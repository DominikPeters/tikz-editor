#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const distEntry = resolve(process.cwd(), "packages/core/dist/text/tex/math/index.js");

if (!existsSync(distEntry)) {
  throw new Error("Missing packages/core/dist/text/tex/math/index.js. Run `npm run -w @tikz-editor/core build` first.");
}

const { parseTexMath } = await import(distEntry);

const args = readArgs();
if (!args.parserOnly) {
  throw new Error("Only --parser-only is currently implemented.");
}

const rng = makeRng(args.seed);
const failures = [];
let diagnostics = 0;
let unsupported = 0;
for (let index = 0; index < args.cases; index += 1) {
  const source = randomMathSource(rng);
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

function randomMathSource(rng) {
  const mode = randomInt(rng, 10);
  if (mode === 0) {
    return randomMalformedSource(rng);
  }
  if (mode === 1) {
    return randomEnvironmentSource(rng);
  }
  if (mode === 2) {
    return randomDelimitedSource(rng);
  }
  return randomExpression(rng, 0);
}

function randomExpression(rng, depth) {
  const count = 1 + randomInt(rng, depth > 1 ? 2 : 4);
  const parts = [randomTerm(rng, depth)];
  for (let index = 1; index < count; index += 1) {
    parts.push(randomInfix(rng));
    parts.push(randomTerm(rng, depth));
  }
  return parts.join(randomInt(rng, 4) === 0 ? " " : "");
}

function randomTerm(rng, depth) {
  const choices = depth >= 3
    ? ["atom", "group", "command"]
    : ["atom", "group", "command", "frac", "sqrt", "script", "accent", "text", "operatorname", "xarrow"];
  const choice = choices[randomInt(rng, choices.length)] ?? "atom";
  if (choice === "group") {
    return "{" + randomExpression(rng, depth + 1) + "}";
  }
  if (choice === "frac") {
    const command = randomChoice(rng, ["\\frac", "\\dfrac", "\\tfrac", "\\binom"]);
    return command + randomArgument(rng, depth) + randomArgument(rng, depth);
  }
  if (choice === "sqrt") {
    return "\\sqrt" + randomArgument(rng, depth);
  }
  if (choice === "script") {
    return randomScriptableBase(rng, depth) + randomScriptSuffix(rng, depth);
  }
  if (choice === "accent") {
    return randomChoice(rng, [
      "\\hat",
      "\\bar",
      "\\tilde",
      "\\vec",
      "\\dot",
      "\\ddot",
    ]) + randomArgument(rng, depth);
  }
  if (choice === "text") {
    return randomChoice(rng, ["\\text", "\\mathrm", "\\mathit", "\\mathbf"]) +
      "{" + randomChoice(rng, ["if", "office", "ABC", "x+y", "\\bad"]) + "}";
  }
  if (choice === "operatorname") {
    return randomChoice(rng, ["\\operatorname", "\\operatorname*"]) +
      "{" + randomChoice(rng, ["rank", "arg\\,max", "\\bad"]) + "}";
  }
  if (choice === "xarrow") {
    const below = randomInt(rng, 2) === 0 ? "[" + randomExpression(rng, depth + 1) + "]" : "";
    return randomChoice(rng, ["\\xleftarrow", "\\xrightarrow"]) +
      below +
      randomArgument(rng, depth);
  }
  if (choice === "command") {
    return randomCommand(rng);
  }
  return randomAtom(rng);
}

function randomScriptableBase(rng, depth) {
  return randomChoice(rng, [
    randomAtom(rng),
    "{" + randomExpression(rng, depth + 1) + "}",
    "\\sqrt" + randomArgument(rng, depth),
    "\\frac" + randomArgument(rng, depth) + randomArgument(rng, depth),
  ]);
}

function randomScriptSuffix(rng, depth) {
  const sub = "_" + randomScriptArgument(rng, depth);
  const sup = "^" + randomScriptArgument(rng, depth);
  if (randomInt(rng, 2) === 0) {
    return sub + (randomInt(rng, 2) === 0 ? sup : "");
  }
  return sup + (randomInt(rng, 2) === 0 ? sub : "");
}

function randomArgument(rng, depth) {
  if (randomInt(rng, 4) === 0) {
    return randomTerm(rng, depth + 1);
  }
  return "{" + randomExpression(rng, depth + 1) + "}";
}

function randomScriptArgument(rng, depth) {
  if (randomInt(rng, 3) === 0) {
    return randomAtom(rng);
  }
  return "{" + randomExpression(rng, depth + 1) + "}";
}

function randomDelimitedSource(rng) {
  const pairs = [
    ["(", ")"],
    ["[", "]"],
    ["\\lbrace", "\\rbrace"],
    ["\\lfloor", "\\rfloor"],
    ["\\langle", "\\rangle"],
    ["|", "|"],
  ];
  const [left, right] = randomChoice(rng, pairs);
  return "\\left" + left + " " + randomExpression(rng, 1) + "\\right" + right;
}

function randomEnvironmentSource(rng) {
  const environment = randomChoice(rng, ["aligned", "matrix", "pmatrix", "array", "cases", "smallmatrix"]);
  const rows = [];
  const rowCount = 1 + randomInt(rng, 3);
  const columnCount = environment === "cases" ? 2 : 1 + randomInt(rng, 3);
  for (let row = 0; row < rowCount; row += 1) {
    const cells = [];
    for (let column = 0; column < columnCount; column += 1) {
      cells.push(randomExpression(rng, 2));
    }
    rows.push(cells.join("&"));
  }
  const preamble = environment === "array" ? "{lcr".slice(0, columnCount + 1) + "}" : "";
  return "\\begin{" + environment + "}" + preamble + rows.join("\\\\") + "\\end{" + environment + "}";
}

function randomMalformedSource(rng) {
  return randomChoice(rng, [
    "{",
    "}",
    "x_",
    "^",
    "\\frac{1}",
    "\\sqrt{",
    "\\left(x",
    "\\right)",
    "\\begin{matrix}a&b",
    "\\xrightarrow[abc{d}",
    randomExpression(rng, 1) + randomChoice(rng, ["{", "}", "_", "^", "\\unknown"]),
  ]);
}

function randomAtom(rng) {
  return randomChoice(rng, [
    "x",
    "y",
    "z",
    "A",
    "B",
    "1",
    "2",
    "3",
    "\\alpha",
    "\\beta",
    "\\Gamma",
    "\\infty",
  ]);
}

function randomCommand(rng) {
  return randomChoice(rng, [
    "\\sin",
    "\\lim",
    "\\sum",
    "\\int",
    "\\to",
    "\\Longrightarrow",
    "\\iff",
    "\\colon",
    "\\,",
    "\\ ",
    "\\unknown",
  ]);
}

function randomInfix(rng) {
  return randomChoice(rng, ["+", "-", "=", ",", "\\leq", "\\to", "\\implies"]);
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

function randomChoice(rng, values) {
  return values[randomInt(rng, values.length)] ?? values[0];
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
