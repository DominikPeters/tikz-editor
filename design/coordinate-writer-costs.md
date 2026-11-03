# Coordinate writer costs

Measured 2026-10-22 on Apple M1 Pro, macOS arm64, Node v26.12.0. Raw
measurements, all samples' summary statistics and GC calibration trials are
in [coordinate-writer-costs.json](coordinate-writer-costs.json).

## Method

`apps/web/profiling/coordinate-writer-benchmark.ts` runs in an isolated Node
process with `--expose-gc`. Fixtures contain 100, 1,000 or 5,000 statements
(80% two-point paths, 20% nodes), with `x=2cm,y=1.6cm`. Each size has a
shared-frame fixture and a fixture with varying per-statement rotation and
shift. The edited middle path is untransformed in both: topology insertion
currently refuses some transformed paths. The varied fixture still
records distinct contexts for 80% of its statements.

For each document, the harness measures adding a line, inserting a path
point, pasting one raw statement with a world offset, and repeating one
path in a 2×2 grid. Every action must succeed and change the source.

- **Cold:** fresh parse, semantic evaluation and edit for each sample.
- **Prepared:** reuse the immutable snapshot, analysis view and geometry
  session. Report the first prepared call separately, then 12 samples
  interleaved with cold samples. Each edit starts from the same document;
  edits do not accumulate.
- **Checkpoint:** prepare the edited statement in a fresh geometry
  session, then request that preparation again.
- **Memory:** force three GCs before each heap reading. Measure retained
  snapshots, calibrate five trials of shared/unique captures and entry
  rows, and compare heap retention after replacing a snapshot 20 times
  while keeping the number of live snapshots fixed. Serialized graph
  sizes are reported separately; they are not heap overhead.

These are core costs. Browser painting, event handling, worker transport
and undo history are excluded. This is one machine/run, without a
pre-migration A/B baseline; it measures present costs, not migration
slowdown. With 12 samples, p95 is the maximum sample and is a coarse tail
indicator, not a stable performance threshold. No timing threshold is
added to CI.

## Results

Prepared p50 milliseconds (cold p50 in parentheses):

| Statements | Frames | Add line | Insert point | Paste | Repeat 2×2 |
|---:|---|---:|---:|---:|---:|
| 100 | shared | 2.82 (22.01) | 0.07 (9.42) | 15.18 (25.79) | 6.27 (15.95) |
| 100 | varied | 4.57 (31.50) | 0.07 (13.00) | 24.37 (40.37) | 8.61 (24.99) |
| 1,000 | shared | 22.50 (191.91) | 0.26 (81.13) | 147.06 (250.11) | 59.60 (162.37) |
| 1,000 | varied | 38.77 (308.65) | 0.27 (120.88) | 231.23 (385.81) | 85.71 (266.11) |
| 5,000 | shared | 112.75 (1010.93) | 0.97 (456.23) | 792.38 (1393.45) | 353.43 (939.97) |
| 5,000 | varied | 192.59 (1554.10) | 1.03 (675.20) | 1239.54 (2102.49) | 466.02 (1340.38) |

On 5,000 statements, first checkpoint preparation took 6.08–7.42 ms;
repeated requests rounded below 0.005 ms. Prepared insert-point p95 was
1.35–1.53 ms. Paste p95 was 1,764.94 ms (shared) and 1,375.36 ms (varied),
so individual pauses can substantially exceed its median. The raw report
retains first-prepared and p95/max data for every action.

Capture caching works: 10,000 uses of the same frame produce one capture,
retaining about 81.6 KB including the result-reference array. 10,000 unique
frames retain a median **504 bytes per capture**, including weak-cache
bookkeeping and that array. An independently calibrated entry row costs
about **56 bytes**, excluding pre-existing IDs and context. Individual GC
trials include noise (including a negative shared-frame trial); raw trial
values are preserved and the median is used.

| Statements | Frames | Unique contexts | Retained snapshot MiB |
|---:|---|---:|---:|
| 100 | shared | 1 | 0.87 |
| 100 | varied | 80 | 0.96 |
| 1,000 | shared | 1 | 7.86 |
| 1,000 | varied | 800 | 8.86 |
| 5,000 | shared | 1 | 32.00 |
| 5,000 | varied | 4,000 | 37.61 |

Applying the calibrations to the largest varied fixture gives roughly
2.3 MB for 5,000 rows and 4,000 captures. This is an estimate, not a
component-by-component heap attribution. After 20 snapshot replacements,
retained heap deltas ranged from −156 KiB to +176 KiB, with no size-growing
trend in this run. That is a retention sanity check, not proof against all
leaks or undo-history growth.

The next performance target is paste/repeat and new-element insertion on
large figures. Their growth is consistent with document-wide analysis
and evaluation; a CPU profile should identify the avoidable work before
changing caches. Context deduplication and checkpoint preparation are
working, and prepared point insertion stays small on this fixture.

## Reproduce

From `apps/web`, run the profiling scenario without starting a browser:

```sh
npx playwright test --config profiling/playwright.core.config.ts
```

Reports are written to the ignored `apps/web/profiling/traces/` directory
and attached to the Playwright test. The standard scenario report records
`appMode: "core"`; no browser frame statistics are claimed.

For a quick harness check:

```sh
COORD_PROFILE_SIZES=100 COORD_PROFILE_SAMPLES=3 npx playwright test --config profiling/playwright.core.config.ts
```

Or from the repository root, capture raw JSON directly:

```sh
node --expose-gc --import tsx apps/web/profiling/coordinate-writer-benchmark.ts > /tmp/coordinate-writer-costs.json
```

`COORD_PROFILE_MEMORY_ONLY=1` runs only the GC calibrations. The entry-row
calibration in the checked-in report was taken in a separate process with
this mode on the same machine/runtime; action timings and capture trials
come from the full run.
