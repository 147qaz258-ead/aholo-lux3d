import { useState } from "react";
import { useApp } from "../store";

export function ViewControls() {
  const [open, setOpen] = useState(false);
  const projection = useApp(s => s.cameraView.projection);
  const view = (detail: string) => window.dispatchEvent(new CustomEvent("aether:view", { detail }));
  return <div className="workspace-views">
    <button className="btn sm" aria-expanded={open} onClick={() => setOpen(v => !v)}>视图</button>
    {open && <section className="panel workspace-view-options" aria-label="标准视图与投影">
      <div className="control-grid">
        {[["front", "前"], ["back", "后"], ["left", "左"], ["right", "右"], ["top", "顶"], ["bottom", "底"]].map(([id, name]) =>
          <button key={id} className="btn sm" onClick={() => view(id)} aria-label={`${name}视图`}>{name}</button>)}
      </div>
      <div className="seg">
        <button className={projection !== "orthographic" ? "on" : ""} onClick={() => view("perspective")}>透视</button>
        <button className={projection === "orthographic" ? "on" : ""} onClick={() => view("orthographic")}>正交</button>
      </div>
      <div className="control-grid">
        <button className="btn sm" onClick={() => view("reset")}>复位视图</button>
        <button className="btn sm" onClick={() => view("selected")}>聚焦选中</button>
        <button className="btn sm" onClick={() => view("all")}>显示全部</button>
      </div>
    </section>}
  </div>;
}
