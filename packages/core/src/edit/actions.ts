import type {
  EditHandle,
  EvaluateOptions,
  Point,
  SceneCircle,
  SceneElement,
  SceneEllipse,
  ScenePath,
  ScenePathShapeHint
} from "../semantic/types.js";
import type { CoordinateItem, NodeItem, PathItem, PathOptionItem, PathStatement, Statement, Span } from "../ast/types.js";
import type { SourcePatch } from "./types.js";
import { applyEditIntent } from "./apply.js";
import { rewriteCoordinate } from "./rewrite.js";
import { replaceSpan } from "./patch.js";
import { CM_PER_PT, PT_PER_CM, formatNumber } from "./format.js";
import {
  generateElementSource,
  insertElementIntoSource,
  type ElementTemplate
} from "./element-templates.js";
import type { OptionEntry } from "../options/types.js";
import { resolvePropertyTarget, type PropertyTarget } from "./property-target.js";
import { evaluateTikzFigure } from "../semantic/evaluate.js";
import { parseCircleRadiusFromCoordinateRaw, parseEllipseRadiiFromCoordinateRaw } from "../semantic/path/parsers.js";
import { parseLength } from "../semantic/coords/parse-length.js";
import { applyMatrix } from "../semantic/transform.js";
import { computeSourceFingerprint } from "../utils/source-fingerprint.js";
import { planAlignDeltas, planDistributeDeltas, type AlignMode, type DistributeAxis } from "./arrange.js";
import { collectSourceWorldBounds } from "./snapping/index.js";
import { localToSourceUnits, worldToLocal } from "./coords.js";
import {
  applyOptionMutationsToTarget,
  normalizeOptionKey,
  rewriteOptionListMutations,
  serializeOptionEntry,
  type OptionMutation,
  type OptionMutationApplyResult
} from "./option-mutations.js";
import {
  applyTextReplacements,
  lineIndentAtOffset,
  parseStatementSnapshot,
  resolveStatementRefs,
  type StatementRef
} from "./statement-ops.js";
import {
  analyzeExplicitPathStatement,
  buildPathBodyFromSegments,
  buildStatementText,
  resolveActivePathPointHandle,
  resolveEligibleExplicitPath,
  resolvePathControlHandle,
  type ExplicitPathAnalysis,
  type PathPointKind
} from "./path-editing.js";
import { applyAdornmentSetProperty } from "./actions/adornment-set-property.js";
import {
  applyMovePathAttachedNodeAction,
  type MovePathAttachedNodeAction
} from "./actions/path-attached-node-actions.js";
import {
  applyAddNodeAdornmentAction,
  applyDuplicateAdornmentAction,
  applyMoveAdornmentAction
} from "./actions/adornment-actions.js";
import { applyDeleteAdornmentAction, applyDeleteElementsAction } from "./actions/delete-elements.js";
import {
  applyDuplicateElementsAction,
  applyPasteStatementsAction
} from "./actions/paste-duplicate.js";
import {
  applyAppendToPathAction,
  applyDeletePathPointAction,
  applyInsertPathPointAction,
  applyJoinPathsAction,
  applyReversePathAction,
  applySetPathPointKindAction,
  applySplitPathAction,
  applyToggleClosedPathAction
} from "./actions/path-editing-actions.js";
import {
  applyAlignElementsAction,
  applyDistributeElementsAction,
  applyMoveElementsAction
} from "./actions/move-arrange-actions.js";
import { applyReorderElementsAction, buildParentReorderReplacement } from "./actions/reorder-elements.js";
import { applyResizeElementAction } from "./actions/resize-element.js";
import { applySetPropertyAction } from "./actions/set-property.js";
import { applyGroupElementsAction, applyUngroupElementsAction } from "./actions/group-ungroup-actions.js";
import { applyRepeatElementsAction } from "./actions/repeat.js";
import {
  applyAddTreeChildAction,
  applyAddTreeSiblingAction,
  applyRemoveTreeChildAction
} from "./actions/tree-child-actions.js";
import {
  applyAddMatrixColumnAction,
  applyAddMatrixRowAction,
  applyRemoveMatrixColumnAction,
  applyRemoveMatrixRowAction,
  applyTransposeMatrixAction
} from "./actions/matrix-structure-actions.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";
import { patchesMatchSourceTransition } from "./source-patches.js";

