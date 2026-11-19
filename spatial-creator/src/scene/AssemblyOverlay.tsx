import { useEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useApp } from "../store";
import { connectorMatrix } from "../lib/assembly";
import { objectRegistry } from "./runtime";

export function AssemblyOverlay() {
  const s = useApp(useShallow(s=>({connectionPreview:s.connectionPreview,connectors:s.connectors,objects:s.objects,selectedId:s.selectedId})));
  const [ghost, setGhost] = useState<THREE.Object3D | null>(null);
  const preview = s.connectionPreview;
  useEffect(() => {
    if (!preview) { setGhost(null); return; }
    const source = objectRegistry.get(preview.targetId);
    if (!source) return;
    // Share source geometry without copying large saved sculpt baselines from userData.
    const cloneGhost = (node: THREE.Object3D): THREE.Object3D => {
      const mesh = node as THREE.Mesh;
      const copy = mesh.isMesh ? new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: "#ffb84d", transparent: true, opacity: 0.35, depthWrite: false })) : new THREE.Group();
      copy.position.copy(node.position); copy.quaternion.copy(node.quaternion); copy.scale.copy(node.scale); copy.visible = node.visible;
      copy.raycast = () => {};
      for (const child of node.children) copy.add(cloneGhost(child));
      return copy;
    };
    const copy = cloneGhost(source);
    copy.position.fromArray(preview.transform.position); copy.rotation.set(...preview.transform.rotation); copy.scale.fromArray(preview.transform.scale);
    setGhost(copy);
    return () => copy.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) (m.material as THREE.Material).dispose(); });
  }, [preview]);
  const selected = s.objects.find(o => o.id === s.selectedId);
  const visible = s.connectors.filter(c => c.partId === selected?.partId && selected?.visible);
  return <>{ghost && <primitive object={ghost} />}{visible.map(c => <ConnectorMarker key={c.id} connectorId={c.id} />)}</>;
}

function ConnectorMarker({ connectorId }: { connectorId: string }) {
  const marker = useMemo(() => new THREE.Group(), []);
  const axes = useMemo(() => new THREE.AxesHelper(0.15), []);
  useEffect(() => () => axes.dispose(), [axes]);
  useFrame(() => {
    const s = useApp.getState(), c = s.connectors.find(c => c.id === connectorId);
    const obj = s.objects.find(o => o.partId === c?.partId), runtime = obj && objectRegistry.get(obj.id);
    if (!c || !obj || !runtime) return;
    runtime.updateMatrixWorld(true);
    const m = runtime.matrixWorld.clone().multiply(connectorMatrix(c));
    m.decompose(marker.position, marker.quaternion, new THREE.Vector3());
  });
  return <primitive object={marker}><mesh raycast={() => {}}><sphereGeometry args={[0.025, 12, 8]} /><meshBasicMaterial color="#2ee8c8" depthTest={false} /></mesh><primitive object={axes} /></primitive>;
}
import { useShallow } from "zustand/react/shallow";
