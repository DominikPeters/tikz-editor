import type { WorldTransform } from "../../coords/transforms.js";
import { worldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { WorldPoint } from "../../coords/points.js";
import { splitAllAtTopLevel } from "../../domains/coordinates/parse.js";
import type { OptionListAst } from "../../options/types.js";
import type { PathOptionItem } from "../../ast/types.js";
import { applyMatrix, applyMatrixToVector } from "../transform.js";
import type { ResolvedStyle, ScenePath } from "../types.js";
import { MAIN_SCENE_LAYER } from "../types.js";
import type { DiagnosticPushFn } from "./types.js";
import { parseCoordinateLike, parseLength } from "../coords/parse-length.js";
import { coordinateInner, normalizeOptionValue, toRadians } from "./shared.js";
import { DEFAULT_GRID_STEP } from "./constants.js";
import type { StyleChainEntry } from "../style-chain.js";
import { cloneStyleChain } from "../style-chain.js";
import { expandPathMacroBindings } from "./macro-expansion.js";
import type { MacroBinding } from "../../macros/index.js";

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

type GridPolarStep = Readonly<{ x: number; y: number }>;

function gridPolarStep(x: number, y: number): GridPolarStep {
  return { x, y };
}

const GRID_POSITION_EPSILON = 1e-6;

export function extractGridSteps(
  item: PathOptionItem,
  pushDiagnostic: DiagnosticPushFn,
  macroBindings: ReadonlyMap<string, MacroBinding>,
  transform: WorldTransform
): { stepX?: number; stepY?: number } | null {
  return extractGridStepsFromOptionList(item.options, pushDiagnostic, macroBindings, transform);
}

export function extractGridStepsFromOptionList(
  options: OptionListAst,
  pushDiagnostic: DiagnosticPushFn,
  macroBindings: ReadonlyMap<string, MacroBinding>,
  transform: WorldTransform
): { stepX?: number; stepY?: number } | null {
  let stepX: number | undefined;
  let stepY: number | undefined;

  for (const entry of options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "step") {
      const expandedValue = expandPathMacroBindings(entry.valueRaw, macroBindings);
      const pair = parseCoordinateLike(expandedValue);
      if (pair) {
        const parsedX = parseLength(pair.x, "cm");
        const parsedY = parseLength(pair.y, "cm");
        if (parsedX == null || parsedY == null || parsedX < 0 || parsedY < 0) {
          pushDiagnostic("invalid-grid-step", "Grid `step` coordinate must provide positive lengths.", entry.span.from, entry.span.to);
          continue;
        }
        stepX = resolveGridAxisStep(parsedX, "x", hasExplicitLengthUnit(pair.x), transform);
        stepY = resolveGridAxisStep(parsedY, "y", hasExplicitLengthUnit(pair.y), transform);
        continue;
      }

      const polar = parsePolarStep(expandPathMacroBindings(entry.valueRaw, macroBindings));
      if (polar) {
        stepX = Math.abs(polar.x);
        stepY = Math.abs(polar.y);
        continue;
      }

      const scalar = parseLength(
        expandPathMacroBindings(entry.valueRaw, macroBindings),
        "cm"
      );
      if (scalar == null || scalar < 0) {
        pushDiagnostic("invalid-grid-step", "Grid `step` must be a positive length.", entry.span.from, entry.span.to);
        continue;
      }
      const hasUnit = hasExplicitLengthUnit(entry.valueRaw);
      stepX = resolveGridAxisStep(scalar, "x", hasUnit, transform);
      stepY = resolveGridAxisStep(scalar, "y", hasUnit, transform);
      continue;
    }

    if (entry.key === "xstep" || entry.key === "x step") {
      const parsed = parseLength(expandPathMacroBindings(entry.valueRaw, macroBindings), "cm");
      if (parsed == null || parsed < 0) {
        pushDiagnostic("invalid-grid-step", "Grid `xstep` must be a positive length.", entry.span.from, entry.span.to);
        continue;
      }
      stepX = resolveGridAxisStep(parsed, "x", hasExplicitLengthUnit(entry.valueRaw), transform);
      continue;
    }

    if (entry.key === "ystep" || entry.key === "y step") {
      const parsed = parseLength(expandPathMacroBindings(entry.valueRaw, macroBindings), "cm");
      if (parsed == null || parsed < 0) {
        pushDiagnostic("invalid-grid-step", "Grid `ystep` must be a positive length.", entry.span.from, entry.span.to);
        continue;
      }
      stepY = resolveGridAxisStep(parsed, "y", hasExplicitLengthUnit(entry.valueRaw), transform);
    }
  }

  if (stepX == null && stepY == null) {
    return null;
  }

  return { stepX, stepY };
}

