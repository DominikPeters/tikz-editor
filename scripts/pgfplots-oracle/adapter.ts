/**
 * Adapter from the editor's evaluated scene (and the axis evaluations the
 * pgfplots evaluator records) to the oracle's neutral Tier 1 / Tier 2
 * structures (schema.ts), so `compare.ts` can check our output against
 * the saved LuaLaTeX oracles.
 *
 * Coordinates: our scene is already in pt, y up, picture origin — the
 * oracle frame. Text: glyph origins come from the TeX layout payload of each
 * text element (`data-tex-font`/`data-tex-glyph` uses with their nested
 * transforms); text boxes from the node geometry the evaluator probed (axis
 * labels) or from the text element and the engine's metrics.
 */
import { renderTikzToSvgAsync, type RenderTikzOptions } from "../../packages/core/src/render/index.js";
import { renderPathWithArrows } from "../../packages/core/src/svg/arrows/render.js";
import { getAxisEvaluations, type AxisEvaluation } from "../../packages/core/src/pgfplots/evaluate-axis.js";
import { normalizeColor } from "../../packages/core/src/semantic/style/colors.js";
import type { ResolvedStyle, SceneClipPath, SceneElement, ScenePathCommand, SceneText } from "../../packages/core/src/semantic/types.js";
import { applyMatrix } from "../../packages/core/src/semantic/transform.js";
import { createTexNodeTextEngine } from "../../packages/core/src/text/tex-node-text-engine.js";
import type { NodeTextEngine } from "../../packages/core/src/text/types.js";
import { hexToRgb } from "../../packages/core/src/utils/color-convert.js";
import type { Box, GlyphRun, NodeGeometry, OracleAxis, OracleTick, Paint, PathPrimitive, PathSegment, Point, TextBox, Tier1, Tier2, Tier2Primitive } from "./schema.js";

/** The harness preamble's `compat` (README "Fixture format"), as our evaluator reads it. */
export const ORACLE_PREAMBLE = "\\pgfplotsset{compat=1.18}\n";

let sharedEngine: NodeTextEngine | null = null;
async function engine(): Promise<NodeTextEngine> {
  sharedEngine ??= await createTexNodeTextEngine();
  return sharedEngine;
}

export type AdaptedPicture = {
  tier1: Tier1;
  tier2: Tier2;
  diagnostics: Array<{ code?: string; message: string; severity: string }>;
  svg: string;
  axes: readonly AxisEvaluation[];
};

/** Renders a fixture body with the editor and converts the result. */
export async function renderObservedPicture(body: string): Promise<AdaptedPicture> {
  return renderObservedSource(ORACLE_PREAMBLE + body);
}

/**
 * Renders a complete source (a whole document, as in the corpus) with the
 * editor and converts the result. `options` are passed to the renderer
 * (e.g. a graphics resolver for table files).
 */
