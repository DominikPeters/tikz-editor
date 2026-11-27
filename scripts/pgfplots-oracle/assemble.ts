/**
 * Turn the raw outputs of one batched TeX run (probe records, LuaTeX text-box
 * walk, mutool trace) into per-case Tier 1 / Tier 2 data.
 */
import type { Box, GlyphRun, NodeGeometry, OracleAxis, OracleTick, Point, TextBox, Tier1, Tier2 } from "./schema.js";
import { pagePrimitives, type MutoolPage } from "./mutool-trace.js";

const SP_PER_PT = 65536;

export interface ProbeRecord { caseId: string; fields: string[] }

export function parseProbeRecords(tsv: string): ProbeRecord[] {
  return tsv.split(/\r?\n/u).filter(Boolean).map((line) => {
    const [caseId = "", ...fields] = line.split("|");
    return { caseId, fields };
  });
}

export interface RawTextBox {
  page: number; tag: number; nesting: number;
  /** Page frame, sp, y down. */
  x: number; y: number;
  a: number; b: number; c: number; d: number;
  width: number; height: number; depth: number;
  glyphs: { code: number; font: string }[];
}

export interface RawTextBoxPage { page: number; boxes: RawTextBox[]; unreadableLiterals: number; openScopes: number }

export function parseTextBoxTrace(tsv: string): RawTextBoxPage[] {
  const pages = new Map<number, RawTextBoxPage>();
  for (const line of tsv.split(/\r?\n/u)) {
    if (!line) continue;
    const f = line.split("\t");
    const page = Number(f[1]);
    if (f[0] === "PAGE") pages.set(page, { page, boxes: [], unreadableLiterals: 0, openScopes: 0 });
    const entry = pages.get(page);
    if (!entry) continue;
    if (f[0] === "ENDPAGE") { entry.unreadableLiterals = Number(f[2]); entry.openScopes = Number(f[3]); }
    if (f[0] === "TEXTBOX") {
      entry.boxes.push({
        page, tag: Number(f[2]), nesting: Number(f[3]), x: Number(f[4]), y: Number(f[5]),
        a: Number(f[6]), b: Number(f[7]), c: Number(f[8]), d: Number(f[9]),
        width: Number(f[10]), height: Number(f[11]), depth: Number(f[12]),
        glyphs: (f[13] ?? "").split(" ").filter(Boolean).map((g) => {
          const at = g.indexOf("@");
          return { code: Number(g.slice(0, at)), font: g.slice(at + 1) };
        }),
      });
    }
  }
  return [...pages.values()].sort((p, q) => p.page - q.page);
}

function pt(value: string | undefined): number {
  const n = Number.parseFloat((value ?? "").replace(/pt$/u, ""));
  if (!Number.isFinite(n)) throw new Error(`Bad TeX dimension ${value}`);
  return n;
}

export interface CaseVersions { pgf: string; pgfplots: string }

export function versionsFrom(records: ProbeRecord[]): CaseVersions {
  const v = records.find((r) => r.fields[0] === "VERSION");
  const get = (key: string) => v?.fields.find((f) => f.startsWith(`${key}=`))?.slice(key.length + 1) ?? "unknown";
  return { pgf: get("pgf"), pgfplots: get("pgfplots") };
}

export interface CasePageSize { width: number; height: number; depth: number }

