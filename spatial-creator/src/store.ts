import { create } from "zustand";
import type { AiTask, Assembly, AssemblyRelation, CameraView, Connector, GeneratedAsset, SceneObject, Settings, ToolId, Transform, Vec3 } from "./types";
import { idb } from "./lib/idb";
import { handState } from "./lib/handState";
import { base64ToBlob, blobToBase64, migrateProject, validateProject, type ProjectSnapshot } from "./lib/project";
import { alignedTransform, connectionError, jointTransform, descendants, fromMatrix, identityTransform, localTransform, matrix, moveHierarchy, rebuildAssemblies, transformedRelations } from "./lib/assembly";
import { downloadBlob } from "./lib/exporter";
import { recorder } from "./lib/recorder";
import { Matrix4, Euler, Quaternion, Vector3 } from "three";
import { selectionCenter, selectionIds, transformObjects } from "./lib/selection";
import { listVersions, saveVersion, type SavedVersion } from "./lib/versions";

export interface Toast {
  id: string;
  kind: "info" | "ok" | "warn" | "err";
  text: string;
  t: number;
}

interface Hud {
  gesture: string;
  hands: number;
  handFps: number;
  renderFps: number;
  pointerActive: boolean;
}

interface AppState {
  projectId: string;
  projectName: string;
  cameraView: CameraView;
  cameraViewEpoch: number;
  updateCameraView: (view: CameraView) => void;
  renameProject: (name: string) => void;
  sceneRevision: number;
  savedRevision: number;
  saveStatus: "saved" | "dirty" | "saving" | "error";
  saveError: string;
  recoveryAvailable: boolean;
  connectors: Connector[];
  relations: AssemblyRelation[];
  assemblies: Assembly[];
  past: SceneSnapshot[];
  future: SceneSnapshot[];
  commands: { id: string; timestamp: number; type: string; beforeRevision: number; afterRevision: number }[];
  interaction: string;
  cancelEpoch: number;
  connectionPreview: { targetId: string; transform: Transform } | null;
  setConnectionPreview: (preview: AppState["connectionPreview"]) => void;
  cancelInteraction: () => void;
  setInteraction: (state: string) => void;
  commit: (label: string, change: Partial<SceneSnapshot>) => void;
  undo: () => boolean;
  redo: () => boolean;
  convertToPart: (id: string) => void;
  replacePart: (targetId: string, sourceId: string) => void;
  reparent: (id: string, parentId?: string) => void;
  addConnector: (id: string, position: Vec3, rotation?: Vec3) => void;
  connect: (parentConnectorId: string, childConnectorId: string, type?: AssemblyRelation["type"], limits?: {min:number;max:number}) => void;
  setJointValue: (id:string,value:number) => void;
  detach: (relationId: string) => void;
  transformAssembly: (id: string, transform: Transform) => void;
  acceptTask: (id: string) => boolean;
  rejectTask: (id: string) => void;
  openProjectFile: (file: File) => Promise<void>;
  restoreBackup: () => Promise<void>;
  snapshot: () => ProjectSnapshot;
  objects: SceneObject[];
  selectedId: string | null;
  selectedIds: string[];
  selectMany: (ids: string[]) => void;
  transformSelected: (position: Vec3, rotation?: Vec3, scale?: number) => void;
  applySelectionDelta: (ids: string[], delta: Matrix4) => void;
  removeSelected: () => void;
  saveNamedVersion: (label: string) => Promise<SavedVersion>;
  restoreVersion: (id: string) => Promise<void>;
  tool: ToolId;
  settings: Settings;
  tasks: AiTask[];
  assets: GeneratedAsset[];
  toasts: Toast[];
  hud: Hud;
  booted: boolean;
  cameraReady: boolean;
  sculptMode: "dent" | "stretch";
  /** 面板显隐（WS-004）：false = 隐藏，布局让出空间 */
  panels: { rail: boolean; inspector: boolean; ai: boolean };
  gestureMenu: { id: number; x: number; y: number } | null;
  setGestureMenu: (menu: AppState["gestureMenu"]) => void;

  setTool: (t: ToolId) => void;
  setSculptMode: (m: "dent" | "stretch") => void;
  togglePanel: (k: "rail" | "inspector" | "ai") => void;
  select: (id: string | null, additive?: boolean) => void;
  addObject: (o: SceneObject) => void;
  removeObject: (id: string) => void;
  patchObject: (id: string, patch: Partial<SceneObject>) => void;
  setTransform: (id: string, t: Partial<Transform>) => void;
  duplicateObject: (id: string) => void;
  clearScene: () => void;

  updateSettings: (patch: Partial<Settings>) => void;
  addTask: (t: AiTask) => void;
  patchTask: (id: string, patch: Partial<AiTask>) => void;
  removeTask: (id: string) => void;
  addAsset: (a: GeneratedAsset) => void;
  removeAsset: (id: string) => void;

  toast: (text: string, kind?: Toast["kind"]) => void;
  dismiss: (id: string) => void;

