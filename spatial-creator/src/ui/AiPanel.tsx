import { useEffect, useRef, useState } from "react";
import { useApp, makeObject } from "../store";
import { createImgTo3D, createTextTo3D, downloadGlb, waitForTask } from "../lib/lux3dClient";
import { imageReference } from "../lib/images";
import { idb } from "../lib/idb";
import type { AiTask, AiTaskType, Vec3 } from "../types";
import { IconImage, IconMic } from "./Icons";
import { useDictation } from "./useDictation";
import { AssetPreview } from "./AssetPreview";
import { disposeObject, parseGlb } from "../lib/glb";
import { providerText, sceneContext, sketchImage } from "../lib/aiContext";

const STYLES = [
  { v: "photorealistic", l: "写实" },
  { v: "cyberpunk", l: "赛博" },
  { v: "fantasy", l: "奇想" },
  { v: "cartoon", l: "卡通" },
  { v: "hand_painted", l: "手绘" },
  { v: "glass", l: "玻璃" },
  { v: "anime", l: "动漫" },
];

/**
 * 预设描述：手势打不出字，但"生成"必须有一句描述。
 * 点一下即填入输入框，纯手势才能走完 描述 → 提交 → 模型入场景。
 */
const PRESETS = [
  { short: "珊瑚椅 · 发光", prompt: "悬浮的珊瑚质感椅子，边缘发光" },
  { short: "雪山地形", prompt: "低多边形雪山地形，冷色雾" },
  { short: "青瓷猫", prompt: "青瓷质感的猫，坐姿" },
  { short: "赛博街灯", prompt: "赛博朋克街灯，湿润地面反光" },
];

const uid = () => Math.random().toString(36).slice(2, 10);

