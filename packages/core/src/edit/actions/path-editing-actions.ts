import { EMPTY_FRAGMENT, layout, tikz, type CoordinateText, type EditedSource, type TikzFragment } from "../fragment.js";
import { requireArrayValue } from "../../utils/collections.js";
import type { EditActionResultLike } from "../result-types.js";
import { worldPoint, worldVector } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { WorldPoint, WorldVector } from "../../coords/points.js";
import { isCoordinateEditHandle, type EditHandle, type EvaluateOptions } from "../../semantic/types.js";
import { evaluateTikzFigure } from "../../semantic/evaluate.js";
import { sameSiteContext } from "../../semantic/site-context.js";
import { createCoordinateWriter, type WriterResult } from "../writer/index.js";
import { CoordinateWriteRefused } from "../new-statement.js";
import {
  generateComplexPathPrependSource,
  generateComplexPathSegmentSource,
  reverseComplexPathSegments,
  type AnchorReference,
  type ComplexPathSegment
} from "../element-templates.js";
import type { Span } from "../../ast/types.js";
import { rewriteCoordinate } from "../rewrite.js";
import { replaceSpan } from "../patch.js";
import { closestPointOnLine, closestPointOnCubic, subdivideCubicAt } from "../curve-math.js";
import {
  applyTextReplacements,
  lineIndentAtOffset,
  parseStatementSnapshot,
  resolveStatementRefs
} from "../statement-ops.js";
import {
  analyzeExplicitPathStatement,
  buildStatementText,
  resolveActivePathPointHandle,
  resolveEligibleExplicitPath,
  resolvePathControlHandle,
  type ExplicitPathAnalysis,
  type PathPointKind
} from "../path-editing.js";
import type { SourcePatch } from "../types.js";
import { parseTikzForEdit, type EditParseOptions } from "../parse-options.js";
import { explicitPiece, itemPoint, pathEndState, segmentPieces, spellPath, type PathPiece, type PathPoint, type PathState } from "../path-pieces.js";


export type SplitPathAction = { elementId: string; handleId: string };
export type JoinPathsAction = { elementIds: [string, string] };
export type ReversePathAction = { elementId: string };
export type ToggleClosedPathAction = { elementId: string; closed: boolean };
export type DeletePathPointAction = { elementId: string; handleId: string };
export type SetPathPointKindAction = { elementId: string; handleId: string; pointKind: PathPointKind };
/**
 * Segments drawn on from one end of a path, in world points. `start` is
 * where they begin: the end (or start) point the tool continued from.
 */
export type AppendToPathAction = {
  elementId: string;
  end: "start" | "end";
  start: WorldPoint;
  startAnchor?: AnchorReference;
  segments: readonly ComplexPathSegment[];
};
export type InsertPathPointAction = { elementId: string; segmentIndex: number; point: WorldPoint };

type PathEditingDeps = {
  normalizeElementIds: (elementIds: readonly string[]) => string[];
};

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

function wv(x: number, y: number): WorldVector {
  return worldVector(pt(x), pt(y));
}

/**
 * Where a rewritten path's points are: the caller's handles when they are
 * this source's, else the source evaluated. Asked for only when a relative
 * coordinate has to be written again.
 */
function pathHandles(
  source: string,
  editHandles: readonly EditHandle[],
  sourceId: string,
  parseOptions: EditParseOptions,
  evaluateOptions: EvaluateOptions | undefined
): () => readonly EditHandle[] {
  let evaluated: readonly EditHandle[] | undefined;
  return () => {
    const own = editHandles.filter(handle => handle.sourceRef.sourceId === sourceId);
    if (own.length > 0 && own.every(handle => source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to) === handle.sourceText)) {
      return editHandles;
    }
    evaluated ??= evaluateTikzFigure(parseTikzForEdit(source, parseOptions).figure, source, evaluateOptions).editHandles;
    return evaluated;
  };
}

/** The path's statement with `pieces` as its body. */
function spelledStatement(
  source: string,
  analysis: ExplicitPathAnalysis,
  pieces: readonly PathPiece[],
  handles: () => readonly EditHandle[],
  continuesFrom?: () => PathState | null
): { kind: "ok"; text: TikzFragment } | { kind: "unsupported"; reason: string } {
  const body = spellPath({ source, analysis, pieces, handles, ...(continuesFrom ? { continuesFrom } : {}) });
  if (body.kind !== "ok") return { kind: "unsupported", reason: `Cannot keep the path's relative coordinates: ${body.reason}.` };
  return { kind: "ok", text: buildStatementText(source, analysis, body.fragment) };
}

function rewrittenPath(
  source: string,
  analysis: ExplicitPathAnalysis,
  replacement: TikzFragment,
  unchangedReason: string,
  ids: { changed: readonly string[]; selected?: readonly string[] }
): EditActionResultLike {
  const rewritten = replaceSourceSpan(source, analysis.statement.span, replacement);
  if (!rewritten) {
    return { kind: "unsupported", reason: unchangedReason };
  }
  return {
    kind: "success",
    newSource: rewritten.source,
    patches: [rewritten.patch],
    ...(ids.selected ? { selectedSourceIds: [...ids.selected] } : {}),
    changedSourceIds: [...ids.changed]
  };
}

