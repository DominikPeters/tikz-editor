import fs from "node:fs";
import path from "node:path";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { gotoApp, resetStorageBeforeNavigation, setSource } from "../e2e/helpers";
import { TRACES_DIR } from "./helpers";

const SLIDES = 24;
const ASSETS = 4;
const REVISIONS = 18;

type WorkerStats = { pending: number; registered: number; renders: number; registrations: number; releases: number };
type Sample = {
  label: string; mainHeapBytes: number; mainBackingBytes: number; nodes: number; listeners: number;
  workerHeapBytes: number; workerBackingBytes: number; workers: number; workerStats: WorkerStats;
  deckCache: { pages: number; estimatedBytes: number } | null;
};

type AppApi = {
  getSource: () => string; getSnapshotSource: () => string; getPendingRequestId: () => string | null;
  getDeckCacheStats: () => { pages: number; estimatedBytes: number };
};

async function installWorkerCounters(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Retain only request IDs/counts, never sources, bundles, SVGs or workers.
    const states: Array<{ pending: Map<string, string>; registered: Set<string>; renders: number; registrations: number; releases: number }> = [];
    const Original = window.Worker;
    window.Worker = new Proxy(Original, { construct(target, args) {
      const worker = Reflect.construct(target, args) as Worker;
      const state = { pending: new Map<string, string>(), registered: new Set<string>(), renders: 0, registrations: 0, releases: 0 };
      states.push(state);
      const originalPost = worker.postMessage;
      worker.postMessage = (...postArgs: Parameters<Worker["postMessage"]>) => {
        const value = postArgs[0] as { type?: string; requestId?: string; groupId?: string; bundle?: { cacheKey: string }; cacheKey?: string };
        if (value.type === "render" && value.requestId && value.groupId) { state.pending.set(value.requestId, value.groupId); state.renders++; }
        if (value.type === "cancelGroup") for (const [id, group] of state.pending) if (group === value.groupId) state.pending.delete(id);
        if (value.type === "registerGraphics" && value.bundle) { state.registered.add(value.bundle.cacheKey); state.registrations++; }
        if (value.type === "unregisterGraphics" && value.cacheKey) { state.registered.delete(value.cacheKey); state.releases++; }
        return Reflect.apply(originalPost, worker, postArgs);
      };
      worker.addEventListener("message", event => {
        const message = event.data as { requestId?: string };
        if (message.requestId) state.pending.delete(message.requestId);
      });
      worker.addEventListener("error", () => { state.pending.clear(); state.registered.clear(); });
      return worker;
    } });
    (window as typeof window & { __MEMORY_WORKERS__: () => WorkerStats }).__MEMORY_WORKERS__ = () => ({
      pending: states.reduce((sum, state) => sum + state.pending.size, 0),
      registered: states.reduce((sum, state) => sum + state.registered.size, 0),
      renders: states.reduce((sum, state) => sum + state.renders, 0),
      registrations: states.reduce((sum, state) => sum + state.registrations, 0),
      releases: states.reduce((sum, state) => sum + state.releases, 0)
    });
  });
}