export type ResizeRole =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top"
  | "bottom"
  | "left"
  | "right";

export type StyleLevel = "command" | "scope" | "named-style" | "preamble";
export type { ElementTemplate } from "./element-templates.js";
export type ReorderDirection = "sendToBack" | "sendBackward" | "bringForward" | "bringToFront";
export { ADORNMENT_EDIT_NOOP_REASON } from "./actions/adornment-set-property.js";
export { PATH_ATTACHED_NODE_EDIT_NOOP_REASON } from "./actions/path-attached-node-actions.js";

export type EditAction =
  | { kind: "moveElement"; elementId: string; delta: Point }
  | { kind: "moveElements"; elementIds: string[]; delta: Point }
  | { kind: "alignElements"; elementIds: string[]; mode: AlignMode }
  | { kind: "distributeElements"; elementIds: string[]; axis: DistributeAxis }
  | { kind: "moveHandle"; handleId: string; newWorld: Point }
  | { kind: "connectHandle"; handleId: string; nodeName: string; anchor: string }
  | { kind: "splitPath"; elementId: string; handleId: string }
  | { kind: "joinPaths"; elementIds: [string, string] }
  | { kind: "reversePath"; elementId: string }
  | { kind: "toggleClosedPath"; elementId: string; closed: boolean }
  | { kind: "deletePathPoint"; elementId: string; handleId: string }
  | { kind: "setPathPointKind"; elementId: string; handleId: string; pointKind: PathPointKind }
  | { kind: "appendToPath"; elementId: string; end: "start" | "end"; segmentSource: string }
  | { kind: "insertPathPoint"; elementId: string; segmentIndex: number; point: Point }
  | {
      kind: "setProperty";
      elementId: string;
      level: StyleLevel;
      key: string;
      value: string;
      clearKeys?: string[];
      commentMode?: "disable" | "enable";
      commentSourceText?: string;
    }
  | { kind: "updateNodeText"; elementId: string; text: string }
  | { kind: "addElement"; template: ElementTemplate; at: Point }
  | { kind: "deleteElement"; elementId: string }
  | { kind: "deleteElements"; elementIds: string[] }
  | { kind: "deleteAdornment"; targetId: string }
  | { kind: "pasteStatements"; snippets: string[]; anchorElementId?: string; delta?: Point }
  | { kind: "duplicateElements"; elementIds: string[]; delta?: Point }
  | { kind: "duplicateAdornment"; targetId: string }
  | { kind: "moveAdornment"; targetId: string; ownerPoint: Point; newWorld: Point; angleRaw?: string; distancePt?: number }
  | MovePathAttachedNodeAction
  | { kind: "addNodeAdornment"; nodeId: string; adornmentKind: "label" | "pin"; angle: string; text: string }
  | { kind: "reorderElements"; elementIds: string[]; direction: ReorderDirection }
  | { kind: "groupElements"; elementIds: string[] }
  | { kind: "ungroupElements"; elementIds: string[] }
  | {
      kind: "repeatElements";
      elementIds: string[];
      columns: number;
      rows: number;
      horizontalStep: number;
      verticalStep: number;
    }
  | { kind: "addTreeChild"; parentSourceId: string; afterChildIndex?: number }
  | { kind: "removeTreeChild"; childSourceId: string }
  | { kind: "addTreeSibling"; siblingSourceId: string; position: "before" | "after" }
  | { kind: "addMatrixRow"; matrixSourceId: string; rowIndex: number }
  | { kind: "removeMatrixRow"; matrixSourceId: string; rowIndex: number }
  | { kind: "addMatrixColumn"; matrixSourceId: string; columnIndex: number }
  | { kind: "removeMatrixColumn"; matrixSourceId: string; columnIndex: number }
  | { kind: "transposeMatrix"; matrixSourceId: string }
  | {
      kind: "resizeElement";
      elementId: string;
      role: ResizeRole;
      newWorld: Point;
      preserveAspect?: boolean;
      preserveAspectRatio?: number;
      referenceBounds?: {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
      };
      referenceScopeTransform?: {
        xscale: number;
        yscale: number;
        xshift: number;
        yshift: number;
      };
    };

