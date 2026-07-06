import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  gotoApp,
  readStoreSource,
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

const MANIFEST = getProfilingScenarioById("source-typing");

if (!MANIFEST) {
  throw new Error("Missing profiling manifest for source-typing.");
}

const INSERTION = " node[midway, above] {typed label}";
const KEYSTROKE_DELAY_MS = 35;

type ProbeRecord = {
  t: number;
  type: string;
  [key: string]: unknown;
};

type SourceTypingProbeSnapshot = {
  records: ProbeRecord[];
  sourceRevision: number;
  cmContentLength: number;
  cmLineCount: number;
  visibleHitRegionCount: number;
  frameDurations: number[];
};

type SourceTypingVariant = {
  id: string;
  label: string;
  dimensions: Record<string, string | number | boolean | null>;
  source: string;
  targetLineIndex: number;
  expectedSourceSubstring: string;
};

const SMALL_SOURCE = String.raw`\begin{tikzpicture}
  \draw[thick, blue] (0,0) -- (4,0);
  \node[draw] at (2,1) {A nearby node};
\end{tikzpicture}`;

const DENSE_SOURCE = buildDenseSource(120);

const VARIANTS: SourceTypingVariant[] = [
  {
    id: "small-figure-path-label",
    label: "Type a path label in a small figure",
    dimensions: {
      document: "small-figure",
      typedCharacters: INSERTION.length,
      initialStatements: 2
    },
    source: SMALL_SOURCE,
    targetLineIndex: 1,
    expectedSourceSubstring: String.raw`\draw[thick, blue] (0,0) -- (4,0) node[midway, above] {typed label};`
  },
  {
    id: "dense-figure-path-label",
    label: "Type a path label in a dense figure",
    dimensions: {
      document: "dense-figure",
      typedCharacters: INSERTION.length,
      generatedNodeCount: 120
    },
    source: DENSE_SOURCE,
    targetLineIndex: 1,
    expectedSourceSubstring: String.raw`\draw[thick, blue] (0,0) -- (4,0) node[midway, above] {typed label};`
  }
];

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

function buildDenseSource(nodeCount: number): string {
  const lines = [
    String.raw`\begin{tikzpicture}`,
    String.raw`  \draw[thick, blue] (0,0) -- (4,0);`
  ];
  for (let index = 0; index < nodeCount; index += 1) {
    const column = index % 12;
    const row = Math.floor(index / 12);
    lines.push(`  \\node[draw, rounded corners=1pt] (N${index}) at (${column * 0.75},${row * 0.45 + 1}) {N${index}};`);
  }
  lines.push(String.raw`\end{tikzpicture}`);
  return lines.join("\n");
}

