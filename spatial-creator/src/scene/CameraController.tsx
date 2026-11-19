import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { PerspectiveCamera as Perspective, OrthographicCamera as Orthographic } from "@react-three/drei";
import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls } from "three-stdlib";
import { useApp } from "../store";
import { objectRegistry } from "./runtime";
import type { Vec3 } from "../types";

export function saveCameraView(camera: PerspectiveCamera | OrthographicCamera, orbit: OrbitControls) {
  const ortho = camera as OrthographicCamera;
  useApp.getState().updateCameraView({
    position: camera.position.toArray() as Vec3,
    target: orbit.target.toArray() as Vec3,
    up: camera.up.toArray() as Vec3,
    projection: ortho.isOrthographicCamera ? "orthographic" : "perspective",
    orthoHeight: ortho.isOrthographicCamera ? (ortho.top - ortho.bottom) / ortho.zoom : undefined,
  });
}

export function ProjectionCamera(){
  const projection=useApp(s=>s.cameraView.projection);
  return projection==="orthographic"?<Orthographic makeDefault position={[0,1.6,4.8]} near={.01} far={10000}/>:<Perspective makeDefault fov={45} position={[0,1.6,4.8]} near={.01} far={10000}/>;
}

export function CameraController() {
  const { camera, controls, size } = useThree();
  const epoch = useApp(s => s.cameraViewEpoch);
  const ortho = camera as OrthographicCamera, perspective = camera as PerspectiveCamera;
  useEffect(()=>{const debug=(window as unknown as {__three?:{camera:unknown}}).__three;if(debug)debug.camera=camera;},[camera]);
  useEffect(() => {
    const orbit=controls as OrbitControls|null;if(!orbit)return;
    const view=useApp.getState().cameraView;
    camera.position.fromArray(view.position);camera.up.fromArray(view.up??[0,1,0]);orbit.target.fromArray(view.target);
    const distance=camera.position.distanceTo(orbit.target);
    orbit.maxDistance=Math.max(14,distance*3);orbit.minDistance=Math.min(1.2,Math.max(.01,distance*.1));
    camera.near=.01;camera.far=Math.max(120,distance*4);
    if(ortho.isOrthographicCamera){const height=view.orthoHeight??distance*2*Math.tan(Math.PI/8);ortho.top=height/2;ortho.bottom=-height/2;ortho.left=-height*size.width/size.height/2;ortho.right=-ortho.left;ortho.zoom=1;}
    perspective.updateProjectionMatrix();orbit.update();
  },[camera,controls,epoch,size.width,size.height]);
  useEffect(()=>{
    const orbit=controls as OrbitControls|null;if(!orbit)return;
    const save=()=>saveCameraView(camera, orbit);
    const action=(e:Event)=>{
      const s=useApp.getState();s.cancelInteraction();const type=(e as CustomEvent<string>).detail;
      if(type==="orthographic"||type==="perspective"){
        save();const current=useApp.getState().cameraView;
        const height=current.orthoHeight??camera.position.distanceTo(orbit.target)*2*Math.tan(Math.PI/8);
        const position=type==="perspective"&&ortho.isOrthographicCamera?orbit.target.clone().add(camera.position.clone().sub(orbit.target).normalize().multiplyScalar(height/(2*Math.tan(Math.PI/8)))).toArray() as Vec3:current.position;
        useApp.setState({cameraView:{...current,position,projection:type,orthoHeight:height},cameraViewEpoch:s.cameraViewEpoch+1});return;
      }
      const directions:Record<string,Vec3>={front:[0,0,1],back:[0,0,-1],left:[-1,0,0],right:[1,0,0],top:[0,1,0],bottom:[0,-1,0]};
      if(type==="reset"){
        camera.position.set(0,1.6,4.8);camera.up.set(0,1,0);orbit.target.set(0,.9,0);orbit.minDistance=1.2;orbit.maxDistance=14;
        if(ortho.isOrthographicCamera){ortho.zoom=1;ortho.top=2;ortho.bottom=-2;ortho.left=-2*size.width/size.height;ortho.right=-ortho.left;}
      }else if(directions[type]){
        const distance=Math.max(.1,camera.position.distanceTo(orbit.target));camera.up.set(...(type==="top"?[0,0,-1]:type==="bottom"?[0,0,1]:[0,1,0]) as Vec3);
        camera.position.copy(orbit.target).add(new Vector3(...directions[type]).multiplyScalar(distance));
      }else{
        const box=new Box3(),targets=type==="selected"?s.selectedIds:[...objectRegistry.keys()];
        for(const id of targets){const object=objectRegistry.get(id);if(object&&object.visible)box.expandByObject(object);}
        if(box.isEmpty()){s.toast("没有可聚焦的可见对象","warn");return;}
        const center=box.getCenter(new Vector3()),radius=Math.max(.05,box.getSize(new Vector3()).length()/2);
        const fov=ortho.isOrthographicCamera?Math.PI/4:perspective.fov*Math.PI/180;
        const limiting=Math.min(fov,2*Math.atan(Math.tan(fov/2)*size.width/size.height));
        const distance=radius/Math.sin(limiting/2)*1.1,direction=camera.position.clone().sub(orbit.target).normalize();
        orbit.target.copy(center);camera.position.copy(center).addScaledVector(direction,distance);
        orbit.maxDistance=Math.max(14,distance*3);orbit.minDistance=Math.max(.01,radius*.2);camera.far=Math.max(120,distance+radius*4);
        if(ortho.isOrthographicCamera){const height=radius*2.2*Math.max(1,size.height/size.width);ortho.top=height/2;ortho.bottom=-height/2;ortho.left=-height*size.width/size.height/2;ortho.right=-ortho.left;ortho.zoom=1;}
      }
      perspective.updateProjectionMatrix();orbit.update();save();
    };
    orbit.addEventListener("end",save);window.addEventListener("aether:view",action);
    return()=>{orbit.removeEventListener("end",save);window.removeEventListener("aether:view",action);};
  },[camera,controls,size.width,size.height]);
  return null;
}
