# @tikz-editor/lang-tikz

CodeMirror language support for TeX documents containing TikZ and for direct
TikZ sources.

The configured parsers compose the generated grammars recursively:

- Beamer/TeX documents mount the TikZ parser on `tikzpicture` environments.
- TikZ node-text groups mount the shared TeX fragment parser.

CodeMirror 6 language support for TikZ source code.

```ts
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tikz } from "@tikz-editor/lang-tikz";

new EditorView({
  state: EditorState.create({
    doc: "\\draw (0,0) -- (1,1);",
    extensions: [tikz()],
  }),
  parent: document.body,
});
```

This package includes syntax parsing, highlighting, line comments, and folding.
It does not include tikz-editor's autocomplete, diagnostics, color swatches, or
number scrubbing helpers.
