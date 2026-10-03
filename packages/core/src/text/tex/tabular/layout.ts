import { concatMappedText, createGeneratedMappedText, createIdentityMappedText, type MappedText } from "../../source-map.js";
import { texHBoxLocalX, texHBoxLocalY, texHBoxX, texHBoxY, texLength, type TexLength } from "../coordinates.js";
import { parseTexDimensionExpression, resolveTexDimensionExpression, texDimensionContextForFont, type TexDimensionContext } from "../dimensions.js";
import type { ResolvedTexFont, TexMetricProvider } from "../fonts/types.js";
import type { TexTextFontProfile } from "../fonts/text-profile.js";
import { simpleTexInlineNodesToTokens, parseSimpleTexInlineNodes, type SimpleTexFontState, type SimpleTexInlineNode, type SimpleTexToken, type TexSpaceGlueProfile } from "../ir.js";
import { simpleTexInlineTokensToLayoutItems, texMBoxHListFromLayoutItems, type TexMathBox, type TexMathBoxProvider, type TexMathCaretEntry } from "../layout-inline-items.js";
import { layoutSimpleTexParagraph } from "../layout-simple.js";
import { defaultTexMathFontProfile } from "../math/font-profile.js";
import type { TexMathChildHListLayoutItem, TexMathHList, TexMathHListItem, TexMathRuleLayoutItem } from "../math/layout.js";
import type { DocumentGraphicsResolver } from "../../../graphics/types.js";
import type { TexTabular, TexTabularCell, TexTabularColumn, TexTabularDimension, TexTabularLayoutProfile, TexTabularRegisters, TexTabularRule, TexTabularSourcePart } from "./types.js";

