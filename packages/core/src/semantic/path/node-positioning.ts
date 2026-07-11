import { worldTransform } from "../../coords/transforms.js";
import { pt } from "../../coords/scalars.js";
import { PT_PER_CM } from "../../coords/source.js";
import { worldPoint as makeWorldPoint, worldVector as makeWorldVector, type WorldPoint, type WorldVector } from "../../coords/points.js";
import { parseCoordinate } from "../../domains/coordinates/parse.js";
import type { Span } from "../../ast/types.js";
import type { OptionListAst } from "../../options/types.js";
import type { NodeDistanceSpec, NodeDistanceValue, SemanticContext } from "../context.js";
import { evaluateRawCoordinate } from "../coords/evaluate.js";
import { parseLength, parseQuantityExpression } from "../coords/parse-length.js";
import { applyMatrixToVector } from "../transform.js";
import { parseBooleanishNormalized } from "../../utils/booleanish.js";
import { normalizeOptionValue } from "./shared.js";

export type PositioningDirection =
  | "above"
  | "below"
  | "left"
  | "right"
  | "above left"
  | "above right"
  | "below left"
  | "below right"
  | "base left"
  | "base right"
  | "mid left"
  | "mid right";

export type ParsedDirectionalKey = {
  direction: PositioningDirection;
  legacyOf: boolean;
};

type DirectionMeta = {
  xSign: -1 | 0 | 1;
  ySign: -1 | 0 | 1;
  currentAnchor: string;
  targetAnchor: string;
  singleFactor: number;
};

const DIRECTION_KEYS: Record<PositioningDirection, PositioningDirection> = {
  above: "above",
  below: "below",
  left: "left",
  right: "right",
  "above left": "above left",
  "above right": "above right",
  "below left": "below left",
  "below right": "below right",
  "base left": "base left",
  "base right": "base right",
  "mid left": "mid left",
  "mid right": "mid right"
};

const DIRECTION_META: Record<PositioningDirection, DirectionMeta> = {
  above: { xSign: 0, ySign: 1, currentAnchor: "south", targetAnchor: "north", singleFactor: 1 },
  below: { xSign: 0, ySign: -1, currentAnchor: "north", targetAnchor: "south", singleFactor: 1 },
  left: { xSign: -1, ySign: 0, currentAnchor: "east", targetAnchor: "west", singleFactor: 1 },
  right: { xSign: 1, ySign: 0, currentAnchor: "west", targetAnchor: "east", singleFactor: 1 },
  "above left": { xSign: -1, ySign: 1, currentAnchor: "south east", targetAnchor: "north west", singleFactor: 0.707106781 },
  "above right": { xSign: 1, ySign: 1, currentAnchor: "south west", targetAnchor: "north east", singleFactor: 0.707106781 },
  "below left": { xSign: -1, ySign: -1, currentAnchor: "north east", targetAnchor: "south west", singleFactor: 0.707106781 },
  "below right": { xSign: 1, ySign: -1, currentAnchor: "north west", targetAnchor: "south east", singleFactor: 0.707106781 },
  "base left": { xSign: -1, ySign: 0, currentAnchor: "base east", targetAnchor: "base west", singleFactor: 1 },
  "base right": { xSign: 1, ySign: 0, currentAnchor: "base west", targetAnchor: "base east", singleFactor: 1 },
  "mid left": { xSign: -1, ySign: 0, currentAnchor: "mid east", targetAnchor: "mid west", singleFactor: 1 },
  "mid right": { xSign: 1, ySign: 0, currentAnchor: "mid west", targetAnchor: "mid east", singleFactor: 1 }
};

const IDENTITY_MATRIX = worldTransform(1, 0, 0, 1, 0, 0);

function worldPoint(x: number, y: number): WorldPoint {
  return makeWorldPoint(pt(x), pt(y));
}

function worldVector(x: number, y: number): WorldVector {
  return makeWorldVector(pt(x), pt(y));
}

type RelativePlacementSpec = {
  direction: PositioningDirection;
  legacyOf: boolean;
  targetRaw: string;
  shiftRaw: string;
  span: Span;
};

