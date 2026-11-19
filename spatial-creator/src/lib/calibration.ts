import type { Calibration } from "../types";
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
export function fourCornerCalibration(corners: { x: number; y: number }[][]): Calibration {
  if (corners.length !== 4 || corners.some(c => c.length < 15)) throw new Error("四角各需至少 15 个有效采样帧");
  const p = corners.map(c => ({ x: median(c.map(p => p.x)), y: median(c.map(p => p.y)) }));
  if (!(p[0].x < p[1].x && p[3].x < p[2].x && p[0].y < p[3].y && p[1].y < p[2].y)) throw new Error("四角顺序错误，请按左上、右上、右下、左下采集");
  const result = { x0: (p[0].x + p[3].x) / 2, x1: (p[1].x + p[2].x) / 2, y0: (p[0].y + p[1].y) / 2, y1: (p[2].y + p[3].y) / 2 };
  if (result.x1 - result.x0 < 0.4 || result.y1 - result.y0 < 0.4) throw new Error("校准区域宽高均须至少覆盖摄像头画面的 40%");
  return result;
}
export function ninePointErrors(errors: { x: number; y: number }[], width: number, height: number) {
  if (errors.length !== 9) throw new Error("必须完成九个测试点");
  const diagonal = Math.hypot(width, height);
  const distances = errors.map(e => Math.hypot(e.x * width, e.y * height) / diagonal);
  const rms = Math.sqrt(distances.reduce((s, d) => s + d * d, 0) / 9);
  const max = Math.max(...distances);
  return { rms, max, pass: rms <= 0.02 && max <= 0.04 };
}
