import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { expectSourceCanvasConsistency, gotoApp, readSelectedSourceIds, readSource, resetStorageBeforeNavigation, setCanvasTransform, setSource, waitForHitRegions } from "./helpers";

// The plot data grid (inspector Data table > Edit Data…): cell edits, paste,
// rows, symbolic categories, inline table header rename, undo, a 20k-row table.
const shotDir = process.env.CHART_UI_SHOTS ?? path.join(os.tmpdir(), "tikz-editor-chart-ui");
const doc = (body: string) => String.raw`\documentclass{article}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\begin{document}
\begin{tikzpicture}
${body}
\end{tikzpicture}
\end{document}`;
const COORDS = doc(String.raw`\begin{axis}[xlabel={Time}, ylabel={Value}]
  \addplot coordinates {(0,1.2) (1,2.3) (2,2.9) (3,4.1)};
  \addlegendentry{Measurements}
\end{axis}`);
const BARS = doc(String.raw`\begin{axis}[ybar, ymin=0, symbolic x coords={Q1,Q2,Q3}, xtick=data]
  \addplot coordinates {(Q1,3) (Q2,5) (Q3,4)};
\end{axis}`);
const TABLE = doc(String.raw`\begin{axis}[xlabel={$t$}]
  \addplot table [x=t, y=v] {
    t v
    0 1.0
    1 1.5
    2 3.0
  };
\end{axis}`);

type TestApi = { __TIKZ_EDITOR_APP_TEST_API__: { selectSourceIds: (ids: string[]) => void } };

test.use({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: Number(process.env.CHART_UI_SCALE ?? "1") });

async function open(page: Page, source: string): Promise<void> {
  await setSource(page, source);
  await waitForHitRegions(page);
  await page.evaluate(() => (window as unknown as TestApi).__TIKZ_EDITOR_APP_TEST_API__.selectSourceIds(["axis:1:plot:0"]));
  await expect.poll(() => readSelectedSourceIds(page)).toEqual(["axis:1:plot:0"]);
  await page.getByRole("button", { name: "Edit Data…" }).click();
  await expect(page.getByTestId("plot-data-panel")).toBeVisible();
}

function cell(page: Page, row: number, column: number) {
  return page.getByTestId("plot-data-panel").locator(`[role='gridcell'][data-row='${String(row)}'][data-column='${String(column)}']`);
}

async function typeInto(page: Page, row: number, column: number, text: string, key = "Enter"): Promise<void> {
  await cell(page, row, column).click();
  await cell(page, row, column).dblclick();
  const editor = cell(page, row, column).locator("input");
  await expect(editor).toBeVisible();
  await editor.fill(text);
  await editor.press(key);
}

async function settled(page: Page): Promise<void> {
  await expectSourceCanvasConsistency(page, { assertNoActiveCanvasDrag: true });
}

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setCanvasTransform(page, { translateX: 200, translateY: 120, scale: 1.3 });
});

test("coordinates: edit a cell, Escape cancels, paste a block, add and delete rows, each one undo step", async ({ page }) => {
  await open(page, COORDS);
  await page.screenshot({ path: path.join(shotDir, "data-grid-coordinates.png") });
  await typeInto(page, 1, 1, "2.5");
  await expect.poll(() => readSource(page)).toBe(COORDS.replace("(1,2.3)", "(1,2.5)"));
  await settled(page);
  // Enter moved down a row; typing starts an edit, Escape cancels it.
  await page.keyboard.type("9");
  await expect(cell(page, 2, 1).locator("input")).toHaveValue("9");
  await page.keyboard.press("Escape");
  await expect(cell(page, 2, 1).locator("input")).toHaveCount(0);
  await expect(page.getByTestId("plot-data-panel")).toBeVisible();
  // Undo from the grid.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readSource(page)).toBe(COORDS);
  // Paste a block from a spreadsheet at row 3 (past the end: rows are added).
  await cell(page, 3, 0).click();
  await page.evaluate(() => {
    const grid = document.querySelector("[data-testid='plot-data-panel'] [role='grid']");
    const data = new DataTransfer();
    data.setData("text/plain", "3\t4.0\n4\t4.6\n5\t5.1\n");
    grid?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => readSource(page)).toBe(COORDS.replace("(3,4.1)", "(3,4.0) (4,4.6) (5,5.1)"));
  await settled(page);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readSource(page)).toBe(COORDS);
  await cell(page, 0, 0).click();
  await page.getByRole("button", { name: "Add Row" }).click();
  await expect.poll(() => readSource(page)).toBe(COORDS.replace("(0,1.2) (1,2.3)", "(0,1.2) (1,2.3) (1,2.3)"));
  await page.getByRole("button", { name: "Delete Row" }).click();
  await expect.poll(() => readSource(page)).toBe(COORDS);
  await settled(page);
});

