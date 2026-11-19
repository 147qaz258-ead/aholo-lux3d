import { useEffect, useState } from "react";
import { intentPredictor, type IntentPrompt } from "../lib/intentPredictor";
import { useApp } from "../store";

export function IntentCoach() {
  const [prompt, setPrompt] = useState<IntentPrompt | null>(() => intentPredictor.current);

  useEffect(() => {
    const sync = () => setPrompt(intentPredictor.current);
    const unsub = intentPredictor.subscribe(sync);
    const timer = setInterval(() => intentPredictor.tick(), 500);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);

  if (!prompt) return null;

  const stroke = prompt.strokeId ? useApp.getState().objects.find((o) => o.id === prompt.strokeId) : null;
  const shape = prompt.analysis;

  return (
    <aside className="panel intent-coach" role="status" aria-live="polite" aria-label="智能手势预测提示">
      <div className="intent-coach-head">
        <strong>{prompt.title}</strong>
        <button className="mp-btn" onClick={() => intentPredictor.dismiss(true)} title="本会话不再提示此项">
          不再提示
        </button>
        <button className="mp-btn" onClick={() => intentPredictor.dismiss(false)} title="关闭">
          ✕
        </button>
      </div>
      <p className="caption-5" style={{ margin: "4px 0 8px" }}>
        {prompt.body}
      </p>
      <div className="control-grid" style={{ margin: 0 }}>
        {prompt.kind === "air-bend" && useApp.getState().tool !== "draw" && (
          <button
            className="btn sm primary"
            onClick={() => {
              useApp.getState().setTool("draw");
              intentPredictor.dismiss(false);
            }}
          >
            切到绘制
          </button>
        )}
        {prompt.kind === "stroke-fit" && stroke && shape && shape.kind !== "free" && (
          <button
            className="btn sm primary"
            onClick={() => {
              const s = useApp.getState();
              s.patchObject(stroke.id, { points: shape.fittedPoints, geometryEdits: {}, deformed: false });
              s.select(stroke.id);
              s.toast(`已规整为${shape.label}`, "ok");
              intentPredictor.dismiss(false);
            }}
          >
            规整为{shape.label}
          </button>
        )}
        {prompt.kind === "stroke-fit" && stroke && shape && (
          <>
            <button
              className="btn sm"
              onClick={() => {
                const s = useApp.getState();
                s.patchObject(stroke.id, { points: shape.smoothedPoints, geometryEdits: {}, deformed: false });
                s.select(stroke.id);
                s.toast("已顺滑去抖", "ok");
                intentPredictor.dismiss(false);
              }}
            >
              顺滑去抖
            </button>
            <button
              className="btn sm"
              onClick={() => {
                const s = useApp.getState();
                s.removeObject(stroke.id);
                s.setTool("draw");
                s.toast("已删除，可直接重画", "info");
                intentPredictor.dismiss(false);
              }}
            >
              删除重画
            </button>
          </>
        )}
        <button className="btn sm" onClick={() => intentPredictor.dismiss(false)}>
          知道了
        </button>
      </div>
    </aside>
  );
}
