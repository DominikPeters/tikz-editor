import { expect, test } from "@playwright/test";
import { gotoApp, resetStorageBeforeNavigation, setSource } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("source completions offer live styles without commented ghost styles", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
% \tikzset{qualityghost/.style={red}}
\tikzset{qualitylive/.style={blue}}
\draw[quality
\end{tikzpicture}`);
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.press("ControlOrMeta+Home");
  await editor.press("ArrowDown");
  await editor.press("ArrowDown");
  await editor.press("ArrowDown");
  await editor.press("End");
  await editor.press("Control+Space");
  await expect(page.locator(".cm-completionLabel").filter({ hasText: /^qualitylive$/ })).toBeVisible();
  await expect(page.locator(".cm-completionLabel").filter({ hasText: /^qualityghost$/ })).toHaveCount(0);
});
