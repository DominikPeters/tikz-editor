# Adversarial Fuzzing for the TeX Text Engine

## Status

Operational, with completion criteria still open (July 2026).

The shared package, production-derived registries, recursive text/document/math
generators, profile and adaptive weighting, malformed mutation, stateful edit
harness, hard layout invariants, shrinking, replay/artifact formats, batched
LuaLaTeX support and generated-paragraph geometry oracles, content cache, and
PR/nightly/soak entry points are now implemented. Existing parser, paragraph,
inline/display math, visual, and hit-map fuzzers consume the shared generator.

The native gate now renders every selected case at 48, 160, and 480pt; checks
finite geometry, caret/source ranges, deterministic repetition, linear segment
flow where that model applies, and preservation of visible generated leaves;
and executes malformed cases, sampled typing prefixes, and actual metamorphic
pairs. Mutation regressions prove that this gate rejects both finite geometry
corruption and silent removal of a final painted segment. Generation receives
live feature-frequency feedback rather than merely testing the weighting
utility in isolation.

Dense aggressive cases often intentionally enter partial-fallback paths. Each
tier therefore enforces a separate `supported-aggressive` quota: deterministic,
bounded rejection sampling admits only distinct cases that produce canonical,
fallback-free, error-free reports with no literal-degraded segments at 48,
160, and 480pt. Accepted-feature feedback favors underrepresented syntax. The
PR, nightly, and soak quotas are 32, 128, and 256 real generated cases; failure
to fill a quota is explicit and includes rejection/diversity statistics.
Controlled projections remain useful mutation canaries, but no longer carry
the burden of exercising supported production behavior.

Visible prose is compared as an exact ordered semantic stream. Generated AST
leaves supply expected text; report segments supply painted text; NFC handles
accent/precomposed equivalence; phantom-family hiding and atomic text boxes
have explicit rules. Whitespace geometry remains a separate invariant. A
bounded Levenshtein distance and compact first-difference context are attached
for diagnosis only—any non-whitespace substitution, deletion, duplication, or
reordering is still a hard mismatch.

A July 2026 mutation audit exercised the real CLI gate, not only unit-test
seams:

| Injected renderer defect | Result |
| --- | --- |
| Restore non-finite glue-ratio propagation | caught |
| Halve finite justified glue stretch | caught by generated LuaLaTeX sample |
| Drop every line's final painted segment | caught by supported generated controls |
| Halve finite segment widths without moving following segments | caught |
| Remove painted source attribution | caught |
| Erase text while retaining geometry and attribution | initially missed, invariant strengthened, then caught |
| Replace painted text with different nonempty text | caught by exact semantic diff without projection controls |
| Reverse finite caret-stop order | caught |

Finding counts are not used as a strength metric because one mutation may
produce hundreds of line/segment observations. The runner preserves those
observations but shrinks one representative per diagnostic class.

The supported lane itself discovered two baseline defects during integration:
starred `\\*[length]` syntax leaked its star/argument into painted prose,
suggested `\linebreak[n]` could swallow following grouped prose, and
literal-degraded reports could claim top-level support. The line-break scanner
now consumes the star, `\newline`, and priorities 0–4 (lower priorities become
real Knuth–Plass penalties), and support classification now rejects literal,
noncanonical, external-fallback, missing-report, and error-bearing results.

The scheduled LuaLaTeX gate sends a coverage-stratified sample of generated
cases through a batched paragraph oracle. It projects arbitrary generated
syntax to replayable controlled prose, compares line text and realized
interword glue, caches observations, bisects compilation failures, emits
structured artifacts, and fails on new geometry findings. Mutation regressions
prove that halved glue and dropped final text are detected. The richer legacy
math/display/visual comparisons remain diagnostic layers and are not yet all
normalized into this shared finding pipeline.

The generated edit-sequence suite runs cases through the real app compute
adapter and compares genuinely reused parser/semantic stages with a fresh full
render. The standalone CLI still uses its lightweight model adapter, and TeX
text shaping remains a fresh computation; neither path claims shaping reuse
without production evidence. The optional corpus-mining pipeline, a fully
pinned TeX container, richer calibrated metamorphic relations, visual-funnel
integration, and native incremental-shaping instrumentation remain follow-ups.

This status is intentionally narrower than “design implemented.” The final
completion criterion still requires a scheduled run to discover, minimize,
replay, fix, and permanently regress a previously unknown bug.

This document specifies a replacement for the current collection of mostly
shallow, deterministic TeX fuzz generators with a shared adversarial fuzzing
system. It complements `design/tex-text-visual-fuzz.md`, which remains the
operational description of the existing LuaLaTeX/SVG visual oracle.

## Thesis

The success metric for a fuzzing system is not the percentage of generated
cases that stay green. It is:

