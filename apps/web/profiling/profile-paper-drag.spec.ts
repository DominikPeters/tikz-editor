import { expect, test } from "@playwright/test";
import { gotoApp, openMenuCommand, readActiveFigureId, readFigureCount } from "../e2e/helpers";
import {
  PAPER_PATH,
  clearSelection,
  resolvePaperTarget,
  resolveVisibleSamplePointForSelector,
  seedWorkspace,
  waitForActiveFigure,
  type PaperTarget
} from "./helpers";
import { captureProfileVariant, writeScenarioReport } from "./framework";
import { getProfilingScenarioById } from "./scenario-registry";

const TARGET_DRAW_LINES = [
  String.raw`\draw[thick,->,magenta] (0.0, 0.0) -- (0.0, 4.5);`,
  String.raw`\draw[thick,->] (0.0, 0.0) -- (0.0, 4.5);`
] as const;
const DRAG_DX_PX = 80;
const DRAG_DY_PX = -60;
const DRAG_STEPS = 12;
const DRAG_STEP_DELAY_MS = 16;
const VERBOSE_PROFILE_LOGS = process.env.TIKZ_PROFILE_VERBOSE === "1";

type ProbeRecord = {
  t: number;
  type: string;
  [key: string]: unknown;
};

type FrameStats = {
  count: number;
  p95Ms: number | null;
  maxMs: number | null;
  avgMs: number | null;
};

type ProbeSnapshot = {
  records: ProbeRecord[];
  sourcePanelVisible: boolean;
  handleCount: number;
  computingTextCount: number;
  statusBarText: string | null;
  endpointHandleCenter: { x: number; y: number } | null;
  frameStats: FrameStats;
};

type DebugState = {
  activeFigureId: string | null;
  figureCount: number;
  canvasNoSvgText: string | null;
  computingTextCount: number;
  sourcePanelVisible: boolean;
  matchingMagentaPathCount: number;
  matchingAnyPathCount: number;
  handleCount: number;
  statusBarText: string | null;
};

const MANIFEST = getProfilingScenarioById("paper-drag");

if (!MANIFEST) {
  throw new Error("Missing profiling manifest for paper-drag.");
}


