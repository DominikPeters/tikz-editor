import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canvasViewport,
  clearSceneSelection,
  clickHitRegionByTargetId,
  clickHitRegion,
  dragBetweenPoints,
  dragLocatorBy,
  dragHitRegionByTargetId,
  focusCanvas,
  gotoApp,
  interactionLayer,
  openMenuCommand,
  openMenuSection,
  readSource,
  readSelectionOverlayBoxSourceIds,
  readStoreSource,
  resetStorageBeforeNavigation,
  runMenuCommandIfEnabled,
  readSelectedSourceIds,
  selectAllSceneElements,
  selectFirstCanvasElement,
  setSource,
  waitForHitRegions
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

function readShiftValue(source: string, axis: "x" | "y"): number | null {
  const match = source.match(new RegExp(`${axis}shift=([-0-9.]+)pt`));
  return match ? Number(match[1]) : null;
}

function readScaleValue(source: string, axis: "x" | "y"): number | null {
  const match = source.match(new RegExp(`${axis}scale=([-0-9.]+)(?![a-zA-Z])`));
  return match ? Number(match[1]) : null;
}

function readAboveDistancePt(source: string): number | null {
  const nodeOptionsMatch = source.match(/node\[([^\]]*)\]\s*\{A\}/);
  if (!nodeOptionsMatch) {
    return null;
  }
  const options = nodeOptionsMatch[1] ?? "";
  const valueMatch = options.match(/\babove\s*=\s*([-0-9.]+)pt\b/);
  if (valueMatch) {
    return Number(valueMatch[1]);
  }
  return /\babove\b/.test(options) ? 0 : null;
}

function readBelowDistancePt(source: string): number | null {
  const nodeOptionsMatch = source.match(/node\[([^\]]*)\]\s*\{A\}/);
  if (!nodeOptionsMatch) {
    return null;
  }
  const options = nodeOptionsMatch[1] ?? "";
  const valueMatch = options.match(/\bbelow\s*=\s*([-0-9.]+)pt\b/);
  if (valueMatch) {
    return Number(valueMatch[1]);
  }
  return /\bbelow\b/.test(options) ? 0 : null;
}

const THIS_DIR = fileURLToPath(new URL(".", import.meta.url));
const POWERPOINT_GVML_SAMPLE_BASE64 = readFileSync(
  join(THIS_DIR, "../../../test/fixtures/powerpoint-gvml-clipboard.zip")
).toString("base64");

test("tool keyboard shortcut creates shape and escape returns to select", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await focusCanvas(page);
  await page.keyboard.press("r");
  const layer = interactionLayer(page);
  await dragBetweenPoints(page, layer, { x: 120, y: 120 }, { x: 240, y: 220 });
  await page.mouse.up();
  await expect.poll(async () => readSource(page)).toContain("rectangle");

  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
  await page.keyboard.press("Escape");

  const sourceAfterEsc = await readSource(page);
  expect(sourceAfterEsc).toContain("rectangle");
});

test("duplicate, undo, redo and delete shortcuts operate on selected canvas elements", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (2,1);
\end{tikzpicture}`);

  await focusCanvas(page);
  await selectAllSceneElements(page);

  const beforeDuplicate = await readSource(page);
  await page.keyboard.press("ControlOrMeta+d");
  await expect.poll(async () => readSource(page)).not.toEqual(beforeDuplicate);

  const afterDuplicate = await readSource(page);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => readSource(page)).toEqual(beforeDuplicate);

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => readSource(page)).toEqual(afterDuplicate);

  await selectAllSceneElements(page);
  await page.keyboard.press("Delete");
  await expect.poll(async () => readSource(page)).not.toEqual(afterDuplicate);
});

test("cmd/ctrl+a selects all canvas elements for delete", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (2,1);
\draw (3,0) rectangle (4,1);
\end{tikzpicture}`);

  await waitForHitRegions(page, 2);
  await focusCanvas(page);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");

  await expect.poll(async () => readSource(page)).not.toContain("\\draw (0,0) rectangle (2,1);");
  await expect.poll(async () => readSource(page)).not.toContain("\\draw (3,0) rectangle (4,1);");
});

test("clipped geometry only targets the visible clipped area on canvas", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\clip (0,0) rectangle (1,1);
\fill[red] (0,0) rectangle (2,1);
\end{tikzpicture}`);

  await waitForHitRegions(page, 1);
  await expect(page.locator("[data-hit-region-target-id='path:0']")).toHaveCount(0);
  const region = page.locator("[data-hit-region-target-id='path:1']").first();
  await expect(region).toBeVisible();
  const regionBox = await region.boundingBox();
  if (!regionBox) {
    throw new Error("Missing clipped hit-region bounds.");
  }

  await expect(page.locator("[data-testid='canvas-svg-layer'] clipPath")).toHaveCount(1);

  await clearSceneSelection(page);
  await page.mouse.click(regionBox.x + regionBox.width * 0.75, regionBox.y + regionBox.height * 0.5);
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual([]);

  await page.mouse.click(regionBox.x + regionBox.width * 0.25, regionBox.y + regionBox.height * 0.5);
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["path:1"]);

  await clearSceneSelection(page);
  await page.mouse.move(regionBox.x + regionBox.width * 0.72, regionBox.y + regionBox.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(regionBox.x + regionBox.width * 0.95, regionBox.y + regionBox.height * 0.75, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual([]);
});

test("inline edge nodes are selectable independently and support resize/rotate handles", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw[->] (0,0) -- node[above,draw] {$f$} (2,0);
\end{tikzpicture}`);

  await waitForHitRegions(page, 2);
  const textRegions = page.locator('[data-hit-region-interaction-mode="text"]');
  await expect.poll(async () => textRegions.count()).toBeGreaterThanOrEqual(1);

  const labelTargetId = await textRegions.first().getAttribute("data-hit-region-target-id");
  if (!labelTargetId) {
    throw new Error("Missing inline edge-node text hit-region target id.");
  }
  expect(labelTargetId).not.toBe("path:0");

  await clickHitRegionByTargetId(page, labelTargetId);
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual([labelTargetId]);

  const resizeHandles = page.locator(
    `[data-handle-kind="resize-element"][data-source-id="${labelTargetId}"]`
  );
  await expect.poll(async () => resizeHandles.count()).toBeGreaterThan(0);
  expect(await resizeHandles.first().evaluate((el) => getComputedStyle(el).cursor)).not.toBe("not-allowed");

  const baselineSource = await readSource(page);
  const bottomRightResizeHandle = page.locator(
    `[data-handle-kind="resize-element"][data-source-id="${labelTargetId}"][data-resize-role="bottom-right"]`
  ).first();
  await expect(bottomRightResizeHandle).toBeVisible();
  await dragLocatorBy(page, bottomRightResizeHandle, 120, 120);
  await page.mouse.up();
  await expect.poll(async () => readSource(page)).not.toEqual(baselineSource);
  const resizedSource = await readSource(page);
  expect(resizedSource).toMatch(/node\[[^\]]*above[^\]]*draw[^\]]*\]/);
  expect(resizedSource).toContain("minimum width=");

  const rotateHandle = page.locator(
    `[data-handle-kind="rotate-element"][data-source-id="${labelTargetId}"]`
  ).first();
  await expect(rotateHandle).toBeVisible();
  expect(await rotateHandle.evaluate((el) => getComputedStyle(el).cursor)).not.toBe("not-allowed");
  await dragLocatorBy(page, rotateHandle, 30, -26);
  await page.mouse.up();

  const rotatedSource = await readSource(page);
  expect(rotatedSource).toMatch(/node\[[^\]]*rotate=/);
  expect(rotatedSource).not.toMatch(/\\draw\[[^\]]*rotate=/);
});

