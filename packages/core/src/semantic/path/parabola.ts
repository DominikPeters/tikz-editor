import { currentFrame } from "../context.js";
import { worldPoint, worldVector } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { WorldPoint, WorldVector } from "../../coords/points.js";
import type { PathItem, PathOptionItem } from "../../ast/types.js";
import type { SemanticContext } from "../context.js";
import { evaluateCoordinate, evaluateRawCoordinate } from "../coords/evaluate.js";
import { parseLength } from "../coords/parse-length.js";
import type { ScenePathCommand } from "../types.js";
import { clamp, interpolate, normalizeOptionValue } from "./shared.js";
import { expandPathMacroBindings } from "./macro-expansion.js";

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

function wv(x: number, y: number): WorldVector {
  return worldVector(pt(x), pt(y));
}

export function parseParabolaFromItems(
  items: PathItem[],
  startIndex: number,
  context: SemanticContext
): { consumedIndex: number; commands: ScenePathCommand[]; endPoint: WorldPoint } | null {
  const start = context.currentPoint;
  if (!start) {
    return null;
  }

  let cursor = startIndex + 1;
  let parabolaOptions: PathOptionItem["options"] | undefined;

  const maybeOption = items[cursor];
  if (maybeOption?.kind === "PathOption") {
    parabolaOptions = maybeOption.options;
    cursor += 1;
  }

  const parsedOptions = parseParabolaOptions(parabolaOptions, context);
  let bendSpec = parsedOptions.bend;
  let bendPos = parsedOptions.bendPos;

  const maybeBendKeyword = items[cursor];
  if (maybeBendKeyword?.kind === "PathKeyword" && maybeBendKeyword.keyword === "bend") {
    const bendCoordinate = items[cursor + 1];
    if (bendCoordinate?.kind !== "Coordinate") {
      return null;
    }
    bendSpec = {
      kind: "coordinate",
      raw: bendCoordinate.raw,
      ...(bendCoordinate.relativePrefix === undefined ? {} : { relativePrefix: bendCoordinate.relativePrefix })
    };
    cursor += 2;
  }

  const targetItem = items[cursor];
  let endPoint: WorldPoint | null = null;
  if (targetItem?.kind === "Coordinate") {
    const evaluated = evaluateCoordinate(targetItem, context);
    endPoint = evaluated.world;
  } else if (targetItem?.kind === "PathKeyword" && targetItem.keyword === "cycle") {
    endPoint = context.pathStartPoint;
  }

  if (!endPoint) {
    return null;
  }

  if (!Number.isFinite(bendPos)) {
    bendPos = 0;
  }
  bendPos = clamp(bendPos, 0, 1);
  const savedPoint = interpolate(start, endPoint, bendPos);

  let bendPoint: WorldPoint | null;
  if (bendSpec.kind === "saved") {
    bendPoint = savedPoint;
  } else if (bendSpec.kind === "height") {
    bendPoint = wp(savedPoint.x, savedPoint.y + bendSpec.height);
  } else {
    bendPoint = evaluateParabolaBendCoordinate(bendSpec.raw, context, savedPoint, bendSpec.relativePrefix);
  }

  if (!bendPoint) {
    return null;
  }

  const toBend = wv(bendPoint.x - start.x, bendPoint.y - start.y);
  const toEnd = wv(endPoint.x - bendPoint.x, endPoint.y - bendPoint.y);

  return {
    consumedIndex: cursor,
    commands: buildParabolaCommands(start, toBend, toEnd),
    endPoint
  };
}