export function AiPanel() {
  const tasks = useApp((s) => s.tasks);
  const addTask = useApp((s) => s.addTask);
  const patchTask = useApp((s) => s.patchTask);
  const addAsset = useApp((s) => s.addAsset);
  const addObject = useApp((s) => s.addObject);
  const toast = useApp((s) => s.toast);
  const tool = useApp((s) => s.tool);
  const visible = useApp((s) => s.panels.ai);
  const objects = useApp((s) => s.objects);
  const selectedId = useApp(s => s.selectedId);
  const [taskType, setTaskType] = useState<AiTaskType>("CREATE_OBJECT");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const activeTask = useRef<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("photorealistic");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const submitting = useRef(false);
  const [images, setImages] = useState<string[]>([]);
  const [references,setReferences]=useState<NonNullable<AiTask["references"]>>([]);
  const [referencePurpose,setReferencePurpose]=useState<NonNullable<AiTask["references"]>[number]["purpose"]>("appearance");
  const [dragging, setDragging] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dictation = useDictation(visible && !busy, prompt, setPrompt);

  useEffect(() => {
    if (tool === "ai" && visible) taRef.current?.focus();
  }, [tool, visible]);

  const placeNew = (name: string) => {
    const n = objects.length;
    if (n === 0) return { position: [0, 0.85, 0.2] as Vec3 };
    const col = ((n - 1) % 3) - 1;
    const row = Math.floor((n - 1) / 3);
    return { position: [col * 1.0, 0.85, 0.2 + row * -0.9] as Vec3 };
  };

  async function finish(taskLocalId: string, label: string, taskId: number, promptText: string) {
    const abort = new AbortController(); controller.current = abort; activeTask.current = taskLocalId;
    setWaiting(true);
    try {
      const urls = await waitForTask(taskId, (snap) => {
        patchTask(taskLocalId, {
          state: snap.status === 1 || snap.status === 3 ? "running" : "queued",
          message: snap.status === 1 ? "生成中" : "排队中",
        });
      }, 2000, 12 * 60 * 1000, abort.signal);
      abort.signal.throwIfAborted();
      patchTask(taskLocalId, { state: "running", message: "下载并校验模型" });
      const buf = await downloadGlb(urls[0]);
      abort.signal.throwIfAborted();
      const checked = await parseGlb(buf); disposeObject(checked);
      abort.signal.throwIfAborted();
      const task = useApp.getState().tasks.find(t => t.id === taskLocalId);
      if (!task || task.state === "cancelled" || task.projectId !== useApp.getState().projectId) return;
      const assetId = `asset_${taskId}`;
      await idb.putAsset(assetId, new Blob([buf], { type: "model/gltf-binary" }));
      addAsset({
        id: assetId,
        name: label,
        taskId,
        sourceUrl: urls[0],
        createdAt: Date.now(),
        bytes: buf.byteLength,
        prompt: promptText,
      });
      const candidate = makeObject("model", label, {
          assetId,
          source: "ai", sourceTaskId: taskLocalId,
          sourceObjectIds: task.targetObjectId ? [task.targetObjectId] : [],
          partId: task.taskType === "GENERATE_PART" ? crypto.randomUUID() : undefined,
          color: "#b06bff",
          transform: { ...placeNew(label), rotation: [0, 0, 0], scale: [1, 1, 1] },
        });
      patchTask(taskLocalId, { state: "preview", message: "结果待确认 · 归一化尺寸 1.2 场景单位", assetId, candidate, durationMs: Date.now() - task.createdAt });
      setPreviewId(taskLocalId);
      toast("模型已校验，预览后接受或拒绝", "ok");
    } catch (e) {
      if (abort.signal.aborted) { patchTask(taskLocalId, { state: "cancelled", message: "已停止等待；上游可能继续运行，可继续查询" }); return; }
      const msg = (e as Error).message || "生成失败";
      patchTask(taskLocalId, { state: msg.includes("超时") ? "timed_out" : "failed", message: msg });
      toast(msg, "err");
    } finally {
      setWaiting(false); controller.current = null;
    }
  }

  const taskInput = (id: string, label: string, mode: "text" | "image"): AiTask => {
    const st = useApp.getState(), target = st.objects.find(o => o.id === st.selectedId);
    if (taskType === "REPLACE_OBJECT" && (!target || target.locked)) throw new Error("替换任务需要选中一个未锁定对象");
    if (taskType === "CONTINUE_FROM_SKETCH" && target?.kind !== "stroke") throw new Error("请先选中要保留的草图");
    return { id, label, mode, state: "queued", progress: 0, createdAt: Date.now(), message: "提交任务", requestId: crypto.randomUUID(),
      projectId: st.projectId, sceneRevision: st.sceneRevision, taskType, targetObjectId: target?.id,
      targetObjectVersion: target?.version ?? 1, context: JSON.stringify(sceneContext(target?.id)), prompt: prompt.trim(), cost: "unknown",
      parentTaskId: st.tasks.find(t=>t.state==="accepted"&&t.acceptedObjectId===target?.id)?.id,
      references: mode==="image"?references.map(r=>({...r,purpose:referencePurpose})):undefined };
  };

  const runText = async () => {
    if (submitting.current) return;
    const p = prompt.trim();
    if (!p || p.length > 600) {
      toast(p ? "文字描述请控制在 600 字符以内" : "先描述你想要的物体", "warn");
      return;
    }
    const local = uid();
    const label = p.slice(0, 14);
    let input: AiTask;
    try { input = taskInput(local, label, "text"); } catch (e) { toast((e as Error).message, "warn"); return; }
    submitting.current = true; setBusy(true); addTask(input);
    try {
      const target = useApp.getState().objects.find(o => o.id === input.targetObjectId);
      const remotePrompt = providerText(p, JSON.parse(input.context!), input.taskType!);
      patchTask(local, { providerPrompt: taskType === "CONTINUE_FROM_SKETCH" ? undefined : remotePrompt });
      const { taskId } = taskType === "CONTINUE_FROM_SKETCH"
        ? await createImgTo3D([sketchImage(target!)], 200000, input.requestId)
        : await createTextTo3D(remotePrompt, style, 200000, input.requestId);
      patchTask(local, { taskId, state: "queued", message: `task ${taskId}` });
      await finish(local, label, taskId, p);
    } catch (e) {
      patchTask(local, { state: "failed", message: (e as Error).message });
      toast((e as Error).message, "err");
    } finally {
      submitting.current = false; setBusy(false);
    }
  };

  const runImage = async () => {
    if (submitting.current) return;
    if (!images.length) {
      fileRef.current?.click();
      return;
    }
    const local = uid();
    const label = `图生 3D · ${images.length} 图`;
    let input: AiTask;
    try { input = taskInput(local, label, "image"); } catch (e) { toast((e as Error).message, "warn"); return; }
    submitting.current = true; setBusy(true); addTask({ ...input, state: "uploading", message: "上传素材" });
    try {
      const { taskId } = await createImgTo3D(images, 200000, input.requestId);
      patchTask(local, { taskId, state: "queued", message: `task ${taskId}` });
      await finish(local, label, taskId, prompt || "(图生 3D)");
      setImages([]);
      setReferences([]);
    } catch (e) {
      patchTask(local, { state: "failed", message: (e as Error).message });
      toast((e as Error).message, "err");
    } finally {
      submitting.current = false; setBusy(false);
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const refs:NonNullable<AiTask["references"]>=[];
    try { for (const f of Array.from(files).slice(0,4)) refs.push({...await imageReference(f),purpose:referencePurpose}); }
    catch(e){toast((e as Error).message,"warn");return;}
    const arr=refs.map(r=>r.dataUrl);
    if (!arr.length) {
      toast("请选择 JPG / PNG 图片", "warn");
      return;
    }
    setImages(arr);
    setReferences(refs);
    toast(`已载入 ${arr.length} 张参考图，点击「图生 3D」提交`, "ok");
  };

  const stateLabel = (s: string) => ({ success: "完成", failed: "失败", running: "生成中", uploading: "上传中", preview: "待确认", accepted: "已接受", rejected: "已拒绝", cancelled: "已停止", conflicted: "版本冲突", timed_out: "等待超时", queued: "排队" }[s] ?? s);
  const preview = tasks.find(t => t.id === previewId && t.state === "preview");

  return (
    <section
      className="panel ai-panel"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void onFiles(e.dataTransfer.files);
      }}
    >
      <div className="panel-head">
        <span className="panel-title">Aholo Lux3D · 三维生成</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--dim-2)", fontFamily: "var(--mono)" }}>
          {images.length ? `${images.length} REF` : "TEXT → 3D"}
        </span>
      </div>

      <div className="ai-context caption-5">
        <select className="num" aria-label="AI 任务类型" value={taskType} disabled={busy} onChange={e => setTaskType(e.target.value as AiTaskType)}>
          <option value="CREATE_OBJECT">新增对象</option><option value="GENERATE_PART">生成零件</option><option value="REPLACE_OBJECT">替换选中对象</option><option value="CONTINUE_FROM_SKETCH">草图轮廓生成</option>
        </select>
        <span>上下文：{objects.find(o => o.id === selectedId)?.name ?? "未选择对象"}</span>
        {busy && <button className="btn sm" disabled={!waiting} onClick={() => controller.current?.abort()}>停止等待</button>}
        {(taskType === "CONTINUE_FROM_SKETCH" || taskType === "REPLACE_OBJECT") && <span>当前服务支持整体重新生成；草图按轮廓参考，图生服务不接收文字约束。</span>}
      </div>

      <div className="ai-input-wrap">
        <textarea
          ref={taRef}
          className="ai-input"
          aria-label="AI 建模描述"
          placeholder="描述你想生成的物体"
          maxLength={600}
          value={dictation.interim ?? prompt}
          readOnly={dictation.active}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (dictation.active && e.key === "Escape") { e.stopPropagation(); dictation.cancel(); }
            if (!dictation.active && e.key === "Enter" && (e.metaKey || e.ctrlKey)) void runText();
          }}
        />
        <div className="ai-side">
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="btn sm"
              style={{ width: 74, height: 26 }}
              data-hand-hit
              data-hand-label={`风格 ${STYLES.find((s) => s.v === style)?.l ?? ""}`}
              onClick={() => {
                const i = STYLES.findIndex((s) => s.v === style);
                const next = STYLES[(i + 1) % STYLES.length];
                setStyle(next.v);
              }}
            >
              风格 {STYLES.find((s) => s.v === style)?.l}
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn primary" disabled={busy || dictation.active} onClick={runText} data-hand-hit data-hand-label="文生 3D">
              文生 3D
            </button>
            <button
              className="btn"
              disabled={busy || dictation.active}
              onClick={runImage}
              title="上传图片后生成（选图需要鼠标）"
              aria-label="图生 3D（需鼠标选图）"
              data-hand-hit
              data-hand-label="图生 3D（需鼠标选图）"
            >
              <IconImage size={13} />
            </button>
            <button
              className={`btn dictation-button${dictation.active ? " active" : ""}`}
              disabled={busy || dictation.phase === "stopping"}
              title={dictation.active ? "停止听写" : "普通话语音输入"}
              aria-label={dictation.active ? "停止听写" : "语音输入"}
              onClick={dictation.active ? dictation.stop : dictation.start}
            ><IconMic size={16} /></button>
          </div>
        </div>
      </div>
      {(dictation.active || dictation.message) && <div className="dictation-status caption-5" role="status">
        <span>{dictation.message || (dictation.phase === "starting" ? "正在开启麦克风" : dictation.phase === "stopping" ? "正在完成听写" : "正在听写普通话")}</span>
        {dictation.active && <button className="btn sm" onClick={dictation.cancel}>取消听写</button>}
      </div>}

      {/* 预设短语只在「生成」工具下出现：它占 30px 高度，常驻会把画布下方挡掉，
          而它的作用也只是这一步——把手势用户送进生成流程 */}
      {tool === "ai" && !dictation.active && (
        <div className="ai-presets">
          {PRESETS.map((p) => (
            <button
              key={p.short}
              className="chip-btn"
              data-hand-hit
              data-hand-label={p.short}
              title={p.prompt}
              onClick={() => {
                setPrompt(p.prompt);
                toast("已填入描述，点「文生 3D」提交", "info");
              }}
            >
              {p.short}
            </button>
          ))}
        </div>
      )}

      {images.length > 0 && (
        <div style={{ display: "flex", gap: 6, padding: "0 10px 10px" }}>
          {images.map((src, i) => (
            <div key={i} style={{ position: "relative", width: 46, height: 46, border: "1px solid var(--line)" }}>
              <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <button
                aria-label={`移除参考图 ${i+1}`}
                onClick={() => {setImages(images.filter((_, j) => j !== i));setReferences(references.filter((_,j)=>j!==i));}}
                style={{ position: "absolute", right: -6, top: -6, color: "var(--err)", fontSize: 12 }}
              >
                ×
              </button>
            </div>
          ))}
          <select className="num" aria-label="参考图用途" value={referencePurpose} onChange={e=>setReferencePurpose(e.target.value as typeof referencePurpose)}><option value="appearance">外观参考</option><option value="outline">轮廓参考</option><option value="material">材质参考</option><option value="detail">细节参考</option></select>
          <span className="caption-5">用途记入任务；当前供应商按图片整体生成。</span>
          <button className="btn sm" style={{ alignSelf: "center" }} onClick={() => {setImages([]);setReferences([]);}}>
            清空
          </button>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="tasks" data-hand-scroll>
          {tasks.map((t) => (
            <div className="task" key={t.id}>
              <span className="lbl">{t.label}</span>
              <span className={`st ${t.state}`}>{stateLabel(t.state)}</span>
              {t.message && (
                <span style={{ fontSize: 9, color: "var(--dim-2)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.message}
                </span>
              )}
              {t.state === "preview" && t.assetId && <button className="btn sm" onClick={() => setPreviewId(t.id)}>预览</button>}
              {t.taskId && ["failed", "timed_out", "cancelled", "queued", "running"].includes(t.state) && !busy && <button className="btn sm" onClick={async () => { setBusy(true); try { await finish(t.id, t.label, t.taskId!, t.prompt ?? ""); } finally { setBusy(false); } }}>继续查询</button>}
            </div>
          ))}
        </div>
      )}

      {dragging && <div className="drop-hint">松手载入参考图</div>}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        style={{ display: "none" }}
        onChange={(e) => void onFiles(e.target.files)}
      />
      {preview?.assetId && <AssetPreview assetId={preview.assetId} title={preview.taskType === "REPLACE_OBJECT" ? "替换对象预览" : "生成结果预览"}
        compareTargetId={preview.taskType==="REPLACE_OBJECT"?preview.targetObjectId:undefined}
        detail={`${preview.label} · 放置位置 ${preview.candidate?.transform.position.join(", ")} · ${preview.taskType === "REPLACE_OBJECT" ? "仅替换绑定的目标对象，旧版本可撤销。" : "接受后新增一个对象。"} 模型已统一到 1.2 场景单位。`}
        onAccept={() => { const ok = useApp.getState().acceptTask(preview.id); if (ok) { setPreviewId(null); toast("结果已接受，可继续编辑", "ok"); } else toast("结果未写入：目标已改变或任务已处理", "warn"); }}
        onReject={() => { useApp.getState().rejectTask(preview.id); setPreviewId(null); }} />}
    </section>
  );
}