test("neutral path-attached node drag rewrites pos without introducing side regime", async ({ page }) => {
  await gotoApp(page);
  const initialSource = String.raw`\begin{tikzpicture}
  \draw[->] (-0.2,-0.4) -- node[pos=0.4,fill=white] {ok} (2.8,-0.4);
\end{tikzpicture}`;
  await setSource(page, initialSource);

  await waitForHitRegions(page, 2);
  const textRegion = page.locator('[data-hit-region-interaction-mode="text"]').first();
  await expect(textRegion).toBeVisible();
  const targetId = await textRegion.getAttribute("data-hit-region-target-id");
  if (!targetId) {
    throw new Error("Missing text region target id.");
  }
  await clickHitRegionByTargetId(page, targetId);
  const targetRegion = page.locator(
    `[data-hit-region-target-id='${targetId}'][data-hit-region-interaction-mode='text']`
  ).first();
  const box = await targetRegion.boundingBox();
  if (!box) {
    throw new Error("Missing target text-region bounds.");
  }
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 16, startY, { steps: 6 });
  await page.waitForTimeout(40);
  await page.mouse.move(startX + 220, startY, { steps: 20 });
  await page.mouse.up();

  await expect.poll(async () => readSource(page)).not.toEqual(initialSource);
  const sourceAfter = await readSource(page);
  expect(sourceAfter).toContain("fill=white");
  expect(sourceAfter).not.toContain("pos=0.4");
  expect(sourceAfter).not.toContain("above");
  expect(sourceAfter).not.toContain("below");
  expect(sourceAfter).not.toContain("auto");
});

test("path-attached directional distance drag is stable from off-center pickup", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw[->] (0,0) -- node[above=2pt] {A} (3,0);
\end{tikzpicture}`);

  await waitForHitRegions(page, 2);
  const textRegion = page.locator('[data-hit-region-interaction-mode="text"]').first();
  await expect(textRegion).toBeVisible();
  const box = await textRegion.boundingBox();
  if (!box) {
    throw new Error("Missing text hit-region bounds for path-attached node.");
  }

  const startX = box.x + box.width * 0.2;
  const startY = box.y + box.height * 0.25;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY, { steps: 2 });
  await page.waitForTimeout(80);

  const afterPickupDistance = readAboveDistancePt(await readSource(page));
  expect(afterPickupDistance).not.toBeNull();
  if (afterPickupDistance == null) {
    throw new Error("Expected path-attached above placement after pickup drag.");
  }
  expect(Math.abs(afterPickupDistance - 2)).toBeLessThanOrEqual(0.75);

  const holdX = startX + 44;
  const holdY = startY - 16;
  await page.mouse.move(holdX, holdY, { steps: 8 });
  await page.waitForTimeout(120);

  const observed = new Set<string>();
  for (let index = 0; index < 8; index += 1) {
    await page.mouse.move(holdX, holdY);
    await page.waitForTimeout(50);
    const distance = readAboveDistancePt(await readSource(page));
    if (distance != null) {
      observed.add(distance.toFixed(3));
    }
  }
  await page.mouse.move(holdX, holdY + 120, { steps: 18 });
  await expect.poll(async () => {
    return readBelowDistancePt(await readSource(page));
  }, {
    timeout: 1500,
    intervals: [100, 200, 300]
  }).not.toBeNull();
  const resolvedBelowDistance = readBelowDistancePt(await readSource(page));
  expect(resolvedBelowDistance).not.toBeNull();
  if (resolvedBelowDistance == null) {
    throw new Error("Expected transition into below regime.");
  }
  expect(resolvedBelowDistance).toBeLessThanOrEqual(12);
  await page.mouse.up();

  expect(observed.size).toBeGreaterThan(0);
  expect(observed.size).toBeLessThanOrEqual(1);
});

test("path-attached resize removes non-binding minimum width when shrinking", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw[->] (-0.2,-0.4) -- node[fill=white, minimum width=16.92pt, pos=0.47] {ok} (2.8,-0.4);
\end{tikzpicture}`);

  await waitForHitRegions(page, 2);
  const textRegion = page.locator('[data-hit-region-interaction-mode="text"]').first();
  await expect(textRegion).toBeVisible();
  const targetId = await textRegion.getAttribute("data-hit-region-target-id");
  if (!targetId) {
    throw new Error("Missing path-attached node target id.");
  }
  await clickHitRegionByTargetId(page, targetId);
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual([targetId]);

  const bottomLeft = page.locator(
    `[data-handle-kind="resize-element"][data-source-id="${targetId}"][data-resize-role="bottom-left"]`
  ).first();
  const bottomRight = page.locator(
    `[data-handle-kind="resize-element"][data-source-id="${targetId}"][data-resize-role="bottom-right"]`
  ).first();
  await expect(bottomLeft).toBeVisible();
  await expect(bottomRight).toBeVisible();

  const leftBox = await bottomLeft.boundingBox();
  const rightBox = await bottomRight.boundingBox();
  if (!leftBox || !rightBox) {
    throw new Error("Missing resize handle bounds for path-attached node.");
  }

  const startX = rightBox.x + rightBox.width / 2;
  const startY = rightBox.y + rightBox.height / 2;
  const endX = leftBox.x + leftBox.width / 2 + 1;
  const endY = leftBox.y + leftBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();

  await expect.poll(async () => readSource(page)).not.toContain("minimum width=");
});

test("clearing source editor does not trigger maximum update depth crash", async ({ page }) => {
  await gotoApp(page);

  const reactDepthErrors: string[] = [];
  page.on("pageerror", (error) => {
    const message = String(error?.message ?? "");
    if (message.includes("Maximum update depth exceeded")) {
      reactDepthErrors.push(message);
    }
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") {
      return;
    }
    const text = msg.text();
    if (text.includes("Maximum update depth exceeded")) {
      reactDepthErrors.push(text);
    }
  });

  const sourceEditor = page.locator(".cm-content").first();
  await expect(sourceEditor).toBeVisible();
  await sourceEditor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");

  await expect.poll(async () => readStoreSource(page)).toBe("");
  await expect(page.getByTestId("tab-strip")).toBeVisible();
  expect(reactDepthErrors).toEqual([]);
});