async function installProbe(page: import("@playwright/test").Page, targetSourceId: string): Promise<void> {
  await page.evaluate((sourceId) => {
    const globalLike = window as typeof window & {
      __PW_DRAG_PROFILE_PROBE__?: {
        reset: (label: string) => void;
        snapshot: () => ProbeSnapshot;
      };
      __PW_DRAG_PROFILE_PROBE_INSTALLED__?: boolean;
    };
    if (globalLike.__PW_DRAG_PROFILE_PROBE_INSTALLED__) {
      return;
    }
    globalLike.__PW_DRAG_PROFILE_PROBE_INSTALLED__ = true;

    let start = performance.now();
    let records: ProbeRecord[] = [];
    let frameDurations: number[] = [];
    let previousFrameTs: number | null = null;
    let rafId = 0;
    let lastHandleCount = -1;
    let lastComputingTextCount = -1;
    let lastStatusBarText = "__uninitialized__";
    let lastHandleCenter: { x: number; y: number } | null = null;
    const onDragPatchModeFull = (event: Event) => {
      const detail = event instanceof CustomEvent && event.detail && typeof event.detail === "object"
        ? event.detail as Record<string, unknown>
        : {};
      record("drag-patch-mode-full", detail);
    };
    window.addEventListener("tikz-editor:drag-patch-mode-full", onDragPatchModeFull);

    const sourcePanelVisible = (): boolean => document.querySelector(".cm-editor") != null;
    const handleCount = (): number => document.querySelectorAll("[data-handle-kind]").length;
    const computingTextCount = (): number =>
      [...document.querySelectorAll("body *")]
        .map((node) => node.textContent?.trim() ?? "")
        .filter(Boolean)
        .filter((text) => text.includes("Computing…")).length;
    const statusBarText = (): string | null =>
      document.querySelector("[data-testid='status-bar'], [class*='statusBar']")?.textContent?.trim() ?? null;
    const endpointHandleCenter = (): { x: number; y: number } | null => {
      const handles = [...document.querySelectorAll(
        `[data-handle-kind="move-handle"][data-source-id="${sourceId}"]`
      )] as SVGGraphicsElement[];
      const visible = handles
        .map((handle) => {
          const rect = handle.getBoundingClientRect();
          const style = window.getComputedStyle(handle);
          const ok =
            (rect.width > 0 || rect.height > 0) &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            Number(style.opacity || "1") > 0;
          return ok
            ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
            : null;
        })
        .filter((point): point is { x: number; y: number } => point != null)
        .sort((left, right) => left.y - right.y || left.x - right.x);
      return visible[0] ?? null;
    };

    const record = (type: string, detail: Record<string, unknown> = {}) => {
      records.push({
        t: performance.now() - start,
        type,
        ...detail
      });
    };

    const sample = (reason: string) => {
      const nextHandleCount = handleCount();
      if (nextHandleCount !== lastHandleCount) {
        lastHandleCount = nextHandleCount;
        record("handle-count", { reason, handleCount: nextHandleCount });
      }

      const nextComputingTextCount = computingTextCount();
      if (nextComputingTextCount !== lastComputingTextCount) {
        lastComputingTextCount = nextComputingTextCount;
        record("computing-text-count", { reason, computingTextCount: nextComputingTextCount });
      }

      const nextStatusBarText = statusBarText();
      if (nextStatusBarText !== lastStatusBarText) {
        lastStatusBarText = nextStatusBarText;
        record("status-bar-text", { reason, statusBarText: nextStatusBarText });
      }

      const nextHandleCenter = endpointHandleCenter();
      if (
        (nextHandleCenter == null) !== (lastHandleCenter == null) ||
        (nextHandleCenter &&
          lastHandleCenter &&
          (Math.abs(nextHandleCenter.x - lastHandleCenter.x) > 0.01 ||
            Math.abs(nextHandleCenter.y - lastHandleCenter.y) > 0.01))
      ) {
        lastHandleCenter = nextHandleCenter ? { ...nextHandleCenter } : null;
        record("endpoint-handle-center", {
          reason,
          x: nextHandleCenter?.x ?? null,
          y: nextHandleCenter?.y ?? null
        });
      }
    };

    const observer = new MutationObserver(() => {
      sample("mutation");
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: false
    });

    const step = (now: number) => {
      if (previousFrameTs != null) {
        frameDurations.push(Math.max(0, now - previousFrameTs));
      }
      previousFrameTs = now;
      rafId = window.requestAnimationFrame(step);
    };
    rafId = window.requestAnimationFrame(step);

    const summarizeFrames = (): FrameStats => {
      if (frameDurations.length === 0) {
        return {
          count: 0,
          p95Ms: null,
          maxMs: null,
          avgMs: null
        };
      }
      const sorted = [...frameDurations].sort((a, b) => a - b);
      const index = (sorted.length - 1) * 0.95;
      const lower = Math.floor(index);
      const upper = Math.ceil(index);
      const p95 =
        lower === upper
          ? sorted[lower] ?? null
          : (sorted[lower] ?? 0) * (1 - (index - lower)) + (sorted[upper] ?? 0) * (index - lower);
      const total = frameDurations.reduce((sum, value) => sum + value, 0);
      return {
        count: frameDurations.length,
        p95Ms: p95,
        maxMs: Math.max(...frameDurations),
        avgMs: total / frameDurations.length
      };
    };

    sample("install");

    globalLike.__PW_DRAG_PROFILE_PROBE__ = {
      reset(label: string) {
        start = performance.now();
        records = [];
        frameDurations = [];
        previousFrameTs = null;
        lastHandleCount = -1;
        lastComputingTextCount = -1;
        lastStatusBarText = "__uninitialized__";
        lastHandleCenter = null;
        record("reset", { label, sourcePanelVisible: sourcePanelVisible() });
        sample("reset");
      },
      snapshot() {
        sample("snapshot");
        return {
          records: [...records],
          sourcePanelVisible: sourcePanelVisible(),
          handleCount: handleCount(),
          computingTextCount: computingTextCount(),
          statusBarText: statusBarText(),
          endpointHandleCenter: endpointHandleCenter(),
          frameStats: summarizeFrames()
        };
      }
    };

    window.addEventListener("beforeunload", () => {
      observer.disconnect();
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("tikz-editor:drag-patch-mode-full", onDragPatchModeFull);
    });
  }, targetSourceId);
}


