#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_SLICE_FILE = "scripts/mathjax-tex-corpus-slices.json";
const DEFAULT_OUT_DIR = "artifacts/mathjax-tex-corpus";
const DEFAULT_AGGREGATE_OUT = "artifacts/mathjax-tex-corpus/coverage-slices.json";
const CHECK_SCRIPT = "scripts/check-mathjax-tex-corpus-coverage.mjs";

const args = readArgs();
const sliceConfig = readSliceConfig(args.sliceFile);
const configuredSlices = Object.keys(sliceConfig.slices ?? {});
const slices = args.slices ?? configuredSlices;
for (const slice of slices) {
  if (!sliceConfig.slices?.[slice]) {
    throw new Error(`Unknown corpus slice: ${slice}. Known slices: ${configuredSlices.sort().join(", ")}`);
  }
}

const summaries = [];
for (const slice of slices) {
  summaries.push(runSlice(slice));
}

const aggregate = {
  sliceFile: relative(process.cwd(), args.sliceFile),
  outDir: relative(process.cwd(), args.outDir),
  slices: summaries,
};
mkdirSync(dirname(args.aggregateOut), { recursive: true });
writeFileSync(args.aggregateOut, `${JSON.stringify(aggregate, null, 2)}\n`, "utf8");

printTable(summaries);
console.log(`\nWrote ${relative(process.cwd(), args.aggregateOut)}`);

function readArgs() {
  const parsed = {
    sliceFile: DEFAULT_SLICE_FILE,
    outDir: DEFAULT_OUT_DIR,
    aggregateOut: DEFAULT_AGGREGATE_OUT,
    input: null,
    slices: null,
    jsonl: false,
    examples: 0,
  };
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === "--slice-file") {
      parsed.sliceFile = process.argv[++index] ?? parsed.sliceFile;
    } else if (arg === "--out-dir") {
      parsed.outDir = process.argv[++index] ?? parsed.outDir;
    } else if (arg === "--out") {
      parsed.aggregateOut = process.argv[++index] ?? parsed.aggregateOut;
    } else if (arg === "--input") {
      parsed.input = process.argv[++index] ?? null;
    } else if (arg === "--slices") {
      parsed.slices = readList(process.argv[++index] ?? "");
    } else if (arg === "--jsonl") {
      parsed.jsonl = true;
    } else if (arg === "--examples") {
      parsed.examples = Number(process.argv[++index] ?? parsed.examples);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  parsed.sliceFile = resolve(process.cwd(), parsed.sliceFile);
  parsed.outDir = resolve(process.cwd(), parsed.outDir);
  parsed.aggregateOut = resolve(process.cwd(), parsed.aggregateOut);
  parsed.input = parsed.input ? resolve(process.cwd(), parsed.input) : null;
  return parsed;
}

function readList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readSliceConfig(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing corpus slice file: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function runSlice(slice) {
  const out = resolve(args.outDir, `coverage-${slice}.json`);
  const commandArgs = [
    CHECK_SCRIPT,
    "--slice",
    slice,
    "--slice-file",
    args.sliceFile,
    "--out",
    out,
    "--examples",
    String(args.examples),
  ];
  if (args.input) {
    commandArgs.push("--input", args.input);
  }
  if (args.jsonl) {
    commandArgs.push("--jsonl-out", resolve(args.outDir, `${slice}-results.jsonl`));
  }

  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    throw new Error(`Coverage check failed for slice ${slice}.`);
  }
  return JSON.parse(readFileSync(out, "utf8"));
}

function printTable(summaries) {
  const rows = summaries.map((summary) => {
    const supported = summary.byTopStatus.supported ?? 0;
    return [
      summary.slice ?? "(all)",
      String(summary.entries),
      String(supported),
      `${((supported / Math.max(1, summary.entries)) * 100).toFixed(1)}%`,
      String(summary.byTopStatus["explicit-unsupported"] ?? 0),
      String(summary.byTopStatus["parser-error"] ?? 0),
      String(summary.byTopStatus["not-applicable"] ?? 0),
    ];
  });
  const headers = ["Slice", "Entries", "Supported", "Supported %", "Explicit unsupported", "Parser error", "Not applicable"];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
  printRow(headers, widths);
  printRow(headers.map((header) => "-".repeat(header.length)), widths);
  for (const row of rows) {
    printRow(row, widths);
  }
}

function printRow(values, widths) {
  console.log(values.map((value, index) => value.padEnd(widths[index])).join("  "));
}
