#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const DEFAULT_SOURCE_DIR = "examples/mathjax-src/testsuite/tests/input/tex";
const DEFAULT_OUT = "artifacts/mathjax-tex-corpus/corpus.jsonl";
const DEFAULT_SUMMARY = "artifacts/mathjax-tex-corpus/summary.json";

const args = readArgs();
const sourceDir = resolve(process.cwd(), args.sourceDir);
if (!existsSync(sourceDir)) {
  throw new Error(`Missing MathJax TeX testsuite directory: ${sourceDir}`);
}

const files = testFiles(sourceDir, args.files);
const entries = files.flatMap((file) => extractFile(file, sourceDir));
entries.sort((a, b) =>
  a.file.localeCompare(b.file) ||
  a.line - b.line ||
  a.testName.localeCompare(b.testName) ||
  a.source.localeCompare(b.source)
);

mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

const summary = buildSummary(entries, files, sourceDir);
mkdirSync(dirname(args.summary), { recursive: true });
writeFileSync(args.summary, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

console.log(JSON.stringify(summary, null, 2));

function readArgs() {
  const parsed = {
    sourceDir: DEFAULT_SOURCE_DIR,
    out: DEFAULT_OUT,
    summary: DEFAULT_SUMMARY,
    files: null,
  };
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === "--source-dir") {
      parsed.sourceDir = process.argv[++index] ?? parsed.sourceDir;
    } else if (arg === "--out") {
      parsed.out = process.argv[++index] ?? parsed.out;
    } else if (arg === "--summary") {
      parsed.summary = process.argv[++index] ?? parsed.summary;
    } else if (arg === "--files") {
      parsed.files = String(process.argv[++index] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  parsed.out = resolve(process.cwd(), parsed.out);
  parsed.summary = resolve(process.cwd(), parsed.summary);
  return parsed;
}

function testFiles(sourceDir, selectedFiles) {
  const selected = selectedFiles === null
    ? null
    : new Set(selectedFiles.map((file) => file.endsWith(".test.ts") ? file : `${file}.test.ts`));
  return readdirSync(sourceDir)
    .filter((file) => file.endsWith(".test.ts"))
    .filter((file) => selected === null || selected.has(file))
    .sort()
    .map((file) => join(sourceDir, file));
}

function extractFile(file, sourceDir) {
  const text = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const relativeFile = relative(process.cwd(), file);
  const packages = extractSetupPackages(text);
  const entries = [];

  const visit = (node, context) => {
    const blockContext = describeOrTestContext(node, context);
    if (blockContext) {
      visitBody(blockContext.body, blockContext.context);
      return;
    }

    const call = extractedMathCall(node);
    if (call) {
      const position = ast.getLineAndCharacterOfPosition(node.getStart(ast));
      const categories = classifyEntry({
        file: relative(sourceDir, file),
        describeName: context.describeName,
        testName: context.testName,
        source: call.source,
        mode: call.mode,
      });
      entries.push({
        id: stableId(relative(sourceDir, file), position.line + 1, context, call.source),
        file: relativeFile,
        sourceFile: relative(sourceDir, file),
        line: position.line + 1,
        column: position.character + 1,
        describeName: context.describeName,
        testName: context.testName,
        call: call.name,
        mode: call.mode,
        display: call.display,
        packages,
        categories,
        suggestedUse: suggestedUse(call.mode, categories),
        source: call.source,
      });
    }

    ts.forEachChild(node, (child) => visit(child, context));
  };

  visit(ast, { describeName: "", testName: "" });
  return entries;
  
  function visitBody(body, context) {
    if (!body) {
      return;
    }
    ts.forEachChild(body, (child) => visit(child, context));
  }
}

function describeOrTestContext(node, context) {
  if (!ts.isCallExpression(node)) {
    return null;
  }
  const name = callName(node.expression);
  if (name !== "describe" && name !== "it" && name !== "test") {
    return null;
  }
  const label = stringValue(node.arguments[0]);
  const body = node.arguments[1];
  if (!label || !body || (!ts.isArrowFunction(body) && !ts.isFunctionExpression(body))) {
    return null;
  }
  return {
    body,
    context: name === "describe"
      ? { ...context, describeName: context.describeName ? `${context.describeName} / ${label}` : label }
      : { ...context, testName: label },
  };
}

function extractedMathCall(node) {
  if (!ts.isCallExpression(node)) {
    return null;
  }
  const name = callName(node.expression);
  if (![
    "tex2mml",
    "typeset2mml",
    "render2mml",
    "page2mml",
    "expectTexError",
    "expectTypesetError",
  ].includes(name)) {
    return null;
  }
  const source = evalStringExpression(node.arguments[0]);
  if (source === null) {
    return null;
  }
  return {
    name,
    source,
    mode: name === "expectTexError" || name === "expectTypesetError" ? "error" : "render",
    display: displayMode(name, node.arguments[1]),
  };
}

function callName(expression) {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return "";
}

function displayMode(name, arg) {
  if (name === "page2mml" || name === "render2mml") {
    return "document";
  }
  if (arg?.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  if (arg?.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  return true;
}

function stringValue(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function evalStringExpression(node) {
  if (!node) {
    return null;
  }
  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (
    ts.isTaggedTemplateExpression(node) &&
    ts.isPropertyAccessExpression(node.tag) &&
    ts.isIdentifier(node.tag.expression) &&
    node.tag.expression.text === "String" &&
    node.tag.name.text === "raw" &&
    ts.isNoSubstitutionTemplateLiteral(node.template)
  ) {
    return node.template.rawText ?? node.template.text;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = evalStringExpression(node.left);
    const right = evalStringExpression(node.right);
    return left !== null && right !== null ? `${left}${right}` : null;
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "join" &&
    ts.isArrayLiteralExpression(node.expression.expression)
  ) {
    const separator = node.arguments.length === 0 ? "," : evalStringExpression(node.arguments[0]);
    if (separator === null) {
      return null;
    }
    const parts = node.expression.expression.elements.map(evalStringExpression);
    return parts.every((part) => part !== null) ? parts.join(separator) : null;
  }
  return null;
}

function extractSetupPackages(text) {
  const packages = new Set();
  for (const match of text.matchAll(/setupTex(?:Render|Typeset|Page|Components)?\s*\(\s*\[([\s\S]*?)\]/gu)) {
    for (const packageMatch of match[1].matchAll(/['"]([^'"]+)['"]/gu)) {
      packages.add(packageMatch[1]);
    }
  }
  return [...packages].sort();
}

function classifyEntry(entry) {
  const haystack = `${entry.file} ${entry.describeName} ${entry.testName} ${entry.source}`.toLowerCase();
  const categories = new Set();
  if (entry.mode === "error" || /error|undefined|missing|invalid|not allowed|misplaced/u.test(haystack)) {
    categories.add("diagnostics");
  }
  if (/script|sup|sub|prime|limits|sideset|prescript/u.test(haystack)) {
    categories.add("scripts");
  }
  if (/frac|binom|over|choose|atop|root|sqrt|radical/u.test(haystack)) {
    categories.add("radicals-fractions");
  }
  if (/left|right|middle|delimiter|fenced|brace|brack|paren|angle|floor|ceil|vert|matrix|cases/u.test(haystack)) {
    categories.add("delimiters");
  }
  if (/array|matrix|cases|align|gather|multline|split|eqnarray|column|row/u.test(haystack)) {
    categories.add("arrays-matrices");
  }
  if (/align|gather|multline|equation|tag|label|refeq|eqnarray/u.test(haystack)) {
    categories.add("display-alignment");
  }
  if (/space|quad|qquad|thinspace|hskip|hspace|mskip|mspace|break|linebreak|newline|allowbreak|goodbreak|badbreak|nobreak/u.test(haystack)) {
    categories.add("spacing-breaks");
  }
  if (/accent|acute|grave|ddot|dot|tilde|bar|breve|check|hat|vec|widehat|widetilde|overline|underline/u.test(haystack)) {
    categories.add("accents");
  }
  if (/mathop|mathrel|mathord|mathopen|mathclose|mathbin|mathpunct|mathinner|operator|function|sin|cos|lim|mod|not|rel|arrow|equiv|less|gtr|approx/u.test(haystack)) {
    categories.add("operators-relations");
  }
  if (/greek|alpha|beta|gamma|delta|omega|symbol|mathchar|unicode|textcomp|upgreek|gensymb/u.test(haystack)) {
    categories.add("symbol-tables");
  }
  if (/font|mathbf|mathrm|mathbb|mathcal|mathsf|mathtt|boldsymbol|bbm|bboldx|dsfont/u.test(haystack)) {
    categories.add("font-alphabets");
  }
  if (/\\text|\\mbox|\\hbox|textmacros|textcomp|text\{/u.test(haystack)) {
    categories.add("text-in-math");
  }
  if (/newcommand|def|let|macro|require|begingroup|configmacros|user defined/u.test(haystack)) {
    categories.add("macro-expansion");
  }
  if (/color|bbox|html|texhtml|\\texttip|\\mathtip|\\toggle|\\enclose|\\cancel|cancel\.test|action\.test/u.test(haystack)) {
    categories.add("annotation-color-html");
  }
  if (/physics|mhchem|braket|cancel|empheq|bussproofs|amscd|extpfeil|mathtools|cases|colortbl|units|verb|bboldx|bbm|dsfont|upgreek|textcomp|gensymb/u.test(haystack)) {
    categories.add("package-extensions");
  }
  if (categories.size === 0) {
    categories.add("core-syntax");
  }
  return [...categories].sort();
}

function suggestedUse(mode, categories) {
  if (mode === "error" || categories.includes("diagnostics")) {
    return "parser-diagnostics";
  }
  if (categories.includes("package-extensions") || categories.includes("macro-expansion")) {
    return "coverage-inventory";
  }
  if (categories.includes("annotation-color-html")) {
    return "explicit-unsupported";
  }
  return "lualatex-oracle-fixture";
}

function stableId(file, line, context, source) {
  const slug = `${file}:${line}:${context.describeName}:${context.testName}:${source}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 120);
  return slug || `case-${line}`;
}

function buildSummary(entries, files, sourceDir) {
  const byFile = countBy(entries, (entry) => entry.sourceFile);
  const byCategory = new Map();
  for (const entry of entries) {
    for (const category of entry.categories) {
      byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
    }
  }
  return {
    sourceDir: relative(process.cwd(), sourceDir),
    filesScanned: files.length,
    entries: entries.length,
    renderEntries: entries.filter((entry) => entry.mode === "render").length,
    errorEntries: entries.filter((entry) => entry.mode === "error").length,
    bySuggestedUse: objectFromMap(countBy(entries, (entry) => entry.suggestedUse)),
    byCategory: objectFromMap(sortMapByValueThenKey(byCategory)),
    byFile: objectFromMap(sortMapByValueThenKey(byFile)),
    out: relative(process.cwd(), args.out),
    summary: relative(process.cwd(), args.summary),
  };
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
  return new Map([...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function objectFromMap(map) {
  return Object.fromEntries(map.entries());
}
