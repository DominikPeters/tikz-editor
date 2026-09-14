import { expect, test } from "@playwright/test";
import {
  clickTextHitRegionByTargetId,
  gotoApp,
  readSelectedSourceIds,
  readStoreSource,
  resetStorageBeforeNavigation,
  setSource
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

for (const { options, closeEditor } of [
  { options: "tiny", closeEditor: true },
  { options: "tiny,rotate=30,inner sep=0pt", closeEditor: false }
]) {
  test(`selected text node frame drags over a filled background (${options}, editor ${closeEditor ? "closed" : "open"})`, async ({ page }) => {
    await gotoApp(page);
    const background = String.raw`\fill[white] (-3.75,0) rectangle (156.25,120);`;
    const text = String.raw`$f_i(s^*)\approx0.60$`;
    const initialSource = String.raw`\begin{tikzpicture}[x=1mm,y=-1mm]
${background}
\node[${options}] at (139,101.5) {${text}};
\end{tikzpicture}`;
    await setSource(page, initialSource);

    await clickTextHitRegionByTargetId(page, "path:1");
    await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveValue(text);
    if (closeEditor) {
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("canvas-text-edit-popup")).toHaveCount(0);
    }
    await expect.poll(() => readSelectedSourceIds(page)).toEqual(["path:1"]);

    // Use real mouse hit testing just outside the visible frame, away from its
    // resize handles. The background must not receive this pointerdown.
    const frame = page.locator("[data-selection-overlay-box-source-id='path:1']");
    const start = await frame.evaluate((element) => {
      const polygon = element as SVGPolygonElement;
      const matrix = polygon.getScreenCTM();
      if (!matrix) throw new Error("Missing selection frame transform.");
      const points = Array.from(polygon.points).map((point) => point.matrixTransform(matrix));
      const a = points[0];
      const b = points[1];
      const center = points.reduce((sum, point) => ({
        x: sum.x + point.x / points.length,
        y: sum.y + point.y / points.length
      }), { x: 0, y: 0 });
      const edge = { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 };
      const normal = { x: b.y - a.y, y: a.x - b.x };
      const direction = normal.x * (edge.x - center.x) + normal.y * (edge.y - center.y) > 0 ? 1 : -1;
      const length = Math.hypot(normal.x, normal.y);
      return {
        x: edge.x + direction * normal.x * 3 / length,
        y: edge.y + direction * normal.y * 3 / length
      };
    });

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await expect.poll(() => readSelectedSourceIds(page)).toEqual(["path:1"]);
    await page.mouse.move(start.x - 100, start.y - 65, { steps: 12 });
    await expect.poll(() => readStoreSource(page)).not.toBe(initialSource);
    await page.mouse.up();

    const movedSource = await readStoreSource(page);
    expect(movedSource).toContain(background);
    expect(movedSource).toContain(`{${text}}`);
    expect(movedSource).not.toContain("at (139,101.5)");
    await expect.poll(() => readSelectedSourceIds(page)).toEqual(["path:1"]);
    await expect(page.getByTestId("canvas-text-edit-popup")).toHaveCount(0);

    // A broad frame target must leave even tiny, unpadded text editable.
    await clickTextHitRegionByTargetId(page, "path:1");
    await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveValue(text);
    expect(await readStoreSource(page)).toBe(movedSource);
  });
}
