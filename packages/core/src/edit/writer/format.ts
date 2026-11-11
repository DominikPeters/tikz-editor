import { requireArrayValue } from "../../utils/collections.js";
import type { CoordinateSourceUnits } from "../../semantic/types.js";
import { coordinateSourceUnit, parseLength } from "../../semantic/coords/parse-length.js";
import { PT_PER_CM } from "../../coords/source.js";
import { formatNumber, shortestDecimal } from "../format.js";

// Writer-internal (checker rule F3): authored spelling around new numbers.
// Each keeps the old coordinate's whitespace, coordinate options and units;
// numbers come in cm-equivalent and are converted to a component's unit.

/**
 * A number to write, in cm-equivalent units, and how far from it the written
 * text may be. It is rounded in the unit it is written in, so `20pt` stays
 * `20pt` rather than passing through centimetres.
 */
export type WrittenValue = Readonly<{ value: number; tolerance: number }>;

const AUTHORED = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([A-Za-z]+)?\s*$/u;

/** The number an authored component says, in `unit` (or plain), when it is one. */
function authoredValue(component: string, unit?: string): number | null {
  const match = AUTHORED.exec(component);
  if (!match || (match[2] ?? undefined) !== unit) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * The text for `value` in `unit`: the authored text when it already says
 * that, else the shortest decimal, spelled `.5` where the author wrote `.5`.
 */
export function writtenNumber(value: number, tolerance: number, authored: string | undefined, unit: string | undefined): string {
  const old = authored === undefined ? null : authoredValue(authored, unit);
  if (authored !== undefined && old !== null && Math.abs(old - value) <= tolerance) return authored.trim();
  return `${bareLike(shortestDecimal(value, tolerance), authored)}${unit ?? ""}`;
}

const BARE = /^\s*[+-]?\.\d/u;

/** `0.82` as `.82` when the authored number dropped its leading zero. */
function bareLike(text: string, authored: string | undefined): string {
  return authored !== undefined && BARE.test(authored) ? text.replace(/^(-?)0\./u, "$1.") : text;
}

function componentWithUnit(component: string | WrittenValue, oldComponent: string, unit?: string): string {
  const resolvedUnit = unit ?? coordinateSourceUnit(oldComponent);
  if (typeof component !== "string") {
    const factor = resolvedUnit ? parseLength(`1${resolvedUnit}`, "pt") : null;
    const scale = resolvedUnit && factor ? PT_PER_CM / factor : 1;
    const text = writtenNumber(component.value * scale, component.tolerance * scale, oldComponent, resolvedUnit && factor ? resolvedUnit : undefined);
    // Keep the author's spacing around a component written afresh.
    return text === oldComponent.trim() ? oldComponent : text;
  }
  // Public format helpers also accept already-authored lengths or expressions.
  const numericValue = Number(component);
  if (!Number.isFinite(numericValue)) return component;
  if (!resolvedUnit) return component;
  const factor = parseLength(`1${resolvedUnit}`, "pt");
  return factor ? `${formatNumber(numericValue * PT_PER_CM / factor, { fractionDigits: 6 })}${resolvedUnit}` : component;
}

export function formatCoordinate(oldRaw: string, x: string | WrittenValue, y: string | WrittenValue, units?: CoordinateSourceUnits): string {
  const exact = oldRaw.match(/^\((\s*)(\[[^\]]*\]\s*)?([^,)]*)(\s*),(\s*)([^)]*)(\s*)\)$/s);
  if (exact) {
    return `(${exact[1]}${exact[2] ?? ""}${componentWithUnit(x, requireArrayValue(exact, 3), units?.x)}${exact[4]},${exact[5]}${componentWithUnit(y, requireArrayValue(exact, 6), units?.y)}${exact[7]})`;
  }

  const afterComma = /,\s+/.test(oldRaw) ? " " : "";
  return `(${plain(x)},${afterComma}${plain(y)})`;
}

/** An angle in degrees; with a tolerance, the authored angle is kept when it says the same modulo 360. */
export type WrittenAngle = string | Readonly<{ value: number; tolerance: number }>;

function angleText(angle: WrittenAngle, oldAngle?: string): string {
  if (typeof angle === "string") return angle;
  const old = oldAngle === undefined ? null : authoredValue(oldAngle);
  if (oldAngle !== undefined && old !== null && Math.abs(((angle.value - old) % 360 + 540) % 360 - 180) <= angle.tolerance) return oldAngle;
  // A full turn reads as no turn: `360` is `0` written the long way.
  const value = Math.abs(angle.value - 360) <= angle.tolerance ? 0 : angle.value;
  return bareLike(shortestDecimal(value, angle.tolerance), oldAngle);
}

