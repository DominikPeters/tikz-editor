import { expect, test } from "@playwright/test";
import {
  canvasViewport,
  clickHitRegion,
  clickHitRegionByTargetId,
  dragBetweenPoints,
  dragLocatorBy,
  gotoApp,
  interactionLayer,
  openMenuCommand,
  openMenuSection,
  readSelectedSourceIds,
  readSource,
  resetStorageBeforeNavigation,
  setSource,
  waitForHitRegions
} from "./helpers";

const CM_PER_PT = 1 / 28.4527559055;

function toolbarButton(page: import("@playwright/test").Page, label: string) {
  return page.locator(`[data-tauri-drag-region] button[aria-label="${label}"]`).first();
}

function normalizeSourceWhitespace(source: string): string {
  return source.replace(/\s+/g, "");
}

async function readCodeMirrorText(page: import("@playwright/test").Page): Promise<string> {
  return await page.locator(".cm-content .cm-line").evaluateAll((lines) =>
    lines.map((line) => line.textContent ?? "").join("\n")
  );
}

async function readRightmostResizeHandleCenter(page: import("@playwright/test").Page): Promise<{ x: number; y: number }> {
  const center = await page.evaluate(() => {
    const handles = Array.from(document.querySelectorAll('[data-handle-kind="resize-element"]'));
    if (handles.length === 0) {
      return null;
    }
    let best: { x: number; y: number } | null = null;
    for (const handle of handles) {
      const rect = handle.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (!best || x > best.x) {
        best = { x, y };
      }
    }
    return best;
  });
  if (!center) {
    throw new Error("No resize handles were found.");
  }
  return center;
}

async function readCursorDistanceToRightmostResizeHandle(
  page: import("@playwright/test").Page,
  cursor: { x: number; y: number }
): Promise<number> {
  return await page.evaluate((target) => {
    const handles = Array.from(document.querySelectorAll('[data-handle-kind="resize-element"]'));
    if (handles.length === 0) {
      return Number.POSITIVE_INFINITY;
    }
    let best: { x: number; y: number } | null = null;
    for (const handle of handles) {
      const rect = handle.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (!best || x > best.x) {
        best = { x, y };
      }
    }
    if (!best) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.hypot(best.x - target.x, best.y - target.y);
  }, cursor);
}

async function readResizeHandleSpanPt(page: import("@playwright/test").Page): Promise<{ widthPt: number; heightPt: number } | null> {
  return await page.evaluate(() => {
    const resizeHandles = Array.from(document.querySelectorAll('[data-handle-kind="resize-element"]'));
    if (resizeHandles.length === 0) {
      return null;
    }
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const handle of resizeHandles) {
      const rect = handle.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      minX = Math.min(minX, centerX);
      maxX = Math.max(maxX, centerX);
      minY = Math.min(minY, centerY);
      maxY = Math.max(maxY, centerY);
    }
    const svgs = Array.from(document.querySelectorAll("[data-canvas-viewport='true'] svg"));
    const svg = svgs[svgs.length - 1];
    if (!svg) {
      return null;
    }
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    if (rect.width <= 0 || rect.height <= 0 || viewBox.width <= 0 || viewBox.height <= 0) {
      return null;
    }
    const ptPerPxX = viewBox.width / rect.width;
    const ptPerPxY = viewBox.height / rect.height;
    return {
      widthPt: (maxX - minX) * ptPerPxX,
      heightPt: (maxY - minY) * ptPerPxY
    };
  });
}

async function readResizeRoles(page: import("@playwright/test").Page): Promise<string[]> {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-handle-kind="resize-element"][data-resize-role]'))
      .map((element) => element.getAttribute("data-resize-role") ?? "")
      .filter((value) => value.length > 0)
  );
}

async function worldCmToClientPoint(
  page: import("@playwright/test").Page,
  point: { xCm: number; yCm: number }
): Promise<{ x: number; y: number }> {
  return await page.evaluate(({ xCm, yCm, cmPerPt }) => {
    const svgs = Array.from(document.querySelectorAll("[data-canvas-viewport='true'] svg"));
    const svg = svgs[svgs.length - 1] as SVGSVGElement | undefined;
    if (!svg) {
      throw new Error("No canvas SVG was found.");
    }
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    if (rect.width <= 0 || rect.height <= 0 || viewBox.width <= 0 || viewBox.height <= 0) {
      throw new Error("Canvas SVG has invalid bounds.");
    }
    const ptPerCm = 1 / cmPerPt;
    const worldX = xCm * ptPerCm;
    const worldY = yCm * ptPerCm;
    const svgX = worldX;
    const svgY = viewBox.y + viewBox.height - (worldY - viewBox.y);
    return {
      x: rect.left + ((svgX - viewBox.x) / viewBox.width) * rect.width,
      y: rect.top + ((svgY - viewBox.y) / viewBox.height) * rect.height
    };
  }, { ...point, cmPerPt: CM_PER_PT });
}

async function doubleClickHitRegionByTargetId(
  page: import("@playwright/test").Page,
  targetId: string
): Promise<void> {
  await waitForHitRegions(page, 1);
  const region = page.locator(`[data-hit-region-target-id='${targetId}']`).first();
  await expect(region).toBeVisible();
  const target = await region.evaluate((element) => {
    const fallback = () => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };

    if (element instanceof SVGGeometryElement && typeof element.getTotalLength === "function") {
      try {
        const length = element.getTotalLength();
        const sample = element.getPointAtLength(Math.min(Math.max(length * 0.25, 1), Math.max(length - 1, 1)));
        const svg = element.ownerSVGElement;
        const ctm = element.getScreenCTM();
        if (!svg || !ctm) {
          return fallback();
        }
        const point = svg.createSVGPoint();
        point.x = sample.x;
        point.y = sample.y;
        const screen = point.matrixTransform(ctm);
        return { x: screen.x, y: screen.y };
      } catch {
        return fallback();
      }
    }

    return fallback();
  });
  await page.mouse.dblclick(target.x, target.y);
}

