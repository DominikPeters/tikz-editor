/**
 * Profiling against an already-running development server. Select engines with
 * PLAYWRIGHT_BROWSERS and override the URL with TIKZ_PROFILE_BASE_URL.
 * Measures development latency rather than a production regression threshold.
 */
import { defineConfig, devices } from "@playwright/test";

const engines = {
  chromium: devices["Desktop Chrome"],
  firefox: devices["Desktop Firefox"],
  webkit: devices["Desktop Safari"]
};
const projects = (process.env.PLAYWRIGHT_BROWSERS ?? "chromium").split(",").map(name => {
  const browser = name.trim();
  if (!(browser in engines)) throw new Error(`Unsupported profiling browser: ${browser}`);
  return { name: browser, use: { ...engines[browser as keyof typeof engines] } };
});

export default defineConfig({
  testDir: ".",
  timeout: 180_000,
  expect: {
    timeout: 15_000
  },
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.TIKZ_PROFILE_BASE_URL ?? "http://127.0.0.1:5802",
    trace: "off"
  },
  projects
});
