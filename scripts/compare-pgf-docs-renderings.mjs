#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { compareTikzRenderers, RendererComparisonError } from "./compare-tikz-renderers.mjs";
import { ensureDistBuildFresh } from "./ensure-dist-build.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultExamplesRoot = join(repoRoot, "examples");
const corpusModes = new Set(["pgf-docs", "kottwitz-book", "kolda-book"]);
const bookModes = new Set(["kottwitz-book", "kolda-book"]);
const defaultDocsRoot = join(repoRoot, "pgf-docs");
const defaultSourceFile = "pgfmanual-en-tikz-paths.tex";
const defaultReferenceMode = "pdf-png";
const validReferenceModes = new Set(["pdf-png", "dvisvgm-svg", "dvisvgm-svg-png"]);

if (isMain(import.meta.url)) {
  await runCli();
}

async function runCli() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printUsage();
      process.exit(0);
    }

    const distEntry = ensureDistBuildFresh(repoRoot);

    const corpusEntry = join(
      dirname(distEntry),
      "corpus",
      "index.js"
    );
    const corpusModule = await import(pathToFileURL(corpusEntry).href);
    if (typeof corpusModule.extractTikzSnippetsFromSource !== "function") {
      throw new Error(
        "extractTikzSnippetsFromSource export not found in packages/core/dist/corpus/index.js."
      );
    }

    const source = loadSnippetsForMode(args, corpusModule);
    let snippets = source.snippets;
    if (args.kind !== "all") {
      snippets = snippets.filter((snippet) => snippet.kind === args.kind);
    }
    if (!args.includeIncomplete) {
      snippets = snippets.filter((snippet) => !snippet.incomplete);
    }
    let selected = snippets.map((snippet, index) => ({ snippet, ordinal: index + 1 }));
    if (args.only && args.only.size > 0) {
      selected = selected.filter((entry) => args.only.has(entry.ordinal));
    }
    if (args.max != null) {
      selected = selected.slice(0, args.max);
    }

    if (selected.length === 0) {
      throw new Error("No snippets matched the selected filters.");
    }

    const outRoot = resolve(args.outDir ?? source.defaultOutDir);
    const batchName = sanitizeName(args.name ?? source.defaultBatchName);
    const batchDir = join(outRoot, `${batchName}-${timestampSlug()}`);
    mkdirSync(batchDir, { recursive: true });

    const entries = [];
    let okCount = 0;
    let failCount = 0;
    const rasterizeOurs = true;

    for (let i = 0; i < selected.length; i += 1) {
      const entry = selected[i];
      const snippet = entry.snippet;
      const snippetName = createSnippetRunName(entry.ordinal - 1, snippet);
      process.stdout.write(`[${i + 1}/${selected.length}] ${snippetName}\n`);

      try {
        const result = await compareTikzRenderers({
          code: snippet.source,
          outDir: batchDir,
          name: snippetName,
          includeTimestamp: false,
          rasterizeOurs,
          referenceMode: args.referenceMode,
          latexPreamble: snippet.latexPreamble ?? null,
          latexPrepend: snippet.latexPrepend ?? null
        });
        okCount += 1;
        entries.push(
          buildEntry({
            index: entry.ordinal,
            snippet,
            batchDir,
            status: "ok",
            runDir: result.runDir,
            reportPath: result.reportPath,
            report: result.report,
            errorMessage: null
          })
        );
      } catch (error) {
        failCount += 1;
        if (!(error instanceof RendererComparisonError)) {
          throw error;
        }

        entries.push(
          buildEntry({
            index: entry.ordinal,
            snippet,
            batchDir,
            status: "error",
            runDir: error.runDir ?? null,
            reportPath: error.reportPath ?? null,
            report: error.report ?? null,
            errorMessage: error.message
          })
        );

        if (!args.continueOnError) {
          throw error;
        }
      }
    }

    const manifest = {
      generatedAt: new Date().toISOString(),
      mode: source.mode,
      docsRoot: source.mode === "pgf-docs" ? source.manifestSource.rootDir : null,
      sourceFile: source.manifestSource.sourceFile ?? null,
      sourceRelativePath: source.manifestSource.sourceRelativePath ?? null,
      source: source.manifestSource,
      filters: {
        kind: args.kind,
        includeIncomplete: args.includeIncomplete,
        only: args.only ? [...args.only].sort((a, b) => a - b) : null,
        max: args.max,
        referenceMode: args.referenceMode,
        rasterizeOurs
      },
      totals: {
        snippets: selected.length,
        succeeded: okCount,
        failed: failCount
      },
      entries
    };

    const manifestPath = join(batchDir, "comparison-manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const htmlPath = join(batchDir, "index.html");
    writeFileSync(htmlPath, renderHtmlPage(manifest), "utf8");

    console.log(
      JSON.stringify(
        {
          batchDir,
          htmlPath,
          manifestPath,
          totals: manifest.totals
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function parseArgs(argv) {
  const parsed = {
    mode: "pgf-docs",
    docsRoot: null,
    examplesRoot: null,
    sourceFile: null,
    outDir: null,
    name: null,
    only: null,
    max: null,
    kind: "all",
    includeIncomplete: false,
    continueOnError: true,
    referenceMode: defaultReferenceMode,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--docs-root") {
      parsed.docsRoot = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--examples-root") {
      parsed.examplesRoot = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--mode") {
      const mode = argv[i + 1] ?? "";
      if (!corpusModes.has(mode)) {
        throw new Error(`--mode must be one of: ${[...corpusModes].join(", ")}.`);
      }
      parsed.mode = mode;
      i += 1;
      continue;
    }
    if (arg === "--source-file") {
      parsed.sourceFile = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--out-dir") {
      parsed.outDir = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--name") {
      parsed.name = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--only" || arg === "--figures") {
      parsed.only = parseOnlySelection(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (arg === "--max") {
      const parsedMax = Number.parseInt(argv[i + 1] ?? "", 10);
      if (!Number.isFinite(parsedMax) || parsedMax <= 0) {
        throw new Error("--max must be a positive integer.");
      }
      parsed.max = parsedMax;
      i += 1;
      continue;
    }
    if (arg === "--kind") {
      const kind = argv[i + 1] ?? "";
      if (kind !== "all" && kind !== "tikzpicture" && kind !== "tikz-inline") {
        throw new Error("--kind must be one of: all, tikzpicture, tikz-inline.");
      }
      parsed.kind = kind;
      i += 1;
      continue;
    }
    if (arg === "--include-incomplete") {
      parsed.includeIncomplete = true;
      continue;
    }
    if (arg === "--stop-on-error") {
      parsed.continueOnError = false;
      continue;
    }
    if (arg === "--reference-mode") {
      parsed.referenceMode = parseReferenceMode(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function printUsage() {
  console.log(`Usage:
  node scripts/compare-pgf-docs-renderings.mjs
  node scripts/compare-pgf-docs-renderings.mjs --source-file pgfmanual-en-tikz-paths.tex --max 25
  node scripts/compare-pgf-docs-renderings.mjs --source-file pgfmanual-en-tikz-actions.tex --only 6,7,8,10,13,14
  node scripts/compare-pgf-docs-renderings.mjs --source-file pgfmanual-en-tikz-paths.tex --kind tikzpicture
  node scripts/compare-pgf-docs-renderings.mjs --mode kottwitz-book
  node scripts/compare-pgf-docs-renderings.mjs --mode kolda-book --max 25
  node scripts/compare-pgf-docs-renderings.mjs --mode kolda-book --figures 9,11,14,17,28,31
  node scripts/compare-pgf-docs-renderings.mjs --reference-mode dvisvgm-svg
  node scripts/compare-pgf-docs-renderings.mjs --reference-mode dvisvgm-svg-png

Defaults:
  --mode pgf-docs
  --docs-root ${defaultDocsRoot}
  --examples-root ${defaultExamplesRoot}
  --source-file ${defaultSourceFile} (pgf-docs mode only)
  --out-dir mode-specific default under ${join(repoRoot, "artifacts")}
  --reference-mode ${defaultReferenceMode}
  --only/--figures takes comma-separated # indices from the gallery cards (supports ranges like 10-14)
  source-file resolution:
    pgf-docs mode: resolved under --docs-root
    book modes: resolved under --examples-root/<mode>
    book modes without --source-file: scan all .tex files recursively
  skips incomplete snippets unless --include-incomplete is set
  continues on per-snippet errors unless --stop-on-error is set

Outputs:
  comparison-manifest.json
  index.html
  one subdirectory per snippet containing compare-report.json and rendering artifacts
`);
}

function resolveSourceFile(docsRoot, sourceFile) {
  if (!sourceFile) {
    throw new Error("--source-file requires a value.");
  }

  const candidate = isAbsolute(sourceFile) ? sourceFile : join(docsRoot, sourceFile);
  const resolved = resolve(candidate);
  if (!existsSync(resolved)) {
    throw new Error(`Source file not found: ${resolved}`);
  }
  return resolved;
}

function loadSnippetsForMode(args, distModule) {
  if (args.mode === "pgf-docs") {
    return loadPgfDocsSnippets(args, distModule);
  }
  if (bookModes.has(args.mode)) {
    return loadBookSnippets(args, distModule, args.mode);
  }
  throw new Error(`Unsupported --mode value: ${args.mode}`);
}

function loadPgfDocsSnippets(args, distModule) {
  const docsRoot = resolve(args.docsRoot ?? defaultDocsRoot);
  const sourceFile = resolveSourceFile(docsRoot, args.sourceFile ?? defaultSourceFile);
  const sourceRelativePath = relative(docsRoot, sourceFile);
  const sourceCode = readFileSync(sourceFile, "utf8");

  let snippets = distModule.extractTikzSnippetsFromSource(sourceCode, sourceRelativePath);
  snippets = recoverInlineTikzCodeExamples(snippets, sourceCode);
  snippets = attachCodeExampleLatexContext(snippets, sourceCode);

  return {
    mode: "pgf-docs",
    snippets,
    defaultOutDir: join(repoRoot, "artifacts", "renderer-compare-docs"),
    defaultBatchName: basename(sourceFile, extname(sourceFile)),
    manifestSource: {
      rootDir: docsRoot,
      sourceFile,
      sourceRelativePath,
      label: sourceRelativePath
    }
  };
}

function loadBookSnippets(args, distModule, mode) {
  const examplesRoot = resolve(args.examplesRoot ?? defaultExamplesRoot);
  const bookRoot = resolveBookRoot(examplesRoot, mode);
  const sourceFile = args.sourceFile ? resolveSourceFile(bookRoot, args.sourceFile) : null;
  const texFiles = sourceFile ? [sourceFile] : collectTexFiles(bookRoot);

  const snippets = [];
  for (const texFile of texFiles) {
    const sourceCode = readFileSync(texFile, "utf8");
    const sourceRelativePath = toPosix(relative(bookRoot, texFile));
    const snippetPath = `${mode}/${sourceRelativePath}`;
    let fileSnippets = distModule.extractTikzSnippetsFromSource(sourceCode, snippetPath);
    fileSnippets = attachLatexDocumentContext(fileSnippets, sourceCode, { keepOnlyBodySnippets: true });
    snippets.push(...fileSnippets);
  }

  snippets.sort((a, b) => {
    if (a.filePath !== b.filePath) {
      return a.filePath.localeCompare(b.filePath);
    }
    return a.span.from - b.span.from;
  });

  const sourceRelativePath = sourceFile ? toPosix(relative(bookRoot, sourceFile)) : null;

  return {
    mode,
    snippets,
    defaultOutDir: join(repoRoot, "artifacts", `renderer-compare-${mode}`),
    defaultBatchName: sourceFile ? basename(sourceFile, extname(sourceFile)) : mode,
    manifestSource: {
      rootDir: bookRoot,
      sourceFile,
      sourceRelativePath,
      label: sourceFile ? `${mode}/${sourceRelativePath}` : `${mode}/**/*.tex`
    }
  };
}

function resolveBookRoot(examplesRoot, mode) {
  const root = resolve(join(examplesRoot, mode));
  if (!existsSync(root)) {
    throw new Error(`Book root not found for mode "${mode}": ${root}`);
  }
  return root;
}

function collectTexFiles(rootDir) {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".tex")) {
        files.push(fullPath);
      }
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function attachLatexDocumentContext(snippets, sourceCode, options = {}) {
  const context = extractLatexDocumentContext(sourceCode);
  if (!context) {
    return snippets;
  }

  return snippets
    .filter((snippet) => {
      if (options.keepOnlyBodySnippets !== true) {
        return true;
      }
      return snippet.span.from >= context.bodyStart && snippet.span.from < context.bodyEnd;
    })
    .map((snippet) => {
      const latexPreamble = context.preamble.trim();
      const latexPrepend = extractTikzsetSetupBeforeSnippet(sourceCode, context.bodyStart, snippet.span.from).trim();

      if (latexPreamble.length === 0 && latexPrepend.length === 0) {
        return snippet;
      }

      return {
        ...snippet,
        latexPreamble: latexPreamble.length > 0 ? latexPreamble : null,
        latexPrepend: latexPrepend.length > 0 ? latexPrepend : null
      };
    });
}

function extractLatexDocumentContext(source) {
  const beginDocumentToken = "\\begin{document}";
  const endDocumentToken = "\\end{document}";
  const beginDocument = source.indexOf(beginDocumentToken);

  if (beginDocument === -1) {
    return null;
  }

  const bodyStart = beginDocument + beginDocumentToken.length;
  const endDocument = source.indexOf(endDocumentToken, bodyStart);
  const bodyEnd = endDocument === -1 ? source.length : endDocument;
  const preambleRaw = source.slice(0, beginDocument);
  const preamble = stripDocumentclass(preambleRaw);

  return {
    preamble,
    bodyStart,
    bodyEnd
  };
}

function stripDocumentclass(preamble) {
  const lines = preamble.split(/\r?\n/);
  const filtered = lines.filter((line) => !line.includes("\\documentclass"));
  return filtered.join("\n").trim();
}

function createSnippetRunName(index, snippet) {
  const ordinal = String(index + 1).padStart(4, "0");
  return `${ordinal}-${snippet.kind}-l${snippet.startLine}`;
}

function recoverInlineTikzCodeExamples(snippets, sourceCode) {
  const codeExampleSpans = extractCodeExampleContexts(sourceCode);
  if (codeExampleSpans.length === 0) {
    return snippets;
  }

  const lineStarts = buildLineStarts(sourceCode);

  return snippets.map((snippet) => {
    if (snippet.kind !== "tikz-inline" || !snippet.incomplete || !isInsideAnySpan(snippet.span.from, codeExampleSpans)) {
      return snippet;
    }

    const expanded = expandInlineTikzSnippet(sourceCode, snippet.span.from);
    if (!expanded || expanded.incomplete || expanded.end < snippet.span.to) {
      return snippet;
    }

    return {
      ...snippet,
      source: sourceCode.slice(snippet.span.from, expanded.end),
      span: {
        from: snippet.span.from,
        to: expanded.end
      },
      endLine: lineForOffset(Math.max(snippet.span.from, expanded.end - 1), lineStarts),
      incomplete: false
    };
  });
}

function attachCodeExampleLatexContext(snippets, sourceCode) {
  const codeExampleContexts = extractCodeExampleContexts(sourceCode);
  if (codeExampleContexts.length === 0) {
    return snippets;
  }

  return snippets.map((snippet) => {
    const context = findContainingSpan(snippet.span.from, codeExampleContexts);
    if (!context) {
      return snippet;
    }

    const preambleParts = collectPreamblesBeforeSnippet(codeExampleContexts, snippet.span.from);
    const currentPreamble = context.preamble.trim();
    if (currentPreamble.length > 0) {
      preambleParts.push(currentPreamble);
    }
    const latexPreamble = dedupePreservingOrder(preambleParts).join("\n");
    const prependParts = [];
    const setupCode = collectSetupCodeBeforeSnippet(sourceCode, codeExampleContexts, snippet.span.from);
    if (setupCode.length > 0) {
      prependParts.push(setupCode);
    }
    const latexPre = context.pre.trim();
    if (latexPre.length > 0) {
      prependParts.push(latexPre);
    }
    const contextPrelude = sourceCode.slice(context.bodyStart, snippet.span.from).trim();
    if (contextPrelude.length > 0) {
      prependParts.push(contextPrelude);
    }
    const latexPrepend = prependParts.join("\n");

    if (latexPreamble.length === 0 && latexPrepend.length === 0) {
      return snippet;
    }

    return {
      ...snippet,
      latexPreamble: latexPreamble.length > 0 ? latexPreamble : null,
      latexPrepend: latexPrepend.length > 0 ? latexPrepend : null
    };
  });
}

function collectPreamblesBeforeSnippet(contexts, snippetStart) {
  const preambles = [];
  for (const context of contexts) {
    if (context.to > snippetStart) {
      continue;
    }
    const preamble = context.preamble.trim();
    if (preamble.length > 0) {
      preambles.push(preamble);
    }
  }
  return preambles;
}

function dedupePreservingOrder(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function collectSetupCodeBeforeSnippet(sourceCode, contexts, snippetStart) {
  const setupBlocks = [];
  for (const context of contexts) {
    if (!context.setupCode || context.to > snippetStart) {
      continue;
    }
    const body = sourceCode.slice(context.bodyStart, context.bodyEnd).trim();
    if (body.length > 0) {
      setupBlocks.push(body);
    }
  }
  return setupBlocks.join("\n");
}

function extractCodeExampleContexts(source) {
  const beginToken = "\\begin{codeexample}";
  const endToken = "\\end{codeexample}";
  const contexts = [];
  let cursor = 0;

  while (cursor < source.length) {
    const begin = source.indexOf(beginToken, cursor);
    if (begin === -1) {
      break;
    }

    let searchCursor = begin + beginToken.length;
    searchCursor = skipWhitespaceAndComments(source, searchCursor);

    let optionsRaw = "";
    if (source[searchCursor] === "[") {
      const options = findBalancedEnd(source, searchCursor, "[", "]");
      if (!options) {
        break;
      }
      optionsRaw = source.slice(searchCursor + 1, options.end - 1);
      searchCursor = options.end;
    }

    const endStart = source.indexOf(endToken, searchCursor);
    if (endStart === -1) {
      break;
    }

    const parsedOptions = parseCodeExampleOptions(optionsRaw);
    const end = endStart + endToken.length;
    contexts.push({
      from: begin,
      to: end,
      bodyStart: searchCursor,
      bodyEnd: endStart,
      pre: parsedOptions.pre ?? "",
      preamble: parsedOptions.preamble ?? "",
      setupCode: Object.prototype.hasOwnProperty.call(parsedOptions, "setup code")
    });
    cursor = end;
  }

  return contexts;
}

function parseCodeExampleOptions(rawOptions) {
  const parsed = {};
  let cursor = 0;

  while (cursor < rawOptions.length) {
    cursor = skipOptionDelimiters(rawOptions, cursor);
    if (cursor >= rawOptions.length) {
      break;
    }

    const keyStart = cursor;
    while (cursor < rawOptions.length && rawOptions[cursor] !== "=" && rawOptions[cursor] !== ",") {
      cursor += 1;
    }

    const key = rawOptions.slice(keyStart, cursor).trim();
    let value = "";

    if (cursor < rawOptions.length && rawOptions[cursor] === "=") {
      cursor += 1;
      cursor = skipOptionWhitespace(rawOptions, cursor);
      const parsedValue = readCodeExampleOptionValue(rawOptions, cursor);
      value = parsedValue.value;
      cursor = parsedValue.end;
    }

    if (key.length > 0) {
      parsed[key] = value;
    }

    cursor = skipOptionWhitespace(rawOptions, cursor);
    if (cursor < rawOptions.length && rawOptions[cursor] === ",") {
      cursor += 1;
    }
  }

  return parsed;
}

function readCodeExampleOptionValue(source, start) {
  if (start >= source.length) {
    return { value: "", end: start };
  }

  const ch = source[start];
  if (ch === "{") {
    const balanced = findBalancedEnd(source, start, "{", "}");
    if (!balanced) {
      return { value: source.slice(start + 1).trim(), end: source.length };
    }
    return {
      value: source.slice(start + 1, balanced.end - 1).trim(),
      end: balanced.end
    };
  }

  if (ch === '"' || ch === "'") {
    let cursor = start + 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") {
        cursor += 2;
        continue;
      }
      if (source[cursor] === ch) {
        return {
          value: source.slice(start + 1, cursor),
          end: cursor + 1
        };
      }
      cursor += 1;
    }

    return {
      value: source.slice(start + 1),
      end: source.length
    };
  }

  let cursor = start;
  while (cursor < source.length && source[cursor] !== ",") {
    cursor += 1;
  }

  return {
    value: source.slice(start, cursor).trim(),
    end: cursor
  };
}

function skipOptionDelimiters(source, cursor) {
  let index = cursor;

  while (index < source.length) {
    const ch = source[index];
    if (ch === "," || /\s/u.test(ch)) {
      index += 1;
      continue;
    }
    return index;
  }

  return index;
}

function skipOptionWhitespace(source, cursor) {
  let index = cursor;

  while (index < source.length && /\s/u.test(source[index])) {
    index += 1;
  }

  return index;
}

function extractTikzsetSetupBeforeSnippet(source, from, to) {
  if (from >= to) {
    return "";
  }

  const commands = [];
  let cursor = from;

  while (cursor < to) {
    const hit = source.indexOf("\\tikzset", cursor);
    if (hit === -1 || hit >= to) {
      break;
    }

    let bodyCursor = hit + "\\tikzset".length;
    bodyCursor = skipWhitespaceAndComments(source, bodyCursor);
    if (bodyCursor >= to || source[bodyCursor] !== "{") {
      cursor = hit + "\\tikzset".length;
      continue;
    }

    const balanced = findBalancedEnd(source, bodyCursor, "{", "}");
    if (!balanced || balanced.end > to) {
      break;
    }

    const command = source.slice(hit, balanced.end).trim();
    if (command.length > 0) {
      commands.push(command);
    }
    cursor = balanced.end;
  }

  return commands.join("\n");
}

function expandInlineTikzSnippet(source, start) {
  const prefixMatch = /^\\tikz\b/.exec(source.slice(start));
  if (!prefixMatch) {
    return null;
  }

  let cursor = start + prefixMatch[0].length;
  cursor = skipWhitespaceAndComments(source, cursor);

  while (source[cursor] === "[") {
    const options = findBalancedEnd(source, cursor, "[", "]");
    if (!options) {
      return { end: source.length, incomplete: true };
    }
    cursor = skipWhitespaceAndComments(source, options.end);
  }

  if (source[cursor] === "{") {
    const body = findBalancedEnd(source, cursor, "{", "}");
    if (!body) {
      return { end: source.length, incomplete: true };
    }

    let end = body.end;
    const maybeSemicolon = skipWhitespaceAndComments(source, end);
    if (source[maybeSemicolon] === ";") {
      end = maybeSemicolon + 1;
    }

    return { end, incomplete: false };
  }

  let curlyDepth = 0;
  let squareDepth = 0;
  let parenDepth = 0;
  let inComment = false;

  for (let i = cursor; i < source.length; i += 1) {
    const ch = source[i];

    if (inComment) {
      if (ch === "\n") {
        inComment = false;
      }
      continue;
    }

    if (ch === "%") {
      inComment = true;
      continue;
    }

    if (ch === "\\") {
      i += 1;
      continue;
    }

    if (ch === "{") {
      curlyDepth += 1;
      continue;
    }
    if (ch === "}") {
      curlyDepth = Math.max(0, curlyDepth - 1);
      continue;
    }
    if (ch === "[") {
      squareDepth += 1;
      continue;
    }
    if (ch === "]") {
      squareDepth = Math.max(0, squareDepth - 1);
      continue;
    }
    if (ch === "(") {
      parenDepth += 1;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (ch === ";" && curlyDepth === 0 && squareDepth === 0 && parenDepth === 0) {
      return { end: i + 1, incomplete: false };
    }
  }

  return { end: source.length, incomplete: true };
}

function findBalancedEnd(source, start, openChar, closeChar) {
  if (source[start] !== openChar) {
    return null;
  }

  let depth = 0;
  let inComment = false;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];

    if (inComment) {
      if (ch === "\n") {
        inComment = false;
      }
      continue;
    }

    if (ch === "%") {
      inComment = true;
      continue;
    }

    if (ch === "\\") {
      i += 1;
      continue;
    }

    if (ch === openChar) {
      depth += 1;
      continue;
    }

    if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return { end: i + 1 };
      }
    }
  }

  return null;
}

function skipWhitespaceAndComments(source, cursor) {
  let index = cursor;

  while (index < source.length) {
    const ch = source[index];
    if (ch === "%" && source[index - 1] !== "\\") {
      const newlineIndex = source.indexOf("\n", index + 1);
      if (newlineIndex === -1) {
        return source.length;
      }
      index = newlineIndex + 1;
      continue;
    }

    if (/\s/u.test(ch)) {
      index += 1;
      continue;
    }

    return index;
  }

  return index;
}

function buildLineStarts(source) {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "\n") {
      lineStarts.push(i + 1);
    }
  }
  return lineStarts;
}

function lineForOffset(offset, lineStarts) {
  let low = 0;
  let high = lineStarts.length - 1;
  let answer = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineStarts[mid] <= offset) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return answer + 1;
}

function isInsideAnySpan(position, spans) {
  return findContainingSpan(position, spans) !== null;
}

function findContainingSpan(position, spans) {
  for (const span of spans) {
    if (position >= span.from && position < span.to) {
      return span;
    }
  }
  return null;
}

function buildEntry(params) {
  const { index, snippet, batchDir, status, runDir, reportPath, report, errorMessage } = params;
  const parseDiagnostics = report?.renderer?.parseDiagnostics ?? [];
  const semanticDiagnostics = report?.renderer?.semanticDiagnostics ?? [];
  const svgDiagnostics = report?.renderer?.svgDiagnostics ?? [];
  const latex = report?.latex ?? { compiled: false, rasterized: false, converted: false, mode: defaultReferenceMode };
  const outputs = report?.outputs ?? {};
  const referenceMode = parseReferenceMode(report?.reference?.mode ?? latex.mode ?? defaultReferenceMode);
  const dvisvgmReference = referenceMode === "dvisvgm-svg" || referenceMode === "dvisvgm-svg-png";
  const oursImagePath = outputs.oursComparablePng ?? outputs.oursWhitePng ?? outputs.oursPng ?? outputs.oursSvg;
  const latexImagePath = outputs.latexComparablePng ?? outputs.latexWhitePng ?? outputs.latexPng ?? (dvisvgmReference ? outputs.latexSvg : null);

  return {
    index,
    id: snippet.id,
    kind: snippet.kind,
    filePath: snippet.filePath,
    startLine: snippet.startLine,
    endLine: snippet.endLine,
    incomplete: snippet.incomplete,
    status,
    errorMessage,
    runDir: runDir ? relativizePath(batchDir, runDir) : null,
    reportPath: reportPath ? relativizePath(batchDir, reportPath) : null,
    referenceMode,
    images: {
      ours: oursImagePath ? relativizePath(batchDir, oursImagePath) : null,
      latex: latexImagePath ? relativizePath(batchDir, latexImagePath) : null,
      sideBySide: outputs.sideBySidePng ? relativizePath(batchDir, outputs.sideBySidePng) : null
    },
    diagnostics: {
      parseCount: parseDiagnostics.length,
      semanticCount: semanticDiagnostics.length,
      svgCount: svgDiagnostics.length,
      parseErrorCount: parseDiagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
      semanticErrorCount: semanticDiagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
      svgErrorCount: svgDiagnostics.filter((diagnostic) => diagnostic.severity === "error").length
    },
    latex: {
      mode: referenceMode,
      compiled: Boolean(latex.compiled),
      rasterized: Boolean(latex.rasterized),
      converted: Boolean(latex.converted),
      error: latex.error ?? null
    },
    source: snippet.source
  };
}

function renderHtmlPage(manifest) {
  const summary = manifest.totals;
  const generatedAt = manifest.generatedAt;
  const mode = manifest.mode ?? "pgf-docs";
  const modeLabel = corpusModeLabel(mode);
  const sourceLabel = manifest?.source?.label ?? manifest?.source?.sourceRelativePath ?? "(multiple files)";
  const escapedSource = escapeHtml(sourceLabel);
  const referenceMode = escapeHtml(manifest.filters.referenceMode ?? defaultReferenceMode);
  const cards = manifest.entries.map((entry) => renderEntryCard(entry)).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(modeLabel)} Renderer Comparison</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f3ee;
      --text: #1f2630;
      --card: #ffffff;
      --accent: #0b6e4f;
      --muted: #667085;
      --border: #d0d7de;
      --error: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif;
      background: radial-gradient(circle at top right, #fff8ef 0%, var(--bg) 46%);
      color: var(--text);
    }
    header {
      padding: 1.25rem 1.5rem 0.5rem;
    }
    h1 {
      margin: 0;
      font-size: 1.8rem;
      line-height: 1.2;
    }
    .summary {
      margin-top: 0.5rem;
      color: var(--muted);
      font-size: 0.95rem;
    }
    main {
      padding: 1rem 1.5rem 2rem;
      display: grid;
      gap: 1rem;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 0.9rem;
      box-shadow: 0 3px 14px rgba(20, 20, 20, 0.04);
    }
    .card.error {
      border-color: #f4c7c3;
    }
    .card h2 {
      margin: 0 0 0.4rem;
      font-size: 1.1rem;
    }
    .meta {
      margin: 0 0 0.75rem;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .grid {
      display: grid;
      gap: 0.8rem;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    }
    .pane {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.55rem;
      background: #fcfcfc;
      min-height: 190px;
    }
    .pane h3 {
      margin: 0 0 0.45rem;
      font-size: 0.95rem;
      color: var(--accent);
    }
    .pane img {
      width: 100%;
      height: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #fff;
    }
    .missing {
      color: var(--error);
      font-size: 0.9rem;
      margin: 0;
    }
    details {
      margin-top: 0.65rem;
    }
    pre {
      margin: 0;
      font-size: 0.85rem;
      overflow-x: auto;
      background: #121212;
      color: #f5f5f5;
      border-radius: 8px;
      padding: 0.55rem;
    }
    .diag {
      margin-top: 0.4rem;
      font-size: 0.88rem;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(modeLabel)} Renderer Comparison</h1>
    <p class="summary">
      Mode: <code>${escapeHtml(mode)}</code><br>
      Source: <code>${escapedSource}</code><br>
      Generated: ${escapeHtml(generatedAt)}<br>
      Reference mode: <code>${referenceMode}</code><br>
      Snippets: ${summary.snippets} | Succeeded: ${summary.succeeded} | Failed: ${summary.failed}
    </p>
  </header>
  <main>
${cards}
  </main>
</body>
</html>`;
}

function renderEntryCard(entry) {
  const title = `#${entry.index} ${entry.kind} lines ${entry.startLine}-${entry.endLine}`;
  const oursPane = renderImagePane("Our renderer", entry.images.ours, `ours-${entry.index}`);
  const dvisvgmReference = entry.referenceMode === "dvisvgm-svg" || entry.referenceMode === "dvisvgm-svg-png";
  const referenceLabel = dvisvgmReference ? "dvisvgm reference (PNG)" : "pdflatex reference (PNG)";
  const latexPane = renderImagePane(referenceLabel, entry.images.latex, `latex-${entry.index}`);
  const diag = `parse:${entry.diagnostics.parseCount} (errors ${entry.diagnostics.parseErrorCount}), semantic:${entry.diagnostics.semanticCount} (errors ${entry.diagnostics.semanticErrorCount}), svg:${entry.diagnostics.svgCount} (errors ${entry.diagnostics.svgErrorCount})`;
  const latexInfo =
    dvisvgmReference
      ? `latex compiled=${entry.latex.compiled} converted=${entry.latex.converted} rasterized=${entry.latex.rasterized}`
      : `latex compiled=${entry.latex.compiled} rasterized=${entry.latex.rasterized}`;
  const errorLine = entry.errorMessage ? `<p class="missing">${escapeHtml(entry.errorMessage)}</p>` : "";
  const latexErrorLine = entry.latex.error ? `<p class="missing">${escapeHtml(entry.latex.error)}</p>` : "";

  return `    <section class="card ${entry.status}">
      <h2>${escapeHtml(title)}</h2>
      <p class="meta"><code>${escapeHtml(entry.filePath)}</code> | id <code>${escapeHtml(entry.id)}</code></p>
      ${errorLine}
      <div class="grid">
        ${oursPane}
        ${latexPane}
      </div>
      <p class="diag">${escapeHtml(diag)} | ${escapeHtml(latexInfo)}</p>
      ${latexErrorLine}
      <details>
        <summary>Snippet Source</summary>
        <pre><code>${escapeHtml(entry.source)}</code></pre>
      </details>
    </section>`;
}

function renderImagePane(label, src, key) {
  if (!src) {
    return `<div class="pane"><h3>${escapeHtml(label)}</h3><p class="missing">Image unavailable</p></div>`;
  }
  return `<div class="pane"><h3>${escapeHtml(label)}</h3><img loading="lazy" src="${escapeAttribute(src)}" alt="${escapeAttribute(
    key
  )}"></div>`;
}

function relativizePath(baseDir, targetPath) {
  return toPosix(relative(baseDir, targetPath));
}

function toPosix(pathValue) {
  return pathValue.replace(/\\/g, "/");
}

function sanitizeName(input) {
  return input.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "docs";
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function corpusModeLabel(mode) {
  if (mode === "pgf-docs") {
    return "PGF Docs";
  }
  if (mode === "kottwitz-book") {
    return "Kottwitz Book";
  }
  if (mode === "kolda-book") {
    return "Kolda Book";
  }
  return "TikZ Corpus";
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(input) {
  return escapeHtml(String(input)).replaceAll('"', "&quot;");
}

function parseReferenceMode(value) {
  const mode = value || defaultReferenceMode;
  if (!validReferenceModes.has(mode)) {
    throw new Error(`Invalid --reference-mode value: ${value}. Expected one of: ${[...validReferenceModes].join(", ")}.`);
  }
  return mode;
}

function parseOnlySelection(raw) {
  const normalized = String(raw ?? "").trim();
  if (normalized.length === 0) {
    throw new Error("--only requires a comma-separated list like `6,7,8` or ranges like `10-14`.");
  }

  const selected = new Set();
  const tokens = normalized.split(",");
  for (const tokenRaw of tokens) {
    const token = tokenRaw.trim();
    if (token.length === 0) {
      continue;
    }

    const rangeMatch = token.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0 || start > end) {
        throw new Error(`Invalid --only range: ${token}`);
      }
      for (let index = start; index <= end; index += 1) {
        selected.add(index);
      }
      continue;
    }

    const index = Number.parseInt(token, 10);
    if (!Number.isFinite(index) || index <= 0) {
      throw new Error(`Invalid --only index: ${token}`);
    }
    selected.add(index);
  }

  if (selected.size === 0) {
    throw new Error("--only did not contain any valid snippet indices.");
  }

  return selected;
}

function isMain(metaUrl) {
  if (!process.argv[1]) {
    return false;
  }
  return pathToFileURL(resolve(process.argv[1])).href === metaUrl;
}
