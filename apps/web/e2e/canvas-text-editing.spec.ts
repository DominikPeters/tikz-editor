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

async function readCanvasCaretCenter(page: Page): Promise<{ x: number; y: number }> {
  const caret = page.getByTestId("canvas-text-selection-caret");
  await expect(caret).toBeVisible();
  const box = await caret.boundingBox();
  if (!box) {
    throw new Error("Expected caret bounds.");
  }
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

async function dispatchTextareaBeforeInput(
  page: Page,
  inputType: string,
  options?: {
    data?: string | null;
    selectionStart?: number;
    selectionEnd?: number;
  }
): Promise<void> {
  const { data = null, selectionStart, selectionEnd } = options ?? {};
  await page.getByTestId("canvas-text-edit-textarea").evaluate((element, payload) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.focus();
    if (typeof payload.selectionStart === "number" && typeof payload.selectionEnd === "number") {
      textarea.setSelectionRange(payload.selectionStart, payload.selectionEnd);
    }
    const event = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: payload.inputType,
      data: payload.data
    });
    textarea.dispatchEvent(event);
  }, { inputType, data, selectionStart, selectionEnd });
}

async function dispatchTextareaDrop(page: Page, text: string, selectionStart: number, selectionEnd: number): Promise<void> {
  await page.getByTestId("canvas-text-edit-textarea").evaluate((element, payload) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(payload.selectionStart, payload.selectionEnd);
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", payload.text);
    const event = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer
    });
    textarea.dispatchEvent(event);
  }, { text, selectionStart, selectionEnd });
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
    } = raw;
    const region = document.querySelector(
      `[data-hit-region-target-id="${targetId}"][data-hit-region-interaction-mode="text"]`
    );
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
    const { sourceId, localRatioX, localRatioY } = raw;
    const rendered = document.querySelector(
      `svg[data-text-renderer="mathjax"][data-source-id="${sourceId}"]`
    );
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

