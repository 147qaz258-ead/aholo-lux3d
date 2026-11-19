import { useEffect, useState } from "react";
import { useApp } from "../store";
import { listVersions, versionDiff, type SavedVersion } from "../lib/versions";
export function VersionHistory(){
  const s=useApp(useShallow(s=>({projectId:s.projectId,restoreVersion:s.restoreVersion,saveNamedVersion:s.saveNamedVersion,snapshot:s.snapshot,objects:s.objects,relations:s.relations,settings:s.settings}))),[versions,setVersions]=useState<SavedVersion[]>([]),[label,setLabel]=useState(""),[selected,setSelected]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const refresh=async()=>setVersions(await listVersions(s.projectId));
  useEffect(()=>{void refresh().catch(e=>setError(e.message));},[s.projectId]);
  const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError("");try{await fn();await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const version=versions.find(v=>v.id===selected),diff=version&&versionDiff(s.snapshot(),version.snapshot);
  return <div className="version-history caption-5"><h3 className="title-4">工程历史版本</h3>
    <div className="control-grid"><input className="num" aria-label="版本名称" value={label} maxLength={80} placeholder="例如：装配完成" onChange={e=>setLabel(e.target.value)}/><button className="btn" disabled={busy} onClick={()=>void run(async()=>{await s.saveNamedVersion(label);setLabel("");})}>保存命名版本</button></div>
    <p>当前浏览器保留最近 20 个命名版本，恢复前自动记录当前工程。跨设备请下载原生工程；版本列表保存在此浏览器。</p>
    <select className="num" aria-label="历史版本" value={selected??""} onChange={e=>setSelected(e.target.value||null)}><option value="">选择历史版本查看差异</option>{versions.map(v=><option key={v.id} value={v.id}>{v.label} · {new Date(v.savedAt).toLocaleString()} · r{v.snapshot.sceneRevision}</option>)}</select>
    {version&&diff&&<><p>恢复后：新增 {diff.added} 个、移除 {diff.removed} 个、变化 {diff.changed} 个对象；连接关系{diff.relationsChanged?"有变化":"一致"}，设置{diff.settingsChanged?"有变化":"一致"}。</p><p>此版本有 {version.snapshot.objects.length} 个对象、{version.snapshot.relations.length} 条关系。恢复后生成新修订号，在途 AI 结果需重新生成。</p><button className="btn" disabled={busy} onClick={()=>void run(()=>s.restoreVersion(version.id))}>确认恢复此版本</button></>}
    {busy&&<p role="status">正在处理版本…</p>}{error&&<p role="alert" className="error-text">{error}</p>}
  </div>;
}
import { useShallow } from "zustand/react/shallow";
