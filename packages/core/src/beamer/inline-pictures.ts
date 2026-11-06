import type { Span } from "../ast/types.js";
import { concatMappedText, createMappedText, sliceMappedText, type MappedText } from "../text/source-map.js";
import type { PreparedColumnFlowItem } from "./render-model.js";

export type BeamerInlinePicture = {
  span: Span;
  tikz: Extract<PreparedColumnFlowItem, {kind: "tikzpicture"}>;
};

/** Let the normal TeX paragraph/trivlist frontend own the picture's box.
 * Its original range survives projection for painting, selection and carets. */
export function projectBeamerInlinePictures(mapped: MappedText, pictures: readonly BeamerInlinePicture[] = []): MappedText {
  if (!pictures.length || !mapped.text.includes("tikzpicture")) return mapped;
  const byStart = new Map(pictures.map(picture => [picture.span.from, picture]));
  const parts: MappedText[] = [];
  let cursor = 0;
  for (let index = 0; index < mapped.text.length; index++) {
    const first = mapped.sourceMap.charOrigins[index];
    const picture = first?.kind === "direct" ? byStart.get(first.from) : undefined;
    if (!picture) continue;
    let end = index;
    while (end < mapped.text.length) {
      const last = mapped.sourceMap.charOrigins[end];
      if (last?.kind === "direct" && last.to === picture.span.to) break;
      end++;
    }
    if (end === mapped.text.length) continue;
    const box = `\\phantom{\\rule{${picture.tikz.width}pt}{${picture.tikz.height}pt}}`;
    parts.push(sliceMappedText(mapped, cursor, index), createMappedText(box,
      Array.from({length:box.length}, () => ({kind:"direct" as const,from:picture.span.from,to:picture.span.to})),
      Array.from({length:box.length+1}, (_,i)=>({kind:"offset" as const,offset:i===box.length?picture.span.to:picture.span.from}))));
    cursor = end + 1;
    index = end;
  }
  if (cursor === 0) return mapped;
  parts.push(sliceMappedText(mapped, cursor, mapped.text.length));
  return concatMappedText(parts);
}
