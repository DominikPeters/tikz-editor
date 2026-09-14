import { expect, test } from "@playwright/test";
import { gotoApp, readSelectedSourceIds, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

for (const named of [true, false]) {
  test(`anchor drag preserves a separate triangle after reordering (${named ? "named" : "unnamed"} node)`, async ({ page }) => {
    await gotoApp(page);
    const triangle = String.raw`\fill[green] (10.3,49)--(11.6500,48.4250)--(11.6500,49.5750)--cycle;`;
    const source = String.raw`\begin{tikzpicture}[x=1mm,y=-1mm]
\draw[green] (26,49)--(11.1775,49.0000);
${triangle}
\node[draw,minimum width=14mm,minimum height=8mm]${named ? " (depot)" : ""} at (6,52) {Depot};
\end{tikzpicture}`;
    await setSource(page, source);
    await page.evaluate(async () => {
      const api = (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__: {
        selectSourceIds: (ids: string[]) => void;
        getCanvasTransform: () => { translateX: number; translateY: number; scale: number };
        setCanvasTransform: (transform: { translateX: number; translateY: number; scale: number }) => void;
      } }).__TIKZ_EDITOR_APP_TEST_API__;
      api.selectSourceIds(["path:0"]);
      api.setCanvasTransform(api.getCanvasTransform());
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    const handles = page.locator("[data-handle-kind='move-handle'][data-source-id='path:0']");
    await expect(handles).toHaveCount(2);
    const boxes = await handles.evaluateAll((elements) => elements.map((element, index) => {
      const box = element.getBoundingClientRect();
      return { index, x: box.x + box.width / 2 };
    }));
    const start = boxes.sort((a, b) => a.x - b.x)[0];
    await handles.nth(start.index).hover();
    await page.mouse.down();
    await expect.poll(() => page.evaluate(() =>
      (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { getActiveCanvasDragKind: () => string | null } }).__TIKZ_EDITOR_APP_TEST_API__.getActiveCanvasDragKind()
    )).toBe("handle");
    const nodeBox = await page.locator("[data-hit-region-target-id='path:2'][data-hit-region-interaction-mode='text']").first().boundingBox();
    if (!nodeBox) throw new Error("Expected Depot hit region");
    const target = { x: nodeBox.x + nodeBox.width / 2, y: nodeBox.y + nodeBox.height / 2 };
    await page.mouse.move(target.x, target.y);
    const reference = `(${named ? "depot" : "node1"})`;
    await expect.poll(() => readStoreSource(page)).toContain(`--${reference};`);
    await expect.poll(() => readSelectedSourceIds(page)).toEqual(["path:2"]);
    const connectedSource = await readStoreSource(page);
    expect(connectedSource).toContain(triangle);
    await expect.poll(() => page.evaluate(() => {
      const api = (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { getSource: () => string; getSnapshotSource: () => string } }).__TIKZ_EDITOR_APP_TEST_API__;
      return api.getSource() === api.getSnapshotSource();
    })).toBe(true);
    if (named) {
      // Exercise another move with the recycled id; the unnamed case instead
      // releases immediately with the anchor target from before it was named.
      await page.mouse.move(target.x + 1, target.y + 1);
    }
    await page.mouse.up();
    await expect.poll(() => readStoreSource(page)).toBe(connectedSource);
    await expect(page.getByTestId("canvas-warning-message")).toHaveCount(0);
    await expect.poll(() => readSelectedSourceIds(page)).toEqual(["path:2"]);

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => readStoreSource(page)).toBe(source);
  });
}