async function resetProbe(page: import("@playwright/test").Page, label: string): Promise<void> {
  await page.evaluate((nextLabel) => {
    const globalLike = window as typeof window & {
      __PW_DRAG_PROFILE_PROBE__?: { reset: (label: string) => void };
    };
    globalLike.__PW_DRAG_PROFILE_PROBE__?.reset(nextLabel);
  }, label);
}

async function readProbe(page: import("@playwright/test").Page): Promise<ProbeSnapshot> {
  return await page.evaluate(() => {
    const globalLike = window as typeof window & {
      __PW_DRAG_PROFILE_PROBE__?: { snapshot: () => ProbeSnapshot };
    };
    if (!globalLike.__PW_DRAG_PROFILE_PROBE__) {
      throw new Error("Probe not installed.");
    }
    return globalLike.__PW_DRAG_PROFILE_PROBE__.snapshot();
  });
}

async function readDebugState(
  page: import("@playwright/test").Page,
  target: PaperTarget
): Promise<DebugState> {
  const activeFigureId = await readActiveFigureId(page);
  const figureCount = await readFigureCount(page);
  return await page.evaluate((params) => {
    const targetSelector = `path[data-source-id="${params.targetSourceId}"]`;
    const magentaSelector = `${targetSelector}[stroke="#ff00ff"]:not([data-arrow-tip-kind])`;
    const canvasNoSvg = document.querySelector("[data-testid='canvas-no-svg']");
    const statusBar = document.querySelector("[data-testid='status-bar'], [class*='statusBar']");
    const allText = [...document.querySelectorAll("body *")]
      .map((node) => node.textContent?.trim() ?? "")
      .filter(Boolean);
    const computingTextCount = allText.filter((text) => text.includes("Computing…")).length;
    return {
      activeFigureId: params.activeFigureId,
      figureCount: params.figureCount,
      canvasNoSvgText: canvasNoSvg?.textContent?.trim() ?? null,
      computingTextCount,
      sourcePanelVisible: document.querySelector(".cm-editor") != null,
      matchingMagentaPathCount: document.querySelectorAll(magentaSelector).length,
      matchingAnyPathCount: document.querySelectorAll(targetSelector).length,
      handleCount: document.querySelectorAll("[data-handle-kind]").length,
      statusBarText: statusBar?.textContent?.trim() ?? null
    } satisfies DebugState;
  }, { targetSourceId: target.targetSourceId, activeFigureId, figureCount });
}

function printDebug(label: string, state: DebugState): void {
  if (!VERBOSE_PROFILE_LOGS) {
    return;
  }
  console.log(`[paper-drag] ${label}: ${JSON.stringify(state)}`);
}

async function waitForTargetFigureReady(
  page: import("@playwright/test").Page,
  target: PaperTarget
): Promise<void> {
  await waitForActiveFigure(page, target);
  printDebug("after-figure-activate", await readDebugState(page, target));

  await expect.poll(async () => {
    const state = await readDebugState(page, target);
    printDebug("ready-poll", state);
    return {
      canvasNoSvgText: state.canvasNoSvgText,
      matchingMagentaPathCount: state.matchingMagentaPathCount
    };
  }, {
    timeout: 120_000,
    intervals: [250, 500, 1000, 2000, 5000],
    message: "waiting for target figure SVG to render"
  }).toEqual({
    canvasNoSvgText: null,
    matchingMagentaPathCount: 1
  });
}


