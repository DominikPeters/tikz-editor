import { expect, test, type Page } from "@playwright/test";
import { gotoApp, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}[label=start]{Start}
Editable introduction. \hyperlink{destination<2>}{Go to second overlay}.
See \cite{reference}.
\end{frame}
\begin{frame}[label=destination]{Destination}
First overlay. \only<2>{Second overlay.}
\hyperlink{start}{Return}
\end{frame}
\begin{frame}{References}
\begin{thebibliography}{9}
\bibitem{reference} A. Author. \newblock A title.
\end{thebibliography}
\end{frame}
\end{document}`;

const activeFrame = (page: Page) => page.evaluate(() =>
  (window as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { getActiveFigureId: () => string | null } }).__TIKZ_EDITOR_APP_TEST_API__.getActiveFigureId()
);

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, SOURCE);
});

test("clicks internal links and citations without changing the source", async ({ page }) => {
  await page.locator('[data-beamer-link="destination<2>"]').first().click();
  await expect.poll(() => activeFrame(page)).toBe("frame:1");
  await expect(page.getByRole("button", { name: "Next overlay" })).toBeDisabled();
  await page.locator('[data-beamer-link="start"]').first().click();
  await expect.poll(() => activeFrame(page)).toBe("frame:0");
  await page.locator('[data-beamer-link="Citation reference"]').first().click();
  await expect.poll(() => activeFrame(page)).toBe("frame:2");
  await expect(page.getByTestId("canvas-svg-layer").locator('[data-beamer-placeholder]')).toHaveCount(0);
  expect(await readStoreSource(page)).toBe(SOURCE);
});

test("disables link activation while editing slide text", async ({ page }) => {
  const link = page.locator('[data-beamer-link="destination<2>"]').first();
  await expect(link).toBeVisible();
  const region = page.locator('[data-hit-region-interaction-mode="text"]').first();
  await region.click({ position: { x: 2, y: 2 } });
  await expect(page.getByTestId("canvas-text-edit-textarea")).toBeAttached();
  await expect(page.locator("[data-beamer-link]")).toHaveCount(0);
  await expect.poll(() => activeFrame(page)).toBe("frame:0");
  await page.keyboard.press("Escape");
  await expect(link).toBeVisible();
});
