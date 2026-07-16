import type { CoordinateForm, CoordinateItem } from "../../ast/types.js";
import { pt } from "../../coords/scalars.js";
import { parseCoordinate } from "../../domains/coordinates/parse.js";
import { splitAllAtTopLevel } from "../../domains/coordinates/parse.js";
import { DEFAULT_MACRO_EXPANSION_MAX_DEPTH, expandMacroBindings, type MacroBinding } from "../../macros/index.js";
import {
  readNamedCoordinate,
  readNamedNodeGeometry,
  resolveAddonCoordinateSystem,
  type NamedNodeGeometry,
  type SemanticContext
} from "../context.js";
import { applyFrameTransform, applyFrameVector } from "../../coords/frame.js";
import { frameLocalPoint, frameLocalVector, worldPoint, worldVector } from "../../coords/points.js";
import type { FrameLocalPoint, WorldPoint, WorldVector } from "../../coords/points.js";
import { frameTransform } from "../../coords/transforms.js";
import type { FrameTransform, WorldTransform } from "../../coords/transforms.js";
import { applyMatrix, applyMatrixToVector, inverseMatrix } from "../transform.js";
import { parseLength, parseQuantityExpression } from "./parse-length.js";
import { intersectRayWithPolygon } from "../nodes/shape-geometry.js";

export type EvaluatedCoordinate = {
  kind: "transformed" | "world-only" | "invalid";
  world: WorldPoint | null;
  local?: FrameLocalPoint;
  frame?: FrameTransform;
  origin?: "named" | "calc" | "perpendicular" | "intersection" | "numeric-anchor" | "addon-coordinate-system";
  coordinateForm: CoordinateForm;
  relativePrefix?: "+" | "++";
  diagnostics: string[];
  advancesCurrentPoint: boolean;
};

function asFrameTransform(transform: { a: number; b: number; c: number; d: number; e: number; f: number }): FrameTransform {
  return frameTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
}

type ParsedExplicitCoordinate =
  | { kind: "canvas"; x: string; y: string }
  | { kind: "perpendicular"; horizontalLineThrough: string; verticalLineThrough: string }
  | { kind: "intersection"; firstLine: ParsedLineSpec; secondLine: ParsedLineSpec; solution: number };

type ParsedLineSpec = {
  startRaw: string;
  endRaw: string;
};

