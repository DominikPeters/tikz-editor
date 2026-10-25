import { expect, test } from "@playwright/test";
import { gotoApp, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const SOURCE = String.raw`\documentclass[aspectratio=169]{beamer}
\usetheme[progressbar=frametitle]{moloch}
\title[Short]{A Long Title}
\author{Ada Lovelace}
\begin{document}
\begin{frame}
\titlepage
\end{frame}
\section{Intro}
\begin{frame}{Content}
\begin{itemize}
\item One
\end{itemize}
\end{frame}
\end{document}`;
const MOD = process.platform === "darwin" ? "Meta" : "Control";

test.use({ viewport: { width: 1600, height: 1000 } });
test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, SOURCE);
  await page.locator(".cm-line").filter({ hasText: "\\begin{frame}{Content}" }).click();
  await expect(page.getByRole("button", { name: "Change…" })).toBeVisible({ timeout: 30_000 });
});

test("the theme gallery previews on the canvas without editing, and applies with one undo", async ({ page }) => {
  await page.getByRole("button", { name: "Change…" }).click();
  const gallery = page.getByRole("dialog", { name: "Themes" });
  await expect(gallery).toBeVisible();
  await expect(gallery.locator("button[data-theme-id='moloch']")).toHaveAttribute("aria-pressed", "true");
  // Opening under the pointer previews nothing until it moves.
  await expect(page.getByTestId("canvas-theme-preview")).toHaveCount(0);

  const madrid = gallery.locator("button[data-theme-id='madrid']");
  await expect(madrid.locator("img")).toHaveCount(2, { timeout: 60_000 });
  await madrid.hover();
  await expect(page.getByTestId("canvas-theme-preview")).toHaveCount(1);
  expect(await readStoreSource(page)).toBe(SOURCE);

  await madrid.click();
  await expect(gallery).toHaveCount(0);
  await expect(page.getByTestId("canvas-theme-preview")).toHaveCount(0);
  // Madrid reads none of moloch's options, so the bracket goes.
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE.replace("\\usetheme[progressbar=frametitle]{moloch}", "\\usetheme{Madrid}"));
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
});

test("Escape closes the gallery and clears the preview", async ({ page }) => {
  await page.getByRole("button", { name: "Change…" }).click();
  const gallery = page.getByRole("dialog", { name: "Themes" });
  const warsaw = gallery.locator("button[data-theme-id='warsaw']");
  await expect(warsaw.locator("img")).toHaveCount(2, { timeout: 60_000 });
  await warsaw.focus();
  await expect(page.getByTestId("canvas-theme-preview")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(gallery).toHaveCount(0);
  await expect(page.getByTestId("canvas-theme-preview")).toHaveCount(0);
  expect(await readStoreSource(page)).toBe(SOURCE);
});