export async function renderObservedSource(source: string, options: Omit<RenderTikzOptions, "textEngine" | "parse"> = {}): Promise<AdaptedPicture> {
  const textEngine = await engine();
  const result = await renderTikzToSvgAsync(source, { ...options, textEngine, parse: { includeContextDefinitions: true } });
  const scene = result.semantic.scene;
  const axes = getAxisEvaluations(scene);
  const bounds = scene.bounds;
  const bbox: Box = bounds ? { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const texts = scene.elements.filter((element): element is SceneText => element.kind === "Text").map((element) => textGeometry(element, textEngine));
  const textByElement = new Map(texts.map((t) => [t.element, t]));
  const tier1: Tier1 = { boundingBox: bbox, axes: axes.map((axis, index) => adaptAxis(axis, index, texts)) };
  // Each axis is typeset as a box of its own (LuaTeX sees it at nesting 0), spanning its bounding box (F1),
  // in the axis frame (a picture transformation acts on it as a canvas transformation, behaviour Z1).
  const axisBoxes = axes.map((axis): TextBox => {
    const m = axis.frameTransform;
    const o = applyMatrix(m, { x: axis.layout.bbox.minX, y: axis.layout.bbox.minY } as never);
    return { type: "textbox", tag: 0, nesting: 0, origin: { x: o.x, y: o.y }, xAxis: { x: m.a, y: m.b }, yAxis: { x: m.c, y: m.d }, width: axis.layout.bbox.maxX - axis.layout.bbox.minX, height: axis.layout.bbox.maxY - axis.layout.bbox.minY, depth: 0, glyphs: [], text: "" };
  });
  // Legends: the entry nodes are typeset inside the matrix node's text box (nesting 2), with the
  // box height/depth TikZ gives them (`text depth=0.15em`); the matrix box itself is a nesting-1 box.
  const legendBoxes: TextBox[] = [];
  const boxOverrides = new Map<SceneElement, { nesting: number; height: number; depth: number }>();
  for (const axis of axes) for (const record of axis.labels) {
    if (record.role === "legend" && record.textBox) {
      const tb = record.textBox;
      const m = axis.frameTransform;
      const o = applyMatrix(m, { x: tb.origin.x, y: tb.origin.y } as never);
      legendBoxes.push({ type: "textbox", tag: 0, nesting: 1, origin: { x: o.x, y: o.y }, xAxis: { x: m.a, y: m.b }, yAxis: { x: m.c, y: m.d }, width: tb.width, height: tb.height, depth: tb.depth, glyphs: [], text: "" });
    }
    if (record.role === "legend-entry" && record.probe) {
      const probe = record.probe;
      const origin = canvasPoint(axis, probe.textOrigin);
      const text = texts.find((t) => Math.hypot(t.origin.x - origin.x, t.origin.y - origin.y) < 1e-6);
      if (text) boxOverrides.set(text.element, { nesting: 2, height: probe.textHeight, depth: probe.textDepth });
    }
  }
  const tier2 = adaptTier2(scene.elements, bbox, textByElement, axisBoxes, axes.flatMap((axis) => (axis.clip ? [axis.clip] : [])), legendBoxes, boxOverrides);
  return { tier1, tier2, diagnostics: result.semantic.diagnostics, svg: result.svg.svg, axes };
}

// ---------------------------------------------------------------------------
// Text

type GlyphPosition = { unicode: string; x: number; y: number; font: string; size: number; math: boolean };

type TextGeometry = {
  element: SceneText;
  origin: Point;
  xAxis: Point;
  yAxis: Point;
  width: number;
  height: number;
  depth: number;
  glyphs: GlyphPosition[];
  text: string;
};

const CMSY: Record<number, string> = { 0: "−", 1: "·", 2: "×", 3: "∗", 6: "±", 20: "≤", 21: "≥", 33: "→", 48: "′", 49: "∞", 106: "|", 107: "∥" };
const CMMI_EXTRA: Record<number, string> = { 58: ".", 59: ",", 60: "<", 61: "/", 62: ">" };
// Greek slots of cmmi (11-39) and cmr (0-10), as the PDF's ToUnicode maps them (compared after NFKC).
const CMMI_GREEK = "αβγδϵζηθικλμνξπρστυϕχψωεϑϖϱςφ";
const CMR_GREEK = "ΓΔΘΛΞΠΣΥΦΨΩ";

function unicodeOf(font: string, code: number): string {
  if (font.startsWith("lm")) return String.fromCodePoint(code).normalize("NFKC");
  if (font.startsWith("cmsy")) return CMSY[code] ?? "\uFFFD";
  if (font.startsWith("cmmi")) return (CMMI_EXTRA[code] ?? (code >= 11 && code <= 39 ? [...CMMI_GREEK][code - 11] : undefined) ?? (code >= 65 && code <= 122 ? String.fromCharCode(code) : "\uFFFD")).normalize("NFKC");
  if (font.startsWith("cmr") && code <= 10) return [...CMR_GREEK][code] ?? "\uFFFD";
  if (code >= 32 && code < 127) return String.fromCharCode(code);
  return "\uFFFD";
}

/** The PDF font names LuaLaTeX writes (subset tag removed). */
function pdfFontName(font: string): string {
  const lm: Record<string, string> = {
    "lmroman10-regular": "LMRoman10-Regular", "lmroman10-bold": "LMRoman10-Bold", "lmroman10-italic": "LMRoman10-Italic",
    "lmroman7-regular": "LMRoman7-Regular", "lmroman5-regular": "LMRoman5-Regular", "lmsans10-regular": "LMSans10-Regular"
  };
  return lm[font] ?? font.toUpperCase();
}

type Affine = { a: number; b: number; c: number; d: number; e: number; f: number };
const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
function compose(m: Affine, n: Affine): Affine {
  return { a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b, c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d, e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f };
}
function parseTransform(attr: string | undefined): Affine {
  if (!attr) return IDENTITY;
  let m = IDENTITY;
  for (const match of attr.matchAll(/(translate|scale)\(([^)]*)\)/gu)) {
    const nums = (match[2] ?? "").trim().split(/[\s,]+/u).map(Number);
    if (match[1] === "translate") m = compose(m, { a: 1, b: 0, c: 0, d: 1, e: nums[0] ?? 0, f: nums[1] ?? 0 });
    else m = compose(m, { a: nums[0] ?? 1, b: 0, c: 0, d: nums[1] ?? nums[0] ?? 1, e: 0, f: 0 });
  }
  return m;
}

