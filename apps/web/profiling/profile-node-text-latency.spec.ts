import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  clickTextHitRegionByTargetId,
  gotoApp,
  resetStorageBeforeNavigation,
  setSource
} from "../e2e/helpers";
import {
  ensureTracesDir,
  readAppProfilingSnapshot,
  resetAppProfilingSession,
  roundNumber,
  summarizeFrameDurations,
  TRACES_DIR
} from "./framework";

const SOURCE = String.raw`\begin{tikzpicture}
  \node at (0.78,2.83) {Hello Worl};
  \draw (-0.45,3.4) rectangle (2.1,2.26);
\end{tikzpicture}`;

const INITIAL_TEXT = "Hello Worl";
const FINAL_TEXT = "Hello World";
const REPORT_PATH = path.join(TRACES_DIR, "node-text-latency-report.json");

type LatencyRecord = {
  t: number;
  type: string;
  value?: string | null;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  sourceRevision?: number;
  sourceContainsFinalText?: boolean;
  renderedText?: string;
  frameDurationMs?: number;
  timing?: Record<string, unknown>;
};

type LatencyProbeSnapshot = {
  records: LatencyRecord[];
  frameDurations: number[];
  finalTextareaValue: string | null;
  finalRenderedText: string;
  finalSourceRevision: number;
};

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? null;
  return (sorted[lower] ?? 0) * (1 - (index - lower)) + (sorted[upper] ?? 0) * (index - lower);
}

function firstRecord(records: readonly LatencyRecord[], type: string): LatencyRecord | null {
  return records.find((record) => record.type === type) ?? null;
}

function firstRecordAfter(
  records: readonly LatencyRecord[],
  type: string,
  minTime: number,
  predicate: (record: LatencyRecord) => boolean = () => true
): LatencyRecord | null {
  return records.find((record) => record.type === type && record.t >= minTime && predicate(record)) ?? null;
}

function summarizeLatency(snapshot: LatencyProbeSnapshot) {
  const records = snapshot.records;
  const keydown = firstRecord(records, "textarea-keydown");
  const beforeInput = firstRecord(records, "textarea-beforeinput");
  const input = firstRecord(records, "textarea-dom-final");
  const sourceRevision = firstRecord(records, "source-revision-final");
  const origin = keydown?.t ?? beforeInput?.t ?? input?.t ?? 0;
  const computeAfterKeydown = firstRecordAfter(records, "compute-timing", origin);
  const sourcePanelSyncAfterInput = firstRecordAfter(records, "source-panel-sync-timing", input?.t ?? origin);
  const svgPatch = firstRecordAfter(records, "svg-patch-timing", origin);
  const rafAfterSvgPatch = firstRecord(records, "raf-after-svg-patch");

  const delta = (record: LatencyRecord | null) => roundNumber(record ? record.t - origin : null);
  const framesAfterInput = input
    ? snapshot.frameDurations.filter((durationRecord, index) => {
        const frameRecord = records.filter((record) => record.type === "raf-frame")[index];
        return frameRecord ? frameRecord.t >= input.t : false;
      })
    : [];

  return {
    metrics: {
      msKeydownToBeforeInput: delta(beforeInput),
      msKeydownToTextareaDomFinal: delta(input),
      msKeydownToSourceRevision: delta(sourceRevision),
      msKeydownToComputeAfterKeydown: delta(computeAfterKeydown),
      msKeydownToSourcePanelSyncAfterInput: delta(sourcePanelSyncAfterInput),
      msKeydownToSvgPatch: delta(svgPatch),
      msKeydownToNextRafAfterSvgPatch: delta(rafAfterSvgPatch),
      msTextareaDomFinalToSourceRevision: roundNumber(input && sourceRevision ? sourceRevision.t - input.t : null),
      msTextareaDomFinalToComputeAfterKeydown: roundNumber(input && computeAfterKeydown ? computeAfterKeydown.t - input.t : null),
      msTextareaDomFinalToSourcePanelSyncAfterInput: roundNumber(input && sourcePanelSyncAfterInput ? sourcePanelSyncAfterInput.t - input.t : null),
      msTextareaDomFinalToSvgPatch: roundNumber(input && svgPatch ? svgPatch.t - input.t : null),
      msTextareaDomFinalToNextRafAfterSvgPatch: roundNumber(input && rafAfterSvgPatch ? rafAfterSvgPatch.t - input.t : null),
      msSourceRevisionToComputeAfterKeydown: roundNumber(sourceRevision && computeAfterKeydown ? computeAfterKeydown.t - sourceRevision.t : null),
      msSourceRevisionToSvgPatch: roundNumber(sourceRevision && svgPatch ? svgPatch.t - sourceRevision.t : null),
      msSvgPatchToNextRaf: roundNumber(svgPatch && rafAfterSvgPatch ? rafAfterSvgPatch.t - svgPatch.t : null),
      frameCountAfterInputUntilRendered: input && rafAfterSvgPatch
        ? records.filter((record) => record.type === "raf-frame" && record.t >= input.t && record.t <= rafAfterSvgPatch.t).length
        : null,
      frameP95AfterInputMs: roundNumber(percentile(framesAfterInput, 0.95)),
      finalTextareaValue: snapshot.finalTextareaValue,
      finalRenderedText: snapshot.finalRenderedText,
      finalSourceRevision: snapshot.finalSourceRevision
    },
    frameStats: summarizeFrameDurations(snapshot.frameDurations),
    records
  };
}