/** Build Tier 1 from one case's probe records. */
export function assembleTier1(records: ProbeRecord[]): { tier1: Tier1; page?: CasePageSize } {
  const axes = new Map<string, OracleAxis>();
  const tickValues = new Map<string, Map<string, OracleTick>>();
  const nodeAnchors = new Map<string, Record<string, Point>>();
  let current: OracleAxis | undefined;
  let page: CasePageSize | undefined;
  const bbox: Record<string, Point> = {};
  const caseId = records[0]?.caseId ?? "";
  const axisOf = (id: string) => {
    let axis = axes.get(id);
    if (!axis) { axis = { id }; axes.set(id, axis); }
    return axis;
  };
  for (const { fields } of records) {
    const [kind] = fields;
    if (kind === "AXIS") current = axisOf(fields[1] ?? "?");
    else if (kind === "MODE") {
      const axis = axisOf(fields[1] ?? "?");
      const mode = (v: string | undefined) => (v === "log" ? "log" : "linear");
      axis.scale = { x: mode(fields[2]), y: mode(fields[3]) };
    }
    else if (kind === "PAGE") page = { width: pt(fields[1]), height: pt(fields[2]), depth: pt(fields[3]) };
    else if (kind === "LIMITS") {
      const axis = axisOf(fields[1] ?? "?");
      const [xmin = "", xmax = "", ymin = "", ymax = ""] = fields.slice(2);
      axis.limitsRaw = { xmin, xmax, ymin, ymax };
      axis.limits = { xmin: Number(xmin), xmax: Number(xmax), ymin: Number(ymin), ymax: Number(ymax) };
    } else if (kind === "TICK") {
      const [, axisId = "?", letter = "?", index = "", value = ""] = fields;
      const key = `${axisId}|${letter}`;
      let ticks = tickValues.get(key);
      if (!ticks) { ticks = new Map(); tickValues.set(key, ticks); }
      const previous = ticks.get(index);
      if (previous && previous.valueRaw !== value) throw new Error(`${caseId}: tick ${key}#${index} reported twice with different values (${previous.valueRaw}, ${value}).`);
      ticks.set(index, { index: Number(index), value: Number(value), valueRaw: value });
    } else if (kind === "A") {
      const [, group = "", node = "", anchor = "", x, y] = fields;
      const point = { x: pt(x), y: pt(y) };
      if (group === "axis" && current) (current.anchors ??= {})[anchor] = point;
      else if (group === "bbox") bbox[anchor] = point;
      else { const anchors = nodeAnchors.get(node) ?? {}; anchors[anchor] = point; nodeAnchors.set(node, anchors); }
    }
  }
  for (const axis of axes.values()) {
    // Node names carry the case id: PGF node names are global, so without it
    // a later case would read an earlier case's same-named node.
    const named = (suffix: string) => nodeAnchors.get(`pgfplotsoracle-${caseId}-${axis.id}-${suffix}`);
    const corner = (suffix: string) => named(suffix)?.center;
    const r00 = corner("r00"); const r10 = corner("r10"); const r01 = corner("r01"); const r11 = corner("r11");
    if (r00 && r10 && r01 && r11) axis.rect = { r00, r10, r01, r11 };
    const d00 = corner("d00"); const d10 = corner("d10"); const d01 = corner("d01");
    const logAxis = axis.scale !== undefined && (axis.scale.x === "log" || axis.scale.y === "log");
    if (logAxis && axis.rect && axis.limits) {
      // The axis cs probe takes data values, but the limits of a log direction
      // are logarithms: the map (in internal coordinates) comes from the
      // rectangle and the limits instead, and the limit corners are its images.
      const { xmin, xmax, ymin, ymax } = axis.limits;
      const { r00: o0, r10: ox, r01: oy } = axis.rect;
      const xUnit = { x: (ox.x - o0.x) / (xmax - xmin), y: (ox.y - o0.y) / (xmax - xmin) };
      const yUnit = { x: (oy.x - o0.x) / (ymax - ymin), y: (oy.y - o0.y) / (ymax - ymin) };
      axis.map = { origin: { x: o0.x - xmin * xUnit.x - ymin * yUnit.x, y: o0.y - xmin * xUnit.y - ymin * yUnit.y }, xUnit, yUnit };
      axis.limitCorners = { d00: { ...o0 }, d10: { ...ox }, d01: { ...oy } };
    } else if (d00 && d10 && d01) {
      axis.limitCorners = { d00, d10, d01 };
      if (axis.limits) {
        const { xmin, xmax, ymin, ymax } = axis.limits;
        const xUnit = { x: (d10.x - d00.x) / (xmax - xmin), y: (d10.y - d00.y) / (xmax - xmin) };
        const yUnit = { x: (d01.x - d00.x) / (ymax - ymin), y: (d01.y - d00.y) / (ymax - ymin) };
        axis.map = { origin: { x: d00.x - xmin * xUnit.x - ymin * yUnit.x, y: d00.y - xmin * xUnit.y - ymin * yUnit.y }, xUnit, yUnit };
      }
    }
    for (const [letter, probeLetter] of [["x", "x"], ["y", "y"], ["xExtra", "xe"], ["yExtra", "ye"]] as const) {
      const ticks = tickValues.get(`${axis.id}|${probeLetter}`);
      if (!ticks) continue;
      axis.ticks ??= { x: [], y: [] };
      const list = (axis.ticks[letter] ??= []);
      for (const tick of [...ticks.values()].sort((a, b) => a.index - b.index)) {
        const anchors = named(`${probeLetter}${tick.index}`);
        if (anchors) tick.label = { anchors };
        list.push(tick);
      }
    }
    for (const kind of ["title", "xlabel", "ylabel", "legend"] as const) {
      const anchors = named(kind);
      if (anchors) (axis.descriptions ??= {})[kind] = { anchors };
    }
    for (let row = 1; row <= 16; row += 1) for (let column = 1; column <= 16; column += 1) {
      const anchors = named(`legend-${String(row)}-${String(column)}`);
      if (anchors) (axis.legendEntries ??= []).push({ row, column, node: { anchors } });
    }
  }
  const tier1: Tier1 = { axes: [...axes.values()] };
  if (bbox["south west"] && bbox["north east"]) {
    tier1.boundingBox = { minX: bbox["south west"].x, minY: bbox["south west"].y, maxX: bbox["north east"].x, maxY: bbox["north east"].y };
  }
  return page ? { tier1, page } : { tier1 };
}

