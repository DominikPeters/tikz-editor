import { writeFile } from "node:fs/promises";
import type { AppProfilingSnapshot } from "../../../packages/app/src/profiling";
import { expect, test, type Page } from "@playwright/test";

import { expectSourceCanvasConsistency, gotoApp, openMenuCommand, readStoreSource, resetStorageBeforeNavigation, setSource } from "./helpers";

const PRIMARY_MOD = process.platform === "darwin" ? "Meta" : "Control";

const LAYERED = String.raw`\documentclass{beamer}
\usepackage{tikz}
\begin{document}
\begin{frame}{Layer}
A first paragraph of text.

\begin{tikzpicture}[remember picture, overlay, shift={(current page.south west)}]
  \draw[fill=orange!20] (1.2,5.5) rectangle (5.0,7.1);
  \node[anchor=north west, draw] at (8.3,7.9) {Key result};
\end{tikzpicture}
\end{frame}
\end{document}`;

const PLAIN = String.raw`\documentclass{beamer}
\usepackage{tikz}
\begin{document}
\begin{frame}{Plain}
Some text here.
\end{frame}
\end{document}`;

// The editor's drawing layer environment (BEAMER_TIKZ_LAYER_DEFINITION).
const TIKZ_LAYER_DEFINITION = String.raw`\newenvironment{tikzlayer}[1][]
  {\par\nointerlineskip\begin{tikzpicture}[remember picture, overlay, shift={(current page.south west)}, #1]}
  {\end{tikzpicture}}`;
const defined = (source: string) => source.replace("\\usepackage{tikz}\n", "\\usepackage{tikz}\n" + TIKZ_LAYER_DEFINITION + "\n");

type TestApi = {
  getCanvasTransform?: () => { translateX: number; translateY: number; scale: number };
  getSelectedSourceIds?: () => string[];
  getActiveFigureId?: () => string | null;
  getSource: () => string;
  getSnapshotSource: () => string;
  getSceneSourceIds: () => string[];
  resetProfilingSession: (label: string) => void;
  getProfilingSnapshot: () => AppProfilingSnapshot;
};

async function resetProfile(page: Page, label: string) {
  await page.evaluate(label => (window as unknown as { __TIKZ_EDITOR_APP_TEST_API__: TestApi })
    .__TIKZ_EDITOR_APP_TEST_API__.resetProfilingSession(label), label);
}

async function readProfile(page: Page) {
  return await page.evaluate(() => (window as unknown as { __TIKZ_EDITOR_APP_TEST_API__: TestApi })
    .__TIKZ_EDITOR_APP_TEST_API__.getProfilingSnapshot());
}

async function waitForSlideSnapshot(page: Page, objectCount: number) {
  await expect.poll(async () => page.evaluate(count => {
    const api = (window as unknown as { __TIKZ_EDITOR_APP_TEST_API__: TestApi }).__TIKZ_EDITOR_APP_TEST_API__;
    return api.getSnapshotSource() === api.getSource() && new Set(api.getSceneSourceIds()).size >= count;
  }, objectCount)).toBe(true);
}

async function canvasState(page: Page) {
  return await page.evaluate(() => {
    const testApi = (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__: TestApi }).__TIKZ_EDITOR_APP_TEST_API__;
    return { transform: testApi.getCanvasTransform?.(), selected: testApi.getSelectedSourceIds?.(), rootId: testApi.getActiveFigureId?.() };
  });
}

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
});

test("overlay shapes select and drag directly on the slide, and empty clicks clear selection", async ({ page }, testInfo) => {
  await setSource(page, LAYERED);
  await page.getByRole("button", { name: "1. Layer", exact: true }).click();
  const rectangle = page.locator('[data-hit-region-target-id="path:0"]').first();
  await expect(rectangle).toBeAttached({ timeout: 30_000 });
  const before = (await canvasState(page)).transform;
  const box = (await rectangle.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  const crumb = page.getByRole("button", { name: "Back to Slide 1" });
  await expect(crumb).toHaveCount(0);
  await expect(page.getByTestId("canvas-layer-backdrop")).toHaveCount(0);
  expect((await canvasState(page)).rootId).toBe("frame:0");
  await expect.poll(async () => (await canvasState(page)).selected).toEqual(["path:0"]);
  // In place: the slide stays where it was.
  expect((await canvasState(page)).transform).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath("layer-entered.png") });

  // The shape moves in page coordinates; the text does not.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => readStoreSource(page)).not.toContain("(1.2,5.5) rectangle (5.0,7.1)");
  expect(await readStoreSource(page)).toContain("A first paragraph of text.");

  // Empty slide space clears selection without changing the editing surface.
  const stage = (await page.getByTestId("canvas-world-stage").boundingBox())!;
  await page.mouse.click(stage.x + stage.width * 0.6, stage.y + stage.height * 0.85);
  await expect(crumb).toHaveCount(0);
  await expect.poll(async () => (await canvasState(page)).rootId).toBe("frame:0");
  expect((await canvasState(page)).transform).toEqual(before);
});

