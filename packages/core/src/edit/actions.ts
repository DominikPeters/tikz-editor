import { ADORNMENT_EDIT_NOOP_REASON } from "./actions/adornment-set-property.js";
import { PATH_ATTACHED_NODE_EDIT_NOOP_REASON } from "./actions/path-attached-node-actions.js";
import type { EditGeometrySession } from "./geometry-session.js";
import { advanceIdentityMoves, collectIdentitySpans, geometryIdentityMoves, type IdentityMove } from "./identity-provenance.js";
import type {
  EditHandle,
  EvaluateOptions
} from "../semantic/types.js";
import type { WorldPoint, WorldBounds } from "../coords/points.js";
import type { NodeItem, PathItem, PathStatement, Statement, Span } from "../ast/types.js";
import type { SourcePatch } from "./types.js";
import { applyEditIntent } from "./apply.js";
import { computeMinimalReplacementPatch, replaceSpan } from "./patch.js";
import { PT_PER_CM, type DragFormatPrecision } from "./format.js";
import {
  generateElementSource,
  insertElementIntoSource,
  type AnchorReference,
  type ElementTemplate
} from "./element-templates.js";
import { changedSourceIdsForPropertyTarget, resolvePropertyTarget } from "./property-target.js";
import type { AlignMode, DistributeAxis } from "./arrange.js";
import {
  applyTextReplacements,
  parseStatementSnapshot
} from "./statement-ops.js";
import { normalizeElementIds, uniqueStrings } from "./statement-find.js";
import type { PathPointKind } from "./path-editing.js";
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
  applyMoveElementsAction,
  type MoveElementsBaseline
} from "./actions/move-arrange-actions.js";
import { applyReorderElementsAction, buildParentReorderReplacement } from "./actions/reorder-elements.js";
import { applyResizeElementAction, type PathRectangleResizeBaseline } from "./actions/resize-element.js";
import {
  applyRotateElementAction,
  type RotateElementAction
} from "./actions/rotate-element.js";
import {
  applyPlannedSetPropertyAction,
  cleanupIdiomaticPropertyWrites,
  PROPERTY_WRITE_CLEANUP_NOOP_REASON
} from "./property-write-planner.js";
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
import {
  applyConvertNodePositionToAbsoluteAction,
  applyPositionNodeRelativeToAction,
  preflightPositionNodeRelativeToAction as preflightPositionNodeRelativeToActionRaw,
  type ConvertNodePositionToAbsoluteAction,
  type PositionNodeRelativeToPreflight,
  type PositionNodeRelativeToAction
} from "./actions/node-positioning-actions.js";
import { parseTikzForEdit, sourceFingerprintForEdit, type EditParseOptions } from "./parse-options.js";
import { composeSourcePatches, patchesMatchSourceTransition } from "./source-patches.js";
import type { SemanticPropertyId } from "./property-registry.js";
import { flattenForeachInSource, type FlattenForeachTarget } from "../foreach/flatten.js";
import { applySetFigureBoundsAction, type SetFigureBoundsAction } from "./figure-bounds.js";

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
export { PROPERTY_WRITE_CLEANUP_NOOP_REASON };
export type { MoveElementsBaseline };

export type SetPropertyEditAction = {
  kind: "setProperty";
  elementId: string;
  level: StyleLevel;
  key: string;
  value: string;
  propertyId?: SemanticPropertyId;
  clearKeys?: string[];
  commentMode?: "disable" | "enable";
  commentSourceText?: string;
};

