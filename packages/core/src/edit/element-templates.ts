import {
  applyFragments, canvasLength, EMPTY_FRAGMENT, joinFragments, layout, legacyText, option, optionList, tikz, unchangedSource, userText,
  type CoordinateText, type EditedSource, type TikzFragment
} from "./fragment.js";
import type { NewStatementPoints } from "./new-statement.js";
import { requireArrayValue } from "../utils/collections.js";
import { worldPoint } from "../coords/points.js";
import { pt } from "../coords/scalars.js";
import type { WorldPoint } from "../coords/points.js";
import type { Span } from "../ast/types.js";
import { CM_PER_PT, PT_PER_CM, formatNumber } from "./format.js";

export type AnchorReference = {
  nodeName: string;
  nodeSourceId?: string;
  anchor: string;
};

export type ElementTemplate =
  | { kind: "node"; name?: string; text?: string; shape?: string; minimumWidthPt?: number; minimumHeightPt?: number; strokeColor?: string; fillColor?: string }
  | { kind: "matrix"; rows?: number; columns?: number; matrixKind?: "plain" | "nodes" | "math-nodes"; cells?: string[][] }
  | { kind: "line"; hasArrow?: boolean; to?: WorldPoint; fromAnchor?: AnchorReference; toAnchor?: AnchorReference; strokeColor?: string }
  | { kind: "bezier"; to?: WorldPoint; control1?: WorldPoint; control2?: WorldPoint; strokeColor?: string }
  | { kind: "grid"; corner?: WorldPoint; strokeColor?: string }
  | { kind: "rectangle"; corner?: WorldPoint; strokeColor?: string; fillColor?: string }
  | { kind: "ellipse"; corner?: WorldPoint; strokeColor?: string; fillColor?: string }
  | { kind: "circle"; edge?: WorldPoint; strokeColor?: string; fillColor?: string }
  | { kind: "filledCircle"; edge?: WorldPoint };

export type ComplexPathSegment =
  | { kind: "line"; to: WorldPoint; toAnchor?: AnchorReference }
  | { kind: "bezier"; to: WorldPoint; control1: WorldPoint; control2: WorldPoint; toAnchor?: AnchorReference };

const DEFAULT_NODE_TEXT = "node";
const SHAPE_TOOL_DEFAULT_MINIMUM_WIDTH_CM = 2.2;
const SHAPE_TOOL_DEFAULT_MINIMUM_HEIGHT_CM = 1.4;
const DEFAULT_LINE_LENGTH_PT = 2 * PT_PER_CM;
const DEFAULT_RECT_WIDTH_PT = 2.2 * PT_PER_CM;
const DEFAULT_RECT_HEIGHT_PT = 1.4 * PT_PER_CM;
const DEFAULT_CIRCLE_RADIUS_PT = 0.8 * PT_PER_CM;
const DEFAULT_BEZIER_CONTROL_OFFSET_PT = 0;

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

/**
 * The statement for a new element at the world point `at`. Every coordinate
 * is written where the statement will be read (`points`); radii are still
 * written as canvas lengths (phase 5).
 */
