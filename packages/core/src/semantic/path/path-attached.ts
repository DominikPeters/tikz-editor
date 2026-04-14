import type { OptionListAst } from "../../options/types.js";
import type { StyleChainEntry } from "../style-chain.js";
import type { Point, ScenePathAttachment } from "../types.js";
import type { PlacementSegment } from "./types.js";

type ArcParams = Extract<PlacementSegment, { kind: "arc" }>["params"];

export type PathPositionPreset =
  | "at start"
  | "very near start"
  | "near start"
  | "midway"
  | "near end"
  | "very near end"
  | "at end";

export const PATH_POSITION_PRESETS: ReadonlyArray<{ key: PathPositionPreset; t: number; label: string }> = [
  { key: "at start", t: 0, label: "Start" },
  { key: "very near start", t: 0.125, label: "Very near start" },
  { key: "near start", t: 0.25, label: "Near start" },
  { key: "midway", t: 0.5, label: "Mid" },
  { key: "near end", t: 0.75, label: "Near end" },
  { key: "very near end", t: 0.875, label: "Very near end" },
  { key: "at end", t: 1, label: "End" }
] as const;

const POSITION_PRESET_KEYS = new Set(PATH_POSITION_PRESETS.map((preset) => preset.key));
const EXPLICIT_DIRECTIONS = new Set([
  "above",
  "below",
  "left",
  "right",
  "above left",
  "above right",
  "below left",
  "below right",
  "base left",
  "base right",
  "mid left",
  "mid right"
]);

export function normalizePathPosition(position: number): number {
  if (!Number.isFinite(position)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, position));
}

export function resolvePathPositionFraction(options: OptionListAst | undefined): number | null {
  if (!options) {
    return null;
  }

  let value: number | null = null;
  for (const entry of options.entries) {
    if (entry.kind === "flag" && POSITION_PRESET_KEYS.has(entry.key as PathPositionPreset)) {
      value = PATH_POSITION_PRESETS.find((preset) => preset.key === entry.key)?.t ?? value;
      continue;
    }
    if (entry.kind === "kv" && entry.key === "pos") {
      const parsed = Number(normalizeOptionValue(entry.valueRaw));
      if (Number.isFinite(parsed)) {
        value = parsed;
      }
    }
  }

  return value == null ? null : normalizePathPosition(value);
}

export function resolvePathPositionPreset(
  position: number,
  segment: PlacementSegment | null,
  options: { normalizedThreshold?: number; worldThresholdPt?: number } = {}
): { preset: PathPositionPreset | null; snappedT: number } {
  const clamped = normalizePathPosition(position);
  const normalizedThreshold = options.normalizedThreshold ?? 0.03;
  const worldThresholdPt = options.worldThresholdPt ?? 10;
  const segmentLength = segment ? approximatePlacementSegmentLength(segment) : null;
  const threshold = segmentLength && segmentLength > 1e-6
    ? Math.max(0.0125, Math.min(normalizedThreshold, worldThresholdPt / segmentLength))
    : normalizedThreshold;

  let best: { preset: PathPositionPreset; t: number; delta: number } | null = null;
  for (const preset of PATH_POSITION_PRESETS) {
    const delta = Math.abs(clamped - preset.t);
    if (delta > threshold) {
      continue;
    }
    if (!best || delta < best.delta) {
      best = { preset: preset.key, t: preset.t, delta };
    }
  }

  return best ? { preset: best.preset, snappedT: best.t } : { preset: null, snappedT: clamped };
}

export function approximatePlacementSegmentLength(segment: PlacementSegment): number {
  if (segment.kind === "line") {
    return distance(segment.from, segment.to);
  }
  if (segment.kind === "hv") {
    return distance(segment.from, segment.bend) + distance(segment.bend, segment.to);
  }
  if (segment.kind === "arc") {
    const delta = Math.abs(segment.params.endAngle - segment.params.startAngle) * (Math.PI / 180);
    const avgRadius = (Math.abs(segment.params.rx) + Math.abs(segment.params.ry)) / 2;
    return delta * avgRadius;
  }
  let length = 0;
  let previous = segment.from;
  for (let index = 1; index <= 24; index += 1) {
    const point = pointAtPlacementSegment(segment, index / 24);
    length += distance(previous, point);
    previous = point;
  }
  return length;
}

