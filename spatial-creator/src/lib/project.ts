import { z } from "zod";
import type { Assembly, AssemblyRelation, AiTask, CameraView, Connector, GeneratedAsset, SceneObject, Settings } from "../types";
import { buildSurfaceGeometry, prepareContour } from "./stroke";

export interface ProjectSnapshot {
  version: 2;
  projectId: string;
  name: string;
  sceneRevision: number;
  objects: SceneObject[];
  settings: Settings;
  assets: GeneratedAsset[];
  tasks: AiTask[];
  connectors: Connector[];
  relations: AssemblyRelation[];
  assemblies: Assembly[];
  savedAt: number;
  cameraView?: CameraView;
}

const finite = z.number().finite();
const vec = z.tuple([finite, finite, finite]);
const transform = z.object({ position: vec, rotation: vec, scale: vec.refine(v => v.every(n => n > 0 && n <= 1000), "缩放必须在 0 到 1000 之间") });
const object = z.object({
  id: z.string().min(1), kind: z.enum(["primitive", "model", "stroke", "extrusion"]), name: z.string(),
  transform, visible: z.boolean(), locked: z.boolean(), color: z.string(), createdAt: finite,
  material: z.object({roughness:finite.min(0).max(1),metalness:finite.min(0).max(1),opacity:finite.min(0).max(1),emissiveIntensity:finite.min(0).max(10),
    texture:z.object({dataUrl:z.string().max(8000000).regex(/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/),name:z.string(),hash:z.string()}).optional()}).optional(),
  version: finite.optional(), partId: z.string().optional(), parentId: z.string().optional(),
  localTransform: transform.optional(), assetId: z.string().optional(),
  primitive: z.object({ type: z.enum(["box", "sphere", "cylinder", "torus", "cone"]), params: z.record(finite) }).optional(),
  points: z.array(vec).max(100000).optional(), rawPoints: z.array(vec).max(100000).optional(),
  width: finite.positive().optional(), geometryEdits: z.record(z.array(finite).max(6000000)).optional(),
  geometryType: z.enum(["tube", "curve", "surface"]).optional(),
  planeNormal: vec.optional(),
  extrusion: z.object({ contour: z.array(vec).min(4).max(1024), normal: vec.refine(v => Math.hypot(...v) > 0), thickness: finite.positive() }).optional(),
}).passthrough().superRefine((o, ctx) => {
  if (o.kind === "model" && !o.assetId) ctx.addIssue({ code: "custom", message: "模型缺少资产引用" });
  if (o.kind === "primitive" && !o.primitive) ctx.addIssue({ code: "custom", message: "基础对象缺少几何定义" });
  if (o.kind === "stroke" && (!o.points || o.points.length < 3)) ctx.addIssue({ code: "custom", message: "笔迹至少需要 3 点" });
  if (o.kind === "extrusion" && !o.extrusion) ctx.addIssue({ code: "custom", message: "实体缺少拉伸轮廓" });
});
const schema = z.object({
  version: z.literal(2), projectId: z.string().min(1), name: z.string(), sceneRevision: finite.int().nonnegative(),
  objects: z.array(object).max(10000), settings: z.object({
    calibration: z.object({ x0: finite, x1: finite, y0: finite, y1: finite }).passthrough().nullable(),
    mirror: z.boolean(), smoothing: finite.min(0).max(1), pinchSensitivity: finite.min(0.2).max(0.9),
    sculptRadius: finite.positive(), sculptStrength: finite.positive(), showHandSkeleton: z.boolean(),
    showGrid: z.boolean(), autoRotate: z.boolean(), drawPlane: z.enum(["camera", "xy", "xz", "yz"]),
    drawDepth: finite, strokeSmoothing: finite.min(0).max(1),
  }),
  assets: z.array(z.object({ id: z.string(), name: z.string(), taskId: finite, sourceUrl: z.string(), createdAt: finite, bytes: finite }).passthrough()),
  tasks: z.array(z.object({ id: z.string(), state: z.enum(["queued", "running", "success", "failed", "uploading", "preview", "accepted", "rejected", "cancelled", "conflicted", "timed_out"]), candidate: object.optional(),
    taskType:z.enum(["CREATE_OBJECT","GENERATE_PART","REPLACE_OBJECT","CONTINUE_FROM_SKETCH","MODIFY_OBJECT","MODIFY_REGION","EXPLAIN_SCENE"]).optional(),
    parentTaskId:z.string().optional(),localOperation:z.enum(["transform","material","region"]).optional(),explanation:z.string().optional(),
    region:z.object({center:vec,radius:finite.positive().max(10000),delta:vec}).optional(),
    references:z.array(z.object({name:z.string(),hash:z.string(),purpose:z.enum(["appearance","outline","material","detail"]),dataUrl:z.string().max(8000000).regex(/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/)})).max(4).optional()
  }).passthrough()),
  connectors: z.array(z.object({ id: z.string(), partId: z.string(), name: z.string(), position: vec, rotation: vec, axis: vec.refine(v => Math.hypot(...v) > 0) })),
  relations: z.array(z.object({ id: z.string(), parentPartId: z.string(), childPartId: z.string(), parentConnectorId: z.string(), childConnectorId: z.string(), type: z.enum(["fixed","hinge","slider"]), status: z.enum(["valid", "broken", "suppressed"]), limits:z.object({min:finite,max:finite,value:finite}).optional() })),
  assemblies: z.array(z.object({ id: z.string(), name: z.string(), rootPartId: z.string(), partIds: z.array(z.string()), transform, version: finite })),
  savedAt: finite,
  cameraView: z.object({ position: vec, target: vec, up:vec.optional(), projection:z.enum(["perspective","orthographic"]).optional(),orthoHeight:finite.positive().optional() }).optional(),
});

