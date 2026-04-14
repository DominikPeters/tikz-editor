import { memo, useCallback, useState, type CSSProperties } from "react";
import { EmbeddedEditor } from "./EmbeddedEditor";
import { CursorOverlay } from "./CursorOverlay";
import { useDemoPlayer } from "./useDemoPlayer";
import type { DemoScript, CursorFrameState } from "./demo-script";
import type { EditorStoreApi } from "../store/store";

export type DemoPlayerProps = {
  script: DemoScript;
  className?: string;
  style?: CSSProperties;
};

export const DemoPlayer = memo(function DemoPlayer({ script, className, style }: DemoPlayerProps) {
  const [store, setStore] = useState<EditorStoreApi | null>(null);
  const [cursor, setCursor] = useState<CursorFrameState>({ x: 0, y: 0, visible: false, pressed: false });
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  const handleStoreRef = useCallback((next: EditorStoreApi | null) => {
    setStore(next);
  }, []);

  useDemoPlayer({
    store,
    script,
    onCursor: setCursor,
    viewportEl: containerEl
  });

  return (
    <div
      ref={setContainerEl}
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", ...style }}
    >
      <EmbeddedEditor initialSource={script.initialSource} storeRef={handleStoreRef} />
      <CursorOverlay {...cursor} />
    </div>
  );
});
