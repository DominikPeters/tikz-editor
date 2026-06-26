import { worldPoint, type WorldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionListAst } from "../../options/types.js";
import { parseBooleanishNormalized } from "../../utils/booleanish.js";
import { stripWrappingBraces } from "../../utils/braces.js";
import { resolveContextColorAliasValue, type SemanticContext } from "../context.js";
import { parseLength } from "../coords/parse-length.js";
import { normalizeColor } from "../style/colors.js";
import type { ResolvedStyle } from "../types.js";
import { resolveNodeLayout } from "./layout.js";
import {
  type NodePartText,
  resolveRectangleSplitIgnoreEmptyParts,
  resolveRectangleSplitHorizontal,
  resolveRectangleSplitPartTexts,
  resolveRectangleSplitParts
} from "./multipart.js";
import { splitTopLevelCommas } from "./raw-list.js";
import {
  makeDiamondSplitPolygonForSizing,
  resolveCircleSolidusRadius,
  resolveCircleSplitRadius,
  resolveEllipseSplitRadii,
  type TwoPartShapeSizingInput
} from "./shape-geometry.js";
import type { NodeLayout, NodeShape } from "./types.js";
import { normalizeOptionValue } from "./utils.js";

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

type RectangleSplitInnerSep = Readonly<{ x: number; y: number }>;

function rectangleSplitInnerSep(x: number, y: number): RectangleSplitInnerSep {
  return { x, y };
}

export type RectangleSplitSegment = {
  center: WorldPoint;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
};

export type RectangleSplitPartLayout = {
  text: string;
  layout: ReturnType<typeof resolveNodeLayout>;
  metricWidth: number;
  metricHeight: number;
};

export type RectangleSplitPartAlign = "left" | "right" | "center" | "top" | "bottom" | "base";

export type RectangleSplitLayoutGeometry = {
  horizontal: boolean;
  width: number;
  height: number;
  textStyle: ResolvedStyle;
  parts: RectangleSplitPartLayout[];
  segments: RectangleSplitSegment[];
  partAlignments: RectangleSplitPartAlign[];
};

export function mergeOptionLists(lists: Array<OptionListAst | undefined>): OptionListAst | undefined {
  const present = lists.filter((entry): entry is OptionListAst => Boolean(entry));
  if (present.length === 0) {
    return undefined;
  }
  const spanFrom = present.reduce((min, list) => Math.min(min, list.span.from), Number.POSITIVE_INFINITY);
  const spanTo = present.reduce((max, list) => Math.max(max, list.span.to), 0);
  return {
    span: {
      from: Number.isFinite(spanFrom) ? spanFrom : 0,
      to: spanTo
    },
    raw: present.map((list) => list.raw).join(", "),
    entries: present.flatMap((list) => list.entries)
  };
}

function resolveHorizontalSplitTextOffset(layout: NodeLayout, lineWidth: number): number {
  const innerYSep = Math.max(0, (layout.naturalHeight - layout.textBlockHeight) / 2);
  return layout.textBlockHeight / 2 + innerYSep + lineWidth / 2;
}

export function resolveTwoPartSplitTextPosition(params: {
  nodeShape: NodeShape;
  nodeLayout: NodeLayout;
  partLayout: NodeLayout;
  center: WorldPoint;
  anchor: "lower" | "text";
  options: OptionListAst | undefined;
  lineWidth: number;
}): WorldPoint {
  if (params.nodeShape === "diamond split") {
    return wp(
      params.center.x,
      params.center.y + resolveDiamondSplitTextBaselineOffset(params.anchor, params.nodeLayout, params.partLayout)
    );
  }

  const sign = params.anchor === "text" ? 1 : -1;
  return wp(
    params.center.x,
    params.center.y + sign * resolveHorizontalSplitTextOffset(params.partLayout, params.lineWidth)
  );
}

function resolveDiamondSplitTextBaselineOffset(
  anchor: "lower" | "text",
  nodeLayout: NodeLayout,
  partLayout: NodeLayout
): number {
  if (anchor === "lower") {
    return -1.25 * partLayout.textBlockHeight - nodeLayout.outerYSep - partLayout.baseLineY;
  }
  return partLayout.textBlockHeight / 4 + nodeLayout.outerYSep - partLayout.baseLineY;
}