export function applySplitPathAction(
  source: string,
  editHandles: readonly EditHandle[],
  action: SplitPathAction,
  parseOptions: EditParseOptions = {},
  evaluateOptions?: EvaluateOptions
): EditActionResultLike {
  const resolved = resolveEligibleExplicitPath(source, action.elementId, parseOptions);
  if (resolved.kind !== "eligible") {
    return { kind: "unsupported", reason: resolved.reason };
  }
  const analysis = resolved.analysis;
  const handleResolution = resolveActivePathPointHandle(editHandles, analysis, action.handleId, source);
  if (handleResolution.kind !== "found") {
    return { kind: "unsupported", reason: handleResolution.reason };
  }
  const anchorIndex = handleResolution.anchorIndex;
  if (anchorIndex <= 0 || (!analysis.closed && anchorIndex >= analysis.anchors.length - 1)) {
    return { kind: "unsupported", reason: "Only interior path points can split a path." };
  }
  const handles = pathHandles(source, editHandles, analysis.statement.id, parseOptions, evaluateOptions);

  if (!analysis.closed) {
    const firstSegments = analysis.segments
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => !segment.closesPath && segment.endAnchorIndex <= anchorIndex)
      .map(({ index }) => index);
    const secondSegments = analysis.segments
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => !segment.closesPath && segment.startAnchorIndex >= anchorIndex)
      .map(({ index }) => index);
    if (firstSegments.length === 0 || secondSegments.length === 0) {
      return { kind: "unsupported", reason: "Split point must leave geometry on both sides." };
    }
    const first = spelledStatement(source, analysis, segmentPieces(analysis, 0, firstSegments), handles);
    if (first.kind !== "ok") return first;
    const second = spelledStatement(source, analysis, segmentPieces(analysis, anchorIndex, secondSegments), handles);
    if (second.kind !== "ok") return second;
    const replacement = tikz`${first.text}${layout(`\n${lineIndentAtOffset(source, analysis.statement.span.from)}`)}${second.text}`;
    return rewrittenPath(source, analysis, replacement, "Split path would not change the source.", { changed: [action.elementId] });
  }

  const opened = openedClosedPathPieces(analysis, anchorIndex);
  if (!opened) {
    return { kind: "unsupported", reason: "Closed path could not be opened at that point." };
  }
  const statement = spelledStatement(source, analysis, opened, handles);
  if (statement.kind !== "ok") return statement;
  return rewrittenPath(source, analysis, statement.text, "Split path would not change the source.", { changed: [action.elementId] });
}

export function applyJoinPathsAction(
  source: string,
  editHandles: readonly EditHandle[],
  action: JoinPathsAction,
  deps: PathEditingDeps,
  parseOptions: EditParseOptions = {},
  evaluateOptions?: EvaluateOptions
): EditActionResultLike {
  const elementIds = deps.normalizeElementIds(action.elementIds);
  if (elementIds.length !== 2) {
    return { kind: "unsupported", reason: "Join requires exactly two selected open paths." };
  }
  const snapshot = parseStatementSnapshot(source, parseOptions);
  const refs = resolveStatementRefs(snapshot, elementIds).sort((left, right) => left.index - right.index);
  if (refs.length !== 2 || refs[0]?.parentKey !== refs[1]?.parentKey) {
    return { kind: "unsupported", reason: "Join requires two path statements in the same scope." };
  }

  const firstStatement = requireArrayValue(refs, 0).statement;
  const secondStatement = requireArrayValue(refs, 1).statement;
  if (firstStatement.kind !== "Path" || secondStatement.kind !== "Path") {
    return { kind: "unsupported", reason: "Join requires two path statements in the same scope." };
  }
  const firstResolved = analyzeExplicitPathStatement(source, firstStatement);
  const secondResolved = analyzeExplicitPathStatement(source, secondStatement);
  if (firstResolved.kind !== "eligible") {
    return { kind: "unsupported", reason: firstResolved.reason };
  }
  if (secondResolved.kind !== "eligible") {
    return { kind: "unsupported", reason: secondResolved.reason };
  }
  if (firstResolved.analysis.closed || secondResolved.analysis.closed) {
    return { kind: "unsupported", reason: "Only open explicit paths can be joined." };
  }

  const first = firstResolved.analysis;
  const second = secondResolved.analysis;
  const allSegments = (analysis: ExplicitPathAnalysis) => analysis.segments.map((_, index) => index);
  const firstHandles = pathHandles(source, editHandles, first.statement.id, parseOptions, evaluateOptions);
  const secondHandles = pathHandles(source, editHandles, second.statement.id, parseOptions, evaluateOptions);
  const firstBody = spellPath({ source, analysis: first, pieces: segmentPieces(first, 0, allSegments(first)), handles: firstHandles });
  // The second path goes on from where the first one ends.
  const secondBody = spellPath({
    source,
    analysis: second,
    pieces: segmentPieces(second, 0, allSegments(second)),
    handles: secondHandles,
    continuesFrom: () => pathEndState(source, first, firstHandles())
  });
  if (firstBody.kind !== "ok") return { kind: "unsupported", reason: `Cannot keep the path's relative coordinates: ${firstBody.reason}.` };
  if (secondBody.kind !== "ok") return { kind: "unsupported", reason: `Cannot keep the path's relative coordinates: ${secondBody.reason}.` };
  const merged = buildStatementText(source, first, tikz`${firstBody.fragment} -- ${secondBody.fragment}`);
  const replacements = applyTextReplacements(source, [
    { span: first.statement.span, text: merged },
    { span: second.statement.span, text: EMPTY_FRAGMENT }
  ]);
  return {
    kind: "success",
    newSource: replacements.source,
    patches: replacements.patches,
    selectedSourceIds: [first.statement.id],
    changedSourceIds: elementIds
  };
}

