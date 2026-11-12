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
import { findPathStatementById } from "@tikz-editor/core/edit/statement-find";
import type { SourcePatch } from "@tikz-editor/core/edit/types";
import { APP_MENU_COMMAND_IDS } from "../app-menu";
import type { OverlayMenuTarget } from "../context-menu";
import { deckFrameRootId, requestedDeckStep } from "../root-key";
import { useEditorStore } from "../store/store";
import { getDockLayoutHandle } from "./DockLayout";
import type { CommandBindings } from "./editor-command-runtime";

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
  const frameId = deckFrameRootId(input.activeRootId);
  if (frameId === null || !input.elementId || !input.statements || input.snapshotSource !== input.source) return null;
  const statement = findPathStatementById(input.statements, input.elementId);
  // A statement a loop or macro makes has no place of its own in the source.
  if (!statement || !input.source.startsWith("\\", statement.span.from)) return null;
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

/** The one selected shape's overlay rule, from the live document; null while its snapshot is catching up. */
function selectedShapeOverlayRule(elementId?: string | null): { rule: ShapeOverlayRule; elementId: string; step: number } | null {
  const state = useEditorStore.getState();
  const selected = elementId ?? (state.selectedElementIds.size === 1 ? [...state.selectedElementIds][0] : undefined);
  if (!selected || state.documentKind !== "beamer") return null;
  const rule = shapeOverlayRule({ source: state.source, activeRootId: state.activeRootId, statements: state.snapshot.parseResult?.figure.body,
    snapshotSource: state.snapshot.source, elementId: selected });
  if (!rule) return null;
  return { rule, elementId: selected, step: Math.min(requestedDeckStep(state.deckStepByRootKey, state.activeDocumentId, rule.frameId), rule.model.stepCount) };
}

/** What the canvas menu's Overlays submenu offers for the shape `elementId` names. */
export function shapeOverlayMenuTarget(elementId: string | null): OverlayMenuTarget | null {
  const selected = selectedShapeOverlayRule(elementId);
  if (!selected) return null;
  const { target } = selected.rule;
  return { step: selected.step, canSet: target.canSet, hasRule: target.row != null, canRemove: target.removePatches.length > 0 };
}

/**
 * The Overlays commands for the selected shape. They read the document when
 * they run: a menu's items say what applies, and the selection is the shape.
 */
export const SHAPE_OVERLAY_COMMANDS: CommandBindings = (() => {
  const set = (spec: (step: number) => string, nextStep?: (step: number) => number) => () => {
    const selected = selectedShapeOverlayRule();
    const patch = selected?.rule.target.setSpec(spec(selected.step));
    if (!selected || !patch || !applyShapeOverlayPatches(selected.rule, [patch], selected.elementId)) return;
    // The shape is then shown on the step it now appears on.
    if (nextStep) useEditorStore.getState().dispatch({ type: "SET_DECK_STEP", rootId: selected.rule.frameId, step: nextStep(selected.step) });
  };
  return {
    [APP_MENU_COMMAND_IDS.OVERLAY_NEXT]: { enabled: true, run: set((step) => `${step + 1}-`, (step) => step + 1) },
    [APP_MENU_COMMAND_IDS.OVERLAY_FROM]: { enabled: true, run: set((step) => `${step}-`) },
    [APP_MENU_COMMAND_IDS.OVERLAY_ONLY]: { enabled: true, run: set(String) },
    [APP_MENU_COMMAND_IDS.OVERLAY_THROUGH]: { enabled: true, run: set((step) => `-${step}`) },
    [APP_MENU_COMMAND_IDS.OVERLAY_REMOVE]: { enabled: true, run: () => {
      const selected = selectedShapeOverlayRule();
      if (selected) applyShapeOverlayPatches(selected.rule, selected.rule.target.removePatches, selected.elementId);
    } },
    [APP_MENU_COMMAND_IDS.OVERLAY_EDIT]: { enabled: true, run: () => {
      const selected = selectedShapeOverlayRule();
      if (selected?.rule.target.row) revealOverlayRow(selected.rule.frameId, selected.rule.target.row);
    } },
  };
})();
