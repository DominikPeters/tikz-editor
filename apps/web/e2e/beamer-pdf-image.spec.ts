import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { expectSourceCanvasConsistency, gotoApp, openMenuCommand, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{PDF Images}
Before the image.
\end{frame}
\end{document}`;
const PDF = readFileSync(new URL("../../../test/fixtures/graphics-fuzz/fuzz-images/pages.pdf", import.meta.url));
// Same-length stream edit preserves the fixture's xref offsets. This remains a
// real two-page PDF, with different bytes and visibly different top-left paint.
const CHANGED_PDF = Buffer.from(PDF.toString("ascii").replaceAll("0.875 0.125 0.125", "0.125 0.875 0.125"), "ascii");
const PNG = readFileSync(new URL("../../../test/fixtures/graphics-fuzz/fuzz-images/pattern.png", import.meta.url));
const QUADRANTS = ["red", "cyan", "gold", "blue"];
const CHANGED_QUADRANTS = ["green", "cyan", "gold", "blue"];
const LEFT_HALF = ["red", "red", "gold", "gold"];
const imageRegion = (page: Page) => page.locator("[data-hit-region-deck-object-id*=':graphics:']").first();
test.use({ viewport: { width: 1600, height: 1050 }, screenshot: "only-on-failure" });

async function selectImage(page: Page): Promise<void> {
  await expect(async () => {
    await expectSourceCanvasConsistency(page);
    await imageRegion(page).click({ force: true, timeout: 2000 });
    await expect(page.getByRole("button", { name: "Replace Image…", exact: true })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

async function chooseFile(page: Page, replace: boolean, name: string, mimeType: string, buffer: Buffer): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  if (replace) await page.getByRole("button", { name: "Replace Image…", exact: true }).click();
  else await openMenuCommand(page, "insert", "insert.image");
  await (await chooser).setFiles({ name, mimeType, buffer });
  await expectSourceCanvasConsistency(page);
}

/** Decode PDF.js's actual PNG and paint the live SVG in this browser. No PDF
 * module, worker, rasterizer, persistence service or network response is mocked. */
async function readPaint(page: Page) {
  return await page.evaluate(async () => {
    const svg = document.querySelector<SVGSVGElement>("[data-testid='canvas-svg-layer'] svg");
    const region = document.querySelector<SVGGraphicsElement>("[data-hit-region-deck-object-id*=':graphics:']");
    const image = svg?.querySelector<SVGImageElement>("[data-tex-includegraphics='true'] image");
    const href = image?.getAttribute("href");
    if (!svg || !region || !href?.startsWith("data:image/png;base64,")) throw new Error("No resolved PNG image");
    const decode = async (url: string) => { const bitmap = new Image(); bitmap.src = url; await bitmap.decode(); return bitmap; };
    const bitmap = await decode(href);
    const assetCanvas = document.createElement("canvas");
    assetCanvas.width = bitmap.naturalWidth; assetCanvas.height = bitmap.naturalHeight;
    const asset = assetCanvas.getContext("2d");
    if (!asset) throw new Error("No asset canvas");
    asset.drawImage(bitmap, 0, 0);
    const palette: Record<string, number[]> = { red: [223, 32, 32], green: [32, 223, 32], cyan: [32, 184, 207], gold: [232, 176, 32], blue: [40, 70, 170] };
    const color = (context: CanvasRenderingContext2D, x: number, y: number) => {
      const rgb = [...context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data].slice(0, 3);
      return Object.keys(palette).find(name => palette[name].every((value, channel) => Math.abs(value - rgb[channel]) <= 4)) ?? `rgb(${rgb.join(",")})`;
    };
    const fractions = [[.25, .25], [.75, .25], [.25, .75], [.75, .75]];
    const box = region.getBoundingClientRect();
    const inverse = svg.getScreenCTM()?.inverse();
    if (!inverse || box.width <= 0 || box.height <= 0) throw new Error("Missing image geometry");
    const viewBox = svg.viewBox.baseVal;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(viewBox.width)); clone.setAttribute("height", String(viewBox.height));
    const scene = await decode(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`);
    const paintCanvas = document.createElement("canvas");
    paintCanvas.width = Math.ceil(viewBox.width * 4); paintCanvas.height = Math.ceil(viewBox.height * 4);
    const paint = paintCanvas.getContext("2d");
    if (!paint) throw new Error("No paint canvas");
    paint.fillStyle = "white"; paint.fillRect(0, 0, paintCanvas.width, paintCanvas.height);
    paint.drawImage(scene, 0, 0, paintCanvas.width, paintCanvas.height);
    return {
      pixels: [bitmap.naturalWidth, bitmap.naturalHeight],
      asset: fractions.map(([x, y]) => color(asset, x * bitmap.naturalWidth, y * bitmap.naturalHeight)),
      paint: fractions.map(([x, y]) => {
        const point = new DOMPoint(box.x + box.width * x, box.y + box.height * y).matrixTransform(inverse);
        return color(paint, (point.x - viewBox.x) * 4, (point.y - viewBox.y) * 4);
      }),
    };
  });
}

async function expectPaint(page: Page, label: string, pixels: number[], asset = QUADRANTS, paint = asset): Promise<void> {
  await expectSourceCanvasConsistency(page);
  await expect.poll(async () => { try { return await readPaint(page); } catch { return null; } }, { timeout: 15_000 }).toEqual({ pixels, asset, paint });
  await test.info().attach(label, { body: JSON.stringify(await readPaint(page)), contentType: "application/json" });
}

