import fs from "node:fs";
import path from "node:path";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { gotoApp, resetStorageBeforeNavigation, setSource } from "../e2e/helpers";
import { TRACES_DIR } from "./helpers";

type AppApi = {
  getSource: () => string;
  getSnapshotSource: () => string;
  getPendingRequestId: () => string | null;
  getSceneSourceIds: () => string[];
  selectSourceIds: (ids: string[]) => void;
  runCommand: (id: string) => boolean;
};
type PanelSample = {
  cycle: number;
  hidden: boolean;
  heapBytes: number;
  nodes: number;
  listeners: number;
  attachedElements: number;
  editorCount: number;
};
type KindSample = PanelSample & { visibilityListeners: number };

const source = "\\begin{tikzpicture}\n\\draw[thick,magenta] (0,0) -- (4,0);\n" +
  Array.from({ length: 500 }, (_, index) => {
    const x = index % 20, y = -1 - Math.floor(index / 20);
    return index % 3 === 0
      ? `\\node[draw] (n${index}) at (${x},${y}) {$x_{${index}}$};`
      : `\\draw[blue] (${x},${y}) rectangle ++(.7,.6);`;
  }).join("\n") + "\n\\end{tikzpicture}";

async function togglePanels(page: Page): Promise<void> {
  for (const id of ["view.toggle-source-panel", "view.toggle-inspector-panel"]) {
    expect(await page.evaluate(command =>
      (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__: AppApi }).__TIKZ_EDITOR_APP_TEST_API__.runCommand(command), id)).toBe(true);
  }
}

async function sample(page: Page, client: CDPSession, cycle: number, hidden: boolean): Promise<PanelSample> {
  await expect(page.locator(".cm-editor")).toHaveCount(hidden ? 0 : 1);
  await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await client.send("HeapProfiler.collectGarbage");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await client.send("HeapProfiler.collectGarbage");
  const heap = await client.send("Runtime.getHeapUsage");
  const dom = await client.send("Memory.getDOMCounters");
  const attached = await page.evaluate(() => ({
    attachedElements: document.querySelectorAll("*").length,
    editorCount: document.querySelectorAll(".cm-editor").length
  }));
  return { cycle, hidden, heapBytes: heap.usedSize, nodes: dom.nodes, listeners: dom.jsEventListeners, ...attached };
}

test("panel remounts plateau through repeated dense-document hide/show cycles", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Retained memory measurements require CDP");
  test.setTimeout(180_000);
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, source);
  await page.evaluate(() => {
    const api = (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__: AppApi }).__TIKZ_EDITOR_APP_TEST_API__;
    api.selectSourceIds(api.getSceneSourceIds().slice(0, 1));
  });
  await expect.poll(() => page.evaluate(() => {
    const api = (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__: AppApi }).__TIKZ_EDITOR_APP_TEST_API__;
    return api.getPendingRequestId() == null && api.getSource() === api.getSnapshotSource();
  })).toBe(true);
  const client = await page.context().newCDPSession(page);
  const samples: PanelSample[] = [];
  try {
    samples.push(await sample(page, client, 0, false));
    for (let cycle = 1; cycle <= 20; cycle++) {
      await togglePanels(page);
      if ([1, 4, 12, 20].includes(cycle)) samples.push(await sample(page, client, cycle, true));
      await togglePanels(page);
      if ([1, 4, 12, 20].includes(cycle)) {
        samples.push(await sample(page, client, cycle, false));
        console.log(`[memory-panels] ${JSON.stringify(samples.slice(-2))}`);
      }
    }
    const report = { sourceCharacters: source.length, cycles: 20, samples,
      scope: "Production Chromium main-thread retained memory; each cycle unmounts and remounts source and inspector panels" };
    fs.mkdirSync(TRACES_DIR, { recursive: true });
    const reportPath = path.join(TRACES_DIR, "memory-panels-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    await testInfo.attach("memory-panels", { path: reportPath, contentType: "application/json" });
    for (const hidden of [true, false]) {
      const first = samples.find(entry => entry.cycle === 4 && entry.hidden === hidden);
      const last = samples.find(entry => entry.cycle === 20 && entry.hidden === hidden);
      if (!first || !last) throw new Error("Missing panel memory sample");
      expect(last.nodes - first.nodes).toBeLessThan(500);
      expect(last.listeners - first.listeners).toBeLessThan(100);
    }
  } finally {
    await client.detach();
  }
});

