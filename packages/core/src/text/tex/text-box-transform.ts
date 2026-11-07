import type { TexListLayoutProfile } from "./layout-options.js";
import { isSimpleTexInlineNode } from "./ir.js";
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
import { graphicxBounds, graphicxFactorProduct, graphicxPoint, graphicxScaled, graphicxSvgMatrix, graphicxTransformGeometry, type GraphicxGeometry } from "./graphicx-geometry.js";
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
  readonly listProfile?: TexListLayoutProfile;
}
const scaled = graphicxScaled;
const factorProduct = graphicxFactorProduct;
const point = graphicxPoint;
const bounds = graphicxBounds;
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
    ...(params.mathBoxProvider !== undefined ? { mathBoxProvider: params.mathBoxProvider } : {}), ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}), ...(params.tabularProfile !== undefined ? { tabularProfile: params.tabularProfile } : {}),
    ...(params.dimensionContext ? { dimensionContext: { ...params.dimensionContext, linewidth: node.width, ...(node.command === "minipage" ? { textwidth: node.width, columnwidth: node.width } : {}) } } : {}),
    ...(params.listProfile ? { listProfile: { ...params.listProfile, suppressInitialTopsep: true } } : {}),
    sourceMap: mapped.sourceMap,
  });
  if (!layout.supported || !layout.report || !layout.vlistLayout) throw new Error(layout.fallbackReason ?? "Unsupported transformed paragraph box.");
  const vlist = layout.vlistLayout;
  const total = vlist.metrics.height + vlist.metrics.depth;
  // A leading list starts the minipage's vertical list with glue, even
  // when its natural size is zero. TeX's \vtop then has zero height;
  // our semantic list wrapper instead references its first text baseline.
  const first = vlist.items[0];
  const topHeight = first?.item.kind === "vbox" && first.item.role?.kind === "list"
    ? 0 : first?.metrics.height ?? 0;
  const height = node.alignment === "top" ? topHeight : node.alignment === "bottom" ? total - (vlist.items.at(-1)?.metrics.depth ?? 0) : scaled(total / 2 + factorProduct(font.atPt, .25));
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
    if (node.kind !== "box") {
      if (!isSimpleTexInlineNode(node)) throw new Error("Unsupported transformed inline material.");
      inline.push(node); continue;
    }
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
        if (child.svgBody && owner?.kind === "text-box") for (const entry of owner.box.caretMap?.entries ?? []) carets.push({ ...entry, x: texHBoxX(entry.x + x + child.x), y: texHBoxY(entry.y + y + child.y), hitBounds: { xStart: texHBoxX(entry.hitBounds.xStart + x + child.x), xEnd: texHBoxX(entry.hitBounds.xEnd + x + child.x), yStart: texHBoxY(entry.hitBounds.yStart + y + child.y), yEnd: texHBoxY(entry.hitBounds.yEnd + y + child.y) } });
        walk(child.items, x + child.x, y + child.y); continue;
      }
      if (child.kind !== "glyph") continue;
      for (const [sourceOffset, stop] of [[child.sourceSpan.start, child.x], [child.sourceSpan.end, child.x + child.width]] as const) carets.push({ sourceOffset, x: texHBoxX(x + stop), y: texHBoxY(y + child.y), height: child.height, depth: child.depth, sourceSpan: child.sourceSpan, kind: "glyph-boundary", priority: 20, hitBounds: { xStart: texHBoxX(x + child.x), xEnd: texHBoxX(x + child.x + child.width), yStart: texHBoxY(y + child.y - child.height), yEnd: texHBoxY(y + child.y + child.depth) } });
    }
  }
  walk(hlist.items);
  return { hlist, carets };
}

function geometry(params: TransformLayoutParams, body: TexMathHList): GraphicxGeometry {
  const font = params.textFontProfile.resolveTextFont(params.fontState, params.atPt, params.metricProvider);
  const context = texDimensionContextForFont(params.dimensionContext ?? { linewidth: texLength(100), textwidth: texLength(100), columnwidth: texLength(100), paperwidth: texLength(100), em: font.atPt, ex: texLength(0) }, font);
  const dimension = (raw: string): number => {
    const boxReference = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)?)\\(width|height|depth|totalheight)$/u.exec(raw.trim());
    if (boxReference) { const factor = boxReference[1] ? Number(boxReference[1]) : 1; const extent = ({ width: body.width, height: body.height, depth: body.depth, totalheight: body.height + body.depth } as Record<string, number>)[boxReference[2] ?? ""]; if (extent === undefined) throw new Error("Missing graphicx box dimension."); return factorProduct(extent, factor); }
    const parsed = parseTexDimensionExpression(raw); const value = parsed && resolveTexDimensionExpression(parsed, context);
    if (value === null || !Number.isFinite(value)) throw new Error(`Unsupported graphicx dimension ${raw}.`);
    return scaled(value);
  };
  return graphicxTransformGeometry(params.node.parameters, body, dimension);
}

export function layoutTexTransformBox(params: TransformLayoutParams): TexMathBox {
  const { hlist, carets } = contents(params); const transformed = geometry(params, hlist); const matrix = transformed.matrix;
  const entries = carets.map((entry): TexMathCaretEntry => {
    const origin = point(matrix, entry.x, entry.y); const extent = bounds(matrix, entry.hitBounds.xStart, entry.hitBounds.yStart, entry.hitBounds.xEnd - entry.hitBounds.xStart, entry.hitBounds.yEnd - entry.hitBounds.yStart);
    return { ...entry, x: texHBoxX(origin.x), y: texHBoxY(origin.y), height: texLength(origin.y - extent.top), depth: texLength(extent.bottom - origin.y), hitBounds: { xStart: texHBoxX(extent.left), xEnd: texHBoxX(extent.right), yStart: texHBoxY(extent.top), yEnd: texHBoxY(extent.bottom) } };
  });
  const svgMatrix = graphicxSvgMatrix(matrix, 100);
  return { source: params.node.text, content: params.node.content, sourceKind: "text", sourceStart: params.node.sourceStart, sourceEnd: params.node.sourceEnd, contentStart: params.node.contentStart, contentEnd: params.node.contentEnd, width: texLength(transformed.width), height: texLength(transformed.height), depth: texLength(transformed.depth), fontProfile: fontProfile(params), svgBody: `<g data-tex-transform="${params.node.command}" data-source-start="${params.node.sourceStart}" data-source-end="${params.node.sourceEnd}" transform="matrix(${svgMatrix})">${renderTexMathHListSvgBody(hlist, { fontProfile: fontProfile(params) })}</g>`, caretMap: { sourceStart: params.node.sourceStart, sourceEnd: params.node.sourceEnd, contentStart: params.node.contentStart, contentEnd: params.node.contentEnd, entries } };
}
