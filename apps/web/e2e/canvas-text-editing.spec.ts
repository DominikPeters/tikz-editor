import { expect, test, type Page } from "@playwright/test";
import {
  clickTextHitRegionByTargetId,
  dragHitRegionByTargetIdAndMode,
  gotoApp,
  readSelectedSourceIds,
  readStoreSource,
  resetStorageBeforeNavigation,
  setSource,
  waitForHitRegions
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

const PRIMARY_MOD = process.platform === "darwin" ? "Meta" : "Control";

async function setTextareaSelection(page: Page, start: number, end: number): Promise<void> {
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await textarea.evaluate((element, selection) => {
    const [nextStart, nextEnd] = selection as [number, number];
    const textareaElement = element as HTMLTextAreaElement;
    textareaElement.focus();
    textareaElement.setSelectionRange(nextStart, nextEnd);
    textareaElement.dispatchEvent(new Event("select", { bubbles: true }));
  }, [start, end]);
}

async function readTextareaSelection(page: Page): Promise<{ start: number | null; end: number | null }> {
  return await page.getByTestId("canvas-text-edit-textarea").evaluate((element) => {
    const textareaElement = element as HTMLTextAreaElement;
    return {
      start: textareaElement.selectionStart,
      end: textareaElement.selectionEnd
    };
  });
}

async function readTextareaSelectedText(page: Page): Promise<string> {
  return await page.getByTestId("canvas-text-edit-textarea").evaluate((element) => {
    const textareaElement = element as HTMLTextAreaElement;
    const start = textareaElement.selectionStart ?? 0;
    const end = textareaElement.selectionEnd ?? start;
    return textareaElement.value.slice(start, end);
  });
}

async function dispatchTextRegionPointerDrag(
  page: Page,
  options: {
    targetId: string;
    clickCount: number;
    startRatioX: number;
    startRatioY: number;
    endRatioX: number;
    endRatioY: number;
  }
): Promise<void> {
  await page.evaluate((raw) => {
    const {
      targetId,
      clickCount,
      startRatioX,
      startRatioY,
      endRatioX,
      endRatioY
    } = raw as {
      targetId: string;
      clickCount: number;
      startRatioX: number;
      startRatioY: number;
      endRatioX: number;
      endRatioY: number;
    };
    const region = document.querySelector(
      `[data-hit-region-target-id="${targetId}"][data-hit-region-interaction-mode="text"]`
    ) as SVGGraphicsElement | null;
    if (!region) {
      throw new Error(`Text hit region not found for ${targetId}.`);
    }
    const rect = region.getBoundingClientRect();
    const startX = rect.left + rect.width * startRatioX;
    const startY = rect.top + rect.height * startRatioY;
    const endX = rect.left + rect.width * endRatioX;
    const endY = rect.top + rect.height * endRatioY;
    const pointerId = 77;

    region.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
        detail: clickCount,
        clientX: startX,
        clientY: startY
      })
    );

    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: "mouse",
        isPrimary: true,
        buttons: 1,
        clientX: endX,
        clientY: endY
      })
    );

    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 0,
        detail: clickCount,
        clientX: endX,
        clientY: endY
      })
    );
  }, options);
}

async function readMathJaxLocalClientPoint(
  page: Page,
  options: { sourceId: string; localRatioX: number; localRatioY: number }
): Promise<{ x: number; y: number }> {
  return await page.evaluate((raw) => {
    const { sourceId, localRatioX, localRatioY } = raw as {
      sourceId: string;
      localRatioX: number;
      localRatioY: number;
    };
    const rendered = document.querySelector(
      `svg[data-text-renderer="mathjax"][data-source-id="${sourceId}"]`
    ) as SVGSVGElement | null;
    if (!rendered) {
      throw new Error(`Rendered MathJax SVG not found for ${sourceId}.`);
    }
    const owner = rendered.ownerSVGElement;
    const ctm = owner?.getScreenCTM?.();
    if (!owner || !ctm) {
      throw new Error(`Owner SVG or screen CTM missing for ${sourceId}.`);
    }
    const x = Number(rendered.getAttribute("x"));
    const y = Number(rendered.getAttribute("y"));
    const width = Number(rendered.getAttribute("width"));
    const height = Number(rendered.getAttribute("height"));
    if (![x, y, width, height].every(Number.isFinite)) {
      throw new Error(`Rendered MathJax SVG geometry is invalid for ${sourceId}.`);
    }
    const point = owner.createSVGPoint();
    point.x = x + width * localRatioX;
    point.y = y + height * localRatioY;
    const clientPoint = point.matrixTransform(ctm);
    return { x: clientPoint.x, y: clientPoint.y };
  }, options);
}

