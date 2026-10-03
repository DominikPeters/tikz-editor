import type { ArrowTip } from "../../semantic/types.js";
import type { ArrowShorteningResult, ArrowSide, ArrowTipMetrics, ArrowTipPlan, NormalizedArrowTip } from "./types.js";

const EPSILON = 1e-6;
const DEFAULT_CONTEXT_LINE_WIDTH = 0.4;
const DEFAULT_STEALTH_INSET_FACTOR = 0.325;

export type LatexShapeParameters = {
  length: number;
  width: number;
  lineWidth: number;
  frontMiter: number;
  innerLength: number;
  halfBackWidth: number;
};

export type StealthShapeParameters = {
  length: number;
  width: number;
  lineWidth: number;
  inset: number;
  frontMiter: number;
  backMiter: number;
  topMiter: number;
  insetMiter: number;
  innerLength: number;
  innerHalfWidth: number;
};

type ArrowTipInput = Omit<ArrowTip, "afterLineEnd"> & { afterLineEnd?: boolean };

export function normalizeArrowTip(tip: ArrowTipInput, contextLineWidth: number, fallbackColor: string): NormalizedArrowTip {
  const length = Number.isFinite(tip.length) ? Math.max(0.01, tip.length) : 0.01;
  const width = Number.isFinite(tip.width) ? Math.max(0.01, tip.width) : 0.01;
  let lineWidth = normalizeLineWidth(tip.lineWidth, contextLineWidth);
  if (tip.kind === "latex") lineWidth = Math.min(lineWidth, 0.2 * length);
  if (tip.kind === "stealth" || tip.kind === "triangle") {
    lineWidth = Math.min(lineWidth, 0.25 * (length - (tip.kind === "triangle" ? 0 : tip.inset ?? length * DEFAULT_STEALTH_INSET_FACTOR)));
  }
  if (tip.kind === "kite") lineWidth = Math.min(lineWidth, 0.4 * length, 0.4 * width);
  if (tip.kind === "square" || tip.kind === "circle") lineWidth = Math.min(lineWidth, 0.5 * length);
  return {
    ...tip,
    afterLineEnd: tip.afterLineEnd ?? false,
    contextLineWidth: normalizeLineWidth(contextLineWidth, DEFAULT_CONTEXT_LINE_WIDTH),
    length,
    width,
    sep: Math.max(0, tip.sep),
    lineWidth: Math.max(0, lineWidth),
    color: tip.color ?? fallbackColor
  };
}

export function computeArrowShortening(side: ArrowSide, tips: NormalizedArrowTip[], contextLineWidth: number): ArrowShorteningResult {
  if (tips.length === 0) {
    return { lineEndShortening: 0, totalLength: 0, plans: [] };
  }

  const metricsList = tips.map((tip) => buildArrowTipMetrics(tip, contextLineWidth));
  let lineEndShortening = 0;
  let totalLength = 0;
  for (let index = 0; index < tips.length; index += 1) {
    const tip = tips[index];
    const metrics = metricsList[index];
    const delta = metrics.tipEnd - metrics.backEnd + metrics.sep;
    totalLength += delta;
    if (tip.afterLineEnd) {
      lineEndShortening += metrics.tipEnd + metrics.sep - metrics.backEnd;
    } else {
      lineEndShortening = metrics.tipEnd + metrics.sep - metrics.lineEnd;
    }
  }

  let prefixLength = 0;
  const plans: ArrowTipPlan[] = [];
  for (let index = 0; index < tips.length; index += 1) {
    const tip = tips[index];
    const metrics = metricsList[index];
    const delta = metrics.tipEnd - metrics.backEnd + metrics.sep;
    const offset = lineEndShortening - totalLength + prefixLength - metrics.backEnd + metrics.lineEnd;
    plans.push({
      side,
      index,
      tip,
      metrics,
      offset,
      bend: tip.bend
    });
    prefixLength += delta;
  }

  return {
    lineEndShortening,
    totalLength,
    plans
  };
}

