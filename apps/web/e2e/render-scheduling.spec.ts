import { expect, test, type Page } from "@playwright/test";
import { gotoApp, resetStorageBeforeNavigation, setSource } from "./helpers";
import type { AppProfilingSnapshot } from "../../../packages/app/src/profiling";

const DECK = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{First}First slide.\pause Second build.\end{frame}
\begin{frame}{Second}Second slide.\end{frame}
\end{document}`;

async function profiling(page: Page) {
  return page.evaluate(() => (window as typeof window & {
    __TIKZ_EDITOR_APP_TEST_API__: { getProfilingSnapshot: () => AppProfilingSnapshot };
  }).__TIKZ_EDITOR_APP_TEST_API__.getProfilingSnapshot());
}
async function resetProfiling(page: Page) {
  await page.evaluate(() => (window as typeof window & {
    __TIKZ_EDITOR_APP_TEST_API__: { resetProfilingSession: () => void };
  }).__TIKZ_EDITOR_APP_TEST_API__.resetProfilingSession());
}
test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, DECK);
  await expect(page.getByTestId("canvas-svg-layer").locator('[data-part-id="frame:0:background"]')).toHaveCount(1);
});

test("slide switches use a navigation trigger after source typing", async ({ page }) => {
  await resetProfiling(page);
  const latest = DECK.replace("Second slide.", "Latest second slide.");
  await page.evaluate(source => (window as typeof window & {
    __TIKZ_EDITOR_APP_TEST_API__: { setSource: (source: string) => void };
  }).__TIKZ_EDITOR_APP_TEST_API__.setSource(source), latest);
  await page.getByTestId("figure-navigator").getByRole("button", { name: "2. Second", exact: true }).click();
  await expect(page.getByTestId("canvas-svg-layer").locator('[data-part-id="frame:1:background"]')).toHaveCount(1);
  await expect.poll(async () => (await profiling(page)).computeTimings.map(timing => timing.trigger)).toContain("root-switch");
  await expect.poll(() => page.evaluate(() => {
    const api = (window as typeof window & {
      __TIKZ_EDITOR_APP_TEST_API__: { getSource: () => string; getSnapshotSource: () => string };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    return api.getSnapshotSource() === api.getSource();
  })).toBe(true);
});

test("overlay navigation bypasses the delay after a source typing render", async ({ page }) => {
  await page.evaluate(source => (window as typeof window & {
    __TIKZ_EDITOR_APP_TEST_API__: { setSource: (source: string) => void };
  }).__TIKZ_EDITOR_APP_TEST_API__.setSource(source), DECK.replace("First slide.", "Edited first slide."));
  await expect.poll(async () => (await profiling(page)).computeTimings.map(timing => timing.trigger)).toContain("source-typing");
  await resetProfiling(page);
  await page.getByTestId("deck-step-next").click();
  await expect(page.getByTestId("deck-step-label")).toHaveText("2 / 2");
  await expect.poll(async () => (await profiling(page)).computeTimings.map(timing => timing.trigger)).toContain("overlay-step");
});

test("idle neighbors warm full pages without changing the visible slide", async ({ page }) => {
  await expect.poll(() => page.evaluate(() => (window as typeof window & {
    __TIKZ_EDITOR_APP_TEST_API__: { getDeckCacheStats: () => { pages: number } };
  }).__TIKZ_EDITOR_APP_TEST_API__.getDeckCacheStats().pages)).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("canvas-svg-layer").locator('[data-part-id="frame:0:background"]')).toHaveCount(1);
  await resetProfiling(page);
  await page.getByTestId("figure-navigator").getByRole("button", { name: "2. Second", exact: true }).click();
  await expect(page.getByTestId("canvas-svg-layer").locator('[data-part-id="frame:1:background"]')).toHaveCount(1);
  await expect.poll(async () => (await profiling(page)).computeTimings.some(timing => timing.phaseDurationsMs?.cachedNavigation != null)).toBe(true);
  const targets = await page.locator('[data-hit-region-target-id^="frame:"]').evaluateAll(regions =>
    regions.map(region => region.getAttribute("data-hit-region-target-id")!));
  expect(targets.length).toBeGreaterThan(0);
  expect(targets.every(id => id.startsWith("frame:1:"))).toBe(true);
});

test("a new source revision cannot reuse cached SVG or old text geometry", async ({ page }) => {
  await page.getByTestId("figure-navigator").getByRole("button", { name: "2. Second", exact: true }).click();
  await expect(page.getByTestId("canvas-svg-layer").locator('[data-part-id="frame:1:background"]')).toHaveCount(1);
  await page.getByTestId("figure-navigator").getByRole("button", { name: "1. First", exact: true }).click();
  await resetProfiling(page);
  const latest = DECK.replace("Second slide.", "New second slide.");
  await page.evaluate(source => (window as typeof window & {
    __TIKZ_EDITOR_APP_TEST_API__: { setSource: (source: string) => void };
  }).__TIKZ_EDITOR_APP_TEST_API__.setSource(source), latest);
  await page.getByTestId("figure-navigator").getByRole("button", { name: "2. Second", exact: true }).click();
  const glyph = page.getByTestId("canvas-svg-layer").locator(`path[data-source-start="${latest.indexOf("New second slide.")}"]`);
  await expect(glyph).toHaveAttribute("data-tex-glyph", "78");
  await expect.poll(() => page.evaluate(() => (window as typeof window & {
    __TIKZ_EDITOR_APP_TEST_API__: { getSnapshotSource: () => string };
  }).__TIKZ_EDITOR_APP_TEST_API__.getSnapshotSource())).toBe(latest);
});
