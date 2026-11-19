import { Group, Mesh, MeshStandardMaterial } from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { disposeObject, parseGlb } from "./glb";
export async function importGeometry(file:File):Promise<ArrayBuffer>{
  if(file.size>60*1024*1024)throw new Error("文件超过 60MB");
  const ext=file.name.split(".").at(-1)?.toLowerCase();
  if(ext==="glb"||ext==="gltf")return file.arrayBuffer();
  let root:Group;
  if(ext==="obj"){const {OBJLoader}=await import("three/examples/jsm/loaders/OBJLoader.js");root=new OBJLoader().parse(await file.text());}
  else if(ext==="stl"){const {STLLoader}=await import("three/examples/jsm/loaders/STLLoader.js");const geometry=new STLLoader().parse(await file.arrayBuffer());root=new Group();root.add(new Mesh(geometry,new MeshStandardMaterial({color:"#d5e5e8",roughness:.5})));}
  else throw new Error("支持 GLB、内嵌 glTF、OBJ 或 STL");
  try{
    let vertices=0;root.traverse(node=>{const mesh=node as Mesh;if(!mesh.isMesh)return;const p=mesh.geometry.getAttribute("position");vertices+=p?.count??0;if(!p||vertices>2000000)throw new Error("模型为空或超过 200 万顶点");for(const n of p.array)if(!Number.isFinite(n))throw new Error("模型含非有限顶点");});
    if(!vertices)throw new Error("文件没有三角网格");
    const result=await new GLTFExporter().parseAsync(root,{binary:true});
    const checked=await parseGlb(result as ArrayBuffer);disposeObject(checked);return result as ArrayBuffer;
  }finally{disposeObject(root);}
}
