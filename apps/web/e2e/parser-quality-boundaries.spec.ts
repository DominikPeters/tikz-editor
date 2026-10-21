import { expect, test } from "@playwright/test";
import { expectSourceCanvasConsistency, gotoApp, readFigureCount, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("commented figure delimiters stay inert in the editor inventory", async ({ page }) => {
  await gotoApp(page);
  const source = String.raw`% \begin{tikzpicture}\draw (9,9)--(10,10);\end{tikzpicture}
\begin{tikzpicture}
% \end{tikzpicture}
\draw (0,0)--(1,0);
\end{tikzpicture}`;
  await setSource(page, source);
  await expect.poll(() => readFigureCount(page)).toBe(1);
  await expectSourceCanvasConsistency(page, { assertNoPendingRequest: true });
  await expect(page.getByRole("img", { name: "TikZ SVG preview" })).toBeVisible();
  await expect.poll(() => readStoreSource(page)).toBe(source);
});

test("figure navigator line labels update after source newline insertion and deletion", async ({ page }) => {
  await gotoApp(page);
  const source = String.raw`\begin{tikzpicture}
\node {First};
\end{tikzpicture}
\begin{tikzpicture}
\node {Second};
\end{tikzpicture}`;
  await setSource(page, source);
  await expect.poll(() => readFigureCount(page)).toBe(2);
  const navigator = page.getByTestId("figure-navigator");
  await expect(navigator).toContainText("Figure 2 (L4)");
  await setSource(page, source.replace("First", "First\nline"));
  await expectSourceCanvasConsistency(page, { assertNoPendingRequest: true });
  await expect(navigator).toContainText("Figure 2 (L5)");
  await setSource(page, source);
  await expectSourceCanvasConsistency(page, { assertNoPendingRequest: true });
  await expect(navigator).toContainText("Figure 2 (L4)");
});
