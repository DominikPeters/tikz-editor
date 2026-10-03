import { expect, test, type Page } from "@playwright/test";
import { gotoApp, resetStorageBeforeNavigation } from "./helpers";

type UpdateEnvOptions = {
  updateAvailable?: boolean;
  installFails?: boolean;
  automaticChecks?: boolean;
  preferenceFails?: boolean;
};

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

async function installUpdateEnv(page: Page, options: UpdateEnvOptions = {}): Promise<void> {
  await page.addInitScript((opts: UpdateEnvOptions) => {
    let updateAvailable = opts.updateAvailable ?? true;
    const installFails = opts.installFails ?? false;
    const progressEvents: unknown[] = [];
    let relaunchCalls = 0;
    let checkCalls = 0;
    let automaticChecks = opts.automaticChecks ?? true;

    (globalThis as typeof globalThis & {
      __UPDATE_TEST__?: {
        setUpdateAvailable: (available: boolean) => void;
        getProgressEvents: () => unknown[];
        getRelaunchCalls: () => number;
        getCheckCalls: () => number;
        getAutomaticChecks: () => boolean;
      };
      __TIKZ_EDITOR_BROWSER_PLATFORM_ENV__?: unknown;
    }).__UPDATE_TEST__ = {
      setUpdateAvailable: (available) => {
        updateAvailable = available;
      },
      getProgressEvents: () => progressEvents,
      getRelaunchCalls: () => relaunchCalls,
      getCheckCalls: () => checkCalls,
      getAutomaticChecks: () => automaticChecks
    };

    (globalThis as typeof globalThis & {
      __TIKZ_EDITOR_BROWSER_PLATFORM_ENV__?: unknown;
    }).__TIKZ_EDITOR_BROWSER_PLATFORM_ENV__ = {
      id: "desktop-tauri",
      updates: {
        getAutomaticUpdateChecks: async () => {
          // Exercise the asynchronous preference read before the first request.
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (opts.preferenceFails) throw new Error("preference unavailable");
          return automaticChecks;
        },
        setAutomaticUpdateChecks: async (enabled: boolean) => { automaticChecks = enabled; },
        resetAutomaticUpdateChecks: async () => { automaticChecks = true; return automaticChecks; },
        checkForUpdate: async () => {
          checkCalls += 1;
          return updateAvailable
          ? {
              version: "0.2.0",
              currentVersion: "0.1.0",
              date: "2026-05-08T12:00:00Z",
              body: "## Highlights\n\n- Update notes\n- **Bold note**"
            }
          : null;
        },
        installUpdate: async (onProgress: (event: unknown) => void) => {
          if (installFails) {
            throw new Error("download failed");
          }
          const events = [
            { type: "started", contentLength: 100 },
            { type: "progress", chunkLength: 40 },
            { type: "progress", chunkLength: 60 },
            { type: "finished" }
          ];
          for (const event of events) {
            progressEvents.push(event);
            onProgress(event);
          }
        },
        relaunch: async () => {
          relaunchCalls += 1;
        }
      }
    };
  }, options);
}

async function getCheckCalls(page: Page): Promise<number> {
  return await page.evaluate(() => (globalThis as typeof globalThis & {
    __UPDATE_TEST__?: { getCheckCalls: () => number };
  }).__UPDATE_TEST__?.getCheckCalls() ?? 0);
}

test("disabled automatic checks make no startup request but allow manual checks", async ({ page }) => {
  await installUpdateEnv(page, { automaticChecks: false });
  await gotoApp(page);
  await page.evaluate(() => {
    (globalThis as typeof globalThis & {
      __TIKZ_EDITOR_APP_TEST_API__?: { runCommand?: (id: string) => boolean };
    }).__TIKZ_EDITOR_APP_TEST_API__?.runCommand?.("file.open-settings");
  });
  const preference = page.getByRole("checkbox", { name: "Automatically Check for Updates on Startup" });
  const generalGroup = page.locator("#setting-ui-font-size").locator("..").locator("..");
  await expect(generalGroup.locator("#setting-automatic-update-checks")).toHaveCount(1);
  await expect(preference).toBeEnabled();
  await expect(preference).not.toBeChecked();
  expect(await getCheckCalls(page)).toBe(0);
  await preference.check();
  await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & {
    __UPDATE_TEST__?: { getAutomaticChecks: () => boolean };
  }).__UPDATE_TEST__?.getAutomaticChecks())).toBe(true);
  await preference.uncheck();
  await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & {
    __UPDATE_TEST__?: { getAutomaticChecks: () => boolean };
  }).__UPDATE_TEST__?.getAutomaticChecks())).toBe(false);
  await page.getByTestId("settings-reset-general").click();
  await expect(preference).toBeChecked();
  await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & {
    __UPDATE_TEST__?: { getAutomaticChecks: () => boolean };
  }).__UPDATE_TEST__?.getAutomaticChecks())).toBe(true);
  await page.getByRole("button", { name: "Close settings" }).click();
  await runCheckForUpdatesCommand(page);
  await expect(page.getByTestId("update-modal")).toBeVisible();
  expect(await getCheckCalls(page)).toBe(1);
});