function parseParabolaOptions(
  options: PathOptionItem["options"] | undefined,
  context: SemanticContext
): {
  bendPos: number;
  bend:
    | { kind: "saved" }
    | { kind: "height"; height: number }
    | { kind: "coordinate"; raw: string; relativePrefix?: "+" | "++" };
} {
  let bendPos = 0;
  let bend:
    | { kind: "saved" }
    | { kind: "height"; height: number }
    | { kind: "coordinate"; raw: string; relativePrefix?: "+" | "++" } = { kind: "saved" };
  const frame = currentFrame(context);

  if (!options) {
    return { bendPos, bend };
  }

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "bend at end") {
        bendPos = 1;
        bend = { kind: "coordinate", raw: "(0,0)", relativePrefix: "+" };
      } else if (entry.key === "bend at start") {
        bendPos = 0;
        bend = { kind: "coordinate", raw: "(0,0)", relativePrefix: "+" };
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "bend pos") {
      const parsed = Number(normalizeOptionValue(entry.valueRaw));
      if (Number.isFinite(parsed)) {
        bendPos = parsed;
      }
      continue;
    }
    if (entry.key === "parabola height") {
      const parsed = parseLength(expandPathMacroBindings(entry.valueRaw, frame.macroBindings), "cm");
      if (parsed != null) {
        bendPos = 0.5;
        bend = { kind: "height", height: parsed };
      }
      continue;
    }
    if (entry.key === "bend") {
      const parsed = parseBendCoordinateValue(expandPathMacroBindings(entry.valueRaw, frame.macroBindings));
      if (parsed) {
        bend = { kind: "coordinate", raw: parsed.raw, ...(parsed.relativePrefix === undefined ? {} : { relativePrefix: parsed.relativePrefix }) };
      }
    }
  }

  return { bendPos, bend };
}

function parseBendCoordinateValue(raw: string): { raw: string; relativePrefix?: "+" | "++" } | null {
  const normalized = normalizeOptionValue(raw);
  if (normalized.length === 0) {
    return null;
  }

  let relativePrefix: "+" | "++" | undefined;
  let coordinateRaw = normalized;
  if (coordinateRaw.startsWith("++")) {
    relativePrefix = "++";
    coordinateRaw = coordinateRaw.slice(2).trim();
  } else if (coordinateRaw.startsWith("+")) {
    relativePrefix = "+";
    coordinateRaw = coordinateRaw.slice(1).trim();
  }

  if (!coordinateRaw.startsWith("(") || !coordinateRaw.endsWith(")")) {
    return null;
  }

  return { raw: coordinateRaw, ...(relativePrefix === undefined ? {} : { relativePrefix: relativePrefix }) };
}

function evaluateParabolaBendCoordinate(
  raw: string,
  context: SemanticContext,
  savedPoint: WorldPoint,
  relativePrefix?: "+" | "++"
): WorldPoint | null {
  if (!relativePrefix) {
    return evaluateRawCoordinate(raw, context).world;
  }

  const originalCurrent = context.currentPoint;
  context.currentPoint = savedPoint;
  const evaluated = evaluateRawCoordinate(raw, context, relativePrefix);
  context.currentPoint = originalCurrent;
  return evaluated.world;
}

function buildParabolaCommands(start: WorldPoint, toBend: WorldVector, toEnd: WorldVector): ScenePathCommand[] {
  const commands: ScenePathCommand[] = [];

  const hasBendSegment = Math.abs(toBend.x) > 1e-9 || Math.abs(toBend.y) > 1e-9;
  const bend = wp(start.x + toBend.x, start.y + toBend.y);
  if (hasBendSegment) {
    commands.push({
      kind: "C",
      c1: wp(start.x + 0.1125 * toBend.x, start.y + 0.225 * toBend.y),
      c2: wp(start.x + 0.5 * toBend.x, start.y + toBend.y),
      to: bend
    });
  }

  const hasEndSegment = Math.abs(toEnd.x) > 1e-9 || Math.abs(toEnd.y) > 1e-9;
  if (hasEndSegment) {
    commands.push({
      kind: "C",
      c1: wp(bend.x + 0.5 * toEnd.x, bend.y),
      c2: wp(bend.x + 0.8875 * toEnd.x, bend.y + 0.775 * toEnd.y),
      to: wp(bend.x + toEnd.x, bend.y + toEnd.y)
    });
  }

  return commands;
}
