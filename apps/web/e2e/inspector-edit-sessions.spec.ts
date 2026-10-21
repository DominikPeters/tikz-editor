import { expect, test } from "@playwright/test";
import type { AppProfilingSnapshot } from "../../../packages/app/src/profiling";
import { expectSourceCanvasConsistency, gotoApp, openMenuCommand, readSource, resetStorageBeforeNavigation, setSource, waitForHitRegions } from "./helpers";

type TestWindow = Window & { __TIKZ_EDITOR_APP_TEST_API__: {
  selectSourceIds: (ids: string[]) => void;
  getSourceRevision: () => number;
  resetProfilingSession: (label: string) => void;
  getProfilingSnapshot: () => AppProfilingSnapshot;
} };
const pointer = { pointerId: 43, pointerType: "mouse", button: 0, buttons: 1, bubbles: true };
const source = String.raw`\begin{tikzpicture}
\node[draw,inner sep=2pt] at (0,0) {First};
\node[draw,inner sep=2pt] at (3,0) {Second};
\end{tikzpicture}`;

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page); await gotoApp(page); await setSource(page, source); await waitForHitRegions(page, 2);
});

test("inspector scrub coalesces moves, keeps the release position, and makes one undo step", async ({ page }) => {
  await page.evaluate(() => (window as TestWindow).__TIKZ_EDITOR_APP_TEST_API__.selectSourceIds(["path:0"]));
  const label = page.getByText("Inner sep", { exact: true }).first();
  await expect(label).toBeVisible();
  const box = await label.boundingBox();
  if (!box) throw new Error("Missing inspector label");
  const initial = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await label.dispatchEvent("pointerdown", { ...pointer, clientX: initial.x, clientY: initial.y });
  await page.evaluate(({ pointer, initial }) => {
    (window as TestWindow).__TIKZ_EDITOR_APP_TEST_API__.resetProfilingSession("inspector-scrub");
    for (const x of [8, 16, 24]) window.dispatchEvent(new PointerEvent("pointermove", { ...pointer, clientX: initial.x + x, clientY: initial.y }));
  }, { pointer, initial });
  await expect.poll(() => readSource(page)).toContain("inner sep=2.3pt");
  await expectSourceCanvasConsistency(page);
  const profile = await page.evaluate(() => (window as TestWindow).__TIKZ_EDITOR_APP_TEST_API__.getProfilingSnapshot());
  const edits = profile.computeTimings.filter(timing => (timing.changedSourceCount ?? 0) > 0);
  expect(edits.length).toBeGreaterThan(0);
  expect(edits.every(timing => timing.parseStrategy === "incremental" && timing.semanticStrategy === "incremental")).toBe(true);
  await page.evaluate(({ pointer, initial }) => {
    window.dispatchEvent(new PointerEvent("pointermove", { ...pointer, clientX: initial.x + 32, clientY: initial.y }));
    window.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0, clientX: initial.x + 48, clientY: initial.y }));
  }, { pointer, initial });
  await expect.poll(() => readSource(page)).toContain("inner sep=2.6pt");
  await expectSourceCanvasConsistency(page);
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readSource(page)).toBe(source);
});

test("multi-selection inspector changes update both targets in one revision and undo step", async ({ page }) => {
  await page.evaluate(() => (window as TestWindow).__TIKZ_EDITOR_APP_TEST_API__.selectSourceIds(["path:0", "path:1"]));
  const label = page.getByText("Inner sep", { exact: true }).first();
  const input = label.locator("xpath=following::input[@type='number'][1]");
  await expect(input).toBeVisible();
  const revision = await page.evaluate(() => (window as TestWindow).__TIKZ_EDITOR_APP_TEST_API__.getSourceRevision());
  await page.evaluate(() => (window as TestWindow).__TIKZ_EDITOR_APP_TEST_API__.resetProfilingSession("multi-property"));
  await input.fill("4");
  await expect.poll(async () => (await readSource(page)).match(/inner sep=4pt/g)?.length).toBe(2);
  expect(await page.evaluate(() => (window as TestWindow).__TIKZ_EDITOR_APP_TEST_API__.getSourceRevision())).toBe(revision + 1);
  await expectSourceCanvasConsistency(page);
  const profile = await page.evaluate(() => (window as TestWindow).__TIKZ_EDITOR_APP_TEST_API__.getProfilingSnapshot());
  const edits = profile.computeTimings.filter(timing => (timing.changedSourceCount ?? 0) > 0);
  expect(edits.length).toBeGreaterThan(0);
  expect(edits.every(timing => timing.parseStrategy === "incremental" && timing.semanticStrategy === "incremental")).toBe(true);
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readSource(page)).toBe(source);
});
