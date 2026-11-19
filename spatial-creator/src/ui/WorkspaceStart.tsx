import { useApp } from "../store";

export function WorkspaceStart() {
  const empty = useApp(s => s.objects.length === 0);
  const drawing = useApp(s => s.interaction === "Drawing");
  const camera = useApp(s => s.cameraReady);
  const tool = useApp(s => s.tool);
  const setTool = useApp(s => s.setTool);
  if (drawing || tool === "ai" || (!empty && tool === "draw")) return null;
  const active = tool === "draw";
  return <section className="workspace-start" aria-label="创作起步">
    <h2 className="title-3">{active ? "绘制已就绪" : empty ? "画下第一笔" : "绘制新笔迹"}</h2>
    {!active && <button className="btn primary" onClick={() => setTool("draw")}>开始绘制</button>}
    {camera && <p>{active
      ? "手势：指向网格，拇指碰食指起笔，保持指尖相碰移动，分开就收笔。"
      : "用鼠标点击，或用食指对准按钮，等提示后轻弯再伸直。"}</p>}
    {active && <p>在网格上按住鼠标左键画线，松开后收笔。</p>}
  </section>;
}