/** Glyphs of a TeX payload in payload coordinates (pt, y down from the box top). */
function payloadGlyphs(body: string): Array<{ font: string; code: number; x: number; y: number; size: number; math: boolean }> {
  const out: Array<{ font: string; code: number; x: number; y: number; size: number; math: boolean }> = [];
  const stack: Array<{ m: Affine; math: boolean }> = [{ m: IDENTITY, math: false }];
  for (const tag of body.matchAll(/<(\/?)(g|use|rect)\b([^>]*?)(\/?)>/gu)) {
    const top = stack[stack.length - 1] ?? { m: IDENTITY, math: false };
    const attrs = tag[3] ?? "";
    if (tag[1] === "/") { if (tag[2] === "g") stack.pop(); continue; }
    const transform = /\stransform="([^"]*)"/u.exec(attrs)?.[1];
    const m = compose(top.m, parseTransform(transform));
    if (tag[2] === "g") { stack.push({ m, math: top.math || attrs.includes("data-tex-inline-math") }); continue; }
    if (tag[2] === "use") {
      const font = /data-tex-font="([^"]*)"/u.exec(attrs)?.[1];
      const code = /data-tex-glyph="([^"]*)"/u.exec(attrs)?.[1];
      const size = /data-tex-font-at-pt="([^"]*)"/u.exec(attrs)?.[1];
      if (font && code) out.push({ font, code: Number(code), x: m.e, y: m.f, size: Number(size ?? "10"), math: top.math });
    }
  }
  return out;
}

