# Codebase Review — 2026-07-03

Full-codebase review of tikz-editor (~275k lines of TypeScript, 728 tracked files), conducted by six parallel review passes: core parser/semantics, core rendering/text, edit-action layer, app UI (`packages/app`), app shells + tooling, and a cross-cutting quality scan. Findings below were verified by reading (and in two cases executing against) the actual code; each carries a confidence level.

**Overall impression:** the codebase is unusually disciplined for its ambition — strict typing throughout, branded coordinate types, patch-validated edit actions, render-equivalence certification of risky rewrites, deterministic e2e bridges instead of sleeps, and a genuinely sophisticated incremental-evaluation architecture. The problems are concentrated in three systemic patterns rather than sloppy code:

1. **The per-keystroke path pays for machinery it doesn't use.** Registry deep-clones, clip-chain clones, checkpoint snapshots, availability recomputation, and command-runtime rebuilds all run on every edit, but their benefits accrue to rarer operations (drags, menu opens). Hot-path cost grows with document *richness*, not edit size.
2. **Module boundaries haven't kept up with feature velocity.** Six files over 2,000 lines act as hubs (`CanvasPanel.tsx`, `semantic/evaluate.ts`, `semantic/path/graph.ts`, `edit/inspector.ts`, `App.tsx`, `desktop-platform.ts`), and core helpers are copy-pasted up to 15×.
3. **Enforcement gaps.** CI runs neither lint nor typecheck; `apps/desktop/src` is typechecked by nothing at all; no guard that the committed generated grammar matches `tikz.grammar`.

**What's in notably good shape** (worth preserving deliberately): zero TODO/FIXME/HACK comments in source; zero `as any` and zero `@ts-ignore` in production code (the 6 `@ts-expect-error` are all in tests, justified); no `console.log` in production paths; only two empty catches, both benign and commented; strictly clean dependency layering (lezer-tikz ← {lang-tikz, core} ← app ← apps; core never imports app; within core, `semantic` never imports `edit`/`svg`/`render` — the single backwards edge is a type-only import of `SourcePatch` in `parser/incremental.ts:7`, trivially movable); every `addEventListener` in the app has a matching cleanup; e2e suites use deterministic injected bridges with only 7 `waitForTimeout`s in ~8k lines; shell entry points are 17 lines each with all logic shared in `packages/app`.

**Implementation status notes:** added 2026-07-04 after the Priority 1 correctness pass and the first Priority 2 hot-path performance pass. "Done" means code was changed and verified locally; "Partial" means a contained improvement landed but the full recommendation still has follow-up work.

---

## Priority 1 — Correctness bugs

