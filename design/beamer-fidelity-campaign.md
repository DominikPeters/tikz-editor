# Beamer fidelity campaign

Started 2026-10-16 after the titlepage work in `7d1bf584`. The aim is reliable
rendering of ordinary Beamer documents across themes and compositions, backed
by actual TeX references. A successful render or an empty diagnostic list is
not a fidelity result.

## First-wave fixes

The original 14 mismatches are addressed: measured sidebar/shadow/modern
headings; modern centering and Metropolis paragraph/line spacing; class-sized
nested list fonts, list-entry baseline selection, math skips and tiny footers;
source-ordered frame/group-local block font/color declarations; and native
Fira Sans Light/Regular with both italic faces. Metropolis's explicit Latin
Modern override remains a separate control.

The final run passes **20/20 cases**, and all **78 older controls** still pass.
The original comparison thresholds and strict font/glyph checks are unchanged.
The full suite passes 7,443 tests; typecheck and production lint also pass.

Two additional holdouts cover actual Fira titlepages and mixed Fira styles,
ligatures and punctuation. They exposed missing-face ligature assumptions and
extended-punctuation kerning, unencoded GSUB ligatures and nested italic
correction that the original requested-font case could not
establish. Explicit flat-paint probes also cover a locally red title-only colorbox
and Warsaw's expanded second-line background. Its shadow uses the source's full
opacity ramp and is checked visually in the paired rasters.

The final live run and regression-control results are recorded separately in
`beamer-fidelity-campaign-wave1-results.json`; the initial baseline stays intact.
Passing TeX traces are pinned with source hashes for offline regression. Refresh
only from a complete passing live run:

```sh
npm run compare:beamer-campaign
node scripts/update-beamer-campaign-oracles.mjs artifacts/beamer-fidelity-campaign/wave1
```

This closes the first measured wave. It does not establish arbitrary fontspec
programs, Fira Mono, font-role parent execution, arbitrary theme templates, or
all class-size/theme/overlay/subtitle combinations. The breadth and real-document
work below remain subsequent campaign targets.

## Existing protection

Reuse the existing comparison tools and their exact gates. The first baseline
reruns the 26 original priorities (20 fidelity cases and six recognition cases),
34 corpus follow-ups, and the three existing conformance frames under Default,
Madrid, Berlin, Berkeley, Warsaw and Rochester. These are regression controls,
not a fresh real-world corpus survey.

The checked-in oracle suites already cover titlepages, frame headings, scoped
and fixed flow, tables, transforms, footnotes, captions, continuations, shrink,
colors, list/navigation paint, bibliography and overlay pictures. Keep their
source hashes and independent TeX provenance. Prior review findings in
[`beamer-corpus-todos.json`](beamer-corpus-todos.json) are evidence and mechanism
IDs, not an up-to-date list of missing primitives. The round-three fixes already
closed many of those reproductions.

## First discovery wave

The [18-case manifest](../test/fixtures/beamer/fidelity-campaign/cases.json)
adds interactions that the passing controls do not establish:

| Family | Cases | Question |
| --- | ---: | --- |
| Wrapped frame headings | 8 | Do the active outer theme's heading box, sidebar and body packing grow with multiline text? |
| Class size and composition | 6 | Do 14pt nested lists and 10pt math blocks use the active size profile throughout? |
| Requested fonts | 1 | Does full Metropolis use its requested fonts? |
| Scoped declarations | 3 | Are ordinary grouped colors and body-local Beamer font/color declarations reflected in content and paint? |

Metropolis has separate layout and requested-font controls. Dates are empty to
avoid measuring the current calendar date as a geometry defect. These are valid
TeX comparisons with content witnesses; known renderer defects stay red.

Run the wave with `npm run compare:beamer-campaign`. It uses the original strict
runner and writes `artifacts/beamer-fidelity-campaign/wave1/index.html`, traces,
PDF/SVG rasters and contract failures. Select cases with `--cases ID,ID` and
preserve a run with `--out-dir PATH`. Do not use `--structural-only` to claim
paint fidelity.

## Initial measured result

All **78 regression controls pass**: 72 fidelity cases across 84 TeX snapshots,
plus six separate unsupported-code recognition checks. The new discovery wave
has **4 passes and 14 mismatches**, with valid reference builds and page
correspondence for all 18 cases. There are no oracle failures or comparison
exceptions in this run. Every result's source and manifest hashes were checked
against the current fixtures.

