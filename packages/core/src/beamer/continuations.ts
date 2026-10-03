import { beamerDocumentParser } from "@tikz-editor/lezer-tex";
import type { Span } from "../ast/types.js";
import { concatMappedText, createGeneratedMappedText, projectInputRange, sliceMappedText, type MappedText } from "../text/source-map.js";
import { getTexSyntaxIndex, type TexSyntaxIndex } from "../text/tex/syntax-index.js";
import { texVListY } from "../text/tex/coordinates.js";
import type { PositionedTexVListItem } from "../text/tex/vlist/types.js";
import type { LaidParagraph, PositionedFrameFlowItem, PreparedFrameFlowItem } from "./render-model.js";
import { positionPreparedFrameFlow } from "./frame-flow.js";
import type { BeamerDocumentModel, BeamerFrameModel } from "./types.js";

export type BeamerContinuationBreak = { span: Span; penalty: number; newpage: boolean };
export type BeamerContinuationBreaks = ReadonlyMap<number, BeamerContinuationBreak>;

function continuationControl(source: string, span: Span): { name: string; span: Span } {
  // The Beamer grammar has a reserved \frame token. Recover the complete
  // TeX control word when it appears as the prefix of \framebreak.
  const word = /^\\[A-Za-z@]+/u.exec(source.slice(span.from));
  return { name: word?.[0].slice(1) ?? "", span: { from: span.from, to: span.from + (word?.[0].length ?? span.to - span.from) } };
}

/** Pagebreak is a vadjust in horizontal mode; newpage ends the paragraph. */
export function collectBeamerContinuationBreaks(syntax: TexSyntaxIndex, frame: BeamerFrameModel): BeamerContinuationBreaks {
  const breaks = new Map<number, BeamerContinuationBreak>();
  for (const token of syntax.controlsIn(frame.bodySpan)) {
    const control = continuationControl(syntax.source, token.span);
    if (!["newpage", "framebreak", "pagebreak", "noframebreak", "nopagebreak"].includes(control.name)) continue;
    const overlay = syntax.argumentAfter(control.span.to, "overlay", frame.bodySpan.to);
    const optional = syntax.argumentAfter(overlay?.span.to ?? control.span.to, "optional", frame.bodySpan.to);
    const priority = optional ? Number(syntax.source.slice(optional.contentSpan.from, optional.contentSpan.to)) : 4;
    const penalties = [0, -51, -151, -301, -10000];
    if (!Number.isInteger(priority) || priority < 0 || priority > 4) continue;
    breaks.set(control.span.from, {
      span: { from: control.span.from, to: optional?.span.to ?? overlay?.span.to ?? control.span.to },
      penalty: (control.name === "noframebreak" || control.name === "nopagebreak" ? -1 : 1) * penalties[priority],
      newpage: control.name === "newpage",
    });
  }
  return breaks;
}

export function projectBeamerContinuationBreaks(mapped: MappedText, breaks?: BeamerContinuationBreaks): MappedText {
  if (!breaks?.size) return mapped;
  const syntax = getTexSyntaxIndex(mapped.text, beamerDocumentParser);
  const parts: MappedText[] = [];
  let cursor = 0;
  for (const token of syntax.controls) {
    const control = continuationControl(mapped.text, token.span);
    const owner = projectInputRange(mapped.sourceMap, control.span.from, control.span.to);
    if (owner.kind !== "source-range") continue;
    const entry = breaks.get(owner.from);
    if (!entry || control.span.from < cursor) continue;
    const overlay = syntax.argumentAfter(control.span.to, "overlay", mapped.text.length);
    const optional = syntax.argumentAfter(overlay?.span.to ?? control.span.to, "optional", mapped.text.length);
    parts.push(sliceMappedText(mapped, cursor, control.span.from));
    // vspace uses the frontend's horizontal-mode vadjust machinery. Its
    // source-owned zero glue becomes the pagebreak penalty in the split pass.
    parts.push(createGeneratedMappedText(entry.newpage ? "\\par\\vfill\\penalty -10000 " : "\\vspace{0pt}", "Beamer frame page break", entry.span));
    cursor = optional?.span.to ?? overlay?.span.to ?? control.span.to;
  }
  parts.push(sliceMappedText(mapped, cursor, mapped.text.length));
  return concatMappedText(parts);
}

