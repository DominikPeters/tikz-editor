import { expect, test } from "@playwright/test";
import {
  expectSourceCanvasConsistency,
  gotoApp,
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

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, source);
  await waitForHitRegions(page, 2);
  await setCanvasTransform(page, { translateX: 100, translateY: 100, scale: 1 });
});

for (const direction of [1, -1]) {
  test(`rectangle drag returns to its exact source after fractional moves (${direction})`, async ({ page }) => {
    const region = page.locator("[data-hit-region-target-id='path:1']").first();
    const start = await region.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    });
    const pointer = { pointerId: 17, pointerType: "mouse", button: 0, buttons: 1, bubbles: true };
    // Synthetic events preserve fractional client coordinates, making the
    // accumulated-rounding regression independent of display pixel density.
    await region.dispatchEvent("pointerdown", { ...pointer, clientX: start.x, clientY: start.y });
    for (const deltaCm of [0.31, 0.326, 0.342, 0.358, 0.374, 0.39, 0]) {
      await page.evaluate(({ pointer, x, y }) => {
        window.dispatchEvent(new PointerEvent("pointermove", { ...pointer, clientX: x, clientY: y }));
      }, { pointer, x: start.x + direction * deltaCm * ptPerCm, y: start.y });
      const left = Math.round((3 + direction * deltaCm) * 100) / 100;
      const right = Math.round((5 + direction * deltaCm) * 100) / 100;
      await expect.poll(() => readSource(page)).toContain(`(${left},2) rectangle (${right},1)`);
      await expectSourceCanvasConsistency(page);
      await expect(page.locator("g[class*='snapOverlay']")).toHaveCount(1);
    }
    await page.evaluate(({ pointer, start }) => {
      window.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0, clientX: start.x, clientY: start.y }));
    }, { pointer, start });
    await expect.poll(() => readSource(page)).toBe(source);
    await expectSourceCanvasConsistency(page, { assertNoActiveCanvasDrag: true });
  });
}
