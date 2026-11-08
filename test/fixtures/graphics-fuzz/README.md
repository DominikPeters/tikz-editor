# Controlled graphics for fuzzing

These original, deliberately asymmetric colour patterns are shared by the
TeX and native comparison paths. `assets.json` pins every input byte with
SHA-256; changing a fixture requires a reviewed manifest update. Campaigns
copy the same files into `cases/fuzz-images/` and retain the manifest hash.

- `pattern.png` and `pattern.v2.png`: 24 by 16 RGB pixels, no resolution metadata.
- `photo.jpg`: the same pattern, JPEG at 72 dpi, 4:4:4 sampling, quality 95.
- `pages.pdf`: an original two-page vector PDF, 24 by 16 bp and 16 by 24 bp.
- `page-1.png` and `page-2.png`: original 72-dpi Poppler renders, retained with
  their original hashes. `page-1-144dpi.png` and `page-2-144dpi.png` are the active
  shared text/Node edit proxies, matching the app PDF rasterizer's default scale
  2. Natural dimensions remain unchanged. The independent TeX oracle reads the
  original PDF. Corpus/Beamer comparisons rasterize the original PDF themselves.
- `nested/pattern.pdf`: a PDF with the PNG's basename in a later search
  directory, testing that extension priority precedes directory priority.

No SVG is used as a substitute for a supported TeX image format. Missing files,
invalid pages, decode errors and interrupted comparisons remain failures.

Focused commands, after `npm run build:tex-fuzz`:

```
node scripts/compare-beamer-fuzz.mjs --profile images --cases 8 --seed 20261108 --out-dir artifacts/includegraphics/beamer
node scripts/compare-tex-text-visual-fuzz.mjs --case-mode images --cases 16 --seed 20261108 --scale 4 --out-dir artifacts/includegraphics/text
```

Image mode enables the visual runner's existing raster-difference failure gate.
It checks controlled color footprints against an independent MuPDF conversion
of the actual TeX PDF, using the same final rasterizer as the native SVG, and
exits unsuccessfully on findings or errors. All nine original article paint
observations are closed; see the [status and ledger](../../../design/includegraphics-fuzzing.md).
Beamer image cases require the image count on every overlay state and compare
four interior paint probes per visible, resolved image, using the existing RGB
tolerance. Recursive broad/complex generation also includes image leaves and
images inside TikZ nodes. Native edit/cache parity and independent TeX fidelity
are separate checks; passing one does not establish the other.

`cases.json` and the eight `v4-*.tex` sources replay the focused Beamer run.
`original-beamer-corners.tex` retains the invalid Beamer production, and
`original-history-owner-id.tex` retains the original engine-owner comparison
failure. `article-findings/` preserves every originally flagged snippet and its
exact TeX oracle document; hashes, original paint failures, per-case geometry,
closure evidence and replay commands are in the ledger.

The PR/nightly image fidelity workflow runs the live oracle regressions and both
bounded campaigns, and retains reproduction artifacts for 14 days. The separate
Chromium/WebKit browser matrix imports `pages.pdf` through the real file chooser
and PDF.js path and verifies page/crop/resize/history/replacement/reload pixels.
Run those browser tests locally with:

```
PLAYWRIGHT_BROWSERS=chromium,webkit npm run test:e2e -- beamer-pdf-image.spec.ts --workers=1
```