export function applyReversePathAction(
  source: string,
  editHandles: readonly EditHandle[],
  action: ReversePathAction,
  parseOptions: EditParseOptions = {},
  evaluateOptions?: EvaluateOptions
): EditActionResultLike {
  const resolved = resolveEligibleExplicitPath(source, action.elementId, parseOptions);
  if (resolved.kind !== "eligible") {
    return { kind: "unsupported", reason: resolved.reason };
  }
  const analysis = resolved.analysis;
  const reversed = reversedPathPieces(analysis);
  if (!reversed) {
    return { kind: "unsupported", reason: "Reverse path would not change the source." };
  }
  const statement = spelledStatement(source, analysis, reversed, pathHandles(source, editHandles, analysis.statement.id, parseOptions, evaluateOptions));
  if (statement.kind !== "ok") return statement;
  return rewrittenPath(source, analysis, statement.text, "Reverse path would not change the source.", { changed: [action.elementId], selected: [action.elementId] });
}

export function applyToggleClosedPathAction(
  source: string,
  editHandles: readonly EditHandle[],
  action: ToggleClosedPathAction,
  parseOptions: EditParseOptions = {},
  evaluateOptions?: EvaluateOptions
): EditActionResultLike {
  const resolved = resolveEligibleExplicitPath(source, action.elementId, parseOptions);
  if (resolved.kind !== "eligible") {
    return { kind: "unsupported", reason: resolved.reason };
  }
  const analysis = resolved.analysis;
  const handles = pathHandles(source, editHandles, analysis.statement.id, parseOptions, evaluateOptions);
  const allSegments = analysisSegmentIndices(analysis);
  if (action.closed) {
    if (analysis.closed) {
      return { kind: "unsupported", reason: "The selected path is already closed." };
    }
    const statement = spelledStatement(source, analysis, [...segmentPieces(analysis, 0, allSegments), { kind: "line", target: "cycle" }], handles);
    if (statement.kind !== "ok") return statement;
    return rewrittenPath(source, analysis, statement.text, "Close path would not change the source.", { changed: [action.elementId] });
  }

  if (!analysis.closed) {
    return { kind: "unsupported", reason: "The selected path is already open." };
  }
  if (analysis.closureKind == null) {
    return { kind: "unsupported", reason: "This closed path cannot be opened safely." };
  }
  // Opening drops the closing segment.
  const statement = spelledStatement(source, analysis, segmentPieces(analysis, 0, allSegments), handles);
  if (statement.kind !== "ok") return statement;
  return rewrittenPath(source, analysis, statement.text, "Open path would not change the source.", { changed: [action.elementId] });
}

export function applyDeletePathPointAction(
  source: string,
  editHandles: readonly EditHandle[],
  action: DeletePathPointAction,
  parseOptions: EditParseOptions = {},
  evaluateOptions?: EvaluateOptions
): EditActionResultLike {
  const resolved = resolveEligibleExplicitPath(source, action.elementId, parseOptions);
  if (resolved.kind !== "eligible") {
    return { kind: "unsupported", reason: resolved.reason };
  }
  const analysis = resolved.analysis;
  const handleResolution = resolveActivePathPointHandle(editHandles, analysis, action.handleId, source);
  if (handleResolution.kind !== "found") {
    return { kind: "unsupported", reason: handleResolution.reason };
  }
  const anchorIndex = handleResolution.anchorIndex;
  if (analysis.closed) {
    if (analysis.anchors.length <= 2) {
      return { kind: "unsupported", reason: "Deleting this point would leave too few anchors." };
    }
  } else if (anchorIndex <= 0 || anchorIndex >= analysis.anchors.length - 1) {
    return { kind: "unsupported", reason: "Choose an interior path point to delete." };
  }

  const previousSegment = analysis.segments.find((segment) => segment.endAnchorIndex === anchorIndex && (analysis.closed || !segment.closesPath)) ?? null;
  const nextSegment = analysis.segments.find((segment) => segment.startAnchorIndex === anchorIndex && (analysis.closed || !segment.closesPath)) ?? null;
  if (!previousSegment || !nextSegment) {
    return { kind: "unsupported", reason: "Could not resolve the segments around the selected point." };
  }
  const target: PathPoint | "cycle" = nextSegment.closesPath || (analysis.closed && anchorIndex === 0)
    ? "cycle"
    : itemPoint(requireArrayValue(analysis.anchors, nextSegment.endAnchorIndex).coordinateIndex);
  const replacement = deletedPointReplacement(analysis, previousSegment, nextSegment, target);
  if (!replacement) {
    return { kind: "unsupported", reason: "Deleting this point would require unsupported segment conversion." };
  }

  const pieces = analysis.closed
    ? closedPathPiecesAfterDeletedPoint(analysis, anchorIndex, previousSegment, nextSegment, replacement)
    : openPathPiecesAfterDeletedPoint(analysis, previousSegment, nextSegment, replacement);
  const statement = spelledStatement(source, analysis, pieces, pathHandles(source, editHandles, analysis.statement.id, parseOptions, evaluateOptions));
  if (statement.kind !== "ok") return statement;
  return rewrittenPath(source, analysis, statement.text, "Delete point would not change the source.", { changed: [action.elementId] });
}