export type EditAction =
  | { kind: "setProperties"; actions: readonly SetPropertyEditAction[] }
  | { kind: "moveElement"; elementId: string; delta: WorldPoint; formatPrecision?: DragFormatPrecision }
  | { kind: "moveElements"; bypassSnapping?: boolean; elementIds: string[]; delta: WorldPoint; formatPrecision?: DragFormatPrecision; baseline?: MoveElementsBaseline }
  | { kind: "alignElements"; elementIds: string[]; mode: AlignMode }
  | { kind: "distributeElements"; elementIds: string[]; axis: DistributeAxis }
  | { kind: "moveHandle"; bypassSnapping?: boolean; handleId: string; newWorld: WorldPoint }
  | { kind: "connectHandle"; handleId: string; nodeName: string; nodeSourceId?: string; anchor: string }
  | { kind: "splitPath"; elementId: string; handleId: string }
  | { kind: "joinPaths"; elementIds: [string, string] }
  | { kind: "reversePath"; elementId: string }
  | { kind: "toggleClosedPath"; elementId: string; closed: boolean }
  | { kind: "deletePathPoint"; elementId: string; handleId: string }
  | { kind: "setPathPointKind"; elementId: string; handleId: string; pointKind: PathPointKind }
  | { kind: "appendToPath"; elementId: string; end: "start" | "end"; segmentSource: string }
  | { kind: "insertPathPoint"; elementId: string; segmentIndex: number; point: WorldPoint }
  | SetPropertyEditAction
  | RotateElementAction
  | { kind: "updateNodeText"; elementId: string; text: string }
  | SetFigureBoundsAction
  | { kind: "cleanupPropertyWrites"; elementIds?: string[] }
  | { kind: "addElement"; template: ElementTemplate; at: WorldPoint }
  | { kind: "deleteElement"; elementId: string }
  | { kind: "deleteElements"; elementIds: string[] }
  | { kind: "deleteAdornment"; targetId: string }
  | { kind: "pasteStatements"; snippets: string[]; anchorElementId?: string; delta?: WorldPoint }
  | { kind: "duplicateElements"; elementIds: string[]; delta?: WorldPoint }
  | { kind: "duplicateAdornment"; targetId: string }
  | {
      kind: "moveAdornment";
      targetId: string;
      ownerPoint: WorldPoint;
      newWorld: WorldPoint;
      angleRaw?: string;
      distancePt?: number;
      formatPrecision?: DragFormatPrecision;
    }
  | MovePathAttachedNodeAction
  | { kind: "addNodeAdornment"; nodeId: string; adornmentKind: "label" | "pin"; angle: string; text: string }
  | PositionNodeRelativeToAction
  | ConvertNodePositionToAbsoluteAction
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
  | { kind: "flattenForeach"; target: FlattenForeachTarget; recursive?: boolean; maxExpansions?: number }
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
      rectangleBaseline?: PathRectangleResizeBaseline;
      elementId: string;
      role: ResizeRole;
      newWorld: WorldPoint;
      preserveAspect?: boolean;
      preserveAspectRatio?: number;
      formatPrecision?: DragFormatPrecision;
      referenceBounds?: WorldBounds;
      referenceScopeTransform?: {
        xscale: number;
        yscale: number;
        xshift: number;
        yshift: number;
      };
    };

export type { EditActionResultLike as EditActionResult } from "./result-types.js";
import type { EditActionResultLike as EditActionResult } from "./result-types.js";

const DEFAULT_DUPLICATE_OFFSET_PT = 0.25 * PT_PER_CM;
const GENERATED_NODE_NAME_RE = /(?:^|[^A-Za-z0-9_-])(node\d+)(?![A-Za-z0-9_-])/g;

export type EditActionApplyOptions = {
  geometry?: EditGeometrySession;
  evaluateOptions?: EvaluateOptions;
  parseOptions?: EditParseOptions;
};

export function preflightPositionNodeRelativeToAction(
  source: string,
  action: PositionNodeRelativeToAction,
  options: EditActionApplyOptions = {}
): PositionNodeRelativeToPreflight {
  const preflight = preflightPositionNodeRelativeToActionRaw(
    source,
    action,
    options.evaluateOptions,
    options.parseOptions ?? {},
    options.geometry
  );
  return {
    ...preflight,
    result: normalizeResultPatches(source, preflight.result)
  };
}

type AnchorNameResolution = {
  source: string;
  anchor: AnchorReference;
  insertedSpan?: Span;
  insertedLength: number;
};

