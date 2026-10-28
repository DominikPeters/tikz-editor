import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type CDPSession } from "@playwright/test";
import type { AppProfilingSnapshot } from "../../../packages/app/src/profiling";
import { parseTikz } from "@tikz-editor/core";
import { resolvePaperTarget, seedWorkspace, TRACES_DIR, type PaperTarget } from "./helpers";

type AppApi = {
  getSource: () => string;
  getSourceRevision: () => number;
  getSnapshotSource: () => string;
  getPendingRequestId: () => string | null;
  getActiveCanvasDragKind: () => string | null;
  selectSourceIds: (ids: string[]) => void;
  runCommand: (id: string) => boolean;
  resetProfilingSession: (label: string) => void;
  getProfilingSnapshot: () => AppProfilingSnapshot;
};
type MemorySample = { label: string; heapBytes: number; preGcHeapBytes: number; nodes: number; listeners: number; connectedElements: number };
type DragCase = { id: string; target: PaperTarget; hidePanels?: boolean; bypassSnapping?: boolean };

const paper = resolvePaperTarget([
  String.raw`\draw[thick,->,magenta] (0.0, 0.0) -- (0.0, 4.5);`,
  String.raw`\draw[thick,->] (0.0, 0.0) -- (0.0, 4.5);`
]);

function targetForSource(source: string, line: string): PaperTarget {
  const parsed = parseTikz(source, { recover: true, includeContextDefinitions: true });
  const offset = source.indexOf(line);
  const figure = parsed.figures.find(candidate => candidate.span.from <= offset && candidate.span.to > offset);
  if (!figure) throw new Error("Target figure not found");
  const active = parseTikz(source, { recover: true, includeContextDefinitions: true, activeFigureId: figure.id });
  const statement = active.figure.body.find(candidate => candidate.span.from <= offset && candidate.span.to > offset);
  if (!statement) throw new Error("Target statement not found");
  return { source, targetLine: line, targetOffset: offset, activeRootId: figure.id,
    activeFigureNumber: parsed.figures.indexOf(figure) + 1, targetSourceId: statement.id };
}

const denseLine = String.raw`\draw[thick,magenta] (0,0) -- (4,0);`;
const denseSource = `\\begin{tikzpicture}\n${denseLine}\n` + Array.from({ length: 500 }, (_, index) => {
  const x = index % 20;
  const y = -1 - Math.floor(index / 20);
  return index % 3 === 0
    ? `\\node[draw] (n${index}) at (${x},${y}) {$x_{${index}}$};`
    : `\\draw[blue] (${x},${y}) rectangle ++(.7,.6);`;
}).join("\n") + "\n\\end{tikzpicture}";
const padding = Array.from({ length: 4500 }, (_, index) => `% Large paper source context ${index}: explanatory text, references, formulas, definitions and annotations.\n`).join("");
const expandedPaper = targetForSource(paper.source.replace("\\begin{document}", `${padding}\\begin{document}`), paper.targetLine);
const cases: DragCase[] = [
  { id: "paper-148kb", target: paper },
  { id: "paper-600kb", target: expandedPaper },
  { id: "dense-500", target: targetForSource(denseSource, denseLine) },
  { id: "dense-500-hidden-panels", target: targetForSource(denseSource, denseLine), hidePanels: true },
  { id: "dense-500-coordinate-only", target: targetForSource(denseSource, denseLine), bypassSnapping: true }
];
const batchCount = Number(process.env.TIKZ_MEMORY_DRAG_BATCHES ?? 3);
if (!Number.isInteger(batchCount) || batchCount < 1 || batchCount > 6) throw new Error("TIKZ_MEMORY_DRAG_BATCHES must be 1 through 6");

async function command(page: Page, id: string): Promise<void> {
  expect(await page.evaluate(commandId =>
    (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__: AppApi }).__TIKZ_EDITOR_APP_TEST_API__.runCommand(commandId), id)).toBe(true);
}

async function settle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const api = (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__?: AppApi }).__TIKZ_EDITOR_APP_TEST_API__;
    return api != null && api.getPendingRequestId() == null && api.getActiveCanvasDragKind() == null &&
      api.getSource() === api.getSnapshotSource();
  }), { timeout: 60_000 }).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function sample(page: Page, client: CDPSession, label: string): Promise<MemorySample> {
  await settle(page);
  const preGc = await client.send("Runtime.getHeapUsage");
  await client.send("HeapProfiler.collectGarbage");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await client.send("HeapProfiler.collectGarbage");
  const heap = await client.send("Runtime.getHeapUsage");
  const dom = await client.send("Memory.getDOMCounters");
  const connectedElements = await page.evaluate(() => document.querySelectorAll("*").length);
  return { label, heapBytes: heap.usedSize, preGcHeapBytes: preGc.usedSize, nodes: dom.nodes, listeners: dom.jsEventListeners, connectedElements };
}

async function heapSnapshot(client: CDPSession, name: string): Promise<void> {
  if (process.env.TIKZ_MEMORY_HEAP_SNAPSHOT !== "1") return;
  fs.mkdirSync(TRACES_DIR, { recursive: true });
  const target = path.join(TRACES_DIR, `${name}.heapsnapshot`);
  fs.writeFileSync(target, "");
  const append = ({ chunk }: { chunk: string }) => fs.appendFileSync(target, chunk);
  client.on("HeapProfiler.addHeapSnapshotChunk", append);
  try { await client.send("HeapProfiler.takeHeapSnapshot"); }
  finally { client.off("HeapProfiler.addHeapSnapshotChunk", append); }
}

