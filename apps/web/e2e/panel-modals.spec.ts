import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  gotoApp,
  openMenuCommand,
  resetStorageBeforeNavigation,
  selectAllSceneElements,
  setSource
} from "./helpers";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

const SAMPLE_SOURCE = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
  \node[draw] at (2,0) {B};
\end{tikzpicture}`;

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
});

test("panel modal closes on Escape events from outside the panel", async ({ page }) => {
  await openMenuCommand(page, "insert", "insert.equation");
  const modal = page.getByTestId("equation-modal");
  await expect(modal).toBeVisible();
  await expect(modal.locator("math-field")).toBeVisible();

  const fileMenuTrigger = page.getByTestId("menu-section-file");
  await fileMenuTrigger.evaluate((element) => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });

  await expect(modal).toHaveCount(0);
});

test("help menu opens the web about modal", async ({ page }) => {
  await expect(page.getByText("TikZ Editor Web")).toBeVisible();

  await openMenuCommand(page, "help", "help.show-about");

  const modal = page.getByTestId("about-modal");
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("heading", { name: "TikZ Editor Web" })).toBeVisible();
  await expect(modal.getByText(`Version ${packageJson.version}`, { exact: true })).toBeVisible();
  await expect(modal.getByText("Dominik Peters")).toBeVisible();
  await expect(modal.getByRole("link", { name: "https://tikz.dev/editor/" })).toHaveAttribute(
    "href",
    "https://tikz.dev/editor/"
  );
});

test("repeat panel closes on outside click without activating background UI", async ({ page }) => {
  await setSource(page, SAMPLE_SOURCE);
  await selectAllSceneElements(page);
  await openMenuCommand(page, "edit", "edit.repeat");
  await expect(page.getByTestId("repeat-modal")).toBeVisible();

  const fileMenuTrigger = page.getByTestId("menu-section-file");
  await expect(fileMenuTrigger).toHaveAttribute("aria-expanded", "false");

  const triggerBox = await fileMenuTrigger.boundingBox();
  if (!triggerBox) {
    throw new Error("Expected File menu trigger bounds.");
  }
  await page.mouse.click(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2);

  await expect(page.getByTestId("repeat-modal")).toHaveCount(0);
  await expect(fileMenuTrigger).toHaveAttribute("aria-expanded", "false");
});