export function generateElementSource(template: ElementTemplate, at: WorldPoint, points: NewStatementPoints): TikzFragment {
  switch (template.kind) {
    case "node": {
      const point = points({ command: "node", options: "" });
      const text = userText(template.text == null ? DEFAULT_NODE_TEXT : sanitizeNodeText(template.text), "node-text");
      const namePart = formatNodeName(template.name);
      if (template.shape) {
        const hasExplicitShapeSize = template.minimumWidthPt != null || template.minimumHeightPt != null;
        const optionParts = buildNodeOptions(template.strokeColor, template.fillColor, true);
        optionParts.push(option("shape", userText(template.shape, "inspector-value")));
        if (hasExplicitShapeSize) {
          if (template.minimumWidthPt != null) optionParts.push(option("minimum width", canvasLength(pt(template.minimumWidthPt), "cm")));
          if (template.minimumHeightPt != null) optionParts.push(option("minimum height", canvasLength(pt(template.minimumHeightPt), "cm")));
        } else {
          // PGF double arrows measure head span with width and arrow length with height.
          const swapDimensions = template.shape === "double arrow";
          const minimumWidth = swapDimensions ? SHAPE_TOOL_DEFAULT_MINIMUM_HEIGHT_CM : SHAPE_TOOL_DEFAULT_MINIMUM_WIDTH_CM;
          const minimumHeight = swapDimensions ? SHAPE_TOOL_DEFAULT_MINIMUM_WIDTH_CM : SHAPE_TOOL_DEFAULT_MINIMUM_HEIGHT_CM;
          optionParts.push(option("minimum width", canvasLength(pt(minimumWidth * PT_PER_CM), "cm")));
          optionParts.push(option("minimum height", canvasLength(pt(minimumHeight * PT_PER_CM), "cm")));
        }
        return tikz`\node[${joinFragments(optionParts, tikz`, `)}]${namePart} at ${point(at)} {${text}};`;
      }
      const nodeOptions = buildNodeOptions(template.strokeColor, template.fillColor, false);
      return tikz`\node${optionList(nodeOptions)}${namePart} at ${point(at)} {${text}};`;
    }

    case "matrix": {
      const point = points({ command: "node", options: "" });
      const rows = Math.max(1, Math.floor(template.rows ?? 2));
      const columns = Math.max(1, Math.floor(template.columns ?? 2));
      const matrixKind = template.matrixKind ?? "nodes";
      const matrixOption = matrixKind === "math-nodes"
        ? tikz`matrix of math nodes`
        : matrixKind === "plain"
          ? tikz`matrix`
          : tikz`matrix of nodes`;
      const bodyRows: TikzFragment[] = [];
      for (let row = 0; row < rows; row += 1) {
        const cells: TikzFragment[] = [];
        for (let column = 0; column < columns; column += 1) {
          const flatIndex = row * columns + column;
          const explicit = template.cells?.[row]?.[column];
          cells.push(userText(sanitizeMatrixCellText(explicit ?? spreadsheetLabel(flatIndex)), "node-text"));
        }
        bodyRows.push(tikz`${joinFragments(cells, tikz` & `)} \\`);
      }
      return tikz`\matrix [${matrixOption}] at ${point(at)} {${layout("\n  ")}${joinFragments(bodyRows, layout("\n  "))}${layout("\n")}};`;
    }

    case "line": {
      const lineOptions = buildDrawOptions(template.strokeColor, undefined, template.hasArrow ?? false);
      const point = points({ command: "draw", options: lineOptions.slice(1, -1) });
      const to = template.to ?? wp(at.x + DEFAULT_LINE_LENGTH_PT, at.y);
      return tikz`\draw${lineOptions} ${endpoint(template.fromAnchor, at, point)} -- ${endpoint(template.toAnchor, to, point)};`;
    }

    case "bezier": {
      const to = template.to ?? wp(at.x + DEFAULT_LINE_LENGTH_PT, at.y);
      const controls = resolveBezierControls(at, to, template.control1, template.control2);
      const bezierOptions = buildDrawOptions(template.strokeColor, undefined, false);
      const point = points({ command: "draw", options: bezierOptions.slice(1, -1) });
      return tikz`\draw${bezierOptions} ${point(at)} .. controls ${point(controls.control1)} and ${point(controls.control2)} .. ${point(to)};`;
    }

    case "grid": {
      const corner = template.corner ?? wp(at.x + DEFAULT_RECT_WIDTH_PT, at.y + DEFAULT_RECT_HEIGHT_PT);
      const gridOptions = buildDrawOptions(template.strokeColor, undefined, false);
      const point = points({ command: "draw", options: gridOptions.slice(1, -1) });
      return tikz`\draw${gridOptions} ${point(at)} grid ${point(corner)};`;
    }

    case "rectangle": {
      const corner = template.corner ?? wp(at.x + DEFAULT_RECT_WIDTH_PT, at.y + DEFAULT_RECT_HEIGHT_PT);
      const rectOptions = buildDrawOptions(template.strokeColor, template.fillColor, false);
      const point = points({ command: "draw", options: rectOptions.slice(1, -1) });
      return tikz`\draw${rectOptions} ${point(at)} rectangle ${point(corner)};`;
    }

    case "ellipse": {
      const { center, xRadiusPt, yRadiusPt } = ellipseFromCorner(at, template.corner);
      const ellipseOptions = buildDrawOptions(template.strokeColor, template.fillColor, false);
      const point = points({ command: "draw", options: ellipseOptions.slice(1, -1) });
      // Radii are lengths in the frame; the writer takes them over in phase 5.
      const radii = legacyText(`x radius=${formatNumber(xRadiusPt * CM_PER_PT)}cm, y radius=${formatNumber(yRadiusPt * CM_PER_PT)}cm`);
      return tikz`\draw${ellipseOptions} ${point(center)} ellipse [${radii}];`;
    }

    case "circle": {
      const circleOptions = buildDrawOptions(template.strokeColor, template.fillColor, false);
      const point = points({ command: "draw", options: circleOptions.slice(1, -1) });
      return tikz`\draw${circleOptions} ${point(at)} circle (${circleRadius(at, template.edge)});`;
    }

    case "filledCircle": {
      const point = points({ command: "fill", options: "" });
      return tikz`\fill ${point(at)} circle (${circleRadius(at, template.edge)});`;
    }
  }
}

