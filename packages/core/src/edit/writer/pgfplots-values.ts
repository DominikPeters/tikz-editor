/**
 * Lengths and positions the pgfplots axis edits write (`width=`, `height=`,
 * `at=`): in the unit the document already uses, to the edit's write
 * tolerance. The axis frame and parent vectors come from the evaluator.
 */
import { shortestDecimal, writeTolerancePt } from "../format.js";
import type { CoordinateText } from "../fragment.js";
import { coordinateText } from "./coordinate-text.js";

type Pt = { x: number; y: number };

const PT_PER_UNIT: Record<string, number> = { pt: 1, cm: 72.27 / 2.54, mm: 72.27 / 25.4, in: 72.27, bp: 72.27 / 72 };

export function stripBraces(raw: string): string {
  let text = raw.trim();
  while (text.startsWith("{") && text.endsWith("}")) text = text.slice(1, -1).trim();
  return text;
}

/** `2cm` → { value: 2, unit: "cm" }; `3` → unit null; anything else (macros, `0.8\textwidth`) → null. */
export function readLengthWithUnit(raw: string): { value: number; unit: string | null } | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(pt|cm|mm|in|bp)?$/u.exec(stripBraces(raw));
  if (!match?.[1]) return null;
  return { value: Number(match[1]), unit: match[2] ?? null };
}

/** A length in `unit`, to the edit's write tolerance (pt). */
function writeLength(valuePt: number, unit: string): string {
  const perUnit = PT_PER_UNIT[unit] ?? 1;
  return `${shortestDecimal(valuePt / perUnit, writeTolerancePt() / perUnit)}${unit}`;
}

/**
 * The `at` value placing the axis anchor at `local` (pt in the parent frame),
 * in the spelling of the existing value: the same unit when both components
 * carry one, unitless through the parent's x/y vectors when the value is
 * unitless, cm otherwise.
 */
function writeAtText(existing: string | null, local: Pt, parentBasis: { x: Pt; y: Pt } | undefined, fallbackUnit = "cm"): string {
  const inner = existing ? stripBraces(existing) : "";
  const pair = /^\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)$/u.exec(inner);
  const x = pair?.[1] ? readLengthWithUnit(pair[1]) : null;
  const y = pair?.[2] ? readLengthWithUnit(pair[2]) : null;
  if (x && y && x.unit === null && y.unit === null && parentBasis) {
    const { x: bx, y: by } = parentBasis;
    const det = bx.x * by.y - bx.y * by.x;
    if (Math.abs(det) > 1e-12) {
      const u = (by.y * local.x - by.x * local.y) / det;
      const v = (-bx.y * local.x + bx.x * local.y) / det;
      const scale = Math.hypot(bx.x, bx.y) || 1;
      const tol = writeTolerancePt() / scale;
      return `{(${shortestDecimal(u, tol)},${shortestDecimal(v, tol)})}`;
    }
  }
  const unitX = x?.unit ?? y?.unit ?? fallbackUnit;
  const unitY = y?.unit ?? x?.unit ?? fallbackUnit;
  return `{(${writeLength(local.x, unitX)},${writeLength(local.y, unitY)})}`;
}


/** `width=`/`height=` value. */
export function writeAxisLength(valuePt: number, unit: string): CoordinateText {
  return coordinateText(writeLength(valuePt, unit));
}

/** `at=` value. */
export function writeAxisAt(existing: string | null, local: Pt, parentBasis: { x: Pt; y: Pt } | undefined, fallbackUnit = "cm"): CoordinateText {
  return coordinateText(writeAtText(existing, local, parentBasis, fallbackUnit));
}
