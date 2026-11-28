import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import {
  clickHitRegionByTargetId,
  expectSourceCanvasConsistency,
  focusCanvas,
  gotoApp,
  readSelectedSourceIds,
  readSource,
  resetStorageBeforeNavigation,
  setCanvasTransform,
  setSource,
  waitForHitRegions
} from "./helpers";
import { parseTikz } from "../../../packages/core/src/parser/index";
import { evaluateTikzFigure } from "../../../packages/core/src/semantic/evaluate";
import { CHART_KINDS } from "../../../packages/core/src/edit/pgfplots/chart-kinds";

// The chart UI (Escape step-out, inspector placeholders and Elements, Objects
// panel parts, toolbar gallery, chart context menus, legend-entry text edit).
// Screenshots go to CHART_UI_SHOTS (or a temp dir); CHART_UI_SCALE sets the device scale.
const shotDir = process.env.CHART_UI_SHOTS ?? path.join(os.tmpdir(), "tikz-editor-chart-ui");
const AXIS = "axis:1";
const SOURCE = String.raw`\documentclass{article}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\begin{document}
\begin{tikzpicture}
\begin{axis}[xlabel={Time}, ylabel={Speed}, xmin=0, xmax=4, ymin=0, ymax=4]
\addplot[red, thick] coordinates {(1,1) (2,3) (3,2)};
\addlegendentry{measured}
\addplot coordinates {(0,2) (2,2.5) (4,3)};
\addlegendentry{model}
\end{axis}
\fill (-1,-2) circle (2pt);
\end{tikzpicture}
\end{document}`;

type TestApi = { __TIKZ_EDITOR_APP_TEST_API__: { selectSourceIds: (ids: string[]) => void; getActiveHandleId: () => string | null } };

test.use({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: Number(process.env.CHART_UI_SCALE ?? "1") });

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(shotDir, `${name}.png`) });
}

async function settled(page: Page): Promise<void> {
  await expectSourceCanvasConsistency(page, { assertNoActiveCanvasDrag: true });
}

async function select(page: Page, id: string): Promise<void> {
  await page.evaluate((sourceId) => (window as unknown as TestApi).__TIKZ_EDITOR_APP_TEST_API__.selectSourceIds([sourceId]), id);
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([id]);
}

/** A client point on a path region of `id` (a quarter along it), or the centre of its first region. */
async function pointOn(page: Page, id: string, mode?: "text"): Promise<{ x: number; y: number }> {
  const selector = mode ? `[data-hit-region-target-id='${id}'][data-hit-region-interaction-mode='${mode}']` : `[data-hit-region-target-id='${id}']`;
  const region = page.locator(selector).first();
  await expect(region).toBeAttached();
  return await region.evaluate((element) => {
    if (element instanceof SVGGeometryElement && element.ownerSVGElement && element.getTotalLength() > 0) {
      const sample = element.getPointAtLength(element.getTotalLength() * 0.25);
      const point = element.ownerSVGElement.createSVGPoint();
      point.x = sample.x; point.y = sample.y;
      const screen = point.matrixTransform(element.getScreenCTM() ?? undefined);
      return { x: screen.x, y: screen.y };
    }
    const r = element.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

async function openContextMenu(page: Page, id: string, mode?: "text"): Promise<void> {
  const at = await pointOn(page, id, mode);
  await page.mouse.click(at.x, at.y, { button: "right" });
  await expect(page.getByTestId("canvas-context-menu")).toBeVisible();
}

async function runContextCommand(page: Page, commandId: string): Promise<void> {
  await page.getByTestId(`canvas-context-cmd-${commandId}`).click();
}

/** Errors and warnings of parsing and evaluating a source in the editor's own pipeline. */
function diagnostics(source: string): string[] {
  const parsed = parseTikz(source, { includeContextDefinitions: true, recover: true });
  const result = evaluateTikzFigure(parsed.figure, source);
  return [...parsed.diagnostics, ...result.diagnostics].map((d) => `${d.severity}: ${d.message}`);
}

function inspector(page: Page) {
  return page.locator("[class*='_panel_']").filter({ has: page.getByText("Elements", { exact: true }) }).first();
}

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, SOURCE);
  await waitForHitRegions(page);
  await setCanvasTransform(page, { translateX: 200, translateY: 120, scale: 1.5 });
  await waitForHitRegions(page);
});

