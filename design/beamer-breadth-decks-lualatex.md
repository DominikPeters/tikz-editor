# Beamer breadth decks: LuaLaTeX gap audit

This audit compares the twelve original breadth decks with LuaLaTeX, using
every discovered source frame and overlay, plus the numerical deck's second
continuation page. The machine-readable inventory is
[`beamer-breadth-decks-lualatex.json`](beamer-breadth-decks-lualatex.json).
It records sources, environment, coverage, diagnostics, structural failures,
raster differences and artifact paths per page. These are observations, not
accepted fidelity goldens.

All **151 paired pages** obtained valid LuaLaTeX references, with no oracle
failures. **Two** meet the existing strict structural contract; **six** generated
section pages remain undiscovered. The 104 states without top-level diagnostics
still include literal fallbacks and visual differences.

## What to work on next

The most useful next campaign is ordinary Beamer content and composition.
Specialist packages account for several large failures, but they do not explain
missing footer metadata, visible speaker notes, literal contents commands,
missing progress bars or layout errors on otherwise supported text and math.

| Priority | Gap | Concrete reproduction and observed behavior |
| --- | --- | --- |
| 1 | Complete footlines and sidebar metadata | NVIDIA frame 5: the body and description labels agree closely, but Madrid drops `Research workshop (Teaching case)` and `FY2025`. The Infolines planner builds the three backgrounds, title and number without author/institute/date text. Quantum has the same missing footer fields. Fluid frame 6 omits the sidebar's author and moves subsequent section entries. |
| 1 | Suppress speaker notes in normal slide output | Relativity frame 2 paints `\note{...}` in an unsupported-content box below the columns, shifting the visible slide upward by about 25pt. Ecology frame 8 also paints its notes as unsupported content. This is different from intentional unsupported package content. |
| 1 | Implement contents flow | Logic frame 3 paints literal `\tableofcontents`; LuaLaTeX paints the three sections and the Judgments subsection. The corrected oracle retains the complete authored `.toc` on both compilation passes. |
| 1 | Ordinary flow declarations and overlay containers | Algorithms frame 2 turns standalone `\centering` into unsupported content before its TikZ picture; the same pattern appears in quantum, chemistry and systems. Quantum frame 4's `overlayarea` is unsupported on all three states. These valid Beamer/layout interfaces need reductions before attributing all diagram-slide failures to specialist packages. |
| 1 | Modern progress paint and layout | Metropolis frame 5 emits progress foreground and background with the same brown fill, and the list/block stack differs by about 3.96pt. Moloch uses `progressbar=foot`, but its bottom progress bar is absent; even simple frame 3 has a 0.4pt body offset. Moloch frame 6's supported display-math composition differs by 7pt. |
| 1 | Font/color theme components | Logic's `dove` and `serif` are unregistered: the native red/blue sans theme differs throughout from LuaLaTeX's monochrome serif theme, changing line breaks and metrics. Category theory also diagnoses `professionalfonts`; that component should be evaluated separately from changing the text family. |
| 2 | Common package shorthands | Fluid frame 6 paints literal `\SI` and unit commands; quantum frames 3 and 5 paint literal `\ket`; organic frame 2 paints `\ce` and `\chemfig` source. These alter both meaning and layout, sometimes without a useful top-level diagnostic. Reduce each package interface independently. |
| 2 | Code and preformatted text | Algorithms frame 4, systems frame 7 and numerics frames 2/7/9 use `lstlisting` or `alltt`; native output is an unsupported box instead of the formatted code. Preserve line breaks, spaces, font sizes and listing options before adding highlighting. |
| 2 | PGFPlots | NVIDIA frame 3, ML frame 4 and ecology frame 6 lose their charts. Valid `axis`/`addplot` input is passed through the TikZ parser, generating syntax/unsupported-statement diagnostics rather than plots. This deserves a package-level boundary and diagnosis. |
| 2 | Diagram package frontends | Logic frame 6 (`bussproofs`), quantum frame 2 (`quantikz`) and category frame 3 (`tikzcd`) produce placeholders or literal source instead of their respective diagrams. These are separate frontends, rather than evidence that every ordinary TikZ picture fails. |
| 2 | Figure composition | Ecology frame 7's two `subfigure` environments become unsupported content, although the local raster resolves. Check captions, widths, crop/clip and float spacing independently from asset discovery. |
| 2 | Page sequencing | Metropolis and Moloch execute six automatic section frames that native discovery does not expose. Numerical frame 10's second continuation renders, but differs in title/body geometry (17.5pt maximum rectangle-edge difference; 10.87pt glyph-baseline difference). |
| 3 | Classic titlepage metrics and smaller body details | NVIDIA's otherwise complete titlepage is about 1.93pt too low; Moloch's titlepage differs by 0.058pt. Bibliography indentation, theorem/proof layout, display spacing, and intrinsic column height also need focused reductions. Avoid mixing these with missing packages in one test. |

