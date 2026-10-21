import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { build } from "esbuild";

describe("@tikz-editor/core browser entry", () => {
  it("bundles the package root without Node built-ins", async () => {
    const result = await build({
      absWorkingDir: resolve(import.meta.dirname, ".."),
      entryPoints: ["packages/core/src/index.ts"],
      bundle: true,
      platform: "browser",
      format: "esm",
      write: false,
      logLevel: "silent",
    });

    expect(result.outputFiles).toHaveLength(1);
    expect(result.outputFiles[0]?.text.length).toBeGreaterThan(0);
  });
});