export function validateProject(input: unknown): ProjectSnapshot {
  const p = schema.parse(input) as unknown as ProjectSnapshot;
  const ids = new Set(p.objects.map(o => o.id));
  const parts = new Set(p.objects.flatMap(o => o.partId ? [o.partId] : []));
  if (ids.size !== p.objects.length || parts.size !== p.objects.filter(o => o.partId).length) throw new Error("对象或零件 ID 重复");
  const unique = (items: { id: string }[]) => new Set(items.map(x => x.id)).size === items.length;
  if (!unique(p.connectors) || !unique(p.relations) || !unique(p.assemblies) || !unique(p.tasks)) throw new Error("关系或任务 ID 重复");
  for (const o of p.objects) {
    if (o.geometryType === "surface") buildSurfaceGeometry(o.points ?? []).dispose();
    if (o.extrusion) prepareContour(o.extrusion.contour);
    const seen = new Set([o.id]);
    let parent = o.parentId;
    while (parent) {
      if (!ids.has(parent) || seen.has(parent)) throw new Error("层级包含循环或缺失父对象");
      seen.add(parent); parent = p.objects.find(x => x.id === parent)?.parentId;
    }
  }
  for (const c of p.connectors) if (!parts.has(c.partId)) throw new Error("连接点引用缺失零件");
  for (const r of p.relations) {
    if(r.type!=="fixed"&&(!r.limits||r.limits.min>r.limits.max||r.limits.value<r.limits.min||r.limits.value>r.limits.max))throw new Error("关节限位或当前位置无效");
    if (!parts.has(r.parentPartId) || !parts.has(r.childPartId) ||
        !p.connectors.some(c => c.id === r.parentConnectorId && c.partId === r.parentPartId) ||
        !p.connectors.some(c => c.id === r.childConnectorId && c.partId === r.childPartId)) throw new Error("连接关系引用无效");
  }
  for (const a of p.assemblies) if (!a.partIds.includes(a.rootPartId) || a.partIds.some(id => !parts.has(id))) throw new Error("装配体引用无效");
  return p;
}

export function migrateProject(input: unknown, defaults: Settings): ProjectSnapshot {
  const v = input as Partial<ProjectSnapshot>;
  if (v?.version === 2) return validateProject(v);
  if (!v || !Array.isArray(v.objects) || (v.version !== undefined && v.version !== 1)) throw new Error("不支持的项目格式");
  return validateProject({ version: 2, projectId: crypto.randomUUID(), name: "恢复的作品", sceneRevision: 0,
    objects: v.objects.map(o => ({ ...o, version: o.version ?? 1 })), settings: { ...defaults, ...v.settings },
    assets: v.assets ?? [], tasks: [], connectors: [], relations: [], assemblies: [], savedAt: v.savedAt ?? Date.now() });
}

export async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
export function base64ToBlob(text: string) {
  return new Blob([Uint8Array.from(atob(text), c => c.charCodeAt(0))], { type: "model/gltf-binary" });
}
