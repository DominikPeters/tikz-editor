import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { ensureDistBuildFresh } from "./ensure-dist-build.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArgs(process.argv.slice(2));
const inputPath = resolve(repoRoot, options.input);
const source = readFileSync(inputPath, "utf8");

ensureDistBuildFresh(repoRoot);
const { prepareBeamerDocument, scanBeamerDocument } = await import(
  resolve(repoRoot, "packages/core/dist/index.js")
);

runWarmups("scan", options.warmups, (revision) => {
  scanBeamerDocument(revisionSource(source, "scan-warmup", revision));
});
const scanTimesMs = measureRevisions(
  "scan",
  options.iterations,
  (revision) => {
    scanBeamerDocument(revisionSource(source, "scan", revision));
  }
);

runWarmups("prepare", options.warmups, (revision) => {
  prepareBeamerDocument(revisionSource(source, "prepare-warmup", revision));
});
const prepareTimesMs = measureRevisions(
  "prepare",
  options.iterations,
  (revision) => {
    prepareBeamerDocument(revisionSource(source, "prepare", revision));
  }
);

const document = scanBeamerDocument(source);
const result = {
  benchmark: "beamer-frontend",
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  input: {
    path: options.input,
    bytes: Buffer.byteLength(source),
    characters: source.length,
    frames: document.frames.length,
  },
  settings: {
    warmups: options.warmups,
    iterations: options.iterations,
    revisionMode: "unique-trailing-comment",
  },
  phases: {
    scanBeamerDocument: summarize(scanTimesMs),
    prepareBeamerDocument: summarize(prepareTimesMs),
  },
};

if (options.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  console.log("# Beamer frontend benchmark");
  console.log(
    `# input=${options.input} bytes=${result.input.bytes} frames=${result.input.frames}`
  );
  console.log(
    `# warmups=${options.warmups} iterations=${options.iterations} revisionMode=${result.settings.revisionMode}`
  );
  for (const [phase, summary] of Object.entries(result.phases)) {
    console.log(
      `${phase}: median=${summary.medianMs.toFixed(3)}ms p95=${summary.p95Ms.toFixed(3)}ms min=${summary.minMs.toFixed(3)}ms max=${summary.maxMs.toFixed(3)}ms`
    );
  }
}

function revisionSource(base, phase, revision) {
  return `${base}\n% codex-beamer-frontend-benchmark:${phase}:${revision}`;
}

function runWarmups(_phase, count, callback) {
  for (let revision = 0; revision < count; revision += 1) {
    callback(revision);
  }
}

function measureRevisions(_phase, count, callback) {
  const samples = [];
  for (let revision = 0; revision < count; revision += 1) {
    const started = performance.now();
    callback(revision);
    samples.push(performance.now() - started);
  }
  return samples;
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    samples: sorted.length,
    minMs: sorted[0] ?? 0,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1) ?? 0,
  };
}

function percentile(sorted, quantile) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1)
  );
  return sorted[index] ?? 0;
}

function parseArgs(args) {
  const options = {
    input: "test/fixtures/beamer/kkt_theorem_beamer.tex",
    iterations: 200,
    warmups: 25,
    json: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--input") {
      options.input = requireValue(args, ++index, "--input");
    } else if (argument === "--iterations") {
      options.iterations = parsePositiveInteger(
        requireValue(args, ++index, "--iterations"),
        "--iterations"
      );
    } else if (argument === "--warmups") {
      options.warmups = parseNonNegativeInteger(
        requireValue(args, ++index, "--warmups"),
        "--warmups"
      );
    } else if (argument === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function requireValue(args, index, flag) {
  const value = args[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return parsed;
}