### 1.1 Property writes destroy comments and formatting in option lists ⚠️ verified empirically
`packages/core/src/edit/option-mutations.ts:104-149`, root cause `packages/core/src/options/parse.ts:41-68`.
Every `setProperty` rewrites the whole `optionsSpan` by re-joining `entry.raw.trim()` with `", "`. `maskLineComments` blanks comments before tokens are captured, so `\draw[red, % main color\n  thick]` + set `line width=2pt` → `\draw[red, thick, line width=2pt]` — comment silently deleted, multi-line list flattened. For a WYSIWYG-over-source editor, user formatting should be sacred. The comment-toggle path (`set-property.ts:129-481`) already has a careful comment-preserving serializer; the ordinary write path doesn't use it.
**Fix:** make option mutations surgical (edit only the changed entry's span; whole-list rewrite only when structure requires it), or reuse the `parseCommentToggleItems` fragment model for all rewrites. *(high confidence)* → Architecture note A.
**Status (2026-07-04): Done.** `option-mutations.ts` now uses a source-preserving rewrite path for spanned targets, with focused regression coverage for comments, multiline options, and bare-option clearing.

### 1.2 `addElement` broken in multi-figure documents ⚠️ verified empirically
`packages/core/src/edit/actions.ts:1122-1144`, `packages/core/src/edit/element-templates.ts:140-168`.
`insertElementIntoSource` inserts before the **last** `\end{tikzpicture}`; `applyAddElement` parses snapshots without forwarding `parseOptions` (so `activeFigureId` defaults to figure 0). With two figures, the diff finds no new statement and a non-null assertion throws a raw `TypeError`. Even fixed, the element lands in the last figure regardless of the active one.
**Fix:** thread `parseOptions` into both snapshots, make insertion figure-aware, replace the `!` with an error result. *(high confidence)*
**Status (2026-07-04): Done.** `addElement` now threads `parseOptions`, inserts into the active figure span, and returns an explicit error if the inserted element cannot be identified; multi-figure regression coverage was added.

### 1.3 SVG part-reuse can attach wrong/missing gradients & patterns after an edit
`packages/core/src/svg/emit.ts:126-148, 1664-1685`; reuse driven from `packages/app/src/compute.ts:377-391`.
Gradient/pattern def ids are sequence-numbered per emit (`gradientIdBySignature.size + 1`) and baked into part markup as `url(#tikz-shading-…-N)`. The keystroke reuse path replays *old* markup for unaffected elements while defs renumber from scratch: `\shade A; \shade B;` then edit A to `\fill` → B is "unaffected", reuses `url(#…-2)`, but the new emit registers B's gradient as `…-1`. B's fill silently breaks, or B picks up another element's gradient. Clip paths get a blanket reuse guard (line 1632); gradients/patterns get none.
**Fix:** derive def ids from a content hash of the signature (stable across emits), or bail out of reuse when def-id assignment changes for any reused element. *(high confidence)* → Architecture note F.
**Status (2026-07-04): Done.** Gradient and pattern ids are content-derived rather than sequence-derived, with a reuse regression test that verifies old part markup still resolves to current defs after an edit.

### 1.4 Uncapped `\graph` expansion can freeze the editor mid-keystroke
`packages/core/src/semantic/path/graph.ts:3707-3754, 3122-3140`.
`\foreach` is capped at 10,000 expansions (`semantic/evaluate.ts:212`) but graphs have no budget: typing `\graph { subgraph K_n [n=2000] };` plans ~2M edges each with full style resolution; `V={1,...,100000000}` builds a 100M-element array in `expandRange`. Hangs or OOMs while the user is still typing the number.
**Fix:** add a node/edge budget in `buildGraphPlan` mirroring the foreach cap, with a diagnostic. *(high confidence)*
**Status (2026-07-04): Done.** Graph expansion now caps planned nodes and edges and emits budget diagnostics; regression coverage exercises both large clique and huge range inputs.

### 1.5 `computeBounds` spreads unbounded arrays into `Math.min/max`
`packages/core/src/semantic/evaluate.ts:2441-2444`.
`Math.min(...points.map(...))` throws `RangeError` past the engine argument limit (~65k+ in V8). `points` accumulates every endpoint plus curve/arc extrema across all elements, so large foreach/plot-heavy figures can kill the whole render.
**Fix:** single loop tracking min/max (also removes four intermediate arrays per call). *(high confidence on pattern)*
**Status (2026-07-04): Done.** `computeBounds` now tracks extrema in one loop instead of spreading mapped arrays.

### 1.6 `setPointerCapture` in canvas text-selection can never succeed
`packages/app/src/ui/canvas-panel/CanvasPanel.tsx:2354-2399` (esp. 2394-2398).
`event.currentTarget.setPointerCapture(...)` is called inside a `.then()`; React nulls `currentTarget` after dispatch, so this is always a TypeError swallowed by the surrounding try/catch. Text-selection drags never capture the pointer → hover churn on neighboring elements during selection drags.
**Fix:** save `event.currentTarget` to a local synchronously before the async work. *(high confidence)*
**Status (2026-07-04): Done.** Canvas text selection captures the target and pointer id synchronously before async layout work.

### 1.7 Align/distribute drops `parseOptions` for `rotate around` pivots
`packages/core/src/edit/actions/move-arrange-actions.ts:1054-1058, 1088-1098`.
`applyElementDeltaMapStrict` passes a hard-coded `{}` where every sibling call threads `parseOptions`. In multi-figure docs the pivot adjustment parses figure 0: pivot silently not moved, or an identically-numbered statement in the wrong figure gets resolved.
**Fix:** plumb `parseOptions` through. *(medium-high confidence)*
**Status (2026-07-04): Done.** Align/distribute strict delta application now preserves `parseOptions`, including active-figure targeting for `rotate around` pivots; a multi-figure regression was added.

### 1.8 Race between global Knuth–Plass options and async MathJax renders
`packages/core/src/text/mathjax-engine.ts:1483-1505, 860-904, 1181-1205`.
Pending async renders each do "set jax-global options → await render"; render A can execute after render B overwrote `layoutMode`/`alignment`/`wrappedTextGaps`, producing a wrongly-laid-out result cached *permanently* under A's key.
**Fix:** serialize async renders through a queue, or pass options per call instead of via shared jax state. *(medium confidence)*
**Status (2026-07-04): Done.** Async MathJax cache population now serializes through a queue and re-checks cache state before inserting.

### 1.9 Wrong `PT_PER_CM` constant skews all coordinates reported to the AI assistant
`packages/app/src/ui/assistant-tool-handlers.ts:5-6`.
The constant is `28.3465` (big points per cm, 72/2.54) while its own comment claims TeX points — the rest of the pipeline uses `28.4527559055` (72.27/2.54), defined independently in five other places (`core/src/coords/source.ts:4`, `edit/format.ts:1`, `edit/snapping/grid-snaps.ts:9`, `semantic/style/constants.ts:399`, `semantic/path/node-positioning.ts:73`). All coordinates and radii the assistant sees are ~0.37% off.
**Fix:** import `PT_PER_CM` from `coords/source` everywhere; delete the five local copies. *(high confidence)*
**Status (2026-07-04): Done for the user-visible skew.** The assistant now imports the shared `PT_PER_CM` value from `tikz-editor/edit/format`; broader consolidation of every remaining local constant copy was not part of this pass.

### 1.10 Smaller correctness items
- **Standalone export misses definitions in nested scopes** — `packages/core/src/export/standalone-latex.ts:86-97`: `collectStatementById` descends only one scope level, so a `\tikzset`/`\definecolor` two scopes deep is silently dropped and the exported `.tex` doesn't compile. Fix: recurse. *(medium-high)*
- **Status (2026-07-04): Done.** `collectStatementById` now recurses through nested scope bodies.
- **Clearing the last option of a bare-format target is a silent no-op** — `packages/core/src/edit/option-mutations.ts:38-56`: removing the only entry of e.g. `mystyle/.style={draw}` returns null → "would not change the source". Fix: emit empty string for bare format. *(medium)*
- **Status (2026-07-04): Done.** Bare-format last-option removal is covered by the source-preserving option mutation rewrite and tests.
- **Tree-child span resolution by `indexOf` of raw text** — `packages/core/src/edit/property-target.ts:1211-1348`: two identical `child {node {x}}` siblings resolve to the first occurrence; an edit aimed at the second can rewrite the first (system ships a "verify the updated source" warning rather than a correct edit). Fix: keep absolute offsets from the parser instead of re-finding text. *(high that it's fragile, medium that it's user-reachable)*
- **Status (2026-07-04): Done.** Tree-child operation spans now prefer parser/absolute offsets before falling back to raw text search; duplicate-child regression coverage was added.
- **Desktop About dialog reports 0.1.0** — `packages/app/src/ui/AboutModal.tsx:4` reads `TIKZ_EDITOR_VERSION`, defined only in `apps/web/vite.config.ts:12`, not desktop/landing. Fix: shared vite config helper. *(medium)*
- **Status (2026-07-04): Done via desktop Vite config.** Desktop now defines `import.meta.env.TIKZ_EDITOR_VERSION`; extracting a shared Vite helper remains optional cleanup.
- **Value-span attribution via `raw.indexOf(valueRaw)`** — duplicated in `semantic/evaluate.ts:3589-3595` and `semantic/style/resolve.ts:192-198`; mis-positions provenance spans when value text appears in the key (`x=x`). `OptionEntry` already carries `valueSpan` — use it, delete both helpers. *(high; impact minor)*
- **Status (2026-07-04): Done.** Both helpers now use `entry.valueSpan?.from`.

---

## Priority 2 — Hot-path performance (per-keystroke costs)

These compound: the same keystroke pays all of them.

### 2.1 Command runtime rebuilt on every render; availability recomputed ~7× per rebuild
`packages/app/src/ui/editor-command-runtime.ts:1189-1302`; call sites `App.tsx:591-659`, `CanvasPanel.tsx:1034-1080`; `editor-commands.ts:516-605, 1393-1420`.
`useEditorCommandRuntime`'s `useMemo` keys on ~25 callbacks that both call sites pass as fresh inline arrows — the memo never holds, so `createEditorCommandRuntime` re-executes on every render of App **and** CanvasPanel (every keystroke, hover, drag frame). Each rebuild runs `actionAvailability` plus six `can*Selection` checks, each independently calling `deriveFacts` → `collectSourceWorldBounds` over the entire scene; matrix/foreach checks additionally run speculative `applyEditAction` calls. The drag-freezing logic inside the hook is dead weight because the memo never holds.
**Fix:** (a) `useCallback` (or refs) for the option callbacks at both call sites; (b) compute availability once per context (`WeakMap<context, availability>`); (c) consider lazy per-menu-open `enabled` computation. *(high confidence; agent estimates fixing 2.1–2.3 eliminates most per-keystroke waste in the app layer)* → Architecture note C.
**Status (2026-07-04): Mostly done.** App and CanvasPanel command callbacks are now stable/ref-backed, and command availability, matrix/tree target resolution, matrix cell classification, and speculative matrix checks are cached per runtime context. Lazy per-menu-open `enabled` computation remains a possible follow-up.

### 2.2 App root over-subscribes to the store
`packages/app/src/ui/App.tsx:226-262, 974-992, 1233-1349, 1552-1571`; `DockLayout.tsx:412-449`.
App subscribes to `hoveredElementId` (used only to schedule compute pre-warm) and the whole `documents` record — every hover transition and every assistant streaming delta re-renders the entire tree, and (via 2.1) rebuilds the command runtime. On desktop, the `syncNativeMenu` effect deps include `commandRuntime`, so a native-menu IPC sync fires on essentially every render; the global keydown listener is re-registered each render. Assistant handlers are plain functions, defeating `memo(AssistantPanel)`.
**Fix:** move pre-warm into a transient `useEditorStore.subscribe` hook; select narrow fields; `useCallback` handlers; gate menu sync on a command-state signature. *(high confidence)*
**Status (2026-07-04): Mostly done.** Hover prewarm now runs from a store subscription, platform/key handlers read current command runtime through refs, native menu sync is gated by a command-state signature, and assistant handlers are memoized. `App` still selects `documents` for tab/close/file-watch workflows, so deeper document-slice splitting remains follow-up work.

### 2.3 AssistantPanel subscribes to the whole active `DocumentSession`
`packages/app/src/ui/AssistantPanel.tsx:49`; `store/reducer.ts:280-321`.
The active-document object changes identity on every keystroke/snapshot/selection change, so the 1,187-line panel re-renders continuously during typing and drags.
**Fix:** select only the assistant slice with `useShallow` (fields are already referentially stable). *(high confidence)*
**Status (2026-07-04): Done.** `AssistantPanel` now selects only assistant items, pending approvals, turn status, error, and document presence.

### 2.4 Semantic evaluator deep-clones registries per path statement
`packages/core/src/semantic/evaluate.ts:938-939, 997-998, 1163-1164, 1216-1217`; `semantic/style/custom-styles.ts:157-163`; `semantic/pics/registry.ts:41-47`.
Every path statement — even `\draw (0,0)--(1,1);` — deep-clones the custom-style registry, pic registry, color aliases, and macro bindings before pushing a frame. O(statements × definitions) clone work per keystroke; 300 statements × 50 styles ≈ 15k layer clones per edit.
**Fix:** copy-on-write registries (writes inside path statements are rare) or a layered lookup chain like the existing `PersistentMap`. *(high confidence)* → Architecture note B.
**Status (2026-07-04): Partial.** Custom-style and pic registries now use shallow map clones, relying on replacement-on-write semantics for inherited entries. Macro bindings and color aliases still use eager `Map` clones because their current helper APIs mutate frames directly; full layered lookup remains future work.

### 2.5 Clip chain deep-cloned after every path statement
`packages/core/src/semantic/evaluate.ts:1091-1119`. Rebuilt by cloning every command of every clip path even when the statement contains no `clip`. One large `\clip plot …` followed by K draws → K × clipSize allocations per keystroke.
**Fix:** identity-compare / dirty-flag and skip the clone when unchanged. *(high confidence)*
**Status (2026-07-04): Done.** Path evaluation now identity-compares clip-chain arrays and only deep-clones when the evaluated frame changed the chain.

### 2.6 SVG reuse path double-computes arrow geometry, path encoding, bounds
`packages/core/src/svg/emit.ts:278-329 vs 339-437`. With reuse active, `registerDefsForElement` runs `renderPathWithArrows` + `encodePathData` + `computeSvgPathBounds` for **all** elements — then the main loop recomputes all three for edited ones. Bounds are computed even for elements with no shading/pattern/shadow, where they're never used.
**Fix:** early-out when no shading/pattern/shadow; thread computed values into the main emission. *(high confidence)*
**Status (2026-07-04): Partial.** The reuse pre-pass now registers clip defs unconditionally, resolves pattern-only defs without geometry, and skips bounds work for elements with no shading or shadows. Threading precomputed geometry into the main emission remains follow-up work.

### 2.7 Knuth–Plass always runs the hyphenation pass even when pass 1 succeeds
`packages/core/src/text/knuth-plass/KnuthPlassVisitor.ts:370-400`. `pass2Model`/`pass2Dp` (hyphenation + second full DP) are computed unconditionally *before* checking whether pass 1 sufficed — inverting TeX's pretolerance design.
**Fix:** compute pass 2 lazily on pass-1 failure; audit the main wrap path for the same pattern. *(high confidence)*
**Status (2026-07-04): Done.** Pass 2 model/DP construction is now lazy and runs only when pass 1 fails.

### 2.8 MathJax engine caches are unbounded on a process-lifetime singleton
`packages/core/src/text/mathjax-engine.ts:196-199`. Every keystroke inside a node label inserts a full rendered-SVG cache entry (`"Hello"`, `"Hell"`, `"Hel"`, …); no eviction anywhere.
**Fix:** LRU cap or clear-on-idle. *(high confidence)*
**Status (2026-07-04): Done.** MathJax render, exact-width, and validation caches now have capped insertion behavior.

### 2.9 Decoration sampling recomputes arc-length parameterization from scratch
`packages/core/src/geometry/path-sampler.ts:444-462, 597-627, 215-244`; consumers `semantic/decorations/engine.ts:617-1156`.
`parameterAtCubicDistance` runs 28 bisection iterations × 30-step Simpson per sample, recomputing total length each call; `sampleFrameFromStartExtrapolated` rescans segments from index 0 per sample. A coil/zigzag on a long curved path → millions of trig calls per keystroke.
**Fix:** per-segment cached cumulative-length tables (build once in `commandsToSegments`, binary-search) + walking cursors. *(high confidence)*
**Status (2026-07-04): Mostly done.** Path sampling now caches total/cumulative segment lengths per segment array and caches curved-segment length-to-parameter tables with binary search/refinement. Walking cursors in decoration consumers were not added.

### 2.10 Other hot-path items
- **Incremental machinery activates only for drags; typing pays full re-eval + checkpoint snapshots** (`semantic/incremental.ts:713-732, 283-298`; `semantic/context.ts:455-480`): per-keystroke path = full parse + full evaluation + N/8 `structuredClone` snapshots of the whole frame stack whose only beneficiary is a later drag. Consider lazy checkpoint capture on first drag. *(high on mechanism, medium on net cost)*
- **Status (2026-07-04): Not done.** This remains a larger incremental-evaluation refactor.
- **Property-write cleanup renders the document 2× per candidate** (`edit/property-write-planner.ts:499-523`); node resize parses+evaluates ~5× per invocation (`actions/resize-element.ts:190-299`). Memoize `render(source)` within a plan; skip certification for pure option-appends. *(high on cost structure)*
- **Status (2026-07-04): Partial.** Property-write certification now memoizes `render(source)` within each cleanup/plan call. Node-resize parse/evaluate reuse and pure option-append certification skipping remain follow-ups.
- **Quadratic graph placement + array-based color sets** (`semantic/path/graph.ts:1976-2002, 3756-3764`): O(n²) chain offset re-simulation with scope clones per node; `Array.includes` color classes. *(medium-high; real graphs usually small)*
- **Status (2026-07-04): Partial.** Color-class uniqueness/recolor filtering now uses `Set`-based lookups in the touched helpers. The chain-offset placement simulation remains unresolved.
- **Constant option strings re-parsed per statement** (`semantic/path/evaluate.ts:382-384, 1023`; `graph.ts:2722, 3174`): `"draw"`, `"every edge"`, `"[auto]"` etc. fully tokenized in innermost loops. Small memo keyed on raw string. *(high mechanism, medium impact)*
- **Status (2026-07-04): Partial.** The path evaluator now reuses module-level parsed constants for `"draw"`, `"every edge"`, `"edge from parent"`, and `"help lines"`. Graph-side constant parses are still pending.
- **Foreach: redundant conditional-expansion per iteration** (`packages/core/src/foreach/expand.ts:257-266`): eager fallback work only needed on parse errors; double expansion when no macros defined. *(high)*
- **Status (2026-07-04): Done.** Foreach expansion now skips macro expansion when no macro bindings exist and only parses the fallback body after a macro-expanded parse error.
- **Node-position picking preflights every anchor synchronously in a render memo** (`CanvasPanel.tsx:1459-1522`): O(nodes) full edit-preflights on the render thread when picking starts. Compute lazily per hovered target. *(medium)*
- **Status (2026-07-04): Not done.** Still a targeted UI follow-up.
- **Drag controller: one 1,160-line effect, ~40 deps, re-registers 5 window listeners per keystroke/drag-frame** (`useCanvasDragController.ts:140-1301`): currently correct but a stale-closure landmine; register once + read hot values through refs. *(high mechanics, medium impact)*
- **Status (2026-07-04): Not done.** Still a larger hook refactor.
- **Completion re-scans raw source with ad-hoc scanners** (`packages/core/src/completion/index.ts:60-144`) duplicating knowledge the parser already has as AST statements. *(drift + recomputation concern)*
- **Status (2026-07-04): Not done.** Still a parser/completion integration follow-up.

**Verification (2026-07-04):** Priority 2 pass verified with focused Vitest coverage for SVG/model/property-write/foreach/decorations/graphs/pics/text hot paths, plus `npm run typecheck`, `npm run lint:prod`, and `git diff --check`.

---

## Priority 3 — Organization & duplication

### 3.1 Copy-paste helper duplication in the edit layer
- `type EditActionResultLike`: **15 copies** (every file in `edit/actions/` + planner) — exists to dodge a circular import with `actions.ts`.
- `findPathStatementById`: **8 copies** with subtly different signatures (`move-arrange-actions.ts:1366`, `resize-element.ts:1980`, `rotate-element.ts:565`, `tree-child-actions.ts:273`, `property-target.ts:949`, `fit.ts:43`, `inspector/grid-state.ts:62`, `path-editing.ts:366`).
- `normalizeElementIds` ×5, `uniqueStrings` ×4; `set-property.ts` inlines a copy of its own helper (77-99 vs 630-653).
**Fix:** `edit/result-types.ts` + `edit/statement-find.ts`; removes ~300 lines and the drift risk. *(high confidence)*
**Status (2026-07-04): Done.** Added shared `edit/result-types.ts` and `edit/statement-find.ts`; action files, fit/path-editing/inspector/property-write helpers now import the shared result and statement/ID utilities instead of carrying local copies.

### 3.2 The "every X node styles" frame-meta explosion (~600 deletable lines)
`semantic/context.ts:143-181`; `semantic/evaluate.ts:272-337, 988-1053, 1207-1272, 2064-2105, 2849-2947, 2980-3429`.
22 hardcoded per-shape fields (`everyKiteNodeStyles`, …) each threaded through the frame type, three ~65-line push blocks, three lookup tables, and a bucket-clone block. The pic path (line 1510) already proves the fix: replace with one `everyShapeNodeStyles: Map<string, ProvenanceOptionList[]>` + spread. New shapes become one-line additions. *(high confidence)* → Architecture note D.
**Status (2026-07-04): Partial.** Repeated clone/assignment blocks are now centralized through `FRAME_STYLE_BUCKET_KEYS`, and node shape style lookup is shared by node evaluation and effective-option merging. The recommended end-state (`everyShapeNodeStyles: Map<...>`) is still a follow-up; the semantic frame still exposes the legacy per-shape fields.

### 3.3 Six-way duplication in `graph.ts` option handling
`semantic/path/graph.ts:1190-1523` vs `1525-1765` (same ~30 keys hand-dispatched twice, ×3 entry kinds each); `parseChain` (503-618) vs `parseChainFromParsedSpec` (620-731) ~110-line near-duplicates. Adding one graph option = up to 6 coordinated edits. Extract shared `applyGraphOptionEntry` table + common chain-walker. *(high confidence)*
**Status (2026-07-04): Done.** Node/group graph option handling now shares a common scope-control dispatcher for kv/flag/bare entries, leaving only node-specific edge accumulation and group-specific quote/text behavior at the call sites. Raw and parsed graph chains now feed one shared chain accumulator, so connector edge/color/layout updates live in one path.

### 3.4 `emit.ts` shape emission duplicated six ways (~400 lines)
`packages/core/src/svg/emit.ts:717-889` (three structurally identical shadow emitters), `371-414, 463-506, 530-582` (double-stroke/plain branches per shape). Extract `emitStyledShape(tag, style, …)`. Also `fmt()` duplicated (`emit.ts:1521`, `model.ts:171`); module-global `currentPatternGlobalYPhase` (line 73) threads state invisibly through pattern renderers — pass explicitly. *(high confidence)*
**Status (2026-07-04): Done.** Path/circle/ellipse emission now shares styled-shape rendering helpers, double-stroke/plain branch handling, transform emission, and shadow shape emission. SVG number formatting is shared, and pattern rendering now threads its phase through an explicit context instead of module-global state.

### 3.5 God files with concrete decomposition seams
- **`CanvasPanel.tsx` (3,806)**: extract `useCanvasTextEditSession` + `<CanvasTextEditPopup>` (lines 331-660, 2268-2753, 3536-3617), `useNodePositionTargetPicking` (1451-1663, 2755-2836), move text-measure helpers to a module. Also contains **dead snap-debug overlay** (~150 lines + an always-on window pointermove listener) behind hardcoded `showDevPanel={false}` at line 3776 — delete it (DevPanel supersedes it).
- **`edit/inspector.ts` (3,345)**: `getInspectorDescriptor` alone is ~1,140 lines; the `inspector/` subdirectory already shows the intended decomposition — move per-section builders (fill/shadow/arrow/node/adornment) to `SectionBuilder(ctx) => InspectorSection | null` modules.
- **`semantic/path/evaluate.ts`**: `evaluatePathStatement` is ~2,700 lines with ~25 closure-captured mutables and per-call handler closures — reify into a `PathBuilderState` class with per-item-kind methods.
- **`semantic/nodes/evaluate.ts`**: `evaluateNodeItem` ~1,400 lines. **`semantic/style/apply-kv.ts:38-883`**: one 845-line if/else over 85 keys — table-driven map.
- **`apps/desktop/src/platform/desktop-platform.ts` (1,579)**: four concerns with clean seams — split into `bridge.ts`, `native-menu.ts`, `adapter.ts`.
- **`text/knuth-plass/editor/hitmap.ts`**: four entry points × ~50 lines of identical boilerplate (1465-1864) — extract `resolveHitMap()` + error factory (~200 lines).
- **`text/mathjax-engine.ts`**: duplicated space-factor tokenizer (`collectWrappedTextGaps` 1577-1642 vs `encodeWrappedTextSpaces` 1644-1712 — positionally consumed, drift silently corrupts layout) and three sync/async twin pairs — unify.
- **`foreach/expand.ts`**: clause-variant cartesian loop ×3, substitute→expand→parse pipeline ×5 — extract `buildClauseVariants` + `expandSubstitutedFragment`.

Decomposition contracts and recommended order for the four big splits are in Architecture note E.

### 3.6 Capability registries are 320 lines of hand-maintained derivable data
`packages/core/src/capabilities/registries.ts`. The spec test enforces exactly: registry ⇔ matrix layer ∉ {none, not-applicable}. Replace each registry with a `FEATURE_IDS.filter(...)` over the matrix — invariant true by construction; "three files updated together" becomes two. Nothing depends on the literal tuple types. *(high confidence)*

### 3.7 Other duplication
- **parseOptions/analysis/fingerprint recipe re-implemented 4×** (`CanvasPanel.tsx:1018-1032`, `editor-command-runtime.ts:213-223+1171-1187`, `useInspectorModel.ts:248-267`, `store/reducer.ts:758-779`) with slightly different fields — one `buildEditParseOptions()` helper + hook. *(high; real cache-miss risk)*
- **`resolvePropertyTarget` / `resolvePropertyTargetFromParseResult`** duplicate the same 8-step cascade (`property-target.ts:97-188`) — new target kinds must be added twice, in order. *(high)*
- **Default-parameter resolver idiom bypasses the parse cache** (`inspector.ts:1547-1558` called without resolver at 1265) — a required parameter or context object would make cache-sharing enforceable. *(high mechanism)*
- **`HistoryEntry.backward` holds forward patches, never used for undo** (`store/reducer.ts:902-912`) — drop or rename before someone applies it as an inverse. *(high)*
- Render-phase side effects in CanvasPanel/App (`CanvasPanel.tsx:1183-1188, 1706-1711`; `App.tsx:361, 923-927`): ref writes + `getBoundingClientRect` during render — move to handlers/layout effects. *(high facts, low-medium breakage today)*

### 3.8 Cross-package utility duplication (from the cross-cutting scan)
- `clamp` defined **15×** (one exported in `core/src/semantic/nodes/utils.ts:9`, 14 private re-implementations across core and app — several inside `canvas-panel/` even though its own `geometry.ts` exports one).
- `hexToRgb`/`rgbToHex` **4×**, twice inside core itself (`semantic/style/colors.ts:447-458` vs `svg/emit.ts:1535-1546`) — and they've **diverged**: `colors.ts` rounds components, `emit.ts` doesn't (fractional component → invalid hex).
- `fmt(value)` byte-identical **5×**; `distanceSquared` ×6; `clamp01` ×4.
- App re-implements core's grid-step picker: `app/ui/canvas-panel/geometry.ts:213` `pickStepPt` is logic-identical to `core/edit/snapping/grid-snaps.ts:11` `pickGridStepPt` (already exported from core's barrel). If the step table changes in one place, grid rendering and snapping disagree.
- `formatAccelerator` + `IS_MAC_PLATFORM` verbatim-identical in `AppMenuBar.tsx:9-27` and `CanvasContextMenu.tsx:13-36`; platform detection re-inlined differently in `Toolbar.tsx:54` and `editor-command-runtime.ts:257` (`navigator.platform` is deprecated, so this *will* need touching).
**Fix:** `core/src/utils/math.ts` + `core/src/utils/color-convert.ts`; delete `pickStepPt`; one `ui/platform-detect.ts`. *(high confidence)*

