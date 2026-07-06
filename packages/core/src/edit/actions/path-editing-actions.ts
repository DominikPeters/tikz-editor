import type { EditActionResultLike } from "../result-types.js";
import { worldPoint, worldVector } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { WorldPoint, WorldVector } from "../../coords/points.js";
import type { EditHandle } from "../../semantic/types.js";
import type { PathStatement, Span } from "../../ast/types.js";
import { rewriteCoordinate } from "../rewrite.js";
import { replaceSpan } from "../patch.js";
import { CM_PER_PT, formatNumber } from "../format.js";
import { closestPointOnLine, closestPointOnCubic, subdivideCubicAt } from "../curve-math.js";
import {
  applyTextReplacements,
  lineIndentAtOffset,
  parseStatementSnapshot,
  resolveStatementRefs
} from "../statement-ops.js";
import {
  analyzeExplicitPathStatement,
  buildPathBodyFromSegments,
  buildStatementText,
  resolveActivePathPointHandle,
  resolveEligibleExplicitPath,
  resolvePathControlHandle,
  type ExplicitPathAnalysis,
  type PathPointKind
} from "../path-editing.js";
import type { SourcePatch } from "../types.js";
import type { EditParseOptions } from "../parse-options.js";


export type SplitPathAction = { elementId: string; handleId: string };
export type JoinPathsAction = { elementIds: [string, string] };
export type ReversePathAction = { elementId: string };
export type ToggleClosedPathAction = { elementId: string; closed: boolean };
export type DeletePathPointAction = { elementId: string; handleId: string };
export type SetPathPointKindAction = { elementId: string; handleId: string; pointKind: PathPointKind };
export type AppendToPathAction = { elementId: string; end: "start" | "end"; segmentSource: string };
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

export function applySplitPathAction(
  source: string,
  editHandles: EditHandle[],
  action: SplitPathAction,
  parseOptions: EditParseOptions = {}
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
    const replacement = `${buildStatementText(
      source,
      analysis,
      buildPathBodyFromSegments(analysis, source, 0, firstSegments)
    )}\n${lineIndentAtOffset(source, analysis.statement.span.from)}${buildStatementText(
      source,
      analysis,
      buildPathBodyFromSegments(analysis, source, anchorIndex, secondSegments)
    )}`;
    const rewritten = replaceSourceSpan(source, analysis.statement.span, replacement);
    if (!rewritten) {
      return { kind: "unsupported", reason: "Split path would not change the source." };
    }
    return {
      kind: "success",
      newSource: rewritten.source,
      patches: [rewritten.patch],
      changedSourceIds: [action.elementId]
    };
  }

  const orderedSegments = orderedOpenSegmentsFromClosedPath(analysis, anchorIndex);
  const openedBody = buildOpenedClosedPathBody(source, analysis, anchorIndex, orderedSegments);
  if (!openedBody) {
    return { kind: "unsupported", reason: "Closed path could not be opened at that point." };
  }
  const rewritten = replaceSourceSpan(
    source,
    analysis.statement.span,
    buildStatementText(source, analysis, openedBody)
  );
  if (!rewritten) {
    return { kind: "unsupported", reason: "Split path would not change the source." };
  }
  return {
    kind: "success",
    newSource: rewritten.source,
    patches: [rewritten.patch],
    changedSourceIds: [action.elementId]
  };
}

export function applyJoinPathsAction(
  source: string,
  action: JoinPathsAction,
  deps: PathEditingDeps,
  parseOptions: EditParseOptions = {}
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

  const firstResolved = analyzeExplicitPathStatement(source, refs[0].statement as PathStatement);
  const secondResolved = analyzeExplicitPathStatement(source, refs[1].statement as PathStatement);
  if (firstResolved.kind !== "eligible") {
    return { kind: "unsupported", reason: firstResolved.reason };
  }
  if (secondResolved.kind !== "eligible") {
    return { kind: "unsupported", reason: secondResolved.reason };
  }
  if (firstResolved.analysis.closed || secondResolved.analysis.closed) {
    return { kind: "unsupported", reason: "Only open explicit paths can be joined." };
  }

  const firstBody = buildPathBodyFromSegments(
    firstResolved.analysis,
    source,
    0,
    analysisSegmentIndices(firstResolved.analysis)
  );
  const secondBody = buildPathBodyFromSegments(
    secondResolved.analysis,
    source,
    0,
    analysisSegmentIndices(secondResolved.analysis)
  );
  const merged = buildStatementText(source, firstResolved.analysis, `${firstBody} -- ${secondBody}`);
  const replacements = applyTextReplacements(source, [
    { span: firstResolved.analysis.statement.span, text: merged },
    { span: secondResolved.analysis.statement.span, text: "" }
  ]);
  return {
    kind: "success",
    newSource: replacements.source,
    patches: replacements.patches,
    selectedSourceIds: [firstResolved.analysis.statement.id],
    changedSourceIds: elementIds
  };
}

