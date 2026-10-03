import type { CoordinateSourceUnits } from "../semantic/types.js";
import { coordinateSourceUnit, parseLength } from "../semantic/coords/parse-length.js";
import { PT_PER_CM } from "../coords/source.js";
import { formatNumber } from "./format.js";

function componentWithUnit(value: string, oldComponent: string, unit?: string): string {
  // Public format helpers also accept already-authored lengths or expressions.
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return value;
  const resolvedUnit = unit ?? coordinateSourceUnit(oldComponent);
  if (!resolvedUnit) return value;
  const factor = parseLength(`1${resolvedUnit}`, "pt");
  return factor ? `${formatNumber(numericValue * PT_PER_CM / factor, { fractionDigits: 6 })}${resolvedUnit}` : value;
}

export function formatCoordinate(oldRaw: string, x: string, y: string, units?: CoordinateSourceUnits): string {
  const exact = oldRaw.match(/^\((\s*)(\[[^\]]*\]\s*)?([^,)]*)(\s*),(\s*)([^)]*)(\s*)\)$/s);
  if (exact) {
    return `(${exact[1]}${exact[2] ?? ""}${componentWithUnit(x, exact[3], units?.x)}${exact[4]},${exact[5]}${componentWithUnit(y, exact[6], units?.y)}${exact[7]})`;
  }

  const afterComma = /,\s+/.test(oldRaw) ? " " : "";
  return `(${x},${afterComma}${y})`;
}

export function formatPolarCoordinate(oldRaw: string, angle: string, radius: string, units?: CoordinateSourceUnits): string {
  const exact = oldRaw.match(/^\((\s*)(\[[^\]]*\]\s*)?([^:)]*)(\s*):(\s*)([^)]*)(\s*)\)$/s);
  if (exact) {
    return `(${exact[1]}${exact[2] ?? ""}${angle}${exact[4]}:${exact[5]}${componentWithUnit(radius, exact[6], units?.radius)}${exact[7]})`;
  }

  const afterColon = /:\s+/.test(oldRaw) ? " " : "";
  return `(${angle}:${afterColon}${radius})`;
}

export function formatCanvasCoordinate(oldRaw: string, x: string, y: string, units?: CoordinateSourceUnits): string | null {
  if (!/canvas\s+cs:/iu.test(oldRaw)) return null;
  let count = 0;
  const result = oldRaw.replace(/\b([xy])\s*=\s*([^,)]+)/gu, (_match, key: "x" | "y", value: string) => {
    count += 1;
    return `${key}=${componentWithUnit(key === "x" ? x : y, value, units?.[key])}`;
  });
  return count === 2 ? result : null;
}