function textGeometry(element: SceneText, textEngine: NodeTextEngine): TextGeometry {
  const info = element.textRenderInfo;
  const width = element.textBlockWidth ?? 0;
  const blockHeight = element.textBlockHeight ?? 0;
  let baselineY = -blockHeight / 2;
  let glyphsLocal: ReturnType<typeof payloadGlyphs> = [];
  if (info?.mode === "tex") {
    const metrics = textEngine.measure({
      text: info.renderSourceText, textWidthPt: null, fontStyle: element.style.fontStyle, fontWeight: element.style.fontWeight,
      fontFamily: element.style.fontFamily, fontSizePt: element.style.fontSize
    });
    if (metrics) baselineY = metrics.baselineY;
    const payload = textEngine.renderFromCache(info.cacheKey);
    if (payload) glyphsLocal = payloadGlyphs(payload.body);
  }
  const height = blockHeight / 2 - baselineY;
  const depth = blockHeight - height;
  const rot = element.rotation ? (() => { const r = (element.rotation * Math.PI) / 180; return { a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r) }; })() : { a: 1, b: 0, c: 0, d: 1 };
  const m = element.transform ?? { a: 1, b: 0, c: 0, d: 1 };
  // The node's rotation, then its transform.
  const linear = { a: m.a * rot.a + m.c * rot.b, b: m.b * rot.a + m.d * rot.b, c: m.a * rot.c + m.c * rot.d, d: m.b * rot.c + m.d * rot.d };
  // A text element's transform maps the positioned node (TikZ `transform shape`, or an axis' canvas transformation).
  const center = element.transform ? applyMatrix(element.transform, element.position) : element.position;
  const toWorld = (lx: number, ly: number): Point => ({ x: center.x + linear.a * lx + linear.c * ly, y: center.y + linear.b * lx + linear.d * ly });
  const glyphScale = Math.sqrt(Math.abs(linear.a * linear.d - linear.b * linear.c));
  // Payload: x from the block's left, y down from the block's top; the block is centred on the node.
  const glyphs = glyphsLocal.map((g): GlyphPosition => {
    const w = toWorld(g.x - width / 2, blockHeight / 2 - g.y);
    return { unicode: unicodeOf(g.font, g.code), x: w.x, y: w.y, font: pdfFontName(g.font), size: g.size * glyphScale, math: g.math };
  });
  return {
    element,
    origin: toWorld(-width / 2, baselineY),
    xAxis: { x: linear.a, y: linear.b },
    yAxis: { x: linear.c, y: linear.d },
    width, height, depth, glyphs,
    text: glyphs.map((g) => g.unicode).join("")
  };
}

// ---------------------------------------------------------------------------
// Tier 1

/** A label probe point (untransformed axis frame) in the picture: through the axis' canvas transformation, if any (behaviour Z1). */
function canvasPoint(axis: AxisEvaluation, q: { x: number; y: number }): Point {
  if (!axis.canvas) return { x: q.x, y: q.y };
  const r = applyMatrix(axis.canvas, { x: q.x, y: q.y } as never);
  return { x: r.x, y: r.y };
}

const LABEL_ANCHORS = ["center", "north", "south", "east", "west", "north east", "north west", "south east", "south west", "base", "base west", "base east", "mid"];

