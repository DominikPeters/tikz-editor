import type {
  TexHBoxItem,
  TexVListDocument,
  TexVListItem,
} from "./types.js";
import { texVListPathKey } from "./paths.js";

export interface TexHBoxBeforeParagraphAttachment {
  readonly vlistPath: readonly number[];
  readonly hbox: TexHBoxItem;
}

export interface TexVListPathRemap {
  readonly from: readonly number[];
  readonly to: readonly number[];
}

export interface TexHBoxBeforeParagraphAttachmentResult {
  readonly vlist: TexVListDocument;
  readonly paragraphPathRemaps: readonly TexVListPathRemap[];
}

export function attachTexHBoxesBeforeVListParagraphs(
  document: TexVListDocument,
  attachments: readonly TexHBoxBeforeParagraphAttachment[]
): TexHBoxBeforeParagraphAttachmentResult {
  const hboxesByPath = texHBoxAttachmentsByPath(attachments);
  const usedAttachmentKeys = new Set<string>();
  const result = attachTexHBoxesBeforeVListParagraphItems(
    document.items,
    hboxesByPath,
    [],
    [],
    usedAttachmentKeys
  );
  assertAllHBoxAttachmentsUsed(hboxesByPath, usedAttachmentKeys);
  return {
    vlist: {
      ...document,
      items: result.items,
    },
    paragraphPathRemaps: result.paragraphPathRemaps,
  };
}

function texHBoxAttachmentsByPath(
  attachments: readonly TexHBoxBeforeParagraphAttachment[]
): ReadonlyMap<string, readonly TexHBoxItem[]> {
  const hboxesByPath = new Map<string, TexHBoxItem[]>();
  for (const attachment of attachments) {
    const key = texVListPathKey(attachment.vlistPath);
    const previous = hboxesByPath.get(key) ?? [];
    if (previous.some(hbox => sameHBoxAttachmentOwner(hbox, attachment.hbox))) {
      throw new Error(`TeX vlist hbox attachments contain duplicate path ${key}.`);
    }
    hboxesByPath.set(key, [...previous, attachment.hbox]);
  }
  return hboxesByPath;
}

/** Transferred labels can share a local depth/index with the new minipage's
 * own list. Source command ownership distinguishes those physical labels. */
function sameHBoxAttachmentOwner(left: TexHBoxItem, right: TexHBoxItem): boolean {
  const a = left.role, b = right.role;
  if (a?.kind !== "list-label" || b?.kind !== "list-label") return true;
  if (!!a.originalItemCommandSpan !== !!b.originalItemCommandSpan) return false;
  const aSpan = a.originalItemCommandSpan ?? a.itemCommandSpan;
  const bSpan = b.originalItemCommandSpan ?? b.itemCommandSpan;
  return aSpan && bSpan ? aSpan.start === bSpan.start && aSpan.end === bSpan.end : a.depth === b.depth && a.itemIndex === b.itemIndex;
}

interface TexHBoxAttachmentItemsResult {
  readonly items: readonly TexVListItem[];
  readonly paragraphPathRemaps: readonly TexVListPathRemap[];
}

function attachTexHBoxesBeforeVListParagraphItems(
  items: readonly TexVListItem[],
  hboxesByPath: ReadonlyMap<string, readonly TexHBoxItem[]>,
  originalPathPrefix: readonly number[],
  outputPathPrefix: readonly number[],
  usedAttachmentKeys: Set<string>
): TexHBoxAttachmentItemsResult {
  const outputItems: TexVListItem[] = [];
  const paragraphPathRemaps: TexVListPathRemap[] = [];
  for (const [index, item] of items.entries()) {
    const originalPath = [...originalPathPrefix, index];
    if (item.kind === "vbox") {
      const outputPath = [...outputPathPrefix, outputItems.length];
      const childResult = attachTexHBoxesBeforeVListParagraphItems(
        item.items,
        hboxesByPath,
        originalPath,
        outputPath,
        usedAttachmentKeys
      );
      outputItems.push({
        ...item,
        items: childResult.items,
      });
      paragraphPathRemaps.push(...childResult.paragraphPathRemaps);
      continue;
    }
    if (item.kind === "paragraph") {
      const key = texVListPathKey(originalPath);
      const hboxes = hboxesByPath.get(key);
      if (hboxes) {
        outputItems.push(...hboxes);
        usedAttachmentKeys.add(key);
      }
      const outputPath = [...outputPathPrefix, outputItems.length];
      outputItems.push(item);
      paragraphPathRemaps.push({
        from: originalPath,
        to: outputPath,
      });
      continue;
    }
    outputItems.push(item);
  }
  return {
    items: outputItems,
    paragraphPathRemaps,
  };
}

function assertAllHBoxAttachmentsUsed(
  hboxesByPath: ReadonlyMap<string, readonly TexHBoxItem[]>,
  usedAttachmentKeys: ReadonlySet<string>
): void {
  for (const key of hboxesByPath.keys()) {
    if (!usedAttachmentKeys.has(key)) {
      throw new Error(
        `TeX vlist hbox attachment references missing paragraph path ${key}.`
      );
    }
  }
}