export function pointAtPlacementSegment(segment: PlacementSegment, t: number): Point {
  const clamped = normalizePathPosition(t);
  if (segment.kind === "line") {
    return interpolate(segment.from, segment.to, clamped);
  }
  if (segment.kind === "hv") {
    if (clamped <= 0.5) {
      return interpolate(segment.from, segment.bend, clamped * 2);
    }
    return interpolate(segment.bend, segment.to, (clamped - 0.5) * 2);
  }
  if (segment.kind === "cubic") {
    return cubicPoint(segment.from, segment.c1, segment.c2, segment.to, clamped);
  }
  const center = arcCenter(segment.from, segment.params);
  const angle = segment.params.startAngle + (segment.params.endAngle - segment.params.startAngle) * clamped;
  const radians = (angle * Math.PI) / 180;
  return {
    x: center.x + segment.params.rx * Math.cos(radians),
    y: center.y + segment.params.ry * Math.sin(radians)
  };
}

export function tangentAtPlacementSegment(segment: PlacementSegment, t: number): Point {
  const clamped = normalizePathPosition(t);
  if (segment.kind === "line") {
    return { x: segment.to.x - segment.from.x, y: segment.to.y - segment.from.y };
  }
  if (segment.kind === "hv") {
    if (clamped < 0.5) {
      return { x: segment.bend.x - segment.from.x, y: segment.bend.y - segment.from.y };
    }
    return { x: segment.to.x - segment.bend.x, y: segment.to.y - segment.bend.y };
  }
  if (segment.kind === "cubic") {
    const u = 1 - clamped;
    return {
      x:
        3 * u * u * (segment.c1.x - segment.from.x) +
        6 * u * clamped * (segment.c2.x - segment.c1.x) +
        3 * clamped * clamped * (segment.to.x - segment.c2.x),
      y:
        3 * u * u * (segment.c1.y - segment.from.y) +
        6 * u * clamped * (segment.c2.y - segment.c1.y) +
        3 * clamped * clamped * (segment.to.y - segment.c2.y)
    };
  }
  const angle = segment.params.startAngle + (segment.params.endAngle - segment.params.startAngle) * clamped;
  const radians = (angle * Math.PI) / 180;
  const delta = segment.params.endAngle >= segment.params.startAngle ? 1 : -1;
  return {
    x: -segment.params.rx * Math.sin(radians) * delta,
    y: segment.params.ry * Math.cos(radians) * delta
  };
}

export function closestPointOnPlacementSegment(segment: PlacementSegment, point: Point): { t: number; point: Point } {
  if (segment.kind === "line") {
    return closestPointOnLine(point, segment.from, segment.to);
  }
  if (segment.kind === "hv") {
    const first = closestPointOnLine(point, segment.from, segment.bend);
    const second = closestPointOnLine(point, segment.bend, segment.to);
    const firstDist = distanceSquared(point, first.point);
    const secondDist = distanceSquared(point, second.point);
    return firstDist <= secondDist
      ? { t: first.t * 0.5, point: first.point }
      : { t: 0.5 + second.t * 0.5, point: second.point };
  }
  if (segment.kind === "cubic") {
    return closestPointOnCubic(point, segment.from, segment.c1, segment.c2, segment.to);
  }

  const center = arcCenter(segment.from, segment.params);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const rawAngle = Math.atan2(
    segment.params.rx * dy,
    segment.params.ry * dx
  ) * 180 / Math.PI;
  const angle = normalizeDegrees(rawAngle);
  const start = normalizeDegrees(segment.params.startAngle);
  const end = normalizeDegrees(segment.params.endAngle);
  const delta = normalizeSignedAngle(segment.params.endAngle - segment.params.startAngle);
  const sweepPositive = delta >= 0;
  const candidateAngle = clampAngleToArc(angle, start, end, sweepPositive);
  const normalized = delta === 0 ? 0 : normalizePathPosition((candidateAngle - segment.params.startAngle) / delta);
  return { t: normalized, point: pointAtPlacementSegment(segment, normalized) };
}