function adaptAxis(axis: AxisEvaluation, index: number, texts: TextGeometry[]): OracleAxis {
  const { layout, frameTransform } = axis;
  const w = (q: Point): Point => { const r = applyMatrix(frameTransform, { x: q.x, y: q.y } as never); return { x: r.x, y: r.y }; };
  const { x0, y0, x1, y1 } = layout.box;
  const { limits } = layout;
  const map = (x: number, y: number) => w({ x: layout.map.origin.x + x * layout.map.xUnit.x, y: layout.map.origin.y + y * layout.map.yUnit.y });
  const origin = map(0, 0);
  const ex = map(1, 0); const ey = map(0, 1);
  const labelOf = (role: string, position?: number): NodeGeometry | undefined => {
    const record = axis.labels.find((l) => l.role === role && l.tickPosition === position);
    if (!record?.probe) return undefined;
    const probe = record.probe;
    const anchors: Record<string, Point> = {};
    for (const name of LABEL_ANCHORS) anchors[name] = canvasPoint(axis, probe.anchor(name));
    const origin = canvasPoint(axis, probe.textOrigin);
    const text = texts.find((t) => Math.hypot(t.origin.x - origin.x, t.origin.y - origin.y) < 1e-6)?.text;
    return { anchors, ...(text === undefined ? {} : { text }) };
  };
  const ticks = (letter: "x" | "y"): OracleTick[] => {
    const t = layout.ticks[letter];
    return t.major.map((tick, position) => {
      const value = t.scaleExponent === 0 ? tick.value : tick.value / 10 ** t.scaleExponent;
      const label = labelOf(`${letter}tick`, position);
      return { index: tick.index, value, valueRaw: String(value), ...(label ? { label } : {}) };
    });
  };
  const extraTicks = (letter: "x" | "y"): Partial<Record<"xExtra" | "yExtra", OracleTick[]>> => {
    const extra = layout.ticks[letter].extra;
    if (!extra || extra.length === 0) return {};
    return { [`${letter}Extra`]: extra.map((tick, position) => {
      const label = labelOf(`${letter}extra`, position);
      return { index: tick.index, value: tick.value, valueRaw: String(tick.value), ...(label ? { label } : {}) };
    }) };
  };
  const descriptions: OracleAxis["descriptions"] = {};
  for (const kind of ["title", "xlabel", "ylabel"] as const) {
    const label = labelOf(kind);
    if (label) descriptions[kind] = label;
  }
  // The legend matrix node: its text is the glyphs inside it, as the oracle recovers it.
  const legend = labelOf("legend");
  if (legend) {
    const sw = legend.anchors["south west"]; const ne = legend.anchors["north east"];
    const inside = (p: Point) => sw && ne && p.x >= sw.x && p.x <= ne.x && p.y >= sw.y && p.y <= ne.y;
    descriptions.legend = { anchors: legend.anchors, text: texts.filter((t) => inside(t.origin)).map((t) => t.text).join("") };
  }
  const legendEntries = axis.labels.flatMap((record) => {
    if (record.role !== "legend-entry" || !record.probe || !record.cell) return [];
    const probe = record.probe;
    const anchors: Record<string, Point> = {};
    for (const name of LABEL_ANCHORS) anchors[name] = canvasPoint(axis, probe.anchor(name));
    return [{ row: record.cell.row, column: record.cell.column, node: { anchors } }];
  }).sort((a, b) => a.row - b.row || a.column - b.column);
  return {
    id: `a${String(index + 1)}`,
    limits: { ...limits },
    limitsRaw: { xmin: String(limits.xmin), xmax: String(limits.xmax), ymin: String(limits.ymin), ymax: String(limits.ymax) },
    rect: { r00: w({ x: x0, y: y0 }), r10: w({ x: x1, y: y0 }), r01: w({ x: x0, y: y1 }), r11: w({ x: x1, y: y1 }) },
    limitCorners: { d00: map(limits.xmin, limits.ymin), d10: map(limits.xmax, limits.ymin), d01: map(limits.xmin, limits.ymax) },
    map: { origin, xUnit: { x: ex.x - origin.x, y: ex.y - origin.y }, yUnit: { x: ey.x - origin.x, y: ey.y - origin.y } },
    anchors: Object.fromEntries(Object.entries(layout.anchors).map(([k, q]) => [k, w(q)])),
    ticks: { x: ticks("x"), y: ticks("y"), ...extraTicks("x"), ...extraTicks("y") },
    scale: { x: axis.model.x.mode, y: axis.model.y.mode },
    descriptions,
    ...(legendEntries.length > 0 ? { legendEntries } : {})
  };
}

// ---------------------------------------------------------------------------
// Tier 2

function paintOf(color: string | null, alpha: number): Paint | undefined {
  if (!color || color === "none") return undefined;
  const normalized = normalizeColor(color);
  if (!normalized.startsWith("#")) return { space: "DeviceRGB", components: [0, 0, 0], alpha };
  const rgb = hexToRgb(normalized);
  return { space: "DeviceRGB", components: [rgb.r / 255, rgb.g / 255, rgb.b / 255], alpha };
}

/** Maps segments through an element's transform (TikZ `transform shape` paths, an axis' canvas transformation). */
function transformSegments(segments: PathSegment[], m: { a: number; b: number; c: number; d: number; e: number; f: number } | undefined): PathSegment[] {
  if (!m) return segments;
  const f = (x: number, y: number) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
  return segments.map((s): PathSegment => {
    if (s.op === "Z") return s;
    if (s.op === "C") { const a = f(s.x1, s.y1); const b = f(s.x2, s.y2); const c = f(s.x, s.y); return { op: "C", x1: a.x, y1: a.y, x2: b.x, y2: b.y, x: c.x, y: c.y }; }
    const q = f(s.x, s.y);
    return { op: s.op, x: q.x, y: q.y };
  });
}

