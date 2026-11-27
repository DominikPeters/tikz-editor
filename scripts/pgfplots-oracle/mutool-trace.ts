/**
 * Tier 2 primitive trace from the final PDF, via `mutool trace`.
 *
 * MuPDF interprets the page content stream and reports every device call
 * (fill/stroke/clip path, text, image, shading, transparency group) with the
 * full current transformation matrix and the resolved graphics state (line
 * width, dash, caps, joins, colour, alpha from ExtGState). This sees every
 * painted mark regardless of who emitted it (PGF, pgfplots, TeX rules,
 * fonts), needs no TeX-side hooks, and works identically for LuaLaTeX and
 * pdfLaTeX PDFs.
 *
 * Device space of `mutool trace` is PDF user space with the y axis flipped
 * at the media box top, in big points. We convert to TeX points and then to
 * picture coordinates (see schema.ts).
 */
import type { Box, GlyphRun, OtherPrimitive, Paint, PathPrimitive, PathSegment, Point, Tier2Primitive } from "./schema.js";

export const BP_TO_PT = 72.27 / 72;

type Matrix = [number, number, number, number, number, number];

interface XmlTag { name: string; attrs: Record<string, string>; close: boolean; selfClose: boolean }

function* tokenize(xml: string): Generator<XmlTag> {
  const tagPattern = /<(\/?)([A-Za-z_]+)((?:\s+[A-Za-z_:][A-Za-z0-9_:]*="[^"]*")*)\s*(\/?)>/gu;
  for (const match of xml.matchAll(tagPattern)) {
    const attrs: Record<string, string> = {};
    for (const attr of (match[3] ?? "").matchAll(/([A-Za-z_:][A-Za-z0-9_:]*)="([^"]*)"/gu)) {
      attrs[attr[1] ?? ""] = decodeEntities(attr[2] ?? "");
    }
    yield { name: match[2] ?? "", attrs, close: match[1] === "/", selfClose: match[4] === "/" };
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/gu, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/gu, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", "\"").replaceAll("&apos;", "'").replaceAll("&amp;", "&");
}

function numbers(text: string | undefined): number[] {
  if (!text) return [];
  return text.split(/[\s,]+/u).filter(Boolean).map(Number);
}

function matrix(text: string | undefined): Matrix {
  const m = numbers(text);
  return m.length === 6 ? (m as Matrix) : [1, 0, 0, 1, 0, 0];
}

function apply(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Page frame (bp, y-down) -> picture frame (pt, y-up). */
export interface FrameConversion { minX: number; maxY: number }

function toPicture(p: Point, frame: FrameConversion): Point {
  return { x: p.x * BP_TO_PT + frame.minX, y: frame.maxY - p.y * BP_TO_PT };
}

function boundsOf(pointsList: Point[]): Box | undefined {
  if (pointsList.length === 0) return undefined;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of pointsList) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function intersect(a: Box | undefined, b: Box | undefined): Box | undefined {
  if (!a) return b;
  if (!b) return a;
  const result = { minX: Math.max(a.minX, b.minX), minY: Math.max(a.minY, b.minY), maxX: Math.min(a.maxX, b.maxX), maxY: Math.min(a.maxY, b.maxY) };
  if (result.minX > result.maxX) result.maxX = result.minX;
  if (result.minY > result.maxY) result.maxY = result.minY;
  return result;
}

export function segmentPoints(segments: PathSegment[]): Point[] {
  const result: Point[] = [];
  for (const s of segments) {
    if (s.op === "M" || s.op === "L") result.push({ x: s.x, y: s.y });
    else if (s.op === "C") result.push({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }, { x: s.x, y: s.y });
  }
  return result;
}

/** Detect `x y w h re`-like closed axis-aligned rectangles. */
export function rectangleOf(segments: PathSegment[]): Box | undefined {
  const ops = segments.map((s) => s.op).join("");
  if (ops !== "MLLLZ" && ops !== "MLLLLZ" && ops !== "MLLLL") return undefined;
  const pts = segmentPoints(segments);
  if (ops === "MLLLL" || ops === "MLLLLZ") {
    const first = pts[0]; const last = pts[4];
    if (!first || !last || Math.abs(first.x - last.x) > 1e-6 || Math.abs(first.y - last.y) > 1e-6) return undefined;
  }
  const corners = pts.slice(0, 4);
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i]; const b = corners[(i + 1) % 4];
    if (!a || !b) return undefined;
    if (Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6) return undefined;
  }
  return boundsOf(corners);
}

export interface MutoolPage {
  number: number;
  /** Media box size in pt. */
  width: number;
  height: number;
  /** Raw device-space trace items; convert with `pagePrimitives`. */
  xml: string;
}