function insideQuad(p: Point, quad: Point[], epsilon: number): boolean {
  // Convex quad, either orientation.
  let sign = 0;
  for (let i = 0; i < quad.length; i += 1) {
    const a = quad[i]; const b = quad[(i + 1) % quad.length];
    if (!a || !b) return false;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const distance = cross / length;
    if (Math.abs(distance) <= epsilon) continue;
    const s = Math.sign(distance);
    if (sign === 0) sign = s; else if (s !== sign) return false;
  }
  return true;
}

function nodeQuad(node: NodeGeometry): Point[] | undefined {
  const a = node.anchors;
  const q = [a["south west"], a["south east"], a["north east"], a["north west"]];
  return q.every((p): p is Point => p !== undefined) ? q : undefined;
}

function textBoxQuad(box: TextBox): Point[] {
  const at = (u: number, v: number) => ({ x: box.origin.x + u * box.xAxis.x + v * box.yAxis.x, y: box.origin.y + u * box.xAxis.y + v * box.yAxis.y });
  return [at(0, -box.depth), at(box.width, -box.depth), at(box.width, box.height), at(0, box.height)];
}

interface PlacedGlyph { unicode: string; x: number; y: number; order: number; probes: Point[] }

/**
 * Each glyph is represented by three probe points of its approximate ink
 * box: the origin, the end of its advance, and a point 0.6 em above the
 * origin. A glyph belongs to a box only if all three lie inside, which keeps
 * the corner of a neighbouring label (whose origin may sit inside this box's
 * inner sep) out.
 */
function glyphsOf(runs: GlyphRun[]): PlacedGlyph[] {
  return runs.flatMap((run) => run.glyphs.map((g) => {
    const d = run.direction; const up = { x: -d.y, y: d.x };
    const probes = [
      { x: g.x, y: g.y },
      { x: g.x + g.advance * d.x, y: g.y + g.advance * d.y },
      { x: g.x + 0.6 * run.size * up.x, y: g.y + 0.6 * run.size * up.y },
    ];
    return { unicode: g.unicode, x: g.x, y: g.y, order: run.order, probes };
  }));
}