### 3.9 Design-consistency items
- **Three coexisting result-shape conventions:** `kind: "success"|"partial"|"unsupported"|"error"` (edit actions, ~204 uses), `ok: boolean` (pgfmath evaluator, hitmap, thumbnail workers, ~39 uses), `success: boolean` (`app/platform/types.ts:233`). Internally consistent per area; cost is at boundaries. Bless one shape (the `kind` discriminant is most expressive) for new code rather than migrating. *(high)*
- **Export failures are console-only:** `app/ui/export-commands.ts` has 23 `console.warn` terminal failures ("Failed to export PNG/PDF", "Failed to copy SVG…") and no toast/status-error mechanism exists anywhere in `packages/app` to route them to. User clicks Export, nothing happens. Add a minimal status-bar/toast error channel. *(high pattern, medium UX impact)*
- **Non-null assertions clustered in central mutation paths:** only 57 `!` assertions in ~177k lines (excellent), but concentrated in `edit/actions/group-ungroup-actions.ts` (8), `move-arrange-actions.ts` (6), `resize-element.ts` (5), `actions.ts` (5), `semantic/path/graph.ts` (5) — a broken invariant surfaces as an opaque TypeError instead of the `{kind:"error"}` result those files already define. A `mustGet(map, key, context)` helper would fix most. *(high)*
- Minor: the knuth-plass subtree uses camelCase/PascalCase filenames against core's kebab-case convention.

