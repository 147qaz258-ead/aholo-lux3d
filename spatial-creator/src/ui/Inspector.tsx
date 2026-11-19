import { useApp, makeObject } from "../store";
import type { PrimitiveType, SceneObject, Vec3 } from "../types";
import { clearSculpt } from "../lib/deformation";
import { SAMPLES, loadSample } from "../lib/samples";
import { idb } from "../lib/idb";
import { objectRegistry } from "../scene/runtime";
import { IconEye, IconEyeOff, IconLock, IconPlus, IconTrash, IconUndo, IconUnlock } from "./Icons";
import { useState } from "react";
import { AssetPreview } from "./AssetPreview";
import { disposeObject, parseGlb } from "../lib/glb";
import { AssemblyPanel } from "./AssemblyPanel";
import { StrokeEditor } from "./StrokeEditor";
import { SelectionControls } from "./SelectionControls";
import { MaterialEditor } from "./MaterialEditor";
import { importGeometry } from "../lib/interchange";
import { SceneCommandPanel } from "./SceneCommandPanel";

const PRIMS: { type: PrimitiveType; label: string; params: Record<string, number>; color: string }[] = [
  { type: "box", label: "立方体", params: { w: 0.6, h: 0.6, d: 0.6 }, color: "#7cf7e3" },
  { type: "sphere", label: "球体", params: { r: 0.4 }, color: "#8fb4ff" },
  { type: "cylinder", label: "圆柱", params: { rt: 0.3, rb: 0.3, h: 0.8 }, color: "#c79cff" },
  { type: "cone", label: "圆锥", params: { r: 0.34, h: 0.8 }, color: "#ffd28f" },
  { type: "torus", label: "圆环", params: { r: 0.34, tube: 0.1 }, color: "#8ef0ff" },
];

/** 预设色：色板是为了让"只用手"也能改颜色——原生取色器是系统弹窗，手势打不开 */
const SWATCHES = ["#7cf7e3", "#8fb4ff", "#c79cff", "#ffd28f", "#ff8fa3", "#8ef0ff", "#b06bff", "#e9f4f9"];

function Num({ value, onChange, step = 0.1 }: { value: number; onChange: (v: number) => void; step?: number }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      className="num"
      value={text ?? (Math.round(value * 100) / 100).toString()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = parseFloat(text ?? "");
        if (!Number.isNaN(v)) onChange(v);
        setText(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "ArrowUp") {
          e.preventDefault();
          onChange(value + step);
          setText(null);
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          onChange(value - step);
          setText(null);
        }
      }}
      inputMode="decimal"
    />
  );
}