test("canvas supports two-finger pinch zoom on touch devices", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw[line width=1.2pt] (-2,-1.5) rectangle (2,1.5);
\draw[fill=black] (0,0) circle (0.35);
\end{tikzpicture}`);

  const readStageMetrics = async () => {
    return await page.evaluate(() => {
      const viewport = document.querySelector("[data-canvas-viewport='true']") as HTMLDivElement | null;
      if (!viewport) {
        return null;
      }
      const stage = Array.from(viewport.children).find(
        (child): child is HTMLDivElement =>
          child instanceof HTMLDivElement && child.querySelector("svg[viewBox]") != null
      );
      if (!stage) {
        return null;
      }
      const rect = stage.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        transform: stage.style.transform
      };
    });
  };

  await expect.poll(readStageMetrics, {
    timeout: 30_000,
    intervals: [250, 500, 1000]
  }).not.toBeNull();

  const before = await readStageMetrics();

  expect(before).not.toBeNull();

  await page.evaluate(() => {
    const viewport = document.querySelector("[data-canvas-viewport='true']") as HTMLDivElement | null;
    if (!viewport) {
      throw new Error("Canvas viewport not found.");
    }
    const interactionSvg = Array.from(viewport.querySelectorAll("svg[viewBox]")).at(-1) as SVGSVGElement | null;
    if (!interactionSvg) {
      throw new Error("Canvas interaction layer not found.");
    }

    const rect = viewport.getBoundingClientRect();
    const y = rect.top + rect.height * 0.5;
    const leftStart = rect.left + rect.width * 0.4;
    const rightStart = rect.left + rect.width * 0.6;
    const leftEnd = leftStart - rect.width * 0.08;
    const rightEnd = rightStart + rect.width * 0.08;

    const dispatchPointer = (target: EventTarget, type: string, init: PointerEventInit) => {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          ...init
        })
      );
    };

    dispatchPointer(interactionSvg, "pointerdown", {
      pointerId: 101,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: leftStart,
      clientY: y
    });
    dispatchPointer(interactionSvg, "pointerdown", {
      pointerId: 202,
      pointerType: "touch",
      isPrimary: false,
      button: 0,
      buttons: 1,
      clientX: rightStart,
      clientY: y
    });
    dispatchPointer(window, "pointermove", {
      pointerId: 101,
      pointerType: "touch",
      isPrimary: true,
      buttons: 1,
      clientX: leftEnd,
      clientY: y
    });
    dispatchPointer(window, "pointermove", {
      pointerId: 202,
      pointerType: "touch",
      isPrimary: false,
      buttons: 1,
      clientX: rightEnd,
      clientY: y
    });
    dispatchPointer(window, "pointerup", {
      pointerId: 101,
      pointerType: "touch",
      isPrimary: true,
      clientX: leftEnd,
      clientY: y
    });
    dispatchPointer(window, "pointerup", {
      pointerId: 202,
      pointerType: "touch",
      isPrimary: false,
      clientX: rightEnd,
      clientY: y
    });
  });

  await expect.poll(async () => (await readStageMetrics())?.width ?? 0).toBeGreaterThan((before?.width ?? 0) * 1.1);
});

test("short background touch tap clears the current selection", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (2,1);
\draw (3,0) rectangle (4,1);
\end{tikzpicture}`);

  await selectAllSceneElements(page);
  await expect.poll(async () => (await readSelectedSourceIds(page)).length).toBeGreaterThan(0);

  const viewport = canvasViewport(page);
  const box = await viewport.boundingBox();
  if (!box) {
    throw new Error("Missing canvas viewport bounds.");
  }

  const x = box.x + box.width * 0.8;
  const y = box.y + box.height * 0.8;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }],
    modifiers: 0
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
    modifiers: 0
  });

  await expect.poll(async () => readSelectedSourceIds(page)).toEqual([]);
});

test("selection-sensitive edit menu commands enable only after selecting element", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (2,1);
\end{tikzpicture}`);

  await openMenuSection(page, "edit");
  await expect(page.getByTestId("menu-cmd-edit.copy")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-edit.cut")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-edit.delete")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-edit.duplicate")).toBeDisabled();

  await focusCanvas(page);
  await selectAllSceneElements(page);

  await openMenuSection(page, "edit");
  await expect(page.getByTestId("menu-cmd-edit.copy")).toBeEnabled();
  await expect(page.getByTestId("menu-cmd-edit.cut")).toBeEnabled();
  await expect(page.getByTestId("menu-cmd-edit.delete")).toBeEnabled();
  await expect(page.getByTestId("menu-cmd-edit.duplicate")).toBeEnabled();
});

test("menu cut/copy/paste flow works with mocked clipboard", async ({ page }) => {
  await page.addInitScript(() => {
    let clipboardText = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          clipboardText = value;
        },
        readText: async () => clipboardText
      }
    });
  });

  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,1);
\end{tikzpicture}`);

  await focusCanvas(page);
  await selectFirstCanvasElement(page);
  const before = await readSource(page);

  await openMenuCommand(page, "edit", "edit.copy");
  await openMenuCommand(page, "edit", "edit.paste");
  await expect.poll(async () => readSource(page)).not.toEqual(before);

  const afterPaste = await readSource(page);
  await selectFirstCanvasElement(page);
  await openMenuCommand(page, "edit", "edit.cut");
  await expect.poll(async () => readSource(page)).not.toEqual(afterPaste);
});