interface TableLayoutParams {
  readonly table: TexTabular;
  readonly source: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly fontState: SimpleTexFontState;
  readonly atPt: TexLength;
  readonly metricProvider: TexMetricProvider;
  readonly textFontProfile: TexTextFontProfile;
  readonly mathBoxProvider?: TexMathBoxProvider;
  readonly graphicsResolver?: DocumentGraphicsResolver;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
  readonly dimensionContext?: TexDimensionContext;
  readonly tabularProfile?: TexTabularLayoutProfile;
}
interface MeasuredCell { cell: TexTabularCell; column: TexTabularColumn; box: TexMathHList; index: number; }
function scaledPt(value: number): TexLength { return texLength(Math.round(value * 65536) / 65536); }
// TeX scans decimal factors as 16-bit fractions and truncates their product.
function fractionPt(value: number, factor: number): TexLength {
  return texLength(Math.trunc(Math.round(value * 65536) * Math.round(factor * 65536) / 65536) / 65536);
}
function baselineForSize(size: number): number { return ({ 5: 6, 6: 7, 7: 8, 8: 9.5, 9: 11, 10: 12, 10.95: 13.6, 12: 14, 14.4: 18, 17.28: 22, 20.74: 25, 24.88: 30 } as Record<number, number>)[size] ?? size * 1.2; }
function boxChild(box: TexMathHList, x: number, y: number, span: { start: number; end: number }): TexMathChildHListLayoutItem {
  return { kind: "hlist", role: "array-cell", x: texHBoxLocalX(x), y: texHBoxLocalY(y), width: box.width, height: box.height, depth: box.depth, sourceSpan: span, items: box.items };
}
function preamblePieces(parts: readonly TexTabularSourcePart[]): TexTabularSourcePart[] {
  return parts.flatMap((part) => {
    const pieces: TexTabularSourcePart[] = []; let start = 0;
    for (const match of part.text.matchAll(/\\(?:arraybackslash|raggedright|raggedleft|centering|noindent)\b/gu)) {
      pieces.push({ text: part.text.slice(start, match.index), sourceStart: part.sourceStart + start, sourceEnd: part.sourceStart + match.index });
      start = match.index + match[0].length;
    }
    pieces.push({ text: part.text.slice(start), sourceStart: part.sourceStart + start, sourceEnd: part.sourceEnd });
    return pieces;
  });
}
function preambleNodes(parts: readonly TexTabularSourcePart[]): SimpleTexInlineNode[] {
  return preamblePieces(parts).flatMap((part) => {
    const parsed = parseSimpleTexInlineNodes(part.text, part.sourceStart);
    if (parsed.unsupportedCommand) throw new Error("Unsupported vertical material in tabular preamble.");
    return parsed.nodes;
  });
}
function mappedPreamble(parts: readonly TexTabularSourcePart[]): MappedText[] {
  return preamblePieces(parts).flatMap((part) => [createIdentityMappedText(part.text, part.sourceStart), ...(/\\[A-Za-z@]+$/u.test(part.text) ? [createGeneratedMappedText("{}", "tabular-column-control-word-end", { from: part.sourceStart, to: part.sourceEnd })] : [])]);
}
function cellTokens(cell: TexTabularCell, column: TexTabularColumn, fontState: SimpleTexFontState): SimpleTexToken[] {
  if (column.before?.trim() === "$" && column.after?.trim() === "$") {
    return simpleTexInlineNodesToTokens([{ kind: "math", text: `$${cell.text}$`, delimiter: "dollar", content: cell.text, sourceStart: cell.sourceStart, sourceEnd: cell.sourceEnd, contentStart: cell.sourceStart, contentEnd: cell.sourceEnd }], fontState);
  }
  const before = preambleNodes(column.beforeParts ?? []);
  const parsedBody = parseSimpleTexInlineNodes(cell.text, cell.sourceStart);
  if (parsedBody.unsupportedCommand) throw new Error("Unsupported vertical material in tabular LR cell.");
  const body = parsedBody.nodes;
  const after = preambleNodes(column.afterParts ?? []);
  return simpleTexInlineNodesToTokens([...before, ...body, ...after], fontState);
}
function naturalCell(cell: TexTabularCell, column: TexTabularColumn, params: TableLayoutParams, trimEdges = true): TexMathHList {
  const inline = simpleTexInlineTokensToLayoutItems({ tokens: cellTokens(cell, column, params.fontState), ...params, trimEdges });
  const box = texMBoxHListFromLayoutItems({ items: inline, sourceSpan: { start: cell.sourceStart, end: cell.sourceEnd }, metricProvider: params.metricProvider });
  if (!box) throw new Error("Unsupported vertical material in tabular LR cell.");
  return box;
}
function paragraphCell(cell: TexTabularCell, column: TexTabularColumn, params: TableLayoutParams, width: number, baselineSkip: number, strutDepth: number): TexMathHList {
  if (!cell.text.trim()) return { kind: "math-hlist", style: "text", width: texLength(width), height: texLength(0), depth: texLength(strutDepth), sourceSpan: { start: cell.sourceStart, end: cell.sourceEnd }, items: [] };
  const prefix = preambleNodes(column.beforeParts ?? []);
  const selected = simpleTexInlineNodesToTokens([...prefix, { kind: "text", text: "x", sourceStart: cell.sourceStart, sourceEnd: cell.sourceStart }], params.fontState).at(-1)?.fontState ?? params.fontState;
  const font = params.textFontProfile.resolveTextFont(selected, params.atPt, params.metricProvider);
  const cellBaselineSkip = selected.sizePt !== params.fontState.sizePt ? baselineForSize(font.atPt) : baselineSkip;
  const alignment = /\\raggedright\b/u.test(column.before ?? "") ? "ragged-right" : /\\centering\b/u.test(column.before ?? "") ? "center" : /\\raggedleft\b/u.test(column.before ?? "") ? "ragged-left" : "justified";
  const mapped = concatMappedText([
    ...mappedPreamble(column.beforeParts ?? []),
    createIdentityMappedText(cell.text, cell.sourceStart),
    ...mappedPreamble(column.afterParts ?? []),
  ]);
  const layout = layoutSimpleTexParagraph(mapped.text, { width, alignment, font, baselineSkip: cellBaselineSkip, parindent: 0, textFontProfile: { ...params.textFontProfile, defaultFontState: params.fontState }, mathBoxProvider: params.mathBoxProvider, metricProvider: params.metricProvider, graphicsResolver: params.graphicsResolver, dimensionContext: params.dimensionContext, tabularProfile: params.tabularProfile, sourceMap: mapped.sourceMap });
  if (!layout.supported || !layout.report || !layout.vlistLayout) throw new Error(layout.fallbackReason ?? "Unsupported tabular paragraph cell.");
  const placements = new Map(layout.vlistLayout.linePlacements.map((line) => [line.lineIndex, line]));
  const firstLine = layout.report.lines[0];
  if (!firstLine) return { kind: "math-hlist", style: "text", width: texLength(width), height: texLength(0), depth: texLength(strutDepth), sourceSpan: { start: cell.sourceStart, end: cell.sourceEnd }, items: [] };
  const firstBaseline = Number(placements.get(firstLine.lineIndex)?.y ?? 0) + firstLine.ascent;
  const items: TexMathHListItem[] = [];
  let depth = strutDepth;
  for (const line of layout.report.lines) {
    const position = placements.get(line.lineIndex);
    const y = Number(position?.y ?? 0) + line.ascent - firstBaseline;
    for (const segment of line.segments) {
      if (segment.kind === "text" && segment.text && segment.fontId) {
        const part = texMBoxHListFromLayoutItems({ sourceSpan: { start: Number(segment.sourceStartRaw ?? cell.sourceStart), end: Number(segment.sourceEndRaw ?? cell.sourceEnd) }, metricProvider: params.metricProvider, items: [{ kind: "text", text: segment.text, sourceStart: Number(segment.sourceStartRaw ?? cell.sourceStart), sourceEnd: Number(segment.sourceEndRaw ?? cell.sourceEnd), font: params.metricProvider.resolveFont({ fontId: segment.fontId, atPt: segment.fontAtPt ?? font.atPt }), italicCorrectionAfter: false, spaceFactorBefore: 1000, spaceFactorAfter: 1000 }] });
        if (part) items.push(boxChild(part, Number(position?.x ?? 0) + Number(segment.x), y, part.sourceSpan));
      } else if (segment.kind === "math" && segment.mathSvgBody) {
        items.push({ kind: "hlist", role: "array-cell", x: texHBoxLocalX(Number(position?.x ?? 0) + Number(segment.x)), y: texHBoxLocalY(y), width: segment.width, height: line.ascent, depth: line.descent, sourceSpan: { start: Number(segment.sourceStartRaw ?? cell.sourceStart), end: Number(segment.sourceEndRaw ?? cell.sourceEnd) }, items: [], svgBody: segment.mathSvgBody });
      }
    }
    depth = Math.max(depth, y + Math.max(line.descent, strutDepth));
  }
  return { kind: "math-hlist", style: "text", width: texLength(width), height: firstLine.ascent, depth: texLength(depth), sourceSpan: { start: cell.sourceStart, end: cell.sourceEnd }, items };
}

