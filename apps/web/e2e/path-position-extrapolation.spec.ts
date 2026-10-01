import { expect, test } from "@playwright/test";
import {
  clickTextHitRegionByTargetId,
  dragHitRegionByTargetIdAndMode,
  expectSourceCanvasConsistency,
  gotoApp,
  readSource,
  resetStorageBeforeNavigation,
  setSource,
  waitForHitRegions
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
});

for (const position of [-0.5, 2]) {
  test(`dragging a label at pos=${position} preserves extrapolation and undo`, async ({ page }) => {
    const source = String.raw`\begin{tikzpicture}\draw (0,0) -- (2,0) node[pos=${position}] {Label};\end{tikzpicture}`;
    await setSource(page, source);
    await waitForHitRegions(page, 2);
    const text = page.locator('[data-hit-region-interaction-mode="text"]').first();
    const targetId = await text.getAttribute("data-hit-region-target-id");
    if (!targetId) throw new Error("Missing label target");
    await dragHitRegionByTargetIdAndMode(page, targetId, "text", position < 0 ? -30 : 30, 0);
    await expect.poll(() => readSource(page)).not.toBe(source);
    const edited = await readSource(page);
    const match = /pos=([+-]?\d+(?:\.\d+)?)/u.exec(edited);
    if (!match) throw new Error(`Expected extrapolated pos in ${edited}`);
    const movedPosition = Number(match[1]);
    if (position < 0) expect(movedPosition).toBeLessThan(position);
    else expect(movedPosition).toBeGreaterThan(position);
    await expectSourceCanvasConsistency(page, { assertNoActiveCanvasDrag: true });
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => readSource(page)).toBe(source);
    await expectSourceCanvasConsistency(page, { assertNoActiveCanvasDrag: true });
    await clickTextHitRegionByTargetId(page, targetId);
    await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveValue("Label");
    const slider = page.locator('input[type="range"][list="slider-ticks-path-attached-node-position"]');
    await expect(slider).toHaveValue(String(position));
    const bounds = await slider.evaluate(element => ({ min: Number(element.getAttribute("min")), max: Number(element.getAttribute("max")) }));
    expect(bounds.min).toBeLessThanOrEqual(position);
    expect(bounds.max).toBeGreaterThanOrEqual(position);
  });
}

test("dragging an ordinary path label can cross the endpoint", async ({ page }) => {
  const source = String.raw`\begin{tikzpicture}\draw (0,0) -- (2,0) node[pos=.9] {Label};\end{tikzpicture}`;
  await setSource(page, source);
  await waitForHitRegions(page, 2);
  const targetId = await page.locator('[data-hit-region-interaction-mode="text"]').first().getAttribute("data-hit-region-target-id");
  if (!targetId) throw new Error("Missing label target");
  await dragHitRegionByTargetIdAndMode(page, targetId, "text", 70, 0);
  await expect.poll(() => readSource(page)).not.toBe(source);
  const match = /pos=([+-]?\d+(?:\.\d+)?)/u.exec(await readSource(page));
  expect(match).not.toBeNull();
  expect(Number(match?.[1])).toBeGreaterThan(1);
  await expectSourceCanvasConsistency(page, { assertNoActiveCanvasDrag: true });
});