async function numberField(page: Page, name: string, value: string): Promise<void> {
  const field = page.getByRole("spinbutton", { name, exact: true });
  await field.fill(value); await field.press("Enter");
  await expectSourceCanvasConsistency(page);
}

async function drag(page: Page, testId: string, dx: number, dy: number): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`Missing ${testId}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
  await expectSourceCanvasConsistency(page);
}

async function reloadSaved(page: Page, source: string): Promise<void> {
  await expect.poll(() => page.evaluate(expected => localStorage.getItem("tikz-editor:workspace")?.includes(JSON.stringify(expected).slice(1, -1)) ?? false, source)).toBe(true);
  await page.reload();
  await expect(page.getByTestId("tab-strip")).toBeVisible();
  await expect.poll(() => readStoreSource(page)).toBe(source);
  await page.locator(".cm-line").filter({ hasText: "\\begin{frame}{PDF Images}" }).first().click();
  await selectImage(page);
}

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await page.addInitScript(() => { Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined }); });
  await gotoApp(page);
  await setSource(page, SOURCE);
  await page.locator(".cm-line").filter({ hasText: "\\begin{frame}{PDF Images}" }).first().click();
  await chooseFile(page, false, "Pages.pdf", "application/pdf", PDF);
  await expect.poll(() => readStoreSource(page)).toMatch(/\\includegraphics[^\n]*\{__tikz_assets__\/[^}]*Pages\.pdf\}/u);
  await selectImage(page);
  await expectPaint(page, "imported-page-one", [48, 32]);
  await numberField(page, "Width", "0.3");
});

test("real PDF pages survive crop, resize, undo/redo and reload", async ({ page }) => {
  const firstPage = await readStoreSource(page);
  await numberField(page, "Page", "2");
  await expectPaint(page, "page-two", [32, 48]);
  const secondPage = await readStoreSource(page);
  await page.getByRole("button", { name: "Edit Crop", exact: true }).click();
  const east = await page.getByTestId("deck-crop-e").boundingBox(), west = await page.getByTestId("deck-crop-w").boundingBox();
  if (!east || !west) throw new Error("Missing crop handles");
  await drag(page, "deck-crop-e", -(east.x - west.x) / 2, 0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expectPaint(page, "cropped-page-two", [32, 48], QUADRANTS, LEFT_HALF);
  const cropped = await readStoreSource(page);
  expect(cropped).not.toBe(secondPage);
  await drag(page, "deck-image-resize-se", 24, 24);
  await expectPaint(page, "resized-crop", [32, 48], QUADRANTS, LEFT_HALF);
  const resized = await readStoreSource(page);
  expect(resized).not.toBe(cropped);
  for (const [source, pixels, paint] of [[cropped, [32, 48], LEFT_HALF], [secondPage, [32, 48], QUADRANTS], [firstPage, [48, 32], QUADRANTS]] as const) {
    await openMenuCommand(page, "edit", "edit.undo");
    await expect.poll(() => readStoreSource(page)).toBe(source);
    await expectPaint(page, "undo", [...pixels], QUADRANTS, [...paint]);
  }
  for (const source of [secondPage, cropped, resized]) {
    await openMenuCommand(page, "edit", "edit.redo");
    await expect.poll(() => readStoreSource(page)).toBe(source);
  }
  await expectPaint(page, "redo", [32, 48], QUADRANTS, LEFT_HALF);
  await reloadSaved(page, resized);
  await expect(page.getByRole("spinbutton", { name: "Page", exact: true })).toHaveValue("2");
  await expectPaint(page, "reloaded-pdf", [32, 48], QUADRANTS, LEFT_HALF);
});

test("PDF replacement with the same name retains both versions through history and persistence", async ({ page }) => {
  await numberField(page, "Page", "2");
  await expectPaint(page, "before-replacement", [32, 48]);
  const before = await readStoreSource(page);
  await chooseFile(page, true, "Pages.pdf", "application/pdf", CHANGED_PDF);
  await expectPaint(page, "replaced-pdf", [48, 32], CHANGED_QUADRANTS);
  await expect(page.getByRole("spinbutton", { name: "Page", exact: true })).toHaveValue("1");
  const replaced = await readStoreSource(page);
  expect(replaced).not.toBe(before);
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readStoreSource(page)).toBe(before);
  await expectPaint(page, "undo-replacement", [32, 48]);
  await openMenuCommand(page, "edit", "edit.redo");
  await expect.poll(() => readStoreSource(page)).toBe(replaced);
  await expectPaint(page, "redo-replacement", [48, 32], CHANGED_QUADRANTS);
  await selectImage(page);
  await chooseFile(page, true, "Pattern.png", "image/png", PNG);
  await expectPaint(page, "png-replacement", [24, 16]);
  await expect(page.getByRole("spinbutton", { name: "Page", exact: true })).toHaveCount(0);
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readStoreSource(page)).toBe(replaced);
  await expectPaint(page, "restored-pdf", [48, 32], CHANGED_QUADRANTS);
  await reloadSaved(page, replaced);
  await expectPaint(page, "reloaded-replacement", [48, 32], CHANGED_QUADRANTS);
});