test("single-line node text enters canvas edit mode and closes when CodeMirror takes focus", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Hello};
\end{tikzpicture}`);

  const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
  await expect(textRegion).toBeVisible();
  await textRegion.hover();
  await expect.poll(async () => textRegion.evaluate((element) => getComputedStyle(element).cursor)).toBe("text");

  await clickTextHitRegionByTargetId(page, "path:0");

  const popup = page.getByTestId("canvas-text-edit-popup");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(popup).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("Hello");
  await expect(page.getByTestId("canvas-text-selection-overlay")).toBeVisible();
  await expect.poll(async () => await readSelectedSourceIds(page)).toEqual(["path:0"]);

  await textarea.fill("Hello world");
  await expect.poll(async () => await readStoreSource(page)).toContain("{Hello world}");

  const sourceEditor = page.locator(".cm-editor").first();
  await sourceEditor.click();
  await expect(popup).toBeHidden();
  await expect(page.getByTestId("canvas-text-selection-overlay")).toHaveCount(0);
});

test("foreach-expanded node text editing uses the template source text", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \foreach \y in {1,2,3} {
    \node at (\y, 0) {\y};
  }
\end{tikzpicture}`);

  const textRegion = page.locator('[data-hit-region-interaction-mode="text"]').first();
  await expect(textRegion).toBeVisible();
  await textRegion.click();

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue(String.raw`\y`);

  await textarea.fill(String.raw`\y units`);
  await expect.poll(async () => await readStoreSource(page)).toContain(String.raw`{\y units}`);
});

test("foreach-expanded text caret and selection overlay stay on the clicked instance", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \foreach \y in {1,2,3} {
    \node at (\y, 0) {\y+x};
  }
\end{tikzpicture}`);

  const textRegions = page.locator('[data-hit-region-target-id="foreach:0"][data-hit-region-interaction-mode="text"]');
  await expect(textRegions).toHaveCount(3);

  const firstBox = await textRegions.nth(0).boundingBox();
  const thirdBox = await textRegions.nth(2).boundingBox();
  if (!firstBox || !thirdBox) {
    throw new Error("Expected foreach text region bounds.");
  }

  await textRegions.nth(2).click();
  await expect(page.getByTestId("canvas-text-edit-textarea")).toBeVisible();
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveValue(String.raw`\y+x`);

  const caret = page.getByTestId("canvas-text-selection-caret");
  await expect(caret).toBeVisible();
  const caretBox = await caret.boundingBox();
  if (!caretBox) {
    throw new Error("Expected caret bounds.");
  }
  const caretCenterX = caretBox.x + caretBox.width / 2;
  const firstCenterX = firstBox.x + firstBox.width / 2;
  const thirdCenterX = thirdBox.x + thirdBox.width / 2;

  expect(Math.abs(caretCenterX - thirdCenterX)).toBeLessThan(Math.abs(caretCenterX - firstCenterX));
});

test("rotated single-line node text enters canvas edit mode", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[draw, rotate=34] (C) at (0,0) {Here is an example text};
\end{tikzpicture}`);

  const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
  await expect(textRegion).toBeVisible();
  await clickTextHitRegionByTargetId(page, "path:0");

  const popup = page.getByTestId("canvas-text-edit-popup");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(popup).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("Here is an example text");
});