test("transform, reorder, align and distribute commands are surfaced with stable enabled/disabled states", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (1,1);
\draw (2,0.5) rectangle (3,1.5);
\end{tikzpicture}`);

  await selectAllSceneElements(page);

  const commands = [
    "edit.align-left",
    "edit.align-middle",
    "edit.distribute-horizontal",
    "edit.send-to-back",
    "edit.bring-to-front",
    "edit.rotate-left-90",
    "edit.rotate-right-90",
    "edit.flip-horizontal",
    "edit.flip-vertical"
  ] as const;
  let enabledCount = 0;
  let disabledCount = 0;
  for (const command of commands) {
    const enabled = await runMenuCommandIfEnabled(page, "edit", command);
    if (enabled) {
      enabledCount += 1;
    } else {
      disabledCount += 1;
    }
  }
  expect(enabledCount + disabledCount).toBe(commands.length);
  expect(disabledCount).toBeGreaterThan(0);
});

test("canvas context menu opens and runs duplicate command", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (2,1);
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();

  const sourceBefore = await readSource(page);
  await selectAllSceneElements(page);
  await clickHitRegion(page, 0, { button: "right" });
  await expect(page.getByTestId("canvas-context-menu")).toBeVisible();
  await page.getByTestId("canvas-context-cmd-edit.duplicate").click();

  await expect.poll(async () => readSource(page)).not.toEqual(sourceBefore);
});

test("group honors editor indent size and supports pointer-up drill-down behavior", async ({ page }) => {
  await gotoApp(page);
  await openMenuCommand(page, "file", "file.open-settings");
  await page.getByTestId("settings-category-editor").click();
  await page.selectOption("#setting-indent-size", "4");
  await page.getByTestId("settings-modal").getByRole("button", { name: "Close" }).click();

  await setSource(page, String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \node[draw] (A) at (-1, -1) {A};
  \node[draw] (B) at (1, -1) {B};
  \draw (-1.35,-2.28) rectangle (2.2,-3.4);
\end{tikzpicture}`);

  await page.evaluate(() => {
    const api = (globalThis as unknown as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        selectSourceIds?: (sourceIds: string[]) => void;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    api?.selectSourceIds?.(["path:0", "path:1"]);
  });
  await expect.poll(async () => {
    const selected = await readSelectedSourceIds(page);
    return selected.slice().sort();
  }).toEqual(["path:0", "path:1"]);
  const grouped = await runMenuCommandIfEnabled(page, "edit", "edit.group");
  expect(grouped).toBe(true);
  await expect.poll(async () => readStoreSource(page)).toContain("\\begin{scope}");
  await expect.poll(async () => readStoreSource(page)).toContain("\n      \\node[draw] (A) at (-1, -1) {A};");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:0"]);

  await page.evaluate(() => {
    const api = (globalThis as unknown as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        clearSelection?: () => void;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    api?.clearSelection?.();
  });
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual([]);

  await clickHitRegionByTargetId(page, "path:1", { button: "right" });
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:0"]);
  await expect(page.getByTestId("canvas-context-menu")).toBeVisible();
  await expect(page.getByTestId("canvas-context-cmd-edit.ungroup")).toBeEnabled();
  await page.keyboard.press("Escape");

  await focusCanvas(page);
  await clickHitRegionByTargetId(page, "path:1");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:0"]);
  await clickHitRegionByTargetId(page, "path:1", { button: "right" });
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:0"]);
  await expect(page.getByTestId("canvas-context-menu")).toBeVisible();
  await expect(page.getByTestId("canvas-context-cmd-edit.ungroup")).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByText("scope", { exact: true })).toBeVisible();
  await expect(page.getByText("Transform", { exact: true })).toBeVisible();
  await expect(page.getByText("X shift", { exact: true })).toBeVisible();
  await expect(page.getByText("Y shift", { exact: true })).toBeVisible();
  await expect(page.getByText("X scale", { exact: true })).toBeVisible();
  await expect(page.getByText("Y scale", { exact: true })).toBeVisible();
  await openMenuSection(page, "edit");
  await expect(page.getByTestId("menu-cmd-edit.ungroup")).toBeEnabled();
  await page.getByRole("menuitem", { name: "Transform" }).hover();
  await expect(page.getByTestId("menu-cmd-edit.rotate-left-90")).toBeEnabled();
  await expect(page.getByTestId("menu-cmd-edit.rotate-right-90")).toBeEnabled();
  await expect(page.getByTestId("menu-cmd-edit.flip-horizontal")).toBeEnabled();
  await expect(page.getByTestId("menu-cmd-edit.flip-vertical")).toBeEnabled();

  await dragHitRegionByTargetId(page, "path:1", 40, -20);
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:0"]);

  await clickHitRegionByTargetId(page, "path:1");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["path:1"]);
  await clickHitRegionByTargetId(page, "path:1", { button: "right" });
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["path:1"]);
  await expect(page.getByTestId("canvas-context-menu")).toBeVisible();
  await expect(page.getByTestId("canvas-context-cmd-edit.ungroup")).toBeDisabled();
  await page.keyboard.press("Escape");
  await clickHitRegionByTargetId(page, "path:1");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["path:1"]);
  await openMenuSection(page, "edit");
  await expect(page.getByTestId("menu-cmd-edit.ungroup")).toBeDisabled();
});

test("nested scope drill is outermost-first and dragging does not advance drill steps", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \begin{scope}
    \begin{scope}
      \node[draw] (A) at (0, 0) {A};
    \end{scope}
  \end{scope}
  \node[draw] (B) at (3, 0) {B};
\end{tikzpicture}`);

  await focusCanvas(page);
  await clickHitRegionByTargetId(page, "path:2");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:0"]);

  await dragHitRegionByTargetId(page, "path:2", 35, 0);
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:0"]);

  await clickHitRegionByTargetId(page, "path:2");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:1"]);

  await dragHitRegionByTargetId(page, "path:2", 35, 0);
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:1"]);

  await clickHitRegionByTargetId(page, "path:2");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["path:2"]);

  await clickHitRegionByTargetId(page, "path:2", { button: "right" });
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["path:2"]);
});

test("keyboard delete clears a selected scope atomically without crashing the source panel", async ({ page }) => {
  const pageErrors: string[] = [];
  const relevantConsoleErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(String(error));
  });
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") {
      return;
    }
    const text = message.text();
    if (
      text.includes("RangeError: Position") ||
      text.includes("An error occurred in the <SourcePanel> component")
    ) {
      relevantConsoleErrors.push(text);
    }
  });

  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \begin{scope}
    \fill (0,0) rectangle (1,1);
  \end{scope}
\end{tikzpicture}`);

  await page.evaluate(() => {
    const api = (globalThis as unknown as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        selectSourceIds?: (sourceIds: string[]) => void;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    api?.selectSourceIds?.(["scope:0"]);

    const viewport = document.querySelector("[data-testid='canvas-viewport']");
    if (viewport instanceof HTMLElement) {
      viewport.focus();
    }
  });

  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:0"]);
  await expect(canvasViewport(page)).toBeFocused();

  await page.keyboard.press("Delete");

  await expect.poll(async () => readStoreSource(page)).toEqual(String.raw`\begin{tikzpicture}
\end{tikzpicture}`);
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual([]);
  await expect(page.locator(".cm-content").first()).toContainText(String.raw`\begin{tikzpicture}`);
  await expect(page.locator(".cm-content").first()).toContainText(String.raw`\end{tikzpicture}`);
  expect(pageErrors).toEqual([]);
  expect(relevantConsoleErrors).toEqual([]);
});