  setHud: (patch: Partial<Hud>) => void;
  setBooted: (v: boolean) => void;
  setCameraReady: (v: boolean) => void;

  hydrate: () => Promise<void>;
  save: () => Promise<void>;
  saveProjectFile: () => Promise<void>;
}

export const uid = () => crypto.randomUUID();
type SceneSnapshot = Pick<AppState, "objects" | "selectedId" | "selectedIds" | "connectors" | "relations" | "assemblies">;
const sceneSnapshot = (s: AppState): SceneSnapshot => ({ objects: s.objects, selectedId: s.selectedId, selectedIds: s.selectedIds, connectors: s.connectors, relations: s.relations, assemblies: s.assemblies });
let saveTimer: ReturnType<typeof setTimeout>;
let saveQueue = Promise.resolve();
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void useApp.getState().save().catch(() => {}), 700);
}

const defaultSettings: Settings = {
  calibration: null,
  mirror: true,
  smoothing: 0.55,
  pinchSensitivity: 0.62,
  sculptRadius: 0.18,
  sculptStrength: 1,
  showHandSkeleton: true,
  showGrid: true,
  autoRotate: false,
  drawPlane: "camera",
  drawDepth: 0,
  strokeSmoothing: 0.35,
  dwellClick: false,
};

export const useApp = create<AppState>((set, get) => ({
  projectId: uid(), projectName: "未命名作品", sceneRevision: 0, savedRevision: 0,
  cameraView: { position: [0, 1.6, 4.8], target: [0, 0.9, 0] }, cameraViewEpoch: 0,
  updateCameraView: cameraView => { set({ cameraView, saveStatus: "dirty" }); scheduleSave(); },
  renameProject: projectName => { set(s => ({ projectName, sceneRevision: s.sceneRevision + 1, saveStatus: "dirty" })); scheduleSave(); },
  saveStatus: "saved", saveError: "", recoveryAvailable: false,
  connectors: [], relations: [], assemblies: [], past: [], future: [], commands: [],
  interaction: "Idle", cancelEpoch: 0,
  connectionPreview: null,
  setConnectionPreview: connectionPreview => set({ connectionPreview }),
  cancelInteraction: () => set(s => ({ cancelEpoch: s.cancelEpoch + 1, connectionPreview: null })),
  setInteraction: interaction => { if (get().interaction !== interaction) { recorder.event("InteractionEvent", { eventType: interaction, activeTool: get().tool, targetObjectId: get().selectedId, consumedBy: "scene" }); set({ interaction }); } },
  commit: (label, change) => {
    const before = get();
    const validIds = new Set((change.objects ?? before.objects).map(o => o.id));
    const selectedIds = (change.selectedIds ?? (change.selectedId !== undefined ? change.selectedId ? [change.selectedId] : [] : before.selectedIds)).filter(id => validIds.has(id));
    recorder.event("SceneCommand", { commandId: uid(), transactionId: uid(), commandType: label, targetIds: change.objects?.filter(o => before.objects.find(p => p.id === o.id) !== o).map(o => o.id) ?? [], beforeRevision: before.sceneRevision, undoable: true, origin: label.startsWith("AI") ? "AI" : before.interaction === "Grabbing" || before.interaction === "Pressing" || before.interaction === "Drawing" ? "gesture-or-mouse" : "ui" });
    set({ ...change, selectedIds, selectedId: selectedIds.includes(change.selectedId ?? before.selectedId ?? "") ? change.selectedId ?? before.selectedId : selectedIds.at(-1) ?? null, sceneRevision: before.sceneRevision + 1, saveStatus: "dirty", saveError: "",
      past: [...before.past, sceneSnapshot(before)].slice(-50), future: [],
      commands: [...before.commands, { id: uid(), timestamp: Date.now(), type: label, beforeRevision: before.sceneRevision, afterRevision: before.sceneRevision + 1 }].slice(-200) });
    scheduleSave();
  },
  undo: () => {
    const s = get(), prior = s.past.at(-1);
    if (!prior || !["Idle", "Hover", "Committed", "Cancelled"].includes(s.interaction)) return false;
    set({ ...prior, past: s.past.slice(0, -1), future: [...s.future, sceneSnapshot(s)], sceneRevision: s.sceneRevision + 1, saveStatus: "dirty", cancelEpoch: s.cancelEpoch + 1 });
    scheduleSave(); return true;
  },
  redo: () => {
    const s = get(), next = s.future.at(-1);
    if (!next || !["Idle", "Hover", "Committed", "Cancelled"].includes(s.interaction)) return false;
    set({ ...next, past: [...s.past, sceneSnapshot(s)], future: s.future.slice(0, -1), sceneRevision: s.sceneRevision + 1, saveStatus: "dirty", cancelEpoch: s.cancelEpoch + 1 });
    scheduleSave(); return true;
  },
  objects: [],
  selectedId: null,
  selectedIds: [],
  tool: "select",
  settings: defaultSettings,
  tasks: [],
  assets: [],
  toasts: [],
  booted: false,
  cameraReady: false,
  sculptMode: "dent",
  panels: { rail: true, inspector: true, ai: false },
  gestureMenu: null,
  setGestureMenu: gestureMenu => set({ gestureMenu }),
  hud: { gesture: "none", hands: 0, handFps: 0, renderFps: 0, pointerActive: false },

  setTool: (tool) => set(s => ({ tool, panels: { ...s.panels, ai: tool === "ai" }, cancelEpoch: s.cancelEpoch + 1 })),
  setSculptMode: (sculptMode) => set({ sculptMode }),
  togglePanel: (k) => set((s) => ({ panels: { ...s.panels, [k]: !s.panels[k] } })),
  select: (id, additive = false) => {
    if (!id) { set({ selectedId: null, selectedIds: [] }); return; }
    if (!get().objects.some(o=>o.id===id)) return;
    const ids = additive ? get().selectedIds.includes(id) ? get().selectedIds.filter(x=>x!==id) : [...get().selectedIds,id] : [id];
    set({ selectedIds: ids, selectedId: ids.includes(id) ? id : ids.at(-1) ?? null });
  },
  selectMany: ids => { const selectedIds=[...new Set(ids)].filter(id=>get().objects.some(o=>o.id===id)); set({selectedIds,selectedId:selectedIds.at(-1)??null}); },
  applySelectionDelta: (ids, delta) => {
    const s=get(), affected=selectionIds(s.objects,ids), objects=transformObjects(s.objects,ids,delta);
    s.commit("TRANSFORM_SELECTION", {objects, relations:transformedRelations(s.relations,s.objects,affected,Math.cbrt(Math.abs(delta.determinant())))});
  },
  transformSelected: (position, rotation=[0,0,0], scale=1) => {
    if ([...position,...rotation,scale].some(n=>!Number.isFinite(n))||scale<=0) throw new Error("批量变换参数无效");
    const s=get(),center=selectionCenter(s.objects,s.selectedIds),pivot=new Vector3(...center);
    const delta=new Matrix4().makeTranslation(...position).multiply(new Matrix4().makeTranslation(...center))
      .multiply(new Matrix4().compose(new Vector3(),new Quaternion().setFromEuler(new Euler(...rotation)),new Vector3(scale,scale,scale)))
      .multiply(new Matrix4().makeTranslation(...pivot.negate().toArray() as Vec3));
    s.applySelectionDelta(s.selectedIds,delta);
  },
  removeSelected: () => {
    const s=get(),ids=new Set(s.selectedIds); if(!ids.size)return;
    if(s.objects.some(o=>ids.has(o.id)&&o.locked))throw new Error("选中集合包含锁定对象，请先解锁");
    const parts=new Set(s.objects.filter(o=>ids.has(o.id)).map(o=>o.partId));
    const objects=s.objects.filter(o=>!ids.has(o.id)).map(o=>o.parentId&&ids.has(o.parentId)?{...o,parentId:undefined,localTransform:undefined,version:(o.version??1)+1}:o);
    const relations=s.relations.filter(r=>!parts.has(r.parentPartId)&&!parts.has(r.childPartId));
    s.commit("DELETE_SELECTION",{objects,selectedIds:[],selectedId:null,relations,connectors:s.connectors.filter(c=>!parts.has(c.partId)),assemblies:rebuildAssemblies(objects,relations,s.assemblies)});
  },
  saveNamedVersion: async label => {
    if(get().recoveryAvailable)throw new Error("请先恢复有效项目");
    const snapshot=validateProject(get().snapshot()); await get().save(); return saveVersion(snapshot,label);
  },
  restoreVersion: async id => {
    const start=get(),entry=(await listVersions(start.projectId)).find(v=>v.id===id);
    if(!entry)throw new Error("历史版本不存在");
    const p=validateProject(entry.snapshot);
    if(get().projectId!==start.projectId)throw new Error("当前项目已切换");
    await get().saveNamedVersion(`恢复前 r${get().sceneRevision}`);
    if(get().projectId!==start.projectId)throw new Error("当前项目已切换");
    const revision=Math.max(get().sceneRevision,p.sceneRevision)+1;
    const tasks=p.tasks.map(t=>["preview","running","queued","uploading"].includes(t.state)?{...t,state:"conflicted" as const,message:"工程已恢复历史版本，请基于当前对象重新提交"}:t);
    set({...p,projectName:p.name,tasks,sceneRevision:revision,selectedId:null,selectedIds:[],past:[],future:[],cancelEpoch:get().cancelEpoch+1,cameraView:p.cameraView??get().cameraView,cameraViewEpoch:get().cameraViewEpoch+1,saveStatus:"dirty"});
    await get().save();
  },

  addObject: (o) => {
    if (get().objects.some(x => x.id === o.id)) return;
    get().commit("CREATE_OBJECT", { objects: [...get().objects, { version: 1, source: "manual", ...o }], selectedId: o.id });
  },
  removeObject: (id) => {
    const s = get(), o = s.objects.find(x => x.id === id);
    if (!o) return;
    if (o.locked) { s.toast("对象已锁定，请先解锁再删除", "warn"); return; }
    const objects = s.objects.filter(x => x.id !== id).map(x => x.parentId === id ? { ...x, parentId: undefined, localTransform: undefined, version: (x.version ?? 1) + 1 } : x);
    const relations = s.relations.filter(r => r.parentPartId !== o.partId && r.childPartId !== o.partId);
    get().commit("DELETE_OBJECT", {
      objects,
      selectedId: s.selectedId === id ? null : s.selectedId,
      connectors: s.connectors.filter(c => c.partId !== o.partId),
      relations,
      assemblies: rebuildAssemblies(objects, relations, s.assemblies),
    });
  },
  patchObject: (id, patch) => {
    const s = get(), o = s.objects.find(x => x.id === id);
    if (!o || (o.locked && patch.locked !== false && Object.keys(patch).some(key => key !== "visible")) || patch.id || patch.parentId || patch.partId) return;
    if (JSON.stringify(patch) === "{}") return;
    if(patch.color&&o.kind==="model"&&!o.material&&!patch.material)patch={...patch,material:{roughness:.34,metalness:.24,opacity:1,emissiveIntensity:.14}};
    get().commit("EDIT_OBJECT", { objects: s.objects.map(x => x.id === id ? { ...x, ...patch, version: (x.version ?? 1) + 1 } : x) });
  },
  setTransform: (id, t) => {
    const s = get(), o = s.objects.find(x => x.id === id);
    if (!o || o.locked) return;
    const affected = descendants(s.objects, id);
    if (s.objects.some(x => affected.has(x.id) && x.locked)) { s.toast("子对象已锁定，请先解锁再整体变换", "warn"); return; }
    const transform = { ...o.transform, ...t };
    if (Object.values(transform).some(v => v.some(n => !Number.isFinite(n))) || transform.scale.some(n => n <= 0 || n > 1000)) { s.toast("变换无效：请输入有限数值和正缩放", "warn"); return; }
    if (JSON.stringify(transform) === JSON.stringify(o.transform)) return;
    const scaleRatios = transform.scale.map((v, i) => v / o.transform.scale[i]);
    if(s.selectedIds.length>1&&s.selectedIds.includes(id)) {
      if(Math.max(...scaleRatios)-Math.min(...scaleRatios)>1e-6){s.toast("多选变换仅支持等比缩放","warn");return;}
      try{s.applySelectionDelta(s.selectedIds,matrix(transform).multiply(matrix(o.transform).invert()));}catch(e){s.toast((e as Error).message,"warn");}return;
    }
    if (affected.size > 1 && Math.max(...scaleRatios) - Math.min(...scaleRatios) > 1e-6) { s.toast("带子对象的层级仅支持等比缩放，避免产生剪切变形", "warn"); return; }
    try {
      get().commit("TRANSFORM", { objects: moveHierarchy(s.objects, id, transform), relations: transformedRelations(s.relations,s.objects,affected,scaleRatios[0]) });
    } catch (e) { s.toast((e as Error).message, "warn"); }
  },
  duplicateObject: (id) => {
    const src = get().objects.find((o) => o.id === id);
    if (!src) return;
    const copy: SceneObject = {
      ...src,
      id: uid(),
      partId: src.partId ? uid() : undefined,
      parentId: undefined, localTransform: undefined, version: 1,
      locked: false,
      name: `${src.name} 副本`,
      transform: {
        position: [src.transform.position[0] + 0.6, src.transform.position[1], src.transform.position[2]] as Vec3,
        rotation: [...src.transform.rotation] as Vec3,
        scale: [...src.transform.scale] as Vec3,
      },
      createdAt: Date.now(),
    };
    get().commit("DUPLICATE", { objects: [...get().objects, copy], selectedId: copy.id });
  },
  clearScene: () => {
    get().commit("CLEAR_SCENE", { objects: [], selectedId: null, assemblies: [], connectors: [], relations: [] });
  },

  updateSettings: (patch) => {
    if (patch.mirror !== undefined && patch.mirror !== get().settings.mirror) patch = { ...patch, calibration: null };
    set((s) => ({ settings: { ...s.settings, ...patch }, sceneRevision: s.sceneRevision + 1, saveStatus: "dirty" }));
    scheduleSave();
  },

  addTask: (t) => { set((s) => ({ tasks: [t, ...s.tasks].slice(0, 100), saveStatus: "dirty" })); scheduleSave(); },
  patchTask: (id, patch) =>
    { recorder.event("AITaskEvent", { taskId: id, sceneRevision: get().sceneRevision, status: patch.state, message: patch.message }); set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)), saveStatus: "dirty" })); scheduleSave(); },
  removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

  addAsset: (a) => {
    set((s) => ({ assets: [a, ...s.assets.filter((x) => x.id !== a.id)].slice(0, 40) }));
    scheduleSave();
  },
  removeAsset: (id) => {
    if (get().objects.some(o => o.assetId === id) || get().past.some(p => p.objects.some(o => o.assetId === id)) || get().tasks.some(t => t.candidate?.assetId === id)) { get().toast("资产仍被作品、任务或撤销记录引用", "warn"); return; }
    // Keep bytes for saved versions; removing the catalog entry must not corrupt history.
    set((s) => ({ assets: s.assets.filter((a) => a.id !== id) }));
    scheduleSave();
  },

  toast: (text, kind = "info") => {
    const t: Toast = { id: uid(), text, kind, t: Date.now() };
    set((s) => ({ toasts: [...s.toasts, t].slice(-4) }));
    setTimeout(() => get().dismiss(t.id), 4200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setHud: (patch) => set((s) => ({ hud: { ...s.hud, ...patch } })),
  setBooted: (booted) => set({ booted }),
  setCameraReady: (cameraReady) => set(s => cameraReady === s.cameraReady ? s : {
    cameraReady,
    panels: { ...s.panels, rail: !cameraReady, inspector: !cameraReady },
  }),

  convertToPart: id => {
    const s = get(), o = s.objects.find(o => o.id === id);
    if (!o || o.partId || o.locked) return;
    s.commit("CONVERT_PART", { objects: s.objects.map(x => x.id === id ? { ...x, partId: uid(), version: (x.version ?? 1) + 1 } : x) });
  },
  replacePart: (targetId, sourceId) => {
    const s = get(), target = s.objects.find(o => o.id === targetId), source = s.objects.find(o => o.id === sourceId);
    if (!target?.partId || !source || target.locked || source.id === target.id) throw new Error("请选择未锁定的目标零件和不同的替换来源");
    const replacement = { ...source, id: target.id, partId: target.partId, parentId: target.parentId, localTransform: target.localTransform, name: target.name,
      transform: target.transform, locked: target.locked, visible: target.visible, version: (target.version ?? 1) + 1, sourceObjectIds: [source.id] };
    s.commit("REPLACE_PART", { objects: s.objects.map(o => o.id === targetId ? replacement : o),
      relations: s.relations.map(r => r.parentPartId === target.partId || r.childPartId === target.partId ? { ...r, status: "broken" } : r) });
  },
  reparent: (id, parentId) => {
    const s = get(), o = s.objects.find(o => o.id === id), parent = s.objects.find(o => o.id === parentId);
    if (!o || o.locked || (parentId && (!parent || descendants(s.objects, id).has(parentId)))) { s.toast("无法建立循环层级或修改锁定对象", "warn"); return; }
    try {
      s.commit("REPARENT", { objects: s.objects.map(x => x.id === id ? { ...x, parentId, localTransform: parent ? localTransform(parent.transform, x.transform) : undefined, version: (x.version ?? 1) + 1 } : x),
        relations: s.relations.map(r => r.childPartId === o.partId ? { ...r, status: "broken" } : r) });
    } catch (e) { s.toast((e as Error).message, "warn"); }
  },
  addConnector: (id, position, rotation = [0, 0, 0]) => {
    const s = get(), o = s.objects.find(o => o.id === id);
    if (!o?.partId || o.locked || [...position, ...rotation].some(n => !Number.isFinite(n))) return;
    s.commit("ADD_CONNECTOR", { connectors: [...s.connectors, { id: uid(), partId: o.partId, name: `连接点 ${s.connectors.filter(c => c.partId === o.partId).length + 1}`, position, rotation, axis: [0, 1, 0] }] });
  },
  connect: (aId, bId, type="fixed", limits={min:-Math.PI/2,max:Math.PI/2}) => {
    const s = get(), a = s.connectors.find(c => c.id === aId), b = s.connectors.find(c => c.id === bId);
    if (!a || !b || a.partId === b.partId) throw new Error("请选择不同零件上的两个连接点");
    const parent = s.objects.find(o => o.partId === a.partId)!, child = s.objects.find(o => o.partId === b.partId)!;
    const moving = descendants(s.objects, child.id);
    if (parent.locked || s.objects.some(o => moving.has(o.id) && o.locked) || moving.has(parent.id)) throw new Error("连接会造成循环或修改锁定零件");
    if(type!=="fixed"&&(!Number.isFinite(limits.min)||!Number.isFinite(limits.max)||limits.min>0||limits.max<0||limits.min>=limits.max))throw new Error("关节限位须包含零位且最小值小于最大值");
    const existing=s.relations.filter(r=>r.status!=="suppressed"&&r.childPartId===child.partId);
    if (s.relations.some(r => r.status !== "suppressed" && (r.parentConnectorId === aId || r.childConnectorId === aId || r.parentConnectorId === bId || r.childConnectorId === bId))||existing.some(r=>r.parentPartId!==parent.partId||r.type!=="fixed"||type!=="fixed"||r.status!=="valid")) throw new Error("连接点已占用，或子零件已有不兼容的约束，请先拆卸");
    const transform = alignedTransform(parent, child, a, b);
    if(existing.length){
      const probe=s.objects.map(o=>o.id===child.id?{...o,transform}:o);
      if(existing.some(r=>{const e=connectionError(probe,s.connectors,r);return e.position>1e-4||e.angle>.01;}))throw new Error("多连接点约束冲突：新对齐会破坏现有固定连接");
    }
    const objects = moveHierarchy(s.objects, child.id, transform).map(o => o.id === child.id ? { ...o, parentId: parent.id, localTransform: localTransform(parent.transform, transform) } : o);
    const merged = s.assemblies.filter(g => g.partIds.includes(a.partId) || g.partIds.includes(b.partId));
    const partIds = [...new Set([a.partId, b.partId, ...merged.flatMap(g => g.partIds)])];
    const assembly: Assembly = { id: merged[0]?.id ?? uid(), name: merged[0]?.name ?? `装配体 ${s.assemblies.length + 1}`, rootPartId: merged.find(g => g.partIds.includes(a.partId))?.rootPartId ?? a.partId, partIds, transform: merged[0]?.transform ?? identityTransform(), version: (merged[0]?.version ?? 0) + 1 };
    s.commit("CONNECT_JOINT", { objects, relations: [...s.relations, { id: uid(), parentPartId: a.partId, childPartId: b.partId, parentConnectorId: a.id, childConnectorId: b.id, type, limits:type==="fixed"?undefined:{...limits,value:0}, status: "valid" }], assemblies: [...s.assemblies.filter(g => !merged.includes(g)), assembly] });
  },
  setJointValue: (id,value) => {
    const s=get(),r=s.relations.find(r=>r.id===id);
    if(!r||r.type==="fixed"||r.status!=="valid"||!r.limits||!Number.isFinite(value))throw new Error("请选择有效的铰接或滑动关系");
    const parent=s.objects.find(o=>o.partId===r.parentPartId)!,child=s.objects.find(o=>o.partId===r.childPartId)!,affected=descendants(s.objects,child.id);
    if(parent.locked||s.objects.some(o=>affected.has(o.id)&&o.locked))throw new Error("关联零件已锁定");
    const next=Math.max(r.limits.min,Math.min(r.limits.max,value));if(next===r.limits.value)return;
    const transform=jointTransform(parent,child,s.connectors.find(c=>c.id===r.parentConnectorId)!,s.connectors.find(c=>c.id===r.childConnectorId)!,r.type,next);
    s.commit("MOVE_JOINT",{objects:moveHierarchy(s.objects,child.id,transform),relations:s.relations.map(x=>x.id===id?{...x,limits:{...r.limits!,value:next}}:x)});
  },
  detach: id => {
    const s = get(), r = s.relations.find(r => r.id === id);
    if (!r) return;
    const relations = s.relations.map(x => x.id === id ? { ...x, status: "suppressed" as const } : x);
    const stillAttached=relations.some(x=>x.id!==r.id&&x.status!=="suppressed"&&x.childPartId===r.childPartId);
    const objects = s.objects.map(o => o.partId === r.childPartId&&!stillAttached ? { ...o, parentId: undefined, localTransform: undefined, version: (o.version ?? 1) + 1 } : o);
    s.commit("DETACH", { relations, objects, assemblies: rebuildAssemblies(objects, relations, s.assemblies) });
  },
  transformAssembly: (id, transform) => {
    const s = get(), a = s.assemblies.find(a => a.id === id);
    if (!a) return;
    const affected = new Set(s.objects.filter(o => a.partIds.includes(o.partId ?? "")).flatMap(o => [...descendants(s.objects, o.id)]));
    if (s.objects.some(o => affected.has(o.id) && o.locked)) throw new Error("请先解锁装配体内的零件及其子对象");
    if (Object.values(transform).some(v => v.some((n: number) => !Number.isFinite(n))) || transform.scale.some(n => n <= 0 || n > 1000) || Math.max(...transform.scale) - Math.min(...transform.scale) > 1e-6) throw new Error("装配体缩放须为有限正数且各轴一致");
    const delta = matrix(transform).multiply(matrix(a.transform).invert());
    const moved = s.objects.map(o => affected.has(o.id) ? { ...o, transform: fromMatrix(delta.clone().multiply(matrix(o.transform))), version: (o.version ?? 1) + 1 } : o);
    const objects = moved.map(o => affected.has(o.id) && o.parentId && !affected.has(o.parentId) ? { ...o, localTransform: localTransform(moved.find(p => p.id === o.parentId)!.transform, o.transform) } : o);
    s.commit("TRANSFORM_ASSEMBLY", { objects, relations:transformedRelations(s.relations,s.objects,affected,Math.cbrt(Math.abs(delta.determinant()))), assemblies: s.assemblies.map(g => g.id === id ? { ...g, transform, version: g.version + 1 } : g) });
  },
  acceptTask: id => {
    const s = get(), t = s.tasks.find(t => t.id === id);
    if (!t?.candidate || t.state !== "preview" || t.projectId !== s.projectId || t.acceptedObjectId || s.objects.some(o => o.sourceTaskId === id)) return false;
    const target = s.objects.find(o => o.id === t.targetObjectId);
    const replacing = ["REPLACE_OBJECT","MODIFY_OBJECT","MODIFY_REGION"].includes(t.taskType??"");
    if (replacing && (!target || target.locked || (target.version ?? 1) !== t.targetObjectVersion)) {
      s.patchTask(id, { state: "conflicted", message: "目标版本已改变，请基于最新对象重新生成" }); return false;
    }
    if(t.localOperation==="transform"&&target&&descendants(s.objects,target.id).size>1){s.patchTask(id,{state:"conflicted",message:"目标含子对象，请使用层级整体变换"});return false;}
    const candidate = replacing ? { ...t.candidate, id: target!.id, partId: target!.partId, parentId: target!.parentId,
      localTransform: t.localOperation==="transform"&&target!.parentId?localTransform(s.objects.find(o=>o.id===target!.parentId)!.transform,t.candidate.transform):target!.localTransform,
      transform: t.localOperation==="transform"?t.candidate.transform:target!.transform, version: (target!.version ?? 1) + 1 } : t.candidate;
    validateProject({...s.snapshot(),objects:replacing?s.objects.map(o=>o.id===target!.id?candidate:o):[...s.objects,candidate]});
    s.commit("AI_ACCEPT", { objects: replacing ? s.objects.map(o => o.id === target!.id ? candidate : o) : [...s.objects, candidate], selectedId: candidate.id,
      relations: replacing && t.localOperation!=="material" && t.localOperation!=="region" ? s.relations.map(r => r.parentPartId === target!.partId || r.childPartId === target!.partId ? { ...r, status: "broken" } : r) : s.relations });
    s.patchTask(id, { state: "accepted", acceptedObjectId: candidate.id, message: "已接受，可继续编辑" }); return true;
  },
  rejectTask: id => get().patchTask(id, { state: "rejected", message: "已拒绝，场景未变更" }),
  snapshot: () => {
    const s = get();
    return { version: 2, projectId: s.projectId, name: s.projectName, sceneRevision: s.sceneRevision,
      objects: s.objects, settings: s.settings, assets: s.assets, tasks: s.tasks, connectors: s.connectors, relations: s.relations, assemblies: s.assemblies, cameraView: s.cameraView, savedAt: Date.now() };
  },

  hydrate: async () => {
    try {
      const saved = await idb.get<unknown>("project");
      if (saved) {
        const p = migrateProject(saved, defaultSettings);
        set({ ...p, selectedId:null, selectedIds:[], cameraView: p.cameraView ?? get().cameraView, cameraViewEpoch: get().cameraViewEpoch + 1, projectName: p.name, savedRevision: p.sceneRevision, past: [], future: [], saveStatus: "saved", recoveryAvailable: false, saveError: "" });
      }
    } catch (e) {
      set({ saveStatus: "error", saveError: `读取失败：${(e as Error).message}`, recoveryAvailable: true });
      get().toast("项目读取失败，已停止自动保存。可恢复上一有效快照", "err");
    }
  },

  save: async () => {
    clearTimeout(saveTimer);
    if (get().recoveryAvailable) throw new Error("请先恢复或打开有效项目，避免覆盖原数据");
    const captured = get();
    let snapshot: ProjectSnapshot;
    try { snapshot = validateProject(captured.snapshot()); }
    catch (e) { set({ saveStatus: "error", saveError: `项目校验失败：${(e as Error).message}` }); throw e; }
    set({ saveStatus: "saving" });
    recorder.event("SaveStarted", { projectId: snapshot.projectId, sceneRevision: snapshot.sceneRevision });
    const operation = saveQueue.catch(() => {}).then(() => idb.saveProject(snapshot));
    saveQueue = operation;
    try { await operation;
      const now = get();
      if (now.projectId !== captured.projectId || now.recoveryAvailable) return;
      const unchanged = now.sceneRevision === captured.sceneRevision && now.tasks === captured.tasks && now.assets === captured.assets && now.projectName === captured.projectName && now.cameraView === captured.cameraView;
      set({ savedRevision: snapshot.sceneRevision, saveStatus: unchanged ? "saved" : "dirty", saveError: "" });
      recorder.event("SaveCommitted", { projectId: snapshot.projectId, sceneRevision: snapshot.sceneRevision });
    }
    catch (e) { if (get().projectId === captured.projectId && !get().recoveryAvailable) set({ saveStatus: "error", saveError: (e as Error).message }); throw e; }
  },

  saveProjectFile: async () => {
    const p = validateProject(get().snapshot());
    const embeddedAssets: Record<string, string> = {};
    const refs = new Set([...p.objects.map(o => o.assetId), ...p.assets.map(a => a.id), ...p.tasks.map(t => t.candidate?.assetId)].filter(Boolean) as string[]);
    for (const ref of refs) {
      const blob = await idb.getAsset(ref);
      if (!blob) throw new Error(`资产缺失：${ref}，无法导出完整项目`);
      embeddedAssets[ref] = await blobToBase64(blob);
    }
    downloadBlob(new Blob([JSON.stringify({ ...p, embeddedAssets })], { type: "application/json" }), `aether-${Date.now()}.aether.json`);
  },
  openProjectFile: async file => {
    if (file.size > 250 * 1024 * 1024) throw new Error("项目超过 250 MB 限制");
    const input = JSON.parse(await file.text());
    const p = migrateProject(input, defaultSettings);
    const embedded = input.embeddedAssets ?? {};
    const remap = new Map<string, string>();
    for (const ref of new Set([...p.objects.map(o => o.assetId), ...p.assets.map(a => a.id), ...p.tasks.map(t => t.candidate?.assetId)].filter(Boolean) as string[])) {
      const blob = typeof embedded[ref] === "string" ? base64ToBlob(embedded[ref]) : await idb.getAsset(ref);
      if (!blob) throw new Error(`项目缺少模型资产：${ref}`);
      const { parseGlb, disposeObject } = await import("./lib/glb");
      const model = await parseGlb(await blob.arrayBuffer()); disposeObject(model);
      const key = `project_${uid()}`;
      await idb.putAsset(key, blob); remap.set(ref, key);
    }
    const replaceRef = (o: SceneObject) => o.assetId ? { ...o, assetId: remap.get(o.assetId) ?? o.assetId } : o;
    p.objects = p.objects.map(replaceRef);
    p.tasks = p.tasks.map(t => ({ ...t, candidate: t.candidate ? replaceRef(t.candidate) : undefined, assetId: t.assetId ? remap.get(t.assetId) ?? t.assetId : undefined }));
    p.assets = p.assets.map(a => ({ ...a, id: remap.get(a.id) ?? a.id }));
    // Preserve current project before replacing it; commit storage before swapping the view.
    if (get().objects.length && !get().recoveryAvailable) await get().save();
    await idb.saveProject(p);
    set({ ...p, cameraView: p.cameraView ?? { position: [0, 1.6, 4.8], target: [0, 0.9, 0] }, cameraViewEpoch: get().cameraViewEpoch + 1, projectName: p.name, selectedId: null, selectedIds: [], past: [], future: [], saveStatus: "saved", savedRevision: p.sceneRevision, recoveryAvailable: false, saveError: "", cancelEpoch: get().cancelEpoch + 1 });
  },
  restoreBackup: async () => {
    clearTimeout(saveTimer);
    const wasRecovering = get().recoveryAvailable;
    set({ recoveryAvailable: true, saveStatus: "saving" });
    try {
    // Finish earlier transactions before reading the backup; prohibit new autosaves during recovery.
    await saveQueue.catch(() => {});
    const backup = await idb.get<unknown>("project:backup");
    const p = migrateProject(backup, defaultSettings);
    const damaged = await idb.get("project");
    await idb.set(`project:diagnostic:${Date.now()}`, damaged);
    await idb.set("project", p);
    set({ ...p, cameraView: p.cameraView ?? { position: [0, 1.6, 4.8], target: [0, 0.9, 0] }, cameraViewEpoch: get().cameraViewEpoch + 1, projectName: p.name, selectedId: null, selectedIds: [], past: [], future: [], saveStatus: "saved", savedRevision: p.sceneRevision, recoveryAvailable: false, saveError: "", cancelEpoch: get().cancelEpoch + 1 });
    } catch (e) {
      set({ saveStatus: "error", saveError: (e as Error).message, recoveryAvailable: wasRecovering });
      throw e;
    }
  },
}));

