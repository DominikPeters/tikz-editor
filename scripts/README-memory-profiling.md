# Memory profiling

Run the browser soak against a production build:

```sh
cd apps/web
npx playwright test --config profiling/playwright.config.ts profiling/profile-memory.spec.ts --project chromium
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` to use a system
Chromium instead of Playwright's downloaded browser. The profiling config starts
the production build and preview server unless one is already running at its
configured URL. Stop an existing preview server before comparing builds.

The scenario warms rendering and fonts, applies 60 source revisions, then opens,
edits and discards 18 documents. Samples wait for the active render to finish and
force garbage collection. The JSON report is written to
`apps/web/profiling/traces/memory-report.json` and attached to the test results.
It records retained main-thread JS heap, backing storage and DOM/listener counts.
The generous growth guards detect regressions; passing does not prove that all
memory is released. Worker heaps, native/GPU allocations and transient peaks are
outside this measurement. Render durations include Playwright polling and should
not be interpreted as precise rendering CPU times.

Set `TIKZ_MEMORY_HEAP_SNAPSHOT=1` to also write
`profiling/traces/memory.heapsnapshot` for Chrome DevTools' Memory panel.

Run the core retention probes in a fresh Node process for each revision:

```sh
node --expose-gc --import tsx scripts/benchmark-core-memory.mts --json /tmp/core-memory.json
node --expose-gc --import tsx scripts/benchmark-core-memory.mts --module-root /path/to/baseline --json /tmp/core-memory-before.json
```

The baseline needs its dependencies available. `--only hyphenation`, `foreach`,
`beamer-resolvers` or `syntax-history` selects one probe. Comparing archived HEAD
sources with the memory-pass sources produced these results on this environment:

| Probe | Before | After |
| --- | ---: | ---: |
| Retained heap after 100,000 unique hyphenation words | 25.35 MB | 5.45 MB |
| Retained heap after 300 revisions of a 21,000-character loop | 27.89 MB | 0.34 MB |
| Retired graphics resolvers retained by one prepared deck | 10/10 | 0/10 |
| Oversized syntax indexes retained after visiting eight documents | 8/8 | 1/8 |

MB above means decimal megabytes. The resolver probe attaches 4 MiB per resolver,
so releasing ten also releases 40 MiB of asset buffers. These are focused probes,
not whole-app savings. A separate alternating hot-word microbenchmark measured
about 9 ns extra per lookup for bounded LRU bookkeeping; timings vary with load.

The browser soak also exposed Chromium's native contenteditable undo stack
retaining detached CodeMirror lines after document switches. A heap snapshot
traced ownership through `blink::Editor → UndoStack → UndoStep → Text → cmTile`.
Clearing CodeMirror's separate history alone did not release those DOM trees.
The editor now briefly detaches/reinserts the same view on document switches,
preserving its identity, listeners and focus. The final soak held DOM counts at
1,886 after 6, 12 and 18 closed documents, versus growth to over 5,000 before
the native-undo cleanup. This work runs on document switches, not keystrokes.

Compare the old image-import encoder with the current app implementation:

```sh
node --expose-gc --import tsx scripts/benchmark-import-encoding.mjs --bytes 8MiB --runs 3
```

The benchmark checks output parity and reports elapsed time plus heap samples
immediately after encoding and after GC. An immediate sample measures surviving
temporary allocations, not a true allocation peak. GC timing and competing work
affect these measurements; avoid concurrent builds/tests for timing comparisons.

The memory pass adds regression coverage for cache eviction and recent-entry
reuse, oversized active entries, worker registrations and cancellation, PDF error
cleanup, source-editor history ownership, and GC of obsolete graphics resolvers.
Run the normal unit suite with `npm test`; `npm run lint:prod` and
`npm run typecheck` remain the production gates.

Cache byte limits estimate retained payload size; object overhead and shared
strings make them approximate. Selected caches keep one oversized active entry
so a large document or image remains reusable. Worker registrations also pin
in-flight work until it settles. Cold entries can require rereading or reparsing
after eviction; hot entries retain their normal reuse behavior.

The follow-up pass adds varied production-browser scenarios. Run them serially
to limit CPU contention when comparing timings:

```sh
cd apps/web
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test --config profiling/playwright.config.ts profiling/profile-memory-*.spec.ts --project chromium --workers 1
```

