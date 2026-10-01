import { expect, test, type Page } from "@playwright/test";
import type { AppProfilingSnapshot } from "../../../packages/app/src/profiling";
import { expectSourceCanvasConsistency, gotoApp, openMenuCommand, readSource, resetStorageBeforeNavigation, setCanvasTransform, setSource, waitForHitRegions } from "./helpers";

const ptPerCm = 28.4527559055;
const pointer = { pointerId: 23, pointerType: "mouse", button: 0, buttons: 1, bubbles: true };
type TestWindow = Window & { __TIKZ_EDITOR_APP_TEST_API__: {
  selectSourceIds: (ids: string[]) => void;
  resetProfilingSession: (label: string) => void;
  getProfilingSnapshot: () => AppProfilingSnapshot;
} };

async function load(page: Page, source: string) {
  await setSource(page, source);
  await waitForHitRegions(page, 2);
  await expectSourceCanvasConsistency(page);
  await setCanvasTransform(page, { translateX: 100, translateY: 100, scale: 1 });
}
async function start(page: Page, id: string, kind = "resize-element", role = "top-right") {
  await page.evaluate(id => (window as TestWindow).__TIKZ_EDITOR_APP_TEST_API__.selectSourceIds([id]), id);
  const handle = page.locator(`[data-handle-kind="${kind}"][data-source-id="${id}"]${kind === "resize-element" ? `[data-resize-role="${role}"]` : ""}`).first();
  await expect(handle).toBeVisible();
  const position = await handle.evaluate(element => {
    const b = element.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  await handle.dispatchEvent("pointerdown", { ...pointer, clientX: position.x, clientY: position.y });
  return position;
}
async function event(page: Page, kind: "pointermove" | "pointerup", point: { x: number; y: number }, ctrlKey = false) {
  await page.evaluate(({ kind, init }) => window.dispatchEvent(new PointerEvent(kind, init)), {
    kind, init: { ...pointer, clientX: point.x, clientY: point.y, ctrlKey, buttons: kind === "pointerup" ? 0 : 1 }
  });
}

test.beforeEach(async ({ page }) => { await resetStorageBeforeNavigation(page); await gotoApp(page); });

for (const example of [
  { name: "node", body: String.raw`\draw (0,2) rectangle (2,0);\node[draw,inner sep=0,outer sep=0,minimum width=2cm,minimum height=1cm] at (4,.5) {};`, id: "path:1", dy: .94, expected: /minimum height=[\d.]+pt/ },
  { name: "circle", body: String.raw`\draw (0,3) rectangle (2,1);\draw (4,1) circle (1cm);`, id: "path:1", dy: .94, expected: /circle \(2cm\)/ },
  { name: "ellipse", body: String.raw`\draw (0,3) rectangle (2,1);\draw (4,1) ellipse (1cm and .5cm);`, id: "path:1", dy: 1.44, expected: /ellipse \(1cm and 2cm\)/ },
  { name: "scope", body: String.raw`\draw (0,3) rectangle (2,1);\begin{scope}\draw (3,2) rectangle (5,1);\end{scope}`, id: "scope:1", dy: .94, expected: /yscale=/ }
]) {
  test(`${example.name} resize snaps, keeps incremental rendering, and makes one undo step`, async ({ page }) => {
    const source = `\\begin{tikzpicture}${example.body}\\end{tikzpicture}`;
    await load(page, source);
    const initial = await start(page, example.id);
    await page.evaluate(() => (window as TestWindow).__TIKZ_EDITOR_APP_TEST_API__.resetProfilingSession("resize-other"));
    for (const dy of [example.dy * .5, example.dy * .8, example.dy]) {
      await event(page, "pointermove", { x: initial.x + .1 * ptPerCm, y: initial.y - dy * ptPerCm });
      await expectSourceCanvasConsistency(page);
    }
    await expect.poll(() => readSource(page)).toMatch(example.expected);
    if (example.name === "node") {
      const height = Number((await readSource(page)).match(/minimum height=([\d.]+)pt/)?.[1]);
      expect(height).toBeCloseTo(3 * ptPerCm, 5);
    }
    await expect(page.locator("g[class*='snapOverlay']")).toHaveCount(1);
    const profile = await page.evaluate(() => (window as TestWindow).__TIKZ_EDITOR_APP_TEST_API__.getProfilingSnapshot());
    const edits = profile.computeTimings.filter(timing => (timing.changedSourceCount ?? 0) > 0);
    expect(edits.length).toBeGreaterThan(0);
    expect(edits.every(timing => timing.incremental && timing.semanticStrategy === "incremental")).toBe(true);
    await event(page, "pointerup", { x: initial.x + .1 * ptPerCm, y: initial.y - example.dy * ptPerCm });
    await expectSourceCanvasConsistency(page, { assertNoActiveCanvasDrag: true });
    await openMenuCommand(page, "edit", "edit.undo");
    await expect.poll(() => readSource(page)).toBe(source);
  });
}

test("release consumes the final pointer even when all movement arrives in one event loop turn", async ({ page }) => {
  const source = String.raw`\begin{tikzpicture}\draw (0,3) rectangle (2,1);\draw (3,2) rectangle (5,1);\end{tikzpicture}`;
  await load(page, source);
  const initial = await start(page, "path:1");
  await page.evaluate(({ initial, pointer, ptPerCm }) => {
    for (const dy of [.3, .5, .7]) window.dispatchEvent(new PointerEvent("pointermove", {
      ...pointer, clientX: initial.x, clientY: initial.y - dy * ptPerCm
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      ...pointer, buttons: 0, clientX: initial.x, clientY: initial.y - .94 * ptPerCm
    }));
  }, { initial, pointer, ptPerCm });
  await expect.poll(() => readSource(page)).toContain("(3,3) rectangle (5,1)");
  await expectSourceCanvasConsistency(page, { assertNoActiveCanvasDrag: true });
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readSource(page)).toBe(source);
});

test("ordinary handle moves retain the latest point while recomputing", async ({ page }) => {
  const source = String.raw`\begin{tikzpicture}\draw (0,3) rectangle (2,1);\draw (3,2) -- (5,1);\end{tikzpicture}`;
  await load(page, source);
  const initial = await start(page, "path:1", "move-handle");
  await page.evaluate(({ initial, pointer, ptPerCm }) => {
    for (const dx of [.3, .4, .5]) window.dispatchEvent(new PointerEvent("pointermove", {
      ...pointer, ctrlKey: true, clientX: initial.x + dx * ptPerCm, clientY: initial.y
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      ...pointer, ctrlKey: true, buttons: 0, clientX: initial.x + .67 * ptPerCm, clientY: initial.y
    }));
  }, { initial, pointer, ptPerCm });
  await expect.poll(() => readSource(page)).toContain("(3.67,2) -- (5,1)");
  await expectSourceCanvasConsistency(page, { assertNoActiveCanvasDrag: true });
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readSource(page)).toBe(source);
});

