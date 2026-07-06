import { expect, test } from "@playwright/test";
import {
  clickHitRegionByTargetId,
  focusCanvas,
  gotoApp,
  openMenuCommand,
  readSelectedSourceIds,
  readSelectionOverlayBoxSourceIds,
  resetStorageBeforeNavigation,
  setSource
} from "../e2e/helpers";
import {
  captureProfileVariant,
  summarizeFrameDurations,
  writeScenarioReport
} from "./framework";
import { getProfilingScenarioById } from "./scenario-registry";

const MANIFEST = getProfilingScenarioById("scope-edit");

if (!MANIFEST) {
  throw new Error("Missing profiling manifest for scope-edit.");
}

const SOURCE = String.raw`\begin{tikzpicture}
  \draw (-3,-3) rectangle (3,3);
  \begin{scope}[xshift=-5.69pt]
    \draw[fill=red] (-2.5,1.5) rectangle (-0.8,-0.3);
    \draw[fill=blue] (-2.4,0) rectangle (-0.9,-2);
  \end{scope}
\end{tikzpicture}`;

type ProbeRecord = {
  t: number;
  type: string;
  [key: string]: unknown;
};

type ScopeEditProbeSnapshot = {
  records: ProbeRecord[];
  sourceRevision: number;
  overlayCenter: { x: number; y: number } | null;
  frameDurations: number[];
};

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