- `profile-memory-drag.spec.ts`: the real 148 KB paper, the same paper padded to
  615 KB, and a 500-statement figure with source/inspector panels visible and
  hidden. Each case performs 40 real endpoint drags with eight pointer moves
  each, records incremental/full parse and semantic paths, and samples after GC
  and after closing the document. The padded source increases source size, not
  semantic complexity; the dense figure separately increases scene complexity.
  A fifth case bypasses snapping with Control to isolate pure coordinate edits;
  the ordinary dense case also exercises structural node-anchor connections,
  which legitimately reorder statements and require full-render fallbacks.
  Handle hit-testing and active drag-kind assertions verify actual canvas input.
  Set `TIKZ_MEMORY_DRAG_BATCHES=6` for 76 drags (default three batches = 40),
  or `TIKZ_MEMORY_HEAP_SNAPSHOT=1` for open/closed heap snapshots.
- `profile-memory-deck.spec.ts`: a 24-slide, 88 KB deck with math, overlays and
  four SVG assets; 72 repeat visits followed by 18 source/asset revisions. It
  measures both main and thumbnail-worker heaps, plus bundle registration and
  release counts. Navigation plateaued around 60 MB main / 24 MB worker; asset
  revisions warm the bounded caches and do not establish a plateau themselves.
- `profile-memory-panels.spec.ts`: 20 panel hide/show cycles, 12 document-kind
  round trips, and actual tab switching between open TikZ and Beamer documents.
  The initially higher hidden-panel footprint comes from mounting the Objects
  panel's 500 rows; repeated toggles plateaued. Document-kind switches exposed a
  separate FlexLayout listener leak, fixed by preserving its Layout instance
  while replacing kind-specific models. Visibility listeners previously grew
  from 3 to 27; they now remain at 3.
- `profile-memory-export.spec.ts`: 12 real 2048×2048 PNG encodes and six PDF
  effect rasterizations. Canvas wrappers are deliberately retained to check
  prompt backing-surface release. Each probe previously left an estimated
  192 MiB of scratch surfaces; both now leave zero. This is a resource-lifetime
  check, not an RSS/peak-memory measurement. Encoded output sizes match baseline.

The follow-up also fixes materialized semantic map snapshots retaining their
redundant ancestry. Replacing a 64 KiB value 1,000 times while keeping only the
latest map retained all 1,000 old payloads before (62.5 MiB), versus one afterward
(64 KiB). Explicitly held old snapshots still work. Reproduce with:

```sh
node --expose-gc --import tsx scripts/benchmark-core-memory.mts --only persistent-map
```

The pure-coordinate case exposed a separate incremental parser history chain
that structural fallback renders had masked. Its deferred syntax-tree closure
shared the evaluator's lexical context and retained prior caches. A factory
capturing only source/span preserves lazy parsing while releasing old versions.
In 300 updates of a 501-statement figure, retained historical inventories fell
from 300 to 1; the parser-only heap went from growing 14.08→30.81 MB to remaining
10.74→10.83 MB. The GC regression also verifies that an explicitly retained old
result and both deferred trees remain valid. Reproduce with:

```sh
node --expose-gc --import tsx scripts/benchmark-core-memory.mts --only incremental-parse
```

In the matching production-browser run (76 snap-bypassed endpoint drags over the
dense figure), retained main-thread heap fell from **181.25 MB to 79.09 MB**.
After closing the document it fell from **156.32 MB to 51.56 MB**. Both runs
recorded 720 measured renders with no full parse or semantic fallback. Median
compute duration was effectively unchanged, **14.5 ms versus 14.6 ms** (p95:
45.1 versus 46.7 ms). These are component timings, not end-to-end input latency.
Undo history and bounded caches still account for useful retained data.

A back-to-back three-repeat export probe, without competing builds or drag
tests, also showed no cleanup slowdown: median time for 12 PNGs was 437→349 ms,
and for six PDF-effect rasterizations 1,485→1,223 ms. Timing samples are diagnostic,
not statistical performance guarantees. Output byte counts matched baseline.

PDF viewer regressions cover a 24-page sweep and cancellation/load/render races:
evicted pages call pdf.js cleanup after rendering settles, and offscreen canvases
release backing surfaces. One still-displayed old canvas remains painted until
replacement; its backing surface can await GC afterward. Closed decks also
discard their per-document overlay-step records.
