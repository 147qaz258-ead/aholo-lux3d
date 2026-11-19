import { useState } from "react";
import { Vector3 } from "three";
import { makeObject, useApp } from "../store";
import { buildSurfaceGeometry } from "../lib/stroke";
import { fitCirclePoints, fitLinePoints, fitRectPoints, refineStrokePoints } from "../lib/strokeFit";
import { commitExtrusion, prepareSketchExtrusion } from "../lib/extrusion";
import type { SceneObject, Vec3 } from "../types";

export function StrokeEditor({ stroke }: { stroke: SceneObject }) {
  const s = useApp(useShallow(s=>({addObject:s.addObject,commit:s.commit,objects:s.objects,patchObject:s.patchObject,removeObject:s.removeObject,setTool:s.setTool,toast:s.toast}))), points = stroke.points ?? [];
  const [index, setIndex] = useState(0), [mergeId, setMergeId] = useState(""), [error, setError] = useState("");
  const [thickness, setThickness] = useState("");
  const i = Math.min(index, points.length - 1), point = points[i];
  const convert = (geometryType: SceneObject["geometryType"]) => {
    try { setError(""); if (geometryType === "surface") buildSurfaceGeometry(points).dispose(); s.patchObject(stroke.id, { geometryType, geometryEdits: {}, deformed: false }); }
    catch (e) { setError((e as Error).message); }
  };
  const applyPoints = (next: Vec3[], label: string) => {
    setError("");
    s.patchObject(stroke.id, { points: next, geometryEdits: {}, deformed: false });
    s.toast(label, "ok");
  };
  return <div className="section">
    <div className="section-label">轨迹精修与规整 · {points.length} 点</div>
    <div className="control-grid">
      <button className="btn sm" disabled={stroke.locked || points.length < 4} onClick={() => applyPoints(refineStrokePoints(points, stroke.planeNormal), "已顺滑去抖")}>顺滑去抖</button>
      <button className="btn sm" disabled={stroke.locked || points.length < 3} onClick={() => applyPoints(fitCirclePoints(points, stroke.planeNormal), "已规整为标准圆")}>规整为圆</button>
      <button className="btn sm" disabled={stroke.locked || points.length < 3} onClick={() => applyPoints(fitRectPoints(points, stroke.planeNormal), "已规整为矩形")}>规整为矩形</button>
      <button className="btn sm" disabled={stroke.locked || points.length < 2} onClick={() => applyPoints(fitLinePoints(points, stroke.planeNormal), "已拉直为直线")}>拉直为直线</button>
    </div>
    <div className="control-grid"><button className="btn sm" disabled={stroke.locked} onClick={() => convert("curve")}>转为曲线</button><button className="btn sm" disabled={stroke.locked} onClick={() => convert("tube")}>转为管体</button><button className="btn sm" disabled={stroke.locked} onClick={() => convert("surface")}>生成闭合面</button></div>
    <form className="row" onSubmit={e => {
      e.preventDefault();
      try {
        const view = useApp.getState().cameraView;
        const sketch = prepareSketchExtrusion(stroke, new Vector3(...view.target).sub(new Vector3(...view.position)));
        commitExtrusion(sketch, thickness ? Number(thickness) : sketch.profile.diagonal * .15);
        setError("");
      } catch (e) { setError((e as Error).message); }
    }}>
      <input className="num" type="number" min="0" step="any" value={thickness} placeholder="默认厚度" aria-label="实体厚度" onChange={e => setThickness(e.target.value)} />
      <button className="btn sm" disabled={stroke.locked || !stroke.visible}>拉伸实体</button>
    </form>
    <label className="caption-5">控制点序号<input className="num" aria-label="控制点序号" type="number" min="0" max={points.length-1} value={i} onChange={e => setIndex(Math.max(0, Math.min(points.length-1, Math.trunc(Number(e.target.value)))))} /></label>
    {point && <div className="coordinate-inputs">{point.map((v,k) => <input key={k} className="num" aria-label={`控制点 ${"XYZ"[k]}`} type="number" step="0.01" value={v} disabled={stroke.locked || stroke.geometryType === "surface"} onChange={e => { const n = Number(e.target.value); if (!Number.isFinite(n)) return; s.patchObject(stroke.id, { points: points.map((p,j) => j === i ? p.map((x,axis) => axis === k ? n : x) as Vec3 : p), geometryEdits: {} }); }} />)}</div>}
    <div className="control-grid">
      <button className="btn sm" disabled={stroke.locked || points.length <= 3} onClick={() => {
        const next = points.filter((_, j) => j !== i);
        setIndex(Math.max(0, Math.min(i, next.length - 1)));
        applyPoints(next, `已删除第 ${i} 个控制点`);
      }}>删当前点</button>
      <button className="btn sm" disabled={stroke.locked || !point || i >= points.length - 1} onClick={() => {
        const nextPt = points[i + 1];
        const mid: Vec3 = [(point[0] + nextPt[0]) / 2, (point[1] + nextPt[1]) / 2, (point[2] + nextPt[2]) / 2];
        const next = [...points.slice(0, i + 1), mid, ...points.slice(i + 1)];
        setIndex(i + 1);
        applyPoints(next, "已插入控制点");
      }}>后插中点</button>
      <button className="btn sm" disabled={stroke.locked} onClick={() => {
        s.removeObject(stroke.id);
        s.setTool("draw");
        s.toast("已删除本笔，可直接重画", "info");
      }}>删除重画</button>
    </div>
    <button className="btn sm" disabled={stroke.locked || i < 2 || points.length - i < 3} onClick={() => {
      const first = makeObject("stroke", `${stroke.name} A`, { ...stroke, id: crypto.randomUUID(), strokeId: crypto.randomUUID(), points: points.slice(0,i+1), rawPoints: points.slice(0,i+1), geometryType: "tube", parentId: undefined, partId: undefined });
      const second = { ...first, id: crypto.randomUUID(), strokeId: crypto.randomUUID(), name: `${stroke.name} B`, points: points.slice(i), rawPoints: points.slice(i) };
      s.commit("SPLIT_STROKE", { objects: [...s.objects, first, second], selectedId: first.id });
    }}>在此拆分为两个新对象</button>
    <select className="num" aria-label="合并轨迹" value={mergeId} onChange={e => setMergeId(e.target.value)}><option value="">选择另一条轨迹</option>{s.objects.filter(o=>o.kind==="stroke" && o.id!==stroke.id).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>
    <button className="btn sm" disabled={!mergeId || stroke.locked} onClick={async () => {
      const other = s.objects.find(o=>o.id===mergeId); if (!other?.points) return;
      const { matrix } = await import("../lib/assembly"); const { Vector3 } = await import("three");
      const project = matrix(stroke.transform).invert().multiply(matrix(other.transform));
      const joined = [...points, ...other.points.map(p=>new Vector3(...p).applyMatrix4(project).toArray() as Vec3)];
      s.addObject(makeObject("stroke", `${stroke.name} 合并`, { transform: stroke.transform, points: joined, rawPoints: joined, planeId: stroke.planeId, strokeId: crypto.randomUUID(), geometryType: "tube", width: stroke.width }));
    }}>生成合并轨迹（保留原对象）</button>
    {error && <p className="caption-5 error-text" role="alert">{error}</p>}
  </div>;
}
import { useShallow } from "zustand/react/shallow";