---

## Priority 4 — Tooling, CI, and workspace hygiene

### 4.1 CI runs neither lint nor typecheck
`.github/workflows/ci.yml` runs only `npm test` + e2e. `lint:ci` and `typecheck` exist in root `package.json` but nothing calls them — type/lint regressions land silently. Add `npm run lint:ci && npm run typecheck` as a CI step. *(high confidence)*
**Status (2026-07-04): Done.** The CI test job now runs `npm run lint:ci` and `npm run typecheck` before the unit/e2e suites.

### 4.2 `apps/desktop/src` is typechecked by nothing
Root tsconfig `include` lists web + landing but not desktop; desktop `build` is plain `vite build`. The 1,579-line `desktop-platform.ts` is never seen by `tsc`. The desktop mock-bridge suite (`test:e2e:mock`) isn't in CI either. Add `apps/desktop/src` to the root typecheck include; run `test:e2e:mock` in CI. *(high confidence)*
**Status (2026-07-04): Done.** Root typecheck now includes `apps/desktop/src`, and CI runs the desktop workspace's `test:e2e:mock` suite.

### 4.3 No drift guard for the committed generated parser
`packages/lezer-tikz/src/grammar/tikz-parser.ts` is committed (currently in sync — verified by regenerating), but `npm test` regenerates before running, so CI passes even if the committed copy is stale while typecheck/eslint check the stale one. Add CI step: `npm run generate:grammar && git diff --exit-code packages/lezer-tikz/src/grammar/`. *(high confidence)*
**Status (2026-07-04): Done.** CI now regenerates the grammar and fails on diffs under `packages/lezer-tikz/src/grammar/`.

