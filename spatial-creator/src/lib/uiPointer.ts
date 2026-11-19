/**
 * 手势指针 → DOM 控件。
 *
 * 3D 射线只能点场景物体，点不到工具栏/面板——而"绘制""生成"都在按钮后面，
 * 于是纯手势用户进不去任何工具，闭环是断的。
 *
 * 这一层解决三件事，缺一件"不用鼠标"就不成立：
 * 1. 命中：把 NDC 投成屏幕像素，用 elementFromPoint 找控件；手指精度不如鼠标，
 *    小图标（18px 的行内按钮、滑杆）靠"磁性吸附"补足。命中时抑制 3D 拾取。
 * 2. 点击：捏合或食指轻点在命中元素上派发真实 click，进入目标要停留，两次之间要冷却。
 * 3. 拖动/滚动：滑杆、长面板需要"按住并移动"，而合成事件不会触发原生拖动行为，
 *    所以这里自己算：指针位移 → 控件的值 / 滚动位置。
 *
 * 覆盖不到的只剩"必须先有输入法"的文本输入与浏览器禁止合成的文件选择框，
 * 那两类由界面上的替代控件承担（预设短语、内置素材）。
 */

import { handState, type HandFrame } from './handState';
import { intentPredictor } from './intentPredictor';
import { useApp } from '../store';

/** 可被手势点击的元素：按钮、显式标注的、表单控件、对象列表行 */
const HIT_SELECTOR = "button, [role=button], [data-hand-hit], input, select, textarea, .obj-item";

/** 进入目标后需停留多久才允许触发，防"抬手路过按钮"误触 */
const ARM_MS = 140;
const TAP_ARM_MS = 100;
const DWELL_MS = 600;
const DWELL_SLOP_PX = 12;
/** 两次手势点击的最小间隔 */
const COOLDOWN_MS = 340;
const TAP_LIFT_MS = 720;
const TAP_SLOP = .08;
const HIT_CACHE_MS = 120;

/**
 * 磁性吸附：只吸附"矮"控件。
 * 视线在画布上画线时，指针离工具栏 18px 也会被吸走，所以大按钮必须直接命中；
 * 而行内 18px 的图标、18px 高的滑杆，手指根本不可能精确落点，必须靠吸附。
 */
const MAGNET_MAX_H = 32;
const MAGNET_MAX_W = 140;
const MAGNET_RING_1 = 8;
const MAGNET_RING_2 = 16;

export type DragSpec =
  | { kind: "range"; el: HTMLInputElement; lastValue: number }
  | { kind: "scroll"; el: HTMLElement; startY: number; startScroll: number };

export const uiPointer = {
  /** 视口坐标（CSS px） */
  x: 0,
  y: 0,
  visible: false,
  sampleAt: 0,
  /** 指针是否压在可按控件上 */
  overUi: false,
  /**
   * 指针是否压在"属于界面的地方"（控件、面板、顶栏、工具栏、浮层）。
   * 为 true 时禁止 3D 交互——否则在面板空白处捏合，会在后面的画布上落一笔。
   */
  blockScene: false,
  target: null as HTMLElement | null,
  /** 指针在可滚动容器内但没压在控件上时，捏合 = 拖动滚动 */
  scrollHost: null as HTMLElement | null,
  /** 进入当前目标的时刻 */
  armedAt: 0,
  lastActionAt: 0,
  /** 供 HUD 显示当前目标文字 */
  label: "",
  clicks: 0,
  tapLabel: "",
  tapAnchor: null as { x: number; y: number } | null,
  dwellProgress: 0,
  dwellAnchor: null as { x: number; y: number } | null,
  /** 正在进行的拖动 */
  drag: null as DragSpec | null,
  /** 拖动时显示的值（滑杆数值 / 滚动位置） */
  dragLabel: "",
};

/* ------------------------------- 命中 ------------------------------- */

function isUsable(el: HTMLElement | null): el is HTMLElement {
  if (!el?.isConnected || el.closest("[inert]")) return false;
  if (el.hasAttribute("disabled") || el.matches(":disabled") || el.getAttribute("aria-disabled") === "true") return false;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  // 滚出视口的控件不算可达
  if (r.bottom < 0 || r.top > window.innerHeight) return false;
  return true;
}

