import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoApp, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}[t]{Spacing}
\begin{columns}[T]
\begin{column}{.48\textwidth}
\begin{block}{Left}
First paragraph.\par
\medskip
Second paragraph.
\end{block}
\end{column}
\begin{column}{.48\textwidth}
\begin{block}{Right}Content above the gap.\end{block}
\vspace*{0em}
Content below the gap.
\end{column}
\end{columns}
\end{frame}
\end{document}`;

async function pointAtEdge(page: Page, handle: Locator) {
  const box = await handle.getByTestId("deck-spacing-edge").boundingBox();
  if (!box) throw new Error("Missing spacing edge handle");
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y);
  return point;
}

test.use({ viewport: { width: 1600, height: 1000 } });
test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, SOURCE);
  // Select the slide by placing the source caret inside its frame.
  await page.locator(".cm-line").filter({ hasText: "\\begin{frame}" }).click();
  await expect(page.getByTestId("deck-spacing-handle")).toHaveCount(2, { timeout: 30_000 });
});

test("spacing drag previews the source and is one undo step", async ({ page }) => {
  const handle = page.getByRole("spinbutton", { name: "Vertical spacing, medskip" });
  const point = await pointAtEdge(page, handle);
  await page.mouse.click(point.x, point.y);
  expect(await readStoreSource(page)).toBe(SOURCE);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y + 30, { steps: 8 });
  await expect.poll(() => readStoreSource(page)).not.toContain("\\medskip");
  await page.mouse.up();
  const changed = await readStoreSource(page);
  expect(changed.replace(/\\vspace\{[\d.]+pt\}/u, "\\medskip")).toBe(SOURCE);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await expect(handle).toHaveCount(1);
});

test("a zero spacing grip beside a column divider can drag negative", async ({ page }) => {
  await expect(page.getByTestId("deck-column-divider")).toHaveCount(1);
  const handle = page.getByRole("spinbutton", { name: "Vertical spacing, vspace" });
  const point = await pointAtEdge(page, handle);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y - 8, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => readStoreSource(page)).toMatch(/\\vspace\*\{-[\d.]+em\}/u);
  const changed = await readStoreSource(page);
  expect(changed.replace(/\\vspace\*\{-[\d.]+em\}/u, "\\vspace*{0em}")).toBe(SOURCE);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
});
