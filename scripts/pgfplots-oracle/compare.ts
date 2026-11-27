/**
 * Oracle comparison. Both functions take the neutral `Tier1` / `Tier2`
 * structures (schema.ts) for expected (oracle) and observed (our renderer,
 * after normalisation into the same structures) — never SVG.
 *
 * Tier 1: named quantities; layout to `layoutPt`, discrete outputs exact.
 * Tier 2: primitives matched by geometry, not by order. Paths are split into
 * subpaths so that grouping (one path with many subpaths vs many paths) does
 * not matter. Paint order is checked only between overlapping painted items,
 * the only place it is visible.
 */
import type { Box, NodeGeometry, OracleAxis, OracleTick, Paint, PathPrimitive, PathSegment, Point, TextBox, Tier1, Tier2 } from "./schema.js";

export interface Tolerances {
  /** Layout positions: boxes, anchors, ticks, labels, straight path geometry (pt). */
  layoutPt: number;
  /** Paths containing curves (pt). Set from the engine noise floor. */
  curvePt: number;
  /** Glyph origins (pt). */
  glyphPt: number;
  /** Line widths and dash lengths (pt). */
  strokePt: number;
  /** Colour components and alpha (0..1). */
  colour: number;
  /** Tick values: relative to the axis range (data units). */
  tickRelative: number;
  /** Pairs further apart than this are not considered the same primitive (pt). */
  searchRadiusPt: number;
  /**
   * The `above/below/left/right of origin` axis anchors. pgfplots reports
   * them up to 0.042pt off the box edge they lie on (28 fixtures, 2026-11-27;
   * behaviour A7), a computation noise of the oracle, not a rule.
   */
  originProjectionPt: number;
}

export const DEFAULT_TOLERANCES: Tolerances = {
  layoutPt: 0.02,
  curvePt: 0.02,
  glyphPt: 0.02,
  strokePt: 0.01,
  colour: 1e-3,
  tickRelative: 1e-6,
  searchRadiusPt: 4,
  originProjectionPt: 0.05,
};

export interface CompareOptions {
  tolerances?: Partial<Tolerances>;
  /** Compare LuaTeX text boxes (default: when the expected data has any). */
  textBoxes?: boolean;
  /** Compare PDF font names of glyphs (subset tag removed, case-insensitive). */
  fontNames?: boolean;
  /** Check paint order between overlapping painted items. */
  paintOrder?: boolean;
}

export interface Finding {
  tier: 1 | 2;
  /** Stable category, e.g. `tick-value`, `anchor`, `path-missing`, `paint`. */
  code: string;
  /** Where, e.g. `axes[0].ticks.x[2].value` or `stroke#14`. */
  where: string;
  message: string;
  delta?: number;
  tolerance?: number;
}

export interface CompareStats {
  /** Largest numeric difference seen per category, whether or not it failed. */
  maxDelta: Record<string, number>;
  matched: Record<string, number>;
}

export interface CompareResult { pass: boolean; findings: Finding[]; stats: CompareStats }

