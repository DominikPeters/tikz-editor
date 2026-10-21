import { copyFileSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { gotoApp, resetStorageBeforeNavigation, setSource } from "../e2e/helpers";
import { captureProfileVariant, roundNumber, summarizeFrameDurations, writeScenarioReport } from "./framework";
import { getProfilingScenarioById } from "./scenario-registry";
import type { TikzEditorProfilingComputeTiming, TikzEditorProfilingSvgPatchTiming } from "../../../packages/core/src/profiling";

const SOURCE = readFileSync(new URL("../../../test/fixtures/beamer/kkt_theorem_beamer.tex", import.meta.url), "utf8");
const MANIFEST = getProfilingScenarioById("beamer-slide-switch");
if (!MANIFEST) throw new Error("Missing slide-switch profiling scenario.");
const APP_MODE = process.env.TIKZ_PROFILE_APP_MODE === "development" ? "development" : "production";
const RUN_LABEL = process.env.TIKZ_PROFILE_RUN_LABEL;

type SwitchSample = {
  frameId: string;
  label: string;
  clickAt: number;
  selectedAt?: number;
  computeStartAt?: number;
  computeEndAt?: number;
  computeDurationMs?: number;
  cachedNavigation?: boolean;
  svgAt?: number;
  svgPatchMs?: number;
  svgOperations?: number;
  replaceAll?: boolean;
  firstRafAfterSvgAt?: number;
  paintOpportunityAt?: number;
};
type SlideProbe = { samples: SwitchSample[]; longTasks: Array<{ start: number; duration: number }>; frameIntervals: number[] };

async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const globalLike = window as typeof window & {
      __TIKZ_EDITOR_APP_TEST_API__?: { getActiveFigureId: () => string | null; getPendingRequestId: () => string | null };
      __PW_SLIDE_SWITCH__?: { snapshot: () => SlideProbe; reset: () => void };
    };
    const api = globalLike.__TIKZ_EDITOR_APP_TEST_API__;
    const recorder = globalLike.__TIKZ_EDITOR_PROFILING_RECORDER__;
    if (!api || !recorder) throw new Error("Slide profiling API is unavailable.");
    const samples: SwitchSample[] = [];
    const longTasks: SlideProbe["longTasks"] = [];
    const frameIntervals: number[] = [];
    let previousFrameTs: number | null = null;
    let pending: SwitchSample | null = null;
    const targetIsRendered = (sample: SwitchSample) => document.querySelector(
      `[data-testid="canvas-svg-layer"] [data-part-id="${sample.frameId}:background"]`
    ) != null;
    document.addEventListener("click", event => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>(
        '[data-testid="figure-navigator"] [data-slide-id] button'
      );
      const frameId = button?.closest('[data-slide-id]')?.getAttribute("data-slide-id");
      if (!button || !frameId || api.getActiveFigureId() === frameId) return;
      if (pending) throw new Error("Previous slide switch has not reached a paint opportunity.");
      pending = { frameId, label: button.getAttribute("aria-label") ?? frameId, clickAt: performance.now() };
      samples.push(pending);
      const sample = pending;
      queueMicrotask(() => {
        if (api.getActiveFigureId() === frameId) sample.selectedAt = performance.now();
      });
    }, true);

    const originalCompute = recorder.recordComputeTiming.bind(recorder);
    recorder.recordComputeTiming = (timing: TikzEditorProfilingComputeTiming) => {
      originalCompute(timing);
      if (!pending || timing.kind !== "render") return;
      pending.computeEndAt = performance.now();
      pending.computeStartAt = pending.computeEndAt - timing.durationMs;
      pending.computeDurationMs = timing.durationMs;
      pending.cachedNavigation = timing.phaseDurationsMs?.cachedNavigation != null;
    };
    const originalPatch = recorder.recordSvgPatchTiming.bind(recorder);
    recorder.recordSvgPatchTiming = (timing: TikzEditorProfilingSvgPatchTiming) => {
      originalPatch(timing);
      if (!pending || pending.svgAt != null || !targetIsRendered(pending)) return;
      pending.svgAt = performance.now();
      pending.svgPatchMs = timing.durationMs;
      pending.svgOperations = timing.operationCount;
      pending.replaceAll = timing.hasReplaceAll;
    };
    // Two animation frames after the target DOM commit span a paint
    // opportunity. This is an upper-bound proxy, not a compositor timestamp.
    const observe = (frameTs: number) => {
      if (previousFrameTs != null) frameIntervals.push(frameTs - previousFrameTs);
      previousFrameTs = frameTs;
      const sample = pending;
      if (sample?.svgAt != null && targetIsRendered(sample) && api.getPendingRequestId() == null) {
        sample.firstRafAfterSvgAt ??= performance.now();
        requestAnimationFrame(() => {
          if (pending === sample && targetIsRendered(sample)) {
            sample.paintOpportunityAt = performance.now();
            pending = null;
          }
        });
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ type: "longtask" });
    }
    globalLike.__PW_SLIDE_SWITCH__ = {
      snapshot: () => ({ samples: samples.map(sample => ({ ...sample })), longTasks: [...longTasks], frameIntervals: [...frameIntervals] }),
      reset: () => { samples.length = 0; longTasks.length = 0; frameIntervals.length = 0; previousFrameTs = null; }
    };
  });
}

async function readProbe(page: Page): Promise<SlideProbe> {
  return page.evaluate(() => (window as typeof window & {
    __PW_SLIDE_SWITCH__: { snapshot: () => SlideProbe };
  }).__PW_SLIDE_SWITCH__.snapshot());
}