async function installLatencyProbe(page: Page): Promise<void> {
  await page.evaluate(({ finalText }) => {
    const globalLike = window as typeof window & {
      __PW_NODE_TEXT_LATENCY_PROBE__?: {
        snapshot: () => LatencyProbeSnapshot;
      };
    };

    const records: LatencyRecord[] = [];
    const frameDurations: number[] = [];
    const startedAt = performance.now();
    let previousFrameTs: number | null = null;
    let rafId = 0;
    let sawFinalSourceRevision = false;
    let finalInputAt: number | null = null;
    let keydownAt: number | null = null;
    let svgPatchAfterInputAt: number | null = null;
    let sawSvgPatchAfterInput = false;
    let sawRafAfterSvgPatch = false;
    let baselineSourceRevision = 0;

    const now = () => performance.now() - startedAt;
    const textarea = () => document.querySelector<HTMLTextAreaElement>('[data-testid="canvas-text-edit-textarea"]');
    const svgLayer = () => document.querySelector<HTMLElement>('[data-testid="canvas-svg-layer"]');
    const renderedText = () => svgLayer()?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const sourceRevision = () =>
      (window as typeof window & {
        __TIKZ_EDITOR_APP_TEST_API__?: { getSourceRevision?: () => number };
      }).__TIKZ_EDITOR_APP_TEST_API__?.getSourceRevision?.() ?? 0;
    const sourceContainsFinalText = () =>
      (window as typeof window & {
        __TIKZ_EDITOR_APP_TEST_API__?: { getSource?: () => string };
      }).__TIKZ_EDITOR_APP_TEST_API__?.getSource?.()?.includes(finalText) ?? false;

    const record = (type: string, detail: Omit<LatencyRecord, "t" | "type"> = {}) => {
      records.push({ t: now(), type, ...detail });
    };

    baselineSourceRevision = sourceRevision();
    record("probe-installed", {
      sourceRevision: baselineSourceRevision,
      renderedText: renderedText()
    });

    const profilingGlobal = window as typeof window & {
      __TIKZ_EDITOR_PROFILING_RECORDER__?: {
        incrementCounter: (counter: string, amount?: number) => void;
        recordComputeTiming: (timing: Record<string, unknown>) => void;
        recordSvgPatchTiming: (timing: Record<string, unknown>) => void;
        recordSourcePanelSyncTiming: (timing: Record<string, unknown>) => void;
      };
    };
    const existingRecorder = profilingGlobal.__TIKZ_EDITOR_PROFILING_RECORDER__;
    if (!existingRecorder) {
      throw new Error("App profiling recorder missing.");
    }
    const originalRecordSvgPatchTiming = existingRecorder.recordSvgPatchTiming.bind(existingRecorder);
    const originalRecordComputeTiming = existingRecorder.recordComputeTiming.bind(existingRecorder);
    const originalRecordSourcePanelSyncTiming = existingRecorder.recordSourcePanelSyncTiming.bind(existingRecorder);
    existingRecorder.recordComputeTiming = (timing: Record<string, unknown>) => {
      originalRecordComputeTiming(timing);
      record("compute-timing", {
        timing,
        sourceRevision: sourceRevision(),
        sourceContainsFinalText: sourceContainsFinalText(),
        renderedText: renderedText()
      });
    };
    existingRecorder.recordSvgPatchTiming = (timing: Record<string, unknown>) => {
      originalRecordSvgPatchTiming(timing);
      record("svg-patch-timing", {
        timing,
        sourceRevision: sourceRevision(),
        sourceContainsFinalText: sourceContainsFinalText(),
        renderedText: renderedText()
      });
      if (!sawSvgPatchAfterInput && keydownAt != null) {
        sawSvgPatchAfterInput = true;
        svgPatchAfterInputAt = now();
      }
    };
    existingRecorder.recordSourcePanelSyncTiming = (timing: Record<string, unknown>) => {
      originalRecordSourcePanelSyncTiming(timing);
      record("source-panel-sync-timing", {
        timing,
        sourceRevision: sourceRevision(),
        sourceContainsFinalText: sourceContainsFinalText(),
        renderedText: renderedText()
      });
    };

    const textAreaElement = textarea();
    if (!textAreaElement) {
      throw new Error("Textarea missing while installing latency probe.");
    }

    for (const eventType of ["keydown", "beforeinput", "input", "keyup"] as const) {
      textAreaElement.addEventListener(eventType, () => {
        const value = textAreaElement.value;
        const isFinal = value === finalText;
        const eventDetail = {
          value,
          selectionStart: textAreaElement.selectionStart,
          selectionEnd: textAreaElement.selectionEnd
        };
        record(`textarea-${eventType}`, eventDetail);
        if (eventType === "keydown" && keydownAt == null) {
          keydownAt = records[records.length - 1]?.t ?? now();
        }
        if (!finalInputAt && isFinal) {
          record("textarea-dom-final", eventDetail);
          finalInputAt = records[records.length - 1]?.t ?? now();
        }
      });
    }

    const layer = svgLayer();
    if (!layer) {
      throw new Error("SVG layer missing while installing latency probe.");
    }

    const step = (frameTs: number) => {
      if (previousFrameTs != null) {
        const duration = Math.max(0, frameTs - previousFrameTs);
        frameDurations.push(duration);
        record("raf-frame", { frameDurationMs: duration });
      }
      previousFrameTs = frameTs;

      const nextSourceRevision = sourceRevision();
      if (
        !sawFinalSourceRevision &&
        nextSourceRevision > baselineSourceRevision &&
        sourceContainsFinalText()
      ) {
        sawFinalSourceRevision = true;
        record("source-revision-final", {
          sourceRevision: nextSourceRevision,
          sourceContainsFinalText: true
        });
      }

      if (
        !sawRafAfterSvgPatch &&
        svgPatchAfterInputAt != null &&
        now() >= svgPatchAfterInputAt
      ) {
        sawRafAfterSvgPatch = true;
        record("raf-after-svg-patch", {
          renderedText: renderedText(),
          sourceRevision: nextSourceRevision,
          sourceContainsFinalText: sourceContainsFinalText()
        });
      }

      rafId = window.requestAnimationFrame(step);
    };
    rafId = window.requestAnimationFrame(step);

    globalLike.__PW_NODE_TEXT_LATENCY_PROBE__ = {
      snapshot() {
        return {
          records: [...records],
          frameDurations: [...frameDurations],
          finalTextareaValue: textarea()?.value ?? null,
          finalRenderedText: renderedText(),
          finalSourceRevision: sourceRevision()
        };
      }
    };

    window.addEventListener("beforeunload", () => {
      window.cancelAnimationFrame(rafId);
      existingRecorder.recordSvgPatchTiming = originalRecordSvgPatchTiming;
      existingRecorder.recordComputeTiming = originalRecordComputeTiming;
      existingRecorder.recordSourcePanelSyncTiming = originalRecordSourcePanelSyncTiming;
    });
  }, { finalText: FINAL_TEXT });
}

