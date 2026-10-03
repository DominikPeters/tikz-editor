import { expect, test } from "@playwright/test";
import { expectSourceCanvasConsistency, gotoApp, resetStorageBeforeNavigation, setSource } from "./helpers";

test("body edits retain deck mode and declaration edits switch the root navigator", async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  const source = String.raw`% \documentclass{article}
\documentclass[10pt]{beamer}
\begin{document}
\begin{frame}{First}\begin{tikzpicture}\draw (0,0)--(1,0);\end{tikzpicture}\end{frame}
\begin{frame}{Second}\begin{tikzpicture}\draw (0,0)--(0,1);\end{tikzpicture}\end{frame}
\end{document}`;
  await setSource(page, source);
  const navigator = page.getByTestId("figure-navigator");
  await expect(navigator.getByRole("button", { name: "First", exact: true })).toBeVisible();
  const edited = source.replace("(1,0)", "(1.5,0)");
  await setSource(page, edited);
  await expect(navigator.getByRole("button", { name: "Second", exact: true })).toBeVisible();
  await expectSourceCanvasConsistency(page, { assertNoPendingRequest: true });
  const article = edited.replace("{beamer}", "{article}");
  await setSource(page, article);
  await expect(navigator.getByRole("button", { name: "Figure 1", exact: true })).toBeVisible();
  await expect(navigator.getByRole("button", { name: "Figure 2", exact: true })).toBeVisible();
  // Mode changes retire the old root selection. Choose a current root before
  // checking the source-owned rendered scene.
  await navigator.getByRole("button", { name: "Figure 1", exact: true }).click();
  await expectSourceCanvasConsistency(page, { minSceneSourceIds: 1, assertNoPendingRequest: true });
  await setSource(page, edited);
  await expect(navigator.getByRole("button", { name: "First", exact: true })).toBeVisible();
  await navigator.getByRole("button", { name: "First", exact: true }).click();
  await expectSourceCanvasConsistency(page, { assertNoPendingRequest: true });
});
