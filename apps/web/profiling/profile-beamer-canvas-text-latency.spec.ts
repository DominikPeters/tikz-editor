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
const INSERTED_TEXT = " and canvas editing stays live";
const REPORT_PATH = path.join(
  TRACES_DIR,
  "beamer-canvas-text-latency-report.json"
);

type BeamerLatencyProbe = {
  latenciesMs: number[];
  completedRevisions: number[];
  baselineRevision: number;
};

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return (sorted[lower] ?? 0) * (1 - (index - lower)) +
    (sorted[upper] ?? 0) * (index - lower);
}

async function openKktBodyText(page: Page): Promise<void> {
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
      await textarea.press("End");
      return;
    }
    await page.keyboard.press("Escape");
  }
  throw new Error("Could not open the KKT body paragraph for canvas editing.");
}

async function installLatencyProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    type TestApi = {
      getSource?: () => string;
      getSnapshotSource?: () => string | null;
      getSourceRevision?: () => number;
    };
    const globalLike = window as typeof window & {
      __TIKZ_EDITOR_APP_TEST_API__?: TestApi;
      __PW_BEAMER_TEXT_LATENCY__?: {
        snapshot: () => BeamerLatencyProbe;
      };
    };
    const api = globalLike.__TIKZ_EDITOR_APP_TEST_API__;
    const textarea = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="canvas-text-edit-textarea"]'
    );
    if (!api || !textarea) {
      throw new Error("Beamer latency probe prerequisites are unavailable.");
    }

    const baselineRevision = api.getSourceRevision?.() ?? 0;
    const pending: Array<{ inputAt: number; revision: number }> = [];
    const latenciesMs: number[] = [];
    const completedRevisions: number[] = [];
    let nextRevision = baselineRevision + 1;

    textarea.addEventListener("beforeinput", (event) => {
      if (event.inputType !== "insertText") return;
      pending.push({
        inputAt: performance.now(),
        revision: nextRevision
      });
      nextRevision += 1;
    }, true);

    const observe = () => {
      const source = api.getSource?.();
      const snapshotSource = api.getSnapshotSource?.();
      const revision = api.getSourceRevision?.() ?? 0;
      while (
        pending.length > 0 &&
        revision >= pending[0].revision &&
        source != null &&
        snapshotSource === source
      ) {
        const completed = pending.shift();
        if (!completed) break;
        latenciesMs.push(performance.now() - completed.inputAt);
        completedRevisions.push(completed.revision);
      }
      window.setTimeout(observe, 0);
    };
    window.setTimeout(observe, 0);

    globalLike.__PW_BEAMER_TEXT_LATENCY__ = {
      snapshot: () => ({
        latenciesMs: [...latenciesMs],
        completedRevisions: [...completedRevisions],
        baselineRevision
      })
    };
  });
}

async function readProbe(page: Page): Promise<BeamerLatencyProbe> {
  return await page.evaluate(() => {
    const probe = (window as typeof window & {
      __PW_BEAMER_TEXT_LATENCY__?: {
        snapshot: () => BeamerLatencyProbe;
      };
    }).__PW_BEAMER_TEXT_LATENCY__;
    if (!probe) throw new Error("Beamer latency probe is missing.");
    return probe.snapshot();
  });
}

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("profiles 30 paced Beamer canvas text edits on a warmed KKT frame", async ({ page }) => {
  expect(INSERTED_TEXT).toHaveLength(30);
  await gotoApp(page);
  await setSource(page, SOURCE);
  await openKktBodyText(page);
  await installLatencyProbe(page);

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  for (let index = 0; index < INSERTED_TEXT.length; index += 1) {
    await textarea.type(INSERTED_TEXT[index]);
    await expect.poll(async () => (await readProbe(page)).latenciesMs.length)
      .toBe(index + 1);
    await page.waitForTimeout(40);
  }

  const probe = await readProbe(page);
  const medianMs = percentile(probe.latenciesMs, 0.5);
  const p95Ms = percentile(probe.latenciesMs, 0.95);
  const finalSource = await page.evaluate(() => {
    const api = (window as typeof window & {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        getSource?: () => string;
        getSnapshotSource?: () => string | null;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    return {
      source: api?.getSource?.() ?? "",
      snapshotSource: api?.getSnapshotSource?.() ?? null
    };
  });
  const { source, snapshotSource } = finalSource;

  const report = {
    editCount: INSERTED_TEXT.length,
    baselineRevision: probe.baselineRevision,
    completedRevisions: probe.completedRevisions,
    latenciesMs: probe.latenciesMs.map((value) => roundNumber(value)),
    medianMs: roundNumber(medianMs),
    p95Ms: roundNumber(p95Ms),
    finalRevisionRendered: snapshotSource === source,
    platform: process.platform
  };
  ensureTracesDir();
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log(`[profiling] wrote ${REPORT_PATH}`);
  console.log(`[profiling] metrics ${JSON.stringify(report)}`);

  expect(probe.latenciesMs).toHaveLength(30);
  expect(snapshotSource).toBe(source);
  expect(medianMs).toBeLessThanOrEqual(50);
  expect(p95Ms).toBeLessThanOrEqual(100);
});
