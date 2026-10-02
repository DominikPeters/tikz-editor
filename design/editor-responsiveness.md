# Editor responsiveness

## Findings and changes

The source editor used a full render after its debounce, even when a canvas edit
of the same statement could use the incremental pipeline. Ordinary source edits
now infer a transition from the last completed parse. This handles skipped
revisions and coalesced keystrokes without depending on the latest keystroke's
patch. Parsing, semantic invalidation, and SVG reuse consume the same transition.

The parser falls back to a full parse for structural changes, edits outside a
known statement, and incomplete syntax it cannot safely reuse. Full parser
fallback also resets semantic reuse. Switching documents resets the cached
sessions. Existing debounce durations are unchanged.

Other work removed from the editing path:

- SVG padding uses the render's existing AST instead of parsing the source again.
- Document classification skips TeX syntax indexing when `\documentclass` is
  absent. Graphics resource discovery does the same for `\includegraphics`.
  Possible matches still use the grammar, including its comment handling.
- Beamer readers share the existing cached syntax index for unmasked source.
- Property targets and fit checks use an index owned by the parse result.
  Drag eligibility indexes rewrite targets and source spans once per scene.
- Flattening a persistent semantic map builds only the requested version.
  Previously it copied a complete map for every ancestor checkpoint. Lookup
  chains are bounded before materializing the requested version.
- Named color analysis reads a consistent source/tree pair from the completed
  snapshot. It does not request a full syntax tree when no color declarations
  are present.
- Canvas updates parse changed SVG parts in one XML document. Their existing
  DOM sibling links provide ordering directly, removing a full array copy and
  search for each changed part. Unchanged elements keep their DOM identity.

## Correctness of reused source data

Changing a label's length shifts all later source offsets. Reusing geometry is
safe only when editing APIs still resolve the correct source. The initial work
reprojected retained text measurements and regenerated affected SVG metadata.
The source binding refactor below removes that repeated layout/markup work for
unchanged direct text while preserving each snapshot's source interpretation.
Incremental parse results also expose a lazily rebuilt, current syntax tree
rather than the previous revision's tree.

## Measuring source editing

`apps/web/profiling/profile-source-typing.spec.ts` covers:

1. A short typing burst in a two-statement figure.
2. The same burst with 120 nodes.
3. Inserting a path label with 400 nodes and pauses long enough for previews.
4. Editing an existing label with 400 nodes and the same pauses.

The last two cases distinguish structural/incomplete syntax fallbacks from
steady incremental label editing. The probe records compute stages and work
counts, frame intervals, long tasks, and keydown-to-next-animation-frame time.
That last value is a responsiveness proxy, not a browser paint or INP metric.
The probe measures hit-region layout only at the beginning and end; scanning it
on every DOM mutation had added forced layout to the workload being measured.

Use a production build, one browser worker, and matching browser/build settings
for comparisons. Preserve each report and CPU profile before the next run;
scenario outputs use fixed names. Compare both timings and work counts, because
other builds and memory pressure on the host can dominate wall-clock results.

## Initial responsiveness results, October 2, 2026

Compared the baseline at `e3949988` with these changes using isolated source
copies, holding unrelated working-tree edits constant. Both used a production
profiling build with function names retained, no source maps, installed Chrome,
and one Playwright worker. The table reports the median of three runs' median
compute times. No test or build jobs from this task ran during measurements.

| Source edit | Before | After |
| --- | ---: | ---: |
| Short burst, 2 statements | 5.5 ms | 5.7 ms |
| Short burst, 120 nodes | 52.6 ms | 39.4 ms |
| Paused path-label insertion, 400 nodes | 163.2 ms | 94.0 ms |
| Paused existing-label edit, 400 nodes | 162.5 ms | 79.7 ms |

For the existing-label case, median SVG patch time fell from 26.1 to 14.3 ms.
The median of the runs' 95th-percentile frame gaps fell from 266.6 to 116.7 ms;
the keydown-to-frame proxy fell from 33.6 to 23.3 ms. Small figures were roughly
unchanged. Host load varied, so these are observed improvements on this machine,
not latency guarantees.

Work counts explain the difference independently of timing:

- All 22 existing-label edits reparsed and reevaluated one statement, reusing
  400 statements. The baseline performed full renders. Parse calls fell from
  44 full-figure calls to 22 statement-snippet calls.
- Structural path-label insertion still used full fallback where necessary;
  15 of its 32 preview updates used incremental evaluation.
- A DOM regression test verifies that changing 101 parts requires one XML parse
  and keeps an unchanged reordered element's identity.
- A checkpoint regression test verifies that flattening 500 accumulated entries
  retains only the requested materialization instead of all 500 prefix maps.

## Separate source bindings from reusable layout

