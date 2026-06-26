# TeX Text Visual Fuzz Harness

The TeX-derived paragraph path is validated against a TeX oracle with:

- Exact line text and glyph sequence comparison.
- SVG-derived glyph coordinate comparison with line-normalized `x` tolerance.
- PNG raster comparison against TeX output, normalized by TeX-vs-TeX renderer noise.

## Commands

Build the core package first, because the harness imports `packages/core/dist`:

```sh
npm run -w @tikz-editor/core build
```

Run the fast regression matrix:

```sh
npm run compare:tex-text-visual-fuzz:smoke
```

Run the larger current-regime matrix:

```sh
npm run compare:tex-text-visual-fuzz:large
```

Run the ligature-focused matrix:

```sh
npm run compare:tex-text-visual-fuzz:ligatures
```

Run the alignment-environment matrix:

```sh
npm run compare:tex-text-visual-fuzz:alignment-env
```

Both commands use `artifacts/tex-text-svgtrace-cache` for TeX oracle artifacts. The first run for a new seed or matrix compiles TeX; later runs reuse cached `case.tex`, `case.pdf`, `tex-pdftocairo.svg`, and `tex-dvisvgm.svg`.

## Current Matrix

The large matrix currently covers 200 generated cases with:

- Alignments: left, right, center, justify.
- Widths: 80, 100, 120, 150, 200, 240, 320 pt.
- Paragraph features: plain text, multiple paragraphs, `\noindent`, `\\[<len>]`, mixed paragraph/forced breaks, and paragraph-prefix alignment declarations.
- Paragraph-prefix declarations: `\raggedright`, `\centering`, `\raggedleft`.
- Environment-focused modes: `quote`/`quotation`, list environments, parbox/minipage boxes, and `center`/`flushleft`/`flushright` alignment environments.
- Alignment-environment mode covers plain, multi-paragraph, consecutive, box/minipage, list-inside, inside-list, and quote/quotation-inside cases.
- Ligature-focused mode: words containing `ff`, `fi`, `fl`, `ffi`, and `ffl` across plain, multi-paragraph, forced-break, and `\noindent` cases.
- Default Computer Modern OT1 text at the TeX default 10 pt text font.

## Pass Criteria

A case is structurally flagged when any of these fail:

- TeX and our renderer produce different line text.
- TeX and our renderer produce different glyph sequences.
- Line-normalized maximum glyph `x` delta exceeds 1.5 pt.
- Maximum glyph baseline `y` delta exceeds 0.25 pt.

A case is visually flagged when ours-vs-TeX absolute-error ratio exceeds 1.5 times the pdftocairo-vs-dvisvgm TeX renderer noise baseline. Visual flags generate `side-by-side.png` and `diff.png`.

The coordinate tolerance is intentionally looser than exact TeX scaled-point equality because dvisvgm glyph extraction and the path-based renderer do not expose identical glyph origins. Exact line text, glyph sequence, and visual noise-level comparison are the primary guards.

## Known Limits

The harness currently targets the supported simple TeX paragraph regime:

- Default Computer Modern OT1 only.
- Plain text plus supported paragraph commands.
- Whole-node fallback for unsupported TeX syntax.
- No inline math or tabular material. Font switches, boxes, lists, quotes, and supported alignment environments are covered by dedicated modes.
- Alignment declarations are supported as paragraph prefixes, including after `\par` or blank paragraph boundaries; declarations in the middle of a paragraph still fall back.
- Paragraph-prefix declaration cases are currently diagnostic coverage rather than a clean gate: `\raggedright`, `\centering`, and `\raggedleft` still expose TeX line-breaking/discretionary selection differences in very loose TikZ node paragraphs.
- SVG glyph traces decode glyph names by pairing TeX and our glyph streams, so the trace is a structural/layout oracle, not a standalone semantic TeX extractor.
