/** 单手一帧的可用数据：全部为「已镜像、已校准」的屏幕坐标系 */
export interface HandFrame {
  timestamp?: number;
  sourceFrameId?: number;
  id: number;
  handedness: "Left" | "Right";
  /** 21 个关键点，归一化屏幕坐标 0..1（已镜像、已校准） */
  screen: { x: number; y: number; z: number }[];
  /** 21 个关键点，已镜像但未校准（校准采集用） */
  raw: { x: number; y: number; z: number }[];
  /** MediaPipe world landmarks（米，手部局部坐标系） */
  world: { x: number; y: number; z: number }[];
  /** 归一化屏幕坐标 */
  view: { x: number; y: number };
  ndc: { x: number; y: number };
  /** 捏合比：0 = 完全张开，1 = 指尖贴合 */
  pinch: number;
  pinchClosure?: number;
  pinched: boolean;
  /** 手掌尺度（归一化屏幕单位），用于尺度无关判定 */
  palm: number;
  /** 五指伸展状态（拇指/食指/中指/无名指/小指） */
  fingers: FingerState;
}

export type { GestureName } from "./gesture";
import type { GestureName, FingerState } from "./gesture";

export { CAL_INSET } from "./gesture";

/**
 * 全局手部状态。刻意放在 React 状态之外：
 * 手部数据每帧变化，走 React 会造成 60fps 重渲染。
 * UI 只订阅低频派生量（present / gesture / fps）。
 */
export const handState = {
  trackingState: "READY" as "READY" | "LOST" | "RECOVERING" | "IDENTITY_UNCERTAIN",
  cameraInfo: null as Record<string, unknown> | null,
  inferenceBackend: null as "GPU" | "CPU" | null,
  status: "idle" as "idle" | "loading" | "ready" | "error",
  error: "",
  hands: [] as HandFrame[],
  primary: null as HandFrame | null,
  secondary: null as HandFrame | null,
  gesture: "none" as GestureName,
  pinched: false,
  /** 0..1，指针进入视口的时间戳节流用 */
  updatedAt: 0,
  sourceFrameAt: 0,
  resultIntervalMs: 0,
  /** 用户主动暂停手部输入（空格） */
  paused: false,
  fps: 0,
  frames: 0,
  /** 双手交互：两手间距相对基准的缩放比与旋转角 */
  twoHand: { active: false, distance: 0, angle: 0, midNdc: { x: 0, y: 0 } },
  mouseMode: false,
  mouse: { x: 0.5, y: 0.5, down: false, movedAt: 0 },
};

// A slower but steady worker should not trip the tracking-loss state between results.
export function handInputWindow() {
  return Math.max(120, Math.min(400, handState.resultIntervalMs * 1.5));
}

// Workspace gestures advance only on new results. Keep their dwell through slow, steady inference.
export function handPoseWindow() {
  return Math.max(220, Math.min(800, handState.resultIntervalMs * 2));
}

export function resetHandState() {
  handState.trackingState = "LOST";
  handState.updatedAt = handState.sourceFrameAt = handState.resultIntervalMs = handState.fps = 0;
  handState.hands = [];
  handState.primary = null;
  handState.secondary = null;
  handState.gesture = "none";
  handState.pinched = false;
  handState.twoHand.active = false;
}

/* --------------------------------- 滤波 --------------------------------- */

/** 一欧元滤波：低速重平滑、高速低延迟，手部指针的标准解法 */
export class OneEuro {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;
  constructor(
    private minCutoff = 1.2,
    private beta = 0.5,
    private dCutoff = 1.0,
  ) {}

  /**
   * 平滑度 0..1 映射到截止频率：越大越平滑、越滞后。
   * 区间取 5.2Hz（最跟手）↔ 1.2Hz（最平滑），默认 0.55 落在 3.0Hz。
   * 实测（30fps 阶跃 + σ=6‰ 噪声，见 docs/03-progress.md 阶段 15）：
   *   2.24Hz/β0.03 → 到位 200ms、抖动 1.3‰
   *   3.0Hz/β2.0   → 到位 100ms、抖动 1.4‰   ← 当前默认
   *   4.0Hz/β3.0   → 到位 97ms、抖动 1.7‰（多 0.3‰ 抖动只换 3ms，不划算）
   */
  setSmoothing(s: number) {
    this.minCutoff = 5.2 - 4.0 * clamp01(s);
  }

  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, t: number) {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }
    // t 来自 performance.now()，单位毫秒；alpha 的时间常数以秒为单位，
    // 这里必须换算，否则 dt 会被当成 33 秒，滤波器等价于直通（历史 bug）。
    const dt = Math.max(1e-3, (t - this.tPrev) / 1000);
    this.tPrev = t;
    const dx = (x - this.xPrev) / dt;
    const ad = this.alpha(this.dCutoff, dt);
    this.dxPrev = ad * dx + (1 - ad) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    const a = this.alpha(cutoff, dt);
    this.xPrev = a * x + (1 - a) * this.xPrev;
    return this.xPrev;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
  }
}

export function dist3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, wz = 1) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z - b.z) * wz;
  return Math.hypot(dx, dy, dz);
}

import { clamp01 } from "./gesture";
export { clamp01 };
