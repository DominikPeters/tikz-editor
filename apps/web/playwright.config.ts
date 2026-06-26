import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const withoutColorEnv = "env -u NO_COLOR -u FORCE_COLOR";
const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR ??
  path.join(os.tmpdir(), "tikz-editor-playwright-results", "web");
const browserProjects = {
  chromium: {
    name: "chromium",
    use: { ...devices["Desktop Chrome"] }
  },
  firefox: {
    name: "firefox",
    use: { ...devices["Desktop Firefox"] }
  },
  webkit: {
    name: "webkit",
    use: { ...devices["Desktop Safari"] }
  }
} as const;

function getBrowserProjects() {
  const requestedBrowsers = (process.env.PLAYWRIGHT_BROWSERS ?? "chromium")
    .split(",")
    .map((browser) => browser.trim())
    .filter(Boolean);

  const invalidBrowsers = requestedBrowsers.filter((browser) => !(browser in browserProjects));
  if (invalidBrowsers.length > 0) {
    throw new Error(
      `Unsupported PLAYWRIGHT_BROWSERS value(s): ${invalidBrowsers.join(", ")}. ` +
        `Supported browsers are: ${Object.keys(browserProjects).join(", ")}.`
    );
  }

  return requestedBrowsers.map((browser) => browserProjects[browser as keyof typeof browserProjects]);
}

export default defineConfig({
  testDir: "./e2e",
  outputDir,
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure"
  },
  webServer: {
    command: `${withoutColorEnv} npm run build -- --base / && ${withoutColorEnv} npx vite preview --host 127.0.0.1 --port 4173`,
    cwd: ".",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: getBrowserProjects()
});