function assetPath(revision: number, index: number): string { return `__tikz_assets__/memory-${revision}-${index}.svg`; }
function deck(revision: number): string {
  const frames = Array.from({ length: SLIDES }, (_, index) => String.raw`\begin{frame}{Memory slide ${index + 1}}
A shaped paragraph with mathematics $x_i^2+\alpha=\frac{1}{2}$ and revision ${revision}.
\begin{itemize}[<+->]
\item Cache lifetime, retained source revisions and linked image contexts.
\item A second reveal step with a label and $\sum_{i=1}^n i$.
\end{itemize}
\includegraphics[width=2cm]{${assetPath(revision, index % ASSETS)}}
\begin{tikzpicture}[scale=.3]\draw[blue] (0,0) -- (2,1);\node at (1,1) {${index}};\end{tikzpicture}
% ${"large document context ".repeat(140)}
\end{frame}`);
  return String.raw`\documentclass{beamer}
\usepackage{tikz}
\usepackage{graphicx}
\begin{document}
${frames.join("\n")}
\end{document}`;
}
async function seedAssets(page: Page, revision: number): Promise<void> {
  await page.evaluate(({ revision, assets }) => {
    for (let index = 0; index < assets; index++) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="36"><!--${"asset padding ".repeat(1200)}--><rect width="72" height="36" fill="rgb(${revision * 13 % 255},${index * 60},90)"/></svg>`;
      localStorage.setItem(`tikz-editor:imported-graphic:__tikz_assets__/memory-${revision}-${index}.svg`, btoa(svg));
    }
  }, { revision, assets: ASSETS });
}

async function settled(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const win = window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__?: AppApi; __MEMORY_WORKERS__: () => WorkerStats };
    const api = win.__TIKZ_EDITOR_APP_TEST_API__;
    return api != null && api.getPendingRequestId() == null && api.getSource() === api.getSnapshotSource() && win.__MEMORY_WORKERS__().pending === 0;
  }), { timeout: 30_000, intervals: [50, 100, 250] }).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function workerCommand(client: CDPSession, sessionId: string, method: string, id: number): Promise<Record<string, number>> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.off("Target.receivedMessageFromTarget", onMessage); reject(new Error(`Worker CDP timeout: ${method}`)); }, 10_000);
    const onMessage = (event: { sessionId: string; message: string }) => {
      if (event.sessionId !== sessionId) return;
      const response = JSON.parse(event.message) as { id: number; result?: Record<string, number>; error?: { message: string } };
      if (response.id !== id) return;
      clearTimeout(timer); client.off("Target.receivedMessageFromTarget", onMessage);
      if (response.error) reject(new Error(response.error.message)); else resolve(response.result ?? {});
    };
    client.on("Target.receivedMessageFromTarget", onMessage);
    void client.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method }) }).catch(error => {
      clearTimeout(timer); client.off("Target.receivedMessageFromTarget", onMessage);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

async function sample(page: Page, client: CDPSession, targets: CDPSession, label: string, attempt = 0): Promise<Sample> {
  await settled(page);
  await client.send("HeapProfiler.collectGarbage");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await client.send("HeapProfiler.collectGarbage");
  const heap = await client.send("Runtime.getHeapUsage"), dom = await client.send("Memory.getDOMCounters");
  const workers = (await targets.send("Target.getTargets")).targetInfos.filter(target => target.type === "worker");
  let workerHeapBytes = 0, workerBackingBytes = 0;
  for (const worker of workers) {
    const { sessionId } = await targets.send("Target.attachToTarget", { targetId: worker.targetId, flatten: false });
    try {
      await workerCommand(targets, sessionId, "HeapProfiler.collectGarbage", 1);
      const workerHeap = await workerCommand(targets, sessionId, "Runtime.getHeapUsage", 2);
      workerHeapBytes += workerHeap.usedSize; workerBackingBytes += workerHeap.backingStorageSize ?? 0;
    } finally { await targets.send("Target.detachFromTarget", { sessionId }); }
  }
  const extra = await page.evaluate(() => {
    const win = window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__: AppApi; __MEMORY_WORKERS__: () => WorkerStats };
    return { workerStats: win.__MEMORY_WORKERS__(), deckCache: win.__TIKZ_EDITOR_APP_TEST_API__.getDeckCacheStats() };
  });
  // Completing one thumbnail wave can schedule the next while GC/CDP runs.
  // Resample instead of labeling that in-flight wave as retained idle memory.
  if (extra.workerStats.pending > 0) {
    if (attempt >= 3) throw new Error("Thumbnail requests did not remain settled while sampling memory.");
    return sample(page, client, targets, label, attempt + 1);
  }
  return { label, mainHeapBytes: heap.usedSize, mainBackingBytes: heap.backingStorageSize ?? 0, nodes: dom.nodes,
    listeners: dom.jsEventListeners, workers: workers.length, workerHeapBytes, workerBackingBytes, ...extra };
}

async function visit(page: Page, index: number, steps: boolean): Promise<void> {
  await page.getByTestId("figure-navigator").locator(`[data-slide-id="frame:${index}"] button`).first().click();
  await expect(page.getByTestId("canvas-svg-layer").locator(`[data-part-id="frame:${index}:background"]`)).toHaveCount(1);
  if (steps) {
    const next = page.getByTestId("deck-step-next");
    if (await next.isEnabled()) { await next.click(); await page.getByTestId("deck-step-prev").click(); }
  }
}

test("retains bounded memory through slide navigation, overlay steps and asset revisions", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Worker and retained heap measurements require Chromium CDP.");
  test.setTimeout(360_000);
  await resetStorageBeforeNavigation(page);
  await installWorkerCounters(page);
  await gotoApp(page);
  await seedAssets(page, 0);
  await setSource(page, deck(0));
  await expect(page.getByTestId("figure-navigator").locator("[data-slide-id]")).toHaveCount(SLIDES);
  const client = await page.context().newCDPSession(page);
  const targets = await page.context().browser()!.newBrowserCDPSession();
  const samples: Sample[] = [];
  const switchesMs: number[] = [];
  try {
    for (let index = 0; index < SLIDES; index++) await visit(page, index, true);
    samples.push(await sample(page, client, targets, "warm-all-slides"));
    for (let batch = 0; batch < 3; batch++) {
      for (let index = 0; index < SLIDES; index++) {
        const started = performance.now();
        await visit(page, (index * 7) % SLIDES, index % 3 === 0);
        switchesMs.push(performance.now() - started);
      }
      samples.push(await sample(page, client, targets, `navigation-${(batch + 1) * SLIDES}`));
      console.log(`[deck-memory] navigation batch ${batch + 1}`);
    }
    for (let revision = 1; revision <= REVISIONS; revision++) {
      await seedAssets(page, revision);
      await setSource(page, deck(revision));
      await visit(page, revision * 7 % SLIDES, true);
      await settled(page);
      if (revision % 6 === 0) {
        samples.push(await sample(page, client, targets, `asset-revisions-${revision}`));
        console.log(`[deck-memory] asset revision ${revision}`);
      }
    }
    const report = { sourceCharacters: deck(0).length, slides: SLIDES, assetsPerRevision: ASSETS, assetRevisions: REVISIONS,
      samples, switchesMs, scope: "Forced-GC main and dedicated-worker heaps; excludes renderer native/GPU allocations and transient peaks" };
    fs.mkdirSync(TRACES_DIR, { recursive: true });
    const reportPath = path.join(TRACES_DIR, "memory-deck-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    await testInfo.attach("memory-deck-report", { path: reportPath, contentType: "application/json" });
    console.log(`[deck-memory] ${JSON.stringify(report)}`);
    const warm = samples[0], navigation = samples[3], last = samples.at(-1);
    if (!warm || !navigation || !last) throw new Error("Missing samples");
    expect(navigation.mainHeapBytes - warm.mainHeapBytes).toBeLessThan(24 * 1024 * 1024);
    expect(navigation.workerHeapBytes - warm.workerHeapBytes).toBeLessThan(8 * 1024 * 1024);
    expect(last.workerStats.pending).toBe(0);
    expect(last.workerStats.registered).toBeLessThanOrEqual(16);
    expect(last.workerStats.releases).toBeGreaterThan(0);
    expect(last.workers).toBe(1);
  } finally { await client.detach(); await targets.detach(); }
});