export function applySetPathPointKindAction(
  source: string,
  editHandles: readonly EditHandle[],
  action: SetPathPointKindAction,
  parseOptions: EditParseOptions = {},
  evaluateOptions?: EvaluateOptions
): EditActionResultLike {
  const resolved = resolveEligibleExplicitPath(source, action.elementId, parseOptions);
  if (resolved.kind !== "eligible") {
    return { kind: "unsupported", reason: resolved.reason };
  }
  const analysis = resolved.analysis;
  const handleResolution = resolveActivePathPointHandle(editHandles, analysis, action.handleId, source);
  if (handleResolution.kind !== "found") {
    return { kind: "unsupported", reason: handleResolution.reason };
  }
  const anchorIndex = handleResolution.anchorIndex;
  if (anchorIndex <= 0 || anchorIndex >= analysis.anchors.length - 1) {
    return { kind: "unsupported", reason: "Point type editing requires an interior path anchor." };
  }

  const previousSegment = analysis.segments.find((segment) => segment.endAnchorIndex === anchorIndex && !segment.closesPath) ?? null;
  const nextSegment = analysis.segments.find((segment) => segment.startAnchorIndex === anchorIndex && !segment.closesPath) ?? null;
  if (!previousSegment || !nextSegment) {
    return { kind: "unsupported", reason: "The selected anchor is missing adjacent editable segments." };
  }

  const beforeAnchor = resolveAnchorWorld(editHandles, action.elementId, requireArrayValue(analysis.anchors, anchorIndex - 1), source);
  const afterAnchor = resolveAnchorWorld(editHandles, action.elementId, requireArrayValue(analysis.anchors, anchorIndex + 1), source);
  if (!beforeAnchor || !afterAnchor) {
    return { kind: "unsupported", reason: "Neighboring anchors could not be resolved for point editing." };
  }

  if (action.pointKind === "smooth" && previousSegment.kind === "line" && nextSegment.kind === "line") {
    const writePoint = newPathPointWriter(editHandles, analysis.statement.id, source);
    const replacementSegments = writePoint &&
      lineSegmentsSmoothReplacement(writePoint, analysis, previousSegment, nextSegment, beforeAnchor, handleResolution.handle.world, afterAnchor);
    if (!replacementSegments) {
      return { kind: "unsupported", reason: "Could not rewrite this polyline corner into a Bezier bend." };
    }
    const pieces: PathPiece[] = [{ kind: "start", point: itemPoint(requireArrayValue(analysis.anchors, 0).coordinateIndex) }];
    for (const segment of analysis.segments) {
      if (segment === previousSegment) {
        pieces.push(...replacementSegments);
      } else if (segment !== nextSegment) {
        pieces.push({ kind: "segment", segment });
      }
    }
    const statement = spelledStatement(source, analysis, pieces, pathHandles(source, editHandles, analysis.statement.id, parseOptions, evaluateOptions));
    if (statement.kind !== "ok") return statement;
    return rewrittenPath(source, analysis, statement.text, "Point is already using that handle configuration.", { changed: [action.elementId] });
  }

  if (previousSegment.kind !== "cubic" || nextSegment.kind !== "cubic") {
    return {
      kind: "unsupported",
      reason:
        action.pointKind === "smooth"
          ? "Point to Smooth currently supports line-line and cubic-cubic anchors."
          : "Point to Corner currently supports anchors between two cubic segments."
    };
  }

  const prevControl = analysis.statement.items[previousSegment.control2Index];
  const nextControl = analysis.statement.items[nextSegment.control1Index];
  if (!prevControl || !nextControl || prevControl.kind !== "Coordinate" || nextControl.kind !== "Coordinate") {
    return { kind: "unsupported", reason: "The selected cubic point is missing control coordinates." };
  }

  const prevHandle = resolvePathControlHandle(editHandles, action.elementId, prevControl, source);
  const nextHandle = resolvePathControlHandle(editHandles, action.elementId, nextControl, source);
  if (!prevHandle || !nextHandle) {
    return { kind: "unsupported", reason: "The selected cubic point could not be resolved for rewriting." };
  }

  const nextPositions = action.pointKind === "smooth"
    ? smoothControlPositions(handleResolution.handle.world, prevHandle.world, nextHandle.world)
    : cornerControlPositions(beforeAnchor, handleResolution.handle.world, afterAnchor, prevHandle.world, nextHandle.world);

  const prevReplacement = rewriteCoordinate(nextPositions.prev, prevHandle, source);
  const nextReplacement = rewriteCoordinate(nextPositions.next, nextHandle, source);
  if (!prevReplacement || !nextReplacement) {
    return { kind: "unsupported", reason: "Point type rewrite failed for one of the control coordinates." };
  }

  const replacements = applyTextReplacements(source, [
    { span: prevHandle.sourceRef.sourceSpan, text: prevReplacement },
    { span: nextHandle.sourceRef.sourceSpan, text: nextReplacement }
  ]);
  if (replacements.patches.length === 0) {
    return { kind: "unsupported", reason: "Point is already using that handle configuration." };
  }
  return {
    kind: "success",
    newSource: replacements.source,
    patches: replacements.patches,
    changedSourceIds: [action.elementId]
  };
}

