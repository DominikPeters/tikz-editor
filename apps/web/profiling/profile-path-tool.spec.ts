import { test } from "@playwright/test";
import {
  gotoApp,
  interactionLayer,
  openMenuCommand,
  resetStorageBeforeNavigation,
  setSource,
  waitForHitRegions
} from "../e2e/helpers";
import {
  buildLinearDragPath,
  captureProfileVariant,
  performPacedMouseDrag,
  summarizeFrameDurations,
  writeScenarioReport
} from "./framework";
import { getProfilingScenarioById } from "./scenario-registry";

const MANIFEST = getProfilingScenarioById("path-tool");

if (!MANIFEST) {
  throw new Error("Missing profiling manifest for path-tool.");
}

const BUCKET_SOURCE = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (2,2);
  \draw (3,0) rectangle (5,2);
\end{tikzpicture}`;
const TOOL_DRAG_STEP_DELAY_MS = 16;

type ProbeRecord = {
  t: number;
  type: string;
  [key: string]: unknown;
};

type PathToolProbeSnapshot = {
  records: ProbeRecord[];
  sourceRevision: number;
  activeCanvasDragKind: string | null;
  targetState: string | number | null;
  frameDurations: number[];
};

type TargetMode = "fill" | "count";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

function toolbarButton(page: import("@playwright/test").Page, label: string) {
  return page.locator(`[data-tauri-drag-region] button[aria-label="${label}"]`).first();
}

async function installProbe(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const globalLike = window as typeof window & {
      __PW_PATH_TOOL_PROBE__?: {
        configureTarget: (selector: string, mode: TargetMode) => void;
        reset: (label: string) => void;
        snapshot: () => PathToolProbeSnapshot;
      };
      __PW_PATH_TOOL_PROBE_INSTALLED__?: boolean;
    };
    if (globalLike.__PW_PATH_TOOL_PROBE_INSTALLED__) {
      return;
    }
    globalLike.__PW_PATH_TOOL_PROBE_INSTALLED__ = true;

    let start = performance.now();
    let records: ProbeRecord[] = [];
    const frameDurations: number[] = [];
    let previousFrameTs: number | null = null;
    let rafId = 0;
    let targetSelector = "";
    let targetMode: TargetMode = "count";
    let lastSourceRevision = Number.NaN;
    let lastActiveDragKind: string | null | undefined = undefined;
    let lastTargetState: string | number | null = null;

    const api = () =>
      (window as typeof window & {
        __TIKZ_EDITOR_APP_TEST_API__?: {
          getSourceRevision?: () => number;
          getActiveCanvasDragKind?: () => string | null;
        };
      }).__TIKZ_EDITOR_APP_TEST_API__;
    const sourceRevision = (): number => api()?.getSourceRevision?.() ?? 0;
    const activeCanvasDragKind = (): string | null => api()?.getActiveCanvasDragKind?.() ?? null;

    const targetState = (): string | number | null => {
      if (!targetSelector) {
        return null;
      }
      if (targetMode === "count") {
        return document.querySelectorAll(targetSelector).length;
      }
      const element = document.querySelector(targetSelector);
      return element?.getAttribute("fill") ?? null;
    };

    const record = (type: string, detail: Record<string, unknown> = {}) => {
      records.push({
        t: performance.now() - start,
        type,
        ...detail
      });
    };

    const sample = (reason: string, includeDomMeasurements = true) => {
      const nextRevision = sourceRevision();
      if (nextRevision !== lastSourceRevision) {
        lastSourceRevision = nextRevision;
        record("source-revision", { reason, sourceRevision: nextRevision });
      }
      const nextActiveDragKind = activeCanvasDragKind();
      if (nextActiveDragKind !== lastActiveDragKind) {
        lastActiveDragKind = nextActiveDragKind;
        record("active-canvas-drag-kind", { reason, activeCanvasDragKind: nextActiveDragKind });
      }

      if (!includeDomMeasurements) {
        return;
      }

      const nextTargetState = targetState();
      if (nextTargetState !== lastTargetState) {
        lastTargetState = nextTargetState;
        record("target-state", { reason, targetState: nextTargetState });
      }
    };

    const observer = new MutationObserver(() => {
      sample("mutation");
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true
    });

    const step = (now: number) => {
      if (previousFrameTs != null) {
        frameDurations.push(Math.max(0, now - previousFrameTs));
      }
      previousFrameTs = now;
      sample("raf", false);
      rafId = window.requestAnimationFrame(step);
    };
    rafId = window.requestAnimationFrame(step);

    globalLike.__PW_PATH_TOOL_PROBE__ = {
      configureTarget(selector: string, mode: TargetMode) {
        targetSelector = selector;
        targetMode = mode;
      },
      reset(label: string) {
        start = performance.now();
        records = [];
        frameDurations.length = 0;
        previousFrameTs = null;
        lastSourceRevision = Number.NaN;
        lastActiveDragKind = undefined;
        lastTargetState = null;
        record("reset", { label, targetSelector, targetMode });
        sample("reset");
      },
      snapshot() {
        sample("snapshot");
        return {
          records: [...records],
          sourceRevision: sourceRevision(),
          activeCanvasDragKind: activeCanvasDragKind(),
          targetState: targetState(),
          frameDurations: [...frameDurations]
        };
      }
    };

    window.addEventListener("beforeunload", () => {
      observer.disconnect();
      window.cancelAnimationFrame(rafId);
    });
  });
}

async function configureProbeTarget(
  page: import("@playwright/test").Page,
  selector: string,
  mode: TargetMode
): Promise<void> {
  await page.evaluate(({ nextSelector, nextMode }) => {
    (window as typeof window & {
      __PW_PATH_TOOL_PROBE__?: {
        configureTarget: (selector: string, mode: TargetMode) => void;
      };
    }).__PW_PATH_TOOL_PROBE__?.configureTarget(nextSelector, nextMode);
  }, {
    nextSelector: selector,
    nextMode: mode
  });
}

async function resetProbe(page: import("@playwright/test").Page, label: string): Promise<void> {
  await page.evaluate((nextLabel) => {
    (window as typeof window & {
      __PW_PATH_TOOL_PROBE__?: { reset: (label: string) => void };
    }).__PW_PATH_TOOL_PROBE__?.reset(nextLabel);
  }, label);
}

async function readProbe(page: import("@playwright/test").Page): Promise<PathToolProbeSnapshot> {
  return await page.evaluate(() => {
    const probe = (window as typeof window & {
      __PW_PATH_TOOL_PROBE__?: { snapshot: () => PathToolProbeSnapshot };
    }).__PW_PATH_TOOL_PROBE__;
    if (!probe) {
      throw new Error("Path tool probe not installed.");
    }
    return probe.snapshot();
  });
}

function summarizeProbe(snapshot: PathToolProbeSnapshot) {
  const baselineRevision = snapshot.records.find((record) => record.type === "source-revision");
  const baselineTargetState = snapshot.records.find((record) => record.type === "target-state");
  const firstSourceRewrite = snapshot.records.find((record) =>
    record.type === "source-revision" &&
    record !== baselineRevision &&
    Number(record.sourceRevision ?? 0) > Number(baselineRevision?.sourceRevision ?? 0)
  );
  const firstRenderedUpdate = snapshot.records.find((record) =>
    record.type === "target-state" &&
    record !== baselineTargetState &&
    record.targetState !== baselineTargetState?.targetState
  );
  const firstDragStart = snapshot.records.find((record) =>
    record.type === "active-canvas-drag-kind" && record.activeCanvasDragKind != null
  );
  const firstDragEnd = snapshot.records.find((record) =>
    record.type === "active-canvas-drag-kind" &&
    record.activeCanvasDragKind == null &&
    firstDragStart != null &&
    Number(record.t) > Number(firstDragStart.t)
  );

  return {
    metrics: {
      msToFirstSourceRewrite: firstSourceRewrite ? Number(firstSourceRewrite.t.toFixed(2)) : null,
      msToFirstRenderedUpdate: firstRenderedUpdate ? Number(firstRenderedUpdate.t.toFixed(2)) : null,
      msToDragStart: firstDragStart ? Number(firstDragStart.t.toFixed(2)) : null,
      msToDragEnd: firstDragEnd ? Number(firstDragEnd.t.toFixed(2)) : null,
      finalTargetState: snapshot.targetState
    },
    frameStats: summarizeFrameDurations(snapshot.frameDurations),
    probeSnapshot: snapshot
  };
}

test("profile bucket fill and path creation interactions", async ({ page }, testInfo) => {
  const variants = [];

  await gotoApp(page, "/");
  await setSource(page, BUCKET_SOURCE);
  await installProbe(page);
  await page.getByTestId("toolbar-bucket-color-caret").click();
  await page.getByRole("button", { name: "Bucket fill color red" }).click();
  await waitForHitRegions(page, 2);
  await configureProbeTarget(page, `path[data-source-id="path:0"]:not([data-arrow-tip-kind])`, "fill");
  await resetProbe(page, "bucket-fill-visible");
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "bucket-fill-visible",
    label: "bucket-fill-visible",
    dimensions: {
      interaction: "bucket-fill",
      sourcePanelVisible: true
    },
    run: async () => {
      const region = page.locator("[data-hit-region-target-id]").first();
      const box = await region.boundingBox();
      if (!box) {
        throw new Error("Bucket target bounds missing.");
      }
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(300);
      return summarizeProbe(await readProbe(page));
    }
  }));

  await gotoApp(page, "/");
  await setSource(page, BUCKET_SOURCE);
  await installProbe(page);
  await openMenuCommand(page, "view", "view.toggle-source-panel");
  await page.getByTestId("toolbar-bucket-color-caret").click();
  await page.getByRole("button", { name: "Bucket fill color red" }).click();
  await waitForHitRegions(page, 2);
  await configureProbeTarget(page, `path[data-source-id="path:0"]:not([data-arrow-tip-kind])`, "fill");
  await resetProbe(page, "bucket-fill-source-hidden");
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "bucket-fill-source-hidden",
    label: "bucket-fill-source-hidden",
    dimensions: {
      interaction: "bucket-fill",
      sourcePanelVisible: false
    },
    run: async () => {
      const region = page.locator("[data-hit-region-target-id]").first();
      const box = await region.boundingBox();
      if (!box) {
        throw new Error("Bucket target bounds missing.");
      }
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(300);
      return summarizeProbe(await readProbe(page));
    }
  }));

  await gotoApp(page, "/");
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);
  await installProbe(page);
  await toolbarButton(page, "Path").click();
  await configureProbeTarget(page, "[data-hit-region-target-id]", "count");
  await resetProbe(page, "path-create-visible");
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "path-create-visible",
    label: "path-create-visible",
    dimensions: {
      interaction: "multi-segment-path-create",
      sourcePanelVisible: true
    },
    run: async () => {
      const layer = interactionLayer(page);
      const box = await layer.boundingBox();
      if (!box) {
        throw new Error("Canvas interaction layer bounds missing.");
      }
      await page.mouse.click(box.x + 120, box.y + 120);
      await page.mouse.click(box.x + 200, box.y + 120);
      await page.mouse.click(box.x + 200, box.y + 180);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      return summarizeProbe(await readProbe(page));
    }
  }));

  await gotoApp(page, "/");
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);
  await installProbe(page);
  await toolbarButton(page, "Rect").click();
  await configureProbeTarget(page, "[data-hit-region-target-id]", "count");
  await resetProbe(page, "rect-drag-create-visible");
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "rect-drag-create-visible",
    label: "rect-drag-create-visible",
    dimensions: {
      interaction: "rectangle-drag-create",
      sourcePanelVisible: true
    },
    run: async () => {
      const layer = interactionLayer(page);
      const box = await layer.boundingBox();
      if (!box) {
        throw new Error("Canvas interaction layer bounds missing.");
      }
      await performPacedMouseDrag(
        page,
        buildLinearDragPath(
          { x: box.x + 120, y: box.y + 120 },
          180,
          110,
          28
        ),
        TOOL_DRAG_STEP_DELAY_MS
      );
      await page.waitForTimeout(300);
      return summarizeProbe(await readProbe(page));
    }
  }));

  const reportPath = writeScenarioReport(MANIFEST, testInfo, variants);
  console.log(`[profiling] wrote ${reportPath}`);
});
