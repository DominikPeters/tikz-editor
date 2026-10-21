import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { gotoApp, resetStorageBeforeNavigation } from "../e2e/helpers";
import { captureProfileVariant, summarizeFrameDurations, writeScenarioReport, type ProfilingVariantReport } from "./framework";
import { PAPER_PATH } from "./helpers";
import { getProfilingScenarioById } from "./scenario-registry";

/**
 * The same everyday operations on documents of increasing size, so costs
 * that grow with the document (rather than with the edit) stand out. Each
 * latency runs from the input to the first paint after the canvas has caught
 * up with the source.
 */
const MANIFEST = getProfilingScenarioById("scale");
if (!MANIFEST) throw new Error("Missing profiling manifest for scale.");

type DocumentCase = {
  id: string;
  label: string;
  source: string;
  kind: "picture" | "paper" | "deck";
};

/** The first line of the first picture whose node text ends the line (`{...};`): typing goes before its `}`. */
function typingLine(source: string): number | null {
  const start = source.indexOf("\\begin{tikzpicture}");
  if (start < 0) return null;
  const lines = source.split("\n");
  const firstLine = source.slice(0, start).split("\n").length - 1;
  for (let index = firstLine; index < lines.length; index++) {
    if (lines[index].includes("\\end{tikzpicture}")) return null;
    if (/\{[^{}]*\};\s*$/u.test(lines[index])) return index;
  }
  return null;
}

function picture(statements: number): string {
  const lines: string[] = [];
  for (let index = 0; index < statements; index++) {
    const x = (index % 20) * 1.5;
    const y = Math.floor(index / 20) * -1.5;
    switch (index % 5) {
      case 0: lines.push(`  \\draw[thick, fill=blue!${10 + (index % 7) * 10}] (${x},${y}) rectangle ++(1,1);`); break;
      case 1: lines.push(`  \\node[draw, circle] (n${index}) at (${x + 0.5},${y + 0.5}) {$x_{${index}}$};`); break;
      case 2: lines.push(`  \\draw[->, red] (${x},${y}) .. controls (${x + 0.5},${y + 1}) .. (${x + 1},${y});`); break;
      case 3: lines.push(`  \\node[align=center] at (${x + 0.5},${y + 0.5}) {Label ${index}\\\\second line};`); break;
      default: lines.push(`  \\begin{scope}[shift={(${x},${y})}] \\foreach \\k in {0,1,2} { \\draw (\\k*0.3,0) -- (\\k*0.3,1); } \\end{scope}`);
    }
  }
  return `\\begin{tikzpicture}\n${lines.join("\n")}\n\\end{tikzpicture}`;
}

function deck(frames: number): string {
  const body = Array.from({ length: frames }, (_, index) => String.raw`\section{Part ${index}}
\begin{frame}{Slide ${index}}
  \begin{itemize}
    \item<1-> A first point with $a_${index} + b^2$ inline.
    \item<2-> A second point, \textbf{bold} and \emph{emphasised}.
  \end{itemize}
  \begin{tikzpicture}
    \draw[fill=blue!20] (0,0) rectangle (2,1);
    \node at (1,0.5) {Box ${index}};
  \end{tikzpicture}
\end{frame}`).join("\n\n");
  return `\\documentclass{beamer}\n\\usetheme{Madrid}\n\\title{Scale deck}\n\\begin{document}\n${body}\n\\end{document}\n`;
}

function paperWithImage(): string {
  return readFileSync(PAPER_PATH, "utf8").replace("\\begin{document}", "\\begin{document}\n\\includegraphics[width=3cm]{figure.png}\n");
}

const DOCUMENTS: DocumentCase[] = [
  { id: "picture-100", label: "Picture, 100 statements", source: picture(100), kind: "picture" },
  { id: "picture-500", label: "Picture, 500 statements", source: picture(500), kind: "picture" },
  { id: "paper", label: "Paper (150 KB) with an image", source: paperWithImage(), kind: "paper" },
  { id: "deck-40", label: "Deck, 40 frames", source: deck(40), kind: "deck" },
];

type Metrics = Record<string, number | string | null>;