export function buildArrowTipMetrics(tip: NormalizedArrowTip, contextLineWidth: number): ArrowTipMetrics {
  if (tip.kind === "latex") {
    const params = computeLatexShapeParameters(tip);
    let metrics: ArrowTipMetrics = {
      tipEnd: tip.round ? params.innerLength + 0.5 * params.lineWidth : params.length - 0.5 * params.lineWidth,
      backEnd: -0.5 * params.lineWidth,
      lineEnd: tip.reversed ? params.innerLength - 0.5 * normalizeLineWidth(contextLineWidth, contextLineWidth) : 0,
      visualTipEnd: tip.round ? params.innerLength + 0.5 * params.lineWidth : params.length - 0.5 * params.lineWidth,
      visualBackEnd: -0.5 * params.lineWidth,
      sep: tip.sep
    };
    if (tip.reversed) {
      metrics = reverseMetrics(metrics);
    }
    return metrics;
  }

  if (tip.kind === "stealth" || tip.kind === "triangle") {
    const params = computeStealthShapeParameters(tip.kind === "triangle" ? { ...tip, inset: 0 } : tip);
    let metrics: ArrowTipMetrics = {
      tipEnd: tip.round ? params.innerLength + params.backMiter + 0.5 * params.lineWidth : params.length,
      backEnd: tip.round ? params.backMiter - 0.5 * params.lineWidth : 0,
      lineEnd: tip.reversed
        ? params.innerLength + params.backMiter - 0.25 * params.lineWidth
        : params.inset + params.insetMiter - 0.25 * params.lineWidth,
      visualTipEnd: tip.round ? params.innerLength + params.backMiter + 0.5 * params.lineWidth : params.length,
      visualBackEnd: params.inset,
      sep: tip.sep
    };
    if (tip.reversed) {
      metrics = reverseMetrics(metrics);
    }
    return metrics;
  }

  if (tip.kind === "kite") {
    const params = computeKiteShapeParameters(tip);
    const roundedBackEnd = (tip.inset ?? 0.25 * tip.length) / tip.width * tip.lineWidth - 0.5 * tip.lineWidth;
    const metrics: ArrowTipMetrics = {
      tipEnd: tip.round ? params.front + 0.5 * tip.lineWidth : tip.length,
      backEnd: tip.round ? roundedBackEnd : 0,
      lineEnd: tip.reversed
        ? params.front - contextLineWidth + tip.lineWidth
        : params.back + contextLineWidth - tip.lineWidth,
      visualTipEnd: tip.round ? params.front + 0.5 * tip.lineWidth : tip.length,
      visualBackEnd: tip.round ? roundedBackEnd : 0,
      sep: tip.sep
    };
    return tip.reversed ? reverseMetrics(metrics) : metrics;
  }

  if (tip.kind === "cm-rightarrow") {
    let metrics: ArrowTipMetrics = {
      tipEnd: tip.length,
      backEnd: 0,
      lineEnd: Math.max(0, tip.length - tip.lineWidth),
      visualTipEnd: tip.length,
      visualBackEnd: 0,
      sep: tip.sep
    };
    if (tip.reversed) {
      metrics = reverseMetrics(metrics);
    }
    return metrics;
  }

  const halfStroke = 0.5 * tip.lineWidth;
  let familyMetrics: ArrowTipMetrics | null = null;
  if (tip.kind === "bar" || tip.kind === "tee-barb") {
    const params = computeTeeBarbShapeParameters(tip);
    familyMetrics = {
      tipEnd: params.front + (tip.round && !params.frontClamped ? halfStroke : 0),
      backEnd: params.back - (tip.round && !params.backClamped ? halfStroke : 0),
      lineEnd: (tip.reversed ? 1 : -1) * 0.25 * tip.lineWidth,
      visualTipEnd: params.front,
      visualBackEnd: halfStroke,
      sep: tip.sep
    };
  } else if (tip.kind === "straight-barb") {
    const frontMiter = halfStroke * Math.hypot(1, 2 * tip.length / tip.width);
    familyMetrics = {
      tipEnd: tip.length + (tip.round ? halfStroke : frontMiter),
      backEnd: -halfStroke,
      lineEnd: tip.length - (tip.reversed ? 0 : halfStroke),
      visualTipEnd: tip.length + (tip.round ? halfStroke : frontMiter),
      visualBackEnd: tip.length + halfStroke,
      sep: tip.sep
    };
  } else if (tip.kind === "hooks") {
    const arc = tip.arc ?? 180;
    const radius = tip.length - halfStroke;
    const sin = Math.sin(arc * Math.PI / 180);
    const tipEnd = (arc < 90 ? sin * radius : radius) + halfStroke;
    const backEnd = arc >= 270 ? -radius - halfStroke
      : arc > 180 ? sin * radius - halfStroke
      : arc >= 90 && tip.round ? -halfStroke : 0;
    familyMetrics = {
      tipEnd, backEnd,
      lineEnd: (tip.reversed ? 0.5 : 0.25) * tip.lineWidth,
      visualTipEnd: tipEnd, visualBackEnd: backEnd, sep: tip.sep
    };
  } else if (tip.kind === "arc-barb") {
    const halfArc = (tip.arc ?? 180) / 2;
    const cosine = Math.cos(halfArc * Math.PI / 180);
    const radius = tip.length - (tip.round ? halfStroke : halfArc < 90 ? tip.lineWidth : 0);
    const backEnd = cosine * radius - (tip.round ? halfStroke : 0);
    familyMetrics = {
      tipEnd: tip.length, backEnd,
      lineEnd: tip.length - halfStroke,
      visualTipEnd: tip.length, visualBackEnd: tip.length, sep: tip.sep
    };
  } else if (tip.kind === "square" || tip.kind === "circle") {
    familyMetrics = {
      tipEnd: tip.length, backEnd: 0,
      lineEnd: tip.reversed ? tip.length - halfStroke : halfStroke,
      visualTipEnd: tip.length, visualBackEnd: 0, sep: tip.sep
    };
  } else if (tip.kind === "round-cap" || tip.kind === "butt-cap" || tip.kind === "triangle-cap") {
    familyMetrics = {
      tipEnd: tip.length, backEnd: 0,
      lineEnd: tip.reversed && tip.kind !== "butt-cap" ? tip.length + 0.5 * contextLineWidth : -0.5 * contextLineWidth,
      visualTipEnd: tip.length, visualBackEnd: 0, sep: tip.sep
    };
  }
  if (familyMetrics) return tip.reversed ? reverseMetrics(familyMetrics) : familyMetrics;

  if (tip.kind === "rays") {
    let metrics: ArrowTipMetrics = {
      tipEnd: tip.length,
      backEnd: 0,
      lineEnd: 0.5 * tip.length,
      visualTipEnd: tip.length,
      visualBackEnd: 0,
      sep: tip.sep
    };
    if (tip.reversed) {
      metrics = reverseMetrics(metrics);
    }
    return metrics;
  }

  if (tip.kind === "implies") {
    let metrics: ArrowTipMetrics = {
      tipEnd: tip.length,
      backEnd: 0,
      lineEnd: 0.1 * tip.length,
      visualTipEnd: tip.length,
      visualBackEnd: 0,
      sep: tip.sep
    };
    if (tip.reversed) {
      metrics = reverseMetrics(metrics);
    }
    return metrics;
  }

  let metrics: ArrowTipMetrics = {
    tipEnd: tip.length,
    backEnd: 0,
    lineEnd: 0.15 * tip.length,
    visualTipEnd: tip.length,
    visualBackEnd: 0,
    sep: tip.sep
  };
  if (tip.reversed) {
    metrics = reverseMetrics(metrics);
  }
  return metrics;
}

