import type { BeamerOverlayItem, BeamerOverlayCommand } from "./overlay.js";
import type { MappedText } from "../text/source-map.js";

/** At the next item Beamer ends horizontal mode before closing actionenv.
 * At list end actionenv closes first: smuggle's empty group starts a resumed
 * paragraph after a display, which endtrivlist subsequently ships. */
export function beamerItemActionCommitsParagraph(mapped: MappedText, sourceEnd: number, items: readonly BeamerOverlayItem[], commands: readonly BeamerOverlayCommand[] = []): boolean {
  const previous = mapped.sourceMap.charOrigins[sourceEnd - 1];
  if (previous?.kind === "direct") {
    // The display can be the last material in a nested only/alt branch.
    // Follow those closing groups to the enclosing visibility action.
    let offset = previous.to;
    for (;;) {
      const parent = commands.find(command => command.span.to > offset &&
        command.branches.some(branch => branch.contentSpan.to === offset));
      if (!parent) break;
      if (["visible", "uncover", "invisible"].includes(parent.kind)) return true;
      offset = parent.span.to;
    }
  }
  let boundaryIndex = sourceEnd;
  while (/\s/u.test(mapped.text[boundaryIndex] ?? "") && boundaryIndex < mapped.text.length) boundaryIndex++;
  const boundary = mapped.sourceMap.boundaryOrigins[boundaryIndex];
  return boundary?.kind === "offset" && items.some(item => item.contentSpan.to === boundary.offset) &&
    !/^\\item(?![A-Za-z@])/u.test(mapped.text.slice(boundaryIndex));
}
