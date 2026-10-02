import { expect, test } from "@playwright/test";
import { gotoApp, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}[t]{Overlays}
\only<2->{Target}
\begin{columns}[T]
\begin{column}{.55\textwidth}Left content.\end{column}
\begin{column}{.42\textwidth}Right content.\end{column}
\end{columns}
\begin{block}{Result}Content.\end{block}
\end{frame}
\end{document}`;
const MOD = process.platform === "darwin" ? "Meta" : "Control";

test.use({ viewport: { width: 1600, height: 1000 } });
test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, SOURCE);
  await page.locator(".cm-line").filter({ hasText: "\\begin{frame}" }).click();
  await expect(page.getByTestId("deck-column-divider")).toHaveCount(1, { timeout: 30_000 });
});

test("overlay timing edits and boundary drags update source with one undo", async ({ page }) => {
  await page.locator(".flexlayout__tab_button_content").filter({ hasText: /^Overlays$/u }).first().click();
  await page.getByRole("button", { name: "Text · Target", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Overlay steps" });
  await field.fill("3-");
  await field.press("Enter");
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE.replace("<2->", "<3->"));
  const handle = page.locator('button[data-boundary="start"]');
  const box = await handle.boundingBox();
  const cell = await handle.locator("..").boundingBox();
  if (!box || !cell) throw new Error("Missing overlay boundary");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - cell.width, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE.replace("<2->", "<3->"));
});

test("column resizing commits once and Escape restores the preview", async ({ page }) => {
  const handle = page.getByTestId("deck-column-divider");
  const box = await handle.boundingBox();
  if (!box) throw new Error("Missing column divider");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 25, y, { steps: 5 });
  await expect.poll(() => readStoreSource(page)).not.toBe(SOURCE);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => readStoreSource(page)).not.toBe(SOURCE);
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
});

test("canvas overlay commands reveal the source rule in the Overlays panel", async ({ page }) => {
  const block = page.locator('[data-hit-region-deck-object-id*="block:"]').first();
  const box = await block.boundingBox();
  if (!box) throw new Error("Missing block hit region");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  await page.getByRole("menuitem", { name: /^Overlays/u }).hover();
  await page.getByTestId("canvas-context-cmd-overlay.next").click();
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE.replace("\\begin{block}", "\\begin{block}<2->"));
  await page.locator(".flexlayout__tab_button_content").filter({ hasText: /^Overlays$/u }).first().click();
  const row = page.getByTestId("build-row").filter({ hasText: "Block · Result" });
  await expect(row).toHaveAttribute("data-selected", "true");
  await expect(page.getByRole("textbox", { name: "Overlay steps" })).toHaveValue("2-");
});