export function extractGridStepsFromOptionLists(
  optionLists: readonly OptionListAst[],
  pushDiagnostic: DiagnosticPushFn,
  macroBindings: ReadonlyMap<string, MacroBinding>,
  transform: WorldTransform
): { stepX?: number; stepY?: number } | null {
  let stepX: number | undefined;
  let stepY: number | undefined;

  for (const options of optionLists) {
    const parsed = extractGridStepsFromOptionList(options, pushDiagnostic, macroBindings, transform);
    if (!parsed) {
      continue;
    }
    if (parsed.stepX != null) {
      stepX = parsed.stepX;
    }
    if (parsed.stepY != null) {
      stepY = parsed.stepY;
    }
  }

  if (stepX == null && stepY == null) {
    return null;
  }

  return { stepX, stepY };
}

function parsePolarStep(raw: string): GridPolarStep | null {
  const inner = coordinateInner(raw);
  if (!inner) {
    return null;
  }

  const parts = splitAllAtTopLevel(inner, ":").map((part) => part.trim());
  if (parts.length !== 2) {
    return null;
  }

  const angle = Number(parts[0]);
  const radius = parseLength(parts[1], "cm");
  if (!Number.isFinite(angle) || radius == null) {
    return null;
  }

  const radians = toRadians(angle);
  return gridPolarStep(
    radius * Math.cos(radians),
    radius * Math.sin(radians)
  );
}

function resolveGridAxisStep(
  step: number,
  axis: "x" | "y",
  hasExplicitUnit: boolean,
  transform: WorldTransform
): number {
  if (hasExplicitUnit) {
    return Math.abs(step);
  }

  const delta =
    axis === "x"
      ? applyMatrixToVector(transform, wp(step, 0))
      : applyMatrixToVector(transform, wp(0, step));
  const magnitude = Math.hypot(delta.x, delta.y);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-9) {
    return Math.abs(step);
  }
  return Math.abs(magnitude);
}

function hasExplicitLengthUnit(raw: string): boolean {
  const compact = normalizeOptionValue(raw).replace(/\s+/g, "");
  const match = compact.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([A-Za-z]+)?$/);
  return Boolean(match?.[2]);
}

export function makeGridElements(
  sourceId: string,
  itemId: string,
  from: WorldPoint,
  to: WorldPoint,
  stepX: number,
  stepY: number,
  style: ResolvedStyle,
  styleChain: StyleChainEntry[],
  span: { from: number; to: number },
  transform?: WorldTransform
): ScenePath[] {
  if (transform) {
    const affine = makeAffineGridElements(sourceId, itemId, from, to, stepX, stepY, style, styleChain, span, transform);
    if (affine) {
      return affine;
    }
  }

  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);
  const spacingX = stepX >= 0 ? stepX : DEFAULT_GRID_STEP;
  const spacingY = stepY >= 0 ? stepY : DEFAULT_GRID_STEP;

  const paths: ScenePath[] = [];
  if (spacingX > 0) {
    for (const x of gridLinePositions(minX, maxX, spacingX)) {
      paths.push({
        kind: "Path",
        id: `scene-grid-x:${sourceId}:${itemId}:${x.toFixed(3)}`,
        runtimeId: `scene-grid-x:${sourceId}:${itemId}:${x.toFixed(3)}`,
        layer: MAIN_SCENE_LAYER,
        sourceRef: { sourceId, sourceSpan: span, sourceFingerprint: "" },
        style: { ...style },
        styleChain: cloneStyleChain(styleChain),
        commands: [
          { kind: "M", to: wp(x, minY) },
          { kind: "L", to: wp(x, maxY) }
        ]
      });
    }
  }
  if (spacingY > 0) {
    for (const y of gridLinePositions(minY, maxY, spacingY)) {
      paths.push({
        kind: "Path",
        id: `scene-grid-y:${sourceId}:${itemId}:${y.toFixed(3)}`,
        runtimeId: `scene-grid-y:${sourceId}:${itemId}:${y.toFixed(3)}`,
        layer: MAIN_SCENE_LAYER,
        sourceRef: { sourceId, sourceSpan: span, sourceFingerprint: "" },
        style: { ...style },
        styleChain: cloneStyleChain(styleChain),
        commands: [
          { kind: "M", to: wp(minX, y) },
          { kind: "L", to: wp(maxX, y) }
        ]
      });
    }
  }
  return paths;
}

