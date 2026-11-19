import { handState, OneEuro, resetHandState, type HandFrame } from "./handState";
import {
  classifyGesture,
  FingerStabilizer,
  isClosedFist,
  palmScale,
  pinchRatio,
  pinchValueFromRatio,
  mapCalibrated,
  clamp01,
} from "./gesture";
import { metrics } from "./metrics";
import type { Settings } from "../types";
// 经典 Worker（iife）：MediaPipe 在 Worker 内用 importScripts 加载 wasm，module worker 没有该函数
import HandWorker from "./handWorker?worker";
import { ConfirmedPinch, HandIdentity } from "./handIdentity";
import { recorder } from "./recorder";

type Pt = { x: number; y: number; z: number };

const MODEL_URL = "/models/hand_landmarker.task";
const WASM_URL = "/wasm";

/** 送帧节流：摄像头本身 30fps（33ms/帧），再密只是重复抓同一帧 */
const MIN_SEND_MS = 30;

/**
 * 送进 Worker 前先缩放。
 * MediaPipe 的 GPU delegate 每帧要把输入纹理 readPixels 回 CPU，耗时几乎正比于像素数：
 * 1280×720 单帧 35ms，640×360 约 1/4。关键点精度对 640 宽完全够用（21 点只有 2 位小数级差异）。
 */
const FEED_W = 640;
const FEED_H = 360;

type WorkerResult = {
  type: "result";
  ts: number;
  doneAt: number;
  ms: number;
  generation: number;
  hands: { pts: Float32Array; world: Float32Array; label: "Left" | "Right" }[];
};

/**
 * 手部追踪：主线程负责"取帧 + 结果换算"，推理整个搬进 Worker。
 *
 * 历史教训：推理留在主线程时，MediaPipe 每帧 `gl.readPixels` 要 20–30ms，
 * 页面被拖到 30fps，用户感受是"整个应用都在卡"。见 handWorker.ts 顶部的说明。
 */
export class HandTracker {
  private worker: Worker | null = null;
  private video: HTMLVideoElement | null = null;
  private raf = 0;
  private lastVideoTime = -1;
  private lastSendAt = 0;
  private inFlight = false;
  // At most one capture or inference in flight. Capture fresh video when the worker is free.
  private lastFrameTimestamp = 0;
  private lastResultAt = 0;
  private generation = 0;
  private ready = false;
  private backend: "GPU" | "CPU" | null = null;
  /** 每个关键点的 x / y 必须各用一个滤波器：共用一个实例会让第二个轴的 dt≈0 */
  private filters: { handedness: "Left" | "Right"; axes: { x: OneEuro; y: OneEuro }[] }[] = [];
  private fpsWindow: number[] = [];
  private stickyPrimary: number | null = null;
  private identity = new HandIdentity();
  private primaryLastSeen = 0;
  private alternateSince = 0;
  private recoveringFrames = 0;
  private pinchConfirm = new Map<number, ConfirmedPinch>();
  private lastSeen = new Map<number, number>();
  /** 每只手一个五指稳定器：左右手不可共用，否则换手会继承对方的伸展状态 */
  private fingerStab: { handedness: "Left" | "Right"; s: FingerStabilizer }[] = [];
  private settings: Settings;
  private onStatus: (s: "loading" | "ready" | "error", msg?: string) => void;

  constructor(settings: Settings, onStatus: (s: "loading" | "ready" | "error", msg?: string) => void) {
    this.settings = settings;
    this.onStatus = onStatus;
  }

  updateSettings(s: Settings) {
    const smoothChanged = s.smoothing !== this.settings.smoothing;
    this.settings = s;
    if (smoothChanged) {
      this.filters.forEach((hand) =>
        hand.axes.forEach((a) => {
          a.x.setSmoothing(s.smoothing);
          a.y.setSmoothing(s.smoothing);
        }),
      );
    }
  }

