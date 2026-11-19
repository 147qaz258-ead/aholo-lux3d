/**
 * 手势判定层：与 MediaPipe 解耦的纯函数。
 *
 * 为什么单独抽出来：
 * 1. 判定逻辑可以被离线基准脚本（scripts/bench-gesture.mjs）直接量化，
 *    数字来自线上同一份代码，而不是另一份"测试用"实现。
 * 2. 阈值集中在一处，调参不需要改 tracker。
 *
 * 姿态计算使用已镜像、未校准的图像归一化坐标，避免活动矩形的非等比拉伸改变捏合比例。
 * 映射函数单独产生已校准的视口坐标。食指指尖 = 8，拇指指尖 = 4，腕 = 0。
 */

import type { Calibration } from "../types";

export type Pt = { x: number; y: number; z: number };

/** 拇指-食指距离 / 掌宽 的比值区间：1.3 视为完全张开，0.15 视为贴合 */
export const PINCH_OPEN_RATIO = 1.3;
export const PINCH_CLOSED_RATIO = 0.15;

/** 掌宽：腕(0) 到 中指根(9) 的距离，用作尺度归一 */
export function palmScale(lm: Pt[]): number {
  return Math.max(1e-4, Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y));
}

/** 捏合原始比值（与尺度无关，手离镜头远近不影响） */
export function pinchRatio(lm: Pt[], palm = palmScale(lm)): number {
  return Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y) / palm;
}

/** 比值 → 0..1 的捏合强度 */
export function pinchValueFromRatio(ratio: number): number {
  const v = (PINCH_OPEN_RATIO - ratio) / (PINCH_OPEN_RATIO - PINCH_CLOSED_RATIO);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 带滞回的开关判定。on 为拾取阈值（默认 0.62），off 为释放阈值。
 * 滞回宽度决定"边缘抖动时不反复切换"的鲁棒性。
 */
export function decidePinch(value: number, wasOn: boolean, on: number, off: number): boolean {
  return wasOn ? value > off : value > on;
}

/* ------------------------------ 五指伸展度 ------------------------------ */

export type FingerName = "thumb" | "index" | "middle" | "ring" | "pinky";

interface FingerDef {
  name: FingerName;
  tip: number;
  pip: number;
  mcp: number;
  /** 蜷起时的比值：指尖落回指根，比值趋近 1 */
  curled: number;
  /** 伸直时的比值：来自手掌解剖比例，用于归一化 */
  straight: number;
  /**
   * 分母基准。四指用「腕→指根」，拇指的指根离腕太近，
   * 蜷起时分母趋近 0，比值噪声放大数倍，所以改用掌宽做分母。
   */
  basis: "mcp" | "palm";
}

/**
 * 旧实现直接拿比值比阈值，问题是"伸直 1.64 / 阈值 1.50"只剩 0.14 余量，
 * 按关键点噪声折算约 2σ，半屈姿态会随机翻转。
 * 现在把比值归一化成伸展度 0..1：伸展度 = (比值 - 蜷起) / (伸直 - 蜷起)，
 * 判定点 0.55、滞回 0.42，食指余量从 0.14 提升到 0.30 以上。
 */
export const FINGERS: FingerDef[] = [
  { name: "thumb", tip: 4, pip: 3, mcp: 2, curled: 0.33, straight: 0.89, basis: "palm" },
  { name: "index", tip: 8, pip: 6, mcp: 5, curled: 1.0, straight: 1.72, basis: "mcp" },
  { name: "middle", tip: 12, pip: 10, mcp: 9, curled: 1.0, straight: 1.7, basis: "mcp" },
  { name: "ring", tip: 16, pip: 14, mcp: 13, curled: 1.0, straight: 1.68, basis: "mcp" },
  { name: "pinky", tip: 20, pip: 18, mcp: 17, curled: 1.0, straight: 1.6, basis: "mcp" },
];

/** 伸展判定点与滞回：按下 0.55，保持到 0.42 才松开 */
export const EXT_ON = 0.55;
export const EXT_OFF = 0.42;

export interface FingerState {
  /** 每指原始伸展比（tan 值），用于调试 */
  ratio: Record<FingerName, number>;
  /** 归一化伸展度 0..1，可直接做进度条 */
  ext: Record<FingerName, number>;
  extended: Record<FingerName, boolean>;
  /** 0..5 */
  count: number;
}

const ZERO_ON = { thumb: false, index: false, middle: false, ring: false, pinky: false };

/** 五指伸展度（无状态，单帧判定）。时序稳定请用 FingerStabilizer */
export function fingerState(lm: Pt[]): FingerState {
  const wrist = lm[0];
  const palm = palmScale(lm);
  const ratio = {} as Record<FingerName, number>;
  const ext = {} as Record<FingerName, number>;
  const extended = {} as Record<FingerName, boolean>;
  let count = 0;
  for (const f of FINGERS) {
    const tip = lm[f.tip];
    const mcp = lm[f.mcp];
    const denom =
      f.basis === "palm" ? palm : Math.max(1e-4, Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y));
    const r = Math.hypot(tip.x - wrist.x, tip.y - wrist.y) / denom;
    const e = clamp01((r - f.curled) / Math.max(1e-4, f.straight - f.curled));
    ratio[f.name] = r;
    ext[f.name] = e;
    const on = e > EXT_ON;
    extended[f.name] = on;
    if (on) count++;
  }
  return { ratio, ext, extended, count };
}