export function applyEditAction(
  source: string,
  editHandles: EditHandle[],
  action: EditAction,
  options: EditActionApplyOptions = {}
): EditActionResult {
  const currentSource = source;
  const evaluateOptions = options.evaluateOptions;
  let parseOptions = options.parseOptions ?? {};
  const geometry = options.geometry;
  // Gesture positions are absolute (or total deltas). Always write from the
  // immutable baseline, then adapt patches to the current source below.
  if (geometry) {
    source = geometry.source;
    editHandles = geometry.semantic.editHandles;
    parseOptions = {
      ...parseOptions,
      analysisView: null,
      analysisSession: null,
      sourceFingerprint: geometry.semantic.editHandles[0]?.sourceRef.sourceFingerprint,
      preparedParse: { source, activeFigureId: parseOptions.activeFigureId, result: geometry.parsed }
    };
  }
  if ("bypassSnapping" in action) parseOptions = { ...parseOptions, bypassSnapping: action.bypassSnapping };
  const rawResult = (() : EditActionResult => {
    switch (action.kind) {
      case "moveHandle": {
        const initial = geometry?.semantic.editHandles.find(handle => handle.id === action.handleId);
        if (initial && Math.hypot(initial.world.x - action.newWorld.x, initial.world.y - action.newWorld.y) < 1e-9) {
          return { kind: "success", newSource: source, patches: [], changedSourceIds: [initial.sourceRef.sourceId] };
        }
        return applyMoveHandle(source, editHandles, action.handleId, action.newWorld, parseOptions);
      }
      case "connectHandle":
        return applyConnectHandle(source, editHandles, action.handleId, action.nodeName, action.nodeSourceId, action.anchor, parseOptions);
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
        return applyMoveElements(source, editHandles, [action.elementId], action.delta, parseOptions, action.formatPrecision, undefined, geometry);
      case "moveElements":
        return applyMoveElements(
          source,
          editHandles,
          action.elementIds,
          action.delta,
          parseOptions,
          action.formatPrecision,
          action.baseline,
          geometry
        );
      case "alignElements":
        return applyAlignElementsAction(source, action, parseOptions, geometry);
      case "distributeElements":
        return applyDistributeElementsAction(source, action, parseOptions, geometry);
      case "setProperty":
        return applySetProperty(source, action, parseOptions);
      case "setProperties": {
        let nextSource = source;
        const steps: SourcePatch[][] = [];
        const changedSourceIds = new Set<string>();
        const skippedHandles: string[] = [];
        for (const property of action.actions) {
          const result = applySetProperty(nextSource, property, parseOptions);
          if (result.kind === "unsupported" && result.reason === "setProperty would not change the source.") continue;
          if (result.kind !== "success" && result.kind !== "partial") return result;
          const normalized = normalizeResultPatches(nextSource, result);
          if (normalized.kind !== "success" && normalized.kind !== "partial") return normalized;
          steps.push(normalized.patches);
          nextSource = result.newSource;
          for (const id of result.changedSourceIds ?? [property.elementId]) changedSourceIds.add(id);
          if (result.kind === "partial") skippedHandles.push(...result.skippedHandles);
        }
        const patches = composeSourcePatches(source, steps);
        return skippedHandles.length > 0
          ? { kind: "partial", newSource: nextSource, patches, changedSourceIds: [...changedSourceIds], skippedHandles, reason: "Some property targets could not be edited." }
          : { kind: "success", newSource: nextSource, patches, changedSourceIds: [...changedSourceIds] };
      }
      case "rotateElement":
        return applyRotateElementAction(source, action, evaluateOptions, parseOptions, geometry);
      case "updateNodeText":
        return applyUpdateNodeText(source, action, parseOptions);
      case "setFigureBounds":
        return applySetFigureBoundsAction(source, action, parseOptions);
      case "cleanupPropertyWrites":
        return cleanupIdiomaticPropertyWrites(source, { ...parseOptions, propertyWriteMode: "drag-end" }, action.elementIds);
      case "addElement":
        return applyAddElement(source, action.template, action.at, parseOptions);
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
      case "positionNodeRelativeTo":
        return applyPositionNodeRelativeToAction(source, action, evaluateOptions, parseOptions, geometry);
      case "convertNodePositionToAbsolute":
        return applyConvertNodePositionToAbsoluteAction(source, action, evaluateOptions, parseOptions, geometry);
      case "reorderElements":
        return applyReorderElementsAction(source, action.elementIds, action.direction, parseOptions);
      case "groupElements":
        return applyGroupElementsAction(source, action.elementIds, parseOptions, geometry);
      case "ungroupElements":
        return applyUngroupElements(source, action, parseOptions);
      case "repeatElements":
        return applyRepeatElementsAction(source, action, parseOptions);
      case "flattenForeach":
        return applyFlattenForeachAction(source, action, parseOptions);
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
        return applyResizeElementAction(source, action, evaluateOptions, parseOptions, geometry);
    }
  })();
  let result = geometry && rawResult.kind === "unsupported" && (
    rawResult.reason === ADORNMENT_EDIT_NOOP_REASON ||
    rawResult.reason === PATH_ATTACHED_NODE_EDIT_NOOP_REASON ||
    rawResult.reason === "rotateElement would not change the source."
  ) ? { kind: "success" as const, newSource: source, patches: [] } : rawResult;
  if (geometry && (result.kind === "success" || result.kind === "partial") && (
    result.identityMoves || ["moveHandle", "connectHandle", "moveElement", "moveElements", "resizeElement", "rotateElement",
      "setProperty", "setProperties", "alignElements", "distributeElements", "updateNodeText", "cleanupPropertyWrites", "movePathAttachedNode"].includes(action.kind)
  )) {
    const baselineResult = normalizeResultPatches(source, result);
    if (baselineResult.kind === "success" || baselineResult.kind === "partial") {
      result = { ...result, identityMoves: geometryIdentityMoves(geometry, currentSource, result.newSource,
        baselineResult.patches, result.identityMoves), geometryBaseSource: geometry.source };
    }
  }
  return normalizeResultPatches(currentSource, result);
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
    patches: [computeMinimalReplacementPatch(source, result.newSource)]
  };
}