function VecRow({
  label,
  value,
  onChange,
  step = 0.05,
}: {
  label: string;
  value: Vec3;
  onChange: (v: Vec3) => void;
  step?: number;
}) {
  return (
    <div className="row">
      <div className="k">{label}</div>
      <div className="v">
        {[0, 1, 2].map((i) => (
          <Num
            key={i}
            value={value[i]}
            step={step}
            onChange={(v) => {
              const next = [...value] as Vec3;
              next[i] = v;
              onChange(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function Inspector() {
  const objects = useApp((s) => s.objects);
  const selectedId = useApp((s) => s.selectedId);
  const selectedIds = useApp((s) => s.selectedIds);
  const select = useApp((s) => s.select);
  const addObject = useApp((s) => s.addObject);
  const setTransform = useApp((s) => s.setTransform);
  const patchObject = useApp((s) => s.patchObject);
  const removeObject = useApp((s) => s.removeObject);
  const duplicate = useApp((s) => s.duplicateObject);
  const toast = useApp((s) => s.toast);
  const sculptMode = useApp((s) => s.sculptMode);
  const setSculptMode = useApp((s) => s.setSculptMode);
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const [importing, setImporting] = useState<SceneObject | null>(null);
  const undo = useApp(s => s.undo), redo = useApp(s => s.redo);

  const sel = objects.find((o) => o.id === selectedId) || null;

  const addPrim = (p: (typeof PRIMS)[number]) => {
    const idx = objects.length;
    // 让几何体落在网格面上，而不是悬空
    const h =
      p.type === "sphere"
        ? (p.params.r ?? 0.4) * 2
        : p.type === "torus"
          ? (p.params.tube ?? 0.1) * 2
          : (p.params.h ?? 0.6);
    const obj: SceneObject = makeObject("primitive", p.label, {
      primitive: { type: p.type, params: p.params },
      color: p.color,
      transform: {
        position: [((idx % 3) - 1) * 0.9, h / 2 + 0.01, ((idx % 2) - 0.5) * 0.6] as Vec3,
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    });
    addObject(obj);
  };

  /** MODEL-002：把本地 GLB/GLTF 作为对象导入（资产落 IndexedDB，与 AI 生成物走同一路径） */
  const importGlb = async (f: File) => {
    if (!/\.(glb|gltf|obj|stl)$/i.test(f.name)) {
      toast("支持 GLB、glTF、OBJ、STL", "warn");
      return;
    }
    if (f.size > 60 * 1024 * 1024) {
      toast("文件超过 60MB，请简化后重试", "warn"); return;
    }
    try {
      const assetId = `asset_import_${Date.now().toString(36)}`;
      const buffer = await importGeometry(f);
      const checked = await parseGlb(buffer); disposeObject(checked);
      await idb.putAsset(assetId, new Blob([buffer], { type: "model/gltf-binary" }));
      const n = objects.length;
      setImporting(
        makeObject("model", f.name.replace(/\.(glb|gltf|obj|stl)$/i, ""), {
          assetId,
          source: "import",
          color: "#8ef0ff",
          transform: {
            position: [((n % 2) * 1.1) - 0.55, 0.72, ((n % 3) - 1) * 0.4] as Vec3,
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
        }),
      );
      toast(`已校验 ${f.name}，请确认导入预览`, "ok");
    } catch (e) {
      toast(`导入失败：${(e as Error).message}`, "err");
    }
  };

  return (
    <aside className="panel inspector">
      <div className="panel-head">
        <span className="panel-title">Inspector</span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim-2)" }}>
          {objects.length} OBJ
        </span>
      </div>

      <div className="inspector-scroll" data-hand-scroll>
        <div className="section">
          <div className="section-label">创建基础几何体</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {PRIMS.map((p) => (
              <button key={p.type} className="btn sm" onClick={() => addPrim(p)}>
                {p.label}
              </button>
            ))}
          </div>
          <button
            className="btn sm"
            style={{ width: "100%", marginTop: 6 }}
            onClick={() => {
              void loadSample(SAMPLES[0]).catch((e) => toast(`示例载入失败：${(e as Error).message}`, "err"));
            }}
          >
            载入示例 · 文生3D 陶瓷椅
          </button>
          <button
            className="btn sm"
            style={{ width: "100%", marginTop: 4 }}
            onClick={() => {
              void loadSample(SAMPLES[1]).catch((e) => toast(`示例载入失败：${(e as Error).message}`, "err"));
            }}
          >
            载入示例 · 图生3D 青瓷
          </button>
          <label
            className="btn sm"
            style={{ width: "100%", marginTop: 4, display: "block", textAlign: "center", cursor: "pointer" }}
            title="浏览器不允许非真实点击打开文件框，这一项需要鼠标"
          >
            导入 GLB / OBJ / STL（需鼠标）
            <input
              type="file"
              accept=".glb,.gltf,.obj,.stl"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void importGlb(f);
              }}
            />
          </label>
        </div>

        <div className="section">
          <div className="section-label">场景对象</div>
          <SelectionControls />
          <div className="obj-list">
            {objects.length === 0 && (
              <div style={{ fontSize: 11, color: "var(--dim-2)", lineHeight: 1.7 }}>
                还没有对象。用「绘制」在空中画线，或用「生成」让 Lux3D 造一个模型。
              </div>
            )}
            {objects.map((o) => (
              <button
                key={o.id}
                className={`obj-item ${selectedIds.includes(o.id) ? "active" : ""}`}
                aria-pressed={selectedIds.includes(o.id)}
                onClick={(e) => select(o.id,e.ctrlKey||e.metaKey||e.shiftKey)}
                data-hand-hit
                data-hand-label={o.name}
              >
                <span className={`kind ${o.kind}`} />
                <span className="nm" style={{ opacity: o.visible ? 1 : 0.45 }}>
                  {o.parentId ? "↳ " : ""}{o.partId ? "[零件] " : ""}
                  {o.name}
                </span>
                <span
                  className={`mini ${o.visible ? "" : "off"}`}
                  title={o.visible ? "隐藏" : "显示"}
                  data-hand-hit
                  data-hand-label={o.visible ? "隐藏对象" : "显示对象"}
                  onClick={(e) => {
                    e.stopPropagation();
                    patchObject(o.id, { visible: !o.visible });
                  }}
                >
                  {o.visible ? <IconEye size={12} /> : <IconEyeOff size={12} />}
                </span>
                <span
                  className={`mini ${o.locked ? "on" : ""}`}
                  title={o.locked ? "解锁（当前不可移动/雕刻）" : "锁定"}
                  data-hand-hit
                  data-hand-label={o.locked ? "解锁" : "锁定"}
                  onClick={(e) => {
                    e.stopPropagation();
                    patchObject(o.id, { locked: !o.locked });
                  }}
                >
                  {o.locked ? <IconLock size={12} /> : <IconUnlock size={12} />}
                </span>
                <span
                  className="mini"
                  title="删除"
                  data-hand-hit
                  data-hand-label="删除对象"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeObject(o.id);
                  }}
                >
                  <IconTrash size={12} />
                </span>
              </button>
            ))}
          </div>
        </div>

        {sel && (
          <div className="section">
            <div className="section-label">对象属性 · {sel.kind}</div>
            <p className="caption-5">来源：{{ manual: "手工创建", stroke: "空间绘制", ai: "AI 生成", import: "外部导入" }[sel.source ?? "manual"]} · v{sel.version ?? 1}{sel.sourceTaskId ? ` · 任务 ${sel.sourceTaskId.slice(0,8)}` : ""}</p>
            <div className="row">
              <div className="k">名称</div>
              <div className="v">
                <input
                  className="num"
                  style={{ fontFamily: "var(--sans)" }}
                  value={sel.name}
                  onChange={(e) => patchObject(sel.id, { name: e.target.value })}
                />
              </div>
            </div>
            <VecRow
              label="位置"
              value={sel.transform.position}
              onChange={(v) => setTransform(sel.id, { position: v })}
            />
            <VecRow
              label="旋转°"
              step={5}
              value={sel.transform.rotation.map((r) => Math.round((r * 180) / Math.PI)) as Vec3}
              onChange={(v) =>
                setTransform(sel.id, { rotation: v.map((d) => (d * Math.PI) / 180) as Vec3 })
              }
            />
            <VecRow label="缩放" value={sel.transform.scale} onChange={(v) => setTransform(sel.id, { scale: v })} />
            <div className="row">
              <div className="k">颜色</div>
              <div className="v">
                <input
                  type="color"
                  value={sel.color}
                  onChange={(e) => patchObject(sel.id, { color: e.target.value })}
                  style={{ width: "100%", height: 24, background: "none", border: "1px solid var(--line)" }}
                />
              </div>
            </div>
            <div className="swatches">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  className={`swatch ${sel.color.toLowerCase() === c ? "on" : ""}`}
                  style={{ background: c }}
                  aria-label={`颜色 ${c}`}
                  title={`颜色 ${c}`}
                  data-hand-hit
                  data-hand-label={`颜色 ${c}`}
                  onClick={() => patchObject(sel.id, { color: c })}
                />
              ))}
            </div>
            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              <button className="btn sm" onClick={() => duplicate(sel.id)}>
                复制
              </button>
              <button
                className="btn sm"
                onClick={() => {
                  const o = objectRegistry.get(sel.id);
                  o?.traverse((c) => {
                    const m = c as unknown as { isMesh?: boolean; geometry?: unknown };
                    if (m.isMesh && m.geometry) clearSculpt(c as never);
                  });
                  patchObject(sel.id, { deformed: false, geometryEdits: {} });
                  toast("已重置该对象的形变", "ok");
                }}
              >
                重置形变
              </button>
              <button className="btn sm" onClick={() => removeObject(sel.id)}>
                删除
              </button>
            </div>
            <p className="caption-5">删除「{sel.name}」会解除其连接，直接子对象保留并移至根级。可用撤销恢复。</p>
          </div>
        )}

        {sel && <MaterialEditor key={sel.id} object={sel} />}
        <SceneCommandPanel />
        <AssemblyPanel />
        {sel?.kind === "stroke" && <StrokeEditor key={sel.id} stroke={sel} />}

        <div className="section">
          <div className="section-label">空间绘制平面</div>
          <select className="num" aria-label="绘制平面" value={settings.drawPlane} onChange={e => updateSettings({ drawPlane: e.target.value as typeof settings.drawPlane })}>
            <option value="camera">相机朝向平面（距离 3.2）</option><option value="xy">XY 平面</option><option value="xz">XZ 地面平面</option><option value="yz">YZ 侧面平面</option>
          </select>
          <div className="row"><div className="k">深度</div><Num value={settings.drawDepth} onChange={v => updateSettings({ drawDepth: v })} /></div>
          <label className="caption-5">轨迹平滑<input type="range" min="0" max="1" step="0.05" value={settings.strokeSmoothing} onChange={e => updateSettings({ strokeSmoothing: Number(e.target.value) })} /></label>
          {sel?.kind === "stroke" && <div className="row"><div className="k">粗细</div><Num value={sel.width ?? 0.011} step={0.002} onChange={v => { if (v > 0) patchObject(sel.id, { width: v }); }} /></div>}
          <p className="caption-5">本笔开始后平面保持固定。原始采样点单独保存，Esc 取消本笔。</p>
        </div>

        <div className="section">
          <div className="section-label">雕刻</div>
          <div className="seg" style={{ marginBottom: 8 }}>
            <button className={sculptMode === "dent" ? "on" : ""} onClick={() => setSculptMode("dent")}>
              按压凹陷
            </button>
            <button className={sculptMode === "stretch" ? "on" : ""} onClick={() => setSculptMode("stretch")}>
              拖动拉伸
            </button>
          </div>
          <div className="row">
            <div className="k">半径比</div>
            <div className="v">
              <input
                type="range"
                min={0.05}
                max={0.2}
                step={0.01}
                data-hand-label="雕刻半径"
                value={settings.sculptRadius}
                onChange={(e) => updateSettings({ sculptRadius: Number(e.target.value) })}
              />
            </div>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)", width: 30, textAlign: "right" }}>
              {settings.sculptRadius.toFixed(2)}
            </span>
          </div>
          <div className="row">
            <div className="k">强度</div>
            <div className="v">
              <input
                type="range"
                min={0.2}
                max={2.5}
                step={0.05}
                data-hand-label="雕刻强度"
                value={settings.sculptStrength}
                onChange={(e) => updateSettings({ sculptStrength: Number(e.target.value) })}
              />
            </div>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)", width: 30, textAlign: "right" }}>
              {settings.sculptStrength.toFixed(2)}
            </span>
          </div>
          <button
            className="btn sm"
            style={{ width: "100%", marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            onClick={() => {
              if (undo()) toast("已撤销一次编辑", "ok");
              else toast("没有可撤销的编辑", "warn");
            }}
          >
            <IconUndo size={13} /> 撤销编辑 (Ctrl+Z)
          </button>
          <button
            className="btn sm"
            style={{ width: "100%", marginTop: 4 }}
            onClick={() => {
              if (redo()) toast("已重做一次编辑", "ok");
              else toast("没有可重做的编辑", "warn");
            }}
          >
            重做编辑 (Ctrl+Shift+Z)
          </button>
        </div>

        <div className="section">
          <div className="section-label">设置</div>
          <div className="row">
            <div className="k">镜像</div>
            <div className="v">
              <div className="seg">
                <button className={settings.mirror ? "on" : ""} onClick={() => updateSettings({ mirror: true })}>
                  开
                </button>
                <button className={!settings.mirror ? "on" : ""} onClick={() => updateSettings({ mirror: false })}>
                  关
                </button>
              </div>
            </div>
          </div>
          <div className="row">
            <div className="k">平滑</div>
            <div className="v">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                data-hand-label="平滑度"
                value={settings.smoothing}
                onChange={(e) => updateSettings({ smoothing: Number(e.target.value) })}
              />
            </div>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)", width: 30, textAlign: "right" }}>
              {settings.smoothing.toFixed(2)}
            </span>
          </div>
          <div className="row">
            <div className="k">握力</div>
            <div className="v">
              <input
                type="range"
                min={0.3}
                max={0.9}
                step={0.02}
                data-hand-label="握力阈值"
                value={settings.pinchSensitivity}
                onChange={(e) => updateSettings({ pinchSensitivity: Number(e.target.value) })}
              />
            </div>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim)", width: 30, textAlign: "right" }}>
              {settings.pinchSensitivity.toFixed(2)}
            </span>
          </div>
          <div className="row">
            <div className="k">网格</div>
            <div className="v">
              <div className="seg">
                <button className={settings.showGrid ? "on" : ""} onClick={() => updateSettings({ showGrid: true })}>
                  显示
                </button>
                <button className={!settings.showGrid ? "on" : ""} onClick={() => updateSettings({ showGrid: false })}>
                  隐藏
                </button>
              </div>
            </div>
          </div>
          <div style={{ fontSize: 10, color: "var(--dim-2)", lineHeight: 1.6, marginTop: 6 }}>
            {settings.calibration
              ? "已完成手部校准。若指针偏移，在左下角重新校准。"
              : "尚未校准：在左下角摄像头面板点「校准」，把食指在框内四角各停一下。"}
          </div>
        </div>

        <div className="section" style={{ borderBottom: "none" }}>
          <div className="section-label">快捷操作</div>
          <div style={{ fontSize: 10.5, color: "var(--dim)", lineHeight: 1.9 }}>
            <div>1 / 2 / 3 / 4 切换工具</div>
            <div>右键拖动旋转视角 · 滚轮缩放</div>
            <div>Delete 删除选中 · Esc 取消选择</div>
            <div>空格 暂停/恢复手部输入</div>
          </div>
        </div>
      </div>
      {importing?.assetId && <AssetPreview assetId={importing.assetId} title="模型导入预览" detail="将作为独立对象导入。尺寸统一为 1.2 场景单位，原始节点和材质随资产保留。" onAccept={() => { addObject(importing); setImporting(null); toast("模型已导入", "ok"); }} onReject={() => { void idb.delAsset(importing.assetId!); setImporting(null); }} />}
    </aside>
  );
}
