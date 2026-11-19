import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { objectRegistry } from "../scene/runtime";

function exportClone(source: THREE.Object3D): THREE.Object3D | null {
  const mesh = source as THREE.Mesh;
  if (!source.visible || (mesh.isMesh && (mesh.material as THREE.MeshBasicMaterial)?.wireframe)) return null;
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) throw new Error("当前导出不支持骨骼动画模型，请先转换为静态网格");
  const clone = mesh.isMesh ? new THREE.Mesh(mesh.geometry, mesh.material) : new THREE.Group();
  clone.name = source.name; clone.position.copy(source.position); clone.quaternion.copy(source.quaternion); clone.scale.copy(source.scale);
  for (const child of source.children) { const next = exportClone(child); if (next) clone.add(next); }
  return clone;
}

/** 导出当前场景中所有可见对象为 GLB（含形变后的几何、笔迹管体、AI 模型） */
export function exportGeometryScene(name = "aether-scene", ids?: string[]) {
  const scene = new THREE.Scene();
  scene.name = name;

  const ambient = new THREE.AmbientLight(0xffffff, 1.1);
  ambient.name = "ambient";
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 1.6);
  dir.position.set(4, 8, 5);
  dir.name = "key";
  scene.add(dir);

  for (const [id, obj] of objectRegistry) {
    if (!obj.visible) continue;
    if (ids && !ids.includes(id)) continue;
    const clone = exportClone(obj);
    if (!clone) continue;
    clone.position.copy(obj.position);
    clone.quaternion.copy(obj.quaternion);
    clone.scale.copy(obj.scale);
    scene.add(clone);
  }

  if(!scene.children.some(o=>(o as THREE.Mesh).isMesh||o.children.length))throw new Error("导出范围内没有可见几何");
  scene.updateMatrixWorld(true);return scene;
}
export async function exportSceneGlb(name = "aether-scene", ids?: string[]): Promise<Blob> {
  const scene=exportGeometryScene(name,ids);
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, { binary: true, onlyVisible: true });
  return new Blob([result as ArrayBuffer], { type: "model/gltf-binary" });
}

export async function exportSceneFormat(format:"glb"|"obj"|"stl",name:string,ids?:string[]):Promise<Blob>{
  if(format==="glb")return exportSceneGlb(name,ids);
  const scene=exportGeometryScene(name,ids);
  if(format==="obj"){const {OBJExporter}=await import("three/examples/jsm/exporters/OBJExporter.js");return new Blob([new OBJExporter().parse(scene)],{type:"text/plain"});}
  const {STLExporter}=await import("three/examples/jsm/exporters/STLExporter.js");const result=new STLExporter().parse(scene,{binary:true});return new Blob([result.buffer as ArrayBuffer],{type:"model/stl"});
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