function applyFlattenForeachAction(
  source: string,
  action: Extract<EditAction, { kind: "flattenForeach" }>,
  parseOptions: EditParseOptions
): EditActionResult {
  const flattened = flattenForeachInSource(source, action.target, {
    recursive: action.recursive,
    maxExpansions: action.maxExpansions
  });

  if (flattened.kind === "unsupported") {
    return { kind: "unsupported", reason: flattened.reason };
  }
  if (flattened.kind === "error") {
    return { kind: "error", message: flattened.message };
  }

  const selectedSourceIds = collectSourceIdsInSpan(flattened.newSource, flattened.flattenedSpan, parseOptions);
  return {
    kind: "success",
    newSource: flattened.newSource,
    patches: flattened.patches,
    selectedSourceIds,
    changedSourceIds: selectedSourceIds
  };
}

function collectSourceIdsInSpan(
  source: string,
  span: Span,
  parseOptions: EditParseOptions
): string[] {
  const parsed = parseTikzForEdit(source, parseOptions);
  const ids: string[] = [];
  const seen = new Set<string>();

  const add = (id: string): void => {
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };

  const visitStatements = (statements: readonly Statement[]): void => {
    for (const statement of statements) {
      if (spanContains(span, statement.span)) {
        add(statement.id);
      }

      if (statement.kind === "Path") {
        if (!spanContains(span, statement.span) && spansOverlap(span, statement.span)) {
          visitPathItems(statement.items);
        }
        continue;
      }

      if (statement.kind === "Scope") {
        visitStatements(statement.body);
      }
    }
  };

  const visitPathItems = (items: readonly PathItem[]): void => {
    for (const item of items) {
      if (spanContains(span, item.span)) {
        add(item.id);
      }
      if (item.kind === "Node") {
        continue;
      }
      if (item.kind === "ChildOperation") {
        visitPathItems(item.body);
      }
    }
  };

  visitStatements(parsed.figure.body);
  return ids;
}

function spanContains(outer: Span, inner: Span): boolean {
  return inner.from >= outer.from && inner.to <= outer.to;
}

function spansOverlap(left: Span, right: Span): boolean {
  return left.from < right.to && right.from < left.to;
}