async function readMathJaxSourceClientPoint(
  page: Page,
  options: { sourceId: string; sourceOffset: number; sourceText?: string }
): Promise<{ x: number; y: number }> {
  return await page.evaluate((raw) => {
    const { sourceId, sourceOffset, sourceText } = raw;
    const clamp = (value: number, min: number, max: number): number => {
      if (!Number.isFinite(value)) {
        return min;
      }
      return Math.min(max, Math.max(min, value));
    };
    const equivalentChars = (source: string, render: string): boolean => {
      return source === render || (/\s/.test(source) && /\s/.test(render));
    };
    const sourceToRenderOffset = (sourceText: string, renderText: string, offset: number): number => {
      const sourceLength = sourceText.length;
      const renderLength = renderText.length;
      const width = renderLength + 1;
      const distance = Array.from<number>({ length: (sourceLength + 1) * (renderLength + 1) }).fill(0);
      for (let sourceIndex = 0; sourceIndex <= sourceLength; sourceIndex += 1) {
        distance[sourceIndex * width] = sourceIndex;
      }
      for (let renderIndex = 0; renderIndex <= renderLength; renderIndex += 1) {
        distance[renderIndex] = renderIndex;
      }
      for (let sourceIndex = 1; sourceIndex <= sourceLength; sourceIndex += 1) {
        for (let renderIndex = 1; renderIndex <= renderLength; renderIndex += 1) {
          const sourceChar = sourceText[sourceIndex - 1] ?? "";
          const renderChar = renderText[renderIndex - 1] ?? "";
          const substitutionCost = equivalentChars(sourceChar, renderChar) ? 0 : 1;
          const substitution = distance[(sourceIndex - 1) * width + (renderIndex - 1)] + substitutionCost;
          const deletion = distance[(sourceIndex - 1) * width + renderIndex] + 1;
          const insertion = distance[sourceIndex * width + (renderIndex - 1)] + 1;
          distance[sourceIndex * width + renderIndex] = Math.min(substitution, deletion, insertion);
        }
      }

      const operations: Array<"match" | "delete" | "insert"> = [];
      let sourceCursor = sourceLength;
      let renderCursor = renderLength;
      while (sourceCursor > 0 || renderCursor > 0) {
        const current = distance[sourceCursor * width + renderCursor];
        if (sourceCursor > 0 && renderCursor > 0) {
          const sourceChar = sourceText[sourceCursor - 1] ?? "";
          const renderChar = renderText[renderCursor - 1] ?? "";
          const substitutionCost = equivalentChars(sourceChar, renderChar) ? 0 : 1;
          const diagonal = distance[(sourceCursor - 1) * width + (renderCursor - 1)] + substitutionCost;
          if (substitutionCost === 0 && diagonal === current) {
            operations.push("match");
            sourceCursor -= 1;
            renderCursor -= 1;
            continue;
          }
        }
        if (sourceCursor > 0) {
          const deletion = distance[(sourceCursor - 1) * width + renderCursor] + 1;
          if (deletion === current) {
            operations.push("delete");
            sourceCursor -= 1;
            continue;
          }
        }
        if (renderCursor > 0) {
          const insertion = distance[sourceCursor * width + (renderCursor - 1)] + 1;
          if (insertion === current) {
            operations.push("insert");
            renderCursor -= 1;
            continue;
          }
        }
        if (sourceCursor > 0 && renderCursor > 0) {
          operations.push("match");
          sourceCursor -= 1;
          renderCursor -= 1;
          continue;
        }
        if (sourceCursor > 0) {
          operations.push("delete");
          sourceCursor -= 1;
          continue;
        }
        operations.push("insert");
        renderCursor -= 1;
      }
      operations.reverse();

      const sourceToRenderMap = Array.from<number>({ length: sourceLength + 1 }).fill(0);
      let sourceIndex = 0;
      let renderIndex = 0;
      for (const operation of operations) {
        if (operation === "match") {
          sourceIndex += 1;
          renderIndex += 1;
          sourceToRenderMap[sourceIndex] = renderIndex;
          continue;
        }
        if (operation === "delete") {
          sourceIndex += 1;
          sourceToRenderMap[sourceIndex] = renderIndex;
          continue;
        }
        renderIndex += 1;
      }
      return sourceToRenderMap[clamp(Math.floor(offset), 0, sourceLength)] ?? 0;
    };
    const api = (globalThis as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        getSceneTextDebug?: () => Array<{
          sourceId: string;
          text: string;
          renderSourceText: string | null;
        }>;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    const debugText = api?.getSceneTextDebug?.().find((entry) => entry.sourceId === sourceId);
    const editableText = sourceText ?? debugText?.text ?? "";
    const renderOffset = debugText?.renderSourceText && editableText
      ? sourceToRenderOffset(editableText, debugText.renderSourceText, sourceOffset)
      : sourceOffset;
    const rendered = document.querySelector(
      `svg[data-text-renderer="mathjax"][data-source-id="${sourceId}"]`
    );
    if (!rendered) {
      throw new Error(`Rendered MathJax SVG not found for ${sourceId}.`);
    }
    const sourceBackedElements = Array.from(
      rendered.querySelectorAll<SVGGraphicsElement>("[data-source-start][data-source-end]")
    );
    const sourceRanges = sourceBackedElements.map((element) => {
      const start = Number(element.getAttribute("data-source-start"));
      const end = Number(element.getAttribute("data-source-end"));
      return { element, start, end };
    }).filter((entry) => Number.isFinite(entry.start) && Number.isFinite(entry.end));
    const minSourceStart = sourceRanges.length > 0
      ? Math.min(...sourceRanges.map((entry) => entry.start))
      : null;
    const offsets = [renderOffset];
    if (minSourceStart != null && minSourceStart !== 0) {
      offsets.push(minSourceStart + renderOffset);
    }
    const candidates = sourceRanges.filter(({ start, end }) => {
      return Number.isFinite(start) &&
        Number.isFinite(end) &&
        offsets.some((offset) => start <= offset && offset < Math.max(start + 1, end));
    });
    const glyphEntry = candidates
      .filter(({ element }) => element.hasAttribute("data-tex-glyph"))
      .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0] ?? candidates[0];
    const glyph = glyphEntry?.element;
    if (!glyph) {
      const sample = sourceRanges.slice(0, 24).map(({ start, end, element }) => {
        const glyphCode = element.getAttribute("data-tex-glyph");
        return glyphCode == null ? `${start}:${end}` : `${start}:${end}#${glyphCode}`;
      }).join(", ");
      throw new Error(
        `Rendered MathJax source glyph not found for ${sourceId} offset ${sourceOffset} (render offset ${renderOffset}). ` +
          `Tried offsets ${offsets.join(", ")}; available ranges: ${sample || "none"}.`
      );
    }
    const rect = glyph.getBoundingClientRect();
    if (
      !Number.isFinite(rect.left) ||
      !Number.isFinite(rect.right) ||
      !Number.isFinite(rect.top) ||
      !Number.isFinite(rect.bottom) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      throw new Error(`Rendered MathJax source glyph geometry is invalid for ${sourceId} offset ${sourceOffset}.`);
    }
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
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

  await textarea.press(`${PRIMARY_MOD}+A`);
  await page.keyboard.type("Hello world");
  await expect.poll(async () => await readStoreSource(page)).toContain("{Hello world}");

  const sourceEditor = page.locator(".cm-editor").first();
  await sourceEditor.click();
  await expect(popup).toBeHidden();
  await expect(page.getByTestId("canvas-text-selection-overlay")).toHaveCount(0);
});

test("block node text popup stays below the node bounds", async ({ page }) => {
  await gotoApp(page);
  await setSource(
    page,
    String.raw`\begin{tikzpicture}[
  block/.style={draw, minimum width=2cm, minimum height=1cm, align=center, sharp corners}
]
\node[block] (edm) at (0,0) {EDM};
\end{tikzpicture}`
  );

  await clickTextHitRegionByTargetId(page, "path:0");

  const popup = page.getByTestId("canvas-text-edit-popup");
  const nodeBounds = page.locator("[data-testid='canvas-svg-layer'] [data-source-id='path:0']").first();
  await expect(popup).toBeVisible();
  await expect(nodeBounds).toBeVisible();

  const [popupBox, nodeBox] = await Promise.all([popup.boundingBox(), nodeBounds.boundingBox()]);
  if (!popupBox || !nodeBox) {
    throw new Error("Missing popup or node bounds.");
  }

  expect(popupBox.y).toBeGreaterThan(nodeBox.y + nodeBox.height - 1);
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
  await expect(page.getByTestId("canvas-text-edit-foreach-tag")).toHaveText("foreach");

  await textarea.press(`${PRIMARY_MOD}+A`);
  await page.keyboard.type(String.raw`\y units`);
  await expect.poll(async () => await readStoreSource(page)).toContain(String.raw`{\y units}`);
});

test("foreach-expanded text editing selects the template and hides canvas caret mapping", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \foreach \y in {1,2,3} {
    \node at (\y, 0) {\y+x};
  }
\end{tikzpicture}`);

  const textRegions = page.locator('[data-hit-region-target-id="foreach:0"][data-hit-region-interaction-mode="text"]');
  await expect(textRegions).toHaveCount(3);

  await textRegions.nth(2).click();
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toHaveValue(String.raw`\y+x`);
  await expect(page.getByTestId("canvas-text-edit-foreach-tag")).toHaveText("foreach");
  await expect(page.getByTestId("canvas-text-selection-overlay")).toHaveCount(0);
  await expect(readTextareaSelection(page)).resolves.toEqual({ start: 0, end: 4 });
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

  await page.keyboard.type("New");
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

test("node text edit recovers to original source after } then Backspace around invalid state", async ({ page }) => {
  await gotoApp(page);
  const originalSource = String.raw`\begin{tikzpicture}
  \node at (0,0) {$x$};
\end{tikzpicture}`;
  await setSource(page, originalSource);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("$x$");

  let clickedBetweenXAndDollar = false;
  for (const localRatioX of [0.55, 0.65, 0.75, 0.85]) {
    const point = await readMathJaxLocalClientPoint(page, {
      sourceId: "path:0",
      localRatioX,
      localRatioY: 0.5
    });
    await page.mouse.click(point.x, point.y);
    const selection = await readTextareaSelection(page);
    if (selection.start === 2 && selection.end === 2) {
      clickedBetweenXAndDollar = true;
      break;
    }
  }
  expect(clickedBetweenXAndDollar).toBe(true);

  await textarea.press("}");
  await expect(textarea).toHaveValue("$x}$");
  await expect
    .poll(async () => await readTextareaSelection(page))
    .toEqual({ start: 3, end: 3 });
  await expect
    .poll(async () => await readStoreSource(page))
    .toEqual(String.raw`\begin{tikzpicture}
  \node at (0,0) {$x}$};
\end{tikzpicture}`);

  await page.waitForTimeout(120);
  await expect
    .poll(async () => await readTextareaSelection(page))
    .toEqual({ start: 3, end: 3 });
  await textarea.press("Backspace");
  await expect
    .poll(async () => await readStoreSource(page))
    .toEqual(originalSource);
});

test("fallback-rendered invalid MathJax text still enters canvas edit mode", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {$};
\end{tikzpicture}`);

  const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
  await expect(textRegion).toBeVisible();
  await expect.poll(async () => textRegion.evaluate((element) => getComputedStyle(element).cursor)).toBe("text");

  const box = await textRegion.boundingBox();
  if (!box) {
    throw new Error("Missing fallback text hit-region bounds.");
  }

  await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("$");
  await expect.poll(async () => await readTextareaSelection(page)).toEqual({ start: 1, end: 1 });

  await page.keyboard.type("x$");
  await expect(textarea).toHaveValue("$x$");
  await expect.poll(async () => await readStoreSource(page)).toContain("{$x$}");
});

