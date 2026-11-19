import { useState } from "react";
import { useApp } from "../store";
import type { MaterialSettings, SceneObject } from "../types";
import { imageReference } from "../lib/images";
export function MaterialEditor({object}:{object:SceneObject}){
  const s=useApp(useShallow(s=>({patchObject:s.patchObject}))),[error,setError]=useState("");
  const value=object.material??{roughness:.34,metalness:.24,opacity:1,emissiveIntensity:.14};
  const patch=(part:Partial<MaterialSettings>)=>s.patchObject(object.id,{material:{...value,...part}});
  return <div className="section material-editor"><div className="section-label">材质与纹理</div>
    {([["roughness","粗糙度",1],["metalness","金属度",1],["opacity","不透明度",1],["emissiveIntensity","发光强度",10]] as const).map(([key,label,max])=><label className="material-row caption-5" key={key}>{label}<input type="range" aria-label={label} min="0" max={max} step="0.05" value={value[key]} disabled={object.locked} onChange={e=>patch({[key]:Number(e.target.value)})}/><output>{value[key].toFixed(2)}</output></label>)}
    <label className="btn sm">载入基础颜色纹理<input aria-label="基础颜色纹理" type="file" accept="image/png,image/jpeg,image/webp" disabled={object.locked} hidden onChange={async e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;try{patch({texture:await imageReference(file)});setError("");}catch(e){setError((e as Error).message);}}}/></label>
    {value.texture&&<p className="caption-5">{value.texture.name}<button className="btn sm" disabled={object.locked} onClick={()=>patch({texture:undefined})}>移除纹理</button></p>}
    <button className="btn sm" disabled={object.locked} onClick={()=>s.patchObject(object.id,{material:undefined})}>恢复默认材质参数</button>
    <p className="caption-5">模型材质调整覆盖到此对象的全部网格；纹理需要模型具有 UV。原生工程内嵌纹理。</p>{error&&<p role="alert" className="error-text caption-5">{error}</p>}
  </div>;
}
import { useShallow } from "zustand/react/shallow";
