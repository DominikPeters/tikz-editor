import { applyEditAction, type ReorderDirection } from "tikz-editor/edit/actions";
import { getEditActionAvailability } from "tikz-editor/edit/action-availability";
import { pt, worldPoint } from "tikz-editor/coords/index";
import { PT_PER_CM } from "tikz-editor/edit/format";
import type {
  resolveTransformInspectorValues} from "tikz-editor/edit/property-write-builders";
import {
  buildTransformSetPropertyMutations,
  resolveTransformInspectorMutationContext,
  type TransformInspectorKey
} from "tikz-editor/edit/property-write-builders";
import { propertyIdForWriteKey } from "tikz-editor/edit/property-registry";
import {
  parseStatementSnapshot,
  resolveStatementRefs,
  statementSnippet
} from "tikz-editor/edit/statement-ops";
import { parseTikzForEdit } from "tikz-editor/edit/parse-options";
import { parseEditableTargetId } from "tikz-editor/edit/editable-targets";
import type { EditParseOptions } from "tikz-editor/edit/parse-options";
import { resolvePropertyTarget } from "tikz-editor/edit/property-target";
import { parseMatrixRowsForEdit, resolveMatrixMode } from "tikz-editor/semantic/nodes/matrix";
import type { OptionListAst } from "tikz-editor/options/types";
import type { EditHandle, SceneElement, SceneFigure } from "tikz-editor/semantic/types";
import type { ForeachOriginFrame } from "tikz-editor/semantic/types";
import type { PathStatement, Statement } from "tikz-editor/ast/types";
import type { EditorAction } from "../store/types";
import {
  buildSelectionPngBase64,
  buildSelectionSvgSync,
  buildSelectionSvg,
  createClipboardPayload,
  readClipboardPayloadFromDataTransfer,
  readClipboardPayloadFromSystemClipboard,
  type ClipboardPasteBehavior,
  type ClipboardReadFailureReason,
  type TikzClipboardPayload,
  writePayloadToDataTransfer,
  writeClipboardPayload
} from "./editor-clipboard";
import { getActiveEditorPlatform } from "../platform/current";

type Dispatch = (action: EditorAction) => void;

type SelectionCommandContext = {
  source: string;
  activeFigureId?: string | null;
  parseOptions?: EditParseOptions;
  figureCount?: number;
  snapshotSource: string | null;
  scene: SceneFigure | null;
  editHandles: readonly EditHandle[];
  selectedElementIds: ReadonlySet<string>;
  activeHandleId?: string | null;
  dispatch: Dispatch;
};

type PasteCommandContext = SelectionCommandContext;

type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";
type DistributeAxis = "horizontal" | "vertical";
const DEFAULT_PASTE_OFFSET_PT = 0.25 * PT_PER_CM;

type ActionAvailability = ReturnType<typeof getEditActionAvailability>;
type TreeCommandTarget = { kind: "root" | "child"; sourceId: string; foreach: boolean };
type MatrixStatementCommandTarget = { matrixSourceId: string; rowCount: number; columnCount: number };
type UniformMatrixCellSelection = { matrixSourceId: string; rowIndex: number | null; columnIndex: number | null };

const availabilityCache = new WeakMap<SelectionCommandContext, ActionAvailability>();
const treeCommandTargetCache = new WeakMap<SelectionCommandContext, TreeCommandTarget | null>();
const matrixStatementTargetCache = new WeakMap<SelectionCommandContext, MatrixStatementCommandTarget | null>();
const uniformMatrixCellSelectionCache = new WeakMap<SelectionCommandContext, UniformMatrixCellSelection | null>();
const matrixCellSelectionClassificationCache = new WeakMap<SelectionCommandContext, MatrixCellSelectionClassification>();
const matrixActionCache = new WeakMap<SelectionCommandContext, Map<string, boolean>>();

export type PasteSelectionResult =
  | { kind: "success" }
  | { kind: "failure"; reason: ClipboardReadFailureReason | "unsupported" };

export function isCodeMirrorEventTarget(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null;
  return element?.closest?.(".cm-editor") != null;
}

export async function copySelection(
  context: SelectionCommandContext,
  options?: { pasteBehavior?: ClipboardPasteBehavior }
): Promise<boolean> {
  if (!canCopySelection(context)) {
    return false;
  }

  const snippets = selectedSnippets(context);
  if (snippets.length === 0) {
    return false;
  }
  const payload = createClipboardPayload(snippets, options?.pasteBehavior ?? "offset", 0);
  if (!payload) {
    return false;
  }
  const svgText = await buildSelectionSvg(payload.snippets);
  const browserWrite = await writeClipboardPayload(payload, { svgText });
  const desktopWrite = await writeDesktopClipboardBundle(payload, svgText);
  return browserWrite || desktopWrite;
}

export function copySelectionToClipboardData(
  context: SelectionCommandContext,
  dataTransfer: DataTransfer | null,
  options?: { pasteBehavior?: ClipboardPasteBehavior }
): boolean {
  if (!canCopySelection(context)) {
    return false;
  }
  const snippets = selectedSnippets(context);
  const payload = createClipboardPayload(snippets, options?.pasteBehavior ?? "offset", 0);
  if (!payload) {
    return false;
  }
  const svgText = buildSelectionSvgSync(payload.snippets);
  const copied = writePayloadToDataTransfer(payload, dataTransfer, { svgText });
  if (!copied) {
    return false;
  }
  void writeDesktopClipboardBundle(payload, svgText);
  return true;
}

export function deleteSelection(context: SelectionCommandContext): boolean {
  if (!canDeleteSelection(context)) {
    return false;
  }

  const matrixSelection = classifyMatrixCellSelection(context);
  if (matrixSelection.hasAnyMatrixCellSelection) {
    if (matrixSelection.exactFullRow) {
      context.dispatch({
        type: "APPLY_EDIT_ACTION",
        action: {
          kind: "removeMatrixRow",
          matrixSourceId: matrixSelection.exactFullRow.matrixSourceId,
          rowIndex: matrixSelection.exactFullRow.rowIndex
        }
      });
      return true;
    }
    if (matrixSelection.exactFullColumn) {
      context.dispatch({
        type: "APPLY_EDIT_ACTION",
        action: {
          kind: "removeMatrixColumn",
          matrixSourceId: matrixSelection.exactFullColumn.matrixSourceId,
          columnIndex: matrixSelection.exactFullColumn.columnIndex
        }
      });
      return true;
    }
    return false;
  }

  const ids = [...context.selectedElementIds];
  if (ids.length === 1 && canRemoveTreeChild(context)) {
    context.dispatch({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "removeTreeChild",
        childSourceId: ids[0]
      }
    });
    return true;
  }
  if (ids.length === 1 && parseEditableTargetId(ids[0]).kind === "node-adornment") {
    context.dispatch({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "deleteAdornment",
        targetId: ids[0]
      }
    });
    return true;
  }
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: ids.length === 1
      ? {
          kind: "deleteElement",
          elementId: ids[0]
        }
      : {
          kind: "deleteElements",
          elementIds: ids
        }
  });
  return true;
}