function applyMoveHandle(
  source: string,
  editHandles: EditHandle[],
  handleId: string,
  newWorld: WorldPoint,
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
  nodeSourceId: string | undefined,
  anchor: string,
  parseOptions: EditParseOptions
): EditActionResult {
  const handle = editHandles.find((candidate) => candidate.id === handleId);
  if (!handle) {
    return { kind: "error", message: `Handle not found: ${handleId}` };
  }

  const sourceFingerprint = sourceFingerprintForEdit(source, parseOptions);
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

  const nameResolution = resolveAnchorNodeName(source, { nodeName, nodeSourceId, anchor }, parseOptions);
  if (!nameResolution) {
    return { kind: "error", message: "Node name is required for endpoint connection." };
  }
  const trimmedNodeName = nameResolution.anchor.nodeName.trim();

  const trimmedAnchor = anchor.trim().toLowerCase();
  if (trimmedAnchor.length === 0) {
    return { kind: "error", message: "Anchor is required for endpoint connection." };
  }

  const replacement =
    trimmedAnchor === "center"
      ? `(${trimmedNodeName})`
      : `(${trimmedNodeName}.${trimmedAnchor})`;
  const adjustedHandleSpan = shiftSpan(handle.sourceRef.sourceSpan, nameResolution.insertedSpan, nameResolution.insertedLength);
  const updated = replaceSpan(nameResolution.source, adjustedHandleSpan, replacement);
  const reordered = moveStatementAfterNamedDefinition(
    updated.source,
    handle.sourceRef.sourceId,
    trimmedNodeName,
    parseOptions
  );
  const reorderedPatches = reordered ? reordered.patches : [];
  const newSource = reordered?.source ?? updated.source;
  let identityMoves = collectIdentitySpans(parseTikzForEdit(source, parseOptions).figure.body);
  if (nameResolution.insertedSpan) {
    const from = nameResolution.insertedSpan.from;
    identityMoves = advanceIdentityMoves(identityMoves, [{ oldSpan: nameResolution.insertedSpan,
      newSpan: { from, to: from + nameResolution.insertedLength },
      replacement: nameResolution.source.slice(from, from + nameResolution.insertedLength) }]);
  }
  identityMoves = advanceIdentityMoves(identityMoves, [{ oldSpan: adjustedHandleSpan, newSpan: updated.changedSpan, replacement }]);
  if (reordered) identityMoves = advanceIdentityMoves(identityMoves, reordered.patches, reordered.identityMoves);
  const patches = nameResolution.insertedSpan
    ? [computeMinimalReplacementPatch(source, newSource)]
    : [
        {
          oldSpan: handle.sourceRef.sourceSpan,
          newSpan: updated.changedSpan,
          replacement
        },
        ...reorderedPatches
      ];
  return {
    kind: "success",
    newSource,
    patches,
    identityMoves,
    // Reordering can renumber statement source ids, so avoid stale id hints.
    // Returning [] forces the drag path to use full recompute for this frame.
    changedSourceIds: reordered || nameResolution.insertedSpan ? [] : [handle.sourceRef.sourceId]
  };
}

function resolveElementTemplateAnchorNames(
  source: string,
  template: ElementTemplate,
  parseOptions: EditParseOptions
): { source: string; template: ElementTemplate } {
  if (template.kind !== "line") {
    return { source, template };
  }

  let currentSource = source;
  const namesBySourceId = new Map<string, string>();
  const resolve = (anchor: AnchorReference | undefined): AnchorReference | undefined => {
    if (!anchor) {
      return anchor;
    }
    const nodeSourceId = anchor.nodeSourceId?.trim() ?? "";
    if (!nodeSourceId || anchor.nodeName.trim()) {
      return anchor;
    }
    const existing = namesBySourceId.get(nodeSourceId);
    if (existing) {
      return { ...anchor, nodeName: existing };
    }
    const resolved = resolveAnchorNodeName(currentSource, anchor, parseOptions);
    if (!resolved) {
      return anchor;
    }
    currentSource = resolved.source;
    namesBySourceId.set(nodeSourceId, resolved.anchor.nodeName);
    return resolved.anchor;
  };

  const fromAnchor = resolve(template.fromAnchor);
  const toAnchor = resolve(template.toAnchor);
  return {
    source: currentSource,
    template: {
      ...template,
      fromAnchor,
      toAnchor
    }
  };
}

function resolveAnchorNodeName(
  source: string,
  anchor: AnchorReference,
  parseOptions: EditParseOptions
): AnchorNameResolution | null {
  const nodeName = anchor.nodeName.trim();
  if (nodeName) {
    return {
      source,
      anchor: { ...anchor, nodeName },
      insertedLength: 0
    };
  }

  const nodeSourceId = anchor.nodeSourceId?.trim() ?? "";
  if (!nodeSourceId) {
    return null;
  }
  const named = ensureNodeSourceHasName(source, nodeSourceId, parseOptions);
  if (!named) {
    return null;
  }
  return {
    source: named.source,
    anchor: { ...anchor, nodeName: named.name },
    insertedSpan: named.insertedSpan,
    insertedLength: named.insertedLength
  };
}