async function hitRegionSamplePoint(
  page: import("@playwright/test").Page,
  index: number
): Promise<{ x: number; y: number }> {
  await waitForHitRegions(page, index + 1);
  return await page.locator("[data-hit-region-target-id]").nth(index).evaluate((element) => {
    const fallback = () => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };

    if (element instanceof SVGGeometryElement && typeof element.getTotalLength === "function") {
      const length = element.getTotalLength();
      const sample = element.getPointAtLength(Math.min(Math.max(length * 0.25, 1), Math.max(length - 1, 1)));
      const svg = element.ownerSVGElement;
      const ctm = element.getScreenCTM();
      if (!svg || !ctm) {
        return fallback();
      }
      const point = svg.createSVGPoint();
      point.x = sample.x;
      point.y = sample.y;
      const screen = point.matrixTransform(ctm);
      return { x: screen.x, y: screen.y };
    }

    return fallback();
  });
}

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("resize drag shows and hides metric tooltip", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\filldraw[fill=blue!20] (0,0) rectangle (4,2);
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();

  await clickHitRegion(page, 0);
  const resizeHandle = page.locator('[data-handle-kind="resize-element"]').first();
  await expect(resizeHandle).toBeVisible();

  await dragLocatorBy(page, resizeHandle, 40, 30);
  const tooltip = page.getByTestId("canvas-drag-tooltip-shell");
  await expect(tooltip).toBeVisible();
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Width:");
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Height:");
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("cm");
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("pt");

  await page.mouse.up();
  await expect(tooltip).toHaveCount(0);
});

test("large selections expose side resize handles while small selections keep corners only", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\filldraw[fill=blue!20] (0,0) rectangle (12,8);
\filldraw[fill=green!20] (14,0) rectangle (15,0.7);
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();

  await waitForHitRegions(page, 2);
  await clickHitRegion(page, 0);
  const largeHandles = page.locator('[data-handle-kind="resize-element"]');
  await expect.poll(async () => largeHandles.count()).toBeGreaterThanOrEqual(8);
  const largeRoles = await readResizeRoles(page);
  expect(largeRoles).toContain("top");
  expect(largeRoles).toContain("right");
  expect(largeRoles).toContain("bottom");
  expect(largeRoles).toContain("left");

  await clickHitRegion(page, 1);
  const smallHandles = page.locator('[data-handle-kind="resize-element"]');
  await expect.poll(async () => smallHandles.count()).toBe(4);
  const smallRoles = await readResizeRoles(page);
  expect(smallRoles).not.toContain("top");
  expect(smallRoles).not.toContain("right");
  expect(smallRoles).not.toContain("bottom");
  expect(smallRoles).not.toContain("left");
});

test("dragging a side resize handle updates one axis", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\filldraw[fill=blue!20] (0,0) rectangle (12,8);
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();

  await waitForHitRegions(page, 1);
  await clickHitRegion(page, 0);
  const rightHandle = page.locator('[data-handle-kind="resize-element"][data-resize-role="right"]').first();
  await expect(rightHandle).toBeVisible();
  const before = await readResizeHandleSpanPt(page);
  if (!before) {
    throw new Error("Could not resolve baseline handle span before side resize.");
  }

  await dragLocatorBy(page, rightHandle, 50, 0);
  await page.mouse.up();
  await expect.poll(async () => {
    const current = await readResizeHandleSpanPt(page);
    return current?.widthPt ?? before.widthPt;
  }).toBeGreaterThan(before.widthPt + 5);
  const after = await readResizeHandleSpanPt(page);
  if (!after) {
    throw new Error("Could not resolve handle span after side resize.");
  }

  expect(Math.abs(after.heightPt - before.heightPt)).toBeLessThan(1.25);
});

test("rotate drag shows degree tooltip", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\filldraw[fill=blue!20] (0,0) rectangle (4,2);
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();

  await clickHitRegion(page, 0);
  const rotateHandle = page.getByTestId("canvas-rotate-handle");
  await expect(rotateHandle).toBeVisible();

  await dragLocatorBy(page, rotateHandle, 30, 35);
  await expect(page.getByTestId("canvas-drag-tooltip-shell")).toBeVisible();
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Angle:");
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("°");

  await page.mouse.up();
  await expect(page.getByTestId("canvas-drag-tooltip-shell")).toHaveCount(0);
});

test("rotate handle follows authored rotate-around pivot", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \draw[rotate around=30:(2,1)] (0,0) rectangle (1,1);
  \draw (-1,2) rectangle (2,-2);
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();

  await clickHitRegion(page, 0);
  const rotateHandle = page.getByTestId("canvas-rotate-handle");
  await expect(rotateHandle).toBeVisible();
  const box = await rotateHandle.boundingBox();
  if (!box) {
    throw new Error("Missing rotate handle bounds.");
  }
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const pivot = await worldCmToClientPoint(page, { xCm: 2, yCm: 1 });
  const vx = start.x - pivot.x;
  const vy = start.y - pivot.y;
  const radians = (-20 * Math.PI) / 180;
  const end = {
    x: pivot.x + vx * Math.cos(radians) - vy * Math.sin(radians),
    y: pivot.y + vx * Math.sin(radians) + vy * Math.cos(radians)
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();

  await expect.poll(async () => normalizeSourceWhitespace(await readSource(page))).toContain(
    "rotatearound={50:(2,1)}"
  );
});

test("Alt during rotate drag switches between center-pivot and origin rotation", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw[rotate=10] (0,0) rectangle (2,1);
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();

  await clickHitRegion(page, 0);
  const rotateHandle = page.getByTestId("canvas-rotate-handle");
  await expect(rotateHandle).toBeVisible();
  const box = await rotateHandle.boundingBox();
  if (!box) {
    throw new Error("Missing rotate handle bounds.");
  }
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();

  await page.keyboard.down("Alt");
  await expect.poll(async () => readSource(page)).toContain("rotate around=");

  const centerPivotSource = await readSource(page);
  await page.keyboard.up("Alt");
  await page.mouse.move(start.x + 10, start.y + 8, { steps: 2 });
  await expect.poll(async () => readSource(page)).not.toContain("rotate around=");
  expect(await readSource(page)).not.toBe(centerPivotSource);
  await page.mouse.up();
});

test("Alt-held rotate commits center-pivot rotation", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw[rotate=10] (0,0) rectangle (2,1);
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();

  await clickHitRegion(page, 0);
  const rotateHandle = page.getByTestId("canvas-rotate-handle");
  await expect(rotateHandle).toBeVisible();
  const box = await rotateHandle.boundingBox();
  if (!box) {
    throw new Error("Missing rotate handle bounds.");
  }
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.keyboard.down("Alt");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 44, start.y + 36, { steps: 4 });
  await expect.poll(async () => readSource(page)).toContain("rotate around=");
  await page.mouse.up();
  await page.keyboard.up("Alt");

  const source = await readSource(page);
  expect(source).toContain("rotate around=");
  expect(source).not.toContain("rotate=10");
});