/**
 * 由 DOM 元素解析出"该被点击的那一个"。
 * 先找 [data-hand-hit]（最内层优先），再退回通用选择器——
 * 对象列表行里的眼睛/锁/删除就是靠这个从"整行"里分出来的。
 */
function resolve(el: Element | null): HTMLElement | null {
  if (!el) return null;
  const marked = el.closest("[data-hand-hit]") as HTMLElement | null;
  if (marked) return isUsable(marked) ? marked : null;
  const t = el.closest(HIT_SELECTOR) as HTMLElement | null;
  return isUsable(t) ? t : null;
}

function rectDist(x: number, y: number, r: DOMRect) {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

const cache = { x: -9999, y: -9999, el: null as HTMLElement | null, until: 0, magnet: false };

function search(x: number, y: number, allowMagnet: boolean): HTMLElement | null {
  const direct = resolve(document.elementFromPoint(x, y));
  if (direct) return direct;
  if (!allowMagnet) return null;

  // 磁性吸附：一圈圈往外试，命中"矮控件"就取离指针最近的那个
  for (const radius of [MAGNET_RING_1, MAGNET_RING_2]) {
    let best: { el: HTMLElement; d: number } | null = null;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const el = resolve(document.elementFromPoint(x + Math.cos(a) * radius, y + Math.sin(a) * radius));
      if (!el) continue;
      const b = el.getBoundingClientRect();
      if (b.height > MAGNET_MAX_H || b.width > MAGNET_MAX_W) continue;
      const d = rectDist(x, y, b);
      if (!best || d < best.d) best = { el, d };
    }
    if (best) return best.el;
  }
  return null;
}

function hitAt(x: number, y: number, allowMagnet: boolean, now: number): HTMLElement | null {
  // 指针几乎没动时复用上一帧结果：磁性搜索每帧最多 17 次布局读取，不必重复付
  if (now < cache.until && cache.magnet === allowMagnet && Math.abs(x - cache.x) + Math.abs(y - cache.y) < 1.5) {
    if (isUsable(cache.el)) return cache.el;
    if (!cache.el && cache.x > -9999) return null;
  }
  const el = search(x, y, allowMagnet);
  cache.x = x;
  cache.y = y;
  cache.el = el;
  cache.until = now + HIT_CACHE_MS;
  cache.magnet = allowMagnet;
  return el;
}

function labelOf(t: HTMLElement | null) {
  if (!t) return "";
  const explicit = t.dataset.handLabel || t.getAttribute("aria-label") || t.getAttribute("title");
  const text = (t.textContent || "").replace(/\s+/g, " ").trim();
  return (explicit || text).slice(0, 18);
}

/* ------------------------------- 拖动 ------------------------------- */

const RANGE_SETTER = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