async function visibilityListenerCount(client: CDPSession): Promise<number> {
  const objectGroup = "memory-panel-document-listeners";
  try {
    const { result } = await client.send("Runtime.evaluate", { expression: "document", objectGroup });
    if (!result.objectId) throw new Error("Missing document remote object");
    const { listeners } = await client.send("DOMDebugger.getEventListeners", { objectId: result.objectId });
    return listeners.filter(listener => listener.type === "visibilitychange").length;
  } finally {
    await client.send("Runtime.releaseObjectGroup", { objectGroup });
  }
}

test("document-kind switches release prior layout listeners and DOM", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Retained memory measurements require CDP");
  test.setTimeout(180_000);
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, source);
  const beamer = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Layout memory probe}
Text and inline mathematics $x_1+y_2$.
\begin{itemize}\item One\item Two\item Three\end{itemize}
\end{frame}
\end{document}`;
  const client = await page.context().newCDPSession(page);
  const samples: KindSample[] = [];
  const measure = async (cycle: number) => {
    const current = await sample(page, client, cycle, false);
    samples.push({ ...current, visibilityListeners: await visibilityListenerCount(client) });
    console.log(`[memory-layout-kinds] ${JSON.stringify(samples.at(-1))}`);
  };
  try {
    await measure(0);
    for (let cycle = 1; cycle <= 12; cycle++) {
      await setSource(page, beamer);
      await setSource(page, source);
      if ([1, 4, 8, 12].includes(cycle)) await measure(cycle);
    }
    const report = { cycles: 12, samples,
      scope: "Production Chromium main-thread retained memory and document visibilitychange listeners after TikZ/Beamer layout round trips" };
    fs.mkdirSync(TRACES_DIR, { recursive: true });
    const reportPath = path.join(TRACES_DIR, "memory-layout-kinds-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    await testInfo.attach("memory-layout-kinds", { path: reportPath, contentType: "application/json" });
    const first = samples[0], last = samples.at(-1);
    if (!first || !last) throw new Error("Missing layout memory sample");
    // Both samples show the same TikZ layout. Each extra listener here roots
    // an abandoned FlexLayout instance and its old layout state.
    expect(last.visibilityListeners).toBe(first.visibilityListeners);
    expect(last.nodes - first.nodes).toBeLessThan(500);
  } finally {
    await client.detach();
  }
});

test("switching open TikZ and Beamer tabs preserves their canvases without accumulating layouts", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Listener measurements require CDP");
  test.setTimeout(180_000);
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await setSource(page, source);
  const expectDenseScene = async () => {
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__: AppApi }).__TIKZ_EDITOR_APP_TEST_API__.getSceneSourceIds().length)).toBeGreaterThanOrEqual(500);
  };
  await expectDenseScene();
  const firstTab = await page.locator("[data-testid^='tab-switch-']").first().getAttribute("data-testid");
  expect(await page.evaluate(() =>
    (window as typeof window & { __TIKZ_EDITOR_APP_TEST_API__: AppApi }).__TIKZ_EDITOR_APP_TEST_API__.runCommand("file.new-document"))).toBe(true);
  await expect(page.locator("[data-testid^='tab-switch-']")).toHaveCount(2);
  await setSource(page, String.raw`\documentclass{beamer}\begin{document}\begin{frame}{Other tab}Text $x^2$.\end{frame}\end{document}`);
  await page.locator('[data-slide-id="frame:0"] button').first().click();
  const secondTab = await page.locator("[data-testid^='tab-switch-']").last().getAttribute("data-testid");
  if (!firstTab || !secondTab) throw new Error("Missing document tabs");
  const client = await page.context().newCDPSession(page);
  try {
    await page.getByTestId(firstTab).click();
    await expectDenseScene();
    await sample(page, client, 0, false);
    const before = await visibilityListenerCount(client);
    for (let index = 0; index < 12; index++) {
      await page.getByTestId(secondTab).click();
      await expect(page.getByTestId("canvas-svg-layer").locator('[data-part-id="frame:0:background"]')).toHaveCount(1);
      await page.getByTestId(firstTab).click();
      await expectDenseScene();
    }
    await sample(page, client, 12, false);
    expect(await visibilityListenerCount(client)).toBe(before);
  } finally {
    await client.detach();
  }
});