test("explicit multiline math nodes collapse first-line caret positions by rendered prefix width", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[align=center] at (0,0) {$x$ \\ variable};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toHaveValue(String.raw`$x$ \\ variable`);

  const centers: Array<{ x: number; y: number }> = [];
  for (const offset of [0, 1, 2, 3, 7]) {
    await setTextareaSelection(page, offset, offset);
    centers.push(await readCanvasCaretCenter(page));
  }

  expect(centers[0]?.x).toBeCloseTo(centers[1]?.x ?? 0, 3);
  expect(centers[2]?.x).toBeCloseTo(centers[3]?.x ?? 0, 3);
  expect((centers[2]?.x ?? 0)).toBeGreaterThan(centers[1]?.x ?? 0);
  expect((centers[4]?.y ?? 0)).toBeGreaterThan((centers[0]?.y ?? 0) + 10);
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

  await textarea.press(`${PRIMARY_MOD}+A`);
  await page.keyboard.type("Hello wrapped world with more text");
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
    });
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
    const popup = textareaElement.closest('[data-testid="canvas-text-edit-popup"]');
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

test("wrapped TeX-derived display math supports canvas caret and selection mapping", async ({ page }) => {
  const geometryErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }
    const text = message.text();
    if (text.includes("paragraph geometry") || text.includes("caret")) {
      geometryErrors.push(text);
    }
  });

  const text = String.raw`Intro \[x^2=y\] Outro`;
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[text width=120pt,align=left] at (0,0) {Intro \[x^2=y\] Outro};
\end{tikzpicture}`);

  await waitForHitRegions(page, 1);
  await expect(page.locator("svg[data-text-renderer='mathjax'][data-source-id='path:0']")).toHaveAttribute(
    "data-paragraph-id",
    /.+/
  );

  const displayStart = text.indexOf(String.raw`\[`);
  const displayEnd = text.indexOf(String.raw`\]`) + String.raw`\]`.length;
  const yOffset = text.indexOf("y");
  const clickPoint = await readMathJaxSourceClientPoint(page, {
    sourceId: "path:0",
    sourceOffset: yOffset,
    sourceText: text
  });
  await page.mouse.click(clickPoint.x, clickPoint.y);

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue(text);
  await expect.poll(async () => {
    const selection = await readTextareaSelection(page);
    return selection.start != null &&
      selection.end === selection.start &&
      selection.start >= displayStart &&
      selection.start <= displayEnd;
  }).toBe(true);
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(1);

  await setTextareaSelection(page, displayStart, displayEnd);
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(0);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(0);
  await expect(geometryErrors).toEqual([]);
});

test("wrapped TeX-derived mixed math and styled text keeps canvas caret mapping", async ({ page }) => {
  const geometryErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }
    const text = message.text();
    if (text.includes("paragraph geometry") || text.includes("caret")) {
      geometryErrors.push(text);
    }
  });

  const text = String.raw`Alpha \textsf{sans} plus $a^2=b$. \\[4pt] Beta \[\frac{1}{2}=\sqrt{z}\] Gamma`;
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[text width=150pt,align=left] at (0,0) {Alpha \textsf{sans} plus $a^2=b$. \\[4pt] Beta \[\frac{1}{2}=\sqrt{z}\] Gamma};
\end{tikzpicture}`);

  await waitForHitRegions(page, 1);
  await expect(page.locator("svg[data-text-renderer='mathjax'][data-source-id='path:0']")).toHaveAttribute(
    "data-paragraph-id",
    /.+/
  );

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  const clickOffsets = [
    text.indexOf("n"),
    text.indexOf("b"),
    text.indexOf("z"),
  ];
  for (const offset of clickOffsets) {
    const point = await readMathJaxSourceClientPoint(page, {
      sourceId: "path:0",
      sourceOffset: offset,
      sourceText: text
    });
    await page.mouse.click(point.x, point.y);
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeFocused();
    await expect(textarea).toHaveValue(text);
    await expect.poll(async () => {
      const selection = await readTextareaSelection(page);
      return selection.start != null &&
        selection.end === selection.start &&
        Math.abs(selection.start - offset) <= 1;
    }).toBe(true);
    await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(1);
  }

  const selectionStart = text.indexOf(String.raw`\textsf`);
  const selectionEnd = text.indexOf(String.raw`\]`) + String.raw`\]`.length;
  await setTextareaSelection(page, selectionStart, selectionEnd);
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(0);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(1);
  await expect(geometryErrors).toEqual([]);
});

