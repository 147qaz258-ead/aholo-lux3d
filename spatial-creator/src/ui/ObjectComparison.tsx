import { useEffect, useState } from "react";
import { PreviewCanvas } from "./PreviewCanvas";
import { Box3, Group, Mesh, MeshStandardMaterial, Texture, Vector3 } from "three";
import type { SceneObject } from "../types";
import { objectRegistry } from "../scene/runtime";
import { disposeObject } from "../lib/glb";

interface GeometrySummary {
  vertices: number;
  triangles: number;
  size: [number, number, number];
}

function summarizeObject(root: import("three").Object3D): GeometrySummary {
  let vertices = 0;
  let triangles = 0;
  root.traverse((n) => {
    const m = n as Mesh;
    if (!m.isMesh || !m.geometry) return;
    const pos = m.geometry.getAttribute("position");
    if (pos) vertices += pos.count;
    const idx = m.geometry.getIndex();
    triangles += idx ? Math.floor(idx.count / 3) : pos ? Math.floor(pos.count / 3) : 0;
  });
  const box = new Box3().setFromObject(root);
  const v = new Vector3();
  if (!box.isEmpty()) box.getSize(v);
  return { vertices, triangles, size: [v.x, v.y, v.z] };
}

/** Copy render geometry, never runtime userData or shared editable vertex buffers. */
export function previewCopy(id:string,candidate?:SceneObject){
  const source=objectRegistry.get(id);if(!source)throw new Error("目标模型尚未加载");
  let meshIndex=0;
  const copy=(node:import("three").Object3D):import("three").Object3D=>{
    const mesh=node as Mesh;
    if(mesh.isMesh&&(mesh.material as MeshStandardMaterial).wireframe)return new Group();
    const cloneMaterial=(m:import("three").Material)=>{
      const next=m.clone();for(const [k,v] of Object.entries(next))if(v instanceof Texture)(next as unknown as Record<string,unknown>)[k]=v.clone();return next;
    };
    const result=mesh.isMesh?new Mesh(mesh.geometry.clone(),Array.isArray(mesh.material)?mesh.material.map(cloneMaterial):cloneMaterial(mesh.material)):new Group();
    result.position.copy(node.position);result.quaternion.copy(node.quaternion);result.scale.copy(node.scale);result.visible=node.visible;
    if(mesh.isMesh){
      const index=String(meshIndex++),out=result as Mesh,edit=candidate?.geometryEdits?.[index];
      if(edit){const p=out.geometry.getAttribute("position");if(edit.length!==p.array.length)throw new Error("预览顶点数量不一致");for(let i=0;i<edit.length;i++)p.array[i]=edit[i];p.needsUpdate=true;out.geometry.computeVertexNormals();out.geometry.computeBoundingBox();out.geometry.computeBoundingSphere();}
      if(candidate?.material||candidate?.color)for(const raw of Array.isArray(out.material)?out.material:[out.material]){const material=raw as MeshStandardMaterial;if(material.color)material.color.set(candidate.color);if(candidate.material&&material.isMeshStandardMaterial){Object.assign(material,{roughness:candidate.material.roughness,metalness:candidate.material.metalness,opacity:candidate.material.opacity,transparent:candidate.material.opacity<1,emissiveIntensity:candidate.material.emissiveIntensity});material.emissive.set(candidate.color);}}
    }
    for(const child of node.children)result.add(copy(child));return result;
  };
  const root=copy(source);if(candidate){root.position.fromArray(candidate.transform.position);root.rotation.set(...candidate.transform.rotation);root.scale.fromArray(candidate.transform.scale);}
  root.updateMatrixWorld(true);return root;
}
export function ObjectComparison({targetId,candidate,onReady}:{targetId:string;candidate?:SceneObject;onReady?:(ready:boolean)=>void}){
  const [model,setModel]=useState<import("three").Object3D|null>(null),[error,setError]=useState("");
  const [diffText, setDiffText] = useState("");
  useEffect(()=>{
    let copy:import("three").Object3D|null=null;setError("");setModel(null);setDiffText("");onReady?.(false);
    try{
      const src = objectRegistry.get(targetId);
      copy=previewCopy(targetId,candidate);
      if (src && candidate) {
        const before = summarizeObject(src);
        const after = summarizeObject(copy);
        const dv = after.vertices - before.vertices;
        const sizeStr = after.size.map((n) => n.toFixed(2)).join("×");
        setDiffText(`顶点 ${before.vertices}→${after.vertices}（${dv >= 0 ? `+${dv}` : dv}） · 尺寸 ${sizeStr}`);
      }
      setModel(copy);onReady?.(true);
    }catch(e){setError((e as Error).message);}
    return()=>{if(copy)disposeObject(copy);};
  },[targetId,candidate]);
  return <div className="asset-preview">{error?<p role="alert">{error}</p>:model?<><PreviewCanvas model={model}/>{diffText && <div className="ai-diff-bar" style={{ fontSize: 11, color: "var(--dim)", padding: "4px 6px" }}>{diffText}</div>}</>:<p>正在准备对象预览…</p>}</div>;
}