export async function cutSelection(context: SelectionCommandContext): Promise<boolean> {
  if (!canCutSelection(context)) {
    return false;
  }

  const didCopy = await copySelection(context, { pasteBehavior: "preserve" });
  if (!didCopy) {
    return false;
  }
  return deleteSelection(context);
}

export function cutSelectionToClipboardData(
  context: SelectionCommandContext,
  dataTransfer: DataTransfer | null
): boolean {
  const copied = copySelectionToClipboardData(context, dataTransfer, { pasteBehavior: "preserve" });
  if (!copied) {
    return false;
  }
  return deleteSelection(context);
}

export function pasteSelectionFromClipboardData(
  context: PasteCommandContext,
  dataTransfer: DataTransfer | null
): PasteSelectionResult {
  const parsed = readClipboardPayloadFromDataTransfer(dataTransfer);
  if (parsed.kind === "failure") {
    return parsed;
  }
  const didPaste = runPasteFromPayload(context, parsed.payload);
  return didPaste ? { kind: "success" } : { kind: "failure", reason: "unsupported" };
}

export async function pasteSelectionFromSystemClipboard(
  context: PasteCommandContext
): Promise<PasteSelectionResult> {
  const readResult = await readClipboardPayloadFromSystemClipboard();
  if (readResult.kind === "failure") {
    return readResult;
  }
  const didPaste = runPasteFromPayload(context, readResult.payload);
  return didPaste ? { kind: "success" } : { kind: "failure", reason: "unsupported" };
}

export function pasteSelectionFromPayload(
  context: PasteCommandContext,
  payload: TikzClipboardPayload
): PasteSelectionResult {
  const didPaste = runPasteFromPayload(context, payload);
  return didPaste ? { kind: "success" } : { kind: "failure", reason: "unsupported" };
}

export function pasteSnippetsWithOffset(
  context: PasteCommandContext,
  snippets: readonly string[],
  options: { pasteCount?: number } = {}
): boolean {
  const payload = createClipboardPayload(snippets, "offset", options.pasteCount ?? 0);
  if (!payload) {
    return false;
  }
  return runPasteFromPayload(context, payload);
}

function runPasteFromPayload(context: PasteCommandContext, payload: TikzClipboardPayload): boolean {
  if (!canPasteSelection(context)) {
    return false;
  }

  const refs = selectedStatementRefs(context);
  const anchor = refs.length > 0 ? refs[refs.length - 1] : null;
  const pasteCount = Math.max(0, Math.floor(payload.pasteCount));
  const offset = DEFAULT_PASTE_OFFSET_PT * (pasteCount + 1);
  const delta = payload.pasteBehavior === "preserve"
    ? worldPoint(pt(0), pt(0))
    : worldPoint(pt(offset), pt(-offset));
  const action = {
    kind: "pasteStatements" as const,
    snippets: [...payload.snippets],
    anchorElementId: anchor?.id,
    delta
  };
  const parseActiveFigureId = resolvedContextActiveFigureId(context);
  const precomputedResult = applyEditAction(context.source, context.editHandles as EditHandle[], action, {
    parseOptions: {
      activeFigureId: parseActiveFigureId,
      sourceFingerprint: context.parseOptions?.sourceFingerprint
    }
  });
  if (precomputedResult.kind !== "success" && precomputedResult.kind !== "partial") {
    return false;
  }

  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action,
    precomputedResult
  });

  if (payload.pasteBehavior === "offset") {
    const nextPayload = {
      ...payload,
      pasteCount: pasteCount + 1
    };
    void buildSelectionSvg(nextPayload.snippets).then(async (svgText) => {
      const browserWrite = await writeClipboardPayload(nextPayload, { svgText });
      if (!browserWrite) {
        await writeDesktopClipboardBundle(nextPayload, svgText);
        return;
      }
      void writeDesktopClipboardBundle(nextPayload, svgText);
    });
  }

  return true;
}

async function writeDesktopClipboardBundle(
  payload: TikzClipboardPayload,
  svgText: string | null
): Promise<boolean> {
  const writeBundle = getActiveEditorPlatform().clipboard?.writeBundle;
  if (typeof writeBundle !== "function") {
    return false;
  }
  try {
    await writeBundle({
      plainText: payload.plainText,
      tikzJson: JSON.stringify(payload),
      svgText,
      pngBase64: await buildSelectionPngBase64(svgText)
    });
    return true;
  } catch {
    return false;
  }
}

export function duplicateSelection(context: SelectionCommandContext): boolean {
  if (!canDuplicateSelection(context)) {
    return false;
  }

  const ids = [...context.selectedElementIds];
  if (ids.length === 1 && parseEditableTargetId(ids[0]).kind === "node-adornment") {
    context.dispatch({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "duplicateAdornment",
        targetId: ids[0]
      }
    });
    return true;
  }
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: {
      kind: "duplicateElements",
      elementIds: ids
    }
  });
  return true;
}

export function openRepeatSelection(
  context: SelectionCommandContext,
  onOpenRepeat?: () => void
): boolean {
  if (!canRepeatSelection(context) || !onOpenRepeat) {
    return false;
  }
  onOpenRepeat();
  return true;
}

export function flattenForeachSelection(context: SelectionCommandContext): boolean {
  const target = resolveFlattenForeachTarget(context);
  if (!target) {
    return false;
  }

  const action = {
    kind: "flattenForeach" as const,
    target: { kind: "span" as const, span: target.loopSpan },
    recursive: true
  };
  const precomputedResult = applyEditAction(context.source, context.editHandles as EditHandle[], action, {
    parseOptions: parseOptionsForContext(context)
  });
  if (precomputedResult.kind !== "success" && precomputedResult.kind !== "partial") {
    return false;
  }

  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action,
    precomputedResult
  });
  return true;
}

export function groupSelection(context: SelectionCommandContext): boolean {
  if (!canGroupSelection(context)) {
    return false;
  }

  const action = {
    kind: "groupElements" as const,
    elementIds: [...context.selectedElementIds]
  };
  const precomputedResult = applyEditAction(context.source, context.editHandles as EditHandle[], action, {
    parseOptions: parseOptionsForContext(context)
  });
  if (precomputedResult.kind !== "success" && precomputedResult.kind !== "partial") {
    return false;
  }

  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action,
    precomputedResult
  });
  return true;
}