function glyphInside(g: PlacedGlyph, quad: Point[]): boolean {
  return g.probes.every((p) => insideQuad(p, quad, 0.05));
}

/**
 * Text boxes are tight (no inner sep), so the 0.6 em probe would leave out
 * glyphs of a box shorter than that (x-height text, `text depth` legend
 * entries: harness v3); the baseline probes decide, and the innermost
 * containing box wins.
 */
function glyphInBox(g: PlacedGlyph, quad: Point[]): boolean {
  return g.probes.slice(0, 2).every((p) => insideQuad(p, quad, 0.05));
}

function textIn(glyphs: PlacedGlyph[], quad: Point[]): string {
  return glyphs.filter((g) => glyphInside(g, quad)).sort((a, b) => a.order - b.order || a.x - b.x).map((g) => g.unicode).join("");
}

/** Build Tier 2 for one page and attach glyph text to Tier 1 node geometry. */
export function assembleTier2(page: MutoolPage, tier1: Tier1, rawBoxes: RawTextBox[]): Tier2 {
  const box: Box = tier1.boundingBox ?? { minX: 0, minY: -page.height, maxX: page.width, maxY: 0 };
  const primitives = pagePrimitives(page, { minX: box.minX, maxY: box.maxY });
  const glyphs = glyphsOf(primitives.filter((p): p is GlyphRun => p.type === "glyphs"));
  // Tags are renumbered per page (walk order) so a fixture does not depend
  // on which other cases shared its batch.
  const textBoxes: TextBox[] = rawBoxes.map((raw, index) => ({
    type: "textbox",
    tag: index + 1,
    nesting: raw.nesting,
    origin: { x: raw.x / SP_PER_PT + box.minX, y: box.maxY - raw.y / SP_PER_PT },
    // Page walk matrices are y-down; flip both axes' y components.
    xAxis: { x: raw.a, y: -raw.b },
    yAxis: { x: -raw.c, y: raw.d },
    width: raw.width / SP_PER_PT,
    height: raw.height / SP_PER_PT,
    depth: raw.depth / SP_PER_PT,
    glyphs: raw.glyphs,
    text: "",
  }));
  // Assign each glyph to the innermost text box containing it.
  const quads = textBoxes.map(textBoxQuad);
  const assigned = new Map<number, PlacedGlyph[]>();
  for (const glyph of glyphs) {
    let best = -1;
    for (let i = 0; i < textBoxes.length; i += 1) {
      const candidate = textBoxes[i]; const quad = quads[i];
      if (!candidate || !quad || !glyphInBox(glyph, quad)) continue;
      if (best < 0 || candidate.nesting > (textBoxes[best]?.nesting ?? -1)) best = i;
    }
    if (best >= 0) assigned.set(best, [...(assigned.get(best) ?? []), glyph]);
  }
  textBoxes.forEach((tb, i) => {
    tb.text = (assigned.get(i) ?? []).sort((a, b) => a.order - b.order || a.x - b.x).map((g) => g.unicode).join("");
  });
  for (const axis of tier1.axes) {
    const nodes: NodeGeometry[] = [
      ...Object.values(axis.descriptions ?? {}),
      ...(axis.ticks?.x ?? []).flatMap((t) => (t.label ? [t.label] : [])),
      ...(axis.ticks?.y ?? []).flatMap((t) => (t.label ? [t.label] : [])),
      ...(axis.ticks?.xExtra ?? []).flatMap((t) => (t.label ? [t.label] : [])),
      ...(axis.ticks?.yExtra ?? []).flatMap((t) => (t.label ? [t.label] : [])),
    ];
    for (const node of nodes) {
      const quad = nodeQuad(node);
      if (quad) node.text = textIn(glyphs, quad);
    }
  }
  return { page: { width: page.width, height: page.height }, primitives, textBoxes };
}