### 4.4 CI double-runs; no concurrency control
`ci.yml` triggers on bare `push:` (all branches) + `pull_request:` → every PR commit runs the full suite (incl. Playwright + Rust build) twice. Restrict push to `master`, add a `concurrency` block, cache `tauri-driver`/target dir as `release-desktop.yml` already does. *(high confidence)*
**Status (2026-07-04): Done.** CI push triggers are restricted to `master`, workflow concurrency cancels superseded runs, and the desktop Linux job now caches the Rust target dir plus `tauri-driver`.

### 4.5 tsconfig `paths` map duplicated 4×
Identical 13-entry blocks in root, web, desktop (byte-identical incl. the same indentation glitch), subset in landing. Extract `tsconfig.base.json`; the `@tikz-editor/app/*` path entries may be redundant entirely given `moduleResolution: bundler` + package exports. *(high confidence)*

### 4.6 Tauri bridge abstraction leaks
`desktop-platform.ts:1485-1498` (latex API), `1303-1306` (`setTheme`), `582-585` (About panel) call Tauri directly, bypassing the injectable `DesktopBridge` — unstubable by the e2e/vitest mock bridges, unlike every other capability. Add them to the bridge. Relatedly, the e2e mock bridge has drifted from the real `DesktopBridge` type (defines nonexistent keys, omits real ones; untyped JS inside `browser.execute()`) — define it in a typed `.ts` module. *(high / medium)*