function ensureNodeSourceHasName(
  source: string,
  nodeSourceId: string,
  parseOptions: EditParseOptions
): { source: string; name: string; insertedSpan?: Span; insertedLength: number } | null {
  const snapshot = parseStatementSnapshot(source, parseOptions);
  const ref = snapshot.byId.get(nodeSourceId);
  if (ref?.statement.kind !== "Path") {
    return null;
  }
  const node = findNodeItemForSourceId(ref.statement, nodeSourceId);
  if (!node) {
    return null;
  }
  const existingName = node.name?.trim();
  if (existingName) {
    return { source, name: existingName, insertedLength: 0 };
  }

  const name = nextGeneratedNodeName(source);
  const insertAt = nodeNameInsertionOffset(source, ref.statement, node);
  if (insertAt == null) {
    return null;
  }
  const insertion = ` (${name})`;
  return {
    source: source.slice(0, insertAt) + insertion + source.slice(insertAt),
    name,
    insertedSpan: { from: insertAt, to: insertAt },
    insertedLength: insertion.length
  };
}

function findNodeItemForSourceId(statement: PathStatement, sourceId: string): NodeItem | null {
  const statementHasTreeChildren = statement.items.some((candidate) => candidate.kind === "ChildOperation");
  const isSyntheticTreeChildStatement = statement.id.includes(":tree-child:");
  for (const item of statement.items) {
    if (item.kind !== "Node") {
      continue;
    }
    const shouldUseStatementSourceId =
      item.adornment != null ||
      statement.command === "node" ||
      statementHasTreeChildren ||
      isSyntheticTreeChildStatement;
    const itemSourceId = shouldUseStatementSourceId ? statement.id : item.id;
    if (itemSourceId === sourceId) {
      return item;
    }
  }
  return null;
}

function nodeNameInsertionOffset(source: string, statement: PathStatement, node: NodeItem): number | null {
  if (statement.command === "node") {
    if (node.optionsSpan) {
      return node.optionsSpan.to;
    }
    if (statement.options) {
      const optionEnd = statement.options.entries.reduce((max, entry) => Math.max(max, entry.span.to), statement.span.from);
      const rawAfterOptions = source.slice(optionEnd, statement.span.to);
      const closeIndex = rawAfterOptions.indexOf("]");
      if (closeIndex >= 0) {
        return optionEnd + closeIndex + 1;
      }
    }
    const raw = source.slice(statement.span.from, statement.span.to);
    const match = /^\\node\b/u.exec(raw);
    if (match) {
      return statement.span.from + match[0].length;
    }
    return null;
  }
  if (node.optionsSpan) {
    return node.optionsSpan.to;
  }
  const raw = source.slice(node.span.from, node.span.to);
  const match = /^\\node\b/u.exec(raw);
  if (match) {
    return node.span.from + match[0].length;
  }
  return null;
}

