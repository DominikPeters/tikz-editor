# TeX text engine benchmarks

Run from the repository root:

```sh
npm run bench:text-engine
npm run bench:text-engine -- --list
npm run bench:text-engine -- --group math --samples 100 --json /tmp/text-engine-math.json
npm run bench:text-engine -- --only paragraph --samples 40
```

`--group` selects an exact group; `--only` matches case names without case sensitivity.
They can be combined. Invalid options and filters that match no cases fail rather than
producing empty reports. `--list` does not initialize or measure the engine.

## Coverage

The fixture catalog lives in `scripts/lib/text-engine-bench-cases.ts`.

| Group | Workloads |
| --- | --- |
| labels | Tiny labels, short labels, natural-width sentences |
| shaping | Ligatures, kerning, quotes, dashes, escaped prose, Unicode/TeX accents, automatic hyphenation |
| fonts | Serif/sans/monospace, bold italic, 7/12/20pt sizes, nested font and color scopes |
| paragraphs | 80/150/300pt widths, four alignments, natural-width multiline alignment, forced breaks, paragraph boundaries, long paragraphs, overfull math |
| structure | Itemize, nested enumerate/itemize, description item paragraphs, quotes, alignment environments, minipages, parboxes |
| boxes | Frames, overlaps, color boxes, rules, raised text, phantom/smash, vertical skips and penalties |
| math | Inline math, scripts, accents, operators, fractions, radicals, extensible delimiters, AMS alphabets, text in math, matrices, cases, aligned math, display equations, display align, Beamer sans math |
| resources | Resolved/missing graphics, contextual image dimensions, color resolver revisions, graphic resolver revisions |
| cache | Source-map cold layout, shifted source maps with shared layout, paragraph width changes with shared IR, remeasurement after cache eviction |
| editing | Character-by-character append, insertion, deletion, backspace, undo/redo, styled wrapped text, incomplete-to-complete math |
| fallback | Incomplete list literal rendering, unsupported-command rejection, empty input |

This is a performance catalog for the current engine. It does not assert full LaTeX
feature fidelity; for example, the description case measures its item paragraphs,
and the Beamer case measures its math font profile rather than full frame composition.
Use the TeX comparison scripts for fidelity and browser profiling scripts for latency
through SVG patching and browser paint.

## Measurement and integrity

Only the synchronous `measure()` call is timed. That call includes parsing, shaping,
line breaking, source mapping, and SVG payload construction on a cache miss. Request
construction, source-map/resolver setup, SVG checks, and cache-churn setup are outside
the timed interval. Initialization and per-case setup time are reported separately.

Each case warms up on three samples outside its measured sample space. Independent
requests use distinct, fixed-length numeric tokens, including a case identifier, so
raising `--samples` beyond 90 cannot turn cold samples into repeated strings. Token
length can increase between runs with different sample counts; compare identical
sample counts when comparing performance.

Every new rendered request is immediately repeated for a warm-cache reference timing.
The runner verifies payload identity, keeping warm samples valid even when the sample
count exceeds the render-cache capacity. Edit sequences preserve edit order and report
cached undo/redo revisits separately. `--samples` counts sequences for editing cases;
the JSON `operations` and timing `count` fields give the number of individual calls.

JSON distinguishes:

- `coldMs`: independent render/layout misses or remeasurement after eviction.
- `editMs`: new states in a sequence, including text edits, declared incomplete input, and width changes.
- `layoutReuseMs`: new render entries for shifted source maps after layout priming.
- `revisitMs`: cached returns to earlier states in a sequence.
- `warmMs`: immediate repeats of new rendered states.
- `measureMs`: all measured operations, including revisits and expected rejections.

Each summary reports count, min, median, mean, p95, and max in milliseconds. The console
shows miss median/p95 and revisit/warm medians. Missing phases are `null` in JSON.
The report includes Node version, platform, architecture, sample count, and filters.

Native fixtures fail on unexpected nulls, literal fallback, missing SVG payloads,
non-finite geometry, repeated cold keys, or missing required feature markers. Literal
and rejected-input fixtures declare those outcomes explicitly. The eviction workload
primes its probes, fills 2304 other labels, and verifies that all probes were evicted;
if engine cache capacities grow, update that working set. Setup is not included in
the miss timings. Outcome counts cover measured calls, excluding warm-up and reference
repeats.

## CPU profiles

```sh
node --cpu-prof --cpu-prof-dir=/tmp --import tsx scripts/bench-text-engine.mts --group math --samples 100
node scripts/analyze-cpuprofile.mjs /tmp/CPU.example.cpuprofile 20
node scripts/analyze-cpuprofile.mjs compare /tmp/before.cpuprofile /tmp/after.cpuprofile 20
```