### 4.7 Core's deep-import alias contradicts its package name
Core's npm name is `@tikz-editor/core` and `packages/app/package.json:52` depends on it — but **zero** source files import that specifier. All 92 importing files in `packages/app/src` use `tikz-editor/options/parse`-style deep paths, resolved only by a root tsconfig path alias plus hand-copied aliases in three vite configs and `vitest.config.ts`. Core has no `exports` map, so the deep imports can't resolve against the built/published package; the workspace dependency declaration is effectively fiction, and every new consumer must replicate the alias.
**Fix:** rename imports to `@tikz-editor/core/*` with a proper `exports` map, or at minimum add an `exports` map matching the alias. *(high on facts, medium urgency — works fine for current in-repo consumers)*

### 4.8 Dead exports; no dead-code tooling
Grep-verified zero-reference exports (8): `collectSourceIdsInBounds` + `deriveSelectionTranslationDeltaFromAnchor` (`app/ui/canvas-panel/interaction-helpers.ts:30,40`), `caretStrokeWidthInSvg` + `resolveEditableTextTargetForSelectionOffsets` (`canvas-panel/panel-helpers.ts`), `resolveScopeAwareSelectionTarget` (`canvas-panel/scope-overlay.ts`), `isCoordinateItem`/`isNodeItem` (`core/edit/apply.ts`), `BACKGROUND_CONFIG_KEYS` (`core/semantic/backgrounds.ts`). ~30 more symbols are exported but used only in-file. No `knip`/`ts-prune` anywhere — worth adding to CI. *(high for the 8; the unscanned rest of the repo likely has proportionally more)*