test("wrapped TeX-derived align display rows and tags keep canvas caret mapping", async ({ page }) => {
  const geometryErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }
    const text = message.text();
    if (text.includes("paragraph geometry") || text.includes("caret")) {
      geometryErrors.push(text);
    }
  });

  const text = String.raw`Intro \begin{align*}x&=y \tag{A}\\a&=b\end{align*} Outro`;
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[text width=180pt,align=left] at (0,0) {Intro \begin{align*}x&=y \tag{A}\\a&=b\end{align*} Outro};
\end{tikzpicture}`);

  await waitForHitRegions(page, 1);
  await expect(page.locator("svg[data-text-renderer='mathjax'][data-source-id='path:0']")).toHaveAttribute(
    "data-paragraph-id",
    /.+/
  );

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  for (const offset of [text.indexOf("y"), text.lastIndexOf("b")]) {
    const point = await readMathJaxSourceClientPoint(page, {
      sourceId: "path:0",
      sourceOffset: offset,
      sourceText: text
    });
    await page.mouse.click(point.x, point.y);
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeFocused();
    await expect(textarea).toHaveValue(text);
    await expect.poll(async () => {
      const selection = await readTextareaSelection(page);
      return selection.start != null &&
        selection.end === selection.start &&
        Math.abs(selection.start - offset) <= 1;
    }).toBe(true);
  }

  const tagStart = text.indexOf(String.raw`\tag`);
  const tagEnd = text.indexOf("}", tagStart) + 1;
  const tagPoint = await readMathJaxSourceClientPoint(page, {
    sourceId: "path:0",
    sourceOffset: text.indexOf("A", tagStart),
    sourceText: text
  });
  await page.mouse.click(tagPoint.x, tagPoint.y);
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect.poll(async () => {
    const selection = await readTextareaSelection(page);
    return selection.start != null &&
      selection.end === selection.start &&
      selection.start >= tagStart &&
      selection.start <= tagEnd;
  }).toBe(true);

  const alignStart = text.indexOf(String.raw`\begin{align*}`);
  const alignEnd = text.indexOf(String.raw`\end{align*}`) + String.raw`\end{align*}`.length;
  await setTextareaSelection(page, alignStart, alignEnd);
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(0);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(1);
  await expect(geometryErrors).toEqual([]);
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

  await textarea.press(`${PRIMARY_MOD}+A`);
  await page.keyboard.type(String.raw`First\\Third`);
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

test("plain fallback multiline caret uses literal backslash text positions", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \node at (0.2,3.2) [align=left]{I'm testing the Mathjax \\ rendering \te};
\end{tikzpicture}`);

  await waitForHitRegions(page, 1);
  await clickTextHitRegionByTargetId(page, "path:0");

  const text = String.raw`I'm testing the Mathjax \\ rendering \te`;
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toHaveValue(text);
  await expect(page.locator("svg[data-text-renderer='mathjax'][data-source-id='path:0']")).toHaveCount(0);

  const firstLineOffset = text.indexOf("the") + 2;
  await setTextareaSelection(page, firstLineOffset, firstLineOffset);
  const firstLineCaret = await page.getByTestId("canvas-text-selection-caret").boundingBox();
  const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
  const textRegionBox = await textRegion.boundingBox();
  if (!firstLineCaret || !textRegionBox) {
    throw new Error("Expected fallback text caret and region bounds.");
  }
  expect(firstLineCaret.y + firstLineCaret.height / 2).toBeLessThan(textRegionBox.y + textRegionBox.height / 2);

  const firstLineSelectionStart = text.indexOf("testing");
  const firstLineSelectionEnd = text.indexOf("Mathjax") + "Mathjax".length;
  await setTextareaSelection(page, firstLineSelectionStart, firstLineSelectionEnd);
  const firstLineSelectionRect = await page.getByTestId("canvas-text-selection-rect").first().boundingBox();
  if (!firstLineSelectionRect) {
    throw new Error("Expected fallback first-line selection rect bounds.");
  }
  expect(firstLineSelectionRect.y + firstLineSelectionRect.height / 2).toBeLessThan(
    textRegionBox.y + textRegionBox.height / 2
  );

  const slashOffset = text.indexOf(String.raw`\te`);
  await setTextareaSelection(page, slashOffset, slashOffset);
  const beforeSlash = await readCanvasCaretCenter(page);
  await setTextareaSelection(page, slashOffset + 1, slashOffset + 1);
  const afterSlash = await readCanvasCaretCenter(page);
  await setTextareaSelection(page, slashOffset + 2, slashOffset + 2);
  const afterT = await readCanvasCaretCenter(page);

  expect(afterSlash.x).toBeGreaterThan(beforeSlash.x + 1);
  expect(afterT.x).toBeGreaterThan(afterSlash.x + 1);
  expect(Math.abs(afterT.y - beforeSlash.y)).toBeLessThan(3);
});