> **Novel, minimized, reproducible counterexamples per CPU-minute.**

The current fuzz infrastructure is valuable, but much of it is better
described as randomized regression sampling. Its generators use small,
carefully supported vocabularies, shallow nesting, fixed seeds, and modest
case counts. That makes the suite stable, but it biases it away from precisely
the combinations most likely to expose parser, layout, source-map, fallback,
cache, and editor-state bugs.

The new system should make the TeX renderer uncomfortable on purpose. It
should generate deep valid structures, nearly valid typing states, malformed
inputs, real-world feature combinations, boundary values, and long stateful
editing sequences. Red findings are useful diagnostic output. Only defined
hard failures need to make every pull request red.

## Strategic Priority

The fuzzing kernel is the strategy; source-corpus mining is an optional source
of novelty for that kernel. The project must not postpone recursive generation,
stateful editing, invariants, shrinking, replay, or diversity feedback while it
builds an acquisition pipeline.

Human-authored TeX is valuable because it reveals combinations and idioms that
the generator's designers did not anticipate. Its best output is therefore a
new structural recipe or generator capability, not a large collection of
papers replayed as opaque regression tests. Once learned, a recipe should be
parameterized, composed with unrelated features, mutated, and shrunk by the
shared system.

A reasonable initial allocation of implementation effort is:

- **70–80%:** generator model, feature registry, invariants, stateful edits,
  shrinking, replay, and diagnostic artifacts;
- **15–20%:** mining repository examples and a small opt-in local-paper set for
  missing structural recipes;
- **5–10%:** external acquisition, license filtering, and Luna synthesis.

These percentages describe priorities rather than permanent staffing. Corpus
mining becomes more useful after the kernel can measure whether a discovered
recipe adds feature-pair, feature-triple, depth, boundary, or authoring-style
coverage. Before that point, collecting more papers mostly increases volume
without increasing diagnostic power.

## Goals

- Exercise every native text and math IR construct, or record an explicit
  exclusion with a reason.
- Maximize structural diversity, including feature pairs and triples, nesting
  depth, mode transitions, font/style combinations, Unicode classes, layout
  boundaries, and malformed-input categories.
- Test parser robustness, rendering fidelity, source attribution, hit geometry,
  incremental recomputation, caching, and editor behavior as one connected
  system.
- Compare against LuaLaTeX at multiple semantic levels: support classification,
  lines, boxes, glyphs, fonts, positions, rules, paint, and final raster output.
- Find failures without depending on an external oracle through strong
  invariants and metamorphic relations.
- Automatically shrink failures into small, readable reproducers.
- Store a stable replay bundle for every finding and promote fixed findings
  into permanent regression tests.
- Support fast deterministic pull-request checks, broader nightly diagnostics,
  and long-running soak jobs from the same generator infrastructure.
- Optionally mine structurally interesting TeX from temporary first-party or
  external corpora, after the core kernel is operational, without vendoring or
  redistributing their expressive content.

## Non-goals

- Treating every LuaLaTeX pixel difference as a pull-request blocker.
- Claiming that a declared source license or an automated similarity check is
  legal clearance.
- Compiling untrusted downloaded TeX source trees.
- Replacing focused hand-written regression tests. Fuzzing discovers and
  generalizes bugs; focused tests document their intended fix.
- Measuring success by raw case count alone.

## Current State and Diagnosis

The repository already has several strong pieces:

- `test/tex-shaping.spec.ts` contains deterministic text, inline-math,
  display-math, and document hit-map fuzz loops.
- `scripts/fuzz-tex-math.mjs` checks parser crash resistance and source-span
  bounds across 10,000 generated cases.
- `scripts/compare-tex-math.mjs` compares generated formula metrics with
  LuaLaTeX.
- `scripts/compare-tex-text-visual-fuzz.mjs` compares paragraph lines, glyph
  traces, fonts, positions, SVG traces, and raster output.
- `scripts/compare-tex-inline-math-paragraph.mjs` and
  `scripts/compare-tex-display-math.mjs` exercise inline and display layout.
- `scripts/lib/tex-oracle.mjs` provides shared TeX-oracle process support.

The central weakness is duplicated generation logic. The parser fuzzer, math
oracle, text visual oracle, inline/display runners, paragraph runner, and
Vitest hit-map tests each own a different small syntax vocabulary. A renderer
feature can acquire excellent fixed tests while remaining absent from every
randomized generator.

The current generators also favor known-successful constructs. Typical depth
is one or two, unsupported diagnostics are counted rather than classified by
novelty, and most random cases are independent final strings rather than
editing histories. External TeX-oracle fuzz commands are not run by the
default GitHub workflow.

The existing commands remain useful during migration:

