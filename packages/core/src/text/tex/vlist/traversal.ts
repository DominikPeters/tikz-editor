import type {
  PositionedTexVListItem,
  TexParagraphItem,
  TexVBoxItem,
  TexVListItem,
} from "./types.js";

export interface TexVListParagraphEntry {
  readonly item: TexParagraphItem;
  readonly ancestors: readonly TexVBoxItem[];
}

export function texVListParagraphItems(
  items: readonly TexVListItem[]
): readonly TexParagraphItem[] {
  return texVListParagraphEntries(items).map((entry) => entry.item);
}

export function texVListParagraphEntries(
  items: readonly TexVListItem[]
): readonly TexVListParagraphEntry[] {
  const entries: TexVListParagraphEntry[] = [];
  collectTexVListParagraphEntries(items, [], entries);
  return entries;
}

function collectTexVListParagraphEntries(
  items: readonly TexVListItem[],
  ancestors: readonly TexVBoxItem[],
  entries: TexVListParagraphEntry[]
): void {
  for (const item of items) {
    if (item.kind === "paragraph") {
      entries.push({ item, ancestors });
      continue;
    }
    if (item.kind === "vbox") {
      collectTexVListParagraphEntries(item.items, [...ancestors, item], entries);
    }
  }
}

export function flattenPositionedTexVListItems(
  items: readonly PositionedTexVListItem[]
): readonly PositionedTexVListItem[] {
  const flattened: PositionedTexVListItem[] = [];
  collectPositionedTexVListItems(items, flattened);
  return flattened;
}

export function findPositionedTexVListItemByPath(
  items: readonly PositionedTexVListItem[],
  path: readonly number[]
): PositionedTexVListItem | null {
  if (path.length === 0) {
    return null;
  }
  let candidates = items;
  let current: PositionedTexVListItem | undefined;
  for (const index of path) {
    if (!Number.isInteger(index) || index < 0) {
      return null;
    }
    current = candidates[index];
    if (!current) {
      return null;
    }
    candidates = current.children ?? [];
  }
  return current ?? null;
}

function collectPositionedTexVListItems(
  items: readonly PositionedTexVListItem[],
  flattened: PositionedTexVListItem[]
): void {
  for (const item of items) {
    flattened.push(item);
    if (item.children?.length) {
      collectPositionedTexVListItems(item.children, flattened);
    }
  }
}
