# Coordinate writer

Status: phases 0–3 and class 1 of phase 4 built (harness, site contexts,
fragment layer and checker, writer core, world points written in source
units); the remaining classes and writer operations are a draft, second
revision after review. Inventory, fuzzer and failure classes are in
[coordinate-writes.md](coordinate-writes.md); this document designs the
writer from those failures.

Changes from the first draft:

- the guarantee is structural (typed fragments), not a set of pattern checks;
- frames come from contexts the evaluator captures, not from probe
  statements (probes were chosen to avoid touching the evaluator, which is
  the wrong reason; they survive only as a test oracle);
- spelling and frame are not independent;
- bounds have a site and a representation that is right under rotation;
- migration gates use fingerprints and per-case outcomes.

## The guarantee

**Structural:** every programmatic change to source text is built from typed
fragments. A fragment can contain a runtime number only if a typed
constructor produced it: the coordinate writer for anything placed in a
frame, typed scalar writers for frame-free values. Raw strings enter only
through a few named, audited entry points. So ordinary editing code cannot
express "turn this world point into text" except by calling the writer.

What it does not promise: that the writer's math is right. The
pointer-invariant fuzzer checks that, and the capture oracle (below) checks
the contexts the writer relies on.

## Fragments

Built in phase 2 (`packages/core/src/edit/fragment.ts`):

```ts
export type TikzFragment = string & Brand<"fragment">;
/** Coordinate-writer output: the only value a frame key accepts. */
export type CoordinateText = TikzFragment & Brand<"coordinate">;
/** A document after fragments were applied: the only source an edit result carries. */
export type EditedSource = string & Brand<"edited">;
/** A frame-free option value; an object, so it is neither a string nor a fragment. */
export type OptionValue = Readonly<{ [brand]: true; text: string }>;

/** Raw literal text with fragment holes: tikz`\draw${options} ${a} -- ${b};`. */
export function tikz(strings: TemplateStringsArray, ...parts: readonly TikzFragment[]): TikzFragment;
export function joinFragments(parts: readonly TikzFragment[], separator?: TikzFragment): TikzFragment;
/** Newlines and indentation; throws on anything else. */
export function layout(text: string): TikzFragment;
/** Slices of what typed constructors produced. */
export function sliceFragment(fragment: TikzFragment, from: number, to?: number): TikzFragment;
export function editedSlice(source: EditedSource | TikzFragment, from: number, to: number): TikzFragment;
export function applyFragments(source: string, edits: readonly { span: Span; fragment: TikzFragment }[]): EditedSource;

// Take any string; every call site is listed and reviewed (F2).
export function sourceSlice(source: string, span: Span): TikzFragment;
export function userText(text: string, origin: UserTextOrigin): TikzFragment;
export function unchangedSource(source: string): EditedSource;
export function plainNumber(value: number, origin: PlainNumberOrigin, bare?: boolean): TikzFragment;
export function macroExpansion(text: string): TikzFragment;
export function optionEntry(key: string, value: TikzFragment | OptionValueText | null): TikzFragment;
// (The migration escapes `legacyText` and `legacyEditedSource` were deleted in phase 5.)

// Option values, and the key table.
export function count(n: number): OptionValue;
export function angle(value: Deg): OptionValue;
export function canvasLength(value: Pt, unit?: CanvasLengthUnit): OptionValue;
export function ratio(value: number): OptionValue;
export function option(key: FrameKey, value: CoordinateText): TikzFragment;
export function option(key: CanvasKey, value: OptionValue): TikzFragment;
export function option<K extends string>(key: OtherKey<K>, value?: TikzFragment): TikzFragment;
```

- `tikz` takes only fragments in its holes. Its literal parts are fixed at
  compile time, so they can hold keywords and authored constants but no
  runtime value; they are read raw, so TeX is written as TeX
  (``tikz`\begin{tikzlayer}` ``) and a line break is a real one. A number
  cannot be concatenated, `.join()`ed or formatted into a fragment:
  `formatNumber` returns a plain `string`, which no fragment-accepting
  function takes. The checker requires `tikz` to be used as a tag (F4).
- Fragments have two roles, so a valid constructor cannot be used in the
  wrong place:
  - **source fragments** (`TikzFragment`): writer output, option lists,
    statements, `sourceSlice`, `userText`. Only these fill `tikz` holes;
  - **option values** (`OptionValue`): `count`, `angle` for angles that are
    not geometry (label directions), `canvasLength` for lengths PGF does not
    transform (node sizes without `transform shape`, line widths),
    `ratio` (`pos=`, opacity). They are objects, so
    ``tikz`(${canvasLength(p.x, "cm")},…)` `` does not compile. They enter
    source only through `option(key, value)` or `optionValueFor`. The
    latter gives the value alone, for option mutations, as an
    `OptionValueText`: a string that is not a fragment, so a value checked
    against one key cannot be spliced into coordinate syntax either. The
    slices that could cut a value back out of its option (`sliceFragment`,
    `editedSlice`) are reviewed call sites under F2.