```sh
npm run fuzz:tex-math:parser
npm run compare:tex-text-visual-fuzz:smoke
npm run compare:tex-text-visual-fuzz:mixed
npm run compare:tex-text-visual-fuzz:large
npm run compare:tex-math:fuzz
npm run compare:tex-math:fuzz:large
npm run compare:tex-math:aligned-fuzz
npm run compare:tex-inline-math-paragraph:mixed-fuzz
npm run compare:tex-inline-math:fidelity:large
npm run compare:tex-display-math:fuzz
npm run compare:tex-display-math:fidelity:large
npm run test:tex-math:hitmap
```

## Design Principles

### Red is data

Exploratory fuzz jobs should be allowed to discover and retain new oracle
mismatches. A red diagnostic dashboard is evidence that the system is doing
work. A red main branch should be reserved for hard safety/correctness
invariants or an untriaged policy violation.

### Generate structures, not strings

The primary generator should build a typed TeX fuzz AST and serialize it only
after generation. This permits category-correct nesting, accurate generation
traces, feature accounting, source maps, and AST-aware shrinking.

Raw-string mutation remains a separate and equally important strategy for
malformed inputs and typing prefixes.

### Bias toward discontinuities

Uniform randomness spends most time far from interesting boundaries. The
generator should deliberately target:

- widths immediately below and above a line-break transition;
- optical font-size transitions;
- script and scriptscript transitions;
- box widths around natural width, `\fboxsep`, and `\fboxrule` boundaries;
- CMEX next-larger and extender thresholds;
- empty, singleton, and oversized arguments;
- negative, zero, extreme, and barely valid dimensions;
- group and declaration boundaries;
- every delimiter and environment boundary offset;
- NFC/NFD Unicode variants and combining-mark order;
- unsupported material adjacent to supported material;
- source edits that enter and leave malformed intermediate states.

### Store decisions, not only seeds

A seed alone is not stable after generator evolution. Replay bundles must store
the generator version, generation profile, choice trace, serialized source,
mutation operations, and expected invariant/failure fingerprint.

Generation decisions must use deterministic integer sampling. Floating-point
weights may be accepted as configuration, but they must be normalized once to
versioned integer weights with a defined rounding rule before selection. A
replay must not depend on platform floating-point behavior.

## Architecture

Add a private workspace package, `packages/tex-fuzz`, published internally as
`@tikz-editor/tex-fuzz`. Production packages must not depend on it.

```text
feature registry ─┬─> recursive AST generators ─> printer + source map ─┐
                  ├─> corpus recipe adapters ──────────────────────────┤
                  └─> coverage targets / weights ─────────────────────┤
                                                                      v
raw mutations ───────────────> case + trace ─> runner ─> invariants/oracles
stateful edit generator ─────> edit sequence ────────┘          │
metamorphic transforms ──────> related cases ───────────────────┤
                                                                 v
                                                    signature + artifact bundle
                                                                 │
                                                                 v
                                               AST/string shrinker + replay test
```

### Proposed package structure

```text
packages/tex-fuzz/
  package.json
  src/
    index.ts
    model.ts
    random.ts
    features.ts
    profiles.ts
    generate-text.ts
    generate-math.ts
    generate-document.ts
    print.ts
    mutate.ts
    edit-sequences.ts
    metamorphic.ts
    shrink.ts
    coverage.ts
    case-format.ts
```

Environment-specific execution stays outside the package:

```text
scripts/lib/tex-fuzz-runner.mjs
scripts/run-tex-fuzz.mjs
scripts/replay-tex-fuzz.mjs
```

The runner should reuse `scripts/lib/tex-oracle.mjs` rather than introducing a
second TeX process layer.

## Shared Data Model

The exact types may evolve, but the model needs these concepts:

```ts
interface FuzzCase {
  schemaVersion: number;
  generatorVersion: string;
  profile: string;
  seed: number;
  choiceTrace: readonly ChoiceRecord[];
  source: string;
  generatedSourceMap?: readonly GeneratedRange[];
  featureTags: readonly string[];
  mutationOps?: readonly MutationOperation[];
  provenance?: FuzzProvenance;
}

interface FuzzFinding {
  case: FuzzCase;
  class: "hard-invariant" | "new-differential" | "known-differential";
  fingerprint: string;
  invariant: string;
  ours: unknown;
  oracle?: unknown;
  artifacts: readonly string[];
}
```

The AST should distinguish syntactic categories rather than exposing one
unrestricted node union:

- text document, block, paragraph, inline, declaration, and inline box;
- math list, atom, scriptable nucleus, relation, operator, delimiter, accent,
  alphabet, array cell, and environment;
- valid, intentionally unsupported, and malformed expectations;
- source-affecting wrappers such as macros and aliases;
- stateful preamble/context definitions separate from node contents.

