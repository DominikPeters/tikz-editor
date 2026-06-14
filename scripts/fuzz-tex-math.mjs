#!/usr/bin/env node

import { parseTexMath } from "../packages/core/dist/text/tex/math/index.js";

const args = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const arg = process.argv[index] ?? "";
  if (arg.startsWith("--")) {
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args.set(key, inlineValue);
    } else {
      args.set(key, process.argv[index + 1]?.startsWith("--") ? "true" : process.argv[++index] ?? "true");
    }
  }
}

const cases = readIntegerArg("cases", 10_000);
const seed = readIntegerArg("seed", 20260615);
const maxLength = readIntegerArg("max-length", 48);
const rng = makeRng(seed);
let diagnostics = 0;
let unsupported = 0;

for (let index = 0; index < cases; index++) {
  const source = randomMathSource(maxLength, rng);
  const sourceOffset = Math.floor(rng() * 1000);
  let result;
  try {
    result = parseTexMath(source, { sourceOffset });
  } catch (error) {
    console.error(`TeX math parser threw on case ${index}: ${JSON.stringify(source)}`);
    throw error;
  }
  diagnostics += result.diagnostics.length;
  unsupported += result.diagnostics.filter((diagnostic) => diagnostic.code === "unsupported-command").length;
  assertSpan("list", result.list.sourceSpan, sourceOffset, source.length, source);
  for (const token of result.tokens) {
    assertSpan(`token ${token.kind}`, token.sourceSpan, sourceOffset, source.length, source);
    const textFromSpan = source.slice(
      token.sourceSpan.start - sourceOffset,
      token.sourceSpan.end - sourceOffset
    );
    if (textFromSpan !== token.text) {
      throw new Error(`Token span/text mismatch for ${JSON.stringify(source)}: ${JSON.stringify(token)}`);
    }
  }
  walkItems(result.list.items, sourceOffset, source.length, source);
}

console.log(JSON.stringify({
  cases,
  seed,
  maxLength,
  diagnostics,
  unsupported,
}, null, 2));

function readIntegerArg(name, fallback) {
  const raw = args.get(name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected --${name} to be a non-negative integer.`);
  }
  return parsed;
}

function randomMathSource(maxLength, rng) {
  const pieces = [
    "x", "y", "z", "a", "b", "1", "2", "3", "+", "-", "=", ",",
    "^", "_", "{", "}", " ", String.raw`\frac`, String.raw`\sqrt`,
    String.raw`\,`, String.raw`\quad`, String.raw`\unknown`,
  ];
  const length = Math.max(1, Math.floor(rng() * maxLength));
  let source = "";
  for (let index = 0; index < length; index++) {
    source += pieces[Math.floor(rng() * pieces.length)] ?? "x";
  }
  return source;
}

function walkItems(items, sourceOffset, sourceLength, source) {
  for (const item of items) {
    assertSpan(item.kind, item.sourceSpan, sourceOffset, sourceLength, source);
    if (item.kind !== "atom") {
      continue;
    }
    walkNucleus(item.nucleus, sourceOffset, sourceLength, source);
    if (item.subscript) {
      assertSpan("subscript", item.subscript.sourceSpan, sourceOffset, sourceLength, source);
      walkItems(item.subscript.list.items, sourceOffset, sourceLength, source);
    }
    if (item.superscript) {
      assertSpan("superscript", item.superscript.sourceSpan, sourceOffset, sourceLength, source);
      walkItems(item.superscript.list.items, sourceOffset, sourceLength, source);
    }
  }
}

function walkNucleus(nucleus, sourceOffset, sourceLength, source) {
  assertSpan(`nucleus ${nucleus.kind}`, nucleus.sourceSpan, sourceOffset, sourceLength, source);
  if (nucleus.kind === "list") {
    walkItems(nucleus.list.items, sourceOffset, sourceLength, source);
  } else if (nucleus.kind === "fraction") {
    walkItems(nucleus.numerator.items, sourceOffset, sourceLength, source);
    walkItems(nucleus.denominator.items, sourceOffset, sourceLength, source);
  } else if (nucleus.kind === "radical") {
    walkItems(nucleus.radicand.items, sourceOffset, sourceLength, source);
  }
}

function assertSpan(label, span, sourceOffset, sourceLength, source) {
  const min = sourceOffset;
  const max = sourceOffset + sourceLength;
  if (
    !Number.isInteger(span.start) ||
    !Number.isInteger(span.end) ||
    span.start < min ||
    span.end < span.start ||
    span.end > max
  ) {
    throw new Error(`${label} has invalid span ${JSON.stringify(span)} for ${JSON.stringify(source)} at offset ${sourceOffset}.`);
  }
}

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
