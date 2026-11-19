import { Box3, Matrix4, Mesh, Vector3 } from "three";
import { objectRegistry } from "../scene/runtime";
import type { SceneObject, Vec3 } from "../types";
export function regionCandidate(target:SceneObject,center:Vec3,radius:number,delta:Vec3){
  if(target.kind==="stroke"||target.locked)throw new Error("请选择未锁定的网格对象");
  if([...center,radius,...delta].some(n=>!Number.isFinite(n))||radius<=0||radius>1e4)throw new Error("区域参数无效");
  const root=objectRegistry.get(target.id);if(!root)throw new Error("目标几何尚未加载");root.updateMatrixWorld(true);
  const inverse=root.matrixWorld.clone().invert(),box=new Box3().setFromObject(root),diagonal=box.getSize(new Vector3()).length();
  if(new Vector3(...delta).length()*Math.max(...target.transform.scale)>diagonal*.2)throw new Error("局部位移应小于对象尺寸的20%");
  let index=0,changed=0;const edits:Record<string,number[]>={},seen=new Set();const p=new Vector3(),c=new Vector3(...center),d=new Vector3(...delta);
  root.traverse(node=>{const mesh=node as Mesh;if(!mesh.isMesh)return;const key=String(index++),position=mesh.geometry.getAttribute("position");if(!position)return;
    if(seen.has(mesh.geometry))return;seen.add(mesh.geometry);
    const local=new Matrix4().multiplyMatrices(inverse,mesh.matrixWorld),back=local.clone().invert(),values=Array.from(position.array);
    for(let i=0;i<position.count;i++){
      p.fromBufferAttribute(position,i).applyMatrix4(local);const distance=p.distanceTo(c);
      if(distance>=radius)continue;
      const amount=(1-distance/radius)**2;if(amount===0)continue;
      p.addScaledVector(d,amount).applyMatrix4(back);values[i*3]=p.x;values[i*3+1]=p.y;values[i*3+2]=p.z;changed++;
    }
    edits[key]=values;
  });
  if(!changed||d.length()===0)throw new Error("区域没有覆盖顶点，或位移为零，请调整区域中心和半径");
  return {...structuredClone(target),geometryEdits:edits,deformed:true,sourceObjectIds:[target.id]};
}