test("wrapped multiline MathJax nodes edit without paragraph-geometry fallback errors", async ({ page }) => {
  const geometryErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }
    const text = message.text();
    if (text.includes("Missing paragraph geometry for multiline MathJax")) {
      geometryErrors.push(text);
    }
  });

  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[draw,text width=3cm,align=right] at (0,0) {alpha beta gamma delta epsilon};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toHaveValue("alpha beta gamma delta epsilon");

  await setTextareaSelection(page, 0, 5);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(0);
  await expect(geometryErrors).toEqual([]);
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

test("clicking rendered wrapped align=right multiline text updates the textarea selection", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[text width=2.6cm,align=right] at (0,0) {alpha beta gamma delta epsilon};
\end{tikzpicture}`);

  const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
  const box = await textRegion.boundingBox();
  if (!box) {
    throw new Error("Missing wrapped align=right text hit-region bounds.");
  }

  await page.mouse.click(box.x + 8, box.y + box.height * 0.3);
  const initialSelection = await readTextareaSelection(page);
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveValue("alpha beta gamma delta epsilon");

  await page.mouse.click(box.x + box.width - 8, box.y + box.height * 0.75);
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

test("dragging across wrapped align=right multiline text creates a multiline canvas selection", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[text width=2.6cm,align=right] at (0,0) {alpha beta gamma delta epsilon};
\end{tikzpicture}`);

  await waitForHitRegions(page, 1);
  await dispatchTextRegionPointerDrag(page, {
    targetId: "path:0",
    clickCount: 1,
    startRatioX: 0.9,
    startRatioY: 0.2,
    endRatioX: 0.1,
    endRatioY: 0.85
  });

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect.poll(async () => {
    const selection = await readTextareaSelection(page);
    return selection.start != null && selection.end != null && selection.end > selection.start;
  }).toBe(true);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(1);
});

