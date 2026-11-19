import * as THREE from "three";
import { makeObject, useApp } from "../store";
import { matrix } from "./assembly";
import { buildExtrusionGeometry, prepareContour } from "./stroke";
import type { SceneObject, Vec3 } from "../types";

export function prepareSketchExtrusion(stroke: SceneObject, viewDirection: THREE.Vector3) {
  if (stroke.kind !== "stroke" || stroke.locked || !stroke.visible || !stroke.points || stroke.points.length > 1024) {
    throw new Error("请选择可见、未锁定且不超过 1024 点的闭合笔迹");
  }
  const transform = matrix(stroke.transform);
  const points = stroke.points.map(p => new THREE.Vector3(...p).applyMatrix4(transform));
  const position = points[0].clone();
  const normal = stroke.planeNormal
    ? new THREE.Vector3(...stroke.planeNormal).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(transform))
    : viewDirection.clone().negate();
  const contour = points.map(p => p.sub(position).toArray() as Vec3);
  const profile = prepareContour(contour, normal);
  return { source: stroke, position, contour, profile };
}

export type SketchExtrusion = ReturnType<typeof prepareSketchExtrusion>;

export function commitExtrusion(sketch: SketchExtrusion, thickness: number) {
  const s = useApp.getState();
  const source = s.objects.find(o => o.id === sketch.source.id);
  if (source !== sketch.source) throw new Error("草图已修改，请重新开始拉伸");
  const { position, profile, contour } = sketch;
  if (!Number.isFinite(thickness) || thickness < profile.diagonal * .005 || thickness > profile.diagonal * 4) {
    throw new Error("请输入有效厚度，范围为轮廓对角线的 0.5% 至 400%");
  }
  buildExtrusionGeometry(profile, thickness).dispose();
  const object = makeObject("extrusion", `${source.name} · 实体`, {
    color: source.color,
    transform: { position: position.toArray() as Vec3, rotation: [0, 0, 0], scale: [1, 1, 1] },
    extrusion: { contour, normal: profile.normal.toArray() as Vec3, thickness },
    sourceObjectIds: [source.id],
  });
  s.commit("EXTRUDE_SKETCH", {
    objects: [...s.objects.map(o => o === source ? { ...o, visible: false, version: (o.version ?? 1) + 1 } : o), object],
    selectedId: object.id,
  });
  s.toast("实体已生成", "ok");
}