export function ungroupSelection(context: SelectionCommandContext): boolean {
  if (!canUngroupSelection(context)) {
    return false;
  }

  const action = {
    kind: "ungroupElements" as const,
    elementIds: [...context.selectedElementIds]
  };
  const precomputedResult = applyEditAction(context.source, context.editHandles as EditHandle[], action, {
    parseOptions: parseOptionsForContext(context)
  });
  if (precomputedResult.kind !== "success" && precomputedResult.kind !== "partial") {
    return false;
  }

  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action,
    precomputedResult
  });
  return true;
}

export function reorderSelection(
  context: SelectionCommandContext,
  direction: ReorderDirection
): boolean {
  if (!canReorderSelection(context, direction)) {
    return false;
  }

  const ids = [...context.selectedElementIds];
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: {
      kind: "reorderElements",
      elementIds: ids,
      direction
    }
  });
  return true;
}

export function alignSelection(context: SelectionCommandContext, mode: AlignMode): boolean {
  const actionId =
    mode === "left"
      ? "align-left"
      : mode === "center"
        ? "align-center"
        : mode === "right"
          ? "align-right"
          : mode === "top"
            ? "align-top"
            : mode === "middle"
              ? "align-middle"
              : "align-bottom";

  const availability = availabilityFor(context);
  if (!availability[actionId].enabled) {
    return false;
  }

  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: {
      kind: "alignElements",
      elementIds: [...context.selectedElementIds],
      mode
    }
  });
  return true;
}

export function distributeSelection(context: SelectionCommandContext, axis: DistributeAxis): boolean {
  const actionId = axis === "horizontal" ? "distribute-horizontal" : "distribute-vertical";
  const availability = availabilityFor(context);
  if (!availability[actionId].enabled) {
    return false;
  }

  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: {
      kind: "distributeElements",
      elementIds: [...context.selectedElementIds],
      axis
    }
  });
  return true;
}

export function rotateSelection(context: SelectionCommandContext, direction: "left" | "right"): boolean {
  const actionId = direction === "left" ? "transform-rotateLeft90" : "transform-rotateRight90";
  return transformSelection(context, actionId, "rotate", (values) =>
    normalizeSignedDeg(values.rotate + (direction === "left" ? 90 : -90))
  );
}

export function flipSelection(context: SelectionCommandContext, axis: "horizontal" | "vertical"): boolean {
  const actionId = axis === "horizontal" ? "transform-flipHorizontal" : "transform-flipVertical";
  return transformSelection(context, actionId, axis === "horizontal" ? "xscale" : "yscale", (values, key) => -values[key]);
}

export function canCopySelection(context: SelectionCommandContext): boolean {
  if (classifyMatrixCellSelection(context).hasAnyMatrixCellSelection) {
    return false;
  }
  return availabilityFor(context).copy.enabled;
}

export function canDuplicateSelection(context: SelectionCommandContext): boolean {
  if (classifyMatrixCellSelection(context).hasAnyMatrixCellSelection) {
    return false;
  }
  return availabilityFor(context).duplicate.enabled;
}

export function canRepeatSelection(context: SelectionCommandContext): boolean {
  if (classifyMatrixCellSelection(context).hasAnyMatrixCellSelection) {
    return false;
  }
  return availabilityFor(context).repeat.enabled;
}

export function canFlattenForeachSelection(context: SelectionCommandContext): boolean {
  if (classifyMatrixCellSelection(context).hasAnyMatrixCellSelection) {
    return false;
  }
  const target = resolveFlattenForeachTarget(context);
  if (!target) {
    return false;
  }
  const result = applyEditAction(context.source, context.editHandles as EditHandle[], {
    kind: "flattenForeach",
    target: { kind: "span", span: target.loopSpan },
    recursive: true
  }, {
    parseOptions: parseOptionsForContext(context)
  });
  return result.kind === "success" || result.kind === "partial";
}

export function canCutSelection(context: SelectionCommandContext): boolean {
  if (classifyMatrixCellSelection(context).hasAnyMatrixCellSelection) {
    return false;
  }
  const availability = availabilityFor(context);
  return availability.cut.enabled && availability.delete.enabled;
}

export function canDeleteSelection(context: SelectionCommandContext): boolean {
  const matrixSelection = classifyMatrixCellSelection(context);
  if (matrixSelection.hasAnyMatrixCellSelection) {
    if (matrixSelection.exactFullRow) {
      return canApplyMatrixAction(context, {
        kind: "removeMatrixRow",
        matrixSourceId: matrixSelection.exactFullRow.matrixSourceId,
        rowIndex: matrixSelection.exactFullRow.rowIndex
      });
    }
    if (matrixSelection.exactFullColumn) {
      return canApplyMatrixAction(context, {
        kind: "removeMatrixColumn",
        matrixSourceId: matrixSelection.exactFullColumn.matrixSourceId,
        columnIndex: matrixSelection.exactFullColumn.columnIndex
      });
    }
    return false;
  }
  return availabilityFor(context).delete.enabled || canRemoveTreeChild(context);
}

export function canGroupSelection(context: SelectionCommandContext): boolean {
  return availabilityFor(context).group.enabled;
}

export function canUngroupSelection(context: SelectionCommandContext): boolean {
  return availabilityFor(context).ungroup.enabled;
}

export function canReorderSelection(
  context: SelectionCommandContext,
  direction: ReorderDirection = "bringForward"
): boolean {
  return availabilityFor(context)[reorderActionId(direction)].enabled;
}

export function canPasteSelection(context: PasteCommandContext): boolean {
  if (classifyMatrixCellSelection(context).hasAnyMatrixCellSelection) {
    return false;
  }
  return availabilityFor(context).paste.enabled;
}

export function canAddTreeChild(context: SelectionCommandContext): boolean {
  const target = resolveTreeCommandTarget(context);
  if (!target) {
    return false;
  }
  if (target.kind === "child") {
    return !target.foreach;
  }
  return target.kind === "root";
}

export function canAddMatrixRowAtEnd(context: SelectionCommandContext): boolean {
  const target = resolveMatrixStatementCommandTarget(context);
  if (!target) {
    return false;
  }
  return canApplyMatrixAction(context, {
    kind: "addMatrixRow",
    matrixSourceId: target.matrixSourceId,
    rowIndex: target.rowCount + 1
  });
}

