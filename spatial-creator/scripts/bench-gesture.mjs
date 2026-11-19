/**
 * 手势判定层量化基准（benchmark）。
 *
 * 为什么可以不用真手就量化：
 * 判定层（捏合滞回、五指伸展、校准映射、滤波）是纯函数，输入是 21 个坐标点。
 * 本脚本用可精确控制参数的合成手部序列驱动**线上同一份代码**，
 * 因此测出的延迟/误触发/抖动是代码的真实属性，不是另一份"测试实现"的结果。
 *
 * 注意边界：MediaPipe 自身的检测准确率（真手 → 关键点）无法用合成数据证明，
 * 必须用真实摄像头。本脚本只对"关键点 → 判定结果"这一段负责。
 *
 * 运行：先起 vite dev（5173），再 node scripts/bench-gesture.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BASE = process.env.BASE || "http://127.0.0.1:5173";
const PW = process.env.PW_PATH || "D:/npm-global/node_modules/playwright/index.js";

const pw = await import(pathToFileURL(PW).href);
const chromium = pw.chromium || pw.default?.chromium;

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader"],
});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
page.on("pageerror", (e) => console.log("PAGEERR", e.message));

await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(800);
// 明确进入鼠标模式：基准脚本要在没有真手的情况下驱动完整交互链路
await page.getByRole("button", { name: "鼠标模式" }).click();
await page.waitForTimeout(900);

const result = await page.evaluate(async () => {
  const g = await import("/src/lib/gesture.ts");
  const hs = await import("/src/lib/handState.ts");
  const OneEuro = hs.OneEuro;

  const round = (v, n = 2) => (Number.isFinite(v) ? +v.toFixed(n) : v);
  const q = (arr, p) => {
    if (!arr.length) return 0;
    const a = [...arr].sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
  };
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

  /* ------------------------- 合成手部几何 ------------------------- */
  let seed = 20261114;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 4294967296);
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (!u) u = rnd();
    while (!v) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const WRIST = { x: 0.5, y: 0.78 };
  const P = 0.12; // 掌宽基准
  const PALM = 0.92 * P; // wrist → 中指根，等于 palmScale()
  // 屏幕坐标 y 向下，-90° 为正上方
  const FING = {
    thumb: { ang: -138, mcp: 0.3 * P, len: 0.52 * P },
    index: { ang: -104, mcp: 0.86 * P, len: 0.55 * P },
    middle: { ang: -90, mcp: 0.92 * P, len: 0.58 * P },
    ring: { ang: -74, mcp: 0.88 * P, len: 0.55 * P },
    pinky: { ang: -56, mcp: 0.8 * P, len: 0.46 * P },
  };
  const pt = (x, y) => ({ x, y, z: 0 });

  /**
   * curl: 0 = 完全伸直，1 = 完全蜷起（指尖落回指根）
   * pinchRatio: 若给出，则把食指指尖放到距拇指尖 ratio*palmScale 处
   */
  function makeHand(opt = {}) {
    const noise = opt.noise ?? 0;
    const curl = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, ...(opt.curl || {}) };
    const lm = new Array(21).fill(null);
    lm[0] = pt(WRIST.x, WRIST.y);
    const chains = {
      thumb: [1, 2, 3, 4],
      index: [5, 6, 7, 8],
      middle: [9, 10, 11, 12],
      ring: [13, 14, 15, 16],
      pinky: [17, 18, 19, 20],
    };
    for (const [name, idxs] of Object.entries(chains)) {
      const f = FING[name];
      const a = (f.ang * Math.PI) / 180;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const effLen = f.len * (1 - curl[name]);
      for (let k = 0; k < 4; k++) {
        const d = f.mcp + effLen * (k / 3);
        lm[idxs[k]] = pt(WRIST.x + ux * d, WRIST.y + uy * d);
      }
    }
    if (opt.pinchRatio !== undefined) {
      const t = lm[4];
      const a = (-58 * Math.PI) / 180;
      const d = opt.pinchRatio * PALM;
      lm[8] = pt(t.x + Math.cos(a) * d, t.y + Math.sin(a) * d);
      lm[7] = pt((lm[6].x + lm[8].x) / 2, (lm[6].y + lm[8].y) / 2);
      lm[6] = pt((lm[5].x + lm[7].x) / 2, (lm[5].y + lm[7].y) / 2);
    }
    if (noise) {
      for (const p of lm) {
        p.x += gauss() * noise;
        p.y += gauss() * noise;
      }
    }
    return lm;
  }

  const mkFilter = () => {
    const f = new OneEuro(1.6, 0.03);
    f.setSmoothing(0.55); // 与默认设置一致
    return f;
  };
  // 与 handTracker 一致：每个关键点的 x / y 各一个滤波器实例
  const newFilters = () => Array.from({ length: 21 }, () => ({ x: mkFilter(), y: mkFilter() }));

  const pipe = (lm, filters, t) =>
    lm.map((p, i) => ({ x: filters[i].x.filter(p.x, t), y: filters[i].y.filter(p.y, t), z: 0 }));

  const ON = 0.62; // 默认拾取阈值
  const OFF = 0.48; // 滞回宽度 0.14
  // 阈值换算成捏合比值，用于判定"真值帧"
  const ON_RATIO = 1.3 - ON * 1.15;
  const OFF_RATIO = 1.3 - OFF * 1.15;
  const STEP = 1000 / 30; // 30fps 输入

  const out = {};

  /* ---------- S1 捏合拾取 / 释放延迟 ---------- */
  {
    const filters = newFilters();
    let latch = false;
    const trace = [];
    const N = 150;
    for (let f = 0; f < N; f++) {
      const t = f * STEP;
      let ratio;
      if (f < 20) ratio = 1.15;
      else if (f < 50) ratio = 1.15 - (1.15 - 0.1) * ((f - 20) / 30);
      else if (f < 90) ratio = 0.1;
      else if (f < 120) ratio = 0.1 + (1.15 - 0.1) * ((f - 90) / 30);
      else ratio = 1.15;
      const fl = pipe(makeHand({ pinchRatio: ratio, noise: 0.0035 }), filters, t);
      const value = g.pinchValueFromRatio(g.pinchRatio(fl, g.palmScale(fl)));
      const before = latch;
      latch = g.decidePinch(value, latch, ON, OFF);
      trace.push({ f, ratio, value, pinched: latch, toggled: latch !== before });
    }
    const truthOn = trace.find((r) => r.ratio <= ON_RATIO);
    const firstOn = trace.find((r) => r.pinched);
    const truthOff = trace.slice(truthOn.f).find((r) => r.ratio >= OFF_RATIO);
    const firstOff = trace.slice(firstOn.f).find((r) => !r.pinched);
    out.pinchLatency = {
      grabMs: round((firstOn.f - truthOn.f) * STEP, 1),
      grabFrames: firstOn.f - truthOn.f,
      releaseMs: round((firstOff.f - truthOff.f) * STEP, 1),
      releaseFrames: firstOff.f - truthOff.f,
      falseToggles: trace.filter((r) => r.toggled).length - 2,
      peakValue: round(Math.max(...trace.map((r) => r.value)), 3),
    };
  }

  /* ---------- S2 张开手静止：误触发 ---------- */
  {
    const filters = newFilters();
    let latch = false;
    let toggles = 0;
    let maxV = 0;
    const vals = [];
    for (let f = 0; f < 300; f++) {
      const t = f * STEP;
      const fl = pipe(makeHand({ pinchRatio: 1.15, noise: 0.005 }), filters, t);
      const value = g.pinchValueFromRatio(g.pinchRatio(fl, g.palmScale(fl)));
      const before = latch;
      latch = g.decidePinch(value, latch, ON, OFF);
      if (latch !== before) toggles++;
      maxV = Math.max(maxV, value);
      if (f > 30) vals.push(value);
    }
    out.falseTrigger = {
      frames: 300,
      toggles,
      maxValue: round(maxV, 3),
      valueStd: round(Math.sqrt(mean(vals.map((v) => (v - mean(vals)) ** 2))), 4),
    };
  }

  /* ---------- S3 捏合保持：掉线 ---------- */
  {
    const filters = newFilters();
    let latch = true; // 已处于捏合
    let toggles = 0;
    let minV = 1;
    for (let f = 0; f < 300; f++) {
      const t = f * STEP;
      const fl = pipe(makeHand({ pinchRatio: 0.12, noise: 0.005 }), filters, t);
      const value = g.pinchValueFromRatio(g.pinchRatio(fl, g.palmScale(fl)));
      const before = latch;
      latch = g.decidePinch(value, latch, ON, OFF);
      if (latch !== before) toggles++;
      if (f > 30) minV = Math.min(minV, value);
    }
    out.holdStability = { frames: 300, dropouts: toggles, minValue: round(minV, 3) };
  }

  /* ---------- S4 指针抖动与跟随滞后 ---------- */
  {
    // 静止抖动
    const filters = newFilters();
    const rawXs = [];
    const fltXs = [];
    for (let f = 0; f < 150; f++) {
      const t = f * STEP;
      const lm = makeHand({ noise: 0 });
      const jx = gauss() * 0.006;
      const jy = gauss() * 0.006;
      lm[8] = pt(lm[8].x + jx, lm[8].y + jy);
      const fl = pipe(lm, filters, t);
      if (f >= 60) {
        rawXs.push(lm[8].x);
        fltXs.push(fl[8].x);
      }
    }
    const std = (a) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));
    const rawStd = std(rawXs);
    const fltStd = std(fltXs);

    // 1Hz 往返跟随
    const filters2 = newFilters();
    const truth = [];
    const filtered = [];
    for (let f = 0; f < 240; f++) {
      const t = f * STEP;
      const x = 0.5 + 0.15 * Math.sin((2 * Math.PI * 1.0 * t) / 1000);
      const lm = makeHand({ noise: 0.002 });
      lm[8] = pt(x, lm[8].y);
      const fl = pipe(lm, filters2, t);
      if (f >= 40) {
        truth.push(lm[8].x);
        filtered.push(fl[8].x);
      }
    }
    let bestShift = 0;
    let bestErr = Infinity;
    for (let s = 0; s <= 8; s++) {
      let err = 0;
      let n = 0;
      for (let i = s; i < truth.length; i++) {
        err += (filtered[i] - truth[i - s]) ** 2;
        n++;
      }
      err = Math.sqrt(err / n);
      if (err < bestErr) {
        bestErr = err;
        bestShift = s;
      }
    }
    out.pointer = {
      restJitterRaw: round(rawStd, 5),
      restJitterFiltered: round(fltStd, 5),
      jitterReductionPct: round((1 - fltStd / rawStd) * 100, 1),
      followLagMs: round(bestShift * STEP, 1),
      followRmsError: round(bestErr, 4),
    };
  }

  /* ---------- S5 校准映射：重复精度与覆盖率 ---------- */
  {
    const RECT = { x0: 0.22, x1: 0.78, y0: 0.18, y1: 0.82 };
    const collector = new g.CalibrationCollector();
    const corners = [
      [RECT.x0, RECT.y0],
      [RECT.x1, RECT.y0],
      [RECT.x1, RECT.y1],
      [RECT.x0, RECT.y1],
    ];
    for (const [cx, cy] of corners) {
      for (let i = 0; i < 40; i++) {
        collector.add({ x: cx + gauss() * 0.008, y: cy + gauss() * 0.008 });
      }
    }
    const cal = collector.result();
    const inset = g.CAL_INSET;
    const std = (a) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));

    // 重复精度：同一个物理位置被噪声扰动后，映射结果的离散程度
    const repeat = [];
    for (const fx of [0, 0.5, 1]) {
      for (const fy of [0, 0.5, 1]) {
        const px = RECT.x0 + (RECT.x1 - RECT.x0) * fx;
        const py = RECT.y0 + (RECT.y1 - RECT.y0) * fy;
        const xs = [];
        const ys = [];
        for (let i = 0; i < 20; i++) {
          const m = g.mapCalibrated({ x: px + gauss() * 0.004, y: py + gauss() * 0.004, z: 0 }, cal);
          xs.push(m.x);
          ys.push(m.y);
        }
        repeat.push(Math.hypot(std(xs), std(ys)));
      }
    }

    // 覆盖率：校准矩形四角映射后覆盖的视口跨度（1.0 = 满屏）
    const m00 = g.mapCalibrated({ x: RECT.x0, y: RECT.y0, z: 0 }, cal);
    const m11 = g.mapCalibrated({ x: RECT.x1, y: RECT.y1, z: 0 }, cal);

    out.calibration = {
      collected: collector.samples,
      capturedRect: cal ? { w: round(cal.x1 - cal.x0, 3), h: round(cal.y1 - cal.y0, 3) } : null,
      repeatStdMean: round(mean(repeat), 4),
      repeatStdPx1920: Math.round(mean(repeat) * 1920),
      coverageX: round(m11.x - m00.x, 3),
      coverageY: round(m11.y - m00.y, 3),
      inset,
    };
  }

  /* ---------- S6 手势类别与手指数识别准确率 ---------- */
  {
    const poses = [
      { name: "open", opt: {}, gesture: "open", count: 5 },
      { name: "fist", opt: { curl: { thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1 } }, gesture: "fist", count: 0 },
      {
        name: "point",
        opt: { curl: { thumb: 1, middle: 1, ring: 1, pinky: 1 } },
        gesture: "point",
        count: 1,
      },
      {
        name: "peace",
        opt: { curl: { thumb: 1, ring: 1, pinky: 1 } },
        gesture: "peace",
        count: 2,
      },
      {
        name: "pinch",
        opt: { pinchRatio: 0.12, curl: { middle: 1, ring: 1, pinky: 1 } },
        gesture: "pinch",
        count: null, // 捏合姿态下手指数不作要求
      },
      {
        name: "spread",
        opt: { curl: { thumb: 1, middle: 1, pinky: 1 } },
        gesture: "spread",
        count: 2,
      },
    ];
    const SAMPLES = 40;
    const GESTURE_NOISE = 0.004;
    const rows = [];
    let correct = 0;
    let total = 0;
    let countCorrect = 0;
    let countTotal = 0;
    for (const pose of poses) {
      let ok = 0;
      const miss = {};
      const hist = {};
      for (let i = 0; i < SAMPLES; i++) {
        const lm = makeHand({ ...pose.opt, noise: GESTURE_NOISE });
        const fs = g.fingerState(lm);
        const pinchVal = g.pinchValueFromRatio(g.pinchRatio(lm, g.palmScale(lm)));
        const pinched = pinchVal > ON;
        const gest = g.classifyGesture(fs, pinched);
        total++;
        if (gest === pose.gesture) {
          ok++;
          correct++;
        } else {
          miss[gest] = (miss[gest] || 0) + 1;
        }
        hist[fs.count] = (hist[fs.count] || 0) + 1;
        if (pose.count !== null) {
          countTotal++;
          if (fs.count === pose.count) countCorrect++;
        }
      }
      rows.push({ pose: pose.name, expect: pose.gesture, hit: `${ok}/${SAMPLES}`, miss, hist, want: pose.count });
    }
    /* 噪声余量：准确率能撑到多大抖动，比"100%"本身更有信息量 */
    const sweep = [];
    for (const sigma of [0.004, 0.008, 0.012, 0.016]) {
      let okS = 0;
      let nS = 0;
      for (const pose of poses) {
        if (pose.count === null) continue;
        for (let i = 0; i < SAMPLES; i++) {
          const fs = g.fingerState(makeHand({ ...pose.opt, noise: sigma }));
          nS++;
          if (fs.count === pose.count) okS++;
        }
      }
      sweep.push({ sigma, accuracy: round((okS / nS) * 100, 1), samples: nS });
    }
    out.fingerNoiseSweep = sweep;

    /* 保持姿态时的时序稳定性：σ=0.008（约 15px，接近真机抖动） */
    const stab = new g.FingerStabilizer();
    let steadyOk = 0;
    let steadyN = 0;
    let flips = 0;
    for (const pose of poses) {
      if (pose.count === null) continue;
      stab.reset();
      let prev = null;
      for (let i = 0; i < 40; i++) {
        const fs = stab.update(makeHand({ ...pose.opt, noise: 0.008 }));
        if (i >= 10) {
          steadyN++;
          if (fs.count === pose.count) steadyOk++;
          if (prev !== null && fs.count !== prev) flips++;
        }
        prev = fs.count;
      }
    }
    out.fingerSequence = {
      sigma: 0.008,
      steadyAccuracy: round((steadyOk / steadyN) * 100, 1),
      steadySamples: steadyN,
      flips,
    };

    out.classification = {
      rows,
      gestureAccuracy: round((correct / total) * 100, 1),
      samples: total,
      fingerCountAccuracy: round((countCorrect / countTotal) * 100, 1),
      countSamples: countTotal,
    };
  }

  return out;
});

