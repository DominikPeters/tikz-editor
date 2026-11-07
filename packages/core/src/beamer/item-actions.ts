import type { BeamerOverlayItem } from "./overlay.js";
import type { MappedText } from "../text/source-map.js";

/** At the next item Beamer ends horizontal mode before closing actionenv.
 * At list end actionenv closes first: smuggle's empty group starts a resumed
 * paragraph after a display, which endtrivlist subsequently ships. */
export function beamerItemActionCommitsParagraph(mapped: MappedText, sourceEnd: number, items: readonly BeamerOverlayItem[]): boolean {
  let boundaryIndex = sourceEnd;
  while (/\s/u.test(mapped.text[boundaryIndex] ?? "") && boundaryIndex < mapped.text.length) boundaryIndex++;
  const boundary = mapped.sourceMap.boundaryOrigins[boundaryIndex];
  return boundary?.kind === "offset" && items.some(item => item.contentSpan.to === boundary.offset) &&
    !/^\\item(?![A-Za-z@])/u.test(mapped.text.slice(boundaryIndex));
}