async function installHelpers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (window as unknown as { __TIKZ_EDITOR_APP_TEST_API__: Record<string, (...args: unknown[]) => unknown> }).__TIKZ_EDITOR_APP_TEST_API__;
    const paint = () => new Promise<void>((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
    const settled = () => api.getSnapshotSource() === api.getSource() && api.getPendingRequestId() == null;
    const settle = async (timeoutMs = 60_000) => {
      const started = performance.now();
      // A request may start a moment after the input; give it one frame.
      await paint();
      while (!settled()) {
        if (performance.now() - started > timeoutMs) throw new Error("canvas did not catch up");
        await new Promise((resolve) => setTimeout(resolve, 4));
      }
      await paint();
    };
    const median = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    };
    const viewport = () => {
      const svg = document.querySelector("[data-hit-region-target-id]")?.closest("svg")
        ?? document.querySelector("[data-testid=canvas-viewport] svg");
      return (svg?.parentElement ?? document.querySelector("[data-testid=canvas-viewport]")) as HTMLElement;
    };
    (window as unknown as { __scale: unknown }).__scale = { api, paint, settle, median, viewport };
  });
}

type ScaleHelpers = {
  api: Record<string, (...args: unknown[]) => unknown>;
  paint: () => Promise<void>;
  settle: (timeoutMs?: number) => Promise<void>;
  median: (values: number[]) => number | null;
  viewport: () => HTMLElement;
};

// Heap readings need CDP, so other browsers report timings only.
async function heapMb(page: Page): Promise<number | null> {
  if (page.context().browser()?.browserType().name() !== "chromium") return null;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = await cdp.send("Runtime.getHeapUsage");
  await cdp.detach();
  return Math.round(usedSize / 1024 / 1024 * 10) / 10;
}

