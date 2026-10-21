import { expect, test } from "@playwright/test";
import {
  expectSourceCanvasConsistency, gotoApp, openMenuCommand, readStoreSource,
  resetStorageBeforeNavigation, setCanvasTransform, setSource
} from "./helpers";

for (const fixture of [
  { name: "mixed Cartesian units", coordinate: "(1cm,1)", syntax: /--\s*\([^,]*cm\s*,[^)]*\)/ },
  { name: "dimensional polar radius", coordinate: "(30:1cm)", syntax: /--\s*\([^:]*:[^)]*cm\s*\)/ }
]) {
  test(`${fixture.name} survives custom-basis drag and undo`, async ({ page }) => {
    const source = String.raw`\begin{tikzpicture}[x=2cm,y=1cm,rotate=25]
\draw (0,0) -- ${fixture.coordinate};
\end{tikzpicture}`;
    await resetStorageBeforeNavigation(page);
    await gotoApp(page);
    for (const target of ["grid", "guides", "object-points", "object-gaps"]) {
      await openMenuCommand(page, "view", `view.toggle-snap-${target}`);
    }
    await setSource(page, source);
    await setCanvasTransform(page, { translateX: 200, translateY: 200, scale: 2 });
    await page.evaluate(() => {
      (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__: { selectSourceIds: (ids: string[]) => void } })
        .__TIKZ_EDITOR_APP_TEST_API__.selectSourceIds(["path:0"]);
    });
    const handles = page.locator('[data-handle-kind="move-handle"][data-source-id="path:0"]');
    await expect(handles.last()).toBeVisible();
    const before = await handles.last().boundingBox();
    if (!before) throw new Error("Missing endpoint handle");
    const x = before.x + before.width / 2, y = before.y + before.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__: { getActiveCanvasDragKind: () => string | null } })
        .__TIKZ_EDITOR_APP_TEST_API__.getActiveCanvasDragKind()
    )).toBe("handle");
    await page.mouse.move(x + 64, y - 32, { steps: 4 });
    await expect.poll(() => readStoreSource(page)).not.toBe(source);
    await expectSourceCanvasConsistency(page, { minSceneSourceIds: 1, assertNoPendingRequest: true });
    const preview = await readStoreSource(page);
    expect(preview).toMatch(fixture.syntax);
    await page.mouse.up();
    await expect.poll(() => readStoreSource(page)).toBe(preview);
    await expectSourceCanvasConsistency(page, {
      minSceneSourceIds: 1, assertNoActiveCanvasDrag: true, assertNoPendingRequest: true
    });
    const after = await handles.last().boundingBox();
    if (!after) throw new Error("Missing committed endpoint handle");
    expect(Math.abs(after.x - before.x - 64)).toBeLessThan(1.5);
    expect(Math.abs(after.y - before.y + 32)).toBeLessThan(1.5);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => readStoreSource(page)).toBe(source);
    await expectSourceCanvasConsistency(page, {
      minSceneSourceIds: 1, assertNoActiveCanvasDrag: true, assertNoPendingRequest: true
    });
  });
}
