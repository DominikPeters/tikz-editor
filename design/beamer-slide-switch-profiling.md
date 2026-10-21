# KKT slide-switch profile (2026-10-07)

The initial profile found that the source-typing debounce also applied when the
selected slide changed. On this fixture it waited 120ms before scheduling
computation, even for cached pages. Explicit render scheduling now removes that
wait for navigation.

**Visibility correction:** the earlier 39–47ms figures were production SVG DOM
commit medians, not time until a user sees the new slide. Development WebKit
shows substantially longer paint-opportunity timings, consistent with the
reported roughly 100ms feel. Read the development/paint follow-up below before
interpreting the production DOM numbers.

Measurements used a production profiling build, a 1280×800 viewport, the default
Source/Canvas/Slides/Inspector layout, and `kkt_theorem_beamer.tex`. The first pass
visits slides 2–20 (slide 1 was rendered during setup); the second pass visits
all 20 cached pages. Normal thumbnail work remains enabled. Chromium captures
CPU samples; WebKit captures the same browser-side timing probe without CDP.

## Before the scheduling fix

| Metric, median ms | Chromium first visit | Chromium repeat | WebKit first visit | WebKit repeat |
| --- | ---: | ---: | ---: | ---: |
| Click → compute start | 128.2 | 128.0 | 136 | 136 |
| Compute wall time | 18.8 | 0.6 | 19 | 1 |
| Compute end → SVG commit | 8.2 | 8.0 | 10 | 11 |
| SVG patch duration (included above) | 1.9 | 2.2 | 3 | 3 |
| Click → SVG commit | 154.3 | 136.9 | 168 | 148 |
| Click → paint opportunity | 160.3 | 143.0 | 177 | 160 |
| Click → SVG commit, p95 | 169.1 | 139.9 | 187.9 | 151.3 |

Each statistic is summarized separately; adding stage medians does not produce
the median of total latency. The clock starts at the browser's capturing click
listener, excluding Playwright actionability/scrolling/polling. SVG completion is
checked against the target frame's background part, so changing the selected
card alone cannot complete the sample. A paint opportunity is the second
animation frame after the target DOM update; this is an upper-bound proxy for
visibility, not a compositor timestamp. This is a local baseline, not a CI speed
threshold or a measurement of the Tauri host itself.

There were exactly 19/20 completed compute and patch records for the respective
Chromium passes, with no observed main-thread long tasks over 50ms. Main-thread
CPU samples spend most of the sequence idle. DOM parsing, CodeMirror updates,
React commits, and viewport fitting account for small additional costs, but SVG
patching is not the primary bottleneck. First visits also have real frame
rendering cost: the slowest measured Chromium computation was 31.6ms on the
water-filling slide.

## Scheduling fix and follow-up measurement

| Click → SVG commit, median ms | Before | After |
| --- | ---: | ---: |
| Chromium, first visit | 154.3 | 38.9 |
| Chromium, repeat visit | 136.9 | 13.0 |
| WebKit, first visit | 168 | 47 |
| WebKit, repeat visit | 148 | 24 |

Median click → compute start is now 6.6/6.1ms in Chromium and 14/14ms in WebKit
for first/repeat visits. Cache lookup remains about 1–2ms. First-visit render
times vary with browser scheduling and warm-up; the reliable improvement is
removing the 120ms wait. Profiling runs use the same fixture and viewport.

`compute-scheduling.ts` classifies the transition between render inputs.
Source-changing reducer actions record session-only provenance for the new
revision, so missing or retained edited-object IDs no longer decide scheduling.