/** 原生 setter + input 事件，React 的 onChange 才会收到 */
function setNativeValue(el: HTMLInputElement, v: string) {
  if (RANGE_SETTER) RANGE_SETTER.call(el, v);
  else el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function fmtNum(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** 指针横坐标 → 滑杆值。按轨道矩形线性映射，比"相对起点的位移"更符合直觉 */
function applyRange(el: HTMLInputElement, x: number) {
  const r = el.getBoundingClientRect();
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  const step = Number(el.step || 1);
  const t = Math.min(1, Math.max(0, (x - r.left) / Math.max(1, r.width)));
  let v = min + t * (max - min);
  if (step > 0) v = Math.round(v / step) * step;
  v = Math.min(max, Math.max(min, v));
  setNativeValue(el, String(v));
  uiPointer.dragLabel = `${el.dataset.handLabel || ""} ${fmtNum(v)}`.trim();
}

function startRange(el: HTMLInputElement, now: number) {
  uiPointer.drag = { kind: "range", el, lastValue: Number(el.value) };
  uiPointer.lastActionAt = now;
  el.classList.add("hand-drag");
  applyRange(el, uiPointer.x);
}

function startScroll(el: HTMLElement, now: number) {
  uiPointer.drag = { kind: "scroll", el, startY: uiPointer.y, startScroll: el.scrollTop };
  uiPointer.lastActionAt = now;
  el.classList.add("hand-drag");
  uiPointer.dragLabel = "拖动滚动";
}

function updateDrag() {
  const d = uiPointer.drag;
  if (!d) return;
  if (d.kind === "range") {
    applyRange(d.el, uiPointer.x);
  } else {
    d.el.scrollTop = d.startScroll - (uiPointer.y - d.startY);
    uiPointer.dragLabel = `滚动 ${Math.round(d.el.scrollTop)}`;
  }
}

function endDrag(commit: boolean) {
  const d = uiPointer.drag;
  uiPointer.drag = null;
  uiPointer.dragLabel = "";
  if (!d) return;
  d.el.classList.remove("hand-drag");
  if (d.kind === "range" && commit) {
    d.el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  uiPointer.lastActionAt = performance.now();
}

/* ------------------------------- 主循环 ------------------------------- */

export function suspendHandPointer() {
  if (!uiPointer.visible && !uiPointer.target && !uiPointer.drag) return;
  endDrag(false);
  uiPointer.target?.classList.remove("hand-hover");
  document.body.classList.remove("hand-over-ui");
  uiPointer.visible = uiPointer.overUi = uiPointer.blockScene = false;
  uiPointer.target = uiPointer.scrollHost = null;
  uiPointer.label = "";
}

/**
 * 每帧调用。ndc 为 -1..1 的指针坐标，rect 为 canvas 的屏幕矩形。
 * 只有 hand 源才接管——鼠标本来就能点，不需要这层。
 * pinched 用于兜底结束拖动（防止释放沿丢失导致滑杆一直跟手）。
 */
export function syncUiPointer(
  ndc: { x: number; y: number },
  rect: DOMRect,
  source: "hand" | "mouse",
  now: number,
  pinched = false,
  sampleAt = now,
) {
  if (source !== "hand") {
    suspendHandPointer();
    return;
  }
  uiPointer.visible = true;
  uiPointer.sampleAt = sampleAt;

  uiPointer.x = rect.left + (ndc.x * 0.5 + 0.5) * rect.width;
  uiPointer.y = rect.top + (-ndc.y * 0.5 + 0.5) * rect.height;

  if (uiPointer.drag) {
    if (!pinched) {
      endDrag(true);
    } else {
      updateDrag();
      return;
    }
  }

  // 先判是否在可滚动面板里：面板空白处要留给"拖动滚动"，
  // 否则磁性吸附会把每一个空白点都吸到旁边的按钮上，长面板再也滚不动
  const host = scrollHostAt(uiPointer.x, uiPointer.y);
  const t = hitAt(uiPointer.x, uiPointer.y, !host, now);
  if (t !== uiPointer.target) {
    // CSS 的 :hover 只认真实鼠标，手势悬停必须自己挂类
    uiPointer.target?.classList.remove("hand-hover");
    uiPointer.target = t;
    t?.classList.add("hand-hover");
    // 换了目标就重新计时：必须在新目标上"张开手停留"过才允许捏
    uiPointer.armedAt = now;
    uiPointer.label = labelOf(t);
    uiPointer.dwellProgress = 0;
    uiPointer.dwellAnchor = t ? { x: uiPointer.x, y: uiPointer.y } : null;
    document.body.classList.toggle("hand-over-ui", Boolean(t));
  }
  uiPointer.overUi = Boolean(t);

  // 可选：悬停读条点击（Dwell Click），适合手不稳或不想弯指/捏合时点按按钮
  const dwellEnabled = Boolean(useApp.getState().settings.dwellClick);
  if (
    dwellEnabled &&
    source === "hand" &&
    !pinched &&
    t &&
    tapAllowed(t, 0, null) &&
    inModalScope(t)
  ) {
    const anchor = uiPointer.dwellAnchor;
    if (!anchor || Math.hypot(uiPointer.x - anchor.x, uiPointer.y - anchor.y) > DWELL_SLOP_PX) {
      uiPointer.dwellAnchor = { x: uiPointer.x, y: uiPointer.y };
      uiPointer.armedAt = now;
      uiPointer.dwellProgress = 0;
    } else {
      const elapsed = now - uiPointer.armedAt;
      uiPointer.dwellProgress = Math.min(1, elapsed / DWELL_MS);
      if (elapsed >= DWELL_MS && now - uiPointer.lastActionAt >= COOLDOWN_MS) {
        uiPointer.dwellProgress = 0;
        uiPointer.armedAt = now + COOLDOWN_MS;
        press(t);
      }
    }
  } else {
    uiPointer.dwellProgress = 0;
  }

  uiPointer.scrollHost = t ? null : host;
  uiPointer.blockScene = Boolean(t) || Boolean(uiPointer.scrollHost) || onUiSurface(uiPointer.x, uiPointer.y);
}

function scrollHostAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const host = el?.closest("[data-hand-scroll]") as HTMLElement | null;
  if (!host) return null;
  return host.scrollHeight > host.clientHeight + 4 ? host : null;
}

/** 指针是否落在界面皮面上（面板/顶栏/工具栏/浮层）。用于挡住"隔着面板点到后面的物体" */
function onUiSurface(x: number, y: number): boolean {
  if (document.querySelector('[aria-modal="true"]')) return true;
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el || el.tagName === "CANVAS") return false;
  return Boolean(el.closest(".panel, .topbar, .rail, .help"));
}

/**
 * 捏合上升沿调用。返回 true 表示这次捏合被界面消费，调用方应跳过 3D 交互。
 */
export function pinchUi(pinchedEdge: boolean, now: number): boolean {
  if (!pinchedEdge) return false;
  if (now - uiPointer.armedAt < ARM_MS) return false;
  if (now - uiPointer.lastActionAt < COOLDOWN_MS) return false;

  const { target: t, x, y } = uiPointer;
  if (t && (!inModalScope(t) || currentHit(x, y) !== t)) return true;
  if (t) {
    if (t instanceof HTMLInputElement && t.type === "range") {
      startRange(t, now);
      return true;
    }
    if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && t.type === "text")) {
      // 能聚焦，但打不出字——输入法不在手势层的能力内，界面另给了预设短语
      t.focus();
      uiPointer.lastActionAt = now;
      return true;
    }
    press(t);
    return true;
  }

  if (uiPointer.scrollHost) {
    startScroll(uiPointer.scrollHost, now);
    return true;
  }
  return false;
}

