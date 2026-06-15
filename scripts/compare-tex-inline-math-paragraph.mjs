#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { runTexOracleDocument } from "./lib/tex-oracle.mjs";

const distEntry = resolve(process.cwd(), "packages/core/dist/text/tex/index.js");
if (!existsSync(distEntry)) {
  throw new Error("Missing packages/core/dist/text/tex/index.js. Run `npm run -w @tikz-editor/core build` first.");
}

const {
  createTexDerivedInlineMathBoxProvider,
  layoutSimpleTexParagraph,
} = await import(distEntry);

const args = readArgs();
const fuzzCases = args.fuzz > 0
  ? generateFuzzCases(args.fuzz, args.seed, args.widths, args.formulaMode)
  : [];
const cases = fuzzCases.length > 0 ? fuzzCases : fixedCases(args.widths);
const results = cases.map((caseSpec) => compareCase(caseSpec, args));
const failed = results.filter((result) => !result.ok);

if (args.summaryOnly) {
  console.log(JSON.stringify({
    passed: results.length - failed.length,
    failed: failed.length,
    seed: fuzzCases.length > 0 ? args.seed : undefined,
    formulaMode: fuzzCases.length > 0 ? args.formulaMode : undefined,
    cases: results.length,
    failures: failed.map((result) => ({
      id: result.id,
      width: result.width,
      source: result.source,
      mismatches: result.mismatches,
      ours: result.ours.lines,
      tex: result.tex.lines,
    })),
  }, null, 2));
} else {
  console.log(JSON.stringify({ results }, null, 2));
}

if (failed.length > 0) {
  process.exitCode = 1;
}

function compareCase(caseSpec, options) {
  const ours = ourLines(caseSpec);
  let tex;
  try {
    tex = texLines(caseSpec, options);
  } catch (error) {
    return {
      ...caseSpec,
      ok: false,
      mismatches: [`TeX oracle failed: ${error instanceof Error ? error.message : String(error)}`],
      ours,
      tex: { lines: [] },
    };
  }

  const mismatches = [];
  if (!ours.supported) {
    mismatches.push(`our layout unsupported: ${ours.errors.join("; ")}`);
  }
  if (ours.lines.length !== tex.lines.length) {
    mismatches.push(`line count differs: ours=${ours.lines.length} tex=${tex.lines.length}`);
  }
  const lineCount = Math.min(ours.lines.length, tex.lines.length);
  for (let index = 0; index < lineCount; index += 1) {
    if (ours.lines[index] !== tex.lines[index]) {
      mismatches.push(`line ${index + 1} differs: ours=${JSON.stringify(ours.lines[index])} tex=${JSON.stringify(tex.lines[index])}`);
    }
  }
  return {
    ...caseSpec,
    ok: mismatches.length === 0,
    mismatches,
    ours,
    tex,
  };
}

function ourLines(caseSpec) {
  const result = layoutSimpleTexParagraph(caseSpec.source, {
    paragraphId: `tex:inline-math-paragraph:${caseSpec.id}`,
    width: caseSpec.width,
    alignment: "ragged-right",
    parindent: 0,
    rightskipStretch: caseSpec.width,
    spaceGlueProfile: "font",
    tikzTextWidthNode: true,
    hyphenator: { hyphenate: () => [] },
    mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
  });
  if (!result.supported || !result.report) {
    return {
      supported: false,
      errors: result.errors ?? [result.fallbackReason ?? "unknown failure"],
      lines: [],
    };
  }
  return {
    supported: true,
    errors: result.errors,
    lines: result.report.lines.map((line) => normalizeLineText(
      line.segments
        .filter((segment) => segment.role !== "list-label")
        .filter((segment) => !(segment.kind === "space" &&
          segment.width === 0 &&
          segment.sourceStartRaw === segment.sourceEndRaw))
        .map((segment) => segment.text ?? "")
        .join("")
    )),
  };
}