/** Line widths and dashes scale with the transform's area factor (as a PDF `cm` scales them). */
function scaledStroke(attrs: ReturnType<typeof strokeAttributes>, m: { a: number; b: number; c: number; d: number } | undefined): ReturnType<typeof strokeAttributes> {
  if (!m) return attrs;
  const k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  return { ...attrs, lineWidth: (attrs.lineWidth ?? 0) * k, ...(attrs.dash ? { dash: { array: attrs.dash.array.map((v) => v * k), phase: attrs.dash.phase * k } } : {}) };
}

function commandsToSegments(commands: readonly ScenePathCommand[]): PathSegment[] {
  let current: Point = { x: 0, y: 0 };
  let start: Point = current;
  return commands.flatMap((command): PathSegment[] => {
    switch (command.kind) {
      case "M": current = start = { x: command.to.x, y: command.to.y }; return [{ op: "M", ...current }];
      case "L": current = { x: command.to.x, y: command.to.y }; return [{ op: "L", ...current }];
      case "C": current = { x: command.to.x, y: command.to.y }; return [{ op: "C", x1: command.c1.x, y1: command.c1.y, x2: command.c2.x, y2: command.c2.y, ...current }];
      case "Z": current = start; return [{ op: "Z" }];
      case "A": {
        const segments = arcToCubics(current, command.rx, command.ry, command.xAxisRotation, command.largeArc, command.sweep, { x: command.to.x, y: command.to.y });
        current = { x: command.to.x, y: command.to.y };
        return segments;
      }
    }
  });
}

/** SVG elliptical arc to cubics, split in pieces of at most 90 degrees (as PGF builds arcs from quarters). */
function arcToCubics(p0: Point, rxIn: number, ryIn: number, rotationDeg: number, largeArc: boolean, sweep: boolean, p1: Point): PathSegment[] {
  let rx = Math.abs(rxIn); let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [{ op: "L", x: p1.x, y: p1.y }];
  const phi = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi); const sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2; const dy = (p0.y - p1.y) / 2;
  const x1p = cos * dx + sin * dy; const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry; const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (p0.x + p1.x) / 2; const cy = sin * cxp + cos * cyp + (p0.y + p1.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / pieces;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (t: number) => ({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos });
  const deriv = (t: number) => ({ x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos });
  const out: PathSegment[] = [];
  for (let i = 0; i < pieces; i += 1) {
    const a = theta1 + i * step; const b = a + step;
    const pa = point(a); const pb = i === pieces - 1 ? p1 : point(b); const da = deriv(a); const db = deriv(b);
    out.push({ op: "C", x1: pa.x + k * da.x, y1: pa.y + k * da.y, x2: pb.x - k * db.x, y2: pb.y - k * db.y, x: pb.x, y: pb.y });
  }
  return out;
}

/** PGF's `\pgfpathellipse`: four quarter Béziers (0.55228475) from angle 0, counterclockwise, closed. */
function ellipseSegments(center: Point, rx: number, ry: number, rotationDeg: number, transform?: { a: number; b: number; c: number; d: number; e: number; f: number }): PathSegment[] {
  const k = 0.55228475;
  const r = (rotationDeg * Math.PI) / 180;
  const ux = { x: rx * Math.cos(r), y: rx * Math.sin(r) };
  const uy = { x: -ry * Math.sin(r), y: ry * Math.cos(r) };
  const at = (a: number, b: number): Point => {
    const local = { x: center.x + a * ux.x + b * uy.x, y: center.y + a * ux.y + b * uy.y };
    return transform ? { x: transform.a * local.x + transform.c * local.y + transform.e, y: transform.b * local.x + transform.d * local.y + transform.f } : local;
  };
  const quarter = (a0: number, b0: number, a1: number, b1: number): PathSegment => {
    const c1 = at(a0 - k * b0, b0 + k * a0); const c2 = at(a1 + k * b1, b1 - k * a1); const end = at(a1, b1);
    return { op: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: end.x, y: end.y };
  };
  const start = at(1, 0);
  return [{ op: "M", x: start.x, y: start.y }, quarter(1, 0, 0, 1), quarter(0, 1, -1, 0), quarter(-1, 0, 0, -1), quarter(0, -1, 1, 0), { op: "Z" }];
}