async function measureDocument(page: Page, doc: DocumentCase): Promise<Metrics> {
  const metrics: Metrics = {};
  const progress = (phase: string) => { if (process.env.TIKZ_PROFILE_VERBOSE === "1") console.log(`[scale] ${doc.id}: ${phase}`, JSON.stringify(metrics)); };
  metrics.sourceKb = Math.round(doc.source.length / 1024);
  metrics.heapBeforeOpenMb = await heapMb(page);

  metrics.openMs = await page.evaluate(async (source) => {
    const scale = (window as unknown as { __scale: ScaleHelpers }).__scale;
    const started = performance.now();
    scale.api.setSource(source);
    await scale.settle(120_000);
    return Math.round(performance.now() - started);
  }, doc.source);
  progress("opened");
  // Fonts, thumbnails and deck prewarming settle after the first paint.
  await page.waitForTimeout(1500);
  metrics.heapAfterOpenMb = await heapMb(page);

  Object.assign(metrics, await page.evaluate(async (kind) => {
    const scale = (window as unknown as { __scale: ScaleHelpers }).__scale;
    const result: Record<string, number | null> = {};
    const time = async (action: () => unknown, wait: () => Promise<void> = scale.paint) => {
      const started = performance.now();
      action();
      await wait();
      return performance.now() - started;
    };
    const viewport = scale.viewport();
    const rect = viewport.getBoundingClientRect();
    const center = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true };

    if (kind !== "deck") {
      result.selectAllMs = Math.round(await time(() => scale.api.selectAllElements()));
      result.clearSelectionMs = Math.round(await time(() => scale.api.clearSelection()));
    }

    const hovers: number[] = [];
    for (let index = 0; index < 30; index++) {
      const x = rect.left + rect.width * (0.1 + 0.8 * ((index * 7) % 30) / 30);
      const y = rect.top + rect.height * (0.1 + 0.8 * ((index * 11) % 30) / 30);
      const target = document.elementFromPoint(x, y) ?? viewport;
      hovers.push(await time(() => {
        target.dispatchEvent(new PointerEvent("pointerover", { clientX: x, clientY: y, bubbles: true, pointerType: "mouse" }));
        target.dispatchEvent(new PointerEvent("pointerenter", { clientX: x, clientY: y, pointerType: "mouse" }));
        target.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true, pointerType: "mouse" }));
      }));
    }
    result.hoverMedianMs = scale.median(hovers);

    const zooms: number[] = [];
    const pans: number[] = [];
    for (let index = 0; index < 16; index++) {
      zooms.push(await time(() => viewport.dispatchEvent(new WheelEvent("wheel", { ...center, deltaY: index % 2 ? 8 : -8, ctrlKey: true }))));
    }
    for (let index = 0; index < 16; index++) {
      pans.push(await time(() => viewport.dispatchEvent(new WheelEvent("wheel", { ...center, deltaY: index % 2 ? 24 : -24 }))));
    }
    result.zoomTickMedianMs = scale.median(zooms);
    result.panTickMedianMs = scale.median(pans);

    if (kind !== "deck") {
      const ids = scale.api.getSceneSourceIds() as string[];
      const target = ids[Math.floor(ids.length / 2)];
      scale.api.selectSourceIds([target]);
      await scale.paint();
      result.flipCommitMs = Math.round(await time(() => scale.api.runCommand("edit.flip-horizontal", "menu"), () => scale.settle()));
      result.undoMs = Math.round(await time(() => scale.api.runCommand("edit.undo", "menu"), () => scale.settle()));
      result.redoMs = Math.round(await time(() => scale.api.runCommand("edit.redo", "menu"), () => scale.settle()));
      scale.api.clearSelection();
    }
    for (const key of Object.keys(result)) {
      const value = result[key];
      if (typeof value === "number") result[key] = Math.round(value * 10) / 10;
    }
    return result;
  }, doc.kind));

  progress("interactions");
  // Source typing through CodeMirror: each keystroke until the canvas caught up.
  const line = typingLine(doc.source);
  if (line != null) {
    // Before the line's closing `}`: CodeMirror renders only visible lines, so
    // place the cursor through its view rather than by clicking a line.
    const placed = await page.evaluate((lineIndex) => {
      const source = (window as unknown as { __scale: ScaleHelpers }).__scale.api.getSource() as string;
      const anchor = source.split("\n").slice(0, lineIndex + 1).join("\n").lastIndexOf("}");
      type View = { dispatch: (spec: unknown) => void; focus: () => void };
      // CodeMirror's content element links back to its view (`cmTile` in current versions).
      const content = document.querySelector<HTMLElement & { cmTile?: { view?: View }; cmView?: { view?: View } }>(".cm-content");
      const view = content?.cmTile?.view ?? content?.cmView?.view;
      if (!view) return false;
      view.dispatch({ selection: { anchor }, scrollIntoView: true });
      view.focus();
      return true;
    }, line);
    if (placed) {
      const keystrokes: number[] = [];
      for (const character of "abcdefgh") {
        const started = Date.now();
        await page.keyboard.type(character);
        await page.evaluate(async () => { await (window as unknown as { __scale: ScaleHelpers }).__scale.settle(); });
        keystrokes.push(Date.now() - started);
      }
      keystrokes.sort((a, b) => a - b);
      metrics.typingKeystrokeMedianMs = keystrokes[Math.floor(keystrokes.length / 2)];
      metrics.typingKeystrokeMaxMs = keystrokes.at(-1) ?? null;
    }
  }

  progress("typed");
  // A burst of commits, to see what each edit retains.
  if (doc.kind !== "deck") {
    await page.evaluate(async () => {
      const scale = (window as unknown as { __scale: ScaleHelpers }).__scale;
      const ids = scale.api.getSceneSourceIds() as string[];
      for (let index = 0; index < 20; index++) {
        scale.api.selectSourceIds([ids[(index * 13) % ids.length]]);
        scale.api.runCommand("edit.flip-horizontal", "menu");
        await scale.settle();
      }
      scale.api.clearSelection();
    });
    metrics.heapAfter20EditsMb = await heapMb(page);
  }
  return metrics;
}

test("operations across document sizes", async ({ page }, testInfo) => {
  test.setTimeout(15 * 60_000);
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
  await installHelpers(page);
  const variants: ProfilingVariantReport<Metrics, null>[] = [];
  // SCALE_DOCUMENTS=paper,deck-40 runs a subset.
  const only = process.env.SCALE_DOCUMENTS?.split(",");
  for (const doc of DOCUMENTS.filter((candidate) => !only || only.includes(candidate.id))) {
    variants.push(await captureProfileVariant<Metrics, null>({
      page,
      scenarioId: MANIFEST.id,
      variantId: doc.id,
      label: doc.label,
      dimensions: { kind: doc.kind, sourceChars: doc.source.length },
      run: async () => {
        const metrics = await measureDocument(page, doc);
        console.log(doc.id, JSON.stringify(metrics));
        return { metrics, frameStats: summarizeFrameDurations([]), probeSnapshot: null };
      }
    }));
  }
  const reportPath = writeScenarioReport(MANIFEST, testInfo, variants);
  expect(reportPath).toContain("scale");
});
