These snapshots pin the LuaLaTeX shipout glyph/rule traces for the existing
`corpus-followups/flow-titles.tex` and `text-empty-frame-title.tex` fixtures.
They cover both subtitle syntaxes, title `only`/`uncover` overlays, a stock
title control, and explicit/absent title controls under Warsaw. Covered
glyphs remain in the snapshots; no failure baseline or geometry tolerance is
encoded in the data. Box ancestry is omitted because the comparator uses
glyphs and rules.

The snapshots were produced by the existing Beamer comparison scripts with
LuaHBTeX from TeX Live 2025 and Beamer 3.72. To regenerate from the repository
root after building the current renderer:

```sh
npm run compare:beamer-followups -- --cases flow-subtitle-control,flow-subtitle-command,flow-subtitle-header,flow-title-uncover,flow-title-only,text-explicit-empty-title,text-absent-title-control
node test/fixtures/beamer/frame-titles-fidelity/capture-oracles.mjs
```

The capture script checks each compiled page count and source hash before
copying the oracle traces. `test/beamer-frame-title-fidelity.spec.ts` compares
the direct source renderer with these traces without requiring TeX in CI.
Subtitle geometry here exercises the default frame-title template, including
themes that retain it. Other frame-title templates and wrapped titles need
their own geometry comparisons.