async function readLatencyProbe(page: Page): Promise<LatencyProbeSnapshot> {
  return await page.evaluate(() => {
    const probe = (window as typeof window & {
      __PW_NODE_TEXT_LATENCY_PROBE__?: {
        snapshot: () => LatencyProbeSnapshot;
      };
    }).__PW_NODE_TEXT_LATENCY_PROBE__;
    if (!probe) {
      throw new Error("Node text latency probe missing.");
    }
    return probe.snapshot();
  });
}

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("measures node text edit latency for one appended character", async ({ page }) => {
  await gotoApp(page, "/");
  await setSource(page, SOURCE);
  await clickTextHitRegionByTargetId(page, "path:0");

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue(INITIAL_TEXT);
  await textarea.evaluate((element, offset) => {
    const textareaElement = element as HTMLTextAreaElement;
    textareaElement.setSelectionRange(offset, offset);
    textareaElement.dispatchEvent(new Event("select", { bubbles: true }));
  }, INITIAL_TEXT.length);

  await resetAppProfilingSession(page, "node-text-latency-one-char");
  await installLatencyProbe(page);
  await textarea.press("d");
  await expect(textarea).toHaveValue(FINAL_TEXT);
  await expect.poll(async () => {
    const snapshot = await readLatencyProbe(page);
    return snapshot.records.some((record) => record.type === "source-revision-final");
  }).toBe(true);

  await page.waitForTimeout(500);
  const snapshot = await readLatencyProbe(page);
  const instrumentation = await readAppProfilingSnapshot(page);
  const report = {
    source: SOURCE,
    initialText: INITIAL_TEXT,
    finalText: FINAL_TEXT,
    instrumentation,
    ...summarizeLatency(snapshot)
  };

  ensureTracesDir();
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log(`[profiling] wrote ${REPORT_PATH}`);
  console.log(`[profiling] metrics ${JSON.stringify(report.metrics)}`);
});
