import { expect, test, type Page } from "@playwright/test";
import { expectSourceCanvasConsistency, gotoApp, readSource, resetStorageBeforeNavigation, setSource, waitForHitRegions } from "./helpers";

const SOURCE = String.raw`\begin{tikzpicture}
\filldraw[fill=blue!20] (0,0) rectangle (2,2);
\end{tikzpicture}`;

async function startPreview(page: Page) {
  await page.getByTestId("toolbar-bucket-color-caret").click();
  await page.getByRole("button", { name: "Bucket fill color red" }).click();
  await waitForHitRegions(page, 1);
  const box = await page.locator("[data-hit-region-target-id='path:0']").first().boundingBox();
  if (!box) throw new Error("Missing bucket target");
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y);
  await expect.poll(() => readSource(page)).toContain("fill=red!60");
  return point;
}

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, SOURCE);
});

test("bucket commits a preview as an undoable edit", async ({ page }) => {
  const point = await startPreview(page);
  await expectSourceCanvasConsistency(page);
  await page.mouse.click(point.x, point.y);
  await page.mouse.move(5, 5);
  await expect.poll(() => readSource(page)).toContain("fill=red!60");
  await expectSourceCanvasConsistency(page);
  const committed = await readSource(page);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readSource(page)).toBe(SOURCE);
  await expectSourceCanvasConsistency(page);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => readSource(page)).toBe(committed);
});

test("bucket preview preserves an intervening source edit and can restart on a new hover", async ({ page }) => {
  const point = await startPreview(page);
  const edited = SOURCE + "\n% independent source edit";
  await setSource(page, edited);
  await expectSourceCanvasConsistency(page);
  await expect.poll(() => readSource(page)).toBe(edited);
  await page.mouse.move(5, 5);
  await expect.poll(() => readSource(page)).toBe(edited);
  await page.mouse.move(point.x, point.y);
  await expect.poll(() => readSource(page)).toContain("fill=red!60");
  expect(await readSource(page)).toContain("independent source edit");
  await page.mouse.move(5, 5);
  await expect.poll(() => readSource(page)).toBe(edited);
});

test("bucket target changes restore the previous target on the rendered canvas", async ({ page }) => {
  await setSource(page, SOURCE.replace("\\end{tikzpicture}", String.raw`\filldraw[fill=green!20] (3,0) rectangle (5,2);\end{tikzpicture}`));
  const firstPath = page.locator("svg path[data-source-id='path:0'][fill]:not([fill='none'])").first();
  await expect(firstPath).toBeVisible();
  const originalFill = await firstPath.getAttribute("fill");
  await startPreview(page);
  await expectSourceCanvasConsistency(page);
  await expect(firstPath).not.toHaveAttribute("fill", originalFill!);
  const second = await page.locator("[data-hit-region-target-id='path:1']").first().boundingBox();
  if (!second) throw new Error("Missing second bucket target");
  await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2);
  await expectSourceCanvasConsistency(page);
  await expect(firstPath).toHaveAttribute("fill", originalFill!);
});