test("endpoint targets keep their identity when connecting to an anonymous node reorders the source", async ({ page }) => {
  const source = String.raw`\begin{tikzpicture}\draw (-1,1) -- (1,1);\node[draw] at (0,0) {C};\end{tikzpicture}`;
  await load(page, source);
  const initial = await start(page, "path:0", "move-handle");
  const node = await page.locator('[data-hit-region-target-id="path:1"]').first().boundingBox();
  if (!node) throw new Error("Missing node bounds");
  const target = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
  for (let i = 0; i < 3; i++) {
    await event(page, "pointermove", target);
    await expectSourceCanvasConsistency(page);
    await expect(page.getByTestId("node-anchor-dot").first()).toBeVisible();
  }
  const connected = await readSource(page);
  expect(connected.indexOf(String.raw`\node`)).toBeLessThan(connected.indexOf(String.raw`\draw`));
  expect(connected.match(/\\node/g)).toHaveLength(1);
  await event(page, "pointermove", initial, true);
  await event(page, "pointerup", initial, true);
  await expect.poll(() => readSource(page)).toBe(source);
});

test("deferred paint cleanup completes and shares the gesture's undo step", async ({ page }) => {
  const source = String.raw`\begin{tikzpicture}\draw (0,3) rectangle (2,1);\draw[draw=none,fill=red] (3,2) rectangle (5,1);\end{tikzpicture}`;
  await load(page, source);
  const initial = await start(page, "path:1");
  const final = { x: initial.x, y: initial.y - .94 * ptPerCm };
  await event(page, "pointermove", final);
  await expectSourceCanvasConsistency(page);
  await event(page, "pointerup", final);
  await expect.poll(() => readSource(page), { timeout: 20_000 }).toContain(String.raw`\fill[red] (3,3) rectangle (5,1)`);
  await expectSourceCanvasConsistency(page, { assertNoActiveCanvasDrag: true });
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readSource(page)).toBe(source);
});

test("clicking an unaligned shape does not snap it without a drag", async ({ page }) => {
  const source = String.raw`\begin{tikzpicture}\draw (0,3) rectangle (2,1);\draw[rotate=10] (3.123,2) rectangle (5.123,1);\end{tikzpicture}`;
  await load(page, source);
  const region = page.locator("[data-hit-region-target-id='path:1']").first();
  await region.click({ force: true });
  await expectSourceCanvasConsistency(page, { assertNoActiveCanvasDrag: true });
  expect(await readSource(page)).toBe(source);
});