CPU profiles cover the whole process, including imports, setup, checks, and output.
Use the timing JSON to distinguish measured calls from that overhead. Run benchmarks
without other CPU-heavy work when collecting comparison results; there are no absolute
latency thresholds in the integrity tests.

## Rendering optimization results (2026-10-01)

Profiling the expanded catalog identified redundant suffix scans in the paragraph
dynamic program as the largest hotspot. Each active state previously regenerated
all future break candidates at every breakpoint. It now advances an ordered candidate
iterator once, retaining only the next candidate and releasing iterators when states
expire or a forced break resets the active set. Scoring, tie-breaking, and overfull
fallback rules are unchanged. The deterministic regression test reduces text-slice
measurements from 60,296 to 597 for its 200-word paragraph while retaining identical
lines and total demerits; its assertion bounds work rather than elapsed time.

Additional changes reuse escaped font glyph paths and math glyph control-point bounds
across sizes and placements, avoid a component-width calculation for ordinary character
caret stops, and avoid parsing ordinary labels to normalize an absent `\par`. Explicit
line-break analysis is performed at most once per layout and its single-line result is
shared by render entries with different source maps. Glyph caches use font-data identity
and check the raw path, so different providers with the same font ID and changed glyph
data remain isolated.

The table shows the median of three fresh-process run medians, each with 40 samples per
case on macOS arm64 / Node v26.3.0. Before and after runs used the same 67-case catalog
and ran serially, alternating order, without tests running concurrently.

| Workload / phase | Before (ms) | After (ms) | Speedup |
| --- | ---: | ---: | ---: |
| Long paragraph, 120pt / cold | 83.576 | 7.090 | 11.8x |
| Wrapped paragraph, 150pt / cold | 2.315 | 1.304 | 1.8x |
| Wrapped paragraph with math, 150pt / cold | 2.507 | 1.283 | 2.0x |
| Centered paragraph, 300pt / cold | 3.605 | 1.167 | 3.1x |
| Nested fractions, radicals, delimiters / cold | 0.952 | 0.456 | 2.1x |
| Short label / cold | 0.245 | 0.214 | 1.1x |
| Short label / warm | 0.01358 | 0.00244 | 5.6x |
| Label append/insert/backspace/undo/redo / edit miss | 0.134 | 0.108 | 1.2x |

The median sum of measured calls across the catalog's 5,080 operations fell from
7,101 ms to 2,019 ms (72%). This aggregate reflects the catalog's chosen workload mix;
it is not an estimate of browser frame time. No case's median increased by more than
15% in these runs. Small timings remain sensitive to JIT and scheduler noise.

Validation included 1,500 seeded paragraph models compared against the previous DP,
508 captured engine states with identical metrics and SVG payloads, glyph-cache
isolation/invalidation tests, and the full test suite (4,115 passing tests). Remaining
sampled costs are spread across shaping, line-report construction, SVG formatting,
and allocations; browser DOM patching and paint need separate browser profiles.

## Second optimization pass

The next profile showed repeated work in encoding, caret-map construction, report
assembly, and SVG serialization. Standalone ASCII characters now bypass NFC
normalization, while Unicode clusters retain the existing normalization and UTF-16
source spans. Shaping reuses encoded characters until ligatures require a composite
glyph, and updates its private caret objects instead of replacing them repeatedly.
SVG rendering opts out of constructing caret maps it never reads; editable shaping
still includes both caret arrays by default, and custom metric providers can ignore
that optional hint.

Report assembly computes source bounds in one pass without temporary arrays and
normalizes each math box once per report build. The normalization cache is local to
the build, so subsequent layouts observe changed input. Styled source with none of
the three supported line-break command spellings bypasses a second IR parse; possible
matches still use the IR to exclude math and comments.

The node engine defers eager inline-math SVG because paragraph assembly renders the
retained hlist after line breaking. The provider's public default and display SVG
behavior remain unchanged. Text SVG rendering formats font attributes and baseline
coordinates once per visible glyph run; integer coordinates bypass decimal formatting
without changing output.

Using the same three-run, 40-sample comparison method against the first-pass source,
the median sum of measured calls fell another 9.6%, from 2,040 ms to 1,845 ms.

| Workload / phase | First pass (ms) | Second pass (ms) |
| --- | ---: | ---: |
| Long paragraph, 120pt / cold | 7.204 | 6.396 |
| Wrapped paragraph, 150pt / cold | 1.256 | 1.076 |
| Nested styles, sizes, colors / cold | 0.409 | 0.340 |
| Unicode and TeX accents / cold | 0.302 | 0.245 |
| Color boxes, rules, raised text / cold | 0.375 | 0.302 |
| Label edit sequence / edit miss | 0.107 | 0.095 |