## Single Feature Registry

`features.ts` is the authoritative fuzz-generation registry. Each construct
records:

- syntactic category and arity;
- text or math mode;
- allowed children and nesting constraints;
- required package/context;
- native support expectation;
- printer strategy;
- base weight and boundary variants;
- feature and coverage tags;
- known oracle qualifications;
- shrink strategy;
- explicit reason if it is not currently generated.

Exporting the relevant production command/IR registries is a named kernel
deliverable, owned by the root integrator. Fuzz adapters must consume those
registries wherever they are the production source of truth; they must not
introduce another hand-copied command table. A drift test must fail when a
native IR or registered command has neither a generator entry nor an explicit,
reviewed exclusion. Where production behavior has no registry today, Phase 0
must either introduce one or document why an adapter cannot derive its cases.

## Generation Strategies

### Recursive valid generation

Generation uses independent size and depth budgets. It should usually produce
small cases but retain a heavy tail that reaches depth 8–15 and occasionally
larger. Categories control which children can appear, while profiles control
weights.

Representative compositions include:

- styled Unicode inside `\colorbox` inside text superscripts;
- scoped declarations crossing adjacent groups without leaking;
- inline math adjacent to ties and forced breaks;
- `\boldsymbol{\widehat{\mathfrak{g_i}}}`;
- braces over fractions containing matrices;
- `dcases` cells containing text, boxes, scripts, and wide accents;
- nested macros that expand to styles or math wrappers;
- empty and one-character forms of every supported construct.

The generator must not globally reject a case merely because one component is
unsupported. Mixed supported/literal rendering is an important target.

### Malformed and typing-prefix generation

Start from a valid AST/serialization and apply one or more recorded damages:

- truncate at every source offset;
- remove, duplicate, or swap braces/brackets;
- corrupt control words one character at a time;
- duplicate or reorder scripts;
- mismatch `\begin` and `\end`;
- insert alignment tabs or row breaks in unusual positions;
- split a grapheme cluster;
- insert whitespace/comments inside commands;
- damage color models, dimensions, and optional arguments;
- splice an unsupported command into a supported construct.

Every prefix of an interesting source is itself a candidate editor state.

### Corpus mutation

Seed cases from PGF documentation, repository examples, MathJax corpus slices,
stored failures, and manually extracted content-free recipes. Parse them into
fuzz ASTs, then:

- delete and duplicate subtrees;
- cross-splice category-compatible subtrees;
- replace leaves and dimensions;
- increase nesting;
- move declarations across groups;
- convert between equivalent spellings;
- inject boundary values and malformed edits.

### Stateful editor generation

A stateful profile should generate an initial node plus a sequence of editor
operations:

- insert, delete, and replace arbitrary ranges;
- move/collapse/extend selections;
- paste supported and malformed fragments;
- undo and redo;
- switch nodes and return;
- change width, font, color aliases, and mode;
- dispatch an operation derived from an older snapshot after intervening
  source changes;
- interleave asynchronous compute completion, selection changes, undo/redo,
  and node switching;
- trigger incremental recomputation between operations.

After every step, compare incremental output with a fresh full parse/evaluation
only for paths that actually reuse incremental parser, semantic, shaping, or
render state. First instrument which stages were reused. If TeX shaping is
currently always fresh, do not claim incremental-shaping coverage; emphasize
stale-snapshot guards, hit maps, selection, undo/redo, and final convergence.
Use the operation and invariant vocabulary in `design/edit-staleness.md` as a
required input to this profile.

### Metamorphic generation

Metamorphic transformations declare an expected relation without requiring an
external oracle at run time, but TeX equivalence must not be guessed. Every
relation has a domain predicate, known-exceptions field, compared observables,
and a calibration corpus. Before activation, run original/transformed pairs
through LuaLaTeX; if TeX itself violates the proposed relation in its stated
domain, narrow or reject the relation.

Safe initial candidates include:

- NFC and NFD forms agree only for supported code points whose TeX shaping and
  font fallback are calibrated as equivalent;
- `\textcolor{red}{x}` and `{\color{red}x}` agree for a scoped body and color
  model supported by both engines;
- replacing a color alias with its resolved value preserves paint while source
  attribution remains independently valid;
- `\ensuremath{x}` agrees with inline math only in calibrated text contexts;
- a deliberately defined identity macro preserves the observables in its
  supported argument domain;
- a TeX tie never becomes a breakpoint;
- repeated rendering is deterministic;
- unsupported input never silently disappears.

Do not assume that inserting `{}`, splitting adjacent styled runs, or adding
group boundaries preserves geometry: group boundaries can break ligatures and
kerning. Do not use paragraph-width/line-count monotonicity as a hard relation;
TeX line breaking is a global optimization. Such transforms may still be
generated as differential probes, but disagreement is data rather than an
invariant violation.