export type EditActionResult =
  | { kind: "success"; newSource: string; patches: SourcePatch[]; selectedSourceIds?: string[]; changedSourceIds?: string[] }
  | {
      kind: "partial";
      newSource: string;
      patches: SourcePatch[];
      skippedHandles: string[];
      reason: string;
      selectedSourceIds?: string[];
      changedSourceIds?: string[];
    }
  | { kind: "unsupported"; reason: string }
  | { kind: "error"; message: string };

const DEFAULT_DUPLICATE_OFFSET_PT = 0.25 * PT_PER_CM;
const ARRANGE_EPSILON = 1e-6;
const RESIZE_EPSILON = 1e-3;

type EditActionApplyOptions = {
  evaluateOptions?: EvaluateOptions;
  parseOptions?: EditParseOptions;
};

export function applyEditAction(
  source: string,
  editHandles: EditHandle[],
  action: EditAction,
  options: EditActionApplyOptions = {}
): EditActionResult {
  const evaluateOptions = options.evaluateOptions;
  const parseOptions = options.parseOptions ?? {};
  const rawResult = (() : EditActionResult => {
    switch (action.kind) {
      case "moveHandle":
        return applyMoveHandle(source, editHandles, action.handleId, action.newWorld, parseOptions);
      case "connectHandle":
        return applyConnectHandle(source, editHandles, action.handleId, action.nodeName, action.anchor, parseOptions);
      case "splitPath":
        return applySplitPath(source, editHandles, action, parseOptions);
      case "joinPaths":
        return applyJoinPaths(source, action, parseOptions);
      case "reversePath":
        return applyReversePath(source, action, parseOptions);
      case "toggleClosedPath":
        return applyToggleClosedPath(source, action, parseOptions);
      case "deletePathPoint":
        return applyDeletePathPoint(source, editHandles, action, parseOptions);
      case "setPathPointKind":
        return applySetPathPointKind(source, editHandles, action, parseOptions);
      case "appendToPath":
        return applyAppendToPathAction(source, action, parseOptions);
      case "insertPathPoint":
        return applyInsertPathPointAction(source, editHandles, action, parseOptions);
      case "moveElement":
        return applyMoveElements(source, editHandles, [action.elementId], action.delta, parseOptions);
      case "moveElements":
        return applyMoveElements(source, editHandles, action.elementIds, action.delta, parseOptions);
      case "alignElements":
        return applyAlignElements(source, action, parseOptions);
      case "distributeElements":
        return applyDistributeElements(source, action, parseOptions);
      case "setProperty":
        return applySetProperty(source, action, parseOptions);
      case "updateNodeText":
        return applyUpdateNodeText(source, action, parseOptions);
      case "addElement":
        return applyAddElement(source, action.template, action.at);
      case "deleteElement":
        return applyDeleteElementsAction(source, [action.elementId], parseOptions);
      case "deleteElements":
        return applyDeleteElementsAction(source, action.elementIds, parseOptions);
      case "deleteAdornment":
        return applyDeleteAdornmentAction(source, action.targetId, parseOptions);
      case "pasteStatements":
        return applyPasteStatements(source, action, parseOptions);
      case "duplicateElements":
        return applyDuplicateElements(source, action, parseOptions);
      case "duplicateAdornment":
        return applyDuplicateAdornment(source, action.targetId, parseOptions);
      case "moveAdornment":
        return applyMoveAdornmentAction(source, action, parseOptions);
      case "movePathAttachedNode":
        return applyMovePathAttachedNodeAction(source, action, parseOptions);
      case "addNodeAdornment":
        return applyAddNodeAdornmentAction(source, action, parseOptions);
      case "reorderElements":
        return applyReorderElementsAction(source, action.elementIds, action.direction, parseOptions);
      case "groupElements":
        return applyGroupElements(source, action, parseOptions);
      case "ungroupElements":
        return applyUngroupElements(source, action, parseOptions);
      case "repeatElements":
        return applyRepeatElementsAction(source, action, parseOptions);
      case "addTreeChild":
        return applyAddTreeChildAction(source, action, parseOptions);
      case "removeTreeChild":
        return applyRemoveTreeChildAction(source, action, parseOptions);
      case "addTreeSibling":
        return applyAddTreeSiblingAction(source, action, parseOptions);
      case "addMatrixRow":
        return applyAddMatrixRowAction(source, action, parseOptions);
      case "removeMatrixRow":
        return applyRemoveMatrixRowAction(source, action, parseOptions);
      case "addMatrixColumn":
        return applyAddMatrixColumnAction(source, action, parseOptions);
      case "removeMatrixColumn":
        return applyRemoveMatrixColumnAction(source, action, parseOptions);
      case "transposeMatrix":
        return applyTransposeMatrixAction(source, action, parseOptions);
      case "resizeElement":
        return applyResizeElement(source, action, evaluateOptions, parseOptions);
    }
  })();
  const normalizedResult = normalizeResultPatches(source, rawResult);
  return withChangedSourceIds(normalizedResult, action, editHandles);
}

