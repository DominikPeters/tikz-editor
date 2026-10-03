import type { DocumentGraphicsResolver } from "../../graphics/types.js";
import { createIdentityMappedText } from "../source-map.js";
import { texHBoxX, texHBoxY, texLength, type TexLength } from "./coordinates.js";
import { parseTexDimensionExpression, resolveTexDimensionExpression, texDimensionContextForFont, type TexDimensionContext } from "./dimensions.js";
import type { TexMetricProvider } from "./fonts/types.js";
import type { TexTextFontProfile } from "./fonts/text-profile.js";
import { simpleTexInlineNodesToTokens, type SimpleTexBoxNode, type SimpleTexFontState, type SimpleTexInlineNode, type SimpleTexTransformNode, type TexSpaceGlueProfile } from "./ir.js";
import { simpleTexInlineTokensToLayoutItems, texMBoxHListFromLayoutItems, type TexLayoutInlineItem, type TexMathBox, type TexMathBoxProvider, type TexMathCaretEntry } from "./layout-inline-items.js";
import { layoutSimpleTexParagraph } from "./layout-simple.js";
import { defaultTexMathFontProfile } from "./math/font-profile.js";
import type { TexMathHList, TexMathHListItem } from "./math/layout.js";
import { renderTexMathHListSvgBody } from "./math/render-svg.js";
import { renderTexParagraphSvgBody } from "./render-svg.js";
import type { TexTabularLayoutProfile } from "./tabular/types.js";

