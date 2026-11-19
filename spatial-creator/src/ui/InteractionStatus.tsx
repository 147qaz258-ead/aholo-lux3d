import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../store";
import { handPoseWindow, handState } from "../lib/handState";
import { HandFeedback, poseFor } from "../lib/handFeedback";
import { drawRuntime, gestureRuntime } from "../scene/runtime";

const TOOLS = { select: "选择对象", draw: "绘制", sculpt: "雕刻", ai: "AI 生成" };
const ACTIVE = {
  Grabbing: "已抓住 · 松开提交", Pressing: "塑形中 · 松开提交", Drawing: "绘制中 · 松开收笔",
  LostPending: "追踪暂断 · 操作已冻结", Lost: "追踪中断 · 请将手移回画面", Recovering: "正在恢复追踪",
};
const FINGER_LABELS = ["拇指", "食指", "中指", "无名指", "小指"];
const POSES = { none: "未检测到手", point: "食指指向", pinch: "指尖已捏合", open: "张掌", fist: "握拳", peace: "剪刀手", three: "三指", spread: "手部已识别" };
const CUES = {
  orbit: "移动手掌线性转动视角（双掌开合可缩放）。",
  panZoom: "双掌开合缩放，同向移动平移。",
  history: "剪刀手已识别，先停一下再横划。",
  "history-ready": "向左划撤销，向右划重做。",
  menu: "保持握拳，打开工具菜单。",
  focus: "保持三指静止，聚焦选中对象；未选中时显示全部。",
};
const READY = {
  select: "用食指指向对象，拇指与食指捏合抓起。",
  draw: "指向网格，拇指碰食指起笔，分开就收笔。鼠标也能画。",
  sculpt: "指向模型表面，捏合后按压或拖动塑形。",
  ai: "在下方输入描述或选择图片，先预览再加入场景。",
};
const CAMERA_OFF = { hint: "可用鼠标操作；开启摄像头后可使用手势。", pose: "摄像头未启用", mask: null };

export function InteractionStatus({ onHelp }: { onHelp: () => void }) {
  const s = useApp(useShallow(s => ({
    tool: s.tool, cameraReady: s.cameraReady, cancel: s.cancelInteraction, interaction: s.interaction,
    plane: s.settings.drawPlane, menu: Boolean(s.gestureMenu),
  })));
  const feedback = useRef(new HandFeedback());
  const trackingHint = useRef<{ shown: string | null; pending: string | null; since: number }>({ shown: null, pending: null, since: 0 });
  const [live, setLive] = useState<{ hint: string; pose: string; mask: number | null }>(CAMERA_OFF);
  useEffect(() => {
    function update() {
      const now = performance.now();
      const enabled = s.cameraReady && handState.status === "ready" && !handState.paused
        && handState.trackingState !== "IDENTITY_UNCERTAIN";
      const fresh = enabled && now - handState.updatedAt < handPoseWindow();
      const hand = fresh ? handState.primary ?? handState.hands[0] : null;
      const mask = feedback.current.update(hand, now, handState.frames, enabled);
      const cue = trackingHint.current;
      let pose = CAMERA_OFF.pose;
      let hint = CAMERA_OFF.hint;
      if (s.cameraReady) {
        if (handState.paused) {
          pose = "手部输入已暂停";
          hint = "按空格恢复手部输入。";
        } else if (handState.status === "error") {
          pose = "手势识别不可用";
          hint = "请在摄像头面板检查状态，也可以用鼠标操作。";
        } else if (handState.status !== "ready") {
          pose = "正在启动手势识别";
          hint = "识别就绪后，将手腕和手指放入摄像头画面。";
        } else if (handState.trackingState === "IDENTITY_UNCERTAIN") {
          pose = "暂时无法区分双手";
          hint = "请分开双手，让两只手都在画面内。";
        } else if (mask === null) {
          pose = "未识别到手";
          hint = "抬手到摄像头画面中央，让手腕和五根手指都入镜。";
        } else {
          pose = POSES[poseFor(mask)];
          if (hand) {
            const nextCue = gestureRuntime.palms.length === 1
              ? "掌心亮环已出现 · 移动手掌线性转动视角。"
              : gestureRuntime.cue ? CUES[gestureRuntime.cue] : null;
            if (nextCue !== cue.pending) {
              cue.pending = nextCue;
              cue.since = now;
            } else if (now - cue.since >= 70) {
              cue.shown = nextCue;
            }
          } else {
            cue.since = now;
          }
          hint = cue.shown ?? READY[s.tool];
        }
      }
      if (mask === null) cue.shown = cue.pending = null;

      // Operation and recovery messages take priority over the display-only pose.
      const action = ACTIVE[s.interaction as keyof typeof ACTIVE];
      if (action && ["Lost", "LostPending", "Recovering"].includes(s.interaction)) hint = action;
      else if (s.menu) hint = "用食指轻点工具，也可以用鼠标点击。";
      else if (s.tool === "draw" && drawRuntime.thickness > 0) hint = `厚度 ${drawRuntime.thickness.toFixed(3)} · 松手生成`;
      else if (s.tool === "draw" && drawRuntime.closing) hint = "松手闭合轮廓";
      else if (action) hint = action;
      else if (s.tool === "draw" && drawRuntime.extrusion) hint = "捏住厚度手柄上下拖动。";
      setLive(previous => previous.hint === hint && previous.pose === pose && previous.mask === mask
        ? previous : { hint, pose, mask });
    }
    update();
    if (!s.cameraReady && s.tool !== "draw") return;
    const timer = setInterval(update, 80);
    return () => clearInterval(timer);
  }, [s.cameraReady, s.interaction, s.menu, s.tool]);
  const mask = s.cameraReady ? live.mask : null;
  const action = ACTIVE[s.interaction as keyof typeof ACTIVE];
  return <div className="interaction-status caption-5">
    <div className="interaction-heading">
      <strong>当前工具：{TOOLS[s.tool]}{s.tool === "draw" ? ` · ${s.plane === "camera" ? "相机平面" : s.plane.toUpperCase()}` : ""}</strong>
      <button className="btn sm" onClick={onHelp}>手势指引</button>
    </div>
    <div className="interaction-heading">
      <span>五指识别 · <b>{s.cameraReady ? live.pose : CAMERA_OFF.pose}</b></span>
      <button className="btn sm" onClick={s.cancel} disabled={!action}>取消（Esc）</button>
    </div>
    <div className="finger-readout" role="group" aria-label="五指识别状态（仅显示）">
      {FINGER_LABELS.map((label, i) => {
        const extended = mask !== null && Boolean(mask & (1 << i));
        const state = mask === null ? "未识别" : extended ? "伸展" : "弯曲";
        return <div key={label} className="finger-reading" role="img" aria-label={`${label}：${state}`}>
          <span>{label}</span><span className={extended ? "extended" : ""}>{state}</span>
        </div>;
      })}
    </div>
    <span className="interaction-hint" role="status">{live.hint}</span>
  </div>;
}
