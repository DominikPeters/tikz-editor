import { requireArrayValue } from "../../utils/collections.js";
import type { CalcCoordinateEditHandle } from "../../semantic/types.js";
import type { WorldPoint } from "../../coords/points.js";
import { worldVector } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { ptToCm } from "../../coords/source.js";
import { parseCoordinate } from "../../domains/coordinates/parse.js";
import { parseLength } from "../../semantic/coords/parse-length.js";
import { worldDeltaToLocalDelta } from "../coords.js";
import { shortestDecimal } from "../format.js";

const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const SCALAR = new RegExp(`^(\\s*)(${NUMBER})(cm|mm|pt|bp|pc|in|dd|cc|sp)?(\\s*)$`, "u");
const CARTESIAN = /^\(([^(),]+),([^(),]+)\)$/u;

/**
 * Writer-internal: a calc expression translated without flattening its
 * named references or math. The offset is read in the handle's frame; it
 * goes into the expression's last plain term, or a new `+(…)` after it.
 */
export function writeCalcCoordinate(newWorld: WorldPoint, handle: CalcCoordinateEditHandle, source: string, tolerancePt: number): string | null {
  const delta = worldDeltaToLocalDelta(worldVector(pt(newWorld.x - handle.world.x), pt(newWorld.y - handle.world.y)), handle.frame);
  if (!delta || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return null;
  const raw = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
  // Local pt per component that keeps the point within the tolerance (over √2 along each axis).
  const axisX = Math.hypot(handle.frame.a, handle.frame.b);
  const axisY = Math.hypot(handle.frame.c, handle.frame.d);
  const tolerance = { x: axisX > 0 ? tolerancePt / (Math.SQRT2 * axisX) : 0, y: axisY > 0 ? tolerancePt / (Math.SQRT2 * axisY) : 0 };
  if (Math.abs(delta.x) <= tolerance.x && Math.abs(delta.y) <= tolerance.y) return raw;
  const parsed = parseCoordinate(raw);
  if (parsed.form !== "calc") return null;
  const calcStart = raw.lastIndexOf(parsed.x);
  if (calcStart < 0) return null;
  const inner = parsed.x.slice(1, -1);
  const tail = trailingTerm(inner);
  const numeric = CARTESIAN.exec(tail.text);
  const customBasis = handle.axisBasis && (Math.abs(handle.axisBasis.x.x - 72.27 / 2.54) > 1e-9 || Math.abs(handle.axisBasis.x.y) > 1e-9 || Math.abs(handle.axisBasis.y.x) > 1e-9 || Math.abs(handle.axisBasis.y.y - 72.27 / 2.54) > 1e-9);
  let rewritten: string;
  if (customBasis) {
    const end = inner.trimEnd().length;
    rewritten = `${inner.slice(0, end)}+(${shortestDecimal(delta.x, tolerance.x)}pt,${shortestDecimal(delta.y, tolerance.y)}pt)${inner.slice(end)}`;
  } else if (numeric) {
    const x = rewriteScalar(requireArrayValue(numeric, 1), tail.sign * delta.x, tolerance.x);
    const y = rewriteScalar(requireArrayValue(numeric, 2), tail.sign * delta.y, tolerance.y);
    if (x != null && y != null) {
      rewritten = inner.slice(0, tail.from) + `(${x},${y})` + inner.slice(tail.to);
    } else {
      rewritten = appendOffset(inner, delta.x, delta.y, tolerance);
    }
  } else {
    rewritten = appendOffset(inner, delta.x, delta.y, tolerance);
  }
  return raw.slice(0, calcStart + 1) + rewritten + raw.slice(calcStart + parsed.x.length - 1);
}

function appendOffset(inner: string, x: number, y: number, tolerance: { x: number; y: number }): string {
  const end = inner.trimEnd().length;
  return `${inner.slice(0, end)}+(${shortestDecimal(ptToCm(pt(x)), ptToCm(pt(tolerance.x)))},${shortestDecimal(ptToCm(pt(y)), ptToCm(pt(tolerance.y)))})${inner.slice(end)}`;
}

/** The scalar moved by `deltaPt`, to within `tolerancePt`; unchanged when the move is within it. */
function rewriteScalar(raw: string, deltaPt: number, tolerancePt: number): string | null {
  const match = SCALAR.exec(raw);
  if (!match) return null;
  if (Math.abs(deltaPt) <= tolerancePt) return raw;
  const unit = match[3] ?? "cm";
  const unitPt = parseLength(`1${unit}`, "cm");
  if (unitPt == null || unitPt === 0) return null;
  const value = Number(match[2]) + deltaPt / unitPt;
  const text = shortestDecimal(value, tolerancePt / unitPt);
  // Keep the author's `.5` spelling.
  const bare = /^[+-]?\./u.test(requireArrayValue(match, 2)) ? text.replace(/^(-?)0\./u, "$1.") : text;
  return `${match[1]}${bare}${match[3] ?? ""}${match[4]}`;
}

/** Find only a complete top-level term, never an interpolation operand. */
function trailingTerm(inner: string): { text: string; from: number; to: number; sign: number } {
  let depth = 0;
  let from = 0;
  let sign = 1;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner.charAt(i);

    if (ch === "\\") { i += 1; continue; }
    if ("({[".includes(ch)) depth += 1;
    else if (")}]".includes(ch)) depth -= 1;
    else if (depth === 0 && (ch === "+" || ch === "-")) {
      from = i + 1;
      sign = ch === "-" ? -1 : 1;
    }
  }
  while (/\s/u.test(inner[from] ?? "") && from < inner.length) from += 1;
  const to = inner.trimEnd().length;
  return { text: inner.slice(from, to), from, to, sign };
}
