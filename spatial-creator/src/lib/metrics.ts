/**
 * 运行时性能与交互指标采集。
 *
 * 目的只有一个：让"流畅""跟手""稳定"这类说法变成可复现的数字。
 * 所有数据都来自真实运行路径（同一份生产代码），不做任何模拟。
 *
 * 采样是环形缓冲，内存恒定，不影响渲染帧率。
 */

const CAP = 240;

class Ring {
  private buf: number[] = [];
  push(v: number) {
    this.buf.push(v);
    if (this.buf.length > CAP) this.buf.shift();
  }
  get n() {
    return this.buf.length;
  }
  clear() {
    this.buf.length = 0;
  }
  /** 分位数，输入 0..1 */
  q(p: number): number {
    if (!this.buf.length) return 0;
    const a = [...this.buf].sort((x, y) => x - y);
    const i = Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))));
    return a[i];
  }
  mean(): number {
    if (!this.buf.length) return 0;
    return this.buf.reduce((s, v) => s + v, 0) / this.buf.length;
  }
  max(): number {
    return this.buf.length ? Math.max(...this.buf) : 0;
  }
}

export interface MetricsSnapshot {
  /** 采集窗口（秒） */
  windowSec: number;
  frames: number;
  /** 手部推理耗时（ms） */
  detect: { n: number; p50: number; p95: number; max: number };
  /** 推理帧率 */
  detectFps: number;
  /** 追踪器就绪后，画面中至少有 1 只手的帧占比 */
  handPresence: number;
  pinch: {
    /** 捏合状态切换次数（开+关） */
    toggles: number;
    onCount: number;
    /** 判定 → 指针状态生效的延迟（ms） */
    latencyAvg: number;
    latencyP95: number;
    latencyMax: number;
  };
  pointer: {
    samples: number;
    /** 静止时的指针抖动（归一化屏幕单位 RMS），无静止段时为 null */
    restJitter: number | null;
  };
  stroke: { points: number; perSecond: number };
  render: { fps: number; lastDtMs: number; p50: number; p95: number; p99: number };
  /** 丢手事件次数：从"有手"变为"无手"的次数，衡量追踪连续性 */
  lossEvents: number;
  pipeline: { workerP95: number; feedbackP95: number; feedbackSamples: number };
}

const detectMs = new Ring();
/** 推理时间戳，用于算真实输入帧率（不能用"总帧数 / 总运行时长"，会被空闲期稀释） */
const detectTimes: number[] = [];
const latencyMs = new Ring();
const renderDts = new Ring();
const workerMs = new Ring(), feedbackMs = new Ring();

let t0 = performance.now();
let frames = 0;
let handFrames = 0;
let lossEvents = 0;
let prevHadHand = false;
let toggles = 0;
let pinchesOn = 0;
let pendingPinchAt = 0;
let strokePoints = 0;
let strokeStartAt = 0;

const pointerBuf: { x: number; y: number; t: number }[] = [];
let pointerTotal = 0;