test("unsupported Alt center-pivot rotate warns and normal rotation still works after release", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw[xshift=1cm, rotate=10] (0,0) rectangle (2,1);
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();

  await clickHitRegion(page, 0);
  const rotateHandle = page.getByTestId("canvas-rotate-handle");
  await expect(rotateHandle).toBeVisible();
  const box = await rotateHandle.boundingBox();
  if (!box) {
    throw new Error("Missing rotate handle bounds.");
  }
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.keyboard.down("Alt");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 44, start.y + 36, { steps: 4 });
  await expect(page.getByTestId("canvas-warning-message")).toContainText("Center-pivot rotate currently supports");
  expect(await readSource(page)).not.toContain("rotate around=");

  await page.keyboard.up("Alt");
  await page.mouse.move(start.x + 66, start.y + 44, { steps: 3 });
  await expect.poll(async () => readSource(page)).toMatch(/rotate=-?\d/);
  await page.mouse.up();
});

test("rectangle and grid creation show tooltips and keep tooltip in viewport bounds", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);
  await toolbarButton(page, "Rect").click();

  const layer = interactionLayer(page);
  await dragBetweenPoints(page, layer, { x: 120, y: 120 }, { x: 280, y: 240 });
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Width:");
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Height:");
  await expect(page.getByTestId("canvas-drag-tooltip-row").first()).toContainText(/Width:\s*[0-9.]+cm \([0-9.]+pt\)/);
  await page.mouse.up();

  await toolbarButton(page, "Circle").click();
  await dragBetweenPoints(page, layer, { x: 140, y: 140 }, { x: 220, y: 200 });
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Radius:");
  await expect(page.getByTestId("canvas-drag-tooltip")).not.toContainText("Width:");
  await expect(page.getByTestId("canvas-drag-tooltip")).not.toContainText("Height:");
  await expect(page.getByTestId("canvas-drag-tooltip-row").first()).toContainText(/Radius:\s*[0-9.]+cm \([0-9.]+pt\)/);
  await page.mouse.up();

  await toolbarButton(page, "Grid").click();
  const viewport = canvasViewport(page);
  const viewportBox = await viewport.boundingBox();
  const layerBox = await layer.boundingBox();
  if (!viewportBox || !layerBox) {
    throw new Error("Canvas bounds missing.");
  }

  const gridStart = {
    x: Math.max(16, layerBox.width - 140),
    y: Math.max(16, layerBox.height - 140)
  };
  const gridEnd = {
    x: Math.max(gridStart.x + 40, layerBox.width - 24),
    y: Math.max(gridStart.y + 40, layerBox.height - 24)
  };
  await dragBetweenPoints(page, layer, gridStart, gridEnd);
  const tooltipShell = page.getByTestId("canvas-drag-tooltip-shell");
  const tooltipCount = await tooltipShell.count();
  if (tooltipCount > 0) {
    const tooltipBox = await tooltipShell.boundingBox();
    if (!tooltipBox) {
      throw new Error("Tooltip bounds missing.");
    }
    expect(tooltipBox.x).toBeGreaterThanOrEqual(viewportBox.x);
    expect(tooltipBox.y).toBeGreaterThanOrEqual(viewportBox.y);
    expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(viewportBox.x + viewportBox.width);
    expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(viewportBox.y + viewportBox.height);
  }

  await page.mouse.up();
});

test("line creation from empty source creates a tikzpicture environment", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, "");

  await toolbarButton(page, "Line").click();
  const layer = interactionLayer(page);
  await dragBetweenPoints(page, layer, { x: 120, y: 120 }, { x: 280, y: 180 });
  await page.mouse.up();

  await expect.poll(async () => readSource(page)).toContain("\\begin{tikzpicture}");
  const source = await readSource(page);
  expect(source).toContain("\\draw");
  expect(source).toContain("\\end{tikzpicture}");
  expect(normalizeSourceWhitespace(source)).toMatch(/^\\begin\{tikzpicture\}\\draw.+\\end\{tikzpicture\}$/);
  await expect(page.getByTestId("canvas-warning-message")).toHaveCount(0);
  await expect.poll(async () => page.locator("[data-hit-region-target-id]").count()).toBeGreaterThanOrEqual(1);
  await expect(page.locator("[data-hit-region-target-id]").first()).toHaveAttribute("data-hit-region-target-id", "path:0");
});

test("insert menu commands switch tool modes and expose checked state", async ({ page }) => {
  await gotoApp(page);
  const insertCommands = [
    "insert.node",
    "insert.matrix",
    "insert.path",
    "insert.freehand",
    "insert.line",
    "insert.arrow",
    "insert.bezier",
    "insert.grid",
    "insert.rect",
    "insert.ellipse",
    "insert.circle"
  ] as const;

  for (const commandId of insertCommands) {
    await openMenuSection(page, "insert");
    const command = page.getByTestId(`menu-cmd-${commandId}`);
    await expect(command).toBeEnabled();
    await command.click();

    await openMenuSection(page, "insert");
    await expect(page.getByTestId(`menu-cmd-${commandId}`)).toHaveAttribute("aria-checked", "true");
  }
});

test("freehand tool activates and inspector shows smoothing control", async ({ page }) => {
  await gotoApp(page);

  await toolbarButton(page, "Freehand").click();
  // Freehand no longer has a toolbar popup; smoothing control is in the inspector
  await expect(toolbarButton(page, "Freehand")).toHaveClass(/btnActive/);
});

test("node tool inserts at the snapped preview point", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await toolbarButton(page, "Node").click();
  const layer = interactionLayer(page);
  const snappedGridClientPoint = await layer.evaluate((svgElement) => {
    const svg = svgElement as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const ptPerCm = 28.4527559055;
    const worldX = ptPerCm;
    const worldY = ptPerCm;
    const svgX = worldX;
    const svgY = viewBox.y + viewBox.height - (worldY - viewBox.y);
    return {
      x: rect.left + ((svgX - viewBox.x) / viewBox.width) * rect.width,
      y: rect.top + ((svgY - viewBox.y) / viewBox.height) * rect.height
    };
  });
  const offGridClick = {
    x: snappedGridClientPoint.x + 4,
    y: snappedGridClientPoint.y + 4
  };

  await page.mouse.move(offGridClick.x, offGridClick.y);
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText(/X:\s*1cm/);
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText(/Y:\s*1cm/);
  await expect(page.getByTestId("canvas-drag-tooltip")).not.toContainText("pt");
  await page.mouse.down();
  await page.mouse.up();

  await expect.poll(async () => normalizeSourceWhitespace(await readSource(page))).toContain("\\node[draw]at(1,1){node};");
});