async function waitForEndpointHandles(
  page: import("@playwright/test").Page,
  targetSourceId: string
): Promise<void> {
  await expect.poll(async () => {
    return await page.evaluate((sourceId) => {
      return document.querySelectorAll(
        `[data-handle-kind="move-handle"][data-source-id="${sourceId}"]`
      ).length;
    }, targetSourceId);
  }, {
    timeout: 10_000,
    intervals: [50, 100, 200, 500],
    message: "waiting for endpoint handles"
  }).toBeGreaterThanOrEqual(2);
}

async function resolveEndpointHandlePoint(
  page: import("@playwright/test").Page,
  targetSourceId: string
): Promise<{ x: number; y: number }> {
  return await page.evaluate((sourceId) => {
    const handles = [...document.querySelectorAll(
      `[data-handle-kind="move-handle"][data-source-id="${sourceId}"]`
    )] as SVGGraphicsElement[];
    const points = handles
      .map((handle) => {
        const rect = handle.getBoundingClientRect();
        const style = window.getComputedStyle(handle);
        const visible =
          (rect.width > 0 || rect.height > 0) &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0;
        return visible
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : null;
      })
      .filter((point): point is { x: number; y: number } => point != null)
      .sort((left, right) => left.y - right.y || left.x - right.x);
    const point = points[0];
    if (!point) {
      throw new Error(`No visible endpoint handle found for ${sourceId}`);
    }
    return point;
  }, targetSourceId);
}

async function performDrag(
  page: import("@playwright/test").Page,
  start: { x: number; y: number },
  dx: number,
  dy: number
): Promise<void> {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= DRAG_STEPS; step += 1) {
    const progress = step / DRAG_STEPS;
    await page.mouse.move(start.x + dx * progress, start.y + dy * progress);
    await page.waitForTimeout(DRAG_STEP_DELAY_MS);
  }
  await page.mouse.up();
}

function summarizeSnapshot(snapshot: ProbeSnapshot, dragDxPx: number, dragDyPx: number) {
  const baselineHandle = snapshot.records.find((record) => record.type === "endpoint-handle-center");
  const baselineX = baselineHandle?.x != null ? Number(baselineHandle.x) : null;
  const baselineY = baselineHandle?.y != null ? Number(baselineHandle.y) : null;
  const firstHandleMove = snapshot.records.find((record) => {
    if (record.type !== "endpoint-handle-center") {
      return false;
    }
    if (baselineX == null || baselineY == null) {
      return false;
    }
    return Math.abs(Number(record.x ?? baselineX) - baselineX) > 0.5 ||
      Math.abs(Number(record.y ?? baselineY) - baselineY) > 0.5;
  });
  const firstComputing = snapshot.records.find(
    (record) => record.type === "computing-text-count" && Number(record.computingTextCount ?? 0) > 0
  );
  const initialStatus = snapshot.records.find((record) => record.type === "status-bar-text");
  const firstStatusChange = snapshot.records.find((record) =>
    record.type === "status-bar-text" &&
    record !== initialStatus &&
    record.statusBarText !== initialStatus?.statusBarText
  );
  const finalHandle = snapshot.endpointHandleCenter;

  return {
    metrics: {
      msToFirstHandleMove: firstHandleMove ? Number(firstHandleMove.t.toFixed(2)) : null,
      msToFirstComputing: firstComputing ? Number(firstComputing.t.toFixed(2)) : null,
      msToFirstStatusChange: firstStatusChange ? Number(firstStatusChange.t.toFixed(2)) : null,
      finalHandleDeltaPx:
        finalHandle != null && baselineX != null && baselineY != null
          ? {
              dx: Number((finalHandle.x - baselineX).toFixed(2)),
              dy: Number((finalHandle.y - baselineY).toFixed(2))
            }
          : null,
      frameP95Ms: snapshot.frameStats.p95Ms != null ? Number(snapshot.frameStats.p95Ms.toFixed(2)) : null,
      frameMaxMs: snapshot.frameStats.maxMs != null ? Number(snapshot.frameStats.maxMs.toFixed(2)) : null,
      frameAvgMs: snapshot.frameStats.avgMs != null ? Number(snapshot.frameStats.avgMs.toFixed(2)) : null,
      frameCount: snapshot.frameStats.count
    },
    frameStats: snapshot.frameStats,
    probeSnapshot: {
      ...snapshot,
      dragDxPx,
      dragDyPx
    }
  };
}