test("textarea selection projects to multiple canvas rects for wrapped align=right multiline text", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[text width=2.6cm,align=right] at (0,0) {alpha beta gamma delta epsilon};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveValue("alpha beta gamma delta epsilon");

  await setTextareaSelection(page, 0, "alpha beta gamma delta epsilon".length);
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(0);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(1);
});

test("clicking rendered wrapped-explicit align=right text updates the textarea selection", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[text width=3cm,align=right] at (0,0) {Alpha \\[10pt] Beta \\ The longest line here};
\end{tikzpicture}`);

  const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
  const box = await textRegion.boundingBox();
  if (!box) {
    throw new Error("Missing wrapped-explicit align=right text hit-region bounds.");
  }

  await page.mouse.click(box.x + box.width - 8, box.y + box.height * 0.2);
  const initialSelection = await readTextareaSelection(page);
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveValue("Alpha \\\\[10pt] Beta \\\\ The longest line here");

  await page.mouse.click(box.x + 8, box.y + box.height * 0.85);
  await expect.poll(async () => await readTextareaSelection(page)).not.toEqual(initialSelection);
});

test("dragging across wrapped-explicit align=right text creates a multiline canvas selection", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[text width=3cm,align=right] at (0,0) {Alpha \\[10pt] Beta \\ The longest line here};
\end{tikzpicture}`);

  await waitForHitRegions(page, 1);
  await dispatchTextRegionPointerDrag(page, {
    targetId: "path:0",
    clickCount: 1,
    startRatioX: 0.95,
    startRatioY: 0.1,
    endRatioX: 0.1,
    endRatioY: 0.9
  });

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect.poll(async () => {
    const selection = await readTextareaSelection(page);
    return selection.start != null && selection.end != null && selection.end > selection.start;
  }).toBe(true);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(1);
});

