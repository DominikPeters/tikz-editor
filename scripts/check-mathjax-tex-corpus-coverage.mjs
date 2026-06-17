#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { mkdirSync } from "node:fs";

const DEFAULT_INPUT = "artifacts/mathjax-tex-corpus/corpus.jsonl";
const DEFAULT_OUT = "artifacts/mathjax-tex-corpus/coverage-summary.json";
const DEFAULT_SLICES = "scripts/mathjax-tex-corpus-slices.json";
const DISPLAY_ALIGNMENT_ENVIRONMENTS = [
  {
    delimiter: "align-star",
    begin: String.raw`\begin{align*}`,
    end: String.raw`\end{align*}`,
  },
  {
    delimiter: "gather-star",
    begin: String.raw`\begin{gather*}`,
    end: String.raw`\end{gather*}`,
  },
  {
    delimiter: "multline-star",
    begin: String.raw`\begin{multline*}`,
    end: String.raw`\end{multline*}`,
  },
];
const distEntry = resolve(process.cwd(), "packages/core/dist/text/tex/math/index.js");

if (!existsSync(distEntry)) {
  throw new Error("Missing packages/core/dist/text/tex/math/index.js. Run `npm run -w @tikz-editor/core build` first.");
}

const {
  createTexDerivedInlineMathBoxProvider,
  layoutTexMathList,
  parseTexMathAlignedBody,
  parseTexMath,
} = await import(distEntry);

const args = readArgs();
const sliceConfig = args.slice ? readSliceConfig(args.sliceFile) : null;
const slice = args.slice ? sliceConfig.slices?.[args.slice] : null;
if (args.slice && !slice) {
  throw new Error(`Unknown corpus slice: ${args.slice}. Known slices: ${Object.keys(sliceConfig.slices ?? {}).sort().join(", ")}`);
}
applySlice(args, slice);
const entries = readCorpus(args.input)
  .filter((entry) => filterEntry(entry, args))
  .slice(0, args.limit > 0 ? args.limit : undefined);
const provider = createTexDerivedInlineMathBoxProvider();
const results = entries.map((entry) => checkEntry(entry, provider));
const summary = buildSummary(results);

mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

if (args.jsonlOut) {
  mkdirSync(dirname(args.jsonlOut), { recursive: true });
  writeFileSync(args.jsonlOut, `${results.map((result) => JSON.stringify(result)).join("\n")}\n`, "utf8");
}

console.log(JSON.stringify(summary, null, 2));

function readArgs() {
  const parsed = {
    input: DEFAULT_INPUT,
    out: DEFAULT_OUT,
    jsonlOut: null,
    slice: null,
    sliceFile: DEFAULT_SLICES,
    categories: null,
    suggestedUses: null,
    files: null,
    limit: 0,
    examples: 5,
  };
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === "--input") {
      parsed.input = process.argv[++index] ?? parsed.input;
    } else if (arg === "--out") {
      parsed.out = process.argv[++index] ?? parsed.out;
    } else if (arg === "--jsonl-out") {
      parsed.jsonlOut = process.argv[++index] ?? null;
    } else if (arg === "--slice") {
      parsed.slice = process.argv[++index] ?? null;
    } else if (arg === "--slice-file") {
      parsed.sliceFile = process.argv[++index] ?? parsed.sliceFile;
    } else if (arg === "--categories") {
      parsed.categories = readList(process.argv[++index] ?? "");
    } else if (arg === "--suggested-use") {
      parsed.suggestedUses = readList(process.argv[++index] ?? "");
    } else if (arg === "--files") {
      parsed.files = readList(process.argv[++index] ?? "");
    } else if (arg === "--limit") {
      parsed.limit = Number(process.argv[++index] ?? parsed.limit);
    } else if (arg === "--examples") {
      parsed.examples = Number(process.argv[++index] ?? parsed.examples);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  parsed.input = resolve(process.cwd(), parsed.input);
  parsed.out = resolve(process.cwd(), parsed.out);
  parsed.jsonlOut = parsed.jsonlOut ? resolve(process.cwd(), parsed.jsonlOut) : null;
  parsed.sliceFile = resolve(process.cwd(), parsed.sliceFile);
  return parsed;
}

