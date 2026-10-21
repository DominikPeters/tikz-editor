import { expect, test } from "@playwright/test";
import {
  expectSourceCanvasConsistency,
  gotoApp,
  readSource,
  resetStorageBeforeNavigation,
  setSource,
  waitForHitRegions
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
});

for (const [literal, expected] of [[".33", "0.63"], ["-.11", "0.19"], ["1e-3", "0.301"], ["1.", "1.3"]]) {
  test(`source scrubbing replaces ${literal} through repeated moves`, async ({ page }) => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (C) at (0.85,5.30);
\node at ($(C)+(${literal},.11)$) {Label};
\end{tikzpicture}`;
    await setSource(page, source);
    const start = await page.locator(".cm-content").first().evaluate((editor, literal) => {
      const line = Array.from(editor.querySelectorAll(".cm-line")).find(element => element.textContent?.includes(`(${literal},.11)`));
      if (!line) throw new Error("Missing calc source line");
      const offset = line.textContent.indexOf(`(${literal},.11)`) + 1;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let consumed = 0;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const length = node.textContent?.length ?? 0;
        const target = offset + (literal.startsWith("-") ? 1 : 0);
        if (target >= consumed && target < consumed + length) {
          const range = document.createRange();
          range.setStart(node, target - consumed);
          range.setEnd(node, target - consumed + 1);
          const box = range.getBoundingClientRect();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        }
        consumed += length;
      }
      throw new Error("Missing number glyph");
    }, literal);
    await page.mouse.move(start.x,start.y);
    await expect(page.locator(".cm-editor.cm-scrub-hover")).toHaveCount(1);
    await page.mouse.down();
    for (const delta of [8,16,24]) {
      await page.mouse.move(start.x + delta,start.y);
      await expectSourceCanvasConsistency(page);
    }
    await page.mouse.up();
    await expect.poll(() => readSource(page)).toContain(`(${expected},.11)`);
    await expect(page.getByTestId("canvas-warning-message")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => readSource(page)).toBe(source);
    await expectSourceCanvasConsistency(page);
  });
}

test("bare calc text selects text and dragging its padding keeps the reference and supports undo", async ({ page }) => {
  const source = String.raw`\begin{tikzpicture}
\coordinate (C) at (0.85,5.30);
\node[anchor=south west,font=\scriptsize] at ($(C)+(.33,.11)$) {\(\mathcal F_c,\ \mathbf C_p\)};
\end{tikzpicture}`;
  await setSource(page, source);
  await waitForHitRegions(page,1);
  const text = page.locator("[data-hit-region-target-id='path:1'][data-hit-region-interaction-mode='text']").first();
  const box = await text.boundingBox();
  if (!box) throw new Error("Missing calc label hit region");
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toHaveValue(String.raw`\(\mathcal F_c,\ \mathbf C_p\)`);
  await expect.poll(() => textarea.evaluate((element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart)).toBeGreaterThan(0);
  expect(await readSource(page)).toBe(source);
  await page.keyboard.press("Escape");

  const moveBox = await page.locator("[data-hit-region-target-id='path:1'][data-hit-region-interaction-mode='move']").first().boundingBox();
  if (!moveBox) throw new Error("Missing calc label movement region");
  const start = { x: moveBox.x + moveBox.width / 2, y: (moveBox.y + box.y) / 2 };
  await page.mouse.move(start.x,start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 35,start.y - 20,{ steps: 5 });
  await page.mouse.up();
  await expect.poll(() => readSource(page)).not.toBe(source);
  const moved = await readSource(page);
  expect(moved).toContain(String.raw`\coordinate (C) at (0.85,5.30);`);
  expect(moved).toMatch(/\$\(C\)\+\([+-]?\d+(?:\.\d+)?,[+-]?\d+(?:\.\d+)?\)\$/u);
  await expectSourceCanvasConsistency(page,{ assertNoActiveCanvasDrag:true });
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => readSource(page)).toBe(source);
  await text.click();
  await expect(page.getByTestId("canvas-text-edit-textarea")).toBeVisible();
});
