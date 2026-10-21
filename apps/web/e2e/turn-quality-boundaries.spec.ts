import { expect, test } from "@playwright/test";
import {
  expectSourceCanvasConsistency, gotoApp, readStoreSource,
  resetStorageBeforeNavigation, setCanvasTransform, setSource
} from "./helpers";

for (const fixture of [
  { name: "rotated line", source: String.raw`\begin{tikzpicture}[rotate=90]
\draw (0,0) -- (1,0) -- ([turn]0:1cm);
\end{tikzpicture}`, vertical: true },
  { name: "arc continuation", source: String.raw`\begin{tikzpicture}
\draw (1,0) arc (0:90:1cm) -- ([turn]0:1cm);
\end{tikzpicture}`, vertical: false }
]) {
  test(`${fixture.name} renders and retains turn syntax through drag and undo`, async ({ page }) => {
    await resetStorageBeforeNavigation(page);
    await gotoApp(page);
    await setSource(page, fixture.source);
    await setCanvasTransform(page, { translateX: 200, translateY: 200, scale: 2 });
    await page.evaluate(() => {
      (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__: { selectSourceIds: (ids: string[]) => void } })
        .__TIKZ_EDITOR_APP_TEST_API__.selectSourceIds(["path:0"]);
    });
    const handles = page.locator('[data-handle-kind="move-handle"][data-source-id="path:0"]');
    await expect(handles.last()).toBeVisible();
    expect(await handles.count()).toBeGreaterThanOrEqual(2);
    const first = await handles.first().boundingBox();
    const last = await handles.last().boundingBox();
    if (!first || !last) throw new Error("Missing turn handles");
    if (fixture.vertical) {
      expect(Math.abs(last.x - first.x)).toBeLessThan(1);
      expect(last.y).toBeLessThan(first.y - 50);
    } else {
      expect(last.x).toBeLessThan(first.x - 50);
      expect(Math.abs((first.x - last.x) - 2 * (first.y - last.y))).toBeLessThan(1);
    }
    const x = last.x + last.width / 2;
    const y = last.y + last.height / 2;
    expect(await handles.last().evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) === element;
    })).toBe(true);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__: { getActiveCanvasDragKind: () => string | null } })
        .__TIKZ_EDITOR_APP_TEST_API__.getActiveCanvasDragKind()
    )).toBe("handle");
    await page.mouse.move(x + 64, y - 32, { steps: 4 });
    await expect.poll(() => readStoreSource(page)).not.toBe(fixture.source);
    // Recompute the preview before release: restoring the baseline can have
    // an ambiguous reverse diff, so the commit must retain gesture identity.
    await expectSourceCanvasConsistency(page, { minSceneSourceIds: 1, assertNoPendingRequest: true });
    const previewSource = await readStoreSource(page);
    await page.mouse.up();
    await expect.poll(() => readStoreSource(page)).toBe(previewSource);
    await expect.poll(() => readStoreSource(page)).not.toBe(fixture.source);
    expect(await readStoreSource(page)).toContain("([turn]");
    await expectSourceCanvasConsistency(page, { minSceneSourceIds: 1, assertNoActiveCanvasDrag: true, assertNoPendingRequest: true });
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => readStoreSource(page)).toBe(fixture.source);
    await expectSourceCanvasConsistency(page, { minSceneSourceIds: 1, assertNoActiveCanvasDrag: true, assertNoPendingRequest: true });
  });
}