test("a drawing tool on a slide without a layer draws into a new one, inserted with the first shape in one undo step", async ({ page }, testInfo) => {
  await setSource(page, PLAIN);
  await page.getByRole("button", { name: "1. Plain", exact: true }).click();
  const text = page.locator('[data-hit-region-interaction-mode="text"]').first();
  await expect(text).toBeAttached({ timeout: 30_000 });
  const textBefore = await text.boundingBox();
  await page.getByRole("button", { name: "Rect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to Slide 1" })).toHaveCount(0);
  await expect.poll(async () => (await canvasState(page)).rootId).toBe("frame:0");
  expect(await readStoreSource(page)).toBe(PLAIN);

  const stage = (await page.getByTestId("canvas-world-stage").boundingBox())!;
  await page.mouse.move(stage.x + stage.width * 0.4, stage.y + stage.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width * 0.7, stage.y + stage.height * 0.8, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => readStoreSource(page)).toContain("Some text here.\n\n\\begin{tikzlayer}\n");
  const drawn = await readStoreSource(page);
  expect(drawn).toContain("\\usepackage{tikz}\n" + TIKZ_LAYER_DEFINITION + "\n");
  // The slide's text stays where it was.
  await expect.poll(async () => JSON.stringify(await text.boundingBox())).toBe(JSON.stringify(textBefore));
  // Page coordinates in cm from the lower-left corner: on the page (12.8 x 9.6 cm).
  const match = /\\draw \(([\d.]+),([\d.]+)\) rectangle \(([\d.]+),([\d.]+)\);/u.exec(drawn);
  expect(match).not.toBeNull();
  for (const [index, limit] of [[1, 12.8], [2, 9.6], [3, 12.8], [4, 9.6]] as const) {
    const value = Number(match![index]);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(limit);
  }
  await page.screenshot({ path: testInfo.outputPath("layer-drawn.png") });

  await page.keyboard.press(`${PRIMARY_MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(PLAIN);
});

test("selecting an overlay preserves step 2 and the slide text", async ({ page }) => {
  const source = LAYERED.replace("A first paragraph of text.", String.raw`First.\pause Second.`);
  await setSource(page, source);
  await page.getByRole("button", { name: "1. Layer", exact: true }).click();
  await page.getByRole("button", { name: "Next overlay step", exact: true }).click();
  const rectangle = page.locator('[data-hit-region-target-id="path:0"]').first();
  await expect(rectangle).toBeAttached();
  const before = (await canvasState(page)).transform;
  await rectangle.click();
  await expect.poll(async () => (await canvasState(page)).rootId).toBe("frame:0");
  await expect.poll(async () => (await canvasState(page)).selected).toEqual(["path:0"]);
  expect((await canvasState(page)).transform).toEqual(before);
  // Paused slide text stays visible while the shape is selected.
  const pausedGlyph = page.getByTestId("canvas-world-stage").locator(`[data-tex-glyph][data-source-start="${source.indexOf("Second.")}"]`).first();
  await expect(pausedGlyph).toBeAttached();
  expect(await pausedGlyph.evaluate(element => getComputedStyle(element).visibility)).toBe("visible");
  expect((await canvasState(page)).rootId).toBe("frame:0");
  await expect(page.getByRole("button", { name: "Next overlay step", exact: true })).toBeDisabled();
  expect(await readStoreSource(page)).toBe(source);
});

for (const [label, body] of [["empty", ""], ["paused", String.raw`First.\pause Second.`]] as const) {
  test(`drawing on a slide with ${label} content loads TikZ and supports undo and redo`, async ({ page }) => {
    const source = PLAIN.replace(String.raw`\usepackage{tikz}` + "\n", "").replace("Some text here.", body);
    await setSource(page, source);
    await page.getByRole("button", { name: "1. Plain", exact: true }).click();
    await page.getByRole("button", { name: "Rect", exact: true }).click();
    await expect.poll(async () => (await canvasState(page)).rootId).toBe("frame:0");
    expect(await readStoreSource(page)).toBe(source);
    const stage = (await page.getByTestId("canvas-world-stage").boundingBox())!;
    await page.mouse.move(stage.x + stage.width * .35, stage.y + stage.height * .5);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width * .55, stage.y + stage.height * .7, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => readStoreSource(page)).toContain("\\usepackage{tikz}\n" + TIKZ_LAYER_DEFINITION + "\n\\begin{document}");
    const drawn = await readStoreSource(page);
    expect(drawn).toContain(body);
    expect(drawn.match(/\\begin\{tikzlayer\}/gu)).toHaveLength(1);
    await page.keyboard.press(`${PRIMARY_MOD}+z`);
    await expect.poll(() => readStoreSource(page)).toBe(source);
    await page.keyboard.press(`${PRIMARY_MOD}+Shift+z`);
    await expect.poll(() => readStoreSource(page)).toBe(drawn);
    expect((await canvasState(page)).rootId).toBe("frame:0");
    await expect(page.locator('[data-hit-region-target-id="path:0"]').first()).toBeAttached();
  });
}

test("a line drawn into a scaled and rotated page layer lands at its canvas endpoints", async ({ page }) => {
  const source = LAYERED.replace("shift={(current page.south west)}", "shift={(current page.south west)}, scale=1.5, rotate=30");
  await setSource(page, source);
  await page.getByRole("button", { name: "1. Layer", exact: true }).click();
  // The root switches before its page is ready; the drawing tool needs the
  // rendered picture inventory to reuse this layer instead of creating one.
  await waitForSlideSnapshot(page, 2);
  await expect(page.locator('[data-hit-region-target-id="path:0"]').first()).toBeAttached();
  await page.getByRole("button", { name: "Line", exact: true }).click();
  await expect.poll(async () => (await canvasState(page)).rootId).toBe("frame:0");
  await page.evaluate(() => {
    const api = (globalThis as unknown as { __TIKZ_EDITOR_APP_TEST_API__: { runCommand: (id: string) => void } }).__TIKZ_EDITOR_APP_TEST_API__;
    for (const mode of ["grid", "guides", "object-points", "object-gaps"]) api.runCommand(`view.toggle-snap-${mode}`);
  });
  // This fixture's fitted page uses a non-identity transform. Measure only
  // after the initial fit so gesture coordinates stay fixed during the drag.
  await expect.poll(async () => {
    const transform = (await canvasState(page)).transform;
    return transform !== undefined && transform.scale !== 1;
  }).toBe(true);
  const stage = (await page.getByTestId("canvas-world-stage").boundingBox())!;
  const start = { x: stage.x + stage.width * .4, y: stage.y + stage.height * .55 };
  const end = { x: stage.x + stage.width * .65, y: stage.y + stage.height * .7 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await canvasState(page)).selected).toEqual(["path:2"]);
  const line = page.locator('[data-source-id="path:2"]').first();
  await expect(line).toBeAttached();
  const box = (await line.boundingBox())!;
  expect(Math.abs(box.x - start.x)).toBeLessThan(1);
  expect(Math.abs(box.y - start.y)).toBeLessThan(1);
  expect(Math.abs(box.x + box.width - end.x)).toBeLessThan(1);
  expect(Math.abs(box.y + box.height - end.y)).toBeLessThan(1);
});

test("deleting the last drawing removes its picture after the list and undo restores it on the slide", async ({ page }) => {
  const source = PLAIN.replace("Some text here.", String.raw`\begin{itemize}
\item First
\item Last
\end{itemize}`);
  await setSource(page, source);
  await page.getByRole("button", { name: "1. Plain", exact: true }).click();
  await page.getByRole("button", { name: "Rect", exact: true }).click();
  await expect.poll(async () => (await canvasState(page)).rootId).toBe("frame:0");
  const stage = (await page.getByTestId("canvas-world-stage").boundingBox())!;
  await page.mouse.move(stage.x + stage.width * .5, stage.y + stage.height * .6);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width * .7, stage.y + stage.height * .8, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await canvasState(page)).selected).toEqual(["path:0"]);
  const drawn = await readStoreSource(page);
  expect(drawn).toContain("\\end{itemize}\n\n\\begin{tikzlayer}");
  await page.keyboard.press("Backspace");
  // The definition stays for the next drawing.
  await expect.poll(() => readStoreSource(page)).toBe(defined(source));
  expect((await canvasState(page)).rootId).toBe("frame:0");
  await page.keyboard.press(`${PRIMARY_MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(drawn);
  await expect(page.getByRole("button", { name: "Back to Slide 1" })).toHaveCount(0);
});

test("slide text stays editable immediately after selecting an overlay object", async ({ page }) => {
  await setSource(page, LAYERED);
  await page.getByRole("button", { name: "1. Layer", exact: true }).click();
  await page.locator('[data-hit-region-target-id="path:0"]').first().click();
  await expect.poll(async () => (await canvasState(page)).selected).toEqual(["path:0"]);
  const text = page.locator('[data-hit-region-interaction-mode="text"][data-hit-region-target-id="frame:0:scope:body"]').first();
  await text.click();
  await page.keyboard.type("Z");
  await expect.poll(() => readStoreSource(page)).not.toBe(LAYERED);
  const changed = await readStoreSource(page);
  expect(changed).toContain("Z");
  expect(changed).toContain(String.raw`\draw[fill=orange!20] (1.2,5.5) rectangle (5.0,7.1);`);
  expect((await canvasState(page)).rootId).toBe("frame:0");
  await expect(page.getByRole("button", { name: "Back to Slide 1" })).toHaveCount(0);
});

test("overlay node text edits on the slide without opening a figure", async ({ page }) => {
  await setSource(page, LAYERED);
  await page.getByRole("button", { name: "1. Layer", exact: true }).click();
  const text = page.locator('[data-hit-region-target-id="path:1"][data-hit-region-interaction-mode="text"]').first();
  await expect(text).toBeAttached();
  await text.dblclick();
  await page.keyboard.type("Updated");
  await expect.poll(() => readStoreSource(page)).toContain("Updated");
  expect((await canvasState(page)).rootId).toBe("frame:0");
  expect(await readStoreSource(page)).toContain("A first paragraph of text.");
  await expect(page.getByRole("button", { name: "Back to Slide 1" })).toHaveCount(0);
});


test("rectangle inspector edits options on the slide and supports undo", async ({ page }) => {
  await setSource(page, LAYERED);
  await page.getByRole("button", { name: "1. Layer", exact: true }).click();
  await page.locator('[data-hit-region-target-id="path:0"]').first().click();
  await expect(page.getByText("Inline command options could not be resolved for this element.")).toHaveCount(0);
  const preset = page.getByRole("button", { name: "Line width preset" });
  await expect(preset).toBeVisible();
  await preset.click();
  await page.getByRole("option", { name: "thick", exact: true }).click();
  await expect.poll(() => readStoreSource(page)).toContain("thick");
  expect(await readStoreSource(page)).toContain("A first paragraph of text.");
  expect((await canvasState(page)).rootId).toBe("frame:0");
  await page.keyboard.press(`${PRIMARY_MOD}+z`);
  await expect.poll(() => readStoreSource(page)).toBe(LAYERED);
});

test("overlay drag uses incremental compute and keeps untouched SVG objects in the DOM", async ({ page }, testInfo) => {
  const extras = Array.from({ length: 30 }, (_, index) => `\\draw (${index / 10},1) -- (${index / 10 + .2},2);`).join("\n");
  const source = LAYERED.replace("\\end{tikzpicture}", extras + "\n\\end{tikzpicture}");
  await setSource(page, source);
  await page.getByRole("button", { name: "1. Layer", exact: true }).click();
  const rectangle = page.locator('[data-hit-region-target-id="path:0"]').first();
  await rectangle.click();
  const untouched = await page.getByTestId("canvas-svg-layer").locator('[data-source-id="path:30"]').elementHandle();
  expect(untouched).not.toBeNull();
  await page.evaluate(() => (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__: {
    resetProfilingSession: (label: string) => void;
  } }).__TIKZ_EDITOR_APP_TEST_API__.resetProfilingSession("overlay-drag"));
  const box = (await rectangle.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(start.x + 8 * step, start.y + 4 * step);
    await page.waitForTimeout(35);
  }
  await expect.poll(() => readStoreSource(page)).not.toBe(source);
  await expect.poll(async () => await page.evaluate(() => (window as typeof window & {
    __TIKZ_EDITOR_APP_TEST_API__: { getProfilingSnapshot: () => AppProfilingSnapshot };
  }).__TIKZ_EDITOR_APP_TEST_API__.getProfilingSnapshot().computeTimings.filter(timing => timing.trigger === "drag-element").length)).toBeGreaterThan(0);
  expect(await untouched!.evaluate(element => element.isConnected)).toBe(true);
  const profile = await page.evaluate(() => (window as typeof window & {
    __TIKZ_EDITOR_APP_TEST_API__: { getProfilingSnapshot: () => AppProfilingSnapshot };
  }).__TIKZ_EDITOR_APP_TEST_API__.getProfilingSnapshot());
  const drags = profile.computeTimings.filter(timing => timing.trigger === "drag-element" && (timing.changedSourceCount ?? 0) > 0);
  expect(drags.length).toBeGreaterThan(0);
  expect(drags.every(timing => timing.parseStrategy === "incremental" && timing.semanticStrategy === "incremental")).toBe(true);
  expect(profile.svgPatchTimings.every(timing => !timing.hasReplaceAll && !timing.hasReplaceDefs)).toBe(true);
  const profilePath = testInfo.outputPath("overlay-drag-profile.json");
  await writeFile(profilePath, JSON.stringify(profile, null, 2));
  await testInfo.attach("overlay-drag-profile.json", { path: profilePath, contentType: "application/json" });
  await page.mouse.up();
  expect((await canvasState(page)).rootId).toBe("frame:0");
});