interface TransformLayoutParams {
  readonly node: SimpleTexTransformNode;
  readonly fontState: SimpleTexFontState;
  readonly atPt: TexLength;
  readonly metricProvider: TexMetricProvider;
  readonly textFontProfile: TexTextFontProfile;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
  readonly mathBoxProvider?: TexMathBoxProvider;
  readonly graphicsResolver?: DocumentGraphicsResolver;
  readonly dimensionContext?: TexDimensionContext;
  readonly tabularProfile?: TexTabularLayoutProfile;
}
type Matrix = readonly [number, number, number, number, number, number];
type Geometry = { width: number; height: number; depth: number; matrix: Matrix };
const scaled = (n: number): TexLength => texLength(Math.round(n * 65536) / 65536);
const factorProduct = (length: number, factor: number): TexLength => texLength(Math.trunc(Math.round(length * 65536) * Math.round(factor * 65536) / 65536) / 65536);
const point = (m: Matrix, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
function bounds(m: Matrix, x: number, y: number, width: number, height: number) {
  const corners = [point(m, x, y), point(m, x + width, y), point(m, x, y + height), point(m, x + width, y + height)];
  return { left: Math.min(...corners.map(p => p.x)), right: Math.max(...corners.map(p => p.x)), top: Math.min(...corners.map(p => p.y)), bottom: Math.max(...corners.map(p => p.y)) };
}
function fontProfile(params: TransformLayoutParams) { return { ...defaultTexMathFontProfile, metricProvider: params.metricProvider, textFontProfile: params.textFontProfile }; }
function baselineSkip(fontSize: number, params: TransformLayoutParams): number {
  if (params.fontState.baselineSkipPt !== undefined) return params.fontState.baselineSkipPt;
  return params.fontState.sizePt === undefined && params.tabularProfile?.baselineSkipPt !== undefined ? params.tabularProfile.baselineSkipPt : ({ 8: 9.5, 9: 11, 10: 12, 10.95: 13.6, 12: 14, 14.4: 18, 17.28: 22, 20.74: 25, 24.88: 30 } as Record<number, number>)[fontSize] ?? fontSize * 1.2;
}

/** Reuse paragraph/list/display paint, then apply the kernel's parbox baseline. */
function paragraphBox(node: SimpleTexBoxNode, params: TransformLayoutParams, fontState: SimpleTexFontState): TexMathBox {
  if (node.height !== undefined) throw new Error("Explicit-height transformed minipages are not yet supported.");
  const font = params.textFontProfile.resolveTextFont(fontState, params.atPt, params.metricProvider);
  const mapped = createIdentityMappedText(node.content, node.contentStart);
  const skip = baselineSkip(font.atPt, { ...params, fontState });
  const layout = layoutSimpleTexParagraph(node.content, {
    width: node.width, font, baselineSkip: skip, parindent: 0, alignment: "justified",
    textFontProfile: { ...params.textFontProfile, defaultFontState: fontState }, metricProvider: params.metricProvider,
    mathBoxProvider: params.mathBoxProvider, graphicsResolver: params.graphicsResolver, tabularProfile: params.tabularProfile,
    dimensionContext: params.dimensionContext ? { ...params.dimensionContext, linewidth: node.width, ...(node.command === "minipage" ? { textwidth: node.width, columnwidth: node.width } : {}) } : undefined,
    sourceMap: mapped.sourceMap,
  });
  if (!layout.supported || !layout.report || !layout.vlistLayout) throw new Error(layout.fallbackReason ?? "Unsupported transformed paragraph box.");
  const vlist = layout.vlistLayout;
  const total = vlist.metrics.height + vlist.metrics.depth;
  const height = node.alignment === "top" ? vlist.items[0]?.metrics.height ?? 0 : node.alignment === "bottom" ? total - (vlist.items.at(-1)?.metrics.depth ?? 0) : scaled(total / 2 + factorProduct(font.atPt, .25));
  const svg = renderTexParagraphSvgBody(layout.report, { lineHeightPt: texLength(skip), metricProvider: params.metricProvider, textFontProfile: params.textFontProfile, vlistLayout: vlist });
  const entries: TexMathCaretEntry[] = [];
  const lines = new Map(vlist.linePlacements.map(line => [line.lineIndex, line]));
  for (const line of layout.report.lines) {
    const placement = lines.get(line.lineIndex); const y = Number(placement?.y ?? 0) + line.ascent - height;
    for (const segment of line.segments) {
      const from = Number(segment.sourceStartRaw ?? node.contentStart); const to = Number(segment.sourceEndRaw ?? from);
      for (const [index, stop] of (segment.caretStops ?? []).entries()) entries.push({ sourceOffset: Math.min(to, from + index), x: texHBoxX(Number(placement?.x ?? 0) + Number(stop)), y: texHBoxY(y), height: line.ascent, depth: line.descent, sourceSpan: { start: from, end: to }, kind: "glyph-boundary", priority: 20, hitBounds: { xStart: texHBoxX(Number(placement?.x ?? 0) + Number(segment.x)), xEnd: texHBoxX(Number(placement?.x ?? 0) + Number(segment.x) + Number(segment.width)), yStart: texHBoxY(y - line.ascent), yEnd: texHBoxY(y + line.descent) } });
    }
  }
  return { source: node.text, content: node.content, sourceKind: "text", sourceStart: node.sourceStart, sourceEnd: node.sourceEnd, contentStart: node.contentStart, contentEnd: node.contentEnd, width: node.width, height: texLength(height), depth: texLength(total - height), svgBody: `<g data-tex-paragraph-box="${node.command}" transform="translate(0 ${-height * 100}) scale(100)">${svg}</g>`, caretMap: { sourceStart: node.sourceStart, sourceEnd: node.sourceEnd, contentStart: node.contentStart, contentEnd: node.contentEnd, entries } };
}

function contents(params: TransformLayoutParams): { hlist: TexMathHList; carets: TexMathCaretEntry[] } {
  const items: TexLayoutInlineItem[] = [];
  let inline: SimpleTexInlineNode[] = []; let fontState = params.fontState;
  const flush = () => {
    if (!inline.length) return;
    const tokens = simpleTexInlineNodesToTokens([...inline, { kind: "text", text: "x", sourceStart: params.node.contentEnd, sourceEnd: params.node.contentEnd }], fontState);
    fontState = tokens.at(-1)?.fontState ?? fontState; tokens.pop();
    items.push(...simpleTexInlineTokensToLayoutItems({ ...params, tokens, trimEdges: false })); inline = [];
  };
  for (const node of params.node.children) {
    if (node.kind === "paragraph-break") continue; // \par is inert in restricted horizontal mode.
    if (node.kind !== "box") { inline.push(node as SimpleTexInlineNode); continue; }
    flush(); const box = paragraphBox(node, params, fontState);
    items.push({ kind: "text-box", command: "mbox", text: node.text, content: node.content, sourceStart: node.sourceStart, sourceEnd: node.sourceEnd, contentStart: node.contentStart, contentEnd: node.contentEnd, box });
  }
  flush();
  const hlist = texMBoxHListFromLayoutItems({ items, sourceSpan: { start: params.node.contentStart, end: params.node.contentEnd }, metricProvider: params.metricProvider });
  if (!hlist) throw new Error("Unsupported transformed LR box content.");
  const carets: TexMathCaretEntry[] = [];
  function walk(children: readonly TexMathHListItem[], x = 0, y = 0) {
    for (const child of children) {
      if (child.kind === "hlist") {
        const owner = items.find(item => item.kind === "text-box" && item.sourceStart === child.sourceSpan.start && item.sourceEnd === child.sourceSpan.end);
        if (child.svgBody && owner?.kind === "text-box") for (const entry of owner.box.caretMap?.entries ?? []) carets.push({ ...entry, x: texHBoxX(entry.x + x + child.x), y: texHBoxY(entry.y + y + child.y), ...(entry.hitBounds ? { hitBounds: { xStart: texHBoxX(entry.hitBounds.xStart + x + child.x), xEnd: texHBoxX(entry.hitBounds.xEnd + x + child.x), yStart: texHBoxY(entry.hitBounds.yStart + y + child.y), yEnd: texHBoxY(entry.hitBounds.yEnd + y + child.y) } } : {}) });
        walk(child.items, x + child.x, y + child.y); continue;
      }
      if (child.kind !== "glyph") continue;
      for (const [sourceOffset, stop] of [[child.sourceSpan.start, child.x], [child.sourceSpan.end, child.x + child.width]]) carets.push({ sourceOffset, x: texHBoxX(x + stop), y: texHBoxY(y + child.y), height: child.height, depth: child.depth, sourceSpan: child.sourceSpan, kind: "glyph-boundary", priority: 20, hitBounds: { xStart: texHBoxX(x + child.x), xEnd: texHBoxX(x + child.x + child.width), yStart: texHBoxY(y + child.y - child.height), yEnd: texHBoxY(y + child.y + child.depth) } });
    }
  }
  walk(hlist.items);
  return { hlist, carets };
}

function geometry(params: TransformLayoutParams, body: TexMathHList): Geometry {
  const font = params.textFontProfile.resolveTextFont(params.fontState, params.atPt, params.metricProvider);
  const context = texDimensionContextForFont(params.dimensionContext ?? { linewidth: texLength(100), textwidth: texLength(100), columnwidth: texLength(100), paperwidth: texLength(100), em: font.atPt, ex: texLength(0) }, font);
  const dimension = (raw: string): number => {
    const boxReference = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)?)\\(width|height|depth|totalheight)$/u.exec(raw.trim());
    if (boxReference) { const factor = Number(boxReference[1] || 1); const extent = ({ width: body.width, height: body.height, depth: body.depth, totalheight: body.height + body.depth } as Record<string, number>)[boxReference[2]]; return factorProduct(extent, factor); }
    const parsed = parseTexDimensionExpression(raw); const value = parsed && resolveTexDimensionExpression(parsed, context);
    if (value === null || value === undefined || !Number.isFinite(value)) throw new Error(`Unsupported graphicx dimension ${raw}.`);
    return scaled(value);
  };
  const spec = params.node.parameters;
  if (spec.kind !== "rotate") {
    const ratio = (target: string, original: number) => {
      if (!original) throw new Error("Cannot resize a zero-extent box.");
      // graphics.sty Gscale@div enlarges the numerator before integer division,
      // and truncates the denominator independently. Direct floating division
      // does not reproduce the package's selected PDF matrix or box dimensions.
      let numerator = Math.round(dimension(target) * 65536);
      let count = numerator < 0 ? -65536 : 65536;
      numerator = Math.abs(numerator);
      if (numerator > 0) {
        while (count >= 2 && numerator < 8192 * 65536) {
          numerator *= 2;
          count = Math.trunc(count / 2);
        }
        const denominator = Math.trunc(Math.round(original * 65536) / count);
        if (!denominator) throw new Error("Cannot resize this box extent.");
        numerator = Math.trunc(numerator / denominator);
      }
      return Number((numerator / 65536).toFixed(5));
    };
    let x = spec.kind === "scale" ? spec.x : spec.width.trim() === "!" ? undefined : ratio(spec.width, body.width);
    let y = spec.kind === "scale" ? spec.y : spec.height.trim() === "!" ? undefined : ratio(spec.height, spec.totalHeight ? body.height + body.depth : body.height);
    if (x === undefined && y === undefined) x = y = 1; else { x ??= y; y ??= x; }
    const width = factorProduct(body.width, Math.abs(x!));
    return { width, height: factorProduct(y! >= 0 ? body.height : body.depth, Math.abs(y!)), depth: factorProduct(y! >= 0 ? body.depth : body.height, Math.abs(y!)), matrix: [x!, 0, 0, y!, x! < 0 ? width : 0, 0] };
  }
  let pivotX: number = spec.options ? factorProduct(body.width, .5) : 0;
  let pivotY: number = spec.options ? factorProduct(body.height - body.depth, .5) : 0;
  let angle = spec.angle;
  for (const option of spec.options?.entries ?? []) {
    if (option.kind === "unknown") throw new Error("Unsupported rotation option.");
    const value = option.kind === "kv" ? option.valueRaw.trim().replace(/^\{(.*)\}$/u, "$1") : "c";
    if (option.key === "origin") for (const char of value) {
      if (char === "l") pivotX = 0; else if (char === "r") pivotX = body.width; else if (char === "t") pivotY = body.height; else if (char === "b") pivotY = -Number(body.depth); else if (char === "B") pivotY = 0; else if (char !== "c") throw new Error("Unsupported rotation origin.");
    }
    else if (option.key === "x") pivotX = dimension(value);
    else if (option.key === "y") pivotY = dimension(value);
    else if (option.key === "units" && Number.isFinite(Number(value)) && Number(value) !== 0) angle = spec.angle * 360 / Number(value);
    else throw new Error(`Unsupported rotation option ${option.key}.`);
  }
  const radians = angle * Math.PI / 180; const cosine = Math.cos(radians); const sine = Math.sin(radians);
  const rotation: Matrix = [Math.abs(cosine) < 1e-12 ? 0 : cosine, Math.abs(sine) < 1e-12 ? 0 : -sine, Math.abs(sine) < 1e-12 ? 0 : sine, Math.abs(cosine) < 1e-12 ? 0 : cosine, 0, 0];
  const relative = bounds(rotation, -Number(pivotX), pivotY - body.height, body.width, body.height + body.depth);
  const pivot = point(rotation, pivotX, -Number(pivotY));
  const matrix: Matrix = [...rotation.slice(0, 4), -pivot.x - relative.left, -pivot.y - pivotY] as unknown as Matrix;
  return { width: scaled(relative.right - relative.left), height: scaled(-relative.top + pivotY), depth: scaled(relative.bottom - pivotY), matrix };
}