function readSliceConfig(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing corpus slice file: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function applySlice(options, slice) {
  if (!slice) {
    return;
  }
  options.files = mergeLists(options.files, slice.files);
  options.categories = mergeLists(options.categories, slice.categories);
  options.suggestedUses = mergeLists(options.suggestedUses, slice.suggestedUses);
}

function mergeLists(cliValues, sliceValues) {
  if (!sliceValues) {
    return cliValues;
  }
  if (!cliValues) {
    return sliceValues;
  }
  return cliValues.filter((value) => sliceValues.includes(value));
}

function readList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readCorpus(input) {
  if (!existsSync(input)) {
    throw new Error(`Missing corpus file: ${input}. Run npm run extract:mathjax-tex-corpus first.`);
  }
  const text = readFileSync(input, "utf8").trim();
  if (!text) {
    return [];
  }
  return text.split(/\n/u).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSONL at ${input}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function filterEntry(entry, options) {
  if (options.categories && !entry.categories?.some((category) => options.categories.includes(category))) {
    return false;
  }
  if (options.suggestedUses && !options.suggestedUses.includes(entry.suggestedUse)) {
    return false;
  }
  if (options.files && !options.files.includes(entry.sourceFile) && !options.files.includes(entry.sourceFile?.replace(/\.test\.ts$/u, ""))) {
    return false;
  }
  return true;
}

function checkEntry(entry, provider) {
  if (entry.display === "document") {
    return resultFor(entry, {
      topStatus: "not-applicable",
      detailStatus: "document-scope",
      providerKind: "none",
      diagnostics: [],
      layoutErrors: [],
    });
  }

  const alignment = displayAlignmentContent(entry.source);
  const providerKind = alignment ? "display-alignment" : entry.display === true ? "display-box" : "inline-box";
  const content = alignment?.content ?? entry.source;
  const contentStart = alignment?.contentStart ?? 0;
  const delimiter = alignment?.delimiter ?? null;
  let parsed;
  try {
    parsed = parseProviderContent(providerKind, content, contentStart, delimiter);
  } catch (error) {
    return resultFor(entry, {
      topStatus: "parser-error",
      detailStatus: "parser-crash",
      providerKind,
      diagnostics: [],
      layoutErrors: [],
      error: errorMessage(error),
    });
  }

  const diagnostics = parsed.diagnostics ?? [];
  const errorDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (entry.mode === "error") {
    return resultFor(entry, {
      topStatus: errorDiagnostics.length > 0 ? "explicit-unsupported" : "parser-error",
      detailStatus: errorDiagnostics.length > 0 ? "expected-error-diagnostic" : "diagnostic-missing",
      providerKind,
      diagnostics,
      layoutErrors: [],
    });
  }
  if (errorDiagnostics.length > 0) {
    return resultFor(entry, {
      topStatus: "explicit-unsupported",
      detailStatus: "parser-diagnostic",
      providerKind,
      diagnostics,
      layoutErrors: [],
    });
  }

  let layout;
  try {
    layout = layoutTexMathList(parsed.list, { style: entry.display === false ? "text" : "display" });
  } catch (error) {
    return resultFor(entry, {
      topStatus: "parser-error",
      detailStatus: "layout-crash",
      providerKind,
      diagnostics,
      layoutErrors: [],
      error: errorMessage(error),
    });
  }
  if (!layout.supported) {
    return resultFor(entry, {
      topStatus: "explicit-unsupported",
      detailStatus: "layout-unsupported",
      providerKind,
      diagnostics,
      layoutErrors: layout.errors ?? [],
    });
  }

  let box = null;
  try {
    box = providerBox(provider, providerKind, entry.source, content, contentStart, delimiter);
  } catch (error) {
    return resultFor(entry, {
      topStatus: "parser-error",
      detailStatus: "provider-crash",
      providerKind,
      diagnostics,
      layoutErrors: [],
      error: errorMessage(error),
    });
  }

  return resultFor(entry, {
    topStatus: box ? "supported" : "explicit-unsupported",
    detailStatus: box ? "provider-supported" : "provider-null",
    providerKind,
    diagnostics,
    layoutErrors: [],
  });
}

function parseProviderContent(providerKind, content, contentStart, delimiter) {
  if (providerKind === "display-alignment") {
    return parseTexMathAlignedBody(content, {
      sourceOffset: contentStart,
      columnSeparation: displayAlignmentColumnSeparation(delimiter),
      suppressTerminalEllipsisGlue: true,
    });
  }
  return parseTexMath(content, {
    sourceOffset: contentStart,
    suppressTerminalEllipsisGlue: providerKind === "display-box",
  });
}

function providerBox(provider, providerKind, source, content, contentStart, delimiter) {
  if (providerKind === "display-alignment") {
    return provider.getDisplayMathAlignment?.({
      source,
      content,
      delimiter: delimiter ?? "align-star",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart,
      contentEnd: contentStart + content.length,
      targetWidth: 160,
    }) ?? null;
  }
  if (providerKind === "display-box") {
    return provider.getDisplayMathBox?.({
      source,
      content,
      delimiter: "bracket",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart,
      contentEnd: contentStart + content.length,
      targetWidth: 160,
    }) ?? null;
  }
  return provider.getInlineMathBox({
    source,
    content,
    delimiter: "dollar",
    sourceStart: 0,
    sourceEnd: source.length,
    contentStart,
    contentEnd: contentStart + content.length,
  });
}

function displayAlignmentContent(source) {
  for (const environment of DISPLAY_ALIGNMENT_ENVIRONMENTS) {
    const start = source.indexOf(environment.begin);
    const finish = source.lastIndexOf(environment.end);
    if (start < 0 || finish < start) {
      continue;
    }
    const contentStart = start + environment.begin.length;
    return {
      content: source.slice(contentStart, finish),
      contentStart,
      delimiter: environment.delimiter,
    };
  }
  return null;
}

function displayAlignmentColumnSeparation(delimiter) {
  if (delimiter === "gather-star") {
    return "gather";
  }
  if (delimiter === "multline-star") {
    return "multline";
  }
  return "align";
}

function resultFor(entry, status) {
  return {
    id: entry.id,
    sourceFile: entry.sourceFile,
    line: entry.line,
    describeName: entry.describeName,
    testName: entry.testName,
    source: entry.source,
    categories: entry.categories,
    suggestedUse: entry.suggestedUse,
    expectedMode: entry.mode,
    ...status,
  };
}

function buildSummary(results) {
  const summary = {
    input: relative(process.cwd(), args.input),
    slice: args.slice ?? undefined,
    entries: results.length,
    byTopStatus: objectFromMap(countBy(results, (result) => result.topStatus)),
    byDetailStatus: objectFromMap(countBy(results, (result) => result.detailStatus)),
    byProviderKind: objectFromMap(countBy(results, (result) => result.providerKind)),
    bySuggestedUse: objectFromMap(countBy(results, (result) => result.suggestedUse)),
    byCategory: objectFromMap(categoryCounts(results)),
    byCategoryTopStatus: objectFromMap(categoryStatusCounts(results)),
    byFile: objectFromMap(countBy(results, (result) => result.sourceFile)),
    examples: {},
    out: relative(process.cwd(), args.out),
    jsonlOut: args.jsonlOut ? relative(process.cwd(), args.jsonlOut) : undefined,
  };
  const statuses = [...new Set(results.map((result) => result.detailStatus))].sort();
  for (const status of statuses) {
    summary.examples[status] = results
      .filter((result) => result.detailStatus === status)
      .slice(0, Math.max(0, args.examples))
      .map((result) => ({
        sourceFile: result.sourceFile,
        line: result.line,
        testName: result.testName,
        categories: result.categories,
        source: result.source,
        diagnostics: summarizeDiagnostics(result.diagnostics),
        layoutErrors: result.layoutErrors,
        error: result.error,
      }));
  }
  return summary;
}

function categoryCounts(results) {
  const counts = new Map();
  for (const result of results) {
    for (const category of result.categories ?? []) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }
  return sortMapByValueThenKey(counts);
}

function categoryStatusCounts(results) {
  const counts = new Map();
  for (const result of results) {
    for (const category of result.categories ?? []) {
      const existing = counts.get(category) ?? {};
      existing[result.topStatus] = (existing[result.topStatus] ?? 0) + 1;
      counts.set(category, existing);
    }
  }
  return new Map([...counts.entries()].sort((a, b) => {
    const totalA = Object.values(a[1]).reduce((sum, value) => sum + value, 0);
    const totalB = Object.values(b[1]).reduce((sum, value) => sum + value, 0);
    return totalB - totalA || a[0].localeCompare(b[0]);
  }));
}

function summarizeDiagnostics(diagnostics) {
  return (diagnostics ?? []).map((diagnostic) => ({
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
  }));
}

function countBy(values, keyForValue) {
  const counts = new Map();
  for (const value of values) {
    const key = keyForValue(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return sortMapByValueThenKey(counts);
}

function sortMapByValueThenKey(map) {
  return new Map([...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function objectFromMap(map) {
  return Object.fromEntries(map.entries());
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