function roman(value: number): string {
  let result = "";
  for (const [amount, text] of [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]] as const) {
    while (value >= amount) { result += text; value -= amount; }
  }
  return result;
}

export function beamerContinuationTitleSuffix(document: BeamerDocumentModel, index: number, count: number): string {
  const source = document.source.slice(document.preamble.span.from, document.preamble.span.to);
  const setting = /\\setbeamertemplate\s*\{\s*frametitle continuation\s*\}\s*\[\s*(from second|singleframecheck|default|roman)\s*\]/gu;
  let variant = "default";
  for (const match of source.matchAll(setting)) variant = match[1];
  if (variant === "from second") return index > 1 ? " (cont.)" : " ";
  if (variant === "singleframecheck" && count === 1) return " ";
  return ` ${roman(index)}`;
}

type VerticalMaterial =
  | { kind: "box"; height: number; depth: number; splitTopHeight?: number; placement: PositionedFrameFlowItem }
  | { kind: "glue"; size: number; stretch: number; shrink: number; order: number }
  | { kind: "penalty"; penalty: number };

const glue = (size: number, stretch = 0, shrink = 0, order = 0): VerticalMaterial => ({ kind: "glue", size, stretch, shrink, order });
const key = (path: readonly number[]): string => path.join("/");

function sliceParagraphLine(item: Extract<PreparedFrameFlowItem, { kind: "paragraph" }>, lineIndex: number): PreparedFrameFlowItem {
  const original = item.paragraph;
  const line = original.layout.report.lines.find((candidate) => candidate.lineIndex === lineIndex)!;
  const placement = original.layout.vlistLayout.linePlacements.find((candidate) => candidate.lineIndex === lineIndex)!;
  const owner = original.layout.vlistLayout.paragraphPlacements.find((candidate) => candidate.lineIndices.includes(lineIndex))!;
  const top = Number(placement.y);
  const height = Number(line.ascent + line.descent);
  const paragraphId = `${original.layout.paragraphId}:continuation-line:${lineIndex}`;
  const report = { ...original.layout.report, paragraphId, lines: [line] };
  const select = (entry: PositionedTexVListItem): PositionedTexVListItem | null => {
    const children = entry.children?.flatMap((child) => { const selected = select(child); return selected ? [selected] : []; });
    const retain = entry.item.kind === "paragraph" ? key(entry.path) === key(owner.vlistPath)
      : entry.item.kind === "hbox" && entry.item.role?.kind === "list-label" && entry.item.role.blockIndex === owner.blockIndex;
    if (!retain && !children?.length) return null;
    return { ...entry, y: texVListY(Number(entry.y) - top), ...(children ? { children } : {}) };
  };
  const items = original.layout.vlistLayout.items.flatMap((entry) => { const selected = select(entry); return selected ? [selected] : []; });
  const boxItems = original.layout.vlistLayout.boxReport.items.filter((entry) =>
    entry.itemKind === "paragraph" && key(entry.path) === key(owner.vlistPath) ||
    entry.hboxRole?.kind === "list-label" && entry.hboxRole.blockIndex === owner.blockIndex
  ).map((entry) => ({ ...entry, y: texVListY(Number(entry.y) - top) }));
  const metrics = { width: original.layout.vlistLayout.metrics.width, height: line.ascent, depth: line.descent };
  const vlistLayout = {
    ...original.layout.vlistLayout, metrics, items,
    linePlacements: [{ ...placement, y: texVListY(0) }],
    paragraphPlacements: [{ ...owner, lineIndices: [lineIndex], y: texVListY(Number(owner.y) - top) }],
    graphicsPlacements: original.layout.vlistLayout.graphicsPlacements.filter((graphic) => graphic.lineIndex === lineIndex).map((graphic) => ({
      ...graphic, bounds: { ...graphic.bounds, y: texVListY(Number(graphic.bounds.y) - top) }, baselineY: texVListY(Number(graphic.baselineY) - top),
    })),
    boxReport: { ...original.layout.vlistLayout.boxReport, metrics, items: boxItems, tree: boxItems },
    reports: [report],
  };
  const clipId = paragraphId.replace(/[^A-Za-z0-9_-]/gu, "_");
  const paragraph: LaidParagraph = {
    height,
    layout: { ...original.layout, paragraphId, report, vlistLayout, bounds: { ...original.layout.bounds, x: 0, y: 0, height }, editableTextSpans: [], atomicRenderSpans: [],
      links: original.layout.links?.filter((link) => link.bounds.y < top + height && link.bounds.y + link.bounds.height > top).map((link) => ({ ...link, bounds: { ...link.bounds, y: link.bounds.y - top } })),
    },
    svgBody: `<defs><clipPath id="${clipId}"><rect x="-1000" y="0" width="10000" height="${height}"/></clipPath></defs><g clip-path="url(#${clipId})"><g transform="translate(0 ${-top})">${original.svgBody}</g></g>`,
    listMarkers: original.listMarkers.filter((marker) => marker.bounds.y < top + height && marker.bounds.y + marker.bounds.height > top).map((marker) => ({ ...marker, bounds: { ...marker.bounds, y: marker.bounds.y - top } })),
  };
  return { ...item, paragraph, naturalHeight: height, boxHeight: Number(line.ascent), endingDepth: Number(line.descent), leadingAdjustment: 0, trailingListGlue: { naturalPt: 0, shrinkPt: 0 } };
}

