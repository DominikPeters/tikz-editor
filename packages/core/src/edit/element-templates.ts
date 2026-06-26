import { worldPoint } from "../coords/points.js";
import { pt } from "../coords/scalars.js";
import type { WorldPoint } from "../coords/points.js";
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

export function generateElementSource(template: ElementTemplate, at: WorldPoint): string {
  const atCoord = formatPointCm(at);

  switch (template.kind) {
    case "node": {
      const text = template.text == null ? DEFAULT_NODE_TEXT : sanitizeNodeText(template.text);
      const namePart = formatNodeName(template.name);
      if (template.shape) {
        const hasExplicitShapeSize = template.minimumWidthPt != null || template.minimumHeightPt != null;
        const optionParts = buildNodeOptions(template.strokeColor, template.fillColor, true);
        optionParts.push(`shape=${template.shape}`);
        if (hasExplicitShapeSize) {
          if (template.minimumWidthPt != null) {
            optionParts.push(`minimum width=${formatNumber(template.minimumWidthPt * CM_PER_PT)}cm`);
          }
          if (template.minimumHeightPt != null) {
            optionParts.push(`minimum height=${formatNumber(template.minimumHeightPt * CM_PER_PT)}cm`);
          }
        } else {
          optionParts.push(`minimum width=${SHAPE_TOOL_DEFAULT_MINIMUM_WIDTH_CM}cm`);
          optionParts.push(`minimum height=${SHAPE_TOOL_DEFAULT_MINIMUM_HEIGHT_CM}cm`);
        }
        return `\\node[${optionParts.join(", ")}]${namePart} at ${atCoord} {${text}};`;
      }
      const nodeOptions = buildNodeOptions(template.strokeColor, template.fillColor, false);
      const optionText = nodeOptions.length > 0 ? `[${nodeOptions.join(", ")}]` : "";
      return `\\node${optionText}${namePart} at ${atCoord} {${text}};`;
    }

    case "matrix": {
      const rows = Math.max(1, Math.floor(template.rows ?? 2));
      const columns = Math.max(1, Math.floor(template.columns ?? 2));
      const matrixKind = template.matrixKind ?? "nodes";
      const matrixOption = matrixKind === "math-nodes"
        ? "matrix of math nodes"
        : matrixKind === "plain"
          ? "matrix"
          : "matrix of nodes";
      const bodyRows: string[] = [];
      for (let row = 0; row < rows; row += 1) {
        const cells: string[] = [];
        for (let column = 0; column < columns; column += 1) {
          const flatIndex = row * columns + column;
          const explicit = template.cells?.[row]?.[column];
          cells.push(sanitizeMatrixCellText(explicit ?? spreadsheetLabel(flatIndex)));
        }
        const rowBody = cells.join(" & ");
        bodyRows.push(`${rowBody} \\\\`);
      }
      return `\\matrix [${matrixOption}] at ${atCoord} {\n  ${bodyRows.join("\n  ")}\n};`;
    }

    case "line": {
      const fromCoord = formatLineEndpoint(template.fromAnchor, atCoord);
      const to = template.to ?? wp(at.x + DEFAULT_LINE_LENGTH_PT, at.y);
      const toCoord = formatLineEndpoint(template.toAnchor, formatPointCm(to));
      const lineOptions = buildDrawOptions(template.strokeColor, undefined, template.hasArrow ?? false);
      return `\\draw${lineOptions} ${fromCoord} -- ${toCoord};`;
    }

    case "bezier": {
      const to = template.to ?? wp(at.x + DEFAULT_LINE_LENGTH_PT, at.y);
      const controls = resolveBezierControls(at, to, template.control1, template.control2);
      const bezierOptions = buildDrawOptions(template.strokeColor, undefined, false);
      return `\\draw${bezierOptions} ${atCoord} .. controls ${formatPointCm(controls.control1)} and ${formatPointCm(controls.control2)} .. ${formatPointCm(to)};`;
    }

    case "grid": {
      const corner = template.corner ?? wp(at.x + DEFAULT_RECT_WIDTH_PT, at.y + DEFAULT_RECT_HEIGHT_PT);
      const gridOptions = buildDrawOptions(template.strokeColor, undefined, false);
      return `\\draw${gridOptions} ${atCoord} grid ${formatPointCm(corner)};`;
    }

    case "rectangle": {
      const corner = template.corner ?? wp(at.x + DEFAULT_RECT_WIDTH_PT, at.y + DEFAULT_RECT_HEIGHT_PT);
      const rectOptions = buildDrawOptions(template.strokeColor, template.fillColor, false);
      return `\\draw${rectOptions} ${atCoord} rectangle ${formatPointCm(corner)};`;
    }

    case "ellipse": {
      const { center, xRadiusPt, yRadiusPt } = ellipseFromCorner(at, template.corner);
      const xRadiusCm = formatNumber(xRadiusPt * CM_PER_PT);
      const yRadiusCm = formatNumber(yRadiusPt * CM_PER_PT);
      const ellipseOptions = buildDrawOptions(template.strokeColor, template.fillColor, false);
      return `\\draw${ellipseOptions} ${formatPointCm(center)} ellipse [x radius=${xRadiusCm}cm, y radius=${yRadiusCm}cm];`;
    }

    case "circle": {
      const radiusPt = circleRadiusPt(at, template.edge);
      const circleOptions = buildDrawOptions(template.strokeColor, template.fillColor, false);
      return `\\draw${circleOptions} ${atCoord} circle (${formatNumber(radiusPt * CM_PER_PT)}cm);`;
    }

    case "filledCircle": {
      const radiusPt = circleRadiusPt(at, template.edge);
      return `\\fill ${atCoord} circle (${formatNumber(radiusPt * CM_PER_PT)}cm);`;
    }
  }
}

