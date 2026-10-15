import { requireArrayValue } from "../../utils/collections.js";
import type { WorldTransform } from "../../coords/transforms.js";
import { pt } from "../../coords/scalars.js";
import { worldPoint as makeWorldPoint, type WorldPoint } from "../../coords/points.js";
import type { ScenePathCommand } from "../types.js";
import { applyMatrix, inverseMatrix } from "../transform.js";
import type { PlacementSegment } from "./types.js";
import { isWrappedBySingleBracePair, toRadians } from "./shared.js";

const EPSILON = 1e-9;
const MAX_ARC_SEGMENT_ANGLE = Math.PI / 2;
const SVG_COMMANDS = new Set(["M", "m", "L", "l", "H", "h", "V", "v", "C", "c", "S", "s", "Q", "q", "T", "t", "A", "a", "Z", "z"]);

function worldPoint(x: number, y: number): WorldPoint {
  return makeWorldPoint(pt(x), pt(y));
}

type SvgToken =
  | {
      kind: "command";
      value: string;
      index: number;
    }
  | {
      kind: "number";
      value: number;
      index: number;
    };

export type SvgPathParseResult = {
  commands: ScenePathCommand[];
  endPoint: WorldPoint;
  subpathStartPoint: WorldPoint | null;
  lastSegment: PlacementSegment | null;
  diagnostics: string[];
};

