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

Changing a label's length shifts all later source offsets. Reusing their geometry
alone is insufficient: native text reports and SVG glyph attributes must move
with their source. The text engine can now reproject a retained measurement into
a new source map while sharing layout work. Old scene reports remain valid.
Unsupported or foreign macro projections trigger semantic replay.

SVG reuse includes the native text render key. An unchanged shape with changed
text source metadata is therefore emitted again. Incremental parse results also
expose a lazily rebuilt, current syntax tree rather than the previous revision's
tree.

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

## Results, October 2, 2026

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

## Remaining architectural work

- Parsing and evaluation still run on the main thread. Moving the compute
  session to a worker would protect typing from expensive full fallbacks, but
  requires explicit ownership and transfer of text reports, graphics resources,
  and revision cancellation.
- A source-length edit necessarily updates later absolute source metadata.
  Separating reusable geometry/layout from source projections further could
  avoid cloning as much of the scene on each revision.
- Canvas updates still replace text markup when absolute source attributes
  change. Updating source metadata separately could avoid rebuilding unchanged
  glyph DOM.
- Beamer frame rendering has a separate compute path. Shared syntax indexing
  helps it, but ordinary TikZ statement reuse does not make complete Beamer
  frames incremental.