/**
 * 五指时序稳定器：每指独立滞回，消除"半屈姿态逐帧翻转"。
 * 每只手一个实例（左右手不可共用，否则切换时会继承对方的伸展状态）。
 */
export class FingerStabilizer {
  private on: Record<FingerName, boolean> = { ...ZERO_ON };
  /** 平滑后的伸展度；首帧直接取原值，避免从 0 爬升导致"抬手半秒才认" */
  private ema: Record<FingerName, number> | null = null;

  update(lm: Pt[]): FingerState {
    const fs = fingerState(lm);
    if (!this.ema) this.ema = { ...fs.ext };
    let count = 0;
    for (const f of FINGERS) {
      const smoothed = this.ema[f.name] * 0.55 + fs.ext[f.name] * 0.45;
      this.ema[f.name] = smoothed;
      const v = smoothed;
      const next = this.on[f.name] ? v > EXT_OFF : v > EXT_ON;
      this.on[f.name] = next;
      fs.extended[f.name] = next;
      if (next) count++;
    }
    fs.count = count;
    return fs;
  }

  reset() {
    this.on = { ...ZERO_ON };
    this.ema = null;
  }
}

/** A fist can overlap the fingertips in the image without touching in 3D. */
export function isClosedFist(fs: FingerState, world: Pt[]): boolean {
  const r = fs.ratio;
  if (r.index >= 1.12 || r.middle >= 1.18 || r.ring >= 1.18 || r.pinky >= 1.18) return false;
  const distance = (a: number, b: number) => Math.hypot(world[a].x - world[b].x, world[a].y - world[b].y, world[a].z - world[b].z);
  const palm = distance(0, 9);
  if (palm < .001) return false;
  return distance(4, 9) / palm < .70 && distance(4, 8) / palm > .12;
}

export type GestureName = "none" | "point" | "pinch" | "open" | "fist" | "peace" | "three" | "spread";

/**
 * 手势类别判定。优先级：捏合 > 食指单指 > 剪刀手 > 张开 > 握拳 > 其它。
 * 捏合必须最高优先，因为它是所有交互的"按下"语义。
 */
export function classifyGesture(fs: Pick<FingerState, "extended" | "count">, pinched: boolean): GestureName {
  if (pinched) return "pinch";
  const e = fs.extended;
  const ix = e.index;
  const mid = e.middle;
  const ring = e.ring;
  const pink = e.pinky;
  if (ix && !mid && !ring && !pink) return "point";
  if (ix && mid && !ring && !pink) return "peace";
  if (ix && mid && ring && !pink && !e.thumb) return "three";
  if (fs.count >= 4) return "open";
  if (fs.count === 0) return "fist";
  return "spread";
}

/** 视口内缩比例：校准后的可用区域离画面边缘留出 4% */
export const CAL_INSET = 0.04;

/**
 * 校准映射：把手指在真实可达矩形内的坐标，线性拉伸到视口可用区。
 * 这是"手只能动 30cm，但要控制整块屏幕"的唯一解法。
 */
export function mapCalibrated(p: Pt, cal: Calibration | null): Pt {
  if (!cal) return p;
  const sx = Math.max(0.15, cal.x1 - cal.x0);
  const sy = Math.max(0.15, cal.y1 - cal.y0);
  const vx = (p.x - cal.x0) / sx;
  const vy = (p.y - cal.y0) / sy;
  const inset = CAL_INSET;
  return {
    x: inset + clamp01(vx) * (1 - inset * 2),
    y: inset + clamp01(vy) * (1 - inset * 2),
    z: p.z,
  };
}

export function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 双手：两点距离与连线角度（缩放/旋转用） */
export function twoHandMetrics(a: Pt, b: Pt) {
  return {
    distance: Math.hypot(a.x - b.x, a.y - b.y),
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

/**
 * 校准采集器：统计一段时间内指尖覆盖范围，得到一个真实可达矩形。
 * 手指在空中的活动范围远小于摄像头画面，不做这一步指针永远够不到屏幕边缘。
 */
export class CalibrationCollector {
  private x0 = 1;
  private x1 = 0;
  private y0 = 1;
  private y1 = 0;
  private n = 0;
  add(p: { x: number; y: number }) {
    this.x0 = Math.min(this.x0, p.x);
    this.x1 = Math.max(this.x1, p.x);
    this.y0 = Math.min(this.y0, p.y);
    this.y1 = Math.max(this.y1, p.y);
    this.n++;
  }
  result(): Calibration | null {
    if (this.n < 10 || this.x1 - this.x0 < 0.18 || this.y1 - this.y0 < 0.15) return null;
    // 不再额外外扩：mapCalibrated 已有 4% 内缩保证边界可用，
    // 这里再外扩会让映射整体压缩，用户会觉得"够不到屏幕边缘"（实测覆盖率只有 76%）
    return {
      x0: clamp01(this.x0),
      x1: clamp01(this.x1),
      y0: clamp01(this.y0),
      y1: clamp01(this.y1),
    };
  }
  reset() {
    this.x0 = 1;
    this.x1 = 0;
    this.y0 = 1;
    this.y1 = 0;
    this.n = 0;
  }
  get samples() {
    return this.n;
  }
}
