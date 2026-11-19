import { useState } from "react";
import { useApp } from "../store";
import type { Vec3 } from "../types";
import { Modal } from "./Modal";

export function SelectionControls() {
  const s=useApp(useShallow(s=>({objects:s.objects,removeSelected:s.removeSelected,selectedIds:s.selectedIds,selectMany:s.selectMany,transformSelected:s.transformSelected}))),[delta,setDelta]=useState<Vec3>([0,0,0]),[angle,setAngle]=useState(0),[factor,setFactor]=useState(1),[error,setError]=useState(""),[deleting,setDeleting]=useState(false);
  const run=(fn:()=>void)=>{try{fn();setError("");}catch(e){setError((e as Error).message);}};
  return <div className="selection-controls caption-5">
    <div className="control-grid"><button className="btn sm" onClick={()=>s.selectMany(s.objects.map(o=>o.id))}>全选</button><button className="btn sm" onClick={()=>s.selectMany([])}>清除选择</button><span>已选 {s.selectedIds.length} 个</span></div>
    <p>按住 Ctrl 或 Shift 点击列表可多选。</p>
    {s.selectedIds.length>1&&<>
      <label>整体位移 XYZ<div className="coordinate-inputs">{delta.map((v,k)=><input key={k} className="num" type="number" aria-label={`批量位移 ${"XYZ"[k]}`} step="0.1" value={v} onChange={e=>setDelta(delta.map((n,i)=>i===k?Number(e.target.value):n) as Vec3)}/>)}</div></label>
      <div className="coordinate-inputs"><label>绕 Y 角度<input className="num" aria-label="批量旋转角度" type="number" value={angle} onChange={e=>setAngle(Number(e.target.value))}/></label><label>等比缩放<input className="num" aria-label="批量缩放倍数" type="number" min="0.01" step="0.1" value={factor} onChange={e=>setFactor(Number(e.target.value))}/></label></div>
      <div className="control-grid"><button className="btn sm" onClick={()=>run(()=>s.transformSelected(delta,[0,angle*Math.PI/180,0],factor))}>应用整体变换</button><button className="btn sm" onClick={()=>setDeleting(true)}>删除选中 {s.selectedIds.length} 个</button></div>
      <p>旋转和缩放以集合中心为基准。任一对象或子对象锁定时阻止变换。</p>
    </>}
    {error&&<p role="alert" className="error-text">{error}</p>}
    {deleting&&<Modal label="确认批量删除" onClose={()=>setDeleting(false)}><section className="review-card panel"><h2 className="title-3">删除 {s.selectedIds.length} 个对象？</h2><p className="caption-5">将解除关联连接。未选中的子对象保留世界位置。可用一次撤销恢复。</p>{error&&<p role="alert">{error}</p>}<div className="review-actions"><button className="btn" onClick={()=>setDeleting(false)}>取消</button><button className="btn primary" onClick={()=>run(()=>{s.removeSelected();setDeleting(false);})}>确认删除</button></div></section></Modal>}
  </div>;
}
import { useShallow } from "zustand/react/shallow";
