import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR ?? ".vite-temp",
  test: {
    include: ["test/**/*.spec.ts"],
    environment: "node",
    // The full suite intentionally runs several CPU-heavy render/fuzz files in
    // parallel. Keep individual logic timeouts explicit where stricter bounds
    // matter, while avoiding false failures caused by worker contention.
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/*.types.ts",
        "**/types.ts",
        "**/vite-env.d.ts",
        "**/generated/**",
        "**/generated-*.ts",
        "packages/lezer-tikz/src/grammar/**"
      ]
    }
  },
  resolve: {
    alias: {
      "@tikz-editor/core": path.resolve(rootDir, "./packages/core/src"),
      "@tikz-editor/tex-fuzz": path.resolve(rootDir, "./packages/tex-fuzz/src/index.ts"),
      "@tikz-editor/lang-tikz": path.resolve(rootDir, "./packages/lang-tikz/src/index.ts"),
      "@tikz-editor/lezer-tikz/grammar/tikz-parser.terms": path.resolve(
        rootDir,
        "./packages/lezer-tikz/src/grammar/tikz-parser.terms.ts"
      ),
      "@tikz-editor/lezer-tikz/grammar/tikz-parser": path.resolve(
        rootDir,
        "./packages/lezer-tikz/src/grammar/tikz-parser.ts"
      ),
      "@tikz-editor/lezer-tikz": path.resolve(rootDir, "./packages/lezer-tikz/src/index.ts")
    }
  }
});
