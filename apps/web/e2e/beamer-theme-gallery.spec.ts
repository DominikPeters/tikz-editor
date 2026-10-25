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

test("opening the gallery focuses the current tile and immediate Escape restores focus", async ({ page }) => {
  const change = page.getByRole("button", { name: "Change…" });
  await change.click();
  const gallery = page.getByRole("dialog", { name: "Themes" });
  await expect(gallery.locator("button[data-theme-id='moloch']")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(gallery.locator("button[data-theme-id='metropolis']")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(gallery).toHaveCount(0);
  await expect(change).toBeFocused();
  expect(await readStoreSource(page)).toBe(SOURCE);
});

test("theme options and component themes write, reset, undo and redo", async ({ page }) => {
  await page.getByRole("button", { name: "Numbering", exact: true }).click();
  await page.getByRole("option", { name: "Fraction", exact: true }).click();
  await expect.poll(() => readStoreSource(page)).toContain("progressbar=frametitle, numbering=fraction");
  const numbered = await readStoreSource(page);
  await page.getByRole("button", { name: "Show More", exact: true }).click();
  await page.getByRole("button", { name: "Color theme", exact: true }).click();
  await page.getByRole("option", { name: "beaver", exact: true }).click();
  await expect.poll(() => readStoreSource(page)).toContain("\\usecolortheme{beaver}");
  await page.getByRole("button", { name: "Color theme", exact: true }).click();
  await page.getByRole("option", { name: "From theme", exact: true }).click();
  await expect.poll(() => readStoreSource(page)).not.toContain("\\usecolortheme{beaver}");
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toContain("\\usecolortheme{beaver}");
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect.poll(() => readStoreSource(page)).not.toContain("\\usecolortheme{beaver}");
  expect((await readStoreSource(page)).trim()).toBe(numbered.trim());
});

test("presentation controls remain usable in an empty deck", async ({ page }) => {
  await setSource(page, String.raw`\documentclass{beamer}\begin{document}\end{document}`);
  await page.getByRole("button", { name: "Show More", exact: true }).click();
  await page.getByRole("button", { name: "Font theme", exact: true }).click();
  await page.getByRole("option", { name: "serif", exact: true }).click();
  await expect.poll(() => readStoreSource(page)).toContain("\\usefonttheme{serif}");
  await page.getByRole("button", { name: "Change…" }).click();
  await page.getByRole("dialog", { name: "Themes" }).locator("button[data-theme-id='berlin']").click();
  await expect.poll(() => readStoreSource(page)).toContain("\\usetheme{Berlin}");
  expect((await readStoreSource(page)).indexOf("\\usetheme")).toBeLessThan((await readStoreSource(page)).indexOf("\\begin{document}"));
});

test("scoped theme commands explain why writes are disabled", async ({ page }) => {
  await setSource(page, SOURCE.replace("\\usetheme[progressbar=frametitle]{moloch}", "\\AtBeginDocument{\\usetheme{moloch}}"));
  await expect(page.getByRole("button", { name: "Change…" })).toBeDisabled();
  await expect(page.getByText("This theme is set inside a group, hook or conditional. Edit it in Source.").first()).toBeVisible();
  await page.getByRole("button", { name: "Show in Source", exact: true }).first().click();
  await expect(page.locator(".cm-activeLine")).toContainText("AtBeginDocument");
});

test("Escape cancels a theme dimension draft and Enter commits once", async ({ page }) => {
  const source = SOURCE.replace("\\usetheme[progressbar=frametitle]{moloch}", "\\usetheme[width=2cm]{Berkeley}");
  await setSource(page, source);
  const width = page.getByRole("textbox", { name: "Width", exact: true });
  await width.fill("3cm");
  await width.press("Escape");
  expect(await readStoreSource(page)).toBe(source);
  await width.fill("3cm");
  await width.press("Enter");
  await expect.poll(() => readStoreSource(page)).toBe(source.replace("width=2cm", "width=3cm"));
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(source);
});

test("the narrow gallery keeps two columns with reserved scrollbars in light and dark mode", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.getByRole("button", { name: "Change…" }).click();
    const gallery = page.getByRole("dialog", { name: "Themes" });
    // Match platforms that reserve scrollbar space rather than overlaying it.
    await gallery.locator("[class*='_scroll_']").evaluate(element => { element.style.scrollbarGutter = "stable"; });
    const tiles = gallery.locator("button[data-theme-id]");
    const first = await tiles.nth(0).boundingBox();
    const second = await tiles.nth(1).boundingBox();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(Math.abs(first!.y - second!.y)).toBeLessThan(1);
    expect(second!.x).toBeGreaterThan(first!.x);
    await page.screenshot({ path: test.info().outputPath(`theme-gallery-${colorScheme}.png`) });
    await page.keyboard.press("Escape");
    await expect(gallery).toHaveCount(0);
  }
});