test("switching between edited overlays keeps inactive hit regions at their page positions", async ({ page }) => {
  const second = String.raw`\begin{tikzpicture}[overlay,remember picture,shift={(current page.south west)}]
\node[draw] at (3,1) {Other layer};
\end{tikzpicture}`;
  const source = LAYERED.replace("\\end{frame}", second + "\n\\end{frame}");
  await setSource(page, source);
  await page.getByRole("button", { name: "1. Layer", exact: true }).click();
  const inactiveRectangle = page.locator('[data-hit-region-key^="deck-layer:frame:0:overlay:0:"][data-hit-region-target-id="path:0"]').first();
  await inactiveRectangle.click();
  const rectangle = page.locator('[data-hit-region-key^="hit:"][data-hit-region-target-id="path:0"]').first();
  await expect(rectangle).toBeAttached();
  const box = (await rectangle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => readStoreSource(page)).not.toBe(source);
  await expect.poll(async () => (await rectangle.boundingBox())!.x).toBeGreaterThan(box.x + 10);
  const moved = (await rectangle.boundingBox())!;
  await page.locator('rect[data-hit-region-key^="deck-layer:frame:0:overlay:1:"]').first().click();
  const afterSwitch = page.locator('[data-hit-region-key^="deck-layer:frame:0:overlay:0:"][data-hit-region-target-id="path:0"]').first();
  await expect(afterSwitch).toBeAttached();
  const region = (await afterSwitch.boundingBox())!;
  expect(Math.abs(region.x - moved.x)).toBeLessThan(1);
  expect(Math.abs(region.y - moved.y)).toBeLessThan(1);
  await afterSwitch.click();
  await expect(rectangle).toBeAttached();
  expect((await canvasState(page)).rootId).toBe("frame:0");
});

