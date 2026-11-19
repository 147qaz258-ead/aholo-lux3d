import { useLayoutEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Box3, Object3D, PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls as Orbit } from "three-stdlib";

export function fitPreview(camera:PerspectiveCamera,model:Object3D,width:number,height:number){
  model.updateWorldMatrix(true,true);
  const box=new Box3().setFromObject(model),center=box.getCenter(new Vector3()),radius=box.getSize(new Vector3()).length()/2;
  if(box.isEmpty()||!Number.isFinite(radius)||radius<=0)throw new Error("预览模型包围盒无效");
  camera.aspect=width/height;
  const vertical=camera.fov*Math.PI/180,angle=Math.min(vertical,2*Math.atan(Math.tan(vertical/2)*camera.aspect));
  const distance=radius/Math.sin(angle/2)*1.2;
  camera.position.copy(center).addScaledVector(new Vector3(2,1.5,3).normalize(),distance);
  camera.near=Math.max(1e-5,distance/1000);camera.far=distance*10;camera.lookAt(center);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  return {center,distance};
}
function FittedModel({model}:{model:Object3D}){
  const {camera,controls,size}=useThree();
  useLayoutEffect(()=>{
    if(!controls)return;
    const {center,distance}=fitPreview(camera as PerspectiveCamera,model,size.width,size.height),orbit=controls as Orbit;
    orbit.target.copy(center);orbit.minDistance=distance*.2;orbit.maxDistance=distance*5;orbit.update();
  },[model,camera,controls,size.width,size.height]);
  return <primitive object={model} dispose={null}/>;
}
export function PreviewCanvas({model}:{model:Object3D}){
  return <Canvas camera={{position:[2,1.8,3],fov:45}}><ambientLight intensity={1.8}/><directionalLight position={[3,4,5]} intensity={3}/><OrbitControls makeDefault/><FittedModel model={model}/></Canvas>;
}
