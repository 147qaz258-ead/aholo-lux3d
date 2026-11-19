import * as THREE from "three";
import type { Vec3 } from "../types";

const MAX_POINTS = 1024;

/** Keep endpoints and sharp corners; retain raw samples separately in the scene. */
export function smoothStroke(points: Vec3[], strength: number): Vec3[] {
  return points.map((p, i) => {
    if (!i || i === points.length - 1) return [...p];
    const a = new THREE.Vector3(...p).sub(new THREE.Vector3(...points[i - 1]));
    const b = new THREE.Vector3(...points[i + 1]).sub(new THREE.Vector3(...p));
    if (a.angleTo(b) > Math.PI / 5) return [...p];
    const weight = Math.min(0.25, Math.max(0, strength) * 0.25);
    return p.map((v, k) => v * (1 - weight * 2) + (points[i - 1][k] + points[i + 1][k]) * weight) as Vec3;
  });
}

function viewNormal(p: THREE.Vector3, cam: THREE.Vector3) {
  return new THREE.Vector3().subVectors(cam, p).normalize();
}

/** 绘制过程中的实时笔迹：面向相机的带状面片，预分配缓冲避免每帧 GC */
export class LiveRibbon {
  geometry: THREE.BufferGeometry;
  private positions: Float32Array;
  private indices: Uint16Array;
  private count = 0;

  constructor(private width = 0.012) {
    this.positions = new Float32Array(MAX_POINTS * 2 * 3);
    const idx: number[] = [];
    for (let i = 0; i < MAX_POINTS - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.indices = new Uint16Array(idx);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));
    this.geometry.setDrawRange(0, 0);
  }

  update(points: THREE.Vector3[], cam: THREE.Vector3) {
    const n = Math.min(points.length, MAX_POINTS);
    if (n < 2) {
      this.geometry.setDrawRange(0, 0);
      return;
    }
    const pos = this.positions;
    const w = this.width / 2;
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(n - 1, i + 1)];
      const tangent = new THREE.Vector3().subVectors(next, prev);
      if (tangent.lengthSq() < 1e-9) tangent.set(0, 1e-3, 0);
      tangent.normalize();
      const side = new THREE.Vector3().crossVectors(tangent, viewNormal(p, cam)).normalize().multiplyScalar(w);
      const i6 = i * 6;
      pos[i6] = p.x - side.x;
      pos[i6 + 1] = p.y - side.y;
      pos[i6 + 2] = p.z - side.z;
      pos[i6 + 3] = p.x + side.x;
      pos[i6 + 4] = p.y + side.y;
      pos[i6 + 5] = p.z + side.z;
    }
    this.count = n;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.setDrawRange(0, (n - 1) * 6);
    this.geometry.computeBoundingSphere();
  }

  dispose() {
    this.geometry.dispose();
  }
}

/** 成型的笔迹：真实三维管状体，可被射线拾取 */
export function buildStrokeGeometry(points: Vec3[], radius = 0.012): THREE.BufferGeometry {
  const pts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  if (pts.length < 2) {
    return new THREE.BufferGeometry();
  }
  const diagonal = new THREE.Box3().setFromPoints(pts).getSize(new THREE.Vector3()).length();
  const closed = pts.length > 3 && pts[0].distanceTo(pts.at(-1)!) <= diagonal * 0.02;
  if (closed) pts.pop();
  const curve = new THREE.CatmullRomCurve3(pts, closed, "catmullrom", 0.25);
  const seg = Math.min(600, Math.max(24, pts.length * 4));
  const geo = new THREE.TubeGeometry(curve, seg, radius, 8, closed);
  return geo;
}