function boundsOf(segments: readonly PathSegment[]): Box | null {
  let box: Box | null = null;
  for (const s of segments) {
    if (s.op === "Z") continue;
    const pts = s.op === "C" ? [[s.x1, s.y1], [s.x2, s.y2], [s.x, s.y]] : [[s.x, s.y]];
    for (const [x = 0, y = 0] of pts) box = box ? { minX: Math.min(box.minX, x), minY: Math.min(box.minY, y), maxX: Math.max(box.maxX, x), maxY: Math.max(box.maxY, y) } : { minX: x, minY: y, maxX: x, maxY: y };
  }
  return box;
}

function intersect(a: Box | undefined, b: Box): Box {
  if (!a) return b;
  return { minX: Math.max(a.minX, b.minX), minY: Math.max(a.minY, b.minY), maxX: Math.min(a.maxX, b.maxX), maxY: Math.min(a.maxY, b.maxY) };
}

function strokeAttributes(style: ResolvedStyle): Pick<PathPrimitive, "lineWidth" | "dash" | "lineCap" | "lineJoin" | "miterLimit"> {
  return {
    lineWidth: style.lineWidth,
    ...(style.dashArray && style.dashArray.length > 0 ? { dash: { array: [...style.dashArray], phase: style.dashOffset } } : {}),
    lineCap: style.lineCap === "butt" ? 0 : style.lineCap === "round" ? 1 : 2,
    lineJoin: style.lineJoin === "miter" ? 0 : style.lineJoin === "round" ? 1 : 2,
    miterLimit: 10
  };
}