export function evaluateCoordinate(item: CoordinateItem, context: SemanticContext): EvaluatedCoordinate {
  const diagnostics: string[] = [];
  const frame = context.stack[context.stack.length - 1];
  const traceCollector = context.macroTraceCollector ?? undefined;

  if (item.form === "named") {
    const rawName = expandCoordinateComponent(item.x.trim(), frame.macroBindings, traceCollector).trim();
    const perpendicular = tryEvaluatePerpendicularCoordinate(rawName, context);
    if (perpendicular?.point) {
      diagnostics.push(...perpendicular.diagnostics);
      return worldOnlyCoordinate("named", perpendicular.point, diagnostics, item.relativePrefix === "++", "perpendicular");
    }

    const intersection = tryEvaluateIntersectionCoordinate(rawName, context);
    if (intersection?.point) {
      diagnostics.push(...intersection.diagnostics);
      return worldOnlyCoordinate("named", intersection.point, diagnostics, item.relativePrefix === "++", "intersection");
    }

    const candidates = scopedNameCandidates(rawName, frame.namePrefix, frame.nameSuffix);
    const named = candidates.map((candidate) => readNamedCoordinate(context, candidate)).find((candidate) => candidate != null) ?? null;
    if (named) {
      return worldOnlyCoordinate("named", named, diagnostics, item.relativePrefix === "++", "named");
    }

    const numericNodeAnchor = tryResolveNumericNodeAnchor(rawName, context, frame.namePrefix, frame.nameSuffix);
    if (numericNodeAnchor) {
      return worldOnlyCoordinate("named", numericNodeAnchor, diagnostics, item.relativePrefix === "++", "numeric-anchor");
    }

    diagnostics.push(`unknown-named-coordinate:${rawName}`);
    return invalidCoordinate("named", diagnostics, item.relativePrefix === "++");
  }

  if (item.form === "calc") {
    const evaluatedCalc = evaluateCalcCoordinate(
      expandCoordinateComponent(item.x, frame.macroBindings, traceCollector),
      context,
      frame.transform
    );
    return evaluatedCalc.point
      ? worldOnlyCoordinate("calc", evaluatedCalc.point, evaluatedCalc.diagnostics, item.relativePrefix === "++", "calc")
      : invalidCoordinate("calc", evaluatedCalc.diagnostics, item.relativePrefix === "++");
  }

  if (item.form === "explicit") {
    const expandedExplicit = expandCoordinateComponent(item.x, frame.macroBindings, traceCollector);
    const addonResolved = tryResolveAddonCoordinateSystemCoordinate(expandedExplicit, context, diagnostics, item.raw);
    if (addonResolved) {
      return addonResolved.point
        ? worldOnlyCoordinate(
            "explicit",
            addonResolved.point,
            diagnostics,
            item.relativePrefix === "++",
            "addon-coordinate-system"
          )
        : invalidCoordinate("explicit", diagnostics, item.relativePrefix === "++");
    }
    const parsed = parseExplicitCoordinate(expandedExplicit);
    if (!parsed) {
      diagnostics.push(`unsupported-coordinate-form:${item.form}`);
      return invalidCoordinate("explicit", diagnostics, item.relativePrefix === "++");
    }
    if (parsed.kind === "canvas") {
      const x = parseLength(parsed.x, "cm");
      const y = parseLength(parsed.y, "cm");
      if (x == null || y == null) {
        diagnostics.push(`invalid-explicit-coordinate:${item.raw}`);
        return invalidCoordinate("explicit", diagnostics, item.relativePrefix === "++");
      }

      const localPt = frameLocalPoint(pt(x), pt(y));
      const frameMatrix = asFrameTransform(frame.transform);
      return transformedCoordinate(
        "explicit",
        localPt,
        applyFrameTransform(frameMatrix, localPt),
        frameMatrix,
        diagnostics,
        item.relativePrefix === "++"
      );
    }

    if (parsed.kind === "perpendicular") {
      const horizontal = evaluateRawCoordinate(parsed.horizontalLineThrough, context);
      const vertical = evaluateRawCoordinate(parsed.verticalLineThrough, context);
      diagnostics.push(...horizontal.diagnostics, ...vertical.diagnostics);
      if (!horizontal.world || !vertical.world) {
        diagnostics.push(`invalid-explicit-coordinate:${item.raw}`);
        return invalidCoordinate("explicit", diagnostics, item.relativePrefix === "++");
      }
      return worldOnlyCoordinate(
        "explicit",
        worldPoint(pt(vertical.world.x), pt(horizontal.world.y)),
        diagnostics,
        item.relativePrefix === "++",
        "perpendicular"
      );
    }

    const firstStart = evaluateRawCoordinate(parsed.firstLine.startRaw, context);
    const firstEnd = evaluateRawCoordinate(parsed.firstLine.endRaw, context);
    const secondStart = evaluateRawCoordinate(parsed.secondLine.startRaw, context);
    const secondEnd = evaluateRawCoordinate(parsed.secondLine.endRaw, context);
    diagnostics.push(...firstStart.diagnostics, ...firstEnd.diagnostics, ...secondStart.diagnostics, ...secondEnd.diagnostics);
    if (!firstStart.world || !firstEnd.world || !secondStart.world || !secondEnd.world) {
      diagnostics.push(`invalid-explicit-coordinate:${item.raw}`);
      return invalidCoordinate("explicit", diagnostics, item.relativePrefix === "++");
    }

    const intersection = intersectInfiniteLines(
      { start: firstStart.world, end: firstEnd.world },
      { start: secondStart.world, end: secondEnd.world }
    );
    if (!intersection) {
      diagnostics.push(`invalid-explicit-coordinate:${item.raw}`);
      return invalidCoordinate("explicit", diagnostics, item.relativePrefix === "++");
    }

    if (parsed.solution !== 1) {
      diagnostics.push(`invalid-intersection-solution:${parsed.solution}`);
      return invalidCoordinate("explicit", diagnostics, item.relativePrefix === "++");
    }

    return worldOnlyCoordinate("explicit", intersection, diagnostics, item.relativePrefix === "++", "intersection");
  }

  if (item.form === "xyz") {
    const x = parseLength(expandCoordinateComponent(item.x, frame.macroBindings, traceCollector), "cm");
    const y = parseLength(expandCoordinateComponent(item.y, frame.macroBindings, traceCollector), "cm");
    const z = item.z ? parseLength(expandCoordinateComponent(item.z, frame.macroBindings, traceCollector), "cm") : 0;
    if (x == null || y == null || z == null) {
      diagnostics.push(`invalid-xyz-coordinate:${item.raw}`);
      return invalidCoordinate("xyz", diagnostics, item.relativePrefix === "++");
    }

    if (Math.abs(z) > 1e-9) {
      diagnostics.push("unsupported-coordinate-z-component");
    }

    const localPt = frameLocalPoint(pt(x), pt(y));
    const frameMatrix = asFrameTransform(frame.transform);
    return transformedCoordinate(
      "xyz",
      localPt,
      applyFrameTransform(frameMatrix, localPt),
      frameMatrix,
      diagnostics,
      item.relativePrefix === "++"
    );
  }

  if (item.form === "unknown") {
    diagnostics.push(`unsupported-coordinate-form:${item.form}`);
    return invalidCoordinate("unknown", diagnostics, item.relativePrefix === "++");
  }

  let localPoint: FrameLocalPoint;

  if (item.form === "polar") {
    const angleQuantity = parseQuantityExpression(expandCoordinateComponent(item.x.trim(), frame.macroBindings, traceCollector));
    const radius = parseLength(expandCoordinateComponent(item.y, frame.macroBindings, traceCollector), "cm");
    if (!angleQuantity || radius == null) {
      diagnostics.push(`invalid-polar-coordinate:${item.raw}`);
      return invalidCoordinate("polar", diagnostics, item.relativePrefix === "++");
    }

    // PGF/TikZ accepts both dimensionless angles and dimension-valued angles here.
    // `\pgfmathparse{#1}` normalizes the angle expression numerically before trig.
    const angle = angleQuantity.value;
    const radians = (angle * Math.PI) / 180;
    localPoint = frameLocalPoint(pt(radius * Math.cos(radians)), pt(radius * Math.sin(radians)));
  } else {
    const x = parseLength(expandCoordinateComponent(item.x, frame.macroBindings, traceCollector), "cm");
    const y = parseLength(expandCoordinateComponent(item.y, frame.macroBindings, traceCollector), "cm");
    if (x == null || y == null) {
      diagnostics.push(`invalid-cartesian-coordinate:${item.raw}`);
      return invalidCoordinate("cartesian", diagnostics, item.relativePrefix === "++");
    }

    localPoint = frameLocalPoint(pt(x), pt(y));
  }

  if (item.relativePrefix) {
    const current = context.currentPoint;
    if (!current) {
      diagnostics.push("relative-coordinate-without-current-point");
      const form: CoordinateForm = item.form === "polar" ? "polar" : "cartesian";
      return invalidCoordinate(form, diagnostics, item.relativePrefix === "++", item.relativePrefix);
    }
    const frameMatrix = asFrameTransform(frame.transform);
    const delta = applyFrameVector(frameMatrix, frameLocalVector(pt(localPoint.x), pt(localPoint.y)));
    const form: CoordinateForm = item.form === "polar" ? "polar" : "cartesian";
    return transformedCoordinate(
      form,
      localPoint,
      worldPoint(pt(current.x + delta.x), pt(current.y + delta.y)),
      frameMatrix,
      diagnostics,
      item.relativePrefix === "++",
      item.relativePrefix
    );
  }

  const coordinateForm: CoordinateForm = item.form === "polar" ? "polar" : "cartesian";
  const frameMatrix = asFrameTransform(frame.transform);
  return transformedCoordinate(
    coordinateForm,
    localPoint,
    applyFrameTransform(frameMatrix, localPoint),
    frameMatrix,
    diagnostics,
    true
  );
}