export function canAddMatrixColumnAtEnd(context: SelectionCommandContext): boolean {
  const target = resolveMatrixStatementCommandTarget(context);
  if (!target) {
    return false;
  }
  return canApplyMatrixAction(context, {
    kind: "addMatrixColumn",
    matrixSourceId: target.matrixSourceId,
    columnIndex: target.columnCount + 1
  });
}

export function canInsertMatrixRowAbove(context: SelectionCommandContext): boolean {
  const selection = resolveUniformMatrixCellSelection(context);
  if (selection?.rowIndex == null) {
    return false;
  }
  return canApplyMatrixAction(context, {
    kind: "addMatrixRow",
    matrixSourceId: selection.matrixSourceId,
    rowIndex: selection.rowIndex
  });
}

export function canInsertMatrixRowBelow(context: SelectionCommandContext): boolean {
  const selection = resolveUniformMatrixCellSelection(context);
  if (selection?.rowIndex == null) {
    return false;
  }
  return canApplyMatrixAction(context, {
    kind: "addMatrixRow",
    matrixSourceId: selection.matrixSourceId,
    rowIndex: selection.rowIndex + 1
  });
}

export function canInsertMatrixColumnLeft(context: SelectionCommandContext): boolean {
  const selection = resolveUniformMatrixCellSelection(context);
  if (selection?.columnIndex == null) {
    return false;
  }
  return canApplyMatrixAction(context, {
    kind: "addMatrixColumn",
    matrixSourceId: selection.matrixSourceId,
    columnIndex: selection.columnIndex
  });
}

export function canInsertMatrixColumnRight(context: SelectionCommandContext): boolean {
  const selection = resolveUniformMatrixCellSelection(context);
  if (selection?.columnIndex == null) {
    return false;
  }
  return canApplyMatrixAction(context, {
    kind: "addMatrixColumn",
    matrixSourceId: selection.matrixSourceId,
    columnIndex: selection.columnIndex + 1
  });
}

export function canTransposeMatrix(context: SelectionCommandContext): boolean {
  const target = resolveMatrixStatementCommandTarget(context);
  if (!target) {
    return false;
  }
  return canApplyMatrixAction(context, {
    kind: "transposeMatrix",
    matrixSourceId: target.matrixSourceId
  });
}

export function canRemoveMatrixRow(context: SelectionCommandContext): boolean {
  const selection = resolveUniformMatrixCellSelection(context);
  if (selection?.rowIndex == null) {
    return false;
  }
  return canApplyMatrixAction(context, {
    kind: "removeMatrixRow",
    matrixSourceId: selection.matrixSourceId,
    rowIndex: selection.rowIndex
  });
}

export function canRemoveMatrixColumn(context: SelectionCommandContext): boolean {
  const selection = resolveUniformMatrixCellSelection(context);
  if (selection?.columnIndex == null) {
    return false;
  }
  return canApplyMatrixAction(context, {
    kind: "removeMatrixColumn",
    matrixSourceId: selection.matrixSourceId,
    columnIndex: selection.columnIndex
  });
}

export function canAddTreeSibling(context: SelectionCommandContext): boolean {
  const target = resolveTreeCommandTarget(context);
  return target?.kind === "child" && !target.foreach;
}

export function canRemoveTreeChild(context: SelectionCommandContext): boolean {
  const target = resolveTreeCommandTarget(context);
  return target?.kind === "child" && !target.foreach;
}

export function addTreeChild(context: SelectionCommandContext): boolean {
  const target = resolveTreeCommandTarget(context);
  if (!target) {
    return false;
  }
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: {
      kind: "addTreeChild",
      parentSourceId: target.sourceId
    }
  });
  return true;
}

export function addTreeSibling(context: SelectionCommandContext, position: "before" | "after"): boolean {
  const target = resolveTreeCommandTarget(context);
  if (target?.kind !== "child" || target.foreach) {
    return false;
  }
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: {
      kind: "addTreeSibling",
      siblingSourceId: target.sourceId,
      position
    }
  });
  return true;
}

export function addMatrixRowAtEnd(context: SelectionCommandContext): boolean {
  const target = resolveMatrixStatementCommandTarget(context);
  if (!target) {
    return false;
  }
  const action = {
    kind: "addMatrixRow" as const,
    matrixSourceId: target.matrixSourceId,
    rowIndex: target.rowCount + 1
  };
  if (!canApplyMatrixAction(context, action)) {
    return false;
  }
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action
  });
  return true;
}

export function addMatrixColumnAtEnd(context: SelectionCommandContext): boolean {
  const target = resolveMatrixStatementCommandTarget(context);
  if (!target) {
    return false;
  }
  const action = {
    kind: "addMatrixColumn" as const,
    matrixSourceId: target.matrixSourceId,
    columnIndex: target.columnCount + 1
  };
  if (!canApplyMatrixAction(context, action)) {
    return false;
  }
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action
  });
  return true;
}

export function insertMatrixRowAbove(context: SelectionCommandContext): boolean {
  const selection = resolveUniformMatrixCellSelection(context);
  if (selection?.rowIndex == null) {
    return false;
  }
  const action = {
    kind: "addMatrixRow" as const,
    matrixSourceId: selection.matrixSourceId,
    rowIndex: selection.rowIndex
  };
  if (!canApplyMatrixAction(context, action)) {
    return false;
  }
  context.dispatch({ type: "APPLY_EDIT_ACTION", action });
  return true;
}

export function insertMatrixRowBelow(context: SelectionCommandContext): boolean {
  const selection = resolveUniformMatrixCellSelection(context);
  if (selection?.rowIndex == null) {
    return false;
  }
  const action = {
    kind: "addMatrixRow" as const,
    matrixSourceId: selection.matrixSourceId,
    rowIndex: selection.rowIndex + 1
  };
  if (!canApplyMatrixAction(context, action)) {
    return false;
  }
  context.dispatch({ type: "APPLY_EDIT_ACTION", action });
  return true;
}

export function insertMatrixColumnLeft(context: SelectionCommandContext): boolean {
  const selection = resolveUniformMatrixCellSelection(context);
  if (selection?.columnIndex == null) {
    return false;
  }
  const action = {
    kind: "addMatrixColumn" as const,
    matrixSourceId: selection.matrixSourceId,
    columnIndex: selection.columnIndex
  };
  if (!canApplyMatrixAction(context, action)) {
    return false;
  }
  context.dispatch({ type: "APPLY_EDIT_ACTION", action });
  return true;
}