function normalizeResultPatches(source: string, result: EditActionResult): EditActionResult {
  if (result.kind !== "success" && result.kind !== "partial") {
    return result;
  }

  if (patchesMatchSourceTransition(source, result.newSource, result.patches)) {
    return result;
  }

  return {
    ...result,
    patches: [computeReplacementPatch(source, result.newSource)]
  };
}

function applyMoveHandle(
  source: string,
  editHandles: EditHandle[],
  handleId: string,
  newWorld: Point,
  parseOptions: EditParseOptions
): EditActionResult {
  const result = applyEditIntent(source, editHandles, { kind: "move", handleId, newWorld }, parseOptions);
  if (result.kind === "success") {
    return {
      kind: "success",
      newSource: result.newSource,
      patches: result.patches,
      changedSourceIds: result.changedSourceIds
    };
  }
  if (result.kind === "unsupported") {
    return { kind: "unsupported", reason: result.reason };
  }
  return { kind: "error", message: result.message };
}

function applyConnectHandle(
  source: string,
  editHandles: EditHandle[],
  handleId: string,
  nodeName: string,
  anchor: string,
  parseOptions: EditParseOptions
): EditActionResult {
  const handle = editHandles.find((candidate) => candidate.id === handleId);
  if (!handle) {
    return { kind: "error", message: `Handle not found: ${handleId}` };
  }

  const sourceFingerprint = computeSourceFingerprint(source);
  if (handle.sourceRef.sourceFingerprint !== sourceFingerprint) {
    return { kind: "error", message: "Handle does not match current source (stale handle)." };
  }

  if (handle.curveEdit) {
    return {
      kind: "unsupported",
      reason: "Only concrete path endpoint coordinates can be connected to node anchors."
    };
  }
  if (handle.kind !== "path-point") {
    return {
      kind: "unsupported",
      reason: "Only path endpoint handles can be connected to node anchors."
    };
  }

  if (
    handle.sourceRef.sourceSpan.from < 0 ||
    handle.sourceRef.sourceSpan.to > source.length ||
    handle.sourceRef.sourceSpan.from >= handle.sourceRef.sourceSpan.to
  ) {
    return {
      kind: "unsupported",
      reason: "Handle does not point to a concrete coordinate span in source."
    };
  }

  if (isSharedExpandedHandleSpan(handle, editHandles)) {
    return {
      kind: "unsupported",
      reason: "Handle span is shared by expanded statements (foreach/macro), cannot connect safely."
    };
  }

  const currentSourceText = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
  if (currentSourceText !== handle.sourceText) {
    return { kind: "error", message: "Handle span content mismatch (stale handle)." };
  }

  const trimmedNodeName = nodeName.trim();
  if (trimmedNodeName.length === 0) {
    return { kind: "error", message: "Node name is required for endpoint connection." };
  }

  const trimmedAnchor = anchor.trim().toLowerCase();
  if (trimmedAnchor.length === 0) {
    return { kind: "error", message: "Anchor is required for endpoint connection." };
  }

  const replacement =
    trimmedAnchor === "center"
      ? `(${trimmedNodeName})`
      : `(${trimmedNodeName}.${trimmedAnchor})`;
  const updated = replaceSpan(source, handle.sourceRef.sourceSpan, replacement);
  const reordered = moveStatementAfterNamedDefinition(
    updated.source,
    handle.sourceRef.sourceId,
    trimmedNodeName,
    parseOptions
  );
  const reorderedPatches = reordered ? reordered.patches : [];
  const newSource = reordered?.source ?? updated.source;
  return {
    kind: "success",
    newSource,
    patches: [
      {
        oldSpan: handle.sourceRef.sourceSpan,
        newSpan: updated.changedSpan,
        replacement
      },
      ...reorderedPatches
    ],
    // Reordering can renumber statement source ids, so avoid stale id hints.
    // Returning [] forces the drag path to use full recompute for this frame.
    changedSourceIds: reordered ? [] : [handle.sourceRef.sourceId]
  };
}

