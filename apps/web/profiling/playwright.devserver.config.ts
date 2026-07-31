/**
 * Temporary profiling config against an ALREADY-RUNNING dev server on 5802
 * (npm run dev). Measures dev-mode latency, the environment interactive
 * testing happens in — not a regression gate.
 */
import { defineConfig, devices } from "@playwright/test";

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
    baseURL: "http://localhost:5802",
    trace: "off"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