test("a 500-object text-heavy overlay drag stays incremental and keeps untouched SVG nodes", async ({ page }, testInfo) => {
  const extras = Array.from({ length: 498 }, (_, index) => {
    const x = .3 + (index % 25) * .45;
    const y = .3 + Math.floor(index / 25) * .2;
    return index % 4 === 0
      ? `\\node[font=\\tiny] at (${x},${y}) {Label ${index} with $x^2$};`
      : `\\draw (${x},${y}) -- (${x + .15},${y + .1});`;
  }).join("\n");
  const source = LAYERED.replace("\\end{tikzpicture}", extras + "\n\\end{tikzpicture}");
  await setSource(page, source);
  await page.getByRole("button", { name: "1. Layer", exact: true }).click();
  const rectangle = page.locator('[data-hit-region-target-id="path:0"]').first();
  await rectangle.click();
  // CodeMirror virtualizes a large source; wait on its rendered snapshot and
  // scene instead of comparing only the visible source lines in the DOM.
  await waitForSlideSnapshot(page, 500);
  const untouched = await page.getByTestId("canvas-svg-layer").locator('[data-source-id="path:499"]').elementHandle();
  expect(untouched).not.toBeNull();
  await resetProfile(page, "overlay-500-drag");
  const box = (await rectangle.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(start.x + 5 * step, start.y + 2 * step);
    await page.waitForTimeout(45);
  }
  await expect.poll(async () => (await readProfile(page)).computeTimings.filter(timing =>
    timing.trigger === "drag-element" && (timing.changedSourceCount ?? 0) > 0).length).toBeGreaterThan(0);
  expect(await untouched!.evaluate(element => element.isConnected)).toBe(true);
  await page.mouse.up();
  await waitForSlideSnapshot(page, 500);
  const profile = await readProfile(page);
  const drags = profile.computeTimings.filter(timing => timing.trigger === "drag-element" && (timing.changedSourceCount ?? 0) > 0);
  expect(drags.every(timing => timing.parseStrategy === "incremental" && timing.semanticStrategy === "incremental")).toBe(true);
  expect(drags.every(timing => timing.recomputedStatementCount === 1 && timing.reusedStatementCount === 499)).toBe(true);
  expect(profile.svgPatchTimings.every(timing => !timing.hasReplaceAll && !timing.hasReplaceDefs)).toBe(true);
  const profilePath = testInfo.outputPath("overlay-500-profile.json");
  await writeFile(profilePath, JSON.stringify(profile, null, 2));
  await testInfo.attach("overlay-500-profile.json", { path: profilePath, contentType: "application/json" });
  expect((await canvasState(page)).rootId).toBe("frame:0");
});