export function resolveCircleSolidusHorizontalTextOffset(layout: NodeLayout, lineWidth: number): number {
  const innerXSep = Math.max(0, (layout.naturalWidth - layout.textBlockWidth) / 2);
  return layout.textBlockHeight / 2 + innerXSep + lineWidth * 0.3536;
}

export function resolveCircleSolidusVerticalTextOffset(layout: NodeLayout, lineWidth: number): number {
  const innerYSep = Math.max(0, (layout.naturalHeight - layout.textBlockHeight) / 2);
  return layout.textBlockWidth / 2 + innerYSep + lineWidth * 0.3536;
}

export type TwoPartShapeVisual = {
  width: number;
  height: number;
  radius: number;
};

export function resolveTwoPartShapeSizing(params: {
  nodeShape: NodeShape;
  rawNodeParts: NodePartText[];
  options: OptionListAst | undefined;
  style: ResolvedStyle;
  textMode: "text" | "math";
  context: SemanticContext;
  baseLayout: NodeLayout;
}): TwoPartShapeSizingInput | null {
  if (
    params.nodeShape !== "circle split" &&
    params.nodeShape !== "circle solidus" &&
    params.nodeShape !== "ellipse split" &&
    params.nodeShape !== "diamond split"
  ) {
    return null;
  }

  const upperText = params.rawNodeParts.find((part) => part.name === "text")?.text ?? "";
  const lowerText =
    params.rawNodeParts.find((part) => part.name === "lower")?.text ??
    params.rawNodeParts.find((part) => part.name !== "text")?.text ??
    "";
  const upperLayout = resolveNodeLayout(upperText, params.options, params.style, 1, params.context.textEngine, params.textMode);
  const lowerLayout = resolveNodeLayout(lowerText, params.options, params.style, 1, params.context.textEngine, params.textMode);
  const innerXSep = Math.max(0, (upperLayout.naturalWidth - upperLayout.textBlockWidth) / 2);
  const innerYSep = Math.max(0, (upperLayout.naturalHeight - upperLayout.textBlockHeight) / 2);

  return {
    upperWidth: upperLayout.textBlockWidth,
    upperHeight: upperLayout.textBlockHeight,
    upperDepth: textDepthFromLayout(upperLayout),
    lowerWidth: lowerText.trim().length > 0 ? lowerLayout.textBlockWidth : 0,
    lowerHeight: lowerText.trim().length > 0 ? lowerLayout.textBlockHeight : 0,
    lowerAscent: lowerText.trim().length > 0 ? textAscentFromLayout(lowerLayout) : 0,
    lowerDepth: lowerText.trim().length > 0 ? textDepthFromLayout(lowerLayout) : 0,
    innerXSep,
    innerYSep,
    lineWidth: params.style.lineWidth,
    minimumWidth: params.baseLayout.minimumWidth,
    minimumHeight: params.baseLayout.minimumHeight
  };
}

function textAscentFromLayout(layout: NodeLayout): number {
  return Math.max(0, layout.textBlockHeight / 2 - layout.baseLineY);
}

function textDepthFromLayout(layout: NodeLayout): number {
  return Math.max(0, layout.textBlockHeight / 2 + layout.baseLineY);
}

export function resolveTwoPartShapeVisual(
  shape: NodeShape,
  sizing: TwoPartShapeSizingInput,
  aspect: number
): TwoPartShapeVisual {
  if (shape === "circle split") {
    const radius = resolveCircleSplitRadius(sizing);
    return { width: 2 * radius, height: 2 * radius, radius };
  }

  if (shape === "circle solidus") {
    const radius = resolveCircleSolidusRadius(sizing);
    return { width: 2 * radius, height: 2 * radius, radius };
  }

  if (shape === "ellipse split") {
    const radii = resolveEllipseSplitRadii(sizing);
    return { width: 2 * radii.rx, height: 2 * radii.ry, radius: Math.max(radii.rx, radii.ry) };
  }

  if (shape === "diamond split") {
    const points = makeDiamondSplitPolygonForSizing(sizing, aspect);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    return { width, height, radius: Math.max(width, height) / 2 };
  }

  return { width: 0, height: 0, radius: 0 };
}