The next change removes deep scene cloning from incremental fragment reuse.
Scene elements and handles retain small envelopes with current source bindings;
path commands, points, transforms, and resolved styles remain shared. The source
binder visits only source metadata, including foreign style definitions and
option spans. Generated identity coordinates remain in their expansion's frame.

A validated set of edit patches maps the preceding source into the next source.
The current AST supplies authored statement boundaries. Callers without patches
use a single replacement computed from the two complete sources; an ambiguous
overlap falls back to replay. Statement text is never searched to recover its
location, so identical statements stay distinct. This is an eager transition;
there is no accumulating chain of offset maps.

Native text entries now separate a source map from an immutable local layout and
SVG payload. Rebasing an unchanged label updates its source map without measuring
or rendering it again. Its visual key and paragraph identity remain stable.
Caret and selection reports are resolved through the snapshot's layout context
only when requested. A direct paragraph lookup avoids projecting all labels when
editing one. Each retained snapshot owns its bindings independently, and cached
projections share the lifetime of their entries through weak maps.

The canvas explicitly requests SVG with paragraph-local source coordinates.
Unchanged text therefore keeps its glyph DOM through source-length edits. The
coordinate space is marked on the SVG. Default/export rendering continues to
produce document-coordinate metadata. Macro/generated projections that can split
text segments retain document-coordinate rendering; foreign macro rebasing still
uses semantic replay. Embedded graphics retain current document source bindings.

Regression coverage checks repeated identical statements, multiple patches,
insertion boundaries, shared path geometry, unchanged native SVG payloads,
current and previous caret reports, export coordinates, and canvas typing/undo.

## Source binding measurements, October 2, 2026

Compared an isolated snapshot from before this refactor with the same snapshot
plus the production changes, keeping unrelated work fixed. Both builds used the
same production profiling configuration, installed Chrome, no source maps, and
one browser worker. Three runs per build covered all four existing typing
scenarios. Builds and tests were stopped during measurement. The table gives the
median of each run's median compute duration.

| Source edit | Before | After |
| --- | ---: | ---: |
| Short burst, 2 statements | 5.6 ms | 5.9 ms |
| Short burst, 120 nodes | 42.5 ms | 39.0 ms |
| Paused path-label insertion, 400 nodes | 101.4 ms | 103.4 ms |
| Paused existing-label edit, 400 nodes | 89.5 ms | 53.4 ms |

The existing-label case improved by about 40%. Its run medians were
87.4–104.4 ms before and 49.2–58.6 ms after. Median SVG patch time fell from
16.1 ms to 0.65 ms, with median patch-operation counts falling from 401 to one.
The median of the runs' 95th-percentile frame gaps fell from 133.3 to 66.7 ms;
the keydown-to-next-frame proxy fell from 24.5 to 19.0 ms. Input duration,
including the scripted 180 ms pauses, fell from 6.77 to 5.69 seconds.

All 22 existing-label previews still reparsed and reevaluated one statement,
reusing 400 statements. The structural insertion case still used semantic reuse
on 15 of 32 previews. Its median compute time and the small-figure results were
essentially unchanged; this refactor primarily improves unchanged-fragment
reuse, rather than the full replay needed by structural/incomplete syntax.

In the third existing-label CPU sample, the old fragment materialization path
accounted for 870 ms across the typing sequence. Updating the new source bindings
accounted for 153 ms. Sampled garbage collection fell from 359 to 162 ms.
These are sampled totals, not wall-clock phase timings. Dependency merging,
persistent-map lookup, React work, and repeated per-source bounds scans remain
visible in the profile.

Validation: 4,336 unit tests passed (six skipped), 71 browser cases passed across
the main run and focused rerun, and type checking and production lint passed.
The browser regression verifies that a later label retains the same glyph DOM
through source typing, then checks undo/redo and editing at its new source span.
Default SVG output still passes the generated-preview hash checks.

Local measurement artifacts: `/private/tmp/tikz-bindings-before-{1,2,3}/` and
`/private/tmp/tikz-bindings-after-{1,2,3}/` contain reports and CPU profiles;
`/private/tmp/tikz-bindings-summary.json` contains all run medians. The reproducible
scenario remains `apps/web/profiling/profile-source-typing.spec.ts`.

## Incremental derived data and cooperative evaluation

Scene source groups are indexed once per immutable element array. Node selection
bounds and text-only-node checks use the same index, replacing a full scene scan
for each handle. Source rebinding carries a geometry identity token forward;
geometry-only bounds caches use that token and the numeric view box. A new
semantic evaluation gets a fresh identity. Tokens do not reference old scene
objects, and the caches are weakly owned so earlier source revisions can be
collected.

The dependency builder indexes each statement's edges in its persistent state.
Selective replay reads only the replayed statements' dependency contributions.
If their topology is unchanged, the complete graph and its invalidation index
retain their identities. Otherwise the changed contribution is merged into the
sorted graph, dropping disconnected resources. Invalidation queries share an
adjacency index and traverse a queue with a cursor instead of repeatedly removing
its first entry.