- `option` checks the key against two tables. `FRAME_KEYS` (`shift`,
  `xshift`, `rotate`, `rotate around`, `scale`, `x`, `y`, `at`, `radius`,
  angles of arcs, `node distance`, …) take only `CoordinateText`, because
  their values are read in the frame; `CANVAS_KEYS` (`minimum width`,
  `inner sep`, `line width`, `label distance`, `shorten`, `pos`,
  opacities, …) take option values; any other key must be a literal (a key
  typed `string` could hide a frame key) and takes a fragment. `in`, `out`
  and the bends are frame keys (phase 5); `rounded corners` and tree
  distances are in neither table until their frame semantics are checked in
  PGF. The writer's `coordinateText`
  is the only `CoordinateText` constructor (writer-internal, F3).
- Lengths that live in a frame are not frame-free: a plain radius `(.5)`
  goes through the x and y vectors, a length `radius=1cm` along the canvas
  axes, and either then through the CTM (`\tikz@do@ellipse`; PGF refuses to
  mix the two in one ellipse). They go through the writer (`writer.radii`,
  phase 5).
- `SourcePatch.replacement`, `replaceSpan`, `TextReplacement.text`,
  `OptionMutation.value` and every result's `newSource` take fragments and
  `EditedSource`, so no string-built source gets into a result. Patch
  composition works on fragments; `documentDiffPatch` (two revisions of the
  document) and `invertSourcePatches` (undo of a preview) copy verbatim text.
- Wraps go where a string is created, never inside a helper: a helper that
  wrapped its `string` parameter would launder whatever callers pass. The
  drawing-layer text of Beamer decks, for instance, is built from `tikz`
  constants in core, so the app's layer patch needs no escape.
- Edit actions are a boundary: `setProperty.value`, adornment values and
  node text arrive as strings and become `userText`. App code that computes
  such a value (an inspector scrub of `xshift`, say) is outside the
  guarantee until it sends a structured action instead.

Checker rules (`scripts/check-coordinate-writes.mjs`, type-aware, run by
`npm run typecheck` through `check-coordinate-typing.mjs`, over the
production sources of `packages/` and `apps/`):

| rule | checks |
|---|---|
| F1 | type assertions and type predicates to a type carrying a fragment brand (`TikzFragment`, `CoordinateText`, `EditedSource`, `OptionValue`, also inside unions and arrays) only in `fragment.ts` and `edit/writer/` |
| F2 | every call of a constructor that takes any string (`userText`, `sourceSlice`, `unchangedSource`, the slices, `plainNumber`, `macroExpansion`, `optionEntry`; until phase 5 also `legacyText`, `legacyEditedSource`) is listed |
| F3 | writer internals (`formatCoordinate`, `formatPolarCoordinate`, `formatCanvasCoordinate` in `writer/format.ts`, `localToSourceUnits`, `coordinateText`) used only in `edit/writer/`, resolved by symbol so aliases and re-exports count; `ptToCm` not on a point's `x`/`y` outside the writer either |
| F4 | `tikz` only as a template tag |
| F5 | a point, vector or bounds constructor of `coords/points.ts` not fed the `x`/`y` of a point in another space (directly, or through `+`, `-`, and one-argument calls such as `pt(…)`), except in the transform modules (`core/src/coords/`, `app/src/ui/coords/`) and the writer |

F5 covers the fixture "a `WorldPoint` built from picture-local numbers",
which the types alone accept (both are `Pt`). Its first run found the
center-pivot move building its next pivot as a `WorldPoint` from the
frame-local pivot plus a local delta; `parseRotateAroundValue` itself labels
an authored pivot `WorldPoint`. Both are migration entries for class 1.

The pattern rules of the first draft (coordinate-shaped template literals,
`formatNumber` with branded operands, unbranded point parameters) are not
built; the type layer and F1–F5 replace them.

Negative fixtures in `test/fixtures/coordinate-checker/` (excluded from the
repository typecheck) each name the diagnostics they must produce, and only
those, as TypeScript codes or rule ids; `coordinate-write-checker.spec.ts`
compiles them with the repository's options and runs the rules without
exceptions. Type errors: concatenation into a patch (TS2322), `.join()` of
formatted numbers in a `tikz` hole (TS2345), split formatting into
`replaceSpan` (TS2345), a helper returning a coordinate string (TS2322), a
`canvasLength` in a `tikz` hole (TS2345), `option("xshift",
canvasLength(…))` (TS2769), an option key typed `string` (TS2769). Checker:
a cast (F1), a type predicate (F1), `userText` in an unlisted module (F2),
an alias import of `formatCoordinate` and a re-export (F3), `tikz` called
as a function (F4), a world point from frame-local components (F5). An
`allowed.ts` fixture expects nothing. Disabling F1, F4 or F5 fails its
fixtures.

