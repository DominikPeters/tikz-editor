# Beamer editing fuzz: isolation and coverage feedback

`npm run fuzz:beamer-edits` compares the production app compute adapter after
editing, navigation, races, undo, aborts and layer changes with fresh compute
instances. Source recipes preserve semantic edit targets; materialization writes
the concrete UTF-16 patches. Saved recipes from both probe versions remain
replayable, including the older overlay-comment spelling.

Run a sequential campaign from the repository root:

```sh
npm run fuzz:beamer-edits -- --cases 128 --steps 96 --mutations 32 \
  --corpus-replays 8 --seed 20261106 \
  --out-dir artifacts/beamer-edit-fuzz/my-soak
```

`--cases` counts fresh generated sequences. Bounded corpus replays run first;
`--mutations` adds sequences derived from the current distilled corpus after
fresh generation. Each passing case that adds coverage becomes available as a
mutation parent immediately. Corpus mutations vary edit values, numeric
boundaries, edit modes, neighborhood scheduling and alignment environments.
Full concrete inputs and parent identities are saved before execution, so
replay does not depend on later corpus membership or scheduling.

The default `broad` profile keeps 33 small interaction controls and fills the
remaining fresh cases with the recursive version-3 grammar. `--profile intricate`
selects only recursive decks. They contain two to four authored frames with
nested flow, math, tables, larger TikZ diagrams and overlays. Macro plans sample
formatting definitions, expansion chains, optional/default arguments, aliases,
local restoration and redefinitions between frames. Saved choices include the
flow tree and macro timeline. Editing probes preserve frame options and are
located after the authored deck; sequences revisit earlier frames in reverse
order to exercise macro-context caches.

The corresponding `compare:beamer-fuzz` profile independently checks every
frame and overlay state with LuaLaTeX. It exposed two new reduced renderer
[findings](../test/fixtures/beamer/fuzz-findings-v4/README.md). It also exposed
an oracle-context omission: reference probes now replay the original source
prefix through TeX while discarding earlier pages, so aliases and redefinitions
are executed by the independent engine. A full-deck trace integration test
checks the result. The reduced findings were subsequently fixed under the
original comparison tolerances; complex generated failures remain visible.

## Resource limits and failure classification

Each case runs in its own supervised Node/Vitest process with one test worker.
The parent watchdog remains responsive while the target synchronously loops.
On POSIX it kills the complete process group; on Windows it uses `taskkill /T`.
Normal exit also cleans up descendants. The next case can run after a resource
failure. SIGINT/SIGTERM terminates the current group and saves an interrupted
report.

Defaults:

| Limit | Default | Override |
| --- | --- | --- |
| Case wall time, including coverage/startup | 180 seconds | `--case-timeout-ms` |
| V8 old-space per Node isolate | 1536 MiB | `--heap-mb` |
| Captured stdout/stderr per child | 8 MiB | supervisor helper option |
| Separate mismatch reduction wall time | 300 seconds | `--reduction-timeout-ms` |
| Semantic reduction trial budget | 48 | `--reduce-budget` |

The heap setting is **not a hard RSS limit**: V8 young-space, native allocations,
other processes and LuaLaTeX memory are outside that cap. Artifact files and the
append-only corpus also require disk space beyond captured stdout/stderr.

Reports distinguish renderer mismatches, thrown errors, wall timeouts, detected
V8 OOM, excessive output, startup errors, interruption and harness errors. An
absent report or required coverage cannot count as a pass. A timed-out reduction
retains the original mismatch and any reduction checkpoints.

The independent TeX reducer is supervised separately:

```sh
npm run reduce:beamer-fidelity -- \
  --input test/fixtures/beamer/fuzz-findings-v3/titlepage-after-prose-reduced.tex \
  --anchor '\titlepage' --witness Probe --budget 32 \
  --timeout-ms 600000 --heap-mb 1536 \
  --out-dir artifacts/beamer-edit-fuzz/title-reduction
```

Its bounded worker log and exit classification are in `worker.log` and
`process.json`. The Beamer oracle's individual LuaLaTeX, PDF and raster tool
calls have a synchronous 120-second deadline, configurable with
`TIKZ_ORACLE_TOOL_TIMEOUT_MS`. Failed/expired oracle calls reject a reduction
candidate; they cannot establish a renderer mismatch. These limits apply to
the Beamer comparison tools and this reducer; other fuzz targets retain their
own existing isolation mechanisms.

## What the coverage means

Each child collects actual Vitest V8 source coverage and saves
`worker/coverage/coverage-final.json`. The parent extracts source-mapped branch
arms, functions and statements. It reports aggregate covered/total counts and
coverage novelty independently of the existing semantic reach counters.

