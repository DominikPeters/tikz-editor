import { expect, test } from "@playwright/test";
import { gotoApp, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

test("source typing and undo keep later canvas text tied to its current source", async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {Alpha};
  \node[draw] at (3,0) {Later};
\end{tikzpicture}`;
  await setSource(page, source);
  const editor = page.locator(".cm-content").first();
  await editor.locator(".cm-line").nth(1).click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type(" extended", { delay: 10 });
  const updated = source.replace("Alpha", "Alpha extended");
  await expect.poll(() => readStoreSource(page)).toBe(updated);
  const laterGlyph = page.locator('svg[data-source-id="path:1"][data-text-renderer="tex"] [data-tex-glyph]').first();
  await expect(laterGlyph).toHaveAttribute("data-source-start", String(updated.indexOf("Later")));
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(source);
  await expect(laterGlyph).toHaveAttribute("data-source-start", String(source.indexOf("Later")));
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect.poll(() => readStoreSource(page)).toBe(updated);
  await expect(laterGlyph).toHaveAttribute("data-source-start", String(updated.indexOf("Later")));
});