test("Escape steps out one level: data point, plot, axis, nothing", async ({ page }) => {
  await select(page, `${AXIS}:plot:0`);
  const handle = page.locator(`[data-source-id="${AXIS}:plot:0"][data-handle-kind]`).nth(1);
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) throw new Error("no handle");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => page.evaluate(() => (window as unknown as TestApi).__TIKZ_EDITOR_APP_TEST_API__.getActiveHandleId())).not.toBeNull();
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => (window as unknown as TestApi).__TIKZ_EDITOR_APP_TEST_API__.getActiveHandleId())).toBeNull();
  expect(await readSelectedSourceIds(page)).toEqual([`${AXIS}:plot:0`]);
  await page.keyboard.press("Escape");
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([AXIS]);
  await page.keyboard.press("Escape");
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([]);
  // A label steps up the same way.
  await select(page, `${AXIS}:xlabel`);
  await page.keyboard.press("Escape");
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([AXIS]);
  expect(await readSource(page)).toBe(SOURCE);
});

test("Escape steps out of a scope the same way", async ({ page }) => {
  await setSource(page, String.raw`\begin{tikzpicture}
\begin{scope}[shift={(1,0)}]
\fill (0,0) rectangle (2,0.8);
\fill (0,1.2) rectangle (2,2);
\end{scope}
\end{tikzpicture}`);
  await waitForHitRegions(page);
  await setCanvasTransform(page, { translateX: 300, translateY: 200, scale: 1 });
  await waitForHitRegions(page);
  await focusCanvas(page);
  await clickHitRegionByTargetId(page, "path:1");
  await expect.poll(() => readSelectedSourceIds(page)).toEqual(["scope:0"]);
  await clickHitRegionByTargetId(page, "path:1");
  await expect.poll(() => readSelectedSourceIds(page)).toEqual(["path:1"]);
  await page.keyboard.press("Escape");
  await expect.poll(() => readSelectedSourceIds(page)).toEqual(["scope:0"]);
  await page.keyboard.press("Escape");
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([]);
});

test("inspector: plain labels; automatic values are placeholders; clearing removes the key", async ({ page }) => {
  await setSource(page, SOURCE.replace("xmin=0, xmax=4, ymin=0, ymax=4", "xmax=4"));
  await waitForHitRegions(page);
  await select(page, AXIS);
  const panel = inspector(page);
  await expect(panel).toBeVisible();
  const labels = await panel.locator("[class*='propertyLabel'], [class*='checkboxLabel']").allTextContents();
  expect(labels.length).toBeGreaterThan(10);
  for (const label of labels) expect(label).not.toMatch(/auto:|\(auto/iu);
  expect(labels).toEqual(expect.arrayContaining(["Width", "Height", "X min", "Y max", "X tick step", "Title", "X label", "Legend", "Grid"]));
  await expect(panel.getByRole("textbox", { name: "Width", exact: true })).toHaveAttribute("placeholder", "240pt");
  await expect(panel.getByRole("textbox", { name: "X min", exact: true })).toHaveAttribute("placeholder", /^-?[\d.]+$/u);
  await expect(panel.getByRole("textbox", { name: "X tick step", exact: true })).toHaveAttribute("placeholder", "Auto");
  await shot(page, "inspector-placeholders");
  // Clearing a written value removes its key.
  const xmax = panel.getByRole("textbox", { name: "X max", exact: true });
  await xmax.fill("");
  await expect.poll(() => readSource(page)).toBe(SOURCE.replace("xmin=0, xmax=4, ymin=0, ymax=4", "").replace("ylabel={Speed}, ]", "ylabel={Speed}]"));
  await settled(page);
  await expect(xmax).toHaveAttribute("placeholder", /^-?[\d.]+$/u);
});

test("inspector Elements: one-click title, labels, legend and grid, each one clean edit", async ({ page }) => {
  await select(page, AXIS);
  const panel = inspector(page);
  await shot(page, "inspector-elements");
  await panel.getByRole("checkbox", { name: "Title", exact: true }).check();
  await expect.poll(() => readSource(page)).toBe(SOURCE.replace("ymax=4]", "ymax=4, title={Title}]"));
  await settled(page);
  await panel.getByRole("checkbox", { name: "Title", exact: true }).uncheck();
  await expect.poll(() => readSource(page)).toBe(SOURCE);
  await settled(page);
  await panel.getByRole("checkbox", { name: "X label", exact: true }).uncheck();
  await expect.poll(() => readSource(page)).toBe(SOURCE.replace("xlabel={Time}, ", ""));
  await settled(page);
  await panel.getByRole("checkbox", { name: "X label", exact: true }).check();
  await expect.poll(() => readSource(page)).toBe(SOURCE.replace("xlabel={Time}, ", "").replace("ymax=4]", "ymax=4, xlabel={$x$}]"));
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readSource(page)).toBe(SOURCE);
  await settled(page);
  await panel.getByRole("checkbox", { name: "Legend", exact: true }).uncheck();
  const noLegend = SOURCE.replace("\\addlegendentry{measured}\n", "").replace("\\addlegendentry{model}\n", "");
  await expect.poll(() => readSource(page)).toBe(noLegend);
  await settled(page);
  await panel.getByRole("checkbox", { name: "Legend", exact: true }).check();
  await expect.poll(() => readSource(page)).toBe(SOURCE.replace("{measured}", "{Series 1}").replace("{model}", "{Series 2}"));
  await settled(page);
  await panel.getByRole("button", { name: "Grid", exact: true }).click();
  await page.getByRole("option", { name: "Major", exact: true }).click();
  await expect.poll(() => readSource(page)).toContain("ymax=4, grid=major]");
  await settled(page);
});

