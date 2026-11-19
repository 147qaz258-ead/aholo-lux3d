import { useEffect, useRef } from "react";
import { uiPointer } from "../lib/uiPointer";
import { handState } from "../lib/handState";
import { handVisualOpacity } from "../lib/handVisuals";

/**
 * 手势光标（DOM 层）。
 *
 * 3D 里的圆环会被面板挡住，用户在按钮区根本看不见指针在哪。
 * 这一层画在所有 UI 之上，负责四件事：位置、是否可点、目标名字、拖动时的实时数值。
 * 直接改 style，不走 React——每帧 setState 会把整棵树 diff 一遍。
 */
export function HandCursor() {
  const ring = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    let last = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = ring.current;
      if (!el) return;
      const tracking = handState.status === "ready" && !handState.paused;
      const anchor = uiPointer.tapAnchor;
      const live = tracking && (uiPointer.visible || anchor !== null);
      const held = tracking && uiPointer.sampleAt > 0 && handState.mouse.movedAt <= uiPointer.sampleAt;
      const alpha = live ? 1 : held ? handVisualOpacity(performance.now(), uiPointer.sampleAt) : 0;
      el.style.opacity = String(alpha);
      document.body.classList.toggle("hand-active", alpha > 0);
      if (!live) {
        if (label.current) label.current.style.opacity = "0";
        el.classList.remove("drag");
        return;
      }
      const dragging = Boolean(uiPointer.drag);
      const { x, y } = anchor ?? uiPointer;
      const overUi = !!anchor || uiPointer.overUi;
      const dwell = uiPointer.dwellProgress;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${
        dragging ? 1.5 : overUi ? 1.75 : 1
      })`;
      el.style.background = dwell > 0.02
        ? `conic-gradient(from -90deg, rgba(46, 232, 200, 0.92) ${(dwell * 360).toFixed(0)}deg, rgba(46, 232, 200, 0.14) 0deg)`
        : "";
      el.classList.toggle("hot", overUi);
      el.classList.toggle("drag", dragging);

      const lb = label.current;
      if (lb) {
        // 拖动时优先显示数值（滑杆拖到 0.32 必须看得见），否则显示目标名
        const text = dragging ? uiPointer.dragLabel : uiPointer.tapLabel || (uiPointer.overUi ? uiPointer.label : "");
        if (text && text !== last) {
          lb.textContent = text;
          last = text;
        }
        lb.classList.toggle("num", dragging);
        lb.style.opacity = text ? "1" : "0";
        lb.style.transform = `translate3d(${x.toFixed(1)}px, ${(y + 26).toFixed(1)}px, 0) translate(-50%, 0)`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      document.body.classList.remove("hand-active");
    };
  }, []);

  return (
    <>
      <div ref={ring} className="hand-cursor" aria-hidden>
        <span className="hc-dot" />
      </div>
      <div ref={label} className="hand-cursor-label" aria-hidden />
    </>
  );
}
