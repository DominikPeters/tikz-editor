import { expect, test } from "@playwright/test";
import {
  clickHitRegion,
  gotoApp,
  interactionLayer,
  resetStorageBeforeNavigation,
  setSource,
  waitForHitRegions
} from "../e2e/helpers";
import {
  buildLinearDragPath,
  buildPolylineDragPath,
  captureProfileVariant,
  performPacedMouseDrag,
  readSourceRevision,
  summarizeFrameDurations,
  writeScenarioReport
} from "./framework";
import { getProfilingScenarioById } from "./scenario-registry";

const MANIFEST = getProfilingScenarioById("basic-drag");

if (!MANIFEST) {
  throw new Error("Missing profiling manifest for basic-drag.");
}

const DRAG_STEP_DELAY_MS = 16;
const LARGE_DOCUMENT_COMMENT_LINE_COUNT = 3000;

type ProbeRecord = {
  t: number;
  type: string;
  [key: string]: unknown;
};

type BasicDragProbeSnapshot = {
  records: ProbeRecord[];
  sourceRevision: number;
  activeCanvasDragKind: string | null;
  handleCount: number;
  hitRegionCount: number;
  frameDurations: number[];
};

function buildLargeDragSource(commentLineCount = LARGE_DOCUMENT_COMMENT_LINE_COUNT): string {
  const lines = [
    String.raw`\begin{tikzpicture}`,
    String.raw`\filldraw[fill=blue!20] (0,0) rectangle (4,2);`
  ];
  for (let index = 0; index < commentLineCount; index += 1) {
    const section = Math.floor(index / 50) + 1;
    lines.push(`  % paper section ${section}: explanatory source line ${index + 1} with references, formulas, and TikZ notes`);
  }
  lines.push(String.raw`\end{tikzpicture}`);
  return lines.join("\n");
}

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