## Evaluator-owned site contexts

### Why not probes

A probe statement inserted at a site and evaluated would reuse the
evaluator, but it is the wrong mechanism:

- a `\path` probe does not see what the destination sees: a new node's
  `every node` styles, its own options and `transform shape`, or path
  transforms active midway through a path;
- the geometry session replays statements and rejects structural changes,
  so inserting a probe needs new machinery anyway;
- it hides TikZ frame semantics as "whatever a `\path` saw", and costs an
  evaluation per edit.

The evaluator already holds every context while it evaluates. Recording it
is the right architecture.

### What the evaluator records (phase 1, built)

`packages/core/src/semantic/site-context.ts`:

```ts
/** What TikZ applies at one place, as the evaluator had it. */
type SiteContext = Readonly<{
  ctm: FrameToWorldTransform;   // raw CTM, before any coordinate's own spelling
  axes: AxisBasis;              // PGF x/y vectors
  [siteContextBrand]: true;
}>;
```

The evaluator's frames are mutable (options and `\tikzset` reassign their
fields), so a capture is a frozen value copy, never a reference to live
state. Frames reassign their transform and axis objects rather than mutating
them, so one capture is memoized per pair and shared by every handle and
statement of that frame.

| capture | where | status |
|---|---|---|
| coordinate context | `siteContext` on every coordinate edit handle, beside its composed `frame` | built |
| statement entries | `semantic.siteContexts.statementEntries`, one per evaluated statement in order; a scope's `:leave` step holds the state at the end of its body; `\foreach` copies give one entry per iteration | built |
| figure end | `semantic.siteContexts.figureEnd` | built |
| node placement | canvas orientation (non-translations reset unless `transform shape`) composed with `every node` and the node's own options, in PGF order | with class 4 |
| current point | not recorded: `path-pieces.ts` replays it from the handles' worlds, checked against each relative handle's `relativeBase` | class 5 done |

Incremental evaluation keeps each statement's entry context on its reused
fragment: it is valid exactly as long as the reused elements are, since both
depend on the state the statement starts from. The figure end is captured
from the run's final state, replayed or restored from the previous run.

### Preparing an insertion

The rich state a new statement needs (styles, macros, `every path`,
`every node`) is not stored. It is re-derived on demand:

```ts
// packages/core/src/edit/insertion-context.ts
prepareInsertion(snapshot, gap: { kind: "before"; statementIndex } | { kind: "end" },
  description: { kind: "path"; command; options?: string } | { kind: "scope"; options?: string }): SiteContext
```

It replays the evaluator from the nearest geometry checkpoint to the gap,
then resolves the statement with the evaluator's own steps: a path through
`resolvePathBoundary` (`every path` styles, then its options), a scope by
running the scope's `enter` step and then a plain path's boundary inside it,
since a scope's coordinates are only read by its paths. Nothing in edit code
combines transforms.

Finding from the capture oracle: the recorded state at a gap is not the
frame a new path there reads coordinates in when `every path` styles
transform (`every path/.style={xshift=5mm}`). So writes of new statements
always go through `prepareInsertion`; recorded entries serve comparisons
(does a copy's gap match its original's?) and loop-invariance checks.

`StatementFrameResolver.options` now resolves paths through the same
`resolvePathBoundary`. It used to skip `every path` styles: under
`every path/.style={rotate=20,xshift=5mm}`, a center-pivot rotation of a
rectangle by 30° landed up to 22pt off; it is now exact. Rectangle resize
was unaffected in that case.
`StatementFrameResolver.parent`, which drops the axes, is deleted when its
callers move to the writer.

Consistency checks:

- **Capture oracle** (`test/site-context.spec.ts`): over the fuzzer's frames
  plus nested scopes, a mid-picture `\tikzset{x=…}`, `every path` and a
  transforming style, (a) every coordinate handle's `frame` equals its raw
  context composed for its spelling, (b) a probe `\path` inserted at every
  gap lands where `prepareInsertion` predicts, and the recorded entry equals
  the replayed state unless `every path` transforms, (c) paths and scopes
  with transforming options match `prepareInsertion`. Mutation-checked:
  dropping the axes from captures fails all three, ignoring path options
  fails (c).
- **Incremental evaluation:** handles, entry contexts and the figure end are
  part of what the incremental tests and the compute differential fuzzer
  compare warm against cold. They caught the one gap in phase 1: the suffix
  replay fallback reused prefix statements without their entry contexts.
- **Loops:** a site inside a `\foreach` body has one entry per iteration;
  the writer accepts it only if they agree.