test("overlay inspector scrubs stay incremental and commit one undo step", async ({ page }, testInfo) => {
  const source = LAYERED.replace("fill=orange!20", "fill=orange!20,xshift=2pt");
  await setSource(page, source);
  await page.getByRole("button", { name: "1. Layer", exact: true }).click();
  await page.locator('[data-hit-region-target-id="path:0"]').first().click();
  const label = page.getByText("X shift", { exact: true }).first();
  await expect(label).toBeVisible();
  const box = (await label.boundingBox())!;
  const initial = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const pointer = { pointerId: 43, pointerType: "mouse", button: 0, buttons: 1, bubbles: true };
  await label.dispatchEvent("pointerdown", { ...pointer, clientX: initial.x, clientY: initial.y });
  await resetProfile(page, "overlay-inspector-scrub");
  await page.evaluate(({ pointer, initial }) => {
    for (const x of [8, 16, 24]) window.dispatchEvent(new PointerEvent("pointermove", { ...pointer, clientX: initial.x + x, clientY: initial.y }));
  }, { pointer, initial });
  await expect.poll(() => readStoreSource(page)).toContain("xshift=2.3pt");
  await expectSourceCanvasConsistency(page);
  const profile = await readProfile(page);
  const edits = profile.computeTimings.filter(timing => (timing.changedSourceCount ?? 0) > 0);
  expect(edits.length).toBeGreaterThan(0);
  expect(edits.every(timing => timing.parseStrategy === "incremental" && timing.semanticStrategy === "incremental")).toBe(true);
  await page.evaluate(({ pointer, initial }) => window.dispatchEvent(new PointerEvent("pointerup", {
    ...pointer, buttons: 0, clientX: initial.x + 48, clientY: initial.y
  })), { pointer, initial });
  await expect.poll(() => readStoreSource(page)).toContain("xshift=2.6pt");
  await expectSourceCanvasConsistency(page);
  const profilePath = testInfo.outputPath("overlay-inspector-profile.json");
  await writeFile(profilePath, JSON.stringify(await readProfile(page), null, 2));
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readStoreSource(page)).toBe(source);
  expect((await canvasState(page)).rootId).toBe("frame:0");
});

