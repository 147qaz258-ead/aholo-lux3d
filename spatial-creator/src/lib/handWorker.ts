/**
 * 手部推理 Worker。
 *
 * 为什么必须有这个文件：MediaPipe 的 GPU delegate 每帧要做一次
 * `gl.readPixels`（把结果张量从 GPU 拉回 CPU），在集成显卡上单次 20–30ms 且同步，
 * 放在主线程等于每 33ms 冻一次页面——面板滚动、光标、按钮悬停全部跟着卡，
 * 实测整页帧率从 60 掉到 30。搬进 Worker 后这笔开销只占 worker 线程。
 *
 * 为什么加载方式这么绕（下面这段 -sMODULARIZE 的说明）：
 * MediaPipe 的 wasm 加载器是 UMD 工厂，靠 `importScripts()`（经典 worker）或
 * `document.createElement("script")`（主线程）把自己挂到全局 `ModuleFactory`。
 * Vite 在 dev 下只会产出 module worker——没有 document，`importScripts` 也存在但抛
 * TypeError，于是 MediaPipe 退回 `import(url)`，而 module 作用域里的 `var ModuleFactory`
 * 不会变成全局，最终以 "Failed to fetch dynamically imported module" 失败。
 *
 * 解法：worker 自己 fetch 加载器源码，用间接 eval 在全局作用域执行（`var` 会成为全局属性），
 * 再给 MediaPipe 一个空的 loader 占位以跳过它自己的加载逻辑。生产构建打成 iife 经典
 * worker 时这条路同样成立，不需要分支。
 */

import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { isSoftwareRenderer, webGlRenderer } from "./renderInfo";

type Delegate = "GPU" | "CPU";
type InitMsg = { type: "init"; wasm: string; model: string; numHands: number; delegate?: Delegate; auto?: boolean };
type FrameMsg = { type: "frame"; bitmap: ImageBitmap; ts: number; generation:number };
type Msg = InitMsg | FrameMsg;

type HandOut = { pts: Float32Array; world: Float32Array; label: "Left" | "Right" };

let lm: HandLandmarker | null = null;
let backend: Delegate = "CPU";
let config: InitMsg | null = null;
let detectErrors = 0;
let recovering = false;
let lastDetectTs = 0;

function post(m: unknown, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(m, transfer);
}

/** 把 wasm 加载器挂到全局 ModuleFactory（见文件头说明） */
async function ensureFactory(wasmBase: string) {
  if ((self as unknown as { ModuleFactory?: unknown }).ModuleFactory) return;
  const url = `${wasmBase}/vision_wasm_internal.js`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载器获取失败 ${res.status}`);
  const text = await res.text();
  // 间接 eval：在 worker 全局作用域执行，UMD 的 var 才会成为 self 上的属性
  (0, eval)(text);
  if (!(self as unknown as { ModuleFactory?: unknown }).ModuleFactory) {
    throw new Error("wasm 加载器未导出 ModuleFactory");
  }
}

/** 占位 loader：让 MediaPipe 自己的加载流程空转，真实工厂已经在全局就位 */
function stubFileset(wasmBase: string) {
  const stub = URL.createObjectURL(new Blob([""], { type: "text/javascript" }));
  return {
    wasmLoaderPath: stub,
    wasmBinaryPath: `${wasmBase}/vision_wasm_internal.wasm`,
  };
}

async function create({ wasm, model, numHands, auto }: InitMsg, delegate: Delegate) {
  const canvas = new OffscreenCanvas(1, 1);
  if (delegate === "GPU" && auto) {
    const gl = canvas.getContext("webgl2", { powerPreference: "high-performance", failIfMajorPerformanceCaveat: true });
    if (!gl || isSoftwareRenderer(webGlRenderer(gl))) throw new Error("没有可用的硬件 WebGL");
  }
  let stub = false;
  const vision = await ensureFactory(wasm).then(() => { stub = true; return stubFileset(wasm); }, () => FilesetResolver.forVisionTasks(wasm));
  try {
    const landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: model, delegate }, canvas,
      runningMode: "VIDEO", numHands,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.4,
    });
    if (delegate === "GPU") {
      // Pre-compile WebGL shaders before reporting ready so the first camera frame does not stall.
      const warm = new OffscreenCanvas(64, 64);
      warm.getContext("2d")?.fillRect(0, 0, 64, 64);
      const bmp = warm.transferToImageBitmap();
      try {
        lastDetectTs = Math.max(lastDetectTs + 1, 1);
        landmarker.detectForVideo(bmp, lastDetectTs);
      } finally {
        bmp.close();
      }
    }
    return landmarker;
  } finally {
    if (stub) URL.revokeObjectURL(vision.wasmLoaderPath);
  }
}

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;

  if (m.type === "init") {
    if (lm) {
      post({ type: "ready", backend });
      return;
    }
    config = m;
    const first = m.delegate ?? "CPU";
    try {
      lm = await create(m, first);
      backend = first;
    } catch (e1) {
      try {
        if (first === "CPU") throw e1;
        lm = await create(m, "CPU");
        backend = "CPU";
      } catch (e2) {
        post({ type: "error", msg: (e2 as Error)?.message || "模型加载失败" });
        return;
      }
    }
    post({ type: "ready", backend });
    return;
  }

  if (m.type === "frame") {
    const bmp = m.bitmap;
    if (!lm || recovering) {
      bmp.close();
      post({ type: "frameError", generation: m.generation });
      return;
    }
    const t0 = performance.now();
    const ts = Math.max(lastDetectTs + 1, m.ts);
    lastDetectTs = ts;
    let res;
    try {
      res = lm.detectForVideo(bmp, ts);
    } catch (err) {
      bmp.close();
      if (backend === "GPU" && ++detectErrors >= 2 && config) {
        recovering = true;
        try {
          try { lm.close(); } catch { /* The GPU context may already be lost. */ }
          lm = await create(config, "CPU");
          backend = "CPU";
          post({ type: "backend", backend, generation: m.generation });
        } catch (fallbackError) {
          lm = null;
          post({ type: "fatal", generation: m.generation, msg: (fallbackError as Error).message });
          return;
        } finally {
          recovering = false;
        }
      }
      post({ type: "frameError", generation:m.generation, msg: (err as Error)?.message || "推理失败" });
      return;
    }
    detectErrors = 0;
    const ms = performance.now() - t0;
    bmp.close();

    const hands: HandOut[] = [];
    const transfer: Transferable[] = [];
    (res.landmarks || []).forEach((points, i) => {
      const pts = new Float32Array(63);
      for (let k = 0; k < 21; k++) {
        const p = points[k] || { x: 0, y: 0, z: 0 };
        pts[k * 3] = p.x;
        pts[k * 3 + 1] = p.y;
        pts[k * 3 + 2] = p.z;
      }
      const w = new Float32Array(63);
      const wp = res.worldLandmarks?.[i];
      if (wp) {
        for (let k = 0; k < 21; k++) {
          const p = wp[k] || { x: 0, y: 0, z: 0 };
          w[k * 3] = p.x;
          w[k * 3 + 1] = p.y;
          w[k * 3 + 2] = p.z;
        }
      }
      const raw = res.handedness?.[i]?.[0]?.categoryName;
      hands.push({ pts, world: w, label: raw === "Left" ? "Left" : "Right" });
      transfer.push(pts.buffer, w.buffer);
    });
    post({ type: "result", ts: m.ts, generation:m.generation, doneAt: performance.now(), ms, hands }, transfer);
  }
};
