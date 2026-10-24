import { expect, test, type Page } from "@playwright/test";
import {
  gotoApp,
  readSelectedSourceIds,
  readSource,
  resetStorageBeforeNavigation,
  setSource,
  waitForHitRegions
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

async function selectSourceIds(page: Page, sourceIds: string[]): Promise<void> {
  await page.evaluate((ids) => {
    const api = (globalThis as unknown as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        selectSourceIds?: (sourceIds: string[]) => void;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    api?.selectSourceIds?.(ids);
  }, sourceIds);
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(sourceIds);
}

function picture(...statements: string[]): string {
  return ["\\begin{tikzpicture}", ...statements.map((statement) => `  ${statement}`), "\\end{tikzpicture}"].join("\n");
}

test("the Fill checkbox switches the fill off and back on", async ({ page }) => {
  await gotoApp(page);
  const source = picture(String.raw`\filldraw[fill=red!30, thick] (0,0) rectangle (2,1);`);
  await setSource(page, source);
  await waitForHitRegions(page, 1);
  await selectSourceIds(page, ["path:0"]);

  const fill = page.getByRole("checkbox", { name: "Fill", exact: true });
  await expect(fill).toBeChecked();
  await expect(page.getByText("Mode", { exact: true })).toBeVisible();

  await fill.click();
  await expect.poll(async () => readSource(page)).toBe(picture(String.raw`\draw[thick] (0,0) rectangle (2,1);`));
  await expect(fill).not.toBeChecked();
  // With its paint off, the section is just its header.
  await expect(page.getByText("Mode", { exact: true })).toHaveCount(0);

  await fill.click();
  await expect.poll(async () => readSource(page)).toBe(source);
  await expect(fill).toBeChecked();
});

test("the Stroke checkbox keeps the fill colour and undoes in one step", async ({ page }) => {
  await gotoApp(page);
  const source = picture(String.raw`\draw[red, fill] (0,0) rectangle (2,1);`);
  await setSource(page, source);
  await waitForHitRegions(page, 1);
  await selectSourceIds(page, ["path:0"]);

  await page.getByRole("checkbox", { name: "Stroke", exact: true }).click();
  await expect.poll(async () => readSource(page)).toBe(picture(String.raw`\fill[red] (0,0) rectangle (2,1);`));

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => readSource(page)).toBe(source);
});

test("a mixed Fill checkbox switches every selected fill on", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, picture(
    String.raw`\filldraw[fill=red!30] (0,0) rectangle (2,1);`,
    String.raw`\draw (3,0) rectangle (4,1);`
  ));
  await waitForHitRegions(page, 2);
  await selectSourceIds(page, ["path:0", "path:1"]);

  const fill = page.getByRole("checkbox", { name: "Fill", exact: true });
  await expect.poll(async () => fill.evaluate((element) => (element as HTMLInputElement).indeterminate)).toBe(true);

  await fill.click();
  await expect.poll(async () => readSource(page)).toBe(picture(
    String.raw`\filldraw[fill=red!30] (0,0) rectangle (2,1);`,
    String.raw`\draw[fill] (3,0) rectangle (4,1);`
  ));
  await expect(fill).toBeChecked();
});
