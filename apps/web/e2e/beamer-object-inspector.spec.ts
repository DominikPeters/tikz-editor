import { expect, test, type Page } from "@playwright/test";
import { gotoApp, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Columns}
\begin{columns}[T]
\begin{column}{.5\textwidth}
\includegraphics[width=.9\textwidth]{figure.png}
\end{column}
\begin{column}{.45\textwidth}
\begin{tikzpicture}
\draw (0,0) rectangle (2,1.5);
\end{tikzpicture}
\end{column}
\end{columns}
\begin{lstlisting}
x = 1
\end{lstlisting}
\end{frame}
\end{document}`;

test.use({ viewport: { width: 1600, height: 1000 } });
test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, SOURCE);
  await page.locator(".cm-line").filter({ hasText: "\\begin{frame}" }).click();
  await expect(page.locator("[data-hit-region-deck-object-id$='columns:0:column:1']")).toHaveCount(1, { timeout: 30_000 });
});

/**
 * Selects a slide object by its hit region and waits for the inspector to
 * show it. Hit regions are rebuilt with each render, so a click right after
 * an edit can land on one being replaced; the click repeats until it takes.
 */
async function select(page: Page, idPart: string, title: string): Promise<void> {
  await expect(async () => {
    // Object ids carry source offsets, so select on a render of the current source.
    await page.waitForFunction(() => {
      const api = (window as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { getSource: () => string; getSnapshotSource: () => string } }).__TIKZ_EDITOR_APP_TEST_API__;
      return api.getSnapshotSource() === api.getSource();
    }, null, { timeout: 2_000 });
    await page.locator(`[data-hit-region-deck-object-id*='${idPart}']`).first().click({ force: true, timeout: 2_000 });
    await expect(page.locator("[class*='_header_']").filter({ hasText: new RegExp(`^${title}$`, "u") })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

test("columns alignment, column placement and image flags write their options", async ({ page }) => {
  // Escape on the canvas selects the parent: the columns around a column.
  await select(page, "columns:0:column:1", "Column");
  await page.keyboard.press("Escape");
  await expect(page.locator("[class*='_header_']").filter({ hasText: /^Columns$/u })).toBeVisible();
  await page.getByRole("button", { name: "Alignment" }).click();
  await page.getByRole("option", { name: "First baseline" }).click();
  await expect.poll(() => readStoreSource(page)).toContain("\\begin{columns}[t]");

  await select(page, "columns:0:column:1", "Column");
  await page.getByRole("button", { name: "Alignment" }).click();
  await page.getByRole("option", { name: "Bottom" }).click();
  await expect.poll(() => readStoreSource(page)).toContain("\\begin{column}[b]{.45\\textwidth}");

  await select(page, ":graphics:", "Image");
  // The box follows the source, so it ticks once the write lands.
  await page.getByRole("checkbox", { name: "Keep aspect ratio" }).click();
  await expect.poll(() => readStoreSource(page)).toContain("\\includegraphics[width=.9\\textwidth, keepaspectratio]{figure.png}");
  // The write renames the image (its id ends in its text range); it stays selected.
  await expect(page.getByRole("checkbox", { name: "Keep aspect ratio" })).toBeChecked();
});

test("Edit Drawing opens the picture for editing", async ({ page }) => {
  await select(page, "column:1:tikz:0", "Drawing");
  await page.getByRole("button", { name: "Edit Drawing" }).click();
  await expect(page.getByTestId("nested-figure-breadcrumb")).toBeVisible();
  expect(await readStoreSource(page)).toBe(SOURCE);
});

test("Show in Source puts the source caret in unsupported content", async ({ page }) => {
  await select(page, "unsupported", "Unsupported content");
  await expect(page.getByRole("button", { name: "Show in Source" })).toBeVisible();
  await page.getByRole("button", { name: "Show in Source" }).click();
  await expect(page.locator(".cm-activeLine")).toContainText("lstlisting");
});