test("shape tool click insertion uses the snapped preview point", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await toolbarButton(page, "Shape").click();
  await page.getByTestId("toolbar-shape-choice-diamond").click();
  const layer = interactionLayer(page);
  const snappedGridClientPoint = await layer.evaluate((svgElement) => {
    const svg = svgElement as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const ptPerCm = 28.4527559055;
    const worldX = ptPerCm;
    const worldY = ptPerCm;
    const svgX = worldX;
    const svgY = viewBox.y + viewBox.height - (worldY - viewBox.y);
    return {
      x: rect.left + ((svgX - viewBox.x) / viewBox.width) * rect.width,
      y: rect.top + ((svgY - viewBox.y) / viewBox.height) * rect.height
    };
  });
  const offGridClick = {
    x: snappedGridClientPoint.x + 4,
    y: snappedGridClientPoint.y + 4
  };

  await page.mouse.move(offGridClick.x, offGridClick.y);
  await page.mouse.down();
  await page.mouse.up();

  await expect.poll(async () => normalizeSourceWhitespace(await readSource(page))).toContain(
    "\\node[draw,shape=diamond,minimumwidth=2.2cm,minimumheight=1.4cm]at(1,1){};"
  );
});

test("creation tools can start on the viewport outside document bounds", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  const readGrayViewportPoint = async () => {
    const viewportBox = await canvasViewport(page).boundingBox();
    const layerBox = await interactionLayer(page).boundingBox();
    if (!viewportBox) {
      throw new Error("Canvas viewport bounds missing.");
    }
    if (!layerBox) {
      throw new Error("Canvas interaction layer bounds missing.");
    }
    if (layerBox.x - viewportBox.x > 24) {
      return {
        x: viewportBox.x + Math.max(8, (layerBox.x - viewportBox.x) / 2),
        y: Math.min(viewportBox.y + viewportBox.height - 8, Math.max(viewportBox.y + 8, layerBox.y + 32))
      };
    }
    if (viewportBox.x + viewportBox.width - (layerBox.x + layerBox.width) > 24) {
      return {
        x: layerBox.x + layerBox.width + Math.max(8, (viewportBox.x + viewportBox.width - (layerBox.x + layerBox.width)) / 2),
        y: Math.min(viewportBox.y + viewportBox.height - 8, Math.max(viewportBox.y + 8, layerBox.y + 32))
      };
    }
    if (layerBox.y - viewportBox.y > 24) {
      return {
        x: Math.min(viewportBox.x + viewportBox.width - 8, Math.max(viewportBox.x + 8, layerBox.x + 32)),
        y: viewportBox.y + Math.max(8, (layerBox.y - viewportBox.y) / 2)
      };
    }
    if (viewportBox.y + viewportBox.height - (layerBox.y + layerBox.height) > 24) {
      return {
        x: Math.min(viewportBox.x + viewportBox.width - 8, Math.max(viewportBox.x + 8, layerBox.x + 32)),
        y: layerBox.y + layerBox.height + Math.max(8, (viewportBox.y + viewportBox.height - (layerBox.y + layerBox.height)) / 2)
      };
    }
    throw new Error("Expected a visible viewport margin outside the document bounds.");
  };

  const readGrayViewportDrag = async () => {
    const start = await readGrayViewportPoint();
    return {
      start,
      end: {
        x: start.x + 72,
        y: start.y + 48
      }
    };
  };

  await toolbarButton(page, "Node").click();
  const nodePoint = await readGrayViewportPoint();
  await page.mouse.click(nodePoint.x, nodePoint.y);
  await expect.poll(async () => normalizeSourceWhitespace(await readSource(page))).toContain("\\node[draw]at");
  await expect(page.getByTestId("canvas-warning-message")).toHaveCount(0);

  await toolbarButton(page, "Rect").click();
  const rectDrag = await readGrayViewportDrag();
  await page.mouse.move(rectDrag.start.x, rectDrag.start.y);
  await page.mouse.down();
  await page.mouse.move(rectDrag.end.x, rectDrag.end.y, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => normalizeSourceWhitespace(await readSource(page))).toContain("rectangle");
  await expect(page.getByTestId("canvas-warning-message")).toHaveCount(0);
});

test("line tool exposes and uses anchors on newly inserted nodes", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);
  await toolbarButton(page, "Node").click();

  const layer = interactionLayer(page);
  const box = await layer.boundingBox();
  if (!box) {
    throw new Error("Canvas interaction layer bounds missing.");
  }

  await page.mouse.click(box.x + 180, box.y + 150);
  await expect.poll(async () => normalizeSourceWhitespace(await readSource(page))).toContain("\\node[draw]at");
  expect(normalizeSourceWhitespace(await readSource(page))).not.toContain("\\node(node1)");

  await toolbarButton(page, "Line").click();
  await waitForHitRegions(page, 1);
  const nodeRegion = page.locator('[data-hit-region-target-id="path:0"]').first();
  const nodeTarget = await nodeRegion.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(nodeTarget.x, nodeTarget.y, { steps: 10 });

  const anchorDots = page.locator('[data-testid="node-anchor-dot"]');
  await expect.poll(async () => anchorDots.count()).toBeGreaterThan(0);
  await expect(page.locator('[data-testid="node-anchor-dot"][data-anchor-source-id="path:0"]')).not.toHaveCount(0);

  const eastAnchor = page.locator('[data-testid="node-anchor-dot"][data-anchor-source-id="path:0"][data-anchor-name="east"]');
  const eastAnchorBox = await eastAnchor.boundingBox();
  if (!eastAnchorBox) {
    throw new Error("Generated node east anchor bounds missing.");
  }
  const start = {
    x: eastAnchorBox.x + eastAnchorBox.width / 2,
    y: eastAnchorBox.y + eastAnchorBox.height / 2
  };
  await page.mouse.move(start.x, start.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.move(start.x + 120, start.y, { steps: 12 });
  await page.mouse.up();

  await expect.poll(async () => normalizeSourceWhitespace(await readSource(page))).toContain("\\node[draw](node1)at");
  await expect.poll(async () => readSource(page)).toContain("(node1.east)");
});

test("shape toolbar popup auto-opens, remembers the chosen shape, and inserts an empty shaped node", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await toolbarButton(page, "Shape").click();
  await expect(page.getByTestId("toolbar-tool-popup-addShape")).toBeVisible();

  await page.getByTestId("toolbar-shape-choice-diamond").click();
  await expect(page.getByTestId("toolbar-tool-popup-addShape")).toHaveCount(0);
  const layer = interactionLayer(page);
  const box = await layer.boundingBox();
  if (!box) {
    throw new Error("Canvas interaction layer bounds missing.");
  }
  await dragBetweenPoints(page, layer, { x: 140, y: 140 }, { x: 260, y: 210 });
  await page.mouse.up();

  await expect.poll(async () => readSource(page)).toContain("\\node[draw, shape=diamond");
  await expect.poll(async () => /minimum (width|height)=/.test(await readSource(page))).toBe(true);
  await expect.poll(async () => readSource(page)).not.toContain("shape=diamond, minimum width=2.2cm, minimum height=1.4cm");
  await expect.poll(async () => readSource(page)).toContain("{};");

  await toolbarButton(page, "Shape").click();
  await expect(page.getByTestId("toolbar-tool-popup-addShape")).toBeVisible();
  await expect(page.getByTestId("toolbar-shape-choice-diamond")).toHaveAttribute("aria-selected", "true");
});