test("Objects panel: title, label and legend rows select the parts; plots reorder by drag", async ({ page }) => {
  await page.getByText("Objects", { exact: true }).first().click();
  const panel = page.locator("[class*='_panel_']").filter({ has: page.getByRole("button", { name: "Coordinates \u2014 model" }) }).first();
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "X label", exact: true }).click();
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([`${AXIS}:xlabel`]);
  await panel.getByRole("button", { name: "Legend", exact: true }).click();
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([`${AXIS}:legend`]);
  // Selected from the panel, the part is outlined on the canvas as after a drill-in click.
  await expect(page.locator(`[data-selection-overlay-box-source-id='${AXIS}:legend']`)).toBeAttached();
  await shot(page, "objects-panel-parts");
  const second = panel.getByRole("button", { name: "Coordinates \u2014 model", exact: true });
  const first = panel.getByRole("button", { name: "Coordinates \u2014 measured", exact: true });
  await second.dragTo(first, { targetPosition: { x: 10, y: 2 } });
  const expected = SOURCE.replace(
    "\\addplot[red, thick] coordinates {(1,1) (2,3) (3,2)};\n\\addlegendentry{measured}\n\\addplot coordinates {(0,2) (2,2.5) (4,3)};\n\\addlegendentry{model}",
    "\\addplot coordinates {(0,2) (2,2.5) (4,3)};\n\\addlegendentry{model}\n\\addplot[red, thick] coordinates {(1,1) (2,3) (3,2)};\n\\addlegendentry{measured}"
  );
  await expect.poll(() => readSource(page)).toBe(expected);
  await settled(page);
});

test("toolbar chart gallery: every kind inserts, selected, without diagnostics", async ({ page }) => {
  const base = "\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}";
  for (const [index, kind] of CHART_KINDS.entries()) {
    await setSource(page, base);
    await waitForHitRegions(page);
    await page.getByTestId("toolbar-insert-chart").click();
    const popup = page.getByTestId("toolbar-tool-popup-insertChart");
    await expect(popup).toBeVisible();
    if (index === 0) await shot(page, "toolbar-chart-gallery");
    await popup.getByTestId(`toolbar-chart-choice-${kind.id}`).click();
    await expect(popup).toHaveCount(0);
    await expect.poll(() => readSource(page)).toContain(kind.template.split("\n")[1]?.trim() ?? "");
    const source = await readSource(page);
    expect(source.match(/compat=1\.18/gu), kind.id).toHaveLength(1);
    expect(diagnostics(source), kind.id).toEqual([]);
    await expect.poll(() => readSelectedSourceIds(page)).toEqual(["axis:2"]);
    await settled(page);
  }
});

