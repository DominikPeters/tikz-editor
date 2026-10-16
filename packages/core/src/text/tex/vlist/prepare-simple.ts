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
  const items = [...vlist.items];
  let nextParagraph: Extract<(typeof items)[number], { kind: "paragraph" }> | undefined;
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (!item) continue;
    if (item.kind === "vbox") {
      items[index] = { ...item, items: applyListBodyFonts({ kind: "vlist", items: item.items }, profile).items };
      nextParagraph = undefined;
      continue;
    }
    if (item.kind !== "paragraph") continue;
    const context = item.paragraph.listContext;
    if (context && context.kind !== "bibliography") {
      const depth = context.depth - 1;
      const size = profile?.bodyFontSizePtByDepth?.[depth];
      const nextDepth = nextParagraph?.paragraph.listContext?.depth;
      // Beamer selects the incoming list font before \list ends the current
      // paragraph. An explicit \par has already committed its baseline grid.
      const endingDepth = profile?.selectBodyFontBeforeList && nextDepth != null && nextDepth > depth + 1 &&
        !nextParagraph?.paragraph.startsAfterExplicitPar ? nextDepth - 1 : depth;
      const skip = profile?.bodyBaselineSkipPtByDepth?.[endingDepth];
      items[index] = { ...item, paragraph: { ...item.paragraph,
        ...(size != null ? { fontSizePt: texLength(size) } : {}),
        ...(skip != null ? { baselineSkip: texLength(skip) } : {}),
      } };
    }
    nextParagraph = item;
  }
  return { ...vlist, items };
}