/* ---------- S7 真实 UI：笔迹采样率（走完整 Interaction 路径） ---------- */
await page.evaluate(() => window.__spatial.useApp.getState().setTool("draw"));
await page.waitForTimeout(200);
const box = await page.locator(".viewport canvas").boundingBox();
const cx = box.x + box.width * 0.5;
const cy = box.y + box.height * 0.5;
await page.evaluate(() => window.__spatial.metrics.reset());
const t0 = Date.now();
await page.mouse.move(cx, cy);
// 让指针先定位：down 紧接 move 时 pinchEdge 会拿到上一帧射线，整条笔迹丢失
await page.waitForTimeout(150);
await page.mouse.down();
// 等第一个落点出现再开始计数：down 与首帧之间若插进移动，起笔会被丢掉
await page
  .waitForFunction(() => (window.__spatial.drawRuntime?.points?.length ?? 0) > 0, { timeout: 3000 })
  .catch(() => {});
if (process.env.DBG_S7) {
  console.log("S7 状态", JSON.stringify(await page.evaluate(() => ({
    pts: window.__spatial.drawRuntime.points.length,
    block: window.__spatial.uiPointer.blockScene,
    over: window.__spatial.uiPointer.overUi,
    target: window.__spatial.uiPointer.target?.className || null,
    src: window.__spatial.pointerRuntime.source,
    hand: !!window.__spatial.handState.primary,
    paused: window.__spatial.handState.paused,
    mouseMode: window.__spatial.handState.mouseMode,
    down: window.__spatial.handState.mouse.down,
    tool: window.__spatial.useApp.getState().tool,
    ndc: [+window.__spatial.pointerRuntime.ndc.x.toFixed(2), +window.__spatial.pointerRuntime.ndc.y.toFixed(2)],
  }))));
}
for (let i = 0; i < 60; i++) {
  const a = (i / 60) * Math.PI * 2;
  await page.mouse.move(cx + Math.cos(a) * 120, cy + Math.sin(a) * 120);
  await page.waitForTimeout(33);
}
await page.mouse.up();
// 抬手的 commitStroke 发生在下一帧 useFrame 里；不等就直接读会读到"笔迹还没提交"，得 0
await page
  .waitForFunction(() => window.__spatial.useApp.getState().objects.some((o) => o.kind === "stroke"), { timeout: 3000 })
  .catch(() => {});
