import { useEffect, useState } from "react";
import { useApp } from "../store";
import { alignedTransform, connectionError } from "../lib/assembly";
import type { Vec3 } from "../types";

export function AssemblyPanel() {
  const s = useApp(useShallow(s=>({addConnector:s.addConnector,assemblies:s.assemblies,connect:s.connect,connectors:s.connectors,convertToPart:s.convertToPart,detach:s.detach,objects:s.objects,relations:s.relations,reparent:s.reparent,replacePart:s.replacePart,selectedId:s.selectedId,setConnectionPreview:s.setConnectionPreview,setJointValue:s.setJointValue,toast:s.toast,transformAssembly:s.transformAssembly})));
  const sel = s.objects.find(o => o.id === s.selectedId);
  const [position, setPosition] = useState<Vec3>([0, 0, 0]);
  const [rotation, setRotation] = useState<Vec3>([0, 0, 0]);
  const [parentConnector, setParentConnector] = useState("");
  const [childConnector, setChildConnector] = useState("");
  const [previewVersion, setPreviewVersion] = useState("");
  const [error, setError] = useState("");
  const [replacementId, setReplacementId] = useState("");
  const [replacementVersion, setReplacementVersion] = useState("");
  const [jointType,setJointType]=useState<"fixed"|"hinge"|"slider">("fixed");
  const [minimum,setMinimum]=useState(-90),[maximum,setMaximum]=useState(90),[inspection,setInspection]=useState("");
  const connectors = s.connectors.filter(c => c.partId === sel?.partId);
  const assembly = s.assemblies.find(a => a.partIds.includes(sel?.partId ?? ""));
  const version = JSON.stringify(s.objects.map(o => [o.id, o.version, o.transform]));
  useEffect(() => { s.setConnectionPreview(null); setPreviewVersion(""); }, [parentConnector, childConnector, s.selectedId]);
  useEffect(() => () => useApp.getState().setConnectionPreview(null), []);
  const run = (fn: () => void) => { try { setError(""); fn(); } catch (e) { setError((e as Error).message); } };
  return <div className="section">
    <div className="section-label">零件与装配约束</div>
    {!sel ? <p className="caption-5">选择对象后可转换为独立零件、定义连接点并建立固定装配。</p> : <>
      <p className="caption-5">{sel.partId ? `零件 ${sel.partId.slice(0, 8)} · v${sel.version ?? 1}` : "普通对象"}{assembly ? ` · ${assembly.name}（${assembly.partIds.length} 件）` : ""}</p>
      {!sel.partId && <button className="btn sm" disabled={sel.locked} onClick={() => s.convertToPart(sel.id)}>转换为零件</button>}
      <label className="caption-5">父对象<select className="num" aria-label="父对象" value={sel.parentId ?? ""} disabled={sel.locked} onChange={e => s.reparent(sel.id, e.target.value || undefined)}><option value="">场景根级</option>{s.objects.filter(o => o.id !== sel.id).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      {sel.partId && <>
        <p className="caption-5">连接点局部位置与朝向（角度）</p>
        <div className="coordinate-inputs">{position.map((v, k) => <input key={k} type="number" className="num" aria-label={`连接点位置 ${"XYZ"[k]}`} step="0.05" value={v} onChange={e => setPosition(position.map((n, i) => i === k ? Number(e.target.value) : n) as Vec3)} />)}</div>
        <div className="coordinate-inputs">{rotation.map((v, k) => <input key={k} type="number" className="num" aria-label={`连接点旋转 ${"XYZ"[k]}`} step="15" value={v} onChange={e => setRotation(rotation.map((n, i) => i === k ? Number(e.target.value) : n) as Vec3)} />)}</div>
        <button className="btn sm" disabled={sel.locked} onClick={() => s.addConnector(sel.id, position, rotation.map(v => v * Math.PI / 180) as Vec3)}>创建连接点</button>
        <p className="caption-5">当前零件：{connectors.length} 个连接点。场景中显示青色标记及连接轴。</p>
        <select className="num" aria-label="零件替换来源" value={replacementId} onChange={e => { setReplacementId(e.target.value); setReplacementVersion(""); s.setConnectionPreview(null); }}><option value="">选择替换来源</option>{s.objects.filter(o => o.id !== sel.id).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <div className="control-grid"><button className="btn sm" disabled={!replacementId || sel.locked} onClick={() => { s.setConnectionPreview({ targetId: replacementId, transform: sel.transform }); setReplacementVersion(version); }}>预览替换</button><button className="btn sm" disabled={!replacementVersion || sel.locked} onClick={() => run(() => {
          if (version !== replacementVersion) throw new Error("零件已改变，请重新预览替换");
          s.replacePart(sel.id, replacementId); s.setConnectionPreview(null); setReplacementVersion("");
        })}>确认替换</button></div>
        <p className="caption-5">替换保留目标零件 ID 与变换；现有连接会标记失效，旧几何可撤销恢复。单独移动已连接子零件也会使连接失效。</p>
      </>}
    </>}
    {s.connectors.length >= 2 && <>
      <label className="caption-5">连接类型<select aria-label="连接类型" className="num" value={jointType} onChange={e=>{const type=e.target.value as typeof jointType;setJointType(type);setMinimum(type==="slider"?-.5:-90);setMaximum(type==="slider"?.5:90);setPreviewVersion("");s.setConnectionPreview(null);}}><option value="fixed">固定</option><option value="hinge">旋转铰接</option><option value="slider">直线滑动</option></select></label>
      {jointType!=="fixed"&&<div className="coordinate-inputs"><label className="caption-5">最小{jointType==="hinge"?"角度":"位移"}<input type="number" aria-label="关节最小限位" className="num" value={minimum} onChange={e=>setMinimum(Number(e.target.value))}/></label><label className="caption-5">最大{jointType==="hinge"?"角度":"位移"}<input type="number" aria-label="关节最大限位" className="num" value={maximum} onChange={e=>setMaximum(Number(e.target.value))}/></label></div>}
      <select className="num" aria-label="父连接点" value={parentConnector} onChange={e => setParentConnector(e.target.value)}><option value="">选择父连接点</option>{s.connectors.map(c => <option key={c.id} value={c.id}>{s.objects.find(o => o.partId === c.partId)?.name} / {c.name}</option>)}</select>
      <select className="num" aria-label="子连接点" value={childConnector} onChange={e => setChildConnector(e.target.value)}><option value="">选择子连接点</option>{s.connectors.map(c => <option key={c.id} value={c.id}>{s.objects.find(o => o.partId === c.partId)?.name} / {c.name}</option>)}</select>
      <div className="control-grid">
        <button className="btn sm" disabled={!parentConnector || !childConnector} onClick={() => run(() => {
          const a = s.connectors.find(c => c.id === parentConnector)!, b = s.connectors.find(c => c.id === childConnector)!;
          if (a.partId === b.partId) throw new Error("请选择不同零件的连接点");
          const parent = s.objects.find(o => o.partId === a.partId)!, child = s.objects.find(o => o.partId === b.partId)!;
          s.setConnectionPreview({ targetId: child.id, transform: alignedTransform(parent, child, a, b) }); setPreviewVersion(version);
        })}>预览对齐</button>
        <button className="btn sm primary" disabled={!previewVersion} onClick={() => run(() => {
          if (version !== previewVersion) throw new Error("零件已改变，请重新预览");
          const unit=jointType==="hinge"?Math.PI/180:1;
          s.connect(parentConnector, childConnector,jointType,{min:minimum*unit,max:maximum*unit}); s.setConnectionPreview(null); setPreviewVersion(""); s.toast("连接已建立", "ok");
        })}>确认连接</button>
      </div>
      {previewVersion && <button className="btn sm" onClick={() => { s.setConnectionPreview(null); setPreviewVersion(""); }}>取消预览</button>}
    </>}
    {s.relations.filter(r => r.status !== "suppressed").map(r => <div key={r.id} className="joint-control caption-5"><div className="relation-row"><span>{s.objects.find(o => o.partId === r.parentPartId)?.name} → {s.objects.find(o => o.partId === r.childPartId)?.name} · {r.status === "valid" ? {fixed:"固定",hinge:"铰接",slider:"滑动"}[r.type] : "连接失效"}</span><button className="btn sm" onClick={() => s.detach(r.id)}>拆卸</button></div>{r.type!=="fixed"&&r.limits&&<label>{r.type==="hinge"?`${(r.limits.value*180/Math.PI).toFixed(1)}°`:`${r.limits.value.toFixed(3)} 单位`}<input aria-label={`${r.type==="hinge"?"铰接角度":"滑动位移"} ${r.id}`} type="range" min={r.limits.min} max={r.limits.max} step={(r.limits.max-r.limits.min)/100} disabled={r.status!=="valid"} value={r.limits.value} onChange={e=>run(()=>s.setJointValue(r.id,Number(e.target.value)))}/></label>}</div>)}
    {!!s.relations.length&&<><button className="btn sm" onClick={()=>{
      const active=s.relations.filter(r=>r.status!=="suppressed"),broken=active.filter(r=>r.status==="broken"),errors=active.filter(r=>r.status==="valid").map(r=>connectionError(s.objects,s.connectors,r));
      setInspection(`${active.length} 条连接，${broken.length} 条失效；最大位置偏差 ${Math.max(0,...errors.map(e=>e.position)).toFixed(5)}，最大角差 ${Math.max(0,...errors.map(e=>e.angle)).toFixed(3)}°。`);
    }}>检查装配连接</button>{inspection&&<p className="caption-5" role="status">{inspection}</p>}<p className="caption-5">铰接绕连接点 Y 轴旋转，滑动沿该轴移动。多点固定连接仅允许同一父子零件且对齐一致。</p></>}
    {assembly && <>
      <p className="caption-5">装配体整体操作（任一零件锁定时禁止整体变换）</p>
      <div className="control-grid">
        <button className="btn sm" onClick={() => run(() => s.transformAssembly(assembly.id, { ...assembly.transform, position: [assembly.transform.position[0] + 0.2, ...assembly.transform.position.slice(1)] as Vec3 }))}>整体右移 0.2</button>
        <button className="btn sm" onClick={() => run(() => s.transformAssembly(assembly.id, { ...assembly.transform, rotation: [0, assembly.transform.rotation[1] + Math.PI / 12, 0] }))}>整体旋转 15°</button>
        <button className="btn sm" onClick={() => run(() => s.transformAssembly(assembly.id, { ...assembly.transform, scale: assembly.transform.scale.map(n => n * 1.1) as Vec3 }))}>整体放大 10%</button>
      </div>
    </>}
    {error && <p className="error-text caption-5" role="alert">{error}</p>}
  </div>;
}
import { useShallow } from "zustand/react/shallow";