export function resolvePathAttachedNodeRegime(
  options: OptionListAst | undefined,
  styleChain: readonly StyleChainEntry[] = []
): ScenePathAttachment["regime"] | null {
  const explicitDirection = resolveExplicitPathDirection(options);
  if (explicitDirection) {
    return explicitDirection;
  }

  let autoSide: "left" | "right" | null = null;
  let autoExplicit = false;
  let swap = false;
  let swapExplicit = false;
  const lists = [...styleChain.flatMap((entry) => entry.rawOptions), ...(options ? [options] : [])];
  for (const optionList of lists) {
    for (const entry of optionList.entries) {
      if (entry.kind === "flag") {
        if (entry.key === "auto") {
          autoSide = "left";
          autoExplicit = optionList === options;
        } else if (entry.key === "swap") {
          swap = !swap;
          swapExplicit = optionList === options;
        }
        continue;
      }
      if (entry.kind !== "kv") {
        continue;
      }
      if (entry.key === "auto") {
        const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase();
        if (normalized === "right") {
          autoSide = "right";
          autoExplicit = optionList === options;
        } else if (
          normalized === "left" ||
          normalized === "true" ||
          normalized === "yes" ||
          normalized === "on" ||
          normalized === "1" ||
          normalized.length === 0
        ) {
          autoSide = "left";
          autoExplicit = optionList === options;
        } else if (
          normalized === "false" ||
          normalized === "no" ||
          normalized === "off" ||
          normalized === "0"
        ) {
          autoSide = null;
        }
      }
      if (entry.key === "swap") {
        const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase();
        if (normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1" || normalized.length === 0) {
          swap = true;
          swapExplicit = optionList === options;
        } else if (normalized === "false" || normalized === "no" || normalized === "off" || normalized === "0") {
          swap = false;
          swapExplicit = optionList === options;
        }
      }
    }
  }
  if (autoSide == null) {
    return null;
  }
  return {
    kind: "auto-side",
    side: swap ? (autoSide === "left" ? "right" : "left") : autoSide,
    swap,
    autoExplicit,
    swapExplicit
  };
}

export function resolvePathAttachedNodeSloped(
  options: OptionListAst | undefined,
  styleChain: readonly StyleChainEntry[] = []
): boolean {
  return resolveScopedBooleanOption(options, styleChain, "sloped") ?? false;
}

export function resolveExplicitDirectionFromPoint(
  point: Point,
  anchor: Point,
  family: "cardinal-diagonal" | "base" | "mid"
): string {
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const sx = Math.abs(dx) <= 1e-6 ? 0 : (dx > 0 ? 1 : -1);
  const sy = Math.abs(dy) <= 1e-6 ? 0 : (dy > 0 ? 1 : -1);

  if (family === "base") {
    return sx >= 0 ? "base right" : "base left";
  }
  if (family === "mid") {
    return sx >= 0 ? "mid right" : "mid left";
  }
  if (sx === 0 && sy >= 0) return "above";
  if (sx === 0 && sy < 0) return "below";
  if (sy === 0 && sx >= 0) return "right";
  if (sy === 0 && sx < 0) return "left";
  if (sx > 0 && sy > 0) return "above right";
  if (sx < 0 && sy > 0) return "above left";
  if (sx > 0 && sy < 0) return "below right";
  return "below left";
}

