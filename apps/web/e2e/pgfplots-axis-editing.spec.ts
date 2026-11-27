import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import {
  expectSourceCanvasConsistency,
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
import { readAxisEditInfo } from "../../../packages/core/src/edit/pgfplots/axis-actions";

/** The axis rectangle in world pt, from evaluating the source (client positions move with the canvas' picture bounds). */
function axisWorldBox(source: string): { x0: number; y0: number; x1: number; y1: number } {
  const parsed = parseTikz(source, { includeContextDefinitions: true, recover: true });
  const info = readAxisEditInfo(evaluateTikzFigure(parsed.figure, source).scene.elements, AXIS);
  if (!info) throw new Error("no axis geometry");
  const { a, d, e, f } = info.frame;
  return { x0: a * info.box.x0 + e, y0: d * info.box.y0 + f, x1: a * info.box.x1 + e, y1: d * info.box.y1 + f };
}

// Direct manipulation of pgfplots axes (design/pgfplots.md section 8).
// Screenshots of the key states go to PGFPLOTS_E2E_SCREENSHOTS (or a temp dir).
const screenshotDir = process.env.PGFPLOTS_E2E_SCREENSHOTS ?? path.join(os.tmpdir(), "tikz-editor-pgfplots-e2e");

const AXIS = "axis:1";
const SOURCE = String.raw`\documentclass{article}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\begin{document}
\begin{tikzpicture}
\begin{axis}[xlabel={Time}, ylabel={Speed}, xmin=0, xmax=4, ymin=0, ymax=4]
\addplot coordinates {(1,1) (2,3) (3,2)};
\addlegendentry{measured}
\end{axis}
\fill (-1,-2) circle (2pt);
\end{tikzpicture}
\end{document}`;
const SCALE = 1.5;
const pointer = { pointerId: 23, pointerType: "mouse", button: 0, buttons: 1, bubbles: true };

type TestWindow = Window & { __TIKZ_EDITOR_APP_TEST_API__: { selectSourceIds: (ids: string[]) => void } };

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(screenshotDir, `${name}.png`) });
}

type ClientBox = { left: number; top: number; right: number; bottom: number };

/**
 * Client bounds of the hit regions of one source id (the axis box path, ticks,
 * tick labels), relative to the reference dot: the canvas origin follows the
 * picture's bounds, so absolute client positions shift when the axis does.
 */
async function regionsBox(page: Page, targetId: string): Promise<ClientBox> {
  const box = await absoluteRegionsBox(page, targetId);
  const ref = await absoluteRegionsBox(page, "path:2");
  return { left: box.left - ref.left, top: box.top - ref.top, right: box.right - ref.left, bottom: box.bottom - ref.top };
}

async function absoluteRegionsBox(page: Page, targetId: string): Promise<ClientBox> {
  await expect(page.locator(`[data-hit-region-target-id='${targetId}']`).first()).toBeAttached();
  return await page.evaluate((id) => {
    let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
    for (const element of Array.from(document.querySelectorAll(`[data-hit-region-target-id='${id}']`))) {
      const r = element.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) continue;
      left = Math.min(left, r.left); top = Math.min(top, r.top); right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
    }
    return { left, top, right, bottom };
  }, targetId);
}

