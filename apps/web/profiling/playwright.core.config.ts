import { defineConfig } from "@playwright/test";

// The core cost probe needs Node and GC, not a browser or a Vite build.
export default defineConfig({
  testDir: ".",
  testMatch: "profile-coordinate-writer.spec.ts",
  timeout: 600_000,
  workers: 1,
  reporter: "list",
  projects: [{ name: "node-core" }]
});