test("selected scope drag tracks cursor displacement without runaway shifts", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \draw (-3,-3) rectangle (3,3);
  \begin{scope}[xshift=-5.69pt]
    \draw[fill=red] (-2.5,1.5) rectangle (-0.8,-0.3);
    \draw[fill=blue] (-2.4,0) rectangle (-0.9,-2);
  \end{scope}
\end{tikzpicture}`);

  await focusCanvas(page);
  await clickHitRegionByTargetId(page, "path:2");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:1"]);
  await expect.poll(async () => readSelectionOverlayBoxSourceIds(page)).toEqual(["scope:1"]);

  const beforeBox = await page.locator("[data-selection-overlay-box-source-id='scope:1']").boundingBox();
  expect(beforeBox).not.toBeNull();
  if (!beforeBox) {
    return;
  }

  const beforeSource = await readStoreSource(page);
  const beforeXShift = readShiftValue(beforeSource, "x");
  expect(beforeXShift).not.toBeNull();
  if (beforeXShift === null) {
    return;
  }

  const scopeHitRegion = page.locator("[data-hit-region-target-id='scope:1']").first();
  const scopeHitBox = await scopeHitRegion.boundingBox();
  expect(scopeHitBox).not.toBeNull();
  if (!scopeHitBox) {
    return;
  }

  const startX = scopeHitBox.x + scopeHitBox.width / 2;
  const startY = scopeHitBox.y + scopeHitBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.evaluate(() => {
    const globalLike = globalThis as typeof globalThis & {
      __TIKZ_EDITOR_APP_TEST_API__?: { getSource?: () => string };
      __PW_SCOPE_DRAG_SAMPLES__?: { stop: () => string[] };
    };
    const samples: string[] = [];
    let active = true;
    const capture = () => {
      if (!active) {
        return;
      }
      samples.push(globalLike.__TIKZ_EDITOR_APP_TEST_API__?.getSource?.() ?? "");
      globalLike.requestAnimationFrame(capture);
    };
    globalLike.requestAnimationFrame(capture);
    globalLike.__PW_SCOPE_DRAG_SAMPLES__ = {
      stop: () => {
        active = false;
        return [...samples];
      }
    };
  });
  await page.mouse.down();
  await page.mouse.move(startX + 180, startY, { steps: 200 });
  await page.mouse.up();
  const dragSamples = await page.evaluate(() => {
    const globalLike = globalThis as typeof globalThis & {
      __PW_SCOPE_DRAG_SAMPLES__?: { stop: () => string[] };
    };
    const samples = globalLike.__PW_SCOPE_DRAG_SAMPLES__?.stop() ?? [];
    delete globalLike.__PW_SCOPE_DRAG_SAMPLES__;
    return samples;
  });
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:1"]);

  const sampledXShifts = dragSamples
    .map((sample) => readShiftValue(sample, "x"))
    .filter((sample): sample is number => sample !== null);
  expect(sampledXShifts.length).toBeGreaterThan(0);
  for (const sampledXShift of sampledXShifts) {
    expect(Math.abs(sampledXShift - beforeXShift)).toBeLessThan(400);
  }

  await expect.poll(async () => {
    const currentBox = await page.locator("[data-selection-overlay-box-source-id='scope:1']").boundingBox();
    if (!currentBox) {
      return Number.NaN;
    }
    return (currentBox.x + currentBox.width / 2) - (beforeBox.x + beforeBox.width / 2);
  }).toBeGreaterThan(120);
  await expect.poll(async () => {
    const currentBox = await page.locator("[data-selection-overlay-box-source-id='scope:1']").boundingBox();
    if (!currentBox) {
      return Number.NaN;
    }
    return (currentBox.x + currentBox.width / 2) - (beforeBox.x + beforeBox.width / 2);
  }).toBeLessThan(260);
  await expect.poll(async () => {
    const currentBox = await page.locator("[data-selection-overlay-box-source-id='scope:1']").boundingBox();
    if (!currentBox) {
      return Number.NaN;
    }
    return (currentBox.y + currentBox.height / 2) - (beforeBox.y + beforeBox.height / 2);
  }).toBeGreaterThan(-20);
  await expect.poll(async () => {
    const currentBox = await page.locator("[data-selection-overlay-box-source-id='scope:1']").boundingBox();
    if (!currentBox) {
      return Number.NaN;
    }
    return (currentBox.y + currentBox.height / 2) - (beforeBox.y + beforeBox.height / 2);
  }).toBeLessThan(20);

  const finalBox = await page.locator("[data-selection-overlay-box-source-id='scope:1']").boundingBox();
  expect(finalBox).not.toBeNull();
  if (!finalBox) {
    return;
  }

  const deltaX = (finalBox.x + finalBox.width / 2) - (beforeBox.x + beforeBox.width / 2);
  const deltaY = (finalBox.y + finalBox.height / 2) - (beforeBox.y + beforeBox.height / 2);
  expect(deltaX).toBeGreaterThan(120);
  expect(deltaX).toBeLessThan(260);
  expect(Math.abs(deltaY)).toBeLessThan(20);

  const afterSource = await readStoreSource(page);
  const afterXShift = readShiftValue(afterSource, "x");
  expect(afterXShift).not.toBeNull();
  if (afterXShift === null) {
    return;
  }

  const xshiftDelta = afterXShift - beforeXShift;
  expect(Math.abs(xshiftDelta)).toBeLessThan(400);
  expect(xshiftDelta).toBeGreaterThan(0);
});

test("selected scope exposes resize handles and rewrites scale on corner drag", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \draw (-3,-3) rectangle (3,3);
  \begin{scope}
    \draw[fill=red] (-2.5,1.5) rectangle (-0.8,-0.3);
    \draw[fill=blue] (-2.4,0) rectangle (-0.9,-2);
  \end{scope}
\end{tikzpicture}`);

  await focusCanvas(page);
  await clickHitRegionByTargetId(page, "path:2");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:1"]);
  await expect.poll(async () => readSelectionOverlayBoxSourceIds(page)).toEqual(["scope:1"]);

  const beforeBox = await page.locator("[data-selection-overlay-box-source-id='scope:1']").boundingBox();
  expect(beforeBox).not.toBeNull();
  if (!beforeBox) {
    return;
  }

  const resizeHandle = page.locator("[data-handle-kind='resize-element'][data-source-id='scope:1'][data-resize-role='top-left']").first();
  await expect(resizeHandle).toBeVisible();
  await dragLocatorBy(page, resizeHandle, -90, -70);
  await page.mouse.up();

  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:1"]);
  await expect.poll(async () => {
    const currentBox = await page.locator("[data-selection-overlay-box-source-id='scope:1']").boundingBox();
    if (!currentBox) {
      return Number.NaN;
    }
    return currentBox.width - beforeBox.width;
  }).toBeGreaterThan(40);
  await expect.poll(async () => {
    const currentBox = await page.locator("[data-selection-overlay-box-source-id='scope:1']").boundingBox();
    if (!currentBox) {
      return Number.NaN;
    }
    return currentBox.height - beforeBox.height;
  }).toBeGreaterThan(30);

  const afterSource = await readStoreSource(page);
  const afterXScale = readScaleValue(afterSource, "x");
  const afterYScale = readScaleValue(afterSource, "y");
  expect(afterXScale).not.toBeNull();
  expect(afterYScale).not.toBeNull();
  if (afterXScale === null || afterYScale === null) {
    return;
  }
  expect(afterXScale).toBeGreaterThan(1);
  expect(afterYScale).toBeGreaterThan(1);
});