| Cause | Policy | Reason |
| --- | --- | --- |
| Source-editor typing | Trailing 120ms; 220ms above 80,000 characters | Avoid rendering every incomplete source version. |
| Assistant source updates | Trailing 60ms | Coalesce rapid streamed updates while keeping preview reasonably current. |
| Dragging, resizing, rotation, numeric scrubbing, inspector editing | Immediate; coalesce superseded in-flight requests | Continuous visual feedback matters even though these events are bursty. |
| Canvas text editing | Immediate | Text, caret, and hit geometry need to track the edit together. |
| Figure/slide/document navigation and overlay steps | Immediate; flush pending typing | A discrete action should show its target promptly. |
| Undo/redo and edit commands | Immediate | The user expects the completed action to be visible. |
| Disk reloads, file context, image refresh, structural text-edit state | Immediate | Watchers already coalesce file notifications; a refresh should not inherit typing delay. |

`useScheduledCompute` cancels obsolete evaluation and retires the previous
debounce timer. Navigation renders the newest source immediately while retaining
source-change inference if a pending typed revision needs it. The evaluator's
existing drag hints remain separate from the scheduling cause, which is now
included in profiling records.

Validation passed 177 focused unit/integration tests, typechecking, production
lint, both KKT profiling runs, and the two new scheduling browser tests in both
engines. Chromium's focused slide-manager/build suite passed 24 of 25 tests; the
existing native-pointer drag test failed in both Chromium and WebKit. A separate
temporary production build loading the original `App.tsx` reproduced the same
drag failures, so they are not introduced by the scheduling change. The other
focused WebKit resize/overlay checks passed.

## Original attribution

The previous `packages/app/src/ui/App.tsx` derived `typingComputeDelay` from the edit trigger
and `changedSourceIds`, without distinguishing navigation from typing. Its
debounced compute effect also depends on `activeRootId` and `activeDeckStep`.
`useDebouncedEffect` therefore started another 120ms timer after a slide click.
The remaining 8–16ms of pre-compute wait included UI effect/timer scheduling.
The existing rendered-page cache in `computeDeckSnapshot` already made repeat
computation cheap.

## Matched browser/build comparison

To separate development overhead from engine differences, the same current
source was measured with 1600×1000/DPR 2 contexts in windowed Chromium and
WebKit, with CPU sampling disabled. Production used a fresh normal minified Vite
build (without `TIKZ_PROFILE_BUILD`); development used the running Vite server.
Each run visits 19 previously unrendered frames and then all 20 cached frames.
Browsers ran sequentially. Versions: Chromium 151.0.7922.34 and WebKit 26.0.

| Windowed browser | Build | First visit paint proxy, median / p95 | Repeat paint proxy, median / p95 | Repeat SVG DOM commit, median |
| --- | --- | ---: | ---: | ---: |
| Chromium | Production | 41.1 / 52.6ms | 19.5 / 25.5ms | 12.0ms |
| Chromium | Development | 57.0 / 133.4ms | 37.8 / 88.9ms | 25.5ms |
| WebKit | Production | 73.0 / 109.8ms | 46.0 / 58.6ms | 23.0ms |
| WebKit | Development | 94.0 / 136.8ms | 65.0 / 81.8ms | 37.0ms |

Both factors matter in these measurements. Development adds roughly 18–21ms to
the median paint proxy; WebKit adds roughly 27ms on repeat visits versus
Chromium at the same build mode. A production/headless cross-check gave medians
of 39.4/20.0ms (first/repeat) in Chromium and 67.0/44.5ms in WebKit, close to the
windowed results. The engine gap is therefore not confined to headless testing.

The measurement also exposes an important proxy limitation. For cached frames,
the observed gap from the first to the second post-SVG animation-frame callback
is approximately 6–7ms in Chromium versus 21–23ms in WebKit. Waiting for that
second callback therefore magnifies the apparent engine difference. This is
observed local callback cadence, not a claim that WebKit always has a particular
frame-rate cap or that these are exact pixel-presentation timestamps.

There is still an engine difference before the proxy's extra callback: cached
SVG commits take about 12ms versus 23ms in production and 25.5ms versus 37ms in
development. Actual cached computation takes about 1–2ms in production and
3.5–4.5ms in development; UI commit/scheduling and frame delivery account for
much of the remaining time. These data support shipping a faster release build,
but do not establish that all remaining delay is only a development artifact.

