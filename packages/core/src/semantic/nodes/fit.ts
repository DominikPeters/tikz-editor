import type { OptionEntry, OptionListAst } from "../../options/types.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { WorldPoint } from "../../coords/points.js";
import { worldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { parseCoordinate } from "../../domains/coordinates/parse.js";
import { stripWrappingBraces } from "../../utils/braces.js";
import { readNamedNodeGeometry, type SemanticContext } from "../context.js";
import { evaluateRawCoordinate } from "../coords/evaluate.js";
import { parseQuantityExpression } from "../coords/parse-length.js";
import { normalizeOptionValue } from "./utils.js";

type FitDiagnostic = {
  code: string;
  message: string;
};

export type FitOverrideResolution = {
  hasFit: boolean;
  overrideOptions: OptionListAst | null;
  diagnostics: FitDiagnostic[];
};

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

export function resolveFitOverrides(options: OptionListAst | undefined, context: SemanticContext): FitOverrideResolution {
  if (!options) {
    return { hasFit: false, overrideOptions: null, diagnostics: [] };
  }

  let fitEntry: Extract<OptionEntry, { kind: "kv" }> | null = null;
  let rotateFitDegrees: number | null = null;
  const diagnostics: FitDiagnostic[] = [];

  for (const entry of options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "fit") {
      fitEntry = entry;
      continue;
    }
    if (entry.key === "rotate fit") {
      const parsed = parseQuantityExpression(normalizeOptionValue(entry.valueRaw));
      if (parsed && Number.isFinite(parsed.value)) {
        rotateFitDegrees = parsed.value;
      } else {
        diagnostics.push({
          code: `unsupported-fit-rotate:${entry.valueRaw}`,
          message: `Node fit issue: unsupported-fit-rotate:${entry.valueRaw}`
        });
      }
    }
  }

  if (!fitEntry) {
    return { hasFit: false, overrideOptions: null, diagnostics };
  }

  const fitWorldPoints = collectFitSampleWorldPoints(fitEntry.valueRaw, context);
  if (fitWorldPoints.length === 0) {
    diagnostics.push({
      code: "unsupported-fit-targets",
      message: "Node fit issue: unsupported-fit-targets"
    });
    return { hasFit: true, overrideOptions: null, diagnostics };
  }

  const bounds = computeFitWorldBounds(fitWorldPoints, rotateFitDegrees);
  if (!bounds) {
    diagnostics.push({
      code: "unsupported-fit-targets",
      message: "Node fit issue: unsupported-fit-targets"
    });
    return { hasFit: true, overrideOptions: null, diagnostics };
  }

  const rotateSegment =
    rotateFitDegrees != null && Number.isFinite(rotateFitDegrees)
      ? `,rotate=${formatFitNumber(rotateFitDegrees)}`
      : "";
  const halfHeight = bounds.height / 2;
  const overrideRaw = `[at=(${formatFitNumber(bounds.center.x)}pt,${formatFitNumber(bounds.center.y)}pt),anchor=center,align=center,text width={${formatFitNumber(bounds.width)}pt},text height={${formatFitNumber(halfHeight)}pt},text depth={${formatFitNumber(halfHeight)}pt}${rotateSegment}]`;
  const overrideOptions = parseOptionListRaw(overrideRaw, fitEntry.span.from);
  return { hasFit: true, overrideOptions, diagnostics };
}

function collectFitSampleWorldPoints(fitRaw: string, context: SemanticContext): WorldPoint[] {
  const normalized = stripWrappingBraces(fitRaw).trim();
  if (normalized.length === 0) {
    return [];
  }

  const tokens = extractTopLevelCoordinateTokens(normalized);
  const points: WorldPoint[] = [];
  for (const token of tokens) {
    for (const point of resolveFitTokenWorldPoints(token, context)) {
      points.push(point);
    }
  }
  return points;
}