export function applyReversePathAction(
  source: string,
  action: ReversePathAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const resolved = resolveEligibleExplicitPath(source, action.elementId, parseOptions);
  if (resolved.kind !== "eligible") {
    return { kind: "unsupported", reason: resolved.reason };
  }

  const reversedBody = buildReversedPathBody(source, resolved.analysis);
  if (!reversedBody) {
    return { kind: "unsupported", reason: "Reverse path would not change the source." };
  }

  const rewritten = replaceSourceSpan(
    source,
    resolved.analysis.statement.span,
    buildStatementText(source, resolved.analysis, reversedBody)
  );
  if (!rewritten) {
    return { kind: "unsupported", reason: "Reverse path would not change the source." };
  }

  return {
    kind: "success",
    newSource: rewritten.source,
    patches: [rewritten.patch],
    selectedSourceIds: [action.elementId],
    changedSourceIds: [action.elementId]
  };
}

export function applyToggleClosedPathAction(
  source: string,
  action: ToggleClosedPathAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const resolved = resolveEligibleExplicitPath(source, action.elementId, parseOptions);
  if (resolved.kind !== "eligible") {
    return { kind: "unsupported", reason: resolved.reason };
  }
  const analysis = resolved.analysis;
  if (action.closed) {
    if (analysis.closed) {
      return { kind: "unsupported", reason: "The selected path is already closed." };
    }
    const rewritten = replaceSourceSpan(
      source,
      analysis.statement.span,
      buildStatementText(
        source,
        analysis,
        `${buildPathBodyFromSegments(analysis, source, 0, analysisSegmentIndices(analysis))} -- cycle`
      )
    );
    if (!rewritten) {
      return { kind: "unsupported", reason: "Close path would not change the source." };
    }
    return {
      kind: "success",
      newSource: rewritten.source,
      patches: [rewritten.patch],
      changedSourceIds: [action.elementId]
    };
  }

  if (!analysis.closed) {
    return { kind: "unsupported", reason: "The selected path is already open." };
  }
  if (analysis.closureKind == null) {
    return { kind: "unsupported", reason: "This closed path cannot be opened safely." };
  }
  const segments =
    analysis.closureKind === "curve-cycle"
      ? analysis.segments.map((segment, index) => ({ segment, index })).filter(({ segment }) => !segment.closesPath).map(({ index }) => index)
      : analysisSegmentIndices(analysis).slice(0, -1);
  const rewritten = replaceSourceSpan(
    source,
    analysis.statement.span,
    buildStatementText(source, analysis, buildPathBodyFromSegments(analysis, source, 0, segments))
  );
  if (!rewritten) {
    return { kind: "unsupported", reason: "Open path would not change the source." };
  }
  return {
    kind: "success",
    newSource: rewritten.source,
    patches: [rewritten.patch],
    changedSourceIds: [action.elementId]
  };
}

