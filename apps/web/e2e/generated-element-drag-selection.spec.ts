import { expect, test, type Page } from "@playwright/test";
import { canvasViewport, expectSourceCanvasConsistency, gotoApp, readSelectedSourceIds, readSource, resetStorageBeforeNavigation, setCanvasTransform, setSource, waitForHitRegions } from "./helpers";

// Elements that TikZ generates from one statement item (a pic, graph nodes,
// matrix cells, tree children, a decorated path): after a drag they stay
// selected, as a plain path does.
const wrap = (body: string) => `\\begin{tikzpicture}\n${body}\n\\fill (-3,-3) circle (2pt);\n\\end{tikzpicture}`;
// Graph nodes, matrix cells and tree children are placed by their layout: a
// drag does not move them (the source stays), and the selection stays too.
const CASES: Array<{ name: string; body: string; target: string | RegExp; moves: boolean }> = [
  { name: "pic", body: String.raw`\tikzset{seagull/.pic={\draw (0,0) -- (1,1) -- (2,0);}}
\pic at (1,1) {seagull};`, target: "pic-operation:1:0", moves: true },
  { name: "graph node", body: String.raw`\graph { a -> b -> c };`, target: /^graph-operation:\d+:\d+:graph-node:1$/u, moves: false },
  { name: "matrix cell", body: String.raw`\matrix (m) [matrix of nodes] { a & b \\ c & d \\ };`, target: /matrix-cell:1:2$/u, moves: false },
  { name: "tree child", body: String.raw`\node {root} child {node {c1}} child {node {c2}};`, target: /tree-child:2:/u, moves: false },
  { name: "decorated path", body: String.raw`\draw[decorate, decoration=zigzag] (0,0) -- (3,0);`, target: "path:0", moves: true },
];

async function pointOn(page: Page, targetId: string): Promise<{ x: number; y: number }> {
  const region = page.locator(`[data-hit-region-target-id='${targetId}']`).first();
  await expect(region).toBeAttached();
  return await region.evaluate((element) => {
    if (element instanceof SVGGeometryElement && element.ownerSVGElement && getComputedStyle(element).pointerEvents !== "fill") {
      const sample = element.getPointAtLength(element.getTotalLength() * 0.3);
      const point = element.ownerSVGElement.createSVGPoint();
      point.x = sample.x; point.y = sample.y;
      const screen = point.matrixTransform(element.getScreenCTM() ?? undefined);
      return { x: screen.x, y: screen.y };
    }
    const r = element.getBoundingClientRect();
    // A node's padding, above its text: pressing on the text edits it.
    return { x: r.left + r.width / 2, y: r.top + Math.min(3, r.height / 4) };
  });
}

test.use({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
test.beforeEach(async ({ page }) => { await resetStorageBeforeNavigation(page); await gotoApp(page); });

for (const { name, body, target, moves } of CASES) {
  test(`a dragged ${name} stays selected`, async ({ page }) => {
    const source = wrap(body);
    await setSource(page, source);
    await waitForHitRegions(page);
    await setCanvasTransform(page, { translateX: 300, translateY: 300, scale: 1.5 });
    await waitForHitRegions(page);
    const ids = await page.evaluate(() => [...new Set(Array.from(document.querySelectorAll("[data-hit-region-target-id]")).map((element) => element.getAttribute("data-hit-region-target-id") ?? ""))]);
    const id = typeof target === "string" ? target : ids.find((candidate) => target.test(candidate));
    expect(id, `hit regions: ${ids.join(", ")}`).toBeDefined();
    if (!id) return;
    const start = await pointOn(page, id);
    await page.mouse.click(start.x, start.y);
    const selected = await readSelectedSourceIds(page);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.keyboard.down("Control");
    await page.mouse.move(start.x + 45, start.y + 30, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    await expectSourceCanvasConsistency(page, { assertNoActiveCanvasDrag: true });
    const after = await readSource(page);
    expect(after !== source).toBe(moves);
    expect(selected.length).toBe(1);
    await expect.poll(() => readSelectedSourceIds(page)).toEqual(selected);
  });
}

// The arrow keys move the selection without the drag's draggable filter. A
// tree child has no coordinate of its own: the nudge must leave the child
// (and the selection) as they are and say why.
test("an arrow-key nudge leaves a selected tree child in place", async ({ page }) => {
  const source = wrap(String.raw`\node {root} child {node {c1}} child {node {c2} child {node {c21}}};`);
  await setSource(page, source);
  await waitForHitRegions(page);
  await setCanvasTransform(page, { translateX: 300, translateY: 300, scale: 1.5 });
  await waitForHitRegions(page);
  const ids = await page.evaluate(() => [...new Set(Array.from(document.querySelectorAll("[data-hit-region-target-id]")).map((element) => element.getAttribute("data-hit-region-target-id") ?? ""))]);
  const id = ids.find((candidate) => /tree-child:2:[^:]+:[^:]+:[^:]+$/u.test(candidate));
  expect(id, `hit regions: ${ids.join(", ")}`).toBeDefined();
  if (!id) return;
  const start = await pointOn(page, id);
  await page.mouse.click(start.x, start.y);
  const selected = await readSelectedSourceIds(page);
  expect(selected).toEqual([id]);
  // A click on a node opens its text for editing; Escape closes that and keeps the selection.
  if (await page.getByTestId("canvas-text-edit-textarea").isVisible()) await page.keyboard.press("Escape");
  await canvasViewport(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("canvas-warning-message")).toContainText("Tree children are placed by the tree layout");
  expect(await readSource(page)).toBe(source);
  await expect.poll(() => readSelectedSourceIds(page)).toEqual(selected);
});
