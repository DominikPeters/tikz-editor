import type {
  TexHBoxItem,
  TexVListDocument,
  TexVListItem,
} from "./types.js";

export function attachTexHBoxesBeforeVListParagraphs(
  document: TexVListDocument,
  hboxesByBlockIndex: ReadonlyMap<number, TexHBoxItem>
): TexVListDocument {
  if (hboxesByBlockIndex.size === 0) {
    return document;
  }
  return {
    ...document,
    items: attachTexHBoxesBeforeVListParagraphItems(
      document.items,
      hboxesByBlockIndex
    ),
  };
}

function attachTexHBoxesBeforeVListParagraphItems(
  items: readonly TexVListItem[],
  hboxesByBlockIndex: ReadonlyMap<number, TexHBoxItem>
): readonly TexVListItem[] {
  return items.flatMap((item): readonly TexVListItem[] => {
    if (item.kind === "vbox") {
      return [{
        ...item,
        items: attachTexHBoxesBeforeVListParagraphItems(
          item.items,
          hboxesByBlockIndex
        ),
      }];
    }
    if (item.kind === "paragraph") {
      const hbox = hboxesByBlockIndex.get(item.blockIndex);
      return hbox ? [hbox, item] : [item];
    }
    return [item];
  });
}