## Oracles and Invariants

### Hard invariants

These always fail the active job:

- crash, uncaught exception, timeout, or runaway memory;
- NaN/infinite/negative-impossible geometry;
- source ranges outside the source, inverted ranges, or non-monotonic caret
  stops;
- silent source loss or unsupported content disappearing;
- incremental/full divergence for a stage proven to have reused incremental
  state;
- nondeterministic output for the same complete replay case;
- cache collision returning output for different semantic inputs;
- offset-to-point or point-to-caret APIs producing invalid ranges;
- source archive or raw external passage entering a staged fixture.

### Differential oracles

Compare our renderer with LuaLaTeX at progressively richer layers:

1. supported/error classification;
2. line count and line text;
3. box width, height, depth, and baseline;
4. glyph sequence, font ID, optical size, and positions;
5. rules, extenders, and paint;
6. SVG bounds and structural trace;
7. raster difference normalized against TeX self-noise.

Structural traces should be preferred for diagnosis. Pixel differences remain
useful but should not obscure whether the root cause is line breaking, font
selection, spacing, baseline placement, or painting.

### Oracle economics and environment

LuaLaTeX compilation is a scarce resource, especially during shrinking. Each
execution tier must publish a compile budget, wall-clock budget, maximum
parallelism, timeout, and cache-hit rate. Rotating cases are expected cache
misses; planning must not assume a warm content cache.

Process and preamble startup currently dominate small oracle cases. A local
July 2026 benchmark with LuaHBTeX 1.21.0 / TeX Live 2025 and a representative
TikZ, styled-text, Unicode, and math preamble measured:

| Workload | Wall time |
| --- | ---: |
| Ten separate LuaLaTeX processes | 2.52 s |
| One LuaLaTeX process containing ten isolated cases | 0.25 s |

This synthetic benchmark is not a throughput promise, especially for raster
work, but the approximately 10× difference makes batching the default oracle
architecture rather than a later optimization.

### Batched oracle execution

Compile valid structural cases in batches, initially benchmarking sizes such as
32, 64, and 128. Every case must have a stable ID, an outer TeX group, isolated
boxes and output records, and explicit begin/end markers in the trace. The
runner parses a single JSON/TSV result into per-case observations.

Batching must not weaken isolation:

- calibrate representative cases standalone and in batches, in multiple
  orders, and require identical compared observables;
- reset all repository-owned counters, dimensions, boxes, attributes, macro
  definitions, and trace state between cases;
- periodically inject sentinels that detect global-state leakage;
- on compilation failure, bisect the batch and replay the smallest failing
  partition or individual case;
- keep malformed-input robustness in the native parser fuzzer rather than
  sending arbitrary invalid documents to a shared oracle batch.

Differential shrinking should batch all independent candidates from one shrink
round into one or a few compilations. The shrink algorithm then selects the
smallest candidate preserving the versioned fingerprint and begins the next
round. Cache duplicate candidates before constructing a batch.

Use a bounded asynchronous worker pool for independent batches, with separate
working directories and a shared prewarmed TeX cache. Determine worker count by
measurement on CI hardware; batching reduces total work and therefore precedes
parallelism.

Use a funnel rather than compiling every generated case:

1. Run parser, hard invariants, metamorphic checks, and our renderer locally.
2. Select a coverage-stratified and novelty-weighted oracle sample.
3. Compare the cheapest semantic layer capable of exposing the target bug.
4. Escalate only surviving findings toward glyph/SVG/raster comparison.

For the visual fuzzer, combine PDF generation and the Lua node trace into one
LuaLaTeX document instead of compiling separate visual and trace documents.
Run broad batched structural comparisons first. Generate SVGs for structural
findings plus a diversity-stratified control sample, and rasterize only the
subset needed to detect or diagnose paint/backend differences. Because visual
bugs can exist without structural divergence, the control sample must remain
large and diverse enough to measure that escape rate.

Use draft mode when a layer needs no PDF, subject to standalone-versus-draft
calibration. Avoid invoking `pdftocairo`, `dvisvgm`, rasterizers, or image
comparison for layers that consume only Lua/log traces.

Initial budgets must be measured with a small benchmark before nightly case
counts are committed. Record compile latency percentiles and use them to set
the nightly budget. Parallel compilation must be capped to avoid converting a
fuzz job into resource contention noise.

Pin the TeX Live distribution and relevant binaries in CI. Every finding
bundle records the LuaLaTeX engine/banner, format, TeX Live revision,
`dvisvgm`, rasterizer, fonts, platform/container digest, and oracle-runner
version. A finding produced under a different oracle environment is a distinct
observation until explicitly reconciled.