export function formatPolarCoordinate(oldRaw: string, angle: WrittenAngle, radius: string | WrittenValue, units?: CoordinateSourceUnits): string {
  const exact = oldRaw.match(/^\((\s*)(\[[^\]]*\]\s*)?([^:)]*)(\s*):(\s*)([^)]*)(\s*)\)$/s);
  if (exact) {
    return `(${exact[1]}${exact[2] ?? ""}${angleText(angle, exact[3])}${exact[4]}:${exact[5]}${componentWithUnit(radius, requireArrayValue(exact, 6), units?.radius)}${exact[7]})`;
  }

  const afterColon = /:\s+/.test(oldRaw) ? " " : "";
  return `(${angleText(angle)}:${afterColon}${plain(radius)})`;
}

function plain(component: string | WrittenValue): string {
  return typeof component === "string" ? component : shortestDecimal(component.value, component.tolerance);
}

export function formatCanvasCoordinate(oldRaw: string, x: string | WrittenValue, y: string | WrittenValue, units?: CoordinateSourceUnits): string | null {
  if (!/canvas\s+cs:/iu.test(oldRaw)) return null;
  let count = 0;
  const result = oldRaw.replace(/\b([xy])\s*=\s*([^,)]+)/gu, (_match, key: "x" | "y", value: string) => {
    count += 1;
    return `${key}=${componentWithUnit(key === "x" ? x : y, value, units?.[key])}`;
  });
  return count === 2 ? result : null;
}

/**
 * The two components of an authored cartesian coordinate. Null for any
 * other form, and for coordinate options, which change how it is read.
 */
export function cartesianComponents(raw: string): { x: string; y: string } | null {
  const exact = raw.match(/^\(\s*([^,()[\]$:]*?)\s*,\s*([^,()[\]$:]*?)\s*\)$/s);
  return exact ? { x: requireArrayValue(exact, 1), y: requireArrayValue(exact, 2) } : null;
}

/**
 * The components of an authored cartesian coordinate with its layout, for
 * writing new components in the same spelling. `z` is an xyz coordinate's
 * third component, which a translation leaves alone.
 */
export type CoordinateLayout = Readonly<{
  open: string;
  options: string;
  x: string;
  gap: string;
  y: string;
  afterY: string;
  z: string | null;
}>;

export function coordinateLayout(raw: string): CoordinateLayout | null {
  const match = raw.match(/^\((\s*)(\[[^\]]*\]\s*)?([^,()[\]$:]*?)(\s*,\s*)([^,()[\]$:]*?)(\s*)(?:,([^,()[\]$:]*?)(\s*))?\)$/s);
  if (!match) return null;
  return {
    open: requireArrayValue(match, 1),
    options: match[2] ?? "",
    x: requireArrayValue(match, 3),
    gap: requireArrayValue(match, 4),
    y: requireArrayValue(match, 5),
    afterY: requireArrayValue(match, 6),
    z: match[7] === undefined ? null : `${match[7]}${match[8] ?? ""}`
  };
}

/**
 * A component plus `variable × value` terms, `value` in cm-equivalent units
 * of the component, each written to within its `tolerance`.
 */
export function translatedComponent(
  oldComponent: string,
  terms: readonly Readonly<{ variable: string; value: number; tolerance: number }>[],
  unit?: string
): string {
  const resolvedUnit = unit ?? coordinateSourceUnit(oldComponent);
  const factor = resolvedUnit ? parseLength(`1${resolvedUnit}`, "pt") : null;
  const scale = resolvedUnit && factor ? PT_PER_CM / factor : 1;
  const written = terms.flatMap(term => {
    const magnitude = bareLike(shortestDecimal(Math.abs(term.value) * scale, term.tolerance * scale), oldComponent);
    return Number(magnitude) === 0 ? [] : [{ negative: term.value < 0, text: `${term.variable}*${magnitude}${resolvedUnit && factor ? resolvedUnit : ""}` }];
  });
  if (written.length === 0) return oldComponent;
  const zero = Number(oldComponent.trim()) === 0 && oldComponent.trim() !== "";
  let text = zero ? "" : oldComponent;
  for (const term of written) text += term.negative ? `-${term.text}` : `${text.length > 0 ? "+" : ""}${term.text}`;
  return text;
}