function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => {
    const position = (sorted.length - 1) * p;
    const lower = Math.floor(position), upper = Math.ceil(position);
    return roundNumber(lower === upper ? sorted[lower]
      : sorted[lower] * (upper - position) + sorted[upper] * (position - lower));
  };
  return { medianMs: percentile(0.5), p95Ms: percentile(0.95), maxMs: roundNumber(sorted.at(-1)) };
}

test("profiles first and repeat slide visits in the KKT deck", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, SOURCE);
  await page.bringToFront();
  const cards = page.getByTestId("figure-navigator").locator('[data-slide-id] button');
  await expect(cards).toHaveCount(20);
  await expect(page.getByTestId("canvas-svg-layer").locator('[data-part-id="frame:0:background"]')).toHaveCount(1);
  await page.evaluate(() => (window as typeof window & {
    __TIKZ_EDITOR_APP_TEST_API__: { resetProfilingSession: (label: string) => void };
  }).__TIKZ_EDITOR_APP_TEST_API__.resetProfilingSession("slide-switch-setup"));
  // Let initial visible thumbnail requests finish before recording switches.
  await expect.poll(() => cards.evaluateAll(buttons => buttons.filter(button => {
    const rect = button.getBoundingClientRect();
    const viewport = button.closest('[data-testid="figure-navigator-strip"]')?.getBoundingClientRect();
    if (!viewport) throw new Error("Slide list viewport is missing.");
    return rect.bottom > viewport.top && rect.top < viewport.bottom && rect.right > viewport.left &&
      rect.left < viewport.right && !button.querySelector("img");
  }).length)).toBe(0);
  await installProbe(page);
  const viewport = page.viewportSize();
  const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
  const variants = [];
  for (const id of ["first-visits", "repeat-visits"] as const) {
    await page.evaluate(() => (window as typeof window & {
      __PW_SLIDE_SWITCH__: { reset: () => void };
    }).__PW_SLIDE_SWITCH__.reset());
    variants.push(await captureProfileVariant({
      page, scenarioId: MANIFEST.id, variantId: APP_MODE === "development" ? `${id}-development` : id, label: id,
      dimensions: { fixture: "kkt_theorem_beamer.tex", cachedPages: id === "repeat-visits",
        viewportWidth: viewport?.width ?? null, viewportHeight: viewport?.height ?? null,
        devicePixelRatio, cpuProfiling: process.env.TIKZ_PROFILE_CPU !== "0" && testInfo.project.name.includes("chromium"),
        headless: testInfo.project.use.headless ?? null,
        browserVersion: page.context().browser()?.version() ?? "unknown" },
      run: async () => {
        // Slide 1 was rendered on load; visits 2–20 are cold the first time.
        const indices = id === "first-visits" ? Array.from({ length: 19 }, (_, i) => i + 1)
          : Array.from({ length: 20 }, (_, i) => i);
        for (const [sampleIndex, index] of indices.entries()) {
          await cards.nth(index).click();
          await expect.poll(async () => (await readProbe(page)).samples.filter(sample => sample.paintOpportunityAt != null).length,
            { intervals: [25, 50, 100] }).toBe(sampleIndex + 1);
        }
        const probeSnapshot = await readProbe(page);
        const cacheStats = await page.evaluate(() => (window as typeof window & {
          __TIKZ_EDITOR_APP_TEST_API__: { getDeckCacheStats?: () => { pages: number; estimatedBytes: number } };
        }).__TIKZ_EDITOR_APP_TEST_API__.getDeckCacheStats?.() ?? null);
        for (const sample of probeSnapshot.samples) {
          expect(sample.computeStartAt).toBeGreaterThanOrEqual(sample.clickAt);
          expect(sample.svgAt).toBeGreaterThanOrEqual(sample.computeEndAt!);
          expect(sample.paintOpportunityAt).toBeGreaterThanOrEqual(sample.svgAt!);
        }
        return {
          metrics: {
            sampleCount: probeSnapshot.samples.length,
            cachedNavigationCount: probeSnapshot.samples.filter(s => s.cachedNavigation).length,
            cacheStats,
            clickToComputeStart: distribution(probeSnapshot.samples.map(s => s.computeStartAt! - s.clickAt)),
            compute: distribution(probeSnapshot.samples.map(s => s.computeDurationMs!)),
            computeEndToSvg: distribution(probeSnapshot.samples.map(s => s.svgAt! - s.computeEndAt!)),
            svgPatch: distribution(probeSnapshot.samples.map(s => s.svgPatchMs!)),
            clickToSvg: distribution(probeSnapshot.samples.map(s => s.svgAt! - s.clickAt)),
            svgToFirstRaf: distribution(probeSnapshot.samples.map(s => s.firstRafAfterSvgAt! - s.svgAt!)),
            firstToSecondRaf: distribution(probeSnapshot.samples.map(s => s.paintOpportunityAt! - s.firstRafAfterSvgAt!)),
            clickToPaintOpportunity: distribution(probeSnapshot.samples.map(s => s.paintOpportunityAt! - s.clickAt))
          }, frameStats: summarizeFrameDurations(probeSnapshot.frameIntervals), probeSnapshot
        };
      }
    }));
  }
  const combinedReportPath = writeScenarioReport(MANIFEST, testInfo, variants, APP_MODE);
  const reportPath = combinedReportPath.replace(/-report\.json$/u,
    `-${testInfo.project.name}${APP_MODE === "development" ? "-development" : ""}${RUN_LABEL ? `-${RUN_LABEL}` : ""}-report.json`);
  copyFileSync(combinedReportPath, reportPath);
  console.log(`[profiling] wrote ${reportPath}`);
  for (const variant of variants) console.log(`[profiling] ${variant.id}: ${JSON.stringify(variant.metrics)}`);
});