### Spelling selects the mapping

The writer chooses the spelling of a coordinate first, and the spelling
selects the map from the raw context:

- unitless component: `ctm · axes`; dimensioned component: `ctm`; mixed
  `(1cm,.5)`: per component, as `coordinateTransform` does;
- relative `+`/`++`: the linear part, from the context's current point;
- polar: angle and radius in the same per-component frame.

A handle's existing `frame` is the composed map for its original spelling,
not a raw CTM. That's why handles carry the raw context too: detaching
`(A.north)` into a numeric coordinate, or re-spelling a coordinate when a
path is reversed, needs the raw context to compose a new map.

Spelling policy:

- editing an existing coordinate preserves its spelling (units per
  component, polar, `canvas cs:`, relative prefix);
- new coordinates are unitless, always. Deterministic, matches how authors
  write `x=2cm` pictures, and correct now that the axes are applied;
- precision from `NumberFormatOptions` (two decimals by default, six for
  frame reparameterization, snapped values exact).

## Writer API

Built in phase 3: `point` at a `coordinate` site. The rest of this section
is the target; each operation comes with the failure class that needs it.

```ts
// packages/core/src/edit/writer/index.ts
export type WriteSite =
  | { kind: "coordinate"; handle: CoordinateEditHandle }
  | { kind: "in-statement"; sourceId: string; itemIndex?: number }
  | { kind: "gap"; containerId: string; index: number }            // before the index-th statement
  | { kind: "node-placement"; nodeSourceId: string }
  | { kind: "picture-bounds"; figureId: string };

export type WriterResult<T> = { kind: "ok"; fragment: T } | { kind: "unsupported"; reason: string };

export interface CoordinateWriter {
  point(site: WriteSite, world: WorldPoint, spelling?: Spelling): WriterResult<TikzFragment>;
  vector(site: WriteSite, world: WorldVector, spelling?: Spelling): WriterResult<TikzFragment>;
  radius(site: WriteSite, world: WorldLength, spelling?: Spelling): WriterResult<TikzFragment>;
  rotation(site: WriteSite, worldDeg: Deg, pivot: WorldPoint): WriterResult<TikzFragment>;
  positioning(site: NodePlacementSite, target: PositioningTarget, world: WorldPoint): WriterResult<TikzFragment>;
  /** A statement copied to `gap`, its own coordinates offset by `delta`. */
  offsetStatement(statement: StatementRef, gap: GapSite, delta: WorldVector): WriterResult<TikzFragment>;
  bounds(site: PictureBoundsSite, world: WorldBounds): WriterResult<TikzFragment>;
  readBounds(site: PictureBoundsSite, statement: StatementRef): WorldBounds | null;
}

/** Bound to one rendered snapshot and its contexts; refuses any other source. */
export function createCoordinateWriter(snapshot: EditGeometrySnapshot | EditGeometrySession): CoordinateWriter;
```

- Inputs are world-space types only, so "picture coordinates" cannot be
  handed in.
- What phase 3 built (`edit/writer/`): `createCoordinateWriter(source)` and
  `point({ kind: "coordinate", handle, context? }, world, { precision })`.
  The map comes from the handle's site context and its **spelling**, which
  the evaluator now records on every frame-local handle
  (`CoordinateSpelling`: unitless per component, and the heading of a
  `turn` coordinate), through `spelledCoordinateFrame` in
  `semantic/site-context.ts`; the handle's `frame` is no longer read. The
  capture oracle checks that this composition equals the evaluator's own
  frame for every handle, turn coordinates after mid-path options included
  (linear part for relative ones). `precision` is `drag` (two decimals,
  polar angles in [0, 360)) or `reparameterize` (six decimals, angle as
  computed), which center-pivot moves and rotations use. `context`
  replaces the site context when an edit changes the options a coordinate
  is read under.
- `rewriteCoordinate` dispatches: coordinates to the writer (adding `at`
  for implicitly placed nodes), calc offsets and positioning to their old
  rewrites, now two `legacyText` exceptions until classes 4 and 5.
  `rewritePreciseFrameCoordinate` is the writer at `reparameterize`.
- Two actions resolve the frame after their option edit as a bare CTM
  (`resolveStatementOptionFrame`), without the axis vectors: center-pivot
  moves and center-pivot rotation. Phase 3 keeps that behavior through
  `legacyCtmSiteContext`, a listed migration escape; under `x=`/`y=` it
  misplaces unitless coordinates (class 1), so the fix belongs there, with
  the full option state from `resolveStatementOptionState`.
- Tests: a write-then-read-back round trip for every fuzzer frame and every
  preserved spelling (mixed units, polar with and without units, relative,
  turn, `canvas cs:`, a detached named endpoint), a spelling snapshot, and
  refusals. Forcing unitless spelling in the writer fails five frames.