async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const globalLike = window as typeof window & {
      __PW_SOURCE_TYPING_PROBE__?: {
        reset: (label: string) => void;
        snapshot: () => SourceTypingProbeSnapshot;
      };
      __PW_SOURCE_TYPING_PROBE_INSTALLED__?: boolean;
    };
    if (globalLike.__PW_SOURCE_TYPING_PROBE_INSTALLED__) {
      return;
    }
    globalLike.__PW_SOURCE_TYPING_PROBE_INSTALLED__ = true;

    let start = performance.now();
    let records: ProbeRecord[] = [];
    const frameDurations: number[] = [];
    let previousFrameTs: number | null = null;
    let rafId = 0;
    let lastSourceRevision = Number.NaN;
    let lastContentLength = -1;
    let lastLineCount = -1;
    let lastHitRegionCount = -1;

    const sourceRevision = (): number =>
      (window as typeof window & {
        __TIKZ_EDITOR_APP_TEST_API__?: { getSourceRevision?: () => number };
      }).__TIKZ_EDITOR_APP_TEST_API__?.getSourceRevision?.() ?? 0;
    const cmContentLength = (): number =>
      document.querySelector(".cm-content")?.textContent?.length ?? 0;
    const cmLineCount = (): number => document.querySelectorAll(".cm-line").length;
    const visibleHitRegionCount = (): number => {
      const regions = [...document.querySelectorAll("[data-hit-region-target-id]")];
      return regions.filter((region) => {
        const rect = region.getBoundingClientRect();
        const style = getComputedStyle(region);
        return (
          (rect.width > 0 || rect.height > 0) &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          Number(style.opacity || "1") > 0
        );
      }).length;
    };

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

      if (!includeDomMeasurements) {
        return;
      }

      const nextContentLength = cmContentLength();
      if (nextContentLength !== lastContentLength) {
        lastContentLength = nextContentLength;
        record("cm-content-length", { reason, cmContentLength: nextContentLength });
      }

      const nextLineCount = cmLineCount();
      if (nextLineCount !== lastLineCount) {
        lastLineCount = nextLineCount;
        record("cm-line-count", { reason, cmLineCount: nextLineCount });
      }

      const nextHitRegionCount = visibleHitRegionCount();
      if (nextHitRegionCount !== lastHitRegionCount) {
        lastHitRegionCount = nextHitRegionCount;
        record("visible-hit-region-count", { reason, visibleHitRegionCount: nextHitRegionCount });
      }
    };

    const observer = new MutationObserver(() => {
      sample("mutation");
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
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

    globalLike.__PW_SOURCE_TYPING_PROBE__ = {
      reset(label: string) {
        start = performance.now();
        records = [];
        frameDurations.length = 0;
        previousFrameTs = null;
        lastSourceRevision = Number.NaN;
        lastContentLength = -1;
        lastLineCount = -1;
        lastHitRegionCount = -1;
        record("reset", { label });
        sample("reset");
      },
      snapshot() {
        sample("snapshot");
        return {
          records: [...records],
          sourceRevision: sourceRevision(),
          cmContentLength: cmContentLength(),
          cmLineCount: cmLineCount(),
          visibleHitRegionCount: visibleHitRegionCount(),
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

async function resetProbe(page: Page, label: string): Promise<void> {
  await page.evaluate((nextLabel) => {
    (window as typeof window & {
      __PW_SOURCE_TYPING_PROBE__?: { reset: (label: string) => void };
    }).__PW_SOURCE_TYPING_PROBE__?.reset(nextLabel);
  }, label);
}

async function readProbe(page: Page): Promise<SourceTypingProbeSnapshot> {
  return await page.evaluate(() => {
    const probe = (window as typeof window & {
      __PW_SOURCE_TYPING_PROBE__?: { snapshot: () => SourceTypingProbeSnapshot };
    }).__PW_SOURCE_TYPING_PROBE__;
    if (!probe) {
      throw new Error("Source typing probe not installed.");
    }
    return probe.snapshot();
  });
}

async function placeCursorBeforeLineSemicolon(page: Page, cmContent: Locator, lineIndex: number): Promise<void> {
  const line = cmContent.locator(".cm-line").nth(lineIndex);
  await expect(line).toBeVisible();
  await line.click();
  await expect(cmContent).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
}

async function typeIndividualKeystrokes(locator: Locator, text: string): Promise<void> {
  for (const character of text) {
    await locator.type(character, { delay: KEYSTROKE_DELAY_MS });
  }
}

function summarizeProbe(
  snapshot: SourceTypingProbeSnapshot,
  sourceRevisionBefore: number,
  inputDurationMs: number,
  msToSnapshotSourceReady: number,
  msFromInputEndToSnapshotSourceReady: number
) {
  const firstSourceRewrite = snapshot.records.find((record) =>
    record.type === "source-revision" &&
    Number(record.sourceRevision ?? 0) > sourceRevisionBefore
  );
  const lastSourceRewrite = [...snapshot.records].reverse().find((record) =>
    record.type === "source-revision" &&
    Number(record.sourceRevision ?? 0) > sourceRevisionBefore
  );
  const firstHitRegionChange = snapshot.records.find((record) =>
    record.type === "visible-hit-region-count" &&
    Number(record.visibleHitRegionCount ?? 0) !== Number(snapshot.records.find((candidate) => candidate.type === "visible-hit-region-count")?.visibleHitRegionCount ?? 0)
  );

  return {
    metrics: {
      typedCharacters: INSERTION.length,
      inputDurationMs: Number(inputDurationMs.toFixed(2)),
      msToSnapshotSourceReady: Number(msToSnapshotSourceReady.toFixed(2)),
      msFromInputEndToSnapshotSourceReady: Number(msFromInputEndToSnapshotSourceReady.toFixed(2)),
      sourceRevisionDelta: snapshot.sourceRevision - sourceRevisionBefore,
      msToFirstSourceRewrite: firstSourceRewrite ? Number(firstSourceRewrite.t.toFixed(2)) : null,
      msToLastSourceRewrite: lastSourceRewrite ? Number(lastSourceRewrite.t.toFixed(2)) : null,
      msToFirstHitRegionChange: firstHitRegionChange ? Number(firstHitRegionChange.t.toFixed(2)) : null,
      finalVisibleLineCount: snapshot.cmLineCount,
      finalVisibleHitRegionCount: snapshot.visibleHitRegionCount
    },
    frameStats: summarizeFrameDurations(snapshot.frameDurations),
    probeSnapshot: snapshot
  };
}

async function prepareVariant(page: Page, variant: SourceTypingVariant): Promise<void> {
  await gotoApp(page, "/");
  await setSource(page, variant.source);
  await waitForHitRegions(page, 1);
  await installProbe(page);
}

async function runVariant(page: Page, variant: SourceTypingVariant) {
  const cmContent = page.locator(".cm-content").first();
  await expect(cmContent).toBeVisible();
  await resetProbe(page, variant.id);
  await placeCursorBeforeLineSemicolon(page, cmContent, variant.targetLineIndex);

  const sourceRevisionBefore = await page.evaluate(() => {
    const api = (globalThis as {
      __TIKZ_EDITOR_APP_TEST_API__?: { getSourceRevision?: () => number };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    return api?.getSourceRevision?.() ?? 0;
  });
  const startedAt = Date.now();
  await typeIndividualKeystrokes(cmContent, INSERTION);
  const inputDurationMs = Date.now() - startedAt;

  await expect.poll(async () => await readStoreSource(page)).toContain(variant.expectedSourceSubstring);
  const expectedSnapshotSource = await readStoreSource(page);
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const api = (globalThis as {
        __TIKZ_EDITOR_APP_TEST_API__?: { getSnapshotSource?: () => string };
      }).__TIKZ_EDITOR_APP_TEST_API__;
      return api?.getSnapshotSource?.() ?? "";
    });
  }, {
    timeout: 15_000,
    intervals: [50, 100, 200, 500]
  }).toBe(expectedSnapshotSource);
  const msToSnapshotSourceReady = Date.now() - startedAt;
  await waitForHitRegions(page, 1);

  const snapshot = await readProbe(page);
  return summarizeProbe(
    snapshot,
    sourceRevisionBefore,
    inputDurationMs,
    msToSnapshotSourceReady,
    msToSnapshotSourceReady - inputDurationMs
  );
}

test("profiles source editor typing", async ({ page }, testInfo) => {
  const variants = [];

  for (const variant of VARIANTS) {
    await prepareVariant(page, variant);
    const captured = await captureProfileVariant({
      page,
      scenarioId: MANIFEST.id,
      variantId: variant.id,
      label: variant.label,
      dimensions: variant.dimensions,
      run: async () => await runVariant(page, variant)
    });
    variants.push(captured);
  }

  const reportPath = writeScenarioReport(MANIFEST, testInfo, variants);
  console.log(`[profiling] wrote ${reportPath}`);
});