test("overlay node typing stays incremental and preserves the slide body", async ({ page }, testInfo) => {
  await setSource(page, LAYERED);
  await page.getByRole("button", { name: "1. Layer", exact: true }).click();
  const text = page.locator('[data-hit-region-target-id="path:1"][data-hit-region-interaction-mode="text"]').first();
  await text.dblclick();
  await resetProfile(page, "overlay-node-typing");
  await page.keyboard.type("Updated", { delay: 60 });
  await expect.poll(() => readStoreSource(page)).toContain("Updated");
  await expectSourceCanvasConsistency(page);
  const profile = await readProfile(page);
  const profilePath = testInfo.outputPath("overlay-typing-profile.json");
  await writeFile(profilePath, JSON.stringify(profile, null, 2));
  const edits = profile.computeTimings.filter(timing => (timing.changedSourceCount ?? 0) > 0);
  expect(edits.length).toBeGreaterThan(0);
  expect(edits.every(timing => timing.parseStrategy === "incremental" && timing.semanticStrategy === "incremental")).toBe(true);
  await page.keyboard.press("Escape");
  await expectSourceCanvasConsistency(page);
  expect(await readStoreSource(page)).toContain("A first paragraph of text.");
  expect((await canvasState(page)).rootId).toBe("frame:0");
});

