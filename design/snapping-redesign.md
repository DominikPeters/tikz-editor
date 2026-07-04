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

## License notes

- Excalidraw (incl. PR #11316): MIT — may copy code.
- tldraw: source-available, non-OSI custom license — design reference only, no code.
- Penpot: MPL-2.0; Graphite: Apache-2.0 — summarized designs only; we implement the
  math ourselves.