function sliceParagraphBox(item: Extract<PreparedFrameFlowItem, { kind: "paragraph" }>, entry: PositionedTexVListItem): PreparedFrameFlowItem {
  const original = item.paragraph;
  const top = Number(entry.y);
  const height = Number(entry.metrics.height + entry.metrics.depth);
  const paragraphId = `${original.layout.paragraphId}:continuation-box:${key(entry.path).replaceAll("/", "-")}`;
  const report = { ...original.layout.report, paragraphId, lines: [] };
  const shift = (value: PositionedTexVListItem): PositionedTexVListItem => ({ ...value, y: texVListY(Number(value.y) - top),
    ...(value.children ? { children: value.children.map(shift) } : {}),
  });
  const boxItems = original.layout.vlistLayout.boxReport.items.filter((value) => key(value.path) === key(entry.path) || key(value.path).startsWith(`${key(entry.path)}/`))
    .map((value) => ({ ...value, y: texVListY(Number(value.y) - top) }));
  const vlistLayout = { ...original.layout.vlistLayout, metrics: entry.metrics, items: [shift(entry)],
    paragraphPlacements: [], linePlacements: [], graphicsPlacements: [], reports: [report],
    boxReport: { ...original.layout.vlistLayout.boxReport, metrics: entry.metrics, tree: boxItems, items: boxItems },
  };
  const clipId = paragraphId.replace(/[^A-Za-z0-9_-]/gu, "_");
  const paragraph: LaidParagraph = { height,
    layout: { ...original.layout, paragraphId, report, vlistLayout, bounds: { ...original.layout.bounds, x: 0, y: 0, height }, editableTextSpans: [], atomicRenderSpans: [], links: [] },
    svgBody: `<defs><clipPath id="${clipId}"><rect x="-1000" y="0" width="10000" height="${height}"/></clipPath></defs><g clip-path="url(#${clipId})"><g transform="translate(0 ${-top})">${original.svgBody}</g></g>`,
    listMarkers: [],
  };
  return { ...item, paragraph, naturalHeight: height, boxHeight: Number(entry.metrics.height), endingDepth: Number(entry.metrics.depth), leadingAdjustment: 0, trailingListGlue: { naturalPt: 0, shrinkPt: 0 } };
}