test("scope resize keeps the opposite edge visually anchored during drag", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \draw (-3,-3) rectangle (3,3);
  \begin{scope}
    \draw[fill=red] (-2.5,1.5) rectangle (-0.8,-0.3);
    \draw[fill=blue] (-2.4,0) rectangle (-0.9,-2);
  \end{scope}
\end{tikzpicture}`);

  await focusCanvas(page);
  await clickHitRegionByTargetId(page, "path:2");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:1"]);

  const beforeBox = await page.locator("[data-selection-overlay-box-source-id='scope:1']").boundingBox();
  expect(beforeBox).not.toBeNull();
  if (!beforeBox) {
    return;
  }

  const resizeHandle = page.locator("[data-handle-kind='resize-element'][data-source-id='scope:1'][data-resize-role='top-right']").first();
  await expect(resizeHandle).toBeVisible();

  await page.evaluate(() => {
    const globalLike = globalThis as typeof globalThis & {
      __PW_SCOPE_RESIZE_SAMPLES__?: { stop: () => Array<{ left: number; bottom: number }> };
    };
    const samples: Array<{ left: number; bottom: number }> = [];
    let active = true;
    const capture = () => {
      if (!active) {
        return;
      }
      const box = document.querySelector("[data-selection-overlay-box-source-id='scope:1']") as SVGGraphicsElement | null;
      if (box) {
        const rect = box.getBoundingClientRect();
        samples.push({ left: rect.left, bottom: rect.bottom });
      }
      globalLike.requestAnimationFrame(capture);
    };
    globalLike.requestAnimationFrame(capture);
    globalLike.__PW_SCOPE_RESIZE_SAMPLES__ = {
      stop: () => {
        active = false;
        return [...samples];
      }
    };
  });

  await dragLocatorBy(page, resizeHandle, 110, 0);
  await page.mouse.up();

  const dragSamples = await page.evaluate(() => {
    const globalLike = globalThis as typeof globalThis & {
      __PW_SCOPE_RESIZE_SAMPLES__?: { stop: () => Array<{ left: number; bottom: number }> };
    };
    const samples = globalLike.__PW_SCOPE_RESIZE_SAMPLES__?.stop() ?? [];
    delete globalLike.__PW_SCOPE_RESIZE_SAMPLES__;
    return samples;
  });

  expect(dragSamples.length).toBeGreaterThan(0);
  const maxLeftDeviation = Math.max(...dragSamples.map((sample) => Math.abs(sample.left - beforeBox.x)));
  const maxBottomDeviation = Math.max(...dragSamples.map((sample) => Math.abs(sample.bottom - (beforeBox.y + beforeBox.height))));
  expect(maxLeftDeviation).toBeLessThan(8);
  expect(maxBottomDeviation).toBeLessThan(8);
});

test("selected scope drag from member area tracks cursor displacement without runaway shifts", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \draw (-3,-3) rectangle (3,3);
  \begin{scope}[xshift=-5.69pt]
    \draw[fill=red] (-2.5,1.5) rectangle (-0.8,-0.3);
    \draw[fill=blue] (-2.4,0) rectangle (-0.9,-2);
  \end{scope}
\end{tikzpicture}`);

  await focusCanvas(page);
  await clickHitRegionByTargetId(page, "path:2");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:1"]);
  await expect.poll(async () => readSelectionOverlayBoxSourceIds(page)).toEqual(["scope:1"]);

  const beforeBox = await page.locator("[data-selection-overlay-box-source-id='scope:1']").boundingBox();
  expect(beforeBox).not.toBeNull();
  if (!beforeBox) {
    return;
  }

  const beforeSource = await readStoreSource(page);
  const beforeMatch = beforeSource.match(/xshift=([-0-9.]+)pt/);
  expect(beforeMatch).not.toBeNull();
  if (!beforeMatch) {
    return;
  }

  const memberRegion = page.locator("[data-hit-region-target-id='path:2']").first();
  const memberBox = await memberRegion.boundingBox();
  expect(memberBox).not.toBeNull();
  if (!memberBox) {
    return;
  }

  const startX = memberBox.x + memberBox.width / 2;
  const startY = memberBox.y + memberBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 180, startY, { steps: 40 });
  await page.mouse.up();
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:1"]);

  await expect.poll(async () => {
    const currentBox = await page.locator("[data-selection-overlay-box-source-id='scope:1']").boundingBox();
    if (!currentBox) {
      return Number.NaN;
    }
    return (currentBox.x + currentBox.width / 2) - (beforeBox.x + beforeBox.width / 2);
  }).toBeGreaterThan(120);
  await expect.poll(async () => {
    const currentBox = await page.locator("[data-selection-overlay-box-source-id='scope:1']").boundingBox();
    if (!currentBox) {
      return Number.NaN;
    }
    return (currentBox.x + currentBox.width / 2) - (beforeBox.x + beforeBox.width / 2);
  }).toBeLessThan(260);

  const afterSource = await readStoreSource(page);
  const afterMatch = afterSource.match(/xshift=([-0-9.]+)pt/);
  expect(afterMatch).not.toBeNull();
  if (!afterMatch) {
    return;
  }

  const xshiftDelta = Number(afterMatch[1]) - Number(beforeMatch[1]);
  expect(Math.abs(xshiftDelta)).toBeLessThan(400);
  expect(xshiftDelta).toBeGreaterThan(0);
});

test("unselected member drag promotes to scope drag without runaway shifts", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \draw (-3,-3) rectangle (3,3);
  \begin{scope}[xshift=-5.69pt]
    \draw[fill=red] (-2.5,1.5) rectangle (-0.8,-0.3);
    \draw[fill=blue] (-2.4,0) rectangle (-0.9,-2);
  \end{scope}
\end{tikzpicture}`);

  await focusCanvas(page);
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual([]);

  const beforeSource = await readStoreSource(page);
  const beforeMatch = beforeSource.match(/xshift=([-0-9.]+)pt/);
  expect(beforeMatch).not.toBeNull();
  if (!beforeMatch) {
    return;
  }

  const memberRegion = page.locator("[data-hit-region-target-id='path:2']").first();
  const memberBox = await memberRegion.boundingBox();
  expect(memberBox).not.toBeNull();
  if (!memberBox) {
    return;
  }

  const startX = memberBox.x + memberBox.width / 2;
  const startY = memberBox.y + memberBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 180, startY, { steps: 40 });
  await page.mouse.up();

  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:1"]);
  await expect.poll(async () => readSelectionOverlayBoxSourceIds(page)).toEqual(["scope:1"]);

  const afterSource = await readStoreSource(page);
  const afterMatch = afterSource.match(/xshift=([-0-9.]+)pt/);
  expect(afterMatch).not.toBeNull();
  if (!afterMatch) {
    return;
  }

  const xshiftDelta = Number(afterMatch[1]) - Number(beforeMatch[1]);
  expect(Math.abs(xshiftDelta)).toBeLessThan(400);
  expect(xshiftDelta).toBeGreaterThan(0);
});

test("small downward scope drag does not explode yshift", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \draw (-3,-3) rectangle (3,3);
  \begin{scope}[xshift=5pt]
    \draw[fill=red] (-2.5,1.5) rectangle (-0.8,-0.3);
    \draw[fill=blue] (-2.4,0) rectangle (-0.9,-2);
  \end{scope}
\end{tikzpicture}`);

  await focusCanvas(page);
  await clickHitRegionByTargetId(page, "path:2");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:1"]);
  await expect.poll(async () => readSelectionOverlayBoxSourceIds(page)).toEqual(["scope:1"]);

  const beforeSource = await readStoreSource(page);
  const beforeXShift = readShiftValue(beforeSource, "x");
  const beforeYShift = readShiftValue(beforeSource, "y") ?? 0;
  expect(beforeXShift).not.toBeNull();
  if (beforeXShift === null) {
    return;
  }

  const memberRegion = page.locator("[data-hit-region-target-id='path:2']").first();
  const memberBox = await memberRegion.boundingBox();
  expect(memberBox).not.toBeNull();
  if (!memberBox) {
    return;
  }

  const startX = memberBox.x + memberBox.width / 2;
  const startY = memberBox.y + memberBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.evaluate(() => {
    const globalLike = globalThis as typeof globalThis & {
      __TIKZ_EDITOR_APP_TEST_API__?: { getSource?: () => string };
      __PW_SCOPE_DRAG_SAMPLES__?: { stop: () => string[] };
    };
    const samples: string[] = [];
    let active = true;
    const capture = () => {
      if (!active) {
        return;
      }
      samples.push(globalLike.__TIKZ_EDITOR_APP_TEST_API__?.getSource?.() ?? "");
      globalLike.requestAnimationFrame(capture);
    };
    globalLike.requestAnimationFrame(capture);
    globalLike.__PW_SCOPE_DRAG_SAMPLES__ = {
      stop: () => {
        active = false;
        return [...samples];
      }
    };
  });
  await page.mouse.down();
  await page.mouse.move(startX, startY + 10, { steps: 30 });
  await page.mouse.up();
  const dragSamples = await page.evaluate(() => {
    const globalLike = globalThis as typeof globalThis & {
      __PW_SCOPE_DRAG_SAMPLES__?: { stop: () => string[] };
    };
    const samples = globalLike.__PW_SCOPE_DRAG_SAMPLES__?.stop() ?? [];
    delete globalLike.__PW_SCOPE_DRAG_SAMPLES__;
    return samples;
  });

  const sampledYShifts = dragSamples
    .map((sample) => readShiftValue(sample, "y") ?? 0)
    .filter((sample) => Number.isFinite(sample));
  expect(sampledYShifts.length).toBeGreaterThan(0);
  for (const sampledYShift of sampledYShifts) {
    expect(Math.abs(sampledYShift - beforeYShift)).toBeLessThan(100);
  }

  const afterSource = await readStoreSource(page);
  const afterYShift = readShiftValue(afterSource, "y") ?? 0;
  expect(Math.abs(afterYShift - beforeYShift)).toBeLessThan(100);
});