function replaceSourceSpan(source: string, span: Span, replacement: TikzFragment): { source: EditedSource; patch: SourcePatch } | null {
  const previous = source.slice(span.from, span.to);
  if (previous === replacement) {
    return null;
  }
  const updated = replaceSpan(source, span, replacement);
  return {
    source: updated.source,
    patch: {
      oldSpan: span,
      newSpan: updated.changedSpan,
      replacement
    }
  };
}

function analysisSegmentIndices(analysis: ExplicitPathAnalysis): number[] {
  return analysis.segments.map((_, index) => index);
}

/**
 * A closed path opened at an anchor: from there round every edge, the
 * closing one written out, back to the same anchor.
 */
function openedClosedPathPieces(analysis: ExplicitPathAnalysis, anchorIndex: number): PathPiece[] | null {
  const closing = analysis.segments.find((segment) => segment.closesPath);
  const open = analysis.segments.filter((segment) => !segment.closesPath);
  if (!closing || open.some((segment, index) => segment.startAnchorIndex !== index || segment.endAnchorIndex !== index + 1)) {
    return null;
  }
  return [
    { kind: "start", point: itemPoint(requireArrayValue(analysis.anchors, anchorIndex).coordinateIndex) },
    ...open.slice(anchorIndex).map((segment): PathPiece => ({ kind: "segment", segment })),
    explicitPiece(analysis, closing),
    ...open.slice(0, anchorIndex).map((segment): PathPiece => ({ kind: "segment", segment }))
  ];
}

function reversedPathPieces(analysis: ExplicitPathAnalysis): PathPiece[] | null {
  if (analysis.segments.length === 0) {
    return null;
  }
  const anchorPoint = (index: number) => itemPoint(requireArrayValue(analysis.anchors, index).coordinateIndex);
  const reversedSegment = (segment: ExplicitPathAnalysis["segments"][number], target: PathPoint | "cycle"): PathPiece => {
    if (segment.kind === "line") return { kind: "line", target };
    // Run backwards, a curve meets its controls in the other order.
    return segment.usedAnd
      ? { kind: "curve", control1: itemPoint(segment.control2Index), control2: itemPoint(segment.control1Index), target }
      : { kind: "curve", control1: itemPoint(segment.control1Index), control2: null, target };
  };

  if (!analysis.closed) {
    const pieces: PathPiece[] = [{ kind: "start", point: anchorPoint(analysis.anchors.length - 1) }];
    for (let index = analysis.segments.length - 1; index >= 0; index -= 1) {
      const segment = requireArrayValue(analysis.segments, index);
      if (!segment.closesPath) pieces.push(reversedSegment(segment, anchorPoint(segment.startAnchorIndex)));
    }
    return pieces;
  }

  const closingSegment = analysis.segments.find((segment) => segment.closesPath);
  if (!closingSegment || analysis.anchors.length === 0) {
    return null;
  }
  const pieces: PathPiece[] = [{ kind: "start", point: anchorPoint(0) }, reversedSegment(closingSegment, anchorPoint(closingSegment.startAnchorIndex))];
  for (let index = analysis.segments.length - 1; index >= 0; index -= 1) {
    const segment = requireArrayValue(analysis.segments, index);
    if (!segment.closesPath) pieces.push(reversedSegment(segment, index === 0 ? "cycle" : anchorPoint(segment.startAnchorIndex)));
  }
  return pieces;
}

function deletedPointReplacement(
  analysis: ExplicitPathAnalysis,
  previousSegment: ExplicitPathAnalysis["segments"][number],
  nextSegment: ExplicitPathAnalysis["segments"][number],
  target: PathPoint | "cycle"
): PathPiece | null {
  if (previousSegment.kind === "line" && nextSegment.kind === "line") {
    return { kind: "line", target };
  }
  if (previousSegment.kind === "cubic" && nextSegment.kind === "cubic") {
    const control1 = analysis.statement.items[previousSegment.control1Index];
    const control2 = analysis.statement.items[nextSegment.control2Index];
    if (control1?.kind !== "Coordinate" || control2?.kind !== "Coordinate") {
      return null;
    }
    return { kind: "curve", control1: itemPoint(previousSegment.control1Index), control2: itemPoint(nextSegment.control2Index), target };
  }
  return null;
}

