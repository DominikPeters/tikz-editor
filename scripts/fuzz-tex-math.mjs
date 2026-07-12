#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadTexFuzzModules } from "./lib/tex-fuzz-loader.mjs";

const distEntry = resolve(process.cwd(), "packages/core/dist/text/tex/math/index.js");

if (!existsSync(distEntry)) {
  throw new Error("Missing packages/core/dist/text/tex/math/index.js. Run `npm run -w @tikz-editor/core build` first.");
}

const { parseTexMath } = await import(distEntry);
const { generateTexMathFuzzCase } = await loadTexFuzzModules();

const args = readArgs();
if (!args.parserOnly) {
  throw new Error("Only --parser-only is currently implemented.");
}

const rng = makeRng(args.seed);
const failures = [];
let diagnostics = 0;
let unsupported = 0;
for (let index = 0; index < args.cases; index += 1) {
  // Parser fuzzing deliberately keeps recovery paths hot. The comparison
  // runner uses the same shared generator with malformed input disabled.
  const source = generateTexMathFuzzCase(caseSeed(args.seed, index), {
    malformed: index % 5 === 0,
  }).source;
  const sourceOffset = args.randomSourceOffset ? randomInt(rng, 1000) : args.sourceOffset;
  try {
    const parsed = parseTexMath(source, { sourceOffset });
    diagnostics += parsed.diagnostics.length;
    unsupported += parsed.diagnostics.filter((diagnostic) => diagnostic.code === "unsupported-command").length;
    const spanFailures = validateParseResultSpans(parsed, source, sourceOffset);
    if (spanFailures.length > 0) {
      failures.push({
        index,
        source,
        sourceOffset,
        kind: "invalid-span",
        failures: spanFailures,
      });
    }
  } catch (error) {
    failures.push({
      index,
      source,
      sourceOffset,
      kind: "parser-crash",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const summary = {
  mode: "parser-only",
  cases: args.cases,
  seed: args.seed,
  sourceOffset: args.randomSourceOffset ? "random" : args.sourceOffset,
  diagnostics,
  unsupported,
  failed: failures.length,
  examples: failures.slice(0, args.examples),
};
console.log(JSON.stringify(summary, null, 2));
if (failures.length > 0) {
  process.exitCode = 1;
}

function validateParseResultSpans(parsed, source, sourceOffset) {
  const failures = [];
  const sourceEnd = sourceOffset + source.length;
  visitSpans(parsed.list, "$.list", sourceOffset, sourceEnd, failures, new Set());
  for (let index = 0; index < (parsed.tokens ?? []).length; index += 1) {
    const token = parsed.tokens[index];
    visitSpans(token, `$.tokens[${index}]`, sourceOffset, sourceEnd, failures, new Set());
    const textFromSpan = source.slice(
      token.sourceSpan.start - sourceOffset,
      token.sourceSpan.end - sourceOffset
    );
    if (textFromSpan !== token.text) {
      failures.push(`$.tokens[${index}] span/text mismatch: ${JSON.stringify(token)} in ${JSON.stringify(source)}`);
    }
  }
  for (let index = 0; index < (parsed.diagnostics ?? []).length; index += 1) {
    const diagnostic = parsed.diagnostics[index];
    visitSpans(diagnostic, `$.diagnostics[${index}]`, sourceOffset, sourceEnd, failures, new Set());
  }
  return failures;
}

function visitSpans(value, path, sourceStart, sourceEnd, failures, seen) {
  if (!value || typeof value !== "object") {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  if (isSourceSpan(value)) {
    if (!Number.isInteger(value.start) || !Number.isInteger(value.end)) {
      failures.push(`${path} has non-integer span ${JSON.stringify(value)}`);
    } else if (value.start > value.end) {
      failures.push(`${path} has inverted span ${JSON.stringify(value)}`);
    } else if (value.start < sourceStart || value.end > sourceEnd) {
      failures.push(`${path} is outside ${sourceStart}-${sourceEnd}: ${JSON.stringify(value)}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitSpans(item, `${path}[${index}]`, sourceStart, sourceEnd, failures, seen));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visitSpans(child, `${path}.${key}`, sourceStart, sourceEnd, failures, seen);
  }
}

function isSourceSpan(value) {
  return Object.hasOwn(value, "start") &&
    Object.hasOwn(value, "end") &&
    Object.keys(value).every((key) => key === "start" || key === "end");
}

function caseSeed(seed, index) {
  return (seed + Math.imul(index, 0x9e3779b1)) >>> 0;
}

function readArgs() {
  const parsed = {
    parserOnly: false,
    cases: 10_000,
    seed: 20260615,
    sourceOffset: 0,
    randomSourceOffset: false,
    examples: 5,
  };
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index] ?? "";
    if (arg === "--parser-only") {
      parsed.parserOnly = true;
    } else if (arg === "--cases") {
      parsed.cases = readNonNegativeInteger(process.argv[++index] ?? "", "--cases");
    } else if (arg.startsWith("--cases=")) {
      parsed.cases = readNonNegativeInteger(arg.slice("--cases=".length), "--cases");
    } else if (arg === "--seed") {
      parsed.seed = readNonNegativeInteger(process.argv[++index] ?? "", "--seed");
    } else if (arg.startsWith("--seed=")) {
      parsed.seed = readNonNegativeInteger(arg.slice("--seed=".length), "--seed");
    } else if (arg === "--source-offset") {
      parsed.sourceOffset = readNonNegativeInteger(process.argv[++index] ?? "", "--source-offset");
    } else if (arg.startsWith("--source-offset=")) {
      parsed.sourceOffset = readNonNegativeInteger(arg.slice("--source-offset=".length), "--source-offset");
    } else if (arg === "--random-source-offset") {
      parsed.randomSourceOffset = true;
    } else if (arg === "--examples") {
      parsed.examples = readNonNegativeInteger(process.argv[++index] ?? "", "--examples");
    } else if (arg.startsWith("--examples=")) {
      parsed.examples = readNonNegativeInteger(arg.slice("--examples=".length), "--examples");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function readNonNegativeInteger(raw, label) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Expected ${label} to be a non-negative integer.`);
  }
  return value;
}

function randomInt(rng, maxExclusive) {
  return Math.floor(rng() * maxExclusive);
}

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