test("rotated single-line node does not enter edit mode at the untransformed text box position", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[draw, rotate=30] (C) at (0,0) {Let me think of something long and fun to write};
\end{tikzpicture}`);

  await waitForHitRegions(page);
  const popup = page.getByTestId("canvas-text-edit-popup");
  await expect(popup).toBeHidden();

  const point = await readMathJaxLocalClientPoint(page, {
    sourceId: "path:0",
    localRatioX: 0.08,
    localRatioY: 0.5
  });
  await page.mouse.click(point.x, point.y);

  await expect(popup).toBeHidden();

  await clickTextHitRegionByTargetId(page, "path:0");
  await expect(popup).toBeVisible();
});

test("rotated single-line text selection overlays follow text rotation", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[draw, rotate=-42] (B) at (1.5, -0.5) {Test string};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toHaveValue("Test string");
  await setTextareaSelection(page, 0, "Test string".length);

  const rects = page.getByTestId("canvas-text-selection-rect");
  await expect(rects).toHaveCount(1);
  const transform = await rects.first().evaluate((node) => getComputedStyle(node).transform);
  expect(transform).not.toBe("none");
});

test("single-line nodes without text width support spaces, backspace, and textarea-driven selection sync", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[draw] at (0,0) {Hello World};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toHaveValue("Hello World");
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(1);
  await expect(page.getByTestId("canvas-text-selection-rect")).toHaveCount(0);

  await setTextareaSelection(page, 0, 5);
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(0);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(0);

  await setTextareaSelection(page, "Hello World".length, "Hello World".length);
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(1);
  await expect(page.getByTestId("canvas-text-selection-rect")).toHaveCount(0);

  await textarea.press("Backspace");
  await expect(textarea).toHaveValue("Hello Worl");
  await expect.poll(async () => await readStoreSource(page)).toContain("{Hello Worl}");
});

test("arrow keys and cmd/ctrl+a stay scoped to the popup textarea while editing", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Hello World};
\node at (2,0) {Other};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toHaveValue("Hello World");
  await expect.poll(async () => await readSelectedSourceIds(page)).toEqual(["path:0"]);

  await setTextareaSelection(page, "Hello World".length, "Hello World".length);
  await textarea.press("ArrowLeft");
  await expect.poll(async () => await readTextareaSelection(page)).toEqual({
    start: "Hello World".length - 1,
    end: "Hello World".length - 1
  });
  await expect.poll(async () => await readStoreSource(page)).toContain("{Hello World}");

  await textarea.press(`${PRIMARY_MOD}+A`);
  await expect.poll(async () => await readTextareaSelection(page)).toEqual({
    start: 0,
    end: "Hello World".length
  });
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(0);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(0);
  await expect.poll(async () => await readSelectedSourceIds(page)).toEqual(["path:0"]);
});

test("window-level cmd/ctrl+a still selects text in the focused popup textarea", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Hello World};
\node at (2,0) {Other};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeFocused();
  await setTextareaSelection(page, 3, 3);

  const useMeta = process.platform === "darwin";
  await page.evaluate((payload) => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "a",
        code: "KeyA",
        bubbles: true,
        cancelable: true,
        metaKey: payload.useMeta,
        ctrlKey: !payload.useMeta
      })
    );
  }, { useMeta });

  await expect.poll(async () => await readTextareaSelection(page)).toEqual({
    start: 0,
    end: "Hello World".length
  });
  await expect.poll(async () => await readSelectedSourceIds(page)).toEqual(["path:0"]);
});

test("double click selects a single word in canvas edit mode", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Hello World Again};
\end{tikzpicture}`);

  await waitForHitRegions(page, 1);
  await dispatchTextRegionPointerDrag(page, {
    targetId: "path:0",
    clickCount: 2,
    startRatioX: 0.5,
    startRatioY: 0.5,
    endRatioX: 0.5,
    endRatioY: 0.5
  });
  await expect(page.getByTestId("canvas-text-edit-textarea")).toBeVisible();
  await expect(page.getByTestId("canvas-text-edit-textarea")).toBeFocused();
  await expect.poll(async () => await readTextareaSelectedText(page)).toMatch(/^\S+$/);
  await expect.poll(async () => await readTextareaSelectedText(page)).not.toBe("Hello World Again");
});