export function resolveDraggedPathAttachedNodeDirection(
  anchor: Point,
  point: Point,
  regime: Extract<ScenePathAttachment["regime"], { kind: "explicit-direction" }>,
  options: { axisThreshold?: number } = {}
): string {
  const axisThreshold = options.axisThreshold ?? 2;
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const current = resolveDirectionSigns(regime.direction);
  const normalizedDirection = normalizeOptionValue(regime.direction).toLowerCase();

  const sx = resolveAxisSign(dx, current.xSign, axisThreshold);
  const sy = resolveAxisSign(dy, current.ySign, axisThreshold);

  if (regime.family === "base") {
    return sx >= 0 ? "base right" : "base left";
  }
  if (regime.family === "mid") {
    return sx >= 0 ? "mid right" : "mid left";
  }
  if (normalizedDirection === "above" || normalizedDirection === "below") {
    return sy >= 0 ? "above" : "below";
  }
  if (normalizedDirection === "left" || normalizedDirection === "right") {
    return sx >= 0 ? "right" : "left";
  }
  if (sx === 0 && sy >= 0) return "above";
  if (sx === 0 && sy < 0) return "below";
  if (sy === 0 && sx >= 0) return "right";
  if (sy === 0 && sx < 0) return "left";
  if (sx > 0 && sy > 0) return "above right";
  if (sx < 0 && sy > 0) return "above left";
  if (sx > 0 && sy < 0) return "below right";
  return "below left";
}

export function resolvePathAttachedDirectionUnit(direction: string): Point {
  const signs = resolveDirectionSigns(direction);
  const magnitude = Math.hypot(signs.xSign, signs.ySign);
  if (magnitude <= 1e-6) {
    return { x: 0, y: 0 };
  }
  return {
    x: signs.xSign / magnitude,
    y: signs.ySign / magnitude
  };
}

function resolveExplicitPathDirection(
  options: OptionListAst | undefined
): Extract<ScenePathAttachment["regime"], { kind: "explicit-direction" }> | null {
  if (!options) {
    return null;
  }
  let resolved: string | null = null;
  for (const entry of options.entries) {
    if (entry.kind === "flag" && EXPLICIT_DIRECTIONS.has(entry.key)) {
      resolved = entry.key;
      continue;
    }
    if (entry.kind === "kv" && EXPLICIT_DIRECTIONS.has(entry.key)) {
      resolved = entry.key;
    }
  }
  if (!resolved) {
    return null;
  }
  const family =
    resolved.startsWith("base ") ? "base" :
    resolved.startsWith("mid ") ? "mid" :
    "cardinal-diagonal";
  return { kind: "explicit-direction", direction: resolved, family };
}

function resolveScopedBooleanOption(
  options: OptionListAst | undefined,
  styleChain: readonly StyleChainEntry[],
  key: string
): boolean | null {
  const local = resolveBooleanOption(options, key);
  if (local != null) {
    return local;
  }
  let inherited: boolean | null = null;
  for (const entry of styleChain) {
    for (const optionList of entry.rawOptions) {
      const resolved = resolveBooleanOption(optionList, key);
      if (resolved != null) {
        inherited = resolved;
      }
    }
  }
  return inherited;
}

function resolveBooleanOption(options: OptionListAst | undefined, key: string): boolean | null {
  if (!options) {
    return null;
  }
  let seen = false;
  let value = false;
  for (const entry of options.entries) {
    if (entry.kind === "flag" && entry.key === key) {
      seen = true;
      value = true;
      continue;
    }
    if (entry.kind !== "kv" || entry.key !== key) {
      continue;
    }
    const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase();
    if (normalized.length === 0 || normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1") {
      seen = true;
      value = true;
    } else if (normalized === "false" || normalized === "no" || normalized === "off" || normalized === "0") {
      seen = true;
      value = false;
    }
  }
  return seen ? value : null;
}

function normalizeOptionValue(raw: string): string {
  return raw.trim().replace(/^\{|\}$/g, "").trim();
}

function resolveAxisSign(value: number, fallback: number, threshold: number): number {
  if (Math.abs(value) <= threshold) {
    return fallback;
  }
  return value > 0 ? 1 : -1;
}

