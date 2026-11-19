import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { HandFrame } from "../lib/handState";
import { HandVisualCache, handVisualOpacity } from "../lib/handVisuals";
import { gestureRuntime } from "./runtime";

const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17], [0, 9], [0, 13],
];
const TIPS = [4, 8, 12, 16, 20];
const FINGERS = ["thumb", "index", "middle", "ring", "pinky"] as const;
const PALM = [0, 5, 9, 13, 17];
const DIST = 1.28;
const UP = new THREE.Vector3(0, 1, 0);
const MAIN = new THREE.Color("#2ee8c8");
const OTHER = new THREE.Color("#81a9ff");
const DIM = new THREE.Color("#375561");
const WHITE = new THREE.Color("#ffffff");

export function HandRig() {
  const { camera } = useThree();
  const group = useRef<THREE.Group>(null);
  const joints = useRef<THREE.InstancedMesh>(null);
  const bones = useRef<THREE.InstancedMesh>(null);
  const tips = useRef<THREE.InstancedMesh>(null);
  const rings = useRef<THREE.InstancedMesh>(null);
  const display = useMemo(() => new HandVisualCache(), []);
  const brightness = useRef(0);
  const palmMesh = useRef<THREE.Mesh>(null);
  const rendered = useRef({ first: null as HandFrame | null, second: null as HandFrame | null, h: 0, w: 0, palms: gestureRuntime.palms, primary: null as number | null });
  const instance = useMemo(() => new THREE.Object3D(), []);
  const scratch = useMemo(() => ({
    a: new THREE.Vector3(), b: new THREE.Vector3(), direction: new THREE.Vector3(), color: new THREE.Color(),
    points: Array.from({ length: 21 }, () => new THREE.Vector3()),
  }), []);
  const geo = useMemo(() => {
    const palm = new THREE.BufferGeometry();
    palm.setAttribute("position", new THREE.BufferAttribute(new Float32Array(30), 3).setUsage(THREE.DynamicDrawUsage));
    palm.setAttribute("color", new THREE.BufferAttribute(new Float32Array(30), 3).setUsage(THREE.DynamicDrawUsage));
    palm.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 5, 6, 7, 5, 7, 8, 5, 8, 9]);
    return { palm, ball: new THREE.SphereGeometry(1, 12, 10), bone: new THREE.CylinderGeometry(1, 1, 1, 8, 1, true) };
  }, []);
  useEffect(() => {
    for (const mesh of [joints.current, bones.current, tips.current, rings.current]) mesh?.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return () => { geo.ball.dispose(); geo.bone.dispose(); geo.palm.dispose(); };
  }, [geo]);

  useFrame((_, dt) => {
    const g = group.current, jointMesh = joints.current, boneMesh = bones.current, tipMesh = tips.current, ringMesh = rings.current;
    if (!g || !jointMesh || !boneMesh || !tipMesh || !ringMesh) return;
    const now = performance.now();
    display.update(now);
    const hands = display.hands;
    g.visible = hands.length > 0;
    if (!g.visible) { brightness.current = 0; return; }
    const firstAlpha = handVisualOpacity(now, hands[0].seenAt);
    const target = hands.length > 1 ? Math.max(firstAlpha, handVisualOpacity(now, hands[1].seenAt)) : firstAlpha;
    // Fade in a returning hand from its current brightness instead of jumping to full strength.
    brightness.current = target < brightness.current ? target : THREE.MathUtils.damp(brightness.current, target, 38, dt);
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);

    const ortho = camera as THREE.OrthographicCamera, perspective = camera as THREE.PerspectiveCamera;
    const h = ortho.isOrthographicCamera ? (ortho.top - ortho.bottom) / ortho.zoom : 2 * Math.tan(perspective.fov * Math.PI / 360) * DIST;
    const w = ortho.isOrthographicCamera ? (ortho.right - ortho.left) / ortho.zoom : h * perspective.aspect;
    const dim = brightness.current;
    if (palmMesh.current) (palmMesh.current.material as THREE.MeshBasicMaterial).opacity = .14 * dim;
    (jointMesh.material as THREE.MeshBasicMaterial).opacity = .7 * dim;
    (boneMesh.material as THREE.MeshBasicMaterial).opacity = .45 * dim;
    (tipMesh.material as THREE.MeshBasicMaterial).opacity = .45 * dim;
    const first = hands[0]?.pose ?? null, second = hands[1]?.pose ?? null;
    if (rendered.current.first === first && rendered.current.second === second && rendered.current.h === h && rendered.current.w === w
      && rendered.current.palms === gestureRuntime.palms && rendered.current.primary === display.primaryId) return;
    rendered.current = { first, second, h, w, palms: gestureRuntime.palms, primary: display.primaryId };
    const pv = geo.palm.getAttribute("position") as THREE.BufferAttribute;
    const pc = geo.palm.getAttribute("color") as THREE.BufferAttribute;
    const { points, direction, a, b, color } = scratch;
    const count = hands.length;
    let ringCount = 0;

    for (let slot = 0; slot < count; slot++) {
      const hand = hands[slot].pose;
      const tint = hand.id === display.primaryId ? MAIN : OTHER;
      const scale = THREE.MathUtils.clamp(hand.palm / .16, .55, 1.6) * .52 * h;
      for (let i = 0; i < 21; i++) {
        const p = hand.screen[i];
        points[i].set((p.x - .5) * w, (.5 - p.y) * h, -DIST + (p.z || 0) * .55);
        const tip = TIPS.indexOf(i);
        instance.position.copy(points[i]);
        instance.quaternion.identity();
        instance.scale.setScalar((tip >= 0 ? .0115 : .0082) * scale);
        instance.updateMatrix();
        jointMesh.setMatrixAt(slot * 21 + i, instance.matrix);
        const hot = hand.pinched && (i === 4 || i === 8);
        jointMesh.setColorAt(slot * 21 + i, hot ? WHITE : tip >= 0 && hand.fingers.extended[FINGERS[tip]] ? tint : DIM);
      }
      for (let i = 0; i < PALM.length; i++) {
        const p = points[PALM[i]], index = slot * PALM.length + i;
        pv.setXYZ(index, p.x, p.y, p.z);
        pc.setXYZ(index, tint.r, tint.g, tint.b);
      }
      for (let i = 0; i < BONES.length; i++) {
        const [ai, bi] = BONES[i];
        a.copy(points[ai]); b.copy(points[bi]);
        direction.subVectors(b, a);
        const length = direction.length();
        instance.position.addVectors(a, b).multiplyScalar(.5);
        instance.quaternion.identity();
        if (length > 1e-5) instance.quaternion.setFromUnitVectors(UP, direction.normalize());
        instance.scale.set(.0032 * scale, Math.max(1e-4, length), .0032 * scale);
        instance.updateMatrix();
        boneMesh.setMatrixAt(slot * BONES.length + i, instance.matrix);
        boneMesh.setColorAt(slot * BONES.length + i, tint);
      }
      for (let i = 0; i < TIPS.length; i++) {
        const index = TIPS[i], hot = hand.pinched && (index === 4 || index === 8);
        instance.position.copy(points[index]);
        instance.quaternion.identity();
        instance.scale.setScalar(.022 * scale);
        instance.updateMatrix();
        tipMesh.setMatrixAt(slot * TIPS.length + i, instance.matrix);
        tipMesh.setColorAt(slot * TIPS.length + i, color.copy(hot ? WHITE : tint).multiplyScalar(hot ? 1 : .45));
      }
      if (gestureRuntime.palms.includes(hand.id)) {
        instance.position.addVectors(points[0], points[9]).multiplyScalar(.5);
        instance.quaternion.identity();
        instance.scale.setScalar(h * .022);
        instance.updateMatrix();
        ringMesh.setMatrixAt(ringCount++, instance.matrix);
      }
    }
    jointMesh.count = count * 21;
    boneMesh.count = count * BONES.length;
    tipMesh.count = count * TIPS.length;
    ringMesh.count = ringCount;
    ringMesh.visible = ringCount > 0;
    geo.palm.setDrawRange(0, count * 9);
    pv.needsUpdate = true;
    pc.needsUpdate = true;
    for (const mesh of [jointMesh, boneMesh, tipMesh, ringMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group ref={group} name="hand-rig" visible={false} renderOrder={10}>
      <mesh ref={palmMesh} geometry={geo.palm} renderOrder={8} frustumCulled={false} raycast={() => null}>
        <meshBasicMaterial vertexColors transparent opacity={.14} side={THREE.DoubleSide} forceSinglePass depthWrite={false} depthTest={false} toneMapped={false} />
      </mesh>
      <instancedMesh ref={joints} args={[geo.ball, undefined, 42]} frustumCulled={false} raycast={() => null}><meshBasicMaterial transparent opacity={.7} depthWrite={false} depthTest={false} toneMapped={false} /></instancedMesh>
      <instancedMesh ref={bones} args={[geo.bone, undefined, BONES.length * 2]} frustumCulled={false} raycast={() => null}><meshBasicMaterial transparent opacity={.45} depthWrite={false} depthTest={false} toneMapped={false} /></instancedMesh>
      <instancedMesh ref={tips} args={[geo.ball, undefined, TIPS.length * 2]} frustumCulled={false} raycast={() => null}><meshBasicMaterial transparent opacity={.45} depthWrite={false} depthTest={false} toneMapped={false} blending={THREE.AdditiveBlending} /></instancedMesh>
      <group>
        <instancedMesh ref={rings} args={[undefined, undefined, 2]} frustumCulled={false} raycast={() => null}>
          <ringGeometry args={[.78, 1, 24]} />
          <meshBasicMaterial color="#ffdfa0" depthWrite={false} depthTest={false} toneMapped={false} />
        </instancedMesh>
      </group>
    </group>
  );
}