test("profile paper drag for the magenta axis endpoint", async ({ page }, testInfo) => {
  const target = resolvePaperTarget(TARGET_DRAW_LINES);
  if (VERBOSE_PROFILE_LOGS) {
    console.log(
      `[paper-drag] target=${JSON.stringify({
        paperPath: PAPER_PATH,
        targetLine: target.targetLine,
        activeFigureId: target.activeFigureId,
        activeFigureNumber: target.activeFigureNumber,
        targetSourceId: target.targetSourceId,
        dragDxPx: DRAG_DX_PX,
        dragDyPx: DRAG_DY_PX
      })}`
    );
  }
  await seedWorkspace(page, target, "doc-profile-paper-drag");
  await gotoApp(page, "/");
  await installProbe(page, target.targetSourceId);

  printDebug("after-app-load", await readDebugState(page, target));
  await waitForTargetFigureReady(page, target);

  const targetPathSelector =
    `path[data-source-id="${target.targetSourceId}"][stroke="#ff00ff"]:not([data-arrow-tip-kind])`;
  const pathPoint = await resolveVisibleSamplePointForSelector(page, targetPathSelector);
  if (VERBOSE_PROFILE_LOGS) {
    console.log(`[paper-drag] target-point=${JSON.stringify(pathPoint)}`);
  }

  const variants = [];

  async function prepareSelectedPath() {
    const currentPathPoint = await resolveVisibleSamplePointForSelector(page, targetPathSelector);
    if (VERBOSE_PROFILE_LOGS) {
      console.log(`[paper-drag] current-target-point=${JSON.stringify(currentPathPoint)}`);
    }
    await clearSelection(page);
    await page.waitForTimeout(100);
    await page.mouse.click(currentPathPoint.x, currentPathPoint.y);
    await waitForEndpointHandles(page, target.targetSourceId);
  }

  async function runScenario(
    variantId: string,
    label: string,
    dimensions: Record<string, string | number | boolean | null>
  ) {
    await prepareSelectedPath();
    const handlePoint = await resolveEndpointHandlePoint(page, target.targetSourceId);
    if (VERBOSE_PROFILE_LOGS) {
      console.log(`[paper-drag] ${label}-handle-point=${JSON.stringify(handlePoint)}`);
    }
    await resetProbe(page, label);
    variants.push(await captureProfileVariant({
      page,
      scenarioId: MANIFEST.id,
      variantId,
      label,
      dimensions,
      run: async () => {
        await performDrag(page, handlePoint, DRAG_DX_PX, DRAG_DY_PX);
        await page.waitForTimeout(900);
        const snapshot = await readProbe(page);
        return summarizeSnapshot(snapshot, DRAG_DX_PX, DRAG_DY_PX);
      }
    }));
  }

  await runScenario("visible", "drag-visible", {
    sourcePanelVisible: true,
    inspectorPanelVisible: true
  });

  await openMenuCommand(page, "view", "view.toggle-source-panel");
  await openMenuCommand(page, "view", "view.toggle-inspector-panel");
  await runScenario("hidden-both-panels", "drag-hidden-both-panels", {
    sourcePanelVisible: false,
    inspectorPanelVisible: false
  });

  const reportPath = writeScenarioReport(MANIFEST, testInfo, variants);
  console.log(`[paper-drag] wrote ${reportPath}`);
});
