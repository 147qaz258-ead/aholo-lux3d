import { useEffect, useState } from "react";
import { metrics, type MetricsSnapshot } from "../lib/metrics";
import { recorder } from "../lib/recorder";
import { downloadBlob } from "../lib/exporter";
import { useApp } from "../store";
import { handState } from "../lib/handState";
import { isSoftwareRenderer, renderInfo } from "../lib/renderInfo";

/**
 * 实时指标面板（按 M 开关）。
 * 存在的意义：让"流畅 / 跟手 / 稳定"这些说法当场可读、可截图取证，
 * 而不是靠感觉描述。数值全部来自真实运行路径。
 */
export function MetricsPanel({ onClose }: { onClose: () => void }) {
  const pinchSensitivity = useApp((s) => s.settings.pinchSensitivity);
  const updateSettings = useApp((s) => s.updateSettings);
  const [snap, setSnap] = useState<MetricsSnapshot | null>(null);
  const [recording, setRecording] = useState(false), [replay, setReplay] = useState("");

  useEffect(() => {
    const t = setInterval(() => setSnap(metrics.snapshot()), 400);
    setSnap(metrics.snapshot());
    return () => clearInterval(t);
  }, []);

  if (!snap) return null;

  const rows: [string, string, string][] = [
    ["手部推理", `p50 ${snap.detect.p50}ms`, `p95 ${snap.detect.p95}ms`],
    ["输入帧率", `${snap.detectFps} fps`, `${snap.frames} 帧`],
    ["手在画面", `${(snap.handPresence * 100).toFixed(0)}%`, `丢手 ${snap.lossEvents} 次`],
    ["捏合判定", `延迟 ${snap.pinch.latencyAvg}ms`, `p95 ${snap.pinch.latencyP95}ms`],
    ["捏合次数", `${snap.pinch.onCount}`, `切换 ${snap.pinch.toggles}`],
    [
      "指针抖动",
      snap.pointer.restJitter === null ? "手在动" : `${(snap.pointer.restJitter * 1000).toFixed(1)}‰`,
      "静止时 RMS",
    ],
    ["笔迹落点", `${snap.stroke.points}`, `${snap.stroke.perSecond}/s`],
    ["渲染", `${snap.render.fps} fps`, `p95 帧 ${snap.render.lastDtMs}ms`],
    ["渲染帧分位", `p50 ${snap.render.p50}ms`, `p99 ${snap.render.p99}ms`],
    ["Worker 往返", `p95 ${snap.pipeline.workerP95}ms`, "取帧到结果接收"],
    ["输入至更新", `p95 ${snap.pipeline.feedbackP95}ms`, `${snap.pipeline.feedbackSamples} 个软件样本`],
  ];

  return (
    <div className="metrics-panel">
      <div className="mp-head">
        <span>METRICS · {snap.windowSec}s</span>
        <div className="mp-actions">
          <button className="mp-btn" onClick={() => metrics.reset()} title="清零重新统计">
            重置
          </button>
          <button className="mp-btn" onClick={onClose} title="隐藏（M）">
            ✕
          </button>
        </div>
      </div>
      <div className="mp-body caption-5">
        <div>手势推理：{handState.inferenceBackend ?? "未启用"}</div>
        <div>三维渲染：{renderInfo.renderer || "等待初始化"}{isSoftwareRenderer(renderInfo.renderer) ? "（软件渲染）" : ""}</div>
        <div>画面分辨率倍率：{renderInfo.pixelRatio.toFixed(2)}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
          <span>握力阈值：{pinchSensitivity.toFixed(2)}</span>
          <button className={`mp-btn ${Math.abs(pinchSensitivity - 0.62) < 0.005 ? "on" : ""}`} onClick={() => updateSettings({ pinchSensitivity: 0.62 })} title="默认偏敏阈值">0.62</button>
          <button className={`mp-btn ${Math.abs(pinchSensitivity - 0.70) < 0.005 ? "on" : ""}`} onClick={() => updateSettings({ pinchSensitivity: 0.70 })} title="防误触建议阈值">0.70</button>
        </div>
      </div>
      <div className="mp-body">
        <div className="control-grid">
          <button className="btn sm" onClick={() => { if (recording) recorder.stop(); else recorder.start(); setRecording(!recording); }}>{recording ? "停止录制" : "录制输入"}</button>
          <button className="btn sm" onClick={() => {
            const s = useApp.getState();
            downloadBlob(new Blob([JSON.stringify({
              ...recorder.export(),
              runtime: {
                inferenceBackend: handState.inferenceBackend,
                renderer: renderInfo.renderer,
                softwareRenderer: isSoftwareRenderer(renderInfo.renderer),
                pixelRatio: renderInfo.pixelRatio,
                pinchSensitivity: s.settings.pinchSensitivity,
                smoothing: s.settings.smoothing,
                mirror: s.settings.mirror,
                calibrated: Boolean(s.settings.calibration),
                calibration: s.settings.calibration,
              },
              metrics: metrics.snapshot(),
              projectId: s.projectId,
              sceneRevision: s.sceneRevision,
              commands: s.commands,
              aiTasks: s.tasks.map(t => ({ id: t.id, taskId: t.taskId, taskType: t.taskType, state: t.state, durationMs: t.durationMs, cost: t.cost ?? "unknown" })),
            })], { type: "application/json" }), `aether-evidence-${Date.now()}.json`);
          }}>导出证据</button>
          <button className="btn sm" disabled={recording || !recorder.frameCount} onClick={() => { void recorder.replay(frame => setReplay(`帧 ${frame.sourceFrameId} · ${frame.trackingState} · ${frame.hands.length} 手`)); }}>诊断回放</button>
        </div>
        <p className="caption-5">最多记录 1800 个关键点结果帧。回放仅显示诊断信息。{replay}</p>
      </div>
      <div className="mp-body">
        {rows.map(([k, a, b]) => (
          <div className="mp-row" key={k}>
            <span className="mp-k">{k}</span>
            <span className="mp-v">{a}</span>
            <span className="mp-sub">{b}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
