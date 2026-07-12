import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { texFuzzCacheKey } from "../scripts/lib/tex-fuzz-cache.mjs";
import {
  commandExists,
  mapTexFuzzWorkers,
  partitionTexFuzzBatches,
  runBatchedTexSupportOracle,
  runBatchedTexSupportOracleAsync,
  selectTexFuzzEscalation,
} from "../scripts/lib/tex-fuzz-oracle.mjs";

const runOracleIntegration = process.env.TEX_FUZZ_ORACLE_TESTS === "1" && commandExists("lualatex");

describe("TeX fuzz oracle hardening", () => {
  it("partitions batches and preserves worker result ordering", async () => {
    expect(partitionTexFuzzBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    const finished: number[] = [];
    const result = await mapTexFuzzWorkers([30, 5, 15], 2, async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      finished.push(index);
      return `result-${index}`;
    });
    expect(finished).not.toEqual([0, 1, 2]);
    expect(result).toEqual(["result-0", "result-1", "result-2"]);
  });

  it("invalidates cache identities for source, preamble, layer, and environment changes", () => {
    const base = { source: "x", preamble: "p", layer: "structural", environment: { engine: "one" } };
    const key = texFuzzCacheKey(base);
    expect(new Set([
      key,
      texFuzzCacheKey({ ...base, source: "y" }),
      texFuzzCacheKey({ ...base, preamble: "q" }),
      texFuzzCacheKey({ ...base, layer: "visual" }),
      texFuzzCacheKey({ ...base, environment: { engine: "two" } }),
    ]).size).toBe(5);
  });

  it("selects all findings and a repeatable diversity control sample", () => {
    const cases = Array.from({ length: 20 }, (_, index) => ({ id: `c${index}`, source: `${index}` }));
    const first = selectTexFuzzEscalation(cases, { findingIds: ["c7"], controlSampleSize: 4, seed: 42 });
    const second = selectTexFuzzEscalation(cases, { findingIds: ["c7"], controlSampleSize: 4, seed: 42 });
    expect(first).toEqual(second);
    expect(first).toHaveLength(5);
    expect(first[0].id).toBe("c7");
  });

  it("honors cancellation before scheduling any batches", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled for test"));
    await expect(runBatchedTexSupportOracleAsync([{ source: "Alpha" }], { signal: controller.signal }))
      .rejects.toThrow("cancelled for test");
  });

  it.runIf(runOracleIntegration)("caches exact observations and isolates global sentinel corruption", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "tex-fuzz-cache-test-"));
    try {
      const cases = [
        { id: "good-a", source: "Alpha" },
        { id: "leak", source: "\\global\\tfzsentinel=2 Corrupt" },
        { id: "good-b", source: "Beta" },
      ];
      const first = await runBatchedTexSupportOracleAsync(cases, { batchSize: 3, workers: 2, cacheDir });
      expect(first.observations.map(({ supported }) => supported)).toEqual([true, false, true]);
      expect(first.stats.bisectedFailures).toBeGreaterThan(0);
      expect(first.stats.cacheMisses).toBe(3);
      const second = runBatchedTexSupportOracle(cases, { batchSize: 1, cacheDir });
      expect(second.observations).toEqual(first.observations);
      expect(second.stats).toMatchObject({ compilations: 0, cacheHits: 3, cacheMisses: 0, cacheWrites: 0 });
      const invalidated = runBatchedTexSupportOracle([cases[0]], { cacheDir, layer: "different-layer" });
      expect(invalidated.stats).toMatchObject({ cacheHits: 0, cacheMisses: 1, compilations: 1 });
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 30_000);

  it.runIf(runOracleIntegration)("bounds each compilation with a timeout", () => {
    const result = runBatchedTexSupportOracle([{ id: "slow", source: "\\directlua{while true do end}" }], { timeoutMs: 100 });
    expect(result.observations[0]).toMatchObject({ id: "slow", supported: false });
    expect(result.observations[0].error).toMatch(/timed out|ETIMEDOUT/i);
  }, 5_000);
});