test("axis context menu: elements, grid, insert plot, delete axis", async ({ page }) => {
  await openContextMenu(page, `${AXIS}:plot:0`);
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([AXIS]);
  const menu = page.getByTestId("canvas-context-menu");
  await expect(menu.getByText("Add Title", { exact: true })).toBeVisible();
  await expect(menu.getByText("Remove X Label", { exact: true })).toBeVisible();
  await expect(menu.getByText("Remove Legend", { exact: true })).toBeVisible();
  await shot(page, "context-menu-axis");
  await runContextCommand(page, "chart.toggle-title");
  // The new title is selected and its placeholder text is selected for typing.
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toHaveValue("Title");
  await textarea.press("ControlOrMeta+a");
  await textarea.pressSequentially("Results");
  await page.keyboard.press("Escape");
  await expect.poll(() => readSource(page)).toBe(SOURCE.replace("ymax=4]", "ymax=4, title={Results}]"));
  await settled(page);
  await setSource(page, SOURCE);
  await waitForHitRegions(page);
  await openContextMenu(page, `${AXIS}:plot:0`);
  await runContextCommand(page, "chart.toggle-ylabel");
  await expect.poll(() => readSource(page)).toBe(SOURCE.replace("ylabel={Speed}, ", ""));
  await settled(page);
  await openContextMenu(page, `${AXIS}:plot:0`);
  await page.getByTestId("canvas-context-menu").getByRole("menuitem", { name: "Grid" }).hover();
  await shot(page, "context-menu-axis-grid");
  await runContextCommand(page, "chart.grid-both");
  await expect.poll(() => readSource(page)).toContain("ymax=4, grid=both]");
  await settled(page);
  await setSource(page, SOURCE);
  await waitForHitRegions(page);
  await openContextMenu(page, `${AXIS}:plot:0`);
  await runContextCommand(page, "chart.toggle-legend");
  await expect.poll(() => readSource(page)).toBe(SOURCE.replace("\\addlegendentry{measured}\n", "").replace("\\addlegendentry{model}\n", ""));
  await settled(page);
  await setSource(page, SOURCE);
  await waitForHitRegions(page);
  await openContextMenu(page, `${AXIS}:plot:0`);
  await runContextCommand(page, "chart.insert-plot");
  await expect.poll(() => readSource(page)).toBe(SOURCE.replace("\\addlegendentry{model}\n", "\\addlegendentry{model}\n\\addplot coordinates {(0,3) (2,3.5) (4,4)};\n\\addlegendentry{Series 3}\n"));
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([`${AXIS}:plot:2`]);
  await settled(page);
  await setSource(page, SOURCE);
  await waitForHitRegions(page);
  await openContextMenu(page, `${AXIS}:plot:0`);
  await expect(page.getByTestId("canvas-context-cmd-edit.delete")).toHaveText(/Delete Axis/u);
  await runContextCommand(page, "edit.delete");
  await expect.poll(() => readSource(page)).not.toContain("\\begin{axis}");
});

test("plot context menu: legend entry, draw order (refusal shown), reset style, delete", async ({ page }) => {
  await select(page, `${AXIS}:plot:0`);
  await openContextMenu(page, `${AXIS}:plot:0`);
  const sendBackward = page.getByTestId("canvas-context-cmd-edit.send-backward");
  await expect(sendBackward).toBeDisabled();
  await expect(sendBackward).toHaveAttribute("title", /.+/u);
  await shot(page, "context-menu-plot");
  await runContextCommand(page, "chart.reset-plot-style");
  await expect.poll(() => readSource(page)).toBe(SOURCE.replace("\\addplot[red, thick] coordinates", "\\addplot coordinates"));
  await settled(page);
  await setSource(page, SOURCE);
  await waitForHitRegions(page);
  await select(page, `${AXIS}:plot:0`);
  await openContextMenu(page, `${AXIS}:plot:0`);
  await runContextCommand(page, "edit.bring-forward");
  await expect.poll(() => readSource(page)).toContain("\\addlegendentry{model}\n\\addplot[red, thick]");
  await settled(page);
  await setSource(page, SOURCE);
  await waitForHitRegions(page);
  await select(page, `${AXIS}:plot:1`);
  await openContextMenu(page, `${AXIS}:plot:1`);
  await runContextCommand(page, "chart.edit-legend-entry");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toHaveValue("model");
  await textarea.press("ControlOrMeta+a");
  await textarea.pressSequentially("fit");
  await page.keyboard.press("Escape");
  await expect.poll(() => readSource(page)).toBe(SOURCE.replace("{model}", "{fit}"));
  await settled(page);
  await select(page, `${AXIS}:plot:1`);
  await openContextMenu(page, `${AXIS}:plot:1`);
  await runContextCommand(page, "edit.delete");
  await expect.poll(() => readSource(page)).toBe(SOURCE.replace("{model}", "{fit}").replace("\\addplot coordinates {(0,2) (2,2.5) (4,3)};\n\\addlegendentry{fit}\n", ""));
});

