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
remaining fresh cases with the recursive version-4 grammar. `--profile intricate`
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
checks the result. The examples are kept as regression tests.

The image extension adds PNG/JPEG/PDF leaves and a focused `--profile images`.
Its controlled filesystem adapter exercises real lookup, decoding and cache
behavior. Node PDF paint uses saved Poppler pages. The
[image tests](includegraphics-fuzzing.md) separately compare rendering with TeX.

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
The [fidelity regression tests](beamer-fidelity-campaign.md) cover rendering
behaviour separately from this cache-consistency fuzzer.