export function resolveRectangleSplitLayoutGeometry(params: {
  rawNodeParts: NodePartText[];
  options: OptionListAst | undefined;
  style: ResolvedStyle;
  textMode: "text" | "math";
  context: SemanticContext;
  baseLayout: ReturnType<typeof resolveNodeLayout>;
}): RectangleSplitLayoutGeometry {
  const textStyle = resolveRectangleSplitPartTextStyle(params.style, params.options);
  const partCount = Math.max(1, resolveRectangleSplitParts(params.options));
  const horizontal = resolveRectangleSplitHorizontal(params.options);
  const ignoreEmpty = resolveRectangleSplitIgnoreEmptyParts(params.options);
  const partTextsBase = resolveRectangleSplitPartTexts(params.rawNodeParts, partCount);
  const partTexts = ignoreEmpty ? partTextsBase.filter((partText) => partText.length > 0) : partTextsBase;
  const innerSeps = resolveRectangleSplitInnerSeps(params.options);
  const emptyPart = resolveRectangleSplitEmptyPartMetrics(params.options);
  const parts = partTexts.map((text) => {
    const layout = resolveNodeLayout(text, params.options, textStyle, 1, params.context.textEngine, params.textMode);
    const isEmpty = text.trim().length === 0;
    const metricWidth = isEmpty ? emptyPart.width + innerSeps.x * 2 : layout.naturalWidth;
    const metricHeight = isEmpty ? emptyPart.height + emptyPart.depth + innerSeps.y * 2 : layout.naturalHeight;
    return { text, layout, metricWidth, metricHeight };
  });

  const metrics = parts.map((part) => Math.max(1e-3, horizontal ? part.metricWidth : part.metricHeight));
  const splitLineTotal = Math.max(0, parts.length - 1) * params.style.lineWidth;
  const sumMetric = metrics.reduce((sum, metric) => sum + metric, 0) + splitLineTotal;
  const maxWidth = parts.reduce((max, part) => Math.max(max, part.metricWidth), 0);
  const maxHeight = parts.reduce((max, part) => Math.max(max, part.metricHeight), 0);
  const rawWidth = horizontal ? sumMetric : maxWidth;
  const rawHeight = horizontal ? maxHeight : sumMetric;
  const width = Math.max(params.baseLayout.minimumWidth, rawWidth, 1e-3);
  const height = Math.max(params.baseLayout.minimumHeight, rawHeight, 1e-3);
  const partAlignments = resolveRectangleSplitPartAlignments(params.options, horizontal, parts.length);

  const segments = computeRectangleSplitSegments({
    center: wp(0, 0),
    width,
    height,
    horizontal,
    metrics
  });

  return {
    horizontal,
    width,
    height,
    textStyle,
    parts,
    segments,
    partAlignments
  };
}

function resolveRectangleSplitPartAlignments(
  options: OptionListAst | undefined,
  horizontal: boolean,
  partCount: number
): RectangleSplitPartAlign[] {
  const defaultAlign: RectangleSplitPartAlign = "center";
  if (!options || partCount <= 0) {
    return Array.from<RectangleSplitPartAlign>({ length: Math.max(0, partCount) }).fill(defaultAlign);
  }

  let list: RectangleSplitPartAlign[] | null = null;
  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "rectangle split part align") {
      continue;
    }
    const rawItems = splitTopLevelCommas(stripWrappingBraces(entry.valueRaw));
    const parsed: RectangleSplitPartAlign[] = [];
    for (const rawItem of rawItems) {
      const normalized = normalizeOptionValue(rawItem).trim().toLowerCase();
      if (horizontal) {
        if (normalized === "top" || normalized === "bottom" || normalized === "center" || normalized === "base") {
          parsed.push(normalized);
        }
      } else if (normalized === "left" || normalized === "right" || normalized === "center") {
        parsed.push(normalized);
      }
    }
    list = parsed.length > 0 ? parsed : [defaultAlign];
  }

  if (!list || list.length === 0) {
    return Array.from<RectangleSplitPartAlign>({ length: partCount }).fill(defaultAlign);
  }

  const alignments: RectangleSplitPartAlign[] = [];
  for (let index = 0; index < partCount; index += 1) {
    alignments.push(list[Math.min(index, list.length - 1)] ?? defaultAlign);
  }
  return alignments;
}

