import * as THREE from "three";

/**
 * 局部网格形变。
 * 采用「基础位置 + 累计偏移」双缓冲：形变可叠加、可撤销，且不需要重建几何体。
 * 影响范围使用平滑衰减（1 - d/R)^2，避免出现硬边。
 */

interface MeshSculptData {
  base: Float32Array;
  offset: Float32Array;
}

interface UndoEntry {
  mesh: THREE.Mesh;
  data: MeshSculptData;
  /** 被修改顶点的旧偏移量 */
  prev: Map<number, [number, number, number]>;
  start: Float32Array;
}

const undoStack: UndoEntry[] = [];
/** 重做：记录一次操作「之后」的偏移量，撤销时反向搬运 */
const redoStack: UndoEntry[] = [];
let activeOp: UndoEntry | null = null;

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpM = new THREE.Matrix4();

function getData(mesh: THREE.Mesh): MeshSculptData {
  let d = mesh.userData.__sculpt as MeshSculptData | undefined;
  const geo = mesh.geometry as THREE.BufferGeometry;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  if (!d || d.base.length !== pos.array.length) {
    d = {
      base: new Float32Array(pos.array as Float32Array),
      offset: new Float32Array(pos.count * 3),
    };
    mesh.userData.__sculpt = d;
  }
  return d;
}

function avgScale(mesh: THREE.Mesh) {
  mesh.getWorldScale(tmpV);
  return Math.max(1e-4, (Math.abs(tmpV.x) + Math.abs(tmpV.y) + Math.abs(tmpV.z)) / 3);
}

export function beginSculptOp(mesh: THREE.Mesh) {
  activeOp = { mesh, data: getData(mesh), prev: new Map(), start: new Float32Array((mesh.geometry.getAttribute("position") as THREE.BufferAttribute).array) };
}

/** Recompute from the operation's baseline. Holding still never accumulates depth. */
export function sculptFromBaseline(mesh: THREE.Mesh, point: THREE.Vector3, radius: number, delta: THREE.Vector3) {
  const op = activeOp;
  if (!op || op.mesh !== mesh) return 0;
  const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const inverse = mesh.matrixWorld.clone().invert();
  const local = point.clone().applyMatrix4(inverse);
  const movement = delta.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(inverse));
  const worldStart = new THREE.Vector3();
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const j = i * 3;
    worldStart.set(op.start[j], op.start[j + 1], op.start[j + 2]).applyMatrix4(mesh.matrixWorld);
    const distance = worldStart.distanceTo(point);
    const w = distance < radius ? (1 - distance / radius) ** 2 : 0;
    if (!w) continue;
    if (!op.prev.has(i)) op.prev.set(i, [op.data.offset[j], op.data.offset[j + 1], op.data.offset[j + 2]]);
    for (let k = 0; k < 3; k++) {
      const value = op.start[j + k] + movement.getComponent(k) * w;
      (pos.array as Float32Array)[j + k] = value;
      op.data.offset[j + k] = value - op.data.base[j + k];
    }
    touched++;
  }
  void local;
  pos.needsUpdate = true; refit(mesh.geometry); return touched;
}

export function cancelSculptOp() {
  if (!activeOp) return;
  applyOffsets(activeOp, activeOp.prev);
  activeOp = null;
}

/** Stable traversal indices bind edited vertices to the source model's mesh layout. */
export function captureGeometry(root: THREE.Object3D): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  let index = 0;
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry.getAttribute("position")) return;
    const key = String(index++);
    const data = mesh.userData.__sculpt as MeshSculptData | undefined;
    if (data && data.offset.some(n => Math.abs(n) > 1e-9)) result[key] = Array.from(mesh.geometry.getAttribute("position").array);
  });
  return result;
}
export function restoreGeometry(root: THREE.Object3D, edits: Record<string, number[]> = {}) {
  let index = 0;
  const restored=new Set<THREE.BufferGeometry>();
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry.getAttribute("position")) return;
    const values = edits[String(index++)];
    if(restored.has(mesh.geometry))return;
    restored.add(mesh.geometry);
    if (!values && !mesh.userData.__sculpt) return;
    const data = getData(mesh);
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    if (values && (values.length !== pos.array.length || values.some(n => !Number.isFinite(n)))) throw new Error("保存的形变与网格结构不匹配");
    (pos.array as Float32Array).set(values ?? data.base);
    for (let i = 0; i < data.offset.length; i++) data.offset[i] = pos.array[i] - data.base[i];
    pos.needsUpdate = true; mesh.geometry.computeVertexNormals(); refit(mesh.geometry);
  });
}

export function endSculptOp() {
  if (!activeOp) return;
  const geo = activeOp.mesh.geometry as THREE.BufferGeometry;
  if (activeOp.prev.size === 0) {
    activeOp = null;
    return;
  }
  undoStack.push(activeOp);
  if (undoStack.length > 24) undoStack.shift();
  // 新操作让重做链失效（标准编辑器语义）
  redoStack.length = 0;
  activeOp = null;
  // 一次性重算法线，避免拖动过程中每帧重算
  geo.computeVertexNormals();
  const pos = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (pos) pos.needsUpdate = true;
  refit(geo);
}

function refit(geo: THREE.BufferGeometry | null) {
  const bvh = (geo as unknown as { boundsTree?: { refit: () => void } })?.boundsTree;
  if (bvh) bvh.refit();
  geo?.computeBoundingSphere();
}