### 4.9 Workspace hygiene
- `apps/ipad/` has **zero git-tracked files** — only local debris inside the workspace glob. Commit the shell or delete the husk.
- `apps/web/tmp-repro.mjs` is committed, with a dedicated `--ignore-pattern '**/tmp-*'` in `lint:prod` to step around it — delete both.
- Root `package.json` declares a stray `keynote-clipboard` dependency, redundant with `packages/app`'s.
- Lint config encodes migration state fragilely: ~10 `--ignore-pattern` flags duplicated across two scripts, a ~45-path hardcoded whitelist in `eslint.config.mjs:189-239`, and a mostly-redundant final override (253-277). Move ignores into flat-config `ignores`; prune.
- e2e/dev pipelines build the grammar packages twice per invocation (`test:e2e` runs `build:package-deps`, then Playwright's webServer runs `npm run build` which runs it again). Drop the outer call; consider `reuseExistingServer: !process.env.CI`.
- The three biggest web e2e specs (1,753 / 1,651 / 1,492 lines) serialize within-file (`fullyParallel: false`) — splitting them speeds CI.
- Repo root accumulates stray LaTeX/debug logs (`case.log`, `probe.log`, `texput.log`, `trace-fuzz89.log`, …) — gitignore + clean.

---

## Architecture notes — principled fixes for the complex findings

Most findings above are mechanical once you decide to do them. Six are not: they need a design decision first, and deciding well fixes whole families of findings at once. These notes record the proposed decision for each, so the later fixes are implementation tasks rather than case-by-case judgment calls.

### Note A — Source-rewrite fidelity: one invariant, one serialization path
*Settles 1.1 (comment destruction), the bare-format no-op in 1.10, and the `indexOf` span fragilities (tree-child mis-targeting, value-span attribution).*

Today there are two serialization paths for option lists: a careful comment-preserving fragment model used only by comment toggling (`set-property.ts:129-481`), and a lossy "mask comments, re-join entries with `, `" path used by everything else. Adopt one invariant for **all** source mutations:

> **An edit may only change bytes inside the span of the entry (or statement) it logically targets. Whole-list rewrites are permitted only when entry structure changes, and must go through a lossless fragment model. Spans always come from the parser — never from re-finding text with `indexOf`.**

Implementation shape: (1) promote the comment-toggle fragment representation to the canonical lossless option-list model (entries + interstitial trivia: comments, whitespace, newlines); (2) express every mutation as an entry-level operation — `replaceValue`, `insertEntry`, `removeEntry` — compiled down to minimal span patches against the original bytes; (3) define the empty-list edge cases in the model once (bracketed → delete `[]`; bare → empty string), which fixes the silent no-op; (4) delete the re-join path. The invariant is directly testable: property/fuzz tests that parse → mutate → assert every byte outside the targeted entry's span is unchanged, over documents seeded with comments, multi-line lists, and duplicate sibling text. The tree-child fix follows the same rule at the statement level: the parser keeps absolute offsets for child items (the `parseStatementsFromBodyWithMapping` precedent) so nothing ever re-locates raw text.

### Note B — An explicit cost contract for the evaluator's typing path
*Settles 2.4 (registry clones), 2.5 (clip-chain clones), 2.10 checkpoint overhead, 1.4 (uncapped graphs), and constrains future features.*

The pattern behind these findings is that nothing states what the per-keystroke path may cost. Adopt the contract:

> **Work on the typing path must scale with the size of the edit and the statements it affects — never with document richness (number of styles, clip complexity, macro count). Speculative work whose benefit accrues to a later interaction (drag checkpoints) is deferred to that interaction. All combinatorial expansion runs under a budget.**

Concretely: (1) the four per-frame registries (custom styles, pics, color aliases, macro bindings) become layered/copy-on-write structures — the `PersistentMap` already in the codebase is the in-house precedent, so this extends an existing pattern rather than introducing one; frames hold a parent reference plus an overlay created on first write, which is rare inside a path statement. (2) The clip chain gets a dirty flag set by the `clip` operation; identical → share, no clone. (3) Checkpoint snapshots are captured lazily — on drag start, from the cached parse/eval fragments — instead of every 8 statements during typing. (4) A single `EvaluationBudget` (max expanded statements / points / edges) is threaded through foreach (already capped), graphs (uncapped today), and any future expander; exceeding it emits a diagnostic and truncates deterministically. One budget type, one diagnostic code, applied uniformly — not per-feature ad-hoc caps.

### Note C — An `EditContext` object for the app layer
*Settles 2.1 (runtime rebuilds), 2.2 (App over-subscription), 3.7 (4× parseOptions recipe), and the default-parameter resolver leak.*

The identity bugs share a missing abstraction: no single owned object represents "the current editable state." Introduce `EditContext`, built **once per snapshot** in one place (a store-derived value next to `edit-analysis-manager.ts`):

```ts
type EditContext = {
  parseOptions: ParseOptions;        // activeFigureId, analysisView, analysisSession
  sourceFingerprint: SourceFingerprint;
  colorAliases: ...; indentSize: number;
  availability(): EditActionAvailability;   // lazy, memoized on first call
};
```

Rules that come with it: commands, inspector, canvas, and reducer consume `EditContext` and never re-derive its parts; `availability()` is computed at most once per context (killing the ~7 redundant full-scene passes); the command runtime's memo keys on `EditContext` identity plus a small serialized state signature — and the ~25 option callbacks are passed through refs (or `useCallback`) so the memo can actually hold. Native-menu sync on desktop gates on the serialized signature string, not object identity. The inspector's `resolveTarget` default parameters become required fields of the context, making cache-sharing enforceable by the compiler instead of by convention. Menu `enabled` state can then move to lazy per-menu-open computation as a follow-up, but the context alone removes the systematic waste.

### Note D — Core's public surface, decided jointly with the add-on architecture
*Settles 4.7 (exports-map fiction), 4.5 (tsconfig duplication), and frames 3.2 / 3.3 / 3.6 as add-on groundwork. See `design/addon-architecture.md`.*

Two decisions, taken together. **Surface:** per the add-on design, core stays unpublished and add-ons see only `@tikz-editor/addon-api` — but in-repo consumers still need honest imports. Add an `exports` map to `@tikz-editor/core` matching today's deep paths, rename the 92 `tikz-editor/*` imports to `@tikz-editor/core/*`, and delete the four hand-copied tsconfig/vite alias blocks (one `tsconfig.base.json`). This makes the workspace dependency real without publishing anything.

**Data-driven core ("phase 0" of the add-on plan):** the review's biggest organization findings are the same closed dispatch points the add-on doc lists as needing to open. Doing them as data-structure refactors now — justified purely by the ~1,000 lines they delete — leaves the add-on work with registries instead of unions: the 22 `everyXNodeStyles` frame fields become one `Map<shapeName, …>` (3.2); `apply-kv`'s 845-line if/else becomes a key→handler table (3.5); the graph option double-dispatch becomes one table (3.3); the capability registries become `filter`s over the matrix (3.6), which also makes the add-on doc's namespaced `addon:${string}` feature ids a one-line widening instead of four hand-edited lists. None of this migrates core onto the add-on API (the doc's "don't dogfood yet" decision stands) — it just replaces hardcoded enumeration with lookups, which both goals want.

