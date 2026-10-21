# Beamer corpus review, round 3

Manual review of 33 new source frames from seven downloaded collections produced
34 original minimal comparison cases. The first strict run has **23 mismatches
and 11 passes across 38 snapshots**, with **no invalid fixture oracles or runner
exceptions**. This is a selected reproduction suite, not a corpus pass rate.
The production renderer was not changed during the initial review. Subsequent
fixes now make **34/34 cases pass across all 38 snapshots**, with the original
strict tolerances unchanged. This remains a selected reproduction suite.

- [Minimal comparison gallery](../artifacts/beamer-followup-conformance/index.html)
- [Corpus source and raster gallery](../artifacts/beamer-corpus-renderer/manual-review-round3/index.html)
- [Structured findings, provenance and initial results](beamer-corpus-round3.json)
- [Current fix validation](beamer-corpus-round3-fixes.json)
- [Fixture manifest](../test/fixtures/beamer/corpus-followups/cases.json)

Run all cases with `npm run compare:beamer-followups`, or select IDs with
`npm run compare:beamer-followups -- --cases tables-tab-indentation,text-bm-vector`.
The runner exits nonzero on any mismatch. It retains the existing exact
glyph, font, transform and rule checks; mismatches are not accepted as goldens. Required empty-area color probes also compare actual PDF/SVG paint.

## Original fix order

The ordering favors common syntax that loses content, then layout/font fidelity.
Every target uses stock Beamer, ordinary LaTeX, or a defined common package
interface. The fixtures remove author macros and private assets.

| Priority | Mechanism | Representative case IDs | Observed failure |
| --- | --- | --- | --- |
| First | Source tabs and escaped math percent | `tables-tab-indentation`, `text-math-percent` | Valid whitespace can reject a whole table; `\%` fails in title, inline and display math. |
| First | Command-form and default-width columns | `tables-command-columns-totalwidth`, `tables-default-columns-width` | Command-form columns lose their contents; default columns move left/right content about 17 pt. Explicit `totalwidth` environment control passes. |
| First | Frame subtitles, empty titles and title overlays | `flow-subtitle-command`, `flow-subtitle-header`, `text-explicit-empty-title`, `flow-title-only`, `flow-title-uncover` | Subtitle row is absent; explicit empty title adds a band; title overlays paint literal commands. |
| First | Standard list registers and block boundary glue | `text-list-register-prefix`, `flow-stock-block-control`, `flow-environment-overlay-control` | Pre-item declarations paint as text. Stock blocks drop opening/closing list glue, shifting title and body in opposite directions. |
| Next | URL line breaking | `text-url-breakpoints` | Long URLs lose standard break opportunities and overflow. Short URL control passes. |
| Next | Bold math and Beamer math-font substitutions | `text-bm-vector`, `text-boldsymbol-control` | `bm` paints a fallback; `boldsymbol` chooses a serif bold-italic font where default Beamer uses Sans bold oblique. |
| Next | Class font size and scoped display extent | `root-font-14pt`, `text-small-display-control` | 14 pt class uses the wrong size ladder; `small` display has a uniform 0.96 pt Y offset despite matching math glyphs/fonts. 11 pt control passes. |
| Next | Shrink and background inheritance | `flow-shrink-explicit`, `root-normal-text-background` | Explicit shrinking is ignored; default canvas does not inherit the normal-text background. The latter passes glyph/rule checks but fails the RGB probe by 26 RGB levels, tolerance 2. |
| Next | Common table and caption declarations | `tables-def-arraystretch`, `tables-caption-star` | Numeric `\def\arraystretch` paints literally and leaves tight rows; caption-package `\caption*` incorrectly gains a Figure label. `renewcommand` control passes. |
| Next | Implicit overlay visibility | `flow-invisible-default` | `\invisible{...}` without angle syntax paints literally, including content and a list marker that TeX hides. |
| Package work | Basic titled `tcolorbox` | `flow-basic-tcolorbox` | Ordinary title, colors and list body become an unsupported card. This is a bounded package target, without advanced skins or author wrappers. |

These are 17 targeted feature groups plus three additional gaps exposed by four
intended controls. The two stock block controls share one defect: TeX includes
3 pt list glue at both boundaries, while native loses both. The 6 pt extent
deficit explains the +2.4 pt title/prose and −0.6 pt list-row shifts. Interitem
spacing and state-to-state space reservation already match. Hidden covered-text
matching also fails until those same geometry errors are fixed.

The other control findings are independent: `boldsymbol` chooses `cmmib10` for
the vector where the oracle chooses `lmsans10-boldoblique`; the small display's
codes, fonts, sizes and X coordinates match, so its Y mismatch belongs to scoped
frame flow rather than the math glyph renderer. Its leading display uses a
12 pt baseline internally, but the frame falls back to the ambient 13.6 pt
baseline because no ordinary paragraph precedes it; frame centering leaves the
measured 0.96 pt offset.

## Evidence and exclusions

The review excluded all 52 previously reviewed identities. Its 34 area assignments
include one jointly reviewed frame, giving 33 distinct frames. Source forms,
native SVGs, 37 native rasters and 38 TeX PDF rasters were inspected and retained.
The seven collections are AGH, bcornelusse, dl4nlp, leeper, MarcToussaint,
montreso and Naereen. The fresh inventory still covers all eight downloaded
collections and 211 entry points, with 3,666 complete distinct discovered frame
forms; scanner discovery has the limitations documented in the corpus README.

