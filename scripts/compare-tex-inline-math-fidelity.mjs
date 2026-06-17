#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ensureDistBuildFresh } from "./ensure-dist-build.mjs";

const repoRoot = process.cwd();
const args = readArgs();
if (!args.skipBuild) {
  ensureDistBuildFresh(repoRoot);
}

const compareScript = join(repoRoot, "scripts", "compare-tex-inline-math-paragraph.mjs");
const common = [
  "--summary-only",
  "--widths",
  args.widths,
  "--oracle-cache-dir",
  args.oracleCacheDir,
  "--glyph-tolerance",
  args.glyphTolerance,
];
const runs = [
  {
    id: "baseline",
    args: ["--summary-only", "--oracle-cache-dir", args.oracleCacheDir, "--glyph-tolerance", args.glyphTolerance],
  },
  {
    id: "glyph-baseline",
    args: ["--summary-only", "--compare-glyphs", "--oracle-cache-dir", args.oracleCacheDir, "--glyph-tolerance", args.glyphTolerance],
  },
  ...args.lineSeeds.flatMap((seed) => [
    {
      id: `line-fuzz:mixed:${seed}`,
      args: [...common, "--fuzz", String(args.lineFuzzCases), "--seed", String(seed), "--formula-mode", "mixed"],
    },
    {
      id: `line-fuzz:scripts:${seed}`,
      args: [...common, "--fuzz", String(args.lineFuzzCases), "--seed", String(seed), "--formula-mode", "scripts"],
    },
  ]),
  ...args.glyphSeeds.flatMap((seed) => [
    {
      id: `glyph-fuzz:mixed:${seed}`,
      args: [...common, "--compare-glyphs", "--fuzz", String(args.glyphFuzzCases), "--seed", String(seed), "--formula-mode", "mixed"],
    },
    {
      id: `glyph-fuzz:scripts:${seed}`,
      args: [...common, "--compare-glyphs", "--fuzz", String(args.glyphFuzzCases), "--seed", String(seed), "--formula-mode", "scripts"],
    },
  ]),
  ...args.absoluteSeeds.flatMap((seed) => [
    {
      id: `absolute-glyph-fuzz:mixed:${seed}`,
      args: [...common, "--absolute-glyphs", "--fuzz", String(args.absoluteFuzzCases), "--seed", String(seed), "--formula-mode", "mixed"],
    },
    {
      id: `absolute-glyph-fuzz:scripts:${seed}`,
      args: [...common, "--absolute-glyphs", "--fuzz", String(args.absoluteFuzzCases), "--seed", String(seed), "--formula-mode", "scripts"],
    },
  ]),
];

const failures = [];
for (const run of runs) {
  console.log(`\n== ${run.id} ==`);
  const result = spawnSync(process.execPath, [compareScript, ...run.args], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    failures.push(run.id);
  }
}

if (failures.length > 0) {
  console.error(`\nTeX inline math fidelity matrix failed: ${failures.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("\nTeX inline math fidelity matrix passed.");
}

function readArgs() {
  const parsed = {
    absoluteFuzzCases: 24,
    absoluteSeeds: [20260621],
    glyphFuzzCases: 24,
    glyphSeeds: [20260618],
    glyphTolerance: "0.05",
    lineFuzzCases: 32,
    lineSeeds: [20260615],
    oracleCacheDir: "artifacts/tex-inline-math-paragraph-oracle-cache",
    skipBuild: false,
    widths: "80,120,160",
  };

  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index] ?? "";
    if (arg === "--absolute-fuzz-cases") {
      parsed.absoluteFuzzCases = readPositiveInteger(process.argv[++index] ?? "", "--absolute-fuzz-cases");
    } else if (arg.startsWith("--absolute-fuzz-cases=")) {
      parsed.absoluteFuzzCases = readPositiveInteger(arg.slice("--absolute-fuzz-cases=".length), "--absolute-fuzz-cases");
    } else if (arg === "--absolute-seeds") {
      parsed.absoluteSeeds = readSeedList(process.argv[++index] ?? "", "--absolute-seeds");
    } else if (arg.startsWith("--absolute-seeds=")) {
      parsed.absoluteSeeds = readSeedList(arg.slice("--absolute-seeds=".length), "--absolute-seeds");
    } else if (arg === "--glyph-fuzz-cases") {
      parsed.glyphFuzzCases = readPositiveInteger(process.argv[++index] ?? "", "--glyph-fuzz-cases");
    } else if (arg.startsWith("--glyph-fuzz-cases=")) {
      parsed.glyphFuzzCases = readPositiveInteger(arg.slice("--glyph-fuzz-cases=".length), "--glyph-fuzz-cases");
    } else if (arg === "--glyph-seeds") {
      parsed.glyphSeeds = readSeedList(process.argv[++index] ?? "", "--glyph-seeds");
    } else if (arg.startsWith("--glyph-seeds=")) {
      parsed.glyphSeeds = readSeedList(arg.slice("--glyph-seeds=".length), "--glyph-seeds");
    } else if (arg === "--glyph-tolerance") {
      parsed.glyphTolerance = readTolerance(process.argv[++index] ?? "");
    } else if (arg.startsWith("--glyph-tolerance=")) {
      parsed.glyphTolerance = readTolerance(arg.slice("--glyph-tolerance=".length));
    } else if (arg === "--line-fuzz-cases") {
      parsed.lineFuzzCases = readPositiveInteger(process.argv[++index] ?? "", "--line-fuzz-cases");
    } else if (arg.startsWith("--line-fuzz-cases=")) {
      parsed.lineFuzzCases = readPositiveInteger(arg.slice("--line-fuzz-cases=".length), "--line-fuzz-cases");
    } else if (arg === "--line-seeds") {
      parsed.lineSeeds = readSeedList(process.argv[++index] ?? "", "--line-seeds");
    } else if (arg.startsWith("--line-seeds=")) {
      parsed.lineSeeds = readSeedList(arg.slice("--line-seeds=".length), "--line-seeds");
    } else if (arg === "--oracle-cache-dir") {
      parsed.oracleCacheDir = process.argv[++index] ?? parsed.oracleCacheDir;
    } else if (arg.startsWith("--oracle-cache-dir=")) {
      parsed.oracleCacheDir = arg.slice("--oracle-cache-dir=".length);
    } else if (arg === "--skip-build") {
      parsed.skipBuild = true;
    } else if (arg === "--widths") {
      parsed.widths = readWidths(process.argv[++index] ?? "");
    } else if (arg.startsWith("--widths=")) {
      parsed.widths = readWidths(arg.slice("--widths=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function readPositiveInteger(raw, label) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Expected ${label} to be a positive integer.`);
  }
  return value;
}

function readSeedList(raw, label) {
  const seeds = raw.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => readPositiveInteger(value, label));
  if (seeds.length === 0) {
    throw new Error(`Expected ${label} to contain at least one comma-separated seed.`);
  }
  return seeds;
}

function readTolerance(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Expected --glyph-tolerance to be a positive number.");
  }
  return raw;
}

function readWidths(raw) {
  const widths = raw.split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (widths.length === 0) {
    throw new Error("--widths must contain at least one positive number.");
  }
  return widths.join(",");
}
