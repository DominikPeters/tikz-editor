# Coordinate writer

Status: draft, second revision after review. Inventory, fuzzer and failure
classes are in [coordinate-writes.md](coordinate-writes.md); this document
designs the writer from those failures.

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

```ts
// packages/core/src/edit/fragment.ts
export type TikzFragment = Brand<string, "TikzFragment">;
/** Source produced by applying fragments; the only type an edit result's newSource accepts. */
export type EditedSource = Brand<string, "EditedSource">;

/** Literal text with fragment holes: `tikz\`\\draw${options} ${a} -- ${b};\``. */
export function tikz(strings: TemplateStringsArray, ...parts: TikzFragment[]): TikzFragment;
export function joinFragments(parts: readonly TikzFragment[], separator: TikzFragment): TikzFragment;
/** Existing source copied verbatim. */
export function sourceSlice(source: string, span: Span): TikzFragment;
/** Text the user typed or pasted: inspector raw values, node text, raw TikZ paste. */
export function userText(text: string, origin: UserTextOrigin): TikzFragment;
export function applyFragments(source: string, edits: readonly { span: Span; fragment: TikzFragment }[]): EditedSource;
```

- `tikz` takes only fragments in its holes. Its literal parts are fixed at
  compile time, so they can hold keywords and authored constants but no
  runtime value. A number cannot be concatenated, `.join()`ed or formatted
  into a fragment; `formatNumber` returns a plain `string`, which no
  fragment-accepting function takes.
- Frame-free values have typed writers next to `fragment.ts`: `count(n)`
  (matrix rows, foreach bounds), `angle(deg)` for angles that are not
  geometry (label directions), `canvasLength(pt, unit)` for lengths PGF does
  not transform (node `minimum width` without `transform shape`, line
  widths), `ratio(x)` (`pos=`, opacity).
- Lengths that live in a frame are not frame-free: a circle radius `(.5)`
  goes through the x vector, and `radius=1cm` is scaled by the CTM. They go
  through the writer (`writer.radius`). `resize-element.ts` writes radii as
  `radiusPt * CM_PER_PT cm` today; circle and ellipse resize are not fuzzed
  yet, so this is likely a sixth failure class.
- `SourcePatch.replacement`, `replaceSpan` and every result's `newSource`
  take fragments and `EditedSource`, so no string-built source gets into a
  result. Patch rebasing and composition (`composeSourcePatches`) operate on
  fragments too.

Checker rules (in `scripts/check-coordinate-typing.mjs`, type-aware, already
in `npm run typecheck`):

| rule | checks |
|---|---|
| F1 | assertions to `TikzFragment`, `EditedSource`, `CoordinateText` and the writer's frame types only in `fragment.ts` and the writer |
| F2 | `userText` and `sourceSlice` called only from listed call sites (each one fingerprinted and reviewed) |
| F3 | writer internals (`formatCoordinate`, `formatPolarCoordinate`, `formatCanvasCoordinate`, `localToSourceUnits`, `ptToCm` on points) imported only inside `edit/writer/`, resolved by symbol so aliases and re-exports count |

The pattern rules of the first draft (coordinate-shaped template literals,
`formatNumber` with branded operands, unbranded point parameters) stay as
tripwires during migration only. They are not part of the guarantee.

Negative fixtures in `test/fixtures/coordinate-checker/`, each expecting its
diagnostic: string concatenation into a patch, `.join()` of formatted
numbers, `formatNumber(x) + "," + formatNumber(y)` split formatting, a helper
that returns a coordinate string, an alias import of `formatCoordinate`, a
re-export, a cast to `TikzFragment`, `userText` from an unlisted module, and
a `WorldPoint` built from picture-local numbers.

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

### What the evaluator records

```ts
/** What TikZ applies at one place, as the evaluator had it. */
type SiteContext = Readonly<{
  ctm: FrameToWorldTransform;   // raw CTM, before any coordinate's own spelling
  axes: AxisBasis;              // PGF x/y vectors
  currentPoint?: WorldPoint;    // for relative coordinates inside a path
  [siteContextBrand]: true;
}>;
```

Capture points, stored in the semantic result:

| capture | when | serves |
|---|---|---|
| gap context | before each statement and at the end of each container body (picture, scope) | new statements, copies placed after an original, figure bounds |
| statement context | after a statement's own options | `in-statement` writes: inserted points, appended segments, re-spelled coordinates |
| path position | per path item, where path options or transforms change the CTM midway | points inserted mid-path |
| node placement | for each node: canvas orientation (non-translations reset unless `transform shape`) composed with `every node` and the node's own options, in PGF order | positioning distances, node `at` |
| coordinate context | on every coordinate edit handle, the raw `SiteContext` beside today's `frame` | drags, re-spelling a detached named coordinate |

A context is a reference to the evaluator's immutable frame state, so
recording costs memory, not time. New statements whose options transform
(a new node with a style, a path with `[rotate=…]`) are resolved by calling
the evaluator's option resolution on the gap context, the same code path
`StatementFrameResolver.options` uses today. Nothing in edit code combines
transforms.

`StatementFrameResolver.parent`, which drops the axes, is deleted.

Consistency requirements:

- **Incremental evaluation and checkpoints** must produce the same contexts
  as a cold evaluation. The compute differential fuzzer compares warm and
  cold results; the contexts become part of what it compares.
- **Loops and macros:** a site inside a `\foreach` body has one context per
  iteration. The writer accepts it only if every iteration has the same
  context, and refuses otherwise.
- **Capture oracle:** a test inserts a probe statement of the right kind
  (node or path, with the destination's options) at each capture point of
  the fuzzer's pictures, evaluates cold, and compares its frame with the
  recorded context. Probes are kept as this oracle, not as the mechanism.

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
- Refusals carry a reason, which actions pass through: singular axes, a
  rotation the frame cannot express, a loop-dependent context.

### Bounds

`\useasboundingbox` sits in the picture body, so it has a site: the gap
context before the first statement. PGF transforms each path point to canvas
before growing the picture box (`\pgfpathmoveto` → `\pgfpointtransformed`,
then `\pgf@protocolsizes`). A `rectangle` between two inverse-mapped corners
is therefore a rotated rectangle under a rotated or skewed frame, and its
canvas hull is larger than the requested box. So:

- if the context's linear part is diagonal (identity, scale, flip, axis
  lengths), write `(x₁,y₁) rectangle (x₂,y₂)`;
- otherwise write the four inverse-mapped corners,
  `(p₁) -- (p₂) -- (p₃) -- (p₄) -- cycle`, whose canvas hull is the box;
- `readBounds` parses both forms through the same context, replacing
  `parseCoordinateComponentCm`, which reads unitless numbers as centimetres.

### Rotation

A path option `rotate` multiplies onto the CTM after the axes: canvas =
parent · R · axes · c. That is a world rotation when the parent's linear part
is conformal; under a reflection the angle flips sign. Under a non-conformal
parent (`xscale=2` scope) the writer refuses with a reason. Baking the
rotation into coordinates instead needs its own design (curves, shapes, node
text, dependencies).

### Positioning

`node-placement` follows PGF: `tikzlibrarypositioning.code.tex` applies the
distance with `\pgftransformshift` during node placement, after
non-translations are reset unless `transform shape` is set. Verified with
pdflatex: `right=1cm of A` leaves a 1cm canvas gap under `scale=2` and
`rotate=90`, and the node's own `rotate=-35,xshift=3mm` moves it. Unitless
distances (`right=1 of A`) go through `\pgfpointxy`, i.e. the axes.

## Failure classes, mapped

| class | fix |
|---|---|
| 1. world cm as source units | insertPathPoint, convert-to-absolute: `writer.point` at an `in-statement` site; figure bounds: `writer.bounds`/`readBounds`; center-pivot rotation: corners via `writer.point`, angle via `writer.rotation` |
| 2. offsets in a bare picture | `writer.offsetStatement` replaces `getOffsetPreparation` and `translateSingleStatementSnippet`: the copy's gap context, not a fresh picture; the original's handles plan the offset only when the contexts match. Repeat steps go through `writer.vector`; positioned nodes through `writer.positioning` |
| 3. new coordinates ignore axes and scopes | insertion actions take world points, written at the gap or target-statement context. A core `addPath { start, segments, closed, style }` replaces app-side path and freehand string generation; `appendToPath` takes world segments. The app's `*InPictureCoordinates` mappings are deleted |
| 4. positioning | drags and `positionNodeRelativeTo` use `writer.positioning`, choosing the direction from the local delta. Aligning `A` with a node positioned from `A` is a move-planning bug (dependents move with `A`), tracked separately |
| 5. relative coordinates in rewritten paths | restructuring actions compute anchors' world positions and re-spell each one at its new place: `writer.point` for absolute, `writer.vector` from the new predecessor for `+`/`++` |

## Product decisions

| question | decision |
|---|---|
| spelling of new coordinates | preserve when editing; new coordinates unitless, always |
| paste across scopes | two intents. Canvas copy/paste keeps the visual geometry, then applies the paste offset (`offsetStatement` into the destination gap). Pasting raw TikZ keeps its text (`userText`) |
| rotation in non-conformal frames | refuse with a reason for now |
| assistant coordinates | structured placement tools state world units explicitly; raw TikZ from the assistant is source text. Check the existing tool contracts before changing behavior |

## Gates

- **Fuzzer, per case.** `expected-outcomes.json` records the outcome of all
  1650 cases (`ok`, `partial`, `unsupported: reason`, `error`, `fail: class`).
  Any difference fails the test. Recording (`POINTER_FUZZ_UPDATE=1`, full
  run, seed 1) prints every transition and refuses regressions unless
  `POINTER_FUZZ_ACCEPT_REGRESSIONS=1`. Partial results are checked like full
  ones; errors are failures. CI runs every frame (`POINTER_FUZZ_FULL=1` on
  the `npm test` step); local `npm test` runs the quick subset. Other seeds
  may change refusals but not add failures.
- **Checker exceptions, fingerprinted.** One entry per violation: rule id,
  file, enclosing declaration, and a hash of the normalized offending
  expression. Line moves don't change it; replacing one violation with
  another does, and fails. The list only shrinks, with the same
  print-and-refuse update as the fuzzer.
- **Capture oracle** and the **compute differential fuzzer** cover the
  contexts.

## Migration

0. **Harness hardening.** Done: real node-resize checks, partial and error
   results, per-case outcomes, full run in CI.
1. **Site contexts in the evaluator.** Capture points, raw context on
   handles, option resolution on a gap context; capture oracle; contexts in
   the differential comparison. No behavior change.
2. **Fragment layer and checker.** `TikzFragment`, `EditedSource`,
   constructors, typed scalar writers; F1–F3 with every current violator in
   the fingerprinted exception list; negative fixtures. From here on, new
   code cannot add a raw coordinate write.
3. **Writer core.** On site contexts; port `rewrite.ts`/`frame-coordinate.ts`
   (already correct) with no behavior change.
4. **Class 1**, then **class 3** (world insertion, `addPath`, delete the app
   pre-mapping), then **class 2**, then **classes 4 and 5**. Each phase
   records its improvements with the fuzzer update and shrinks the
   exception list.
5. **Remaining writers.** Radii and other frame-dependent lengths (after
   adding circle/ellipse resize cases), SVG import, assistant handlers,
   semantic-internal source (`fit`, `tree-child`, `label-quotes`) or audited
   exceptions. Done when the exception list is empty.

Cost to measure before phase 4: memory of the recorded contexts, and the
time of insertion, paste and repeat in large documents, including cold
checkpoint preparation. Paper-drag profiling does not exercise these paths;
add profiling specs for them in `apps/web/profiling/`.

The fuzzer grows with the design: a singular frame expecting `unsupported`,
a `transform shape` node, a mid-picture `\tikzset{x=2cm}` before the
insertion site, points inserted after a mid-path `[rotate=…]`, paste into
another scope, circle and ellipse resize.
