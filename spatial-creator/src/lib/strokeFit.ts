import * as THREE from "three";
import type { Vec3 } from "../types";

export type FittedShapeKind = "circle" | "rect" | "line" | "free";

export interface StrokeAnalysis {
  kind: FittedShapeKind;
  label: string;
  confidence: number;
  fittedPoints: Vec3[];
  smoothedPoints: Vec3[];
}

interface PlaneBasis {
  origin: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  normal: THREE.Vector3;
  flat: THREE.Vector2[];
  diagonal: number;
}

function projectToPlane(points: Vec3[], planeNormal?: Vec3): PlaneBasis {
  const pts = points.map((p) => new THREE.Vector3(...p));
  const origin = pts[0].clone();
  const diagonal = Math.max(1e-4, new THREE.Box3().setFromPoints(pts).getSize(new THREE.Vector3()).length());
  const normal = planeNormal ? new THREE.Vector3(...planeNormal) : new THREE.Vector3();
  if (normal.lengthSq() < 1e-6) {
    for (let i = 1; i < pts.length - 1; i++) {
      normal.add(new THREE.Vector3().crossVectors(pts[i].clone().sub(origin), pts[i + 1].clone().sub(origin)));
    }
  }
  if (normal.lengthSq() < 1e-6) normal.set(0, 0, 1);
  normal.normalize();
  const ref = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(ref, normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  const flat = pts.map((p) => {
    const d = p.clone().sub(origin);
    return new THREE.Vector2(d.dot(u), d.dot(v));
  });
  return { origin, u, v, normal, flat, diagonal };
}

function toWorld(basis: PlaneBasis, flat: THREE.Vector2[]): Vec3[] {
  return flat.map((q) =>
    basis.origin
      .clone()
      .addScaledVector(basis.u, q.x)
      .addScaledVector(basis.v, q.y)
      .toArray() as Vec3,
  );
}

function rdp(pts: THREE.Vector2[], eps: number): THREE.Vector2[] {
  if (pts.length <= 2) return pts.slice();
  const a = pts[0];
  const b = pts[pts.length - 1];
  const ab = b.clone().sub(a);
  const len = ab.length();
  let maxD = -1;
  let index = 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d =
      len < 1e-8
        ? pts[i].distanceTo(a)
        : Math.abs((pts[i].x - a.x) * ab.y - (pts[i].y - a.y) * ab.x) / len;
    if (d > maxD) {
      maxD = d;
      index = i;
    }
  }
  if (maxD <= eps) return [a.clone(), b.clone()];
  return [...rdp(pts.slice(0, index + 1), eps).slice(0, -1), ...rdp(pts.slice(index), eps)];
}

/** 强力平滑与精简控制点：针对手抖笔迹减少噪点并保留轮廓 */
export function refineStrokePoints(points: Vec3[], planeNormal?: Vec3): Vec3[] {
  if (points.length < 4) return points.map((p) => [...p] as Vec3);
  const basis = projectToPlane(points, planeNormal);
  const closed = basis.flat[0].distanceTo(basis.flat.at(-1)!) <= basis.diagonal * 0.08;
  let simplified = rdp(basis.flat, Math.max(0.004, basis.diagonal * 0.018));
  if (simplified.length < 4 && basis.flat.length >= 4) {
    simplified = rdp(basis.flat, Math.max(0.002, basis.diagonal * 0.008));
  }
  if (closed && simplified.length >= 3) {
    simplified[simplified.length - 1] = simplified[0].clone();
  }
  // One gentle Laplacian pass on interior points to remove micro-jitter.
  const out = simplified.map((p) => p.clone());
  const limit = closed ? out.length - 1 : out.length;
  for (let pass = 0; pass < 2; pass++) {
    const snap = out.map((p) => p.clone());
    for (let i = 1; i < limit - 1; i++) {
      out[i].set(
        snap[i].x * 0.55 + (snap[i - 1].x + snap[i + 1].x) * 0.225,
        snap[i].y * 0.55 + (snap[i - 1].y + snap[i + 1].y) * 0.225,
      );
    }
  }
  if (closed && out.length >= 3) out[out.length - 1] = out[0].clone();
  return toWorld(basis, out);
}

export function fitLinePoints(points: Vec3[], planeNormal?: Vec3): Vec3[] {
  if (points.length < 2) return points.map((p) => [...p] as Vec3);
  const a = new THREE.Vector3(...points[0]);
  const b = new THREE.Vector3(...points.at(-1)!);
  const mid = a.clone().lerp(b, 0.5);
  void planeNormal;
  return [a.toArray() as Vec3, mid.toArray() as Vec3, b.toArray() as Vec3];
}