test("label context menu: edit text, remove", async ({ page }) => {
  await select(page, `${AXIS}:ylabel`);
  await openContextMenu(page, `${AXIS}:ylabel`, "text");
  await shot(page, "context-menu-label");
  await runContextCommand(page, "chart.edit-text");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toHaveValue("Speed");
  await textarea.press("End");
  await page.keyboard.type(" (m/s)");
  await page.keyboard.press("Escape");
  await expect.poll(() => readSource(page)).toBe(SOURCE.replace("ylabel={Speed}", "ylabel={Speed (m/s)}"));
  await settled(page);
  await select(page, `${AXIS}:ylabel`);
  await openContextMenu(page, `${AXIS}:ylabel`, "text");
  await runContextCommand(page, "chart.remove-part");
  await expect.poll(() => readSource(page)).toBe(SOURCE.replace("ylabel={Speed}, ", ""));
  await settled(page);
  await select(page, `${AXIS}:legend`);
  await openContextMenu(page, `${AXIS}:legend`, "text");
  await runContextCommand(page, "chart.remove-part");
  await expect.poll(() => readSource(page)).not.toContain("addlegendentry");
});

test("change chart type in the inspector: unavailable kinds show their reason; one undo step", async ({ page }) => {
  await select(page, AXIS);
  const panel = inspector(page);
  await panel.getByRole("button", { name: "Chart type", exact: true }).click();
  // Scatter is not offered: the first plot is `\addplot[…]` without marks.
  const scatter = page.getByRole("option", { name: /^Scatter Plot/u });
  await expect(scatter).toHaveAttribute("aria-disabled", "true");
  await expect(scatter).toContainText("Choose a Mark first");
  await shot(page, "chart-type-unavailable");
  await page.getByRole("option", { name: "Bar Chart", exact: true }).click();
  const bar = SOURCE.replace("\\begin{axis}[xlabel", "\\begin{axis}[ybar, xlabel");
  await expect.poll(() => readSource(page)).toBe(bar);
  await settled(page);
  await shot(page, "chart-type-bar");
  await focusCanvas(page);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readSource(page)).toBe(SOURCE);
  await settled(page);
});

test("change plot type from the context menu; a refused type is disabled with its reason", async ({ page }) => {
  await select(page, `${AXIS}:plot:1`);
  await openContextMenu(page, `${AXIS}:plot:1`);
  await page.getByTestId("canvas-context-menu").getByRole("menuitem", { name: "Change Plot Type" }).hover();
  const bar = page.getByTestId("canvas-context-cmd-chart.plot-type-bar");
  await expect(bar).toBeDisabled();
  await expect(bar).toHaveAttribute("title", /legend/u);
  await shot(page, "context-menu-plot-type");
  await runContextCommand(page, "chart.plot-type-smooth");
  await expect.poll(() => readSource(page)).toBe(SOURCE.replace("\\addplot coordinates {(0,2)", "\\addplot+[smooth] coordinates {(0,2)"));
  await settled(page);
  await select(page, `${AXIS}:plot:1`);
  await openContextMenu(page, `${AXIS}:plot:1`);
  await page.getByTestId("canvas-context-menu").getByRole("menuitem", { name: "Change Plot Type" }).hover();
  await runContextCommand(page, "chart.plot-type-line");
  await expect.poll(() => readSource(page)).toBe(SOURCE);
  await settled(page);
});

test("edit a legend entry in place (\\addlegendentry form)", async ({ page }) => {
  // Click the axis, click the entry (drills into the legend), double-click the entry: as for the x label.
  const entry = page.locator(`[data-hit-region-target-id='${AXIS}:legend'][data-hit-region-interaction-mode='text']`).first();
  await expect(entry).toBeAttached();
  const plot = await pointOn(page, `${AXIS}:plot:1`);
  await page.mouse.click(plot.x, plot.y);
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([AXIS]);
  const box = await entry.boundingBox();
  if (!box) throw new Error("no legend entry region");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([`${AXIS}:legend`]);
  await entry.dblclick();
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toHaveValue("measured");
  await textarea.press("End");
  await page.keyboard.type(" data");
  await page.keyboard.press("Escape");
  await expect.poll(() => readSource(page)).toBe(SOURCE.replace("{measured}", "{measured data}"));
  await settled(page);
});
