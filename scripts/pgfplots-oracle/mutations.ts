/**
 * Mutation test of the oracle (design/pgfplots.md section 5.5).
 *
 * Each mutation takes a copy of an oracle as a stand-in for "our output",
 * injects one known renderer bug into the Tier 1 and/or Tier 2 data the way
 * that bug would show up, and records which tier's comparison detects it.
 * The unmutated copy and a sub-tolerance shift must pass.
 */
import { compareTier1, compareTier2, type CompareOptions } from "./compare.js";
import type { Box, NodeGeometry, OracleAxis, PathPrimitive, PathSegment, PgfplotsOracle, Point, Tier1, Tier2 } from "./schema.js";
import { splitSubpaths } from "./compare.js";

export interface ObservedCopy { tier1: Tier1; tier2: Tier2 }

export interface Mutation {
  name: string;
  /** Which tiers are expected to detect it. */
  expected: { tier1: boolean; tier2: boolean };
  /** Returns false when the mutation does not apply to this oracle. */
  apply(copy: ObservedCopy): boolean;
}

export interface MutationRow {
  file: string;
  mutation: string;
  applicable: boolean;
  expected: { tier1: boolean; tier2: boolean };
  detected: { tier1: boolean; tier2: boolean };
  tier1Codes: string[];
  tier2Codes: string[];
  asExpected: boolean;
}

// ---------------------------------------------------------------------------
// Geometry helpers on the neutral structures

function mapPoint(p: Point, f: (p: Point) => Point): Point { return f(p); }

function mapSegments(segments: PathSegment[], f: (p: Point) => Point): PathSegment[] {
  return segments.map((s) => {
    if (s.op === "Z") return s;
    if (s.op === "C") {
      const a = f({ x: s.x1, y: s.y1 }); const b = f({ x: s.x2, y: s.y2 }); const c = f({ x: s.x, y: s.y });
      return { op: "C", x1: a.x, y1: a.y, x2: b.x, y2: b.y, x: c.x, y: c.y };
    }
    const q = f({ x: s.x, y: s.y });
    return { op: s.op, x: q.x, y: q.y };
  });
}

function subpathPoints(sub: PathSegment[]): Point[] {
  return sub.flatMap((s) => (s.op === "Z" ? [] : s.op === "C" ? [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }, { x: s.x, y: s.y }] : [{ x: s.x, y: s.y }]));
}

function inside(p: Point, b: Box, margin = 0): boolean {
  return p.x >= b.minX - margin && p.x <= b.maxX + margin && p.y >= b.minY - margin && p.y <= b.maxY + margin;
}

/** Transform whole subpaths for which `select` holds. */
function transformSubpaths(tier2: Tier2, select: (points: Point[], primitive: PathPrimitive) => boolean, f: (p: Point) => Point): number {
  let changed = 0;
  for (const primitive of tier2.primitives) {
    if (primitive.type !== "path") continue;
    const subs = splitSubpaths(primitive.segments);
    const rebuilt: PathSegment[] = [];
    let touched = false;
    for (const sub of subs) {
      if (select(subpathPoints(sub), primitive)) { rebuilt.push(...mapSegments(sub, f)); touched = true; changed += 1; } else rebuilt.push(...sub);
    }
    if (touched) { primitive.segments = rebuilt; delete primitive.rect; }
  }
  return changed;
}

/** Transform individual path points for which `select` holds (stretches shapes). */
function transformPoints(tier2: Tier2, select: (p: Point) => boolean, f: (p: Point) => Point): number {
  let changed = 0;
  for (const primitive of tier2.primitives) {
    if (primitive.type !== "path") continue;
    primitive.segments = mapSegments(primitive.segments, (p) => { if (select(p)) { changed += 1; return f(p); } return p; });
    if (primitive.clipBox) {
      const b = primitive.clipBox;
      const lo = select({ x: b.minX, y: b.minY }) ? f({ x: b.minX, y: b.minY }) : { x: b.minX, y: b.minY };
      const hi = select({ x: b.maxX, y: b.maxY }) ? f({ x: b.maxX, y: b.maxY }) : { x: b.maxX, y: b.maxY };
      primitive.clipBox = { minX: lo.x, minY: lo.y, maxX: hi.x, maxY: hi.y };
    }
    delete primitive.rect;
  }
  return changed;
}

