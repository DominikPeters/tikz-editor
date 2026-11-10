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
`assets.json` lists the files and their dimensions. Cache keys are derived from
the current asset contents. Standalone comparison directories receive the same files.
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
runs both image oracle suites with live TeX enabled, and checks that
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
task.
