import * as THREE from "three";

/** 场景对象注册表：手势交互需要稳定的 Object3D 引用，而不是每帧查 React 树 */
export const objectRegistry = new Map<string, THREE.Object3D>();

export function findObjectId(obj: THREE.Object3D | null): string | null {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const id = cur.userData?.objectId;
    if (typeof id === "string") return id;
    cur = cur.parent;
  }
  return null;
}

export const pointerRuntime = {
  ndc: new THREE.Vector2(0, 0),
  active: false,
  pinched: false,
  /** 捏合强度 0..1 */
  pinch: 0.5,
  source: "mouse" as "hand" | "mouse",
  hoverId: null as string | null,
  contactConfirmed: false,
  brushRadius: 0,
  pressure: 0,
  dentDepth: 0,
  worldPoint: new THREE.Vector3(),
  hasWorldPoint: false,
  normal: new THREE.Vector3(0, 1, 0),
};

export const drawRuntime = {
  active: false,
  plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
  points: [] as THREE.Vector3[],
  closing: false,
  extrusion: null as import("../lib/extrusion").SketchExtrusion | null,
  thickness: 0,
};

export const gestureRuntime = {
  palms: [] as number[],
  cue: "" as "" | "orbit" | "panZoom" | "history" | "history-ready" | "menu" | "focus",
};