### Note E — Decomposition contracts before extraction
*Settles 3.5 without merely relocating coupling.*

Each god-file split is only worth doing once the target module API is written down; the extractions themselves are then mechanical. Proposed contracts, in recommended order:

1. **`inspector.ts` → section builders.** `type SectionBuilder = (ctx: InspectorBuildContext) => InspectorSection | null`, one module per section (fill, shadow, arrow, node, path, transform, grid, text), registered in an ordered list. **Deliberately the same shape as the add-on doc's inspector provider registry** — core's own sections become the first "providers," so the Phase C hook is a registry that already exists. Do this one first.
2. **`CanvasPanel.tsx` → hooks with narrow inputs.** `useCanvasTextEditSession({snapshot, svgResult, transform, dispatch})` returning `{state, textareaProps, caretOverlay, popup}`; `useNodePositionTargetPicking(...)` returning `{overlay, links, tooltip, handlers}`. Pure text-measurement helpers move to a plain module. Delete the dead snap-debug overlay as step zero.
3. **`evaluatePathStatement` → `PathBuilderState`.** Reify the ~25 closure-captured mutables into an explicit class with per-item-kind methods at module level (no per-call closure allocation). Riskiest split — do it last, behind the corpus tests (`npm run test:corpus`) as the safety net, and land it as state-reification first, file-split second.
4. **`desktop-platform.ts` → `bridge.ts` / `native-menu.ts` / `adapter.ts`**, deciding the 4.6 bridge additions (`checkLatexAvailable`, `compileTikz`, `setTheme`, `showAboutPanel`) in the same change so the e2e mock can be typechecked against the full `DesktopBridge`.

### Note F — Stable SVG def ids
*Settles 1.3; small, contained, decide once.*

Choose content-hash ids over reuse-bailout: `tikz-shading-<hash(signature)>` instead of sequence numbers. Stable ids make the part-reuse path correct by construction (identical shading → identical id in every emit), avoid throwing away reuse whenever defs change, keep DOM patching calmer, and — later — let add-on-emitted elements with gradients ride the same reuse path safely. Dedup falls out naturally (same hash = same def). Guard with a test that edits a document with two shadings and asserts both `url(#…)` references still resolve.

---

## Suggested plan of attack

**Quick wins (hours each):** 1.4 graph budget, 1.5 computeBounds loop, 1.6 pointer capture, 1.9 PT_PER_CM consolidation, 2.3 AssistantPanel selector, 2.5 clip-chain skip, 2.7 lazy KP pass 2, 2.8 cache cap, 4.1–4.4 CI steps, grid-step-picker dedup (3.8), snap-debug deletion.

**High-leverage days:** 2.1 + 2.2 (command runtime + App subscriptions — likely eliminates most per-keystroke app-layer waste), 1.1 surgical option mutations (comment preservation), 1.2 figure-aware addElement, 1.3 stable def ids, 2.4 copy-on-write registries, an error toast channel for export failures (3.9).

**Structural (schedule deliberately):** 3.2 frame-meta map (~600 lines deleted), 3.1 edit-layer helper consolidation, 3.5 decompositions (start with CanvasPanel text-editing extraction and inspector section builders — both have proven seams), 3.6 derived registries, 2.9 arc-length tables, 4.7 package exports map.