async function installProbe(page: import("@playwright/test").Page, sourceId: string): Promise<void> {
  await page.evaluate((trackedSourceId) => {
    const globalLike = window as typeof window & {
      __PW_SCOPE_EDIT_PROBE__?: {
        reset: (label: string) => void;
        snapshot: () => ScopeEditProbeSnapshot;
      };
      __PW_SCOPE_EDIT_PROBE_INSTALLED__?: boolean;
    };
    if (globalLike.__PW_SCOPE_EDIT_PROBE_INSTALLED__) {
      return;
    }
    globalLike.__PW_SCOPE_EDIT_PROBE_INSTALLED__ = true;

    let start = performance.now();
    let records: ProbeRecord[] = [];
    const frameDurations: number[] = [];
    let previousFrameTs: number | null = null;
    let rafId = 0;
    let lastOverlayCenter: { x: number; y: number } | null = null;
    let lastSourceRevision = Number.NaN;

    const sourceRevision = (): number =>
      (window as typeof window & {
        __TIKZ_EDITOR_APP_TEST_API__?: { getSourceRevision?: () => number };
      }).__TIKZ_EDITOR_APP_TEST_API__?.getSourceRevision?.() ?? 0;

    const overlayCenter = (): { x: number; y: number } | null => {
      const box = document.querySelector(
        `[data-selection-overlay-box-source-id="${trackedSourceId}"]`
      );
      if (!box) {
        return null;
      }
      const rect = box.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    };

    const record = (type: string, detail: Record<string, unknown> = {}) => {
      records.push({
        t: performance.now() - start,
        type,
        ...detail
      });
    };

    const sample = (reason: string) => {
      const nextRevision = sourceRevision();
      if (nextRevision !== lastSourceRevision) {
        lastSourceRevision = nextRevision;
        record("source-revision", {
          reason,
          sourceRevision: nextRevision
        });
      }

      const nextOverlayCenter = overlayCenter();
      if (
        (nextOverlayCenter == null) !== (lastOverlayCenter == null) ||
        (nextOverlayCenter &&
          lastOverlayCenter &&
          (Math.abs(nextOverlayCenter.x - lastOverlayCenter.x) > 0.01 ||
            Math.abs(nextOverlayCenter.y - lastOverlayCenter.y) > 0.01))
      ) {
        lastOverlayCenter = nextOverlayCenter ? { ...nextOverlayCenter } : null;
        record("overlay-center", {
          reason,
          x: nextOverlayCenter?.x ?? null,
          y: nextOverlayCenter?.y ?? null
        });
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
      sample("raf");
      rafId = window.requestAnimationFrame(step);
    };
    rafId = window.requestAnimationFrame(step);

    globalLike.__PW_SCOPE_EDIT_PROBE__ = {
      reset(label: string) {
        start = performance.now();
        records = [];
        frameDurations.length = 0;
        previousFrameTs = null;
        lastOverlayCenter = null;
        lastSourceRevision = Number.NaN;
        record("reset", { label });
        sample("reset");
      },
      snapshot() {
        sample("snapshot");
        return {
          records: [...records],
          sourceRevision: sourceRevision(),
          overlayCenter: overlayCenter(),
          frameDurations: [...frameDurations]
        };
      }
    };

    window.addEventListener("beforeunload", () => {
      observer.disconnect();
      window.cancelAnimationFrame(rafId);
    });
  }, sourceId);
}

async function resetProbe(page: import("@playwright/test").Page, label: string): Promise<void> {
  await page.evaluate((nextLabel) => {
    (window as typeof window & {
      __PW_SCOPE_EDIT_PROBE__?: { reset: (label: string) => void };
    }).__PW_SCOPE_EDIT_PROBE__?.reset(nextLabel);
  }, label);
}

async function readProbe(page: import("@playwright/test").Page): Promise<ScopeEditProbeSnapshot> {
  return await page.evaluate(() => {
    const probe = (window as typeof window & {
      __PW_SCOPE_EDIT_PROBE__?: { snapshot: () => ScopeEditProbeSnapshot };
    }).__PW_SCOPE_EDIT_PROBE__;
    if (!probe) {
      throw new Error("Scope edit probe not installed.");
    }
    return probe.snapshot();
  });
}

function summarizeProbe(snapshot: ScopeEditProbeSnapshot) {
  const baselineOverlay = snapshot.records.find((record) => record.type === "overlay-center");
  const baselineSourceRevision = snapshot.records.find((record) => record.type === "source-revision");
  const firstOverlayMove = snapshot.records.find((record) =>
    record.type === "overlay-center" &&
    baselineOverlay?.x != null &&
    baselineOverlay?.y != null &&
    (Math.abs(Number(record.x) - Number(baselineOverlay.x)) > 0.5 ||
      Math.abs(Number(record.y) - Number(baselineOverlay.y)) > 0.5)
  );
  const firstSourceRewrite = snapshot.records.find((record) =>
    record.type === "source-revision" &&
    record !== baselineSourceRevision &&
    Number(record.sourceRevision ?? 0) > Number(baselineSourceRevision?.sourceRevision ?? 0)
  );
  const finalOverlay = snapshot.overlayCenter;

  return {
    metrics: {
      msToFirstOverlayMove: firstOverlayMove ? Number(firstOverlayMove.t.toFixed(2)) : null,
      msToFirstSourceRewrite: firstSourceRewrite ? Number(firstSourceRewrite.t.toFixed(2)) : null,
      finalOverlayDeltaPx:
        finalOverlay != null && baselineOverlay?.x != null && baselineOverlay?.y != null
          ? {
              dx: Number((finalOverlay.x - Number(baselineOverlay.x)).toFixed(2)),
              dy: Number((finalOverlay.y - Number(baselineOverlay.y)).toFixed(2))
            }
          : null
    },
    frameStats: summarizeFrameDurations(snapshot.frameDurations),
    probeSnapshot: snapshot
  };
}

async function prepareScopeSelection(
  page: import("@playwright/test").Page,
  options: { hideSourcePanel?: boolean } = {}
): Promise<void> {
  await gotoApp(page, "/");
  await setSource(page, SOURCE);
  await installProbe(page, "scope:1");
  await focusCanvas(page);
  await clickHitRegionByTargetId(page, "path:2");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:1"]);
  await expect.poll(async () => readSelectionOverlayBoxSourceIds(page)).toEqual(["scope:1"]);
  if (options.hideSourcePanel) {
    await openMenuCommand(page, "view", "view.toggle-source-panel");
    await expect(page.locator(".cm-editor")).toHaveCount(0);
  }
}

async function prepareScopeSelectionWithoutPreselect(page: import("@playwright/test").Page): Promise<void> {
  await gotoApp(page, "/");
  await setSource(page, SOURCE);
  await installProbe(page, "scope:1");
  await focusCanvas(page);
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual([]);
}

test("profile scope editing interactions", async ({ page }, testInfo) => {
  const variants = [];

  await prepareScopeSelection(page);
  await resetProbe(page, "selected-drag-visible");
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "selected-drag-visible",
    label: "selected-drag-visible",
    dimensions: {
      interaction: "selected-scope-drag",
      sourcePanelVisible: true
    },
    run: async () => {
      const scopeHitRegion = page.locator("[data-hit-region-target-id='scope:1']").first();
      const box = await scopeHitRegion.boundingBox();
      if (!box) {
        throw new Error("Scope hit-region bounds missing.");
      }
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 180, startY, { steps: 40 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      return summarizeProbe(await readProbe(page));
    }
  }));

  await prepareScopeSelection(page, { hideSourcePanel: true });
  await resetProbe(page, "selected-drag-source-hidden");
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "selected-drag-source-hidden",
    label: "selected-drag-source-hidden",
    dimensions: {
      interaction: "selected-scope-drag",
      sourcePanelVisible: false
    },
    run: async () => {
      const scopeHitRegion = page.locator("[data-hit-region-target-id='scope:1']").first();
      const box = await scopeHitRegion.boundingBox();
      if (!box) {
        throw new Error("Scope hit-region bounds missing.");
      }
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 180, startY, { steps: 40 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      return summarizeProbe(await readProbe(page));
    }
  }));

  await prepareScopeSelection(page);
  await resetProbe(page, "selected-resize-visible");
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "selected-resize-visible",
    label: "selected-resize-visible",
    dimensions: {
      interaction: "selected-scope-resize",
      sourcePanelVisible: true
    },
    run: async () => {
      const resizeHandle = page.locator(
        "[data-handle-kind='resize-element'][data-source-id='scope:1'][data-resize-role='top-left']"
      ).first();
      await expect(resizeHandle).toBeVisible();
      const box = await resizeHandle.boundingBox();
      if (!box) {
        throw new Error("Scope resize-handle bounds missing.");
      }
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 90, startY - 70, { steps: 24 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      return summarizeProbe(await readProbe(page));
    }
  }));

  await prepareScopeSelectionWithoutPreselect(page);
  await resetProbe(page, "member-promote-visible");
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "member-promote-visible",
    label: "member-promote-visible",
    dimensions: {
      interaction: "member-drag-promotes-to-scope",
      sourcePanelVisible: true
    },
    run: async () => {
      const memberRegion = page.locator("[data-hit-region-target-id='path:2']").first();
      const box = await memberRegion.boundingBox();
      if (!box) {
        throw new Error("Scope member hit-region bounds missing.");
      }
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 180, startY, { steps: 40 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:1"]);
      return summarizeProbe(await readProbe(page));
    }
  }));

  const reportPath = writeScenarioReport(MANIFEST, testInfo, variants);
  console.log(`[profiling] wrote ${reportPath}`);
});
