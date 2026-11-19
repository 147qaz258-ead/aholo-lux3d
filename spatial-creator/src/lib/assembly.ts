import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { Assembly, AssemblyRelation, Connector, SceneObject, Transform, Vec3 } from "../types";

export const identityTransform = (): Transform => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
export function matrix(t: Transform) {
  return new Matrix4().compose(new Vector3(...t.position), new Quaternion().setFromEuler(new Euler(...t.rotation)), new Vector3(...t.scale));
}
export function fromMatrix(m: Matrix4): Transform {
  const p = new Vector3(), q = new Quaternion(), s = new Vector3();
  m.decompose(p, q, s);
  const e = new Euler().setFromQuaternion(q);
  return { position: p.toArray() as Vec3, rotation: [e.x, e.y, e.z], scale: s.toArray() as Vec3 };
}
export function localTransform(parent: Transform, child: Transform) {
  const local = matrix(parent).invert().multiply(matrix(child)), result = fromMatrix(local), roundTrip = matrix(result);
  const magnitude = Math.max(1, ...local.elements.map(Math.abs));
  if (local.elements.some((v, i) => Math.abs(v - roundTrip.elements[i]) > magnitude * 1e-5)) throw new Error("当前层级不支持剪切变换，请先将父对象改为等比缩放或解除层级");
  return result;
}
export function descendants(objects: SceneObject[], id: string): Set<string> {
  const result = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const o of objects) if (o.parentId && result.has(o.parentId) && !result.has(o.id)) { result.add(o.id); changed = true; }
  }
  return result;
}
export function moveHierarchy(objects: SceneObject[], id: string, transform: Transform): SceneObject[] {
  const root = objects.find(o => o.id === id);
  if (!root) return objects;
  const ids = descendants(objects, id);
  const delta = matrix(transform).multiply(matrix(root.transform).invert());
  return objects.map(o => ids.has(o.id) ? { ...o, transform: o.id === id ? transform : fromMatrix(delta.clone().multiply(matrix(o.transform))), version: (o.version ?? 1) + 1 } : o)
    .map((o, _, all) => o.id === id && o.parentId ? { ...o, localTransform: localTransform(all.find(p => p.id === o.parentId)!.transform, o.transform) } : o);
}
export function connectorMatrix(c: Connector) {
  // rotation gives the connector frame; axis specifies its main connection direction.
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(...c.axis).normalize());
  q.premultiply(new Quaternion().setFromEuler(new Euler(...c.rotation)));
  return new Matrix4().compose(new Vector3(...c.position), q, new Vector3(1, 1, 1));
}
export function alignedTransform(parent: SceneObject, child: SceneObject, a: Connector, b: Connector): Transform {
  const target = matrix(parent.transform).multiply(connectorMatrix(a));
  const childConnector = matrix(child.transform).multiply(connectorMatrix(b));
  const tp = new Vector3(), tq = new Quaternion(), ts = new Vector3();
  const cp = new Vector3(), cq = new Quaternion(), cs = new Vector3();
  target.decompose(tp, tq, ts); childConnector.decompose(cp, cq, cs);
  const deltaQ = tq.multiply(cq.invert());
  const oldQ = new Quaternion().setFromEuler(new Euler(...child.transform.rotation));
  const nextQ = deltaQ.clone().multiply(oldQ);
  const nextP = new Vector3(...child.transform.position).sub(cp).applyQuaternion(deltaQ).add(tp);
  const e = new Euler().setFromQuaternion(nextQ);
  return { position: nextP.toArray() as Vec3, rotation: [e.x, e.y, e.z], scale: [...child.transform.scale] };
}

export function jointTransform(parent: SceneObject, child: SceneObject, a: Connector, b: Connector, type: AssemblyRelation["type"], value=0): Transform {
  const aligned=alignedTransform(parent,child,a,b);
  const frame=matrix(parent.transform).multiply(connectorMatrix(a));
  const pivot=new Vector3().setFromMatrixPosition(frame),axis=new Vector3(0,1,0).transformDirection(frame);
  if(type==="fixed")return aligned;
  if(type==="slider")return {...aligned,position:new Vector3(...aligned.position).addScaledVector(axis,value).toArray() as Vec3};
  const rotation=new Matrix4().makeTranslation(...pivot.toArray() as Vec3).multiply(new Matrix4().makeRotationAxis(axis,value)).multiply(new Matrix4().makeTranslation(...pivot.negate().toArray() as Vec3));
  return fromMatrix(rotation.multiply(matrix(aligned)));
}

export function connectionError(objects: SceneObject[],connectors:Connector[],r:AssemblyRelation){
  const parent=objects.find(o=>o.partId===r.parentPartId),child=objects.find(o=>o.partId===r.childPartId),a=connectors.find(c=>c.id===r.parentConnectorId),b=connectors.find(c=>c.id===r.childConnectorId);
  if(!parent||!child||!a||!b)return {position:Infinity,angle:Infinity};
  const expected=jointTransform(parent,child,a,b,r.type,r.limits?.value??0);
  const actualFrame=matrix(child.transform).multiply(connectorMatrix(b)),expectedFrame=matrix(expected).multiply(connectorMatrix(b));
  const p=new Vector3(),q=new Quaternion(),scale=new Vector3(),ep=new Vector3(),eq=new Quaternion();
  actualFrame.decompose(p,q,scale);expectedFrame.decompose(ep,eq,scale);
  return {position:p.distanceTo(ep),angle:q.angleTo(eq)*180/Math.PI};
}

/** Slider displacement is measured in world scene units and scales with both connected parts. */
export function transformedRelations(relations:AssemblyRelation[],objects:SceneObject[],affected:Set<string>,scale=1){
  const partIds=new Set(objects.filter(o=>affected.has(o.id)).map(o=>o.partId).filter(Boolean));
  return relations.map(r=>{
    if(r.status!=="valid")return r;
    const parent=partIds.has(r.parentPartId),child=partIds.has(r.childPartId);
    if(child&&!parent)return {...r,status:"broken" as const};
    if(parent&&child&&r.type==="slider"&&r.limits&&Math.abs(scale-1)>1e-12)return {...r,limits:{min:r.limits.min*scale,max:r.limits.max*scale,value:r.limits.value*scale}};
    return r;
  });
}

export function rebuildAssemblies(objects: SceneObject[], relations: AssemblyRelation[], previous: Assembly[]): Assembly[] {
  const remaining = new Set(objects.flatMap(o => o.partId ? [o.partId] : []));
  const groups: Assembly[] = [];
  while (remaining.size) {
    const first = remaining.values().next().value!;
    const members = new Set([first]); let changed = true;
    while (changed) {
      changed = false;
      for (const r of relations.filter(r => r.status !== "suppressed")) if (members.has(r.parentPartId) || members.has(r.childPartId)) {
        for (const p of [r.parentPartId, r.childPartId]) if (!members.has(p) && remaining.has(p)) { members.add(p); changed = true; }
      }
    }
    members.forEach(p => remaining.delete(p));
    if (members.size < 2) continue;
    const root = [...members].find(p => !relations.some(r => r.status !== "suppressed" && r.childPartId === p && members.has(r.parentPartId))) ?? first;
    const old = previous.find(a => a.rootPartId === root);
    groups.push({ id: old?.id ?? crypto.randomUUID(), name: old?.name ?? `装配体 ${groups.length + 1}`, rootPartId: root, partIds: [...members], transform: old?.transform ?? identityTransform(), version: (old?.version ?? 0) + 1 });
  }
  return groups;
}