function adaptTier2(elements: readonly SceneElement[], bbox: Box, texts: Map<SceneElement, TextGeometry>, axisBoxes: readonly TextBox[], axisClips: readonly SceneClipPath[], extraBoxes: readonly TextBox[] = [], boxOverrides: ReadonlyMap<SceneElement, { nesting: number; height: number; depth: number }> = new Map()): Tier2 {
  const primitives: Tier2Primitive[] = [];
  // Each axis is typeset as a box of its own (LuaTeX sees it at nesting 0), spanning its bounding box (F1).
  const textBoxes: TextBox[] = axisBoxes.map((box, index): TextBox => ({ ...box, tag: index + 1 }));
  let activeClips: readonly SceneClipPath[] = [];
  const seenClips = new Set<string>();
  let clipBox: Box | undefined;
  const order = () => primitives.length;
  const syncClip = (chain: readonly SceneClipPath[]) => {
    const same = chain.length >= activeClips.length && activeClips.every((clip, i) => chain[i]?.id === clip.id);
    if (!same) { activeClips = []; clipBox = undefined; }
    for (const clip of chain.slice(activeClips.length)) {
      const segments = commandsToSegments(clip.commands);
      const box = boundsOf(segments);
      primitives.push({ type: "path", order: order(), operation: "clip", fillRule: clip.fillRule, segments, clipDepth: activeClips.length, ...(clipBox ? { clipBox } : {}) });
      activeClips = [...activeClips, clip];
      seenClips.add(clip.id);
      if (box) clipBox = intersect(clipBox, box);
    }
  };
  for (const element of elements) {
    if (element.overlayCovered) continue;
    syncClip(element.clipChain ?? []);
    const clipState = { clipDepth: activeClips.length, ...(clipBox ? { clipBox } : {}) };
    if (element.kind === "Path" && (element.style.markerStart || element.style.markerEnd)) {
      // Arrow tips are built at SVG emission: the shaft is shortened and each
      // tip is its own painted path, as PGF paints them (stroke, then the tip).
      const rendered = renderPathWithArrows(element);
      const shaft = transformSegments(commandsToSegments(rendered.shaftCommands), element.transform);
      const stroke = element.style.stroke && element.style.stroke !== "none" ? paintOf(element.style.stroke, element.style.strokeOpacity) : undefined;
      if (stroke && shaft.length > 0) primitives.push({ type: "path", order: order(), operation: "stroke", segments: shaft, paint: stroke, ...scaledStroke(strokeAttributes(element.style), element.transform), ...clipState });
      for (const tip of rendered.tipPaths) {
        const segments = transformSegments(commandsToSegments(tip.commands), element.transform);
        const fill = tip.fill && tip.fill !== "none" ? paintOf(tip.fill, element.style.strokeOpacity) : undefined;
        const tipStroke = tip.stroke && tip.stroke !== "none" && tip.strokeWidth > 0 ? paintOf(tip.stroke, element.style.strokeOpacity) : undefined;
        if (fill) primitives.push({ type: "path", order: order(), operation: "fill", fillRule: "nonzero", segments, paint: fill, ...clipState });
        if (tipStroke) primitives.push({ type: "path", order: order(), operation: "stroke", segments, paint: tipStroke, ...scaledStroke(strokeAttributes({ ...element.style, lineWidth: tip.strokeWidth, lineCap: tip.lineCap, lineJoin: tip.lineJoin, dashArray: null }), element.transform), ...clipState });
      }
      continue;
    }
    if (element.kind === "Path" || element.kind === "Circle" || element.kind === "Ellipse") {
      const segments = element.kind === "Path" ? transformSegments(commandsToSegments(element.commands), element.transform)
        : ellipseSegments(element.center, element.kind === "Circle" ? element.radius : element.rx, element.kind === "Circle" ? element.radius : element.ry, element.kind === "Ellipse" ? element.rotation ?? 0 : 0, element.transform);
      if (segments.length === 0) continue;
      const fill = paintOf(element.style.fill, element.style.fillOpacity);
      const stroke = element.style.stroke && element.style.stroke !== "none" ? paintOf(element.style.stroke, element.style.strokeOpacity) : undefined;
      if (fill) primitives.push({ type: "path", order: order(), operation: "fill", fillRule: element.style.fillRule, segments, paint: fill, ...clipState });
      if (stroke) primitives.push({ type: "path", order: order(), operation: "stroke", segments, paint: stroke, ...scaledStroke(strokeAttributes(element.style), element.transform), ...clipState });
    } else if (element.kind === "Text") {
      const geometry = texts.get(element);
      if (!geometry) continue;
      const paint = paintOf(element.style.textColor ?? "black", element.style.textOpacity) ?? { space: "DeviceRGB", components: [0, 0, 0], alpha: 1 };
      // Consecutive glyphs of one font form a run, as in the PDF.
      const runs: GlyphPosition[][] = [];
      for (const g of geometry.glyphs) {
        const last = runs[runs.length - 1];
        const previous = last?.[last.length - 1];
        if (last && previous && previous.font === g.font && previous.size === g.size) last.push(g);
        else runs.push([g]);
      }
      for (const glyphs of runs) {
        const first = glyphs[0];
        if (!first) continue;
        const run: GlyphRun = {
          type: "glyphs", order: order(), font: first.font, size: first.size, paint, direction: geometry.xAxis,
          glyphs: glyphs.map((g) => ({ unicode: g.unicode, x: g.x, y: g.y, advance: 0 })), text: glyphs.map((g) => g.unicode).join(""), ...clipState
        };
        primitives.push(run);
      }
      const override = boxOverrides.get(element);
      textBoxes.push({
        type: "textbox", tag: textBoxes.length + 1, nesting: override?.nesting ?? 1, origin: geometry.origin, xAxis: geometry.xAxis, yAxis: geometry.yAxis,
        width: geometry.width, height: override?.height ?? geometry.height, depth: override?.depth ?? geometry.depth, glyphs: [], text: geometry.text
      });
    }
  }
  // pgfplots installs the axis clip even when nothing is drawn under it.
  for (const clip of axisClips) {
    if (seenClips.has(clip.id)) continue;
    const segments = commandsToSegments(clip.commands);
    primitives.push({ type: "path", order: order(), operation: "clip", fillRule: clip.fillRule, segments, clipDepth: 0 });
  }
  for (const box of extraBoxes) textBoxes.push({ ...box, tag: textBoxes.length + 1 });
  return { page: { width: bbox.maxX - bbox.minX, height: bbox.maxY - bbox.minY }, primitives, textBoxes };
}
