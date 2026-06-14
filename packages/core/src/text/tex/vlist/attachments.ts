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
): ReadonlyMap<string, TexHBoxItem> {
  const hboxesByPath = new Map<string, TexHBoxItem>();
  for (const attachment of attachments) {
    const key = texVListPathKey(attachment.vlistPath);
    if (hboxesByPath.has(key)) {
      throw new Error(`TeX vlist hbox attachments contain duplicate path ${key}.`);
    }
    hboxesByPath.set(key, attachment.hbox);
  }
  return hboxesByPath;
}

interface TexHBoxAttachmentItemsResult {
  readonly items: readonly TexVListItem[];
  readonly paragraphPathRemaps: readonly TexVListPathRemap[];
}

function attachTexHBoxesBeforeVListParagraphItems(
  items: readonly TexVListItem[],
  hboxesByPath: ReadonlyMap<string, TexHBoxItem>,
  originalPathPrefix: readonly number[],
  outputPathPrefix: readonly number[],
  usedAttachmentKeys: Set<string>
): TexHBoxAttachmentItemsResult {
  const outputItems: TexVListItem[] = [];
  const paragraphPathRemaps: TexVListPathRemap[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
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
      const hbox = hboxesByPath.get(key);
      if (hbox) {
        outputItems.push(hbox);
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
  hboxesByPath: ReadonlyMap<string, TexHBoxItem>,
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