function press(t: HTMLElement) {
  uiPointer.lastActionAt = performance.now();
  uiPointer.clicks++;
  t.classList.add("hand-press");
  window.setTimeout(() => t.classList.remove("hand-press"), 300);
  t.click();
}

const TAP_TARGET = 'button, input[type="checkbox"], input[type="radio"], [role="button"], .obj-item, [data-hand-hit]';
type Tap = { target: HTMLElement; id: number; x: number; y: number; wristX: number; wristY: number; aimedAt: number; bentAt: number | null };
let tap: Tap | null = null;
let lastTapFrame = -1;
let straightEmptyAt = 0;

export function resetIndexTap() {
  tap = null;
  uiPointer.tapLabel = "";
  uiPointer.tapAnchor = null;
}

function indexStraightness(hand: HandFrame) {
  const [a, b, c] = [hand.world[5], hand.world[6], hand.world[8]];
  if (!a || !b || !c) return NaN;
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z;
  const length = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz);
  return length > 1e-7 ? (ux * vx + uy * vy + uz * vz) / length : NaN;
}

function currentHit(x: number, y: number) {
  return search(x, y, !scrollHostAt(x, y));
}

function inModalScope(target: HTMLElement) {
  const dialogs = document.querySelectorAll('[aria-modal="true"]');
  return !dialogs.length || dialogs[dialogs.length - 1].contains(target);
}

