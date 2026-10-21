# Coordinate writes: inventory and pointer invariant

Goal: ordinary editing code cannot write a coordinate into source except
through one writer that resolves the frame and serializes the result; the
writer's correctness is checked by a pointer-invariant fuzzer. This document
is step 1 (inventory) and step 5 (fuzzer) of that plan. The writer designed
from the failures below is in [coordinate-writer.md](coordinate-writer.md).

Trigger: dragging a named endpoint (`(B)`) in a picture with `x=2cm,y=1.6cm`
made it jump. The detach path in `rewriteUnsupportedCoordinate` wrote
`ptToCm(world)` as unitless numbers, which TikZ reads as multiples of the axis
vectors. Branded types did not object: scalar brands carry a unit (`Pt`), not
a space, and the formatters take plain `number`/`string`.

## Pointer-invariant fuzzer

`test/pointer-invariant/`. `npm test` runs a quick subset (5 frames, one per
mechanism: identity, picture axis units, picture scale, scope rotation,
everything stacked; under a second). `npm run test:pointer-fuzz` (or
`POINTER_FUZZ_FULL=1`) runs all 13 frames, 1788 cases, in about two seconds.

- Every case renders a picture, applies one edit, re-renders, and checks
  where the edited geometry is:
  - edits with a world-space input (drags, insertion, offsets, rotation,
    figure bounds) must put the geometry at that world position;
  - edits without one (reverse, point kind, relative/absolute positioning)
    must leave the geometry where it was;
  - no edit except align may move the untouched node `A`.
