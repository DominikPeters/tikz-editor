import { legacyEditedSource, legacyText, type EditedSource, type TikzFragment } from "../packages/core/src/edit/fragment.js";

/** Tests build patches from literal text; production code uses the typed constructors. */
export function fragment(text: string): TikzFragment {
  return legacyText(text);
}

/** A whole document a test wrote by hand, as an edit result's source. */
export function editedSource(text: string): EditedSource {
  return legacyEditedSource(text);
}