- Refusals carry a reason, which actions pass through: singular axes, a
  rotation the frame cannot express, a loop-dependent context.
- `translated(site, steps)` (class 2): a cartesian or xyz coordinate moved
  by `Σ variable × world vector`, as loop terms in its own spelling. At a
  context site the coordinate is `(0,0)` or the text it replaces, which
  serves a scope's `shift`.

### Bounds

`\useasboundingbox` sits in the picture body, so it has a site: the gap
context before the first statement. PGF transforms each path point to canvas
before growing the picture box (`\pgfpathmoveto` → `\pgfpointtransformed`,
then `\pgf@protocolsizes`). A `rectangle` between two inverse-mapped corners
is therefore a rotated rectangle under a rotated or skewed frame, and its
canvas hull is larger than the requested box. So:

- if the context's unitless map keeps axes axis-aligned (identity, scale,
  flip, axis lengths, quarter turns), write `(x₁,y₁) rectangle (x₂,y₂)`;
- otherwise write the four inverse-mapped corners,
  `(p₁) -- (p₂) -- (p₃) -- (p₄) -- cycle`, whose canvas hull is the box;
- reading needs no parser of its own: `resolveFigureBoundsWorld` takes the
  hull of the statement's handles, where the evaluator put them. This
  replaced `parseCoordinateComponentCm`, which read unitless numbers as
  centimetres.

Built: `writer.bounds(context, world)`. The context comes from
`prepareInsertion` at the gap the statement takes (before its own entry
when it is replaced, else before the first statement), as a
`\useasboundingbox` path, so `every path` styles apply as in TikZ.

### Rotation

A path option `rotate` multiplies onto the CTM after the axes: canvas =
parent · R · axes · c. That is a world rotation when the parent's CTM is
conformal; under a reflection the angle flips sign. Under a non-conformal
parent (`xscale=2` scope) no angle is a world rotation. Baking the rotation
into coordinates instead needs its own design (curves, shapes, node text,
dependencies).

Built: `writer.rotation(context, angle, pivot)` writes a `rotate around`
value at the options before it, with the pivot as a coordinate there (its
plain numbers through the axis vectors, as the evaluator reads
`rotate around`). `angle` is `{ world }`, refused under stretch or skew, or
`{ authored }`, the option's own angle. Center-pivot rotation turns the
world by the gesture's change where the CTM is conformal (flipped under a
reflection) and keeps its tested behavior elsewhere: the change goes to the
authored angle, which TikZ composes with the parent. The product table
first said to refuse there; that would have removed a tested feature, so
it was decided to keep it.

### Positioning

`node-placement` follows PGF: `tikzlibrarypositioning.code.tex` applies the
distance with `\pgftransformshift` during node placement, after
non-translations are reset unless `transform shape` is set. Verified with
pdflatex: `right=1cm of A` leaves a 1cm canvas gap under `scale=2` and
`rotate=90`, and the node's own `rotate=-35,xshift=3mm` moves it. Unitless
distances (`right=1 of A`) go through `\pgfpointxy`, i.e. the axes.

What the code does with that (class 4, done): the writer needs no frame for a
positioning option. `right=1.2cm of A` is a canvas distance, so
`writer.positioning(context, world, { bypassSnapping })` writes cm from the
node centers and the anchors the evaluator recorded; the direction is chosen
in world space (PGF's directions are canvas directions, also under a
reflected frame), snapped to a cardinal one unless `bypassSnapping`, and a
direction whose distances are not negative is preferred. What was missing
was the node's own part. A positioned node's handle now stands where the
positioning puts it, before the node's own `xshift`/`yshift` and the
translation its transform carries (the evaluator drew the node at the handle
plus those, but its handle had them half subtracted when a rotation came
first). A node's placement handle records where the node was drawn and its
eight anchors relative to that (`nodePlacement`), so
`positionNodeRelativeTo` measures an unnamed, rotated or round node from its
real anchors, not from its bounds. Not done: the evaluator applies `xshift`
in world space whatever its order against `rotate`; PGF composes them in
option order (`rotate=-35,xshift=3mm` shifts along the rotated axis). That is
an evaluator fidelity question, not a writer one.

## Failure classes, mapped

