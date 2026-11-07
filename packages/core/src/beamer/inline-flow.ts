import type { Span } from "../ast/types.js";
import { createMappedText, concatMappedText, sliceMappedText, type MappedText } from "../text/source-map.js";
import type { PreparedFrameFlowItem } from "./render-model.js";

export type BeamerInlineFlow = {
  span: Span;
  width: number;
  item: Extract<PreparedFrameFlowItem, { kind: "block" | "columns" }>;
};

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
    const text = String.raw`\par\begin{minipage}{1pt}X\end{minipage}\par`;
    parts.push(sliceMappedText(mapped, cursor, index), createMappedText(text,
      Array.from({ length: text.length }, () => ({ kind: "direct" as const, from: box.span.from, to: box.span.to })),
      Array.from({ length: text.length + 1 }, (_, i) => ({ kind: "offset" as const, offset: i === text.length ? box.span.to : box.span.from }))));
    cursor = end + 1; index = end;
  }
  if (!cursor) return mapped;
  parts.push(sliceMappedText(mapped, cursor, mapped.text.length));
  return concatMappedText(parts);
}