/** A circle's radius as a length in the frame; the writer takes it over in phase 5. */
function circleRadius(at: WorldPoint, edge: WorldPoint | undefined): TikzFragment {
  return legacyText(`${formatNumber(circleRadiusPt(at, edge) * CM_PER_PT)}cm`);
}

/** Inserts a statement before the figure's end, indented like its body. */
export function insertElementIntoSource(source: string, snippet: TikzFragment, figureSpan?: Span): EditedSource {
  if (snippet.length === 0) {
    return unchangedSource(source);
  }

  const resolvedEnd = resolveTikzpictureEndToken(source, figureSpan);
  const endToken = resolvedEnd?.token ?? "\\end{tikzpicture}";
  const endIndex = resolvedEnd?.from ?? source.lastIndexOf(endToken);
  if (endIndex < 0) {
    if (source.trim().length === 0) {
      return applyFragments(source, [{ span: { from: 0, to: source.length },
        fragment: tikz`\begin{tikzpicture}${layout("\n  ")}${snippet}${layout("\n")}\end{tikzpicture}` }]);
    }
    return applyFragments(source, [{ span: { from: source.length, to: source.length },
      fragment: tikz`${layout(source.endsWith("\n") ? "" : "\n")}${snippet}` }]);
  }

  const endLineStart = source.lastIndexOf("\n", endIndex - 1) + 1;
  const endIndent = source.slice(endLineStart, endIndex).match(/^[ \t]*/)?.[0] ?? "";
  const needsLeadingNewline = endLineStart > 0 && !source.slice(0, endLineStart).endsWith("\n");
  return applyFragments(source, [{ span: { from: endLineStart, to: endLineStart },
    fragment: tikz`${layout(`${needsLeadingNewline ? "\n" : ""}${endIndent}  `)}${snippet}${layout("\n")}` }]);
}

function resolveTikzpictureEndToken(source: string, figureSpan: Span | undefined): { from: number; token: string } | null {
  if (!figureSpan) {
    return null;
  }
  const from = Math.max(0, Math.min(source.length, figureSpan.from));
  const to = Math.max(from, Math.min(source.length, figureSpan.to));
  const figureSource = source.slice(from, to);
  const endPattern = /\\end\{(?:tikzpicture\*?|tikzlayer)\}/gu;
  let lastMatch: RegExpExecArray | null = null;
  for (const match of figureSource.matchAll(endPattern)) {
    lastMatch = match;
  }
  if (!lastMatch) {
    return null;
  }
  return {
    from: from + lastMatch.index,
    token: lastMatch[0]
  };
}

/** A new path statement through world points, written where it will be read. */
export function generateComplexPathSource(
  start: WorldPoint,
  segments: readonly ComplexPathSegment[],
  options: { closed?: boolean; startAnchor?: AnchorReference; strokeColor?: string },
  points: NewStatementPoints
): TikzFragment | null {
  if (segments.length === 0) {
    return null;
  }
  const drawOptions = buildDrawOptions(options.strokeColor, undefined, false);
  const point = points({ command: "draw", options: drawOptions.slice(1, -1) });
  const parts: TikzFragment[] = [endpoint(options.startAnchor, start, point), ...segments.map(segment => segmentSource(segment, point))];
  if (options.closed) {
    parts.push(tikz`-- cycle`);
  }
  return tikz`\draw${drawOptions} ${joinFragments(parts, tikz` `)};`;
}