export function applyDeletePathPointAction(
  source: string,
  editHandles: EditHandle[],
  action: DeletePathPointAction,
  parseOptions: EditParseOptions = {}
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
  const replacementSegment = buildDeletedWorldPointReplacement(
    source,
    analysis,
    previousSegment,
    nextSegment,
    nextSegment.closesPath || (analysis.closed && anchorIndex === 0) ? "cycle" : undefined
  );
  if (!replacementSegment) {
    return { kind: "unsupported", reason: "Deleting this point would require unsupported segment conversion." };
  }

  const body = analysis.closed
    ? buildClosedPathBodyAfterDeletedPoint(analysis, anchorIndex, previousSegment, nextSegment, replacementSegment)
    : buildOpenPathBodyAfterDeletedPoint(analysis, previousSegment, nextSegment, replacementSegment);
  if (!body) {
    return { kind: "unsupported", reason: "Deleting this point would leave too few anchors." };
  }
  const rewritten = replaceSourceSpan(
    source,
    analysis.statement.span,
    buildStatementText(source, analysis, body)
  );
  if (!rewritten) {
    return { kind: "unsupported", reason: "Delete point would not change the source." };
  }
  return {
    kind: "success",
    newSource: rewritten.source,
    patches: [rewritten.patch],
    changedSourceIds: [action.elementId]
  };
}