- Frames: picture `x=`/`y=` lengths, skewed axis vectors, `scale`,
  `yscale=-1`, `shift`; scope rotate+shift, scope units; path
  `xscale/yscale`, path `x=`, path rotate+shift (a node's own transform),
  a transforming `every path` style; all stacked. An empty scope is left out
  of the source, because some actions refuse scoped paths.
- Bodies: cartesian, dimensioned, mixed units, polar, relative (`++`/`+`),
  curve, rectangle, circle, node, named endpoint, calc, `to[bend]`,
  positioning (`right=of A`).
- Tolerance comes from the frame: two decimals in source units, measured from
  the actual unit and centimetre vectors there.
- Deltas are seeded per case key, so adding cases never reshuffles others.
- Node resize checks the dragged corner and the fixed center (the editor
  resizes nodes symmetrically); nodes with their own `rotate` get no resize
  case, since their world bounds are not their box.
- Drags (`moveHandle`, `moveElements`, `resizeElement`) run against a geometry
  session as in the app, with snapping bypassed; one-shot commands do not.
- Insertion (`addElement`, path tool, freehand, `appendToPath`) goes through
  the app's own `worldToPictureCoordinates` mapping and source generators, so
  it tests what the user gets.

Gate: `expected-outcomes.json` records the outcome of every case (`ok`,
`partial`, `unsupported: reason`, `error`, `fail: class`), so a case that
worked cannot quietly become unsupported. Any difference fails the test.
`POINTER_FUZZ_UPDATE=1` (full run, seed 1) prints every transition and
refuses regressions unless `POINTER_FUZZ_ACCEPT_REGRESSIONS=1`. Partial
results are checked like full ones; errors count as failures. CI runs every
frame (`POINTER_FUZZ_FULL=1` on its `npm test` step). Other seeds may change
refusals but must not add failures; seeds 1–8 agree.

Mutation check: with the pre-fix `rewrite.ts`/`edit-handles.ts`/`types.ts`,
`moveHandle` fails 10 more cases (named endpoint under every non-identity
frame).

## Results (full run, seed 1)

1788 cases: 1140 ok, 31 partial (checked, passed), 328 fail, 289 unsupported,
0 errors.

| action | ok | partial | fail | unsupported |
|---|---|---|---|---|
| moveHandle | 388 | 0 | 2 | 0 |
| moveElement(s) | 141 | 26 | 2 | 0 |
| resizeElement (top-right, bottom-left) | 48 | 0 | 0 | 0 |
| alignElements (left, top) | 277 | 0 | 14 | 47 |
| duplicateElements | 58 | 5 | 106 | 0 |
| repeatElements | 41 | 0 | 63 | 0 |
| insertPathPoint | 7 | 0 | 56 | 28 |
| reversePath | 63 | 0 | 9 | 71 |
| setPathPointKind | 36 | 0 | 9 | 20 |
| rotateElement (center pivot) | 11 | 0 | 5 | 101 |
| positionNodeRelativeTo | 8 | 0 | 3 | 2 |
| convertNodePositionToAbsolute | 9 | 0 | 4 | 0 |
| appendToPath | 20 | 0 | 25 | 20 |
| addElement | 24 | 0 | 18 | 0 |
| path tool | 4 | 0 | 3 | 0 |
| freehand | 4 | 0 | 3 | 0 |
| setFigureBounds | 1 | 0 | 6 | 0 |

### Failure classes (328 cases)

1. **World cm written as source units, no frame** (63: `insertPathPoint`,
   `convertNodePositionToAbsolute`, `setFigureBounds`, center-pivot
   `rotateElement`). Each converts world points with `* CM_PER_PT` and writes
   them unitless.
   - `path-editing-actions.ts` `applyInsertPathPointAction` (local
     `formatPt`): every non-identity frame.
   - `node-positioning-actions.ts` convert: writes `at (1.49,1.6)` under
     `x=2cm`; passes under `scale` and `shift`, so it applies the transform but
     not the axis vectors.
   - `figure-bounds.ts`: the inspector shows `scene.bounds` in world cm and
     writes them back unitless, so they double under `x=2cm` or `scale=2`. The
     reader (`parseCoordinateComponentCm`) makes the same assumption the other
     way round.
   - `rotate-element.ts` center pivot: the recentered rectangle corners come
     out in cm (`(0,0) rectangle (1.5,1)` becomes 3 units wide under `x=2cm`).
     Under `yscale=-1` the angle sense is not flipped either.
2. **Offsets planned in a bare identity-frame picture** (139:
   `duplicateElements`, `repeatElements`). `paste-duplicate.ts`
   `getOffsetPreparation` and `repeat.ts` `translateSingleStatementSnippet`
   wrap the snippet in a fresh picture, plan the offset there, and insert the
   result into the real picture/scope. Path options travel with the snippet,
   so duplicate passes path-level frames; repeat does not.
3. **New coordinates ignore axis vectors and scopes** (36: `addElement`, path
   tool, freehand, `appendToPath`). `element-templates.ts` and
   `freehand-tool.ts` `formatPointCm` write `point.x * CM_PER_PT` unitless.
   The app compensates in `picture-coordinates.ts` by inverting
   `scene.rootTransform`. That handles `scale`/`shift`/`yscale=-1`, but `x=`/`y=`
   axis vectors are not part of `rootTransform`, and `appendToPath` targets a
   path inside a scope whose transform is not inverted at all. Note the
   laundering: `worldToPictureCoordinates` returns picture-local points still
   typed `WorldPoint`, and core's `addElement.at: WorldPoint` really means
   picture-local. Example: a node clicked at world (1cm,1cm) under
   `[x=2cm,y=2cm]` should be written `at (0.5,0.5)`; it is written `at (1,1)`
   and lands at (2cm,2cm).
4. **Positioning nodes** (29):
   - duplicate adds `at (…)` to a `right=of A` node, and `right=of` wins, so
     the copy sits on the original (12, every frame);
   - drags and moves ignore the node's own `rotate`/`xshift` options (4,
     `path-rotate-shift` and `stacked`);
   - align top of `A` with a node positioned from `A` moves `A`, which moves
     the node again (13, most frames);
   - `positionNodeRelativeTo` picks `right=` from source coordinates when the
     nodes differ in world y (3, scope units and node transforms).
5. **Relative coordinates lost when a path is rewritten** (16: `reversePath`,
   `setPathPointKind` on `(0,0) -- ++(1,.5) -- +(0,1)`). Not a frame bug: the
   last point becomes `(0,1)` instead of `(1,1.5)`, in every frame.

## Inventory of programmatic coordinate writes

### Core edit actions