export function computeLatexShapeParameters(tip: NormalizedArrowTip): LatexShapeParameters {
  const length = Math.max(0.01, tip.length);
  const width = Math.max(0.01, tip.width);
  const lineWidth = Math.min(Math.max(0, tip.lineWidth), 0.2 * length);
  const slope = length / Math.max(EPSILON, width);
  const frontMiter = Math.sqrt(1 + 9 * slope * slope) * lineWidth;
  const innerLength = Math.max(0.01, length - 0.5 * frontMiter - 0.5 * lineWidth);
  const norm = Math.hypot(0.3 * length, 0.2333333 * width);
  const backMiterRatio = (0.2333333 * width + norm) / (0.3 * length);
  const halfBackWidth = width / 2 - 0.5 * backMiterRatio * lineWidth;
  return {
    length,
    width,
    lineWidth,
    frontMiter,
    innerLength,
    halfBackWidth
  };
}

export function computeStealthShapeParameters(tip: NormalizedArrowTip): StealthShapeParameters {
  const length = Math.max(0.01, tip.length);
  const width = Math.max(0.01, tip.width);
  const inset = Math.max(0, tip.inset ?? length * DEFAULT_STEALTH_INSET_FACTOR);
  const maxLineWidth = 0.25 * Math.max(0.01, length - inset);
  const lineWidth = Math.min(Math.max(0, tip.lineWidth), maxLineWidth);

  const frontSlope = length / Math.max(EPSILON, width);
  const frontMiter = 0.5 * Math.sqrt(1 + 4 * frontSlope * frontSlope) * lineWidth;

  const halfWidth = 0.5 * width;
  const angleTip = Math.atan2(length, Math.max(EPSILON, halfWidth));
  const angleInset = Math.atan2(inset, Math.max(EPSILON, halfWidth));
  const halfDelta = 0.5 * (angleTip - angleInset);
  const reciprocalTan = Math.abs(Math.tan(halfDelta)) <= EPSILON ? 0 : 1 / Math.tan(halfDelta);
  const backMiterLength = 0.5 * reciprocalTan * lineWidth;
  const bisector = angleInset + halfDelta;
  let backMiter = Math.sin(bisector) * backMiterLength;
  const topMiter = Math.cos(bisector) * backMiterLength;
  if (Math.abs(inset) <= EPSILON) {
    backMiter = 0.5 * lineWidth;
  }

  const insetSlope = inset / Math.max(EPSILON, width);
  const insetMiter = 0.5 * Math.sqrt(1 + 4 * insetSlope * insetSlope) * lineWidth;
  const innerLength = Math.max(0.01, length - frontMiter - backMiter);
  const innerHalfWidth = Math.max(0.01, halfWidth - topMiter);

  return {
    length,
    width,
    lineWidth,
    inset,
    frontMiter,
    backMiter,
    topMiter,
    insetMiter,
    innerLength,
    innerHalfWidth
  };
}