The valid-reference count is 31 source frames. Two MarcToussaint references need
a missing private `LIS-26-text-long` input and remain unavailable. Their custom
`slidecore` wrapper was not promoted into a renderer-specific exception. An
author outline frame throws on two native states, but a stock-list reduction did
not reproduce it; its context-dependent crash remains an investigation item.

Reference context was checked before promoting failures:

- Three Naereen Makefiles require XeLaTeX. The correct-engine references use the
  identical installed Pagella faces by explicit font paths and omit unused Fira
  Code declarations. They are explicitly marked as adapted references.
- An AGH equation reference is correct in the complete 70-page author document,
  page 6. Its unresolved isolated reference was rejected as evidence of a bug.
- A leeper activity slide sets a black canvas in a surrounding document-body
  group. Restoring that exact group proves the native background gap. A strict
  fixture is deferred until the isolated oracle preserves such surrounding
  settings; the initial white-on-white TeX reference was vacuous.
- Author-requested empty `flags.tex`, montreso build flags and an output-only EPS
  conversion are recorded alongside their reference builds. The corpus graphics
  adapter's EPS limitation remains distinct from renderer support.

Generic `physics` derivatives/absolute values, declared operator bodies containing
a nested built-in operator, and package `mdframed` remain useful later targets.
Thin operator spacing, ordinary alignments, matrices, simple declared operators,
text percent, labels and several overlay behaviors have working controls. We did
not promote author-specific macro names or classify these passing mechanisms as
missing support.

## Harness improvements

Commit `e804c293` adds repeatable reviewed-frame exclusions, parsed frame-option
classification and SVG literal-marker triage. The last catches display-math
fallbacks that report zero paragraph literals and no unsupported-flow items.
It also adds explicit flat-fill probes, required even when glyph geometry passes.

Glyph X/Y tolerances remain 0.02/0.01 pt, rule-edge tolerance remains 0.01 pt and
flat-fill RGB tolerance remains 2. All fixture reference page counts and text
witnesses validate. The harness's 22 focused tests, typecheck and production lint
pass. Raster inspection remains necessary for paint beyond these contracts,
particularly shrinking, clipping, opacity and transformed ink.

Detailed evidence is split into [tables](beamer-corpus-round3-tables.json),
[text/math](beamer-corpus-round3-text.json), [flow](beamer-corpus-round3-flow.json)
and [font/background](beamer-corpus-round3-root.json) reports. Their result counts
record the initial baseline, so later fixes should regenerate the gallery rather
than treating those counts as permanent expected outcomes.


## Renderer fixes and regression coverage

The fixes cover command/environment columns and stock column glue, scoped
leading displays, whitespace and list-register declarations, URL line breaking,
frame titles/subtitles and their overlays, class font-size ladders, real bold
math fonts and escaped math percent. Stock blocks now retain the correct list
boundary spacing. Basic standard-skin `tcolorbox` boxes share the paragraph,
list and minipage layout pipeline, with source-owned text and bounded cards for
unsupported skins or nested package boxes.

Caption regressions now cover `caption`/`subcaption` package-enabled captions,
unnumbered `caption*`, wrapping, class-specific fonts, struts and bottom minipage
depth. Isolated reference frames seed figure/table counters from an actual
full-deck TeX run. Generic fixes preserve Beamer's `emph` semantics and keep
custom enumerate labels from advancing the generated counter while retaining
ordinal editing topology.

Shrink expands body widths before layout, uses Beamer's scaled-point reciprocal
and overflow arithmetic, cramps live item separation, and applies one body
transform to paint, traces, source hit bounds, caret stops and selections.
Titles and chrome retain their own coordinates. Three pinned primary cases
cover explicit/default shrink, wrapping, math/rotation and `squeeze`; their
coordinate and rule limits are 0.001pt. Five pinned box pages, class/heading/flow
pages, ten color-declaration cases and eight list/navigation paint cases extend
coverage beyond the corpus reductions.

Manual raster checks caught black enumeration labels and unwanted navigation
icons despite passing glyph geometry. Label color-role inheritance and authored
empty/default navigation templates now match TeX, with source-backed paint
regressions. Fresh side-by-side inspection also checked boxes, wrapped captions,
shrink, invisible list material, colored canvas, bold math and enlarged headings.

The frame oracle now records PGF PDF matrices and retains both actual off-page
paint and declared hidden layout origins. It emits equivalent string-backed PDF
literals to work around a LuaTeX getter defect; a primary-PDF comparison confirms
identical raster pixels. Hidden-layout evidence only matches declared covered
native material. Visible glyph origins, underlying fonts and composed axes
remain gated, as do rule edges and required color probes.

The six gallery runners cover follow-ups, original priorities, tables,
transforms, captions and continuations. Their artifacts are regenerated from
the current renderer; the JSON findings above retain the initial review baseline.
Package-specific physics macros, `mdframed`, body-local theme declarations and
advanced box skins remain later support targets; the newly supported boundaries
are documented in the capability matrix.

Validation at renderer commit `3d06b4d9`: all **138 gallery cases pass**,
including **163 TeX snapshots and six unsupported-code recognition checks**.
The full regression suite passes **6,091 tests in 401 files**, with 12
tests skipped, using four workers. Typecheck, production lint and the core
build pass. Renderer changes landed in six commits, with their identities and
per-suite maximum deltas retained in the validation report.