function transformedCoordinate(
  coordinateForm: CoordinateForm,
  local: FrameLocalPoint,
  world: WorldPoint,
  frame: FrameTransform,
  diagnostics: string[],
  advancesCurrentPoint: boolean,
  relativePrefix?: "+" | "++"
): EvaluatedCoordinate {
  return {
    kind: "transformed",
    coordinateForm,
    local,
    world,
    frame,
    diagnostics,
    advancesCurrentPoint,
    relativePrefix
  };
}

function worldOnlyCoordinate(
  coordinateForm: CoordinateForm,
  world: WorldPoint,
  diagnostics: string[],
  advancesCurrentPoint: boolean,
  origin: NonNullable<EvaluatedCoordinate["origin"]>,
  relativePrefix?: "+" | "++"
): EvaluatedCoordinate {
  return {
    kind: "world-only",
    coordinateForm,
    world,
    origin,
    diagnostics,
    advancesCurrentPoint,
    relativePrefix
  };
}

function invalidCoordinate(
  coordinateForm: CoordinateForm,
  diagnostics: string[],
  advancesCurrentPoint: boolean,
  relativePrefix?: "+" | "++"
): EvaluatedCoordinate {
  return {
    kind: "invalid",
    coordinateForm,
    world: null,
    diagnostics,
    advancesCurrentPoint,
    relativePrefix
  };
}