function tapAllowed(target: HTMLElement, handId: number, menuHandId: number | null) {
  return target.matches(TAP_TARGET) && inModalScope(target)
    && (menuHandId === null || (menuHandId === handId && !!target.closest(".gesture-menu")))
    && !(target instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset"].includes(target.type));
}

/** Only fresh camera samples advance the tap. Releasing the bend clicks the
 * original control, even if the tip wandered while the finger was curled. */
export function indexTapUi(hand: HandFrame | null, frame: number, now: number, menuHandId: number | null) {
  const wrist = hand?.raw[0];
  const wasBent = tap?.bentAt != null;
  if (!hand || !wrist || uiPointer.drag) {
    resetIndexTap();
    return false;
  }
  if (hand.pinched) {
    // A pinch can take over the same control, but a curled tip can land on the
    // canvas or a neighboring control. Do not send that press somewhere else.
    const movedOffTarget = wasBent && (tap?.id !== hand.id || !uiPointer.visible || uiPointer.target !== tap.target);
    resetIndexTap();
    return movedOffTarget;
  }
  const liftLimit = Math.max(TAP_LIFT_MS, Math.min(1600, 600 + handState.resultIntervalMs * 3));
  if (tap && (tap.id !== hand.id || !isUsable(tap.target) || !tapAllowed(tap.target, hand.id, menuHandId)
    || Math.hypot(wrist.x - tap.wristX, wrist.y - tap.wristY) > TAP_SLOP
    || (tap.bentAt !== null && now - tap.bentAt > liftLimit))) {
    resetIndexTap();
    if (wasBent) { lastTapFrame = frame; return true; }
  }
  if (frame === lastTapFrame) return tap?.bentAt != null;
  lastTapFrame = frame;
  const { index, middle, ring } = hand.fingers.extended;
  const angle = indexStraightness(hand);
  if (middle || ring || !Number.isFinite(angle)) {
    resetIndexTap();
    return wasBent;
  }
  const straight = angle >= .83;
  if (tap?.bentAt != null) {
    if (!straight) return true;
    const { target, x, y } = tap;
    resetIndexTap();
    if (now - uiPointer.lastActionAt >= COOLDOWN_MS && currentHit(x, y) === target) press(target);
    return true;
  }

  if (angle < .72) {
    if (tap && now - tap.aimedAt >= TAP_ARM_MS && currentHit(tap.x, tap.y) === tap.target) {
      tap.bentAt = now;
      uiPointer.tapAnchor = { x: tap.x, y: tap.y };
      uiPointer.tapLabel = labelOf(tap.target) + " · 伸直点击";
      return true;
    }
    if (!tap && !uiPointer.overUi && !uiPointer.blockScene && straightEmptyAt && now - straightEmptyAt < 900) {
      straightEmptyAt = 0;
      intentPredictor.onAirBend(useApp.getState().tool, now);
    }
    resetIndexTap();
    return false;
  }
  const target = uiPointer.visible ? uiPointer.target : null;
  if (target !== tap?.target) resetIndexTap();
  if (straight && !target && !uiPointer.blockScene && index) straightEmptyAt = now;
  else if (!straight || target) straightEmptyAt = 0;
  if (straight && target && index) {
    const { x, y } = uiPointer;
    if (!tap && tapAllowed(target, hand.id, menuHandId) && currentHit(x, y) === target) {
      tap = { target, id: hand.id, x, y, wristX: wrist.x, wristY: wrist.y, aimedAt: now, bentAt: null };
    }
    if (tap) {
      tap.x = x;
      tap.y = y;
      uiPointer.tapAnchor = null;
      if (now - tap.aimedAt >= TAP_ARM_MS) uiPointer.tapLabel = labelOf(target) + " · 弯一下食指";
    }
  } else if (tap && angle >= 0.72 && angle < 0.83 && now - tap.aimedAt >= TAP_ARM_MS) {
    // 预弯曲阶段提前锁定光标锚点，防止手指刚开始下弯时指尖下坠把光标带偏到旁边控件
    uiPointer.tapAnchor = { x: tap.x, y: tap.y };
  }
  return false;
}

/** 捏合释放沿调用：结束拖动并把值提交给 React */
export function releaseUi() {
  if (uiPointer.drag) endDrag(true);
}

/** 指针在界面上时，连续捏合值不应被当成"要在 3D 里落笔" */
export function uiBlocksScene() {
  return uiPointer.blockScene;
}
