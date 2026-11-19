import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { objectRegistry, pointerRuntime } from "./runtime";
import { useApp } from "../store";
export function HoverOverlay() {
  const ref = useRef<THREE.Mesh>(null);
  const scratch = useMemo(() => ({ box: new THREE.Box3(), center: new THREE.Vector3(), size: new THREE.Vector3() }), []);
  useFrame(() => {
    const m = ref.current; if (!m) return;
    const id = pointerRuntime.hoverId, obj = id && objectRegistry.get(id);
    m.visible = !!obj && obj.visible && id !== useApp.getState().selectedId;
    if (!obj || !m.visible) return;
    scratch.box.setFromObject(obj); if (scratch.box.isEmpty()) { m.visible=false; return; }
    scratch.box.getCenter(scratch.center); scratch.box.getSize(scratch.size);
    m.position.copy(scratch.center); m.scale.copy(scratch.size).addScalar(.03);
  });
  return <mesh ref={ref} visible={false} raycast={()=>{}}><boxGeometry args={[1,1,1]} /><meshBasicMaterial color="#ffb84d" wireframe transparent opacity={.5} /></mesh>;
}
