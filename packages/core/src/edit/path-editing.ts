import type { CoordinateItem, PathItem, PathKeywordItem, PathStatement, Statement } from "../ast/types.js";
import type { EditHandle } from "../semantic/types.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";

export type PathPointKind = "corner" | "smooth";

type ExplicitPathSegmentBase = {
  startAnchorIndex: number;
  endAnchorIndex: number;
  operatorIndex: number;
  targetIndex: number;
  raw: string;
  closesPath: boolean;
};

export type ExplicitPathSegment =
  | (ExplicitPathSegmentBase & { kind: "line" })
  | (ExplicitPathSegmentBase & {
    kind: "cubic";
    control1Index: number;
    control2Index: number;
    usedAnd: boolean;
  });

export type ExplicitPathAnchor = {
  index: number;
  coordinateIndex: number;
  item: CoordinateItem;
  raw: string;
};

export type ExplicitPathAnalysis = {
  statement: PathStatement;
  prefix: string;
  suffix: string;
  anchors: ExplicitPathAnchor[];
  segments: ExplicitPathSegment[];
  closed: boolean;
  closureKind: "line-cycle" | "curve-cycle" | null;
};

export type PathEditEligibility =
  | { kind: "eligible"; analysis: ExplicitPathAnalysis }
  | { kind: "ineligible"; reason: string };

export type PathHandleResolution =
  | { kind: "found"; handle: EditHandle; anchorIndex: number }
  | { kind: "missing"; reason: string };

export function resolveEligibleExplicitPath(
  source: string,
  elementId: string,
  parseOptions: EditParseOptions = {}
): PathEditEligibility {
  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  const statement = findPathStatementById(parsed.figure.body, elementId);
  if (!statement) {
    return { kind: "ineligible", reason: "Selected element is not a path statement." };
  }
  return analyzeExplicitPathStatement(source, statement);
}

export function resolveActivePathPointHandle(
  editHandles: readonly EditHandle[],
  analysis: ExplicitPathAnalysis,
  handleId: string | null | undefined,
  source: string
): PathHandleResolution {
  if (!handleId) {
    return { kind: "missing", reason: "Choose a path point first." };
  }

  const handle = editHandles.find((candidate) => candidate.id === handleId);
  if (!handle) {
    return { kind: "missing", reason: "The active path point is no longer available." };
  }
  if (handle.sourceRef.sourceId !== analysis.statement.id) {
    return { kind: "missing", reason: "The active path point does not belong to the selected path." };
  }
  if (handle.kind !== "path-point") {
    return { kind: "missing", reason: "Point actions require an anchor point handle." };
  }
  if (isSharedExpandedHandleSpan(handle, editHandles)) {
    return { kind: "missing", reason: "This path point comes from expanded source and cannot be rewritten safely." };
  }
  const currentSourceText = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
  if (currentSourceText !== handle.sourceText) {
    return { kind: "missing", reason: "The active path point is stale. Wait for recompute and try again." };
  }

  for (const anchor of analysis.anchors) {
    if (spansEqual(anchor.item.span, handle.sourceRef.sourceSpan)) {
      return { kind: "found", handle, anchorIndex: anchor.index };
    }
  }

  return { kind: "missing", reason: "The active handle is not an editable anchor in this path." };
}

export function resolvePathControlHandle(
  editHandles: readonly EditHandle[],
  sourceId: string,
  coordinate: CoordinateItem,
  source: string
): EditHandle | null {
  const handle = editHandles.find(
    (candidate) =>
      candidate.sourceRef.sourceId === sourceId &&
      candidate.kind === "path-control" &&
      spansEqual(candidate.sourceRef.sourceSpan, coordinate.span)
  );
  if (!handle || isSharedExpandedHandleSpan(handle, editHandles)) {
    return null;
  }
  const currentSourceText = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
  return currentSourceText === handle.sourceText ? handle : null;
}

export function buildStatementText(source: string, analysis: ExplicitPathAnalysis, body: string): string {
  return `${analysis.prefix}${body}${analysis.suffix}`;
}

export function buildPathBodyFromSegments(
  analysis: ExplicitPathAnalysis,
  source: string,
  startAnchorIndex: number,
  segmentIndices: readonly number[]
): string {
  const parts = [analysis.anchors[startAnchorIndex].raw];
  for (const segmentIndex of segmentIndices) {
    const segment = analysis.segments[segmentIndex];
    if (!segment || segment.closesPath) {
      continue;
    }
    parts.push(segment.raw);
  }
  return parts.join(" ");
}