function makeAffineGridElements(
  sourceId: string,
  itemId: string,
  from: WorldPoint,
  to: WorldPoint,
  stepX: number,
  stepY: number,
  style: ResolvedStyle,
  styleChain: StyleChainEntry[],
  span: { from: number; to: number },
  transform: WorldTransform
): ScenePath[] | null {
  const localFrom = applyInverseMatrix(transform, from);
  const localTo = applyInverseMatrix(transform, to);
  if (!localFrom || !localTo) {
    return null;
  }

  const minLocalX = Math.min(localFrom.x, localTo.x);
  const maxLocalX = Math.max(localFrom.x, localTo.x);
  const minLocalY = Math.min(localFrom.y, localTo.y);
  const maxLocalY = Math.max(localFrom.y, localTo.y);

  const spacingX = stepX >= 0 ? stepX : DEFAULT_GRID_STEP;
  const spacingY = stepY >= 0 ? stepY : DEFAULT_GRID_STEP;
  const axisX = applyMatrixToVector(transform, wp(1, 0));
  const axisY = applyMatrixToVector(transform, wp(0, 1));
  const axisXScale = Math.hypot(axisX.x, axisX.y);
  const axisYScale = Math.hypot(axisY.x, axisY.y);
  const localStepX = axisXScale > 1e-9 ? spacingX / axisXScale : spacingX;
  const localStepY = axisYScale > 1e-9 ? spacingY / axisYScale : spacingY;

  const paths: ScenePath[] = [];
  if (localStepX > 1e-9) {
    for (const x of gridLinePositions(minLocalX, maxLocalX, localStepX)) {
      const fromPoint = applyMatrix(transform, wp(x, minLocalY));
      const toPoint = applyMatrix(transform, wp(x, maxLocalY));
      paths.push({
        kind: "Path",
        id: `scene-grid-x:${sourceId}:${itemId}:${x.toFixed(3)}`,
        runtimeId: `scene-grid-x:${sourceId}:${itemId}:${x.toFixed(3)}`,
        layer: MAIN_SCENE_LAYER,
        sourceRef: { sourceId, sourceSpan: span, sourceFingerprint: "" },
        style: { ...style },
        styleChain: cloneStyleChain(styleChain),
        commands: [
          { kind: "M", to: fromPoint },
          { kind: "L", to: toPoint }
        ]
      });
    }
  }

  if (localStepY > 1e-9) {
    for (const y of gridLinePositions(minLocalY, maxLocalY, localStepY)) {
      const fromPoint = applyMatrix(transform, wp(minLocalX, y));
      const toPoint = applyMatrix(transform, wp(maxLocalX, y));
      paths.push({
        kind: "Path",
        id: `scene-grid-y:${sourceId}:${itemId}:${y.toFixed(3)}`,
        runtimeId: `scene-grid-y:${sourceId}:${itemId}:${y.toFixed(3)}`,
        layer: MAIN_SCENE_LAYER,
        sourceRef: { sourceId, sourceSpan: span, sourceFingerprint: "" },
        style: { ...style },
        styleChain: cloneStyleChain(styleChain),
        commands: [
          { kind: "M", to: fromPoint },
          { kind: "L", to: toPoint }
        ]
      });
    }
  }

  return paths;
}

function gridLinePositions(min: number, max: number, spacing: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(spacing) || spacing <= 0) {
    return [];
  }

  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  const positions: number[] = [];
  let value = Math.ceil((lower - GRID_POSITION_EPSILON) / spacing) * spacing;
  if (Math.abs(value) <= GRID_POSITION_EPSILON) {
    value = 0;
  }

  const maxIterations = Math.ceil(Math.max(0, upper - lower) / spacing) + 3;
  for (let index = 0; index < maxIterations && value <= upper + GRID_POSITION_EPSILON; index += 1) {
    positions.push(Math.abs(value) <= GRID_POSITION_EPSILON ? 0 : value);
    value += spacing;
  }
  return positions;
}

function applyInverseMatrix(matrix: WorldTransform, point: WorldPoint): WorldPoint | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-12) {
    return null;
  }

  const translatedX = point.x - matrix.e;
  const translatedY = point.y - matrix.f;
  return wp(
    (matrix.d * translatedX - matrix.c * translatedY) / determinant,
    (-matrix.b * translatedX + matrix.a * translatedY) / determinant
  );
}
