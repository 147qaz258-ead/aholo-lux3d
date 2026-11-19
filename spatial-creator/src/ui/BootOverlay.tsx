import { useEffect, useState } from "react";
import { useApp } from "../store";
import { startCamera } from "../lib/cameraService";
import { handState } from "../lib/handState";

const ITEMS = [
  ["01", "空中绘制 —— 捏合即落笔，松开成一条可拾取的三维笔迹"],
  ["02", "手势塑形 —— 捏住模型按压出凹陷，拖动拉出形体"],
  ["03", "Lux3D 生成 —— 一句话或一张图，生成真实 GLB 进入场景"],
  ["04", "双手变换 —— 双手捏合，缩放与旋转围绕真实包围盒进行"],
];

export function BootOverlay({ onEnter }: { onEnter: () => void }) {
  const toast = useApp((s) => s.toast);
  const [phase, setPhase] = useState<"idle" | "requesting" | "loading">("idle");
  const [, force] = useState(0);

  useEffect(() => {
    const t = setInterval(() => force((v) => v + 1), 400);
    return () => clearInterval(t);
  }, []);

  const enterWithCamera = async () => {
    setPhase("requesting");
    try {
      await startCamera();
      setPhase("loading");
      onEnter();
    } catch {
      onEnter();
    }
  };

  return (
    <div className="boot">
      <div className="boot-card">
        <h1>AETHER STUDIO</h1>
        <div className="sub">Play in 3D · Create with Aholo</div>
        <p>
          用一台普通摄像头，把双手变成三维创作工具。没有手柄，没有建模软件的层层菜单——
          在空中画，捏住它，让 AI 把它变成真的模型。
        </p>

        <div className="boot-list">
          {ITEMS.map(([n, text]) => (
            <div className="boot-item" key={n}>
              <i>{n}</i>
              <span>{text}</span>
            </div>
          ))}
        </div>

        <div className="boot-actions">
          <button className="btn primary" style={{ height: 36, padding: "0 20px" }} onClick={enterWithCamera}>
            启用摄像头并进入
          </button>
          <button className="btn ghost" style={{ height: 36 }} onClick={onEnter}>
            鼠标模式
          </button>
          <span
            className={`boot-status ${handState.status === "error" ? "err" : ""}`}
            style={{ marginLeft: "auto" }}
          >
            {handState.status === "loading"
              ? "加载与预热手部模型…"
              : phase === "requesting"
                ? "请求摄像头权限…"
                : phase === "loading"
                  ? "加载手部模型…"
                  : "需要摄像头权限 · 视频仅在本地处理"}
          </span>
        </div>
      </div>
    </div>
  );
}