Use one content-addressed oracle cache shared across runners. Its key includes
source, preamble, requested oracle layer, trace schema, engine/format, TeX Live,
fonts, and converter versions. Store structural results independently from
large visual artifacts so cheap cache hits do not require copying PDFs and
rasters.

A custom precompiled LuaLaTeX format containing the stable package preamble may
be investigated only after batching, staging, concurrency, and shared caching
are measured. It adds package-initialization and format-versioning risk and is
not part of the initial implementation.

### Editor invariants

- All selections and caret offsets stay within the current source.
- Exact round trips succeed where the hit geometry is unambiguous.
- Geometry for deleted source is not retained.
- Undo/redo restores byte-identical source and equivalent rendering.
- Returning to the original source produces identical output.
- Literal fallback remains visible and editable throughout malformed states.
- Source maps retain macro and alias provenance without rewriting source text.

## Coverage and Diversity Feedback

The runner should feed coverage information back into generation weights. The
first version can be registry-based rather than native-code coverage-guided:

- feature and IR-node counts;
- feature pairs and triples;
- maximum and distribution of depth/size;
- Unicode blocks and normalization forms;
- font family × series × shape × math style;
- boundary classes reached;
- supported, literal-fallback, parser-error, and oracle-error rates;
- source-range and caret-boundary categories;
- unique diagnostics and failure fingerprints;
- mutation-operation and edit-sequence coverage.

Selection should reward novelty. Ten thousand near-identical fractions should
not score as highly as a small set reaching new construct pairs, depth classes,
or source-boundary interactions.

Later, V8 branch coverage may supplement registry feedback, but it must not
replace semantic diversity metrics.

## Shrinking and Replay

Shrinking is part of the finding pipeline, not a manual afterthought.

AST-aware shrink candidates should include:

- remove siblings, rows, cells, scripts, wrappers, and declarations;
- unwrap groups and boxes;
- replace complex leaves with `x`, `1`, or a short neutral word;
- reduce dimensions toward zero and known thresholds;
- reduce environment size and nesting;
- simplify colors, alphabets, delimiters, and accents;
- shorten edit sequences while preserving the final failure;
- reduce malformed mutations to the smallest damaging operation.

String delta-debugging runs after AST shrinking for failures that depend on
malformed syntax.

Hard-invariant findings shrink in-process without an external-oracle budget.
Differential findings shrink against the earliest and cheapest layer that
still expresses the divergence—classification before lines, lines before box
metrics, structural traces before raster. Give each finding explicit limits on
candidate evaluations, oracle compiles, elapsed time, and parallelism. A
partial shrink remains replayable and may continue in a later job. Raster
comparison must not sit inside the inner shrink loop unless raster output is
the first divergent layer.

### Failure fingerprints

The shrink predicate is a stable failure fingerprint, not merely “still
fails.” This prevents a shrinker from changing an interesting geometry bug
into an unrelated parse error.

A versioned fingerprint contains:

- result class: hard invariant, differential, timeout, or resource limit;
- invariant/diagnostic code or first divergent oracle layer;
- normalized feature-tag set and TeX mode;
- coarse structural locus, such as node kind plus ancestor-kind path;
- normalized operation kind for stateful failures;
- oracle-environment family for differential findings.

It explicitly excludes exact coordinates, pixel hashes, raw error prose,
absolute paths, seed, case size, and unquantized delta magnitudes. A finding may
store those as evidence, but they are not identity. Where magnitude matters,
use named severity buckets with versioned thresholds.

Deduplication may group findings by this fingerprint while retaining multiple
minimal witnesses when their structural recipes differ. Shrinking preserves
the result class, first divergent layer, and structural locus; feature tags may
only be removed when the fingerprint schema marks them incidental.

Every artifact bundle contains:

- replay JSON and exact source;
- minimized replay JSON and source;
- generator/profile version and choice trace;
- failure fingerprint and classification;
- our semantic/layout/glyph trace;
- oracle trace where applicable;
- SVG/raster artifacts where applicable;
- complete oracle-environment manifest;
- shrink budget consumed, termination reason, and remaining candidate queue
  when continuation is supported;
- one command that reproduces the finding.

## Red Policy

### Hard failures

Hard invariants fail pull requests, nightly jobs, and soak runs.

### New differential findings

Nightly and soak jobs save and minimize new mismatches. They should make the
diagnostic job red or “needs triage,” but do not automatically block every
unrelated pull request.

### Known differential findings

Known findings have a checked-in fingerprint, reason, owner/status, and scope.
The system must fail when:

- the fingerprint changes unexpectedly;
- occurrence count or affected feature coverage expands;
- a finding marked fixed reappears;
- an allowlist entry lacks a reason or expires.

