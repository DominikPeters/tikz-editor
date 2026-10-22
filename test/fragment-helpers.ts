import { unchangedSource, userText, type EditedSource, type TikzFragment } from "../packages/core/src/edit/fragment.js";

/** Tests build patches from literal text, as if typed into the source editor; production code uses the typed constructors. */
export function fragment(text: string): TikzFragment {
  return userText(text, "source-editor");
}

/** A whole document a test wrote by hand, as an edit result's source. */
export function editedSource(text: string): EditedSource {
  return unchangedSource(text);
}