function tryResolveAddonCoordinateSystemCoordinate(
  raw: string,
  context: SemanticContext,
  diagnostics: string[],
  originalRaw: string
): { point: WorldPoint | null } | null {
  const csMatch = raw.trim().match(/^(.+?)\s*cs\s*:\s*(.+)$/i);
  if (!csMatch) {
    return null;
  }
  const resolve = resolveAddonCoordinateSystem(context, csMatch[1]);
  if (!resolve) {
    return null;
  }
  const resolved = resolve(csMatch[2].trim());
  if (!resolved || !Number.isFinite(resolved.x) || !Number.isFinite(resolved.y)) {
    diagnostics.push(`invalid-explicit-coordinate:${originalRaw}`);
    return { point: null };
  }
  return { point: worldPoint(pt(resolved.x), pt(resolved.y)) };
}

function parseExplicitCoordinate(raw: string): ParsedExplicitCoordinate | null {
  const trimmed = raw.trim();
  const csMatch = trimmed.match(/^(.+?)\s*cs\s*:\s*(.+)$/i);
  if (!csMatch) {
    return null;
  }

  const system = csMatch[1].trim().toLowerCase();
  const kvValues = parseTopLevelKvPairs(csMatch[2]);
  if (system === "perpendicular") {
    const horizontalLineThrough = kvValues.get("horizontal line through");
    const verticalLineThrough = kvValues.get("vertical line through");
    if (!horizontalLineThrough || !verticalLineThrough) {
      return null;
    }
    const horizontalRaw = normalizeInlineCoordinateRaw(horizontalLineThrough);
    const verticalRaw = normalizeInlineCoordinateRaw(verticalLineThrough);
    if (!horizontalRaw || !verticalRaw) {
      return null;
    }
    return {
      kind: "perpendicular",
      horizontalLineThrough: horizontalRaw,
      verticalLineThrough: verticalRaw
    };
  }

  if (system === "intersection") {
    const firstLineRaw = kvValues.get("first line");
    const secondLineRaw = kvValues.get("second line");
    if (!firstLineRaw || !secondLineRaw) {
      return null;
    }

    const firstLine = parseLineSpec(firstLineRaw);
    const secondLine = parseLineSpec(secondLineRaw);
    if (!firstLine || !secondLine) {
      return null;
    }

    const solutionRaw = kvValues.get("solution");
    const solution = solutionRaw ? Number(unwrapOuterBraces(solutionRaw)) : 1;
    return {
      kind: "intersection",
      firstLine,
      secondLine,
      solution: Number.isFinite(solution) ? Math.max(1, Math.floor(solution)) : 1
    };
  }

  const x = kvValues.get("x");
  const y = kvValues.get("y");
  if (!x || !y) {
    return null;
  }
  return {
    kind: "canvas",
    x,
    y
  };
}

function tryResolveNumericNodeAnchor(
  rawName: string,
  context: SemanticContext,
  prefix: string,
  suffix: string
): WorldPoint | null {
  const parsed = parseNumericNodeAnchor(rawName);
  if (!parsed) {
    return null;
  }

  const geometry =
    scopedNameCandidates(parsed.baseName, prefix, suffix)
      .map((candidate) => readNamedNodeGeometry(context, candidate))
      .find((candidate): candidate is NamedNodeGeometry => candidate != null) ?? null;
  if (!geometry) {
    return null;
  }

  return resolveNumericAnchorPoint(geometry, parsed.degrees);
}

