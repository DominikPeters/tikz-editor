Eleven original Beamer frames cover TikZ `overlay` pictures: after the text, before it, within a line, between paragraphs, in page coordinates through `shift={(current page.south west)}` in a top-aligned frame, without `remember picture`, in a list item, a column and a block, and under `\only`/`\uncover`; the last frame checks that a removed `\only` alone on its line does not end the paragraph.

`test/beamer-overlay-pictures.spec.ts` compares glyph origins and fonts, including the text inside the pictures, against the pinned LuaLaTeX traces with a .001pt limit. On step 2 of the overlays frame, TeX also traces the picture `\uncover<3>` covers, which the native frame does not draw.

To refresh the traces, run `scripts/compare-beamer-frame.mjs --structural-only` on `pictures.tex` for each frame and page listed in `CASES` in `capture-oracles.mjs`, with output directory `artifacts/beamer-overlay-pictures-fidelity` and names `pictures-<frame>-state-<page>`. Then run:

```
node test/fixtures/beamer/overlay-pictures-fidelity/capture-oracles.mjs
```

`drawing-layer-pause.tex` pins both steps of an authored layer following
`\pause` and `\onslide<1->`: existing text keeps its glyph origins while the
drawing is visible on both steps. LuaLaTeX also traces the covered `Second.`
on step 1. Refresh its oracle with `compare-beamer-frame.mjs --structural-only`
for pages 1 and 2; retain the source SHA256 and compiler provenance.

`drawing-layer-joins.tex` pins the two ways the editor joins a new layer to a
frame without moving its text: after a list, `\nointerlineskip` (the picture's
paragraph then adds no baseline glue); after text, a `%` line (it stays in
the last paragraph). Refresh as above for frames 1 and 2 (last page).