Six browser comparisons passed. The consolidated measurements are in
`apps/web/profiling/traces/beamer-slide-switch-browser-mode-comparison.json`;
individual reports use `matrix-windowed` or `matrix-headless` run labels.
Set `TIKZ_PROFILE_CPU=0` for timing-only runs and `TIKZ_PROFILE_RUN_LABEL` to
preserve separately named reports. The temporary matrix config used the full
Chromium browser executable for both headless and windowed checks.

## Development mode and visibility follow-up

The reported environment is the macOS desktop development app, including repeat
visits. Per the user's preference, subsequent measurements stay in browser
WebKit rather than controlling the native app. Both shells use React StrictMode
in development. These are browser measurements, not native presentation times.

| WebKit development run | First SVG, median | First paint proxy, median / p95 | Repeat SVG, median | Repeat paint proxy, median / p95 |
| --- | ---: | ---: | ---: | ---: |
| 1280×800, DPR 1, before visual follow-up | 67ms | 90 / 134ms | 42.5ms | 64 / 82ms |
| 1280×800, DPR 1, SVG commit before paint + stable navigator inventory | 55ms | 86 / 121ms | 35.5ms | 59.5 / 80ms |
| 1600×1000, DPR 2, same visual changes | 63ms | 97 / 140ms | 37ms | 67 / 79ms |

The paint proxy remains the two-animation-frame observation described above,
not a timestamp obtained from displayed pixels or the macOS compositor. It
includes a paint opportunity after the new canvas DOM commit. Small differences
between local runs should not be treated as precise speedups. In particular the
changes below improve commit ordering, but do not establish a consistently
sub-50ms visible switch in development mode.

Cached computation is approximately 4ms in development WebKit. The rest of the
repeat-switch path includes roughly 18ms before computation starts, 14ms between
completion and SVG commit, and 24–30ms from DOM commit to the paint proxy.
These intervals include UI and browser scheduling, not just CPU calculation.

Two small visual changes are retained:

- `CanvasSVGLayer` creates its host and applies SVG patches in layout effects,
  so a completed model is installed during the commit before parent viewport
  measurements and paint. A regression checks the actual DOM seen by its
  parent's layout effect on initial render and slide replacement.
- `RootNavigator` derives card inventories from the frames/figures themselves,
  instead of the whole snapshot. Changing just the active SVG no longer rebuilds
  all card/thumbnail inputs or restarts the inventory-dependent viewport work.

Starting computation in a layout effect was also tried. It mostly moved pending
UI work into the measured compute interval, without a meaningful visible gain;
that experiment was reverted. Immediate compute requests still use the
cause-based scheduling policy, with the source debounce already removed from
navigation.

The visual follow-up passed 45 SVG/viewport tests and seven focused development
WebKit browser checks for navigation, overlay changes, source dimming, active
thumbnail mirroring, and continuous resize edits. Typechecking and production
lint passed. Development reports record the application mode and pixel ratio.

## Guarded cached navigation and idle preparation

All four follow-up changes are implemented:

- The store publishes a cached complete frame and the new root/overlay selection
  in one update. SVG and editing geometry cannot come from different pages.
  The compute hook recognizes this snapshot and avoids scheduling another render.
- Source auto-scroll and dimming wait for two animation frames. Source text and
  editing controls remain immediate; obsolete cosmetic callbacks are canceled.
- Immutable page interaction data (text context, topology, object index) is
  reused through a weak cache owned by the rendered frame. Selection, caret and
  viewport state remain live. Pending navigation cannot edit old frame geometry.
- Idle work prepares at most the next and previous frame's first overlay, in
  cooperative batches with a 4ms budget. Foreground rendering and input cancel
  it; held gestures, hidden windows and active editing prevent it from starting.
  It never publishes a snapshot or advances the foreground revision.

