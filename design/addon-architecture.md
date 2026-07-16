# Add-On Architecture

## Purpose

Users keep asking for pgfplots support. Implementing it faithfully means a
large body of code (a key system, axis survey/scaling, tick placement, plot
handlers) that is best translated from or closely modeled on the GPL-licensed
pgfplots sources. The main editor is MIT-licensed; pgfplots support therefore
should not live in `packages/core` or ship inside the main app bundles.

Instead, this document proposes re-architecting the editor to support
**add-ons**: separately distributed packages that extend the parser, the
semantic evaluator, rendering, the inspector, canvas editing, and completions.
pgfplots becomes the first add-on. The same mechanism should later carry
CircuiTikZ-style component libraries, and whimsical packages like tikzducks —
anything that is "a TeX package that extends TikZ" rather than "a feature of
TikZ itself".

Decisions already made:

- **Loading model: API-first, both mechanisms.** An add-on is a plain ES
  module exporting a typed registration object. The same module can be
  statically bundled (dev, tests, opt-in builds) or dynamically `import()`ed
  at runtime from a separately hosted bundle.
- **Trust model: trusted/curated.** Add-ons run in-process with full access to
  the registration API. No sandbox, no message-passing boundary. Users install
  from a curated list.
- **Scope: "foreign environment/command" add-ons.** V1 targets add-ons that
  claim environments (`axis`) and commands (`\addplot`, `\duck`) and supply
  parsing, evaluation, rendering, inspection, and editing for them. Finer
  extension points (node shapes, arrow tips, decorations) are designed *for*
  but not built now.
- **Shells: web + desktop in v1.** iPad later (App Store rules constrain
  downloaded code; a bundled-but-toggleable variant remains possible).
- **Grammar: hybrid.** One-time host grammar seam for generic environments;
  add-ons hand-parse raw slices; optional Lezer sub-grammars for highlighting.
- **API boundary: a new published `@tikz-editor/addon-api` package.** Core
  stays unpublished; add-ons never import core directly.
- **Activation: preamble/content-driven.** Installed and enabled add-ons
  declare triggers; documents that don't use them are untouched.
- **Dogfooding: design for it, don't do it yet.** Registries are shaped so
  core's own constructs could migrate onto them later, without refactoring
  core now.

## Goals

- A pgfplots add-on (2D axes, linear/log scales, `\addplot` with coordinates
  and expressions, ticks, grids, legends) can be built as a separate package
  against a stable, small API, and loaded at runtime in the web and desktop
  shells.
- Add-on-rendered content is a first-class citizen: correct bounding boxes,
  selection, hit-testing, incremental re-render during drags, inspector
  editing, source round-tripping, and standalone-LaTeX export preamble lines.
- The MIT core and app bundles contain no add-on code. The GPL boundary is a
  runtime module boundary, not a build-time merge.
- Add-ons interoperate with surrounding TikZ: they can export named
  coordinates/anchors and coordinate systems (`axis cs:`) usable by ordinary
  TikZ statements later in the same picture, and they can re-invoke the host
  parser/evaluator on TikZ fragments inside their own bodies.
- The API stays small enough to version honestly (semver on
  `@tikz-editor/addon-api`), and forward-compatible with moving compute into a
  Web Worker.

## Non-Goals

- Sandboxing or capability-restricting add-on code. Add-ons are trusted.
- A public marketplace, discovery UI, or third-party submission pipeline.
- Migrating existing core features (shapes, decorations, arrow tips) onto the
  add-on API now.
- Runtime extension of the compiled Lezer grammar itself. (LR tables are
  frozen at compile time; we work around this, see Parsing.)
- iPad add-on loading in v1.
- Raw-SVG rendering escape hatches. Add-ons lower to core scene primitives;
  this is what keeps editing/bbox/incremental machinery working (see
  Rendering).

## Current State

### Pipeline

```text
source
  -> scanTikzFigures (regex, tikzpicture only)        parser/figure-scan.ts
  -> Lezer parse (compiled grammar)                    packages/lezer-tikz
  -> CST -> AST (hand-written dispatch)                transform/cst-to-ast.ts,
                                                       domains/statements/parse.ts
  -> semantic evaluation (AST -> SceneElement[])       semantic/evaluate.ts
  -> SVG emit (SceneElement kind switch)               svg/emit.ts
```

The IR is a **flat display list**: `SceneElement = ScenePath | SceneCircle |
SceneEllipse | SceneText` (`semantic/types.ts`), each carrying `sourceRef`
(sourceId + span + fingerprint), `layer`, `style: ResolvedStyle`, and optional
`clipChain`. Every higher-level construct (nodes, pics, plots, matrices,
trees) is *lowered* to these four primitives during evaluation. There is no
group/container node; z-order comes from `layer`, provenance from `origin`.

The app layer (`packages/app`) runs `computeSnapshot` (sync behind a promise,
structured-clone-compatible by design for a future worker), a
reducer+Zustand store, and a drag pipeline that re-runs `applyEditAction` per
pointermove and unlocks an incremental fast path (patch-based incremental
reparse + checkpoint/replay semantic evaluation + SVG model reuse) keyed by
`changedSourceIds`.

### What is already extensible-shaped

- **`PicDefinitionRegistry`** (`semantic/pics/registry.ts`): a runtime
  `Map<string, PicDefinition>` populated during evaluation; pic bodies are
  TikZ source re-parsed and evaluated into ordinary scene elements. This is
  the template for both "registry populated per evaluation" and "add-on
  re-invokes the host on nested TikZ".
- **`PROPERTY_REGISTRY`** (`edit/property-registry.ts`): declarative table of
  editable properties (detection keys, conflict keys, write mutations) that
  drives the inspector. The right shape for add-on-contributed properties,
  currently keyed by a closed union.
- **Capabilities matrix** (`capabilities/`): per-feature, per-layer support
  status. The right vocabulary for an add-on manifest's capability
  declaration, currently a closed `FeatureId` list.
- **Platform adapter** (`packages/app/src/platform/`): the one genuine
  dependency-injection seam; proof the codebase tolerates injected service
  interfaces well.
