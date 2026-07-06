import { expect, test } from "@playwright/test";
import {
  canvasViewport,
  clickHitRegion,
  gotoApp,
  openMenuCommand,
  resetStorageBeforeNavigation,
  setSource,
  waitForHitRegions
} from "../e2e/helpers";
import { captureProfileVariant, readSourceRevision, writeScenarioReport } from "./framework";
import { getProfilingScenarioById } from "./scenario-registry";

const MANIFEST = getProfilingScenarioById("actions");

if (!MANIFEST) {
  throw new Error("Missing profiling manifest for actions.");
}

const SIMPLE_FIGURE = String.raw`\begin{tikzpicture}
\node[draw] at (2,2) {Hello};
\end{tikzpicture}`;

const REPETITIONS = 5;

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

async function prepareSelectedNode(page: import("@playwright/test").Page): Promise<void> {
  await gotoApp(page, "/");
  await setSource(page, SIMPLE_FIGURE);
  await page.getByRole("button", { name: "Select" }).click();
  await waitForHitRegions(page);
  await clickHitRegion(page, 0);
  await expect(page.locator("[data-handle-kind]").first()).toBeVisible();
}

test("profile action commands", async ({ page}, testInfo) => {
  const variants = [];

  await prepareSelectedNode(page);
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "rotate-right-90",
    label: "Rotate Right 90°",
    dimensions: {
      commandId: "edit.rotate-right-90",
      interaction: "menu-command"
    },
    run: async () => {
      const sourceRevisionBefore = await readSourceRevision(page);
      for (let index = 0; index < REPETITIONS; index += 1) {
        await openMenuCommand(page, "edit", "edit.rotate-right-90");
        await page.waitForTimeout(300);
      }
      const sourceRevisionAfter = await readSourceRevision(page);
      return {
        metrics: {
          repetitions: REPETITIONS,
          sourceRevisionDelta: sourceRevisionAfter - sourceRevisionBefore
        },
        frameStats: null,
        probeSnapshot: {
          sourceRevisionBefore,
          sourceRevisionAfter
        }
      };
    }
  }));

  await prepareSelectedNode(page);
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "nudge-right",
    label: "Nudge Right",
    dimensions: {
      key: "ArrowRight",
      interaction: "keyboard"
    },
    run: async () => {
      await canvasViewport(page).focus();
      const sourceRevisionBefore = await readSourceRevision(page);
      for (let index = 0; index < REPETITIONS; index += 1) {
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(300);
      }
      const sourceRevisionAfter = await readSourceRevision(page);
      return {
        metrics: {
          repetitions: REPETITIONS,
          sourceRevisionDelta: sourceRevisionAfter - sourceRevisionBefore
        },
        frameStats: null,
        probeSnapshot: {
          sourceRevisionBefore,
          sourceRevisionAfter
        }
      };
    }
  }));

  await prepareSelectedNode(page);
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "menu-overhead",
    label: "Menu Open/Close Overhead",
    dimensions: {
      interaction: "menu-toggle",
      mutatesSource: false
    },
    run: async () => {
      const sourceRevisionBefore = await readSourceRevision(page);
      for (let index = 0; index < REPETITIONS; index += 1) {
        await page.getByTestId("menu-section-edit").click();
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
      const sourceRevisionAfter = await readSourceRevision(page);
      return {
        metrics: {
          repetitions: REPETITIONS,
          sourceRevisionDelta: sourceRevisionAfter - sourceRevisionBefore
        },
        frameStats: null,
        probeSnapshot: {
          sourceRevisionBefore,
          sourceRevisionAfter
        }
      };
    }
  }));

  const reportPath = writeScenarioReport(MANIFEST, testInfo, variants);
  console.log(`[profiling] wrote ${reportPath}`);
});