The complete-page LRU retains at most 32 pages and 32MiB of estimated data.
An oversize page is rendered normally but not retained. Exact source/revision,
document, file/resolver context, asset and platform generations, frame/overlay,
and structural text masks fence cache use. Partial or obsolete work is discarded.
Derived data has weak ownership, so eviction does not leave another permanent
page cache behind. The estimate is a retention policy, not a measured heap cap.

| Windowed WebKit development, 1600×1000 / DPR 2 | Before | Final |
| --- | ---: | ---: |
| First visit paint proxy, median / p95 | 94 / 136.8ms | 78 / 134.9ms |
| Repeat paint proxy, median / p95 | 65 / 81.8ms | 37 / 50.1ms |
| Repeat SVG DOM commit, median | 37ms | 16ms |

The final run had 20/20 synchronous repeat hits and one idle-warmed first visit.
All 20 KKT pages occupied 25,342,820 estimated bytes. A previous verification
run measured 35ms repeat median; normal callback cadence still contributes to
variation. These remain two-rAF visibility proxies, not exact compositor times.
Most cold visits still perform real frame layout/rendering; neighbor preparation
helps when idle time is available rather than promising every cold visit is cached.

Validation: 64 focused cache/scheduling/cooperative/lifecycle tests, 28 WebKit
browser regressions including saved KKT startup/reload and empty decks,
typechecking and production lint. The established native-pointer drag failure
remains excluded from this focused browser run. Source reveal and overlay
selection also preserve ownership across development StrictMode remounts.
The final report is
`apps/web/profiling/traces/beamer-slide-switch-webkit-development-guarded-final-report.json`.

During the native development smoke check, the user reported an import syntax
error and grey startup screen. A bootstrap refresh cleared it, but the failing
module was not recovered: all 656 currently served modules parsed with macOS
JavaScriptCore. The desktop shell now displays startup errors with Reload rather
than leaving an empty screen. Its independently reported window-title denial
was fixed by granting `core:window:allow-set-title`.

## Reproduce

From `apps/web`, with the configured Playwright browsers installed:

```sh
npx playwright test --config profiling/playwright.config.ts profiling/profile-beamer-slide-switch.spec.ts --project chromium
node ../../scripts/analyze-cpuprofile.mjs profiling/traces/beamer-slide-switch-first-visits.cpuprofile --dist dist
```

The profiling config builds production assets with source maps. If the large
bundle exceeds Node's default heap during the build, use
`NODE_OPTIONS=--max-old-space-size=8192` for the profiling command.

Reports and CPU profiles are in the ignored `apps/web/profiling/traces/` directory:

- `beamer-slide-switch-chromium-report.json`
- `beamer-slide-switch-webkit-report.json`
- `beamer-slide-switch-first-visits.cpuprofile`
- `beamer-slide-switch-repeat-visits.cpuprofile`
- `beamer-slide-switch-first-visits-analysis.json`
- `beamer-slide-switch-repeat-visits-analysis.json`

Baseline copies have `-before` before the extension; measured post-change reports
and CPU profiles also have `-after` copies. The main filenames contain the latest
measurement. Baseline CPU analyses retain the original source-map attribution;
use the current `dist` source maps only with the post-change CPU profiles.

The scenario is registered as `beamer-slide-switch`. Reports retain each click's
timestamps, target slide, compute duration, SVG operation count, and long tasks.

For an already-running development server, use the development profiling config
and set `TIKZ_PROFILE_APP_MODE=development`:

```sh
PLAYWRIGHT_BROWSERS=webkit TIKZ_PROFILE_APP_MODE=development npx playwright test --config profiling/playwright.devserver.config.ts profiling/profile-beamer-slide-switch.spec.ts
```

Override `TIKZ_PROFILE_BASE_URL` for another port. The follow-up used WebKit with
explicit 1280×800/DPR 1 and 1600×1000/DPR 2 contexts; the committed development
config uses each engine's standard Desktop device viewport. Additional artifacts include
`beamer-slide-switch-webkit-development-retina-report.json` and the development
baseline/stable-navigator summaries. The production config remains the default.