async function installProbe(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const globalLike = window as typeof window & {
      __PW_BASIC_DRAG_PROBE__?: {
        reset: (label: string) => void;
        snapshot: () => BasicDragProbeSnapshot;
      };
      __PW_BASIC_DRAG_PROBE_INSTALLED__?: boolean;
    };
    if (globalLike.__PW_BASIC_DRAG_PROBE_INSTALLED__) {
      return;
    }
    globalLike.__PW_BASIC_DRAG_PROBE_INSTALLED__ = true;

    let start = performance.now();
    let records: ProbeRecord[] = [];
    const frameDurations: number[] = [];
    let previousFrameTs: number | null = null;
    let rafId = 0;
    let lastSourceRevision = Number.NaN;
    let lastActiveDragKind: string | null | undefined = undefined;
    let lastHandleCount = -1;
    let lastHitRegionCount = -1;

    const api = () =>
      (window as typeof window & {
        __TIKZ_EDITOR_APP_TEST_API__?: {
          getSourceRevision?: () => number;
          getActiveCanvasDragKind?: () => string | null;
        };
      }).__TIKZ_EDITOR_APP_TEST_API__;
    const sourceRevision = (): number => api()?.getSourceRevision?.() ?? 0;
    const activeCanvasDragKind = (): string | null => api()?.getActiveCanvasDragKind?.() ?? null;
    const handleCount = (): number => document.querySelectorAll("[data-handle-kind]").length;
    const hitRegionCount = (): number => document.querySelectorAll("[data-hit-region-target-id]").length;

    const record = (type: string, detail: Record<string, unknown> = {}) => {
      records.push({
        t: performance.now() - start,
        type,
        ...detail
      });
    };

    const sample = (reason: string, includeDomMeasurements = true) => {
      const nextSourceRevision = sourceRevision();
      if (nextSourceRevision !== lastSourceRevision) {
        lastSourceRevision = nextSourceRevision;
        record("source-revision", { reason, sourceRevision: nextSourceRevision });
      }

      const nextActiveDragKind = activeCanvasDragKind();
      if (nextActiveDragKind !== lastActiveDragKind) {
        lastActiveDragKind = nextActiveDragKind;
        record("active-canvas-drag-kind", { reason, activeCanvasDragKind: nextActiveDragKind });
      }

      if (!includeDomMeasurements) {
        return;
      }

      const nextHandleCount = handleCount();
      if (nextHandleCount !== lastHandleCount) {
        lastHandleCount = nextHandleCount;
        record("handle-count", { reason, handleCount: nextHandleCount });
      }

      const nextHitRegionCount = hitRegionCount();
      if (nextHitRegionCount !== lastHitRegionCount) {
        lastHitRegionCount = nextHitRegionCount;
        record("hit-region-count", { reason, hitRegionCount: nextHitRegionCount });
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

    globalLike.__PW_BASIC_DRAG_PROBE__ = {
      reset(label: string) {
        start = performance.now();
        records = [];
        frameDurations.length = 0;
        previousFrameTs = null;
        lastSourceRevision = Number.NaN;
        lastActiveDragKind = undefined;
        lastHandleCount = -1;
        lastHitRegionCount = -1;
        record("reset", { label });
        sample("reset");
      },
      snapshot() {
        sample("snapshot");
        return {
          records: [...records],
          sourceRevision: sourceRevision(),
          activeCanvasDragKind: activeCanvasDragKind(),
          handleCount: handleCount(),
          hitRegionCount: hitRegionCount(),
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

async function resetProbe(page: import("@playwright/test").Page, label: string): Promise<void> {
  await page.evaluate((nextLabel) => {
    (window as typeof window & {
      __PW_BASIC_DRAG_PROBE__?: { reset: (label: string) => void };
    }).__PW_BASIC_DRAG_PROBE__?.reset(nextLabel);
  }, label);
}

async function readProbe(page: import("@playwright/test").Page): Promise<BasicDragProbeSnapshot> {
  return await page.evaluate(() => {
    const probe = (window as typeof window & {
      __PW_BASIC_DRAG_PROBE__?: { snapshot: () => BasicDragProbeSnapshot };
    }).__PW_BASIC_DRAG_PROBE__;
    if (!probe) {
      throw new Error("Basic drag probe not installed.");
    }
    return probe.snapshot();
  });
}

function summarizeProbe(snapshot: BasicDragProbeSnapshot, sourceRevisionBefore: number) {
  const firstDragStart = snapshot.records.find((record) =>
    record.type === "active-canvas-drag-kind" && record.activeCanvasDragKind != null
  );
  const firstDragEnd = snapshot.records.find((record) =>
    record.type === "active-canvas-drag-kind" &&
    record.activeCanvasDragKind == null &&
    firstDragStart != null &&
    Number(record.t) > Number(firstDragStart.t)
  );
  const firstSourceRewrite = snapshot.records.find((record) =>
    record.type === "source-revision" &&
    Number(record.sourceRevision ?? 0) > sourceRevisionBefore
  );
  const firstHandleChange = snapshot.records.find((record) =>
    record.type === "handle-count" &&
    Number(record.handleCount ?? 0) !== Number(snapshot.records.find((candidate) => candidate.type === "handle-count")?.handleCount ?? 0)
  );

  return {
    metrics: {
      sourceRevisionDelta: snapshot.sourceRevision - sourceRevisionBefore,
      msToDragStart: firstDragStart ? Number(firstDragStart.t.toFixed(2)) : null,
      msToDragEnd: firstDragEnd ? Number(firstDragEnd.t.toFixed(2)) : null,
      msToFirstSourceRewrite: firstSourceRewrite ? Number(firstSourceRewrite.t.toFixed(2)) : null,
      msToFirstHandleChange: firstHandleChange ? Number(firstHandleChange.t.toFixed(2)) : null,
      finalHandleCount: snapshot.handleCount,
      finalHitRegionCount: snapshot.hitRegionCount
    },
    frameStats: summarizeFrameDurations(snapshot.frameDurations),
    probeSnapshot: snapshot
  };
}

test("profile basic canvas drags", async ({ page }, testInfo) => {
  const variants = [];

  await gotoApp(page, "/");
  await setSource(
    page,
    String.raw`\begin{tikzpicture}
\filldraw[fill=blue!20] (0,0) rectangle (4,2);
\draw[red, thick] (1,1) circle (0.5);
\draw[->] (5,0) -- (7,2);
\end{tikzpicture}`
  );
  await installProbe(page);
  await page.getByRole("button", { name: "Select" }).click();
  await clickHitRegion(page, 0);
  await waitForHitRegions(page);
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "move-element",
    label: "Move Element Drag",
    dimensions: {
      interaction: "drag-element"
    },
    run: async () => {
      await resetProbe(page, "move-element");
      const sourceRevisionBefore = await readSourceRevision(page);
      const hitRegion = page.locator("[data-hit-region-target-id]").first();
      const box = await hitRegion.boundingBox();
      expect(box).toBeTruthy();
      const startX = box!.x + box!.width / 2;
      const startY = box!.y + box!.height / 2;
      await performPacedMouseDrag(
        page,
        buildPolylineDragPath(
          { x: startX, y: startY },
          [
            { dx: 80, dy: 10 },
            { dx: -15, dy: 50 },
            { dx: 55, dy: -20 }
          ],
          12
        ),
        DRAG_STEP_DELAY_MS
      );
      await page.waitForTimeout(300);
      return summarizeProbe(await readProbe(page), sourceRevisionBefore);
    }
  }));

  const largeDragSource = buildLargeDragSource();
  await gotoApp(page, "/");
  await setSource(page, largeDragSource);
  await installProbe(page);
  await page.getByRole("button", { name: "Select" }).click();
  await clickHitRegion(page, 0);
  await waitForHitRegions(page);
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "large-source-move-element",
    label: "Large Source Move Element Drag",
    dimensions: {
      interaction: "drag-element",
      documentLines: largeDragSource.split("\n").length,
      documentLength: largeDragSource.length
    },
    run: async () => {
      await resetProbe(page, "large-source-move-element");
      const sourceRevisionBefore = await readSourceRevision(page);
      const hitRegion = page.locator("[data-hit-region-target-id]").first();
      const box = await hitRegion.boundingBox();
      expect(box).toBeTruthy();
      const startX = box!.x + box!.width / 2;
      const startY = box!.y + box!.height / 2;
      await performPacedMouseDrag(
        page,
        buildPolylineDragPath(
          { x: startX, y: startY },
          [
            { dx: 80, dy: 10 },
            { dx: -15, dy: 50 },
            { dx: 55, dy: -20 }
          ],
          12
        ),
        DRAG_STEP_DELAY_MS
      );
      await page.waitForTimeout(300);
      return summarizeProbe(await readProbe(page), sourceRevisionBefore);
    }
  }));

  await gotoApp(page, "/");
  await setSource(
    page,
    String.raw`\begin{tikzpicture}
\filldraw[fill=blue!20] (0,0) rectangle (4,2);
\end{tikzpicture}`
  );
  await installProbe(page);
  await page.getByRole("button", { name: "Select" }).click();
  await clickHitRegion(page, 0);
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "resize-element",
    label: "Resize Element Drag",
    dimensions: {
      interaction: "resize-element"
    },
    run: async () => {
      await resetProbe(page, "resize-element");
      const resizeHandle = page.locator('[data-handle-kind="resize-element"]').first();
      await expect(resizeHandle).toBeVisible();
      const sourceRevisionBefore = await readSourceRevision(page);
      const box = await resizeHandle.boundingBox();
      expect(box).toBeTruthy();
      const centerX = box!.x + box!.width / 2;
      const centerY = box!.y + box!.height / 2;
      await performPacedMouseDrag(
        page,
        buildPolylineDragPath(
          { x: centerX, y: centerY },
          [
            { dx: 60, dy: 40 },
            { dx: -20, dy: -10 },
            { dx: 45, dy: 20 }
          ],
          12
        ),
        DRAG_STEP_DELAY_MS
      );
      await page.waitForTimeout(300);
      return summarizeProbe(await readProbe(page), sourceRevisionBefore);
    }
  }));

  await gotoApp(page, "/");
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);
  await installProbe(page);
  await page.getByRole("button", { name: "Rect" }).click();
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "create-rectangle",
    label: "Create Rectangle Drag",
    dimensions: {
      interaction: "tool-create"
    },
    run: async () => {
      await resetProbe(page, "create-rectangle");
      const layer = interactionLayer(page);
      const sourceRevisionBefore = await readSourceRevision(page);
      const box = await layer.boundingBox();
      expect(box).toBeTruthy();
      await performPacedMouseDrag(
        page,
        buildLinearDragPath(
          { x: box!.x + 100, y: box!.y + 100 },
          200,
          150,
          30
        ),
        DRAG_STEP_DELAY_MS
      );
      await page.waitForTimeout(300);
      return summarizeProbe(await readProbe(page), sourceRevisionBefore);
    }
  }));

  const reportPath = writeScenarioReport(MANIFEST, testInfo, variants);
  console.log(`[profiling] wrote ${reportPath}`);
});