function resolveDirectionSigns(direction: string): { xSign: number; ySign: number } {
  switch (normalizeOptionValue(direction).toLowerCase()) {
    case "above":
      return { xSign: 0, ySign: 1 };
    case "below":
      return { xSign: 0, ySign: -1 };
    case "left":
      return { xSign: -1, ySign: 0 };
    case "right":
      return { xSign: 1, ySign: 0 };
    case "above left":
      return { xSign: -1, ySign: 1 };
    case "above right":
      return { xSign: 1, ySign: 1 };
    case "below left":
      return { xSign: -1, ySign: -1 };
    case "below right":
      return { xSign: 1, ySign: -1 };
    case "base left":
    case "mid left":
      return { xSign: -1, ySign: 0 };
    case "base right":
    case "mid right":
      return { xSign: 1, ySign: 0 };
    default:
      return { xSign: 0, ySign: 0 };
  }
}

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const uu = u * u;
  const uuu = uu * u;
  const tt = t * t;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y
  };
}

function interpolate(from: Point, to: Point, t: number): Point {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceSquared(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function closestPointOnLine(p: Point, a: Point, b: Point): { t: number; point: Point } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-12) {
    return { t: 0, point: { ...a } };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return { t, point: interpolate(a, b, t) };
}

function closestPointOnCubic(p: Point, c0: Point, c1: Point, c2: Point, c3: Point): { t: number; point: Point } {
  let bestT = 0;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= 32; index += 1) {
    const t = index / 32;
    const point = cubicPoint(c0, c1, c2, c3, t);
    const currentDistSq = distanceSquared(p, point);
    if (currentDistSq < bestDistSq) {
      bestDistSq = currentDistSq;
      bestT = t;
    }
  }
  let lo = Math.max(0, bestT - 1 / 32);
  let hi = Math.min(1, bestT + 1 / 32);
  for (let index = 0; index < 18; index += 1) {
    const mid1 = lo + (hi - lo) / 3;
    const mid2 = hi - (hi - lo) / 3;
    const d1 = distanceSquared(p, cubicPoint(c0, c1, c2, c3, mid1));
    const d2 = distanceSquared(p, cubicPoint(c0, c1, c2, c3, mid2));
    if (d1 <= d2) {
      hi = mid2;
    } else {
      lo = mid1;
    }
  }
  const t = (lo + hi) / 2;
  return { t, point: cubicPoint(c0, c1, c2, c3, t) };
}

function arcCenter(from: Point, params: ArcParams): Point {
  const startRadians = (params.startAngle * Math.PI) / 180;
  return {
    x: from.x - params.rx * Math.cos(startRadians),
    y: from.y - params.ry * Math.sin(startRadians)
  };
}

function normalizeDegrees(angle: number): number {
  let normalized = angle % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized;
}

function normalizeSignedAngle(angle: number): number {
  let normalized = angle % 360;
  if (normalized > 180) {
    normalized -= 360;
  } else if (normalized <= -180) {
    normalized += 360;
  }
  return normalized;
}

function clampAngleToArc(angle: number, start: number, end: number, sweepPositive: boolean): number {
  const candidate = normalizeDegrees(angle);
  const startToCandidate = normalizeDegrees(candidate - start);
  const startToEnd = normalizeDegrees(end - start);
  if (sweepPositive) {
    if (startToCandidate <= startToEnd) {
      return start + startToCandidate;
    }
    const toStart = Math.abs(normalizeSignedAngle(candidate - start));
    const toEnd = Math.abs(normalizeSignedAngle(candidate - end));
    return toStart <= toEnd ? start : end;
  }
  const candidateNegative = startToCandidate === 0 ? 0 : startToCandidate - 360;
  const endNegative = startToEnd === 0 ? 0 : startToEnd - 360;
  if (candidateNegative >= endNegative) {
    return start + candidateNegative;
  }
  const toStart = Math.abs(normalizeSignedAngle(candidate - start));
  const toEnd = Math.abs(normalizeSignedAngle(candidate - end));
  return toStart <= toEnd ? start : end;
}