async function dragEndpoint(page: Page, sourceId: string, direction: number, bypassSnapping = false): Promise<number> {
  const revision = await page.evaluate(() =>
    (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__: AppApi }).__TIKZ_EDITOR_APP_TEST_API__.getSourceRevision());
  const point = await page.evaluate(id => {
    const selector = `[data-handle-kind="move-handle"][data-source-id="${id}"]`;
    const handles = [...document.querySelectorAll(selector)];
    const points = handles.map(handle => handle.getBoundingClientRect()).filter(rect => rect.width > 0)
      .map(rect => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })).sort((a, b) => a.y - b.y || a.x - b.x);
    const hittable = points.find(point => document.elementFromPoint(point.x, point.y)?.closest(selector));
    if (!hittable) throw new Error(`No hittable endpoint handle: ${JSON.stringify(points)}`);
    return hittable;
  }, sourceId);
  const started = performance.now();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  if (bypassSnapping) await page.keyboard.down("Control");
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(point.x + direction * step * 2, point.y + direction * step);
    await page.waitForTimeout(16);
    if (step === 2) expect(await page.evaluate(() =>
      (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__: AppApi }).__TIKZ_EDITOR_APP_TEST_API__.getActiveCanvasDragKind())).toBe("handle");
  }
  await page.mouse.up();
  if (bypassSnapping) await page.keyboard.up("Control");
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__: AppApi }).__TIKZ_EDITOR_APP_TEST_API__.getSourceRevision())).toBeGreaterThan(revision);
  await settle(page);
  return performance.now() - started;
}

for (const scenario of cases) test(`memory during real drags: ${scenario.id}`, async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "GC measurements use CDP");
  test.setTimeout(300_000);
  page.on("pageerror", error => console.log(`[memory-drag] page error: ${error.message}`));
  await seedWorkspace(page, scenario.target, `memory-${scenario.id}`);
  await page.goto("/");
  await expect(page.getByTestId("tab-strip")).toBeVisible({ timeout: 60_000 });
  await settle(page);
  if (scenario.hidePanels) {
    await command(page, "view.toggle-source-panel");
    await command(page, "view.toggle-inspector-panel");
  }
  await page.evaluate(id =>
    (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__: AppApi }).__TIKZ_EDITOR_APP_TEST_API__.selectSourceIds([id]), scenario.target.targetSourceId);
  await expect(page.locator(`[data-handle-kind="move-handle"][data-source-id="${scenario.target.targetSourceId}"]`).first()).toBeVisible();
  const client = await page.context().newCDPSession(page);
  const samples: MemorySample[] = [];
  const durations: number[] = [];
  const timingBatches: AppProfilingSnapshot[] = [];
  try {
    for (let index = 0; index < 4; index++) await dragEndpoint(page, scenario.target.targetSourceId, index % 2 ? -1 : 1, scenario.bypassSnapping);
    samples.push(await sample(page, client, "warm-4-drags"));
    for (let batch = 0; batch < batchCount; batch++) {
      await page.evaluate(label =>
        (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__: AppApi }).__TIKZ_EDITOR_APP_TEST_API__.resetProfilingSession(label), scenario.id);
      for (let index = 0; index < 12; index++) durations.push(await dragEndpoint(page, scenario.target.targetSourceId, index % 2 ? -1 : 1, scenario.bypassSnapping));
      timingBatches.push(await page.evaluate(() =>
        (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__: AppApi }).__TIKZ_EDITOR_APP_TEST_API__.getProfilingSnapshot()));
      samples.push(await sample(page, client, `drags-${(batch + 1) * 12 + 4}`));
      console.log(`[memory-drag] ${scenario.id}: ${JSON.stringify(samples.at(-1))}`);
    }
    await heapSnapshot(client, `memory-${scenario.id}-open`);
    await command(page, "file.close-all-documents");
    await page.getByTestId("unsaved-discard").click();
    samples.push(await sample(page, client, "closed-document"));
    await heapSnapshot(client, `memory-${scenario.id}-closed`);
    const timings = timingBatches.flatMap(batch => batch.computeTimings);
    const report = { scenario: scenario.id, sourceCharacters: scenario.target.source.length,
      drags: 4 + batchCount * 12, pointerMovesPerDrag: 8, bypassSnapping: scenario.bypassSnapping ?? false, samples, durations, computeTimings: timings,
      incrementalRenders: timings.filter(timing => timing.incremental).length,
      fullRenders: timings.filter(timing => !timing.incremental).length,
      scope: "Main-thread GC heap and DOM; gestures retain bounded undo history; timings include test input pacing" };
    fs.mkdirSync(TRACES_DIR, { recursive: true });
    const reportPath = path.join(TRACES_DIR, `memory-drag-${scenario.id}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    await testInfo.attach("memory-drag", { path: reportPath, contentType: "application/json" });
    expect(report.incrementalRenders).toBeGreaterThan(0);
    if (scenario.bypassSnapping) {
      expect(report.fullRenders).toBe(0);
      expect(timings.every(timing => timing.parseStrategy !== "full" && timing.semanticStrategy !== "full")).toBe(true);
    }
    // History intentionally retains full document sources (64 MiB budget).
    // Record the trajectory; do not mislabel useful undo data as a leak.
    expect(samples.every(entry => Number.isFinite(entry.heapBytes))).toBe(true);
    const warm = samples[0];
    const lastDrag = samples.at(-2);
    if (!warm || !lastDrag) throw new Error("Missing drag memory samples");
    expect(lastDrag.nodes - warm.nodes).toBeLessThan(2000);
    expect(lastDrag.listeners - warm.listeners).toBeLessThan(100);
    if (scenario.bypassSnapping) expect(lastDrag.heapBytes - warm.heapBytes).toBeLessThan(64 * 1024 * 1024);
  } finally {
    await client.detach();
  }
});