export function analyzeExplicitPathStatement(source: string, statement: PathStatement): PathEditEligibility {
  const firstItem = statement.items[0];
  const lastItem = statement.items[statement.items.length - 1];
  if (!firstItem || !lastItem) {
    return { kind: "ineligible", reason: "Path has no editable items." };
  }
  if (firstItem.kind !== "Coordinate") {
    return { kind: "ineligible", reason: "Only explicit coordinate paths can be edited this way." };
  }

  const anchors: ExplicitPathAnchor[] = [{
    index: 0,
    coordinateIndex: 0,
    item: firstItem,
    raw: source.slice(firstItem.span.from, firstItem.span.to)
  }];
  const segments: ExplicitPathSegment[] = [];
  let cursor = 0;
  let closed = false;
  let closureKind: ExplicitPathAnalysis["closureKind"] = null;

  while (cursor < statement.items.length - 1) {
    const operator = statement.items[cursor + 1];
    if (!operator) {
      break;
    }
    if (operator.kind !== "PathKeyword") {
      return { kind: "ineligible", reason: unsupportedItemReason(operator) };
    }
    if (operator.keyword === "--") {
      const target = statement.items[cursor + 2];
      if (!target) {
        return { kind: "ineligible", reason: "Path ends with an incomplete line segment." };
      }
      if (target.kind === "PathKeyword" && target.keyword === "cycle") {
        if (cursor + 2 !== statement.items.length - 1) {
          return { kind: "ineligible", reason: "Cycle must be the last item in an editable path." };
        }
        segments.push({
          kind: "line",
          startAnchorIndex: anchors.length - 1,
          endAnchorIndex: 0,
          operatorIndex: cursor + 1,
          targetIndex: cursor + 2,
          raw: source.slice(operator.span.from, target.span.to),
          closesPath: true
        });
        closed = true;
        closureKind = "line-cycle";
        break;
      }
      if (target.kind !== "Coordinate") {
        return { kind: "ineligible", reason: unsupportedItemReason(target) };
      }
      const anchorIndex = anchors.length;
      anchors.push({
        index: anchorIndex,
        coordinateIndex: cursor + 2,
        item: target,
        raw: source.slice(target.span.from, target.span.to)
      });
      segments.push({
        kind: "line",
        startAnchorIndex: anchorIndex - 1,
        endAnchorIndex: anchorIndex,
        operatorIndex: cursor + 1,
        targetIndex: cursor + 2,
        raw: source.slice(operator.span.from, target.span.to),
        closesPath: false
      });
      cursor = cursor + 2;
      continue;
    }
    if (operator.keyword === "..") {
      const parsedCurve = parseCurvePattern(statement.items, cursor + 1);
      if (!parsedCurve) {
        return { kind: "ineligible", reason: "Only explicit `.. controls ... ..` cubic segments can be edited." };
      }
      if (parsedCurve.target.kind === "PathKeyword") {
        if (parsedCurve.target.keyword !== "cycle" || parsedCurve.targetIndex !== statement.items.length - 1) {
          return { kind: "ineligible", reason: "Only terminal `cycle` closures are supported for editable cubic paths." };
        }
        segments.push({
          kind: "cubic",
          startAnchorIndex: anchors.length - 1,
          endAnchorIndex: 0,
          operatorIndex: cursor + 1,
          targetIndex: parsedCurve.targetIndex,
          raw: source.slice(operator.span.from, parsedCurve.target.span.to),
          closesPath: true,
          control1Index: parsedCurve.control1Index,
          control2Index: parsedCurve.control2Index,
          usedAnd: parsedCurve.usedAnd
        });
        closed = true;
        closureKind = "curve-cycle";
        break;
      }
      const anchorIndex = anchors.length;
      anchors.push({
        index: anchorIndex,
        coordinateIndex: parsedCurve.targetIndex,
        item: parsedCurve.target,
        raw: source.slice(parsedCurve.target.span.from, parsedCurve.target.span.to)
      });
      segments.push({
        kind: "cubic",
        startAnchorIndex: anchorIndex - 1,
        endAnchorIndex: anchorIndex,
        operatorIndex: cursor + 1,
        targetIndex: parsedCurve.targetIndex,
        raw: source.slice(operator.span.from, parsedCurve.target.span.to),
        closesPath: false,
        control1Index: parsedCurve.control1Index,
        control2Index: parsedCurve.control2Index,
        usedAnd: parsedCurve.usedAnd
      });
      cursor = parsedCurve.targetIndex;
      continue;
    }
    return { kind: "ineligible", reason: `Paths using \`${operator.keyword}\` are not editable by these commands.` };
  }

  if (!closed && anchors.length < 2) {
    return { kind: "ineligible", reason: "Path needs at least two anchors." };
  }

  return {
    kind: "eligible",
    analysis: {
      statement,
      prefix: source.slice(statement.span.from, firstItem.span.from),
      suffix: source.slice(lastItem.span.to, statement.span.to),
      anchors,
      segments,
      closed,
      closureKind
    }
  };
}

