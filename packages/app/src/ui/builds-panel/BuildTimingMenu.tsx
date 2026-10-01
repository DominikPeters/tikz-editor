import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BeamerBuildTimingAction } from "@tikz-editor/core/beamer/index";
import css from "../CanvasContextMenu.module.css";

export type BuildTimingMenuAnchor = { x: number; y: number; trigger: HTMLElement };

export function BuildTimingMenu({ anchor, step, onApply, onClose }: {
  anchor: BuildTimingMenuAnchor;
  step: number;
  onApply: (action: BeamerBuildTimingAction) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: anchor.x, y: anchor.y });
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const style = getComputedStyle(anchor.trigger);
    menu.style.setProperty("--app-ui-scale", style.getPropertyValue("--app-ui-scale"));
    menu.style.setProperty("--app-ui-font-size", style.getPropertyValue("--app-ui-font-size"));
    setPosition({ x: Math.max(4, Math.min(anchor.x, window.innerWidth - menu.offsetWidth - 4)),
      y: Math.max(4, Math.min(anchor.y, window.innerHeight - menu.offsetHeight - 4)) });
    menu.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.contains(event.target)) onClose(); };
    const close = () => { onClose(); };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [anchor, onClose]);
  const actions: { action: BeamerBuildTimingAction; label: string }[] = [
    { action: "from", label: `Show from step ${step}` },
    { action: "only", label: `Only on step ${step}` },
    { action: "through", label: `Show through step ${step}` },
  ];
  return createPortal(<div ref={ref} className={`${css.root} ${css.menu}`} style={{ left: position.x, top: position.y }} role="menu" aria-label="Overlay timing"
    onKeyDown={(event) => {
      const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      } else if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault(); event.stopPropagation(); onClose(); anchor.trigger.focus();
      }
    }}>
    {actions.map(({ action, label }) => <button type="button" role="menuitem" className={`${css.item} ${css.itemNoCheck}`} key={action}
      onClick={() => { onApply(action); onClose(); anchor.trigger.focus(); }}>{label}</button>)}
  </div>, document.body);
}