export function resolveRectangleSplitPartTextPosition(params: {
  splitLayout: RectangleSplitLayoutGeometry;
  index: number;
  center: WorldPoint;
}): WorldPoint {
  const segment = params.splitLayout.segments[params.index];
  const part = params.splitLayout.parts[params.index];
  if (!segment || !part) {
    return params.center;
  }
  const partAlign = params.splitLayout.partAlignments[params.index] ?? "center";
  const halfMetricWidth = part.metricWidth / 2;
  const halfMetricHeight = part.metricHeight / 2;
  let x = segment.center.x;
  let y = segment.center.y;

  if (params.splitLayout.horizontal) {
    if (partAlign === "top") {
      y = pt(segment.maxY - halfMetricHeight);
    } else if (partAlign === "bottom") {
      y = pt(segment.minY + halfMetricHeight);
    } else if (partAlign === "base") {
      const baseY = resolveRectangleSplitSharedBaseline(params.splitLayout);
      const minCenterY = segment.minY + halfMetricHeight;
      const maxCenterY = segment.maxY - halfMetricHeight;
      y = pt(clamp(baseY - part.layout.baseLineY, minCenterY, maxCenterY));
    }
  } else {
    if (partAlign === "left") {
      x = pt(segment.minX + halfMetricWidth);
    } else if (partAlign === "right") {
      x = pt(segment.maxX - halfMetricWidth);
    }
  }

  return wp(params.center.x + x, params.center.y + y);
}

function resolveRectangleSplitSharedBaseline(splitLayout: RectangleSplitLayoutGeometry): number {
  let lower = Number.NEGATIVE_INFINITY;
  let upper = Number.POSITIVE_INFINITY;
  for (let index = 0; index < splitLayout.parts.length; index += 1) {
    const segment = splitLayout.segments[index];
    const part = splitLayout.parts[index];
    if (!segment || !part) {
      continue;
    }
    const halfMetricHeight = part.metricHeight / 2;
    const minCenterY = segment.minY + halfMetricHeight;
    const maxCenterY = segment.maxY - halfMetricHeight;
    const baselineMin = minCenterY + part.layout.baseLineY;
    const baselineMax = maxCenterY + part.layout.baseLineY;
    lower = Math.max(lower, baselineMin);
    upper = Math.min(upper, baselineMax);
  }
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
    return 0;
  }
  if (lower <= upper) {
    return (lower + upper) / 2;
  }
  return lower;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveRectangleSplitPartTextStyle(baseStyle: ResolvedStyle, options: OptionListAst | undefined): ResolvedStyle {
  const align = resolveEveryTextNodePartAlign(options);
  if (align == null) {
    return baseStyle;
  }
  return {
    ...baseStyle,
    textAlign: align
  };
}

function resolveEveryTextNodePartAlign(options: OptionListAst | undefined): ResolvedStyle["textAlign"] | null {
  if (!options) {
    return null;
  }
  let align: ResolvedStyle["textAlign"] | null = null;
  for (const entry of options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key !== "every text node part/.style" && entry.key !== "every text node part/.append style") {
      continue;
    }
    const parsed = parseOptionListRaw(`[${stripWrappingBraces(entry.valueRaw)}]`, entry.span.from);
    for (const styleEntry of parsed.entries) {
      if (styleEntry.kind !== "kv" || styleEntry.key !== "align") {
        continue;
      }
      const normalized = normalizeOptionValue(styleEntry.valueRaw).trim().toLowerCase();
      if (
        normalized === "left" ||
        normalized === "flush left" ||
        normalized === "right" ||
        normalized === "flush right" ||
        normalized === "center" ||
        normalized === "flush center" ||
        normalized === "justify" ||
        normalized === "none"
      ) {
        align = normalized;
      }
    }
  }
  return align;
}

function resolveRectangleSplitInnerSeps(options: OptionListAst | undefined): RectangleSplitInnerSep {
  const defaultInner = parseLength(".3333em", "pt") ?? 3.333;
  let x = defaultInner;
  let y = defaultInner;
  if (!options) {
    return rectangleSplitInnerSep(x, y);
  }
  for (const entry of options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "inner sep") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        x = parsed;
        y = parsed;
      }
      continue;
    }
    if (entry.key === "inner xsep") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        x = parsed;
      }
      continue;
    }
    if (entry.key === "inner ysep") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        y = parsed;
      }
    }
  }
  return rectangleSplitInnerSep(x, y);
}