export function prepareContour(points: Vec3[], direction?: THREE.Vector3) {
  if (points.length < 4) throw new Error("闭合面至少需要 4 个轨迹点（含闭合端点）");
  const pts = points.map(p => new THREE.Vector3(...p));
  const diagonal = new THREE.Box3().setFromPoints(pts).getSize(new THREE.Vector3()).length();
  if (diagonal < 0.03 || pts[0].distanceTo(pts.at(-1)!) > diagonal * 0.02) throw new Error("轮廓未闭合：首尾间距须小于包围盒对角线的 2%");
  pts.pop();
  const origin = pts[0], normal = new THREE.Vector3();
  for (let i = 1; i < pts.length - 1; i++) normal.add(new THREE.Vector3().crossVectors(pts[i].clone().sub(origin), pts[i + 1].clone().sub(origin)));
  if (normal.length() < diagonal * diagonal * 1e-6) throw new Error("轮廓面积为零或存在自交");
  normal.normalize();
  if (direction && normal.dot(direction) < 0) normal.negate();
  if (pts.some(p => Math.abs(p.clone().sub(origin).dot(normal)) > diagonal * 0.01)) throw new Error("轨迹不在同一平面，无法生成闭合面");
  const u = pts.find(p => p.distanceTo(origin) > 1e-6)!.clone().sub(origin).normalize(), v = new THREE.Vector3().crossVectors(normal, u).normalize();
  const flat: THREE.Vector2[] = [];
  const epsilon = diagonal * 1e-7;
  for (const p of pts) {
    const q = p.clone().sub(origin);
    const projected = new THREE.Vector2(q.dot(u), q.dot(v));
    if (!flat.length || flat[flat.length - 1].distanceTo(projected) > epsilon) flat.push(projected);
  }
  if (flat.length > 1 && flat[0].distanceTo(flat[flat.length - 1]) <= epsilon) flat.pop();
  const cross = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const onSegment = (a: THREE.Vector2, b: THREE.Vector2, p: THREE.Vector2) => Math.abs(cross(a,b,p)) < 1e-10 && p.x >= Math.min(a.x,b.x)-1e-10 && p.x <= Math.max(a.x,b.x)+1e-10 && p.y >= Math.min(a.y,b.y)-1e-10 && p.y <= Math.max(a.y,b.y)+1e-10;
  for (let i = 0; i < flat.length; i++) for (let j = i + 1; j < flat.length; j++) {
    if (j === i+1 || (i === 0 && j === flat.length-1)) continue;
    const a=flat[i], b=flat[(i+1)%flat.length], c=flat[j], d=flat[(j+1)%flat.length];
    if ((cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0) || onSegment(a,b,c) || onSegment(a,b,d) || onSegment(c,d,a) || onSegment(c,d,b)) throw new Error("轮廓存在自交，请调整控制点后重试");
  }
  // Keep cap and wall topology consistent when triangulation drops straight-edge samples.
  for (let i = flat.length - 1; i >= 0 && flat.length > 3; i--) {
    const a = flat[(i + flat.length - 1) % flat.length], b = flat[i], c = flat[(i + 1) % flat.length];
    if (onSegment(a, c, b)) flat.splice(i, 1);
  }
  if (flat.length < 3 || Math.abs(THREE.ShapeUtils.area(flat)) < diagonal * diagonal * 1e-6) {
    throw new Error("轮廓面积太小，请调整后重试");
  }
  return { origin, normal, u, v, flat, diagonal };
}

export function buildSurfaceGeometry(points: Vec3[]): THREE.BufferGeometry {
  const { origin, u, v, flat } = prepareContour(points);
  const shape = new THREE.Shape(flat);
  const geo = new THREE.ShapeGeometry(shape), attr = geo.getAttribute("position");
  for (let i=0; i<attr.count; i++) { const p=origin.clone().addScaledVector(u,attr.getX(i)).addScaledVector(v,attr.getY(i)); attr.setXYZ(i,p.x,p.y,p.z); }
  geo.computeVertexNormals(); geo.computeBoundingSphere(); return geo;
}

export function buildExtrusionGeometry(profile: ReturnType<typeof prepareContour>, thickness: number) {
  if (!Number.isFinite(thickness) || thickness <= 0) throw new Error("厚度必须为正数");
  const { origin, normal, u, v, flat } = profile;
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(flat), { depth: thickness, bevelEnabled: false, steps: 1 });
  geometry.applyMatrix4(new THREE.Matrix4().makeBasis(u, v, normal).setPosition(origin));
  return geometry;
}
