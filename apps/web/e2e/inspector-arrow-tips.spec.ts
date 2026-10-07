import { expect, test } from "@playwright/test";
import {
  expectSourceCanvasConsistency,
  gotoApp,
  readSelectedSourceIds,
  readSource,
  resetStorageBeforeNavigation,
  selectFirstCanvasElement,
  setSource
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
});

for (const color of ["", ", red", ", blue", ", draw=red"]) {
  test(`arrow tip previews and commits preserve selection and color ${color || "black"} (#32)`, async ({ page }) => {
    const source = String.raw`\begin{tikzpicture}
\draw[->${color}] (0.89,1.5) -- (2.5,2.27);
\end{tikzpicture}`;
    await setSource(page, source);
    await selectFirstCanvasElement(page);
    await expect.poll(() => readSelectedSourceIds(page)).toEqual(["path:0"]);

    const dropdown = page.getByRole("button", { name: "End arrow type", exact: true });
    await dropdown.click();
    await page.getByRole("option", { name: "Stealth", exact: true }).hover();
    await expect.poll(() => readSource(page)).toContain("Stealth");
    await expectSourceCanvasConsistency(page);
    await page.getByRole("option", { name: "Latex", exact: true }).hover();
    await expect.poll(() => readSource(page)).toContain("Latex");
    await expectSourceCanvasConsistency(page);
    await page.mouse.move(5, 5);
    await expect.poll(() => readSource(page)).toBe(source);
    await expectSourceCanvasConsistency(page);
    await expect.poll(() => readSelectedSourceIds(page)).toEqual(["path:0"]);
    await expect(dropdown).toHaveAttribute("aria-expanded", "true");

    await page.getByRole("option", { name: "Stealth", exact: true }).click();
    await expect.poll(() => readSource(page)).toContain("arrows=-Stealth");
    await expectSourceCanvasConsistency(page);
    await expect.poll(() => readSelectedSourceIds(page)).toEqual(["path:0"]);
    if (color) expect(await readSource(page)).toContain(color.slice(2));
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => readSource(page)).toBe(source);
    await expectSourceCanvasConsistency(page);
    await expect.poll(() => readSelectedSourceIds(page)).toEqual(["path:0"]);
  });
}

test("canceling a colored arrow preview keeps the figure and selection (#32)", async ({ page }) => {
  const source = String.raw`\begin{tikzpicture}\draw[<->, red] (0,0) -- (2,1);\end{tikzpicture}`;
  await setSource(page, source);
  await selectFirstCanvasElement(page);
  await page.getByRole("button", { name: "Begin arrow type", exact: true }).click();
  await page.getByRole("option", { name: "Stealth", exact: true }).hover();
  await expect.poll(() => readSource(page)).toContain("Stealth");
  await expectSourceCanvasConsistency(page);
  await page.keyboard.press("Escape");
  await expect.poll(() => readSource(page)).toBe(source);
  await expectSourceCanvasConsistency(page);
  await expect.poll(() => readSelectedSourceIds(page)).toEqual(["path:0"]);
});
