# Beamer renderer corpus checks

The downloaded source snapshots live in the ignored `artifacts/beamer-sources/`
directory. `deck-index.json` identifies candidate entry points, repository commits
and licenses. The runner resolves paths relative to that index, so the corpus can
be moved to another machine. It does not download additional sources.

Run a native renderer census across every indexed deck:

```sh
npm run compare:beamer-corpus
```

The default samples three evenly spaced source frames per deck, including the
first and last, and renders the final overlay step. Increase coverage with
`--frames all --steps all`. Sample sizes and discovered frame counts are recorded;
generated frames that the scanner does not discover are outside that count.

Run a manageable visual comparison across all repositories:

```sh
npm run compare:beamer-corpus -- --mode compare \
  --max-decks-per-repository 1 --frames 3 --expand-inputs
```

For a focused check or a larger batch:

```sh
npm run compare:beamer-corpus -- --mode compare --repository leeper --frames 5
npm run compare:beamer-corpus -- --mode compare --frames all --steps first,last --resume
npm run compare:beamer-corpus -- --input test/fixtures/beamer/hello_world_beamer.tex \
  --mode compare --strict --max-rmse 0.05
```

Outputs are ignored under `artifacts/beamer-corpus-renderer/native/` or
`artifacts/beamer-corpus-renderer/compare/` by default:

- `index.html`: filterable gallery linking SVGs, side-by-side images and detailed
  comparison reports. Filter by repository, file, status or diagnostic code.
- `summary.md`: coverage denominators, repository counts and common diagnostics.
- `report.json`: every deck/page result, source and renderer fingerprints,
  tool versions, sample configuration, diagnostics and resolved/missing assets.
- `decks/`: per-deck checkpoints, worker logs, native SVGs, materialized source,
  and per-page TeX logs/PDFs, traces, overlays and difference images.

## Shortlisting for manual review

Select compact examples that exercise different standard feature families across
repositories, rather than only evenly spaced frames:

```sh
node scripts/shortlist-beamer-corpus.mjs --count 48 --max-per-repository 10
node scripts/shortlist-beamer-corpus.mjs --count 48 --max-per-repository 10 \
  --render-selected --out artifacts/beamer-corpus-renderer/shortlist-rendered
```

This uses the same conservative input expansion and the core syntax inventory.
Comments and commands printed inside opaque code environments do not count as
feature use. It groups constructs into 22 families with Beamer/package provenance,
deduplicates identical frame source per repository, and caps selection per deck
and repository (`--max-per-deck 4`, `--max-per-repository 8` by default). Selection
prefers previously unseen repository/family combinations and compact sources.

`shortlist.json` records every discovered source form, family frequencies,
discovery/input diagnostics, selected cases and a renderer fingerprint.
`selected.json` is the candidate list. Frequencies include only complete discovered
frames: command-form and macro-generated frames can be missed. Counts establish
breadth within these eight collections, not population-wide package popularity or
renderer support. Standard Beamer features can be worth implementing even when
one author accounts for their observed use.

`--render-selected` renders the first and last native state and writes SVGs plus
`render-review-signals.json`. Signals include text-engine literal fallback reasons
and source spans, unsupported flow items, asset resolution failures, suspected
missing graphics and body fallbacks omitted from top-level diagnostics. These
are triage flags, not passes/failures: a hidden overlay can correctly paint no
image, while a block can silently lose its entire body without any such flag.
Keep some clean controls in manual samples. This command does not compile TeX or
rasterize the SVGs; use the comparison tools and valid reference build context
for those steps.

The broader manual review is saved under ignored
`artifacts/beamer-corpus-renderer/manual-review-round2/index.html`, with source
excerpts, native SVG rasters, TeX PDF rasters, per-case caveats and observations.
The durable candidate list is `design/beamer-corpus-todos.json`. It distinguishes
built-in behavior, defined package interfaces, generic macro expansion and
evaluation work. Its author-defined examples are evidence for general mechanisms,
not a list of macro names to hardcode.

## Interpreting results

### Strict reproductions of the manual priority cases

The small, original fixtures in `test/fixtures/beamer/corpus-priorities/` remove
author macros, external assets and project build requirements from the strongest
corpus findings. `cases.json` connects each case to the reviewed evidence and
candidate TODO. The included PNG is an original test asset.

```sh
npm run compare:beamer-priorities
npm run compare:beamer-priorities -- --kind recognition
npm run compare:beamer-priorities -- --cases block-aligned-matrix,figure-image-caption
npm run compare:beamer-priorities -- --refresh-gallery
```

There are 20 fidelity frames and six separate unsupported-code recognition
frames. The fidelity runner calls the existing `compare:beamer-frame` comparator
for every expected overlay state or continuation page. It retains the existing
strict gates: all text/rule matches accounted for, identical glyph codes and
fonts, rectangle edges within 0.01 TeX pt, glyph X within 0.02 pt and glyph Y
within 0.01 pt. Missing images fail an additional image-presence check. Oracle
text witnesses and expected page counts reject empty or incorrectly isolated
references. A count mismatch fails with retained SVG/PDF/trace evidence and
withholds the glyph comparison; continuation pages cannot be paired arbitrarily
with overlay states.

`alltt` and `lstlisting` have a recognition contract: one visible, bounded source
placeholder and diagnostic spanning the complete environment, supported sibling
text retained, and commands printed inside code ignored by overlay discovery.
These cases cover top-level flow, columns and example blocks. They do not require
implementing code typesetting or matching the TeX rendering of those environments.