export function parseSvgPathOperation(args: {
  payloadRaw: string;
  transform: WorldTransform;
  startPoint: WorldPoint;
  subpathStartPoint: WorldPoint | null;
}): SvgPathParseResult {
  const payload = unwrapSvgPayload(args.payloadRaw);
  const { tokens, diagnostics } = tokenizeSvgPathData(payload);

  const worldToLocal = makeWorldToLocal(args.transform, diagnostics);
  const localToWorld = (point: WorldPoint): WorldPoint => applyMatrix(args.transform, point);

  const commands: ScenePathCommand[] = [];
  let lastSegment: PlacementSegment | null = null;
  let currentLocal = worldToLocal(args.startPoint);
  let subpathStartLocal = worldToLocal(args.subpathStartPoint ?? args.startPoint);
  let lastCubicControlLocal: WorldPoint | null = null;
  let lastQuadraticControlLocal: WorldPoint | null = null;
  let activeCommand: string | null = null;
  let cursor = 0;

  const emitMove = (targetLocal: WorldPoint): void => {
    commands.push({ kind: "M", to: localToWorld(targetLocal) });
    currentLocal = targetLocal;
    subpathStartLocal = targetLocal;
    lastCubicControlLocal = null;
    lastQuadraticControlLocal = null;
    lastSegment = null;
  };

  const emitLine = (targetLocal: WorldPoint): void => {
    const fromLocal = currentLocal;
    const fromWorld = localToWorld(fromLocal);
    const toWorldPoint = localToWorld(targetLocal);
    commands.push({ kind: "L", to: toWorldPoint });
    if (!pointsClose(fromWorld, toWorldPoint)) {
      lastSegment = {
        kind: "line",
        from: fromWorld,
        to: toWorldPoint
      };
    }
    currentLocal = targetLocal;
    lastCubicControlLocal = null;
    lastQuadraticControlLocal = null;
  };

  const emitCubic = (c1Local: WorldPoint, c2Local: WorldPoint, targetLocal: WorldPoint): void => {
    const fromLocal = currentLocal;
    const fromWorld = localToWorld(fromLocal);
    const c1World = localToWorld(c1Local);
    const c2World = localToWorld(c2Local);
    const toWorldPoint = localToWorld(targetLocal);
    commands.push({ kind: "C", c1: c1World, c2: c2World, to: toWorldPoint });
    if (!pointsClose(fromWorld, toWorldPoint)) {
      lastSegment = {
        kind: "cubic",
        from: fromWorld,
        c1: c1World,
        c2: c2World,
        to: toWorldPoint
      };
    }
    currentLocal = targetLocal;
  };

  while (cursor < tokens.length) {
    const token = requireArrayValue(tokens, cursor);
    if (token.kind === "command") {
      activeCommand = token.value;
      cursor += 1;
    } else if (activeCommand == null) {
      diagnostics.push(`Expected an SVG command before numeric data near position ${token.index + 1}.`);
      cursor = skipNumberSequence(tokens, cursor);
      continue;
    }


    const lower = activeCommand.toLowerCase();
    const relative = activeCommand === lower;

    if (lower === "z") {
      {
        const fromWorld = localToWorld(currentLocal);
        const toWorldPoint = localToWorld(subpathStartLocal);
        commands.push({ kind: "Z" });
        if (!pointsClose(fromWorld, toWorldPoint)) {
          lastSegment = {
            kind: "line",
            from: fromWorld,
            to: toWorldPoint
          };
        }
        currentLocal = subpathStartLocal;
      }
      lastCubicControlLocal = null;
      lastQuadraticControlLocal = null;
      continue;
    }

    if (lower === "m") {
      if (!hasNumberGroup(tokens, cursor, 2)) {
        diagnostics.push(`SVG command '${activeCommand}' requires at least one coordinate pair.`);
        cursor = skipNumberSequence(tokens, cursor);
        continue;
      }

      const moveTarget = readPointPair(tokens, cursor, currentLocal, relative);
      cursor += 2;
      emitMove(moveTarget);

      while (hasNumberGroup(tokens, cursor, 2)) {
        const lineTarget = readPointPair(tokens, cursor, currentLocal, relative);
        cursor += 2;
        emitLine(lineTarget);
      }
      continue;
    }

    if (lower === "l") {
      let consumed = false;
      while (hasNumberGroup(tokens, cursor, 2)) {
        const target = readPointPair(tokens, cursor, currentLocal, relative);
        cursor += 2;
        emitLine(target);
        consumed = true;
      }
      if (!consumed) {
        diagnostics.push(`SVG command '${activeCommand}' requires coordinate pairs.`);
        cursor = skipNumberSequence(tokens, cursor);
      }
      continue;
    }

    if (lower === "h") {
      let consumed = false;
      while (hasNumberGroup(tokens, cursor, 1)) {
        const rawX = getNumber(tokens[cursor]);
        const target: WorldPoint = relative
          ? worldPoint(currentLocal.x + rawX, currentLocal.y)
          : worldPoint(rawX, currentLocal.y);
        cursor += 1;
        emitLine(target);
        consumed = true;
      }
      if (!consumed) {
        diagnostics.push(`SVG command '${activeCommand}' requires x values.`);
        cursor = skipNumberSequence(tokens, cursor);
      }
      continue;
    }

    if (lower === "v") {
      let consumed = false;
      while (hasNumberGroup(tokens, cursor, 1)) {
        const rawY = getNumber(tokens[cursor]);
        const target: WorldPoint = relative
          ? worldPoint(currentLocal.x, currentLocal.y + rawY)
          : worldPoint(currentLocal.x, rawY);
        cursor += 1;
        emitLine(target);
        consumed = true;
      }
      if (!consumed) {
        diagnostics.push(`SVG command '${activeCommand}' requires y values.`);
        cursor = skipNumberSequence(tokens, cursor);
      }
      continue;
    }

    if (lower === "c") {
      let consumed = false;
      while (hasNumberGroup(tokens, cursor, 6)) {
        const c1 = readPointPair(tokens, cursor, currentLocal, relative);
        const c2 = readPointPair(tokens, cursor + 2, currentLocal, relative);
        const target = readPointPair(tokens, cursor + 4, currentLocal, relative);
        cursor += 6;
        emitCubic(c1, c2, target);
        lastCubicControlLocal = c2;
        lastQuadraticControlLocal = null;
        consumed = true;
      }
      if (!consumed) {
        diagnostics.push(`SVG command '${activeCommand}' requires groups of 6 numbers.`);
        cursor = skipNumberSequence(tokens, cursor);
      }
      continue;
    }

    if (lower === "s") {
      let consumed = false;
      while (hasNumberGroup(tokens, cursor, 4)) {
        const reflected = reflectControlPoint(lastCubicControlLocal, currentLocal);
        const c2 = readPointPair(tokens, cursor, currentLocal, relative);
        const target = readPointPair(tokens, cursor + 2, currentLocal, relative);
        cursor += 4;
        emitCubic(reflected, c2, target);
        lastCubicControlLocal = c2;
        lastQuadraticControlLocal = null;
        consumed = true;
      }
      if (!consumed) {
        diagnostics.push(`SVG command '${activeCommand}' requires groups of 4 numbers.`);
        cursor = skipNumberSequence(tokens, cursor);
      }
      continue;
    }

    if (lower === "q") {
      let consumed = false;
      while (hasNumberGroup(tokens, cursor, 4)) {
        const control = readPointPair(tokens, cursor, currentLocal, relative);
        const target = readPointPair(tokens, cursor + 2, currentLocal, relative);
        cursor += 4;

        const c1 = worldPoint(
          currentLocal.x + (2 / 3) * (control.x - currentLocal.x),
          currentLocal.y + (2 / 3) * (control.y - currentLocal.y)
        );
        const c2 = worldPoint(
          target.x + (2 / 3) * (control.x - target.x),
          target.y + (2 / 3) * (control.y - target.y)
        );
        emitCubic(c1, c2, target);
        lastCubicControlLocal = null;
        lastQuadraticControlLocal = control;
        consumed = true;
      }
      if (!consumed) {
        diagnostics.push(`SVG command '${activeCommand}' requires groups of 4 numbers.`);
        cursor = skipNumberSequence(tokens, cursor);
      }
      continue;
    }

    if (lower === "t") {
      let consumed = false;
      while (hasNumberGroup(tokens, cursor, 2)) {
        const control = reflectControlPoint(lastQuadraticControlLocal, currentLocal);
        const target = readPointPair(tokens, cursor, currentLocal, relative);
        cursor += 2;

        const c1 = worldPoint(
          currentLocal.x + (2 / 3) * (control.x - currentLocal.x),
          currentLocal.y + (2 / 3) * (control.y - currentLocal.y)
        );
        const c2 = worldPoint(
          target.x + (2 / 3) * (control.x - target.x),
          target.y + (2 / 3) * (control.y - target.y)
        );
        emitCubic(c1, c2, target);
        lastCubicControlLocal = null;
        lastQuadraticControlLocal = control;
        consumed = true;
      }
      if (!consumed) {
        diagnostics.push(`SVG command '${activeCommand}' requires coordinate pairs.`);
        cursor = skipNumberSequence(tokens, cursor);
      }
      continue;
    }

    if (lower === "a") {
      let consumed = false;
      while (hasNumberGroup(tokens, cursor, 7)) {
        const rx = Math.abs(getNumber(tokens[cursor]));
        const ry = Math.abs(getNumber(tokens[cursor + 1]));
        const xAxisRotation = getNumber(tokens[cursor + 2]);
        const largeArcFlag = readArcFlag(getNumber(tokens[cursor + 3]));
        const sweepFlag = readArcFlag(getNumber(tokens[cursor + 4]));
        const target = readPointPair(tokens, cursor + 5, currentLocal, relative);
        cursor += 7;

        if (!largeArcFlag.valid) {
          diagnostics.push(`Arc flag value '${largeArcFlag.raw}' is not 0 or 1; treating nonzero as true.`);
        }
        if (!sweepFlag.valid) {
          diagnostics.push(`Arc flag value '${sweepFlag.raw}' is not 0 or 1; treating nonzero as true.`);
        }

        const cubicSegments = arcToCubicSegments({
          from: currentLocal,
          to: target,
          rx,
          ry,
          xAxisRotation,
          largeArc: largeArcFlag.value,
          // SVG arc sweep is defined in screen coordinates (y-down), while TikZ
          // operates in Cartesian coordinates (y-up), so sweep direction flips.
          sweep: !sweepFlag.value
        });

        if (cubicSegments == null) {
          emitLine(target);
        } else if (cubicSegments.length > 0) {
          for (const cubic of cubicSegments) {
            emitCubic(cubic.c1, cubic.c2, cubic.to);
          }
        } else {
          currentLocal = target;
        }

        lastCubicControlLocal = null;
        lastQuadraticControlLocal = null;
        consumed = true;
      }
      if (!consumed) {
        diagnostics.push(`SVG command '${activeCommand}' requires groups of 7 numbers.`);
        cursor = skipNumberSequence(tokens, cursor);
      }
      continue;
    }

    diagnostics.push(`Unsupported SVG command '${activeCommand}'.`);
    activeCommand = null;
  }

  const endPoint = localToWorld(currentLocal);
  return {
    commands,
    endPoint,
    subpathStartPoint: localToWorld(subpathStartLocal),
    lastSegment,
    diagnostics
  };
}