- **Lazy loading**: `React.lazy` for every secondary modal, cached-promise
  `import()` for mathlive/jspdf/svgo/pdfjs, per-font-subset loader thunks in
  the thumbnail worker. Dynamic `import()` is already idiomatic here.
- **pgfmath + foreach**: `semantic/pgfmath/evaluator.ts`
  (`evaluatePgfMathExpression`) and `packages/core/src/foreach/` are exactly
  the computation services a pgfplots add-on needs and must not re-implement.

### What is closed today (the dispatch points to open)

*Update 2026-07-11: three rows changed state with the quality branch.
Inspector: `getInspectorDescriptor` is decomposed into per-section builders
registered in `edit/inspector/section-builder.ts` — the provider registry
now exists; Phase C only needs to open registration. Style keys:
`apply-kv.ts` is a key→handler table (`createKvHandlerMap`). Capabilities:
registries are derived from the matrix, so namespaced feature ids are a
one-line widening. The "Needed change" column below reflects the original
state.*

| Dispatch point | Where | Needed change |
|---|---|---|
| Figure discovery | `parser/figure-scan.ts` (tikzpicture regex) | unchanged for v1 (axis lives inside tikzpicture) |
| Grammar tokens | `lezer-tikz/src/grammar/tikz.grammar` | one-time generic-environment seam + generic macro statement |
| CST→AST statement dispatch | `domains/statements/parse.ts` (`mapStatementNode`) | consult add-on routing table before `UnknownStatement` |
| Statement evaluation | `semantic/evaluate.ts` (`evaluateStatement`, terminal `unsupported-statement` fallback) | consult add-on handlers before fallback |
| Coordinate systems | `semantic/coords/evaluate.ts` (`parseExplicitCoordinate`: perpendicular/intersection/canvas only) | coordinate-system resolver registry |
| Style keys | `semantic/style/apply-kv.ts` / `apply-flag.ts` | *inverted*: host exposes `resolveStyle` to add-ons; key-handler registration deferred |
| SVG emit | `svg/emit.ts` kind switch | unchanged (add-ons emit core elements) |
| Edit actions | `edit/actions.ts` (`applyEditAction` switch) | one generic `addonEdit` variant routed to add-ons |
| Edit handles | `semantic/types.ts` `EditHandle` union | one generic `addon` handle variant |
| Inspector | `edit/inspector.ts` (monolithic `getInspectorDescriptor`) | provider registry consulted first |
| Properties | `edit/property-registry.ts` (`SemanticPropertyId` closed) | namespaced add-on property ids |
| Completion | `SourcePanel.tsx` single `tikzCompletion` override | composable completion-source list |
| Scrubbing | `source-panel/number-scrubber.ts` (`classifyScrubContext` key sets) | add-on-contributed key tables |
| Templates/insert | `edit/element-templates.ts` | add-on template registry (phase 2) |
| Menus/commands | `app-menu/types.ts` + `editor-command-runtime.ts` (closed `AppMenuCommandId`) | namespaced command ids (phase 2) |
| Capabilities | `capabilities/feature-ids.ts` (closed) | namespaced add-on feature ids |
| Export preamble | `semantic/required-tikz-libraries.ts` | manifest-contributed `\usepackage`/`\pgfplotsset` lines |
| Settings | `settings/types.ts` (flat `AppSettings`) | `addons` section (enablement + per-add-on bag) |

### What pgfplots actually requires (the grey-box finding)

A survey of the pgfplots sources (`examples/pgfplots`, GPLv3) shows the add-on
cannot be a black box that swallows `\begin{axis}...\end{axis}`:

- All axis-family environments (`axis`, `semilogxaxis`, `loglogaxis`,
  `groupplot`, ...) lower to one engine; the add-on claims a *set* of
  environment names.
- `\addplot`'s source clause is a keyword-dispatched mini-grammar
  (`coordinates {...}`, `table[...]{...}`, `{expr}`, ...), terminated by `;`.
- pgfplots registers **TikZ coordinate systems** (`axis cs:`, `rel axis cs:`,
  `axis description cs:`) via `\tikzdeclarecoordinatesystem`; these are usable
  by ordinary `\draw` statements *outside* the axis environment, after it.
- Named nodes/anchors defined inside the axis (`current axis.north east`,
  user nodes) are referenced outside it.
- The axis participates in the picture bounding box and clips its plot area.
- Axis bodies contain arbitrary TikZ (`\node at (axis cs:...)`), so the add-on
  must re-invoke the host parser/evaluator on nested fragments (pics
  precedent).
- Needed computation: pgfmath (exists in core), foreach (exists), nice-tick
  placement (~100 lines TS, ported), log transforms (trivial), no FPU needed
  (float64).
- Needed text: tick labels, axis labels, titles, legends — all placeable via
  the host node-text machinery, *including reading back measured text
  dimensions* for legend sizing and label layout.
- Standalone macros outside owned environments exist too: `\pgfplotsset`
  (preamble or picture level), `\pgfplotstableread`, tikzducks' `\duck` — so
  command claiming must work outside owned environments, and some claimed
  macros are not semicolon-terminated.

### Intersections with the 2026-07-03 code review

A full-codebase review (`CODE-REVIEW-2026-07-03.md`, now in `design/`)
surfaced findings that overlap this design. Each is justified on its own
merits — none migrates core onto the add-on API, so the "design for it,
don't do it yet" decision stands — but sequencing them before Phases A–C
makes several hooks cheaper:

**Status (2026-07-11): every item in this list landed with the
`code-quality-2026-07-10` branch** (derived registries, inspector section
builders with the provider-registry signature, the frame-meta map, COW
registries + budget pattern, content-hash def ids, centralized parse
options, and the `kind` result convention). Phase 0 below is therefore
complete; Phase A can plug into existing registries.

- **Derived capability registries** (review 3.6). The four lists in
  `capabilities/registries.ts` are hand-maintained but fully derivable from
  the matrix. Deriving them first turns the namespaced-feature-id widening
  into a one-line change instead of four coordinated list edits.