/** Split `mutool trace` output into pages. */
export function splitMutoolTrace(xml: string): MutoolPage[] {
  const pages: MutoolPage[] = [];
  const pagePattern = /<page number="(\d+)" mediabox="([^"]*)"[^>]*>([\s\S]*?)<\/page>/gu;
  for (const match of xml.matchAll(pagePattern)) {
    const box = numbers(match[2]);
    pages.push({
      number: Number(match[1]),
      width: ((box[2] ?? 0) - (box[0] ?? 0)) * BP_TO_PT,
      height: ((box[3] ?? 0) - (box[1] ?? 0)) * BP_TO_PT,
      xml: match[3] ?? "",
    });
  }
  return pages;
}

function paintOf(attrs: Record<string, string>, groupAlpha: number): Paint {
  return {
    space: attrs.colorspace ?? "none",
    components: numbers(attrs.color),
    alpha: (attrs.alpha === undefined ? 1 : Number(attrs.alpha)) * groupAlpha,
  };
}

/**
 * Convert one page's trace into Tier 2 primitives in picture coordinates.
 * `frame` positions the page's top-left corner in the picture.
 */
export function pagePrimitives(page: MutoolPage, frame: FrameConversion): Tier2Primitive[] {
  const result: Tier2Primitive[] = [];
  const clipStack: (Box | undefined)[] = [];
  const groupAlpha: number[] = [1];
  let maskDepth = 0;
  let order = 0;
  let current: { tag: XmlTag; ctm: Matrix; segments: PathSegment[] } | null = null;
  let text: { tag: XmlTag; ctm: Matrix; runs: GlyphRun[]; run: GlyphRun | null; clip: boolean } | null = null;
  const alpha = () => groupAlpha.reduce((a, b) => a * b, 1);
  const activeClip = () => clipStack.reduce<Box | undefined>((acc, b) => intersect(acc, b), undefined);

  for (const tag of tokenize(page.xml)) {
    const { name, attrs } = tag;
    if (name === "mask" || name === "softmask") {
      if (tag.close) maskDepth -= 1; else if (!tag.selfClose) maskDepth += 1;
      continue;
    }
    if (name === "group") {
      if (tag.close) groupAlpha.pop();
      else if (!tag.selfClose) groupAlpha.push(attrs.alpha === undefined ? 1 : Number(attrs.alpha));
      continue;
    }
    if (name === "pop_clip") { clipStack.pop(); continue; }
    if (name === "fill_path" || name === "stroke_path" || name === "clip_path" || name === "clip_stroke_path") {
      if (tag.close) {
        if (!current) continue;
        const segments = current.segments;
        const isClip = name === "clip_path" || name === "clip_stroke_path";
        if (isClip) {
          clipStack.push(boundsOf(segmentPoints(segments)));
        }
        if (maskDepth > 0 && !isClip) { current = null; continue; }
        const primitive: PathPrimitive = {
          type: "path",
          order: order++,
          operation: isClip ? "clip" : name === "fill_path" ? "fill" : "stroke",
          segments,
          clipDepth: isClip ? clipStack.length - 1 : clipStack.length,
        };
        const clipBox = isClip ? clipStack.slice(0, -1).reduce<Box | undefined>((acc, b) => intersect(acc, b), undefined) : activeClip();
        if (clipBox) primitive.clipBox = clipBox;
        const rect = rectangleOf(segments);
        if (rect) primitive.rect = rect;
        const winding = current.tag.attrs.winding;
        if (winding !== undefined) primitive.fillRule = winding === "eofill" || winding === "evenodd" ? "evenodd" : "nonzero";
        if (name === "fill_path" || name === "stroke_path") primitive.paint = paintOf(current.tag.attrs, alpha());
        if (name === "stroke_path" || name === "clip_stroke_path") {
          const m = current.ctm;
          const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) * BP_TO_PT;
          primitive.lineWidth = Number(current.tag.attrs.linewidth ?? 1) * scale;
          if (current.tag.attrs.dash !== undefined) {
            primitive.dash = { array: numbers(current.tag.attrs.dash).map((d) => d * scale), phase: Number(current.tag.attrs.dash_phase ?? 0) * scale };
          }
          primitive.lineCap = numbers(current.tag.attrs.linecap)[0] ?? 0;
          primitive.lineJoin = Number(current.tag.attrs.linejoin ?? 0);
          primitive.miterLimit = Number(current.tag.attrs.miterlimit ?? 10);
        }
        result.push(primitive);
        current = null;
      } else {
        current = { tag, ctm: matrix(attrs.transform), segments: [] };
        if (tag.selfClose) current = null;
      }
      continue;
    }
    if (current && (name === "moveto" || name === "lineto" || name === "curveto" || name === "closepath")) {
      const m = current.ctm;
      const p = (x: string | undefined, y: string | undefined) => toPicture(apply(m, Number(x), Number(y)), frame);
      if (name === "moveto") { const q = p(attrs.x, attrs.y); current.segments.push({ op: "M", x: q.x, y: q.y }); }
      else if (name === "lineto") { const q = p(attrs.x, attrs.y); current.segments.push({ op: "L", x: q.x, y: q.y }); }
      else if (name === "curveto") {
        const a = p(attrs.x1, attrs.y1); const b = p(attrs.x2, attrs.y2); const c = p(attrs.x3, attrs.y3);
        current.segments.push({ op: "C", x1: a.x, y1: a.y, x2: b.x, y2: b.y, x: c.x, y: c.y });
      } else current.segments.push({ op: "Z" });
      continue;
    }
    if (name === "fill_text" || name === "stroke_text" || name === "clip_text" || name === "clip_stroke_text" || name === "ignore_text") {
      if (tag.close) {
        if (text) {
          if (text.clip) clipStack.push(boundsOf(text.runs.flatMap((r) => r.glyphs.map((g) => ({ x: g.x, y: g.y })))));
          if (maskDepth === 0 && (text.tag.name === "fill_text" || text.tag.name === "stroke_text")) result.push(...text.runs);
        }
        text = null;
      } else if (!tag.selfClose) {
        text = { tag, ctm: matrix(attrs.transform), runs: [], run: null, clip: name.startsWith("clip") };
      }
      continue;
    }
    if (text && name === "span") {
      if (tag.close) { text.run = null; continue; }
      const trm = numbers(attrs.trm);
      const m = text.ctm;
      const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      // Baseline direction: text-space x axis through trm and the CTM, then y flipped.
      const ux = (trm[0] ?? 1) * m[0] + (trm[1] ?? 0) * m[2];
      const uy = (trm[0] ?? 1) * m[1] + (trm[1] ?? 0) * m[3];
      const ulen = Math.hypot(ux, uy) || 1;
      const run: GlyphRun = {
        type: "glyphs",
        direction: { x: ux / ulen, y: -uy / ulen },
        order: order++,
        font: (attrs.font ?? "").replace(/^[A-Z]{6}\+/u, ""),
        size: Math.sqrt(Math.abs((trm[0] ?? 0) * (trm[3] ?? 0) - (trm[1] ?? 0) * (trm[2] ?? 0))) * scale * BP_TO_PT,
        paint: paintOf(text.tag.attrs, alpha()),
        glyphs: [],
        text: "",
        clipDepth: clipStack.length,
      };
      const clipBox = activeClip();
      if (clipBox) run.clipBox = clipBox;
      text.runs.push(run);
      text.run = run;
      continue;
    }
    if (text?.run && name === "g") {
      const q = toPicture(apply(text.ctm, Number(attrs.x), Number(attrs.y)), frame);
      // A glyph whose ToUnicode maps to several characters (pdfTeX's "fi")
      // arrives as several <g> at one position; merge them, and normalise
      // ligature code points (LuaTeX's U+FB01) with NFKC, so text compares
      // by characters rather than by the engine's ligature encoding.
      const unicode = (attrs.unicode ?? "").normalize("NFKC");
      const previous = text.run.glyphs[text.run.glyphs.length - 1];
      if (previous && (attrs.glyph ?? "") === "" && Math.abs(previous.x - q.x) < 1e-9 && Math.abs(previous.y - q.y) < 1e-9) previous.unicode += unicode;
      else text.run.glyphs.push({ unicode, x: q.x, y: q.y, advance: Number(attrs.adv ?? 0) * text.run.size });
      text.run.text += unicode;
      continue;
    }
    if (name === "fill_image" || name === "fill_image_mask" || name === "fill_shade" || name === "clip_image_mask") {
      const m = matrix(attrs.transform);
      const corners = name === "fill_shade" ? [] : [apply(m, 0, 0), apply(m, 1, 0), apply(m, 0, 1), apply(m, 1, 1)].map((p) => toPicture(p, frame));
      if (name === "clip_image_mask") { clipStack.push(boundsOf(corners)); continue; }
      if (maskDepth > 0) continue;
      const bounds = name === "fill_shade" ? activeClip() : boundsOf(corners);
      const other: OtherPrimitive = { type: name === "fill_shade" ? "shading" : "image", order: order++, bounds: bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 }, clipDepth: clipStack.length };
      result.push(other);
    }
  }
  return result;
}
