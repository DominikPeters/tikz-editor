import { expect, test } from "@playwright/test";

import {
  gotoApp,
  openMenuCommand,
  readStoreSource,
  resetStorageBeforeNavigation,
  setSource
} from "./helpers";

const UNSUPPORTED_ENVIRONMENT = String.raw`\begin{tcolorbox}Unrendered content\end{tcolorbox}`;
const SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Source cards}
Before.
${UNSUPPORTED_ENVIRONMENT}
After.
\end{frame}
\begin{frame}{Second slide}Other slide.\end{frame}
\end{document}`;

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, SOURCE);
});

test("source cards reveal the exact source, support replacement and undo", async ({ page }, testInfo) => {
  const card = page.locator('[data-testid="canvas-svg-layer"] [data-beamer-placeholder]');
  await expect(card).toHaveCount(1);
  const id = await card.getAttribute("data-beamer-placeholder");
  const hitRegion = page.locator(`[data-hit-region-deck-object-id="${id}"]`);
  await hitRegion.click();
  await expect(page.locator(".cm-content").first()).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(UNSUPPORTED_ENVIRONMENT);
  expect(await readStoreSource(page)).toBe(SOURCE);

  // Repeat after moving the caret: another click must reveal the complete span.
  await page.keyboard.press("ArrowLeft");
  await hitRegion.click();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(UNSUPPORTED_ENVIRONMENT);

  await page.keyboard.insertText("Replacement.");
  await expect.poll(() => readStoreSource(page)).toBe(
    SOURCE.replace(UNSUPPORTED_ENVIRONMENT, "Replacement.")
  );
  await expect(card).toHaveCount(0);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await expect(card).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("source-card.png"), fullPage: true });
});

test("a source card reopens a closed source panel", async ({ page }) => {
  const card = page.locator('[data-testid="canvas-svg-layer"] [data-beamer-placeholder]');
  await expect(card).toHaveCount(1);
  const id = await card.getAttribute("data-beamer-placeholder");
  await openMenuCommand(page, "view", "view.toggle-source-panel");
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await page.locator(`[data-hit-region-deck-object-id="${id}"]`).click();
  await expect(page.locator(".cm-content").first()).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(UNSUPPORTED_ENVIRONMENT);
  expect(await readStoreSource(page)).toBe(SOURCE);
});