function applySplitPath(
  source: string,
  editHandles: EditHandle[],
  action: Extract<EditAction, { kind: "splitPath" }>,
  parseOptions: EditParseOptions
): EditActionResult {
  return applySplitPathAction(source, editHandles, action, parseOptions);
}

function applyJoinPaths(
  source: string,
  action: Extract<EditAction, { kind: "joinPaths" }>,
  parseOptions: EditParseOptions
): EditActionResult {
  return applyJoinPathsAction(source, action, { normalizeElementIds }, parseOptions);
}

function applyToggleClosedPath(
  source: string,
  action: Extract<EditAction, { kind: "toggleClosedPath" }>,
  parseOptions: EditParseOptions
): EditActionResult {
  return applyToggleClosedPathAction(source, action, parseOptions);
}

function applyReversePath(
  source: string,
  action: Extract<EditAction, { kind: "reversePath" }>,
  parseOptions: EditParseOptions
): EditActionResult {
  return applyReversePathAction(source, action, parseOptions);
}

function applyDeletePathPoint(
  source: string,
  editHandles: EditHandle[],
  action: Extract<EditAction, { kind: "deletePathPoint" }>,
  parseOptions: EditParseOptions
): EditActionResult {
  return applyDeletePathPointAction(source, editHandles, action, parseOptions);
}

function applySetPathPointKind(
  source: string,
  editHandles: EditHandle[],
  action: Extract<EditAction, { kind: "setPathPointKind" }>,
  parseOptions: EditParseOptions
): EditActionResult {
  return applySetPathPointKindAction(source, editHandles, action, parseOptions);
}

function applyMoveElements(
  source: string,
  editHandles: EditHandle[],
  elementIds: readonly string[],
  delta: Point,
  parseOptions: EditParseOptions = {}
): EditActionResult {
  return applyMoveElementsAction(source, editHandles, elementIds, delta, parseOptions);
}

function applyAlignElements(
  source: string,
  action: Extract<EditAction, { kind: "alignElements" }>,
  parseOptions: EditParseOptions
): EditActionResult {
  return applyAlignElementsAction(source, action, parseOptions);
}

function applyDistributeElements(
  source: string,
  action: Extract<EditAction, { kind: "distributeElements" }>,
  parseOptions: EditParseOptions
): EditActionResult {
  return applyDistributeElementsAction(source, action, parseOptions);
}

function applyPasteStatements(
  source: string,
  action: Extract<EditAction, { kind: "pasteStatements" }>,
  parseOptions: EditParseOptions
): EditActionResult {
  return applyPasteStatementsAction(source, action, {
    applyMoveElements,
    normalizeElementIds,
    uniqueStrings,
    defaultDuplicateOffsetPt: DEFAULT_DUPLICATE_OFFSET_PT
  }, parseOptions);
}

function applyDuplicateElements(
  source: string,
  action: Extract<EditAction, { kind: "duplicateElements" }>,
  parseOptions: EditParseOptions
): EditActionResult {
  return applyDuplicateElementsAction(source, action, {
    applyMoveElements,
    normalizeElementIds,
    uniqueStrings,
    defaultDuplicateOffsetPt: DEFAULT_DUPLICATE_OFFSET_PT
  }, parseOptions);
}

function applyDuplicateAdornment(source: string, targetId: string, parseOptions: EditParseOptions): EditActionResult {
  return applyDuplicateAdornmentAction(source, targetId, parseOptions);
}

function applyGroupElements(
  source: string,
  action: Extract<EditAction, { kind: "groupElements" }>,
  parseOptions: EditParseOptions
): EditActionResult {
  return applyGroupElementsAction(source, action.elementIds, parseOptions);
}

function applyUngroupElements(
  source: string,
  action: Extract<EditAction, { kind: "ungroupElements" }>,
  parseOptions: EditParseOptions
): EditActionResult {
  return applyUngroupElementsAction(source, action.elementIds, parseOptions);
}



function detectPreferredNewline(source: string, aroundOffset: number): string {
  const windowStart = Math.max(0, aroundOffset - 256);
  const windowEnd = Math.min(source.length, aroundOffset + 256);
  const window = source.slice(windowStart, windowEnd);
  if (window.includes("\r\n")) {
    return "\r\n";
  }
  return "\n";
}

