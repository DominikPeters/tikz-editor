import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { readAppProfilingSnapshot } from "../../../packages/app/src/profiling.js";
import { writeScenarioReport } from "./framework.js";
import { getProfilingScenarioById } from "./scenario-registry.js";

test("profile coordinate writer insertion, paste, repeat and context memory", async ({ browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Core-only benchmark is independent of browser; run it once.");
  test.setTimeout(600_000);
  const script = fileURLToPath(new URL("./coordinate-writer-benchmark.ts", import.meta.url));
  const raw = execFileSync(process.execPath, ["--expose-gc", "--import", "tsx", script], { encoding: "utf8", timeout: 550_000, maxBuffer: 4 * 1024 * 1024 });
  const report = JSON.parse(raw) as { cases: unknown[]; captures: Array<{ uniqueCaptures: number }> };
  expect(report.cases.length).toBeGreaterThan(0);
  expect(report.captures.map(capture => capture.uniqueCaptures)).toEqual([1, 10000]);
  const directory = fileURLToPath(new URL("./traces/", import.meta.url));
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}coordinate-writer-core-report.json`, raw);
  const manifest = getProfilingScenarioById("coordinate-writer");
  if (!manifest) throw new Error("missing coordinate-writer scenario");
  writeScenarioReport(manifest, testInfo, [{ id: "node-core", label: "Core operations and retained contexts",
    dimensions: { runtime: "node", includesPaint: false }, artifacts: { cpuProfilePath: null, analysisPath: null },
    metrics: report, frameStats: null, probeSnapshot: null,
    // This process makes no app calls. The measured operations run in the
    // isolated Node child, and no browser counters or frame times are claimed.
    instrumentation: readAppProfilingSnapshot() }], "core");
  await testInfo.attach("coordinate-writer-core-report", { body: raw, contentType: "application/json" });
});