export function insertMatrixColumnRight(context: SelectionCommandContext): boolean {
  const selection = resolveUniformMatrixCellSelection(context);
  if (selection?.columnIndex == null) {
    return false;
  }
  const action = {
    kind: "addMatrixColumn" as const,
    matrixSourceId: selection.matrixSourceId,
    columnIndex: selection.columnIndex + 1
  };
  if (!canApplyMatrixAction(context, action)) {
    return false;
  }
  context.dispatch({ type: "APPLY_EDIT_ACTION", action });
  return true;
}

export function transposeMatrix(context: SelectionCommandContext): boolean {
  const target = resolveMatrixStatementCommandTarget(context);
  if (!target) {
    return false;
  }
  const action = {
    kind: "transposeMatrix" as const,
    matrixSourceId: target.matrixSourceId
  };
  if (!canApplyMatrixAction(context, action)) {
    return false;
  }
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action
  });
  return true;
}

export function removeMatrixRow(context: SelectionCommandContext): boolean {
  const selection = resolveUniformMatrixCellSelection(context);
  if (selection?.rowIndex == null) {
    return false;
  }
  const action = {
    kind: "removeMatrixRow" as const,
    matrixSourceId: selection.matrixSourceId,
    rowIndex: selection.rowIndex
  };
  if (!canApplyMatrixAction(context, action)) {
    return false;
  }
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action
  });
  return true;
}

export function removeMatrixColumn(context: SelectionCommandContext): boolean {
  const selection = resolveUniformMatrixCellSelection(context);
  if (selection?.columnIndex == null) {
    return false;
  }
  const action = {
    kind: "removeMatrixColumn" as const,
    matrixSourceId: selection.matrixSourceId,
    columnIndex: selection.columnIndex
  };
  if (!canApplyMatrixAction(context, action)) {
    return false;
  }
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action
  });
  return true;
}

export function canAlignSelection(context: SelectionCommandContext, mode: AlignMode): boolean {
  const actionId =
    mode === "left"
      ? "align-left"
      : mode === "center"
        ? "align-center"
        : mode === "right"
          ? "align-right"
          : mode === "top"
            ? "align-top"
            : mode === "middle"
              ? "align-middle"
              : "align-bottom";
  return availabilityFor(context)[actionId].enabled;
}

export function canDistributeSelection(context: SelectionCommandContext, axis: DistributeAxis): boolean {
  const actionId = axis === "horizontal" ? "distribute-horizontal" : "distribute-vertical";
  return availabilityFor(context)[actionId].enabled;
}

export function canRotateSelection(context: SelectionCommandContext, direction: "left" | "right"): boolean {
  const actionId = direction === "left" ? "transform-rotateLeft90" : "transform-rotateRight90";
  return availabilityFor(context)[actionId].enabled;
}

export function canFlipSelection(context: SelectionCommandContext, axis: "horizontal" | "vertical"): boolean {
  const actionId = axis === "horizontal" ? "transform-flipHorizontal" : "transform-flipVertical";
  return availabilityFor(context)[actionId].enabled;
}

export function splitSelectedPath(context: SelectionCommandContext): boolean {
  const ids = [...context.selectedElementIds];
  if (ids.length !== 1 || !availabilityFor(context)["path-split"].enabled || !context.activeHandleId) {
    return false;
  }
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: {
      kind: "splitPath",
      elementId: ids[0],
      handleId: context.activeHandleId
    }
  });
  return true;
}

export function joinSelectedPaths(context: SelectionCommandContext): boolean {
  const ids = [...context.selectedElementIds];
  if (ids.length !== 2 || !availabilityFor(context)["path-join"].enabled) {
    return false;
  }
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: {
      kind: "joinPaths",
      elementIds: [ids[0], ids[1]]
    }
  });
  return true;
}

export function reverseSelectedPath(context: SelectionCommandContext): boolean {
  const ids = [...context.selectedElementIds];
  if (ids.length !== 1 || !availabilityFor(context)["path-reverse"].enabled) {
    return false;
  }
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: {
      kind: "reversePath",
      elementId: ids[0]
    }
  });
  return true;
}

export function setSelectedPathClosed(context: SelectionCommandContext, closed: boolean): boolean {
  const ids = [...context.selectedElementIds];
  const actionId = closed ? "path-close" : "path-open";
  if (ids.length !== 1 || !availabilityFor(context)[actionId].enabled) {
    return false;
  }
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: {
      kind: "toggleClosedPath",
      elementId: ids[0],
      closed
    }
  });
  return true;
}

export function deleteSelectedPathPoint(context: SelectionCommandContext): boolean {
  const ids = [...context.selectedElementIds];
  if (ids.length !== 1 || !availabilityFor(context)["path-delete-point"].enabled || !context.activeHandleId) {
    return false;
  }
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: {
      kind: "deletePathPoint",
      elementId: ids[0],
      handleId: context.activeHandleId
    }
  });
  return true;
}

export function setSelectedPathPointKind(context: SelectionCommandContext, pointKind: "corner" | "smooth"): boolean {
  const ids = [...context.selectedElementIds];
  const actionId = pointKind === "corner" ? "path-point-corner" : "path-point-smooth";
  if (ids.length !== 1 || !availabilityFor(context)[actionId].enabled || !context.activeHandleId) {
    return false;
  }
  context.dispatch({
    type: "APPLY_EDIT_ACTION",
    action: {
      kind: "setPathPointKind",
      elementId: ids[0],
      handleId: context.activeHandleId,
      pointKind
    }
  });
  return true;
}

export function actionAvailability(
  context: SelectionCommandContext
) {
  return availabilityFor(context);
}

function selectedSnippets(context: SelectionCommandContext): string[] {
  const { source, selectedElementIds } = context;
  const parseOptions = parseOptionsForContext(context);
  if (selectedElementIds.size === 0) {
    return [];
  }

  const statementIds: string[] = [];
  const snippets: string[] = [];
  for (const id of selectedElementIds) {
    const parsed = parseEditableTargetId(id);
    if (parsed.kind === "node-adornment") {
      const resolved = resolvePropertyTarget(source, id, parseOptions);
      if (resolved.kind === "found" && resolved.target.optionSpan) {
        const snippet = source.slice(resolved.target.optionSpan.from, resolved.target.optionSpan.to).trim();
        if (snippet.length > 0) {
          snippets.push(snippet);
        }
      }
      continue;
    }
    statementIds.push(id);
  }

  if (statementIds.length > 0) {
    const snapshot = parseStatementSnapshot(source, parseOptions);
    const refs = resolveStatementRefs(snapshot, statementIds);
    refs.sort((left, right) => {
      if (left.span.from !== right.span.from) {
        return left.span.from - right.span.from;
      }
      return left.span.to - right.span.to;
    });
    snippets.push(...refs.map((ref) => statementSnippet(source, ref)));
  }

  return snippets;
}

