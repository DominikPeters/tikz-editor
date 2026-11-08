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
footprints with an independent MuPDF conversion of the LuaLaTeX PDF, rasterized
with the same librsvg backend as the native SVG. Poppler's rendering of that
same PDF is retained as a diagnostic control. Per-case reports retain the
existing RGB tolerance of 2 and one-pixel boundary rule. The general AE/noise
score alone can hide missing image paint among surrounding text.

## Verification on November 8, 2026

The [ledger](includegraphics-fuzz-ledger.json) records reports, source hashes,
original failures, comparison changes and exact replay commands.

- Focused Beamer: 8 cases / 11 states passed structural and paint checks,
  including 50 image/block paint samples.
- Native image edit campaign: 8 sequences passed, 105 warm/cold comparisons;
  81 resolved image occurrences reached.
- Article image campaign: **all 16 pass structural and paint checks**, including
  the nine original flagged sources. All nine snippets and original TeX oracle
  documents retain their SHA-256 hashes. A separate live regression test renders
  those originals through the production SVG emitter and independently compiled
  LuaLaTeX, and rejects missing, shifted, flipped and uncropped image mutations.
- Focused LuaLaTeX image-box tests: all 7 tests passed, including seven independent
  dimension programs. The wider targeted suite passed 243 tests in 27 files;
  12 opt-in/disabled tests were skipped. The two image-paint regression tests
  were additionally run with the live oracle enabled and both passed. Full typecheck/build and
  production lint passed. Changed JavaScript scripts passed syntax checks;
  the repository's typed ESLint project does not include `.mjs` files.

The image integration corrected comparison adapters, not renderer semantics:
unclipped viewBox transforms, image rectangles inside TikZ nodes, retained rotated
glyph axes, and engine-local owner prefixes in placement IDs. Negative tests
still reject corrupted placement IDs and missing image paint.

The article oracle ships the original TeX paragraph box at the page origin,
avoiding the enclosing TikZ/page offset. Native preview painting uses the current
glyph-outline API. The nine paint observations had two test-harness causes:

1. The mask gate mixed librsvg/Cairo SVG paint with Poppler/Splash PDF paint.
   Seven cases fail the same contract comparing two renderings of the identical
   TeX PDF, with no editor output involved. MuPDF's SVG conversion preserves the
   independent PDF geometry and image data while letting both sides use librsvg.
   Eight original failures disappear under that comparison. A global native
   nearest-neighbor filter was rejected: it made 10/16 cases fail.
2. The remaining PDF case used an undersampled 72-dpi test proxy. The app's
   existing PDF rasterizer defaults to scale 2 (144 dpi). Matching that default
   fixes the test proxy without changing natural dimensions, original PDF bytes
   or image geometry. The original 72-dpi assets and their hashes are preserved.

Both causes, experiments, original failures and the separate oracle correction
are recorded in the ledger. Older Cairo SVG conversion shifts bitmap samples;
dvisvgm also emits oversized symbols and empty image data for some clipped
images. Those SVG scores are diagnostic in image mode. The intermediate runs are
retained and are not successful paint comparisons. The zero-noise
AE flag was also strengthened: nonzero native error is flagged when the two TeX
SVG references agree exactly. **No numeric tolerance was relaxed.**

No large image soak or independent TeX campaign over the recursive image grammar
was run. Paint closure uses the original campaign's 4 pixels per TeX point.
Native Node edit checks use pinned Poppler PDF pages and do not validate
the browser PDF.js rasterizer. The full repository test suite was not rerun.
Older campaigns, remaining support gaps and raster limitations remain recorded
in the separate [Beamer ledger](beamer-failure-ledger.json); this focused run does
not revalidate or close those records.