test("a failed preference read does not enable automatic network requests", async ({ page }) => {
  await installUpdateEnv(page, { preferenceFails: true });
  await gotoApp(page);
  await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & {
    __TIKZ_EDITOR_APP_TEST_API__?: { runCommand?: (id: string) => boolean };
  }).__TIKZ_EDITOR_APP_TEST_API__?.runCommand?.("file.open-settings"))).toBe(true);
  await expect(page.getByRole("alert")).toHaveText("Could not load update preferences.");
  expect(await getCheckCalls(page)).toBe(0);
});

async function runCheckForUpdatesCommand(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (globalThis as typeof globalThis & {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        runCommand?: (commandId: string) => boolean;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    if (!api?.runCommand?.("help.check-for-updates")) {
      throw new Error("Check for Updates command did not run.");
    }
  });
}

test("startup update check shows toolbar chip and opens update modal", async ({ page }) => {
  await installUpdateEnv(page);
  await gotoApp(page);

  await expect(page.getByTestId("toolbar-update-chip")).toBeVisible();
  await page.getByTestId("toolbar-update-chip").click();
  await expect(page.getByTestId("update-modal")).toBeVisible();
  await expect(page.getByText("0.2.0")).toBeVisible();
  await expect(page.getByText("Update notes")).toBeVisible();
  const heading = page.getByRole("heading", { name: "Highlights" });
  await expect(heading).toBeVisible();
  await expect(page.getByText("Bold note")).toHaveCSS("font-weight", "700");
  await expect.poll(async () => {
    const headingFontSize = await heading.evaluate((element) => getComputedStyle(element).fontSize);
    const notesFontSize = await page.getByTestId("update-notes").evaluate((element) => getComputedStyle(element).fontSize);
    return headingFontSize === notesFontSize;
  }).toBe(true);
});

test("later hides the update chip for the session", async ({ page }) => {
  await installUpdateEnv(page);
  await gotoApp(page);

  await page.getByTestId("toolbar-update-chip").click();
  await page.getByTestId("update-later").click();
  await expect(page.getByTestId("update-modal")).toHaveCount(0);
  await expect(page.getByTestId("toolbar-update-chip")).toHaveCount(0);
});

test("manual check reports no update with an alert", async ({ page }) => {
  await installUpdateEnv(page, { updateAvailable: false });
  await gotoApp(page);

  await Promise.all([
    page.waitForEvent("dialog").then(async (dialog) => {
      expect(dialog.message()).toContain("You're up to date.");
      await dialog.accept();
    }),
    runCheckForUpdatesCommand(page)
  ]);
});

test("manual check opens the modal when an update is found", async ({ page }) => {
  await installUpdateEnv(page);
  await gotoApp(page);

  await runCheckForUpdatesCommand(page);
  await expect(page.getByTestId("update-modal")).toBeVisible();
});

test("install progress relaunches after success", async ({ page }) => {
  await installUpdateEnv(page);
  await gotoApp(page);

  await page.getByTestId("toolbar-update-chip").click();
  await page.getByTestId("update-install").click();

  await expect(page.getByTestId("update-install-progress")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    return (globalThis as typeof globalThis & {
      __UPDATE_TEST__?: { getRelaunchCalls: () => number };
    }).__UPDATE_TEST__?.getRelaunchCalls() ?? 0;
  })).toBe(1);
});

test("install failure stays in the update modal with retry available", async ({ page }) => {
  await installUpdateEnv(page, { installFails: true });
  await gotoApp(page);

  await page.getByTestId("toolbar-update-chip").click();
  await page.getByTestId("update-install").click();

  await expect(page.getByTestId("update-install-error")).toContainText("download failed");
  await expect(page.getByTestId("update-install")).toHaveText("Retry");
  await expect(page.getByTestId("update-later")).toBeEnabled();
});
