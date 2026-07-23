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
    vlist,
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