function nextGeneratedNodeName(source: string): string {
  const used = new Set<string>();
  for (const match of source.matchAll(GENERATED_NODE_NAME_RE)) {
    const name = match[1];
    if (name) {
      used.add(name);
    }
  }
  for (let index = 1; index < Number.MAX_SAFE_INTEGER; index += 1) {
    const candidate = `node${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  return `node${Date.now()}`;
}

function shiftSpan(span: Span, insertedSpan: Span | undefined, insertedLength: number): Span {
  if (!insertedSpan || insertedLength === 0 || insertedSpan.from > span.from) {
    return span;
  }
  return {
    from: span.from + insertedLength,
    to: span.to + insertedLength
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
  delta: WorldPoint,
  parseOptions: EditParseOptions = {},
  formatPrecision?: DragFormatPrecision,
  baseline?: MoveElementsBaseline,
  geometry?: EditGeometrySession
): EditActionResult {
  return applyMoveElementsAction(source, editHandles, elementIds, delta, formatPrecision, parseOptions, baseline, geometry);
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

function applyUngroupElements(
  source: string,
  action: Extract<EditAction, { kind: "ungroupElements" }>,
  parseOptions: EditParseOptions
): EditActionResult {
  return applyUngroupElementsAction(source, action.elementIds, parseOptions);
}

function resolveNodeTextTargetForElementId(
  source: string,
  elementId: string,
  parseOptions: EditParseOptions
): { textSpan: Span; changedSourceIds: string[] } | null {
  const normalizedId = elementId.trim();
  if (normalizedId.length === 0) {
    return null;
  }

  const resolvedTarget = resolvePropertyTarget(source, normalizedId, parseOptions);
  if (resolvedTarget.kind === "found") {
    const target = resolvedTarget.target;
    if (target.textSpan) {
      return {
        textSpan: target.textSpan,
        changedSourceIds: changedSourceIdsForPropertyTarget(target)
      };
    }
  }

  const statementSnapshot = parseStatementSnapshot(source, parseOptions);
  const statementRef = statementSnapshot.byId.get(normalizedId);
  if (statementRef?.statement.kind === "Path" && statementRef.statement.command === "node") {
    const nodeItem = statementRef.statement.items.find((item) => item.kind === "Node");
    if (nodeItem?.kind === "Node") {
      return { textSpan: nodeItem.textSpan, changedSourceIds: changedSourceIdsForPropertyTarget({ id: statementRef.statement.id }) };
    }
  }

  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  const stack: Statement[] = [...parsed.figure.body];
  while (stack.length > 0) {
    const statement = stack.shift()!;
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
        return { textSpan: nodeItem.textSpan, changedSourceIds: changedSourceIdsForPropertyTarget({ id: statement.id }) };
      }
    }
    for (const item of statement.items) {
      if (item.kind === "Node" && item.id === normalizedId) {
        return { textSpan: item.textSpan, changedSourceIds: changedSourceIdsForPropertyTarget({ id: statement.id }) };
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
): { source: string; patches: SourcePatch[]; identityMoves: IdentityMove[] } | null {
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

  const parentRefs = snapshot.byParentKey.get(movingRef.parentKey);
  if (!parentRefs) {
    return null;
  }
  const ids = parentRefs.map((ref) => ref.id);
  if (!ids.includes(movingStatementId) || !ids.includes(producerId)) {
    return null;
  }
  const withoutMoving = ids.filter((id) => id !== movingStatementId);
  const producerIndexInFiltered = withoutMoving.indexOf(producerId);
  if (producerIndexInFiltered < 0) {
    return null;
  }
  const nextOrder = [...withoutMoving];
  nextOrder.splice(producerIndexInFiltered + 1, 0, movingStatementId);

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

  return {
    source: applied.source,
    patches: applied.patches,
    identityMoves: parentRefs.flatMap(ref => {
      const newSpan = replacement.newSpansById.get(ref.id);
      return newSpan ? [{ oldSpan: ref.span, newSpan }] : [];
    })
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

function applySetProperty(
  source: string,
  action: Extract<EditAction, { kind: "setProperty" }>,
  parseOptions: EditParseOptions
): EditActionResult {
  return applyPlannedSetPropertyAction(source, action, parseOptions);
}

function applyUpdateNodeText(
  source: string,
  action: Extract<EditAction, { kind: "updateNodeText" }>,
  parseOptions: EditParseOptions
): EditActionResult {
  const target = resolveNodeTextTargetForElementId(source, action.elementId, parseOptions);
  if (!target) {
    return { kind: "unsupported", reason: `No editable node text target found for ${action.elementId}` };
  }
  const { textSpan } = target;
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
    ],
    changedSourceIds: target.changedSourceIds
  };
}

function applyAddElement(
  source: string,
  template: ElementTemplate,
  at: WorldPoint,
  parseOptions: EditParseOptions
): EditActionResult {
  const beforeStatements = parseStatementSnapshot(source, parseOptions);
  const resolved = resolveElementTemplateAnchorNames(source, template, parseOptions);
  const snippet = generateElementSource(resolved.template, at);
  const parsedForInsertion = parseTikzForEdit(resolved.source, parseOptions);

  const newSource = insertElementIntoSource(resolved.source, snippet, parsedForInsertion.figure.span);

  const afterStatements = parseStatementSnapshot(newSource, parseOptions);
  const insertedStatementId = afterStatements.all.find((ref) => !beforeStatements.byId.has(ref.id))?.id;
  if (!insertedStatementId) {
    return {
      kind: "error",
      message: "Could not identify the inserted element."
    };
  }

  return {
    kind: "success",
    newSource,
    patches: [computeMinimalReplacementPatch(source, newSource)],
    selectedSourceIds: [insertedStatementId],
    changedSourceIds: [insertedStatementId]
  };
}