function newStats(): CompareStats { return { maxDelta: {}, matched: {} }; }
function noteDelta(stats: CompareStats, key: string, delta: number): void {
  stats.maxDelta[key] = Math.max(stats.maxDelta[key] ?? 0, delta);
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------------------------------------------------------------------------
// Tier 1

export function compareTier1(expected: Tier1, observed: Tier1, options: CompareOptions = {}): CompareResult {
  const tol = { ...DEFAULT_TOLERANCES, ...options.tolerances };
  const findings: Finding[] = [];
  const stats = newStats();
  const add = (code: string, where: string, message: string, delta?: number, tolerance?: number) =>
    findings.push({ tier: 1, code, where, message, ...(delta === undefined ? {} : { delta }), ...(tolerance === undefined ? {} : { tolerance }) });
  const point = (code: string, where: string, e: Point | undefined, o: Point | undefined, limit = tol.layoutPt) => {
    if (!e) return;
    if (!o) { add(`${code}-missing`, where, "missing in observed"); return; }
    const d = dist(e, o);
    noteDelta(stats, code, d);
    if (d > limit) add(code, where, `off by ${d.toFixed(4)}pt (expected ${fmt(e)}, observed ${fmt(o)})`, d, limit);
  };
  const anchors = (code: string, where: string, e: Record<string, Point> | undefined, o: Record<string, Point> | undefined) => {
    if (!e) return;
    if (!o) { add(`${code}-missing`, where, "anchors missing in observed"); return; }
    for (const [name, p] of Object.entries(e)) {
      const noisy = code === "axis-anchor" && /^(above|below|left of|right of) origin$/u.test(name);
      point(code, `${where}.${name}`, p, o[name], noisy ? Math.max(tol.layoutPt, tol.originProjectionPt) : tol.layoutPt);
    }
  };
  const node = (code: string, where: string, e: NodeGeometry | undefined, o: NodeGeometry | undefined) => {
    if (!e && !o) return;
    if (!e || !o) { add(`${code}-presence`, where, e ? "missing in observed" : "unexpected in observed"); return; }
    anchors(code, where, e.anchors, o.anchors);
    if (e.text !== undefined && o.text !== undefined && e.text !== o.text) add(`${code}-text`, `${where}.text`, `expected ${JSON.stringify(e.text)}, observed ${JSON.stringify(o.text)}`);
  };

  if (expected.boundingBox) {
    const e = expected.boundingBox; const o = observed.boundingBox;
    point("bbox", "boundingBox.min", { x: e.minX, y: e.minY }, o && { x: o.minX, y: o.minY });
    point("bbox", "boundingBox.max", { x: e.maxX, y: e.maxY }, o && { x: o.maxX, y: o.maxY });
  }
  if (expected.axes.length !== observed.axes.length) add("axis-count", "axes", `expected ${expected.axes.length} axes, observed ${observed.axes.length}`);
  expected.axes.forEach((e, index) => {
    const o: OracleAxis | undefined = observed.axes.find((a) => a.id === e.id) ?? observed.axes[index];
    const where = `axes[${index}]`;
    if (!o) return;
    const unit = e.map ? { x: Math.hypot(e.map.xUnit.x, e.map.xUnit.y), y: Math.hypot(e.map.yUnit.x, e.map.yUnit.y) } : undefined;
    if (e.limits) {
      if (!o.limits) add("limits-missing", `${where}.limits`, "missing in observed");
      else {
        for (const key of ["xmin", "xmax", "ymin", "ymax"] as const) {
          const scale = key.startsWith("x") ? unit?.x : unit?.y;
          const range = key.startsWith("x") ? e.limits.xmax - e.limits.xmin : e.limits.ymax - e.limits.ymin;
          const d = Math.abs(e.limits[key] - o.limits[key]);
          // Limits are compared as the canvas distance they cause.
          const canvas = scale === undefined ? (d / Math.abs(range || 1)) * 100 : d * scale;
          noteDelta(stats, "limits", canvas);
          if (canvas > tol.layoutPt) add("limits", `${where}.limits.${key}`, `expected ${e.limits[key]}, observed ${o.limits[key]} (${canvas.toFixed(4)}pt on canvas)`, canvas, tol.layoutPt);
        }
      }
    }
    if (e.rect) for (const key of ["r00", "r10", "r01", "r11"] as const) point("rect", `${where}.rect.${key}`, e.rect[key], o.rect?.[key]);
    if (e.map && e.limits) {
      if (!o.map) add("map-missing", `${where}.map`, "missing in observed");
      else {
        const { xmin, xmax, ymin, ymax } = e.limits;
        for (const [x, y] of [[xmin, ymin], [xmax, ymin], [xmin, ymax], [xmax, ymax]] as const) {
          point("map", `${where}.map(${x},${y})`, applyMap(e.map, x, y), applyMap(o.map, x, y));
        }
      }
    }
    anchors("axis-anchor", `${where}.anchors`, e.anchors, o.anchors);
    if (e.scale && (!o.scale || e.scale.x !== o.scale.x || e.scale.y !== o.scale.y)) add("scale", `${where}.scale`, `expected ${JSON.stringify(e.scale)}, observed ${JSON.stringify(o.scale)}`);
    if (e.ticks) {
      for (const letter of ["x", "y", "xExtra", "yExtra"] as const) {
        const et = e.ticks[letter]; const ot = o.ticks?.[letter];
        if (!et) { if (ot && ot.length > 0) add("tick-count", `${where}.ticks.${letter}`, `expected no ticks, observed ${ot.length}`); continue; }
        const twhere = `${where}.ticks.${letter}`;
        if (!ot) { add("ticks-missing", twhere, "missing in observed"); continue; }
        if (et.length !== ot.length) add("tick-count", twhere, `expected ${et.length} ticks [${et.map((t) => t.value).join(", ")}], observed ${ot.length} [${ot.map((t) => t.value).join(", ")}]`);
        const range = letter.startsWith("x") ? (e.limits ? e.limits.xmax - e.limits.xmin : 1) : (e.limits ? e.limits.ymax - e.limits.ymin : 1);
        et.forEach((tick: OracleTick, i) => {
          const other = ot[i];
          if (!other) return;
          const logDirection = e.scale?.[letter.startsWith("x") ? "x" : "y"] === "log";
          const dirUnit = letter.startsWith("x") ? unit?.x : unit?.y;
          if (logDirection && dirUnit !== undefined) {
            // On a log direction TeX writes \tick (a logarithm) with 5 decimals
            // and its fractional-step ticks carry fixed-point drift (behaviour
            // Q3): compared as the canvas distance it causes, like the limits.
            const canvas = Math.abs(tick.value - other.value) * dirUnit;
            noteDelta(stats, "tick-value-canvas", canvas);
            if (canvas > tol.layoutPt) add("tick-value", `${twhere}[${i}].value`, `expected ${tick.value}, observed ${other.value} (${canvas.toFixed(4)}pt on canvas)`, canvas, tol.layoutPt);
          } else {
            const d = Math.abs(tick.value - other.value) / Math.abs(range || 1);
            noteDelta(stats, "tick-value-relative", d);
            if (d > tol.tickRelative) add("tick-value", `${twhere}[${i}].value`, `expected ${tick.value}, observed ${other.value}`, d, tol.tickRelative);
          }
          if (tick.index !== other.index) add("tick-index", `${twhere}[${i}].index`, `expected \\ticknum ${tick.index}, observed ${other.index}`);
          node("tick-label", `${twhere}[${i}].label`, tick.label, other.label);
        });
      }
    }
    for (const kind of ["title", "xlabel", "ylabel", "legend"] as const) {
      node("description", `${where}.descriptions.${kind}`, e.descriptions?.[kind], o.descriptions?.[kind]);
    }
    if (e.legendEntries) {
      const oe = o.legendEntries ?? [];
      const key = (x: { row: number; column: number }) => `${String(x.row)}-${String(x.column)}`;
      if (e.legendEntries.map(key).join(",") !== oe.map(key).join(",")) add("legend-entry-cells", `${where}.legendEntries`, `expected cells [${e.legendEntries.map(key).join(", ")}], observed [${oe.map(key).join(", ")}]`);
      for (const entry of e.legendEntries) {
        const other = oe.find((x) => key(x) === key(entry));
        if (other) node("legend-entry", `${where}.legendEntries[${key(entry)}]`, entry.node, other.node);
      }
    }
  });
  return { pass: findings.length === 0, findings, stats };
}

export function applyMap(map: { origin: Point; xUnit: Point; yUnit: Point }, x: number, y: number): Point {
  return { x: map.origin.x + x * map.xUnit.x + y * map.yUnit.x, y: map.origin.y + x * map.xUnit.y + y * map.yUnit.y };
}

function fmt(p: Point): string { return `(${p.x.toFixed(4)}, ${p.y.toFixed(4)})`; }

// ---------------------------------------------------------------------------
// Tier 2: normalisation

interface PathItem {
  key: string;
  kind: string;
  source: PathPrimitive;
  segments: PathSegment[];
  closed: boolean;
  curved: boolean;
  samples: Point[];
  bounds: Box;
  order: number;
}

export function splitSubpaths(segments: PathSegment[]): PathSegment[][] {
  const result: PathSegment[][] = [];
  let current: PathSegment[] = [];
  for (const s of segments) {
    if (s.op === "M" && current.length > 0) { result.push(current); current = []; }
    current.push(s);
    if (s.op === "Z") { result.push(current); current = []; }
  }
  if (current.length > 0) result.push(current);
  // A moveto-only subpath paints nothing.
  return result.filter((sub) => sub.some((s) => s.op !== "M"));
}

function endPoint(s: PathSegment, start: Point): Point {
  return s.op === "Z" ? start : { x: s.x, y: s.y };
}

/** Canonical subpath: drop a final lineto that returns to the start before Z. */
function canonical(sub: PathSegment[]): PathSegment[] {
  const first = sub[0];
  if (!first || first.op === "Z") return sub;
  const start = { x: first.x, y: first.y };
  const last = sub[sub.length - 1]; const beforeLast = sub[sub.length - 2];
  if (last?.op === "Z" && beforeLast?.op === "L" && dist(beforeLast, start) < 1e-9) return [...sub.slice(0, -2), last];
  return sub;
}

function sampleSubpath(sub: PathSegment[]): Point[] {
  const samples: Point[] = [];
  const first = sub[0];
  if (!first || first.op === "Z") return samples;
  const start = { x: first.x, y: first.y };
  let p = start;
  samples.push(p);
  for (const s of sub.slice(1)) {
    const q = endPoint(s, start);
    const steps = 8;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      if (s.op === "C") {
        const u = 1 - t;
        samples.push({
          x: u * u * u * p.x + 3 * u * u * t * s.x1 + 3 * u * t * t * s.x2 + t * t * t * s.x,
          y: u * u * u * p.y + 3 * u * u * t * s.y1 + 3 * u * t * t * s.y2 + t * t * t * s.y,
        });
      } else samples.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
    p = q;
  }
  return samples;
}

function boundsOf(points: Point[]): Box {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { minX, minY, maxX, maxY };
}

function pathItems(tier2: Tier2): PathItem[] {
  const items: PathItem[] = [];
  tier2.primitives.forEach((p) => {
    if (p.type !== "path") return;
    splitSubpaths(p.segments).forEach((raw, index) => {
      const segments = canonical(raw);
      const samples = sampleSubpath(segments);
      if (samples.length === 0) return;
      const kind = p.operation === "fill" ? `fill-${p.fillRule ?? "nonzero"}` : p.operation;
      items.push({
        key: `${p.operation}#${p.order}.${index}`, kind, source: p, segments,
        closed: segments[segments.length - 1]?.op === "Z", curved: segments.some((s) => s.op === "C"),
        samples, bounds: boundsOf(samples), order: p.order,
      });
    });
  });
  return items;
}

function controlPoints(sub: PathSegment[]): Point[] {
  const pts: Point[] = [];
  for (const s of sub) {
    if (s.op === "M" || s.op === "L") pts.push({ x: s.x, y: s.y });
    else if (s.op === "C") pts.push({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }, { x: s.x, y: s.y });
  }
  return pts;
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function directedHausdorff(from: Point[], to: Point[]): number {
  let worst = 0;
  for (const p of from) {
    let best = Infinity;
    if (to.length === 1 && to[0]) best = dist(p, to[0]);
    for (let i = 1; i < to.length; i += 1) {
      const a = to[i - 1]; const b = to[i];
      if (a && b) best = Math.min(best, pointSegmentDistance(p, a, b));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

/** Geometric distance between two subpaths (pt). */
function itemDistance(a: PathItem, b: PathItem): number {
  const ops = (x: PathItem) => x.segments.map((s) => s.op).join("");
  if (ops(a) === ops(b)) {
    const pa = controlPoints(a.segments); const pb = controlPoints(b.segments);
    const direct = Math.max(...pa.map((p, i) => dist(p, pb[i] ?? p)));
    if (!a.curved) {
      // Polylines may be emitted in either direction, closed ones from any vertex.
      let best = direct;
      const candidates = a.closed ? pb.length : 1;
      for (const reversed of [false, true]) {
        const seq = reversed ? [...pb].reverse() : pb;
        for (let shift = 0; shift < candidates; shift += 1) {
          if (!a.closed && !reversed) continue;
          const rotated = [...seq.slice(shift), ...seq.slice(0, shift)];
          best = Math.min(best, Math.max(...pa.map((p, i) => dist(p, rotated[i] ?? p))));
        }
      }
      return best;
    }
    return direct;
  }
  return Math.max(directedHausdorff(a.samples, b.samples), directedHausdorff(b.samples, a.samples));
}

function boxGap(a: Box, b: Box): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
  return Math.hypot(dx, dy);
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/** Greedy minimum-distance assignment within `radius`. */
function assign<E, O>(expected: E[], observed: O[], distance: (e: E, o: O) => number, radius: number): { pairs: [number, number, number][]; unmatchedExpected: number[]; unmatchedObserved: number[] } {
  const candidates: [number, number, number][] = [];
  expected.forEach((e, i) => observed.forEach((o, j) => {
    const d = distance(e, o);
    if (d <= radius) candidates.push([i, j, d]);
  }));
  candidates.sort((a, b) => a[2] - b[2]);
  const usedE = new Set<number>(); const usedO = new Set<number>();
  const pairs: [number, number, number][] = [];
  for (const [i, j, d] of candidates) {
    if (usedE.has(i) || usedO.has(j)) continue;
    usedE.add(i); usedO.add(j); pairs.push([i, j, d]);
  }
  return {
    pairs,
    unmatchedExpected: expected.map((_, i) => i).filter((i) => !usedE.has(i)),
    unmatchedObserved: observed.map((_, j) => j).filter((j) => !usedO.has(j)),
  };
}

export function toRgb(paint: Paint): number[] {
  const c = paint.components;
  if (paint.space.includes("Gray") && c.length === 1) return [c[0] ?? 0, c[0] ?? 0, c[0] ?? 0];
  if (paint.space.includes("CMYK") && c.length === 4) {
    const [cy = 0, m = 0, y = 0, k = 0] = c;
    return [(1 - cy) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
  }
  return c;
}

function paintDelta(a: Paint | undefined, b: Paint | undefined): number {
  if (!a && !b) return 0;
  if (!a || !b) return Infinity;
  const ra = toRgb(a); const rb = toRgb(b);
  if (ra.length !== rb.length) return Infinity;
  return Math.max(Math.abs(a.alpha - b.alpha), ...ra.map((v, i) => Math.abs(v - (rb[i] ?? v))));
}

interface GlyphItem { unicode: string; x: number; y: number; font: string; size: number; paint: Paint; order: number; key: string }

function glyphItems(tier2: Tier2): GlyphItem[] {
  return tier2.primitives.flatMap((p) => p.type !== "glyphs" ? [] : (p).glyphs.map((g, i) => ({
    unicode: g.unicode, x: g.x, y: g.y, font: p.font.toLowerCase(), size: p.size, paint: p.paint, order: p.order, key: `glyph#${p.order}.${i}`,
  })));
}

// ---------------------------------------------------------------------------
// Tier 2: comparison

export function compareTier2(expected: Tier2, observed: Tier2, options: CompareOptions = {}): CompareResult {
  const tol = { ...DEFAULT_TOLERANCES, ...options.tolerances };
  const findings: Finding[] = [];
  const stats = newStats();
  const add = (code: string, where: string, message: string, delta?: number, tolerance?: number) =>
    findings.push({ tier: 2, code, where, message, ...(delta === undefined ? {} : { delta }), ...(tolerance === undefined ? {} : { tolerance }) });

  // Paths, per kind.
  const ePaths = pathItems(expected); const oPaths = pathItems(observed);
  const matchedOrder: { e: number; o: number; bounds: Box; painted: boolean }[] = [];
  for (const kind of new Set([...ePaths, ...oPaths].map((p) => p.kind))) {
    const es = ePaths.filter((p) => p.kind === kind); const os = oPaths.filter((p) => p.kind === kind);
    const { pairs, unmatchedExpected, unmatchedObserved } = assign(es, os, (e, o) => boxGap(e.bounds, o.bounds) > tol.searchRadiusPt ? Infinity : itemDistance(e, o), tol.searchRadiusPt);
    for (const i of unmatchedExpected) { const e = es[i]; if (e) add("path-missing", e.key, `${kind} subpath ${describe(e)} not found in observed`); }
    for (const j of unmatchedObserved) { const o = os[j]; if (o) add("path-extra", o.key, `observed ${kind} subpath ${describe(o)} not in oracle`); }
    for (const [i, j, d] of pairs) {
      const e = es[i]; const o = os[j];
      if (!e || !o) continue;
      const limit = e.curved ? tol.curvePt : tol.layoutPt;
      noteDelta(stats, e.curved ? "path-curve" : "path-straight", d);
      stats.matched[kind] = (stats.matched[kind] ?? 0) + 1;
      if (d > limit) add("path-geometry", e.key, `${kind} subpath ${describe(e)} off by ${d.toFixed(4)}pt`, d, limit);
      matchedOrder.push({ e: e.order, o: o.order, bounds: e.bounds, painted: e.kind !== "clip" });
      styleFindings(e.source, o.source, e.key, tol, add, stats);
    }
  }

  // Glyphs, matched per Unicode value by position.
  const eg = glyphItems(expected); const og = glyphItems(observed);
  const glyphs = assign(eg, og, (e, o) => e.unicode === o.unicode ? dist(e, o) : Infinity, tol.searchRadiusPt);
  for (const i of glyphs.unmatchedExpected) { const e = eg[i]; if (e) add("glyph-missing", e.key, `glyph ${JSON.stringify(e.unicode)} at ${fmt(e)} not found`); }
  for (const j of glyphs.unmatchedObserved) { const o = og[j]; if (o) add("glyph-extra", o.key, `observed glyph ${JSON.stringify(o.unicode)} at ${fmt(o)} not in oracle`); }
  for (const [i, j, d] of glyphs.pairs) {
    const e = eg[i]; const o = og[j];
    if (!e || !o) continue;
    noteDelta(stats, "glyph", d);
    stats.matched.glyph = (stats.matched.glyph ?? 0) + 1;
    if (d > tol.glyphPt) add("glyph-position", e.key, `glyph ${JSON.stringify(e.unicode)} off by ${d.toFixed(4)}pt`, d, tol.glyphPt);
    if (Math.abs(e.size - o.size) > tol.strokePt) add("glyph-size", e.key, `font size ${e.size} vs ${o.size}`);
    if ((options.fontNames ?? true) && e.font !== o.font) add("glyph-font", e.key, `font ${e.font} vs ${o.font}`);
    const pd = paintDelta(e.paint, o.paint);
    if (pd > tol.colour) add("paint", e.key, `glyph colour ${JSON.stringify(e.paint)} vs ${JSON.stringify(o.paint)}`);
    matchedOrder.push({ e: e.order, o: o.order, bounds: { minX: e.x, minY: e.y, maxX: e.x + e.size * 0.5, maxY: e.y + e.size * 0.7 }, painted: true });
  }

  // LuaTeX text boxes.
  if (options.textBoxes ?? expected.textBoxes.length > 0) {
    const tb = assign(expected.textBoxes, observed.textBoxes, (e, o) => textBoxDistance(e, o), tol.searchRadiusPt);
    for (const i of tb.unmatchedExpected) { const e = expected.textBoxes[i]; if (e) add("textbox-missing", `textbox#${e.tag}`, `text box ${JSON.stringify(e.text)} at ${fmt(e.origin)} not found`); }
    for (const j of tb.unmatchedObserved) { const o = observed.textBoxes[j]; if (o) add("textbox-extra", `textbox#${o.tag}`, `observed text box ${JSON.stringify(o.text)} not in oracle`); }
    for (const [i, j, d] of tb.pairs) {
      const e = expected.textBoxes[i]; const o = observed.textBoxes[j];
      if (!e || !o) continue;
      noteDelta(stats, "textbox", d);
      stats.matched.textbox = (stats.matched.textbox ?? 0) + 1;
      const size = Math.max(Math.abs(e.width - o.width), Math.abs(e.height - o.height), Math.abs(e.depth - o.depth));
      noteDelta(stats, "textbox-size", size);
      if (d > tol.layoutPt) add("textbox-position", `textbox#${e.tag}`, `text box ${JSON.stringify(e.text)} off by ${d.toFixed(4)}pt`, d, tol.layoutPt);
      if (size > tol.layoutPt) add("textbox-size", `textbox#${e.tag}`, `text box ${JSON.stringify(e.text)} size differs by ${size.toFixed(4)}pt`, size, tol.layoutPt);
      if (e.text !== o.text) add("textbox-text", `textbox#${e.tag}`, `text ${JSON.stringify(e.text)} vs ${JSON.stringify(o.text)}`);
    }
  }

  // Paint order where it is visible: overlapping painted items.
  if (options.paintOrder ?? true) {
    let inversions = 0;
    const painted = matchedOrder.filter((m) => m.painted);
    for (let a = 0; a < painted.length; a += 1) {
      for (let b = a + 1; b < painted.length; b += 1) {
        const p = painted[a]; const q = painted[b];
        if (!p || !q || !boxesOverlap(p.bounds, q.bounds) || p.e === q.e || p.o === q.o) continue;
        if (Math.sign(p.e - q.e) !== Math.sign(p.o - q.o)) inversions += 1;
      }
    }
    stats.maxDelta["paint-order-inversions"] = inversions;
    if (inversions > 0) add("paint-order", "primitives", `${inversions} overlapping pairs painted in a different order`);
  }
  return { pass: findings.length === 0, findings, stats };
}

function textBoxDistance(e: TextBox, o: TextBox): number {
  const rotation = Math.max(dist(e.xAxis, o.xAxis), dist(e.yAxis, o.yAxis));
  if (rotation > 1e-3 || e.nesting !== o.nesting) return Infinity;
  return dist(e.origin, o.origin);
}

function describe(item: PathItem): string {
  const b = item.bounds;
  return `[${item.segments.map((s) => s.op).join("")}] (${b.minX.toFixed(2)},${b.minY.toFixed(2)})-(${b.maxX.toFixed(2)},${b.maxY.toFixed(2)})`;
}

function styleFindings(e: PathPrimitive, o: PathPrimitive, where: string, tol: Tolerances, add: (code: string, where: string, message: string, delta?: number, tolerance?: number) => void, stats: CompareStats): void {
  if (e.operation !== "clip") {
    const pd = paintDelta(e.paint, o.paint);
    if (pd !== Infinity) noteDelta(stats, "paint", pd);
    if (pd > tol.colour) add("paint", where, `paint ${JSON.stringify(e.paint)} vs ${JSON.stringify(o.paint)}`);
  }
  if (e.operation === "stroke") {
    const lw = Math.abs((e.lineWidth ?? 1) - (o.lineWidth ?? 1));
    noteDelta(stats, "line-width", lw);
    if (lw > tol.strokePt) add("line-width", where, `line width ${e.lineWidth} vs ${o.lineWidth}`, lw, tol.strokePt);
    const ea = e.dash?.array ?? []; const oa = o.dash?.array ?? [];
    if (ea.length !== oa.length || ea.some((v, i) => Math.abs(v - (oa[i] ?? v)) > tol.strokePt) || Math.abs((e.dash?.phase ?? 0) - (o.dash?.phase ?? 0)) > tol.strokePt) {
      add("dash", where, `dash ${JSON.stringify(e.dash ?? null)} vs ${JSON.stringify(o.dash ?? null)}`);
    }
    if ((e.lineCap ?? 0) !== (o.lineCap ?? 0)) add("line-cap", where, `line cap ${e.lineCap} vs ${o.lineCap}`);
    if ((e.lineJoin ?? 0) !== (o.lineJoin ?? 0)) add("line-join", where, `line join ${e.lineJoin} vs ${o.lineJoin}`);
  }
  // Clipping: compare the effective clip rectangle.
  if (!!e.clipBox !== !!o.clipBox) add("clip", where, e.clipBox ? "clip missing in observed" : "unexpected clip in observed");
  else if (e.clipBox && o.clipBox) {
    const d = Math.max(Math.abs(e.clipBox.minX - o.clipBox.minX), Math.abs(e.clipBox.minY - o.clipBox.minY), Math.abs(e.clipBox.maxX - o.clipBox.maxX), Math.abs(e.clipBox.maxY - o.clipBox.maxY));
    noteDelta(stats, "clip", d);
    if (d > tol.layoutPt) add("clip", where, `clip box differs by ${d.toFixed(4)}pt`, d, tol.layoutPt);
  }
}

/** Both tiers. */
export function comparePicture(expected: { tier1: Tier1; tier2: Tier2 }, observed: { tier1: Tier1; tier2: Tier2 }, options: CompareOptions = {}): { tier1: CompareResult; tier2: CompareResult; pass: boolean } {
  const tier1 = compareTier1(expected.tier1, observed.tier1, options);
  const tier2 = compareTier2(expected.tier2, observed.tier2, options);
  return { tier1, tier2, pass: tier1.pass && tier2.pass };
}