Synchronous and cooperative semantic evaluation use the same generator, including
full evaluation, suffix replay, selective replay and source rebinding. The app
runs batches with an 8 ms budget and checks the budget between statements or
reused fragments. The budget is a scheduling target: it cannot preempt one large
statement or an indivisible parser/layout/finalization operation. Each batch
enters and leaves its text render scope before the browser resumes other work.

The host uses feature-detected `scheduler.yield()` and a timer fallback to cross
an actual event-loop task boundary. A resolved Promise alone would not let input
and rendering run. See [Chrome's scheduling explanation](https://developer.chrome.com/blog/use-scheduler-yield).

The compute scheduler cancels obsolete requests and suppresses both their success
and error callbacks. Source changes invalidate running work immediately, even
while the replacement request is debouncing. New evaluations fork the committed
parser and semantic sessions; SVG/text bindings are local to the request. Only a
completed, current request can publish those caches together. Cancellation closes
the generator outside semantic fallback handlers and leaves the previous
snapshot/baseline intact. Concurrent preview/export requests cannot overwrite a
newer completed cache with an older result.

Regression tests compare synchronous and cooperative results, interrupt evaluation
inside scopes, render another document during a text-layout pause, and verify
that the next edit can reuse the committed baseline after cancellation. A browser
test pauses a 400-node render and types into CodeMirror while the previous canvas
remains displayed.

## Derived-data and scheduling measurements, October 2, 2026

Compared `efa28d32` with the changes above using frozen production builds,
installed Chrome, one browser worker, and three runs per build. No other builds
or test jobs from this task ran during measurement. Values below are the median
of each run's median elapsed compute time; they include time spent yielding.

| Source edit | Before | After |
| --- | ---: | ---: |
| Short burst, 2 statements | 5.7 ms | 5.6 ms |
| Short burst, 120 nodes | 41.0 ms | 39.6 ms |
| Paused path-label insertion, 400 nodes | 90.8 ms | 94.0 ms |
| Paused existing-label edit, 400 nodes | 42.0 ms | 34.0 ms |

The existing-label case computes about 19% faster. Median long-task counts over
the typing sequence fell from 22 to 3. The structural insertion case takes about
4% longer to complete, but its median long-task count fell from 32 to 17, and the
median of the runs' 95th-percentile long-task durations fell from 158.9 to 63.6 ms.
This is the intended tradeoff: the browser can process input between batches,
even when total completion time is slightly longer.

The keydown-to-next-frame proxy and frame-gap percentiles did not show a clear
improvement in these workloads. For existing-label edits, they remained 18.2 ms
and 50.0 ms respectively. Long-task reduction is evidence of less uninterrupted
main-thread blocking, not a measured INP improvement. The separate browser
regression verifies that CodeMirror can accept edits during suspended evaluation.

Work counts stayed constant: all 22 existing-label previews reparse and reevaluate
one statement and reuse 400; structural insertion uses semantic reuse on 15 of
32 previews. Existing-label SVG updates still patch one part. Thus the compute
improvement is not explained by dropping more preview updates.

In the third existing-label CPU sample, dependency merging previously accounted
for 142 ms across the sequence; the new subset-building/replacement path accounted
for about 2 ms of samples. Preferred-node bounds lookups fell from 121 to 5 ms.
Sampled React synchronous work fell from 734 to 592 ms. These sampled totals are
supporting evidence rather than latency guarantees; garbage collection and host
load varied between runs.

Local reports and CPU profiles are in
`/private/tmp/tikz-derived-before-{1,2,3}/` and
`/private/tmp/tikz-derived-after-{1,2,3}/`. The per-run metrics and medians are in
`/private/tmp/tikz-derived-summary.json`. The same four cases remain reproducible
through `apps/web/profiling/profile-source-typing.spec.ts`.

Validation: 4,345 unit tests passed across 308 files (six skipped); type checking,
production lint, focused test lint, and the production build passed. Browser
checks passed 43 cases covering source typing, cancellation, snapping, rectangle
resizing and core editing. One grouping test expected six spaces of indentation
but received four; the same failure reproduced on the unchanged baseline build.

## Remaining architectural work

- Parsing still updates absolute AST spans. Profiling should determine whether
  its remaining copies justify a similar separation inside the parser.
- Some scene-derived UI work, semantic finalization, parsing and SVG emission
  still process the whole figure. The new identities and pause points provide
  foundations for further targeted changes.
- One large statement (for example, a matrix with many cells), macro expansion
  and an individual text layout still run synchronously within a batch. Further
  pause points should follow evidence from those workloads.
- Beamer frame rendering has a separate compute path. Shared syntax indexing
  helps it, but ordinary TikZ statement reuse does not make complete Beamer
  frames incremental.