await page.waitForTimeout(150);
const strokeSec = (Date.now() - t0) / 1000;
const snap = await page.evaluate(() => window.__spatial.metrics.snapshot());
const stroke = await page.evaluate(() => {
  const objs = window.__spatial.useApp.getState().objects.filter((o) => o.kind === "stroke");
  return objs.length ? objs[objs.length - 1].points.length : 0;
});

result.strokeUi = {
  durationSec: +strokeSec.toFixed(2),
  inputs: 60,
  pointsInLastStroke: stroke,
  acceptRate: +(stroke / 60).toFixed(2),
  pointsPerSec: +(stroke / strokeSec).toFixed(1),
  renderFps: snap.render.fps,
  renderP95DtMs: snap.render.lastDtMs,
  pointerSamples: snap.pointer.samples,
};

/* ---------- 汇总输出 ---------- */
const p = result.pinchLatency;
const ptr = result.pointer;
const cls = result.classification;
const cal = result.calibration;
const ft = result.falseTrigger;
const hold = result.holdStability;
const s7 = result.strokeUi;

const lines = [];
lines.push("");
lines.push("手势判定层基准（合成序列驱动线上同一份代码，30fps 输入）");
lines.push("─".repeat(74));
lines.push(`S1 捏合拾取延迟        ${p.grabMs} ms (${p.grabFrames} 帧)  释放 ${p.releaseMs} ms  多余切换 ${p.falseToggles}`);
lines.push(`S2 张开手静止误触发    ${ft.toggles} 次 / ${ft.frames} 帧，最大捏合值 ${ft.maxValue}（阈值 0.62）`);
lines.push(`S3 捏合保持掉线        ${hold.dropouts} 次 / ${hold.frames} 帧，最低捏合值 ${hold.minValue}（释放阈值 0.48）`);
lines.push(
  `S4 指针静止抖动        ${ptr.restJitterRaw} → ${ptr.restJitterFiltered}（降 ${ptr.jitterReductionPct}%）`,
);
lines.push(`S4 1Hz 跟随滞后        ${ptr.followLagMs} ms，RMS 误差 ${ptr.followRmsError}`);
lines.push(
  `S5 校准重复精度        ${cal.repeatStdPx1920} px @1920  覆盖率 X ${(cal.coverageX * 100).toFixed(0)}% / Y ${(cal.coverageY * 100).toFixed(0)}%（设计留边 ${cal.inset * 100}%）`,
);
lines.push(`S6 手势类别准确率      ${cls.gestureAccuracy}%（${cls.samples} 样本）  手指数准确率 ${cls.fingerCountAccuracy}%（${cls.countSamples} 样本）`);
lines.push(
  `S7 笔迹落点            输入 ${s7.inputs} 次 → ${s7.pointsInLastStroke} 点（落点率 ${(s7.acceptRate * 100).toFixed(0)}%），渲染 ${s7.renderFps} fps`,
);
lines.push("─".repeat(74));
lines.push(
  `S6b 噪声余量          手指数准确率 ` +
    (result.fingerNoiseSweep || []).map((r) => `σ=${r.sigma}:${r.accuracy}%`).join(" / "),
);
lines.push(
  `S6c 保持姿态（σ=0.008） 稳态准确率 ${result.fingerSequence?.steadyAccuracy}%（${result.fingerSequence?.steadySamples} 帧）  帧间翻转 ${result.fingerSequence?.flips} 次`,
);
lines.push(
  "S6 手指数分布：" + cls.rows.map((r) => `${r.pose}(期望${r.want ?? "-"})=${JSON.stringify(r.hist)}`).join("  "),
);
lines.push(
  "S6 明细：" +
    cls.rows
      .map((r) => {
        const miss = Object.entries(r.miss || {})
          .map(([k, v]) => `误判${k}×${v}`)
          .join("/");
        return `${r.pose}=${r.hit}${miss ? `(${miss})` : ""}`;
      })
      .join("  "),
);
lines.push("");

console.log(lines.join("\n"));

mkdirSync("test-artifacts", { recursive: true });
writeFileSync("test-artifacts/bench-gesture.json", JSON.stringify(result, null, 2), "utf-8");

await browser.close();