export function layoutTexTabularBox(params: TableLayoutParams): TexMathBox {
  const { table, metricProvider } = params;
  const font: ResolvedTexFont = params.textFontProfile.resolveTextFont(params.fontState, params.atPt, metricProvider);
  const context = texDimensionContextForFont(params.dimensionContext ?? { linewidth: texLength(100), textwidth: texLength(100), columnwidth: texLength(100), paperwidth: texLength(100), em: font.atPt, ex: texLength(font.atPt * .43) }, font);
  const dimension = (raw: TexTabularDimension | undefined, fallback: number): number => {
    if (raw === undefined) return fallback;
    const assignment = typeof raw === "string" ? undefined : raw;
    const declarationFont = assignment ? params.textFontProfile.resolveTextFont({ family: assignment.font.family ?? params.textFontProfile.defaultFontState.family, series: assignment.font.series ?? params.textFontProfile.defaultFontState.series, shape: assignment.font.shape ?? params.textFontProfile.defaultFontState.shape, ...(assignment.font.sizePt !== undefined ? { sizePt: texLength(assignment.font.sizePt) } : {}) }, texLength(params.tabularProfile?.booktabsFontSizePt ?? params.atPt), metricProvider) : font;
    const parsed = parseTexDimensionExpression(typeof raw === "string" ? raw : raw.value);
    const resolved = parsed && resolveTexDimensionExpression(parsed, assignment ? texDimensionContextForFont(context, declarationFont) : context);
    if (resolved === null || resolved === undefined || !Number.isFinite(resolved)) throw new Error(`Unsupported table dimension ${typeof raw === "string" ? raw : raw.value}.`);
    return scaledPt(resolved);
  };
  const registers: TexTabularRegisters = { ...params.tabularProfile?.registers, ...params.fontState.tabularRegisters };
  const sep = dimension(registers.tabcolsep, 6); const ruleWidth = dimension(registers.arrayrulewidth, .4); const doubleSep = dimension(registers.doublerulesep, 2);
  const normalSkip = params.fontState.sizePt === undefined ? params.tabularProfile?.baselineSkipPt ?? baselineForSize(font.atPt) : baselineForSize(font.atPt);
  const stretch = registers.arraystretch ?? 1;
  const strutHeight = fractionPt(fractionPt(normalSkip, .7) + dimension(registers.extrarowheight, 0), stretch);
  const strutDepth = fractionPt(fractionPt(normalSkip, .3), stretch);
  const arrayPackage = params.tabularProfile?.arrayPackage === true;
  const bookSize = params.tabularProfile?.booktabsFontSizePt ?? params.atPt;
  const bookFont = params.textFontProfile.resolveTextFont({ ...params.fontState, sizePt: texLength(bookSize) }, texLength(bookSize), metricProvider);
  const bookEx = params.tabularProfile?.booktabsXHeightPt ?? bookFont.atPt * bookFont.data.fontdimen.xheight;
  const heavy = dimension(registers.heavyrulewidth, fractionPt(bookSize, .08)); const light = dimension(registers.lightrulewidth, fractionPt(bookSize, .05)); const midWidth = dimension(registers.cmidrulewidth, fractionPt(bookSize, .03));
  const above = dimension(registers.aboverulesep, fractionPt(bookEx, .4)); const below = dimension(registers.belowrulesep, fractionPt(bookEx, .65));
  const boundaries = table.preamble.boundaries;
  const boundaryBoxes = boundaries.map((boundary) => {
    const parts = [...boundary.replaceParts ?? [], ...boundary.insertParts ?? []];
    const inline = simpleTexInlineTokensToLayoutItems({ tokens: simpleTexInlineNodesToTokens(preambleNodes(parts), params.fontState), ...params, trimEdges: false });
    const sourceSpan = { start: parts[0]?.sourceStart ?? table.contentStart, end: parts.at(-1)?.sourceEnd ?? table.contentStart };
    const box = texMBoxHListFromLayoutItems({ items: inline, sourceSpan, metricProvider });
    if (!box) throw new Error("Unsupported vertical material in tabular boundary insert.");
    return box;
  });
  const boundaryWidths = boundaries.map((boundary, i) => boundaryBoxes[i].width + (boundary.replace !== undefined ? 0 : sep * (i === 0 || i === boundaries.length - 1 ? 1 : 2)) + Math.max(0, boundary.rules - 1) * doubleSep + (arrayPackage ? boundary.rules * ruleWidth : 0));
  const widths = table.preamble.columns.map((column) => column.width ? dimension(column.width, 0) : 0);
  const rows = new Map<number, MeasuredCell[]>();
  for (let index = 0; index < table.items.length; index++) {
    const row = table.items[index]; if (row.kind !== "row") continue;
    let col = 0; const measured: MeasuredCell[] = [];
    for (const cell of row.cells) {
      if (col + cell.span > widths.length) throw new Error("Too many tabular cells.");
      const column = cell.preamble?.columns[0] ?? table.preamble.columns[col];
      let box = column.width ? paragraphCell(cell, column, params, dimension(column.width, 0), normalSkip, strutDepth) : naturalCell(cell, column, params);
      if (column.width) {
        box = { ...box, height: texLength(Math.max(box.height, strutHeight)) };
        if (column.alignment === "middle" || column.alignment === "bottom") {
          if (!arrayPackage) throw new Error("Array m/b paragraph columns require the array package.");
          const shiftToLastBaseline = box.depth - strutDepth;
          const vboxHeight = box.height + shiftToLastBaseline;
          // The surrounding alignment sets baselineskip=0; @endpbox restores that
          // before array.sty runs ar@align@mcell.
          const lower = column.alignment === "middle" && vboxHeight > fractionPt(normalSkip, .7) ? fractionPt(vboxHeight - strutHeight, .5) : 0;
          box = { ...box, height: texLength(vboxHeight - lower), depth: texLength(strutDepth + lower), items: [boxChild(box, 0, lower - shiftToLastBaseline, box.sourceSpan)] };
        }
      }
      measured.push({ cell, column, box, index: col });
      if (cell.span === 1) widths[col] = Math.max(widths[col], box.width);
      col += cell.span;
    }
    rows.set(index, measured);
  }
  for (const row of rows.values()) for (const { cell, box, index } of row) {
    if (cell.span <= 1) continue;
    const start = index; const end = index + cell.span;
    const replacement = cell.preamble!;
    const left = replacement.boundaries[0].replace === undefined ? sep : dimension("0pt", 0); const right = replacement.boundaries[1].replace === undefined ? sep : 0;
    const existing = widths.slice(start, end).reduce((sum, n) => sum + n, 0) + boundaryWidths.slice(start + 1, end).reduce((sum, n) => sum + n, 0) + boundaryWidths[start] / (start === 0 ? 1 : 2) + boundaryWidths[end] / (end === widths.length ? 1 : 2);
    const deficit = box.width + left + right - existing;
    if (deficit > 0) widths[end - 1] += deficit;
  }
  const cellStarts: number[] = []; const boundaryStarts: number[] = []; let width = 0;
  for (let i = 0; i < widths.length; i++) { boundaryStarts.push(width); width += boundaryWidths[i]; cellStarts.push(width); width += widths[i]; }
  boundaryStarts.push(width); width += boundaryWidths.at(-1)!;
  const logicalColumnEdge = (index: number): number => index === 0 ? 0 : index === widths.length ? width : cellStarts[index] - (boundaries[index].replace !== undefined ? 0 : sep);
  const items: TexMathHListItem[] = []; let y = 0; let firstBaseline = 0; let lastDepth = 0; let lastBookClass = 0;
  const rectangle = (x: number, top: number, w: number, h: number, source: { start: number; end: number }): TexMathRuleLayoutItem => ({ kind: "rule", role: "array-rule", x: texHBoxLocalX(x), y: texHBoxLocalY(top), width: texLength(Math.max(0, w)), height: texLength(h), sourceSpan: source });
  const paintRule = (rule: TexTabularRule, top: number, h: number) => {
    const first = (rule.from ?? 1) - 1; const last = rule.to ?? widths.length;
    if (first < 0 || last > widths.length || first >= last) throw new Error("Invalid table rule range.");
    const left = rule.trimLeft === "default" ? dimension(registers.cmidrulekern, fractionPt(bookSize, .5)) : dimension(rule.trimLeft, 0);
    const right = rule.trimRight === "default" ? dimension(registers.cmidrulekern, fractionPt(bookSize, .5)) : dimension(rule.trimRight, 0);
    const x = logicalColumnEdge(first);
    const edge = logicalColumnEdge(last);
    items.push(rectangle(x + left, top, edge - x - left - right, h, { start: rule.sourceStart, end: rule.sourceEnd }));
  };
  for (let index = 0; index < table.items.length; index++) {
    const item = table.items[index]; const next = table.items[index + 1];
    if (item.kind === "rule") {
      if (item.command === "morecmidrules") { y += doubleSep; continue; }
      if (item.command === "addlinespace") { y += dimension(item.below, dimension(registers.defaultaddspace, fractionPt(bookSize, .5))); lastBookClass = 2; continue; }
      if (item.command === "hline" || item.command === "cline") {
        paintRule(item, y, ruleWidth); if (item.command === "hline") y += ruleWidth + (next?.kind === "rule" && next.command === "hline" ? doubleSep - (arrayPackage ? 0 : ruleWidth) : 0);
        lastBookClass = 0; continue;
      }
      const partial = item.command === "cmidrule";
      const thickness = dimension(item.width, partial ? midWidth : item.command === "midrule" ? light : heavy);
      const aboveSkip = item.command === "toprule" ? dimension(registers.abovetopsep, 0) : above;
      if (item.command === "specialrule") y += dimension(item.above, 0);
      else if (lastBookClass === 0) y += aboveSkip;
      else if (!partial && lastBookClass === 1) y += doubleSep;
      paintRule(item, y, thickness); y += thickness;
      if (partial && next?.kind === "rule" && next.command === "cmidrule") { y -= thickness; lastBookClass = 1; continue; }
      const nextBookRule = next?.kind === "rule" && !["hline", "cline"].includes(next.command);
      if (partial || !nextBookRule) y += item.command === "bottomrule" ? dimension(registers.belowbottomsep, 0) : item.command === "specialrule" ? dimension(item.below, 0) : below;
      lastBookClass = nextBookRule ? item.command === "specialrule" ? 2 : 1 : 0;
      continue;
    }
    const row = rows.get(index)!;
    let height: number = strutHeight; let depth: number = strutDepth;
    for (const cell of row) { height = Math.max(height, cell.box.height); depth = Math.max(depth, cell.box.depth); }
    const extra = dimension(item.extraDepth, 0); if (extra > 0) depth = Math.max(depth, strutDepth + extra);
    const baseline = y + height; if (!firstBaseline) firstBaseline = baseline; lastDepth = depth;
    for (const { cell, box, column, index: col } of row) {
      const spanEnd = col + cell.span;
      let available = widths.slice(col, spanEnd).reduce((sum, n) => sum + n, 0) + boundaryWidths.slice(col + 1, spanEnd).reduce((sum, n) => sum + n, 0);
      let x = cellStarts[col];
      if (cell.preamble) { const boundaryStart = logicalColumnEdge(col); const boundaryEnd = logicalColumnEdge(spanEnd); const left = cell.preamble.boundaries[0].replace === undefined ? sep : 0; const right = cell.preamble.boundaries[1].replace === undefined ? sep : 0; x = boundaryStart + left; available = boundaryEnd - boundaryStart - left - right; }
      if (column.alignment === "center") x += (available - box.width) / 2; else if (column.alignment === "right") x += available - box.width;
      items.push(boxChild(box, x, baseline, { start: cell.sourceStart, end: cell.sourceEnd }));
    }
    const omittedBoundaries = new Set<number>();
    const rowBoundaries = new Map<number, typeof boundaries[number]>();
    for (const { cell, index: col } of row) {
      if (!cell.preamble) continue;
      for (let i = col + 1; i < col + cell.span; i++) omittedBoundaries.add(i);
      rowBoundaries.set(col, cell.preamble.boundaries[0]);
      rowBoundaries.set(col + cell.span, cell.preamble.boundaries[1]);
    }
    for (let i = 0; i < boundaries.length; i++) {
      if (omittedBoundaries.has(i)) continue;
      const boundary = rowBoundaries.get(i) ?? boundaries[i]; const insertX = boundaryStarts[i] + (boundary.replace !== undefined ? 0 : sep);
      if (!rowBoundaries.has(i) && boundaryBoxes[i].width) items.push(boxChild(boundaryBoxes[i], insertX, baseline, boundaryBoxes[i].sourceSpan));
      const ruleRunWidth = Math.max(0, boundary.rules - 1) * doubleSep + (arrayPackage ? boundary.rules * ruleWidth : 0);
      const ruleStart = i === 0 ? 0 : i === widths.length ? width - ruleRunWidth : cellStarts[i] - sep - ruleRunWidth;
      for (let r = 0; r < boundary.rules; r++) items.push(rectangle(ruleStart - (arrayPackage ? 0 : ruleWidth / 2) + r * (doubleSep + (arrayPackage ? ruleWidth : 0)), y, ruleWidth, height + depth, { start: table.contentStart, end: table.contentStart }));
    }
    y = baseline + depth + (extra < 0 ? extra : 0); lastBookClass = 0;
  }
  // vtop uses the first physical node's height; vbox keeps the last node's
  // depth. Rules and booktabs' surrounding glue therefore change t/b anchors.
  const firstItem = table.items[0]; const lastItem = table.items.at(-1);
  const firstHeight = firstItem?.kind === "rule" ? ["hline", "cline"].includes(firstItem.command) ? ruleWidth : 0 : firstBaseline;
  const finalDepth = lastItem?.kind === "rule" ? 0 : lastDepth;
  const tableHeight = table.alignment === "top" ? firstHeight : table.alignment === "bottom" ? y - finalDepth : y / 2 + fractionPt(font.atPt, .25);
  const shifted = items.map((item) => "y" in item ? { ...item, y: texHBoxLocalY(item.y - tableHeight) } : item);
  const sourceSpan = { start: params.sourceStart, end: params.sourceEnd };
  const hlist: TexMathHList = { kind: "math-hlist", style: "text", width: texLength(width), height: texLength(tableHeight), depth: texLength(y - tableHeight), sourceSpan, items: shifted };
  const caretEntries: TexMathCaretEntry[] = [];
  const collectCarets = (children: readonly TexMathHListItem[], x = 0, y = 0): void => {
    for (const item of children) {
      if (item.kind === "hlist") { collectCarets(item.items, x + item.x, y + item.y); continue; }
      if (item.kind !== "glyph") continue;
      const bounds = { xStart: texHBoxX(x + item.x), xEnd: texHBoxX(x + item.x + item.width), yStart: texHBoxY(y + item.y - item.height), yEnd: texHBoxY(y + item.y + item.depth) };
      for (const [sourceOffset, caretX] of [[item.sourceSpan.start, x + item.x], [item.sourceSpan.end, x + item.x + item.width]]) caretEntries.push({ sourceOffset, x: texHBoxX(caretX), y: texHBoxY(y + item.y), height: item.height, depth: item.depth, sourceSpan: item.sourceSpan, kind: "glyph-boundary", hitBounds: bounds, priority: 20 });
    }
  };
  collectCarets(hlist.items);
  return { caretMap: { sourceStart: params.sourceStart, sourceEnd: params.sourceEnd, contentStart: table.contentStart, contentEnd: table.contentEnd, entries: caretEntries }, source: params.source, content: params.source, sourceKind: "text", sourceStart: params.sourceStart, sourceEnd: params.sourceEnd, contentStart: table.contentStart, contentEnd: table.contentEnd, width: hlist.width, height: hlist.height, depth: hlist.depth, hlist, fontProfile: { ...defaultTexMathFontProfile, textFontProfile: params.textFontProfile, metricProvider } };
}