test("child-hit-only scope targeting does not select scope on empty interior clicks", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \begin{scope}
    \node[draw] (A) at (-2, 0) {A};
    \node[draw] (B) at (2, 0) {B};
  \end{scope}
\end{tikzpicture}`);

  await expect.poll(async () => page.locator("[data-hit-region-target-id='path:1']").count()).toBeGreaterThan(0);
  await expect.poll(async () => page.locator("[data-hit-region-target-id='path:2']").count()).toBeGreaterThan(0);

  const clickPoint = await page.evaluate(() => {
    const left = document.querySelector("[data-hit-region-target-id='path:1']") as SVGGraphicsElement | null;
    const right = document.querySelector("[data-hit-region-target-id='path:2']") as SVGGraphicsElement | null;
    if (!left || !right) {
      throw new Error("Expected node hit regions for grouped children.");
    }
    const leftBox = left.getBoundingClientRect();
    const rightBox = right.getBoundingClientRect();
    return {
      x: (leftBox.right + rightBox.left) / 2,
      y: (leftBox.top + leftBox.bottom + rightBox.top + rightBox.bottom) / 4
    };
  });

  await page.evaluate(() => {
    const api = (globalThis as unknown as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        clearSelection?: () => void;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    api?.clearSelection?.();
  });
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual([]);

  await page.mouse.click(clickPoint.x, clickPoint.y);
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual([]);
});

test("selecting non-resizable multi-edge draw statements does not render an extra selection bbox", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \node[draw] (A) at (-1, -1) {A};
  \node[draw] (B) at (1.5, -0.5) {B};
  \node[draw] (C) at (0, 1.5) {C};
  \draw (A) edge (B)
        (B) edge (C)
        (C) edge (A);
\end{tikzpicture}`);

  await focusCanvas(page);
  await clickHitRegionByTargetId(page, "path:3");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["path:3"]);
  await expect.poll(async () => readSelectionOverlayBoxSourceIds(page)).toEqual([]);
});

test("canvas context menu exposes snapping submenu check states", async ({ page }) => {
  await gotoApp(page);

  await page.getByTestId("canvas-viewport").click({ button: "right" });
  await expect(page.getByTestId("canvas-context-menu")).toBeVisible();

  await page.getByRole("menuitem", { name: "Snapping" }).hover();
  await expect(page.getByTestId("canvas-context-cmd-view.toggle-snap-grid")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("canvas-context-cmd-view.toggle-snap-guides")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("canvas-context-cmd-view.toggle-snap-object-points")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("canvas-context-cmd-view.toggle-snap-object-gaps")).toHaveAttribute("aria-checked", "true");

  await page.getByTestId("canvas-context-cmd-view.toggle-snap-grid").click();
  await page.getByTestId("canvas-viewport").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Snapping" }).hover();
  await expect(page.getByTestId("canvas-context-cmd-view.toggle-snap-grid")).toHaveAttribute("aria-checked", "false");
});

test("canvas drop svg inserts a scope-wrapped import", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await page.evaluate(() => {
    const viewport = document.querySelector("[data-canvas-viewport='true']") as HTMLDivElement | null;
    if (!viewport) {
      throw new Error("Canvas viewport not found.");
    }
    const svg = `<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 12 12\"><path d=\"M1 1 L11 11\" stroke=\"black\"/></svg>`;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([svg], "drop.svg", { type: "image/svg+xml" }));
    viewport.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
    viewport.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  });

  await expect.poll(async () => readSource(page)).toContain("\\begin{scope}");
});

test("canvas paste custom svg fallback shows warning for invalid svg data", async ({ page }) => {
  await page.addInitScript(() => {
    const globalLike = globalThis as unknown as {
      __TIKZ_EDITOR_BROWSER_PLATFORM_ENV__?: {
        clipboard?: {
          readCustomText?: (formats: readonly string[]) => Promise<{ format: string; text: string } | null>;
        };
      };
    };
    globalLike.__TIKZ_EDITOR_BROWSER_PLATFORM_ENV__ = {
      clipboard: {
        readCustomText: async (formats) => {
          if (!formats.includes("public.svg-image")) {
            return null;
          }
          return {
            format: "public.svg-image",
            text: "this is not svg"
          };
        }
      }
    };
  });

  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await page.evaluate(() => {
    const viewport = document.querySelector("[data-canvas-viewport='true']") as HTMLDivElement | null;
    if (!viewport) {
      throw new Error("Canvas viewport not found.");
    }
    const dataTransfer = new DataTransfer();
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dataTransfer });
    viewport.dispatchEvent(event);
  });

  await expect.poll(async () => readSource(page)).toContain("\\begin{tikzpicture}");
  await expect(page.getByTestId("canvas-warning-message")).toContainText("SVG import failed:");
});