function parseNumericNodeAnchor(rawName: string): { baseName: string; degrees: number } | null {
  const trimmed = rawName.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0 || dot >= trimmed.length - 1) {
    return null;
  }

  const baseName = trimmed.slice(0, dot).trim();
  const anchorRaw = trimmed.slice(dot + 1).trim();
  if (baseName.length === 0 || anchorRaw.length === 0) {
    return null;
  }

  const degrees = Number(anchorRaw);
  if (!Number.isFinite(degrees)) {
    return null;
  }

  return {
    baseName,
    degrees: normalizeDegrees(degrees)
  };
}

function normalizeDegrees(value: number): number {
  let normalized = value % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized;
}

function resolveNumericAnchorPoint(geometry: NamedNodeGeometry, degrees: number): WorldPoint | null {
  const radians = (degrees * Math.PI) / 180;
  const direction = worldVector(pt(Math.cos(radians)), pt(Math.sin(radians)));
  return intersectNamedGeometryBorder(geometry, direction);
}

function intersectNamedGeometryBorder(geometry: NamedNodeGeometry, direction: WorldVector): WorldPoint | null {
  const dx = direction.x;
  const dy = direction.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len <= 1e-9) {
    return geometry.center;
  }

  if (geometry.shape === "coordinate") {
    return geometry.center;
  }

  const transform = geometry.anchorTransform;
  let mappingTransform = transform;
  const localDirection = (() => {
    if (!transform) {
      return direction;
    }
    const inverse = inverseMatrix(transform);
    if (!inverse) {
      mappingTransform = undefined;
      return direction;
    }
    return applyMatrixToVector(inverse, direction);
  })();
  const localDx = localDirection.x;
  const localDy = localDirection.y;
  const localLen = Math.hypot(localDx, localDy);
  if (!Number.isFinite(localLen) || localLen <= 1e-9) {
    return geometry.center;
  }
  const fromLocal = (point: WorldVector): WorldPoint => {
    if (!mappingTransform) {
      return worldPoint(pt(geometry.center.x + point.x), pt(geometry.center.y + point.y));
    }
    const mapped = applyMatrixToVector(mappingTransform, point);
    return worldPoint(pt(geometry.center.x + mapped.x), pt(geometry.center.y + mapped.y));
  };

  if (geometry.shape === "circle") {
    const radius = geometry.anchorRadius;
    if (!Number.isFinite(radius) || radius <= 1e-9) {
      return geometry.center;
    }
    return fromLocal(worldVector(pt((localDx / localLen) * radius), pt((localDy / localLen) * radius)));
  }

  if (geometry.shape === "rectangle") {
    const hw = geometry.anchorHalfWidth;
    const hh = geometry.anchorHalfHeight;
    if (!Number.isFinite(hw) || !Number.isFinite(hh) || hw <= 1e-9 || hh <= 1e-9) {
      return geometry.center;
    }
    const scale = 1 / Math.max(Math.abs(localDx) / hw, Math.abs(localDy) / hh);
    return fromLocal(worldVector(pt(localDx * scale), pt(localDy * scale)));
  }

  if (geometry.shape === "ellipse") {
    const rx = geometry.anchorHalfWidth;
    const ry = geometry.anchorHalfHeight;
    if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx <= 1e-9 || ry <= 1e-9) {
      return geometry.center;
    }
    const scale = 1 / Math.sqrt((localDx * localDx) / (rx * rx) + (localDy * localDy) / (ry * ry));
    if (!Number.isFinite(scale)) {
      return geometry.center;
    }
    return fromLocal(worldVector(pt(localDx * scale), pt(localDy * scale)));
  }

  if (geometry.anchorPolygon && geometry.anchorPolygon.length >= 3) {
    const border = intersectRayWithPolygon(worldPoint(pt(0), pt(0)), direction, geometry.anchorPolygon);
    if (border) {
      return worldPoint(pt(geometry.center.x + border.x), pt(geometry.center.y + border.y));
    }
  }

  return geometry.center;
}