function transformGlyphs(tier2: Tier2, select: (p: Point) => boolean, f: (p: Point) => Point): number {
  let changed = 0;
  for (const primitive of tier2.primitives) {
    if (primitive.type !== "glyphs") continue;
    primitive.glyphs = primitive.glyphs.map((g) => { if (!select(g)) return g; changed += 1; const q = f(g); return { ...g, x: q.x, y: q.y }; });
  }
  for (const box of tier2.textBoxes) if (select(box.origin)) { box.origin = f(box.origin); changed += 1; }
  return changed;
}

function nodeBox(node: NodeGeometry): Box | undefined {
  const pts = Object.values(node.anchors);
  if (pts.length === 0) return undefined;
  return { minX: Math.min(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxX: Math.max(...pts.map((p) => p.x)), maxY: Math.max(...pts.map((p) => p.y)) };
}

function shiftNode(node: NodeGeometry, dx: number, dy: number): void {
  for (const key of Object.keys(node.anchors)) {
    const p = node.anchors[key];
    if (p) node.anchors[key] = { x: p.x + dx, y: p.y + dy };
  }
}

function firstAxis(copy: ObservedCopy): OracleAxis | undefined { return copy.tier1.axes[0]; }

function rectBox(axis: OracleAxis): Box | undefined {
  if (!axis.rect) return undefined;
  const pts = Object.values(axis.rect);
  return { minX: Math.min(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxX: Math.max(...pts.map((p) => p.x)), maxY: Math.max(...pts.map((p) => p.y)) };
}

// ---------------------------------------------------------------------------
// The mutations

export const MUTATIONS: Mutation[] = [
  {
    name: "identity (control)",
    expected: { tier1: false, tier2: false },
    apply: () => true,
  },
  {
    name: "everything shifted 0.01pt (sub-tolerance control)",
    expected: { tier1: false, tier2: false },
    apply(copy) {
      const f = (p: Point) => ({ x: p.x + 0.01, y: p.y });
      const shift = (record: Record<string, Point> | undefined) => { if (record) for (const k of Object.keys(record)) { const p = record[k]; if (p) record[k] = f(p); } };
      for (const axis of copy.tier1.axes) {
        shift(axis.anchors); shift(axis.rect); shift(axis.limitCorners);
        if (axis.map) axis.map.origin = f(axis.map.origin);
        for (const t of [...(axis.ticks?.x ?? []), ...(axis.ticks?.y ?? [])]) if (t.label) shift(t.label.anchors);
        for (const d of Object.values(axis.descriptions ?? {})) shift(d.anchors);
      }
      if (copy.tier1.boundingBox) { copy.tier1.boundingBox.minX += 0.01; copy.tier1.boundingBox.maxX += 0.01; }
      transformPoints(copy.tier2, () => true, f);
      transformGlyphs(copy.tier2, () => true, f);
      return true;
    },
  },
  {
    name: "x ticks off by one step",
    expected: { tier1: true, tier2: true },
    apply(copy) {
      const axis = firstAxis(copy);
      const ticks = axis?.ticks?.x;
      const box = axis && rectBox(axis);
      if (!axis?.map || !ticks || ticks.length < 2 || !box) return false;
      const step = (ticks[1]?.value ?? 0) - (ticks[0]?.value ?? 0);
      const dx = step * axis.map.xUnit.x; const dy = step * axis.map.xUnit.y;
      // Tier 2 first, while Tier 1 still says where the labels were.
      const labelBoxes = ticks.flatMap((t) => (t.label ? [nodeBox(t.label)] : [])).filter((b): b is Box => !!b);
      const tickX = ticks.map((t) => axis.map ? axis.map.origin.x + t.value * axis.map.xUnit.x : 0);
      // Tick marks: short subpaths at a tick's x position on the bottom/top edge.
      transformSubpaths(copy.tier2, (pts) => {
        const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
        const vertical = Math.max(...xs) - Math.min(...xs) < 1e-6;
        const short = Math.max(...ys) - Math.min(...ys) < 8;
        const onEdge = ys.some((y) => Math.abs(y - box.minY) < 8 || Math.abs(y - box.maxY) < 8);
        const atTick = tickX.some((x) => Math.abs((xs[0] ?? NaN) - x) < 1e-3);
        return vertical && short && onEdge && atTick;
      }, (p) => ({ x: p.x + dx, y: p.y + dy }));
      transformGlyphs(copy.tier2, (p) => labelBoxes.some((b) => inside(p, b, 0.05)), (p) => ({ x: p.x + dx, y: p.y + dy }));
      for (const t of ticks) { t.value += step; if (t.label) shiftNode(t.label, dx, dy); }
      return true;
    },
  },
  {
    name: "dropped plot path",
    expected: { tier1: false, tier2: true },
    apply(copy) {
      const axis = firstAxis(copy);
      const box = axis && rectBox(axis);
      if (!box) return false;
      // The plot line: a clipped stroke with several segments inside the axis rectangle.
      const index = copy.tier2.primitives.findIndex((p) => p.type === "path" && p.operation === "stroke" && p.clipDepth > 0 &&
        p.segments.filter((s) => s.op === "L" || s.op === "C").length >= 3 && subpathPoints(p.segments).every((q) => inside(q, box, 1)));
      if (index < 0) return false;
      copy.tier2.primitives.splice(index, 1);
      return true;
    },
  },
  {
    name: "one plot vertex 0.05pt off",
    expected: { tier1: false, tier2: true },
    apply(copy) {
      const axis = firstAxis(copy);
      const box = axis && rectBox(axis);
      if (!box) return false;
      const plot = copy.tier2.primitives.find((p): p is PathPrimitive => p.type === "path" && p.operation === "stroke" && p.clipDepth > 0 &&
        p.segments.filter((s) => s.op === "L").length >= 3 && subpathPoints(p.segments).every((q) => inside(q, box, 1)));
      const vertex = plot?.segments[2];
      if (!vertex || vertex.op !== "L") return false;
      vertex.y += 0.05;
      return true;
    },
  },
  {
    name: "legend 2pt low",
    expected: { tier1: true, tier2: true },
    apply(copy) {
      const legend = firstAxis(copy)?.descriptions?.legend;
      const box = legend && nodeBox(legend);
      if (!legend || !box) return false;
      const f = (p: Point) => ({ x: p.x, y: p.y - 2 });
      transformSubpaths(copy.tier2, (pts) => pts.every((p) => inside(p, box, 0.5)), f);
      transformGlyphs(copy.tier2, (p) => inside(p, box, 0.05), f);
      shiftNode(legend, 0, -2);
      return true;
    },
  },
  {
    name: "swapped fill colour",
    expected: { tier1: false, tier2: true },
    apply(copy) {
      const fills = copy.tier2.primitives.filter((p): p is PathPrimitive => p.type === "path" && p.operation === "fill" && !!p.paint);
      const first = fills[0];
      if (!first?.paint) return false;
      const other = fills.find((p) => p.paint && JSON.stringify(p.paint.components) !== JSON.stringify(first.paint?.components));
      if (other?.paint) {
        const keep = first.paint;
        first.paint = other.paint; other.paint = keep;
      } else {
        const c = first.paint.components;
        first.paint = { ...first.paint, space: "DeviceRGB", components: c.length === 3 ? [c[2] ?? 0, c[1] ?? 0, c[0] ?? 0] : [1, 0, 0] };
        if (JSON.stringify(first.paint.components) === JSON.stringify(c)) first.paint.components = [1, 0, 1];
      }
      return true;
    },
  },
  {
    name: "tick label string changed",
    expected: { tier1: true, tier2: true },
    apply(copy) {
      const tick = firstAxis(copy)?.ticks?.x.find((t) => t.label?.text);
      const label = tick?.label;
      const box = label && nodeBox(label);
      if (!label?.text || !box) return false;
      const replace = (u: string) => (u === "7" ? "8" : "7");
      label.text = [...label.text].map((c, i) => (i === label.text!.length - 1 ? replace(c) : c)).join("");
      // The last glyph inside the label box changes.
      let last: { run: number; glyph: number; x: number } | undefined;
      copy.tier2.primitives.forEach((p, run) => {
        if (p.type !== "glyphs") return;
        p.glyphs.forEach((g, glyph) => { if (inside(g, box, 0.05) && (!last || g.x > last.x)) last = { run, glyph, x: g.x }; });
      });
      if (last) {
        const run = copy.tier2.primitives[last.run];
        const g = run?.type === "glyphs" ? run.glyphs[last.glyph] : undefined;
        if (run?.type === "glyphs" && g) { g.unicode = replace(g.unicode); run.text = run.glyphs.map((x) => x.unicode).join(""); }
      }
      for (const tb of copy.tier2.textBoxes) if (inside(tb.origin, box, 0.05) && tb.text) tb.text = [...tb.text].map((c, i, a) => (i === a.length - 1 ? replace(c) : c)).join("");
      return true;
    },
  },
  {
    name: "axis box 0.05pt wider",
    expected: { tier1: true, tier2: true },
    apply(copy) {
      const axis = firstAxis(copy);
      const box = axis && rectBox(axis);
      if (!axis || !box) return false;
      const right = box.maxX;
      // PDF path coordinates differ from Tier 1 by up to ~1e-5 relative
      // (PGF's 0.99627 pt->bp factor), so select the edge with 0.01pt slack.
      const select = (p: Point) => Math.abs(p.x - right) < 0.01;
      const f = (p: Point) => (select(p) ? { x: p.x + 0.05, y: p.y } : p);
      const moveAll = (record: Record<string, Point> | undefined) => { if (record) for (const k of Object.keys(record)) { const p = record[k]; if (p) record[k] = mapPoint(p, f); } };
      moveAll(axis.rect); moveAll(axis.anchors); moveAll(axis.limitCorners);
      if (axis.map && axis.limits) axis.map.xUnit = { x: axis.map.xUnit.x * (box.maxX - box.minX + 0.05) / (box.maxX - box.minX), y: axis.map.xUnit.y };
      transformPoints(copy.tier2, select, (p) => ({ x: p.x + 0.05, y: p.y }));
      return true;
    },
  },
];

export function runMutationTest(oracle: PgfplotsOracle, file = oracle.case.name, options: CompareOptions = {}): MutationRow[] {
  return MUTATIONS.map((mutation) => {
    const copy: ObservedCopy = structuredClone({ tier1: oracle.tier1, tier2: oracle.tier2 });
    const applicable = mutation.apply(copy);
    const t1 = compareTier1(oracle.tier1, copy.tier1, options);
    const t2 = compareTier2(oracle.tier2, copy.tier2, options);
    const detected = { tier1: !t1.pass, tier2: !t2.pass };
    return {
      file, mutation: mutation.name, applicable, expected: mutation.expected, detected,
      tier1Codes: [...new Set(t1.findings.map((f) => f.code))],
      tier2Codes: [...new Set(t2.findings.map((f) => f.code))],
      asExpected: !applicable || (detected.tier1 === mutation.expected.tier1 && detected.tier2 === mutation.expected.tier2),
    };
  });
}

export function formatMutationTable(rows: MutationRow[]): string {
  const yn = (b: boolean) => (b ? "yes" : "no");
  const lines = ["fixture | mutation | expected T1/T2 | detected T1/T2 | ok | T1 codes | T2 codes", "---|---|---|---|---|---|---"];
  for (const r of rows) {
    const name = r.file.replace(/^.*\//u, "").replace(/\.oracle\.json$/u, "");
    if (!r.applicable) { lines.push(`${name} | ${r.mutation} | n/a | n/a | - | | `); continue; }
    lines.push(`${name} | ${r.mutation} | ${yn(r.expected.tier1)}/${yn(r.expected.tier2)} | ${yn(r.detected.tier1)}/${yn(r.detected.tier2)} | ${r.asExpected ? "ok" : "MISMATCH"} | ${r.tier1Codes.join(",")} | ${r.tier2Codes.join(",")}`);
  }
  return lines.join("\n");
}
