import { memo, useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { downloadBlob, exportSceneFormat } from "../lib/exporter";
import { Modal } from "./Modal";
import { VersionHistory } from "./VersionHistory";

export const ProjectControls = memo(function ProjectControls() {
  const s = useApp(useShallow(s=>({assemblies:s.assemblies,objects:s.objects,openProjectFile:s.openProjectFile,projectName:s.projectName,relations:s.relations,renameProject:s.renameProject,restoreBackup:s.restoreBackup,save:s.save,saveError:s.saveError,saveProjectFile:s.saveProjectFile,saveStatus:s.saveStatus,sceneRevision:s.sceneRevision,selectedId:s.selectedId,selectedIds:s.selectedIds,toast:s.toast})));
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [scope, setScope] = useState("scene");
  const [format,setFormat]=useState<"glb"|"obj"|"stl">("glb");
  const file = useRef<HTMLInputElement>(null);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await operation(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => { const s = useApp.getState(); if (s.saveStatus !== "saved") { e.preventDefault(); e.returnValue = ""; } };
    const save = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void useApp.getState().save().then(() => useApp.getState().toast("项目已保存", "ok")).catch(e => useApp.getState().toast(e.message, "err")); } };
    window.addEventListener("beforeunload", leave); window.addEventListener("keydown", save);
    return () => { window.removeEventListener("beforeunload", leave); window.removeEventListener("keydown", save); };
  }, []);
  return <>
    <button className="btn sm project-status" onClick={() => setOpen(true)} title={s.saveError || "项目管理"}>
      项目 · {({ saved: "已保存", dirty: "未保存", saving: "保存中", error: "保存失败" })[s.saveStatus]} · r{s.sceneRevision}
    </button>
    {open && <Modal label="项目管理" onClose={() => setOpen(false)}>
      <section className="review-card panel">
        <h2 className="title-3">作品与交付</h2>
        <label className="caption-5">作品名称<input className="num" aria-label="作品名称" value={s.projectName} onChange={e => s.renameProject(e.target.value)} /></label>
        <p className="caption-5">{s.objects.length} 个对象 · {s.assemblies.length} 个装配体 · {s.relations.length} 条关系 · 场景版本 {s.sceneRevision}</p>
        <div className="control-grid">
          <button className="btn" disabled={busy} onClick={() => void run(async () => { await s.save(); s.toast("本地保存完成", "ok"); })}>保存到浏览器</button>
          <button className="btn" disabled={busy} onClick={() => void run(() => s.saveProjectFile())}>下载完整原生项目</button>
          <button className="btn" disabled={busy} onClick={() => file.current?.click()}>打开原生项目</button>
          <button className="btn" disabled={busy} onClick={() => void run(async () => { await s.restoreBackup(); s.toast("已恢复上一有效快照", "ok"); })}>恢复上一快照</button>
        </div>
        <p className="caption-5">原生项目保留模型资产、雕刻、层级、连接和 AI 来源。打开文件前会保存当前作品。GLB 用于几何交换，不能替代原生项目。</p>
        <label className="caption-5">交换格式<select className="num" aria-label="交换格式" value={format} onChange={e=>setFormat(e.target.value as typeof format)}><option value="glb">GLB 几何与材质</option><option value="obj">OBJ 几何</option><option value="stl">STL 三角网格</option></select></label>
        {format!=="glb"&&<p className="caption-5">OBJ/STL 当前仅交换几何，不保存纹理、应用约束或制造单位；OBJ 不附带 MTL。STL 导出不代表已通过可打印性检查。</p>}
        <label className="caption-5">导出范围<select className="num" aria-label="导出范围" value={scope} onChange={e => setScope(e.target.value)}><option value="scene">全部可见对象</option><option value="selected">选中对象集合</option><option value="assembly">选中对象所属装配体</option></select></label>
        <button className="btn" disabled={busy || !s.objects.length} onClick={() => void run(async () => {
          let ids: string[] | undefined;
          if (scope === "selected") { if (!s.selectedIds.length) throw new Error("请先选择对象"); ids = s.selectedIds; }
          if (scope === "assembly") {
            const part = s.objects.find(o => o.id === s.selectedId)?.partId;
            const a = s.assemblies.find(a => a.partIds.includes(part ?? "")); if (!a) throw new Error("选中对象不属于装配体");
            ids = s.objects.filter(o => a.partIds.includes(o.partId ?? "")).map(o => o.id);
          }
          const blob = await exportSceneFormat(format,s.projectName, ids); downloadBlob(blob, `${s.projectName || "aether"}.${format}`); s.toast(`${format.toUpperCase()} 导出完成`, "ok");
        })}>导出 {format.toUpperCase()}</button>
        <p className="caption-5">GLB 不保存应用内装配约束、任务日志或撤销记录。当前仅导出可见对象。</p>
        <VersionHistory />
        {(error || s.saveError) && <p role="alert" className="error-text">{error || s.saveError}</p>}
        {busy && <p role="status">正在处理项目数据…</p>}
        <input ref={file} hidden type="file" accept=".json" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void run(async () => { await s.openProjectFile(f); s.toast("项目已打开", "ok"); }); }} />
        <div className="review-actions"><button autoFocus className="btn primary" disabled={busy} onClick={() => setOpen(false)}>返回工作空间</button></div>
      </section>
    </Modal>}
  </>;
});
import { useShallow } from "zustand/react/shallow";