export const metrics = {
  markWorkerRoundTrip(ms: number) { if (ms >= 0) workerMs.push(ms); },
  markFeedback(ms: number) { if (ms >= 0) feedbackMs.push(ms); },
  /** MediaPipe 单帧推理耗时。首帧包含 GPU/WASM 预热，异常值不计入统计 */
  markDetect(ms: number) {
    const now = performance.now();
    detectTimes.push(now);
    if (detectTimes.length > 60) detectTimes.shift();
    if (ms < 500) detectMs.push(ms);
  },

  /** 每帧手部输入结果 */
  markFrame(handCount: number) {
    frames++;
    if (handCount > 0) handFrames++;
    if (prevHadHand && handCount === 0) lossEvents++;
    prevHadHand = handCount > 0;
  },

  /** 追踪器判定捏合状态变化 */
  markPinch(on: boolean) {
    toggles++;
    if (on) {
      pinchesOn++;
      pendingPinchAt = performance.now();
    }
  },

  /** 指针真正响应捏合（同一帧内，用于确认端到端没有多帧延迟） */
  markPinchApplied() {
    if (!pendingPinchAt) return;
    latencyMs.push(performance.now() - pendingPinchAt);
    pendingPinchAt = 0;
  },

  /** 指针位置采样 */
  markPointer(x: number, y: number) {
    pointerTotal++;
    pointerBuf.push({ x, y, t: performance.now() });
    if (pointerBuf.length > 90) pointerBuf.shift();
  },

  /** 笔迹落点 */
  markStrokePoint() {
    if (!strokeStartAt) strokeStartAt = performance.now();
    strokePoints++;
  },

  markStrokeEnd() {
    strokeStartAt = 0;
  },

  /** 渲染帧间隔 */
  markRender(dtMs: number) {
    renderDts.push(dtMs);
  },

  snapshot(): MetricsSnapshot {
    const now = performance.now();
    const windowSec = Math.max(0.001, (now - t0) / 1000);

    // 静止抖动：只有当 90 个采样点覆盖的路径长度很小（手基本不动）时才有意义
    let restJitter: number | null = null;
    if (pointerBuf.length >= 60) {
      let path = 0;
      for (let i = 1; i < pointerBuf.length; i++) {
        path += Math.hypot(pointerBuf[i].x - pointerBuf[i - 1].x, pointerBuf[i].y - pointerBuf[i - 1].y);
      }
      if (path < 0.02) {
        const mx = pointerBuf.reduce((s, p) => s + p.x, 0) / pointerBuf.length;
        const my = pointerBuf.reduce((s, p) => s + p.y, 0) / pointerBuf.length;
        const vx = pointerBuf.reduce((s, p) => s + (p.x - mx) ** 2, 0) / pointerBuf.length;
        const vy = pointerBuf.reduce((s, p) => s + (p.y - my) ** 2, 0) / pointerBuf.length;
        restJitter = Math.sqrt(vx + vy);
      }
    }

    const strokeSec = strokeStartAt ? Math.max(0.01, (now - strokeStartAt) / 1000) : 0;

    return {
      windowSec: +windowSec.toFixed(1),
      frames,
      detect: {
        n: detectMs.n,
        p50: +detectMs.q(0.5).toFixed(2),
        p95: +detectMs.q(0.95).toFixed(2),
        max: +detectMs.max().toFixed(2),
      },
      detectFps: (() => {
        if (detectTimes.length < 2) return 0;
        const span = detectTimes[detectTimes.length - 1] - detectTimes[0];
        return span > 0 ? +(((detectTimes.length - 1) / span) * 1000).toFixed(1) : 0;
      })(),
      handPresence: frames ? +(handFrames / frames).toFixed(3) : 0,
      pinch: {
        toggles,
        onCount: pinchesOn,
        latencyAvg: +latencyMs.mean().toFixed(1),
        latencyP95: +latencyMs.q(0.95).toFixed(1),
        latencyMax: +latencyMs.max().toFixed(1),
      },
      pointer: { samples: pointerTotal, restJitter: restJitter === null ? null : +restJitter.toFixed(5) },
      stroke: { points: strokePoints, perSecond: strokeSec ? +(strokePoints / strokeSec).toFixed(1) : 0 },
      render: {
        fps: renderDts.mean() ? +(1000 / renderDts.mean()).toFixed(1) : 0,
        lastDtMs: +renderDts.q(0.95).toFixed(1),
        p50: +renderDts.q(0.5).toFixed(1), p95: +renderDts.q(0.95).toFixed(1), p99: +renderDts.q(0.99).toFixed(1),
      },
      lossEvents,
      pipeline: { workerP95: +workerMs.q(.95).toFixed(1), feedbackP95: +feedbackMs.q(.95).toFixed(1), feedbackSamples: feedbackMs.n },
    };
  },

  reset() {
    t0 = performance.now();
    workerMs.clear(); feedbackMs.clear();
    detectMs.clear();
    detectTimes.length = 0;
    latencyMs.clear();
    renderDts.clear();
    pointerBuf.length = 0;
    frames = 0;
    handFrames = 0;
    lossEvents = 0;
    prevHadHand = false;
    toggles = 0;
    pinchesOn = 0;
    pendingPinchAt = 0;
    strokePoints = 0;
    strokeStartAt = 0;
    pointerTotal = 0;
  },
};
