import fs from "node:fs";
import path from "node:path";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { gotoApp, resetStorageBeforeNavigation, setSource } from "../e2e/helpers";
import { TRACES_DIR } from "./helpers";

// Run against a production build with Chromium. GC makes these retained-heap
// measurements, not a measure of peak allocation or total process/worker RSS.
type MemorySample = {
  label: string;
  usedHeapBytes: number;
  backingStorageBytes: number;
  nodes: number;
  documents: number;
  listeners: number;
};

async function sample(page: Page, client: CDPSession, label: string): Promise<MemorySample> {
  // Closing a tab schedules a render of the newly active document. Measuring
  // before it finishes counts the still-live render's temporary DOM as retained.
  await expect.poll(() => page.evaluate(() => {
    const api = (window as typeof window & {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        getPendingRequestId: () => string | null;
        getSource: () => string;
        getSnapshotSource: () => string;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    return api != null && api.getPendingRequestId() == null && api.getSource() === api.getSnapshotSource();
  })).toBe(true);
  await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await client.send("HeapProfiler.collectGarbage");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await client.send("HeapProfiler.collectGarbage");
  const heap = await client.send("Runtime.getHeapUsage");
  const dom = await client.send("Memory.getDOMCounters");
  return { label, usedHeapBytes: heap.usedSize, backingStorageBytes: heap.backingStorageSize ?? 0,
    nodes: dom.nodes, documents: dom.documents, listeners: dom.jsEventListeners };
}

function sourceForRevision(revision: number): string {
  const nodes = Array.from({ length: 24 }, (_, index) =>
    `\\node[draw] at (${index % 10},${Math.floor(index / 10)}) {Label ${revision}-${index}};`);
  // Exercise expansion caches as well as text, parsing and scene replacement.
  return `\\begin{tikzpicture}\n${nodes.join("\n")}\n` +
    `\\foreach \\x in {1,...,12} {\\draw (\\x,0) -- (\\x,1);}\n% revision ${revision}\n\\end{tikzpicture}`;
}

async function command(page: Page, id: string): Promise<void> {
  expect(await page.evaluate(commandId => {
    const api = (window as typeof window & {
      __TIKZ_EDITOR_APP_TEST_API__?: { runCommand: (id: string) => boolean };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    return api?.runCommand(commandId);
  }, id)).toBe(true);
}

test("retained memory plateaus through edits and document close cycles", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Retained heap measurements require Chromium CDP.");
  test.setTimeout(300_000);
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  const client = await page.context().newCDPSession(page);
  const samples: MemorySample[] = [];
  const renderDurationsMs: number[] = [];
  try {
    // Warm font outlines, render paths, JIT and caches before measuring growth.
    for (let revision = 0; revision < 8; revision++) await setSource(page, sourceForRevision(revision));
    samples.push(await sample(page, client, "warm"));
    for (let batch = 0; batch < 3; batch++) {
      for (let revision = 0; revision < 20; revision++) {
        const startedAt = performance.now();
        await setSource(page, sourceForRevision(100 + batch * 20 + revision));
        renderDurationsMs.push(performance.now() - startedAt);
      }
      samples.push(await sample(page, client, `edits-${(batch + 1) * 20}`));
      console.log(`[memory] completed edit batch ${batch + 1}`);
    }
    for (let batch = 0; batch < 3; batch++) {
      for (let document = 0; document < 6; document++) {
        await command(page, "file.new-document");
        await expect(page.locator("[data-testid^='tab-switch-']")).toHaveCount(2);
        await setSource(page, sourceForRevision(1000 + batch * 6 + document));
        // Include actual CodeMirror undo data, then close/discard the document.
        const editor = page.locator(".cm-content").first();
        await editor.click();
        await page.keyboard.press("Control+End");
        await page.keyboard.type(" % typed edit");
        await command(page, "file.close-document");
        await page.getByTestId("unsaved-discard").click();
        await expect(page.locator("[data-testid^='tab-switch-']")).toHaveCount(1);
      }
      samples.push(await sample(page, client, `closed-${(batch + 1) * 6}`));
      console.log(`[memory] completed close batch ${batch + 1}`);
    }
    const firstSettled = samples[1];
    const last = samples.at(-1);
    if (!firstSettled || !last) throw new Error("Missing memory samples");
    const report = { samples, renderDurationsMs,
      retainedGrowthBytes: last.usedHeapBytes - firstSettled.usedHeapBytes,
      scope: "Chromium main-thread retained JS heap after forced GC; excludes workers, peak allocations and native RSS" };
    fs.mkdirSync(TRACES_DIR, { recursive: true });
    const reportPath = path.join(TRACES_DIR, "memory-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    await testInfo.attach("memory-report", { path: reportPath, contentType: "application/json" });
    if (process.env.TIKZ_MEMORY_HEAP_SNAPSHOT === "1") {
      const snapshotPath = path.join(TRACES_DIR, "memory.heapsnapshot");
      fs.writeFileSync(snapshotPath, "");
      const appendChunk = ({ chunk }: { chunk: string }) => fs.appendFileSync(snapshotPath, chunk);
      client.on("HeapProfiler.addHeapSnapshotChunk", appendChunk);
      try {
        await client.send("HeapProfiler.takeHeapSnapshot");
      } finally {
        client.off("HeapProfiler.addHeapSnapshotChunk", appendChunk);
      }
    }
    console.log(`[memory] ${JSON.stringify(report)}`);
    // A generous regression guard allows bounded cache warmup and engine noise.
    // Inspect the samples when comparing revisions; this is not a zero-leak proof.
    expect(report.retainedGrowthBytes).toBeLessThan(16 * 1024 * 1024);
    expect(last.nodes - firstSettled.nodes).toBeLessThan(2000);
    expect(last.listeners - firstSettled.listeners).toBeLessThan(200);
  } finally {
    await client.detach();
  }
});