export function computeKiteShapeParameters(tip: NormalizedArrowTip): { front: number; back: number; topX: number; topY: number } {
  const inset = tip.inset ?? 0.25 * tip.length;
  const halfWidth = tip.width / 2;
  const front = tip.length - 0.5 * tip.lineWidth * Math.hypot(1, 2 * (tip.length - inset) / tip.width);
  const back = 0.5 * tip.lineWidth * Math.hypot(1, 2 * inset / tip.width);
  const a = Math.atan2(tip.length - inset, halfWidth);
  const b = Math.atan2(inset, halfWidth);
  const halfAngle = 0.5 * (a + b);
  const miter = 0.5 * tip.lineWidth / Math.max(EPSILON, Math.sin(halfAngle));
  const angle = halfAngle - b - Math.PI / 2;
  return { front, back, topX: inset + Math.cos(angle) * miter, topY: halfWidth + Math.sin(angle) * miter };
}

export function computeTeeBarbShapeParameters(tip: NormalizedArrowTip): { front: number; back: number; frontClamped: boolean; backClamped: boolean } {
  const inset = tip.inset ?? 0.5 * tip.length;
  const frontClamped = tip.length - inset < 0.5 * tip.lineWidth;
  const backClamped = -inset > -0.5 * tip.lineWidth;
  return {
    front: Math.max(tip.length - inset, 0.5 * tip.lineWidth),
    back: Math.min(-inset, -0.5 * tip.lineWidth),
    frontClamped, backClamped
  };
}

function reverseMetrics(metrics: ArrowTipMetrics): ArrowTipMetrics {
  return {
    tipEnd: -metrics.backEnd,
    backEnd: -metrics.tipEnd,
    lineEnd: -metrics.lineEnd,
    visualTipEnd: -metrics.visualBackEnd,
    visualBackEnd: -metrics.visualTipEnd,
    sep: metrics.sep
  };
}

function normalizeLineWidth(lineWidth: number | null | undefined, fallback: number): number {
  const resolvedFallback = Number.isFinite(fallback) && fallback >= 0 ? fallback : DEFAULT_CONTEXT_LINE_WIDTH;
  if (!Number.isFinite(lineWidth) || lineWidth == null || lineWidth < 0) {
    return resolvedFallback;
  }
  return lineWidth;
}