No rendering case's median increased by more than 15%. The empty-input rejection
case varied from 0.084 to 0.125 microseconds, where timer/JIT noise dominates. These
results are additional savings over the first pass, using a fresh baseline rather
than mixing measurements from separate sessions.

The second pass retained identical metrics and SVG payloads for all 508 captured
states and matched 3,000 seeded shaping comparisons, including failure paths.
Deterministic tests cover the absence of ASCII normalization, Unicode/source-end
handling, omitted render-only caret arrays, custom providers that ignore the hint,
deferred inline SVG with unchanged display output, and report-local math-box reuse.
Typechecking and production lint passed. The full suite passed with two workers:
282 files, 4,136 tests (five skipped). An earlier default-concurrency run hit two
15-second app/store import timeouts and a subsequent listener-count failure; the
affected files also passed in isolation before the bounded full rerun.

## Bounded caching pass

Paragraph IR now survives changes to width, font size, alignment, and source-map
position. Its key includes the exact source, list margins by value, and the color
resolver revision. Unversioned color callbacks bypass this cache. Shaped text uses
a provider-local cache keyed by owned generated font data, exact size, text, source
span length, and caret mode; hits rebase source positions and retain the current
caller font/color. Custom mutable fonts bypass it, and mutable custom lig/kern
programs are recompiled. Cache state stays out of font-profile serialization, and
borrowed shaping methods retain their original behavior.

Both caches admit results after their second use and freeze the admitted graphs.
This avoids preparing immutable results for most unique edits. Generated shaping
metrics are also frozen; caller-owned resolver, role, font, and list settings are
never frozen. The caches are bounded by entry count and estimated retained bytes:

| Cache | Entries | Estimated budget | Admission limits |
| --- | ---: | ---: | --- |
| Paragraph IR | 512 | 2 MiB | Source up to 16,384 UTF-16 units |
| Shaped runs, per provider | 2,048 | 2 MiB | Text up to 256 units; source span up to 512 |
| IR admission keys | 1,024 | 512 KiB | Keys only |
| Shaping admission keys, per provider | 1,024 | 256 KiB | Keys only |
| Source-map identities, per engine | 2,048 | 4 MiB | Oversized maps use an exact serialized key |
| Equivalent Beamer math profiles | 64 | 256 KiB | Finite line height |

Render keys no longer round requested dimensions, concatenate resolver revisions,
or rely on unchecked 32-bit source-map hashes. Exact source-map equality includes
projection bounds and produces tokens that are never recycled; eviction causes a
safe miss. Paragraph IDs are unique within their engine's report registry. Custom
math profiles use object identity rather than their display ID; equivalent owned
Beamer profiles are canonicalized with line height included. Reusing an engine
also selects its report context.

Three fresh-process, alternating-order comparisons of the same 68-case catalog
(40 samples, 5,240 measured calls) reduced the median sum from 1,948 ms to 1,885 ms,
an additional 3.2%. These measurements compare against the second-pass source.

| Workload / phase | Before (ms) | Cached (ms) |
| --- | ---: | ---: |
| Wrapped paragraph, 150pt / cold | 1.130 | 1.005 |
| Long paragraph, 120pt / cold | 6.361 | 5.920 |
| Paragraph width changes / new state | 0.787 | 0.741 |
| Ligatures and kerning / cold | 0.163 | 0.151 |
| Nested styles, sizes, colors / cold | 0.367 | 0.330 |
| Label edit sequence / edit miss | 0.096 | 0.093 |
| Tiny word / cold | 0.189 | 0.230 |

Caching has bookkeeping costs: the tiny-word median increased by 22%, about
0.04 ms. No other rendering miss phase increased by more than 15% in these runs.
Sub-millisecond comparisons remain sensitive to JIT and scheduling, and the
aggregate describes this catalog rather than browser latency.

Validation matched 12,000 seeded shaping/IR comparisons and all 524 captured engine
states, normalizing only opaque keys and paragraph IDs. Regression tests cover
eviction, frozen shared arrays, mutable custom inputs, exact dimensions, resolver
separators, a reproduced source-map hash collision, projection bounds, profile
identity, report ownership, serialization, and borrowed methods. An isolated
snapshot of `be61f1be` plus this pass passed all 289 test files (4,218 tests; five
skipped), with two workers and a 30-second test timeout. The final compatibility
adjustments also passed 25 targeted tests. Typechecking, the coordinate-type guard,
production lint, and lint for the new tests passed in that snapshot.