| class | fix |
|---|---|
| 1. world cm as source units | insertPathPoint, convert-to-absolute: `writer.point` at an `in-statement` site; figure bounds: `writer.bounds`/`readBounds`; center-pivot rotation: corners via `writer.point`, angle via `writer.rotation` |
| 2. offsets in a bare picture (done) | a copy is inserted unmoved and offset in the document it landed in, by the move machinery (no `offsetStatement`: the copy's own handles carry its frame). Repeat steps are world vectors, written by `writer.translated`; positioned nodes through `writer.positioning` (class 4) |
| 3. new coordinates ignore axes and scopes (done) | insertion actions take world points, written at the gap or target-statement context. A core `addPath { start, segments, closed, style }` replaces app-side path and freehand string generation; `appendToPath` takes world segments. The app's `*InPictureCoordinates` mappings are deleted |
| 4. positioning (done) | drags and `positionNodeRelativeTo` use `writer.positioning` (world directions, canvas distances), against handles that stand where the positioning puts the node. Copies and alignments are exact: they bypass the cardinal snap |
| 5. relative coordinates in rewritten paths | restructuring actions build the path from pieces; `spellPath` keeps every coordinate's text unless it is relative and read from another point now, then `writer.point` with that point as `relativeBase` (absolute where nothing comes before it) |

## Product decisions

| question | decision |
|---|---|
| spelling of new coordinates | preserve when editing; new coordinates unitless, always |
| paste across scopes | two intents. Canvas copy/paste keeps the visual geometry, then applies the paste offset (`offsetStatement` into the destination gap). Pasting raw TikZ keeps its text (`userText`) |
| rotation in non-conformal frames | the gesture changes the authored angle, which TikZ composes with the parent (existing, tested behavior; decided to keep) |
| assistant coordinates | structured placement tools state world units explicitly; raw TikZ from the assistant is source text. Check the existing tool contracts before changing behavior |

## Gates

- **Fuzzer, per case.** `expected-outcomes.json` records the outcome of all
  1788 cases (`ok`, `partial`, `unsupported: reason`, `error`, `fail: class`).
  Any difference fails the test. Recording (`POINTER_FUZZ_UPDATE=1`, full
  run, seed 1) prints every transition and refuses regressions unless
  `POINTER_FUZZ_ACCEPT_REGRESSIONS=1`. Partial results are checked like full
  ones; errors are failures. A full run must generate every recorded case,
  and recording refuses removed cases and new failing cases too. CI runs
  every frame (`POINTER_FUZZ_FULL=1` on
  the `npm test` step); local `npm test` runs the quick subset. Other seeds
  may change refusals but not add failures.
- **Checker exceptions, fingerprinted.** `scripts/coordinate-write-exceptions.json`
  has one entry per fingerprint: rule, file, enclosing declaration path,
  and a hash of the offending expression without whitespace, with a count
  and the expression for review. Line moves don't change it; replacing one
  violation with another does, and fails. Two sections: `reviewed` (calls
  of `userText`, `sourceSlice`, `unchangedSource` whose arguments were
  checked to be user input or verbatim document text) and `migration`
  (everything else; done when empty). A listed count the code no longer
  reaches fails too, so the list shrinks with the code.
  `node scripts/check-coordinate-writes.mjs --update` prints removals (`-`)
  and additions (`+`), writes removals, and refuses additions unless
  `--accept-new` is given after review.
- **Capture oracle** and the **compute differential fuzzer** cover the
  contexts.

## Migration

0. **Harness hardening.** Done: real node-resize checks, partial and error
   results, per-case outcomes, full run in CI.
1. **Site contexts in the evaluator.** Done: raw context on handles,
   statement entries and figure end in the semantic result, carried through
   incremental fragments; `prepareInsertion` for paths and scopes; capture
   oracle. Node placement and current point come with classes 4 and 5. The
   only behavior change: `StatementFrameResolver.options` now applies
   `every path` styles.
2. **Fragment layer and checker.** Done: fragment types and constructors,
   option values and the key table, every patch, replacement and result
   typed; F1–F5 with the fingerprinted exception list; negative fixtures.
   First list: 156 violations in 150 entries; 59 reviewed constructor
   calls, and as migration 64 `legacyText`/`legacyEditedSource` calls,
   22 writer-internal uses (F3) and 11 rebranded points (F5). Reviewing the
   string-constructor calls found two launderings, now migration entries:
   `rotate-element` passed computed rotation values as inspector text, and
   the connect action sliced a document it had built by concatenation. New
   code cannot add a raw coordinate write without a listed exception. No
   behavior change.
3. **Writer core.** Done: the evaluator records each coordinate's
   spelling, and `edit/writer/` writes existing coordinates from the site
   context and that spelling; `rewrite.ts` and `frame-coordinate.ts` are
   ported with no behavior change (unchanged rewrite tests and fuzzer
   outcomes). The formatters and `localToSourceUnits` moved into the writer;
   the exception list went from 156 to 139 violations: 18 writer-internal
   uses and the precise rewrite's two `legacyText` calls left, the old
   rewrite exception split into calc and positioning, and two
   `legacyCtmSiteContext` calls were added.
4. **Class 1**, then **class 3** (world insertion, `addPath`, delete the app
   pre-mapping), then **class 2**, then **classes 4 and 5**. Each phase
   records its improvements with the fuzzer update and shrinks the
   exception list.
   - Class 1 done: all 71 recorded failures pass (328 → 257 fuzzer
     failures), no other outcome changed. The writer gained `context`
     sites (a coordinate at a context the evaluator resolved, keeping the
     spelling of text it replaces), `readContextPoint`, `bounds` and
     `rotation`; statement option states come as site contexts
     (`resolveStatementOptionContext`, `geometry.optionContext`); node
     positioning handles record where an `at` would be read.
     `insertPathPoint` and smoothing a corner write at the path's own
     context (refused when its points are read in different frames);
     convert-to-absolute at the node's placement; figure bounds as above,
     read back from handles; center-pivot moves read and write the pivot
     at the prefix options' context and give the moved coordinates the
     full option state, which removed `legacyCtmSiteContext`.
     Exceptions: 139 → 129 (migration 80 → 66; four reviewed
     `sourceSlice` calls copy the `rotate around` text around the pivot).
   - Class 3 done: 49 recorded failures pass (257 → 208), no other outcome
     changed. Insertion actions take world points. A new statement is
     appended at the end gap, `prepareInsertion` gives the context there
     (options included, so `[x=2cm]` and scopes count), and the points are
     written with a `context` site (`edit/new-statement.ts`; it reuses the
     geometry snapshot when its source is the edited one, which keeps a
     drawing layer's page shift). `generateElementSource` and the complex
     path generators take such a point writer; `addPath { start, segments,
     closed, strokeColor }` replaces the app's path and freehand string
     generation, and `appendToPath` takes world segments, written in the
     frame its path's points share (refused when they differ). The app's
     `picture-coordinates.ts` and its mappings are deleted. A refusal is an
     `unsupported` result, never a guess. Names and text values entered in
     templates are `userText`, with a new `node-reference` origin. Circle
     and ellipse radii stay `legacyText` until phase 5 (`writer.radius`).
     Exception entries: reviewed 58 → 68 (the template text values),
     migration 64 → 62.
   - Class 2 done: 163 recorded failures pass (208 → 45); one case went
     ok → partial and was fixed (below). `duplicateElements` and
     `pasteStatements` insert the unmoved copy, evaluate the edited
     document and move the copy's statements with `applyMoveElements`, so
     the copy's coordinates are rewritten in the frame, spelling and path
     options they are read with there (the old bare-picture preparation and
     its cache are gone). Moving after inserting cost one evaluation per
     group of copies. Statements are found by span, trimmed of the line
     break before them, innermost first (a copy in a scope matched the
     scope). Groups are copied from the end of the document, since an
     insertion shifts the ids after it. A copy that ends at a named node
     keeps the node: those skipped endpoints no longer make a duplicate
     partial. `repeatElements` evaluates the source and gives the writer a
     step per loop variable (`translated`, `LoopStep`): the coordinate
     `1+\i*1.5-\j*0.5` keeps each component's unit, a plain number stays
     one, and the step is the world vector through the inverse of the
     coordinate's own frame, so axes, rotation and skew are right. A
     coordinate without a handle, or a relative, polar or named one,
     sends the statement into `\begin{scope}[shift={…}]`, read in the frame
     the statement starts in; a frame that differs between passes of an
     enclosing loop is refused. Output in a plain picture changed: plain
     numbers stay plain (`(1+\i*2,0)`, not `(1cm+\i*2cm,0)`).
     Exception entries: migration 62 → 60.
   - Class 4 done: the 27 positioning failures are gone (45 → 18, the rest
     class 5), two `positionNodeRelativeTo` cases now refuse where they wrote
     the wrong place (a rotated node whose centers would need a negative
     distance). Causes, in order of cases: the positioned node's handle
     included its own shifts (8 cases: drags, moves, duplicates, aligns of a
     node with `rotate=…,xshift=…`); duplicates and aligns went through the
     cardinal snap meant for drags and dropped the offset (16, including
     `top` alignments in every frame); `positionNodeRelativeTo` took anchors
     from bounds and offsets from a different center than the one it
     preserved (3). `rewritePositioningFromContext` moved into the writer as
     `positioning`, returns typed text, and lost its `legacyText`; the
     wrapper that put the entry into a node's option brackets is typed too.
     Exception entries: migration 60 → 58.
   - Review fixes after class 4. `positionNodeRelativeTo` aimed at the
     handle (where the `at` is) while removing the node's own
     `xshift`/`yshift`, so a shifted node moved by its shift; it now aims
     at where the node is drawn. The evaluator let the anchor a placement
     implies beat a later `anchor=`, while PGF reads options in order and
     the later one wins. `optionValueFor` returned a fragment, so a value
     checked against a canvas key could fill coordinate syntax; it now
     returns `OptionValueText`, which only option mutations take, and the
     slices are reviewed F2 sites. Duplicating siblings put every copy
     after the last one, where a `\tikzset{x=2cm}` or a redefined node name
     between them changed how a copy read; copies now go after each run of
     adjacent originals. Repeat refused nothing that a `shift` cannot move:
     it now refuses a node positioned relative to, or placed at, a node
     the copy does not declare (PGF reads anchors with the transformation
     undone).
   - Class 5 done: the 18 recorded failures pass (18 → 0). Restructuring
     actions (reverse, split, join, delete point, close/open, point kind,
     insert point, prepend) build the new path from pieces: the start, the
     path's own segments, and new lines and curves of its coordinates or of
     points the writer wrote. `spellPath` replays how TikZ reads them
     (`tikz.code.tex`: a coordinate is read from the current point, which a
     `+` one does not update; a first control from where the curve starts,
     the end from the current point, a second control from the end;
     controls never update it), on the old path and on the new one. A
     relative coordinate whose base changes is written again from the new
     one (`CoordinateSite.relativeBase`), exactly, not rounded like a drag;
     where nothing comes before it, it becomes absolute; every other
     coordinate keeps its text, and a path without relative coordinates
     comes out as before. The replayed bases are checked against the
     evaluator's `relativeBase`, and a disagreement refuses. A `turn`
     coordinate is refused once anything before it changes. Most of the
     failures were the anchor text dropping its `++`: a coordinate's span
     leaves the prefix out. `explicitSegmentText` and its `legacyText` are
     gone. Exception entries: reviewed 78 → 80, migration 58 → 57.
5. **Remaining writers.** Radii and other frame-dependent lengths (after
   adding circle/ellipse resize cases), SVG import, assistant handlers,
   semantic-internal source (`fit`, `tree-child`, `label-quotes`) or audited
   exceptions. Done when the exception list is empty.
   - Radii: the radius frame is the CTM, through the axis vectors when the
     radius is a plain number. Three readers give lengths in it
     (`radiusLengthsOf` for a drag's reach, `circleRadiusLengths` for a
     world circle, `worldEllipseRadiusLengths` for a world-axis ellipse) and
     `writer.radii` writes them in their spelling, each radius keeping its
     own unit. Resize used to read the drag in the center's frame and write
     `cm`, so a plain radius under `x=2cm` came out half as large; new
     circles were written in `cm` whatever the CTM, so they doubled in a
     `scale=2` picture. A new circle in a skewed frame, and a new ellipse
     the frame turns off the world axes, are refused; a stretched frame
     gets an `x radius` and a `y radius`.
   - Values that are frame keys but not points, solved by the action and
     checked against the frame it produces, are formatted by the writer:
     `angle` (an authored `rotate=`), `factor` (`xscale`), `length` (a shift
     in its ordered prefix's frame, or a canvas distance such as a node's
     `above=3pt`), `shiftPair`, and `typedComponents` (the public
     `updateCoordinate` edit, whose components are user text). Matrix and
     tree placement write through `writer.point` at the node's own
     coordinate, in its spelling, or at the statement's entry context.
   - `plainNumber(value, origin)` is the one constructor for numbers no frame
     reads (Beamer lengths and scales, label counters); its call sites are
     reviewed under F2, as a number that could fill coordinate syntax.
   - `to` path angles: PGF's `topaths` computes the curve (the distance
     between the points, `out`, `in`, a bend's turn) in the coordinates it
     is read in, and the CTM maps it after. The evaluator read every angle
     in world space, so `out=0` under `rotate=90` bulged sideways in the
     editor where PGF draws a straight line, and a bend did not flatten
     under `xscale=2` (checked with `compare:renderers`). It now computes
     the curve in the CTM's coordinates; curve handles carry that linear
     map, and a dragged control or bend is read back into angles there and
     written by `writer.angle`. `in`, `out` and the bends became frame
     keys.
   - Exception entries: migration 57 → 0; reviewed 80 → 135 (the
     structural text now typed at its origin, each copy, user value and
     new constructor call a listed site). Three agents (Sonnet) did the
     app-side rebranding, the Beamer text and the structural text; their
     results were reviewed, and the structural one checked against HEAD on
     164k edit scenarios with identical output.
   - With no call site left, `legacyText` and `legacyEditedSource` are
     deleted: a string can no longer become source text except through a
     listed constructor or the writer.

Cost to measure before phase 4: memory of the recorded contexts, and the
time of insertion, paste and repeat in large documents, including cold
checkpoint preparation. Paper-drag profiling does not exercise these paths;
add profiling specs for them in `apps/web/profiling/`.

The fuzzer grows with the design: a singular frame expecting `unsupported`,
a `transform shape` node, a mid-picture `\tikzset{x=2cm}` before the
insertion site, points inserted after a mid-path `[rotate=…]`, paste into
another scope, circle and ellipse resize.