test("wrapped-explicit align=right selections cross the \\[10pt] boundary without paragraph-geometry errors", async ({ page }) => {
  const geometryErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }
    const text = message.text();
    if (text.includes("paragraph geometry")) {
      geometryErrors.push(text);
    }
  });

  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[text width=3cm,align=right] at (0,0) {Alpha \\[10pt] Beta \\ The longest line here};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveValue("Alpha \\\\[10pt] Beta \\\\ The longest line here");

  await setTextareaSelection(page, 0, "Alpha \\\\[10pt] Beta \\\\ The longest line here".length);
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(0);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(1);
  await expect(geometryErrors).toEqual([]);
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

test("textarea-local undo/redo works while node text edit is focused", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Hello};
\node at (2,0) {Other};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("Hello");

  await textarea.press("End");
  await page.keyboard.type("!");
  await expect(textarea).toHaveValue("Hello!");
  await expect.poll(async () => await readStoreSource(page)).toContain("{Hello!}");

  await textarea.press(`${PRIMARY_MOD}+Z`);
  await expect(textarea).toHaveValue("Hello");
  await expect.poll(async () => await readStoreSource(page)).toContain("{Hello}");
  await expect.poll(async () => await readStoreSource(page)).toContain("{Other}");
  await expect.poll(async () => await readSelectedSourceIds(page)).toEqual(["path:0"]);

  if (process.platform === "darwin") {
    await textarea.press("Meta+Shift+Z");
  } else {
    await textarea.press("Control+Y");
  }
  await expect(textarea).toHaveValue("Hello!");
  await expect.poll(async () => await readStoreSource(page)).toContain("{Hello!}");
  await expect.poll(async () => await readStoreSource(page)).toContain("{Other}");
  await expect.poll(async () => await readSelectedSourceIds(page)).toEqual(["path:0"]);
});

test("supported beforeinput replacement and word-delete intents update node text", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {alpha beta gamma};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("alpha beta gamma");

  await dispatchTextareaBeforeInput(page, "insertReplacementText", {
    data: "BETA",
    selectionStart: 6,
    selectionEnd: 10
  });
  await expect(textarea).toHaveValue("alpha BETA gamma");
  await expect.poll(async () => await readStoreSource(page)).toContain("{alpha BETA gamma}");

  await dispatchTextareaBeforeInput(page, "deleteWordBackward", {
    selectionStart: 11,
    selectionEnd: 11
  });
  await expect(textarea).toHaveValue("alpha gamma");
  await expect.poll(async () => await readStoreSource(page)).toContain("{alpha gamma}");
});

test("insertParagraph and line-delete beforeinput intents work in multiline node text", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {alpha};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("alpha");

  await dispatchTextareaBeforeInput(page, "insertParagraph", {
    selectionStart: 5,
    selectionEnd: 5
  });
  await dispatchTextareaBeforeInput(page, "insertText", {
    data: "beta",
    selectionStart: 6,
    selectionEnd: 6
  });
  await dispatchTextareaBeforeInput(page, "insertParagraph", {
    selectionStart: 10,
    selectionEnd: 10
  });
  await dispatchTextareaBeforeInput(page, "insertText", {
    data: "gamma",
    selectionStart: 11,
    selectionEnd: 11
  });

  await expect(textarea).toHaveValue("alpha\nbeta\ngamma");
  await expect.poll(async () => await readStoreSource(page)).toContain("{alpha\nbeta\ngamma}");

  await dispatchTextareaBeforeInput(page, "deleteSoftLineBackward", {
    selectionStart: 8,
    selectionEnd: 8
  });
  await expect(textarea).toHaveValue("alpha\nta\ngamma");
  await expect.poll(async () => await readStoreSource(page)).toContain("{alpha\nta\ngamma}");

  await dispatchTextareaBeforeInput(page, "deleteSoftLineForward", {
    selectionStart: 7,
    selectionEnd: 7
  });
  await expect(textarea).toHaveValue("alpha\nt\ngamma");
  await expect.poll(async () => await readStoreSource(page)).toContain("{alpha\nt\ngamma}");
});