/**
 * 在局部范围内施加位移。
 * @param mesh 目标网格
 * @param worldPoint 接触点（世界坐标）
 * @param radius 世界半径
 * @param deltaWorld 位移向量（世界坐标）
 * @returns 实际影响的顶点数
 */
export function displace(
  mesh: THREE.Mesh,
  worldPoint: THREE.Vector3,
  radius: number,
  deltaWorld: THREE.Vector3,
): number {
  const geo = mesh.geometry as THREE.BufferGeometry;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const data = getData(mesh);

  tmpM.copy(mesh.matrixWorld).invert();
  const localPoint = new THREE.Vector3().copy(worldPoint).applyMatrix4(tmpM);
  // 位移向量只经过线性部分变换（不能用 transformDirection，它会归一化掉长度）
  const lin = new THREE.Matrix3().setFromMatrix4(tmpM);
  const localDelta = new THREE.Vector3().copy(deltaWorld).applyMatrix3(lin);

  const s = avgScale(mesh);
  const r = Math.max(0.01, radius / s);
  const r2 = r * r;

  // 位移上限：相对于模型自身尺度，避免长时间按压把顶点拉成尖刺
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  const sphereR = geo.boundingSphere?.radius ?? 1;
  const maxOffset = sphereR * 0.34;

  const base = data.base;
  const arr = pos.array as Float32Array;
  let touched = 0;

  for (let i = 0; i < pos.count; i++) {
    const i3 = i * 3;
    const dx = base[i3] - localPoint.x;
    const dy = base[i3 + 1] - localPoint.y;
    const dz = base[i3 + 2] - localPoint.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;
    const t = 1 - Math.sqrt(d2) / r;
    const w = t * t;
    if (w < 0.0008) continue;

    if (activeOp) {
      if (!activeOp.prev.has(i)) {
        activeOp.prev.set(i, [data.offset[i3], data.offset[i3 + 1], data.offset[i3 + 2]]);
      }
    }
    let ox = data.offset[i3] + localDelta.x * w;
    let oy = data.offset[i3 + 1] + localDelta.y * w;
    let oz = data.offset[i3 + 2] + localDelta.z * w;
    const len = Math.hypot(ox, oy, oz);
    if (len > maxOffset) {
      const k = maxOffset / len;
      ox *= k;
      oy *= k;
      oz *= k;
    }
    data.offset[i3] = ox;
    data.offset[i3 + 1] = oy;
    data.offset[i3 + 2] = oz;
    arr[i3] = base[i3] + ox;
    arr[i3 + 1] = base[i3 + 1] + oy;
    arr[i3 + 2] = base[i3 + 2] + oz;
    touched++;
  }

  if (touched) {
    pos.needsUpdate = true;
    refit(geo);
    mesh.userData.__deformed = true;
  }
  return touched;
}

/** 沿法线方向按压（depth > 0 向内凹） */
export function dent(
  mesh: THREE.Mesh,
  worldPoint: THREE.Vector3,
  worldNormal: THREE.Vector3,
  radius: number,
  depth: number,
) {
  tmpN.copy(worldNormal).normalize().multiplyScalar(-depth);
  return displace(mesh, worldPoint, radius, tmpN);
}

export function canUndo() {
  return undoStack.length > 0;
}

export function canRedo() {
  return redoStack.length > 0;
}

function snapshot(data: MeshSculptData, keys: Iterable<number>) {
  const m = new Map<number, [number, number, number]>();
  for (const i of keys) m.set(i, [data.offset[i * 3], data.offset[i * 3 + 1], data.offset[i * 3 + 2]]);
  return m;
}

function applyOffsets(entry: UndoEntry, values: Map<number, [number, number, number]>) {
  const pos = entry.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  const { data } = entry;
  for (const [i, v] of values) {
    data.offset[i * 3] = v[0];
    data.offset[i * 3 + 1] = v[1];
    data.offset[i * 3 + 2] = v[2];
    arr[i * 3] = data.base[i * 3] + v[0];
    arr[i * 3 + 1] = data.base[i * 3 + 1] + v[1];
    arr[i * 3 + 2] = data.base[i * 3 + 2] + v[2];
  }
  pos.needsUpdate = true;
  const geo = entry.mesh.geometry as THREE.BufferGeometry;
  geo.computeVertexNormals();
  refit(geo);
}

export function undo() {
  const e = undoStack.pop();
  if (!e) return false;
  const after = snapshot(e.data, e.prev.keys());
  applyOffsets(e, e.prev);
  redoStack.push({ mesh: e.mesh, data: e.data, prev: after, start: e.start });
  if (redoStack.length > 24) redoStack.shift();
  return true;
}

export function redo() {
  const e = redoStack.pop();
  if (!e) return false;
  const before = snapshot(e.data, e.prev.keys());
  applyOffsets(e, e.prev);
  undoStack.push({ mesh: e.mesh, data: e.data, prev: before, start: e.start });
  if (undoStack.length > 24) undoStack.shift();
  return true;
}

export function clearSculpt(mesh: THREE.Mesh) {
  const d = mesh.userData.__sculpt as MeshSculptData | undefined;
  if (!d) return;
  const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  (pos.array as Float32Array).set(d.base);
  d.offset.fill(0);
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  refit(mesh.geometry as THREE.BufferGeometry);
  mesh.userData.__deformed = false;
}

export function resetSculptHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  activeOp = null;
}
