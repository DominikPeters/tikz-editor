import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import {
  expectSourceCanvasConsistency,
  gotoApp,
  openMenuCommand,
  readCanvasTransform,
  readSelectedSourceIds,
  readStoreSource,
  resetStorageBeforeNavigation,
  setSource
} from "./helpers";
import { parseTikz } from "../../../packages/core/src/parser/index";
import { evaluateTikzFigure } from "../../../packages/core/src/semantic/evaluate";
import { readAxisEditInfo } from "../../../packages/core/src/edit/pgfplots/axis-actions";

// pgfplots axes in a Beamer deck: on the slide, in the picture opened from it,
// on overlay steps, in thumbnails and in presentation mode.
// Screenshots go to PGFPLOTS_BEAMER_E2E_SCREENSHOTS (or a temp dir); the scale
// factor comes from PGFPLOTS_BEAMER_E2E_SCALE (default 1).
const screenshotDir = process.env.PGFPLOTS_BEAMER_E2E_SCREENSHOTS ?? path.join(os.tmpdir(), "tikz-editor-pgfplots-beamer-e2e");
const deviceScaleFactor = Number(process.env.PGFPLOTS_BEAMER_E2E_SCALE ?? "1");

const AXIS = "axis:1";
const SOURCE = String.raw`\documentclass{beamer}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\begin{document}
\begin{frame}{Results}
Speed over time.

\begin{tikzpicture}
\begin{axis}[xlabel={Time}, ylabel={Speed}, xmin=0, xmax=4, ymin=0, ymax=4, width=6cm, height=4.5cm]
\addplot coordinates {(1,1) (2,3) (3,2)};
\addlegendentry{measured}
\only<2>{\addplot coordinates {(1,2) (2,2) (3,3)};}
\end{axis}
\end{tikzpicture}
\end{frame}
\begin{frame}{Second}
\begin{tikzpicture}
\begin{axis}[width=5cm, title={Square}]
\addplot {x^2};
\end{axis}
\end{tikzpicture}
\end{frame}
\end{document}`;

type TestApi = { selectSourceIds: (ids: string[]) => void; getSceneSourceIds: () => string[] };
const api = <T>(page: Page, call: string) => page.evaluate((code) =>
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("api", `return ${code}`)((window as unknown as { __TIKZ_EDITOR_APP_TEST_API__: TestApi }).__TIKZ_EDITOR_APP_TEST_API__) as T, call);

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(screenshotDir, `${name}.png`) });
}

/** The axis rectangle in world pt, from evaluating the deck's first picture. */
function axisWorldBox(source: string): { x0: number; y0: number; x1: number; y1: number } {
  const parsed = parseTikz(source, { includeContextDefinitions: true, recover: true });
  const info = readAxisEditInfo(evaluateTikzFigure(parsed.figure, source).scene.elements, AXIS);
  if (!info) throw new Error("no axis geometry");
  const { a, d, e, f } = info.frame;
  return { x0: a * info.box.x0 + e, y0: d * info.box.y0 + f, x1: a * info.box.x1 + e, y1: d * info.box.y1 + f };
}

/** Client px per pt of the open picture. */
async function pxPerPt(page: Page): Promise<number> {
  return (await readCanvasTransform(page)).scale;
}