The command always exits nonzero on a contract failure or invalid oracle, writes
`report.json` and an `index.html` gallery under ignored
`artifacts/beamer-priority-conformance/`, and supports `--out-dir` to preserve a
run. Native and TeX raster previews are generated by default, with labelled
side-by-side images for paired states. Count mismatches show the native output
and all TeX pages separately. Recognition cases show the native rendering only.
`--structural-only` skips rasterization but still embeds native SVGs in the gallery;
exact trace gates apply in both modes. `--refresh-gallery` generates previews
from an existing report and its SVG/PDF artifacts without recompiling TeX or
changing comparison results. Current renderer failures are red
reproductions, not accepted output snapshots or tolerance exceptions. Ordinary
unit tests validate the contracts and passing recognition cases; the explicit
conformance command remains red until the corresponding fixes land.

To investigate one frame directly with the existing comparator:

```sh
npm run compare:beamer-frame -- --input test/fixtures/beamer/corpus-priorities/flow.tex --frame 4 --structural-only --assert-structural
```

The frame probe uses two LaTeX passes to resolve labels defined within the
selected frame, restoring the original deck's navigation seed before each pass.
This does not supply labels or bibliography state from omitted frames.

The initial run passes four of 20 fidelity frames, with 12 content/position
mismatches and four page-count mismatches; all reference page counts and content
witnesses validate. Four of six code recognition cases pass, while both example
block cases lose the environment and surrounding text. These are results for
the controlled fixtures, not a corpus pass rate.

The Lua trace measures TeX node layout before PDF paint transforms. The image
controls use the PNG's natural TeX size to isolate figure/caption behavior.
Rotation/scaling cases currently catch missing or literal content; their eventual
ink transforms also need the retained PDF/SVG raster checks. A trace pass alone
does not establish transformed paint fidelity.

Native `rendered` means the renderer returned an SVG. It is not a fidelity pass.
Pages without diagnostics can still contain missing or misplaced content.
Scanner diagnostics and renderer diagnostics are recorded separately. Diagnostic
counts include repeated occurrences, while page counts deduplicate each code
within a sampled page.

`compared` means the selected page was rendered by both engines. Its strict
structural contract is the same one used by `compare:beamer-frame`: matched text
and rule geometry, glyph codes, fonts and tight position tolerances. This trace
comparison does not cover every paint primitive. Normalized raster RMSE compares
the SVG raster with the actual TeX PDF raster, from 0 (identical) to 1. Large white
backgrounds can make RMSE look good despite missing text; inspect the gallery and
structural differences together. `--vector-oracle` also retains same-rasterizer SVG
comparisons as an additional aid when dvisvgm PDF conversion is available.

Oracle errors, renderer exceptions, worker failures, timeouts, no discovered frames
and mismatched overlay page counts are reported explicitly. They are excluded from
the successful-comparison denominator. They do not disappear into a fidelity score.
`--strict` fails on these outcomes or any strict structural mismatch; optional
`--max-rmse` adds a raster threshold. Non-strict runs finish the batch and preserve
all results even when individual decks fail.

## Source and tool limitations

Native mode uses the entry-point source as the app does. `--expand-inputs` is a
separate adaptation: it recursively inlines top-level literal `\input` filenames
relative to the entry-point directory, leaving comments, verbatim content and
macro bodies alone. The report lists expanded, dynamic, missing and cyclic inputs.
It does not interpret TeX conditionals, `\includeonly`, macro-generated filenames,
`\include`, package definitions or author-specific build wrappers. Both engines
receive the same assembled source when expansion is enabled. This improves access
to included frames but does not claim that the app supports multi-file projects.

The TeX oracle compiles the original preamble and selected source frame, with
navigation and theorem counter seeds from the existing frame probe. It resolves
relative dependencies from the entry-point directory and searches the repository
snapshot for local packages. Output stays in the artifact directory; shell escape
is disabled. Whole-deck state, external bibliography processing, generated assets,
engine-specific packages, conditional class selection and project Makefiles can
prevent faithful isolated compilation. Such cases require dedicated fixtures or
a future full-project oracle.

The native graphics adapter resolves literal local PNG/JPEG/SVG/PDF files and
literal `\graphicspath` directories, returning missing/unsupported facts through
the core graphics contract. PDF pages are rasterized for embedding. It is a corpus
adapter rather than the app's asset loader; macro filenames and dynamic paths are
unsupported and recorded. PNG/SVG dimensions need no extra tool; JPEG dimensions use
ImageMagick and PDF assets use `pdfinfo`/`pdftoppm`.

Full comparison needs `lualatex`, `kpsewhich`, `pdfinfo`, `rsvg-convert`, `magick`
and `pdftoppm`. `--structural-only` needs just the first three. Optional
`--vector-oracle` also needs dvisvgm with working PDF conversion. MuPDF text
extraction is optional; Lua shipout tracing supplies the structural oracle.
The runner builds core output when stale, records tool versions, and starts an
isolated worker per deck, with two workers by default. `--timeout-seconds` limits
the whole deck (including TeX and raster tools); on macOS/Linux its entire process
group is stopped and partial page checkpoints survive.

`--resume` reuses complete results only when run parameters, Node/tool versions,
harness and renderer code fingerprints, and the snapshot's file sizes/mtimes match.
It retries deck-level timeouts and crashes. Complete decks containing page errors
are cached too: omit `--resume` to retry them after fixing external dependencies.
Use a different `--out-dir` to retain an earlier baseline or compare raw and
assembled-source runs side by side.