- **Inspector decomposition** (review 3.5 / note E). Splitting
  `getInspectorDescriptor` into per-section builders should use the *same*
  `SectionBuilder(ctx) => InspectorSection | null` signature as the
  provider registry Phase C introduces — core's own sections become the
  first providers, so Phase C's hook is a registry that already exists
  rather than a mechanism bolted onto a monolith.
- **Frame-meta map** (review 3.2). Replacing the 22 hardcoded
  `every*NodeStyles` frame fields with one map keyed by shape name is the
  data-driven shape a future node-shape extension point needs, and deletes
  ~600 lines today.
- **Evaluator cost contract** (review note B). The `AddonRuntime`
  registries (routing tables, coordinate-system resolvers, named-anchor
  exports) should be layered/copy-on-write from day one — the review found
  core's own per-frame registries are deep-cloned per statement, and new
  registries must not repeat that pattern. Relatedly, `engine.evaluate`
  must run under the host's evaluation budget (see the purity requirements
  below); the uncapped-`\graph` freeze (review 1.4) is the cautionary tale.
- **Stable SVG def ids** (review 1.3 / note F). The incremental SVG model
  reuse path mis-links sequence-numbered gradient/pattern defs after edits.
  Content-hash def ids are a prerequisite for add-on-emitted elements with
  shading to survive the reuse path this design relies on for drag
  performance.
- **App-side `EditContext`** (review note C). Consolidating the four
  parseOptions/analysis/fingerprint recipes into one owned object makes
  `HostEditContext` a thin view over it instead of a fifth re-derivation.
- **Result convention** (review 3.9). `AddonParseResult`, `AddonEvalResult`
  and `AddonEditResult` should adopt the
  `kind: "success" | "partial" | "unsupported" | "error"` discriminant used
  by core's edit actions, since add-on results flow through the same
  feedback paths.

## Architecture Overview

```text
            +--------------------------------------------------+
            |  add-on package (separate repo / bundle, e.g. GPL) |
            |    engine entry (worker-safe)      ui entry        |
            |    parse / evaluate / edit         inspector, ...  |
            +---------------------|----------------------------+
                                  | implements types from
                                  v
            +--------------------------------------------------+
            |  @tikz-editor/addon-api  (published, MIT, semver) |
            |    manifest & module types, HostContext interfaces|
            |    test harness helpers                           |
            +---------------------|----------------------------+
                                  | implemented by
                                  v
   +-----------------------------------------------------------------+
   | packages/core: AddonRuntime (registries) + hooks at the closed   |
   | dispatch points; packages/app: loader, settings, UI contributions|
   +-----------------------------------------------------------------+
```

An add-on is two ES modules described by one manifest:

- **engine entry** — pure logic: statement parsing, semantic evaluation, edit
  application, completion data. No DOM, no React. This is the part that must
  keep working when `computeSnapshot` moves into a Web Worker, so it must be
  importable there.
- **ui entry** — React components (inspector section renderers, future
  panels), loaded lazily on the main thread only, following the existing
  `React.lazy` pattern.

Everything an add-on receives from the host arrives through **injected
context objects** (`HostParseContext`, `HostEvalContext`, `HostEditContext`),
never through imports of core. `@tikz-editor/addon-api` contains only types
and small pure helpers; it has no runtime dependency on core. This keeps the
compile-time surface small, makes the license boundary a genuine arm's-length
interface, and lets core refactor internals freely behind the facade.

## The `@tikz-editor/addon-api` package

### Manifest

```ts
export type AddonManifest = {
  id: string;                        // "pgfplots"
  version: string;                   // add-on's own semver
  apiVersion: string;                // semver range of addon-api it targets
  displayName: string;
  license: string;                   // shown in the add-on manager UI
  sourceUrl: string;                 // corresponding-source link (GPL compliance)
  triggers: {
    environments?: string[];         // ["axis", "semilogxaxis", ...]
    commands?: string[];             // ["\\addplot", "\\addplot3", "\\pgfplotsset"]
    packages?: string[];             // usepackage names: ["pgfplots"]
    tikzLibraries?: string[];        // \usetikzlibrary / \usepgfplotslibrary names
  };
  // for standalone-LaTeX export of documents that use this add-on:
  requiredPreamble?: string[];       // ["\\usepackage{pgfplots}", "\\pgfplotsset{compat=1.18}"]
  capabilities?: AddonCapabilityRow[]; // namespaced feature ids + per-layer status
  entries: { engine: string; ui?: string }; // module specifiers within the bundle
};
```

Trigger semantics (preamble/content-driven activation): an installed+enabled
add-on participates in a document's pipeline iff the document mentions one of
its triggers — an owned environment or command appears in the source, or a
`\usepackage`/`\usetikzlibrary` line names it. Cheap substring/regex prescan,
same spirit as `scanTikzFigures`. Documents that never mention pgfplots pay
nothing.

Conflicts (two enabled add-ons claiming the same environment/command) are
rejected at registration time with a visible error; first-enabled wins, the
second is deactivated with a notice. Curated distribution makes this rare.

### Module shape

```ts
// engine entry (worker-safe)
import type { AddonEngine } from "@tikz-editor/addon-api";
const engine: AddonEngine = {
  manifest,
  parseEnvironment(env, ctx) { ... },      // -> AddonParseResult
  parseCommand(cmd, ctx) { ... },          // -> AddonParseResult
  evaluate(statement, ctx) { ... },        // -> AddonEvalResult
  applyEdit(edit, ctx) { ... },            // -> AddonEditResult
  completion?: { optionKeys, valueMap, scrubKeys },
};
export default engine;

// ui entry (main thread only)
import type { AddonUi } from "@tikz-editor/addon-api";
const ui: AddonUi = {
  inspector(statement, payload, ctx) { ... }, // -> InspectorSection[]
  // later: templates, commands, panels
};
export default ui;
```

All payloads that cross between engine results and app state
(`AddonParseResult.payload`, `AddonEvalResult` contents) must be **plain
structured-clone-compatible data** — no functions, no class instances. This
is required because they ride inside `SessionSnapshot`, which is designed for
worker transfer.