export function applySetPathPointKindAction(
  source: string,
  editHandles: EditHandle[],
  action: SetPathPointKindAction,
  parseOptions: EditParseOptions = {}
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

  const beforeAnchor = resolveAnchorWorld(editHandles, action.elementId, analysis.anchors[anchorIndex - 1], source);
  const afterAnchor = resolveAnchorWorld(editHandles, action.elementId, analysis.anchors[anchorIndex + 1], source);
  if (!beforeAnchor || !afterAnchor) {
    return { kind: "unsupported", reason: "Neighboring anchors could not be resolved for point editing." };
  }

  if (action.pointKind === "smooth" && previousSegment.kind === "line" && nextSegment.kind === "line") {
    const replacementSegments = buildLineSegmentsSmoothReplacement(source, analysis, previousSegment, nextSegment, beforeAnchor, handleResolution.handle.world, afterAnchor);
    if (!replacementSegments) {
      return { kind: "unsupported", reason: "Could not rewrite this polyline corner into a Bezier bend." };
    }
    const bodyParts = [analysis.anchors[0].raw];
    for (const segment of analysis.segments) {
      if (segment === previousSegment) {
        bodyParts.push(...replacementSegments);
        continue;
      }
      if (segment === nextSegment || segment.closesPath) {
        continue;
      }
      bodyParts.push(segment.raw);
    }
    const rewritten = replaceSourceSpan(
      source,
      analysis.statement.span,
      buildStatementText(source, analysis, bodyParts.join(" "))
    );
    if (!rewritten) {
      return { kind: "unsupported", reason: "Point is already using that handle configuration." };
    }
    return {
      kind: "success",
      newSource: rewritten.source,
      patches: [rewritten.patch],
      changedSourceIds: [action.elementId]
    };
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

function replaceSourceSpan(source: string, span: Span, replacement: string): { source: string; patch: SourcePatch } | null {
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

function orderedOpenSegmentsFromClosedPath(analysis: ExplicitPathAnalysis, anchorIndex: number): number[] {
  const ordered: number[] = [];
  let currentAnchor = anchorIndex;
  let guard = 0;
  while (ordered.length < analysis.anchors.length - 1 && guard < analysis.segments.length * 3) {
    guard += 1;
    const nextSegmentIndex = analysis.segments.findIndex(
      (segment) => segment.startAnchorIndex === currentAnchor && !segment.closesPath
    );
    if (nextSegmentIndex >= 0) {
      if (analysis.segments[nextSegmentIndex].endAnchorIndex === anchorIndex) {
        break;
      }
      ordered.push(nextSegmentIndex);
      currentAnchor = analysis.segments[nextSegmentIndex].endAnchorIndex;
      continue;
    }
    const closingIndex = analysis.segments.findIndex(
      (segment) => segment.startAnchorIndex === currentAnchor && segment.closesPath
    );
    if (closingIndex < 0) {
      break;
    }
    currentAnchor = analysis.segments[closingIndex].endAnchorIndex;
  }
  return ordered;
}

function buildOpenedClosedPathBody(
  source: string,
  analysis: ExplicitPathAnalysis,
  anchorIndex: number,
  orderedSegments: readonly number[]
): string | null {
  if (orderedSegments.length === 0) {
    return null;
  }
  const parts = [analysis.anchors[anchorIndex].raw];
  for (const segmentIndex of orderedSegments) {
    const segment = analysis.segments[segmentIndex];
    parts.push(segment.raw);
  }
  const closingSegment = analysis.segments.find(
    (segment) => segment.closesPath && segment.startAnchorIndex === analysis.segments[orderedSegments[orderedSegments.length - 1]].endAnchorIndex
  );
  if (closingSegment) {
    parts.push(explicitSegmentText(source, analysis, closingSegment));
  }
  return parts.join(" ");
}

function buildReversedPathBody(source: string, analysis: ExplicitPathAnalysis): string | null {
  if (analysis.segments.length === 0) {
    return null;
  }

  if (!analysis.closed) {
    const lastAnchor = analysis.anchors[analysis.anchors.length - 1];
    const parts = [lastAnchor.raw];
    for (let index = analysis.segments.length - 1; index >= 0; index -= 1) {
      const segment = analysis.segments[index];
      if (segment.closesPath) {
        continue;
      }
      const reversed = reversedSegmentText(source, analysis, segment);
      if (!reversed) {
        return null;
      }
      parts.push(reversed);
    }
    return parts.join(" ");
  }

  const closingSegment = analysis.segments.find((segment) => segment.closesPath);
  const firstAnchor = analysis.anchors[0];
  if (!closingSegment || !firstAnchor) {
    return null;
  }

  const parts = [firstAnchor.raw];
  const reversedClosing = reversedSegmentText(source, analysis, closingSegment);
  if (!reversedClosing) {
    return null;
  }
  parts.push(reversedClosing);

  for (let index = analysis.segments.length - 1; index >= 0; index -= 1) {
    const segment = analysis.segments[index];
    if (segment.closesPath) {
      continue;
    }
    const reversed = reversedSegmentText(source, analysis, segment, { useCycleTarget: index === 0 });
    if (!reversed) {
      return null;
    }
    parts.push(reversed);
  }

  return parts.join(" ");
}

function buildDeletedWorldPointReplacement(
  source: string,
  analysis: ExplicitPathAnalysis,
  previousSegment: ExplicitPathAnalysis["segments"][number],
  nextSegment: ExplicitPathAnalysis["segments"][number],
  targetRawOverride?: string
): string | null {
  const targetRaw = targetRawOverride ?? analysis.anchors[nextSegment.endAnchorIndex].raw;
  if (previousSegment.kind === "line" && nextSegment.kind === "line") {
    return `-- ${targetRaw}`;
  }
  if (previousSegment.kind === "cubic" && nextSegment.kind === "cubic") {
    const control1 = analysis.statement.items[previousSegment.control1Index];
    const control2 = analysis.statement.items[nextSegment.control2Index];
    if (!control1 || !control2 || control1.kind !== "Coordinate" || control2.kind !== "Coordinate") {
      return null;
    }
    const control1Raw = sourceSliceForItem(source, analysis, previousSegment.control1Index);
    const control2Raw = sourceSliceForItem(source, analysis, nextSegment.control2Index);
    if (!control1Raw || !control2Raw) {
      return null;
    }
    return `.. controls ${control1Raw} and ${control2Raw} .. ${targetRaw}`;
  }
  return null;
}

function buildOpenPathBodyAfterDeletedPoint(
  analysis: ExplicitPathAnalysis,
  previousSegment: ExplicitPathAnalysis["segments"][number],
  nextSegment: ExplicitPathAnalysis["segments"][number],
  replacementSegment: string
): string {
  const bodyParts = [analysis.anchors[0].raw];
  for (const segment of analysis.segments) {
    if (segment === previousSegment) {
      bodyParts.push(replacementSegment);
      continue;
    }
    if (segment === nextSegment || segment.closesPath) {
      continue;
    }
    bodyParts.push(segment.raw);
  }
  return bodyParts.join(" ");
}

function buildClosedPathBodyAfterDeletedPoint(
  analysis: ExplicitPathAnalysis,
  anchorIndex: number,
  previousSegment: ExplicitPathAnalysis["segments"][number],
  nextSegment: ExplicitPathAnalysis["segments"][number],
  replacementSegment: string
): string | null {
  if (anchorIndex !== 0) {
    const bodyParts = [analysis.anchors[0].raw];
    for (const segment of analysis.segments) {
      if (segment === previousSegment) {
        bodyParts.push(replacementSegment);
        continue;
      }
      if (segment === nextSegment) {
        continue;
      }
      bodyParts.push(segment.raw);
    }
    return bodyParts.join(" ");
  }

  const bodyParts = [analysis.anchors[1].raw];
  for (const segment of analysis.segments) {
    if (segment === previousSegment || segment === nextSegment) {
      continue;
    }
    bodyParts.push(segment.raw);
  }
  bodyParts.push(replacementSegment);
  return bodyParts.join(" ");
}

function buildLineSegmentsSmoothReplacement(
  source: string,
  analysis: ExplicitPathAnalysis,
  previousSegment: ExplicitPathAnalysis["segments"][number],
  nextSegment: ExplicitPathAnalysis["segments"][number],
  beforeAnchor: WorldPoint,
  anchor: WorldPoint,
  afterAnchor: WorldPoint
): [string, string] | null {
  const firstTargetRaw = analysis.anchors[previousSegment.endAnchorIndex].raw;
  const secondTargetRaw = analysis.anchors[nextSegment.endAnchorIndex].raw;

  const prevLength = Math.hypot(anchor.x - beforeAnchor.x, anchor.y - beforeAnchor.y);
  const nextLength = Math.hypot(afterAnchor.x - anchor.x, afterAnchor.y - anchor.y);
  const tangent = normalizeVector(wv(afterAnchor.x - beforeAnchor.x, afterAnchor.y - beforeAnchor.y));
  if (!tangent) {
    return null;
  }

  const control1 = wp(
    beforeAnchor.x + (anchor.x - beforeAnchor.x) / 3,
    beforeAnchor.y + (anchor.y - beforeAnchor.y) / 3
  );
  const control2 = wp(
    anchor.x - tangent.x * (prevLength / 3),
    anchor.y - tangent.y * (prevLength / 3)
  );
  const control3 = wp(
    anchor.x + tangent.x * (nextLength / 3),
    anchor.y + tangent.y * (nextLength / 3)
  );
  const control4 = wp(
    afterAnchor.x - (afterAnchor.x - anchor.x) / 3,
    afterAnchor.y - (afterAnchor.y - anchor.y) / 3
  );

  const formatRawCoordinate = (world: WorldPoint): string =>
    `(${formatNumber(world.x * CM_PER_PT)},${formatNumber(world.y * CM_PER_PT)})`;

  return [
    `.. controls ${formatRawCoordinate(control1)} and ${formatRawCoordinate(control2)} .. ${firstTargetRaw}`,
    `.. controls ${formatRawCoordinate(control3)} and ${formatRawCoordinate(control4)} .. ${secondTargetRaw}`
  ];
}

function sourceSliceForItem(source: string, analysis: ExplicitPathAnalysis, itemIndex: number): string {
  const item = analysis.statement.items[itemIndex];
  return source.slice(item.span.from, item.span.to);
}

function reversedSegmentText(
  source: string,
  analysis: ExplicitPathAnalysis,
  segment: ExplicitPathAnalysis["segments"][number],
  options: { useCycleTarget?: boolean } = {}
): string | null {
  const targetRaw = options.useCycleTarget ? "cycle" : analysis.anchors[segment.startAnchorIndex]?.raw;
  if (!targetRaw) {
    return null;
  }

  if (segment.kind === "line") {
    return `-- ${targetRaw}`;
  }

  const control1Raw = sourceSliceForItem(source, analysis, segment.control1Index);
  const control2Raw = sourceSliceForItem(source, analysis, segment.control2Index);

  if (segment.usedAnd) {
    return `.. controls ${control2Raw} and ${control1Raw} .. ${targetRaw}`;
  }
  return `.. controls ${control2Raw} .. ${targetRaw}`;
}

function explicitSegmentText(source: string, analysis: ExplicitPathAnalysis, segment: ExplicitPathAnalysis["segments"][number]): string {
  if (!segment.closesPath) {
    return segment.raw;
  }
  const targetRaw = analysis.anchors[segment.endAnchorIndex].raw;
  if (segment.kind === "line") {
    return `-- ${targetRaw}`;
  }
  const raw = source.slice(
    analysis.statement.items[segment.operatorIndex].span.from,
    analysis.statement.items[segment.targetIndex].span.to
  );
  return raw.replace(/\bcycle\b/u, targetRaw);
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
  action: AppendToPathAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const resolved = resolveEligibleExplicitPath(source, action.elementId, parseOptions);
  if (resolved.kind !== "eligible") {
    return { kind: "unsupported", reason: resolved.reason };
  }
  const analysis = resolved.analysis;
  if (analysis.closed) {
    return { kind: "unsupported", reason: "Cannot append to a closed path." };
  }

  let newBody: string;
  const allSegmentIndices = analysis.segments.map((_, i) => i);
  const existingBody = buildPathBodyFromSegments(analysis, source, 0, allSegmentIndices);

  if (action.end === "end") {
    newBody = `${existingBody} ${action.segmentSource}`;
  } else {
    // Prepend: new segments go before the existing first anchor
    newBody = `${action.segmentSource} ${existingBody}`;
  }

  const rewritten = replaceSourceSpan(
    source,
    analysis.statement.span,
    buildStatementText(source, analysis, newBody)
  );
  if (!rewritten) {
    return { kind: "unsupported", reason: "Append would not change the source." };
  }
  return {
    kind: "success",
    newSource: rewritten.source,
    patches: [rewritten.patch],
    selectedSourceIds: [action.elementId],
    changedSourceIds: [action.elementId]
  };
}

export function applyInsertPathPointAction(
  source: string,
  editHandles: EditHandle[],
  action: InsertPathPointAction,
  parseOptions: EditParseOptions = {}
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

  const startWorld = resolveAnchorWorld(editHandles, action.elementId, analysis.anchors[segment.startAnchorIndex], source);
  const endWorld = resolveAnchorWorld(editHandles, action.elementId, analysis.anchors[segment.endAnchorIndex], source);
  if (!startWorld || !endWorld) {
    return { kind: "unsupported", reason: "Could not resolve segment endpoint positions." };
  }

  const formatPt = (pt: WorldPoint): string =>
    `(${formatNumber(pt.x * CM_PER_PT)},${formatNumber(pt.y * CM_PER_PT)})`;

  let replacementSegments: string;

  if (segment.kind === "line") {
    const closest = closestPointOnLine(action.point, startWorld, endWorld);
    const newPt = closest.point;
    const endAnchorRaw = segment.closesPath ? "cycle" : analysis.anchors[segment.endAnchorIndex].raw;
    replacementSegments = `-- ${formatPt(newPt)} -- ${endAnchorRaw}`;
  } else if (segment.kind === "cubic") {
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

    const endAnchorRaw = segment.closesPath ? "cycle" : analysis.anchors[segment.endAnchorIndex].raw;
    replacementSegments =
      `.. controls ${formatPt(left[1])} and ${formatPt(left[2])} .. ${formatPt(left[3])}` +
      ` .. controls ${formatPt(right[1])} and ${formatPt(right[2])} .. ${endAnchorRaw}`;
  } else {
    return { kind: "unsupported", reason: "Unsupported segment kind for point insertion." };
  }

  // Rebuild the path body with the segment replaced
  const bodyParts = [analysis.anchors[0].raw];
  for (let i = 0; i < analysis.segments.length; i++) {
    const seg = analysis.segments[i];
    if (i === action.segmentIndex) {
      bodyParts.push(replacementSegments);
    } else if (!seg.closesPath) {
      bodyParts.push(seg.raw);
    } else {
      // Closing segment not being replaced — keep it
      bodyParts.push(seg.raw);
    }
  }

  const rewritten = replaceSourceSpan(
    source,
    analysis.statement.span,
    buildStatementText(source, analysis, bodyParts.join(" "))
  );
  if (!rewritten) {
    return { kind: "unsupported", reason: "Insert point would not change the source." };
  }
  return {
    kind: "success",
    newSource: rewritten.source,
    patches: [rewritten.patch],
    changedSourceIds: [action.elementId]
  };
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