| action | implementation | frame handling | status |
|---|---|---|---|
| moveHandle | `rewrite.ts` `rewriteCoordinate` (+ `rewrite-calc.ts`, `frame-coordinate.ts`) | handle `frame` / `detachFrame`; positioning via `rewritePositioning` | pass, except positioning under node transforms (class 4) |
| moveElement(s) | `move-arrange-actions.ts`, `center-pivot-move.ts`, `calc-move.ts` | per-handle frames via `rewritePreciseFrameCoordinate` | pass, except positioning under node transforms (class 4) |
| alignElements | `move-arrange-actions.ts` → moveElements | as moveElements | pass, except positioning dependency (class 4) |
| distributeElements | `move-arrange-actions.ts` → moveElements | as moveElements | not fuzzed (same machinery as align) |
| resizeElement | `resize-element.ts` (7 raw `CM_PER_PT`) | local transform for rectangles | pass for rectangle corners; edges, circles, ellipses, node sizes not checked |
| rotateElement | `rotate-element.ts` | `rewritePreciseFrameCoordinate`; recentered corners in cm | fails (class 1); only rectangles/circles/ellipses supported |
| addElement | `element-templates.ts` `generateElementSource` | none in core; app inverts `rootTransform` | fails (class 3) |
| pasteStatements / duplicateElements | `paste-duplicate.ts` | offset planned in identity frame | fails (classes 2, 4) |
| repeatElements | `repeat.ts` | step planned in identity frame | fails (class 2) |
| insertPathPoint | `path-editing-actions.ts` | none | fails (class 1); refuses scoped paths and paths with options |
| reversePath / setPathPointKind | `path-editing-actions.ts` | n/a (rewrites existing text) | fail on relative (class 5); refuse scoped paths and paths with options |
| appendToPath | `path-editing-actions.ts`, source from the app path tool | app inverts `rootTransform` only | fails (class 3); refuses paths with options |
| positionNodeRelativeTo | `node-positioning-actions.ts` | world anchors, direction from source | fails (class 4) |
| convertNodePositionToAbsolute | `node-positioning-actions.ts:783` | `worldToLocal` + `localToSourceUnits` without axis vectors | fails (class 1) |
| setFigureBounds | `figure-bounds.ts` | none | fails (class 1) |
| splitPath / joinPaths / deletePathPoint / toggleClosedPath | `path-editing-actions.ts` | reorder existing text | not fuzzed (likely class 5 on relative coordinates) |
| moveAdornment | `adornment-actions.ts` | writes label angle/distance | not fuzzed: the expected label position under scaled/rotated frames needs a PGF check first |
| movePathAttachedNode | `path-attached-node-actions.ts` | takes `pos`, not a world point | out of scope (the app converts pointer to `pos`) |
| connectHandle | `actions.ts` | writes a node reference, no numbers | out of scope |

### App-side source generation

| site | what it writes | status |
|---|---|---|
| `canvas-panel/freehand-tool.ts` `formatPointCm` | freehand curves | fails (class 3) |
| `canvas-panel/path-tool.ts` → core `generateComplexPathSource` | path tool statements and appended segments | fails (class 3) |
| `CanvasPanel.tsx` → `templateInPictureCoordinates` | addElement preprocessing | fails (class 3) |
| `svg-import-clipping.ts` | coordinates from imported SVG | not fuzzed |
| `assistant-tool-handlers.ts` (27 raw pt/cm constants) | assistant-generated statements | not fuzzed; intended semantics (world or source units) to decide first |

### Synthesized source inside semantic evaluation

`semantic/nodes/fit.ts`, `semantic/path/tree-child.ts`,
`semantic/path/label-quotes.ts` build coordinate text for internal
evaluation, not for the user's file. They need a separate decision: either
the writer serves them too, or they are listed as audited exceptions.

## What the failures say about the writer

- Most failures need no new math: the frame is already known (handles carry
  `frame`/`detachFrame`, and the evaluator knows every statement's frame).
  The bugs are in callers that skip it, plan in a stand-in frame, or apply
  part of it (`rootTransform` but not the axis vectors).
- Insertion needs the frame of an insertion site, not of a handle: the
  picture for new statements, the target path's frame for `appendToPath`, the
  original statement's frame for duplicate/repeat. The writer API should take
  a site, and core actions should take real world points; the app's
  `worldToPictureCoordinates` pre-mapping should go away.
- Offsets (duplicate, repeat, align, distribute) are world vectors and need
  the frame's linear part only.
- Positioning distances are dimensions in a frame of their own (the node's
  transform), which the writer has to resolve separately from coordinates.

## Existing enforcement to build on

`scripts/check-coordinate-typing.mjs` already runs in `npm run typecheck`. It
uses the TypeScript compiler API (type-aware) over `core/src/{coords,semantic,
svg,edit,geometry,text}` and `app/src/ui/{coords,canvas-panel}`, and bans
unsafe constructors, vector-as-point aliases, raw branded object literals, and
direct assertions to TeX coordinate / source-offset types. The writer-boundary
rules (who may call coordinate serialization, coordinate-shaped template
literals, unbranded point-shaped parameters) belong there, not in ESLint.

## Not covered yet

- Actions marked "not fuzzed" above, SVG import and the assistant handlers.
- Scoped and path-option frames for insertPathPoint, reversePath,
  setPathPointKind and appendToPath (they refuse those paths).
- Curve-control (`to[bend]`) handles; resize edges and non-rectangle shapes.
- Side effects within the edited element (relative successors) are not
  checked; only the separate node `A` is.
