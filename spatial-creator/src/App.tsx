import { useEffect, useState } from "react";
import { useApp, startHudSync } from "./store";
import { handState } from "./lib/handState";
import { syncTrackerSettings } from "./lib/cameraService";
import { Viewport } from "./scene/Viewport";
import { TopBar } from "./ui/TopBar";
import { GestureToolMenu, ToolRail } from "./ui/ToolRail";
import { ViewControls } from "./ui/ViewControls";
import { Inspector } from "./ui/Inspector";
import { AiPanel } from "./ui/AiPanel";
import { CameraPanel } from "./ui/CameraPanel";
import { Toasts } from "./ui/Toasts";
import { BootOverlay } from "./ui/BootOverlay";
import { HelpOverlay } from "./ui/HelpOverlay";
import { MetricsPanel } from "./ui/MetricsPanel";
import { HandCursor } from "./ui/HandCursor";
import { InteractionStatus } from "./ui/InteractionStatus";
import { WorkspaceStart } from "./ui/WorkspaceStart";
import { IntentCoach } from "./ui/IntentCoach";

export default function App() {
  const hydrate = useApp((s) => s.hydrate);
  const booted = useApp((s) => s.booted);
  const setBooted = useApp((s) => s.setBooted);
  const panels = useApp((s) => s.panels);
  const cameraReady = useApp((s) => s.cameraReady);
  const [help, setHelp] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    void hydrate().finally(() => setHydrated(true));
    return startHudSync();
  }, [hydrate]);

  /* 开发期调试钩子：供自动化测试读取真实几何状态（生产构建不注入） */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    void (async () => {
      const [three, rt, deform, hs, mtr, gs, exp, uip] = await Promise.all([
        import("three"),
        import("./scene/runtime"),
        import("./lib/deformation"),
        import("./lib/handState"),
        import("./lib/metrics"),
        import("./lib/gesture"),
        import("./lib/exporter"),
        import("./lib/uiPointer"),
      ]);
      (window as unknown as Record<string, unknown>).__spatial = {
        useApp,
        objectRegistry: rt.objectRegistry,
        pointerRuntime: rt.pointerRuntime,
        drawRuntime: rt.drawRuntime,
        exporter: exp,
        deformation: deform,
        handState: hs.handState,
        metrics: mtr.metrics,
        gesture: gs,
        uiPointer: uip.uiPointer,
        THREE: three,
      };
    })();
  }, []);

  /* 设置变更同步给追踪器（镜像 / 灵敏度在下一帧生效） */
  useEffect(() => {
    return useApp.subscribe((s, prev) => {
      if (s.settings !== prev.settings) syncTrackerSettings();
    });
  }, []);

  /* 键盘快捷操作 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = e.target as HTMLElement;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) {
        if (e.key === "Escape") target.blur();
        return;
      }
      const st = useApp.getState();
      if (e.key === "1") st.setTool("select");
      if (e.key === "2") st.setTool("draw");
      if (e.key === "3") st.setTool("sculpt");
      if (e.key === "4") st.setTool("ai");
      if (e.key === "Escape") {
        if (st.gestureMenu) st.setGestureMenu(null);
        else {
          st.cancelInteraction();
          if (st.interaction === "Idle" || st.interaction === "Hover") st.select(null);
        }
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (st.selectedIds.length>1) { st.toast(`请在对象列表确认批量删除 ${st.selectedIds.length} 个对象`,"info"); }
        else if (st.selectedId) st.removeObject(st.selectedId);
      }
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="a"){e.preventDefault();st.selectMany(st.objects.map(o=>o.id));}
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        const ok = e.shiftKey ? st.redo() : st.undo();
        st.toast(
          e.shiftKey
            ? ok
              ? "已重做一次编辑"
              : "没有可重做的编辑"
            : ok
              ? "已撤销一次编辑"
              : "没有可撤销的编辑",
          ok ? "ok" : "warn",
        );
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        const ok = st.redo();
        st.toast(ok ? "已重做一次编辑" : "没有可重做的编辑", ok ? "ok" : "warn");
      }
      if (e.key === " ") {
        e.preventDefault();
        handState.paused = !handState.paused;
        st.toast(handState.paused ? "手部输入已暂停（鼠标接管）" : "手部输入已恢复", "info");
      }
      if (e.key === "?" || e.key === "h") setHelp((v) => !v);
      if (e.key.toLowerCase() === "m") setShowMetrics((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!hydrated) {
    return (
      <div className="boot">
        <div className="boot-card" style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 18, letterSpacing: "0.3em" }}>INITIALIZING</h1>
          <div className="sub">LOADING PROJECT STATE</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`app${panels.rail ? "" : " no-rail"}${panels.inspector ? "" : " no-inspector"}${panels.ai ? "" : " no-ai"}${cameraReady ? " camera-active" : ""}`}
    >
      <TopBar onHelp={() => setHelp(true)} />
      <div className="stage">
        <Viewport />
        <div className="fx-scan" />
        <div className="fx-vignette" />
        <ToolRail />
        <Inspector />
        <CameraPanel />
        <AiPanel />
        <HandCursor />
        <IntentCoach />
        <Toasts />
        <div className="workspace-hud">
          <InteractionStatus onHelp={() => setHelp(true)} />
          <ViewControls />
          {booted && <WorkspaceStart />}
        </div>
        <GestureToolMenu />
        {showMetrics && <MetricsPanel onClose={() => setShowMetrics(false)} />}
      </div>
      {!booted && <BootOverlay onEnter={() => setBooted(true)} />}
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
    </div>
  );
}