function resolveRectangleSplitEmptyPartMetrics(options: OptionListAst | undefined): {
  width: number;
  height: number;
  depth: number;
} {
  let width = parseLength("1ex", "pt") ?? 4.3;
  let height = parseLength("1ex", "pt") ?? 4.3;
  let depth = parseLength("0ex", "pt") ?? 0;
  if (!options) {
    return { width, height, depth };
  }
  for (const entry of options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "rectangle split empty part width") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        width = Math.max(0, parsed);
      }
      continue;
    }
    if (entry.key === "rectangle split empty part height") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        height = Math.max(0, parsed);
      }
      continue;
    }
    if (entry.key === "rectangle split empty part depth") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        depth = Math.max(0, parsed);
      }
    }
  }
  return { width, height, depth };
}

function computeRectangleSplitSegments(params: {
  center: WorldPoint;
  width: number;
  height: number;
  horizontal: boolean;
  metrics: number[];
}): RectangleSplitSegment[] {
  const count = Math.max(1, params.metrics.length);
  const values = params.metrics.length === count ? params.metrics : Array.from<number>({ length: count }).fill(1);
  const metricSum = values.reduce((sum, value) => sum + Math.max(1e-3, value), 0);
  const safeSum = metricSum > 1e-6 ? metricSum : count;
  const segments: RectangleSplitSegment[] = [];

  if (params.horizontal) {
    const left = params.center.x - params.width / 2;
    let cursor = left;
    for (let index = 0; index < count; index += 1) {
      const span = (params.width * Math.max(1e-3, values[index] ?? 1)) / safeSum;
      const minX = cursor;
      const maxX = index === count - 1 ? left + params.width : cursor + span;
      segments.push({
        center: wp((minX + maxX) / 2, params.center.y),
        minX,
        maxX,
        minY: params.center.y - params.height / 2,
        maxY: params.center.y + params.height / 2,
        width: Math.max(0, maxX - minX),
        height: params.height
      });
      cursor = maxX;
    }
    return segments;
  }

  const top = params.center.y + params.height / 2;
  let cursor = top;
  for (let index = 0; index < count; index += 1) {
    const span = (params.height * Math.max(1e-3, values[index] ?? 1)) / safeSum;
    const maxY = cursor;
    const minY = index === count - 1 ? top - params.height : cursor - span;
    segments.push({
      center: wp(params.center.x, (minY + maxY) / 2),
      minX: params.center.x - params.width / 2,
      maxX: params.center.x + params.width / 2,
      minY,
      maxY,
      width: params.width,
      height: Math.max(0, maxY - minY)
    });
    cursor = minY;
  }
  return segments;
}

export function resolveRectangleSplitUseCustomFill(options: OptionListAst | undefined): boolean {
  if (!options) {
    return true;
  }
  let value = true;
  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "rectangle split use custom fill") {
      continue;
    }
    const parsed = parseBooleanishNormalized(normalizeOptionValue(entry.valueRaw));
    if (parsed != null) {
      value = parsed;
    }
  }
  return value;
}

export function resolveRectangleSplitDrawSplits(options: OptionListAst | undefined): boolean {
  if (!options) {
    return true;
  }
  let value = true;
  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "rectangle split draw splits") {
      continue;
    }
    const parsed = parseBooleanishNormalized(normalizeOptionValue(entry.valueRaw));
    if (parsed != null) {
      value = parsed;
    }
  }
  return value;
}

export function resolveRectangleSplitPartFills(
  options: OptionListAst | undefined,
  context: SemanticContext,
  consumerStatementId: string,
  currentColor: string
): string[] {
  if (!options) {
    return [];
  }
  const fills: string[] = [];
  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "rectangle split part fill") {
      continue;
    }
    const rawList = splitTopLevelCommas(stripWrappingBraces(entry.valueRaw));
    fills.length = 0;
    for (const raw of rawList) {
      const normalized = normalizeOptionValue(raw).trim();
      if (normalized.length === 0) {
        continue;
      }
      const color = normalizeColor(normalized, {
        currentColor,
        resolveAlias: (name) => resolveContextColorAliasValue(context, name, consumerStatementId)
      });
      if (color && color !== "none") {
        fills.push(color);
      }
    }
  }
  return fills;
}