export function fitCirclePoints(points: Vec3[], planeNormal?: Vec3, segments = 36): Vec3[] {
  if (points.length < 3) return points.map((p) => [...p] as Vec3);
  const basis = projectToPlane(points, planeNormal);
  const n = basis.flat.length;
  let cx = 0;
  let cy = 0;
  for (const p of basis.flat) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  let r = 0;
  for (const p of basis.flat) r += Math.hypot(p.x - cx, p.y - cy);
  r = Math.max(0.02, r / n);
  const circle: THREE.Vector2[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    circle.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return toWorld(basis, circle);
}

function principalAngle(pts: THREE.Vector2[]) {
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  return 0.5 * Math.atan2(2 * cxy, cxx - cyy);
}

export function fitRectPoints(points: Vec3[], planeNormal?: Vec3): Vec3[] {
  if (points.length < 3) return points.map((p) => [...p] as Vec3);
  const basis = projectToPlane(points, planeNormal);
  const angle = principalAngle(basis.flat);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of basis.flat) {
    const rx = p.x * cos - p.y * sin;
    const ry = p.x * sin + p.y * cos;
    minX = Math.min(minX, rx);
    maxX = Math.max(maxX, rx);
    minY = Math.min(minY, ry);
    maxY = Math.max(maxY, ry);
  }
  const rcos = Math.cos(angle);
  const rsin = Math.sin(angle);
  const unrot = (x: number, y: number) => new THREE.Vector2(x * rcos - y * rsin, x * rsin + y * rcos);
  const corners = [
    unrot(minX, minY),
    unrot(maxX, minY),
    unrot(maxX, maxY),
    unrot(minX, maxY),
  ];
  // Add edge midpoints so TubeGeometry and prepareContour both stay crisp and valid.
  const rect: THREE.Vector2[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    rect.push(a, a.clone().lerp(b, 0.5));
  }
  rect.push(corners[0].clone());
  return toWorld(basis, rect);
}

/** 识别草图形状意图（标准圆 / 矩形 / 直线 / 自由曲线） */
export function analyzeStrokeShape(points: Vec3[], planeNormal?: Vec3): StrokeAnalysis {
  const smoothedPoints = refineStrokePoints(points, planeNormal);
  if (points.length < 3) {
    return { kind: "free", label: "自由曲线", confidence: 0, fittedPoints: smoothedPoints, smoothedPoints };
  }
  const basis = projectToPlane(points, planeNormal);
  const flat = basis.flat;
  const start = flat[0];
  const end = flat[flat.length - 1];
  const span = start.distanceTo(end);

  // 1. Line test: endpoints far apart relative to diagonal, small perpendicular error.
  if (span > basis.diagonal * 0.72) {
    const dir = end.clone().sub(start).normalize();
    let maxPerp = 0;
    for (const p of flat) {
      const rel = p.clone().sub(start);
      const perp = Math.abs(rel.x * dir.y - rel.y * dir.x);
      maxPerp = Math.max(maxPerp, perp);
    }
    if (maxPerp / span <= 0.11) {
      const confidence = Math.max(0.6, Math.min(0.99, 1 - maxPerp / (span * 0.15)));
      return {
        kind: "line",
        label: "直线",
        confidence,
        fittedPoints: fitLinePoints(points, planeNormal),
        smoothedPoints,
      };
    }
  }

  // 2. Closed/loop candidates: circle vs rectangle.
  const endGap = span / basis.diagonal;
  if (flat.length >= 6 && endGap <= 0.45) {
    let cx = 0;
    let cy = 0;
    for (const p of flat) {
      cx += p.x;
      cy += p.y;
    }
    cx /= flat.length;
    cy /= flat.length;
    const radii = flat.map((p) => Math.hypot(p.x - cx, p.y - cy));
    const meanR = radii.reduce((a, b) => a + b, 0) / radii.length;
    const rmsR = Math.sqrt(radii.reduce((s, r) => s + (r - meanR) ** 2, 0) / radii.length);
    const circleErr = meanR > 1e-4 ? rmsR / meanR : 1;

    // Oriented bounding box edge proximity for rectangle check.
    const angle = principalAngle(flat);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const rot = flat.map((p) => {
      const rx = p.x * cos - p.y * sin;
      const ry = p.x * sin + p.y * cos;
      minX = Math.min(minX, rx);
      maxX = Math.max(maxX, rx);
      minY = Math.min(minY, ry);
      maxY = Math.max(maxY, ry);
      return { x: rx, y: ry };
    });
    const w = maxX - minX;
    const h = maxY - minY;
    const obbDiag = Math.max(1e-4, Math.hypot(w, h));
    const rectErr =
      rot.reduce(
        (s, p) => s + Math.min(Math.abs(p.x - minX), Math.abs(maxX - p.x), Math.abs(p.y - minY), Math.abs(maxY - p.y)),
        0,
      ) /
      (rot.length * obbDiag);

    if (circleErr <= 0.22 && (circleErr <= rectErr * 1.35 || rectErr > 0.08)) {
      return {
        kind: "circle",
        label: "标准圆形",
        confidence: Math.max(0.55, Math.min(0.98, 1 - circleErr * 2.2)),
        fittedPoints: fitCirclePoints(points, planeNormal),
        smoothedPoints,
      };
    }
    if (w > 0.02 && h > 0.02 && Math.min(w, h) / Math.max(w, h) >= 0.25 && rectErr <= 0.095) {
      return {
        kind: "rect",
        label: "规整矩形",
        confidence: Math.max(0.55, Math.min(0.96, 1 - rectErr * 4)),
        fittedPoints: fitRectPoints(points, planeNormal),
        smoothedPoints,
      };
    }
  }

  return { kind: "free", label: "自由曲线", confidence: 0.5, fittedPoints: smoothedPoints, smoothedPoints };
}