## Parsing

### Routing and AST representation

Core's `Statement` union gains exactly **two** new generic members (not
per-add-on kinds), so exhaustive switches in core stay finite:

```ts
type AddonEnvironmentStatement = {
  kind: "AddonEnvironment";
  id: string; span: Span;
  addonId: string; envName: string;
  options?: OptionListAst;           // parsed generically by parseOptionListRaw
  bodySpan: Span;                    // raw slice boundaries
  body?: Statement[];                // host-parsed interior (see below)
  payload?: unknown;                 // add-on's own parse result (plain data)
};

type AddonCommandStatement = {
  kind: "AddonCommand";
  id: string; span: Span;
  addonId: string; commandName: string;
  argsSpan: Span;                    // raw slice after the command name
  payload?: unknown;
};
```

`mapStatementNode` consults the routing table (env/command name → add-on)
before falling through to `UnknownStatement`. On a hit it builds the generic
statement, then calls the add-on's `parseEnvironment`/`parseCommand` with a
`HostParseContext`:

```ts
type HostParseContext = {
  source: string;                                  // full document
  slice(span: Span): string;
  parseOptionList(raw: string, from: number): OptionListAst;
  parseTikzStatements(span: Span): Statement[];    // re-invoke host CST->AST
  readBalancedGroup(from: number): Span | null;    // brace scanning helper
  pushDiagnostic(d: AddonDiagnostic): void;
};
```

For pgfplots, the axis body is *also* parsed by the host
(`parseTikzStatements`), because axis interiors contain ordinary TikZ
statements plus claimed `\addplot` commands — which route back to the add-on
as nested `AddonCommandStatement`s. The add-on's own payload stores what the
host cannot represent (the parsed coordinate list of `coordinates {...}`, the
expression of `{expr}` plots), keyed for later evaluation and inspection.

### Grammar seam (one-time core work)

The compiled Lezer LR tables cannot be extended at runtime, so the host
grammar grows two generic productions, once:

1. **`GenericEnvironment`** — `BeginEnvGeneric BodyItem* EndEnvGeneric`, where
   `BeginEnvGeneric` matches `\begin{name}` for any name that is not one of
   the dedicated tokens (tikzpicture/scope keep their precedence). LR cannot
   enforce begin/end name matching; the CST→AST layer validates the names and
   emits a diagnostic on mismatch. Interiors keep being parsed by the host
   grammar (statements, groups, option lists), which is what makes
   `parseTikzStatements` on the body cheap.
