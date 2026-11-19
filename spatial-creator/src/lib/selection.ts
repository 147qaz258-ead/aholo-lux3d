import { Box3, Matrix4, Vector3 } from "three";
import type { SceneObject, Vec3 } from "../types";
import { descendants, fromMatrix, localTransform, matrix } from "./assembly";
import { objectRegistry } from "../scene/runtime";

export function selectionIds(objects: SceneObject[], ids: string[]) {
  return new Set(ids.flatMap(id => [...descendants(objects, id)]));
}
export function selectionCenter(objects: SceneObject[], ids: string[]): Vec3 {
  const box = new Box3();
  const affected=selectionIds(objects,ids);
  for (const o of objects) if (affected.has(o.id)) {
    const runtime = objectRegistry.get(o.id);
    if (runtime) { runtime.updateMatrixWorld(true); box.expandByObject(runtime); }
    else box.expandByPoint(new Vector3(...o.transform.position));
  }
  return box.isEmpty() ? [0,0,0] : box.getCenter(new Vector3()).toArray() as Vec3;
}
/** Apply one world-space delta exactly once even when parent and child are both selected. */
export function transformObjects(objects: SceneObject[], ids: string[], delta: Matrix4) {
  const affected = selectionIds(objects, ids);
  if (!affected.size || objects.some(o => affected.has(o.id) && o.locked)) throw new Error("选中对象或其子对象已锁定");
  const moved = objects.map(o => affected.has(o.id) ? { ...o, transform: fromMatrix(delta.clone().multiply(matrix(o.transform))), version: (o.version ?? 1) + 1 } : o);
  for (const o of moved) if (affected.has(o.id)) {
    if (o.transform.scale.some(n => !Number.isFinite(n) || n <= 0 || n > 1000)) throw new Error("批量变换超过缩放范围");
    if (o.parentId) o.localTransform = localTransform(moved.find(p => p.id === o.parentId)!.transform, o.transform);
  }
  return moved;
}
