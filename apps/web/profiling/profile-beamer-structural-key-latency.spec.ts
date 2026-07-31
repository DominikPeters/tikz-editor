import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import {
  gotoApp,
  resetStorageBeforeNavigation,
  setSource
} from "../e2e/helpers";
import {
  ensureTracesDir,
  roundNumber,
  TRACES_DIR
} from "./framework";

const SOURCE = fs.readFileSync(
  path.resolve(process.cwd(), "../../test/fixtures/beamer/kkt_theorem_beamer.tex"),
  "utf8"
);
const REPORT_PATH = path.join(
  TRACES_DIR,
  "beamer-structural-key-latency-report.json"
);
const REPS = 10;

type StructuralLatencySample = {
  /** Keydown until the re-render caught up with the new source. */
  totalMs: number;
};

type StructuralLatencyProbe = {
  samples: StructuralLatencySample[];
};

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return (sorted[lower] ?? 0) * (1 - (index - lower)) +
    (sorted[upper] ?? 0) * (index - lower);
}

function summarize(samples: readonly StructuralLatencySample[]) {
  const totals = samples.map((sample) => sample.totalMs);
  return {
    reps: samples.length,
    totalsMs: totals.map((value) => roundNumber(value)),
    medianTotalMs: roundNumber(percentile(totals, 0.5)),
    p95TotalMs: roundNumber(percentile(totals, 0.95))
  };
}

async function openKktColumnScope(page: Page): Promise<void> {
  await page.getByRole("button", {
    name: "Why KKT conditions matter",
    exact: true
  }).click();
  await expect.poll(async () =>
    page.locator(
      '[data-hit-region-target-id^="frame:1:"][data-hit-region-interaction-mode="text"]'
    ).count()
  ).toBeGreaterThan(0);

  const targetIds = await page.locator(
    '[data-hit-region-target-id^="frame:1:"][data-hit-region-interaction-mode="text"]'
  ).evaluateAll((regions) =>
    [...new Set(regions.map((region) =>
      region.getAttribute("data-hit-region-target-id")
    ).filter((value): value is string => value != null))]
  );
  for (const targetId of targetIds) {
    const region = page.locator(
      `[data-hit-region-target-id="${targetId}"][data-hit-region-interaction-mode="text"]`
    ).first();
    const box = await region.boundingBox();
    if (!box) continue;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const textarea = page.getByTestId("canvas-text-edit-textarea");
    if (
      await textarea.count() > 0 &&
      (await textarea.inputValue()).includes("KKT conditions turn")
    ) {
      return;
    }
    await page.keyboard.press("Escape");
  }
  throw new Error("Could not open the KKT column scope for canvas editing.");
}

async function installStructuralProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    type TestApi = {
      getSource?: () => string;
      getSnapshotSource?: () => string | null;
      getSourceRevision?: () => number;
    };
    const globalLike = window as typeof window & {
      __TIKZ_EDITOR_APP_TEST_API__?: TestApi;
      __PW_BEAMER_STRUCTURAL_LATENCY__?: {
        arm: () => void;
        snapshot: () => StructuralLatencyProbe;
      };
    };
    const api = globalLike.__TIKZ_EDITOR_APP_TEST_API__;
    const input = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="canvas-focus-input"]'
    );
    if (!api || !input) {
      throw new Error("Structural latency probe prerequisites are unavailable.");
    }

    const samples: StructuralLatencySample[] = [];
    let armed = false;
    let inputAt = 0;
    let revisionAtInput = 0;

    input.addEventListener("keydown", (event) => {
      if (!armed) return;
      if (event.key !== "Enter" && event.key !== "Tab") return;
      inputAt = performance.now();
      revisionAtInput = api.getSourceRevision?.() ?? 0;
    }, true);

    const observe = () => {
      if (armed && inputAt > 0) {
        const source = api.getSource?.();
        const snapshotSource = api.getSnapshotSource?.();
        const revision = api.getSourceRevision?.() ?? 0;
        if (
          revision > revisionAtInput &&
          source != null &&
          snapshotSource === source
        ) {
          samples.push({
            totalMs: performance.now() - inputAt
          });
          armed = false;
          inputAt = 0;
        }
      }
      window.setTimeout(observe, 0);
    };
    window.setTimeout(observe, 0);

    globalLike.__PW_BEAMER_STRUCTURAL_LATENCY__ = {
      arm: () => {
        armed = true;
        inputAt = 0;
      },
      snapshot: () => ({ samples: [...samples] })
    };
  });
}