function evaluateCalcCoordinate(
  calcRaw: string,
  context: SemanticContext,
  frame: WorldTransform
): { point: WorldPoint | null; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const trimmed = calcRaw.trim();
  if (!trimmed.startsWith("$") || !trimmed.endsWith("$")) {
    return { point: null, diagnostics: ["invalid-calc-coordinate"] };
  }

  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) {
    return { point: null, diagnostics: ["invalid-calc-coordinate"] };
  }

  const terms = tokenizeCalcTerms(inner);
  if (terms.length === 0) {
    return { point: null, diagnostics: ["invalid-calc-coordinate"] };
  }

  const origin = applyMatrix(frame, worldPoint(pt(0), pt(0)));
  let acc = origin;
  let evaluatedAny = false;

  for (const term of terms) {
    const termResult = evaluateCalcTerm(term.term, context);
    diagnostics.push(...termResult.diagnostics);
    if (!termResult.point) {
      return { point: null, diagnostics };
    }

    const vector = worldVector(
      pt(termResult.point.x - origin.x),
      pt(termResult.point.y - origin.y)
    );
    acc =
      term.op === "-"
        ? worldPoint(pt(acc.x - vector.x), pt(acc.y - vector.y))
        : worldPoint(pt(acc.x + vector.x), pt(acc.y + vector.y));
    evaluatedAny = true;
  }

  return { point: evaluatedAny ? acc : null, diagnostics };
}

function tokenizeCalcTerms(input: string): Array<{ op: "+" | "-"; term: string }> {
  const terms: Array<{ op: "+" | "-"; term: string }> = [];
  let op: "+" | "-" = "+";
  let cursor = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (char === "\\") {
      index += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if ((char === "+" || char === "-") && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      const token = input.slice(cursor, index).trim();
      if (token.length > 0) {
        terms.push({ op, term: token });
      }
      op = char;
      cursor = index + 1;
    }
  }

  const trailing = input.slice(cursor).trim();
  if (trailing.length > 0) {
    terms.push({ op, term: trailing });
  }

  return terms;
}

function evaluateCalcTerm(term: string, context: SemanticContext): { point: WorldPoint | null; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const interpolation = tryParseCalcInterpolation(term);
  if (interpolation) {
    const left = evaluateRawCoordinate(interpolation.left, context);
    const right = evaluateRawCoordinate(interpolation.right, context);
    diagnostics.push(...left.diagnostics, ...right.diagnostics);
    if (!left.world || !right.world) {
      return { point: null, diagnostics };
    }
    return {
      point: worldPoint(
        pt(left.world.x + interpolation.factor * (right.world.x - left.world.x)),
        pt(left.world.y + interpolation.factor * (right.world.y - left.world.y))
      ),
      diagnostics
    };
  }

  const evaluated = evaluateRawCoordinate(term, context);
  diagnostics.push(...evaluated.diagnostics);
  return { point: evaluated.world, diagnostics };
}

function tryParseCalcInterpolation(term: string): { left: string; right: string; factor: number } | null {
  const parts = splitAllAtTopLevel(term, "!").map((part) => part.trim());
  if (parts.length !== 3) {
    return null;
  }

  const [left, factorRaw, right] = parts;
  if (!left.startsWith("(") || !left.endsWith(")") || !right.startsWith("(") || !right.endsWith(")")) {
    return null;
  }

  const factor = Number(factorRaw);
  if (!Number.isFinite(factor)) {
    return null;
  }

  return { left, right, factor };
}

function tryEvaluatePerpendicularCoordinate(
  raw: string,
  context: SemanticContext
): { point: WorldPoint | null; diagnostics: string[] } | null {
  const parsed = parsePerpendicularCoordinate(raw);
  if (!parsed) {
    return null;
  }

  const left = evaluateRawCoordinate(parsed.leftRaw, context);
  const right = evaluateRawCoordinate(parsed.rightRaw, context);
  const diagnostics = [...left.diagnostics, ...right.diagnostics];
  if (!left.world || !right.world) {
    diagnostics.push("invalid-perpendicular-coordinate");
    return { point: null, diagnostics };
  }

  if (parsed.operator === "|-") {
    return {
      point: worldPoint(pt(left.world.x), pt(right.world.y)),
      diagnostics
    };
  }

  return {
    point: worldPoint(pt(right.world.x), pt(left.world.y)),
    diagnostics
  };
}