/** A client point on a path hit region (a quarter along it). */
async function pointOnRegion(page: Page, targetId: string): Promise<{ x: number; y: number }> {
  const region = page.locator(`[data-hit-region-target-id='${targetId}']`).first();
  return await region.evaluate((element) => {
    if (element instanceof SVGGeometryElement && element.ownerSVGElement) {
      const length = element.getTotalLength();
      const sample = element.getPointAtLength(length * 0.25);
      const point = element.ownerSVGElement.createSVGPoint();
      point.x = sample.x; point.y = sample.y;
      const screen = point.matrixTransform(element.getScreenCTM() ?? undefined);
      return { x: screen.x, y: screen.y };
    }
    const r = element.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

/** A point on the axis box line: the largest path region of the axis, a little way along its left edge. */
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

async function selectAxis(page: Page): Promise<ClientBox> {
  const box = await regionsBox(page, AXIS);
  const at = await axisBoxPoint(page);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([AXIS]);
  return box;
}

async function settled(page: Page): Promise<void> {
  await expectSourceCanvasConsistency(page, { assertNoActiveCanvasDrag: true });
}

test.use({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, SOURCE);
  await waitForHitRegions(page);
  await setCanvasTransform(page, { translateX: 200, translateY: 120, scale: SCALE });
  await waitForHitRegions(page);
});

test("select the axis, drag it: writes at= and the box follows the pointer", async ({ page }) => {
  await selectAxis(page);
  await shot(page, "01-axis-selected");
  await expect(page.getByText("Axis", { exact: true }).first()).toBeVisible();
  const start = await axisBoxPoint(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.keyboard.down("Control"); // no snapping: the written delta is the pointer's
  await page.mouse.move(start.x + 60, start.y - 30, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  await settled(page);
  expect(await readSelectedSourceIds(page)).toEqual([AXIS]);
  await shot(page, "02-axis-moved");
  const source = await readSource(page);
  expect(source).toMatch(/ymax=4, at=\{\([-\d.]+cm,[-\d.]+cm\)\}\]/u);
  // 60 px right, 30 px up at 1.5 px/pt: (40pt, 20pt), to the pointer's half-pixel precision.
  const was = axisWorldBox(SOURCE); const now = axisWorldBox(source);
  expect(Math.abs(now.x0 - was.x0 - 40)).toBeLessThan(0.5);
  expect(Math.abs(now.y0 - was.y0 - 20)).toBeLessThan(0.5);
  expect(now.x1 - now.x0).toBeCloseTo(was.x1 - was.x0, 6);
  await shot(page, "02-axis-moved");
});

test("resize the axis from its right edge: writes width (and pins height)", async ({ page }) => {
  await selectAxis(page);
  const handle = page.locator(`[data-handle-kind="resize-element"][data-source-id="${AXIS}"][data-resize-role="right"]`);
  await expect(handle).toBeVisible();
  const start = await handle.evaluate((element) => {
    const r = element.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await handle.dispatchEvent("pointerdown", { ...pointer, clientX: start.x, clientY: start.y });
  for (const dx of [20, 45, 60]) {
    await page.evaluate((init) => window.dispatchEvent(new PointerEvent("pointermove", init)), { ...pointer, ctrlKey: true, clientX: start.x + dx, clientY: start.y });
  }
  await page.evaluate((init) => window.dispatchEvent(new PointerEvent("pointerup", init)), { ...pointer, ctrlKey: true, buttons: 0, clientX: start.x + 60, clientY: start.y });
  await settled(page);
  const source = await readSource(page);
  expect(source).toMatch(/ymax=4, width=[\d.]+cm, height=[\d.]+cm\]/u);
  // The right edge follows the pointer (60 px = 40 pt); the left edge and the height stay.
  const was = axisWorldBox(SOURCE); const now = axisWorldBox(source);
  expect(Math.abs(now.x1 - was.x1 - 40)).toBeLessThan(0.5);
  expect(now.x0).toBeCloseTo(was.x0, 6);
  expect(Math.abs((now.y1 - now.y0) - (was.y1 - was.y0))).toBeLessThan(0.5);
  await shot(page, "03-axis-resized");
});

test("drill into a plot, change its colour in the inspector", async ({ page }) => {
  await selectAxis(page);
  const onLine = await pointOnRegion(page, `${AXIS}:plot:0`);
  await page.mouse.click(onLine.x, onLine.y);
  await expect.poll(() => readSelectedSourceIds(page)).toEqual([`${AXIS}:plot:0`]);
  await expect(page.getByText("Plot", { exact: true }).first()).toBeVisible();
  await shot(page, "04-plot-selected");
  await page.locator("xpath=//button[@aria-label='Color (cycle list)']").first().click();
  await shot(page, "04b-color-open");
  await page.getByRole("button", { name: "Color (cycle list) red" }).click();
  await expect.poll(() => readSource(page)).toBe(SOURCE.replace("\\addplot coordinates", "\\addplot+[color=red] coordinates"));
  await settled(page);
  // The plot stays selected across the edit of its axis.
  expect(await readSelectedSourceIds(page)).toEqual([`${AXIS}:plot:0`]);
  await shot(page, "05-plot-red");
});

test("edit the x label text in place", async ({ page }) => {
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
  await page.keyboard.type(" XYZ");
  await page.keyboard.press("Escape");
  await expect.poll(() => readSource(page)).toBe(SOURCE.replace("xlabel={Time}", "xlabel={Time XYZ}"));
  await settled(page);
  await shot(page, "06-xlabel-edited");
});

test("drag a data point of the selected plot: rewrites that (x,y) in data units", async ({ page }) => {
  await page.evaluate((id) => (window as TestWindow).__TIKZ_EDITOR_APP_TEST_API__.selectSourceIds([id]), `${AXIS}:plot:0`);
  const handles = page.locator(`[data-source-id="${AXIS}:plot:0"][data-handle-kind]`);
  await expect.poll(() => handles.count()).toBeGreaterThanOrEqual(3);
  await shot(page, "07-point-handles");
  const second = handles.nth(1);
  const start = await second.evaluate((element) => {
    const r = element.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // One data unit is a quarter of the 195 x 162 pt box.
  await page.mouse.move(start.x + 0.5 * (195 * SCALE / 4), start.y + (162 * SCALE / 4), { steps: 6 });
  await shot(page, "07b-mid-drag");
  await page.mouse.up();
  await settled(page);
  // Written to the pointer's precision (half a pixel in data units: two decimals here).
  const dragged = await readSource(page);
  expect(dragged).toMatch(/\\addplot coordinates \{\(1,1\) \(2\.(?:49|5|51),(?:1\.99|2|2\.01)\) \(3,2\)\};/u);
  expect(dragged.replace(/\(2\.\d+,[\d.]+\)/u, "(2,3)")).toBe(SOURCE);
  expect(await readSelectedSourceIds(page)).toEqual([`${AXIS}:plot:0`]);
  await shot(page, "08-point-dragged");
});