function extractTopLevelCoordinateTokens(raw: string): string[] {
  const tokens: string[] = [];
  let start = -1;
  let depth = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\\" && index + 1 < raw.length) {
      index += 1;
      continue;
    }
    if (char === "(") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char === ")") {
      if (depth === 0) {
        continue;
      }
      depth -= 1;
      if (depth === 0 && start >= 0) {
        tokens.push(raw.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return tokens;
}

function resolveFitTokenWorldPoints(tokenRaw: string, context: SemanticContext): WorldPoint[] {
  const coordinate = evaluateRawCoordinate(tokenRaw, context);
  if (!coordinate.world) {
    return [];
  }

  const parsed = parseCoordinate(tokenRaw);
  const maybeName = parsed.form === "named" ? parsed.x.trim() : "";
  if (!isBareNodeReference(maybeName)) {
    return [coordinate.world];
  }

  const geometry = resolveScopedNamedNodeGeometry(maybeName, context);
  if (!geometry) {
    return [coordinate.world];
  }

  const anchors: WorldPoint[] = [];
  for (const anchor of ["west", "east", "north", "south"]) {
    const resolved = evaluateRawCoordinate(`(${maybeName}.${anchor})`, context);
    if (resolved.world) {
      anchors.push(resolved.world);
    }
  }
  return anchors.length > 0 ? anchors : [coordinate.world];
}

function isBareNodeReference(nameRaw: string): boolean {
  if (nameRaw.length === 0) {
    return false;
  }
  if (nameRaw.includes(".")) {
    return false;
  }
  const normalized = stripWrappingBraces(nameRaw).trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  if (normalized.startsWith("intersection ") || normalized.includes(" of ")) {
    return false;
  }
  if (normalized.includes("|-") || normalized.includes("-|")) {
    return false;
  }
  return true;
}

function resolveScopedNamedNodeGeometry(name: string, context: SemanticContext) {
  const frame = context.stack[context.stack.length - 1];
  const prefix = frame?.namePrefix ?? "";
  const suffix = frame?.nameSuffix ?? "";
  const scoped = applyRawNameScope(name, prefix, suffix);
  return readNamedNodeGeometry(context, scoped) ?? readNamedNodeGeometry(context, name);
}

function applyRawNameScope(name: string, prefix: string, suffix: string): string {
  if (prefix.length === 0 && suffix.length === 0) {
    return name;
  }
  const dot = name.indexOf(".");
  if (dot === -1) {
    return `${prefix}${name}${suffix}`;
  }
  const base = name.slice(0, dot);
  const anchor = name.slice(dot);
  return `${prefix}${base}${suffix}${anchor}`;
}

function computeFitWorldBounds(
  points: WorldPoint[],
  rotateFitDegrees: number | null
): { center: WorldPoint; width: number; height: number } | null {
  if (points.length === 0) {
    return null;
  }

  const hasRotate = rotateFitDegrees != null && Number.isFinite(rotateFitDegrees);
  const sampled = hasRotate ? points.map((point) => rotateWorldPoint(point, -rotateFitDegrees)) : points;
  const minX = Math.min(...sampled.map((point) => point.x));
  const maxX = Math.max(...sampled.map((point) => point.x));
  const minY = Math.min(...sampled.map((point) => point.y));
  const maxY = Math.max(...sampled.map((point) => point.y));

  if (![minX, maxX, minY, maxY].every(Number.isFinite)) {
    return null;
  }

  const centerRotated = wp((minX + maxX) / 2, (minY + maxY) / 2);
  const center = hasRotate ? rotateWorldPoint(centerRotated, rotateFitDegrees) : centerRotated;
  return {
    center,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY)
  };
}

function rotateWorldPoint(point: WorldPoint, degrees: number): WorldPoint {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return wp(point.x * cos - point.y * sin, point.x * sin + point.y * cos);
}

function formatFitNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.abs(value) < 1e-9 ? 0 : value;
  return Number(rounded.toFixed(6)).toString();
}