Allowlist growth must be an explicit reviewed change, never an automatic
“update snapshots” operation.

Legitimate renderer or oracle changes may move many findings at once. Provide
a sanctioned re-baselining command that runs both revisions in the pinned
oracle environment, produces an old-to-new fingerprint mapping, separates
resolved/new/split/merged findings, and requires reviewed justification before
writing the baseline. Expected movement is reviewed evidence, not a storm of
independent unexplained failures.

## Execution Tiers

### Pull-request smoke

- 30–60 second budget.
- Fixed, versioned seeds plus a stable canary/replay set; rebases and unrelated
  commits must not silently select different cases.
- Thousands of shallow parser/property cases, but only a measured number of
  layout cases with explicit size/depth caps.
- Hard invariants and metamorphic properties.
- Small replay corpus of previous failures.
- No network access.

### Nightly diagnostic

- Multiple rotating seeds.
- Newly discovered hard failures are minimized and proposed for the fixed
  canary set rather than ambushing unrelated pull requests.
- LuaLaTeX glyph/box differential runs.
- Stateful edit sequences.
- Stored corpus mutation.
- Automatic minimization and artifact upload.
- New differential findings require triage.

### Weekly soak

- High depth and large size budgets.
- Long editor histories and cache stress.
- Broad seed rotation and feature-pair/triad targeting.
- Concurrency, cancellation, and repeated-render determinism checks.
- Coverage/diversity trend report.

### Manual networked mining

- Explicit command and operator intent.
- arXiv or other external-source acquisition.
- Never part of ordinary CI.
- Produces only synthetic candidate fixtures and provenance reports.

## Deferred Corpus Mining

Real-paper mining is an optional, later-stage novelty feed. Begin with manual
recipe extraction from PGF documentation and two or three explicitly selected
local papers. Automate acquisition or Luna synthesis only if repeated manual
pilots demonstrate both measurable coverage value and material tedium.

The complete license, privacy, safe-acquisition, sanitization, synthesis, and
retention design lives in `design/tex-text-corpus-mining.md`. None of that
pipeline blocks the fuzzing kernel, registry drift test, invariants, replay,
fingerprints, or shrinking.
## Parallel Subagent Implementation Plan

Parallelism begins only after a working serial vertical slice exposes the real
couplings between the AST, registry, generator, printer, runner, fingerprint,
and shrinker. Contracts are expected to change during that slice. All
implementation briefs must state that agents may not spawn subagents; the root
coordinator owns delegation, shared schemas, integration, and policy choices.

### Phase 0: serial vertical slice

The root/coordinator implements an end-to-end slice with roughly ten constructs
covering text, math, grouping, styling, Unicode, and one malformed form:

- export or introduce the relevant production command/IR registry APIs;
- define the smallest versioned fuzz AST, case, choice-trace, and fingerprint
  schemas needed by the slice;
- implement deterministic integer RNG decisions, one text/math generator, the
  printer, and source map;
- implement two hard invariants and one LuaLaTeX structural differential;
- shrink both one hard-invariant canary and one differential canary;
- replay the minimized cases in a separate process;
- make the registry drift test fail for an unaccounted production construct;
- benchmark oracle compile and differential-shrink costs;
- record the oracle environment in every bundle.

The slice is complete only when a generated case travels through generation,
execution, fingerprinting, shrinking, replay, and artifact emission. Then
review and freeze schema version 1 for the breadth phase. This freeze is a
versioning point, not a claim that future schema migrations will be unnecessary.

### Phase 1: parallel kernel breadth

After the vertical slice, agents extend non-overlapping files against its tested
contracts:

- **Agent A — model/RNG/printer breadth:** remaining AST nodes, source maps, and
  cross-process determinism fixtures.
- **Agent B — production registry/coverage:** registry exports, explicit
  exclusions, profiles, pair/triple/depth/boundary accounting, and drift tests.
- **Agent C — mutation/metamorphic/shrinking breadth:** malformed operations,
  TeX-calibrated relation domains, fingerprint-preserving reducers, and budget
  enforcement.
- **Agent D — generator breadth:** text, math, and document families using the
  production-derived registry and frozen model.

Root integrates continuously. A contract change requires a schema-version
change plus coordinated fixtures, not an agent-local workaround or copied
registry.

### Phase 2: existing-runner adapters

Parallel migration proceeds by file ownership:

- **Agent A — parser fuzz adapter:** scripts/fuzz-tex-math.mjs.
- **Agent B — math oracles:** scripts/compare-tex-math.mjs, then inline and
  display math consumers.
- **Agent C — prose visual/paragraph:**
  scripts/compare-tex-text-visual-fuzz.mjs and
  scripts/compare-paragraph-breaks.mjs.
- **Agent D — Vitest hit maps:** replace embedded generators and the fixed
  formula pool in test/tex-shaping.spec.ts.