/**
 * Just the segment operators (e.g. `-- (x,y) .. controls ... .. (x2,y2)`),
 * without the `\draw`, start coordinate, or `;`, for appending to a path.
 */
export function generateComplexPathSegmentSource(
  segments: readonly ComplexPathSegment[],
  point: (point: WorldPoint) => CoordinateText
): TikzFragment | null {
  if (segments.length === 0) {
    return null;
  }
  return joinFragments(segments.map(segment => segmentSource(segment, point)), tikz` `);
}

function segmentSource(segment: ComplexPathSegment, point: (point: WorldPoint) => CoordinateText): TikzFragment {
  return segment.kind === "line"
    ? tikz`-- ${endpoint(segment.toAnchor, segment.to, point)}`
    : tikz`.. controls ${point(segment.control1)} and ${point(segment.control2)} .. ${endpoint(segment.toAnchor, segment.to, point)}`;
}

/**
 * Reverse an array of path segments so they traverse the path in the opposite direction.
 * `fromWorld` is the start point of the original (unreversed) segment sequence.
 */
export function reverseComplexPathSegments(
  fromWorld: WorldPoint,
  segments: readonly ComplexPathSegment[],
  fromAnchor?: AnchorReference
): { startWorld: WorldPoint; startAnchor?: AnchorReference; segments: ComplexPathSegment[] } {
  if (segments.length === 0) {
    return { startWorld: fromWorld, ...(fromAnchor === undefined ? {} : { startAnchor: fromAnchor }), segments: [] };
  }
  const reversed: ComplexPathSegment[] = [];
  // Walk backwards. For each segment, the new "to" is the previous segment's start.
  const segFromPoints = [fromWorld];
  const segFromAnchors: Array<AnchorReference | undefined> = [fromAnchor];
  for (const seg of segments) {
    segFromPoints.push(seg.to);
    segFromAnchors.push(seg.toAnchor);
  }
  // segFromPoints: [from, seg0.to, seg1.to, ...]
  // reversed[i] corresponds to segments[n-1-i]
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = requireArrayValue(segments, i);
    const segStart = requireArrayValue(segFromPoints, i);
    const segStartAnchor = segFromAnchors[i];
    if (seg.kind === "line") {
      reversed.push({ kind: "line", to: segStart, ...(segStartAnchor === undefined ? {} : { toAnchor: segStartAnchor }) });
    } else {
      // swap control1 and control2
      reversed.push({
        kind: "bezier",
        to: segStart,
        control1: seg.control2,
        control2: seg.control1,
        ...(segStartAnchor === undefined ? {} : { toAnchor: segStartAnchor })
      });
    }
  }
  const newStart = requireArrayValue(segFromPoints, segFromPoints.length - 1);
  const newStartAnchor = segFromAnchors[segFromAnchors.length - 1];
  return { startWorld: newStart, ...(newStartAnchor === undefined ? {} : { startAnchor: newStartAnchor }), segments: reversed };
}

/**
 * Generate source for prepending to an existing path's start.
 * Returns `(newStart) -- (p1) -- ... --` — ending with an operator (no final coordinate),
 * so the existing path's first coordinate naturally follows.
 *
 * `startWorld` is the new far start point; `segments` should be reversed so the last
 * segment's target is the existing path's old start (which will be omitted).
 */
export function generateComplexPathPrependSource(
  startWorld: WorldPoint,
  segments: readonly ComplexPathSegment[],
  startAnchor: AnchorReference | undefined,
  point: (point: WorldPoint) => CoordinateText
): TikzFragment | null {
  if (segments.length === 0) return null;

  const parts: TikzFragment[] = [endpoint(startAnchor, startWorld, point)];

  // All segments except the last: include full operator + target
  for (let i = 0; i < segments.length - 1; i++) {
    parts.push(segmentSource(requireArrayValue(segments, i), point));
  }

  // Last segment: operator only, no target (existing body provides it)
  const last = requireArrayValue(segments, segments.length - 1);
  parts.push(last.kind === "line" ? tikz`--` : tikz`.. controls ${point(last.control1)} and ${point(last.control2)} ..`);
  return joinFragments(parts, tikz` `);
}

function formatNodeName(name: string | undefined): TikzFragment {
  const trimmed = name?.trim() ?? "";
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(trimmed) ? tikz` (${userText(trimmed, "node-reference")})` : EMPTY_FRAGMENT;
}

