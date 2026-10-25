import { expect, test, type Page } from "@playwright/test";
import { expectSourceCanvasConsistency, gotoApp, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const SOURCE = String.raw`\documentclass[aspectratio=169,10pt,handout]{beamer}
\usetheme{Madrid}
\title{\LARGE A long $x$ title}
\author{Ada Lovelace}
\begin{document}
\begin{frame}{Content}
Hello
\end{frame}
\end{document}`;
const MOD = process.platform === "darwin" ? "Meta" : "Control";

test.use({ viewport: { width: 1600, height: 1050 } });
test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, SOURCE);
  await page.locator(".cm-line").filter({ hasText: "\\begin{frame}{Content}" }).click();
  await expect(page.getByRole("button", { name: "Aspect ratio", exact: true })).toBeEnabled();
});

async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("page controls update geometry, preserve other options and support reset and history", async ({ page }) => {
  await choose(page, "Aspect ratio", "4:3");
  await expect.poll(() => readStoreSource(page)).toContain("aspectratio=43,10pt,handout");
  await expectSourceCanvasConsistency(page);
  const svg = page.getByTestId("canvas-svg-layer").locator("svg").first();
  await expect.poll(async () => {
    const box = (await svg.getAttribute("viewBox"))?.split(/\s+/u).map(Number);
    return box && box.length === 4 ? box[2] / box[3] : 0;
  }).toBeCloseTo(4 / 3);
  await choose(page, "Font size", "12 pt");
  await expect.poll(() => readStoreSource(page)).toContain("aspectratio=43,12pt,handout");
  await choose(page, "Font size", "Default (11 pt)");
  await expect.poll(() => readStoreSource(page)).not.toContain("12pt");
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toContain("12pt");
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect.poll(() => readStoreSource(page)).not.toContain("12pt");
  await choose(page, "Aspect ratio", "Default (4:3)");
  await expect.poll(() => readStoreSource(page)).toContain("\\documentclass[handout]{beamer}");
});

test("navigation symbols can override a modern theme and reset to its default", async ({ page }) => {
  const source = SOURCE.replace("{Madrid}", "{moloch}");
  await setSource(page, source);
  const navigation = page.getByRole("button", { name: "Navigation", exact: true });
  await expect(navigation).toHaveText("From theme");
  await choose(page, "Navigation", "Symbols shown");
  await expect.poll(() => readStoreSource(page)).toContain("\\setbeamertemplate{navigation symbols}[default]");
  await expect(navigation).toHaveText("Symbols shown");
  await expectSourceCanvasConsistency(page);
  await choose(page, "Navigation", "From theme");
  await expect.poll(() => readStoreSource(page)).toBe(source);
  await expect(navigation).toHaveText("From theme");
});

test("short title editing falls back to the full title when cleared", async ({ page }) => {
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await expect(title).toHaveAttribute("placeholder", "\\LARGE A long $x$ title");
  await title.fill("Short $x$");
  await title.press("Enter");
  await expect.poll(() => readStoreSource(page)).toContain("\\title[Short $x$]{\\LARGE A long $x$ title}");
  await expectSourceCanvasConsistency(page);
  await title.fill("");
  await title.press("Enter");
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toContain("\\title[Short $x$]{");
});

test("Escape discards a metadata draft without a blur commit", async ({ page }) => {
  const author = page.getByRole("textbox", { name: "Author", exact: true });
  await author.fill("Uncommitted draft");
  await author.press("Escape");
  await expect(author).toHaveValue("");
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
});

test("page and metadata writes work without a slide", async ({ page }) => {
  await setSource(page, String.raw`\documentclass{beamer}\usetheme{Madrid}\begin{document}\end{document}`);
  await choose(page, "Aspect ratio", "16:9");
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("Header title");
  await title.press("Enter");
  await expect.poll(() => readStoreSource(page)).toContain("\\title[Header title]{}");
  await expect.poll(() => readStoreSource(page)).toContain("aspectratio=169");
});

test("scoped metadata and custom navigation code stay read-only", async ({ page }) => {
  await setSource(page, SOURCE.replace("\\begin{document}", "\\AtBeginDocument{\\title{Deferred}}\n\\addtobeamertemplate{navigation symbols}{}{Custom}\n\\begin{document}"));
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Navigation", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Aspect ratio", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Show in Source", exact: true })).toHaveCount(2);
});

test("page and footer fields remain readable in light and dark mode", async ({ page }) => {
  for (const section of ["Info", "Colors", "Theme"]) await page.getByRole("button", { name: section, exact: true }).click();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.getByRole("button", { name: "Aspect ratio", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`page-metadata-${colorScheme}.png`) });
  }
});