function openPathPiecesAfterDeletedPoint(
  analysis: ExplicitPathAnalysis,
  previousSegment: ExplicitPathAnalysis["segments"][number],
  nextSegment: ExplicitPathAnalysis["segments"][number],
  replacement: PathPiece
): PathPiece[] {
  const pieces: PathPiece[] = [{ kind: "start", point: itemPoint(requireArrayValue(analysis.anchors, 0).coordinateIndex) }];
  for (const segment of analysis.segments) {
    if (segment === previousSegment) {
      pieces.push(replacement);
    } else if (segment !== nextSegment && !segment.closesPath) {
      pieces.push({ kind: "segment", segment });
    }
  }
  return pieces;
}

function closedPathPiecesAfterDeletedPoint(
  analysis: ExplicitPathAnalysis,
  anchorIndex: number,
  previousSegment: ExplicitPathAnalysis["segments"][number],
  nextSegment: ExplicitPathAnalysis["segments"][number],
  replacement: PathPiece
): PathPiece[] {
  if (anchorIndex !== 0) {
    const pieces: PathPiece[] = [{ kind: "start", point: itemPoint(requireArrayValue(analysis.anchors, 0).coordinateIndex) }];
    for (const segment of analysis.segments) {
      if (segment === previousSegment) {
        pieces.push(replacement);
      } else if (segment !== nextSegment) {
        pieces.push({ kind: "segment", segment });
      }
    }
    return pieces;
  }

  // Deleting the first point starts the path at the second, closing back to it.
  const pieces: PathPiece[] = [{ kind: "start", point: itemPoint(requireArrayValue(analysis.anchors, 1).coordinateIndex) }];
  for (const segment of analysis.segments) {
    if (segment !== previousSegment && segment !== nextSegment) {
      pieces.push({ kind: "segment", segment });
    }
  }
  pieces.push(replacement);
  return pieces;
}

function lineSegmentsSmoothReplacement(
  writePoint: (point: WorldPoint) => WriterResult<CoordinateText>,
  analysis: ExplicitPathAnalysis,
  previousSegment: ExplicitPathAnalysis["segments"][number],
  nextSegment: ExplicitPathAnalysis["segments"][number],
  beforeAnchor: WorldPoint,
  anchor: WorldPoint,
  afterAnchor: WorldPoint
): [PathPiece, PathPiece] | null {
  const prevLength = Math.hypot(anchor.x - beforeAnchor.x, anchor.y - beforeAnchor.y);
  const nextLength = Math.hypot(afterAnchor.x - anchor.x, afterAnchor.y - anchor.y);
  const tangent = normalizeVector(wv(afterAnchor.x - beforeAnchor.x, afterAnchor.y - beforeAnchor.y));
  if (!tangent) {
    return null;
  }

  const controls = [
    wp(beforeAnchor.x + (anchor.x - beforeAnchor.x) / 3, beforeAnchor.y + (anchor.y - beforeAnchor.y) / 3),
    wp(anchor.x - tangent.x * (prevLength / 3), anchor.y - tangent.y * (prevLength / 3)),
    wp(anchor.x + tangent.x * (nextLength / 3), anchor.y + tangent.y * (nextLength / 3)),
    wp(afterAnchor.x - (afterAnchor.x - anchor.x) / 3, afterAnchor.y - (afterAnchor.y - anchor.y) / 3)
  ];
  const written: PathPoint[] = [];
  for (const world of controls) {
    const text = writePoint(world);
    if (text.kind !== "ok") return null;
    written.push({ kind: "written", text: text.fragment, world });
  }
  const [c1, c2, c3, c4] = written;
  if (!c1 || !c2 || !c3 || !c4) return null;
  return [
    { kind: "curve", control1: c1, control2: c2, target: itemPoint(requireArrayValue(analysis.anchors, previousSegment.endAnchorIndex).coordinateIndex) },
    { kind: "curve", control1: c3, control2: c4, target: itemPoint(requireArrayValue(analysis.anchors, nextSegment.endAnchorIndex).coordinateIndex) }
  ];
}

/**
 * Writes new points where the path's own points are read. Null when the
 * path's points are read in different frames (mid-path options).
 */
function newPathPointWriter(
  editHandles: readonly EditHandle[],
  sourceId: string,
  source: string
): ((point: WorldPoint) => WriterResult<CoordinateText>) | null {
  const contexts = editHandles.filter(handle => handle.sourceRef.sourceId === sourceId)
    .flatMap(handle => isCoordinateEditHandle(handle) ? [handle.siteContext] : []);
  const context = contexts[0];
  if (!context || contexts.some(other => !sameSiteContext(other, context))) return null;
  const writer = createCoordinateWriter(source);
  return point => writer.point({ kind: "context", context }, point);
}