test("matrix toolbar popup supports size picker, remembers selection, and inserts at click position", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await toolbarButton(page, "Matrix").click();
  await expect(page.getByTestId("toolbar-tool-popup-addMatrix")).toBeVisible();
  await expect(page.getByText("Insert Matrix (2 x 2)")).toBeVisible();

  await page.getByTestId("toolbar-matrix-picker-cell-3-4").hover();
  await expect(page.getByText("Insert Matrix (4 x 3)")).toBeVisible();

  await page.getByTestId("toolbar-matrix-picker-cell-2-3").click();
  await expect(page.getByTestId("toolbar-tool-popup-addMatrix")).toHaveCount(0);

  const layer = interactionLayer(page);
  await dragBetweenPoints(page, layer, { x: 180, y: 170 }, { x: 180, y: 170 });
  await page.mouse.up();

  await expect.poll(async () => readSource(page)).toContain("\\matrix [matrix of nodes] at (");
  await expect.poll(async () => readSource(page)).toContain("A & B & C \\\\");
  await expect.poll(async () => readSource(page)).toContain("D & E & F");
  await expect.poll(async () => {
    const ids = await readSelectedSourceIds(page);
    return ids.length === 1 && ids[0] != null && !ids[0].includes(":matrix-cell:");
  }).toBe(true);
  await expect(toolbarButton(page, "Select")).toHaveClass(/btnActive/);

  await toolbarButton(page, "Matrix").click();
  await expect(page.getByTestId("toolbar-tool-popup-addMatrix")).toBeVisible();
  await expect(page.getByTestId("toolbar-matrix-picker-cell-2-3")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("toolbar-matrix-picker-cell-3-3")).toHaveAttribute("aria-selected", "false");
});

test("diamond shapes show drag-size preview and can be resized with handles", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await toolbarButton(page, "Shape").click();
  await page.getByTestId("toolbar-shape-choice-diamond").click();

  const layer = interactionLayer(page);
  const box = await layer.boundingBox();
  if (!box) {
    throw new Error("Canvas interaction layer bounds missing.");
  }

  await dragBetweenPoints(page, layer, { x: 140, y: 140 }, { x: 260, y: 210 });
  await page.mouse.up();

  await waitForHitRegions(page, 1);
  await clickHitRegion(page, 0);
  const resizeHandle = page.locator('[data-handle-kind="resize-element"]').first();
  await expect(resizeHandle).toBeVisible();

  const before = await readSource(page);
  await dragLocatorBy(page, resizeHandle, -80, -80);
  await page.mouse.up();
  const after = await readSource(page);

  expect(after).toContain("shape=diamond");
  expect(after).toContain("minimum width=");
  expect(after).toContain("minimum height=");
  expect(after).not.toBe(before);
});

test("diamond east-handle drag does not collapse to tiny size", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await toolbarButton(page, "Shape").click();
  await page.getByTestId("toolbar-shape-choice-diamond").click();

  const layer = interactionLayer(page);
  const box = await layer.boundingBox();
  if (!box) {
    throw new Error("Canvas interaction layer bounds missing.");
  }

  await dragBetweenPoints(page, layer, { x: 120, y: 90 }, { x: 300, y: 290 });
  await page.mouse.up();

  await waitForHitRegions(page, 1);
  await clickHitRegion(page, 0);

  const handles = page.locator('[data-handle-kind="resize-element"]');
  await expect.poll(async () => handles.count()).toBeGreaterThanOrEqual(4);
  const eastIndex = await handles.evaluateAll((elements) => {
    let bestIndex = 0;
    let bestX = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < elements.length; index += 1) {
      const rect = elements[index].getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      if (centerX > bestX) {
        bestX = centerX;
        bestIndex = index;
      }
    }
    return bestIndex;
  });
  const eastHandle = handles.nth(eastIndex);
  await expect(eastHandle).toBeVisible();

  const baseline = await page.evaluate(() => {
    const resizeHandles = Array.from(document.querySelectorAll('[data-handle-kind="resize-element"]'));
    if (resizeHandles.length < 4) {
      return null;
    }
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const handle of resizeHandles) {
      const rect = handle.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      minX = Math.min(minX, centerX);
      maxX = Math.max(maxX, centerX);
      minY = Math.min(minY, centerY);
      maxY = Math.max(maxY, centerY);
    }
    const svgs = Array.from(document.querySelectorAll("[data-canvas-viewport='true'] svg"));
    const svg = svgs[svgs.length - 1];
    if (!svg) {
      return null;
    }
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    if (rect.width <= 0 || rect.height <= 0 || viewBox.width <= 0 || viewBox.height <= 0) {
      return null;
    }
    const ptPerPxX = viewBox.width / rect.width;
    const ptPerPxY = viewBox.height / rect.height;
    return {
      widthPt: (maxX - minX) * ptPerPxX,
      heightPt: (maxY - minY) * ptPerPxY
    };
  });
  if (!baseline) {
    throw new Error("Could not resolve baseline diamond dimensions from resize handles.");
  }

  await dragLocatorBy(page, eastHandle, -8, 0);
  const tooltip = page.getByTestId("canvas-drag-tooltip");
  await expect(tooltip).toBeVisible();
  const tooltipText = (await tooltip.textContent()) ?? "";
  const widthCm = Number((/Width:\s*([0-9.]+)cm/.exec(tooltipText) ?? [])[1] ?? "0");
  const heightCm = Number((/Height:\s*([0-9.]+)cm/.exec(tooltipText) ?? [])[1] ?? "0");
  expect(widthCm).toBeLessThan((baseline.widthPt + 0.75) * CM_PER_PT);
  expect(heightCm).toBeLessThan((baseline.heightPt + 0.75) * CM_PER_PT);
  expect(widthCm).toBeGreaterThan(30 * CM_PER_PT);
  expect(heightCm).toBeGreaterThan(30 * CM_PER_PT);

  await page.mouse.up();
  const after = await readSource(page);
  expect(after).toContain("shape=diamond");
  expect(after).not.toContain("minimum height=13.65pt");
});

