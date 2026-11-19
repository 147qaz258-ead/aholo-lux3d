import type { ComponentType } from "react";
import { useApp } from "../store";
import type { ToolId } from "../types";
import { IconPen, IconSculpt, IconSelect, IconSpark } from "./Icons";

const TOOLS: { id: ToolId; label: string; hint: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: "select", label: "选择", hint: "捏合抓起 · 双手缩放旋转", icon: IconSelect },
  { id: "draw", label: "绘制", hint: "捏合落笔 · 松开成线", icon: IconPen },
  { id: "sculpt", label: "雕刻", hint: "捏合按压凹陷 / 拖动拉伸", icon: IconSculpt },
  { id: "ai", label: "生成", hint: "文字或图片生成三维模型", icon: IconSpark },
];

export function GestureToolMenu() {
  const menu = useApp(s => s.gestureMenu);
  if (!menu) return null;
  return <section className="panel gesture-menu" aria-label="手势工具" style={{
    left: `clamp(112px, ${menu.x * 100}%, calc(100% - 112px))`,
    top: `clamp(74px, ${menu.y * 100}%, calc(100% - 74px))`,
  }}>
    <div className="control-grid">
      {TOOLS.map(({ id, label, icon: Icon }) => <button key={id} className="btn" onClick={() => {
        const s = useApp.getState();
        s.setGestureMenu(null);
        s.setTool(id);
      }}><Icon size={16} />{label}</button>)}
    </div>
    <button className="btn sm menu-close" onClick={() => useApp.getState().setGestureMenu(null)}>关闭</button>
  </section>;
}

export function ToolRail() {
  const tool = useApp((s) => s.tool);
  const setTool = useApp((s) => s.setTool);
  const toast = useApp((s) => s.toast);

  return (
    <nav className="rail">
      {TOOLS.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            className={`tool ${tool === t.id ? "active" : ""}`}
            onClick={() => {
              setTool(t.id);
              if (t.id === "ai") toast("在下方输入描述，或把图片拖进来", "info");
            }}
            aria-pressed={tool === t.id}
            aria-label={t.label}
          >
            <Icon size={19} />
            <span>{t.label}</span>
            <em className="tool-hint">{t.hint}</em>
          </button>
        );
      })}
    </nav>
  );
}
