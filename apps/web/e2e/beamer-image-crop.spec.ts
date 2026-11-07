import { expect, test, type Page } from "@playwright/test";
import { expectSourceCanvasConsistency, gotoApp, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Crop}
\includegraphics[width=4cm]{old.png}
\end{frame}
\end{document}`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="40" height="40" fill="red"/><rect x="40" width="40" height="40" fill="blue"/></svg>';
const MOD = process.platform === "darwin" ? "Meta" : "Control";
test.use({ viewport: { width: 1600, height: 1050 } });

const image = (page: Page) => page.locator("[data-hit-region-deck-object-id*=':graphics:']").first();

async function selectImage(page: Page): Promise<void> {
  await expect(async () => {
    await expectSourceCanvasConsistency(page);
    await image(page).click({ force: true, timeout: 2000 });
    await expect(page.locator("[class*='_header_']").filter({ hasText: /^Image$/u })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

async function drag(page: Page, testId: string, dx: number, dy: number): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`Missing ${testId}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await page.addInitScript(() => { Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined }); });
  await gotoApp(page);
  await setSource(page, SOURCE);
  await page.locator(".cm-line").filter({ hasText: "\\begin{frame}{Crop}" }).click();
  await selectImage(page);
  // An unreadable image cannot be cropped faithfully.
  await expect(page.getByRole("button", { name: "Crop Image", exact: true })).toHaveCount(0);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Replace Image…", exact: true }).click();
  await (await chooser).setFiles({ name: "Halves.svg", mimeType: "image/svg+xml", buffer: Buffer.from(SVG) });
  await expect.poll(() => readStoreSource(page)).toContain("/Halves.svg}");
  await expect(page.getByTestId("canvas-svg-layer").locator("image").first()).toBeVisible();
});

test("crops from an edge, moves the image in its window, and undoes each drag", async ({ page }) => {
  const original = await readStoreSource(page);
  await page.getByRole("button", { name: "Crop Image", exact: true }).click();
  await expect(page.getByTestId("deck-crop-overlay")).toBeVisible();
  await expect(page.getByTestId("deck-crop-ghost")).toBeAttached();
  await expect(page.getByRole("button", { name: "Done Cropping", exact: true })).toBeVisible();

  const right = await page.getByTestId("deck-crop-e").boundingBox();
  const left = await page.getByTestId("deck-crop-w").boundingBox();
  if (!right || !left) throw new Error("Missing crop handles");
  // Cut the right half: the blue square.
  await drag(page, "deck-crop-e", -(right.x - left.x) / 2, 0);
  await expect.poll(() => readStoreSource(page)).toMatch(/\[width=2(?:\.\d+)?cm, trim=0 0 \d+(?:\.\d+)? 0, clip\]/u);
  const cropped = await readStoreSource(page);
  await expect(page.getByTestId("deck-crop-overlay")).toBeVisible();

  // Moving the image left shows its right part through the same window.
  await drag(page, "deck-crop-move", -200, 0);
  await expect.poll(() => readStoreSource(page)).toMatch(/trim=\d+(?:\.\d+)? 0 0 0, clip\]/u);
  await expectSourceCanvasConsistency(page);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("deck-crop-overlay")).toHaveCount(0);
  await expect(page.locator("[class*='_header_']").filter({ hasText: /^Image$/u })).toBeVisible();

  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(cropped);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(original);
});

test("double-click reopens crop only for a cropped image, and Reset Crop restores it", async ({ page }) => {
  await image(page).dblclick({ force: true });
  await expect(page.getByTestId("deck-crop-overlay")).toHaveCount(0);

  await page.getByRole("button", { name: "Crop Image", exact: true }).click();
  const top = await page.getByTestId("deck-crop-n").boundingBox();
  const bottom = await page.getByTestId("deck-crop-s").boundingBox();
  if (!top || !bottom) throw new Error("Missing crop handles");
  await drag(page, "deck-crop-n", 0, (bottom.y - top.y) / 4);
  await expect.poll(() => readStoreSource(page)).toContain(", clip]");
  await page.getByRole("button", { name: "Done Cropping", exact: true }).click();
  await expect(page.getByTestId("deck-crop-overlay")).toHaveCount(0);

  await selectImage(page);
  await image(page).dblclick({ force: true });
  await expect(page.getByTestId("deck-crop-overlay")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("deck-crop-overlay")).toHaveCount(0);

  await page.getByRole("button", { name: "Reset Crop", exact: true }).click();
  await expect.poll(() => readStoreSource(page)).toMatch(/\\includegraphics\[width=4(?:\.0+)?cm, clip\]\{[^}]*Halves\.svg\}/u);
  await expectSourceCanvasConsistency(page);
});