function unwrapSvgPayload(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}") && isWrappedBySingleBracePair(trimmed)) {
    return trimmed.slice(1, -1).trim();
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function tokenizeSvgPathData(input: string): { tokens: SvgToken[]; diagnostics: string[] } {
  const tokens: SvgToken[] = [];
  const diagnostics: string[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input.charAt(index);

    if (isSvgSeparator(char)) {
      index += 1;
      continue;
    }

    if (SVG_COMMANDS.has(char)) {
      tokens.push({ kind: "command", value: char, index });
      index += 1;
      continue;
    }

    const numberMatch = /^[+-]?(?:\d+\.\d*|\d+|\.\d+)(?:[eE][+-]?\d+)?/.exec(input.slice(index));
    if (numberMatch) {
      const parsed = Number(numberMatch[0]);
      if (!Number.isFinite(parsed)) {
        diagnostics.push(`Invalid numeric value '${numberMatch[0]}' near position ${index + 1}.`);
      } else {
        tokens.push({ kind: "number", value: parsed, index });
      }
      index += numberMatch[0].length;
      continue;
    }

    diagnostics.push(`Unexpected character '${char}' near position ${index + 1}.`);
    index += 1;
  }

  return { tokens, diagnostics };
}

function isSvgSeparator(char: string): boolean {
  return char === "," || /\s/.test(char);
}

