import type { CalcCoordinateEditHandle } from "../semantic/types.js";
import type { WorldPoint } from "../coords/points.js";
import { worldVector } from "../coords/points.js";
import { pt } from "../coords/scalars.js";
import { ptToCm } from "../coords/source.js";
import { parseCoordinate } from "../domains/coordinates/parse.js";
import { parseLength } from "../semantic/coords/parse-length.js";
import { worldDeltaToLocalDelta } from "./coords.js";
import { formatNumber } from "./format.js";

const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const SCALAR = new RegExp(`^(\\s*)(${NUMBER})(cm|mm|pt|bp|pc|in|dd|cc|sp)?(\\s*)$`, "u");
const CARTESIAN = /^\(([^(),]+),([^(),]+)\)$/u;

/** Translate a calc expression without flattening its named references or math. */
export function rewriteCalcCoordinate(newWorld: WorldPoint, handle: CalcCoordinateEditHandle, source: string): string | null {
  const delta = worldDeltaToLocalDelta(worldVector(pt(newWorld.x - handle.world.x), pt(newWorld.y - handle.world.y)), handle.frame);
  if (!delta || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return null;
  const raw = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
  if (Math.abs(delta.x) < 1e-9 && Math.abs(delta.y) < 1e-9) return raw;
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
    rewritten = `${inner.slice(0, end)}+(${formatNumber(delta.x, { fractionDigits: 6 })}pt,${formatNumber(delta.y, { fractionDigits: 6 })}pt)${inner.slice(end)}`;
  } else if (numeric) {
    const x = rewriteScalar(numeric[1], tail.sign * delta.x);
    const y = rewriteScalar(numeric[2], tail.sign * delta.y);
    if (x != null && y != null) {
      rewritten = inner.slice(0, tail.from) + `(${x},${y})` + inner.slice(tail.to);
    } else {
      rewritten = appendOffset(inner, delta.x, delta.y);
    }
  } else {
    rewritten = appendOffset(inner, delta.x, delta.y);
  }
  return raw.slice(0, calcStart + 1) + rewritten + raw.slice(calcStart + parsed.x.length - 1);
}

function appendOffset(inner: string, x: number, y: number): string {
  const end = inner.trimEnd().length;
  return `${inner.slice(0, end)}+(${formatNumber(ptToCm(pt(x)))},${formatNumber(ptToCm(pt(y)))})${inner.slice(end)}`;
}

function rewriteScalar(raw: string, deltaPt: number): string | null {
  const match = SCALAR.exec(raw);
  if (!match) return null;
  if (Math.abs(deltaPt) < 1e-9) return raw;
  const unit = match[3] ?? "cm";
  const unitPt = parseLength(`1${unit}`, "cm");
  if (unitPt == null || unitPt === 0) return null;
  const value = Number(match[2]) + deltaPt / unitPt;
  const [mantissa, exponent = "0"] = match[2].toLowerCase().split("e");
  const digits = Math.max(0, (mantissa.split(".")[1]?.length ?? 0) - Number(exponent));
  const formatted = formatNumber(value, { fractionDigits: Math.min(12, Math.max(2, digits)) });
  const displayDigits = Math.min(12, Math.max(digits, formatted.split(".")[1]?.length ?? 0));
  const display = digits > 0 ? Number(formatted).toFixed(displayDigits) : formatted;
  return `${match[1]}${display}${match[3] ?? ""}${match[4]}`;
}

/** Find only a complete top-level term, never an interpolation operand. */
function trailingTerm(inner: string): { text: string; from: number; to: number; sign: number } {
  let depth = 0;
  let from = 0;
  let sign = 1;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
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