function resolveAnchorWorld(
  editHandles: readonly EditHandle[],
  sourceId: string,
  anchor: ExplicitPathAnalysis["anchors"][number],
  source: string
): WorldPoint | null {
  const handle = editHandles.find(
    (candidate) =>
      candidate.sourceRef.sourceId === sourceId &&
      candidate.kind === "path-point" &&
      candidate.sourceRef.sourceSpan.from === anchor.item.span.from &&
      candidate.sourceRef.sourceSpan.to === anchor.item.span.to
  );
  if (!handle) {
    return null;
  }
  const currentSourceText = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
  return currentSourceText === handle.sourceText ? handle.world : null;
}

function smoothControlPositions(anchor: WorldPoint, previousControl: WorldPoint, nextControl: WorldPoint): { prev: WorldPoint; next: WorldPoint } {
  const prevLength = Math.hypot(anchor.x - previousControl.x, anchor.y - previousControl.y);
  const nextLength = Math.hypot(nextControl.x - anchor.x, nextControl.y - anchor.y);
  const direction =
    normalizeVector(
      wv(
        anchor.x - previousControl.x + nextControl.x - anchor.x,
        anchor.y - previousControl.y + nextControl.y - anchor.y
      )
    ) ??
    normalizeVector(wv(nextControl.x - previousControl.x, nextControl.y - previousControl.y)) ??
    wv(1, 0);
  return {
    prev: wp(anchor.x - direction.x * prevLength, anchor.y - direction.y * prevLength),
    next: wp(anchor.x + direction.x * nextLength, anchor.y + direction.y * nextLength)
  };
}

function cornerControlPositions(
  beforeAnchor: WorldPoint,
  anchor: WorldPoint,
  afterAnchor: WorldPoint,
  previousControl: WorldPoint,
  nextControl: WorldPoint
): { prev: WorldPoint; next: WorldPoint } {
  const prevLength = Math.hypot(anchor.x - previousControl.x, anchor.y - previousControl.y);
  const nextLength = Math.hypot(nextControl.x - anchor.x, nextControl.y - anchor.y);
  const prevDirection = normalizeVector(wv(anchor.x - beforeAnchor.x, anchor.y - beforeAnchor.y)) ?? wv(1, 0);
  const nextDirection = normalizeVector(wv(afterAnchor.x - anchor.x, afterAnchor.y - anchor.y)) ?? wv(1, 0);
  return {
    prev: wp(anchor.x - prevDirection.x * prevLength, anchor.y - prevDirection.y * prevLength),
    next: wp(anchor.x + nextDirection.x * nextLength, anchor.y + nextDirection.y * nextLength)
  };
}

export function applyAppendToPathAction(
  source: string,
  editHandles: readonly EditHandle[],
  action: AppendToPathAction,
  parseOptions: EditParseOptions = {},
  evaluateOptions?: EvaluateOptions
): EditActionResultLike {
  const resolved = resolveEligibleExplicitPath(source, action.elementId, parseOptions);
  if (resolved.kind !== "eligible") {
    return { kind: "unsupported", reason: resolved.reason };
  }
  const analysis = resolved.analysis;
  if (analysis.closed) {
    return { kind: "unsupported", reason: "Cannot append to a closed path." };
  }

  // New segments are read where the path's own points are.
  const writePoint = newPathPointWriter(editHandles, action.elementId, source);
  if (!writePoint) {
    return { kind: "unsupported", reason: "Appending needs a path whose points share one coordinate frame." };
  }
  const point = (world: WorldPoint): CoordinateText => {
    const written = writePoint(world);
    if (written.kind !== "ok") throw new CoordinateWriteRefused(written.reason);
    return written.fragment;
  };
  let segmentSource: TikzFragment | null;
  let prependedEnd: WorldPoint | null = null;
  try {
    if (action.end === "end") {
      segmentSource = generateComplexPathSegmentSource(action.segments, point);
    } else {
      // Prepend: the drawn segments, reversed, run from the new far end back to the old start.
      const reversed = reverseComplexPathSegments(action.start, action.segments, action.startAnchor);
      segmentSource = generateComplexPathPrependSource(reversed.startWorld, reversed.segments, reversed.startAnchor, point);
      prependedEnd = reversed.segments.length > 1 ? requireArrayValue(reversed.segments, reversed.segments.length - 2).to : reversed.startWorld;
    }
  } catch (error) {
    if (error instanceof CoordinateWriteRefused) return { kind: "unsupported", reason: `Cannot write the new segments: ${error.message}.` };
    throw error;
  }
  if (!segmentSource) return { kind: "unsupported", reason: "Nothing to append." };

  // Prepended segments end where the path started, which its first point is then read from.
  const reachedFrom = prependedEnd;
  const existing = spellPath({
    source,
    analysis,
    pieces: segmentPieces(analysis, 0, analysisSegmentIndices(analysis)),
    handles: pathHandles(source, editHandles, analysis.statement.id, parseOptions, evaluateOptions),
    ...(reachedFrom ? { continuesFrom: () => ({ drawn: reachedFrom, current: reachedFrom }) } : {})
  });
  if (existing.kind !== "ok") return { kind: "unsupported", reason: `Cannot keep the path's relative coordinates: ${existing.reason}.` };
  const newBody = action.end === "end" ? tikz`${existing.fragment} ${segmentSource}` : tikz`${segmentSource} ${existing.fragment}`;
  return rewrittenPath(source, analysis, buildStatementText(source, analysis, newBody), "Append would not change the source.",
    { changed: [action.elementId], selected: [action.elementId] });
}