async function pointOnRegion(page: Page, targetId: string, at = 0.25): Promise<{ x: number; y: number }> {
  const region = page.locator(`[data-hit-region-target-id='${targetId}']`).first();
  await expect(region).toBeAttached();
  return await region.evaluate((element, fraction) => {
    if (element instanceof SVGGeometryElement && element.ownerSVGElement) {
      const sample = element.getPointAtLength(element.getTotalLength() * fraction);
      const point = element.ownerSVGElement.createSVGPoint();
      point.x = sample.x; point.y = sample.y;
      const screen = point.matrixTransform(element.getScreenCTM() ?? undefined);
      return { x: screen.x, y: screen.y };
    }
    const r = element.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, at);
}

async function axisBoxPoint(page: Page): Promise<{ x: number; y: number }> {
  return await page.evaluate((id) => {
    let best: SVGGeometryElement | null = null; let area = -1;
    for (const element of Array.from(document.querySelectorAll(`[data-hit-region-target-id='${id}']`))) {
      if (!(element instanceof SVGGeometryElement)) continue;
      const r = element.getBoundingClientRect();
      if (r.width * r.height > area) { area = r.width * r.height; best = element; }
    }
    if (!best?.ownerSVGElement) throw new Error("no axis box region");
    const sample = best.getPointAtLength(best.getTotalLength() * 0.1);
    const point = best.ownerSVGElement.createSVGPoint();
    point.x = sample.x; point.y = sample.y;
    const screen = point.matrixTransform(best.getScreenCTM() ?? undefined);
    return { x: screen.x, y: screen.y };
  }, AXIS);
}

async function selectAxis(page: Page): Promise<void> {
  const at = await axisBoxPoint(page);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([AXIS]);
}

async function settled(page: Page): Promise<void> {
  await expectSourceCanvasConsistency(page, { assertNoActiveCanvasDrag: true });
}

/** Shows frame `frame` (1-based) on the slide canvas. */
async function showFrame(page: Page, frame: number): Promise<void> {
  await page.locator(".cm-line").filter({ hasText: frame === 1 ? "\\begin{frame}{Results}" : "\\begin{frame}{Second}" }).click();
  await expect(page.locator(`[data-hit-region-deck-object-id$='frame:${frame - 1}:tikz:0']`).first()).toHaveCount(1, { timeout: 30_000 });
}

/** Selects the picture on the slide, then opens it ("Edit Drawing"). */
async function openPicture(page: Page, frame = 1, expectedId = AXIS, selector = `[data-hit-region-deck-object-id$='frame:${frame - 1}:tikz:0']`): Promise<void> {
  const picture = page.locator(selector).first();
  // Hit regions are rebuilt with each render; the click repeats until it takes.
  await expect(async () => {
    await picture.click({ force: true, timeout: 2_000 });
    await expect(page.getByRole("button", { name: "Edit Drawing" })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: "Edit Drawing" }).click();
  await expect(page.getByTestId("nested-figure-breadcrumb")).toBeVisible();
  await expect.poll(() => api<string[]>(page, "api.getSceneSourceIds()")).toContain(expectedId);
}

test.use({ viewport: { width: 1400, height: 900 }, deviceScaleFactor });

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, SOURCE);
  await showFrame(page, 1);
});

test("the slide shows the axis; the picture is selected on the slide and opened for editing", async ({ page }) => {
  await shot(page, "01-slide");
  const picture = page.locator("[data-hit-region-deck-object-id$='frame:0:tikz:0']").first();
  const box = await picture.boundingBox();
  // The axis is 6cm wide with its labels: about half the 4:3 slide's text width, visible on the slide.
  expect(box?.width ?? 0).toBeGreaterThan(100);
  await openPicture(page);
  await shot(page, "02-picture-open");
  // Step 2 (the last) is shown: both plots, the axis parts.
  expect(await api<string[]>(page, "api.getSceneSourceIds()")).toEqual([AXIS, `${AXIS}:plot:0`, `${AXIS}:plot:1`, `${AXIS}:xlabel`, `${AXIS}:ylabel`, `${AXIS}:legend`]);
  expect(await readStoreSource(page)).toBe(SOURCE);
});