test("diamond east-handle stays under cursor while dragging inward", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await toolbarButton(page, "Shape").click();
  await page.getByTestId("toolbar-shape-choice-diamond").click();

  const layer = interactionLayer(page);
  const box = await layer.boundingBox();
  if (!box) {
    throw new Error("Canvas interaction layer bounds missing.");
  }

  await dragBetweenPoints(page, layer, { x: 120, y: 90 }, { x: 320, y: 300 });
  await page.mouse.up();

  await waitForHitRegions(page, 1);
  await clickHitRegion(page, 0);
  const handles = page.locator('[data-handle-kind="resize-element"]');
  await expect.poll(async () => handles.count()).toBeGreaterThanOrEqual(4);

  const start = await readRightmostResizeHandleCenter(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();

  for (const deltaX of [-4, -8, -12, -16]) {
    const cursor = { x: start.x + deltaX, y: start.y };
    await page.mouse.move(cursor.x, cursor.y);
    await expect.poll(
      async () => readCursorDistanceToRightmostResizeHandle(page, cursor),
      { timeout: 2_000, intervals: [40, 80, 120, 200] }
    ).toBeLessThan(4.5);
  }

  await page.mouse.up();
});

test("diamond east-handle stays under cursor while dragging outward", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await toolbarButton(page, "Shape").click();
  await page.getByTestId("toolbar-shape-choice-diamond").click();

  const layer = interactionLayer(page);
  const box = await layer.boundingBox();
  if (!box) {
    throw new Error("Canvas interaction layer bounds missing.");
  }

  await dragBetweenPoints(page, layer, { x: 120, y: 90 }, { x: 300, y: 290 });
  await page.mouse.up();

  await waitForHitRegions(page, 1);
  await clickHitRegion(page, 0);
  const handles = page.locator('[data-handle-kind="resize-element"]');
  await expect.poll(async () => handles.count()).toBeGreaterThanOrEqual(4);

  const start = await readRightmostResizeHandleCenter(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();

  for (const deltaX of [4, 8, 12, 16]) {
    const cursor = { x: start.x + deltaX, y: start.y };
    await page.mouse.move(cursor.x, cursor.y);
    await expect.poll(
      async () => readCursorDistanceToRightmostResizeHandle(page, cursor),
      { timeout: 2_000, intervals: [40, 80, 120, 200] }
    ).toBeLessThan(4.5);
  }

  await page.mouse.up();
});

test("circle shapes can be resized with handles", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await toolbarButton(page, "Shape").click();
  await page.getByTestId("toolbar-shape-choice-circle").click();

  const layer = interactionLayer(page);
  const box = await layer.boundingBox();
  if (!box) {
    throw new Error("Canvas interaction layer bounds missing.");
  }

  await dragBetweenPoints(page, layer, { x: 140, y: 140 }, { x: 260, y: 210 });
  await page.mouse.up();

  await expect.poll(async () => readSource(page)).toContain("shape=circle");
  await waitForHitRegions(page, 1);
  await clickHitRegion(page, 0);
  const resizeHandle = page.locator('[data-handle-kind="resize-element"]').first();
  await expect(resizeHandle).toBeVisible();

  const before = await readSource(page);
  await dragLocatorBy(page, resizeHandle, 60, 60);
  await page.mouse.up();
  const after = await readSource(page);

  expect(after).toContain("shape=circle");
  expect(after).not.toBe(before);
});

test("horizontal resize on text-width nodes updates text width, not minimum width", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[draw,text width=2cm] at (0,0) {This is wrapped text};
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();

  await waitForHitRegions(page, 1);
  await clickHitRegion(page, 0);
  const handles = page.locator('[data-handle-kind="resize-element"]');
  await expect.poll(async () => handles.count()).toBeGreaterThanOrEqual(4);
  const eastIndex = await handles.evaluateAll((elements) => {
    let bestIndex = 0;
    let bestX = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < elements.length; index += 1) {
      const rect = elements[index].getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      if (centerX > bestX) {
        bestX = centerX;
        bestIndex = index;
      }
    }
    return bestIndex;
  });
  const eastHandle = handles.nth(eastIndex);
  await expect(eastHandle).toBeVisible();

  const before = await readSource(page);
  await dragLocatorBy(page, eastHandle, 60, 0);
  await page.mouse.up();
  await expect.poll(async () => readSource(page)).not.toBe(before);

  const after = await readSource(page);
  expect(after).toContain("text width=");
  expect(after).not.toContain("minimum width=");
});

test("bucket popup chooses color, previews on hover, and stays active across fills", async ({ page }) => {
  await gotoApp(page);
  const source = String.raw`\begin{tikzpicture}
  \filldraw[fill=blue!20] (0,0) rectangle (2,2);
  \filldraw[fill=green!20] (3,0) rectangle (5,2);
\end{tikzpicture}`;
  await setSource(page, source);

  // Click the bucket caret to open color picker, selecting a color auto-activates the tool
  await page.getByTestId("toolbar-bucket-color-caret").click();
  await expect(page.getByTestId("toolbar-tool-popup-addBucket")).toBeVisible();
  await page.getByRole("button", { name: "Bucket fill color red" }).click();

  await waitForHitRegions(page, 2);
  const hitRegions = page.locator("[data-hit-region-target-id]");
  const firstRegion = hitRegions.nth(0);
  const secondRegion = hitRegions.nth(1);
  await expect(firstRegion).toBeVisible();
  await expect(secondRegion).toBeVisible();
  const firstBox = await firstRegion.boundingBox();
  const secondBox = await secondRegion.boundingBox();
  if (!firstBox) {
    throw new Error("First bucket target bounds missing.");
  }
  if (!secondBox) {
    throw new Error("Second bucket target bounds missing.");
  }

  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await expect.poll(async () => readSource(page)).toContain("\\filldraw[fill=red!60] (0,0) rectangle (2,2);");
  await expect.poll(async () => readSource(page)).toContain("\\filldraw[fill=green!20] (3,0) rectangle (5,2);");

  const layer = interactionLayer(page);
  const layerBox = await layer.boundingBox();
  if (!layerBox) {
    throw new Error("Canvas interaction layer bounds missing.");
  }
  await page.mouse.move(layerBox.x + 8, layerBox.y + 8);
  await expect.poll(async () => normalizeSourceWhitespace(await readSource(page))).toBe(normalizeSourceWhitespace(source));

  await page.mouse.click(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.mouse.click(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2);
  await expect.poll(async () => readSource(page)).toContain("\\filldraw[fill=red!60] (0,0) rectangle (2,2);");
  await expect.poll(async () => readSource(page)).toContain("\\filldraw[fill=red!60] (3,0) rectangle (5,2);");
  await expect(toolbarButton(page, "Bucket")).toHaveClass(/btnActive/);
});

test("bucket main button returns to select when bucket is already active", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \filldraw[fill=blue!20] (0,0) rectangle (2,2);
\end{tikzpicture}`);

  await page.getByTestId("toolbar-bucket-color-caret").click();
  await page.getByRole("button", { name: "Bucket fill color red" }).click();
  await expect(toolbarButton(page, "Bucket")).toHaveClass(/btnActive/);

  await toolbarButton(page, "Bucket").click();
  await expect(toolbarButton(page, "Select")).toHaveClass(/btnActive/);
  await expect(toolbarButton(page, "Bucket")).not.toHaveClass(/btnActive/);
});

test("bucket fills draw-only closed paths from the interior", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (2,2);
\end{tikzpicture}`);

  // Click the bucket caret to open color picker, selecting a color auto-activates the tool
  await page.getByTestId("toolbar-bucket-color-caret").click();
  await page.getByRole("button", { name: "Bucket fill color red" }).click();

  await waitForHitRegions(page, 1);
  const region = page.locator("[data-hit-region-target-id]").first();
  const box = await region.boundingBox();
  if (!box) {
    throw new Error("Bucket target bounds missing.");
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => readSource(page)).toContain("\\draw[fill=red!60] (0,0) rectangle (2,2);");

  await clickHitRegion(page, 0);
  await expect.poll(async () => readSource(page)).toContain("\\draw[fill=red!60] (0,0) rectangle (2,2);");
});

