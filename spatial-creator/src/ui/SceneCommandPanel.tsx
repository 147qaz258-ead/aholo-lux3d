import { useState } from "react";
import { useApp } from "../store";
import type { Vec3 } from "../types";
import { localTask, planSceneCommand } from "../lib/sceneCommands";
import { regionCandidate } from "../lib/regionEdit";
import { Modal } from "./Modal";
import { ObjectComparison } from "./ObjectComparison";
export function SceneCommandPanel(){
  const s=useApp(useShallow(s=>({acceptTask:s.acceptTask,addTask:s.addTask,objects:s.objects,rejectTask:s.rejectTask,selectedId:s.selectedId,tasks:s.tasks}))),[text,setText]=useState(""),[error,setError]=useState(""),[review,setReview]=useState<string|null>(null),[ready,setReady]=useState(false),[explanation,setExplanation]=useState("");
  const [center,setCenter]=useState<Vec3>([0,0,0]),[radius,setRadius]=useState(.2),[delta,setDelta]=useState<Vec3>([0,-.03,0]);
  const task=s.tasks.find(t=>t.id===review&&t.state==="preview"),target=task&&s.objects.find(o=>o.id===task.targetObjectId);
  const run=(fn:()=>void)=>{try{fn();setError("");}catch(e){setError((e as Error).message);}};
  const show=(task:ReturnType<typeof planSceneCommand>)=>{s.addTask(task);if(task.explanation)setExplanation(task.explanation);else {setReady(false);setReview(task.id);}};
  return <div className="section scene-command-panel"><div className="section-label">场景指令与局部编辑</div>
    <textarea className="num" aria-label="本地场景指令" placeholder="把它缩小10% / 把刚才那个改为蓝色 / 解释场景" maxLength={600} value={text} onChange={e=>setText(e.target.value)}/>
    <button className="btn sm" onClick={()=>run(()=>show(planSceneCommand(text)))}>解析并预览指令</button>
    <p className="caption-5">本地规则支持缩放、方向移动、颜色和场景说明；支持选中对象、唯一名称或上一轮已接受对象。自由形体由远程生成提供。</p>
    {explanation&&<p className="caption-5" role="status">{explanation}</p>}
    <details><summary className="caption-5">指定区域形变（本地，不调用生成服务）</summary>
      <p className="caption-5">区域中心与位移使用目标对象的局部坐标。半径外保持原顶点。</p>
      {([["区域中心",center,setCenter],["区域位移",delta,setDelta]] as const).map(([label,value,setter])=><label className="caption-5" key={label}>{label}<div className="coordinate-inputs">{value.map((v,k)=><input key={k} className="num" aria-label={`${label} ${"XYZ"[k]}`} type="number" step=".01" value={v} onChange={e=>setter(value.map((n,i)=>i===k?Number(e.target.value):n) as Vec3)}/>)}</div></label>)}
      <label className="caption-5">区域半径<input className="num" type="number" aria-label="区域半径" min=".001" step=".05" value={radius} onChange={e=>setRadius(Number(e.target.value))}/></label>
      <button className="btn sm" onClick={()=>run(()=>{const target=s.objects.find(o=>o.id===s.selectedId);if(!target)throw new Error("请先选中目标网格");const task=localTask(target,regionCandidate(target,center,radius,delta),"指定区域形变","region");task.region={center,radius,delta};show(task);})}>预览局部形变</button>
    </details>
    {error&&<p role="alert" className="error-text caption-5">{error}</p>}
    {s.tasks.filter(t=>t.localOperation&&t.state==="preview").map(t=><button key={t.id} className="btn sm" onClick={()=>{setReady(false);setReview(t.id);}}>继续预览：{t.label}</button>)}
    {task&&target&&<Modal label="场景修改确认" onClose={()=>{s.rejectTask(task.id);setReview(null);}}><section className="review-card comparison-card panel"><h2 className="title-3">确认修改「{target.name}」</h2><p className="caption-5">{task.prompt} · 绑定版本 v{task.targetObjectVersion}。仅修改此对象；两个视图分别聚焦，尺寸变化以数值为准。</p><div className="comparison-grid"><div><h3 className="title-4">修改前</h3><ObjectComparison targetId={target.id}/></div><div><h3 className="title-4">修改后</h3><ObjectComparison targetId={target.id} candidate={task.candidate} onReady={setReady}/></div></div><p className="caption-5">缩放 {target.transform.scale.map(n=>n.toFixed(3)).join(" / ")} → {task.candidate?.transform.scale.map(n=>n.toFixed(3)).join(" / ")}；颜色 {target.color} → {task.candidate?.color}。</p>{error&&<p role="alert">{error}</p>}<div className="review-actions"><button className="btn" onClick={()=>{s.rejectTask(task.id);setReview(null);}}>拒绝修改</button><button className="btn primary" disabled={!ready} onClick={()=>run(()=>{if(!s.acceptTask(task.id))throw new Error("目标版本已改变，请重新准备修改");setReview(null);})}>确认修改目标</button></div></section></Modal>}
  </div>;
}
import { useShallow } from "zustand/react/shallow";