function frameMaterial(flow: readonly PreparedFrameFlowItem[], baselineSkip: number, plain: boolean, breaks: BeamerContinuationBreaks): VerticalMaterial[] {
  const positioned = positionPreparedFrameFlow(flow, baselineSkip, 0, plain ? null : 0);
  const result: VerticalMaterial[] = [];
  let outerCursor = 0;
  for (const placement of positioned.items) {
    const item = placement.item;
    if (item.kind === "vertical-space") { result.push(glue(item.height)); outerCursor += item.height; continue; }
    let pendingOuterGap = Math.max(0, placement.contentTop - outerCursor);
    if (item.kind !== "paragraph" || item.paragraph.layout.vlistLayout.items[0]?.item.kind === "paragraph" || item.paragraph.layout.vlistLayout.items[0]?.item.kind === "vbox") {
      if (pendingOuterGap > 0) result.push(glue(pendingOuterGap));
      pendingOuterGap = 0;
    }
    if (item.kind !== "paragraph") {
      const blockBefore = item.kind === "block" && item.block.plan.style === "default" ? item.block.plan.geometry.beforeSkipPt : 0;
      if (blockBefore > 0) result.push(glue(blockBefore, blockBefore / 3, blockBefore / 3));
      const depth = item.kind === "block" || item.kind === "tikzpicture" ? item.endingDepth : item.kind === "columns" ? item.box.depth : 0;
      const height = item.kind === "columns" ? item.box.height : placement.visualBottom - placement.contentTop - depth - blockBefore;
      result.push({ kind: "box", height, depth,
        ...(blockBefore ? { splitTopHeight: item.kind === "block" ? item.block.titleAscent : height } : {}),
        placement: { ...placement, contentTop: -blockBefore, referenceY: height, visualTop: placement.visualTop - placement.contentTop - blockBefore, visualBottom: placement.visualBottom - placement.contentTop - blockBefore },
      });
    } else {
      const vlist = item.paragraph.layout.vlistLayout;
      let cursor = 0;
      const walk = (entries: readonly PositionedTexVListItem[]): void => {
        for (const entry of entries) {
          // These wrappers represent the unboxed list/quote flow. Actual
          // authored boxes (parbox/minipage, tables) remain atomic at a split.
          if (entry.item.kind === "vbox" && entry.item.role && entry.children) { walk(entry.children); continue; }
          const source = entry.item.sourceSpan;
          const command = source && [...breaks.values()].find((candidate) => source.start >= candidate.span.from && source.end <= candidate.span.to);
          if (entry.item.kind === "glue") {
            if (command && !command.newpage) { result.push({ kind: "penalty", penalty: command.penalty }); continue; }
            if (command?.newpage && entry.item.origin?.kind === "paragraph-boundary-interline") continue;
            if (command?.newpage && entry.item.origin?.kind === "explicit-command" && entry.item.origin.command === "vfill") {
              // The LaTeX kernel's newpage cancels a positive prevdepth
              // before adding vfil. It therefore packs against the baseline
              // on a bottom-aligned frame, even for descending letters.
              const previous = [...result].reverse().find(material => material.kind === "box");
              if (previous?.kind === "box" && previous.depth > 0) result.push(glue(-previous.depth));
            }
            if (entry.item.origin?.kind === "display-math-boundary" && entry.item.origin.side === "above" ||
              entry.item.origin?.kind === "display-math-interline" && entry.item.origin.side === "above") result.push({ kind: "penalty", penalty: 10000 });
            if (Number(entry.y) > cursor) result.push(glue(Number(entry.y) - cursor));
            const order = entry.item.stretchOrder === "fill" ? 2 : entry.item.stretchOrder === "fil" ? 1 : 0;
            result.push(glue(Number(entry.item.size), Number(entry.item.stretch ?? 0), Number(entry.item.shrink ?? 0), command?.newpage ? 1 : order));
            cursor = Number(entry.y + entry.item.size);
          } else if (entry.item.kind === "penalty") {
            result.push({ kind: "penalty", penalty: entry.item.penalty });
          } else if (entry.item.kind === "paragraph") {
            if (pendingOuterGap > 0) { result.push(glue(pendingOuterGap)); pendingOuterGap = 0; }
            const lines = vlist.paragraphPlacements.find((candidate) => key(candidate.vlistPath) === key(entry.path))?.lineIndices ?? [];
            const adjustments = [...(entry.item.paragraph.verticalAdjustments ?? [])];
            for (const [index, lineIndex] of lines.entries()) {
              const line = item.paragraph.layout.report.lines.find((candidate) => candidate.lineIndex === lineIndex)!;
              const lineTop = Number(vlist.linePlacements.find((candidate) => candidate.lineIndex === lineIndex)!.y);
              if (index > 0) result.push({ kind: "penalty", penalty: (index === 1 ? 150 : 0) + (index === lines.length - 1 ? 150 : 0) });
              if (lineTop > cursor) result.push(glue(lineTop - cursor));
              const sliced = sliceParagraphLine(item, lineIndex);
              result.push({ kind: "box", height: Number(line.ascent), depth: Number(line.descent), placement: { item: sliced, contentTop: 0, referenceY: Number(line.ascent), visualTop: 0, visualBottom: Number(line.ascent + line.descent) } });
              cursor = lineTop + Number(line.ascent + line.descent);
              const sourceEnd = Math.max(Number(line.break?.sourceOffset ?? -1), ...line.segments.map(segment => Number(segment.sourceEndRaw ?? -1)));
              for (let adjustmentIndex = 0; adjustmentIndex < adjustments.length;) {
                const adjustment = adjustments[adjustmentIndex];
                if (!adjustment.sourceSpan || adjustment.sourceSpan.start > sourceEnd) { adjustmentIndex++; continue; }
                const command = breaks.get(Number(adjustment.sourceSpan.start));
                if (command) result.push({ kind: "penalty", penalty: command.penalty });
                adjustments.splice(adjustmentIndex, 1);
              }
            }
          } else if (entry.item.kind !== "hbox" || entry.item.role?.kind !== "list-label") {
            if (pendingOuterGap > 0) { result.push(glue(pendingOuterGap)); pendingOuterGap = 0; }
            if (Number(entry.y) > cursor) result.push(glue(Number(entry.y) - cursor));
            const sliced = sliceParagraphBox(item, entry);
            result.push({ kind: "box", height: Number(entry.metrics.height), depth: Number(entry.metrics.depth),
              placement: { item: sliced, contentTop: 0, referenceY: Number(entry.metrics.height), visualTop: 0, visualBottom: Number(entry.metrics.height + entry.metrics.depth) },
            });
            cursor = Number(entry.y + entry.metrics.height + entry.metrics.depth);
          }
        }
      };
      walk(vlist.items);
      const extra = item.naturalHeight - cursor;
      if (extra > 0) result.push(glue(extra, item.trailingListGlue.naturalPt > 0 ? 2 : 3, item.trailingListGlue.shrinkPt || 5));
    }
    outerCursor = placement.visualBottom;
    if (item.kind === "block") { const skip = item.block.plan.geometry.afterSkipPt; result.push(glue(skip, skip / 3, skip / 3)); outerCursor += skip; }
  }
  return result;
}

