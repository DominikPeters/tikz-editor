#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ensureDistBuildFresh } from "./ensure-dist-build.mjs";

const repoRoot = process.cwd();
const args = readArgs();
if (!args.skipBuild) {
  ensureDistBuildFresh(repoRoot);
}

const compareScript = join(repoRoot, "scripts", "compare-tex-display-math.mjs");
const runs = [
  {
    id: "baseline",
    args: ["--summary-only", "--tolerance", args.tolerance],
  },
  {
    id: "align-matrix",
    args: ["--align-matrix", "--summary-only", "--tolerance", args.tolerance],
  },
  {
    id: "construct-matrix",
    args: ["--construct-matrix", "--summary-only", "--tolerance", args.tolerance],
  },
  ...args.seeds.map((seed) => ({
    id: `display-fuzz:${seed}`,
    args: ["--display-fuzz", String(args.fuzzCases), "--seed", String(seed), "--summary-only", "--tolerance", args.tolerance],
  })),
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
  console.error(`\nTeX display math fidelity matrix failed: ${failures.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("\nTeX display math fidelity matrix passed.");
}

function readArgs() {
  const parsed = {
    fuzzCases: 70,
    seeds: [20260615, 20260616],
    skipBuild: false,
    tolerance: "0.03",
  };

  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index] ?? "";
    if (arg === "--fuzz-cases") {
      parsed.fuzzCases = readPositiveInteger(process.argv[++index] ?? "", "--fuzz-cases");
    } else if (arg.startsWith("--fuzz-cases=")) {
      parsed.fuzzCases = readPositiveInteger(arg.slice("--fuzz-cases=".length), "--fuzz-cases");
    } else if (arg === "--seeds") {
      parsed.seeds = readSeedList(process.argv[++index] ?? "");
    } else if (arg.startsWith("--seeds=")) {
      parsed.seeds = readSeedList(arg.slice("--seeds=".length));
    } else if (arg === "--skip-build") {
      parsed.skipBuild = true;
    } else if (arg === "--tolerance") {
      parsed.tolerance = readTolerance(process.argv[++index] ?? "");
    } else if (arg.startsWith("--tolerance=")) {
      parsed.tolerance = readTolerance(arg.slice("--tolerance=".length));
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

function readSeedList(raw) {
  const seeds = raw.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => readPositiveInteger(value, "--seeds"));
  if (seeds.length === 0) {
    throw new Error("Expected --seeds to contain at least one comma-separated seed.");
  }
  return seeds;
}

function readTolerance(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Expected --tolerance to be a positive number.");
  }
  return raw;
}
