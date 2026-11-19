import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../store";

export function Modal({ children, label, onClose }: { children: ReactNode; label: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    useApp.getState().cancelInteraction();
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([hidden]), select, textarea, [tabindex="0"]') ?? []);
    controls()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); close.current(); }
      if (e.key === "Tab") {
        const all = controls(), first = all[0], last = all.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("keydown", key, true); previous?.focus(); };
  }, []);
  return createPortal(<div ref={ref} className="review-overlay" role="dialog" aria-modal="true" aria-label={label} data-hand-ui>{children}</div>, document.body);
}