2. **`MacroStatement`** — `CommandName (OptionList | Group)*` *without* a
   required semicolon, for claimed macros like `\pgfplotsset{...}` or
   `\duck[...]` that are not path commands. This is the delicate one (greedy
   termination vs. `UnknownStatement`'s `;` rule); if it turns out to
   destabilize the grammar, the fallback is that the CST→AST layer re-scans
   claimed-command regions with the existing hand-written balanced-group
   scanners (`readBalancedDelimited` precedent in `cst-to-ast.ts`) over
   `UnknownStatement`/error regions. Semicolon-terminated claimed commands
   (`\addplot ... ;`) already parse fine as `UnknownStatement` today.

Unclaimed generic environments (no enabled add-on owns them) map to a
diagnostic-bearing unknown statement, same behavior as today — but the
message can now say "install/enable an add-on that provides `axis`".

### Preamble scanning

The parser only sees tikzpicture windows; preamble-level configuration
(`\pgfplotsset{compat=...}`, `\pgfplotstableread`, `\usepgfplotslibrary`)
needs a separate hook. Add-ons may register a **preamble scanner**: a pure
function over the full source (the region outside figures that
`resolveParseWindowSource` masks today) returning plain-data config that is
handed to every subsequent `evaluate` call for that document. This mirrors
how `scanTikzFigures` and the scoped macro/color collectors already bypass
Lezer.

### Highlighting, folding, completion

- **Baseline (v1):** claimed regions get generic environment
  highlighting/folding from the `GenericEnvironment` node; interiors keep
  normal TikZ highlighting. This is already acceptable for pgfplots since
  axis bodies are TikZ-shaped.
- **Optional sub-grammar:** an add-on may ship its own *compiled* Lezer
  grammar and a `parseMixed` mount point keyed on its claimed environment
  regions (wired through `lang-tikz`'s existing `parser.configure` path).
  Highlighting-only; the semantic pipeline never depends on it.
- **Completion:** `SourcePanel`'s single `override: [tikzCompletion]` becomes
  a composed list: host source + one source per active add-on, fed by the
  engine's declarative `completion` tables (option keys, value maps) plus the
  document symbols the add-on exports (e.g. legend names). Doc-hover can stay
  host-only in v1.

## Semantic Evaluation

### The evaluation hook

`evaluateStatement` gains a branch for the two generic statement kinds before
the `unsupported-statement` fallback: it looks up the owning add-on and calls
`engine.evaluate(statement, ctx)` with a `HostEvalContext` facade. The facade
is the heart of the API; pgfplots v1 needs, and v1 of the API exposes,
roughly:

```ts
type HostEvalContext = {
  // --- style (reuse, don't reimplement) ---
  defaultStyle(): ResolvedStyle;
  resolveStyle(entries: OptionEntry[], base: ResolvedStyle):
    { style: ResolvedStyle; unhandled: OptionEntry[] };  // TikZ subset; leftovers
                                                          // are the add-on's keys
  // --- geometry & coordinates ---
  frameToWorld(p: FrameLocalPoint): WorldPoint;
  evaluateCoordinate(raw: string): WorldPoint | null;     // host coord evaluator
  writeNamedCoordinate(name: string, p: WorldPoint): void;
  registerNodeGeometry(name: string, geometry: NodeGeometryLike): void; // anchors
  registerCoordinateSystem(name: string,
    resolve: (args: string) => WorldPoint | null): void;  // "axis cs:" etc.
  extendPictureBounds(b: WorldBounds): void;
  makeClipPath(commands: ScenePathCommand[]): ClipRef;    // for clipChain
  // --- text (reuse node-text machinery incl. measurement) ---
  layoutText(text: string, options: TextLayoutOptions, style: ResolvedStyle):
    { element: SceneText; metrics: { width; height; baseline } };
  // --- computation ---
  pgfmath(expr: string): PgfMathResult;                   // evaluatePgfMathExpression
  foreach: HostForeachApi;                                // sampling/domain expansion
  // --- nesting (pics precedent) ---
  evaluateTikzStatements(statements: Statement[],
    frame: ChildFrameOptions): SceneElement[];
  // --- bookkeeping ---
  makeElementId(suffix: string): string;                  // ids under this sourceId
  pushDiagnostic(d: AddonDiagnostic): void;
  markFeature(featureId: AddonFeatureId, status: "supported"|"unsupported"): void;
  createHandle(h: AddonHandleSpec): void;                 // see Editing
  preambleConfig: unknown;                                // from the preamble scanner
};
```

The add-on returns `SceneElement[]` (constructed via context helpers so ids,
`sourceRef`, layers, and fingerprints are host-stamped) — the host splices
them into the flat display list. Nothing downstream (SVG emit, hit regions,
bbox, selection) changes at all, because the emitted elements are ordinary
core primitives.

Coordinate-system registration makes `parseExplicitCoordinate` consult a
per-evaluation registry after its built-ins, so `\draw (axis cs:1,2) ...`
works in statements evaluated *after* the axis, matching TeX's order
semantics. Registrations and named-coordinate writes die with the evaluation
run, like all other context state.

### Incremental rendering and purity

The drag fast path (checkpoint/replay in `semantic/incremental.ts`) works on
add-on statements without special cases **provided** dependency edges are
right. Rather than asking add-ons to declare reads/writes manually, the
`HostEvalContext` is instrumented: every `evaluateCoordinate`/named-coordinate
read, and every `writeNamedCoordinate`/`registerCoordinateSystem` write, is
recorded against the statement's `sourceId` and fed into the existing
dependency graph that `collectGeometryInvalidation` consumes. A statement
that later resolves `axis cs:` acquires an edge to the axis statement
automatically.

Requirements this imposes on `engine.evaluate`:

- **Pure and deterministic** over `(statement, ctx)` — no module-level
  mutable state, no wall-clock/random inputs (randomness via the host's
  seeded rng if ever needed). This is what makes checkpoint/replay and
  worker migration safe.
- **Budgeted.** Evaluation runs under the host's evaluation budget (the
  same mechanism that caps `\foreach` expansion, extended per the
  2026-07-03 review to graphs and any future expander): context factories
  count produced elements/points against the cap and abort with a
  diagnostic past it, so a pathological `samples=` value degrades to a
  warning rather than a frozen keystroke.
- Coarse granularity is acceptable in v1: an edit anywhere inside an axis
  environment invalidates and re-evaluates that whole environment (one
  statement). Axis evaluation is O(plot points) in TS; this comfortably fits
  the drag budget, and per-`\addplot` sub-granularity can come later since
  `\addplot`s are separate nested statements with their own sourceIds.

### Diagnostics, capabilities, export

- Claimed statements no longer produce `unsupported-statement` warnings; the
  add-on pushes its own diagnostics (with its own codes) through the context.
- Manifest `capabilities` rows use namespaced feature ids
  (`addon:pgfplots:axis-2d`); `FeatureUsage`/DevPanel merge them with core's
  matrix. Core's `FeatureId` type widens to
  `CoreFeatureId | \`addon:${string}\``.
- Standalone-LaTeX export unions `requiredPreamble` lines from every add-on
  whose statements appear in the exported figure (extends
  `inferRequiredTikzLibraries`).

## Rendering

No SVG-emit changes. Add-ons must lower to core scene primitives; this is a
deliberate constraint, not a limitation to fix later:

- It is exactly how core's own high-level constructs (nodes, pics, matrices,
  plots) already work.
- It is what makes hit regions, selection, bbox, incremental SVG reuse,
  export, and thumbnails work for free.
- A raw-SVG escape hatch would silently break all of the above and invite
  add-ons to bypass the style system; if a genuinely new primitive is ever
  needed (e.g. a mesh/gradient for `surf` plots), it should be added to core's
  `SceneElement` union as a proper primitive instead.

## Editing and Interaction

### Selection and hit-testing

Free: emitted elements carry the claiming statement's `sourceRef`, so
clicking a plotted path selects the `\addplot` statement (or the axis, for
axis chrome — the add-on chooses which nested sourceId to stamp on each
element). `buildHitRegions` and the objects panel work unchanged; the objects
panel shows add-on statements with a label the engine provides.

### Handles and edit actions

Two generic extensions, mirroring the AST approach:

```ts
// core EditHandle union gains:
type AddonEditHandle = {
  handleType: "addon"; id: string;
  addonId: string; sourceRef: SourceRef;
  world: WorldPoint; role: string;          // "axis-corner", "data-point", ...
  data?: unknown;                            // plain data for the add-on
};

// core EditAction union gains:
type AddonEditAction = {
  kind: "addonEdit"; addonId: string; edit: unknown;
};
```

