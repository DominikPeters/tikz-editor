import { expect, test } from "@playwright/test";
import { gotoApp, readSource, resetStorageBeforeNavigation, setSource } from "./helpers";

test.beforeEach(async ({ page }) => { await resetStorageBeforeNavigation(page); });

for (const [name, path] of [["number after closepath", "M0 0Z1 2"], ["number before command", "1 2"]]) {
  test(`malformed SVG ${name} returns through the existing canvas warning`, async ({ page }) => {
    await gotoApp(page);
    const source = String.raw`\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}`;
    await setSource(page, source);
    await page.evaluate(d => {
      const viewport = document.querySelector("[data-canvas-viewport='true']");
      if (!viewport) throw new Error("Canvas viewport missing");
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`], "malformed.svg", { type: "image/svg+xml" }));
      viewport.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    }, path);
    await expect(page.getByTestId("canvas-warning-message")).toContainText("SVG import failed:");
    expect(await readSource(page)).toBe(source);
    // A subsequent edit verifies the same editor remains usable after rejection.
    await setSource(page, source.replace("(1,1)", "(2,1)"));
    await expect.poll(() => readSource(page)).toContain("(2,1)");
  });
}

test("source font edits update native typewriter glyphs and can return to them", async ({ page }) => {
  await gotoApp(page);
  const source = String.raw`\begin{tikzpicture}\node[draw,font=\ttfamily] {iii};\end{tikzpicture}`;
  const textGlyphs = page.locator('[data-testid="canvas-svg-layer"] [data-tex-font="lmmono10-regular"]');
  const romanGlyphs = page.locator('[data-testid="canvas-svg-layer"] [data-tex-font="lmroman10-regular"]');
  await setSource(page, source);
  await expect(textGlyphs).toHaveCount(3);
  await expect(romanGlyphs).toHaveCount(0);
  await setSource(page, source.replace("ttfamily", "rmfamily"));
  await expect(romanGlyphs).toHaveCount(3);
  await expect(textGlyphs).toHaveCount(0);
  await setSource(page, source);
  await expect(textGlyphs).toHaveCount(3);
  await expect(romanGlyphs).toHaveCount(0);
});
