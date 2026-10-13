import { expect, test, type Page } from "@playwright/test";

import { gotoApp, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const PRIMARY_MOD = process.platform === "darwin" ? "Meta" : "Control";

const LAYERED = String.raw`\documentclass{beamer}
\usepackage{tikz}
\begin{document}
\begin{frame}{Layer}
A first paragraph of text.

\begin{tikzpicture}[remember picture, overlay, shift={(current page.south west)}]
  \draw[fill=orange!20] (1.2,5.5) rectangle (5.0,7.1);
  \node[anchor=north west, draw] at (8.3,7.9) {Key result};
\end{tikzpicture}
\end{frame}
\end{document}`;

const PLAIN = String.raw`\documentclass{beamer}
\usepackage{tikz}
\begin{document}
\begin{frame}{Plain}
Some text here.
\end{frame}
\end{document}`;

type TestApi = {
  getCanvasTransform?: () => { translateX: number; translateY: number; scale: number };
  getSelectedSourceIds?: () => string[];
  getActiveFigureId?: () => string | null;
  runCommand?: (id: string) => void;
};

async function api<T>(page: Page, read: (api: TestApi) => T): Promise<T> {
  return await page.evaluate((body) => {
    const testApi = (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__: TestApi }).__TIKZ_EDITOR_APP_TEST_API__;
    return (new Function("api", `return (${body})(api);`) as (api: TestApi) => unknown)(testApi);
  }, read.toString()) as T;
}

test.beforeEach(async ({ page }) => {
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") console.log("CONSOLE", message.type(), message.text().slice(0, 500)); });
  page.on("pageerror", (error) => { console.log("PAGEERROR", error.message.slice(0, 500)); });
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
});

test("a shape on a slide opens its drawing layer in place: select, drag, and a click beside it returns to the slide", async ({ page }, testInfo) => {
  await setSource(page, LAYERED);
  const rectangle = page.locator('[data-hit-region-key^="deck-layer:frame:0:overlay:0:"][data-hit-region-target-id="path:0"]').first();
  await expect(rectangle).toBeAttached({ timeout: 30_000 });
  const before = await api(page, (testApi) => testApi.getCanvasTransform?.());
  const box = (await rectangle.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  const crumb = page.getByRole("button", { name: "Back to Slide 1" });
  await expect(crumb).toBeVisible();
  await expect(page.getByTestId("canvas-layer-backdrop")).toBeAttached();
  await expect.poll(() => api(page, (testApi) => testApi.getSelectedSourceIds?.())).toEqual(["path:0"]);
  // In place: the slide stays where it was.
  expect(await api(page, (testApi) => testApi.getCanvasTransform?.())).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath("layer-entered.png") });

  // The shape moves in page coordinates; the text does not.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => readStoreSource(page)).not.toContain("(1.2,5.5) rectangle (5.0,7.1)");
  expect(await readStoreSource(page)).toContain("A first paragraph of text.");

  // A click where the layer draws nothing is a click on the slide.
  const stage = (await page.getByTestId("canvas-world-stage").boundingBox())!;
  await page.mouse.click(stage.x + stage.width * 0.6, stage.y + stage.height * 0.85);
  await expect(crumb).toHaveCount(0);
  await expect.poll(() => api(page, (testApi) => testApi.getActiveFigureId?.())).toBe("frame:0");
  expect(await api(page, (testApi) => testApi.getCanvasTransform?.())).toEqual(before);
});

test("a drawing tool on a slide without a layer draws into a new one, inserted with the first shape in one undo step", async ({ page }, testInfo) => {
  await setSource(page, PLAIN);
  await expect(page.locator('[data-hit-region-interaction-mode="text"]').first()).toBeAttached({ timeout: 30_000 });
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to Slide 1" })).toBeVisible();
  await expect(page.getByTestId("canvas-layer-backdrop")).toBeAttached();
  expect(await readStoreSource(page)).toBe(PLAIN);

  const stage = (await page.getByTestId("canvas-world-stage").boundingBox())!;
  await page.mouse.move(stage.x + stage.width * 0.4, stage.y + stage.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width * 0.7, stage.y + stage.height * 0.8, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => readStoreSource(page)).toContain("Some text here.%\n" + String.raw`\begin{tikzpicture}[remember picture, overlay, shift={(current page.south west)}]`);
  const drawn = await readStoreSource(page);
  // Page coordinates in cm from the lower-left corner: on the page (12.8 x 9.6 cm).
  const match = /\\draw \(([\d.]+),([\d.]+)\) rectangle \(([\d.]+),([\d.]+)\);/u.exec(drawn);
  expect(match).not.toBeNull();
  for (const [index, limit] of [[1, 12.8], [2, 9.6], [3, 12.8], [4, 9.6]] as const) {
    const value = Number(match![index]);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(limit);
  }
  await page.screenshot({ path: testInfo.outputPath("layer-drawn.png") });

  await page.keyboard.press(`${PRIMARY_MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(PLAIN);
});