function normalizeElementIds(elementIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const elementId of elementIds) {
    if (typeof elementId !== "string") {
      continue;
    }
    const id = elementId.trim();
    if (id.length === 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

function findPathStatementById(
  statements: readonly Statement[],
  elementId: string
): Extract<Statement, { kind: "Path" }> | null {
  for (const statement of statements) {
    if (statement.kind === "Path" && statement.id === elementId) {
      return statement;
    }
    if (statement.kind === "Scope") {
      const nested = findPathStatementById(statement.body, elementId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function withChangedSourceIds(
  result: EditActionResult,
  action: EditAction,
  editHandles: EditHandle[]
): EditActionResult {
  if (result.kind !== "success" && result.kind !== "partial") {
    return result;
  }

  if ("changedSourceIds" in result && result.changedSourceIds !== undefined) {
    return result;
  }

  const changedSourceIds = inferChangedSourceIds(result, action, editHandles);
  if (changedSourceIds.length === 0) {
    return result;
  }

  return {
    ...result,
    changedSourceIds
  };
}

function inferChangedSourceIds(
  result: Extract<EditActionResult, { kind: "success" | "partial" }>,
  action: EditAction,
  editHandles: EditHandle[]
): string[] {
  switch (action.kind) {
    case "moveElement":
      return normalizeElementIds([action.elementId]);
    case "moveElements":
      return normalizeElementIds(action.elementIds);
    case "splitPath":
      return normalizeElementIds([action.elementId]);
    case "joinPaths":
      return normalizeElementIds(action.elementIds);
    case "reversePath":
      return normalizeElementIds([action.elementId]);
    case "toggleClosedPath":
      return normalizeElementIds([action.elementId]);
    case "deletePathPoint":
      return normalizeElementIds([action.elementId]);
    case "setPathPointKind":
      return normalizeElementIds([action.elementId]);
    case "alignElements":
      return normalizeElementIds(action.elementIds);
    case "distributeElements":
      return normalizeElementIds(action.elementIds);
    case "moveHandle": {
      const handle = editHandles.find((candidate) => candidate.id === action.handleId);
      return handle ? normalizeElementIds([handle.sourceRef.sourceId]) : [];
    }
    case "connectHandle": {
      const handle = editHandles.find((candidate) => candidate.id === action.handleId);
      return handle ? normalizeElementIds([handle.sourceRef.sourceId]) : [];
    }
    case "addElement":
    case "pasteStatements":
      return normalizeElementIds(result.selectedSourceIds ?? []);
    case "duplicateElements":
      return normalizeElementIds(result.selectedSourceIds ?? action.elementIds);
    case "duplicateAdornment":
      return normalizeElementIds([action.targetId]);
    case "deleteElement":
      return normalizeElementIds([action.elementId]);
    case "deleteElements":
      return normalizeElementIds(action.elementIds);
    case "deleteAdornment":
      return normalizeElementIds([action.targetId]);
    case "moveAdornment":
      return normalizeElementIds([action.targetId]);
    case "movePathAttachedNode":
      return normalizeElementIds([action.nodeId, action.hostPathSourceId]);
    case "addNodeAdornment":
      return normalizeElementIds([action.nodeId]);
    case "reorderElements":
      return normalizeElementIds(action.elementIds);
    case "groupElements":
      return [];
    case "ungroupElements":
      return [];
    case "repeatElements":
      return normalizeElementIds(action.elementIds);
    case "addTreeChild":
      return normalizeElementIds([action.parentSourceId]);
    case "removeTreeChild":
      return normalizeElementIds([action.childSourceId]);
    case "addTreeSibling":
      return normalizeElementIds([action.siblingSourceId]);
    case "addMatrixRow":
      return normalizeElementIds([action.matrixSourceId]);
    case "removeMatrixRow":
      return normalizeElementIds([action.matrixSourceId]);
    case "addMatrixColumn":
      return normalizeElementIds([action.matrixSourceId]);
    case "removeMatrixColumn":
      return normalizeElementIds([action.matrixSourceId]);
    case "transposeMatrix":
      return normalizeElementIds([action.matrixSourceId]);
    case "setProperty":
      return normalizeElementIds([action.elementId]);
    case "updateNodeText":
      return normalizeElementIds([action.elementId]);
    case "resizeElement":
      return normalizeElementIds([action.elementId]);
    case "appendToPath":
      return normalizeElementIds([action.elementId]);
    case "insertPathPoint":
      return normalizeElementIds([action.elementId]);
  }
}

function resolveNodeTextSpanForElementId(
  source: string,
  elementId: string,
  parseOptions: EditParseOptions
): Span | null {
  const normalizedId = elementId.trim();
  if (normalizedId.length === 0) {
    return null;
  }

  const resolvedTarget = resolvePropertyTarget(source, normalizedId, parseOptions);
  if (resolvedTarget.kind === "found" && resolvedTarget.target.textSpan) {
    return resolvedTarget.target.textSpan;
  }

  const statementSnapshot = parseStatementSnapshot(source, parseOptions);
  const statementRef = statementSnapshot.byId.get(normalizedId);
  if (statementRef?.statement.kind === "Path" && statementRef.statement.command === "node") {
    const nodeItem = statementRef.statement.items.find((item) => item.kind === "Node");
    if (nodeItem?.kind === "Node") {
      return nodeItem.textSpan;
    }
  }

  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  const stack: Statement[] = [...parsed.figure.body];
  while (stack.length > 0) {
    const statement = stack.shift();
    if (!statement) {
      continue;
    }
    if (statement.kind === "Scope") {
      stack.unshift(...statement.body);
      continue;
    }
    if (statement.kind !== "Path") {
      continue;
    }
    if (statement.command === "node" && statement.id === normalizedId) {
      const nodeItem = statement.items.find((item) => item.kind === "Node");
      if (nodeItem?.kind === "Node") {
        return nodeItem.textSpan;
      }
    }
    for (const item of statement.items) {
      if (item.kind === "Node" && item.id === normalizedId) {
        return item.textSpan;
      }
    }
  }

  return null;
}

function isSharedExpandedHandleSpan(
  handle: EditHandle,
  editHandles: readonly EditHandle[]
): boolean {
  return editHandles.some(
    (candidate) =>
      candidate.id !== handle.id &&
      candidate.sourceRef.sourceSpan.from === handle.sourceRef.sourceSpan.from &&
      candidate.sourceRef.sourceSpan.to === handle.sourceRef.sourceSpan.to
  );
}

function moveStatementAfterNamedDefinition(
  source: string,
  movingStatementId: string,
  name: string,
  parseOptions: EditParseOptions = {}
): { source: string; patches: SourcePatch[] } | null {
  const snapshot = parseStatementSnapshot(source, parseOptions);
  const movingRef = snapshot.byId.get(movingStatementId);
  if (!movingRef) {
    return null;
  }

  const producerId = findNamedDefinitionStatementId(snapshot, name);
  if (!producerId || producerId === movingStatementId) {
    return null;
  }

  const producerRef = snapshot.byId.get(producerId);
  if (!producerRef) {
    return null;
  }

  if (movingRef.parentKey !== producerRef.parentKey) {
    return null;
  }

  if (movingRef.index > producerRef.index) {
    return null;
  }

  const parentRefs = snapshot.byParentKey.get(movingRef.parentKey) ?? [];
  if (parentRefs.length <= 1) {
    return null;
  }

  const ids = parentRefs.map((ref) => ref.id);
  const movingIndex = ids.indexOf(movingStatementId);
  const producerIndex = ids.indexOf(producerId);
  if (movingIndex < 0 || producerIndex < 0 || movingIndex > producerIndex) {
    return null;
  }

  const withoutMoving = ids.filter((id) => id !== movingStatementId);
  const producerIndexInFiltered = withoutMoving.indexOf(producerId);
  if (producerIndexInFiltered < 0) {
    return null;
  }
  const nextOrder = [...withoutMoving];
  nextOrder.splice(producerIndexInFiltered + 1, 0, movingStatementId);
  if (arraysEqual(ids, nextOrder)) {
    return null;
  }

  const replacement = buildParentReorderReplacement(snapshot.source, parentRefs, nextOrder);
  if (!replacement) {
    return null;
  }

  const applied = applyTextReplacements(source, [
    {
      span: replacement.span,
      text: replacement.text
    }
  ]);
  if (applied.patches.length === 0) {
    return null;
  }

  return {
    source: applied.source,
    patches: applied.patches
  };
}

function findNamedDefinitionStatementId(
  snapshot: ReturnType<typeof parseStatementSnapshot>,
  name: string
): string | null {
  const normalized = normalizeNodeNameCandidate(name);
  if (!normalized) {
    return null;
  }

  for (const ref of snapshot.all) {
    if (statementDeclaresName(ref.statement, normalized)) {
      return ref.id;
    }
  }

  return null;
}

function statementDeclaresName(statement: Statement, name: string): boolean {
  if (statement.kind !== "Path") {
    return false;
  }
  for (const item of statement.items) {
    if (item.kind === "Node") {
      if (normalizeNodeNameCandidate(item.name) === name) {
        return true;
      }
      const aliases = item.aliases ?? [];
      for (const alias of aliases) {
        if (normalizeNodeNameCandidate(alias) === name) {
          return true;
        }
      }
      continue;
    }
    if (item.kind === "CoordinateOperation") {
      if (normalizeNodeNameCandidate(item.name) === name) {
        return true;
      }
    }
  }
  return false;
}

function normalizeNodeNameCandidate(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function applySetProperty(
  source: string,
  action: Extract<EditAction, { kind: "setProperty" }>,
  parseOptions: EditParseOptions
): EditActionResult {
  return applySetPropertyAction(source, action, parseOptions);
}

function applyUpdateNodeText(
  source: string,
  action: Extract<EditAction, { kind: "updateNodeText" }>,
  parseOptions: EditParseOptions
): EditActionResult {
  const textSpan = resolveNodeTextSpanForElementId(source, action.elementId, parseOptions);
  if (!textSpan) {
    return { kind: "unsupported", reason: `No editable node text target found for ${action.elementId}` };
  }
  const updated = replaceSpan(source, textSpan, action.text);
  if (updated.source === source) {
    return { kind: "unsupported", reason: "Node text update would not change the source." };
  }
  return {
    kind: "success",
    newSource: updated.source,
    patches: [
      {
        oldSpan: textSpan,
        newSpan: updated.changedSpan,
        replacement: action.text
      }
    ]
  };
}

function applyResizeElement(
  source: string,
  action: Extract<EditAction, { kind: "resizeElement" }>,
  evaluateOptions: EvaluateOptions | undefined,
  parseOptions: EditParseOptions
): EditActionResult {
  return applyResizeElementAction(source, action, evaluateOptions, parseOptions);
}

function applyAddElement(
  source: string,
  template: ElementTemplate,
  at: Point
): EditActionResult {
  const beforeStatements = parseStatementSnapshot(source);
  const snippet = generateElementSource(template, at);
  if (snippet.trim().length === 0) {
    return { kind: "error", message: "Failed to generate source for the requested element template." };
  }

  const newSource = insertElementIntoSource(source, snippet);
  if (newSource === source) {
    return { kind: "unsupported", reason: "The source insertion point could not be resolved." };
  }

  const afterStatements = parseStatementSnapshot(newSource);
  const insertedStatementId = afterStatements.all.find((ref) => !beforeStatements.byId.has(ref.id))?.id;

  return {
    kind: "success",
    newSource,
    patches: [computeReplacementPatch(source, newSource)],
    selectedSourceIds: insertedStatementId ? [insertedStatementId] : undefined
  };
}

function computeReplacementPatch(oldSource: string, newSource: string): SourcePatch {
  if (oldSource === newSource) {
    return {
      oldSpan: { from: 0, to: 0 },
      newSpan: { from: 0, to: 0 },
      replacement: ""
    };
  }

  const oldLen = oldSource.length;
  const newLen = newSource.length;
  const minLen = Math.min(oldLen, newLen);

  let prefix = 0;
  while (prefix < minLen && oldSource.charCodeAt(prefix) === newSource.charCodeAt(prefix)) {
    prefix += 1;
  }

  let oldSuffix = oldLen;
  let newSuffix = newLen;
  while (
    oldSuffix > prefix &&
    newSuffix > prefix &&
    oldSource.charCodeAt(oldSuffix - 1) === newSource.charCodeAt(newSuffix - 1)
  ) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }

  return {
    oldSpan: { from: prefix, to: oldSuffix },
    newSpan: { from: prefix, to: newSuffix },
    replacement: newSource.slice(prefix, newSuffix)
  };
}