function badness(amount: number, stretch: number): number {
  if (amount <= 0) return 0;
  if (stretch <= 0) return 10000;
  return Math.min(10000, Math.round(100 * (amount / stretch) ** 3));
}

/** TeX's vert_break cost and prune_page_top rules on unboxed frame material. */
function splitMaterial(material: readonly VerticalMaterial[], target: number, header: number, topStretch: number): number {
  let height = header;
  let previousDepth = 0;
  let stretch = topStretch;
  let shrink = 0;
  let infiniteStretch = false;
  let bestCost = Number.POSITIVE_INFINITY;
  let best = -1;
  let boxes = 0;
  for (const [index, item] of material.entries()) {
    const penalty = item.kind === "penalty" ? item.penalty : item.kind === "glue" && material[index - 1]?.kind === "box" ? 0 : 10000;
    if (penalty < 10000 && boxes > 0) {
      const over = height - target;
      const b = over > 0 ? over > shrink ? 10001 : badness(over, shrink) : infiniteStretch ? 0 : badness(-over, stretch);
      const cost = b > 10000 ? 100000 : penalty <= -10000 ? penalty : b === 10000 ? 100000 : b + penalty;
      if (cost <= bestCost) { bestCost = cost; best = index; }
      if (b > 10000 || penalty <= -10000) return best >= 0 ? best : index;
    }
    if (item.kind === "box") { height += previousDepth + item.height; previousDepth = item.depth; boxes++; }
    else if (item.kind === "glue") { height += previousDepth + item.size; previousDepth = 0; stretch += item.order === 0 ? item.stretch : 0; shrink += item.shrink; infiniteStretch ||= item.order > 0 && item.stretch > 0; }
  }
  return material.length;
}