test("typing at the end of node text keeps the textarea caret after the inserted character", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Hello};
\end{tikzpicture}`);

  const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
  await expect(textRegion).toBeVisible();
  const box = await textRegion.boundingBox();
  if (!box) {
    throw new Error("Missing single-line text hit-region bounds.");
  }

  await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeFocused();
  await expect.poll(async () => await readTextareaSelection(page)).toEqual({
    start: "Hello".length,
    end: "Hello".length
  });

  await page.keyboard.type("!");
  await expect(textarea).toHaveValue("Hello!");
  await expect.poll(async () => await readTextareaSelection(page)).toEqual({
    start: "Hello!".length,
    end: "Hello!".length
  });
  await expect.poll(async () => await readStoreSource(page)).toContain("{Hello!}");
});

test("deleting all node text keeps the popup open so new text can be entered", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Hello};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeFocused();

  await textarea.press(`${PRIMARY_MOD}+A`);
  await textarea.press("Backspace");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("");
  await expect.poll(async () => await readStoreSource(page)).toContain("{}");

  await textarea.fill("New");
  await expect(textarea).toHaveValue("New");
  await expect.poll(async () => await readStoreSource(page)).toContain("{New}");
});

test("transient MathJax syntax errors keep canvas edit mode active", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Hello};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeFocused();

  await textarea.press(`${PRIMARY_MOD}+A`);
  await page.keyboard.type("$");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("$");

  await page.keyboard.type("x");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("$x");

  await page.keyboard.type("$");
  await expect(textarea).toHaveValue("$x$");
  await expect.poll(async () => await readStoreSource(page)).toContain("{$x$}");
});

test("fallback-rendered invalid MathJax text still enters canvas edit mode", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {$};
\end{tikzpicture}`);

  const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
  await expect(textRegion).toBeVisible();
  await expect.poll(async () => textRegion.evaluate((element) => getComputedStyle(element).cursor)).toBe("text");

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("$");

  await page.keyboard.type("x$");
  await expect(textarea).toHaveValue("$x$");
  await expect.poll(async () => await readStoreSource(page)).toContain("{$x$}");
});

test("wrapped text-width nodes enter canvas edit mode and update source through the popup textarea", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[text width=3cm,align=center] at (0,0) {Hello wrapped world};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toHaveValue("Hello wrapped world");

  await textarea.fill("Hello wrapped world with more text");
  await expect
    .poll(async () => await readStoreSource(page))
    .toContain("{Hello wrapped world with more text}");
});

test("wrapped text-width nodes stay wrapped in the popup when field-sizing is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const originalSupports = CSS.supports.bind(CSS);
    CSS.supports = ((...args: Parameters<typeof CSS.supports>) => {
      if (args[0] === "field-sizing" && args[1] === "content") {
        return false;
      }
      return originalSupports(...args);
    }) as typeof CSS.supports;
  });

  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[draw, align=left, text width=80pt] (C) at (0,0) {Let me think of something long and fun to write with much text and a lot of interesting information for readers of this text};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeVisible();
  const metrics = await textarea.evaluate((element) => {
    const textareaElement = element as HTMLTextAreaElement;
    const popup = textareaElement.closest('[data-testid="canvas-text-edit-popup"]') as HTMLElement | null;
    const computed = getComputedStyle(textareaElement);
    return {
      clientWidth: textareaElement.clientWidth,
      scrollWidth: textareaElement.scrollWidth,
      clientHeight: textareaElement.clientHeight,
      scrollHeight: textareaElement.scrollHeight,
      lineHeight: Number.parseFloat(computed.lineHeight),
      popupClientWidth: popup?.clientWidth ?? 0
    };
  });

  expect(metrics.popupClientWidth).toBeGreaterThan(metrics.clientWidth);
  expect(metrics.scrollWidth - metrics.clientWidth).toBeLessThanOrEqual(1);
  expect(metrics.scrollHeight - metrics.clientHeight).toBeLessThanOrEqual(1);
  expect(metrics.clientHeight).toBeGreaterThan(metrics.lineHeight * 2);
});

test("wrapped text selection sync produces multiple canvas highlight rects", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[text width=1.6cm,align=center] at (0,0) {Hello wrapped world with more text};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveValue("Hello wrapped world with more text");

  await setTextareaSelection(page, 0, "Hello wrapped world with more text".length);
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(0);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(1);
});

