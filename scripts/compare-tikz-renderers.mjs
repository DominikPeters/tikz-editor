#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ensureDistBuildFresh } from "./ensure-dist-build.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PDF_RASTER_DPI = 600;
const DEFAULT_REFERENCE_MODE = "pdf-png";
const REFERENCE_MODES = new Set(["pdf-png", "dvisvgm-svg", "dvisvgm-svg-png"]);

export class RendererComparisonError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "RendererComparisonError";
    this.reportPath = details.reportPath;
    this.runDir = details.runDir;
    this.report = details.report;
  }
}

export async function compareTikzRenderers(options = {}) {
  const referenceMode = normalizeReferenceMode(options.referenceMode);
  const useDvisvgmReference = referenceMode === "dvisvgm-svg" || referenceMode === "dvisvgm-svg-png";
  // Always rasterize reference SVGs so PNG comparable and side-by-side assets can be produced.
  const rasterizeLatexSvg = true;
  const input = loadInput({
    inputPath: options.inputPath ?? null,
    code: options.code ?? null,
    allowStdin: options.allowStdin === true
  });
  const runName = options.name ?? deriveRunName(options.inputPath ?? null, input.code);
  const outRoot = resolve(options.outDir ?? join(repoRoot, "artifacts", "renderer-compare"));
  const runDirName = options.includeTimestamp === false ? runName : `${runName}-${timestampSlug()}`;
  const runDir = join(outRoot, runDirName);
  const reportPath = join(runDir, "compare-report.json");
  mkdirSync(runDir, { recursive: true });

  const report = {
    input: {
      source: input.source,
      bytes: Buffer.byteLength(input.code, "utf8"),
      runName
    },
    tools: {
      pdflatex: commandExists("pdflatex"),
      lualatex: commandExists("lualatex"),
      latex: commandExists("latex"),
      dvisvgm: commandExists("dvisvgm"),
      magick: commandExists("magick"),
      rsvgConvert: commandExists("rsvg-convert"),
      pdftoppm: commandExists("pdftoppm"),
      sips: commandExists("sips")
    },
    reference: {
      mode: referenceMode
    },
    outputs: {},
    renderer: {
      parseDiagnostics: [],
      semanticDiagnostics: [],
      svgDiagnostics: []
    },
    latex: {
      mode: referenceMode,
      compiled: false,
      rasterized: false,
      converted: false,
      compiler: null,
      converter: null
    }
  };

  writeFileSync(join(runDir, "input.tikz"), input.code, "utf8");

  const distEntry = ensureDistBuildFresh(repoRoot);

  const rendererModule = await import(pathToFileURL(distEntry).href);
  const renderAsync = typeof rendererModule.renderTikzToSvgAsync === "function" ? rendererModule.renderTikzToSvgAsync : null;
  const renderSync = typeof rendererModule.renderTikzToSvg === "function" ? rendererModule.renderTikzToSvg : null;
  if (!renderAsync && !renderSync) {
    throwWithReport(
      "Neither renderTikzToSvgAsync nor renderTikzToSvg export found in packages/core/dist/index.js.",
      reportPath,
      runDir,
      report
    );
  }

  const rendererCode = injectRendererContext(input.code, {
    preamble: options.latexPreamble ?? "",
    pre: options.latexPrepend ?? ""
  });
  if (rendererCode !== input.code) {
    const rendererInputPath = join(runDir, "input-renderer.tikz");
    writeFileSync(rendererInputPath, rendererCode, "utf8");
    report.outputs.rendererInput = rendererInputPath;
  }

  const rendered = await (renderAsync ?? renderSync)(rendererCode, { parse: { recover: true } });
  report.renderer.parseDiagnostics = rendered.parse.diagnostics;
  report.renderer.semanticDiagnostics = rendered.semantic.diagnostics;
  report.renderer.svgDiagnostics = rendered.svg.diagnostics;

  const oursSvgPath = join(runDir, "ours.svg");
  const oursPngPath = join(runDir, "ours.png");
  let oursRasterPath = null;
  let latexRasterPath = null;
  writeFileSync(oursSvgPath, rendered.svg.svg, "utf8");
  report.outputs.oursSvg = oursSvgPath;

  if (options.rasterizeOurs !== false) {
    const oursRaster = rasterizeSvg(oursSvgPath, oursPngPath, report.tools);
    if (!oursRaster.ok) {
      throwWithReport(
        `Failed to rasterize renderer SVG: ${oursRaster.error}`,
        reportPath,
        runDir,
        { ...report, rendererRasterError: oursRaster.error }
      );
    }
    report.outputs.oursPng = oursPngPath;
    oursRasterPath = oursPngPath;
  }

  const wrappedTex = wrapTikzForStandalone(input.code, referenceMode, {
    preamble: options.latexPreamble ?? "",
    pre: options.latexPrepend ?? ""
  });
  const latexTexPath = join(runDir, "latex-standalone.tex");
  const latexPdfPath = join(runDir, "latex-standalone.pdf");
  const latexPngPath = join(runDir, "latex-standalone.png");
  const latexDviPath = join(runDir, "latex-standalone.dvi");
  const latexSvgPath = join(runDir, "latex-standalone.svg");
  writeFileSync(latexTexPath, wrappedTex, "utf8");
  report.outputs.latexTex = latexTexPath;

  if (!useDvisvgmReference) {
    const latexCompile = compileLatex(latexTexPath, runDir, report.tools);
    report.latex.compiled = latexCompile.ok;
    report.latex.compiler = latexCompile.compiler ?? null;
    if (!latexCompile.ok) {
      report.latex.error = latexCompile.error;
      report.latex.log = latexCompile.logTail;
    } else {
      report.outputs.latexPdf = latexPdfPath;
      const latexRaster = rasterizePdf(latexPdfPath, latexPngPath, report.tools);
      report.latex.converter = latexRaster.tool ?? null;
      report.latex.rasterized = latexRaster.ok;
      if (!latexRaster.ok) {
        report.latex.error = latexRaster.error;
      } else {
        report.outputs.latexPng = latexPngPath;
        latexRasterPath = latexPngPath;
      }
    }
  } else {
    const dviCompile = compileLatexToDvi(latexTexPath, runDir, report.tools);
    report.latex.compiled = dviCompile.ok;
    report.latex.compiler = dviCompile.compiler ?? null;
    if (!dviCompile.ok) {
      report.latex.error = dviCompile.error;
      report.latex.log = dviCompile.logTail;
    } else {
      report.outputs.latexDvi = latexDviPath;
      const dviConvert = convertDviToSvg(latexDviPath, latexSvgPath, report.tools);
      report.latex.converter = dviConvert.converter ?? null;
      report.latex.converted = dviConvert.ok;
      report.latex.rasterized = false;
      if (!dviConvert.ok) {
        report.latex.error = dviConvert.error;
      } else {
        report.outputs.latexSvg = latexSvgPath;
        if (rasterizeLatexSvg) {
          const latexRaster = rasterizeSvg(latexSvgPath, latexPngPath, report.tools);
          report.latex.converter = report.latex.converter ?? latexRaster.tool ?? null;
          report.latex.rasterized = latexRaster.ok;
          if (!latexRaster.ok) {
            report.latex.error = latexRaster.error;
          } else {
            report.outputs.latexPng = latexPngPath;
            latexRasterPath = latexPngPath;
          }
        }
      }
    }
  }

  if (oursRasterPath && latexRasterPath) {
    const comparisonAssets = createComparisonPngAssets(
      runDir,
      {
        oursPngPath: oursRasterPath,
        latexPngPath: latexRasterPath,
        oursSvgPath
      },
      report.tools
    );
    if (comparisonAssets.ok) {
      Object.assign(report.outputs, comparisonAssets.outputs);
      report.comparison = {
        ok: true,
        ...(comparisonAssets.metadata ?? {})
      };
    } else {
      report.comparison = {
        ok: false,
        error: comparisonAssets.error
      };
    }
  }

  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  return {
    runDir,
    reportPath,
    outputs: report.outputs,
    latex: report.latex,
    report
  };
}

