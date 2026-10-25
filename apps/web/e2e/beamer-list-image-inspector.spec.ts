import { expect, test, type Page } from "@playwright/test";
import { expectSourceCanvasConsistency, gotoApp, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Objects}
\begin{enumerate}[<+->][(a)]
\item Alpha
\item<2->[Custom] Beta
\end{enumerate}
\begin{enumerate}[I.]
\item Gamma
\end{enumerate}
\includegraphics[width=.35\textwidth,trim=1 2 3 4,clip,page=3]{old.pdf}
\end{frame}
\end{document}`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><rect width="60" height="30" fill="red"/></svg>';
const MOD = process.platform === "darwin" ? "Meta" : "Control";
test.use({ viewport: { width: 1600, height: 1050 } });
test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await page.addInitScript(() => { Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined }); });
  await gotoApp(page);
  await setSource(page, SOURCE);
  await page.locator(".cm-line").filter({ hasText: "\\begin{frame}{Objects}" }).click();
});

async function select(page: Page, part: string, title: string, occurrence = 0): Promise<void> {
  await expect(async () => {
    await expectSourceCanvasConsistency(page);
    await page.locator(`[data-hit-region-deck-object-id*='${part}']`).nth(occurrence).click({ force: true, timeout: 2000 });
    await expect(page.locator("[class*='_header_']").filter({ hasText: new RegExp(`^${title}$`, "u") })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}
async function firstList(page: Page, occurrence = 0): Promise<void> {
  await expectSourceCanvasConsistency(page);
  const offset = (await readStoreSource(page)).indexOf(occurrence === 0 ? "Alpha" : "Gamma");
  await page.getByTestId("canvas-svg-layer").locator(`path[data-source-start='${offset}']`).first().click({ force: true });
  await expect(page.getByTestId("canvas-text-edit-textarea")).toBeAttached();
  for (let level = 0; level < 4; level++) {
    await page.keyboard.press("Escape");
    try {
      await expect(page.getByRole("button", { name: "Reveal", exact: true })).toBeVisible({ timeout: 400 });
      return;
    } catch { /* Bar focus exits to the canvas, then the item and list. */ }
  }
  await expect(page.getByRole("button", { name: "Reveal", exact: true })).toBeVisible();
}
async function choose(page: Page, label: string, choice: string): Promise<void> {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("option", { name: choice, exact: true }).click();
}
async function replace(page: Page, name = "Replacement.svg", mimeType = "image/svg+xml", content = SVG): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Replace Image…", exact: true }).click();
  await (await chooser).setFiles({ name, mimeType, buffer: Buffer.from(content) });
}

function tinyPdf(): string {
  const stream = "1 0 0 rg 0 0 60 30 re f\n";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 60 30] /Resources << >> /Contents 4 0 R >>", `<< /Length ${stream.length} >>\nstream\n${stream}endstream`];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(source.length); source += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = source.length;
  source += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return source;
}

test("a replacement PDF starts on page one and keeps PDF controls", async ({ page }) => {
  await select(page, ":graphics:", "Image");
  await replace(page, "Replacement.pdf", "application/pdf", tinyPdf());
  await expect.poll(() => readStoreSource(page)).toContain("/Replacement.pdf}");
  await expect.poll(() => readStoreSource(page)).not.toContain("page=");
  await expect(page.getByRole("spinbutton", { name: "Page", exact: true })).toHaveValue("1");
  await expectSourceCanvasConsistency(page);
  await expect(page.getByTestId("canvas-svg-layer").locator("image").first()).toBeVisible();
});

test("list reveal and labels round-trip with independent item overlays and undo/redo", async ({ page }) => {
  await firstList(page);
  await choose(page, "Reveal", "All at once");
  await expect.poll(() => readStoreSource(page)).toContain("\\begin{enumerate}[<1->][(a)]");
  const before = await readStoreSource(page);
  const labels = page.getByRole("textbox", { name: "Labels", exact: true });
  await labels.fill("A.");
  await labels.press("Enter");
  await expect.poll(() => readStoreSource(page)).toContain("[<1->][A.]");
  await expect.poll(() => readStoreSource(page)).toContain("\\item<2->[Custom] Beta");
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(before);
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect.poll(() => readStoreSource(page)).toContain("[<1->][A.]");
});

test("list conversion removes enumerate-only labels and retains reveal", async ({ page }) => {
  await firstList(page);
  await choose(page, "Type", "itemize");
  await expect.poll(() => readStoreSource(page)).toContain("\\begin{itemize}[<+->]");
  await expect.poll(() => readStoreSource(page)).not.toContain("[(a)]");
  await expect(page.getByRole("textbox", { name: "Labels", exact: true })).toHaveCount(0);
  await expectSourceCanvasConsistency(page);
});

test("Escape cancels a label draft, blur commits once, and selecting another list clears drafts", async ({ page }) => {
  await firstList(page);
  const labels = page.getByRole("textbox", { name: "Labels", exact: true });
  await labels.fill("i)");
  await labels.press("Escape");
  expect(await readStoreSource(page)).toBe(SOURCE);
  await labels.fill("A)");
  await labels.press("Tab");
  await expect.poll(() => readStoreSource(page)).toContain("[A)]");
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await firstList(page, 1);
  await expect(labels).toHaveValue("I.");
});

test("replacing a PDF retains sizing/crop, hides page controls and keeps the image selected", async ({ page }) => {
  await select(page, ":graphics:", "Image");
  await expect(page.getByRole("spinbutton", { name: "Page", exact: true })).toHaveValue("3");
  await replace(page);
  await expect.poll(() => readStoreSource(page)).toContain("/Replacement.svg}");
  await expect.poll(() => readStoreSource(page)).toContain("width=.35\\textwidth,trim=1 2 3 4,clip");
  await expect.poll(() => readStoreSource(page)).not.toContain("page=3");
  await expect(page.getByRole("spinbutton", { name: "Page", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Replace Image…", exact: true })).toBeVisible();
  await expectSourceCanvasConsistency(page);
  await expect(page.getByTestId("canvas-svg-layer").locator("image").first()).toBeVisible();
  const replaced = await readStoreSource(page);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect.poll(() => readStoreSource(page)).toBe(replaced);
});

test("a replaced browser image survives reload", async ({ page }) => {
  await select(page, ":graphics:", "Image");
  await replace(page);
  await expect.poll(() => readStoreSource(page)).toContain("/Replacement.svg}");
  await expectSourceCanvasConsistency(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("tikz-editor:workspace"))).toContain("Replacement.svg");
  await page.reload();
  await expect(page.getByTestId("tab-strip")).toBeVisible();
  await page.locator(".cm-line").filter({ hasText: "\\begin{frame}{Objects}" }).click();
  await expect(page.getByTestId("canvas-svg-layer").locator("image").first()).toBeVisible();
  await expect.poll(() => readStoreSource(page)).toContain("/Replacement.svg}");
});

test("canceling replacement leaves source and the previous undo entry untouched", async ({ page }) => {
  await select(page, ":graphics:", "Image");
  const width = page.getByRole("spinbutton", { name: "Width", exact: true });
  await width.fill("0.4");
  await width.press("Enter");
  await expect.poll(() => readStoreSource(page)).toContain("width=0.4\\textwidth");
  const before = await readStoreSource(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Replace Image…", exact: true }).click();
  await (await chooser).setFiles([]);
  expect(await readStoreSource(page)).toBe(before);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
});

test("Escape cancels an image width scrub without adding history", async ({ page }) => {
  await select(page, ":graphics:", "Image");
  const label = page.locator("[class*='propertyLabelScrubbable']").filter({ hasText: /^Width$/u });
  const box = await label.boundingBox();
  if (!box) throw new Error("Missing width scrub label");
  await page.mouse.move(box.x + 15, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 55, box.y + box.height / 2, { steps: 5 });
  await expect.poll(() => readStoreSource(page)).not.toBe(SOURCE);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
});

for (const width of [1600, 1100]) test.describe(`inspector layout at ${width}px`, () => {
  test.use({ viewport: { width, height: 1050 } });
  test("list and image controls remain readable in both themes", async ({ page }) => {
    await firstList(page);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.getByRole("textbox", { name: "Labels", exact: true })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`list-${width}-${colorScheme}.png`) });
    }
    await select(page, ":graphics:", "Image");
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.getByRole("button", { name: "Replace Image…", exact: true })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`image-${width}-${colorScheme}.png`) });
    }
  });
});
