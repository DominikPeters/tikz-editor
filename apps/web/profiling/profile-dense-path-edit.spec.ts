import { expect, test } from "@playwright/test";
import {
  clickHitRegion,
  clickHitRegionByTargetId,
  gotoApp,
  readSelectedSourceIds,
  resetStorageBeforeNavigation,
  setSource,
  waitForHitRegions
} from "../e2e/helpers";
import {
  captureProfileVariant,
  summarizeFrameDurations,
  writeScenarioReport
} from "./framework";
import { getProfilingScenarioById } from "./scenario-registry";

const MANIFEST = getProfilingScenarioById("dense-path-edit");

if (!MANIFEST) {
  throw new Error("Missing profiling manifest for dense-path-edit.");
}

const DENSE_PATH_SOURCE = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,0.2) -- (2,-0.1) -- (3,0.3) -- (4,0) -- (5,0.4) -- (6,0.1) -- (7,0.5) -- (8,0.2);
  \draw (0,2) -- (1,2.2) -- (2,2.1);
\end{tikzpicture}`;

const ENDPOINT_SOURCE = String.raw`\begin{tikzpicture}
  \draw[red] (-1, 1) -- (1, 1);
  \node[draw] (C) at (0, 0) {C};
\end{tikzpicture}`;

type ProbeRecord = {
  t: number;
  type: string;
  [key: string]: unknown;
};

type DensePathProbeSnapshot = {
  records: ProbeRecord[];
  handleCount: number;
  sourceRevision: number;
  frameDurations: number[];
};

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

async function installProbe(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const globalLike = window as typeof window & {
      __PW_DENSE_PATH_PROBE__?: {
        reset: (label: string) => void;
        snapshot: () => DensePathProbeSnapshot;
      };
      __PW_DENSE_PATH_PROBE_INSTALLED__?: boolean;
    };
    if (globalLike.__PW_DENSE_PATH_PROBE_INSTALLED__) {
      return;
    }
    globalLike.__PW_DENSE_PATH_PROBE_INSTALLED__ = true;

    let start = performance.now();
    let records: ProbeRecord[] = [];
    const frameDurations: number[] = [];
    let previousFrameTs: number | null = null;
    let rafId = 0;
    let lastHandleCount = -1;
    let lastSourceRevision = Number.NaN;

    const handleCount = (): number => document.querySelectorAll("[data-handle-kind='move-handle']").length;
    const sourceRevision = (): number =>
      (window as typeof window & {
        __TIKZ_EDITOR_APP_TEST_API__?: { getSourceRevision?: () => number };
      }).__TIKZ_EDITOR_APP_TEST_API__?.getSourceRevision?.() ?? 0;

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
      const nextSourceRevision = sourceRevision();
      if (nextSourceRevision !== lastSourceRevision) {
        lastSourceRevision = nextSourceRevision;
        record("source-revision", { reason, sourceRevision: nextSourceRevision });
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

    window.addEventListener("tikz-editor:source-selection-request", (rawEvent) => {
      const event = rawEvent as CustomEvent<Record<string, unknown>>;
      record("source-selection-request", event.detail ?? {});
    });
    window.addEventListener("tikz-editor:source-selection-changed", (rawEvent) => {
      const event = rawEvent as CustomEvent<Record<string, unknown>>;
      record("source-selection-changed", event.detail ?? {});
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

    globalLike.__PW_DENSE_PATH_PROBE__ = {
      reset(label: string) {
        start = performance.now();
        records = [];
        frameDurations.length = 0;
        previousFrameTs = null;
        lastHandleCount = -1;
        lastSourceRevision = Number.NaN;
        record("reset", { label });
        sample("reset");
      },
      snapshot() {
        sample("snapshot");
        return {
          records: [...records],
          handleCount: handleCount(),
          sourceRevision: sourceRevision(),
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
      __PW_DENSE_PATH_PROBE__?: { reset: (label: string) => void };
    }).__PW_DENSE_PATH_PROBE__?.reset(nextLabel);
  }, label);
}

async function readProbe(page: import("@playwright/test").Page): Promise<DensePathProbeSnapshot> {
  return await page.evaluate(() => {
    const probe = (window as typeof window & {
      __PW_DENSE_PATH_PROBE__?: { snapshot: () => DensePathProbeSnapshot };
    }).__PW_DENSE_PATH_PROBE__;
    if (!probe) {
      throw new Error("Dense path probe not installed.");
    }
    return probe.snapshot();
  });
}

function summarizeProbe(snapshot: DensePathProbeSnapshot) {
  const baselineRevision = snapshot.records.find((record) => record.type === "source-revision");
  const firstHandleAppearance = snapshot.records.find(
    (record) => record.type === "handle-count" && Number(record.handleCount ?? 0) > 0
  );
  const firstSourceSelectionRequest = snapshot.records.find((record) => record.type === "source-selection-request");
  const firstSourceSelectionChange = snapshot.records.find((record) => record.type === "source-selection-changed");
  const firstSourceRewrite = snapshot.records.find((record) =>
    record.type === "source-revision" &&
    record !== baselineRevision &&
    Number(record.sourceRevision ?? 0) > Number(baselineRevision?.sourceRevision ?? 0)
  );

  return {
    metrics: {
      msToFirstHandleAppearance: firstHandleAppearance ? Number(firstHandleAppearance.t.toFixed(2)) : null,
      msToFirstSourceSelectionRequest: firstSourceSelectionRequest ? Number(firstSourceSelectionRequest.t.toFixed(2)) : null,
      msToFirstSourceSelectionChange: firstSourceSelectionChange ? Number(firstSourceSelectionChange.t.toFixed(2)) : null,
      msToFirstSourceRewrite: firstSourceRewrite ? Number(firstSourceRewrite.t.toFixed(2)) : null,
      finalHandleCount: snapshot.handleCount
    },
    frameStats: summarizeFrameDurations(snapshot.frameDurations),
    probeSnapshot: snapshot
  };
}

async function doubleClickHitRegionByTargetId(
  page: import("@playwright/test").Page,
  targetId: string
): Promise<void> {
  const region = page.locator(`[data-hit-region-target-id='${targetId}']`).first();
  await expect(region).toBeVisible();
  const target = await region.evaluate((element) => {
    const fallback = () => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    if (element instanceof SVGGeometryElement && typeof element.getTotalLength === "function") {
      try {
        const length = element.getTotalLength();
        const sample = element.getPointAtLength(Math.min(Math.max(length * 0.25, 1), Math.max(length - 1, 1)));
        const svg = element.ownerSVGElement;
        const ctm = element.getScreenCTM();
        if (!svg || !ctm) {
          return fallback();
        }
        const point = svg.createSVGPoint();
        point.x = sample.x;
        point.y = sample.y;
        const screen = point.matrixTransform(ctm);
        return { x: screen.x, y: screen.y };
      } catch {
        return fallback();
      }
    }
    return fallback();
  });
  await page.mouse.dblclick(target.x, target.y);
}

async function doubleClickBetweenFirstTwoMoveHandles(
  page: import("@playwright/test").Page,
  sourceId: string
): Promise<void> {
  const handles = page.locator(`[data-handle-kind="move-handle"][data-source-id="${sourceId}"]`);
  await expect.poll(async () => handles.count()).toBeGreaterThan(1);
  const firstBox = await handles.nth(0).boundingBox();
  const secondBox = await handles.nth(1).boundingBox();
  if (!firstBox || !secondBox) {
    throw new Error(`Move-handle bounds missing for ${sourceId}.`);
  }
  await page.mouse.dblclick(
    (firstBox.x + firstBox.width / 2 + secondBox.x + secondBox.width / 2) / 2,
    (firstBox.y + firstBox.height / 2 + secondBox.y + secondBox.height / 2) / 2
  );
}

async function resolveDenseAndShortTargetIds(page: import("@playwright/test").Page): Promise<{
  denseTargetId: string;
  shortTargetId: string;
}> {
  await clickHitRegion(page, 0);
  const hintAfterFirstClick = await page.getByTestId("canvas-selection-hint").first().textContent().catch(() => null);
  const firstSelected = await readSelectedSourceIds(page);
  await clickHitRegion(page, 1);
  const hintAfterSecondClick = await page.getByTestId("canvas-selection-hint").first().textContent().catch(() => null);
  const secondSelected = await readSelectedSourceIds(page);

  const firstIsDense = hintAfterFirstClick?.includes("Double-click path to edit points.") ?? false;
  const secondIsDense = hintAfterSecondClick?.includes("Double-click path to edit points.") ?? false;
  if (firstIsDense === secondIsDense) {
    throw new Error("Expected exactly one dense path selection hint.");
  }

  return {
    denseTargetId: firstIsDense ? firstSelected[0] : secondSelected[0],
    shortTargetId: firstIsDense ? secondSelected[0] : firstSelected[0]
  };
}

test("profile dense path editing interactions", async ({ page }, testInfo) => {
  const variants = [];

  await gotoApp(page, "/");
  await setSource(page, DENSE_PATH_SOURCE);
  await installProbe(page);
  await page.getByRole("button", { name: "Select" }).click();
  await waitForHitRegions(page, 2);
  const { denseTargetId } = await resolveDenseAndShortTargetIds(page);
  await clickHitRegionByTargetId(page, denseTargetId);
  await resetProbe(page, "handle-reveal");
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "handle-reveal",
    label: "handle-reveal",
    dimensions: {
      interaction: "dense-path-double-click"
    },
    run: async () => {
      await doubleClickHitRegionByTargetId(page, denseTargetId);
      await expect.poll(async () => page.locator("[data-handle-kind='move-handle']").count()).toBeGreaterThan(0);
      await page.waitForTimeout(300);
      return summarizeProbe(await readProbe(page));
    }
  }));

  await gotoApp(page, "/");
  await setSource(page, DENSE_PATH_SOURCE);
  await installProbe(page);
  await page.getByRole("button", { name: "Select" }).click();
  await waitForHitRegions(page, 2);
  const resolvedIds = await resolveDenseAndShortTargetIds(page);
  await clickHitRegionByTargetId(page, resolvedIds.denseTargetId);
  await doubleClickHitRegionByTargetId(page, resolvedIds.denseTargetId);
  await expect.poll(async () => page.locator("[data-handle-kind='move-handle']").count()).toBeGreaterThan(0);
  await clickHitRegionByTargetId(page, resolvedIds.shortTargetId, { shift: true });
  await expect.poll(async () => (await readSelectedSourceIds(page)).length).toBe(2);
  await resetProbe(page, "insert-point");
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "insert-point",
    label: "insert-point",
    dimensions: {
      interaction: "dense-path-insert-point"
    },
    run: async () => {
      await doubleClickBetweenFirstTwoMoveHandles(page, resolvedIds.denseTargetId);
      await page.waitForTimeout(300);
      return summarizeProbe(await readProbe(page));
    }
  }));

  await gotoApp(page, "/");
  await setSource(page, ENDPOINT_SOURCE);
  await installProbe(page);
  await page.getByRole("button", { name: "Select" }).click();
  await waitForHitRegions(page, 1);
  const lineRegion = page.locator("[data-hit-region-target-id]").first();
  const lineTarget = await lineRegion.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(lineTarget.x, lineTarget.y);
  const endpointHandle = page.locator('[data-handle-kind="move-handle"][data-source-id="path:0"]').nth(1);
  await expect(endpointHandle).toBeVisible();
  const handleBox = await endpointHandle.boundingBox();
  const nodeRegion = page.locator('[data-hit-region-target-id="path:1"]').first();
  const nodeBox = await nodeRegion.boundingBox();
  if (!handleBox || !nodeBox) {
    throw new Error("Endpoint anchor profiling bounds missing.");
  }
  await resetProbe(page, "endpoint-anchor-drag");
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "endpoint-anchor-drag",
    label: "endpoint-anchor-drag",
    dimensions: {
      interaction: "endpoint-anchor-drag"
    },
    run: async () => {
      const startX = handleBox.x + handleBox.width / 2;
      const startY = handleBox.y + handleBox.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2, { steps: 12 });
      await expect.poll(async () => page.locator("svg circle").count()).toBeGreaterThan(0);
      const anchorBox = await page.locator("svg circle").first().boundingBox();
      if (!anchorBox) {
        throw new Error("Node anchor overlay circle bounds missing.");
      }
      await page.mouse.move(anchorBox.x + anchorBox.width / 2, anchorBox.y + anchorBox.height / 2, { steps: 8 });
      await page.mouse.move(startX + 120, startY - 20, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      return summarizeProbe(await readProbe(page));
    }
  }));

  const reportPath = writeScenarioReport(MANIFEST, testInfo, variants);
  console.log(`[profiling] wrote ${reportPath}`);
});