test("select the axis in the opened picture and drag it: writes at=", async ({ page }) => {
  await openPicture(page);
  await selectAxis(page);
  await shot(page, "03-axis-selected");
  const scale = await pxPerPt(page);
  const start = await axisBoxPoint(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.keyboard.down("Control");
  await page.mouse.move(start.x + 60, start.y - 30, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  await settled(page);
  const source = await readStoreSource(page);
  expect(source).toMatch(/height=4\.5cm, at=\{\([-\d.]+cm,[-\d.]+cm\)\}\]/u);
  const was = axisWorldBox(SOURCE); const now = axisWorldBox(source);
  expect(Math.abs(now.x0 - was.x0 - 60 / scale)).toBeLessThan(1);
  expect(Math.abs(now.y0 - was.y0 - 30 / scale)).toBeLessThan(1);
  expect(await readSelectedSourceIds(page)).toEqual([AXIS]);
  await shot(page, "04-axis-moved");
});

test("resize the axis from its right edge: writes width (and pins height)", async ({ page }) => {
  await openPicture(page);
  await selectAxis(page);
  const handle = page.locator(`[data-handle-kind="resize-element"][data-source-id="${AXIS}"][data-resize-role="right"]`);
  await expect(handle).toBeVisible();
  const scale = await pxPerPt(page);
  const start = await handle.evaluate((element) => { const r = element.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.keyboard.down("Control");
  await page.mouse.move(start.x + 50, start.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  await settled(page);
  const source = await readStoreSource(page);
  expect(source).toMatch(/xmin=0, xmax=4, ymin=0, ymax=4, width=[\d.]+cm, height=[\d.]+cm\]/u);
  const was = axisWorldBox(SOURCE); const now = axisWorldBox(source);
  expect(Math.abs(now.x1 - was.x1 - 50 / scale)).toBeLessThan(1);
  expect(now.x0).toBeCloseTo(was.x0, 3);
  await shot(page, "05-axis-resized");
});

test("drill into a plot and recolour it in the inspector; it stays selected", async ({ page }) => {
  await openPicture(page);
  await selectAxis(page);
  // Near (1,1): away from where the step-2 plot crosses it.
  const onLine = await pointOnRegion(page, `${AXIS}:plot:0`, 0.08);
  await page.mouse.click(onLine.x, onLine.y);
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([`${AXIS}:plot:0`]);
  await expect(page.getByText("Plot", { exact: true }).first()).toBeVisible();
  await shot(page, "06-plot-selected");
  await page.locator("xpath=//button[@aria-label='Color']").first().click();
  await page.getByRole("button", { name: "Color red" }).click();
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE.replace("\\addplot coordinates {(1,1)", "\\addplot+[color=red] coordinates {(1,1)"));
  await settled(page);
  expect(await readSelectedSourceIds(page)).toEqual([`${AXIS}:plot:0`]);
  await shot(page, "07-plot-red");
});

test("edit the x label text in place", async ({ page }) => {
  await openPicture(page);
  await selectAxis(page);
  const label = page.locator(`[data-hit-region-target-id='${AXIS}:xlabel'][data-hit-region-interaction-mode='text']`).first();
  await expect(label).toBeAttached();
  const box = await label.boundingBox();
  if (!box) throw new Error("no label region");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([`${AXIS}:xlabel`]);
  await label.dblclick();
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toHaveValue("Time");
  await textarea.press("End");
  await page.keyboard.type(" [s]");
  await shot(page, "08-xlabel-editing");
  await page.keyboard.press("Escape");
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE.replace("xlabel={Time}", "xlabel={Time [s]}"));
  await settled(page);
  await shot(page, "09-xlabel-edited");
});

test("drag a data point of the selected plot: rewrites that (x,y) in data units", async ({ page }) => {
  await openPicture(page);
  await api(page, `api.selectSourceIds(['${AXIS}:plot:0'])`);
  const handles = page.locator(`[data-source-id="${AXIS}:plot:0"][data-handle-kind]`);
  await expect.poll(() => handles.count()).toBeGreaterThanOrEqual(3);
  const was = axisWorldBox(SOURCE);
  const scale = await pxPerPt(page);
  const unitX = (was.x1 - was.x0) / 4 * scale; const unitY = (was.y1 - was.y0) / 4 * scale;
  const second = handles.nth(1);
  const start = await second.evaluate((element) => { const r = element.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.keyboard.down("Control"); // no snapping
  await page.mouse.move(start.x + 0.5 * unitX, start.y + unitY, { steps: 6 });
  await shot(page, "10-point-mid-drag");
  await page.mouse.up();
  await page.keyboard.up("Control");
  await settled(page);
  const dragged = await readStoreSource(page);
  // (2,3) moved half a unit right and one down, to the pointer's precision.
  const match = /\\addplot coordinates \{\(1,1\) \(([\d.]+),([\d.]+)\) \(3,2\)\};/u.exec(dragged);
  expect(match).not.toBeNull();
  expect(Math.abs(Number(match?.[1]) - 2.5)).toBeLessThan(0.05);
  expect(Math.abs(Number(match?.[2]) - 2)).toBeLessThan(0.05);
  expect(await readSelectedSourceIds(page)).toEqual([`${AXIS}:plot:0`]);
  await shot(page, "11-point-dragged");
});

test("drag the legend: writes legend style at/anchor", async ({ page }) => {
  await openPicture(page);
  await selectAxis(page);
  const legend = page.locator(`[data-hit-region-target-id='${AXIS}:legend']`).first();
  const box = await legend.boundingBox();
  if (!box) throw new Error("no legend region");
  await page.mouse.click(box.x + 4, box.y + 4);
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([`${AXIS}:legend`]);
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.mouse.down();
  await page.keyboard.down("Control");
  await page.mouse.move(box.x + 4 - 80, box.y + 4 + 90, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  await settled(page);
  expect(await readStoreSource(page)).toMatch(/height=4\.5cm, legend style=\{at=\{\(0\.\d+,0\.\d+\)\}, anchor=north east\}\]/u);
  await shot(page, "12-legend-dragged");
});

test("delete a plot with the Delete key; one undo restores it", async ({ page }) => {
  await openPicture(page);
  await api(page, `api.selectSourceIds(['${AXIS}:plot:0'])`);
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([`${AXIS}:plot:0`]);
  await page.getByTestId("canvas-viewport").focus();
  await page.keyboard.press("Delete");
  await expect.poll(() => readStoreSource(page)).not.toContain("(1,1) (2,3) (3,2)");
  await settled(page);
  await shot(page, "13-plot-deleted");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readStoreSource(page)).toBe(SOURCE);
  await settled(page);
  await shot(page, "14-plot-restored");
});

test("overlay steps: the plot in \\only<2> is drawn and selectable on step 2 only", async ({ page }) => {
  await page.getByTestId("deck-step-1").click();
  await shot(page, "15-slide-step-1");
  await openPicture(page);
  await page.getByTestId("deck-step-1").click();
  await expect.poll(() => api<string[]>(page, "api.getSceneSourceIds()")).toEqual([AXIS, `${AXIS}:plot:0`, `${AXIS}:xlabel`, `${AXIS}:ylabel`, `${AXIS}:legend`]);
  await expect(page.locator(`[data-hit-region-target-id='${AXIS}:plot:1']`)).toHaveCount(0);
  await shot(page, "16-picture-step-1");
  await page.getByTestId("deck-step-2").click();
  await expect.poll(() => api<string[]>(page, "api.getSceneSourceIds()")).toContain(`${AXIS}:plot:1`);
  await selectAxis(page);
  const onLine = await pointOnRegion(page, `${AXIS}:plot:1`, 0.5);
  await page.mouse.click(onLine.x, onLine.y);
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([`${AXIS}:plot:1`]);
  await shot(page, "17-picture-step-2-plot-selected");
  expect(await readStoreSource(page)).toBe(SOURCE);
});

test("switching slides shows each slide's axis; thumbnails and presentation mode draw them", async ({ page }) => {
  await showFrame(page, 2);
  await shot(page, "18-second-slide");
  const second = page.locator("[data-hit-region-deck-object-id$='frame:1:tikz:0']").first();
  expect((await second.boundingBox())?.width ?? 0).toBeGreaterThan(100);
  // Both thumbnails paint the axes (box, ticks, plot and tick label glyphs).
  const strip = page.getByTestId("figure-navigator-strip");
  const thumbnailPaths = (index: number) => strip.locator("img").nth(index).evaluate(async (image: HTMLImageElement) => {
    const text = await (await fetch(image.src)).text();
    return (text.match(/<(?:path|use)\b/gu) ?? []).length;
  });
  await expect.poll(() => strip.locator("img").count()).toBeGreaterThanOrEqual(2);
  for (const index of [0, 1]) await expect.poll(() => thumbnailPaths(index)).toBeGreaterThan(10);
  await showFrame(page, 1);
  // The audience window of a presentation draws the slide with its axis.
  await page.getByRole("button", { name: "Presentation actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Presentation Options…", exact: true }).click();
  const options = page.getByTestId("presentation-options");
  await options.getByRole("combobox", { name: "Presentation mode" }).selectOption("window");
  await options.getByRole("checkbox", { name: "Show Presenter View" }).setChecked(false);
  await options.getByRole("button", { name: "Start Presentation", exact: true }).click();
  const context = page.context();
  await expect.poll(() => context.pages().filter((child) => child.url().includes("presentation=audience")).length).toBe(1);
  const audience = context.pages().find((child) => child.url().includes("presentation=audience"));
  if (!audience) throw new Error("no audience window");
  const slide = audience.getByRole("img", { name: "Audience slide", exact: true });
  await expect(slide).toBeVisible();
  // The slide's SVG holds the axis: its tick label "4" and box paths.
  await expect.poll(() => slide.locator("img").evaluate(async (image: HTMLImageElement) => (decodeURIComponent(image.src).match(/<(?:path|use)\b/gu) ?? []).length)).toBeGreaterThan(20);
  await audience.screenshot({ path: path.join(screenshotDir, "19-presentation.png") });
});

const TIKZ_DECK = String.raw`\documentclass{beamer}
\usepackage{tikz}
\begin{document}
\begin{frame}{Plan}
First point.
\end{frame}
\begin{frame}{Diagram}
\begin{tikzpicture}
\draw (0,0) rectangle (2,1);
\end{tikzpicture}
\end{frame}
\end{document}`;

test("Insert on a slide: a picture with the axis in the frame, the preamble lines once, the picture selected", async ({ page }) => {
  await setSource(page, TIKZ_DECK);
  await page.locator(".cm-line").filter({ hasText: "\\begin{frame}{Plan}" }).click();
  await expect(page.getByText("Slide 1 of 2")).toBeVisible({ timeout: 30_000 });
  await openMenuCommand(page, "insert", "insert.function-plot");
  await expect.poll(() => readStoreSource(page)).toContain("\\addplot {x^2 - 1};");
  const once = await readStoreSource(page);
  expect(once).toContain(String.raw`\usepackage{tikz}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\begin{document}`);
  expect(once).toContain(String.raw`First point.
\begin{center}
  \begin{tikzpicture}
    \begin{axis}[width=0.8\linewidth, height=0.6\textheight,`);
  // The new picture is selected on the slide.
  await expect(page.getByRole("button", { name: "Edit Drawing" })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-hit-region-deck-object-id$='frame:0:tikz:0']").first()).toHaveCount(1);
  await shot(page, "20-inserted-on-slide");
  await openMenuCommand(page, "insert", "insert.bar-chart");
  await expect.poll(() => readStoreSource(page)).toContain("ybar, ymin=0");
  const twice = await readStoreSource(page);
  expect(twice.match(/\\usepackage\{pgfplots\}|compat=1\.18/gu)).toEqual(["\\usepackage{pgfplots}", "compat=1.18"]);
  // The second chart takes the room left on the slide, not another 0.6\textheight.
  expect(twice).toMatch(/\[width=0\.8\\linewidth, height=0\.(?:3|35|4|45|5|55)\\textheight, ybar/u);
  await shot(page, "21-two-inserted-on-slide");
});

test("the toolbar chart gallery inserts on a slide too", async ({ page }) => {
  await setSource(page, TIKZ_DECK);
  await page.locator(".cm-line").filter({ hasText: "\\begin{frame}{Plan}" }).click();
  await expect(page.getByText("Slide 1 of 2")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("toolbar-insert-chart").click();
  await page.getByTestId("toolbar-tool-popup-insertChart").getByTestId("toolbar-chart-choice-semilogy").click();
  await expect.poll(() => readStoreSource(page)).toContain("\\begin{semilogyaxis}[width=0.8\\linewidth, height=0.6\\textheight, ");
  await expect(page.getByRole("button", { name: "Edit Drawing" })).toBeVisible({ timeout: 15_000 });
});

test("Insert in a picture opened from a deck: the axis goes into the picture, pgfplots into the preamble", async ({ page }) => {
  await setSource(page, TIKZ_DECK);
  await page.locator(".cm-line").filter({ hasText: "\\begin{frame}{Diagram}" }).click();
  await expect(page.locator("[data-hit-region-deck-object-id$='frame:1:tikz:0']").first()).toHaveCount(1, { timeout: 30_000 });
  await openPicture(page, 2, "path:0");
  await openMenuCommand(page, "insert", "insert.function-plot");
  await expect.poll(() => readStoreSource(page)).toContain("\\addplot {x^2 - 1};");
  const source = await readStoreSource(page);
  expect(source).toContain(String.raw`\usepackage{tikz}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\begin{document}`);
  expect(source).toContain(String.raw`\draw (0,0) rectangle (2,1);
  \begin{axis}[at={(3cm,0cm)}, xlabel=`);
  expect(source.match(/compat=1\.18/gu)).toHaveLength(1);
  await expect.poll(() => readSelectedSourceIds(page)).toEqual(["axis:1"]);
  await shot(page, "22-inserted-in-picture");
});

const COLUMN_DECK = String.raw`\documentclass{beamer}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\begin{document}
\begin{frame}{Columns}
\begin{columns}
\begin{column}{0.4\textwidth}
Text beside the plot.
\end{column}
\begin{column}{0.55\textwidth}
\begin{tikzpicture}
\begin{axis}[width=\linewidth, height=0.5\textheight]
\addplot coordinates {(0,0) (1,2) (2,1)};
\end{axis}
\end{tikzpicture}
\end{column}
\end{columns}
\end{frame}
\end{document}`;

test("a \\linewidth axis in a column has the same size on the slide and in the opened picture", async ({ page }) => {
  await setSource(page, COLUMN_DECK);
  await page.locator(".cm-line").filter({ hasText: "\\begin{frame}{Columns}" }).click();
  const selector = "[data-hit-region-deck-object-id$=':tikzpicture:0']";
  const picture = page.locator(selector).first();
  await expect(picture).toHaveCount(1, { timeout: 30_000 });
  await shot(page, "23-column-axis-slide");
  const onSlide = (await picture.boundingBox())?.width ?? 0;
  const slideScale = (await readCanvasTransform(page)).scale;
  await openPicture(page, 1, AXIS, selector);
  await shot(page, "24-column-axis-open");
  const nested = await page.evaluate(() => {
    let left = Infinity; let right = -Infinity;
    for (const element of Array.from(document.querySelectorAll("[data-hit-region-target-id^='axis:1']"))) {
      const r = element.getBoundingClientRect();
      if (r.width <= 0) continue;
      left = Math.min(left, r.left); right = Math.max(right, r.right);
    }
    return right - left;
  });
  const nestedScale = (await readCanvasTransform(page)).scale;
  // The picture is 137.2pt wide on the slide (width=\linewidth = 169pt, the 0.55 column,
  // less pgfplots' 45pt label allowance plus the tick labels; LuaLaTeX agrees, fixture
  // d2-columns). With article lengths (0.55 of 345pt) it would be 21pt wider. The hit
  // regions leave out a few pt of the box.
  expect(Math.abs(onSlide / slideScale - 137.2)).toBeLessThan(1);
  expect(Math.abs(nested / nestedScale - 137.2)).toBeLessThan(6);
});