export function splitBeamerFrameContinuations(params: {
  flow: readonly PreparedFrameFlowItem[]; baselineSkip: number; plain: boolean;
  factor: number; paperHeight: number; textHeight: number; titleHeight: number;
  alignment: "top" | "center" | "bottom"; footnoteHeight: number; breaks: BeamerContinuationBreaks;
  plainExitHeight: number;
}): { items: PositionedFrameFlowItem[]; extent: number }[] {
  let remaining = frameMaterial(params.flow, params.baselineSkip, params.plain, params.breaks);
  const parts: VerticalMaterial[][] = [];
  const topNatural = params.alignment === "top" ? .2 * 72.27 / 2.54 : 0;
  const topStretch = params.alignment === "center" ? .4 * params.paperHeight : params.alignment === "top" ? .5 * params.paperHeight : 0;
  while (remaining.some((item) => item.kind === "box")) {
    const limit = splitMaterial(remaining, params.factor * params.textHeight, params.titleHeight + topNatural, topStretch);
    parts.push(remaining.slice(0, limit));
    remaining = remaining.slice(limit);
    while (remaining.length && remaining[0].kind !== "box") remaining = remaining.slice(1);
    const first = remaining[0];
    if (first?.kind === "box") remaining = [glue(Math.max(0, params.baselineSkip - (first.splitTopHeight ?? first.height))), ...remaining];
    if (parts.length > 1000) throw new Error("Beamer continuation splitting did not make progress.");
  }
  if (!parts.length) parts.push([]);
  return parts.map((part, pageIndex) => {
    const materialHeight = part.reduce((sum, item) => sum + (item.kind === "box" ? item.height + item.depth : item.kind === "glue" ? item.size : 0), 0);
    const available = params.textHeight + params.plainExitHeight - params.titleHeight - topNatural - (pageIndex === parts.length - 1 ? params.footnoteHeight : 0);
    const free = available - materialHeight;
    const topOrder = params.alignment === "bottom" ? 2 : 0;
    const bottomOrder = params.alignment === "top" ? 2 : 0;
    const topWeight = topOrder === 2 ? 1 : topStretch;
    const bottomWeight = bottomOrder === 2 ? 1 : params.alignment === "center" ? .6 * params.paperHeight : 0;
    const order = Math.max(topOrder, bottomOrder, ...part.map((item) => item.kind === "glue" && item.stretch > 0 ? item.order : 0));
    const stretch = (topOrder === order ? topWeight : 0) + (bottomOrder === order ? bottomWeight : 0) + part.reduce((sum, item) => sum + (item.kind === "glue" && item.order === order ? item.stretch : 0), 0);
    const shrink = part.reduce((sum, item) => sum + (item.kind === "glue" ? item.shrink : 0), 0);
    const ratio = free >= 0 ? stretch > 0 ? free / stretch : 0 : shrink > 0 ? Math.max(-1, free / shrink) : 0;
    let cursor = topNatural + (free >= 0 && topOrder === order ? topWeight * ratio : 0);
    const items: PositionedFrameFlowItem[] = [];
    for (const item of part) {
      if (item.kind === "box") {
        items.push({ ...item.placement, contentTop: cursor + item.placement.contentTop, referenceY: cursor + item.placement.referenceY, visualTop: cursor + item.placement.visualTop, visualBottom: cursor + item.placement.visualBottom });
        cursor += item.height + item.depth;
      } else if (item.kind === "glue") cursor += item.size + (free >= 0 ? item.order === order ? item.stretch * ratio : 0 : item.shrink * ratio);
    }
    return { items, extent: cursor };
  });
}
