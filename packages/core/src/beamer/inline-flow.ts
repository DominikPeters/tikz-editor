import type { Span } from "../ast/types.js";
import { createMappedText, concatMappedText, sliceMappedText, type MappedText } from "../text/source-map.js";
import type { LaidParagraph, PreparedFrameFlowItem, PreparedColumnFlowItem, PreparedFlowBox, PreparedTemplateFlowItem } from "./render-model.js";

export type BeamerInlineFlow = {
  span: Span;
  width: number;
  labelTargetOffset?: number;
  item: PreparedFlowBox | PreparedTemplateFlowItem;
};

const inlineFlowBox = String.raw`\begin{minipage}{1pt}X\end{minipage}`;
const paragraphBreak = String.raw`\par`;

/** Preserve the list/group's native TeX scope. The minipage is only an IR
 * boundary; its box is replaced by the measured Beamer material before layout. */
export function projectBeamerInlineFlow(mapped: MappedText, boxes: readonly BeamerInlineFlow[]): MappedText {
  const byStart = new Map(boxes.map(box => [box.span.from, box]));
  const parts: MappedText[] = [];
  let cursor = 0;
  for (let index = 0; index < mapped.text.length; index++) {
    const origin = mapped.sourceMap.charOrigins[index];
    const box = origin?.kind === "direct" ? byStart.get(origin.from) : undefined;
    if (!box) continue;
    let end = index;
    while (end < mapped.text.length) {
      const last = mapped.sourceMap.charOrigins[end];
      if (last?.kind === "direct" && last.to === box.span.to) break;
      end++;
    }
    if (end === mapped.text.length) continue;
    const text = paragraphBreak + inlineFlowBox + paragraphBreak;
    parts.push(sliceMappedText(mapped, cursor, index), createMappedText(text,
      Array.from({ length: text.length }, () => ({ kind: "direct" as const, from: box.span.from, to: box.span.to })),
      Array.from({ length: text.length + 1 }, (_, i) => ({ kind: "offset" as const, offset: i === text.length ? box.span.to : box.span.from }))));
    cursor = end + 1; index = end;
  }
  if (!cursor) return mapped;
  parts.push(sliceMappedText(mapped, cursor, mapped.text.length));
  return concatMappedText(parts);
}

export function beamerInlineListEffects(mapped: MappedText, boxes: readonly BeamerInlineFlow[], inMinipage: boolean) {
  if (boxes.length === 0) return {};
  const boxesClearingPendingItemLabels: number[] = [];
  const minipageListDepthResets: number[] = [];
  const syntheticParagraphBreaks: number[] = [];
  for (const match of mapped.text.matchAll(/\\begin\{minipage\}/gu)) {
    const origin = mapped.sourceMap.charOrigins[match.index];
    if (origin?.kind !== "direct") continue;
    const box = boxes.find(box => box.span.from === origin.from);
    if (!box) continue;
    if (mapped.text.startsWith(inlineFlowBox, match.index)) {
      syntheticParagraphBreaks.push(match.index - paragraphBreak.length, match.index + inlineFlowBox.length);
    }
    if (box.item.kind === "title-page" || box.item.kind === "contents") continue;
    // List/trivlist everypar and endtrivlist clear @inlabel globally.
    if (containsListScope(box.item, "trivlist")) boxesClearingPendingItemLabels.push(match.index);
    if (inMinipage && resetsMinipageListDepth(box.item)) minipageListDepthResets.push(match.index);
  }
  return {
    ...(boxesClearingPendingItemLabels.length ? { boxesClearingPendingItemLabels } : {}),
    ...(minipageListDepthResets.length ? { minipageListDepthResets } : {}),
    ...(syntheticParagraphBreaks.length ? { syntheticParagraphBreaks } : {}),
  };
}

/** LaTeX minipages share @mplistdepth. A nested minipage starts it at
 * zero and a list globally changes the register, replacing the outer value. */
function resetsMinipageListDepth(item: PreparedFlowBox | PreparedFrameFlowItem | PreparedColumnFlowItem): boolean {
  if (item.kind === "columns") return containsListScope(item, "quote");
  if (item.kind !== "block") return false;
  return item.block.plan.style === "rounded" && containsListScope(item, "quote") ||
    !!item.block.bodyFlow?.items.some(flow => resetsMinipageListDepth(flow.item));
}

export function containsListScope(item: PreparedFlowBox | PreparedFrameFlowItem | PreparedColumnFlowItem, otherScope: "quote" | "trivlist"): boolean {
  // An embedded box records whether its own vertical lists hold such a scope.
  const contains = (paragraph: LaidParagraph | null) =>
    paragraph?.layout.vlistLayout.boxReport.items.some(box => box.role?.kind === "list" || box.role?.kind === otherScope ||
      box.hboxRole?.kind === "external-flow" && (otherScope === "trivlist" ? box.hboxRole.containsList === true : box.hboxRole.containsQuoteList === true)) ?? false;
  if (item.kind === "paragraph") return contains(item.paragraph);
  if (item.kind === "block") return contains(item.block.body) ||
    !!item.block.bodyFlow?.items.some(flow => containsListScope(flow.item, otherScope));
  if (item.kind === "columns") return item.columns.some(column => column.flow.some(child => containsListScope(child, otherScope)));
  return false;
}