function resolveTreeCommandTarget(
  context: SelectionCommandContext
): TreeCommandTarget | null {
  if (treeCommandTargetCache.has(context)) {
    return treeCommandTargetCache.get(context) ?? null;
  }
  if (context.selectedElementIds.size !== 1) {
    treeCommandTargetCache.set(context, null);
    return null;
  }
  const sourceId = [...context.selectedElementIds][0]?.trim() ?? "";
  if (!sourceId) {
    treeCommandTargetCache.set(context, null);
    return null;
  }

  const parseOptions = parseOptionsForContext(context);
  const resolved = resolvePropertyTarget(context.source, sourceId, parseOptions);
  if (resolved.kind !== "found") {
    treeCommandTargetCache.set(context, null);
    return null;
  }
  if (resolved.target.kind === "tree-child") {
    const target: TreeCommandTarget = {
      kind: "child",
      sourceId,
      foreach: resolved.target.treeChildForeach === true
    };
    treeCommandTargetCache.set(context, target);
    return target;
  }
  if (resolved.target.kind !== "path-statement") {
    treeCommandTargetCache.set(context, null);
    return null;
  }

  const parsed = parseTikzForEdit(context.source, parseOptions);
  const statement = findPathStatementById(parsed.figure.body, sourceId);
  if (!statement) {
    treeCommandTargetCache.set(context, null);
    return null;
  }
  const hasNode = statement.items.some((item) => item.kind === "Node");
  const hasChildren = statement.items.some((item) => item.kind === "ChildOperation");
  if (!hasNode || !hasChildren) {
    treeCommandTargetCache.set(context, null);
    return null;
  }
  const target: TreeCommandTarget = { kind: "root", sourceId, foreach: false };
  treeCommandTargetCache.set(context, target);
  return target;
}

