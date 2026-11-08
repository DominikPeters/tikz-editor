# Includegraphics in the existing fuzzers

The shared TeX grammar now generates real PNG, JPEG and multi-page PDF images,
including dotted extensionless names, comment gaps, stars, legacy corners, and
ordered sizing, rotation, crop, clipping, draft and page keys. Images participate
in recursive font/box/document generation, feature coverage, shrinking, support
qualification, boundary checks, metamorphic checks and engine histories.

The Beamer recursive grammar has image and image-in-node leaves. Its focused
`images` profile covers inline content, columns, blocks, rotated TikZ nodes,
overlay-qualified commands, search paths, PDF pages and key ordering. Beamer's
wrapper breaks legacy two-bracket corners, so that syntax stays in the article
grammar. The rejected original Beamer source is retained, not counted as a
successful oracle comparison.

The original assets and all successful focused Beamer sources are in
[`test/fixtures/graphics-fuzz`](../test/fixtures/graphics-fuzz/README.md).
`assets.json` pins every asset byte. Both oracle caches and campaign manifests
include the asset hash. Standalone campaign directories receive the same files.
The general TikZ renderer comparator and direct Beamer comparator now resolve
local assets too.

## Running and replaying

After `npm run build:tex-fuzz`:

```sh
node scripts/compare-beamer-fuzz.mjs --profile images --cases 8 --seed 20261108 --out-dir artifacts/includegraphics/beamer-new
node scripts/compare-tex-text-visual-fuzz.mjs --case-mode images --cases 16 --seed 20261108 --scale 4 --out-dir artifacts/includegraphics/text-new
node scripts/fuzz-beamer-edits.mjs --profile images --cases 8 --steps 2 --seed 20261108 --corpus-replays 0 --mutations 0 --out-dir artifacts/includegraphics/edits-new
node scripts/compare-beamer-priorities.mjs --manifest test/fixtures/graphics-fuzz/cases.json --out-dir artifacts/includegraphics/beamer-replay
```

The article image profile rasterizes every case and exits unsuccessfully for
findings or oracle errors. Its image gate compares the four controlled color
footprints with a direct raster of the LuaLaTeX PDF. Per-case reports retain the
existing RGB tolerance of 2 and one-pixel boundary rule. The general AE/noise
score alone can hide missing image paint among surrounding text.

## Verification on November 8, 2026

The [ledger](includegraphics-fuzz-ledger.json) records reports, source hashes,
original failures, comparison changes and exact replay commands.

- Focused Beamer: 8 cases / 11 states passed structural and paint checks,
  including 50 image/block paint samples.
- Native image edit campaign: 8 sequences passed, 105 warm/cold comparisons;
  81 resolved image occurrences reached.
- Article image campaign: all 16 completed and passed structural checks; **9
  paint observations remain open**, 7 cases passed the complete gate. These are
  observations, not nine established distinct renderer bugs. Raster interpolation
  differences and other possible causes have not been triaged.
- Focused LuaLaTeX image-box tests: all 7 tests passed, including seven independent
  dimension programs. The wider targeted suite passed 218 tests in 25 files;
  11 existing opt-in/disabled tests were skipped. Full typecheck/build and
  production lint passed. Changed JavaScript scripts passed syntax checks;
  the repository's typed ESLint project does not include `.mjs` files.

The image integration corrected comparison adapters, not renderer semantics:
unclipped viewBox transforms, image rectangles inside TikZ nodes, retained rotated
glyph axes, and engine-local owner prefixes in placement IDs. Negative tests
still reject corrupted placement IDs and missing image paint.

The article oracle now ships the original TeX paragraph box at the page origin,
avoiding the enclosing TikZ/page offset. Native preview painting uses the current
glyph-outline API. Image footprints use the actual PDF raster because Cairo's
SVG image sampling shifts footprints, and dvisvgm's image symbols render oversized
in librsvg when their uses omit explicit dimensions. The intermediate runs are
retained in the ledger and are not successful paint comparisons. The zero-noise
AE flag was also strengthened: nonzero native error is flagged when the two TeX
SVG references agree exactly. **No numeric tolerance was relaxed.**

No large image soak or independent TeX campaign over the recursive image grammar
was run. Native Node edit checks use pinned Poppler PDF pages and do not validate
the browser PDF.js rasterizer. The full repository test suite was not rerun.
Older campaigns, remaining support gaps and raster limitations remain recorded
in the separate [Beamer ledger](beamer-failure-ledger.json); this focused run does
not revalidate or close those records.