function texLines(caseSpec, options) {
  const cachePath = options.oracleCacheDir
    ? oracleCachePath(options.oracleCacheDir, caseSpec)
    : null;
  if (cachePath && existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, "utf8"));
  }

  const output = runTexOracleDocument({
    engine: "lualatex",
    source: latexOracleSource(caseSpec),
    filename: "inline-math-paragraph.tex",
    tempPrefix: "tikz-tex-inline-math-para-",
    maxBuffer: 10_000_000,
  });
  const lines = output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("TIL "))
    .map((line) => normalizeLineText(line.slice("TIL ".length)));
  const result = { lines };
  if (cachePath) {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(result, null, 2), "utf8");
  }
  return result;
}

function latexOracleSource(caseSpec) {
  return String.raw`\documentclass{article}
\begin{document}
\font\test=cmr10 at 10pt
\test\language=-1
\hsize=${caseSpec.width}pt
\pretolerance=100
\tolerance=200
\parindent=0pt
\rightskip=0pt plus ${caseSpec.width}pt
\setbox0=\vbox{${caseSpec.source}\par}
\directlua{
${lineCollectorLua()}
}
\end{document}
`;
}

function lineCollectorLua() {
  return String.raw`local function glyph_text(n)
  if n.char == 11 then
    return "ff"
  elseif n.char == 12 then
    return "fi"
  elseif n.char == 13 then
    return "fl"
  elseif n.char == 14 then
    return "ffi"
  elseif n.char == 15 then
    return "ffl"
  elseif n.char == 0 then
    return "-"
  end
  return utf8.char(n.char)
end

local function collect(list, in_math)
  local out = table.pack()
  for n in node.traverse(list) do
    local kind = node.type(n.id)
    if kind == "math" then
      in_math = n.subtype == 0
    elseif kind == "glyph" then
      table.insert(out, glyph_text(n))
    elseif kind == "glue" then
      if not in_math and n.subtype == 13 then
        table.insert(out, " ")
      end
    elseif (kind == "hlist" or kind == "vlist") and not (n.list == nil) then
      table.insert(out, collect(n.list, in_math))
    end
  end
  return table.concat(out)
end

for n in node.traverse(tex.box[0].list) do
  if node.type(n.id) == "hlist" then
    texio.write_nl(
      "term",
      "TIL " .. collect(n.list, false)
    )
  end
end`;
}

function normalizeLineText(text) {
  return text
    .replaceAll("\\(", "")
    .replaceAll("\\)", "")
    .replaceAll("$", "")
    .replace(/([A-Za-z])_\{?([0-9])\}?\^\{?([0-9])\}?/gu, "$1$3$2")
    .replace(/[_^{}]/gu, "")
    .replace(/\s+\(\.\/inline-math-paragraph\.aux\)\)+$/u, "")
    .replace(/\s+$/u, "");
}

function oracleCachePath(cacheDir, caseSpec) {
  const key = createHash("sha256")
    .update(JSON.stringify({
      version: 6,
      source: caseSpec.source,
      width: caseSpec.width,
      parindent: 0,
      engine: "lualatex",
    }))
    .digest("hex");
  return resolve(cacheDir, `${key}.json`);
}

function fixedCases(widths) {
  const sources = [
    String.raw`Alpha $a+b$ omega.`,
    String.raw`Alpha beta $a+b=c+d$ omega theta.`,
    String.raw`Prefix words $ab+cd=ef+gh$ suffix words.`,
    String.raw`One $x+y=m+n$ two three.`,
    String.raw`Before \(a+b=c+d\) after.`,
    String.raw`Scripted $x^2+y_1=z_3$ after words.`,
    String.raw`Two spans $a+b$ middle \(x^2=y_1\) end.`,
  ];
  return sources.flatMap((source, sourceIndex) =>
    widths.map((width) => ({
      id: `fixed-${sourceIndex + 1}-${width}`,
      source,
      width,
    }))
  );
}

