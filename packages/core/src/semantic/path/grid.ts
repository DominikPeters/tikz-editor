import { defaultAxisBasis, type AxisBasis } from "../coords/axis-basis.js";
import { PT_PER_CM } from "../../coords/source.js";
import type { WorldTransform } from "../../coords/transforms.js";
import { worldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { WorldPoint } from "../../coords/points.js";
import { splitAllAtTopLevel } from "../../domains/coordinates/parse.js";
import type { OptionListAst } from "../../options/types.js";
import type { PathOptionItem } from "../../ast/types.js";
import { applyMatrix } from "../transform.js";
import type { ResolvedStyle, ScenePath } from "../types.js";
import { MAIN_SCENE_LAYER } from "../types.js";
import type { DiagnosticPushFn } from "./types.js";
import { parseCoordinateLike, parseLengthWithInfo } from "../coords/parse-length.js";
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

export type GridStepValues = Readonly<{ x: string; y: string }>;
export const DEFAULT_GRID_STEP_VALUES: GridStepValues = Object.freeze({ x: "1cm", y: "1cm" });
export type GridSpacing = { stepX: number; stepY: number; rawSteps: GridStepValues };

export function extractGridSteps(
  item: PathOptionItem,
  pushDiagnostic: DiagnosticPushFn,
  macroBindings: ReadonlyMap<string, MacroBinding>,
  basis: AxisBasis = defaultAxisBasis(),
  inheritedSteps: GridStepValues = DEFAULT_GRID_STEP_VALUES
): GridSpacing | null {
  return extractGridStepsFromOptionList(item.options, pushDiagnostic, macroBindings, basis, inheritedSteps);
}

export function extractGridStepsFromOptionList(
  options: OptionListAst,
  pushDiagnostic: DiagnosticPushFn,
  macroBindings: ReadonlyMap<string, MacroBinding>,
  basis: AxisBasis = defaultAxisBasis(),
  inheritedSteps: GridStepValues = DEFAULT_GRID_STEP_VALUES
): GridSpacing | null {
  let xRaw = inheritedSteps.x;
  let yRaw = inheritedSteps.y;
  let changed = false;
  const valid = (raw: string): boolean => {
    const length = parseLengthWithInfo(raw, "cm");
    return length != null && length.value >= 0;
  };
  const invalid = (from: number, to: number): void => {
    pushDiagnostic("invalid-grid-step", "Grid step must provide nonnegative lengths.", from, to);
  };
  for (const entry of options.entries) {
    if (entry.kind !== "kv") continue;
    const value = normalizeOptionValue(expandPathMacroBindings(entry.valueRaw, macroBindings));
    if (entry.key === "step") {
      const pair = parseCoordinateLike(value);
      if (pair) {
        if (!valid(pair.x) || !valid(pair.y)) { invalid(entry.span.from, entry.span.to); continue; }
        xRaw = pair.x;
        yRaw = pair.y;
      } else {
        const polar = parsePolarStep(value, basis);
        if (polar) {
          xRaw = `${polar.x}pt`;
          yRaw = `${polar.y}pt`;
        } else {
          if (!valid(value)) { invalid(entry.span.from, entry.span.to); continue; }
          xRaw = yRaw = value;
        }
      }
      changed = true;
    } else if (entry.key === "xstep" || entry.key === "x step") {
      if (!valid(value)) { invalid(entry.span.from, entry.span.to); continue; }
      xRaw = value;
      changed = true;
    } else if (entry.key === "ystep" || entry.key === "y step") {
      if (!valid(value)) { invalid(entry.span.from, entry.span.to); continue; }
      yRaw = value;
      changed = true;
    }
  }
  if (!changed) return null;
  const x = parseLengthWithInfo(xRaw, "cm");
  const y = parseLengthWithInfo(yRaw, "cm");
  if (!x || !y || x.value < 0 || y.value < 0) {
    pushDiagnostic("invalid-grid-step", "Grid step must provide nonnegative lengths.", options.span.from, options.span.to);
    return null;
  }
  // tikz@gridB adds the two pre-CTM vectors, then uses their canvas x/y components.
  const xVector = x.hasExplicitUnit ? wp(x.value, 0) : wp(x.value / PT_PER_CM * basis.x.x, x.value / PT_PER_CM * basis.x.y);
  const yVector = y.hasExplicitUnit ? wp(0, y.value) : wp(y.value / PT_PER_CM * basis.y.x, y.value / PT_PER_CM * basis.y.y);
  return { stepX: Math.abs(xVector.x + yVector.x), stepY: Math.abs(xVector.y + yVector.y), rawSteps: { x: xRaw, y: yRaw } };
}

export function extractGridStepsFromOptionLists(
  optionLists: readonly OptionListAst[],
  pushDiagnostic: DiagnosticPushFn,
  macroBindings: ReadonlyMap<string, MacroBinding>,
  basis: AxisBasis = defaultAxisBasis(),
  inheritedSteps: GridStepValues = DEFAULT_GRID_STEP_VALUES
): GridSpacing | null {
  if (optionLists.length === 0) return null;
  return extractGridStepsFromOptionList({ ...optionLists[0], entries: optionLists.flatMap(list => list.entries) }, pushDiagnostic, macroBindings, basis, inheritedSteps);
}

function parsePolarStep(raw: string, basis: AxisBasis): GridPolarStep | null {
  const inner = coordinateInner(raw);
  if (!inner) return null;
  const parts = splitAllAtTopLevel(inner, ":").map(part => part.trim());
  if (parts.length !== 2) return null;
  const angle = Number(parts[0]);
  const radius = parseLengthWithInfo(parts[1], "cm");
  if (!Number.isFinite(angle) || !radius) return null;
  const radians = toRadians(angle);
  const x = radius.value * Math.cos(radians);
  const y = radius.value * Math.sin(radians);
  return radius.hasExplicitUnit ? gridPolarStep(x, y) : gridPolarStep(
    (basis.x.x * x + basis.y.x * y) / PT_PER_CM,
    (basis.x.y * x + basis.y.y * y) / PT_PER_CM
  );
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
  const localStepX = spacingX;
  const localStepY = spacingY;

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