function parseCurvePattern(items: readonly PathItem[], startIndex: number): {
  control1Index: number;
  control2Index: number;
  targetIndex: number;
  target: CoordinateItem | PathKeywordItem;
  usedAnd: boolean;
} | null {
  const controls = items[startIndex + 1];
  const control1 = items[startIndex + 2];
  if (controls?.kind !== "PathKeyword" || controls.keyword !== "controls") {
    return null;
  }
  if (control1?.kind !== "Coordinate") {
    return null;
  }
  let cursor = startIndex + 3;
  let control2Index = startIndex + 2;
  let usedAnd = false;

  const maybeAnd = items[cursor];
  if (maybeAnd?.kind === "PathKeyword" && maybeAnd.keyword === "and") {
    const control2 = items[cursor + 1];
    if (control2?.kind !== "Coordinate") {
      return null;
    }
    control2Index = cursor + 1;
    cursor += 2;
    usedAnd = true;
  }

  const closingDots = items[cursor];
  const target = items[cursor + 1];
  if (closingDots?.kind !== "PathKeyword" || closingDots.keyword !== "..") {
    return null;
  }
  if (!target || (target.kind !== "Coordinate" && !(target.kind === "PathKeyword" && target.keyword === "cycle"))) {
    return null;
  }

  const afterTarget = items[cursor + 2];
  if (afterTarget && afterTarget.kind !== "PathKeyword") {
    return null;
  }

  return {
    control1Index: startIndex + 2,
    control2Index,
    targetIndex: cursor + 1,
    target,
    usedAnd
  };
}

function unsupportedItemReason(item: PathItem): string {
  if (item.kind === "PathKeyword") {
    return `Paths using \`${item.keyword}\` are not editable by these commands.`;
  }
  return `Paths containing ${describePathItem(item)} are not editable by these commands.`;
}

function describePathItem(item: PathItem): string {
  switch (item.kind) {
    case "Node": return "inline nodes";
    case "PathOption": return "mid-path options";
    case "PathComment": return "comments";
    case "GraphOperation": return "graph operations";
    case "PlotOperation": return "plot operations";
    case "ToOperation": return "to-operations";
    case "EdgeOperation": return "edge operations";
    case "ChildOperation": return "child operations";
    case "EdgeFromParentOperation": return "edge-from-parent operations";
    case "SvgOperation": return "svg operations";
    case "LetOperation": return "let operations";
    case "DecorateOperation": return "decorate operations";
    case "CoordinateOperation": return "coordinate operations";
    case "PathForeach": return "foreach operations";
    case "PicOperation": return "pic operations";
    case "Coordinate": return "coordinates";
    case "PathKeyword": return "path keywords";
    case "UnknownPathItem": return "unsupported syntax";
  }
}

function findPathStatementById(statements: readonly Statement[], elementId: string): PathStatement | null {
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

function isSharedExpandedHandleSpan(handle: EditHandle, editHandles: readonly EditHandle[]): boolean {
  return editHandles.some(
    (candidate) =>
      candidate.id !== handle.id &&
      candidate.sourceRef.sourceId === handle.sourceRef.sourceId &&
      spansEqual(candidate.sourceRef.sourceSpan, handle.sourceRef.sourceSpan)
  );
}

function spansEqual(left: { from: number; to: number }, right: { from: number; to: number }): boolean {
  return left.from === right.from && left.to === right.to;
}
