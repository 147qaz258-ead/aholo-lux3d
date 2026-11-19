import { useEffect, useRef, useState } from "react";
import { handState } from "../lib/handState";
import { fourCornerCalibration, ninePointErrors } from "../lib/calibration";
import { mapCalibrated } from "../lib/gesture";
import { useApp } from "../store";
import type { Calibration } from "../types";
import { Modal } from "./Modal";

const CORNERS = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
const NINE = [0.15, 0.5, 0.85].flatMap(y => [0.15, 0.5, 0.85].map(x => [x, y]));
export function CalibrationWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0), [count, setCount] = useState(0), [error, setError] = useState("");
  const candidate = useRef<Calibration | null>(null);
  const corners = useRef<{ x: number; y: number }[][]>([]), errors = useRef<{ x: number; y: number }[]>([]);
  const samples = useRef<{ x: number; y: number }[]>([]), lastFrame = useRef(-1);
  const dot = useRef<HTMLDivElement>(null);
  const target = (step < 4 ? CORNERS : NINE)[step < 4 ? step : step - 4];
  useEffect(() => {
    samples.current = []; setCount(0);
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const primary = handState.primary;
      if (!primary || performance.now() - handState.updatedAt > 120) { samples.current = []; setCount(0); return; }
      if (handState.frames === lastFrame.current) return;
      lastFrame.current = handState.frames;
      const raw = primary.raw[8];
      const p = candidate.current ? mapCalibrated(raw, candidate.current) : raw;
      if (dot.current) { dot.current.style.left = `${p.x * 100}%`; dot.current.style.top = `${p.y * 100}%`; }
      samples.current.push({ x: raw.x, y: raw.y }); samples.current = samples.current.slice(-15);
      setCount(samples.current.length);
    };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [step]);
  const capture = () => {
    try {
      setError(""); const values = samples.current;
      if (values.length < 15) throw new Error("请保持手部可见，等待 15 个有效帧");
      const mean = { x: values.reduce((s, p) => s + p.x, 0) / 15, y: values.reduce((s, p) => s + p.y, 0) / 15 };
      if (values.some(p => Math.hypot(p.x - mean.x, p.y - mean.y) > 0.02)) throw new Error("手指仍在移动，请稳定保持后采集");
      if (step < 4) {
        const next = [...corners.current, [...values]];
        if (step === 3) candidate.current = fourCornerCalibration(next);
        corners.current = next;
      } else {
        const mapped = mapCalibrated({ ...mean, z: 0 }, candidate.current);
        const next = [...errors.current, { x: mapped.x - target[0], y: mapped.y - target[1] }];
        if (step === 12) {
          const measured = ninePointErrors(next, window.innerWidth, window.innerHeight);
          if (!measured.pass) throw new Error(`九点误差超标：RMS ${(measured.rms * 100).toFixed(2)}%，最大 ${(measured.max * 100).toFixed(2)}%。请重新校准，上次有效配置保留。`);
          useApp.getState().updateSettings({ calibration: { ...candidate.current!, deviceId: handState.cameraInfo?.deviceId as string | undefined, mirror: useApp.getState().settings.mirror } });
          useApp.getState().toast("四角与九点测试已完成，校准配置已保存", "ok"); onClose(); return;
        }
        errors.current = next;
      }
      setStep(step + 1);
    } catch (e) { setError((e as Error).message); }
  };
  return <Modal label="四角校准与九点验证" onClose={onClose}>
    <div className="calibration-target" style={{ left: `${target[0] * 100}%`, top: `${target[1] * 100}%` }}>+</div>
    <div ref={dot} className="calibration-dot" />
    <section className="calibration-card panel">
      <h2 className="title-3">{step < 4 ? `四角采集 ${step + 1}/4` : `九点验证 ${step - 3}/9`}</h2>
      <p className="caption-5">{step < 4 ? "按左上、右上、右下、左下顺序，移动食指到目标附近并保持。" : "指向目标，保持稳定后采集。九点测试全部通过后才保存新配置。"} 可用另一只手按按钮，或用鼠标采集。</p>
      <p className="caption-5">有效样本 {count}/15 · 单目映射校准，不测量真实空间深度。</p>
      {error && <p className="caption-5 error-text" role="alert">{error}</p>}
      <div className="review-actions"><button className="btn" onClick={onClose}>取消</button><button className="btn" onClick={() => { setStep(0); corners.current = []; errors.current = []; candidate.current = null; samples.current = []; setError(""); }}>重新开始</button><button className="btn primary" disabled={count < 15} onClick={capture}>采集当前目标</button></div>
    </section>
  </Modal>;
}
