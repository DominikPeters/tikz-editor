import { expect, test, type Page } from "@playwright/test";
import { expectSourceCanvasConsistency, gotoApp, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const SOURCE = String.raw`\documentclass{beamer}
\usetheme{Madrid}
\definecolor{BrandInk}{HTML}{123456}
\colorlet{SoftInk}{BrandInk!20!white}
\setbeamercolor{structure}{fg=blue}
\setbeamercolor{palette primary}{use=structure,fg=white,bg=structure.fg!50!black}
\begin{document}
\begin{frame}{Content}Hello\end{frame}
\end{document}`;
const MOD = process.platform === "darwin" ? "Meta" : "Control";
test.use({ viewport: { width: 1600, height: 1050 } });
test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, SOURCE);
  await page.locator(".cm-line").filter({ hasText: "\\begin{frame}{Content}" }).click();
  for (const section of ["Info", "Theme", "Page", "Header & Footer"]) await page.getByRole("button", { name: section, exact: true }).click();
});

async function choose(page: Page, field: string, color: string): Promise<void> {
  await page.getByRole("button", { name: field, exact: true }).click();
  await page.getByRole("tab", { name: "Standard", exact: true }).click();
  await page.getByRole("button", { name: `${field} ${color}`, exact: true }).click();
  await page.keyboard.press("Escape");
}

async function reset(page: Page, field: string): Promise<void> {
  await page.getByRole("button", { name: field, exact: true }).click();
  await page.getByRole("button", { name: "Use Theme Color", exact: true }).click();
}

test("named colors retain spelling, update dependent chrome and support reset and history", async ({ page }) => {
  await choose(page, "Structure", "BrandInk");
  await expect.poll(() => readStoreSource(page)).toContain("\\setbeamercolor{structure}{fg=BrandInk}");
  await expect(page.getByRole("button", { name: "Structure", exact: true })).toHaveText("BrandInk");
  await expectSourceCanvasConsistency(page);
  await expect(page.getByTestId("canvas-svg-layer").locator('rect[fill="#091a2b"]').first()).toBeVisible();
  await reset(page, "Structure");
  await expect.poll(() => readStoreSource(page)).not.toContain("\\setbeamercolor{structure}");
  await expect.poll(() => readStoreSource(page)).toContain("\\definecolor{BrandInk}{HTML}{123456}");
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toContain("fg=BrandInk");
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect.poll(() => readStoreSource(page)).toContain("fg=BrandInk");
});

test("palette foreground and background have independent writes and resets", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Primary fill", exact: true }).locator('span[aria-hidden="true"]').first()).toHaveCSS("background-color", "rgb(0, 0, 128)");
  await choose(page, "Primary text", "black");
  await expect.poll(() => readStoreSource(page)).toContain("use=structure,fg=black,bg=structure.fg!50!black");
  await choose(page, "Primary fill", "white");
  await expect.poll(() => readStoreSource(page)).toContain("use=structure,fg=black,bg=white");
  await reset(page, "Primary text");
  await expect.poll(() => readStoreSource(page)).toContain("use=structure,bg=white");
  // Only an authored side offers the reset.
  await page.getByRole("button", { name: "Primary text", exact: true }).click();
  await expect(page.getByRole("button", { name: "Use Theme Color", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Primary fill", exact: true }).click();
  await expect(page.getByRole("button", { name: "Use Theme Color", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expectSourceCanvasConsistency(page);
});

test("a brightness drag commits only on release and creates one undo step", async ({ page }) => {
  await page.getByRole("button", { name: "Structure", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Structure brightness", exact: true });
  const box = await slider.boundingBox();
  if (!box) throw new Error("Missing brightness slider");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .8, box.y + box.height / 2, { steps: 8 });
  expect(await readStoreSource(page)).toBe(SOURCE);
  await page.mouse.up();
  await expect.poll(() => readStoreSource(page)).not.toBe(SOURCE);
  await page.keyboard.press("Escape");
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
});

test("custom xcolor expressions preserve spelling and Escape cancels an unfinished draft", async ({ page }) => {
  await page.getByRole("button", { name: "Structure", exact: true }).click();
  await page.getByRole("tab", { name: "Custom", exact: true }).click();
  await page.getByRole("textbox", { name: "xcolor", exact: true }).fill("green!30!white");
  await page.getByRole("tab", { name: "Custom", exact: true }).click();
  const input = page.getByRole("textbox", { name: "xcolor", exact: true });
  await input.fill("BrandInk!20!white");
  await input.press("Enter");
  await expect.poll(() => readStoreSource(page)).toContain("fg=BrandInk!20!white");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Structure", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect.poll(() => readStoreSource(page)).toContain("fg=BrandInk!20!white");
});

test("unsafe scoped colors link to source while unrelated color fields stay enabled", async ({ page }) => {
  await setSource(page, SOURCE.replace("\\begin{document}", "\\AtBeginDocument{\\setbeamercolor{structure}{fg=red}}\n\\begin{document}"));
  await expect(page.getByRole("button", { name: "Structure", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Text", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Show in Source", exact: true })).toHaveCount(1);
});

test("color controls are readable in light and dark mode", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.getByRole("button", { name: "Primary fill", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Primary text", exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`beamer-colors-${colorScheme}.png`) });
  }
});
