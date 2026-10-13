Eleven original Beamer frames cover TikZ `overlay` pictures: after the text, before it, within a line, between paragraphs, in page coordinates through `shift={(current page.south west)}` in a top-aligned frame, without `remember picture`, in a list item, a column and a block, and under `\only`/`\uncover`; the last frame checks that a removed `\only` alone on its line does not end the paragraph.

`test/beamer-overlay-pictures.spec.ts` compares glyph origins and fonts, including the text inside the pictures, against the pinned LuaLaTeX traces with a .001pt limit. On step 2 of the overlays frame, TeX also traces the picture `\uncover<3>` covers, which the native frame does not draw.

To refresh the traces, run `scripts/compare-beamer-frame.mjs --structural-only` on `pictures.tex` for each frame and page listed in `CASES` in `capture-oracles.mjs`, with output directory `artifacts/beamer-overlay-pictures-fidelity` and names `pictures-<frame>-state-<page>`. Then run:

```
node test/fixtures/beamer/overlay-pictures-fidelity/capture-oracles.mjs
```