export function insertElementIntoSource(source: string, snippet: string): string {
  const normalizedSnippet = snippet.trim();
  if (normalizedSnippet.length === 0) {
    return source;
  }

  const endToken = "\\end{tikzpicture}";
  const endIndex = source.lastIndexOf(endToken);
  if (endIndex < 0) {
    if (source.trim().length === 0) {
      return `\\begin{tikzpicture}\n  ${normalizedSnippet}\n\\end{tikzpicture}`;
    }
    return source.endsWith("\n")
      ? `${source}${normalizedSnippet}`
      : `${source}\n${normalizedSnippet}`;
  }

  const endLineStart = source.lastIndexOf("\n", endIndex - 1) + 1;
  const endIndent = source.slice(endLineStart, endIndex).match(/^[ \t]*/)?.[0] ?? "";
  const bodyIndent = `${endIndent}  `;

  const before = source.slice(0, endLineStart);
  const after = source.slice(endLineStart);
  const needsLeadingNewline = before.length > 0 && !before.endsWith("\n");
  const prefix = needsLeadingNewline ? "\n" : "";

  return `${before}${prefix}${bodyIndent}${normalizedSnippet}\n${after}`;
}

export function generateComplexPathSource(
  start: WorldPoint,
  segments: readonly ComplexPathSegment[],
  options: { closed?: boolean; startAnchor?: AnchorReference; strokeColor?: string } = {}
): string | null {
  if (segments.length === 0) {
    return null;
  }

  const parts: string[] = [formatPathEndpoint(options.startAnchor, start)];
  for (const segment of segments) {
    if (segment.kind === "line") {
      parts.push(`-- ${formatPathEndpoint(segment.toAnchor, segment.to)}`);
      continue;
    }

    parts.push(
      `.. controls ${formatPointCm(segment.control1)} and ${formatPointCm(segment.control2)} .. ${formatPathEndpoint(segment.toAnchor, segment.to)}`
    );
  }

  if (options.closed) {
    parts.push("-- cycle");
  }

  const drawOptions = buildDrawOptions(options.strokeColor, undefined, false);
  return `\\draw${drawOptions} ${parts.join(" ")};`;
}

/**
 * Generate just the segment operators (e.g. `-- (x,y) .. controls ... .. (x2,y2)`)
 * without the `\draw`, start coordinate, or `;`.
 */