function generateFuzzCases(count, seed, widths, formulaMode) {
  const random = mulberry32(seed);
  const words = [
    "Alpha",
    "affinity",
    "anchor",
    "chapter",
    "compact",
    "logic",
    "modern",
    "option",
    "render",
    "stable",
    "text",
    "width",
  ];
  const variables = ["a", "b", "c", "d", "x", "y", "m", "n"];
  return Array.from({ length: count }, (_, index) => {
    const wordCount = 5 + Math.floor(random() * 8);
    const mathSpanCount = formulaMode === "mixed" && random() < 0.35 ? 2 : 1;
    const insertions = uniqueSortedInsertions(random, wordCount, mathSpanCount);
    const parts = [];
    for (let wordIndex = 0; wordIndex < wordCount; wordIndex += 1) {
      if (insertions.includes(wordIndex)) {
        const formula = randomFormula(random, variables, formulaMode);
        parts.push(random() < 0.2 ? String.raw`\(` + formula + String.raw`\)` : `$${formula}$`);
      }
      parts.push(choice(random, words));
    }
    return {
      id: `fuzz-${seed}-${index + 1}`,
      source: `${parts.join(" ")}.`,
      width: choice(random, widths),
    };
  });
}

function uniqueSortedInsertions(random, wordCount, count) {
  const indices = new Set();
  while (indices.size < count) {
    indices.add(1 + Math.floor(random() * Math.max(1, wordCount - 2)));
  }
  return [...indices].sort((a, b) => a - b);
}

function randomFormula(random, variables, formulaMode) {
  const lhs = `${randomTerm(random, variables, formulaMode)}+${randomTerm(random, variables, formulaMode)}`;
  const rhs = `${randomTerm(random, variables, formulaMode)}+${randomTerm(random, variables, formulaMode)}`;
  return random() < 0.7 ? `${lhs}=${rhs}` : lhs;
}

function randomTerm(random, variables, formulaMode) {
  const variable = choice(random, variables);
  if (formulaMode === "basic") {
    return variable;
  }
  const suffixRoll = random();
  if (suffixRoll < 0.3) {
    return `${variable}_${1 + Math.floor(random() * 3)}`;
  }
  if (suffixRoll < 0.6) {
    return `${variable}^${1 + Math.floor(random() * 3)}`;
  }
  if (suffixRoll < 0.75) {
    return `${variable}_${1 + Math.floor(random() * 3)}^${1 + Math.floor(random() * 3)}`;
  }
  return variable;
}

function choice(random, values) {
  return values[Math.floor(random() * values.length)];
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function readArgs() {
  const parsed = {
    fuzz: 0,
    seed: 20260615,
    widths: [80, 100, 120, 160],
    formulaMode: "basic",
    oracleCacheDir: null,
    summaryOnly: false,
  };
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === "--summary-only") {
      parsed.summaryOnly = true;
    } else if (arg === "--fuzz") {
      parsed.fuzz = Number(process.argv[++index] ?? parsed.fuzz);
    } else if (arg === "--seed") {
      parsed.seed = Number(process.argv[++index] ?? parsed.seed);
    } else if (arg === "--widths") {
      parsed.widths = String(process.argv[++index] ?? "")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0);
    } else if (arg === "--formula-mode") {
      parsed.formulaMode = readFormulaMode(process.argv[++index] ?? "");
    } else if (arg === "--oracle-cache-dir") {
      parsed.oracleCacheDir = process.argv[++index] ?? null;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (parsed.widths.length === 0) {
    throw new Error("--widths must contain at least one positive number.");
  }
  return parsed;
}

function readFormulaMode(value) {
  if (value === "basic" || value === "scripts" || value === "mixed") {
    return value;
  }
  throw new Error("--formula-mode must be one of: basic, scripts, mixed.");
}
