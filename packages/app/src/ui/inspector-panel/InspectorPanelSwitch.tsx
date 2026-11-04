import { memo } from "react";
import { parseDocumentRootId } from "@tikz-editor/core/document/root-id";
import { useEditorStore } from "../../store/store";
import { DeckInspectorPanel } from "./DeckInspectorPanel";
import { InspectorPanel } from "./InspectorPanel";

const MemoInspectorPanel = memo(InspectorPanel);
const MemoDeckInspectorPanel = memo(DeckInspectorPanel);

/**
 * Deck mode gets the deck object/frame inspector, tikz the full one.
 * Mode is a function of (document kind, active root): a beamer document
 * editing a nested tikzpicture root behaves as a tikz editor.
 */
export function InspectorPanelSwitch() {
  const documentKind = useEditorStore((s) => s.documentKind);
  const nestedFigureActive = useEditorStore(
    (s) => parseDocumentRootId(s.activeRootId ?? "")?.kind === "beamer-frame-tikz" ||
      (s.snapshot.overlayLayer != null && (s.selectedElementIds.size > 0 || (s.toolMode !== "select" && s.toolMode !== "magnify")))
  );
  return documentKind === "beamer" && !nestedFigureActive
    ? <MemoDeckInspectorPanel />
    : <MemoInspectorPanel />;
}
