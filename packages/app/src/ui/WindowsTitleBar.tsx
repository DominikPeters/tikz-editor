import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { PlatformWindowFrame } from "../platform/types";
import css from "./WindowsTitleBar.module.css";

/**
 * The title bar of the Windows look: the app mark, the document tabs, a drag
 * region and the caption buttons (design/native-windows-look.md, phase 6).
 * Without a frame (the web preview) the caption buttons are only drawn.
 */
export function WindowsTitleBar({ frame, children }: { frame: PlatformWindowFrame | null; children: ReactNode }) {
  const [maximized, setMaximized] = useState(false);
  const [maximizeHovered, setMaximizeHovered] = useState(false);
  const maximizeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!frame) return;
    void frame.isMaximized().then(setMaximized, () => null);
    return frame.onMaximizedChange(setMaximized);
  }, [frame]);

  useEffect(() => frame?.onMaximizeButtonHover?.(setMaximizeHovered), [frame]);

  // Keeps the shell's Snap Layouts window over the maximise button. It sits at
  // the right edge, so it moves whenever the window is resized.
  useLayoutEffect(() => {
    const button = maximizeRef.current;
    const report = frame?.setMaximizeButtonBounds;
    if (!button || !report) return;
    const update = () => {
      const rect = button.getBoundingClientRect();
      report({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(button);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      report(null);
    };
  }, [frame]);

  return (
    <div className={css.titleBar} data-tauri-drag-region data-select="chrome" data-testid="windows-title-bar">
      <span className={css.appMark} aria-hidden="true" data-tauri-drag-region>{"\\t"}</span>
      {children}
      <div className={css.dragSpace} data-tauri-drag-region />
      <div className={css.captions}>
        <button type="button" tabIndex={-1} className={css.caption} aria-label="Minimize" onClick={() => { void frame?.minimize(); }}>
          <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" /></svg>
        </button>
        <button
          ref={maximizeRef}
          type="button"
          tabIndex={-1}
          className={[css.caption, maximizeHovered ? css.captionHover : ""].filter(Boolean).join(" ")}
          aria-label={maximized ? "Restore" : "Maximize"}
          onClick={() => { void frame?.toggleMaximize(); }}
        >
          {maximized ? (
            <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" /><rect x=".5" y="2.5" width="7" height="7" rx="1" /></svg>
          ) : (
            <svg viewBox="0 0 10 10" aria-hidden="true"><rect x=".5" y=".5" width="9" height="9" rx="1.5" /></svg>
          )}
        </button>
        <button type="button" tabIndex={-1} className={[css.caption, css.captionClose].join(" ")} aria-label="Close" onClick={() => { void frame?.close(); }}>
          <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M.5 .5l9 9M9.5 .5l-9 9" /></svg>
        </button>
      </div>
    </div>
  );
}
