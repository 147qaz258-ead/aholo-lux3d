import { Box3, Vector3 } from "three";
import { objectRegistry } from "../scene/runtime";
import { useApp } from "../store";
import type { SceneObject } from "../types";

export function sceneContext(targetId?: string) {
  const s = useApp.getState();
  const relevant = s.objects.filter(o => o.id === targetId || o.visible).sort((a, b) => Number(b.id === targetId) - Number(a.id === targetId));
  return { projectId: s.projectId, sceneRevision: s.sceneRevision, activeObjectId: targetId,
    omittedObjects: Math.max(0, relevant.length - 30),
    objects: relevant.slice(0, 30).map(o => {
      const root = objectRegistry.get(o.id);
      const box = root ? new Box3().setFromObject(root) : new Box3(new Vector3(...o.transform.position), new Vector3(...o.transform.position));
      return { objectId: o.id, version: o.version ?? 1, objectType: o.kind, name: o.name, transform: o.transform,
        bounds: { min: box.min.toArray(), max: box.max.toArray() }, geometryRef: o.assetId ?? o.strokeId ?? o.id,
        partId: o.partId, parentId: o.parentId, source: o.source ?? "manual", locked: o.locked, visible: o.visible };
    }),
    sketches: s.objects.filter(o => o.id === targetId && o.kind === "stroke").map(o => ({ strokeId: o.strokeId ?? o.id, planeId: o.planeId ?? "camera", rawPoints: o.rawPoints ?? o.points, smoothedPoints: o.points, transform: o.transform })),
    assemblyRelations: s.relations,
  };
}

/** Lux3D accepts an 800-character text description, rather than a structured scene contract. */
export function providerText(prompt: string, context: ReturnType<typeof sceneContext>, taskType: string) {
  const target = context.objects.find(o => o.objectId === context.activeObjectId);
  const vector = (v: number[]) => v.map(n => Number(n.toFixed(2))).join(",");
  const reference = target ? `参考：${target.name.slice(0, 30)}（${target.objectType}），位置[${vector(target.transform.position)}]，缩放[${vector(target.transform.scale)}]，包围盒[${vector(target.bounds.min)}]至[${vector(target.bounds.max)}]。` : "";
  const summary = `任务：${taskType}。${reference}仅生成本次独立模型。`;
  // Keep the original user text intact; reserve a bounded remainder for provider context.
  return `${prompt}。${summary.slice(0, Math.max(0, 799 - prompt.length))}`.slice(0, 800);
}

export function sketchImage(o: SceneObject) {
  if (!o.points || o.points.length < 3) throw new Error("请选择一条有效草图");
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, 512, 512); ctx.strokeStyle = "black"; ctx.lineWidth = 6;
  // Project onto the two axes with the largest extent, retaining the chosen plane's outline.
  const spans = [0, 1, 2].map(k => Math.max(...o.points!.map(p => p[k])) - Math.min(...o.points!.map(p => p[k])));
  const axes = [0, 1, 2].sort((a, b) => spans[b] - spans[a]).slice(0, 2).sort();
  const lo = axes.map(k => Math.min(...o.points!.map(p => p[k])));
  const size = Math.max(...axes.map(k => spans[k]), 0.001);
  ctx.beginPath();
  o.points.forEach((p, i) => { const x = 48 + (p[axes[0]] - lo[0]) / size * 416, y = 464 - (p[axes[1]] - lo[1]) / size * 416; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
  ctx.stroke(); return canvas.toDataURL("image/png");
}
