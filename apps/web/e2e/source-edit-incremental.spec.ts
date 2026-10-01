import { expect, test } from "@playwright/test";
import { gotoApp, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

test("source typing and undo keep later canvas text tied to its current source", async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  const source = String.raw`\begin{tikzpicture}
  \node[draw, minimum width=5cm] at (0,0) {Alpha};
  \node[draw] at (6,0) {Later};
\end{tikzpicture}`;
  await setSource(page, source);
  const laterText = page.locator('svg[data-source-id="path:1"][data-text-renderer="tex"]');
  const laterGlyph = laterText.locator('[data-tex-glyph]').first();
  await expect(laterGlyph).toBeVisible();
  const originalGlyph = await laterGlyph.elementHandle();
  const sourceStart = () => page.evaluate(() => {
    const api = (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__?: {
      getSceneTextDebug?: () => Array<{ sourceId: string; sourceStart: number }>;
    } }).__TIKZ_EDITOR_APP_TEST_API__;
    return api?.getSceneTextDebug?.().find(text => text.sourceId === "path:1")?.sourceStart;
  });
  const editor = page.locator(".cm-content").first();
  await editor.locator(".cm-line").nth(1).click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type(" extended", { delay: 10 });
  const updated = source.replace("Alpha", "Alpha extended");
  await expect.poll(() => readStoreSource(page)).toBe(updated);
  await expect.poll(sourceStart).toBe(updated.indexOf("Later"));
  await expect(laterText).toHaveAttribute("data-source-coordinate-space", "layout");
  await expect(laterGlyph).toHaveAttribute("data-source-start", "0");
  expect(await laterGlyph.evaluate((node, original) => node === original, originalGlyph)).toBe(true);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(source);
  await expect.poll(sourceStart).toBe(source.indexOf("Later"));
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect.poll(() => readStoreSource(page)).toBe(updated);
  await expect.poll(sourceStart).toBe(updated.indexOf("Later"));
  // Hit testing uses this snapshot's resolved reports even though glyph DOM
  // and its paragraph-local source attributes have stayed unchanged.
  const textRegion = page.locator('[data-hit-region-target-id="path:1"][data-hit-region-interaction-mode="text"]').first();
  await textRegion.click();
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toHaveValue("Later");
  await expect(page.getByTestId("canvas-text-selection-caret")).toBeVisible();
  await textarea.press("Home");
  await textarea.press("ArrowRight");
  await textarea.press("ArrowRight");
  await page.keyboard.type("X");
  await expect.poll(() => readStoreSource(page)).toBe(updated.replace("Later", "LaXter"));
});