| Discovery family | Pass | Mismatch | Main evidence |
| --- | ---: | ---: | --- |
| Wrapped headings | 3 | 5 | Default/Madrid/Berlin controls pass. Berkeley/Rochester title lines are 9pt too low (their body packing already matches); Warsaw body text is about 10.8pt too high and its second heading line loses its painted background. Modern heading/body packing also differs. |
| Class size and composition | 0 | 6 | At 14pt the nested list uses the wrong font size/marker metrics. At 10pt, block and display spacing still differ; full Moloch adds theme-specific gaps. |
| Requested font | 0 | 1 | Full Metropolis retains a real font mismatch, beyond the independent layout-control failure. |
| Scoped declarations | 1 | 2 | Ordinary grouped text color passes. Body-local Beamer font/color commands paint literally and the requested block style is absent. |

These are failing **cases**, not 14 independent root causes. Four representative
raster pairs were inspected: Warsaw/Moloch wrapped headings, the default 14pt
list, and body-local block color. The failures above all return empty native
diagnostic lists except Metropolis's documented font substitution. Empty
diagnostics therefore cannot be used as a campaign success gate.

The first fix target is measured multiline heading geometry in the
sidebar/shaded/modern outer templates, with both background growth and body
packing verified. This extends the content measurement approach used for
ordinary headings and titlepages. It does not require new package syntax.

## Work order

1. **Headings and outer-theme geometry** — grow wrapped frame titles from their
   measured content in each actual template family. Compare default, shaded,
   rounded, sidebar and modern templates. Extend to subtitles, top/plain frames
   and alternate aspect ratios. Related mechanisms: B09, B13, B14.
2. **Class-size composition** — replace remaining 11pt assumptions in list fonts,
   marker metrics, block headers and display/paragraph boundary spacing. Cover
   named sizes and mixed nesting, keeping font selection distinct from packing.
   Related mechanisms: B01, B05, B09, B14.
3. **Scoped styles and paint** — represent literal theme declarations in source
   order and with group lifetime. Retain supported siblings when an operation
   is unsupported. Add foreground/background witnesses and PDF paint checks;
   glyph geometry alone cannot close this work. Related mechanisms: B01, B14,
   B20.
4. **Requested fonts** — add genuine Fira metrics/outlines or explicitly retain
   the substitution boundary. A Latin Modern control can verify geometry but
   cannot count as full Metropolis typography support. Related mechanism: B14.
5. **Real-document state and unsupported interfaces** — validate command-form
   discovery, source-defined wrappers, cross-frame references, bibliography and
   assets using valid whole-deck build context. Then select bounded package work
   from actual fresh evidence, rather than hardcoding author macros. Related
   mechanisms: B04, B11–B13, B15–B18, B21.

The first three workstreams precede adding more package breadth: they affect
ordinary supported documents and can invalidate many otherwise correct pieces.
Split a workstream when the reference shows independent causes; do not patch
one fixture's coordinates.

## Closing a target

- Reduce each observed failure to a valid original source fixture and a passing
  sibling/control. Read the installed Beamer/LaTeX/PGF source before assigning a
  layout rule.
- Confirm the oracle contains the expected words, assets and pages before
  comparing. Keep reference failures, timeouts, missing assets and page-count
  disagreements separate from paired geometry mismatches.
- Fix the common mechanism and retain the exact comparison. Do not bless a
  failing native result as an oracle or loosen tolerances to close a target.
- Pin the passing TeX trace for offline regression, including source hashes and
  tool provenance. Add paint checks for colors, clipping, images, gradients or
  shadows; inspect the PDF/SVG raster pair where traces cannot cover the paint.
- Rerun the affected interaction family and the older regression controls, then
  typecheck, production lint and relevant tests. Update capability boundaries
  together when support changes.

## Breadth after the first fixes

Cross the fixed mechanisms with all 28 built-in themes and the modern themes,
multiple class sizes and both 4:3/16:9 pages. Use a pairwise selection before a
large Cartesian product, while retaining explicit stress combinations for
wrapped headings, nested lists, footnotes, overlays and math blocks.

Select fresh real-world frames from the existing eight source collections,
excluding prior review identities with the shortlist tool's repeatable
`--exclude-reviewed` option. Keep clean controls and inspect all overlay and
continuation pages. Resolve the correct engine, includes, assets and full-deck
state before scoring. Missing private inputs remain unscored reference failures.
After each mechanism fix, rerun a holdout from several repositories to check
that the minimal reproductions did not become the whole target.

## Reporting

The durable baseline is
[`beamer-fidelity-campaign-baseline.json`](beamer-fidelity-campaign-baseline.json).
It records source identities, exact commands, selected coverage, separate
recognition results and every discovery result. Detailed logs and raster
artifacts are ignored under `artifacts/beamer-fidelity-campaign/2026-10-16/`.
No combined percentage is presented as overall renderer fidelity: these are
selected controls and discovery cases, with different coverage and contracts.
