import { expect, test, type Page } from "@playwright/test";

import {
  canvasViewport,
  clickHitRegionByTargetId,
  dragBetweenPoints,
  gotoApp,
  openMenuCommand,
  readSource,
  resetStorageBeforeNavigation,
  setSource,
  waitForHitRegions
} from "./helpers";

// The e2e build registers the in-repo smiley test add-on statically
// (VITE_TEST_ADDONS=1 in the playwright web server command), so these tests
// exercise the full add-on pipeline in the production bundle: parsing,
// rendering, selection, inspector edits, completion, and the add-on manager.

const SMILEY_SOURCE = [
  "\\begin{tikzpicture}",
  "\\smileyset{mood=happy}",
  "\\begin{smileybox}[padding=0.4]",
  "\\smiley (0,0);",
  "\\smiley[radius=0.6, fill=orange] (2.4,0);",
  "\\end{smileybox}",
  "\\draw[->, thick] (smiley cs:-1.4,0.6) .. controls (1.2,2.2) .. (smiley.north);",
  "\\end{tikzpicture}"
].join("\n");

type TestApi = {
  getSceneSourceIds: () => string[];
  selectSourceIds: (sourceIds: string[]) => void;
  getSource: () => string;
  runCommand: (commandId: string) => boolean;
};

async function evaluateTestApi<T>(page: Page, fn: (api: TestApi) => T): Promise<T> {
  return await page.evaluate((body) => {
    const api = (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__?: TestApi }).__TIKZ_EDITOR_APP_TEST_API__;
    if (!api) {
      throw new Error("App test API is unavailable.");
    }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return (new Function("api", `return (${body})(api);`) as (api: TestApi) => T)(api);
  }, fn.toString());
}

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, SMILEY_SOURCE);
});

test("claimed add-on statements render as scene elements", async ({ page }) => {
  await expect.poll(() => evaluateTestApi(page, (api) => api.getSceneSourceIds())).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^addon-environment:/),
      expect.stringMatching(/^addon-command:/),
      expect.stringMatching(/^path:/)
    ])
  );
  // Face + eyes for two smileys, drawn as SVG circles on the canvas.
  await expect
    .poll(async () => await page.locator("[data-testid='canvas-panel'] circle, svg circle").count())
    .toBeGreaterThanOrEqual(6);
});

test("selecting a smiley shows the add-on inspector and writes edits to source", async ({ page }) => {
  await expect
    .poll(() =>
      evaluateTestApi(page, (api) => api.getSceneSourceIds().find((id) => id.startsWith("addon-command:")))
    )
    .toBeTruthy();
  await evaluateTestApi(page, (api) => {
    const id = api.getSceneSourceIds().find((entry) => entry.startsWith("addon-command:"));
    if (id) {
      api.selectSourceIds([id]);
    }
  });

  const radiusRow = page.getByTestId("addon-property-addon:smiley:radius");
  await expect(radiusRow).toBeVisible();
  const radiusInput = radiusRow.locator("input[type='number']");
  await radiusInput.fill("1.5");
  await radiusInput.press("Enter");

  await expect.poll(() => evaluateTestApi(page, (api) => api.getSource())).toContain("radius=1.5");
});

test("add-on completion offers claimed commands", async ({ page }) => {
  const lastLine = page.locator(".cm-line", { hasText: "\\end{tikzpicture}" }).first();
  await lastLine.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.type("\\smi", { delay: 40 });

  const completions = page.locator(".cm-tooltip-autocomplete");
  await expect(completions).toBeVisible();
  await expect(completions).toContainText("\\smiley");
  await expect(completions).toContainText("\\smileyset");
});

test("the add-on manager lists the smiley add-on and disabling it deactivates claiming", async ({ page }) => {
  await evaluateTestApi(page, (api) => api.runCommand("file.open-settings"));
  await expect(page.getByTestId("settings-modal")).toBeVisible();
  await page.getByTestId("settings-category-addons").click();

  const row = page.getByTestId("addon-row-smiley");
  await expect(row).toBeVisible();
  await expect(row).toContainText("Smiley (test add-on)");
  await expect(row).toContainText("MIT");

  await row.locator("input[type='checkbox']").uncheck();
  await page.keyboard.press("Escape");

  // With the add-on disabled, claimed statements fall back to unknown
  // statements and stop producing scene elements.
  await expect
    .poll(() => evaluateTestApi(page, (api) => api.getSceneSourceIds()))
    .not.toEqual(expect.arrayContaining([expect.stringMatching(/^addon-command:/)]));
});

const EMPTY_SOURCE = "\\begin{tikzpicture}\n\\draw (0,0) -- (0.1,0);\n\\end{tikzpicture}";

test("the Insert menu arms the smiley tool and a canvas click places a smiley", async ({ page }) => {
  await setSource(page, EMPTY_SOURCE);
  await expect(page.getByTestId("toolbar-addon-addon:smiley:smiley")).toBeVisible();

  await openMenuCommand(page, "insert", "addon:smiley:insert-smiley");

  const box = await canvasViewport(page).boundingBox();
  if (!box) {
    throw new Error("Missing canvas viewport bounds.");
  }
  await page.mouse.click(box.x + box.width / 2 + 120, box.y + box.height / 2 - 90);

  await expect.poll(async () => await readSource(page)).toMatch(/\\smiley \(-?[\d.]+,-?[\d.]+\);/);
});

test("dragging with the smiley tool shows a ghost preview and inserts with the dragged size", async ({ page }) => {
  await setSource(page, EMPTY_SOURCE);

  await page.getByTestId("toolbar-addon-addon:smiley:smiley").click();

  const viewport = canvasViewport(page);
  const box = await viewport.boundingBox();
  if (!box) {
    throw new Error("Missing canvas viewport bounds.");
  }
  await dragBetweenPoints(
    page,
    viewport,
    { x: box.width / 2 + 60, y: box.height / 2 - 120 },
    { x: box.width / 2 + 180, y: box.height / 2 - 20 }
  );
  await expect(page.getByTestId("canvas-tool-preview-path")).toBeVisible();
  await page.mouse.up();

  await expect
    .poll(async () => await readSource(page))
    .toMatch(/\\smiley\[radius=[\d.]+\] \(-?[\d.]+,-?[\d.]+\);/);
});

test("right-clicking a smiley offers the add-on context-menu action", async ({ page }) => {
  await waitForHitRegions(page, 1);
  const clickedId = await evaluateTestApi(page, (api) =>
    api.getSceneSourceIds().find((id) => id.startsWith("addon-command:"))
  );
  expect(clickedId).toBeTruthy();

  await clickHitRegionByTargetId(page, clickedId!, { button: "right" });
  const growItem = page.getByTestId("canvas-context-cmd-addon:smiley:grow");
  await expect(growItem).toBeVisible();
  // The appended add-on item sits at the bottom of the long selection menu,
  // which can overflow the test viewport — dispatch the click directly.
  await growItem.dispatchEvent("click");

  // The clicked smiley's radius grows by 25% (1 -> 1.25 or 0.6 -> 0.75).
  await expect.poll(async () => await readSource(page)).toMatch(/radius=(1\.25|0\.75)/);
});
