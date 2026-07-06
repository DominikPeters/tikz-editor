# @tikz-editor/lezer-tikz

Lezer parser for TikZ source code, extracted from tikz-editor.

```ts
import { parser, parseSyntax } from "@tikz-editor/lezer-tikz";

const tree = parseSyntax("\\draw (0,0) -- (1,1);");
const sameTree = parser.parse("\\node {Hello};");
```

This package provides syntax parsing only. Semantic TikZ evaluation, rendering,
diagnostics, and editing helpers live in `@tikz-editor/core`.