The declared scope in `scripts/lib/fuzz-coverage.mjs` includes core Beamer,
parser, semantic, SVG and render code, relevant TeX vertical/paragraph flow,
and app compute/cache helpers. It excludes test harnesses and generated font
outlines. Percentages describe the union of mapped features reported for that
scope across the campaign. They do not measure whole-project coverage.
Missing or empty target coverage fails the run.

Long campaigns still require actual selective semantic replay, skipped suffixes,
rebased patches, incremental parsing, deck cache claims/prewarming and layer
layout reuse. These checks protect the warm/cold comparison from degenerating
into repeated full renders. A comment containing `overlay` can deliberately
force conservative replay; the current positive probe uses `edit-layer-probe`.

## Persistent corpus and reproducibility

The default corpus is `artifacts/beamer-edit-corpus` (`--corpus` overrides it).
Inputs are immutable content-addressed recipes. Observations are published
atomically into separate files, allowing independent supervisors to append
without overwriting one another's measurements. Reload verifies input hashes.

Coverage observations are namespaced by core/app source hashes, harness and
lockfile hashes, Node/V8, Vitest/coverage versions and coverage scope. Existing
inputs can be replayed after an implementation change, but their old coverage
does not count toward the new namespace. Unknown inputs get replay priority.
Failures remain archived with their limits and artifact provenance.

A deterministic greedy set cover chooses smaller inputs that preserve the full
observed feature union and retains every nonpassing/unmeasured entry. The
active set is used for feedback and mutation; archived recipes are not deleted.
This is bounded greedy distillation rather than a claim of global minimality.
`report.json` records the initial corpus IDs, namespace, hashes, limits,
per-case status, coverage novelty, feature reach, comparison count and corpus
archive/active sizes.

Replay a saved input independently:

```sh
npm run fuzz:beamer-edits -- \
  --replay artifacts/beamer-edit-fuzz/my-soak/case-0000/input.json \
  --out-dir artifacts/beamer-edit-fuzz/replay
```

The nightly/weekly `beamer-edit-feedback` CI job restores and saves the corpus,
runs one worker, and uploads both corpus observations and complete campaign
artifacts on failure. Nightly runs use 49 fresh sequences with 28 edits;
weekly runs use 64 sequences with 96 edits. Both add bounded corpus replays and
16 mutations. This job tests cache consistency; the separate Beamer LuaLaTeX
job continues checking rendering fidelity.

Warm/cold agreement cannot reveal a semantic error shared by both computations.
Independent LuaLaTeX comparisons remain necessary, including edited states.
The two [original fidelity findings](../test/fixtures/beamer/fuzz-findings-v3/README.md)
were strict failing reproductions at this stage. They were subsequently fixed
and added to the passing frozen-oracle collection (see the November 7 results).

## Verification: 2026-11-06

| Campaign | Sequences | Warm/cold comparisons | Result |
| --- | ---: | ---: | --- |
| Supervised pilot, including two corpus mutations | 4 | 232 | Passed |
| All 33 families, four replays, eight mutations | 45 | 4,398 | Passed |
| Separate corpus reuse and mutation | 4 | 279 | Passed |
| Exact saved-input replay | 1 | 58 | Passed |
| Total | 54 | 4,967 | Passed |

The large soak observed 5,521/9,424 mapped branch arms, 1,299/3,007 functions
and 30,488/82,653 statements in the declared scope. Its corpus snapshot
preserved all 37,308 observed features with 26 active inputs from 34 archived
recipes. Mutations added coverage in both the small pilot and the full soak;
exact replay added zero new corpus features.

The 18 targeted tests passed, including real heap exhaustion, synchronous hang
and descendant cleanup, corpus namespace/append integrity, semantic reduction
sabotage checks, and exact rematerialization of 163 older saved recipes.
Type checking and production lint passed. Two deliberate 1 ms case deadlines
produced two timeout findings and confirmed continuation. A live LuaLaTeX
reducer smoke independently reconfirmed the existing title-page glyph-y failure.
The final audit recomputed input hashes, worker receipts, comparison totals,
feature-reach totals, coverage unions and corpus preservation from saved files.

Local evidence is under `artifacts/beamer-edit-fuzz/hardening/`, including
`verification.json`, `audit.mjs` and `final-audit.log`; raw per-case V8 coverage,
recipes, concrete operations and worker logs are retained in each campaign.

## Recursive-grammar verification: 2026-11-06

The [verification record](beamer-intricate-fuzzing-results.json) covers six
recursive decks, all 22 authored frames and 40 overlay states. Every reference
compiled and retained its declared frame/text/paint witnesses. The strict
comparison reported 22 failing frame cases; these share causes and are not
claimed as 22 independent bugs. Two renderer issues were isolated in small,
independently compiled fixtures: local macro redefinition and columns within a
block. Both were strict failing reproductions at this stage and are now fixed
under the same comparison gates (see the November 7 results).