function parsePerpendicularCoordinate(raw: string): { operator: "|-" | "-|"; leftRaw: string; rightRaw: string } | null {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const unwrapped = unwrapOuterBraces(trimmed);
  if (unwrapped !== trimmed) {
    candidates.push(unwrapped);
  }

  for (const candidate of candidates) {
    const split = splitAtTopLevelOperator(candidate, ["|-", "-|"]);
    if (!split) {
      continue;
    }

    const leftRaw = normalizeInlineCoordinateRaw(split.left);
    const rightRaw = normalizeInlineCoordinateRaw(split.right);
    if (!leftRaw || !rightRaw) {
      continue;
    }

    return {
      operator: split.operator as "|-" | "-|",
      leftRaw,
      rightRaw
    };
  }

  return null;
}

function tryEvaluateIntersectionCoordinate(
  raw: string,
  context: SemanticContext
): { point: WorldPoint | null; diagnostics: string[] } | null {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const unwrapped = unwrapOuterBraces(trimmed);
  if (unwrapped !== trimmed) {
    candidates.push(unwrapped);
  }

  let prefixMatch: RegExpMatchArray | null = null;
  for (const candidate of candidates) {
    prefixMatch = candidate.match(/^intersection(?:\s+(\d+))?\s+of\s+(.+)$/i);
    if (prefixMatch) {
      break;
    }
  }
  if (!prefixMatch) {
    return null;
  }

  const diagnostics: string[] = [];
  const solution = prefixMatch[1] ? Number(prefixMatch[1]) : 1;
  const objectPair = splitAtTopLevelKeyword(prefixMatch[2], "and");
  if (!objectPair) {
    return { point: null, diagnostics: ["invalid-intersection-coordinate"] };
  }

  const firstLine = parseLineSpec(objectPair.left);
  const secondLine = parseLineSpec(objectPair.right);
  if (!firstLine || !secondLine) {
    return { point: null, diagnostics: ["invalid-intersection-coordinate"] };
  }

  const firstStart = evaluateRawCoordinate(firstLine.startRaw, context);
  const firstEnd = evaluateRawCoordinate(firstLine.endRaw, context);
  const secondStart = evaluateRawCoordinate(secondLine.startRaw, context);
  const secondEnd = evaluateRawCoordinate(secondLine.endRaw, context);
  diagnostics.push(...firstStart.diagnostics, ...firstEnd.diagnostics, ...secondStart.diagnostics, ...secondEnd.diagnostics);

  if (!firstStart.world || !firstEnd.world || !secondStart.world || !secondEnd.world) {
    diagnostics.push("invalid-intersection-coordinate");
    return { point: null, diagnostics };
  }

  if (!Number.isFinite(solution) || solution !== 1) {
    diagnostics.push(`invalid-intersection-solution:${prefixMatch[1] ?? String(solution)}`);
    return { point: null, diagnostics };
  }

  const point = intersectInfiniteLines(
    { start: firstStart.world, end: firstEnd.world },
    { start: secondStart.world, end: secondEnd.world }
  );
  if (!point) {
    diagnostics.push("invalid-intersection-coordinate");
    return { point: null, diagnostics };
  }

  return { point, diagnostics };
}

function parseLineSpec(raw: string): ParsedLineSpec | null {
  const normalized = unwrapOuterBraces(raw.trim());
  const split = splitAtTopLevelOperator(normalized, ["--"]);
  if (!split) {
    return null;
  }

  const startRaw = normalizeInlineCoordinateRaw(split.left);
  const endRaw = normalizeInlineCoordinateRaw(split.right);
  if (!startRaw || !endRaw) {
    return null;
  }

  return { startRaw, endRaw };
}

function normalizeInlineCoordinateRaw(raw: string): string | null {
  let normalized = raw.trim();
  while (normalized.startsWith("{") && normalized.endsWith("}") && normalized.length >= 2) {
    normalized = normalized.slice(1, -1).trim();
  }
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.startsWith("(") && normalized.endsWith(")")) {
    return normalized;
  }
  return `(${normalized})`;
}