test("rotated wrapped text selection overlays follow text rotation", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[draw, align=left, text width=90pt, rotate=34] (C) at (0,0) {Let me think of something long to write to see the multi-line functionalities of this app};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  const fullText = "Let me think of something long to write to see the multi-line functionalities of this app";
  await expect(textarea).toHaveValue(fullText);
  await setTextareaSelection(page, 0, fullText.length);

  const rects = page.getByTestId("canvas-text-selection-rect");
  await expect.poll(async () => rects.count()).toBeGreaterThan(1);
  const firstTransform = await rects.first().evaluate((node) => getComputedStyle(node).transform);
  expect(firstTransform).not.toBe("none");

});

test("rotated wrapped text supports partial selection overlay screenshot", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[draw, align=left, text width=90pt, rotate=34] (C) at (0,0) {Let me think of something long to write to see the multi-line functionalities of this app};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  const fullText = "Let me think of something long to write to see the multi-line functionalities of this app";
  const selectedText = "long to write";
  const start = fullText.indexOf(selectedText);
  if (start < 0) {
    throw new Error("Failed to locate partial selection text.");
  }
  await expect(textarea).toHaveValue(fullText);
  await setTextareaSelection(page, start, start + selectedText.length);

  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(0);
});

test("rotated wrapped text click maps consistently to caret offsets", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[draw, align=left, text width=90pt, rotate=34] (C) at (0,0) {Let me think of something long to write to see the multi-line functionalities of this app};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  const fullText = "Let me think of something long to write to see the multi-line functionalities of this app";
  await expect(textarea).toHaveValue(fullText);
  await setTextareaSelection(page, 0, 0);

  const firstPoint = await readMathJaxLocalClientPoint(page, {
    sourceId: "path:0",
    localRatioX: 0.24,
    localRatioY: 0.30
  });
  await page.mouse.click(firstPoint.x, firstPoint.y);

  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(1);
  const firstCaretTransform = await page
    .getByTestId("canvas-text-selection-caret")
    .first()
    .evaluate((node) => getComputedStyle(node).transform);
  expect(firstCaretTransform).not.toBe("none");
  const firstSelection = await readTextareaSelection(page);
  expect(firstSelection.start).not.toBeNull();
  expect(firstSelection.end).toBe(firstSelection.start);

  const secondPoint = await readMathJaxLocalClientPoint(page, {
    sourceId: "path:0",
    localRatioX: 0.58,
    localRatioY: 0.66
  });
  await page.mouse.click(secondPoint.x, secondPoint.y);
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(1);
  const secondSelection = await readTextareaSelection(page);
  expect(secondSelection.start).not.toBeNull();
  expect(secondSelection.end).toBe(secondSelection.start);
  const firstOffset = firstSelection.start ?? 0;
  const secondOffset = secondSelection.start ?? 0;
  expect(secondOffset).toBeGreaterThan(firstOffset + 8);

});

