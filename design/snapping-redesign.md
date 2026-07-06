# Snapping Redesign

Research and design notes for fixing "snap lines with no obvious explanation" during drag.
Compiled 2026-07-04 from source-level review of our implementation plus four reference
codebases (Excalidraw, tldraw, Penpot, Graphite).

## Current implementation and its lineage

Our snapping (`packages/core/src/edit/snapping/`) is a port of **Excalidraw's**
`snapping.ts` (MIT): same `GapSnapDirection` values, same `visibleGaps` all-pairs
construction, same corners+center point model, same 8px threshold. The confusing
behavior is inherited, not introduced by the port. Upstream context:

- Object snapping landed in Excalidraw PR #6256 (Sept 2023); all-pairs gap snapping was
  a deliberate day-one design. `VISIBLE_GAPS_LIMIT_PER_AXIS = 99999` (our
  `maxPairsPerAxis: 100000`) carries a `TODO increase or remove once we optimize` and
  has been a no-op ever since. Core algorithm unchanged since 2023. Snapping ships
  off-by-default in Excalidraw.
- **PR #11316** ("refactor(editor): simplifies snaplines", ryan-di, opened 2026-05-11,
  still open/unreviewed as of this research) is the original co-author's attack on
  point-snap-line noise. MIT — we can borrow from it directly. It does NOT touch the
  gap-snap engine.

## Diagnosed problems (ours)

1. **Non-adjacent gap pairs.** `buildVisibleGaps` builds equal-spacing candidates for
   every pair of reference boxes with space between and cross-axis overlap — including
   pairs with other elements *inside* the gap. Matrices amplify it (each cell and the
   whole matrix contribute bounds).
2. **Loose snap geometry.** Everything snaps via bbox corners+center of merged bounds;
   `pathBoundsInWorld` includes Bézier control points and crude arc extents, so the
   points being lined up may correspond to nothing visible.
3. **Role mixing.** Any of the 5 selection points may snap to any of the 5 reference
   points — corner↔center alignments read as arbitrary. `SnapPoint.role` exists but is
   never consulted; selection points lose role info in `selectionSnapPointsFromBounds`.
4. **Undifferentiated, over-complete rendering.** Second pass at threshold 0 draws every
   coincidental alignment; one color/style for all kinds; grid/guide snaps draw nothing;
   point-snap lines are short segments with crosses rather than full-span guides.

## How the references handle each problem

### Gap / equal-spacing snapping

| Tool | Approach |
|---|---|
| Excalidraw | All pairs, cross-axis overlap only. Unfixed; even PR #11316 leaves it. |
| tldraw | All pairs too (verified in `BoundsSnaps.ts` `getVisibleGaps()`); compensates at the *indicator* layer: `findAdjacentGaps()` renders chains of equal-length gaps, `dedupeGapSnaps()`. |
| Penpot | Directional half-plane regions around the selection (`get-areas` → left/right/top/bottom), then **all pairs within a region** (`d/map-perm`) with cross-axis overlap filter; noise suppressed by displaying only the single smallest matching distance. Range trees used for matching. |
| **Graphite** | **The only true adjacency model** (`distribution_snapper.rs`): bucket candidates into 4 directional sets, sort along the axis by center, test **consecutive neighbors only**; extend matches into chains recursively (depth-capped ~8–10, tolerance scaled with depth); `merge_intersecting()` collapses overlapping/nested rects first; candidates capped by viewport extent. |

**Decision: adopt Graphite's model.** Sort per axis, consecutive-neighbor pairs only,
merge intersecting/nested reference bounds first (this also neutralizes the
matrix-cells-plus-matrix noise). Reduces O(n²) to O(n log n) as a side effect.

### Snap geometry / tight bounds