During evaluation the add-on creates handles via `ctx.createHandle`. During a
drag, the canvas controller (generic code) asks the engine to translate a
handle drag into an edit: `engine.planHandleDrag(handle, newWorld, ctx) ->
AddonEditAction | null`, then dispatches it through the normal
`applyActionWithFeedback` path. `applyEditAction`'s switch routes
`addonEdit` to `engine.applyEdit(edit, HostEditContext)`, which returns
`{ patches: SourcePatch[]; changedSourceIds: string[] }` — plugging directly
into the existing patch/normalization/incremental machinery. `HostEditContext`
exposes the shared edit-analysis view (source, statement snapshot, option-list
rewriting helpers like "set key `xmin` in this option list to `-2.5`,
inserting or replacing").

For pgfplots v1 this covers: dragging axis corner/edge handles rewrites
`xmin/xmax/ymin/ymax` (or `width/height`), dragging a data point rewrites one
coordinate pair inside `coordinates {...}`.

### Inspector

`useInspectorModel`'s descriptor chain consults an add-on provider registry
before the core fallback: for a selected `AddonEnvironment`/`AddonCommand`
statement, the add-on's **ui entry** builds `InspectorSection[]` from the
*existing* property kinds (number, length, text, color, dropdown...), so no
new property renderers are needed. Property writes emit `addonEdit` actions.
Add-on-declared properties get namespaced ids (`SemanticPropertyId |
\`addon:${string}\``) so `PROPERTY_REGISTRY`-driven code keeps typechecking.

### Scrubbing (cheap, do first)

`classifyScrubContext`'s key sets become composable: engines contribute
`scrubKeys` (e.g. `xmin/xmax/ymin/ymax/domain/samples` as appropriate numeric
classes). Source-panel number scrubbing inside axis options then works with
zero further integration, because scrubbing already rides the
`changedSourceIds` incremental path.

### Templates, menus, commands (phase 2)

Insertion ("Insert axis" tool/menu item) needs the element-template registry
and namespaced command ids (`addon:pgfplots:insert-axis`) threaded through
`editor-command-runtime`. Deferred behind the core editing loop; in v1 users
type `\begin{axis}` (with completion) to create one.

## App Layer: Settings, Loading, Distribution

### Settings and enablement

`AppSettings` gains an `addons` section:

```ts
addons: {
  installed: Record<string, {
    enabled: boolean;
    source: { kind: "builtin" } | { kind: "url"; url: string; integrity?: string };
    version: string;
    settings?: unknown;               // add-on's own settings bag
  }>;
}
```

A minimal add-on manager UI (list, enable/disable, add-by-URL, show
license/version) lives in the existing Settings modal, lazily loaded.

### Loader

One loader in `packages/app`, two entry paths:

- **Static:** shells (or tests) pass modules directly:
  `<App addons={[pgfplotsEngineAndUi]} />`. Used for dev iteration on an
  add-on (vite aliasing a local checkout) and for possible
  bundled-but-toggleable builds (the future iPad story).
- **Dynamic:** `import(/* @vite-ignore */ resolvedUrl)` of the engine entry
  (and lazily the ui entry) from the configured source, after an apiVersion
  compatibility check against the manifest. Cached-promise pattern, identical
  to the jspdf/mathlive precedents. Load failures disable the add-on for the
  session with a visible notice; documents then show the ordinary
  "unsupported" diagnostics rather than breaking.

Shell specifics:

- **Web:** no CSP is enforced today (the `script-src 'self'` note in
  `vite.config.ts` is aspirational). To keep that hardening path open, the
  default distribution story is **same-origin hosting**: add-on bundles are
  deployed under the site (e.g. `/editor/addons/pgfplots/<version>/...`) so a
  future `script-src 'self'` continues to work. Third-party origins would
  need a CSP allowlist entry; defer.
- **Desktop (Tauri):** `csp: null` today, so webview-side `import()` of a
  fetched or local bundle is unobstructed. Ship add-ons either by fetching
  from the same web origin or from a local add-ons directory surfaced through
  the existing platform adapter. The app updater (whole-app, signed) is
  unrelated; add-on updates are just re-fetching a newer bundle URL. When a
  real CSP is eventually adopted for the desktop webview, the add-on origin
  list must be part of it — noted as a follow-up, not a v1 blocker.
- **iPad (later):** App Store guideline 2.5.2 restricts downloaded executable
  code; WebKit-executed JS is a gray zone. The static path (bundled add-on,
  disabled by default, toggled in settings) is the safe design, which the
  API-first decision already supports. Out of scope for v1.

### Worker forward-compatibility

`computeSnapshot` is designed to move off the main thread. The design keeps
that door open: engine entries are DOM-free, payloads are structured-clone
data, and the loader records each active add-on's engine URL so a future
compute worker can `import()` the same engine modules inside the worker and
rebuild the same registries there. The registration API therefore must not
capture main-thread-only objects — enforced by keeping `HostContext`
interfaces free of DOM types and by an addon-api lint/test helper.

## Licensing

(Engineering-level analysis, not legal advice; the combined-work questions
below are genuinely unsettled law, and anything with real stakes — App Store
submission, commercialization — deserves proper counsel.)

### The pieces and their licenses

- **tikz-editor** (this repo): MIT. Root, `lezer-tikz`, and `lang-tikz`
  declare `"license": "MIT"`; `packages/core` and `packages/app` currently
  lack the field and should get it (housekeeping, Phase A).
- **`@tikz-editor/addon-api`**: MIT, intentionally tiny, published.
- **pgfplots** (upstream, Christian Feuersänger): GPL **v3 or later**. The
  copy at `examples/pgfplots` is *untracked* local reference material, like
  `pgf-src`/`pgf-docs` — the public repo conveys no GPL code today, and that
  must stay true.
- **PGF/TikZ itself** is dual-licensed (GPLv2 / LPPL); core already lives
  with this by *reimplementing behavior* from the manual and reference
  sources rather than translating code. The pgfplots question is the same
  question with a stricter upstream license (GPLv3+, no LPPL option).
- **Data files** inside pgfplots (ColorBrewer, Paul Tol palettes) carry their
  own permissive attribution licenses (Apache-style ColorBrewer license) —
  separately reusable regardless of the code decision.

### What copyright reaches, and what it doesn't

Translating or porting code (TeX → TypeScript) is a derivative work —
translation is the textbook example — so a port of the pgfplots sources
inherits GPLv3+. Structure-preserving paraphrase is still translation; you
cannot launder it by renaming variables.

What is *not* protected: key names (`xmin`, `legend pos`), command syntax,
observable behavior, file formats, and algorithms-as-ideas (idea/expression
dichotomy; *Google v. Oracle* on reimplementing APIs, *SAS v. WPL* in the EU
on functionality and languages). A pgfplots-**compatible** add-on with
identical key names and matching behavior can therefore be independently
written and permissively licensed — provided it is written from the manual
and from black-box observation, not from the code. If that path is ever
chosen, clean-room discipline applies: implement from documentation plus
oracle outputs, never paste or paraphrase `.code.tex`, keep provenance notes.

Running pgfplots is unrestricted either way: the GPL does not constrain use,
and does not claim the output of a program run on your own inputs — so the
oracle-comparison test loop (`compare:renderers` against real LaTeX+pgfplots)
is clean regardless of the add-on's license.

### If the add-on is GPL: what actually follows

GPL obligations attach to **conveying** (distribution), not to running. Three
consequences matter here:

1. **Conveying the add-on itself.** Whoever hosts the bundle must provide the
   license text and corresponding source. A public add-on repo plus a
   `sourceUrl` in the manifest satisfies this. Serving JavaScript to a
   browser *is* conveying — the hosted web app that serves the add-on bundle
   takes on these (light) duties; they are designed into the manifest and
   add-on manager below.
2. **The combined-work question.** The conservative (FSF) view is that an
   in-process plugin sharing data structures with its host forms a combined
   work. The design maximizes the separate-works posture — separate repo,
   separate bundle, off by default, user-initiated enablement, a versioned
   generic API that any add-on could implement against, core hooks
   describable without mentioning pgfplots (the litmus test) — and when the
   user's browser combines separately conveyed works at runtime, the app
   author conveys no combination. The residual scenario is hosting both on
   one origin where the app loads the add-on: someone could argue the site
   conveys the combination. Even under that worst-case reading, the decisive
   fact is that **MIT is GPL-compatible**: conveying an MIT app combined with
   a GPLv3 add-on is permitted; the combination is governed by GPLv3 terms,
   the MIT files remain MIT, and the corresponding-source obligation is
   already satisfied by the public repos. Nothing needs relicensing and no
   scenario here makes the main app "become GPL".
3. **What the worst case actually costs.** (a) The option to later distribute
   the app-with-add-on under proprietary terms — as long as the GPL add-on is
   integrated in what is conveyed, the combination stays GPL-governed.
   (b) **App Store distribution**: GPLv3 and Apple's App Store terms are
   widely considered incompatible (the store imposes additional
   restrictions), so iPad/App Store builds must **never bundle** the GPL
   add-on. The API-first design keeps iPad viable anyway: no pgfplots there,
   a future permissive add-on, or a web pointer. This is the one place the
   license choice constrains the product roadmap.

### If an installer bundles the GPL add-on

Shipping the add-on inside the desktop DMG/NSIS installers (and updater
artifacts — same analysis) is permissible and does not change the app's MIT
licensing; at worst the conveyed whole is GPL-governed, which an open-source
app already satisfies. It does add distributor duties for each such artifact:
include the GPLv3 text and upstream copyright notices (About → open-source
licenses screen plus LICENSE files); provide corresponding-source access for
the *exact shipped add-on version* (download page + in-app link to a matching
tag, kept available while old installers circulate); keep provenance/change
notices in ported files; and ensure no EULA terms restrict the GPL parts.
Anti-tivoization ("Installation Information") does not trigger — no device is
being conveyed. Prefer loading the bundled add-on from the app-support
directory rather than inside the signed .app (signature and update hygiene,
not a license requirement). The GPL-free alternative with nearly the same UX
is download-on-first-enable from the website, which preserves the simple
invariant "no GPL bytes in any first-party artifact"; bundling trades that
simplicity for offline completeness.

### Compliance mechanics designed in

- The manifest carries `license` and `sourceUrl`; the add-on manager UI shows
  both before enabling, and the bundle ships its LICENSE text.
- Ported files carry provenance headers ("derived from pgfplots x.y,
  `pgfplotsticks.code.tex`") — good hygiene and required change-marking.
- The curated list displays each add-on's license; a GPL add-on is normal and
  expected, not an error state.
- Core hooks stay generic (litmus test above); GPL reference trees stay
  untracked; `packages/core`/`packages/app` gain explicit MIT fields.

### The decision: port (GPLv3+) vs clean-room (permissive)

Recommendation: **accept GPLv3+ for the pgfplots add-on and port freely.**
Fidelity is this project's core value, the port path is faster and more
faithful (tick heuristics, scaling edge cases), and the architecture exists
precisely to make a GPL add-on distributable. The clean-room path from the
~560-page manual is substantially slower and buys freedom (App Store
bundling, proprietary futures) that the roadmap may never need. A third
option costs one email: ask upstream about dual-licensing or a linking
exception — PGF itself is dual-licensed, so the ecosystem has precedent.
Whichever is chosen should be recorded in the add-on repo from day one,
because it cannot be cleanly changed after porting has begun.

## Versioning and Compatibility

- `@tikz-editor/addon-api` follows semver; the manifest's `apiVersion` is a
  range checked at load. Breaking interface changes bump major; additive
  context services bump minor (add-ons feature-detect optional services).
- The addon-api package pins nothing from core: all types crossing the
  boundary are either defined in addon-api or re-exported by core *from*
  addon-api (core implements the interfaces, not the other way around).
  Scene-element construction goes through context factories, so core can
  evolve internal representations without breaking add-ons.
- The existing lockstep `version:bump` script does not apply; addon-api and
  add-ons version independently.

## Testing Strategy

- **addon-api test harness:** `createAddonTestHost(engine)` — run
  `parse+evaluate` over fixture sources with the add-on registered, snapshot
  the resulting `SceneElement[]`/SVG/diagnostics, apply `AddonEditAction`s
  and assert source patches. Ships in addon-api so add-on repos can test
  without core internals.
- **Core-side contract tests:** a toy in-repo test add-on (MIT, trivial —
  e.g. an environment that draws a smiley) exercising every hook:
  claiming, nested TikZ, coordinate-system export, handles, inspector,
  incremental invalidation. This is the API's regression suite and doubles as
  the reference implementation for add-on authors.
- **Capabilities drift:** `test/capabilities.spec.ts` extends to validate
  manifest capability rows of the test add-on.
- **Fidelity:** `npm run compare:renderers` works on pgfplots documents
  unmodified once export emits the add-on's `requiredPreamble` (the oracle
  side compiles real pgfplots). This gives the same oracle-comparison loop
  used for text layout.

## pgfplots Add-On v1 Scope (for grounding, lives in its own repo)

Ship first: 2D `axis` + semilog/loglog variants; `\addplot` with
`coordinates {...}` and `{expression}` (`domain`, `samples`); TikZ style
subset via host `resolveStyle` (color, mark, line width, dashed, only marks,
smooth); marks, grids, automatic + explicit ticks (nice-tick algorithm ported
to TS), axis labels, title, basic legend; `axis cs:` resolver + named axis
anchors; plot-area clip; bbox participation; `\pgfplotsset` + `compat` via
preamble scanner; inspector sections for axis bounds/labels/grid and per-plot
style; axis-corner and data-point drag handles; scrub keys.

Deferred: 3D/`\addplot3`, mesh/surf, groupplots, error bars, `table` files and
pgfplotstable, bar/stacked plots, polar/ternary/smithchart, colormaps,
`fill between`, gnuplot/shell sources.

This v1 set is chosen because it exercises **every** extension point above,
validating the API end-to-end before breadth.

## Implementation Phases

Each phase lands independently and is verifiable in isolation.

- **Phase 0 — data-driven core groundwork. Done (2026-07-11, via the
  `code-quality-2026-07-10` branch).** Derived capability registries,
  inspector section-builder decomposition (using the signature Phase C's
  provider registry will adopt), the frame-meta shape-style map,
  content-hash SVG def ids, and the shared evaluation budget all landed;
  `apply-kv` additionally became a key→handler table
  (`createKvHandlerMap`), so the "inverted" style-key decision below has a
  registry to attach to if it is ever revisited. Existing suites pass.
- **Phase A — addon-api + engine hooks. Done (2026-07-16).** Landed as
  `packages/addon-api` plus `packages/core/src/addons/` (runtime,
  statement mapping, HostParseContext/HostEvalContext, coordinate-system
  registry with dependency instrumentation, element budget). The toy
  test add-on lives in `test/helpers/smiley-addon.ts` with contract
  tests in `test/addons.spec.ts`. Create `@tikz-editor/addon-api`
  (types, manifest, contexts) and the core `AddonRuntime`: statement routing
  in `mapStatementNode`, evaluation hook in `evaluateStatement`,
  `HostParseContext`/`HostEvalContext` (style, text layout, pgfmath, foreach,
  nested evaluation, named coords, coordinate-system registry, bounds, clip),
  dependency instrumentation, diagnostics/feature namespacing. Static
  registration only. Validation: toy test add-on renders, selects,
  incremental-drags correctly; claimed statements stop warning.
- **Phase B — grammar seam + language UX. Done (2026-07-16).**
  `GenericEnvironment` landed in the grammar; the `MacroStatement`
  open question resolved AGAINST a grammar production (it would
  legalize missing semicolons everywhere) in favor of the sanctioned
  hand-scanner fallback: manifests declare semicolon-less macros via
  `triggers.macroCommands`, recovered by a statement-level prescan
  (`core/src/addons/macro-scan.ts`) that masks regions before the
  Lezer parse and synthesizes AddonCommand statements.
  `GenericEnvironment` (+
  `MacroStatement` or the scanner fallback) in the host grammar; completion
  source composition; scrub-key contribution; generic
  highlighting/folding for claimed environments. Validation: axis-shaped
  fixture documents parse into `AddonEnvironment` with host-parsed interiors.
- **Phase C — editing surface. Done (2026-07-16).** One deliberate
  deviation: `planHandleDrag(handle, newWorld)` takes no context (pure
  translation from handle data), and add-on inspector sections use a
  compact typed property spec (`AddonInspectorProperty` with buildEdit
  callbacks) rendered by a dedicated block rather than threading writes
  through `SetPropertyWriteTarget`. `addonEdit` action + `addon` handle variant,
  drag-plan hook, inspector provider registry, namespaced property ids.
  Validation: toy add-on's handle drag rewrites source through the normal
  incremental path; inspector sections render and write.
- **Phase D — loading + settings. Done (2026-07-16).** Loader in
  `packages/app/src/addons/loader.ts` (static registrations via
  `<App addons={...}>`, dynamic `import()` with apiVersion check), the
  add-on manager tab in the settings modal, runtime threading through
  compute (full + incremental sessions), edit dispatch, and standalone
  export preamble contribution. `AppSettings.addons`, loader (static +
  dynamic import with apiVersion check), add-on manager UI, same-origin
  hosting layout for web, desktop path via platform adapter, export preamble
  contribution. Validation: enable/disable round-trips; a dev add-on loads
  from a URL in both shells.
- **Phase E — pgfplots v1** in its own repository against the published
  addon-api, driving fixes back into the API. Oracle comparison via
  `compare:renderers`.

Phases A–C touch only core/app internals and carry no distribution risk;
D is where the license boundary becomes real; E is the payoff and the API's
true test.

## Open Questions

- **pgfplots add-on license:** port from GPL sources (add-on is GPLv3+) vs.
  clean-room from the manual (permissive possible) vs. asking upstream about
  dual-licensing. See Licensing; must be decided before porting begins.
- **`MacroStatement` grammar feasibility:** whether semicolon-less claimed
  macros can live in the LR grammar without ambiguity, or the hand-scanner
  fallback becomes the permanent mechanism. Prototype early in Phase B.
- **Sub-grammar highlighting:** ship in v1 for pgfplots or accept generic
  highlighting? (Interiors are TikZ-shaped, so generic may be fine
  indefinitely.)
- **Where add-on bundles are hosted** for the curated list (same origin under
  `/editor/addons/` is the working assumption; needs a publishing script).
- **Compute-worker timing:** if the worker migration lands before Phase D,
  the loader must gain the worker-side import path at the same time.
- **Objects-panel/labeling polish:** how much per-add-on structure (e.g. one
  tree node per `\addplot`) to expose in v1 vs. a single node per
  environment.