export type NodePositioningResolution = {
  anchorPoint: WorldPoint;
  anchorOverride?: string;
  diagnostics: string[];
  relativePlacement?: {
    direction: PositioningDirection;
    targetNodeName: string;
    targetWorld: WorldPoint;
    targetCenter: WorldPoint;
    legacyOf: boolean;
    span: Span;
  };
};

export function parseDirectionalKey(key: string): ParsedDirectionalKey | null {
  const normalized = key.trim().toLowerCase();
  const direct = DIRECTION_KEYS[normalized as PositioningDirection];
  if (direct) {
    return { direction: direct, legacyOf: false };
  }

  if (!normalized.endsWith(" of")) {
    return null;
  }

  const base = normalized.slice(0, -3).trim();
  const legacy = DIRECTION_KEYS[base as PositioningDirection];
  if (!legacy) {
    return null;
  }

  return { direction: legacy, legacyOf: true };
}

export function currentAnchorForDirection(direction: PositioningDirection): string {
  return DIRECTION_META[direction].currentAnchor;
}

export function targetAnchorForDirection(direction: PositioningDirection): string {
  return DIRECTION_META[direction].targetAnchor;
}

export function parseNodeDistance(raw: string, opts: { allowNegative?: boolean } = {}): NodeDistanceSpec | null {
  const normalized = normalizeOptionValue(raw);
  if (normalized.length === 0) {
    return null;
  }

  const allowNegative = opts.allowNegative === true;
  const parts = normalized
    .split(/\band\b/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 2) {
    const vertical = parseNodeDistanceValue(parts[0]);
    const horizontal = parseNodeDistanceValue(parts[1]);
    if (!vertical || !horizontal) {
      return null;
    }
    if (!allowNegative && (vertical.value < 0 || horizontal.value < 0)) {
      return null;
    }
    return { kind: "pair", vertical, horizontal };
  }

  const single = parseNodeDistanceValue(normalized);
  if (!single) {
    return null;
  }
  if (!allowNegative && single.value < 0) {
    return null;
  }
  return { kind: "single", value: single };
}

export function resolveNodePositioningTarget(
  options: OptionListAst | undefined,
  context: SemanticContext,
  fallbackTarget: WorldPoint
): NodePositioningResolution {
  if (!options) {
    return { anchorPoint: fallbackTarget, diagnostics: [] };
  }

  const diagnostics: string[] = [];
  const frame = context.stack[context.stack.length - 1];
  const activeTransform = frame?.transform ?? IDENTITY_MATRIX;
  let onGrid = frame?.onGrid ?? false;
  let nodeDistance = frame?.nodeDistance ?? {
    kind: "pair",
    vertical: { kind: "dimension", value: PT_PER_CM },
    horizontal: { kind: "dimension", value: PT_PER_CM }
  };
  let relativePlacement: RelativePlacementSpec | null = null;
  let additiveOffset: WorldVector = makeWorldVector(pt(0), pt(0));

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "centered") {
        additiveOffset = makeWorldVector(pt(0), pt(0));
      } else if (entry.key === "on grid") {
        onGrid = true;
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "on grid") {
      const parsed = parseBoolish(entry.valueRaw);
      if (parsed != null) {
        onGrid = parsed;
      }
      continue;
    }

    if (entry.key === "node distance") {
      const parsed = parseNodeDistance(entry.valueRaw);
      if (parsed) {
        nodeDistance = parsed;
      } else {
        diagnostics.push(`invalid-node-distance:${entry.valueRaw}`);
      }
      continue;
    }

    if (entry.key === "xshift") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed == null || !Number.isFinite(parsed)) {
        diagnostics.push(`invalid-xshift:${entry.valueRaw}`);
      } else {
        additiveOffset = worldVector(additiveOffset.x + parsed, additiveOffset.y);
      }
      continue;
    }

    if (entry.key === "yshift") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed == null || !Number.isFinite(parsed)) {
        diagnostics.push(`invalid-yshift:${entry.valueRaw}`);
      } else {
        additiveOffset = worldVector(additiveOffset.x, additiveOffset.y + parsed);
      }
      continue;
    }

    const directional = parseDirectionalKey(entry.key);
    if (!directional) {
      continue;
    }

    if (directional.legacyOf) {
      const targetRaw = normalizeOptionValue(entry.valueRaw);
      if (targetRaw.length === 0) {
        diagnostics.push("invalid-positioning-of-target");
        continue;
      }
      relativePlacement = {
        direction: directional.direction,
        legacyOf: true,
        targetRaw,
        shiftRaw: "",
        span: entry.span
      };
      continue;
    }

    const spec = parseOfPart(entry.valueRaw);
    if (spec) {
      relativePlacement = {
        direction: directional.direction,
        legacyOf: false,
        targetRaw: spec.targetRaw,
        shiftRaw: spec.shiftRaw,
        span: entry.span
      };
      continue;
    }

    const parsedOffset = parseDirectionalOffset(directional.direction, entry.valueRaw, activeTransform);
    if (!parsedOffset) {
      diagnostics.push(`invalid-positioning-shift:${entry.valueRaw}`);
      continue;
    }
    additiveOffset = worldVector(additiveOffset.x + parsedOffset.x, additiveOffset.y + parsedOffset.y);
  }

  let anchorPoint = worldPoint(fallbackTarget.x + additiveOffset.x, fallbackTarget.y + additiveOffset.y);
  let anchorOverride: string | undefined;

  let relativePlacementResult: NodePositioningResolution["relativePlacement"];

  if (relativePlacement) {
    const resolved = resolveRelativePlacement(relativePlacement, context, onGrid, nodeDistance, activeTransform);
    diagnostics.push(...resolved.diagnostics);
    if (resolved.anchorPoint) {
      anchorPoint = worldPoint(
        resolved.anchorPoint.x + additiveOffset.x,
        resolved.anchorPoint.y + additiveOffset.y
      );
    }
    if (resolved.anchorOverride) {
      anchorOverride = resolved.anchorOverride;
    }
    if (resolved.targetWorld) {
      relativePlacementResult = {
        direction: relativePlacement.direction,
        targetNodeName: relativePlacement.targetRaw,
        targetWorld: resolved.targetWorld,
        targetCenter: resolved.targetCenter ?? resolved.targetWorld,
        legacyOf: relativePlacement.legacyOf,
        span: relativePlacement.span
      };
    }
  }

  return { anchorPoint, anchorOverride, diagnostics, relativePlacement: relativePlacementResult };
}