export function generateComplexPathSegmentSource(
  segments: readonly ComplexPathSegment[]
): string | null {
  if (segments.length === 0) {
    return null;
  }
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.kind === "line") {
      parts.push(`-- ${formatPathEndpoint(segment.toAnchor, segment.to)}`);
    } else {
      parts.push(
        `.. controls ${formatPointCm(segment.control1)} and ${formatPointCm(segment.control2)} .. ${formatPathEndpoint(segment.toAnchor, segment.to)}`
      );
    }
  }
  return parts.join(" ");
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
    return { startWorld: fromWorld, startAnchor: fromAnchor, segments: [] };
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
    const seg = segments[i];
    const segStart = segFromPoints[i];
    const segStartAnchor = segFromAnchors[i];
    if (seg.kind === "line") {
      reversed.push({ kind: "line", to: segStart, toAnchor: segStartAnchor });
    } else {
      // swap control1 and control2
      reversed.push({
        kind: "bezier",
        to: segStart,
        control1: seg.control2,
        control2: seg.control1,
        toAnchor: segStartAnchor
      });
    }
  }
  const newStart = segFromPoints[segFromPoints.length - 1];
  const newStartAnchor = segFromAnchors[segFromAnchors.length - 1];
  return { startWorld: newStart, startAnchor: newStartAnchor, segments: reversed };
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
  startAnchor?: AnchorReference
): string | null {
  if (segments.length === 0) return null;

  const parts: string[] = [formatPathEndpoint(startAnchor, startWorld)];

  // All segments except the last: include full operator + target
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (seg.kind === "line") {
      parts.push(`-- ${formatPathEndpoint(seg.toAnchor, seg.to)}`);
    } else {
      parts.push(`.. controls ${formatPointCm(seg.control1)} and ${formatPointCm(seg.control2)} .. ${formatPathEndpoint(seg.toAnchor, seg.to)}`);
    }
  }

  // Last segment: operator only, no target (existing body provides it)
  const last = segments[segments.length - 1];
  if (last.kind === "line") {
    parts.push("--");
  } else {
    parts.push(`.. controls ${formatPointCm(last.control1)} and ${formatPointCm(last.control2)} ..`);
  }

  return parts.join(" ");
}

function formatPointCm(point: WorldPoint): string {
  const x = formatNumber(point.x * CM_PER_PT);
  const y = formatNumber(point.y * CM_PER_PT);
  return `(${x},${y})`;
}

function formatNodeName(name: string | undefined): string {
  const trimmed = name?.trim() ?? "";
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(trimmed) ? ` (${trimmed})` : "";
}

function formatLineEndpoint(anchor: AnchorReference | undefined, fallbackCoord: string): string {
  return formatAnchorReference(anchor, fallbackCoord);
}

function formatPathEndpoint(anchor: AnchorReference | undefined, fallbackPoint: WorldPoint): string {
  return formatAnchorReference(anchor, formatPointCm(fallbackPoint));
}

function formatAnchorReference(anchor: AnchorReference | undefined, fallbackCoord: string): string {
  if (!anchor) {
    return fallbackCoord;
  }
  const nodeName = anchor.nodeName.trim();
  if (nodeName.length === 0) {
    return fallbackCoord;
  }
  const normalizedAnchor = anchor.anchor.trim().toLowerCase();
  return normalizedAnchor === "center" || normalizedAnchor.length === 0
    ? `(${nodeName})`
    : `(${nodeName}.${normalizedAnchor})`;
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
): string {
  const parts: string[] = [];

  if (hasArrow) {
    parts.push("->");
  }

  if (strokeColor && strokeColor !== "black") {
    parts.push(`draw=${strokeColor}`);
  }

  if (fillColor && fillColor !== "none") {
    parts.push(`fill=${fillColor}`);
  }

  return parts.length > 0 ? `[${parts.join(", ")}]` : "";
}

function buildNodeOptions(
  strokeColor: string | undefined,
  fillColor: string | undefined,
  defaultDraw: boolean
): string[] {
  const parts: string[] = [];

  if (strokeColor) {
    parts.push(strokeColor === "black" ? "draw" : `draw=${strokeColor}`);
  } else if (defaultDraw) {
    parts.push("draw");
  }

  if (fillColor && fillColor !== "none") {
    parts.push(`fill=${fillColor}`);
  }

  return parts;
}