/** 低频同步手部派生量到 React，避免 60fps 重渲染 */
export function startHudSync() {
  let raf = 0;
  let fpsAcc = 0;
  let fpsFrames = 0;
  let last = performance.now();
  let shownFps = 0;
  let lastPublished = 0;
  const tick = () => {
    const now = performance.now();
    fpsAcc += now - last;
    last = now;
    fpsFrames++;
    if (fpsAcc >= 500) {
      shownFps = Math.round((fpsFrames * 1000) / fpsAcc);
      fpsAcc = 0;
      fpsFrames = 0;
    }
    if(now-lastPublished<200){raf=requestAnimationFrame(tick);return;}
    lastPublished=now;
    const s = useApp.getState();
    const next: Hud = {
      gesture: handState.gesture,
      hands: handState.hands.length,
      handFps: handState.fps,
      renderFps: shownFps,
      pointerActive: handState.status === "ready" || handState.mouseMode,
    };
    const cur = s.hud;
    if (
      cur.gesture !== next.gesture ||
      cur.hands !== next.hands ||
      cur.handFps !== next.handFps ||
      cur.renderFps !== next.renderFps ||
      cur.pointerActive !== next.pointerActive
    ) {
      s.setHud(next);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

export function makeObject(kind: SceneObject["kind"], name: string, extra: Partial<SceneObject> = {}): SceneObject {
  return {
    id: uid(),
    kind,
    name,
    transform: { position: [0, 0.6, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    locked: false,
    color: "#7cf7e3",
    version: 1,
    source: kind === "stroke" ? "stroke" : "manual",
    createdAt: Date.now(),
    ...extra,
  };
}
