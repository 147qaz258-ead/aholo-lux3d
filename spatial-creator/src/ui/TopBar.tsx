import { useEffect, useState } from "react";
import { useApp } from "../store";
import { exportSceneGlb, downloadBlob } from "../lib/exporter";
import {
  IconDownload,
  IconHelp,
  IconSave,
  IconCamera,
  IconLayers,
  IconSelect,
  IconSpark,
  IconContrast,
} from "./Icons";
import { startCamera, stopCamera } from "../lib/cameraService";
import { ProjectControls } from "./ProjectControls";

export function TopBar({ onHelp }: { onHelp: () => void }) {
  const cameraReady = useApp((s) => s.cameraReady);
  const objects = useApp((s) => s.objects);
  const toast = useApp((s) => s.toast);
  const save = useApp((s) => s.save);
  const [highContrast, setHighContrast] = useState(() => {
    try {
      return localStorage.getItem("sc-contrast") === "high";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.body.classList.toggle("contrast-high", highContrast);
    try {
      localStorage.setItem("sc-contrast", highContrast ? "high" : "normal");
    } catch {
      /* 隐私模式下写不了，忽略 */
    }
  }, [highContrast]);
  const panels = useApp((s) => s.panels);
  const togglePanel = useApp((s) => s.togglePanel);
  const [exporting, setExporting] = useState(false);

  const doExport = async () => {
    if (!objects.length) {
      toast("场景为空，没有可导出的对象", "warn");
      return;
    }
    setExporting(true);
    try {
      const blob = await exportSceneGlb();
      downloadBlob(blob, `spatial-scene-${Date.now()}.glb`);
      toast(`已导出 GLB · ${(blob.size / 1024 / 1024).toFixed(2)} MB`, "ok");
    } catch (e) {
      toast(`导出失败：${(e as Error).message}`, "err");
    } finally {
      setExporting(false);
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" />
        <div>
          <div className="brand-name">AETHER STUDIO</div>
          <div className="brand-sub">AHOLO LUX3D · 手部空间创作台</div>
        </div>
      </div>

      <ProjectControls />

      <div className="chip">
        <span className={`dot ${cameraReady ? "live" : ""}`} />
        {cameraReady ? "手势输入" : "鼠标输入"}
      </div>

      <div className="status-chips">
        <div className="chip-toggles">
          <button
            className={`icon-btn ${highContrast ? "on" : ""}`}
            aria-pressed={highContrast}
            title={highContrast ? "关闭高对比模式" : "开启高对比模式（演示环境光线复杂时用）"}
            onClick={() => setHighContrast((v) => !v)}
          >
            <IconContrast size={16} />
          </button>
          <button
            className={`icon-btn workspace-panel-toggle ${panels.rail ? "on" : ""}`}
            aria-pressed={panels.rail}
            title={panels.rail ? "隐藏工具栏" : "显示工具栏"}
            onClick={() => togglePanel("rail")}
          >
            <IconSelect size={16} />
            <span>工具</span>
          </button>
          <button
            className={`icon-btn workspace-panel-toggle ${panels.inspector ? "on" : ""}`}
            aria-pressed={panels.inspector}
            title={panels.inspector ? "隐藏属性区" : "显示属性区"}
            onClick={() => togglePanel("inspector")}
          >
            <IconLayers size={16} />
            <span>属性</span>
          </button>
          <button
            className={`icon-btn ${panels.ai ? "on" : ""}`}
            aria-pressed={panels.ai}
            title={panels.ai ? "隐藏 AI 输入区" : "显示 AI 输入区"}
            onClick={() => togglePanel("ai")}
          >
            <IconSpark size={16} />
          </button>
        </div>
        <button
          className="icon-btn"
          title={cameraReady ? "关闭摄像头" : "启用摄像头"}
          onClick={() => (cameraReady ? stopCamera() : startCamera())}
        >
          <IconCamera size={16} />
        </button>
        <button className="icon-btn" title="保存项目（本地）" onClick={() => void save().then(() => toast("项目已保存到本地", "ok")).catch(e => toast(`保存失败：${e.message}`, "err"))}>
          <IconSave size={16} />
        </button>
        <button className="icon-btn" title="导出 GLB" onClick={doExport} disabled={exporting}>
          <IconDownload size={16} />
        </button>
        <button className="icon-btn" title="操作指引" onClick={onHelp}>
          <IconHelp size={16} />
        </button>
      </div>
    </header>
  );
}
