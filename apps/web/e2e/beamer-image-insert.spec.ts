import { expect, test, type Page } from "@playwright/test";
import { expectSourceCanvasConsistency, gotoApp, openMenuSection, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Main Results}
Some text.
\end{frame}
\end{document}`;
test.use({ viewport: { width: 1600, height: 1050 } });

/** Sends a PNG made in the page as a drop or a paste on the canvas viewport. */
async function sendImage(page: Page, how: "drop" | "paste", name: string, width: number, height: number): Promise<void> {
  await page.evaluate(async ({ how, name, width, height }) => {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas");
    context.fillStyle = "#3a7";
    context.fillRect(0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const data = new DataTransfer();
    data.items.add(new File([blob], name, { type: "image/png" }));
    const viewport = document.querySelector("[data-testid='canvas-viewport']");
    if (!viewport) throw new Error("No viewport");
    if (how === "paste") {
      viewport.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    } else {
      viewport.dispatchEvent(new DragEvent("dragover", { dataTransfer: data, bubbles: true, cancelable: true }));
      viewport.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
    }
  }, { how, name, width, height });
}

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, SOURCE);
  await page.locator(".cm-line").filter({ hasText: "\\begin{frame}{Main Results}" }).click();
  await expectSourceCanvasConsistency(page);
});

test("a dropped image is centred at the end of the slide, selected, and undone from the notice", async ({ page }) => {
  await sendImage(page, "drop", "Chart.png", 400, 200);
  await expect.poll(() => readStoreSource(page)).toMatch(
    /Some text\.\n\\begin\{center\}\n {2}\\includegraphics\[width=0\.5\\linewidth\]\{__tikz_assets__\/[^/]+\/Chart\.png\}\n\\end\{center\}\n\\end\{frame\}/u);
  await expectSourceCanvasConsistency(page);
  await expect(page.getByTestId("canvas-svg-layer").locator("image").first()).toBeVisible();
  await expect(page.locator("[class*='_header_']").filter({ hasText: /^Image$/u })).toBeVisible();

  const notice = page.getByTestId("graphics-notice");
  await expect(notice).toContainText("Chart.png is stored in this browser only");
  await expect(notice.getByRole("button", { name: "Change…" })).toHaveCount(0);
  await notice.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await expect(notice).toHaveCount(0);
});

test("a pasted image without a name is named after the slide and keeps a small natural size", async ({ page }) => {
  await sendImage(page, "paste", "image.png", 40, 30);
  await expect.poll(() => readStoreSource(page)).toMatch(/\\includegraphics\{__tikz_assets__\/[^/]+\/Main-Results\.png\}/u);
  await expectSourceCanvasConsistency(page);
});

test("Insert offers Image… on a slide", async ({ page }) => {
  await openMenuSection(page, "insert");
  await expect(page.getByTestId("menu-cmd-insert.image")).toBeEnabled();
});