function findPathStatementById(statements: readonly Statement[], sourceId: string): PathStatement | null {
  for (const statement of statements) {
    if (statement.kind === "Scope") {
      const nested = findPathStatementById(statement.body, sourceId);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (statement.kind === "Path" && statement.id === sourceId) {
      return statement;
    }
  }
  return null;
}

function selectedStatementRefs(context: SelectionCommandContext) {
  const { source, selectedElementIds } = context;
  if (selectedElementIds.size === 0) {
    return [];
  }

  const statementIds = [...selectedElementIds].filter((id) => parseEditableTargetId(id).kind === "statement");
  const snapshot = parseStatementSnapshot(source, parseOptionsForContext(context));
  const refs = resolveStatementRefs(snapshot, statementIds);
  refs.sort((left, right) => {
    if (left.span.from !== right.span.from) {
      return left.span.from - right.span.from;
    }
    return left.span.to - right.span.to;
  });
  return refs;
}

function resolveMatrixStatementCommandTarget(
  context: SelectionCommandContext
): MatrixStatementCommandTarget | null {
  if (matrixStatementTargetCache.has(context)) {
    return matrixStatementTargetCache.get(context) ?? null;
  }
  if (context.selectedElementIds.size !== 1) {
    matrixStatementTargetCache.set(context, null);
    return null;
  }
  const sourceId = [...context.selectedElementIds][0]?.trim() ?? "";
  if (!sourceId) {
    matrixStatementTargetCache.set(context, null);
    return null;
  }
  const parseOptions = parseOptionsForContext(context);
  const resolved = resolvePropertyTarget(context.source, sourceId, parseOptions);
  if (resolved.kind !== "found" || resolved.target.kind !== "matrix-statement") {
    matrixStatementTargetCache.set(context, null);
    return null;
  }
  const dimensions = resolveMatrixDimensions(context.source, resolved.target.matrixTextSpan, resolved.target.options);
  if (!dimensions) {
    matrixStatementTargetCache.set(context, null);
    return null;
  }
  const target = {
    matrixSourceId: sourceId,
    rowCount: dimensions.rowCount,
    columnCount: dimensions.columnCount
  };
  matrixStatementTargetCache.set(context, target);
  return target;
}

function resolveUniformMatrixCellSelection(
  context: SelectionCommandContext
): UniformMatrixCellSelection | null {
  if (uniformMatrixCellSelectionCache.has(context)) {
    return uniformMatrixCellSelectionCache.get(context) ?? null;
  }
  const sourceIds = [...context.selectedElementIds].map((id) => id.trim()).filter(Boolean);
  if (sourceIds.length === 0) {
    uniformMatrixCellSelectionCache.set(context, null);
    return null;
  }
  const parseOptions = parseOptionsForContext(context);
  let matrixSourceId: string | null = null;
  let rowIndex: number | null = null;
  let columnIndex: number | null = null;

  for (const sourceId of sourceIds) {
    const resolved = resolvePropertyTarget(context.source, sourceId, parseOptions);
    if (resolved.kind !== "found" || resolved.target.kind !== "matrix-cell") {
      uniformMatrixCellSelectionCache.set(context, null);
      return null;
    }
    const currentMatrixSourceId = resolved.target.matrixSourceId?.trim() ?? "";
    const currentRow = resolved.target.row ?? 0;
    const currentColumn = resolved.target.column ?? 0;
    if (!currentMatrixSourceId || currentRow <= 0 || currentColumn <= 0) {
      uniformMatrixCellSelectionCache.set(context, null);
      return null;
    }
    if (matrixSourceId == null) {
      matrixSourceId = currentMatrixSourceId;
      rowIndex = currentRow;
      columnIndex = currentColumn;
      continue;
    }
    if (matrixSourceId !== currentMatrixSourceId) {
      uniformMatrixCellSelectionCache.set(context, null);
      return null;
    }
    if (rowIndex !== null && rowIndex !== currentRow) {
      rowIndex = null;
    }
    if (columnIndex !== null && columnIndex !== currentColumn) {
      columnIndex = null;
    }
  }

  if (!matrixSourceId) {
    uniformMatrixCellSelectionCache.set(context, null);
    return null;
  }
  const selection = { matrixSourceId, rowIndex, columnIndex };
  uniformMatrixCellSelectionCache.set(context, selection);
  return selection;
}

type MatrixCellSelectionClassification = {
  hasAnyMatrixCellSelection: boolean;
  exactFullRow: { matrixSourceId: string; rowIndex: number } | null;
  exactFullColumn: { matrixSourceId: string; columnIndex: number } | null;
};

function classifyMatrixCellSelection(
  context: SelectionCommandContext
): MatrixCellSelectionClassification {
  const cached = matrixCellSelectionClassificationCache.get(context);
  if (cached) {
    return cached;
  }
  const sourceIds = [...context.selectedElementIds].map((id) => id.trim()).filter(Boolean);
  if (sourceIds.length === 0) {
    const classification = {
      hasAnyMatrixCellSelection: false,
      exactFullRow: null,
      exactFullColumn: null
    };
    matrixCellSelectionClassificationCache.set(context, classification);
    return classification;
  }

  const parseOptions = parseOptionsForContext(context);
  const matrixCells: Array<{ sourceId: string; matrixSourceId: string; row: number; column: number }> = [];
  let hasNonMatrixSelection = false;
  for (const sourceId of sourceIds) {
    const resolved = resolvePropertyTarget(context.source, sourceId, parseOptions);
    if (resolved.kind !== "found" || resolved.target.kind !== "matrix-cell") {
      hasNonMatrixSelection = true;
      continue;
    }
    const matrixSourceId = resolved.target.matrixSourceId?.trim() ?? "";
    const row = resolved.target.row ?? 0;
    const column = resolved.target.column ?? 0;
    if (!matrixSourceId || row <= 0 || column <= 0) {
      hasNonMatrixSelection = true;
      continue;
    }
    matrixCells.push({ sourceId, matrixSourceId, row, column });
  }

  if (matrixCells.length === 0) {
    const classification = {
      hasAnyMatrixCellSelection: false,
      exactFullRow: null,
      exactFullColumn: null
    };
    matrixCellSelectionClassificationCache.set(context, classification);
    return classification;
  }

  const matrixSourceId = matrixCells[0]?.matrixSourceId ?? null;
  if (!matrixSourceId || matrixCells.some((cell) => cell.matrixSourceId !== matrixSourceId)) {
    const classification = {
      hasAnyMatrixCellSelection: true,
      exactFullRow: null,
      exactFullColumn: null
    };
    matrixCellSelectionClassificationCache.set(context, classification);
    return classification;
  }
  if (hasNonMatrixSelection) {
    const classification = {
      hasAnyMatrixCellSelection: true,
      exactFullRow: null,
      exactFullColumn: null
    };
    matrixCellSelectionClassificationCache.set(context, classification);
    return classification;
  }
  if (!context.scene) {
    const classification = {
      hasAnyMatrixCellSelection: true,
      exactFullRow: null,
      exactFullColumn: null
    };
    matrixCellSelectionClassificationCache.set(context, classification);
    return classification;
  }

  const rowToCellIds = new Map<number, Set<string>>();
  const columnToCellIds = new Map<number, Set<string>>();
  const seenCellIds = new Set<string>();
  for (const element of context.scene.elements) {
    const matrixCell = element.matrixCell;
    if (matrixCell?.matrixSourceId !== matrixSourceId) {
      continue;
    }
    if (seenCellIds.has(matrixCell.cellSourceId)) {
      continue;
    }
    seenCellIds.add(matrixCell.cellSourceId);
    const rowSet = rowToCellIds.get(matrixCell.row) ?? new Set<string>();
    rowSet.add(matrixCell.cellSourceId);
    rowToCellIds.set(matrixCell.row, rowSet);
    const columnSet = columnToCellIds.get(matrixCell.column) ?? new Set<string>();
    columnSet.add(matrixCell.cellSourceId);
    columnToCellIds.set(matrixCell.column, columnSet);
  }

  const selectedCellIds = new Set(matrixCells.map((cell) => cell.sourceId));
  const singleRow = matrixCells.every((cell) => cell.row === matrixCells[0]?.row) ? (matrixCells[0]?.row ?? null) : null;
  const singleColumn = matrixCells.every((cell) => cell.column === matrixCells[0]?.column)
    ? (matrixCells[0]?.column ?? null)
    : null;

  const exactFullRow =
    singleRow != null && areSetValuesEqual(selectedCellIds, rowToCellIds.get(singleRow))
      ? { matrixSourceId, rowIndex: singleRow }
      : null;
  const exactFullColumn =
    singleColumn != null && areSetValuesEqual(selectedCellIds, columnToCellIds.get(singleColumn))
      ? { matrixSourceId, columnIndex: singleColumn }
      : null;

  const classification = {
    hasAnyMatrixCellSelection: true,
    exactFullRow,
    exactFullColumn
  };
  matrixCellSelectionClassificationCache.set(context, classification);
  return classification;
}

function areSetValuesEqual(left: ReadonlySet<string>, right: ReadonlySet<string> | undefined): boolean {
  if (left.size !== right?.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function resolveMatrixDimensions(
  source: string,
  matrixTextSpan: { from: number; to: number } | undefined,
  options: OptionListAst | undefined
): { rowCount: number; columnCount: number } | null {
  if (!matrixTextSpan || matrixTextSpan.from < 0 || matrixTextSpan.to < matrixTextSpan.from || matrixTextSpan.to > source.length) {
    return null;
  }
  const matrixMode = resolveMatrixMode(options);
  if (!matrixMode.enabled) {
    return null;
  }
  const matrixText = source.slice(matrixTextSpan.from, matrixTextSpan.to);
  const parsedRows = parseMatrixRowsForEdit(matrixText, matrixMode.cellSeparator, matrixTextSpan.from);
  const rowCount = parsedRows.rows.length;
  const columnCount = parsedRows.rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
  return { rowCount, columnCount };
}

function canApplyMatrixAction(
  context: SelectionCommandContext,
  action:
    | { kind: "addMatrixRow"; matrixSourceId: string; rowIndex: number }
    | { kind: "removeMatrixRow"; matrixSourceId: string; rowIndex: number }
    | { kind: "addMatrixColumn"; matrixSourceId: string; columnIndex: number }
    | { kind: "removeMatrixColumn"; matrixSourceId: string; columnIndex: number }
    | { kind: "transposeMatrix"; matrixSourceId: string }
): boolean {
  let cache = matrixActionCache.get(context);
  if (!cache) {
    cache = new Map();
    matrixActionCache.set(context, cache);
  }
  const key = matrixActionCacheKey(action);
  const cached = cache.get(key);
  if (cached != null) {
    return cached;
  }
  const result = applyEditAction(context.source, context.editHandles as EditHandle[], action, {
    parseOptions: parseOptionsForContext(context)
  });
  const canApply = result.kind === "success" || result.kind === "partial";
  cache.set(key, canApply);
  return canApply;
}

function availabilityFor(context: SelectionCommandContext) {
  const cached = availabilityCache.get(context);
  if (cached) {
    return cached;
  }
  const availability = getEditActionAvailability({
    source: context.source,
    activeFigureId: resolvedContextActiveFigureId(context),
    parseOptions: parseOptionsForContext(context),
    snapshotSource: context.snapshotSource,
    selectedSourceIds: [...context.selectedElementIds],
    scene: context.scene,
    editHandles: context.editHandles,
    activeHandleId: context.activeHandleId ?? null,
    hasClipboardContent: true
  });
  availabilityCache.set(context, availability);
  return availability;
}

function matrixActionCacheKey(
  action:
    | { kind: "addMatrixRow"; matrixSourceId: string; rowIndex: number }
    | { kind: "removeMatrixRow"; matrixSourceId: string; rowIndex: number }
    | { kind: "addMatrixColumn"; matrixSourceId: string; columnIndex: number }
    | { kind: "removeMatrixColumn"; matrixSourceId: string; columnIndex: number }
    | { kind: "transposeMatrix"; matrixSourceId: string }
): string {
  if ("rowIndex" in action) {
    return `${action.kind}:${action.matrixSourceId}:${action.rowIndex}`;
  }
  if ("columnIndex" in action) {
    return `${action.kind}:${action.matrixSourceId}:${action.columnIndex}`;
  }
  return `${action.kind}:${action.matrixSourceId}`;
}

function reorderActionId(direction: ReorderDirection) {
  switch (direction) {
    case "sendToBack":
      return "reorder-sendToBack" as const;
    case "sendBackward":
      return "reorder-sendBackward" as const;
    case "bringForward":
      return "reorder-bringForward" as const;
    case "bringToFront":
      return "reorder-bringToFront" as const;
  }
}

function transformSelection(
  context: SelectionCommandContext,
  actionId:
    | "transform-rotateLeft90"
    | "transform-rotateRight90"
    | "transform-flipHorizontal"
    | "transform-flipVertical",
  key: TransformInspectorKey,
  resolveNextValue: (
    values: ReturnType<typeof resolveTransformInspectorValues>,
    key: TransformInspectorKey
  ) => number
): boolean {
  if (!availabilityFor(context)[actionId].enabled) {
    return false;
  }

  const elementIds = [...context.selectedElementIds];
  const mergeKey = `transform:${Date.now().toString(36)}`;
  let dispatched = false;
  const parseOptions = parseOptionsForContext(context);

  for (const elementId of elementIds) {
    const targetId = resolveTransformTargetId(context, elementId);
    if (!targetId) {
      continue;
    }
    const transformContext = resolveTransformInspectorMutationContext(context.source, targetId, parseOptions);
    const mutations = buildTransformSetPropertyMutations(
      transformContext,
      key,
      resolveNextValue(transformContext.values, key)
    );
    for (const mutation of mutations) {
      context.dispatch({
        type: "APPLY_EDIT_ACTION",
        historyMergeKey: mergeKey,
        action: {
          kind: "setProperty",
          elementId: targetId,
          level: "command",
          key: mutation.key,
          value: mutation.value,
          propertyId: propertyIdForWriteKey(mutation.key) ?? undefined,
          clearKeys: mutation.clearKeys
        }
      });
      dispatched = true;
    }
  }

  return dispatched;
}

function normalizeSignedDeg(degrees: number): number {
  if (!Number.isFinite(degrees)) {
    return 0;
  }
  let normalized = ((degrees % 360) + 360) % 360;
  if (normalized > 180) {
    normalized -= 360;
  }
  if (normalized <= -180) {
    normalized += 360;
  }
  return normalized;
}

function resolveTransformTargetId(context: SelectionCommandContext, selectedId: string): string | null {
  const parseOptions = parseOptionsForContext(context);
  const element = findSelectedSceneElement(context.scene, selectedId);
  if (!element) {
    const resolved = resolvePropertyTarget(context.source, selectedId, parseOptions);
    return resolved.kind === "found" ? selectedId : null;
  }

  const styleChainCommandSourceId =
    [...element.styleChain].reverse().find((entry) => entry.kind === "command")?.sourceRef?.sourceId ?? null;
  const candidateTargetIds = [
    element.adornment?.targetId ?? null,
    styleChainCommandSourceId,
    element.sourceRef.sourceId,
    selectedId
  ].filter((candidate, index, all): candidate is string => Boolean(candidate) && all.indexOf(candidate) === index);

  for (const targetId of candidateTargetIds) {
    const resolved = resolvePropertyTarget(context.source, targetId, parseOptions);
    if (resolved.kind === "found") {
      return targetId;
    }
  }

  return null;
}

function resolveFlattenForeachTarget(context: SelectionCommandContext): ForeachOriginFrame | null {
  if (!context.scene || context.selectedElementIds.size === 0) {
    return null;
  }

  const selectedElements = [...context.selectedElementIds]
    .map((selectedId) => findSelectedSceneElement(context.scene, selectedId))
    .filter((element): element is SceneElement => element != null);
  if (selectedElements.length === 0) {
    return null;
  }

  const outerFrames = selectedElements
    .map((element) => element.origin?.foreachStack[0] ?? null)
    .filter((frame): frame is ForeachOriginFrame => frame != null);
  if (outerFrames.length === 0) {
    return null;
  }

  const first = outerFrames[0];
  if (!first) {
    return null;
  }

  const allSameLoop = outerFrames.every((frame) =>
    frame.loopId === first.loopId &&
    frame.loopSpan.from === first.loopSpan.from &&
    frame.loopSpan.to === first.loopSpan.to
  );
  return allSameLoop ? first : null;
}

function resolvedContextActiveFigureId(context: SelectionCommandContext): string | null | undefined {
  if (context.activeFigureId != null) {
    return context.activeFigureId;
  }
  if ((context.figureCount ?? 0) > 1) {
    return null;
  }
  return undefined;
}

function parseOptionsForContext(context: SelectionCommandContext): EditParseOptions {
  return {
    activeFigureId: resolvedContextActiveFigureId(context),
    analysisView: context.parseOptions?.analysisView,
    analysisSession: context.parseOptions?.analysisSession,
    indentSize: context.parseOptions?.indentSize,
    sourceFingerprint: context.parseOptions?.sourceFingerprint
  };
}

function findSelectedSceneElement(scene: SceneFigure | null, selectedId: string): SceneElement | null {
  if (!scene) {
    return null;
  }

  for (const element of scene.elements) {
    if (element.adornment?.targetId === selectedId || element.sourceRef.sourceId === selectedId) {
      return element;
    }
  }

  return null;
}
