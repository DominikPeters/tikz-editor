import { expect, test, type Page } from "@playwright/test";
import { gotoApp, openMenuCommand, resetStorageBeforeNavigation, setSource, tabSwitchButtons } from "./helpers";

const SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Opening}First slide.\end{frame}
\begin{frame}{Results}Second slide.\end{frame}
\end{document}`;

test.use({ viewport: { width: 1800, height: 1000 } });
test.beforeEach(async ({ page }) => { await resetStorageBeforeNavigation(page); await gotoApp(page); });

async function expectBeamerLayout(page: Page) {
  const navigator = page.getByTestId("figure-navigator");
  await expect(navigator).toHaveAttribute("data-layout", "vertical");
  await expect(page.locator(".cm-editor")).toBeVisible();
  const slides = (await navigator.boundingBox())!;
  const canvas = (await page.getByTestId("canvas-viewport").boundingBox())!;
  const source = (await page.locator(".cm-editor").boundingBox())!;
  expect(slides.width).toBeGreaterThan(270);
  expect(slides.x + slides.width).toBeLessThanOrEqual(canvas.x + 2);
  expect(source.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
  expect(Math.abs(source.x - canvas.x)).toBeLessThan(3);
  expect(slides.y + slides.height).toBeGreaterThan(source.y + source.height - 3);
}

async function workspace(page: Page, id: string) {
  await page.getByTestId("menu-section-view").click();
  await page.getByRole("menuitem", { name: /^Workspace/u }).hover();
  await page.getByTestId(`menu-workspace-${id}`).click();
}

test("defaults to slides left and source below, and restores that layout through menus", async ({ page }, testInfo) => {
  await setSource(page, SOURCE);
  await expectBeamerLayout(page);
  await expect(page.getByRole("button", { name: "Show grid", exact: true })).toBeVisible();
  await expect(page.getByTestId("canvas-top-ruler")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("beamer-default-layout.png") });

  for (const panel of ["source", "figures"]) {
    await openMenuCommand(page, "view", `view.toggle-${panel}-panel`);
    await openMenuCommand(page, "view", `view.toggle-${panel}-panel`);
  }
  await expectBeamerLayout(page);
  await workspace(page, "canvasOnly");
  await expect(page.locator(".cm-editor")).toHaveCount(0);
  await workspace(page, "default");
  await expectBeamerLayout(page);
  await workspace(page, "canvasOnly");
  await openMenuCommand(page, "view", "view.reset-panel-layout");
  await expectBeamerLayout(page);
  await page.reload();
  await expectBeamerLayout(page);
});

test("remembers grid and rulers separately for each document kind across reload", async ({ page }) => {
  await openMenuCommand(page, "file", "file.new-beamer-document");
  await expect(page.getByRole("button", { name: "Show grid", exact: true })).toBeVisible();
  await expect(page.getByTestId("canvas-top-ruler")).toHaveCount(0);
  await openMenuCommand(page, "view", "view.toggle-grid");
  await openMenuCommand(page, "view", "view.toggle-rulers");
  await expect(page.getByTestId("canvas-top-ruler")).toBeVisible();
  await tabSwitchButtons(page).first().click();
  await expect(page.getByRole("button", { name: "Hide grid", exact: true })).toBeVisible();
  await expect(page.getByTestId("canvas-top-ruler")).toBeVisible();
  await openMenuCommand(page, "view", "view.toggle-grid");
  await openMenuCommand(page, "view", "view.toggle-rulers");
  await tabSwitchButtons(page).last().click();
  await expect(page.getByRole("button", { name: "Hide grid", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("canvas-top-ruler")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide grid", exact: true })).toBeVisible();
  await tabSwitchButtons(page).first().click();
  await expect(page.getByTestId("canvas-top-ruler")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show grid", exact: true })).toBeVisible();
});