Old flags and commands remain during migration for bisectability. Delete a
legacy generator only after its profiles replay through the shared package and
its feature coverage is equal or better.

### Phase 3: parallel diagnostic capabilities

- **Agent A — stateful editor fuzzing:** implement the operations from
  design/edit-staleness.md, instrument actual incremental reuse, and test stale
  snapshots, hit maps, selections, undo/redo, and convergence.
- **Agent B — artifacts/replay/re-baselining:** versioned fingerprints, bundles,
  replay CLI, minimization continuation, stored failures, and reviewed
  old-to-new baseline mapping.
- **Agent C — diversity feedback:** semantic telemetry, adaptive integer
  weighting, novelty selection, and trend reports.
- **Agent D — oracle hardening:** batched case protocol, isolation canaries,
  failure bisection, shrink-round batching, combined visual/trace compilation,
  staged trace/SVG/raster funnel, bounded workers, pinned environment, shared
  cache, budgets, cancellation, and resource caps.

Corpus automation is not part of this phase. If manual recipe extraction later
justifies it, follow design/tex-text-corpus-mining.md as a separately approved
project.

### Phase 4: CI tiers and soak operation

- Add fixed-seed, bounded-depth hard-invariant PR smoke.
- Add nightly rotating generation, budgeted oracle sampling, shrinking, and
  artifact upload.
- Automatically propose minimized hard findings for the fixed canary set.
- Add a scheduled weekly soak with heavy tails and long edit histories.
- Publish diversity, oracle-cost, shrink-cost, and finding trends.

## Implementation Milestones

### Milestone 1: working vertical slice

- Private package builds without production dependency edges.
- Approximately ten constructs exercise generation through minimized replay.
- Production registry export and drift test are proven end to end.
- One hard and one differential canary shrink with versioned fingerprints.
- Oracle compile/shrink costs are benchmarked and its environment is recorded.

### Milestone 2: reproducible kernel breadth

- Same seed/profile produces byte-identical AST, source, source map, and choice
  trace in separate processes.
- Replay works after changing generator weights because source and operations
  are stored.
- Registry drift test accounts for every native construct.
- Recursive valid generation reaches all supported text/math categories.
- Malformed/prefix mutation covers every delimiter/argument boundary.
- Hard invariants and TeX-calibrated metamorphic relations run in Vitest.

### Milestone 3: differential diagnosis

- Existing LuaLaTeX runners consume shared cases.
- Findings include glyph/box/rule traces and stable signatures.
- AST-aware shrinking preserves signatures.
- Stored findings replay with one command.
- Differential shrinking respects layer-specific compile/time budgets.
- Structural and shrink-round cases use calibrated batching with isolation
  canaries and failure bisection.
- The visual runner produces its PDF and Lua node trace in one compilation and
  escalates only sampled/interesting cases to SVG and raster layers.
- Re-baselining produces a reviewed old-to-new fingerprint map.

### Milestone 4: operational maturity

- PR, nightly, and soak tiers are live.
- Every new native feature must update or explicitly exclude its fuzz registry
  entry.
- New findings are minimized and triaged automatically.
- Coverage reports include pairs/triples/depth/boundaries and trend over time.
- Stateful editor fuzz covers stale-snapshot, selection, hit-map, undo/redo,
  and convergence behavior, plus incremental/full equivalence only where reuse
  instrumentation proves the comparison meaningful.

## Completion Criteria

The project can call this design implemented when:

- every native text/math IR kind is generated or explicitly excluded;
- same-seed output is deterministic and replay is generator-version resilient;
- all hard invariants block the appropriate tier;
- the stateful editor fuzzer covers the staleness operation vocabulary and
  checks incremental/full equivalence for stages that actually reuse state;
- valid, malformed, metamorphic, and boundary-targeted profiles share one case
  model; corpus-mutated profiles use it as well if corpus mining is enabled;
- LuaLaTeX comparisons produce structured, minimized findings;
- shrinkers preserve failure fingerprints;
- feature pair/triple, depth, Unicode, font/style, and boundary coverage are
  reported;
- at least one scheduled diagnostic or soak run has found, minimized, replayed,
  and then permanently regressed a previously unknown bug.

## Open Questions

- Should the first adaptive weighting system use semantic registry coverage
  only, or also V8 branch coverage?
- What compile and shrink budgets do the vertical-slice benchmarks support on
  CI hardware?
- What batch sizes, worker count, and visual control-sample rate maximize
  findings per CPU-minute without hiding isolation or raster-only failures?
- Which differential classes should become pull-request blockers after their
  baselines stabilize?
- How should fuzz cases requiring project-level macro/color context be divided
  between the core fuzz AST and runner setup?