  /** 只起 Worker 和模型，不碰摄像头 */
  async init() {
    if (this.worker) return;
    handState.status = "loading";
    this.onStatus("loading");

    const worker = new HandWorker();
    this.worker = worker;

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("手部模型加载超时（35s）")), 35000);
      worker.onmessage = (e: MessageEvent) => {
        const d = e.data;
        if (d?.type === "ready") {
          window.clearTimeout(timer);
          this.backend = d.backend === "CPU" || d.backend === "GPU" ? d.backend : null;
          this.ready = true;
          resolve();
        } else if (d?.type === "error") {
          window.clearTimeout(timer);
          reject(new Error(d.msg || "模型加载失败"));
        }
      };
      worker.onerror = (ev) => {
        window.clearTimeout(timer);
        reject(new Error(ev.message || "Worker 启动失败"));
      };
      const forced = (typeof localStorage !== "undefined" && localStorage.getItem("sc_delegate")) || "";
      worker.postMessage({
        type: "init",
        wasm: WASM_URL,
        model: MODEL_URL,
        numHands: 2,
        delegate: forced === "CPU" ? "CPU" : "GPU",
        auto: forced !== "GPU" && forced !== "CPU",
      });
    }).catch(error => { worker.terminate(); this.worker = null; this.ready = false; throw error; });

    worker.onmessage = (e: MessageEvent) => this.onWorkerMessage(e.data);
    handState.inferenceBackend = this.backend;
    handState.status = "ready";
    this.onStatus("ready");
  }

  async startCamera(video: HTMLVideoElement, deviceId?: string) {
    this.video = video;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 360 }, frameRate: {ideal:30,max:30} }
        : { facingMode: "user", width: { ideal: 640 }, height: { ideal: 360 }, frameRate: {ideal:30,max:30} },
    });
    video.srcObject = stream;
    const track = stream.getVideoTracks()[0];
    const info = track.getSettings();
    handState.cameraInfo = { ...info, readyState: track.readyState, userAgent: navigator.userAgent };
    track.addEventListener("ended", () => {
      if (this.video?.srcObject !== stream) return;
      this.stop();
      resetHandState();
      handState.status = "error";
      this.onStatus("error", "摄像头已断开，请重新启用");
    });
    if (this.settings.calibration && (this.settings.calibration.deviceId !== info.deviceId || this.settings.calibration.mirror !== this.settings.mirror)) {
      this.settings = { ...this.settings, calibration: null };
    }
    video.muted = true;
    video.playsInline = true;
    await video.play();
    if (!this.worker) await this.init();
    handState.inferenceBackend = this.backend;
    handState.status = "ready";
    this.loop();
    return stream;
  }

  stop() {
    handState.inferenceBackend = null;
    this.generation++;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.inFlight = false;
    this.lastVideoTime=-1;this.lastSendAt=0;this.lastFrameTimestamp=this.lastResultAt=0;
    this.stickyPrimary = null; this.recoveringFrames = 0; this.pinchConfirm.clear();
    this.primaryLastSeen = this.alternateSince = 0;
    this.fpsWindow = []; this.lastSeen.clear();
    this.identity = new HandIdentity(); this.filters = []; this.fingerStab = [];
    const s = this.video?.srcObject as MediaStream | null;
    s?.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.srcObject = null;
  }

  destroy() {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
  }

  /**
   * 取帧循环：只在"上一帧结果已回来"且"距上次发送 ≥28ms"时发新帧。
   * 推理慢的时候自动丢帧，而不是把主线程排满队。
   */
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const v = this.video;
    if (!v || !this.ready || v.readyState < 2 || this.inFlight || handState.paused || document.hidden) return;
    if (v.currentTime === this.lastVideoTime) return;
    const now = performance.now();
    if (now - this.lastSendAt < MIN_SEND_MS) return;
    this.lastSendAt = now;
    this.lastVideoTime = v.currentTime;
    this.capture();
  };

  /**
   * 抓一帧并缩到 FEED_W×FEED_H；推理繁忙时不重复分配和丢弃位图。
   * 缩放必须在送进 Worker 之前做：GPU delegate 每帧把输入纹理 readPixels 回 CPU，
   * 耗时几乎正比于像素数，720p→360p 大约是 1/4。
   */
  private capture() {
    const v = this.video;
    if (!v) return;
    this.inFlight = true;
    const capturedAt = performance.now();
    const generation = this.generation;
    createImageBitmap(v, { resizeWidth: FEED_W, resizeHeight: FEED_H, resizeQuality: "low" })
      .then((bmp) => {
        const w = this.worker;
        if (!w || generation !== this.generation) {
          bmp.close();
          if (generation === this.generation) this.inFlight = false;
          return;
        }
        if (handState.paused || document.hidden || capturedAt <= this.lastFrameTimestamp) { bmp.close(); this.inFlight = false; return; }
        this.lastFrameTimestamp = capturedAt;
        w.postMessage({ type: "frame", bitmap: bmp, ts: capturedAt, generation }, [bmp]);
      })
      .catch(() => {
        if (generation === this.generation) this.inFlight = false;
      });
  }

  private onWorkerMessage(d: WorkerResult | { type: string; msg?: string; generation?: number; backend?: "GPU" | "CPU" }) {
    if ("backend" in d && d.type === "backend" && d.backend) {
      this.backend = d.backend;
      if (this.video?.srcObject && handState.status === "ready") handState.inferenceBackend = d.backend;
      return;
    }
    if (d.type === "fatal") {
      if (d.generation !== this.generation) return;
      this.destroy();
      resetHandState();
      handState.status = "error";
      this.onStatus("error", "手势推理已中断，请重新启用摄像头");
      return;
    }
    if (d.type === "result") {
      const r = d as WorkerResult;
      if(r.generation!==this.generation)return;
      this.inFlight = false;
      if(handState.paused||document.hidden||!this.video?.srcObject)return;
      handState.sourceFrameAt = r.ts;
      metrics.markWorkerRoundTrip(performance.now() - r.ts);
      metrics.markDetect(r.ms);
      /* 关键：时间戳必须取主线程的 performance.now()。
       * Worker 的 performance.now() 从 Worker 创建时归零（实测与主线程差 4106ms），
       * 而下游 HandRig / Interaction 判"数据是否新鲜"用的是主线程时钟：
       *   performance.now() - handState.updatedAt < 450
       * 用 worker 的时间会让这个差值恒为几千毫秒 → 判为过期 →
       * 3D 手不显示、DOM 光标不显示、手指点不到界面，全部退回鼠标。
       * 这条链曾在基准里查不出来，因为基准自己伪造了 updatedAt。 */
      const now = performance.now();
      if (this.lastResultAt) {
        const gap = now - this.lastResultAt;
        if (gap < 900) {
          const prev = handState.resultIntervalMs;
          handState.resultIntervalMs = prev ? prev * .7 + gap * .3 : gap;
        }
      }
      this.lastResultAt = now;
      this.ingest(r.hands, now);
      return;
    }
    if (d.type === "frameError") {
      if(d.generation!==this.generation)return;
      this.inFlight = false;
    }
  }

  private ingest(raw: WorkerResult["hands"], now: number) {
    raw = raw.filter(h => h.pts.length === 63 && h.world.length === 63 && h.pts.every(Number.isFinite) && h.world.every(Number.isFinite));
    const cal = this.settings.calibration;
    const mirror = this.settings.mirror;
    const hands: HandFrame[] = [];

    const identity = this.identity.assign(raw.map(h => ({ x: h.pts[0], y: h.pts[1] })), now);
    if (identity.uncertain) {
      handState.trackingState = "IDENTITY_UNCERTAIN"; handState.primary = null; handState.hands = []; handState.twoHand.active = false;
      handState.secondary = null; handState.gesture = "none"; handState.pinched = false;
      this.pinchConfirm.forEach(state => state.interrupt());
      this.recoveringFrames = 0; return;
    }

    const detected = new Set(identity.ids);
    for (const [id, last] of this.lastSeen) {
      if (now - last >= 1500 || (!detected.has(id) && now - last >= 450)) {
        delete this.filters[id];
        delete this.fingerStab[id];
        this.pinchConfirm.delete(id);
        this.lastSeen.delete(id);
      } else if (!detected.has(id)) this.pinchConfirm.get(id)?.interrupt();
    }
    raw.forEach((h, rawIndex) => {
      const i = identity.ids[rawIndex];
      const rawHandedness = h.label;
      this.lastSeen.set(i, now);
      // 手在画面中的检测顺序可能互换；按左右手重建滤波器，避免状态串到另一只手上
      if (!this.filters[i]) {
        this.filters[i] = {
          handedness: rawHandedness,
          axes: Array.from({ length: 21 }, () => {
            // Speed up fast motion while keeping the stationary cutoff adjustable.
            const ax = new OneEuro(3.0, 4.0, 2.0);
            const ay = new OneEuro(3.0, 4.0, 2.0);
            ax.setSmoothing(this.settings.smoothing);
            ay.setSmoothing(this.settings.smoothing);
            return { x: ax, y: ay };
          }),
        };
      }
      const slot = this.filters[i];
      const rawPose: Pt[] = [];
      const caled: Pt[] = [];
      for (let j = 0; j < 21; j++) {
        const x = mirror ? 1 - h.pts[j * 3] : h.pts[j * 3];
        const y = h.pts[j * 3 + 1], z = h.pts[j * 3 + 2];
        rawPose.push({ x, y, z });
        caled.push(mapCalibrated({ x: slot.axes[j].x.filter(x, now), y: slot.axes[j].y.filter(y, now), z }, cal));
      }

      // Pose decisions keep their own hysteresis; avoid delaying them with positional smoothing.
      const palm = palmScale(rawPose);

      if (!this.fingerStab[i]) {
        this.fingerStab[i] = { handedness: rawHandedness, s: new FingerStabilizer() };
      }
      const fingers = this.fingerStab[i].s.update(rawPose);

      const world: Pt[] = [];
      for (let k = 0; k < 21; k++) {
        world.push({ x: h.world[k * 3], y: h.world[k * 3 + 1], z: h.world[k * 3 + 2] });
      }

      const fist = isClosedFist(fingers, world);
      if (fist) {
        // The tucked thumb can still look extended to the wrist-distance test.
        for (const name of Object.keys(fingers.extended) as Array<keyof typeof fingers.extended>) fingers.extended[name] = false;
        fingers.count = 0;
      }
      const pinch = fist ? 0 : pinchValueFromRatio(pinchRatio(rawPose, palm));

      const tip = caled[8];
      const view = { x: clamp01(tip.x), y: clamp01(tip.y) };
      const ndc = { x: view.x * 2 - 1, y: -(view.y * 2 - 1) };

      // 捏合判定带滞回：按下阈值来自设置项，松开阈值更低，避免边缘抖动
      const on = this.settings.pinchSensitivity;
      const off = Math.max(0.2, on - 0.14);
      if (!this.pinchConfirm.has(i)) this.pinchConfirm.set(i, new ConfirmedPinch());
      const pinched = this.pinchConfirm.get(i)!.update(pinch, on, off);

      hands.push({
        id: i,
        timestamp: now, sourceFrameId: handState.frames + 1,
        handedness: mirror ? flipHandedness(rawHandedness) : rawHandedness,
        screen: caled,
        raw: rawPose,
        world,
        view,
        ndc,
        pinch,
        pinchClosure: pinch,
        pinched,
        palm,
        fingers,
      });
    });

    // 主手：优先保持粘性，避免双手同时出现时指针跳变
    let primary: HandFrame | null = null;
    if (this.stickyPrimary !== null) primary = hands.find((h) => h.id === this.stickyPrimary) || null;
    if (primary) { this.primaryLastSeen = now; this.alternateSince = 0; }
    else if (this.stickyPrimary === null) { primary = hands[0] || null; if (primary) { this.stickyPrimary = primary.id; this.primaryLastSeen = now; } }
    else if (now - this.primaryLastSeen > 500 && hands.length) {
      if (!this.alternateSince) this.alternateSince = now;
      if (now - this.alternateSince >= 300) { primary = hands[0]; this.stickyPrimary = primary.id; this.primaryLastSeen = now; this.alternateSince = 0; this.onStatus("ready", "主操作手已切换"); }
    } else if (!hands.length) this.alternateSince = 0;
    const secondary = hands.find((h) => h !== primary) || null;

    handState.hands = hands;
    if (!primary) { this.recoveringFrames = 0; handState.trackingState = "LOST"; }
    else if (this.recoveringFrames < 3) { this.recoveringFrames++; handState.trackingState = this.recoveringFrames >= 3 ? "READY" : "RECOVERING"; }
    else handState.trackingState = "READY";
    handState.primary = handState.trackingState === "READY" ? primary : null;
    handState.secondary = secondary;
    handState.updatedAt = now;

    const wasPinched = handState.pinched;
    if (primary) {
      handState.pinched = primary.pinched;
      handState.gesture = classifyGesture(primary.fingers, primary.pinched);
    } else {
      handState.pinched = false;
      handState.gesture = "none";
    }
    if (handState.pinched !== wasPinched) metrics.markPinch(handState.pinched);

    if (hands.length >= 2) {
      const [first, second] = hands[0].id < hands[1].id ? hands : [hands[1], hands[0]];
      const a = first.view;
      const b = second.view;
      handState.twoHand.active = true;
      handState.twoHand.distance = Math.hypot(a.x - b.x, a.y - b.y);
      handState.twoHand.angle = Math.atan2(b.y - a.y, b.x - a.x);
      handState.twoHand.midNdc = { x: a.x + b.x - 1, y: -((a.y + b.y) - 1) };
    } else {
      handState.twoHand.active = false;
    }

    metrics.markFrame(hands.length);

    this.fpsWindow.push(now);
    while (this.fpsWindow.length > 1 && now - this.fpsWindow[0] > 1000) this.fpsWindow.shift();
    handState.fps = this.fpsWindow.length;
    handState.frames++;
    recorder.handFrame();
  }
}

function flipHandedness(h: "Left" | "Right"): "Left" | "Right" {
  return h === "Left" ? "Right" : "Left";
}

export { mapCalibrated, CalibrationCollector } from "./gesture";