/** A path endpoint: a node anchor when there is one, else the point. */
function endpoint(anchor: AnchorReference | undefined, fallback: WorldPoint, point: (point: WorldPoint) => CoordinateText): TikzFragment {
  const nodeName = anchor?.nodeName.trim() ?? "";
  if (!anchor || nodeName.length === 0) {
    return point(fallback);
  }
  const normalizedAnchor = anchor.anchor.trim().toLowerCase();
  return normalizedAnchor === "center" || normalizedAnchor.length === 0
    ? tikz`(${userText(nodeName, "node-reference")})`
    : tikz`(${userText(nodeName, "node-reference")}.${userText(normalizedAnchor, "node-reference")})`;
}

function circleRadiusPt(center: WorldPoint, edge: WorldPoint | undefined): number {
  if (!edge) {
    return DEFAULT_CIRCLE_RADIUS_PT;
  }

  const dx = edge.x - center.x;
  const dy = edge.y - center.y;
  const radius = Math.hypot(dx, dy);
  return radius > 1e-4 ? radius : DEFAULT_CIRCLE_RADIUS_PT;
}

function ellipseFromCorner(anchor: WorldPoint, corner: WorldPoint | undefined): { center: WorldPoint; xRadiusPt: number; yRadiusPt: number } {
  const resolvedCorner = corner ?? wp(anchor.x + DEFAULT_RECT_WIDTH_PT, anchor.y + DEFAULT_RECT_HEIGHT_PT);
  const dx = resolvedCorner.x - anchor.x;
  const dy = resolvedCorner.y - anchor.y;
  return {
    center: wp(anchor.x + dx / 2, anchor.y + dy / 2),
    xRadiusPt: Math.abs(dx) / 2,
    yRadiusPt: Math.abs(dy) / 2
  };
}

function sanitizeNodeText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length < 2 || !trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return trimmed;
  }

  const inner = trimmed.slice(1, -1).trim();
  // If users pass `{...}` explicitly, avoid generating `{{...}}` while preserving inner TeX braces.
  return inner;
}

function sanitizeMatrixCellText(raw: string): string {
  return raw.trim();
}

function spreadsheetLabel(index: number): string {
  let value = Math.max(0, Math.floor(index));
  let label = "";
  do {
    const remainder = value % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

function resolveBezierControls(
  from: WorldPoint,
  to: WorldPoint,
  control1: WorldPoint | undefined,
  control2: WorldPoint | undefined
): { control1: WorldPoint; control2: WorldPoint } {
  if (control1 && control2) {
    return { control1, control2 };
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const controlOffsetX = dx === 0 && dy === 0 ? DEFAULT_LINE_LENGTH_PT / 3 : dx / 3;
  const controlOffsetY = dx === 0 && dy === 0 ? DEFAULT_BEZIER_CONTROL_OFFSET_PT : dy / 3;
  const baseControl1 = wp(from.x + controlOffsetX, from.y + controlOffsetY);
  const baseControl2 = wp(from.x + 2 * controlOffsetX, from.y + 2 * controlOffsetY);
  return {
    control1: control1 ?? baseControl1,
    control2: control2 ?? baseControl2
  };
}

export function buildDrawOptions(
  strokeColor: string | undefined,
  fillColor: string | undefined,
  hasArrow: boolean
): TikzFragment {
  const parts: TikzFragment[] = [];

  if (hasArrow) {
    parts.push(option("->"));
  }

  if (strokeColor && strokeColor !== "black") {
    parts.push(option("draw", userText(strokeColor, "inspector-value")));
  }

  if (fillColor && fillColor !== "none") {
    parts.push(option("fill", userText(fillColor, "inspector-value")));
  }

  return optionList(parts);
}

function buildNodeOptions(
  strokeColor: string | undefined,
  fillColor: string | undefined,
  defaultDraw: boolean
): TikzFragment[] {
  const parts: TikzFragment[] = [];

  if (strokeColor) {
    parts.push(strokeColor === "black" ? option("draw") : option("draw", userText(strokeColor, "inspector-value")));
  } else if (defaultDraw) {
    parts.push(option("draw"));
  }

  if (fillColor && fillColor !== "none") {
    parts.push(option("fill", userText(fillColor, "inspector-value")));
  }

  return parts;
}
