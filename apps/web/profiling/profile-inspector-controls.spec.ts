import { expect, test, type Page } from "@playwright/test";
import {
  gotoApp,
  readSource,
  resetStorageBeforeNavigation,
  setSource,
} from "../e2e/helpers";
import {
  captureProfileVariant,
  readSourceRevision,
  summarizeFrameDurations,
  writeScenarioReport
} from "./framework";
import { getProfilingScenarioById } from "./scenario-registry";

const MANIFEST = getProfilingScenarioById("inspector-controls");

if (!MANIFEST) {
  throw new Error("Missing profiling manifest for inspector-controls.");
}

const PATH_SOURCE = String.raw`\begin{tikzpicture}
\draw[line width=0.8pt] (0,0) -- (3,0);
\end{tikzpicture}`;

type FrameProbeSnapshot = {
  frameDurations: number[];
};

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

async function installFrameProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const globalLike = window as typeof window & {
      __PW_INSPECTOR_CONTROLS_FRAME_PROBE__?: {
        reset: () => void;
        snapshot: () => FrameProbeSnapshot;
      };
    };
    if (globalLike.__PW_INSPECTOR_CONTROLS_FRAME_PROBE__) {
      return;
    }

    const frameDurations: number[] = [];
    let lastFrameTime: number | null = null;
    let rafId = 0;

    const onAnimationFrame = (timestamp: number) => {
      if (lastFrameTime != null) {
        frameDurations.push(timestamp - lastFrameTime);
      }
      lastFrameTime = timestamp;
      rafId = window.requestAnimationFrame(onAnimationFrame);
    };
    rafId = window.requestAnimationFrame(onAnimationFrame);

    globalLike.__PW_INSPECTOR_CONTROLS_FRAME_PROBE__ = {
      reset() {
        frameDurations.length = 0;
        lastFrameTime = null;
      },
      snapshot() {
        return { frameDurations: [...frameDurations] };
      }
    };

    window.addEventListener("beforeunload", () => window.cancelAnimationFrame(rafId));
  });
}

async function resetFrameProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as typeof window & {
      __PW_INSPECTOR_CONTROLS_FRAME_PROBE__?: { reset: () => void };
    }).__PW_INSPECTOR_CONTROLS_FRAME_PROBE__?.reset();
  });
}

async function readFrameProbe(page: Page): Promise<FrameProbeSnapshot> {
  return await page.evaluate(() => {
    const probe = (window as typeof window & {
      __PW_INSPECTOR_CONTROLS_FRAME_PROBE__?: { snapshot: () => FrameProbeSnapshot };
    }).__PW_INSPECTOR_CONTROLS_FRAME_PROBE__;
    if (!probe) {
      throw new Error("Inspector controls frame probe is not installed.");
    }
    return probe.snapshot();
  });
}

async function prepareSelectedPath(page: Page): Promise<void> {
  await setSource(page, PATH_SOURCE);
  await page.getByRole("button", { name: "Select" }).click();
  await page.evaluate(() => {
    (window as typeof window & {
      __TIKZ_EDITOR_APP_TEST_API__?: { selectSourceIds?: (sourceIds: string[]) => void };
    }).__TIKZ_EDITOR_APP_TEST_API__?.selectSourceIds?.(["path:0"]);
  });
  await expect(page.getByText("X shift", { exact: true })).toBeVisible();
  await expect(page.getByText("Line width", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dash style" })).toBeVisible();
}

async function summarizeRun(page: Page, sourceRevisionBefore: number) {
  await page.waitForTimeout(800);
  const sourceRevisionAfter = await readSourceRevision(page);
  const frameProbe = await readFrameProbe(page);
  return {
    metrics: {
      sourceRevisionDelta: sourceRevisionAfter - sourceRevisionBefore,
      finalSourceLength: (await readSource(page)).length
    },
    frameStats: summarizeFrameDurations(frameProbe.frameDurations),
    probeSnapshot: {
      sourceRevisionBefore,
      sourceRevisionAfter,
      frameCount: frameProbe.frameDurations.length
    }
  };
}

test("profile inspector controls on a selected path", async ({ page }, testInfo) => {
  const variants = [];

  await gotoApp(page, "/");
  await installFrameProbe(page);

  await prepareSelectedPath(page);
  await resetFrameProbe(page);
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "path-xshift-number",
    label: "Path X shift number input",
    dimensions: {
      elementKind: "path",
      property: "transform.xshift",
      control: "number-input"
    },
    run: async () => {
      const sourceRevisionBefore = await readSourceRevision(page);
      const input = page.getByRole("spinbutton").first();
      await input.fill("2");
      await expect.poll(async () => readSource(page)).toContain("xshift=2pt");
      return await summarizeRun(page, sourceRevisionBefore);
    }
  }));

  await prepareSelectedPath(page);
  await resetFrameProbe(page);
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "path-dash-style-dropdown",
    label: "Path dash style dropdown",
    dimensions: {
      elementKind: "path",
      property: "dashStyle",
      control: "custom-dropdown"
    },
    run: async () => {
      const sourceRevisionBefore = await readSourceRevision(page);
      await page.getByRole("button", { name: "Dash style" }).click();
      await page.getByRole("option", { name: /Dashed/ }).click();
      await expect.poll(async () => readSource(page)).toContain("dashed");
      return await summarizeRun(page, sourceRevisionBefore);
    }
  }));

  const reportPath = writeScenarioReport(MANIFEST, testInfo, variants);
  console.log(`[inspector-controls] wrote ${reportPath}`);
});
