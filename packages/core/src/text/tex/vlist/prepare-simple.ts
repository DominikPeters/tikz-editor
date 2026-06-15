import type { ResolvedTexFont } from "../fonts/types.js";
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
  font: ResolvedTexFont
): TexVListDocument {
  return prepareSimpleTexVList(vlist, font).normalized;
}

export function prepareSimpleTexVList(
  vlist: TexVListDocument,
  font: ResolvedTexFont
): PreparedSimpleTexVList {
  const paragraphGlue = materializeParagraphVerticalGlueInVList(vlist, font);
  const materialized = materializeDisplayMathVerticalGlueInVList(paragraphGlue);
  return {
    materialized,
    normalized: groupSimpleTexVListScopes(materialized, font),
  };
}