export function applyInsertPathPointAction(
  source: string,
  editHandles: readonly EditHandle[],
  action: InsertPathPointAction,
  parseOptions: EditParseOptions = {},
  evaluateOptions?: EvaluateOptions
): EditActionResultLike {
  const resolved = resolveEligibleExplicitPath(source, action.elementId, parseOptions);
  if (resolved.kind !== "eligible") {
    return { kind: "unsupported", reason: resolved.reason };
  }
  const analysis = resolved.analysis;
  const segment = analysis.segments[action.segmentIndex];
  if (!segment) {
    return { kind: "unsupported", reason: "Invalid segment index." };
  }

  const startWorld = resolveAnchorWorld(editHandles, action.elementId, requireArrayValue(analysis.anchors, segment.startAnchorIndex), source);
  const endWorld = resolveAnchorWorld(editHandles, action.elementId, requireArrayValue(analysis.anchors, segment.endAnchorIndex), source);
  if (!startWorld || !endWorld) {
    return { kind: "unsupported", reason: "Could not resolve segment endpoint positions." };
  }

  const writePoint = newPathPointWriter(editHandles, action.elementId, source);
  if (!writePoint) {
    return { kind: "unsupported", reason: "Inserting a point needs a path whose points share one coordinate frame." };
  }
  const written = (world: WorldPoint): PathPoint => {
    const text = writePoint(world);
    if (text.kind !== "ok") throw new CoordinateWriteRefused(text.reason);
    return { kind: "written", text: text.fragment, world };
  };
  const target: PathPoint | "cycle" = segment.closesPath ? "cycle" : itemPoint(requireArrayValue(analysis.anchors, segment.endAnchorIndex).coordinateIndex);

  let replacement: PathPiece[];
  try {
    if (segment.kind === "line") {
      const closest = closestPointOnLine(action.point, startWorld, endWorld);
      replacement = [{ kind: "line", target: written(closest.point) }, { kind: "line", target }];
    } else {
      const control1Item = analysis.statement.items[segment.control1Index];
      const control2Item = analysis.statement.items[segment.control2Index];
      if (control1Item?.kind !== "Coordinate" || control2Item?.kind !== "Coordinate") {
        return { kind: "unsupported", reason: "Could not resolve cubic control points." };
      }
      const control1World = resolveControlWorld(editHandles, action.elementId, control1Item, source);
      const control2World = segment.usedAnd
        ? resolveControlWorld(editHandles, action.elementId, control2Item, source)
        : control1World;
      if (!control1World || !control2World) {
        return { kind: "unsupported", reason: "Could not resolve cubic control point positions." };
      }

      const closest = closestPointOnCubic(action.point, startWorld, control1World, control2World, endWorld);
      const { left, right } = subdivideCubicAt(closest.t, startWorld, control1World, control2World, endWorld);
      replacement = [
        { kind: "curve", control1: written(left[1]), control2: written(left[2]), target: written(left[3]) },
        { kind: "curve", control1: written(right[1]), control2: written(right[2]), target }
      ];
    }
  } catch (error) {
    if (error instanceof CoordinateWriteRefused) return { kind: "unsupported", reason: `Cannot write the new point: ${error.message}.` };
    throw error;
  }

  const pieces: PathPiece[] = [{ kind: "start", point: itemPoint(requireArrayValue(analysis.anchors, 0).coordinateIndex) }];
  for (const [index, own] of analysis.segments.entries()) {
    if (index === action.segmentIndex) pieces.push(...replacement);
    else pieces.push({ kind: "segment", segment: own });
  }
  const statement = spelledStatement(source, analysis, pieces, pathHandles(source, editHandles, analysis.statement.id, parseOptions, evaluateOptions));
  if (statement.kind !== "ok") return statement;
  return rewrittenPath(source, analysis, statement.text, "Insert point would not change the source.", { changed: [action.elementId] });
}

function resolveControlWorld(
  editHandles: readonly EditHandle[],
  sourceId: string,
  coordinate: { span: { from: number; to: number } },
  source: string
): WorldPoint | null {
  const handle = editHandles.find(
    (candidate) =>
      candidate.sourceRef.sourceId === sourceId &&
      candidate.kind === "path-control" &&
      candidate.sourceRef.sourceSpan.from === coordinate.span.from &&
      candidate.sourceRef.sourceSpan.to === coordinate.span.to
  );
  if (!handle) {
    return null;
  }
  const currentSourceText = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
  return currentSourceText === handle.sourceText ? handle.world : null;
}

function normalizeVector(vector: WorldVector): WorldVector | null {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= 1e-6) {
    return null;
  }
  return wv(vector.x / length, vector.y / length);
}