## Evidence and limits

The complete reference documents independently compile to 157 physical pages.
Native discovery yields 111 authored frames and 150 frame/overlay states; a
separate continuation comparison adds page 151. The other six reference pages
are the generated modern-theme section frames, explicitly outside the paired
denominator. Successful rendering and empty diagnostics are not fidelity tests.

The final run's paired gallery is
[`lualatex-audit/index.html`](../artifacts/beamer-breadth-decks/lualatex-audit/index.html),
with native output on the left and LuaLaTeX on the right. The continuation has
[its own pair](../artifacts/beamer-breadth-decks/lualatex-continuation/numerical-frame-10-page-2/side-by-side.png).
The [full-document reference gallery](../artifacts/beamer-breadth-decks/tex/index.html)
also retains the six generated section pages. Representative pairs were
visually inspected across all twelve decks; the entire gallery was measured,
not manually reviewed pixel by pixel.

Structural results require exact text/font identity, glyph offsets at most
0.02pt horizontally and 0.01pt vertically, and rectangle edges within 0.01pt.
Raster RMSE is recorded as a diagnostic, without declaring a universal pixel
threshold. The Metropolis titlepage and category reading page meet the existing
structural contract and were inspected visually. Their raster differences
remain in the report.

These counts are not an overall fidelity percentage. A single unsupported
theme affects many pages, and a shifted covered list can produce both a
position mismatch and unmatched oracle lines. Unmatched lines alone therefore
do not establish lost visible text. Embedded TikZ regions may exclude oracle
glyphs from structural matching. Some painted vector-template rules, including
Metropolis's progress rule, are not represented in the native rectangle trace;
an unmatched rule can therefore be a trace gap. That is separate from the
visually confirmed progress-color and missing Moloch foot-progress defects.

## Comparison repairs made during the audit

Three harness issues were fixed before recording the final results:

- Corpus workers now load font outlines before the first render. Previously,
  cached first-use paragraphs could have valid metrics and blank SVG glyphs.
  The initial blank titlepage images were harness artifacts, not established
  product defects. A fresh-worker test now requires painted glyph paths.
- Complete command-form `\maketitle` frames can be probed and instrumented;
  truncated frame environments remain errors. These decks now obtain real
  frame/page counters and navigation from a full authored TeX compilation.
- Contents probes retain the full deck's `.toc` on each pass. The full-context
  cache version and oracle version were advanced, and the corpus fingerprint
  now includes the deck-context helper.

The preliminary `compare/` and interrupted `compare-all/` artifacts predate
these repairs and must not be used for fidelity conclusions. The earlier
[`baseline`](beamer-breadth-decks-baseline.json) remains a coverage inventory;
its native first-use paint artifacts are superseded by this run. No fixture
source or production renderer was changed for this audit.

## Reproduce

```sh
npm run render:beamer-breadth -- --mode compare --frames all --steps all \
  --timeout-seconds 900 --out-dir artifacts/beamer-breadth-decks/lualatex-audit
node scripts/compare-beamer-frame.mjs \
  --input test/fixtures/beamer/breadth-decks/12-numerical-debugging.tex \
  --frame 10 --page 2 --width 1200 --pdf-only \
  --out-dir artifacts/beamer-breadth-decks/lualatex-continuation \
  --name numerical-frame-10-page-2
BEAMER_ORACLE_TESTS=1 npx vitest run test/beamer-frame-oracle.spec.ts \
  test/beamer-corpus-renderer.spec.ts --maxWorkers=2
```

The corpus command intentionally exits nonzero under `--strict` for the
recorded structural gaps. The oracle/corpus regression tests pass, including
real LuaLaTeX contents and cache checks. TypeScript checking and the production
lint gate pass. The reference engine is LuaHBTeX 1.21.0 / TeX Live 2025.
