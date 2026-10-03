These snapshots are LuaLaTeX shipout traces, normalized to physical page
coordinates with `scripts/lib/beamer-frame-compare.mjs`. They were produced
with LuaHBTeX 1.21.0 (TeX Live 2025) and Beamer 3.72. Each JSON records the
source SHA-256, tool versions, and authored frame/overlay correspondence.
The tests compare native glyphs, font sizes, rules, and frame packing directly
against these traces; they are not native-renderer golden files.

The ordinary one-frame decks were captured through `probe-beamer-frame.mjs`
(also used by `compare-beamer-frame.mjs`), with `--trace-only`. `block-auto`
and `counters` were compiled as complete authored documents using the same
Lua instrumentation, log parser, and trace normalizer. Full-document
compilation matters for `counters`: its four pages are frame 1/step 1,
frame 2/steps 1 and 2, then frame 3/step 1. Their automatic footnote marks are
1, then 2/3, then 2, then 3. Isolating frame 2 loses the preceding frame's
counter and cannot reproduce this oracle.

From the repository root, with the existing TeX Live tools installed:

```sh
npm run -w @tikz-editor/core build
node scripts/regenerate-beamer-footnote-oracles.mjs --check
node scripts/regenerate-beamer-footnote-oracles.mjs
npx vitest run test/beamer-footnotes.spec.ts
```

`--check` recompiles without replacing snapshots. Omit it to regenerate;
review the JSON diff and the test results before committing. `--cases
leading,counters` selects fixtures, and `--out-dir <directory>` changes the
ignored compilation artifact directory. The helper uses the existing probe
CLI for isolated frames and existing oracle helpers for full documents. It
retains the committed frame/step mapping and rejects changed page counts so
that correspondence must be reviewed explicitly.