function parseDirectionalOffset(direction: PositioningDirection, raw: string, transform: typeof IDENTITY_MATRIX): WorldVector | null {
  const normalized = normalizeOptionValue(raw);
  const shift =
    normalized.length === 0
      ? {
          kind: "single" as const,
          value: { kind: "dimension" as const, value: 0 }
        }
      : parseNodeDistance(normalized, { allowNegative: true });
  if (!shift) {
    return null;
  }
  return shiftVectorForDirection(direction, shift, transform);
}

function parseOfPart(raw: string): { shiftRaw: string; targetRaw: string } | null {
  const normalized = normalizeOptionValue(raw);
  const match = normalized.match(/^(.*?)\bof\b\s*(.+)$/i);
  if (!match) {
    return null;
  }

  const shiftRaw = match[1]?.trim() ?? "";
  const targetRaw = normalizeOptionValue(match[2] ?? "").trim();
  if (targetRaw.length === 0) {
    return null;
  }
  return { shiftRaw, targetRaw };
}

function resolveRelativePlacement(
  spec: RelativePlacementSpec,
  context: SemanticContext,
  onGrid: boolean,
  defaultNodeDistance: NodeDistanceSpec,
  transform: typeof IDENTITY_MATRIX
): { anchorPoint: WorldPoint | null; targetWorld?: WorldPoint; targetCenter?: WorldPoint; anchorOverride?: string; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const meta = DIRECTION_META[spec.direction];
  const resolvedReference = resolveReferencePoint(spec, context, onGrid);
  diagnostics.push(...resolvedReference.diagnostics);
  if (!resolvedReference.point) {
    return { anchorPoint: null, diagnostics };
  }
  // Also resolve the target center (on-grid mode) for continuous rewriting
  const resolvedCenter = resolveReferencePoint(spec, context, /* onGrid */ true);
  const targetCenter = resolvedCenter.point ?? resolvedReference.point;

  const shiftSpec =
    spec.shiftRaw.trim().length === 0 ? defaultNodeDistance : parseNodeDistance(spec.shiftRaw, { allowNegative: true });
  if (!shiftSpec) {
    diagnostics.push(`invalid-positioning-shift:${spec.shiftRaw}`);
    return { anchorPoint: null, diagnostics };
  }

  const shift = shiftVectorForDirection(spec.direction, shiftSpec, transform);
  const anchorPoint = worldPoint(
    resolvedReference.point.x + shift.x,
    resolvedReference.point.y + shift.y
  );

  const targetWorld = resolvedReference.point;

  if (spec.legacyOf || (resolvedReference.usesBareNodeName && onGrid)) {
    return {
      anchorPoint,
      targetWorld,
      targetCenter,
      anchorOverride: "center",
      diagnostics
    };
  }

  return {
    anchorPoint,
    targetWorld,
    targetCenter,
    anchorOverride: meta.currentAnchor,
    diagnostics
  };
}