function parseTopLevelKvPairs(raw: string): Map<string, string> {
  const pairs = new Map<string, string>();
  const entries = splitAllAtTopLevel(raw, ",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  for (const entry of entries) {
    const separator = findTopLevelEquals(entry);
    if (separator === -1) {
      continue;
    }
    const key = entry.slice(0, separator).trim().toLowerCase();
    const value = entry.slice(separator + 1).trim();
    if (key.length > 0) {
      pairs.set(key, value);
    }
  }
  return pairs;
}

function findTopLevelEquals(input: string): number {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === "\\") {
      i += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === "=" && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      return i;
    }
  }

  return -1;
}

function splitAtTopLevelOperator(
  input: string,
  operators: string[]
): { left: string; right: string; operator: string } | null {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === "\\") {
      i += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (parenDepth !== 0 || braceDepth !== 0 || bracketDepth !== 0) {
      continue;
    }

    for (const operator of operators) {
      if (input.startsWith(operator, i)) {
        return {
          left: input.slice(0, i).trim(),
          right: input.slice(i + operator.length).trim(),
          operator
        };
      }
    }
  }

  return null;
}

function splitAtTopLevelKeyword(input: string, keyword: string): { left: string; right: string } | null {
  const needle = ` ${keyword} `;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i <= input.length - needle.length; i += 1) {
    const char = input[i];
    if (char === "\\") {
      i += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      const candidate = input.slice(i, i + needle.length).toLowerCase();
      if (candidate === needle) {
        return {
          left: input.slice(0, i).trim(),
          right: input.slice(i + needle.length).trim()
        };
      }
    }
  }

  return null;
}

function unwrapOuterBraces(raw: string): string {
  let normalized = raw.trim();
  while (normalized.startsWith("{") && normalized.endsWith("}") && normalized.length >= 2) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

function intersectInfiniteLines(
  first: { start: WorldPoint; end: WorldPoint },
  second: { start: WorldPoint; end: WorldPoint }
): WorldPoint | null {
  const firstDirection = worldVector(pt(first.end.x - first.start.x), pt(first.end.y - first.start.y));
  const secondDirection = worldVector(pt(second.end.x - second.start.x), pt(second.end.y - second.start.y));
  const denominator = cross(firstDirection, secondDirection);
  if (Math.abs(denominator) <= 1e-9) {
    return null;
  }

  const delta = worldVector(pt(second.start.x - first.start.x), pt(second.start.y - first.start.y));
  const t = cross(delta, secondDirection) / denominator;
  return worldPoint(
    pt(first.start.x + t * firstDirection.x),
    pt(first.start.y + t * firstDirection.y)
  );
}

function cross(left: Pick<WorldPoint | WorldVector, "x" | "y">, right: Pick<WorldPoint | WorldVector, "x" | "y">): number {
  return left.x * right.y - left.y * right.x;
}

function scopedNameCandidates(name: string, prefix: string, suffix: string): string[] {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return [trimmed];
  }

  const scoped = applyNameScope(trimmed, prefix, suffix);
  return scoped === trimmed ? [trimmed] : [scoped, trimmed];
}

function applyNameScope(name: string, prefix: string, suffix: string): string {
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

export function evaluateRawCoordinate(
  raw: string,
  context: SemanticContext,
  relativePrefix?: CoordinateItem["relativePrefix"]
): EvaluatedCoordinate {
  const parsed = parseCoordinate(raw);
  const pseudo: CoordinateItem = {
    kind: "Coordinate",
    id: "raw-coordinate",
    span: { from: 0, to: raw.length },
    relativePrefix,
    x: parsed.x,
    y: parsed.y,
    z: parsed.z,
    raw,
    form: parsed.form,
    optionsSpan: parsed.optionsSpan
      ? {
          from: parsed.optionsSpan.from,
          to: parsed.optionsSpan.to
        }
      : undefined,
    options: undefined
  };
  return evaluateCoordinate(pseudo, context);
}

function expandCoordinateComponent(
  raw: string,
  bindings: ReadonlyMap<string, MacroBinding>,
  trace: SemanticContext["macroTraceCollector"] | undefined
): string {
  return expandMacroBindings(raw, bindings, {
    maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
    trace: trace ?? undefined
  });
}