export function layoutTexTransformBox(params: TransformLayoutParams): TexMathBox {
  const { hlist, carets } = contents(params); const transformed = geometry(params, hlist); const matrix = transformed.matrix;
  const entries = carets.map((entry): TexMathCaretEntry => {
    const origin = point(matrix, entry.x, entry.y); const extent = entry.hitBounds ? bounds(matrix, entry.hitBounds.xStart, entry.hitBounds.yStart, entry.hitBounds.xEnd - entry.hitBounds.xStart, entry.hitBounds.yEnd - entry.hitBounds.yStart) : bounds(matrix, entry.x, entry.y - entry.height, 0, entry.height + entry.depth);
    return { ...entry, x: texHBoxX(origin.x), y: texHBoxY(origin.y), height: texLength(origin.y - extent.top), depth: texLength(extent.bottom - origin.y), hitBounds: { xStart: texHBoxX(extent.left), xEnd: texHBoxX(extent.right), yStart: texHBoxY(extent.top), yEnd: texHBoxY(extent.bottom) } };
  });
  const svgMatrix = [...matrix.slice(0, 4), matrix[4] * 100, matrix[5] * 100].map(value => Math.abs(value) < 1e-12 ? 0 : Number(value.toFixed(10))).join(" ");
  return { source: params.node.text, content: params.node.content, sourceKind: "text", sourceStart: params.node.sourceStart, sourceEnd: params.node.sourceEnd, contentStart: params.node.contentStart, contentEnd: params.node.contentEnd, width: texLength(transformed.width), height: texLength(transformed.height), depth: texLength(transformed.depth), fontProfile: fontProfile(params), svgBody: `<g data-tex-transform="${params.node.command}" data-source-start="${params.node.sourceStart}" data-source-end="${params.node.sourceEnd}" transform="matrix(${svgMatrix})">${renderTexMathHListSvgBody(hlist, { fontProfile: fontProfile(params) })}</g>`, caretMap: { sourceStart: params.node.sourceStart, sourceEnd: params.node.sourceEnd, contentStart: params.node.contentStart, contentEnd: params.node.contentEnd, entries } };
}
