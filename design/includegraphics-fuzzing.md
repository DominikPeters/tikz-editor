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

## CI and real-browser PDF coverage

The reusable [image fidelity workflow](../.github/workflows/image-fidelity.yml)
runs on pull requests, pushes to master, and the daily/manual TeX workflow. It
installs and validates all oracle tools, records their versions, commit, seed and
asset hash, runs both image oracle suites with live TeX enabled, and checks that
no tests were skipped. Its required bounded campaigns use the reproducible seed
20261108: 16 article cases at 4 pixels/pt and 8 Beamer cases / 11 overlay states.
Manual dispatch accepts another seed. Source files, asset bytes, PDFs, SVGs,
pixel comparisons and environment/test reports are retained for 14 days, including
when the gate fails. The existing broader nightly fuzz jobs remain separate.

The [PR browser matrix](../.github/workflows/ci.yml) runs
[`beamer-pdf-image.spec.ts`](../apps/web/e2e/beamer-pdf-image.spec.ts) in Chromium
and WebKit. It imports the real two-page fixture through the file chooser and
uses real PDF.js rendering, workers and browser persistence. It checks both the
decoded PNG and visible SVG quadrant colors, exact raster dimensions for each
page, page selection, crop, direct resize, undo/redo, same-name replacement with
different PDF bytes, PNG replacement and reload. JSON test reports, including
sampled pixel values, and failure screenshots/traces are retained. The new
browser palette check permits 4 channel values for interior
samples; the independent TeX gate's RGB tolerance of 2 and mask boundary contract
are unchanged.

The first WebKit run found a production drag bug: the compatibility click after
crop pointer-up was retargeted to the capturing SVG and treated as a background
click. The image selection was cleared and crop mode closed before Done. The
shared deck resize handler now consumes that trailing click and promptly removes
the listener so the next real control click works. The unchanged PDF test passes
in both engines after the fix, as do the existing SVG crop/undo/reset tests.

Local validation of the configured CI commands passed all 9 live oracle tests
without skips, all 16 article cases, all 11 Beamer states, and 8 browser tests
(4 PDF and 4 SVG crop tests across the two engines). Full typecheck and production
lint passed; the new browser spec also passed a focused typecheck and lint.
Workflow YAML and embedded shell blocks parse, and the tool/skip guards were
executed locally. Hosted GitHub Actions jobs have not been triggered from this
task. The ledger links the local reports and the initial WebKit failure evidence.

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
Native Node edit checks use pinned Poppler PDF pages; the separate browser tests
above validate PDF.js for the controlled two-page fixture. Broader PDF/browser
coverage and the full repository test suite were not run in this pass.
Older campaigns, remaining support gaps and raster limitations remain recorded
in the separate [Beamer ledger](beamer-failure-ledger.json); this focused run does
not revalidate or close those records.
