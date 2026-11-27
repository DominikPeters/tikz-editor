/**
 * A compact text digest of an experiment case's Tier 2 trace and Tier 1
 * limits, for reading by eye: one line per painted primitive with its paint,
 * width, clip depth and (rounded) subpaths in axis data units when an axis
 * map is known.
 */
import type { OracleAxis, PathPrimitive, Tier2 } from "../schema.js";
import type { ExpResult } from "./lib.js";

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Inverse of the oracle's affine map: page point to data (x, y). */
export function dataOf(axis: OracleAxis | undefined): ((x: number, y: number) => [number, number]) | null {
  const m = axis?.map;
  if (!m) return null;
  return (x, y) => [(x - m.origin.x) / m.xUnit.x, (y - m.origin.y) / m.yUnit.y];
}

export function paintText(p: PathPrimitive): string {
  const c = p.paint?.components.map((v) => r3(v)).join(",") ?? "-";
  return `${p.paint?.space ?? ""}(${c})${p.paint && p.paint.alpha !== 1 ? `a${r3(p.paint.alpha)}` : ""}`;
}

export function pathText(p: PathPrimitive, toData: ((x: number, y: number) => [number, number]) | null, max = 12): string {
  const parts: string[] = [];
  for (const s of p.segments) {
    if (parts.length >= max) { parts.push("…"); break; }
    if (s.op === "Z") { parts.push("Z"); continue; }
    const [x, y] = toData ? toData(s.x, s.y) : [s.x, s.y];
    parts.push(`${s.op}${r3(x)},${r3(y)}`);
  }
  return parts.join(" ");
}

export function digest(result: ExpResult, options: { data?: boolean; max?: number } = {}): string {
  const lines: string[] = [];
  const axis = result.axis;
  if (axis?.limits) lines.push(`limits x[${r3(axis.limits.xmin)}, ${r3(axis.limits.xmax)}] y[${r3(axis.limits.ymin)}, ${r3(axis.limits.ymax)}]`);
  const toData = options.data === false ? null : dataOf(axis);
  for (const p of result.tier2.primitives) {
    if (p.type === "path") {
      lines.push(`${String(p.order).padStart(3)} ${p.operation.padEnd(6)} ${paintText(p)} lw${r3(p.lineWidth ?? 0)} clip${p.clipDepth}${p.dash && p.dash.array.length ? ` dash[${p.dash.array.map(r3).join(",")}]` : ""}  ${pathText(p, toData, options.max ?? 12)}`);
    } else if (p.type === "glyphs") {
      lines.push(`${String(p.order).padStart(3)} glyphs ${p.glyphs.map((g) => g.unicode).join("")}`);
    }
  }
  return lines.join("\n");
}

export function tier2Paths(t2: Tier2): PathPrimitive[] {
  return t2.primitives.filter((p): p is PathPrimitive => p.type === "path");
}