test("symbolic bars: a new category is added to the axis' list in the same edit", async ({ page }) => {
  await open(page, BARS);
  await page.screenshot({ path: path.join(shotDir, "data-grid-symbolic.png") });
  await cell(page, 2, 0).click();
  await page.getByRole("button", { name: "Add Row" }).click();
  await expect.poll(() => readSource(page)).toBe(BARS.replace("(Q3,4)", "(Q3,4) (Q3,4)"));
  await typeInto(page, 3, 0, "Q4");
  await expect.poll(() => readSource(page)).toBe(BARS.replace("{Q1,Q2,Q3}", "{Q1,Q2,Q3,Q4}").replace("(Q3,4)", "(Q3,4) (Q4,4)"));
  await settled(page);
  // One undo step takes back both the point and the category.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readSource(page)).toBe(BARS.replace("(Q3,4)", "(Q3,4) (Q3,4)"));
});

test("inline table: header rename updates the plot's column references; cells keep the layout", async ({ page }) => {
  await open(page, TABLE);
  await page.screenshot({ path: path.join(shotDir, "data-grid-table.png") });
  await typeInto(page, -1, 1, "speed");
  await expect.poll(() => readSource(page)).toBe(TABLE.replace("y=v]", "y=speed]").replace("    t v\n", "    t speed\n"));
  await settled(page);
  await typeInto(page, 0, 1, "1.25", "Tab");
  await expect.poll(() => readSource(page)).toContain("    0 1.25\n");
  await settled(page);
});

test("a 20,000-row table opens and commits without freezing", async ({ page }) => {
  const rows = Array.from({ length: 20000 }, (_, index) => `    ${String(index)} ${String((index * 7) % 13)}`).join("\n");
  const big = doc(`\\begin{axis}\n  \\addplot table {\n    x y\n${rows}\n  };\n\\end{axis}`);
  await setSource(page, big);
  await waitForHitRegions(page);
  await page.evaluate(() => (window as unknown as TestApi).__TIKZ_EDITOR_APP_TEST_API__.selectSourceIds(["axis:1:plot:0"]));
  await expect.poll(() => readSelectedSourceIds(page)).toEqual(["axis:1:plot:0"]);
  const started = Date.now();
  await page.getByRole("button", { name: "Edit Data…" }).click();
  await expect(cell(page, 0, 0)).toBeVisible();
  const openMs = Date.now() - started;
  // Only the rows in view are drawn.
  expect(await page.getByTestId("plot-data-panel").locator("[role='row']").count()).toBeLessThan(80);
  const commitStarted = Date.now();
  await typeInto(page, 0, 1, "12");
  await expect.poll(() => readSource(page)).toContain("\n    0 12\n");
  await expect(cell(page, 0, 1)).toHaveText("12");
  const commitMs = Date.now() - commitStarted;
  console.log(`20k rows: open ${String(openMs)} ms, commit ${String(commitMs)} ms`);
  expect(openMs).toBeLessThan(5000);
  expect(commitMs).toBeLessThan(5000);
});