test("explicit multiline node text with align and \\\\ edits from the canvas popup", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[align=center] at (0,0) {First\\Second};
\end{tikzpicture}`);

  await waitForHitRegions(page, 1);
  await clickTextHitRegionByTargetId(page, "path:0");

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toHaveValue(String.raw`First\\Second`);

  await textarea.fill(String.raw`First\\Third`);
  await expect
    .poll(async () => await readStoreSource(page))
    .toContain(String.raw`{First\\Third}`);
});

test("explicit multiline textarea selection stays synced to a multi-line canvas selection", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[align=center] at (0,0) {First\\Second};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveValue(String.raw`First\\Second`);

  await setTextareaSelection(page, 0, String.raw`First\\Second`.length);
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(0);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(1);
});

test("explicit multiline aligned text keeps authored line breaks and canvas selection overlays after paragraph renders", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[text width=2.4cm,align=center] at (0,0) {Wrapped paragraph warmup text};
\end{tikzpicture}`);
  await clickTextHitRegionByTargetId(page, "path:0");
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(1);

  const selectionText = String.raw`Let me think of something\\ long and fun to write`;
  for (const align of ["left", "center", "right"] as const) {
    await setSource(page, String.raw`\begin{tikzpicture}
  \node[draw, align=${align}] (C) at (0,0) {Let me think of something\\ long and fun to write};
\end{tikzpicture}`);

    await waitForHitRegions(page, 1);
    await clickTextHitRegionByTargetId(page, "path:0");

    const textarea = page.getByTestId("canvas-text-edit-textarea");
    await expect(textarea).toHaveValue(selectionText);
    await expect(page.locator("svg[data-text-renderer='mathjax'][data-source-id='path:0']")).toHaveAttribute(
      "data-paragraph-id",
      /.+/
    );
    await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(1);

    await setTextareaSelection(page, 7, 37);
    await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(0);
    await expect(page.getByTestId("canvas-text-selection-rect")).toHaveCount(2);

    const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
    const textBox = await textRegion.boundingBox();
    const firstRectBox = await page.getByTestId("canvas-text-selection-rect").first().boundingBox();
    const secondRectBox = await page.getByTestId("canvas-text-selection-rect").nth(1).boundingBox();
    if (!textBox || !firstRectBox || !secondRectBox) {
      throw new Error(`Expected visible text-region and selection overlay bounds for align=${align}.`);
    }
    expect(firstRectBox.x).toBeGreaterThanOrEqual(textBox.x - 1);
    expect(firstRectBox.y).toBeGreaterThanOrEqual(textBox.y - 1);
    expect(firstRectBox.x + firstRectBox.width).toBeLessThanOrEqual(textBox.x + textBox.width + 1);
    expect(firstRectBox.y + firstRectBox.height).toBeLessThanOrEqual(textBox.y + textBox.height + 1);
    expect(secondRectBox.x).toBeGreaterThanOrEqual(textBox.x - 1);
    expect(secondRectBox.y).toBeGreaterThanOrEqual(textBox.y - 1);
    expect(secondRectBox.x + secondRectBox.width).toBeLessThanOrEqual(textBox.x + textBox.width + 1);
    expect(secondRectBox.y + secondRectBox.height).toBeLessThanOrEqual(textBox.y + textBox.height + 1);
  }
});

test("filled nodes still enter text edit mode from the text region and remain draggable from the move region", async ({ page }) => {
  await gotoApp(page);
  const initialSource = String.raw`\begin{tikzpicture}
\node[draw,fill=yellow!20,inner sep=12pt,minimum width=3cm,minimum height=1.5cm] at (0,0) {Hello World};
\end{tikzpicture}`;
  await setSource(page, initialSource);

  await clickTextHitRegionByTargetId(page, "path:0");
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveValue("Hello World");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("canvas-text-edit-popup")).toHaveCount(0);

  const outerRegion = page.locator("[data-hit-region-target-id='path:0']").first();
  const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
  const outerBox = await outerRegion.boundingBox();
  const textBox = await textRegion.boundingBox();
  if (!outerBox || !textBox) {
    throw new Error("Missing filled-node hit-region bounds.");
  }
  const startX = outerBox.x + outerBox.width / 2;
  const startY = Math.min(textBox.y - 8, outerBox.y + 12);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 48, startY - 32, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => await readStoreSource(page)).not.toBe(initialSource);
  await expect.poll(async () => await readStoreSource(page)).toContain("{Hello World}");
});

test("path-attached node text can still be edited on click and dragged along its edge", async ({ page }) => {
  await gotoApp(page);
  const initialSource = String.raw`\begin{tikzpicture}
  \draw[->] (0,0) -- node[above] {ok} (3,0);
\end{tikzpicture}`;
  await setSource(page, initialSource);

  await waitForHitRegions(page, 2);
  const textRegions = page.locator('[data-hit-region-interaction-mode="text"]');
  await expect.poll(async () => textRegions.count()).toBeGreaterThanOrEqual(1);

  const labelTargetId = await textRegions.first().getAttribute("data-hit-region-target-id");
  if (!labelTargetId) {
    throw new Error("Missing path-attached node text hit-region target id.");
  }

  await clickTextHitRegionByTargetId(page, labelTargetId);
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveValue("ok");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("canvas-text-edit-popup")).toHaveCount(0);

  await dragHitRegionByTargetIdAndMode(page, labelTargetId, "text", -100, 0);

  await expect(page.getByTestId("canvas-text-edit-popup")).toHaveCount(0);
  await expect.poll(async () => await readSelectedSourceIds(page)).toEqual([labelTargetId]);
  await expect.poll(async () => await readStoreSource(page)).not.toBe(initialSource);
  await expect.poll(async () => await readStoreSource(page)).toMatch(/node\[[^\]]*(at start|very near start|near start|pos=)[^\]]*\]\s*\{ok\}/);
  await expect.poll(async () => await readStoreSource(page)).toMatch(/node\[[^\]]*(above|below|left|right)[^\]]*\]\s*\{ok\}/);
  await expect.poll(async () => await readStoreSource(page)).not.toContain("auto");
});