test("overlay resize and rotation preserve the viewport, slide text and undo history", async ({ page }) => {
  await setSource(page, LAYERED);
  await page.getByRole("button", { name: "1. Layer", exact: true }).click();
  await page.locator('[data-hit-region-target-id="path:0"]').first().click();
  const before = (await canvasState(page)).transform;
  const resize = page.locator('[data-handle-kind="resize-element"][data-source-id="path:0"][data-resize-role="bottom-right"]').first();
  await expect(resize).toBeVisible();
  const box = (await resize.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 25, { steps: 6 });
  await page.mouse.up();
  await expectSourceCanvasConsistency(page);
  const resized = await readStoreSource(page);
  expect(resized).not.toBe(LAYERED);
  const rotate = page.locator('[data-handle-kind="rotate-element"][data-source-id="path:0"]').first();
  await expect(rotate).toBeVisible();
  const rotationBox = (await rotate.boundingBox())!;
  await page.mouse.move(rotationBox.x + rotationBox.width / 2, rotationBox.y + rotationBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(rotationBox.x + rotationBox.width / 2 + 30, rotationBox.y + rotationBox.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  await expectSourceCanvasConsistency(page);
  const rotated = await readStoreSource(page);
  expect(rotated).not.toBe(resized);
  expect(rotated).toContain("A first paragraph of text.");
  expect((await canvasState(page)).transform).toEqual(before);
  expect((await canvasState(page)).rootId).toBe("frame:0");
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readStoreSource(page)).toBe(resized);
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readStoreSource(page)).toBe(LAYERED);
});

test("copy/paste and canceled drags keep editing the slide", async ({ page }) => {
  await page.evaluate(() => {
    let clipboardText = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value: string) => { clipboardText = value; }, readText: async () => clipboardText
    } });
  });
  await setSource(page, LAYERED);
  await page.getByRole("button", { name: "1. Layer", exact: true }).click();
  await page.locator('[data-hit-region-target-id="path:0"]').first().click();
  await openMenuCommand(page, "edit", "edit.copy");
  await openMenuCommand(page, "edit", "edit.paste");
  await expect.poll(() => readStoreSource(page)).not.toBe(LAYERED);
  await expectSourceCanvasConsistency(page);
  const pasted = await readStoreSource(page);
  expect(pasted.match(/\\begin\{tikzpicture\}/gu)).toHaveLength(1);
  expect(pasted.match(/rectangle/gu)).toHaveLength(2);
  expect(pasted).toContain("A first paragraph of text.");
  expect((await canvasState(page)).rootId).toBe("frame:0");
  await openMenuCommand(page, "edit", "edit.undo");
  await expect.poll(() => readStoreSource(page)).toBe(LAYERED);
  await expectSourceCanvasConsistency(page);
  const rectangle = page.locator('[data-hit-region-target-id="path:0"]').first();
  await rectangle.click();
  const before = (await rectangle.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 45, before.y + before.height / 2 + 25, { steps: 6 });
  await expect.poll(() => readStoreSource(page)).not.toBe(LAYERED);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => readStoreSource(page)).toBe(LAYERED);
  await expectSourceCanvasConsistency(page, { assertNoActiveCanvasDrag: true });
  const restored = (await rectangle.boundingBox())!;
  expect(Math.abs(restored.x - before.x)).toBeLessThan(1);
  expect(Math.abs(restored.y - before.y)).toBeLessThan(1);
  expect((await canvasState(page)).rootId).toBe("frame:0");
});