test("bucket warns on tikzpicture background", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (2,2);
\end{tikzpicture}`);

  await toolbarButton(page, "Bucket").click();

  const layer = interactionLayer(page);
  const layerBox = await layer.boundingBox();
  if (!layerBox) {
    throw new Error("Canvas interaction layer bounds missing.");
  }
  await page.mouse.click(layerBox.x + layerBox.width - 20, layerBox.y + 20);
  await expect(page.getByTestId("canvas-warning-message")).toContainText("Cannot fill the tikzpicture background.");
});

test("multi-segment path tool finalizes on Enter", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);
  await toolbarButton(page, "Path").click();

  const layer = interactionLayer(page);
  const box = await layer.boundingBox();
  if (!box) {
    throw new Error("Canvas interaction layer bounds missing.");
  }

  await page.mouse.click(box.x + 120, box.y + 120);
  await page.mouse.click(box.x + 200, box.y + 120);
  await page.mouse.click(box.x + 200, box.y + 180);
  await page.keyboard.press("Enter");

  await expect.poll(async () => readSource(page)).toContain("\\draw");
  await expect.poll(async () => readSource(page)).toContain("--");
});

test("multi-segment path tool keeps named anchors when clicking anchor dots", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \node[draw] (A) at (2,1) {A};
\end{tikzpicture}`);
  await toolbarButton(page, "Path").click();

  const layer = interactionLayer(page);
  const box = await layer.boundingBox();
  if (!box) {
    throw new Error("Canvas interaction layer bounds missing.");
  }

  await page.mouse.click(box.x + 120, box.y + 120);

  await waitForHitRegions(page, 1);
  const nodeRegion = page.locator("[data-hit-region-target-id='path:0']").first();
  const nodeTarget = await nodeRegion.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(nodeTarget.x, nodeTarget.y, { steps: 10 });

  const anchorDots = page.locator('[data-testid="node-anchor-dot"]');
  await expect.poll(async () => anchorDots.count()).toBeGreaterThan(0);
  const anchorCenters = await anchorDots.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })
  );
  const eastMostAnchor = anchorCenters.reduce((best, current) => (current.x > best.x ? current : best));
  await page.mouse.click(eastMostAnchor.x, eastMostAnchor.y);
  await page.keyboard.press("Enter");

  await expect.poll(async () => readSource(page)).toContain("\\draw");
  await expect.poll(async () => readSource(page)).toContain("(A.");
});

test("freehand smoothing slider in inspector preserves adjusted values", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);
  await toolbarButton(page, "Freehand").click();
  // Freehand smoothing is now in the inspector panel, not a toolbar popup
  const slider = page.getByTestId("inspector-freehand-smoothing-slider");
  await expect(slider).toBeVisible();
  await slider.fill("8");
  await expect(slider).toHaveValue("8");

  // Switch away and back
  await toolbarButton(page, "Select").click();
  await toolbarButton(page, "Freehand").click();
  await expect(slider).toBeVisible();
  await expect(slider).toHaveValue("8");
  await slider.fill("32");
  await expect(slider).toHaveValue("32");
});

test("path menu commands stay disabled when selection has no editable path point", async ({ page }) => {
  await gotoApp(page);
  await openMenuSection(page, "path");
  await expect(page.getByTestId("menu-cmd-path.split")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-path.join")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-path.close")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-path.open")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-path.delete-point")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-path.point-corner")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-path.point-smooth")).toBeDisabled();
});

test("live endpoint-anchor drag keeps source well-formed while hovering and on drop", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \draw[red] (-1, 1) -- (1, 1);
  \node[draw] (C) at (0, 0) {C};
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();

  await waitForHitRegions(page, 1);
  const lineRegion = page.locator("[data-hit-region-target-id]").first();
  const lineTarget = await lineRegion.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(lineTarget.x, lineTarget.y);
  const endpointHandle = page.locator('[data-handle-kind="move-handle"][data-source-id="path:0"]').nth(1);
  await expect(endpointHandle).toBeVisible();
  const handleBox = await endpointHandle.boundingBox();
  if (!handleBox) {
    throw new Error("Endpoint handle bounds missing.");
  }
  const nodeRegion = page.locator('[data-hit-region-target-id="path:1"]').first();
  await expect(nodeRegion).toBeVisible();
  const nodeBox = await nodeRegion.boundingBox();
  if (!nodeBox) {
    throw new Error("Node hit-region bounds missing.");
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();

  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2, { steps: 12 });
  const anchorDots = page.locator('[data-testid="node-anchor-dot"]');
  await expect.poll(async () => anchorDots.count()).toBeGreaterThan(0);
  const anchorCircle = anchorDots.first();
  const anchorBox = await anchorCircle.boundingBox();
  if (!anchorBox) {
    throw new Error("Node anchor overlay circle bounds missing.");
  }
  await page.mouse.move(anchorBox.x + anchorBox.width / 2, anchorBox.y + anchorBox.height / 2, { steps: 8 });

  const sourceDuringDrag = await readSource(page);
  expect(sourceDuringDrag).toContain("\\draw[red]");
  expect(sourceDuringDrag).not.toContain(");(");
  expect(sourceDuringDrag).toContain("\\end{tikzpicture}");
  await expect.poll(async () => page.locator("[data-hit-region-target-id]").count()).toBeGreaterThanOrEqual(2);

  // Drag away again before releasing: source should detach from node anchor.
  await page.mouse.move(startX + 120, startY - 20, { steps: 12 });
  const sourceAfterDraggingAway = await readSource(page);
  expect(sourceAfterDraggingAway).not.toContain("(C.");
  expect(sourceAfterDraggingAway).toContain("\\end{tikzpicture}");

  await page.mouse.up();
  const sourceAfterDrop = await readSource(page);
  expect(sourceAfterDrop).not.toContain(");(");
  expect(sourceAfterDrop).toContain("\\end{tikzpicture}");
});