test("path-attached node drag rewrites source before mouseup", async ({ page }) => {
  await gotoApp(page);
  const initialSource = String.raw`\begin{tikzpicture}
  \draw[->] (0,0) -- node[above,fill=yellow!20] {ok} (3,0);
\end{tikzpicture}`;
  await setSource(page, initialSource);

  await waitForHitRegions(page, 2);
  const textRegions = page.locator('[data-hit-region-interaction-mode="text"]');
  await expect.poll(async () => textRegions.count()).toBeGreaterThanOrEqual(1);

  const labelTargetId = await textRegions.first().getAttribute("data-hit-region-target-id");
  if (!labelTargetId) {
    throw new Error("Missing path-attached node text hit-region target id.");
  }

  const textRegion = page.locator(
    `[data-hit-region-target-id='${labelTargetId}'][data-hit-region-interaction-mode='text']`
  ).first();
  const initialBox = await textRegion.boundingBox();
  if (!initialBox) {
    throw new Error("Missing path-attached node drag bounds.");
  }

  const startX = initialBox.x + initialBox.width / 2;
  const startY = initialBox.y + initialBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 100, startY, { steps: 12 });

  await expect.poll(async () => await readStoreSource(page)).not.toBe(initialSource);
  await expect(page.locator("text=/fallback \\(parser statement-parse-error\\)/")).toHaveCount(0);

  await page.mouse.up();
  await expect.poll(async () => await readSelectedSourceIds(page)).toEqual([labelTargetId]);
});

test("clicking rendered wrapped text updates the textarea selection", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[text width=3cm,align=center] at (0,0) {Hello wrapped world};
\end{tikzpicture}`);

  const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
  const box = await textRegion.boundingBox();
  if (!box) {
    throw new Error("Missing wrapped text hit-region bounds.");
  }

  await page.mouse.click(box.x + 8, box.y + box.height / 2);
  const initialSelection = await readTextareaSelection(page);
  await expect(page.getByTestId("canvas-text-edit-textarea")).toBeVisible();

  await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
  await expect.poll(async () => await readTextareaSelection(page)).not.toEqual(initialSelection);
});

test("dragging across rendered MathJax node text creates a canvas selection in Chrome", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {$x^2 + y^2 = z^2$};
\end{tikzpicture}`);

  const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
  await expect(textRegion).toBeVisible();
  const box = await textRegion.boundingBox();
  if (!box) {
    throw new Error("Missing MathJax text hit-region bounds.");
  }

  const startX = box.x + 10;
  const startY = box.y + box.height / 2;
  const endX = box.x + box.width - 10;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, startY, { steps: 12 });
  await page.mouse.up();

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect.poll(async () => {
    const selection = await readTextareaSelection(page);
    return selection.start != null && selection.end != null && selection.end > selection.start;
  }).toBe(true);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(0);
});

test("cmd/ctrl+x stays scoped to the textarea while editing node text", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Hello World};
\node at (2,0) {Other};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeFocused();
  await setTextareaSelection(page, 0, 5);

  await textarea.press(`${PRIMARY_MOD}+X`);

  await expect(textarea).toHaveValue(" World");
  await expect.poll(async () => await readStoreSource(page)).toContain("{ World}");
  await expect.poll(async () => await readStoreSource(page)).toContain("{Other}");
  await expect.poll(async () => await readSelectedSourceIds(page)).toEqual(["path:0"]);
});