The original recursive editing pilot passed 350 warm/cold comparisons across
six decks; the final varied-macro plan passed another 119 across two decks.
These agreements coexist with independent TeX mismatches. The 256-seed grammar
check observed 77 parent/child interactions within its nesting/node budgets.
All 62 targeted tests and 18 live oracle tests passed, including exact
rematerialization of 163 legacy editing recipes and full-deck glyph equivalence
after alias-based redefinition. Type checking and production lint passed.

Raw sources, sampled trees, macro plans, all page comparisons and the gallery
are in `artifacts/beamer-fuzz/intricate-macro-grammar/`. `audit.mjs` and
`verification.json` verify generator/source fingerprints, frame/page identity,
visible oracle witnesses and overlay-paint visibility. The two reduced findings
are in `test/fixtures/beamer/fuzz-findings-v4/`.

## Renderer fixes and fresh seed: 2026-11-07

The original four isolated renderer findings are fixed under their original
strict gates: ordinary inline pictures share their prose paragraph; title-page
flow clears preceding depth; macro declarations execute in source order with
local restoration; and columns within blocks compose their measured boxes.
Further strict cases cover long infolines titles, bindings carried across
structural boundaries, and declaration aliases called between and within
frames. The eleven cases in `fuzz-findings-v3` through `v6`, plus `v8`, now pass independent
LuaLaTeX comparisons and are included in the passing frozen collection.
Recursive column editing scopes and the shipped Beamer previews were updated
alongside the renderer. The fresh validation passes 1,402 tests in 81 files.
The [verification record](beamer-fuzz-fixes-results.json) records the earlier
full-suite failures and their passing reruns, rather than reporting that earlier
run as green.

A fresh seed (`20261107`) generated 12 recursive decks, 39 authored frames and
81 overlay states. All independent references retain their source identity and
visible witnesses. Twenty-seven frame cases pass; the twelve richly composed
first frames still fail. These failures share causes and are not counted as
twelve distinct bugs. Two interactions have small, valid, strict failing
[reproductions](../test/fixtures/beamer/fuzz-findings-v7/README.md): blocks within
list items and columns within formatting groups. They remain outside the
passing frozen collection. The source manifests, all state comparisons,
gallery and source/witness audit are saved in
`artifacts/beamer-fuzz/fixes-fresh-intricate/`.

Reduction exposed an acceptance-policy error: the independent TeX reducer was
also using the warm/cold reducer's ban on literal native output. That ban blocks
precisely the bugs that print source syntax. The independent predicate already
checks valid TeX, source identity, visible witnesses, renderer diagnostics and
the mismatch category; it now controls acceptance for this mode. A 32-attempt
run accepted no reductions under the old guard. With the correction, sixteen
attempts accepted three reductions, shrinking the same source from 5,919 to
3,344 bytes and independently reproducing its rule mismatch again at the end.
This is a bounded reduction, not a minimality claim. The original guard remains
in place for editing-cache reduction.

Calendar assignments are protected during reduction, and the older default-date
fixture pins its original calendar so it survives midnight. Witness spelling
recognizes Latin presentation ligatures; exact glyph, font, transform and
geometry comparisons still use the original trace values.

The editing soak then passed eight sequences (six fresh recursive decks and two
corpus mutations), with 729 warm/cold comparisons, all fourteen edit fields,
7,161/11,177 mapped branch arms and no coverage-contract errors. Its audit
recomputes recipe identities, child implementation fingerprints, comparison
totals and the coverage union from saved worker data. This soak preceded the
last renderer correction described below; its implementation fingerprint is
retained in the verification record.

Three final edited documents were materialized from those exact recipes,
checking every source mutation against the saved concrete operations, including
undo. Independent LuaLaTeX checks of their second authored frames passed two
cases and found a 3.486241pt vertical error in the third after switching to 20pt.
Short 20pt Roman and sans controls both passed. The reduced ten-line
[overfull frame](../test/fixtures/beamer/fuzz-findings-v8/README.md) exposed the
cause: native packing shrank the natural `.2cm` top skip to the available free
height, while Beamer preserves it on overfull `[t]` frames. Preserving that skip
fixes the small reproduction (maximum glyph-Y error below 0.0001pt) and all
three edited context checks. This is a renderer bug that 729 warm/cold agreements
alone could not identify.

A further 48 reduction attempts accepted five changes and reached 2,095 bytes,
then independently reproduced the same mismatch category again. Category
identity does not prove root-cause identity: reducing template/preamble settings
can introduce other missing rules. This automatic output is retained for
investigation and is not counted as an additional distinct bug or a globally
minimal reproduction.

After the top-skip correction, the final 81-file validation passes 1,402 tests,
including all 169 frozen fidelity cases, the corpus-wide caret-domain check and
preview synchronization. An exact replay of the offending editing recipe passes
another 90 warm/cold comparisons on the corrected implementation; its audit
also reports no identity, coverage or receipt errors.