test("canvas paste custom keynote fallback inserts a scope-wrapped import", async ({ page }) => {
  await page.addInitScript(() => {
    const globalLike = globalThis as unknown as {
      __TIKZ_EDITOR_BROWSER_PLATFORM_ENV__?: {
        clipboard?: {
          readCustomText?: (formats: readonly string[]) => Promise<{ format: string; text: string } | null>;
        };
      };
    };
    globalLike.__TIKZ_EDITOR_BROWSER_PLATFORM_ENV__ = {
      clipboard: {
        readCustomText: async (formats) => {
          if (!formats.includes("com.apple.apps.content-language.canvas-object-1.0")) {
            return null;
          }
          return {
            format: "com.apple.apps.content-language.canvas-object-1.0",
            text: JSON.stringify([{
              type_identifier: "com.apple.apps.content-language.shape",
              identifier: "shape-1",
              stroke: { kind: "empty" },
              geometry: {
                position: { x: 0, y: 0 },
                size: { width: 100, height: 100 }
              }
            }])
          };
        }
      }
    };
  });

  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await page.evaluate(() => {
    const viewport = document.querySelector("[data-canvas-viewport='true']") as HTMLDivElement | null;
    if (!viewport) {
      throw new Error("Canvas viewport not found.");
    }
    const dataTransfer = new DataTransfer();
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dataTransfer });
    viewport.dispatchEvent(event);
  });

  await expect.poll(async () => readSource(page)).toContain("\\begin{scope}");
  await expect(page.getByTestId("canvas-warning-message")).toHaveCount(0);
});

test("canvas paste custom powerpoint gvml fallback inserts a scope-wrapped import", async ({ page }) => {
  await page.addInitScript((gvmlBase64) => {
    const globalLike = globalThis as unknown as {
      __TIKZ_EDITOR_BROWSER_PLATFORM_ENV__?: {
        clipboard?: {
          readCustomBytes?: (formats: readonly string[]) => Promise<{ format: string; bytesBase64: string } | null>;
        };
      };
    };
    globalLike.__TIKZ_EDITOR_BROWSER_PLATFORM_ENV__ = {
      clipboard: {
        readCustomBytes: async (formats) => {
          if (!formats.includes("com.microsoft.Art--GVML-ClipFormat")) {
            return null;
          }
          return {
            format: "com.microsoft.Art--GVML-ClipFormat",
            bytesBase64: gvmlBase64
          };
        }
      }
    };
  }, POWERPOINT_GVML_SAMPLE_BASE64);

  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await page.evaluate(() => {
    const viewport = document.querySelector("[data-canvas-viewport='true']") as HTMLDivElement | null;
    if (!viewport) {
      throw new Error("Canvas viewport not found.");
    }
    const dataTransfer = new DataTransfer();
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dataTransfer });
    viewport.dispatchEvent(event);
  });

  await expect.poll(async () => readSource(page)).toContain("\\begin{scope}");
  await expect(page.getByTestId("canvas-warning-message")).toHaveCount(0);
});

test("canvas paste custom powerpoint gvml fallback shows warning for invalid gvml data", async ({ page }) => {
  await page.addInitScript(() => {
    const globalLike = globalThis as unknown as {
      __TIKZ_EDITOR_BROWSER_PLATFORM_ENV__?: {
        clipboard?: {
          readCustomBytes?: (formats: readonly string[]) => Promise<{ format: string; bytesBase64: string } | null>;
        };
      };
    };
    globalLike.__TIKZ_EDITOR_BROWSER_PLATFORM_ENV__ = {
      clipboard: {
        readCustomBytes: async (formats) => {
          if (!formats.includes("com.microsoft.Art--GVML-ClipFormat")) {
            return null;
          }
          return {
            format: "com.microsoft.Art--GVML-ClipFormat",
            bytesBase64: "AAECAwQ="
          };
        }
      }
    };
  });

  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await page.evaluate(() => {
    const viewport = document.querySelector("[data-canvas-viewport='true']") as HTMLDivElement | null;
    if (!viewport) {
      throw new Error("Canvas viewport not found.");
    }
    const dataTransfer = new DataTransfer();
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dataTransfer });
    viewport.dispatchEvent(event);
  });

  await expect.poll(async () => readSource(page)).toContain("\\begin{tikzpicture}");
  await expect(page.getByTestId("canvas-warning-message")).toContainText("PowerPoint import failed:");
});

test("canvas paste prefers custom desktop tikz payload over plain text fallback", async ({ page }) => {
  await page.addInitScript(() => {
    const globalLike = globalThis as unknown as {
      __TIKZ_EDITOR_BROWSER_PLATFORM_ENV__?: {
        clipboard?: {
          readCustomText?: (formats: readonly string[]) => Promise<{ format: string; text: string } | null>;
        };
      };
    };
    globalLike.__TIKZ_EDITOR_BROWSER_PLATFORM_ENV__ = {
      clipboard: {
        readCustomText: async (formats) => {
          if (!formats.includes("com.tikzeditor.tikz-json")) {
            return null;
          }
          return {
            format: "com.tikzeditor.tikz-json",
            text: JSON.stringify({
              version: 1,
              snippets: ["\\\\draw (4,4) -- (5,5);"],
              plainText: "\\\\draw (4,4) -- (5,5);",
              pasteBehavior: "offset",
              pasteCount: 2
            })
          };
        }
      }
    };
  });

  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await page.evaluate(() => {
    const viewport = document.querySelector("[data-canvas-viewport='true']") as HTMLDivElement | null;
    if (!viewport) {
      throw new Error("Canvas viewport not found.");
    }
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", "\\draw (0,0) -- (1,1);");
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dataTransfer });
    viewport.dispatchEvent(event);
  });

  await expect.poll(async () => readSource(page)).toContain("\\draw (4,4) -- (5,5);");
  await expect(page.locator(".cm-content").first()).not.toContainText("\\draw (0,0) -- (1,1);");
});

test("view menu check-state toggles for grid, snapping modes, rulers and guides", async ({ page }) => {
  await gotoApp(page);

  await openMenuSection(page, "view");
  await expect(page.getByTestId("menu-cmd-view.toggle-grid")).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitem", { name: "Snapping" }).hover();
  await expect(page.getByTestId("menu-cmd-view.toggle-snap-grid")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("menu-cmd-view.toggle-snap-guides")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("menu-cmd-view.toggle-snap-object-points")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("menu-cmd-view.toggle-snap-object-gaps")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("menu-cmd-view.toggle-rulers")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("menu-cmd-view.toggle-guides")).toHaveAttribute("aria-checked", "true");

  await openMenuCommand(page, "view", "view.toggle-grid");
  await openMenuCommand(page, "view", "view.toggle-snap-grid");
  await openMenuCommand(page, "view", "view.toggle-snap-guides");
  await openMenuCommand(page, "view", "view.toggle-snap-object-points");
  await openMenuCommand(page, "view", "view.toggle-snap-object-gaps");
  await openMenuCommand(page, "view", "view.toggle-rulers");
  await openMenuCommand(page, "view", "view.toggle-guides");

  await openMenuSection(page, "view");
  await expect(page.getByTestId("menu-cmd-view.toggle-grid")).toHaveAttribute("aria-checked", "false");
  await page.getByRole("menuitem", { name: "Snapping" }).hover();
  await expect(page.getByTestId("menu-cmd-view.toggle-snap-grid")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("menu-cmd-view.toggle-snap-guides")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("menu-cmd-view.toggle-snap-object-points")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("menu-cmd-view.toggle-snap-object-gaps")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("menu-cmd-view.toggle-rulers")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("menu-cmd-view.toggle-guides")).toHaveAttribute("aria-checked", "false");
});
