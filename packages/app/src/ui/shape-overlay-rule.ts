import { Actions } from "flexlayout-react";
import {
  beamerBuildStateAt,
  beamerStatementOverlayTarget,
  buildBeamerBuildModel,
  type BeamerBuildModel,
  type BeamerBuildRow,
  type BeamerObjectOverlayTarget
} from "@tikz-editor/core/beamer/index";
import type { Span, Statement } from "@tikz-editor/core/ast/types";
import { formatDocumentRootId, parseDocumentRootId } from "@tikz-editor/core/document/root-id";
import { findPathStatementById } from "@tikz-editor/core/edit/statement-find";
import type { SourcePatch } from "@tikz-editor/core/edit/types";
import { requestedDeckStep } from "../root-key";
import { useEditorStore } from "../store/store";
import { getDockLayoutHandle } from "./DockLayout";

/** A path statement of a slide picture, with the overlay rule it has or stands under. */
export type ShapeOverlayRule = {
  readonly frameId: string;
  readonly statement: Span;
  readonly model: BeamerBuildModel;
  readonly target: BeamerObjectOverlayTarget;
  /** Its own rule's specification as written, when it has one it can change. */
  readonly ownSpec: string | null;
};

/**
 * The overlay rule of the path statement `elementId` names, when the active
 * root is a slide or one of its pictures. `source` and the parsed statements
 * must be of one revision; spans are the document's.
 */
export function shapeOverlayRule(input: {
  source: string;
  activeRootId: string | null;
  statements: readonly Statement[] | undefined;
  snapshotSource: string;
  elementId: string | undefined;
}): ShapeOverlayRule | null {
  const ref = parseDocumentRootId(input.activeRootId ?? "");
  const frameIndex = ref?.kind === "beamer-frame" ? ref.index : ref?.kind === "beamer-frame-tikz" ? ref.frameIndex : null;
  if (frameIndex === null || !input.elementId || !input.statements || input.snapshotSource !== input.source) return null;
  const statement = findPathStatementById(input.statements, input.elementId);
  // A statement a loop or macro makes has no place of its own in the source.
  if (!statement || !input.source.startsWith("\\", statement.span.from)) return null;
  const frameId = formatDocumentRootId({ kind: "beamer-frame", index: frameIndex });
  const model = buildBeamerBuildModel(input.source, frameId);
  if (!model) return null;
  const target = beamerStatementOverlayTarget(model, statement.span);
  const own = target.row?.sourceSpan.from === statement.span.from && target.row.sourceSpan.to === statement.span.to ? target.row : null;
  return { frameId, statement: statement.span, model, target, ownSpec: own && target.canSet ? own.spec?.source.value ?? null : null };
}

/** Apply a rule edit made from a shape, as one undoable step, while the document is still the one it was computed for. */
export function applyShapeOverlayPatches(rule: ShapeOverlayRule, patches: readonly SourcePatch[], elementId: string): boolean {
  const state = useEditorStore.getState();
  if (patches.length === 0 || state.source !== rule.model.source || state.documents[state.activeDocumentId]?.assistantLockReason) return false;
  state.dispatch({ type: "APPLY_SOURCE_PATCHES", documentId: state.activeDocumentId, baseRevision: state.sourceRevision, patches: [...patches], changedSourceIds: [elementId] });
  return useEditorStore.getState().source !== rule.model.source;
}

/** Open the Overlays panel on `row`, at the slide's current step. */
export function revealOverlayRow(frameId: string, row: BeamerBuildRow): void {
  const dock = getDockLayoutHandle();
  if (dock) {
    if (!dock.getModel().getNodeById("builds")) dock.togglePanel("builds");
    dock.getModel().doAction(Actions.selectTab("builds"));
  }
  const state = useEditorStore.getState();
  const model = buildBeamerBuildModel(state.source, frameId);
  const current = model?.rows.find((candidate) => candidate.id === row.id);
  if (!model || !current) return;
  const step = Math.min(requestedDeckStep(state.deckStepByRootKey, state.activeDocumentId, frameId), model.stepCount);
  state.dispatch({ type: "SET_DECK_BUILD_SELECTION", selection: {
    documentId: state.activeDocumentId, frameId, sourceRevision: state.sourceRevision, rowId: current.id,
    step, sourceSpan: current.sourceSpan, contentSpans: beamerBuildStateAt(model, current, step).contentSpans, revealSource: false,
  } });
}
