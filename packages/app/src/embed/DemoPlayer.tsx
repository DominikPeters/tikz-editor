import { memo, useCallback, useEffect, useState, type CSSProperties } from "react";
import { EmbeddedEditor } from "./EmbeddedEditor";
import { CursorOverlay } from "./CursorOverlay";
import { useDemoPlayer } from "./useDemoPlayer";
import { worldToClientPoint } from "../ui/canvas-panel/geometry";
import type { DemoScript, CursorFrameState } from "./demo-script";
import type { EditorStoreApi } from "../store/store";

export type DemoPlayerProps = {
  script: DemoScript;
  className?: string;
  style?: CSSProperties;
};

type OverlayPos = { x: number; y: number; visible: boolean; pressed: boolean; cursor: CursorFrameState["cursor"] };

// Project a world-coord cursor state to pixel coords relative to `container`.
// Returns null when the canvas SVG isn't mounted yet (e.g., first frame).
function projectCursor(container: HTMLElement | null, state: CursorFrameState): OverlayPos | null {
  if (!container) return null;
  const svg = container.querySelector('[data-testid="canvas-interaction-layer"]') as SVGSVGElement | null;
  if (!svg) return null;
  const vb = svg.viewBox.baseVal;
  const client = worldToClientPoint(state.x, state.y, svg, {
    x: vb.x,
    y: vb.y,
    width: vb.width,
    height: vb.height
  });
  if (!client) return null;
  const rect = container.getBoundingClientRect();
  return {
    x: client.clientX - rect.left,
    y: client.clientY - rect.top,
    visible: state.visible,
    pressed: state.pressed,
    cursor: state.cursor
  };
}

export const DemoPlayer = memo(function DemoPlayer({ script, className, style }: DemoPlayerProps) {
  const [store, setStore] = useState<EditorStoreApi | null>(null);
  const [overlay, setOverlay] = useState<OverlayPos>({ x: 0, y: 0, visible: false, pressed: false, cursor: "pointer" });
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  const handleStoreRef = useCallback((next: EditorStoreApi | null) => {
    setStore(next);
  }, []);

  const handleCursor = useCallback(
    (state: CursorFrameState) => {
      const projected = projectCursor(containerEl, state);
      if (projected) setOverlay(projected);
      else setOverlay((prev) => ({ ...prev, visible: false }));
    },
    [containerEl]
  );

  useDemoPlayer({
    store,
    script,
    onCursor: handleCursor,
    viewportEl: containerEl
  });

  useEffect(() => {
    if (!store) return;
    const state = store.getState();
    if (state.showGrid) {
      state.dispatch({ type: "TOGGLE_CANVAS_AID", aid: "grid" });
    }
    if (state.showRulers) {
      state.dispatch({ type: "TOGGLE_CANVAS_AID", aid: "rulers" });
    }
    if (state.snapModes.grid) {
      state.dispatch({ type: "TOGGLE_SNAP_MODE", mode: "grid" });
    }
    if (state.snapModes.guides) {
      state.dispatch({ type: "TOGGLE_SNAP_MODE", mode: "guides" });
    }
    if (state.snapModes.points) {
      state.dispatch({ type: "TOGGLE_SNAP_MODE", mode: "points" });
    }
    if (state.snapModes.gaps) {
      state.dispatch({ type: "TOGGLE_SNAP_MODE", mode: "gaps" });
    }
  }, [store]);

  return (
    <div
      ref={setContainerEl}
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", ...style }}
    >
      <EmbeddedEditor initialSource={script.initialSource} storeRef={handleStoreRef} />
      <CursorOverlay {...overlay} />
    </div>
  );
});