test("synthetic cut/paste events on the textarea do not trigger canvas clipboard handlers", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Hello World};
\node at (2,0) {Other};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeFocused();

  const sourceBefore = await readStoreSource(page);
  await textarea.evaluate((element) => {
    const textareaElement = element as HTMLTextAreaElement;
    textareaElement.focus();
    textareaElement.setSelectionRange(0, 5);
    const cutEvent = new ClipboardEvent("cut", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer()
    });
    textareaElement.dispatchEvent(cutEvent);

    const payload = {
      version: 1,
      snippets: ["\\draw (0,0) -- (1,1);"],
      plainText: "\\draw (0,0) -- (1,1);",
      pasteBehavior: "offset",
      pasteCount: 0
    };
    const transfer = new DataTransfer();
    transfer.setData("web application/x-tikz-editor+json", JSON.stringify(payload));
    transfer.setData("text/plain", payload.plainText);
    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer
    });
    textareaElement.dispatchEvent(pasteEvent);
  });

  await expect.poll(async () => await readStoreSource(page)).toBe(sourceBefore);
  await expect.poll(async () => await readSelectedSourceIds(page)).toEqual(["path:0"]);
});

test("double-click drag selects whole words in canvas text edit mode", async ({ page }) => {
  await gotoApp(page);
  const text = "Alpha Beta Gamma Delta";
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Alpha Beta Gamma Delta};
\end{tikzpicture}`);

  await waitForHitRegions(page, 1);
  await dispatchTextRegionPointerDrag(page, {
    targetId: "path:0",
    clickCount: 2,
    startRatioX: 0.32,
    startRatioY: 0.5,
    endRatioX: 0.95,
    endRatioY: 0.5
  });

  const selection = await readTextareaSelection(page);
  if (selection.start == null || selection.end == null) {
    throw new Error("Expected textarea selection range.");
  }
  expect(selection.end).toBeGreaterThan(selection.start);
  expect(selection.start).toBeGreaterThan(0);
  expect(selection.start <= 0 || text[selection.start - 1] === " ").toBe(true);
  expect(selection.end >= text.length || text[selection.end] === " ").toBe(true);
  const selectedText = await readTextareaSelectedText(page);
  expect(selectedText.startsWith(" ")).toBe(false);
  expect(selectedText.endsWith(" ")).toBe(false);
});

test("triple click selects one line in multiline canvas text", async ({ page }) => {
  await gotoApp(page);
  const text = String.raw`First\\Second\\Third`;
  await setSource(page, String.raw`\begin{tikzpicture}
\node[align=center] at (0,0) {First\\Second\\Third};
\end{tikzpicture}`);

  await waitForHitRegions(page, 1);
  await dispatchTextRegionPointerDrag(page, {
    targetId: "path:0",
    clickCount: 3,
    startRatioX: 0.5,
    startRatioY: 0.15,
    endRatioX: 0.5,
    endRatioY: 0.15
  });

  const selection = await readTextareaSelection(page);
  if (selection.start == null || selection.end == null) {
    throw new Error("Expected textarea selection range.");
  }
  expect(selection.end).toBeGreaterThan(selection.start);
  expect(selection.end - selection.start).toBeLessThan(text.length);
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(0);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(0);
});

test("triple-click drag extends selection by lines in multiline canvas text", async ({ page }) => {
  await gotoApp(page);
  const text = String.raw`First\\Second\\Third`;
  await setSource(page, String.raw`\begin{tikzpicture}
\node[align=center] at (0,0) {First\\Second\\Third};
\end{tikzpicture}`);

  await waitForHitRegions(page, 1);
  await dispatchTextRegionPointerDrag(page, {
    targetId: "path:0",
    clickCount: 3,
    startRatioX: 0.5,
    startRatioY: 0.15,
    endRatioX: 0.5,
    endRatioY: 0.15
  });
  const singleLineSelection = await readTextareaSelection(page);
  if (singleLineSelection.start == null || singleLineSelection.end == null) {
    throw new Error("Expected initial textarea selection.");
  }
  const singleLineLength = singleLineSelection.end - singleLineSelection.start;

  await dispatchTextRegionPointerDrag(page, {
    targetId: "path:0",
    clickCount: 3,
    startRatioX: 0.5,
    startRatioY: 0.15,
    endRatioX: 0.5,
    endRatioY: 0.85
  });

  const dragSelection = await readTextareaSelection(page);
  if (dragSelection.start == null || dragSelection.end == null) {
    throw new Error("Expected drag textarea selection.");
  }
  const dragLength = dragSelection.end - dragSelection.start;
  expect(dragLength).toBeGreaterThan(singleLineLength);
  expect(dragLength).toBeLessThanOrEqual(text.length);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(1);
});