- **Penpot is the only reference with tight Bézier bounds**: `content->selrect` calls
  `calculate-curve-extremities`, which solves the cubic's first-derivative roots and
  evaluates the curve at critical t — exact extrema, not control-point hull. (Graphite
  uses Kurbo's hull-based `bounding_box()`; Excalidraw/tldraw loose.)
- **tldraw's architectural idea**: per-shape snap geometry override
  (`getBoundsSnapGeometry()` / `BoundsSnapGeometry`) instead of one-size-fits-all bbox.
- **Graphite** additionally snaps to real curve geometry (anchors, segment midpoints,
  intersections, tangents/normals) — attractive long-term for a TikZ editor where paths
  are first-class, independent of bboxes.

**Decision:** implement derivative-root tight bounds for cubics and proper arc extrema in
`geometry.ts` (standard math, write ourselves); introduce a per-element snap-geometry
hook so element kinds can expose meaningful points (circle quadrants, path endpoints)
rather than bbox corners.

### Role typing (corner vs center)

- Graphite types sources/targets as enums (`BoundingBoxCornerPoint`,
  `BoundingBoxCenterPoint`, `BoundingBoxEdgeMidpoint`, …) — corner↔center mixing is
  structurally impossible.
- Excalidraw PR #11316 arrives at the same idea independently: `SnapPoint` with
  `type: "outer" | "center"` plus `snapSourceId` keyed on the element pair;
  `isRedundantCenterSnapLine` (hide center guide when edge guides from the same pair
  bracket it); `isRedundantOuterSnapLine` (keep only the two extreme edge guides per
  pair).

**Decision:** tag roles on both sides (we already have `SnapPoint.role`; thread it
through selection points), match like-with-like, and borrow #11316's redundancy
suppression rules (MIT).

### Candidate selection among ties / far-away winners

- Excalidraw PR #11316: `filterPointSnapsToNearestCluster` — group candidates by visual
  distance, prefer the near cluster over a distant element that wins on offset math by a
  hair (`SNAP_REFERENCE_CLUSTER_BREAK_DISTANCE = 200`, zoom-scaled); float-tolerance
  grouping (`SNAP_OFFSET_TOLERANCE`) to stop flicker between candidate sets.
- Graphite: explicit ordered pipeline with typed tie-breaking (path > intersection >
  bbox; alignment ties broken by distance-to-target) rather than pure nearest-wins.

**Decision:** adopt nearest-cluster preference and kind-priority (element points >
guides > grid at equal offset — currently implicit via push order, make explicit).

### Rendering / explainability

- **Penpot** (clearest grammar): three visually distinct languages — crosses + short
  accent connector lines for point alignment, with synthesized **full-span lines through
  all shapes sharing the coordinate** (`process-snap-lines`); finite **measurement
  segments with tick ends and a numeric pill label** (formatted distance) for gaps;
  visually separate persistent ruler guides.
- **Graphite** (most explicit): every snap source/target has a `Display` name; overlay
  renders a **text label "‹target› from ‹source›"** above the snap point, highlights the
  snapped-to element's outline, draws a marker at the snap point.
- **tldraw**: coordinate-grouped full-span indicator lines; equal-gap chains via
  `findAdjacentGaps` so spacing indicators read as "these N spacings are equal".

**Decision:** distinct visual grammar per snap kind; full-span alignment lines grouped by
coordinate; numeric distance labels on gap segments; distinct style for center vs edge
alignment; cap coincidental second-pass lines (nearest cluster only). Optional/later:
Graphite-style text label naming the snap, and/or highlighting the snapped-to element.

### Performance note

Penpot maintains per-page/per-axis red-black range trees in a web worker
(`frontend/src/app/util/range_tree.js`, `worker/snap.cljs`) with incremental updates,
plus a quadtree (`util/quadtree.js`, `worker/selection.cljs`) that narrows candidates to
shapes spatially near the selection before any pairwise work. Overkill for us now;
adjacency + per-axis sorted arrays remove the O(n²) pressure. Range trees are the
fallback if scenes get large.

## Implementation plan

Status (2026-07-04): Phases 1 and 2 implemented and verified (unit tests in
`test/edit-snapping*.spec.ts` plus live drag verification in the web app).
Phase 3 remains open.

Phase 1 — core correctness (contained, testable in `packages/core`):
1. Adjacent-only gaps with pre-merge of intersecting reference bounds
   (`gap-snaps.ts`, `context.ts`).
2. Tight Bézier/arc bounds (`geometry.ts`).
3. Role-tagged snap points, like-with-like matching, kind priority + nearest-cluster
   tie-breaking (`point-snaps.ts`, `types.ts`, `index.ts`).

Phase 2 — rendering (`packages/app` overlays):
4. Full-span coordinate-grouped alignment lines; center-vs-edge styling; gap measurement
   segments with distance labels; redundancy suppression (#11316 rules); cap
   coincidental lines.

Phase 3 — optional depth:
5. Per-element snap geometry hook (circle quadrants, path endpoints/anchors).
6. Snap-explanation label and/or snapped-element highlight (Graphite-style).

## Snap labels (Phase 3, implemented for named elements)

Research (Opus agent over our own codebase, 2026-07-04): the only good per-element
naming sources are (a) explicit TikZ node/coordinate names — surfaced via
`snapshot.semanticResult.nodeAnchorTargets` (`nodeName` + `nodeSourceId`), which covers
exactly the named elements that can appear as snap references, since bare
`\coordinate`s render no scene element — and (b) the Objects panel's generic kind
vocabulary (`deriveStatementLabel` in `packages/app/src/ui/objects-panel/model.ts`),
which does not disambiguate same-kind shapes and is not worth a pill.

Decision: label only when a snap line's references resolve to **exactly one element
with an explicit name**. Implementation: snap candidates and `SnapLine` carry reference
`sourceIds`; `CanvasPanel` memoizes a `sourceId → name` map from `nodeAnchorTargets`;
`SnapOverlay` renders an "edge · foo" / "center · foo" pill (name only for pointer
snaps) beyond the line end. Grouped lines merging several references stay unlabeled by
design — the full-span line is the explanation there.

## Overlay lifecycle: flicker, and the derived-state design

Symptom: snap lines vanish momentarily whenever a drag's own edit lands, because
`CanvasPanel` clears `snapLines` on any `snapshot.source !== source` transition — a
guard meant for external edits that also fires for the drag's own applies.

**Implemented (cheap fix):** skip the clear while `dragRef.current` is an active drag;
the next pointermove overwrites the lines anyway. External edits (typing in the source
panel) still clear.

**Full version (not implemented): snap lines as derived state.** Treat the overlay as
`lines = f(activeDrag, scene, zoom)` recomputed on every snapshot recompute, instead of
imperative `setSnapLines` calls sprinkled across ~10 sites. What it buys beyond flicker:

1. **Dependent-element correctness.** `drag.snapContext` is frozen at drag start; in
   TikZ, moving an element can relocate dependents (paths referencing named nodes,
   relative coordinates), whose *old* positions remain snap targets mid-drag — the
   "inexplicable line" failure mode reintroduced via staleness. Rebuilding the context
   per recompute fixes it.
2. **Self-chasing dependents.** Dependents are not in `selectedSourceIds`, so today they
   are valid snap references even though they move with the drag (approach a target and
   it moves away). Any rebuild design must exclude drag-dependent elements via the
   semantic dependency graph (`packages/core/src/semantic/dependencies.ts`) — worth
   doing even without the rest.
3. **Mid-drag zoom coherence.** Threshold (`thresholdPx / zoom`) and viewport reference
   filtering are computed at drag start; scroll-zoom mid-drag leaves both stale.
4. **Consolidation/testability.** One derivation point replaces ~10 imperative
   clear/set sites (each tool finalizer must currently remember to clear) and is unit-
   testable as a pure function.
5. **Feedback beyond pointer drags.** Keyboard nudges (`snapKeyboardNudge` returns
   `lines: []` today), paste placement, and tool previews could reuse the same
   derivation for free.

Suggested implementation order: (a) dependent-exclusion in `buildSnapContext` input
(correctness, independent of the refactor); (b) a `deriveSnapLines(dragState, snapshot,
canvasTransform)` selector used by an effect that refreshes lines on snapshot
recompute while a drag is active; (c) migrate the imperative call sites tool by tool.

**Measuring the performance impact** before/while doing (b):

- Cost centers: `buildSnapContext` (reference bounds + points + `buildVisibleGaps`) per
  recompute, and `snapSelectionTranslation` per pointermove. Adjacent-only gaps already
  cut gap building from O(n²) pairs to roughly O(n·k) with blocker scans.
- Use the existing in-app profiling: the status bar perf HUD (fps / p95 / max drag ms)
  and the dev test API's `resetProfilingSession()` / `getProfilingSnapshot()`
  (`packages/app/src/profiling.ts`) — record a scripted drag (the synthetic
  pointer-event driver used for verification works headlessly) before/after on the same
  scene and compare p95 drag-frame times.
- Add a `vitest bench` for the core pipeline: synthetic scenes of 100 / 500 / 2000
  elements (grids of rects, plus a matrix-heavy case), measuring `buildSnapContext` and
  one `snapSelectionTranslation` call. Budget: context rebuild under ~8ms at 500
  elements (one 120Hz frame); if exceeded, patch reference bounds incrementally by
  changed `sourceIds` (the recompute already reports `lastEditChangedSourceIds`) rather
  than rebuilding from scratch.
- Watch the degenerate cases: many overlapping bounds make `mergeIntersectingBounds`
  quadratic (repeated `findIndex`); if benches show it, swap to a sweep by sorted minX.

## License notes

- Excalidraw (incl. PR #11316): MIT — may copy code.
- tldraw: source-available, non-OSI custom license — design reference only, no code.
- Penpot: MPL-2.0; Graphite: Apache-2.0 — summarized designs only; we implement the
  math ourselves.
