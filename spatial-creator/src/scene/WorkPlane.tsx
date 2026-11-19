import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useApp } from "../store";
import { drawRuntime } from "./runtime";

export function WorkPlane() {
  const mesh = useRef<THREE.Mesh>(null);
  const scratch = useRef({ center: new THREE.Vector3(), normal: new THREE.Vector3(0, 0, 1) });
  useFrame(() => {
    const m = mesh.current; if (!m) return;
    m.visible = useApp.getState().tool === "draw";
    if (!m.visible) return;
    drawRuntime.plane.coplanarPoint(scratch.current.center);
    m.position.copy(scratch.current.center);
    m.quaternion.setFromUnitVectors(scratch.current.normal, drawRuntime.plane.normal);
  });
  return <mesh ref={mesh} raycast={() => {}} visible={false}><planeGeometry args={[2.8, 2.8, 8, 8]} /><meshBasicMaterial color="#2ee8c8" wireframe transparent opacity={0.12} depthWrite={false} side={THREE.DoubleSide} /></mesh>;
}