function hasNumberGroup(tokens: SvgToken[], start: number, size: number): boolean {
  if (size <= 0) {
    return false;
  }
  if (start + size > tokens.length) {
    return false;
  }
  for (let index = start; index < start + size; index += 1) {
    if (tokens[index]?.kind !== "number") {
      return false;
    }
  }
  return true;
}

function readPointPair(tokens: SvgToken[], start: number, current: WorldPoint, relative: boolean): WorldPoint {
  const x = getNumber(tokens[start]);
  const y = getNumber(tokens[start + 1]);
  if (relative) {
    return worldPoint(current.x + x, current.y + y);
  }
  return worldPoint(pt(x), pt(y));
}

function getNumber(token: SvgToken | undefined): number {
  if (token?.kind !== "number") {
    return 0;
  }
  return token.value;
}

function skipNumberSequence(tokens: SvgToken[], cursor: number): number {
  let index = cursor;
  while (index < tokens.length && tokens[index]?.kind === "number") {
    index += 1;
  }
  return index;
}

function reflectControlPoint(control: WorldPoint | null, current: WorldPoint): WorldPoint {
  if (!control) {
    return current;
  }
  return worldPoint(2 * current.x - control.x, 2 * current.y - control.y);
}

function makeWorldToLocal(transform: WorldTransform, diagnostics: string[]): (point: WorldPoint) => WorldPoint {
  const inverse = inverseMatrix(transform);
  if (inverse) {
    return (point: WorldPoint): WorldPoint => applyMatrix(inverse, point);
  }

  diagnostics.push("SVG operation transform is not invertible; interpreting SVG data in world coordinates.");
  return (point: WorldPoint): WorldPoint => point;
}