async function runCli() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printUsage();
      process.exit(0);
    }
    const result = await compareTikzRenderers({
      inputPath: args.inputPath,
      code: args.code,
      outDir: args.outDir,
      name: args.name,
      allowStdin: true,
      includeTimestamp: args.includeTimestamp,
      rasterizeOurs: args.rasterizeOurs,
      referenceMode: args.referenceMode
    });
    console.log(
      JSON.stringify(
        {
          runDir: result.runDir,
          reportPath: result.reportPath,
          outputs: result.outputs,
          latex: result.latex
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

if (isMain(import.meta.url)) {
  await runCli();
}

function parseArgs(argv) {
  const parsed = {
    inputPath: null,
    code: null,
    outDir: null,
    name: null,
    includeTimestamp: true,
    rasterizeOurs: true,
    referenceMode: DEFAULT_REFERENCE_MODE,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--input") {
      parsed.inputPath = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--code") {
      parsed.code = argv[i + 1] ?? null;
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
    if (arg === "--no-timestamp") {
      parsed.includeTimestamp = false;
      continue;
    }
    if (arg === "--skip-ours-raster") {
      parsed.rasterizeOurs = false;
      continue;
    }
    if (arg === "--reference-mode") {
      parsed.referenceMode = normalizeReferenceMode(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function printUsage() {
  console.log(`Usage:
  node scripts/compare-tikz-renderers.mjs --input path/to/snippet.tex [--out-dir dir] [--name run]
  node scripts/compare-tikz-renderers.mjs --code "\\\\draw (0,0)--(1,1);" [--out-dir dir] [--name run]
  cat snippet.tex | node scripts/compare-tikz-renderers.mjs [--out-dir dir] [--name run]
  node scripts/compare-tikz-renderers.mjs --code "\\\\draw (0,0)--(1,1);" --no-timestamp
  node scripts/compare-tikz-renderers.mjs --code "\\\\draw (0,0)--(1,1);" --skip-ours-raster
  node scripts/compare-tikz-renderers.mjs --code "\\\\draw (0,0)--(1,1);" --reference-mode dvisvgm-svg
  node scripts/compare-tikz-renderers.mjs --code "\\\\draw (0,0)--(1,1);" --reference-mode dvisvgm-svg-png

Outputs:
  input.tikz
  ours.svg / ours.png / ours-white.png / ours-comparable.png
  latex-standalone.tex / latex-standalone.pdf / latex-standalone.png / latex-white.png / latex-comparable.png (pdf-png mode)
  latex-standalone.tex / latex-standalone.dvi / latex-standalone.svg / latex-standalone.png / latex-white.png / latex-comparable.png (dvisvgm-svg mode)
  latex-standalone.tex / latex-standalone.dvi / latex-standalone.svg / latex-standalone.png / latex-white.png / latex-comparable.png (dvisvgm-svg-png mode)
  side-by-side.png
  compare-report.json
`);
}

function loadInput(parsedArgs) {
  if (parsedArgs.inputPath) {
    const path = resolve(parsedArgs.inputPath);
    if (!existsSync(path)) {
      throw new Error(`Input file not found: ${path}`);
    }
    return { code: readFileSync(path, "utf8"), source: `file:${path}` };
  }

  if (parsedArgs.code != null) {
    return { code: parsedArgs.code, source: "inline-arg" };
  }

  if (parsedArgs.allowStdin && !process.stdin.isTTY) {
    return { code: readFileSync(0, "utf8"), source: "stdin" };
  }

  throw new Error("No input provided. Use --input, --code, or stdin.");
}

function deriveRunName(inputPath, code) {
  if (inputPath) {
    return sanitizeName(basename(inputPath, extname(inputPath)));
  }
  const hash = Math.abs(hashCode(code)).toString(16);
  return `tikz-${hash}`;
}

function wrapTikzForStandalone(code, referenceMode, latexContext = {}) {
  const trimmed = code.trim();
  if (/\\documentclass/.test(trimmed)) {
    return `${trimmed}\n`;
  }

  const preamble = normalizeLatexInjection(latexContext.preamble);
  const pre = normalizeLatexInjection(latexContext.pre);
  const hasTikzPicture = /\\begin\{tikzpicture\}/.test(trimmed);
  const startsWithInlineTikz = /^\s*\\tikz(?:\s|\[|$)/.test(trimmed);
  const body = hasTikzPicture || startsWithInlineTikz ? trimmed : `\\begin{tikzpicture}\n${trimmed}\n\\end{tikzpicture}`;
  const bodyWithPre = pre.length > 0 ? `${pre}\n${body}` : body;
  const useDvisvgmReference = referenceMode === "dvisvgm-svg" || referenceMode === "dvisvgm-svg-png";
  const standaloneClassOptions = useDvisvgmReference ? "dvisvgm,border=2pt" : "tikz,border=2pt";

  const lines = [
    `\\documentclass[${standaloneClassOptions}]{standalone}`,
    "\\usepackage{tikz}",
    preamble,
    "\\begin{document}",
    bodyWithPre,
    "\\end{document}",
    ""
  ].filter((line) => line.length > 0);

  return lines.join("\n");
}

function injectRendererContext(code, latexContext = {}) {
  const preamble = sanitizeRendererPreamble(latexContext.preamble);
  const pre = normalizeLatexInjection(latexContext.pre);
  const injections = [preamble, pre].filter((part) => part.length > 0).join("\n");
  if (injections.length === 0) {
    return code;
  }

  const inlineInjected = injectInlineTikzRendererContext(code, injections);
  if (inlineInjected != null) {
    return inlineInjected;
  }

  const beginToken = "\\begin{tikzpicture}";
  const beginIndex = code.indexOf(beginToken);
  if (beginIndex === -1) {
    return `${injections}\n${code}`;
  }

  let insertionPoint = beginIndex + beginToken.length;
  while (insertionPoint < code.length && /\s/u.test(code[insertionPoint] ?? "")) {
    insertionPoint += 1;
  }
  if ((code[insertionPoint] ?? "") === "[") {
    const optionsEnd = findBalancedBracketEnd(code, insertionPoint, "[", "]");
    if (optionsEnd != null) {
      insertionPoint = optionsEnd;
    }
  }

  return `${code.slice(0, insertionPoint)}\n${injections}\n${code.slice(insertionPoint)}`;
}

function injectInlineTikzRendererContext(code, injections) {
  const inlineStart = code.search(/\S/u);
  if (inlineStart < 0) {
    return null;
  }

  const inlineToken = "\\tikz";
  if (!code.startsWith(inlineToken, inlineStart)) {
    return null;
  }

  let cursor = inlineStart + inlineToken.length;
  if (/[A-Za-z@]/u.test(code[cursor] ?? "")) {
    return null;
  }

  while (cursor < code.length && /\s/u.test(code[cursor] ?? "")) {
    cursor += 1;
  }

  let optionRaw = "";
  if ((code[cursor] ?? "") === "[") {
    const optionEnd = findBalancedBracketEnd(code, cursor, "[", "]");
    if (optionEnd == null) {
      return null;
    }
    optionRaw = code.slice(cursor, optionEnd);
    cursor = optionEnd;
    while (cursor < code.length && /\s/u.test(code[cursor] ?? "")) {
      cursor += 1;
    }
  }

  const body = unwrapInlineTikzBody(code.slice(cursor).trim());
  return `\\begin{tikzpicture}${optionRaw}\n${injections}\n${body}\n\\end{tikzpicture}`;
}

function unwrapInlineTikzBody(body) {
  if (!body.startsWith("{")) {
    return body;
  }

  const bodyEnd = findBalancedBracketEnd(body, 0, "{", "}");
  if (bodyEnd == null || body.slice(bodyEnd).trim().length > 0) {
    return body;
  }

  return body.slice(1, bodyEnd - 1).trim();
}

function findBalancedBracketEnd(source, start, openChar, closeChar) {
  if (source[start] !== openChar) {
    return null;
  }

  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === openChar) {
      depth += 1;
      continue;
    }
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return null;
}

function normalizeLatexInjection(value) {
  if (value == null) {
    return "";
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : "";
}

function sanitizeRendererPreamble(value) {
  const normalized = normalizeLatexInjection(value);
  if (normalized.length === 0) {
    return "";
  }

  const kept = normalized
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        return false;
      }
      if (trimmed.startsWith("%")) {
        return false;
      }
      if (trimmed.startsWith("\\usepackage") || trimmed.startsWith("\\RequirePackage")) {
        return false;
      }
      return true;
    });

  return kept.join("\n");
}

function compileLatex(texPath, cwd, tools) {
  if (!tools.pdflatex) {
    return {
      ok: false,
      error: "pdflatex command not found.",
      logTail: ""
    };
  }

  const result = runCommand("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", basename(texPath)], { cwd });
  if (!result.ok) {
    return {
      ok: false,
      error: `pdflatex failed with exit code ${result.status}.`,
      logTail: tail((result.stdout ?? "") + "\n" + (result.stderr ?? ""), 120)
    };
  }

  const pdfPath = texPath.replace(/\.tex$/i, ".pdf");
  if (!existsSync(pdfPath)) {
    return {
      ok: false,
      error: "pdflatex completed but PDF was not produced.",
      logTail: tail(result.stdout ?? "", 120)
    };
  }

  return {
    ok: true,
    compiler: "pdflatex",
    pdfPath
  };
}

function compileLatexToDvi(texPath, cwd, tools) {
  const texFileName = basename(texPath);
  let command = "";
  let args = [];

  if (tools.lualatex) {
    command = "lualatex";
    args = ["--output-format=dvi", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", texFileName];
  } else if (tools.latex) {
    command = "latex";
    args = ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", texFileName];
  } else {
    return {
      ok: false,
      error: "Neither lualatex nor latex command was found.",
      logTail: ""
    };
  }

  const result = runCommand(command, args, { cwd });
  if (!result.ok) {
    return {
      ok: false,
      error: `${command} failed with exit code ${result.status}.`,
      logTail: tail((result.stdout ?? "") + "\n" + (result.stderr ?? ""), 120)
    };
  }

  const dviPath = texPath.replace(/\.tex$/i, ".dvi");
  if (!existsSync(dviPath)) {
    return {
      ok: false,
      error: `${command} completed but DVI was not produced.`,
      logTail: tail(result.stdout ?? "", 120)
    };
  }

  return {
    ok: true,
    compiler: command,
    dviPath
  };
}

function rasterizeSvg(svgPath, pngPath, tools, options = {}) {
  const zoom = normalizeScaleFactor(options.zoom ?? 1);
  if (tools.rsvgConvert) {
    const rsvgArgs = [
      "-f",
      "png",
      "-d",
      String(PDF_RASTER_DPI),
      "-p",
      String(PDF_RASTER_DPI),
      "-z",
      String(zoom),
      "-b",
      "white",
      "-o",
      pngPath,
      svgPath
    ];
    const rsvg = runCommand("rsvg-convert", rsvgArgs);
    if (rsvg.ok && existsSync(pngPath)) {
      if (!ensureOpaqueWhitePng(pngPath, tools)) {
        return { ok: false, error: "Failed to normalize SVG raster output to an opaque white background." };
      }
      return { ok: true, tool: "rsvg-convert" };
    }
  }

  if (tools.sips) {
    const sips = runCommand("sips", ["-s", "format", "png", svgPath, "--out", pngPath]);
    if (sips.ok && existsSync(pngPath)) {
      if (Math.abs(zoom - 1) > 0.02) {
        const scaledPath = pngPath.replace(/\.png$/i, ".scaled.png");
        if (!resizePngByScale(pngPath, scaledPath, zoom, tools) || !existsSync(scaledPath)) {
          return { ok: false, error: "Failed to apply scale factor to SVG rasterized with sips." };
        }
        renameSync(scaledPath, pngPath);
      }
      if (!ensureOpaqueWhitePng(pngPath, tools)) {
        return { ok: false, error: "Failed to normalize SVG raster output to an opaque white background." };
      }
      return { ok: true, tool: "sips" };
    }
  }

  return {
    ok: false,
    error: "No SVG rasterizer succeeded. Tried rsvg-convert and sips."
  };
}

function rasterizePdf(pdfPath, pngPath, tools) {
  if (tools.magick) {
    const magick = runCommand("magick", [
      "-density",
      String(PDF_RASTER_DPI),
      pdfPath,
      "-background",
      "white",
      "-alpha",
      "remove",
      pngPath
    ]);
    if (magick.ok && existsSync(pngPath)) {
      if (!ensureOpaqueWhitePng(pngPath, tools)) {
        return { ok: false, error: "Failed to normalize PDF raster output to an opaque white background." };
      }
      return { ok: true, tool: "magick" };
    }
  }

  if (tools.pdftoppm) {
    const prefixPath = pngPath.replace(/\.png$/i, "");
    const pdftoppm = runCommand("pdftoppm", ["-png", "-singlefile", "-r", String(PDF_RASTER_DPI), pdfPath, prefixPath]);
    const producedPng = `${prefixPath}.png`;
    if (pdftoppm.ok && existsSync(producedPng)) {
      if (producedPng !== pngPath) {
        renameSync(producedPng, pngPath);
      }
      if (!ensureOpaqueWhitePng(pngPath, tools)) {
        return { ok: false, error: "Failed to normalize PDF raster output to an opaque white background." };
      }
      return { ok: true, tool: "pdftoppm" };
    }
  }

  return {
    ok: false,
    error: "No PDF rasterizer succeeded. Tried magick and pdftoppm."
  };
}

function ensureOpaqueWhitePng(pngPath, tools) {
  if (!tools.magick) {
    return true;
  }

  const tempPath = pngPath.replace(/\.png$/i, ".opaque.png");
  const result = runCommand("magick", [pngPath, "-background", "white", "-alpha", "remove", "-alpha", "off", tempPath]);
  if (!result.ok || !existsSync(tempPath)) {
    return false;
  }

  renameSync(tempPath, pngPath);
  return true;
}

function createComparisonPngAssets(
  runDir,
  { oursPngPath, latexPngPath, oursSvgPath = null },
  tools
) {
  if (!tools.magick) {
    return { ok: false, error: "magick command not found. Cannot build comparable PNG assets." };
  }

  const COMPARISON_TRIM_FUZZ = "2%";
  const oursWhitePath = join(runDir, "ours-white.png");
  const latexWhitePath = join(runDir, "latex-white.png");
  const oursTrimmedPath = join(runDir, "ours-trimmed.png");
  const latexTrimmedPath = join(runDir, "latex-trimmed.png");
  const oursComparablePath = join(runDir, "ours-comparable.png");
  const latexComparablePath = join(runDir, "latex-comparable.png");
  const sideBySidePath = join(runDir, "side-by-side.png");
  const oursRerasterPath = join(runDir, "ours-rerasterized.png");

  let rendererRasterPath = oursPngPath;
  let rendererRerasterZoom = 1;
  let rendererRerasterApplied = false;

  if (!flattenPngOnWhite(rendererRasterPath, oursWhitePath, tools)) {
    return { ok: false, error: "Failed to flatten renderer PNG onto white background." };
  }
  if (!flattenPngOnWhite(latexPngPath, latexWhitePath, tools)) {
    return { ok: false, error: "Failed to flatten reference PNG onto white background." };
  }

  if (!trimPngContent(oursWhitePath, oursTrimmedPath, COMPARISON_TRIM_FUZZ, tools)) {
    return { ok: false, error: "Failed to trim renderer PNG content bounds." };
  }
  if (!trimPngContent(latexWhitePath, latexTrimmedPath, COMPARISON_TRIM_FUZZ, tools)) {
    return { ok: false, error: "Failed to trim reference PNG content bounds." };
  }

  const oursContentSize = identifyPngSize(oursTrimmedPath, tools);
  const latexContentSize = identifyPngSize(latexTrimmedPath, tools);
  if (!oursContentSize || !latexContentSize) {
    return { ok: false, error: "Failed to read content bounds for comparison assets." };
  }

  const initialRendererContentSize = { ...oursContentSize };
  const rawRerasterZoom = Math.max(
    latexContentSize.width / oursContentSize.width,
    latexContentSize.height / oursContentSize.height
  );
  const shouldRerasterizeRenderer = oursSvgPath && Math.abs(rawRerasterZoom - 1) > 0.05;
  if (shouldRerasterizeRenderer) {
    const rerasterResult = rasterizeSvg(oursSvgPath, oursRerasterPath, tools, { zoom: rawRerasterZoom });
    if (rerasterResult.ok && existsSync(oursRerasterPath)) {
      rendererRasterPath = oursRerasterPath;
      rendererRerasterZoom = normalizeScaleFactor(rawRerasterZoom);
      rendererRerasterApplied = true;

      if (!flattenPngOnWhite(rendererRasterPath, oursWhitePath, tools)) {
        return { ok: false, error: "Failed to flatten rerasterized renderer PNG onto white background." };
      }
      if (!trimPngContent(oursWhitePath, oursTrimmedPath, COMPARISON_TRIM_FUZZ, tools)) {
        return { ok: false, error: "Failed to trim rerasterized renderer PNG content bounds." };
      }

      const rerasterizedContentSize = identifyPngSize(oursTrimmedPath, tools);
      if (!rerasterizedContentSize) {
        return { ok: false, error: "Failed to read rerasterized renderer content bounds." };
      }
      oursContentSize.width = rerasterizedContentSize.width;
      oursContentSize.height = rerasterizedContentSize.height;
    }
  }

  const targetContentWidth = latexContentSize.width;
  const targetContentHeight = latexContentSize.height;
  const oursScale = normalizeScaleFactor(
    Math.min(targetContentWidth / oursContentSize.width, targetContentHeight / oursContentSize.height)
  );
  const latexScale = 1;

  if (!resizePngByScale(oursTrimmedPath, oursComparablePath, oursScale, tools)) {
    return { ok: false, error: "Failed to resize renderer PNG to normalized comparison scale." };
  }
  if (!resizePngByScale(latexTrimmedPath, latexComparablePath, latexScale, tools)) {
    return { ok: false, error: "Failed to resize reference PNG to normalized comparison scale." };
  }

  const oursScaledSize = identifyPngSize(oursComparablePath, tools);
  const latexScaledSize = identifyPngSize(latexComparablePath, tools);
  if (!oursScaledSize || !latexScaledSize) {
    return { ok: false, error: "Failed to read scaled dimensions for comparison assets." };
  }

  if (!makeSideBySidePng(oursComparablePath, latexComparablePath, sideBySidePath, tools)) {
    return { ok: false, error: "Failed to build side-by-side comparison PNG." };
  }

  return {
    ok: true,
    outputs: {
      oursWhitePng: oursWhitePath,
      latexWhitePng: latexWhitePath,
      oursComparablePng: oursComparablePath,
      latexComparablePng: latexComparablePath,
      sideBySidePng: sideBySidePath
    },
    metadata: {
      trimFuzz: COMPARISON_TRIM_FUZZ,
      rendererContent: oursContentSize,
      rendererContentBeforeReraster: initialRendererContentSize,
      referenceContent: latexContentSize,
      rendererScaleApplied: oursScale,
      referenceScaleApplied: latexScale,
      rendererRerasterApplied,
      rendererRerasterZoom,
      comparableSize: {
        renderer: oursScaledSize,
        reference: latexScaledSize
      }
    }
  };
}

function flattenPngOnWhite(inputPath, outputPath, tools) {
  if (!tools.magick) {
    return false;
  }
  const result = runCommand("magick", [inputPath, "-background", "white", "-alpha", "remove", "-alpha", "off", outputPath]);
  return result.ok && existsSync(outputPath);
}

function identifyPngSize(pngPath, tools) {
  if (!tools.magick) {
    return null;
  }

  const identified = runCommand("magick", ["identify", "-format", "%w %h", pngPath]);
  if (!identified.ok) {
    return null;
  }

  const [widthRaw, heightRaw] = identified.stdout.trim().split(/\s+/);
  const width = Number.parseInt(widthRaw ?? "", 10);
  const height = Number.parseInt(heightRaw ?? "", 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
}

function trimPngContent(inputPath, outputPath, fuzz, tools) {
  if (!tools.magick) {
    return false;
  }

  const result = runCommand("magick", [
    inputPath,
    "-alpha",
    "off",
    "-fuzz",
    fuzz,
    "-trim",
    "+repage",
    outputPath
  ]);
  return result.ok && existsSync(outputPath);
}

function resizePngByScale(inputPath, outputPath, scale, tools) {
  if (!tools.magick) {
    return false;
  }

  const percentage = (scale * 100).toFixed(4);
  const resizeFilter = scale >= 1 ? "point" : "Lanczos";
  const result = runCommand("magick", [inputPath, "-filter", resizeFilter, "-resize", `${percentage}%`, outputPath]);
  return result.ok && existsSync(outputPath);
}

function normalizeScaleFactor(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  const MAX_SCALE = 32;
  const MIN_SCALE = 1 / 32;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function makeSideBySidePng(leftPath, rightPath, outputPath, tools) {
  if (!tools.magick) {
    return false;
  }
  const result = runCommand("magick", [leftPath, rightPath, "-background", "white", "+append", outputPath]);
  return result.ok && existsSync(outputPath);
}

function convertDviToSvg(dviPath, svgPath, tools) {
  if (!tools.dvisvgm) {
    return {
      ok: false,
      error: "dvisvgm command not found."
    };
  }

  const result = runCommand("dvisvgm", ["--page=1", "--bbox=min", "--exact", "-o", svgPath, dviPath]);
  if (!result.ok) {
    return {
      ok: false,
      error: `dvisvgm failed with exit code ${result.status}. ${tail((result.stdout ?? "") + "\n" + (result.stderr ?? ""), 40)}`
    };
  }

  if (!existsSync(svgPath)) {
    return {
      ok: false,
      error: "dvisvgm completed but SVG was not produced."
    };
  }

  return {
    ok: true,
    converter: "dvisvgm"
  };
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8"
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function commandExists(command) {
  const check = spawnSync("sh", ["-lc", `command -v ${command}`], { encoding: "utf8" });
  return check.status === 0;
}

function sanitizeName(input) {
  return input.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "tikz";
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function hashCode(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function tail(input, maxLines) {
  const lines = input.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
}

function normalizeReferenceMode(value) {
  const mode = value || DEFAULT_REFERENCE_MODE;
  if (!REFERENCE_MODES.has(mode)) {
    throw new Error(`Invalid --reference-mode value: ${value}. Expected one of: ${[...REFERENCE_MODES].join(", ")}.`);
  }
  return mode;
}

function throwWithReport(message, reportPath, runDir, report) {
  report.error = message;
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  throw new RendererComparisonError(message, { reportPath, runDir, report });
}

function isMain(metaUrl) {
  if (!process.argv[1]) {
    return false;
  }
  return pathToFileURL(resolve(process.argv[1])).href === metaUrl;
}