function resolveReferencePoint(
  spec: RelativePlacementSpec,
  context: SemanticContext,
  onGrid: boolean
): { point: WorldPoint | null; usesBareNodeName: boolean; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const meta = DIRECTION_META[spec.direction];
  const targetRaw = normalizeOptionValue(spec.targetRaw).trim();
  if (targetRaw.length === 0) {
    diagnostics.push("invalid-positioning-of-target");
    return { point: null, usesBareNodeName: false, diagnostics };
  }

  const coordinateRaw = toCoordinateRaw(targetRaw);
  const parsed = parseCoordinate(coordinateRaw);
  let lookupRaw = coordinateRaw;
  let usesBareNodeName = false;

  if (parsed.form === "named") {
    const rawName = parsed.x.trim();
    if (rawName.length > 0 && !rawName.includes(".")) {
      usesBareNodeName = true;
      if (spec.legacyOf || onGrid) {
        lookupRaw = `(${rawName})`;
      } else {
        lookupRaw = `(${rawName}.${meta.targetAnchor})`;
      }
    }
  }

  const evaluated = evaluateRawCoordinate(lookupRaw, context);
  diagnostics.push(...evaluated.diagnostics);
  return { point: evaluated.world, usesBareNodeName, diagnostics };
}

function shiftVectorForDirection(direction: PositioningDirection, shift: NodeDistanceSpec, transform: typeof IDENTITY_MATRIX): WorldVector {
  const meta = DIRECTION_META[direction];

  const horizontalComponent = shift.kind === "single" ? shift.value : shift.horizontal;
  const verticalComponent = shift.kind === "single" ? shift.value : shift.vertical;

  const horizontalVector = horizontalPositioningVector(horizontalComponent, transform);
  const verticalVector = verticalPositioningVector(verticalComponent, transform);
  let base = worldVector(horizontalVector.x + verticalVector.x, horizontalVector.y + verticalVector.y);

  if (shift.kind === "single" && Math.abs(meta.singleFactor - 1) > 1e-9) {
    base = worldVector(base.x * meta.singleFactor, base.y * meta.singleFactor);
  }

  return worldVector(meta.xSign * base.x, meta.ySign * base.y);
}

function horizontalPositioningVector(component: NodeDistanceValue, transform: typeof IDENTITY_MATRIX): WorldVector {
  if (component.kind === "dimension") {
    return worldVector(component.value, 0);
  }

  return applyMatrixToVector(transform, worldVector(component.value * PT_PER_CM, 0));
}

function verticalPositioningVector(component: NodeDistanceValue, transform: typeof IDENTITY_MATRIX): WorldVector {
  if (component.kind === "dimension") {
    return worldVector(0, component.value);
  }

  return applyMatrixToVector(transform, worldVector(0, component.value * PT_PER_CM));
}

function parseNodeDistanceValue(raw: string): NodeDistanceValue | null {
  const quantity = parseQuantityExpression(normalizeOptionValue(raw));
  if (!quantity || !Number.isFinite(quantity.value)) {
    return null;
  }

  if (quantity.kind === "length") {
    return { kind: "dimension", value: quantity.value };
  }

  return { kind: "number", value: quantity.value };
}

function toCoordinateRaw(raw: string): string {
  const normalized = normalizeOptionValue(raw).trim();
  if (normalized.startsWith("(") && normalized.endsWith(")")) {
    return normalized;
  }
  return `(${normalized})`;
}

function parseBoolish(raw: string): boolean | null {
  return parseBooleanishNormalized(normalizeOptionValue(raw));
}
