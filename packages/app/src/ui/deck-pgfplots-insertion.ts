import { applyDeckEditAction, buildBeamerObjectIndex, type BeamerGraphicsPlacement } from "@tikz-editor/core/beamer/index";
import type { PgfplotsTemplateKind } from "@tikz-editor/core/edit/pgfplots/templates";
import type { EditorAction, EditorState } from "../store/types.js";
import { requestDeckReselect } from "./canvas-panel/deck-insertion-bridge.js";

/**
 * Insert → Function Plot / Data Plot / Bar Chart on a slide: a new picture
 * with the axis after the selected object, or at the end of the frame, and
 * the preamble lines it needs (core `deckInsertPgfplotsTemplate`). The new
 * picture is selected once it has rendered.
 */
export function insertDeckPgfplotsTemplate(
  getState: () => EditorState,
  dispatch: (action: EditorAction) => void,
  template: PgfplotsTemplateKind
): void {
  const state = getState();
  const frame = state.snapshot.deck?.activeFrame;
  if (!frame || state.snapshot.source !== state.source) return;
  let placement: BeamerGraphicsPlacement = { kind: "end" };
  const selection = state.deckObjectSelection;
  if (selection?.frameId === frame.frameId && selection.objectId) {
    const node = buildBeamerObjectIndex({ items: frame.layout.items, paragraphs: frame.layout.paragraphs, source: state.source }).byId.get(selection.objectId);
    if (node) placement = { kind: "after", span: node.sourceSpan };
  }
  const action = { kind: "deckInsertPgfplotsTemplate", frameId: frame.frameId, template, placement } as const;
  const result = applyDeckEditAction(state.source, frame.layout, action);
  // A partial result is inserted with a warning (a slide without room for the chart).
  if (result.kind !== "success" && result.kind !== "partial") return;
  // The picture is the last edit (preamble lines come first).
  const patch = result.patches.at(-1);
  if (patch) requestDeckReselect({ frameId: frame.frameId, kind: "tikzpicture", span: patch.newSpan, source: result.newSource });
  dispatch({ type: "APPLY_EDIT_ACTION", action });
}
