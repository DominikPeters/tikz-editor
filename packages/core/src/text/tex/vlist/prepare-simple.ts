import type { ResolvedTexFont } from "../fonts/types.js";
import type {
  TexDisplayMathLayoutProfile,
  TexListLayoutProfile,
} from "../layout-options.js";
import { groupSimpleTexVListScopes } from "./scopes.js";
import {
  materializeDisplayMathVerticalGlueInVList,
  materializeParagraphVerticalGlueInVList,
} from "./spacing.js";
import type { TexVListDocument } from "./types.js";
import { texLength } from "../coordinates.js";

export interface PreparedSimpleTexVList {
  readonly materialized: TexVListDocument;
  readonly normalized: TexVListDocument;
}

export function normalizeSimpleTexVList(
  vlist: TexVListDocument,
  font: ResolvedTexFont,
  listProfile?: TexListLayoutProfile,
  displayMathProfile?: TexDisplayMathLayoutProfile
): TexVListDocument {
  return prepareSimpleTexVList(
    vlist,
    font,
    listProfile,
    displayMathProfile
  ).normalized;
}

export function prepareSimpleTexVList(
  vlist: TexVListDocument,
  font: ResolvedTexFont,
  listProfile?: TexListLayoutProfile,
  displayMathProfile?: TexDisplayMathLayoutProfile
): PreparedSimpleTexVList {
  const paragraphGlue = materializeParagraphVerticalGlueInVList(
    applyListBodyFonts(vlist, listProfile),
    font,
    listProfile
  );
  const materialized = materializeDisplayMathVerticalGlueInVList(
    paragraphGlue,
    displayMathProfile
  );
  return {
    materialized,
    normalized: groupSimpleTexVListScopes(materialized, font, listProfile),
  };
}

function applyListBodyFonts(vlist: TexVListDocument, profile?: TexListLayoutProfile): TexVListDocument {
  return { ...vlist, items: vlist.items.map(item => {
    if (item.kind === "vbox") return { ...item, items: applyListBodyFonts({ kind: "vlist", items: item.items }, profile).items };
    if (item.kind !== "paragraph" || !item.paragraph.listContext || item.paragraph.listContext.kind === "bibliography") return item;
    const depth = item.paragraph.listContext.depth - 1;
    const size = profile?.bodyFontSizePtByDepth?.[depth];
    const skip = profile?.bodyBaselineSkipPtByDepth?.[depth];
    return { ...item, paragraph: { ...item.paragraph,
      ...(size != null ? { fontSizePt: texLength(size) } : {}),
      ...(skip != null ? { baselineSkip: texLength(skip) } : {}),
    } };
  }) };
}
