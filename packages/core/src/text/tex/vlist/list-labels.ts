import { roundTexPt } from "../fonts/units.js";
import {
  texLength,
  texVListX,
  type TexLength,
  type TexVListX,
} from "../coordinates.js";
import type {
  TexParagraphInput,
  TexVBoxLayout,
  TexVBoxListItemLabelContent,
  TexVBoxListItemLabelKind,
  TexVBoxListItemLabelPlacement,
  TexVBoxListItemLayout,
} from "./types.js";

export interface TexListItemLabelScopeFrame {
  readonly layout: TexVBoxLayout;
}

export function texListItemLayoutForParagraph(
  stack: readonly TexListItemLabelScopeFrame[],
  paragraph: TexParagraphInput
): TexVBoxListItemLayout | undefined {
  if (paragraph.listContext?.showLabel !== true) {
    return undefined;
  }
  const labelKind = texListItemLabelKind(paragraph);
  const labelPlacement = texListItemLabelPlacement(paragraph);
  const labelContent = texListItemLabelContent(paragraph);
  const labelRightEdge = texListItemLabelRightEdge(stack);
  const descriptionIndent = texListItemDescriptionIndent(stack, paragraph);
  return {
    itemIndex: paragraph.listContext.itemIndex,
    ...(labelKind && labelPlacement && labelContent
      ? {
          label: {
            kind: labelKind,
            placement: labelPlacement,
            content: labelContent,
            ...(labelKind === "description"
              ? {
                  fontState: {
                    family: "roman",
                    series: "bold",
                    shape: "upright",
                  },
                }
              : {}),
            ...(labelRightEdge !== undefined ? { rightEdge: labelRightEdge } : {}),
            ...(paragraph.listContext.label
              ? {
                  sourceSpan: {
                    start: paragraph.listContext.label.sourceStart,
                    end: paragraph.listContext.label.sourceEnd,
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(descriptionIndent
      ? {
          description: {
            labelFirstLineIndentWidth: descriptionIndent.labelFirstLineIndentWidth,
            bodyFirstLineIndentWidth: descriptionIndent.bodyFirstLineIndentWidth,
          },
        }
      : {}),
  };
}

function texListItemLabelKind(
  paragraph: TexParagraphInput
): TexVBoxListItemLabelKind | undefined {
  const listContext = paragraph.listContext;
  if (!listContext?.showLabel) {
    return undefined;
  }
  if (listContext.kind === "description") {
    return "description";
  }
  return listContext.label ? "custom" : "default";
}

function texListItemLabelPlacement(
  paragraph: TexParagraphInput
): TexVBoxListItemLabelPlacement | undefined {
  const listContext = paragraph.listContext;
  if (!listContext?.showLabel) {
    return undefined;
  }
  return listContext.kind === "description" ? "inline" : "margin";
}

function texListItemLabelContent(
  paragraph: TexParagraphInput
): TexVBoxListItemLabelContent | undefined {
  const listContext = paragraph.listContext;
  if (!listContext?.showLabel) {
    return undefined;
  }
  if (listContext.label) {
    return { kind: "source" };
  }
  if (listContext.kind === "itemize") {
    return texDefaultItemizeLabelContent(listContext.labelDepth);
  }
  if (listContext.kind === "enumerate") {
    return {
      kind: "text",
      text: texDefaultEnumerateLabelText(listContext.itemIndex, listContext.labelDepth),
    };
  }
  return undefined;
}

function texDefaultItemizeLabelContent(labelDepth: number): TexVBoxListItemLabelContent {
  if (labelDepth === 2) {
    return {
      kind: "glyph",
      text: "\u2013",
      code: 0x2013,
      fontId: "lmroman10-bold",
    };
  }
  if (labelDepth === 3) {
    return {
      kind: "glyph",
      text: "*",
      code: 42,
      fontId: "tcrm1000",
    };
  }
  if (labelDepth === 4) {
    return {
      kind: "glyph",
      text: ".",
      code: 183,
      fontId: "tcrm1000",
    };
  }
  return {
    kind: "glyph",
    text: "\u2022",
    code: 0x2022,
    fontId: "lmroman10-regular",
  };
}

function texDefaultEnumerateLabelText(
  itemIndex: number,
  labelDepth: number
): string {
  switch (labelDepth) {
    case 2:
      return `(${texLowerAlphaCounter(itemIndex)})`;
    case 3:
      return `${texLowerRomanCounter(itemIndex)}.`;
    case 4:
      return `${texUpperAlphaCounter(itemIndex)}.`;
    default:
      return `${itemIndex}.`;
  }
}

function texLowerAlphaCounter(value: number): string {
  const normalized = Math.max(1, Math.floor(value));
  let remaining = normalized;
  let result = "";
  while (remaining > 0) {
    remaining -= 1;
    result = String.fromCharCode(97 + (remaining % 26)) + result;
    remaining = Math.floor(remaining / 26);
  }
  return result;
}

function texUpperAlphaCounter(value: number): string {
  return texLowerAlphaCounter(value).toUpperCase();
}

function texLowerRomanCounter(value: number): string {
  const normalized = Math.max(1, Math.floor(value));
  const entries: Array<[number, string]> = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let remaining = normalized;
  let result = "";
  for (const [value, symbol] of entries) {
    while (remaining >= value) {
      result += symbol;
      remaining -= value;
    }
  }
  return result;
}

function texListItemLabelRightEdge(
  stack: readonly TexListItemLabelScopeFrame[]
): TexVListX | undefined {
  let leftMarginWidth = texLength(0);
  let labelRightEdge: TexVListX | undefined;
  for (const frame of stack) {
    const layout = frame.layout;
    const leftBefore = leftMarginWidth;
    leftMarginWidth = texLength(leftMarginWidth + layout.leftMarginWidth);
    if (layout.list) {
      labelRightEdge = texVListX(
        roundTexPt(leftBefore + layout.list.labelRightEdge)
      );
    }
  }
  return labelRightEdge;
}

function texListItemDescriptionIndent(
  stack: readonly TexListItemLabelScopeFrame[],
  paragraph: TexParagraphInput
): {
  readonly labelFirstLineIndentWidth: TexLength;
  readonly bodyFirstLineIndentWidth: TexLength;
} | undefined {
  if (paragraph.listContext?.kind !== "description") {
    return undefined;
  }
  const listLayout = texNearestListLayout(stack);
  if (!listLayout) {
    return undefined;
  }
  return {
    labelFirstLineIndentWidth: texLength(roundTexPt(
      0 - listLayout.ownLeftMarginWidth + listLayout.descriptionLabelSepWidth
    )),
    bodyFirstLineIndentWidth: texLength(roundTexPt(0 - listLayout.ownLeftMarginWidth)),
  };
}

function texNearestListLayout(
  stack: readonly TexListItemLabelScopeFrame[]
): TexVBoxLayout["list"] | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const list = stack[index]?.layout.list;
    if (list) {
      return list;
    }
  }
  return undefined;
}