test("dropping plain text into the popup textarea updates node text through the reducer", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Hello world};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("Hello world");

  await dispatchTextareaDrop(page, "TikZ", 6, 11);
  await expect(textarea).toHaveValue("Hello TikZ");
  await expect.poll(async () => await readStoreSource(page)).toContain("{Hello TikZ}");
});

test("replacement and drop affect only the targeted identical text node", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Hello};
\node at (2,0) {Hello};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:1");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("Hello");

  await dispatchTextareaBeforeInput(page, "insertReplacementText", {
    data: "Hi",
    selectionStart: 0,
    selectionEnd: 5
  });
  await expect(textarea).toHaveValue("Hi");
  await expect.poll(async () => await readStoreSource(page)).toContain("{Hello};\n\\node at (2,0) {Hi}");

  await dispatchTextareaDrop(page, "TikZ", 0, 2);
  await expect(textarea).toHaveValue("TikZ");
  await expect.poll(async () => await readStoreSource(page)).toContain("{Hello};\n\\node at (2,0) {TikZ}");
});

test("typing trailing backslash in node text stays local until stabilized by next character", async ({ page }) => {
  await gotoApp(page);
  const originalSource = String.raw`\begin{tikzpicture}
  \node at (0,0) {A};
  \node at (1.5,-0.5) {B};
  \node at (0,1.5) {C};
\end{tikzpicture}`;
  await setSource(page, originalSource);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("A");
  await textarea.press("End");
  await expect.poll(async () => await readTextareaSelection(page)).toEqual({ start: 1, end: 1 });
  await page.keyboard.type("\\");
  await expect(textarea).toHaveValue("A\\");
  await expect.poll(async () => await readStoreSource(page)).toBe(originalSource);

  await page.keyboard.type("a");
  await expect(textarea).toHaveValue("A\\a");
  await expect.poll(async () => await readStoreSource(page)).toContain("{A\\a};");
  await expect.poll(async () => await readStoreSource(page)).toContain("{B};");
  await expect.poll(async () => await readStoreSource(page)).toContain("{C};");
});

test("incomplete text command group does not render the path semicolon as node text", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \node at (0.2,3.2) [align=left]{I'm testing the Mathjax \\ rendering };
\end{tikzpicture}`);

  await waitForHitRegions(page, 1);
  await clickTextHitRegionByTargetId(page, "path:0");

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  const nextText = String.raw`I'm testing the Mathjax \\ rendering \textit{d`;
  await expect(textarea).toBeFocused();
  await textarea.press("End");
  await page.keyboard.type(String.raw`\textit{d`);
  await expect(textarea).toHaveValue(nextText);
  await expect.poll(async () => await readStoreSource(page)).toContain(String.raw`\textit{d};`);

  const expectedSceneText = "I'm testing the Mathjax\nrendering \\textit{d";
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const api = (globalThis as {
        __TIKZ_EDITOR_APP_TEST_API__?: {
          getSceneTextDebug?: () => Array<{ sourceId: string; text: string }>;
        };
      }).__TIKZ_EDITOR_APP_TEST_API__;
      return api?.getSceneTextDebug?.().find((entry) => entry.sourceId === "path:0")?.text ?? "";
    });
  }).toBe(expectedSceneText);
});

test("typing two backslashes then backspacing twice restores original node source text", async ({ page }) => {
  await gotoApp(page);
  const originalSource = String.raw`\begin{tikzpicture}
  \node[draw] (A) at (-1, -1) {A};
  \node[draw] (B) at (1.5, -0.5) {B};
  \node[draw] (C) at (0, 1.5) {C};
\end{tikzpicture}`;
  await setSource(page, originalSource);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("A");
  await textarea.press("End");
  await expect.poll(async () => await readTextareaSelection(page)).toEqual({ start: 1, end: 1 });

  await page.keyboard.type("\\\\");
  await expect(textarea).toHaveValue("A\\\\");
  await expect.poll(async () => await readStoreSource(page)).toContain("{A\\\\};");

  await textarea.press("Backspace");
  await expect(textarea).toHaveValue("A\\");
  await expect.poll(async () => await readStoreSource(page)).toContain("{A\\\\};");

  await textarea.press("Backspace");
  await expect(textarea).toHaveValue("A");
  await expect.poll(async () => await readStoreSource(page)).toBe(originalSource);
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
