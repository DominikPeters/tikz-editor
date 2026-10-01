import { expect, test, type Page } from "@playwright/test";
import type { AppProfilingSnapshot } from "../../../packages/app/src/profiling";
import {
  expectSourceCanvasConsistency,
  gotoApp,
  openMenuCommand,
  readSource,
  resetStorageBeforeNavigation,
  setCanvasTransform,
  setSource,
  waitForHitRegions
} from "./helpers";

const source = String.raw`\begin{tikzpicture}
  \draw (0,3) rectangle (2,1);
  \draw (3,2) rectangle (5,1);
\end{tikzpicture}`;
const ptPerCm = 28.4527559055;
const pointer = { pointerId: 19, pointerType: "mouse", button: 0, buttons: 1, bubbles: true };
type TestWindow = Window & {
  __TIKZ_EDITOR_APP_TEST_API__: {
    selectSourceIds: (ids: string[]) => void;
    resetProfilingSession: (label: string) => void;
    getProfilingSnapshot: () => AppProfilingSnapshot;
  };
};

async function startResize(page: Page) {
  await page.evaluate(() => (window as TestWindow).__TIKZ_EDITOR_APP_TEST_API__.selectSourceIds(["path:1"]));
  const handle = page.locator('[data-handle-kind="resize-element"][data-source-id="path:1"][data-resize-role="top-right"]');
  await expect(handle).toBeVisible();
  const start = await handle.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  });
  await handle.dispatchEvent("pointerdown", { ...pointer, clientX: start.x, clientY: start.y });
  return start;
}

async function moveResize(page: Page, start: { x: number; y: number }, dx: number, dy: number, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}) {
  await page.evaluate(init => window.dispatchEvent(new PointerEvent("pointermove", init)), {
    ...pointer, ...modifiers, clientX: start.x + dx * ptPerCm, clientY: start.y - dy * ptPerCm
  });
  await expectSourceCanvasConsistency(page);
}

async function finishResize(page: Page) {
  await page.evaluate(pointer => window.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 })), pointer);
  await expectSourceCanvasConsistency(page, { assertNoActiveCanvasDrag: true });
}

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, source);
  await waitForHitRegions(page, 2);
  await expectSourceCanvasConsistency(page);
  await setCanvasTransform(page, { translateX: 100, translateY: 100, scale: 1 });
});

test("rectangle resize snaps, stays incremental, and undoes as one edit", async ({ page }) => {
  const start = await startResize(page);
  await page.evaluate(() => (window as TestWindow).__TIKZ_EDITOR_APP_TEST_API__.resetProfilingSession("rectangle-resize"));
  for (const dy of [0.4, 0.5, 0.6, 0.7, 0.8, 0.94]) {
    await moveResize(page, start, 0.1, dy);
  }
  await expect.poll(() => readSource(page)).toContain("(3,3) rectangle (5,1)");
  await expect(page.locator("g[class*='snapOverlay']")).toHaveCount(1);
  const profile = await page.evaluate(() => (window as TestWindow).__TIKZ_EDITOR_APP_TEST_API__.getProfilingSnapshot());
  const edits = profile.computeTimings.filter(timing => (timing.changedSourceCount ?? 0) > 0);
  expect(edits.length).toBeGreaterThan(1);
  expect(edits.every(timing => timing.incremental && timing.parseStrategy === "incremental" && timing.semanticStrategy === "incremental")).toBe(true);
  expect(profile.svgPatchTimings.some(timing => timing.hasReplaceAll || timing.forceReplaceAll)).toBe(false);
  await finishResize(page);
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readSource(page)).toBe(source);
  await expectSourceCanvasConsistency(page);
});

test("rectangle resize respects aspect locking, snap bypass, and returning to its starting size", async ({ page }) => {
  const start = await startResize(page);
  await moveResize(page, start, 1.88, 0.94, { shiftKey: true });
  await expect.poll(() => readSource(page)).toContain("(3,3) rectangle (7,1)");
  await expect(page.locator("g[class*='snapOverlay']")).toHaveCount(1);
  await moveResize(page, start, 0.1, 0.94, { ctrlKey: true });
  await expect.poll(() => readSource(page)).toContain("(3,2.94) rectangle (5.1,1)");
  await expect(page.locator("g[class*='snapOverlay']")).toHaveCount(0);
  await moveResize(page, start, 0.04, -0.04);
  await expect.poll(() => readSource(page)).toBe(source);
  await finishResize(page);
});

test("rectangle resize consumes pointer updates that arrive before recompute finishes", async ({ page }) => {
  const start = await startResize(page);
  await page.evaluate(({ pointer, start, ptPerCm }) => {
    for (const [dx, dy] of [[0.31, 0.4], [0.38, 0.6], [0.1, 0.94]]) {
      window.dispatchEvent(new PointerEvent("pointermove", {
        ...pointer, clientX: start.x + dx * ptPerCm, clientY: start.y - dy * ptPerCm
      }));
    }
  }, { pointer, start, ptPerCm });
  await expect.poll(() => readSource(page)).toContain("(3,3) rectangle (5,1)");
  await expectSourceCanvasConsistency(page);
  await expect(page.locator("g[class*='snapOverlay']")).toHaveCount(1);
  await finishResize(page);
});

test("an unrelated source edit cancels the rectangle resize baseline", async ({ page }) => {
  const start = await startResize(page);
  await moveResize(page, start, 0.1, 0.94);
  const externalSource = (await readSource(page)).replace("(0,3)", "(0,4)");
  await setSource(page, externalSource);
  await expectSourceCanvasConsistency(page, { assertNoActiveCanvasDrag: true });
  await moveResize(page, start, 0, 0);
  await expect.poll(() => readSource(page)).toBe(externalSource);
  await expect(page.locator("g[class*='snapOverlay']")).toHaveCount(0);
});