async function armProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as typeof window & {
      __PW_BEAMER_STRUCTURAL_LATENCY__?: { arm: () => void };
    }).__PW_BEAMER_STRUCTURAL_LATENCY__?.arm();
  });
}

async function sampleCount(page: Page): Promise<number> {
  return await page.evaluate(() =>
    (window as typeof window & {
      __PW_BEAMER_STRUCTURAL_LATENCY__?: {
        snapshot: () => StructuralLatencyProbe;
      };
    }).__PW_BEAMER_STRUCTURAL_LATENCY__?.snapshot().samples.length ?? 0
  );
}

async function readSamples(page: Page): Promise<StructuralLatencySample[]> {
  return await page.evaluate(() =>
    (window as typeof window & {
      __PW_BEAMER_STRUCTURAL_LATENCY__?: {
        snapshot: () => StructuralLatencyProbe;
      };
    }).__PW_BEAMER_STRUCTURAL_LATENCY__?.snapshot().samples ?? []
  );
}

async function setCanvasCaret(page: Page, bufferOffset: number): Promise<void> {
  await page.evaluate((offset) => {
    const input = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="canvas-focus-input"]'
    );
    if (!input) throw new Error("canvas-focus-input is missing");
    input.focus();
    input.setSelectionRange(offset, offset);
    input.dispatchEvent(new Event("select", { bubbles: true }));
  }, bufferOffset);
}

async function waitForSettledRender(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const api = (window as typeof window & {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        getSource?: () => string;
        getSnapshotSource?: () => string | null;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    return api?.getSnapshotSource?.() === api?.getSource?.();
  })).toBe(true);
  await page.waitForTimeout(80);
}

async function bufferOffsetOf(page: Page, needle: string, delta: number): Promise<number> {
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  const buffer = await textarea.inputValue();
  const index = buffer.indexOf(needle);
  expect(index, `buffer contains ${JSON.stringify(needle)}`).toBeGreaterThanOrEqual(0);
  return index + delta;
}

async function measureStructuralKey(
  page: Page,
  key: "Enter" | "Tab",
  caretNeedle: string,
  caretDelta: number
): Promise<StructuralLatencySample[]> {
  const before = await readSamples(page);
  for (let rep = 0; rep < REPS; rep += 1) {
    const offset = await bufferOffsetOf(page, caretNeedle, caretDelta);
    await setCanvasCaret(page, offset);
    await armProbe(page);
    const target = (await sampleCount(page)) + 1;
    await page.keyboard.press(key);
    await expect.poll(async () => sampleCount(page), { timeout: 15_000 }).toBe(target);
    await waitForSettledRender(page);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await waitForSettledRender(page);
  }
  const all = await readSamples(page);
  return all.slice(before.length);
}

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("profiles structural Enter and Tab on the warmed KKT column scope", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, SOURCE);
  await openKktColumnScope(page);
  await installStructuralProbe(page);

  // Warm the frame: one throwaway split + undo.
  const warmOffset = await bufferOffsetOf(page, "They generalize", 4);
  await setCanvasCaret(page, warmOffset);
  await armProbe(page);
  const warmTarget = (await sampleCount(page)) + 1;
  await page.keyboard.press("Enter");
  await expect.poll(async () => sampleCount(page), { timeout: 15_000 }).toBe(warmTarget);
  await waitForSettledRender(page);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await waitForSettledRender(page);

  // Enter mid-item: split "They generalize ..." after "They gene|ralize".
  const enterSamples = await measureStructuralKey(page, "Enter", "They generalize", 9);
  // Tab on a non-first item (the first cannot nest): wrap, then undo.
  const tabSamples = await measureStructuralKey(page, "Tab", "Multipliers measure", 5);

  const report = {
    fixture: "kkt_theorem_beamer.tex frame 2 column scope",
    reps: REPS,
    enter: summarize(enterSamples),
    tab: summarize(tabSamples),
    platform: process.platform
  };
  ensureTracesDir();
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log(`[profiling] wrote ${REPORT_PATH}`);
  console.log(`[profiling] metrics ${JSON.stringify(report)}`);

  expect(enterSamples).toHaveLength(REPS);
  expect(tabSamples).toHaveLength(REPS);
});