function readArcFlag(raw: number): { value: boolean; valid: boolean; raw: number } {
  if (Math.abs(raw) <= EPSILON) {
    return { value: false, valid: true, raw };
  }
  if (Math.abs(raw - 1) <= EPSILON) {
    return { value: true, valid: true, raw };
  }
  return {
    value: Math.abs(raw) > EPSILON,
    valid: false,
    raw
  };
}

function arcToCubicSegments(args: {
  from: WorldPoint;
  to: WorldPoint;
  rx: number;
  ry: number;
  xAxisRotation: number;
  largeArc: boolean;
  sweep: boolean;
}): Array<{ c1: WorldPoint; c2: WorldPoint; to: WorldPoint }> | null {
  if (pointsClose(args.from, args.to)) {
    return [];
  }

  let rx = Math.abs(args.rx);
  let ry = Math.abs(args.ry);
  if (rx <= EPSILON || ry <= EPSILON) {
    return null;
  }

  const phi = toRadians(args.xAxisRotation);
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (args.from.x - args.to.x) / 2;
  const dy2 = (args.from.y - args.to.y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;

  const lambda = x1p2 / (rx * rx) + y1p2 / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const numerator = rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2;
  const denominator = rx2 * y1p2 + ry2 * x1p2;
  const sign = args.largeArc === args.sweep ? -1 : 1;
  const factor = denominator <= EPSILON ? 0 : sign * Math.sqrt(Math.max(0, numerator / denominator));

  const cxp = factor * ((rx * y1p) / ry);
  const cyp = factor * ((-ry * x1p) / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (args.from.x + args.to.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (args.from.y + args.to.y) / 2;

  const startVector = worldPoint((x1p - cxp) / rx, (y1p - cyp) / ry);
  const endVector = worldPoint((-x1p - cxp) / rx, (-y1p - cyp) / ry);

  let delta = signedAngle(startVector, endVector);
  if (!args.sweep && delta > 0) {
    delta -= 2 * Math.PI;
  } else if (args.sweep && delta < 0) {
    delta += 2 * Math.PI;
  }

  const startAngle = Math.atan2(startVector.y, startVector.x);
  const segmentCount = Math.max(1, Math.ceil(Math.abs(delta) / MAX_ARC_SEGMENT_ANGLE));
  const step = delta / segmentCount;

  const segments: Array<{ c1: WorldPoint; c2: WorldPoint; to: WorldPoint }> = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const theta1 = startAngle + step * index;
    const theta2 = theta1 + step;
    const deltaTheta = theta2 - theta1;
    const alpha = (4 / 3) * Math.tan(deltaTheta / 4);

    const p1 = worldPoint(Math.cos(theta1), Math.sin(theta1));
    const p2 = worldPoint(Math.cos(theta2), Math.sin(theta2));

    const c1Unit = worldPoint(p1.x - alpha * p1.y, p1.y + alpha * p1.x);
    const c2Unit = worldPoint(p2.x + alpha * p2.y, p2.y - alpha * p2.x);

    segments.push({
      c1: mapArcUnitPoint(cx, cy, rx, ry, cosPhi, sinPhi, c1Unit),
      c2: mapArcUnitPoint(cx, cy, rx, ry, cosPhi, sinPhi, c2Unit),
      to: mapArcUnitPoint(cx, cy, rx, ry, cosPhi, sinPhi, p2)
    });
  }

  return segments;
}

function mapArcUnitPoint(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  cosPhi: number,
  sinPhi: number,
  point: WorldPoint
): WorldPoint {
  return worldPoint(
    cx + rx * cosPhi * point.x - ry * sinPhi * point.y,
    cy + rx * sinPhi * point.x + ry * cosPhi * point.y
  );
}

function signedAngle(from: WorldPoint, to: WorldPoint): number {
  const cross = from.x * to.y - from.y * to.x;
  const dot = from.x * to.x + from.y * to.y;
  return Math.atan2(cross, dot);
}

function pointsClose(left: WorldPoint, right: WorldPoint): boolean {
  return Math.abs(left.x - right.x) <= EPSILON && Math.abs(left.y - right.y) <= EPSILON;
}