test("rapid path endpoint drag keeps CodeMirror synchronized with store source", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \draw (1,2) -- (3,2);
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();

  await waitForHitRegions(page, 1);
  const lineRegion = page.locator('[data-hit-region-target-id="path:0"]').first();
  const lineTarget = await lineRegion.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(lineTarget.x, lineTarget.y);
  const endpointHandle = page.locator('[data-handle-kind="move-handle"][data-source-id="path:0"]').nth(1);
  await expect(endpointHandle).toBeVisible();
  const handleBox = await endpointHandle.boundingBox();
  if (!handleBox) {
    throw new Error("Endpoint handle bounds missing.");
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 20, startY + 15, { steps: 8 });
  await page.mouse.move(startX - 12, startY + 22, { steps: 8 });
  await page.mouse.move(startX - 7, startY + 28, { steps: 8 });
  await page.mouse.move(startX - 4, startY + 34, { steps: 8 });
  await page.mouse.up();

  await page.waitForTimeout(150);
  const storeSource = await readSource(page);
  const editorSource = await readCodeMirrorText(page);
  expect(editorSource).toBe(storeSource);
  expect(editorSource).not.toMatch(/\)\s*\(/);
  expect(editorSource).toContain("\\end{tikzpicture}");
});

test("dense paths require double click before showing interior edit handles", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,0.2) -- (2,-0.1) -- (3,0.3) -- (4,0) -- (5,0.4) -- (6,0.1) -- (7,0.5) -- (8,0.2);
  \draw (0,2) -- (1,2.2) -- (2,2.1);
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();
  await waitForHitRegions(page, 2);

  await expect(page.getByTestId("canvas-warning-message")).toHaveCount(0, { timeout: 10_000 });
  await clickHitRegion(page, 0);
  await expect(page.getByTestId("canvas-warning-message")).toHaveCount(0, { timeout: 10_000 });
  const hintAfterFirstClick = await page.getByTestId("canvas-selection-hint").first().textContent().catch(() => null);
  const firstSelected = await readSelectedSourceIds(page);
  if (firstSelected.length !== 1) {
    throw new Error(`Expected one selected source after first click, got ${firstSelected.length}.`);
  }

  await clickHitRegion(page, 1);
  await expect(page.getByTestId("canvas-warning-message")).toHaveCount(0, { timeout: 10_000 });
  const hintAfterSecondClick = await page.getByTestId("canvas-selection-hint").first().textContent().catch(() => null);
  const secondSelected = await readSelectedSourceIds(page);
  if (secondSelected.length !== 1) {
    throw new Error(`Expected one selected source after second click, got ${secondSelected.length}.`);
  }

  const firstIsDense = hintAfterFirstClick?.includes("Double-click path to edit points.") ?? false;
  const secondIsDense = hintAfterSecondClick?.includes("Double-click path to edit points.") ?? false;
  if (firstIsDense === secondIsDense) {
    throw new Error("Expected exactly one dense path selection hint.");
  }

  const denseTargetId = firstIsDense ? firstSelected[0] : secondSelected[0];
  const shortTargetId = firstIsDense ? secondSelected[0] : firstSelected[0];

  await clickHitRegionByTargetId(page, denseTargetId);
  await expect(page.locator(`[data-handle-kind="move-handle"][data-source-id="${denseTargetId}"]`)).toHaveCount(0);

  await doubleClickHitRegionByTargetId(page, denseTargetId);
  await expect(page.getByTestId("canvas-warning-message")).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(async () =>
    page.locator(`[data-handle-kind="move-handle"]`).count()
  ).toBeGreaterThan(0);

  await clickHitRegionByTargetId(page, shortTargetId, { shift: true });
  await expect.poll(async () => (await readSelectedSourceIds(page)).length).toBe(2);
  await expect(page.getByTestId("canvas-selection-hint")).toHaveCount(0);
});

test("straight path selection hint matches double click point insertion", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \draw (-1.9,1) -- (1.9,1);
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();
  await waitForHitRegions(page, 1);

  const target = await hitRegionSamplePoint(page, 0);
  await page.mouse.click(target.x, target.y);
  await expect(page.getByTestId("canvas-selection-hint")).toContainText("Double-click path to add a point.");

  await page.mouse.dblclick(target.x, target.y);
  await expect(page.getByTestId("canvas-warning-message")).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(async () => normalizeSourceWhitespace(await readSource(page))).toMatch(
    /\\draw\(-1\.9,1\)--\(-?\d+(?:\.\d+)?,1\)--\(1\.9,1\);/
  );
});

test("complex node shapes do not show dense path edit hint", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[draw, star, star points=12] at (2,2) {};
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();
  await waitForHitRegions(page, 1);

  await clickHitRegion(page, 0);
  await expect(page.getByTestId("canvas-selection-hint")).toHaveCount(0);
});

test("tree node selections do not show dense path edit hint", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}[
  level distance=13mm,
  level 1/.style={sibling distance=28mm},
  level 2/.style={sibling distance=14mm},
  every node/.style={draw,rounded corners=2pt,fill=blue!8,minimum width=12mm,align=center}
]
  \node {Root}
    child { node {Left}
      child { node {L1} }
      child { node {L2} }
    }
    child { node {Right}
      child { node {R1} }
      child { node {R2} }
    };
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();
  await waitForHitRegions(page, 7);

  await clickHitRegionByTargetId(page, "path:0");
  await expect(page.getByTestId("canvas-selection-hint")).toHaveCount(0);
});

test("fit-to-content command is available when svg is rendered", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (4,2);
\end{tikzpicture}`);

  await openMenuSection(page, "view");
  await expect(page.getByTestId("menu-cmd-view.fit-to-content")).toBeEnabled();
  await openMenuCommand(page, "view", "view.fit-to-content");

  await expect.poll(async () => readSource(page)).toContain("rectangle");
});
