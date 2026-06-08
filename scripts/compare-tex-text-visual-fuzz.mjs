#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distEntry = join(repoRoot, "packages/core/dist/text/tex/index.js");
const parseLengthEntry = join(repoRoot, "packages/core/dist/semantic/coords/parse-length.js");
const defaultOutDir = join(repoRoot, "artifacts", "tex-text-visual-fuzz");
const defaultCacheDir = join(repoRoot, "artifacts", "tex-text-visual-fuzz-cache");
const defaultSeed = 20260608;
const defaultCases = 32;
const defaultScale = 8;
const defaultThresholdRatio = 1.5;
const defaultGlyphDxTolerance = 1.5;
const defaultGlyphDyTolerance = 0.25;
const defaultTextFontSize = 9.96264;
const lineHeightPt = defaultTextFontSize * 1.2;
const firstLineAscentPt = defaultTextFontSize * 0.7;

const alignments = [
  { label: "left", layout: "ragged-right", tikz: "left" },
  { label: "right", layout: "ragged-left", tikz: "right" },
  { label: "center", layout: "center", tikz: "center" },
  { label: "justify", layout: "justified", tikz: "justify" },
];

const words = [
  "alpha", "beta", "gamma", "delta", "epsilon", "office", "affinity", "efficient",
  "lattice", "chapter", "reader", "layout", "baseline", "sentence", "paragraph",
  "hyphenation", "computer", "modern", "vector", "editor", "figure", "semantic",
  "rendering", "alignment", "precise", "manual", "paper", "method", "result",
  "careful", "default", "metric", "source", "canvas", "anchor", "compact",
  "visible", "screen", "document", "natural", "language", "pattern", "position",
  "stable", "quoted", "sample", "actual", "kernel", "model", "spacing",
  "analysis", "direct", "local", "shape", "table", "nested", "option",
  "single", "double", "final", "initial", "logic", "classic", "control",
  "future", "basic", "normal", "narrow", "wide", "faithful", "output",
];

function usage() {
  return `
Usage:
  node scripts/compare-tex-text-visual-fuzz.mjs [--cases 32] [--seed 20260608] [--scale 8]

Options:
  --cases <n>             Number of fuzz cases. Default: ${defaultCases}.
  --seed <n>              Deterministic fuzz seed. Default: ${defaultSeed}.
  --scale <px-per-pt>     Raster scale. Default: ${defaultScale}.
  --out-dir <dir>         Artifact root. Default: artifacts/tex-text-visual-fuzz.
  --cache-dir <dir>       TeX oracle cache root. Default: artifacts/tex-text-visual-fuzz-cache.
  --no-cache              Disable the TeX oracle cache for this run.
  --refresh-cache         Rebuild TeX oracle entries even if cached artifacts exist.
  --threshold-ratio <n>   Flag ours-vs-TeX AE above n times TeX-vs-TeX AE. Default: ${defaultThresholdRatio}.
  --glyph-dx-tolerance <pt>
                          Max line-normalized glyph x delta for structural pass. Default: ${defaultGlyphDxTolerance}.
  --glyph-dy-tolerance <pt>
                          Max glyph baseline y delta for structural pass. Default: ${defaultGlyphDyTolerance}.
  --help                  Show this message.
`.trim();
}

function parseArgs(argv) {
  const options = {
    cases: defaultCases,
    seed: defaultSeed,
    scale: defaultScale,
    outDir: defaultOutDir,
    cacheDir: defaultCacheDir,
    cache: true,
    refreshCache: false,
    thresholdRatio: defaultThresholdRatio,
    glyphDxTolerance: defaultGlyphDxTolerance,
    glyphDyTolerance: defaultGlyphDyTolerance,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--cases" && next != null) {
      options.cases = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--seed" && next != null) {
      options.seed = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--scale" && next != null) {
      options.scale = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--out-dir" && next != null) {
      options.outDir = resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--cache-dir" && next != null) {
      options.cacheDir = resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--no-cache") {
      options.cache = false;
      continue;
    }
    if (arg === "--refresh-cache") {
      options.refreshCache = true;
      continue;
    }
    if (arg === "--threshold-ratio" && next != null) {
      options.thresholdRatio = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--glyph-dx-tolerance" && next != null) {
      options.glyphDxTolerance = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--glyph-dy-tolerance" && next != null) {
      options.glyphDyTolerance = Number(next);
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  if (!Number.isInteger(options.cases) || options.cases <= 0) {
    throw new Error("--cases must be a positive integer.");
  }
  if (!Number.isInteger(options.seed)) {
    throw new Error("--seed must be an integer.");
  }
  if (!Number.isFinite(options.scale) || options.scale <= 0) {
    throw new Error("--scale must be positive.");
  }
  if (!Number.isFinite(options.thresholdRatio) || options.thresholdRatio <= 0) {
    throw new Error("--threshold-ratio must be positive.");
  }
  if (!Number.isFinite(options.glyphDxTolerance) || options.glyphDxTolerance < 0) {
    throw new Error("--glyph-dx-tolerance must be non-negative.");
  }
  if (!Number.isFinite(options.glyphDyTolerance) || options.glyphDyTolerance < 0) {
    throw new Error("--glyph-dy-tolerance must be non-negative.");
  }
  return options;
}

function commandExists(command) {
  const result = spawnSync("which", [command], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function requireCommands(commands) {
  const missing = commands.filter((command) => !commandExists(command));
  if (missing.length > 0) {
    throw new Error(`Missing required commands: ${missing.join(", ")}`);
  }
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function choice(random, values) {
  return values[Math.floor(random() * values.length)] ?? values[0];
}

function sentence(random, minWords, maxWords) {
  const count = minWords + Math.floor(random() * (maxWords - minWords + 1));
  const parts = [];
  for (let index = 0; index < count; index += 1) {
    let word = choice(random, words);
    if (index === 0) {
      word = word[0].toUpperCase() + word.slice(1);
    }
    if (index > 1 && random() < 0.12) {
      word += ",";
    }
    parts.push(word);
  }
  return `${parts.join(" ")}.`;
}

function paragraph(random, sentenceCount) {
  return Array.from({ length: sentenceCount }, () => sentence(random, 5, 12)).join(" ");
}

function generateCase(index, random) {
  const alignment = alignments[index % alignments.length];
  const widths = [80, 100, 120, 150, 200, 240, 320];
  const width = choice(random, widths);
  const parindent = choice(random, [0, 10, 15]);
  const feature = index % 6;
  let text;
  if (feature === 0) {
    text = paragraph(random, 2 + Math.floor(random() * 3));
  } else if (feature === 1) {
    text = `${paragraph(random, 1 + Math.floor(random() * 2))} \\par ${paragraph(random, 1 + Math.floor(random() * 2))}`;
  } else if (feature === 2) {
    text = `${paragraph(random, 1)} \\par \\noindent ${paragraph(random, 2)}`;
  } else if (feature === 3) {
    text = `${sentence(random, 5, 9)} \\\\[${choice(random, [4, 7, 10])}pt] ${paragraph(random, 2)}`;
  } else if (feature === 4) {
    text = `${paragraph(random, 1)} \\par \\noindent ${sentence(random, 4, 8)} \\\\[7pt] ${paragraph(random, 1)}`;
  } else {
    const declaration = choice(random, ["\\raggedright", "\\centering", "\\raggedleft"]);
    text = `${paragraph(random, 1)} \\par ${declaration} ${paragraph(random, 1 + Math.floor(random() * 2))}`;
  }
  return {
    id: `case-${String(index + 1).padStart(3, "0")}`,
    feature: ["plain", "multi-par", "noindent", "forced-break", "mixed", "declaration"][feature],
    text,
    width,
    parindent,
    alignment,
  };
}

function formatPt(value) {
  return Number(value.toFixed(6)).toString();
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderGlyphRun(text, font, x, baseline, computerModernTexMetricProvider) {
  const shaped = computerModernTexMetricProvider.shapeText(text, font);
  const pieces = [];
  let cursor = x;
  for (const item of shaped.items) {
    if (item.kind === "kern") {
      cursor += item.width;
      continue;
    }
    const path = font.data.glyphs?.[String(item.code)] ?? "";
    if (path && item.code !== 32) {
      pieces.push(
        `<path d="${escapeXml(path)}" transform="translate(${formatPt(cursor)} ${formatPt(baseline)})" />`
      );
    }
    cursor += item.width;
  }
  return pieces.join("");
}

function lineLeadingPt(lineLeading, parseLength) {
  return lineLeading ? parseLength(lineLeading, "pt") ?? 0 : 0;
}

function computeLineTops(report, parseLength) {
  const tops = [];
  let cursor = 0;
  for (const line of report.lines) {
    tops[line.lineIndex] = cursor;
    cursor += lineHeightPt + lineLeadingPt(line.break?.lineLeading, parseLength);
  }
  return tops;
}

function reportLineText(line) {
  return line.segments.map((segment) => segment.text ?? "").join("").trimEnd();
}

function renderOursSvg(caseData, layout, pageWidth, pageHeight, deps) {
  const font = deps.computerModernTexMetricProvider.resolveFont({ atPt: defaultTextFontSize });
  const lineTops = computeLineTops(layout.report, deps.parseLength);
  const pieces = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatPt(pageWidth)}pt" height="${formatPt(pageHeight)}pt" viewBox="0 0 ${formatPt(pageWidth)} ${formatPt(pageHeight)}">`,
    `<rect x="0" y="0" width="${formatPt(pageWidth)}" height="${formatPt(pageHeight)}" fill="white" />`,
    `<g fill="black">`,
  ];
  for (const line of layout.report.lines) {
    const top = lineTops[line.lineIndex] ?? 0;
    const left = Number.isFinite(line.xStart) ? line.xStart : 0;
    pieces.push(`<g transform="translate(${formatPt(left)} ${formatPt(top)})">`);
    for (const segment of line.segments) {
      if (segment.kind !== "text") {
        continue;
      }
      pieces.push(
        renderGlyphRun(
          segment.text ?? "",
          font,
          segment.x - left,
          firstLineAscentPt,
          deps.computerModernTexMetricProvider
        )
      );
    }
    pieces.push("</g>");
  }
  pieces.push("</g></svg>");
  return pieces.join("");
}

function buildOursTrace(layout, deps) {
  const font = deps.computerModernTexMetricProvider.resolveFont({ atPt: defaultTextFontSize });
  const lineTops = computeLineTops(layout.report, deps.parseLength);
  return {
    lines: layout.report.lines.map((line) => {
      const baselineY = (lineTops[line.lineIndex] ?? 0) + firstLineAscentPt;
      const glyphs = [];
      for (const segment of line.segments) {
        if (segment.kind !== "text") {
          continue;
        }
        const shaped = deps.computerModernTexMetricProvider.shapeText(segment.text ?? "", font);
        let cursor = segment.x;
        for (const item of shaped.items) {
          if (item.kind === "kern") {
            cursor += item.width;
            continue;
          }
          if (item.code !== 32) {
            glyphs.push({
              code: item.code,
              x: Number(cursor.toFixed(6)),
              y: Number(baselineY.toFixed(6)),
              width: Number(item.width.toFixed(6)),
            });
          }
          cursor += item.width;
        }
      }
      return {
        text: reportLineText(line),
        width: line.width,
        baselineY,
        glyphs,
      };
    }),
  };
}

function texGlyphText(code) {
  switch (code) {
    case 11:
      return "ff";
    case 12:
      return "fi";
    case 13:
      return "fl";
    case 14:
      return "ffi";
    case 15:
      return "ffl";
    default:
      return code >= 0 ? String.fromCodePoint(code) : "?";
  }
}

function buildTexSvgTrace(svg, oursTrace) {
  const rowsByY = new Map();
  const usePattern = /<use\b[^>]*\bx=['"]([^'"]+)['"][^>]*\by=['"]([^'"]+)['"][^>]*\bxlink:href=['"]#g0-(\d+)['"]/g;
  for (const match of svg.matchAll(usePattern)) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    const glyphId = `g0-${match[3]}`;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    const key = y.toFixed(6);
    const row = rowsByY.get(key) ?? { sourceY: y, glyphs: [] };
    row.glyphs.push({ glyphId, code: -1, x, y, width: 0 });
    rowsByY.set(key, row);
  }

  const rows = [...rowsByY.values()].sort((left, right) => left.sourceY - right.sourceY);
  for (const row of rows) {
    row.glyphs.sort((left, right) => left.x - right.x);
  }
  const texGlyphs = rows.flatMap((row) => row.glyphs);
  const oursGlyphs = oursTrace.lines.flatMap((line) => line.glyphs);
  const glyphIdToCode = new Map();
  const pairCount = Math.min(texGlyphs.length, oursGlyphs.length);
  for (let index = 0; index < pairCount; index += 1) {
    const texGlyph = texGlyphs[index];
    const oursGlyph = oursGlyphs[index];
    if (!glyphIdToCode.has(texGlyph.glyphId)) {
      glyphIdToCode.set(texGlyph.glyphId, oursGlyph.code);
    }
  }
  for (const glyph of texGlyphs) {
    glyph.code = glyphIdToCode.get(glyph.glyphId) ?? -1;
  }

  const firstTexY = rows[0]?.sourceY ?? 0;
  const firstOursY = oursTrace.lines[0]?.glyphs[0]?.y ?? 0;
  return {
    lines: rows.map((row) => {
      const normalizedY = row.sourceY - firstTexY + firstOursY;
      return {
        text: row.glyphs.map((glyph) => texGlyphText(glyph.code)).join(""),
        width: row.glyphs.length > 0
          ? row.glyphs.at(-1).x - row.glyphs[0].x
          : 0,
        baselineY: normalizedY,
        glyphs: row.glyphs.map((glyph) => ({
          ...glyph,
          y: normalizedY,
        })),
      };
    }),
  };
}

function parseEscapedTraceText(value) {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = value[index + 1];
    index += 1;
    if (next === "t") {
      out += "\t";
    } else if (next === "r") {
      out += "\r";
    } else if (next === "n") {
      out += "\n";
    } else if (next === "\\") {
      out += "\\";
    } else if (next) {
      out += next;
    }
  }
  return out;
}

function parseTexGlyphTrace(tsv) {
  const lines = [];
  for (const rawLine of tsv.split(/\r?\n/)) {
    if (!rawLine) {
      continue;
    }
    const parts = rawLine.split("\t");
    if (parts[0] === "LINE") {
      const lineIndex = Number(parts[1]) - 1;
      lines[lineIndex] = {
        text: parseEscapedTraceText(parts[5] ?? ""),
        width: Number(parts[2]),
        baselineY: Number(parts[3]),
        badness: Number(parts[4]),
        glyphs: [],
      };
    } else if (parts[0] === "GLYPH") {
      const lineIndex = Number(parts[1]) - 1;
      const line = lines[lineIndex];
      if (!line) {
        continue;
      }
      line.glyphs.push({
        code: Number(parts[2]),
        x: Number(parts[3]),
        y: Number(parts[4]),
        width: Number(parts[5]),
      });
    }
  }
  return { lines: lines.filter(Boolean) };
}

function runTexGlyphTrace(caseData, caseDir) {
  const traceTexPath = join(caseDir, "trace.tex");
  const traceLuaPath = join(caseDir, "trace.lua");
  const traceOutputPath = join(caseDir, "tex-glyph-trace.tsv");
  writeFileSync(traceTexPath, buildTexTraceDocument(caseData), "utf8");
  writeFileSync(traceLuaPath, texTraceLuaSource(), "utf8");
  execFileSync("lualatex", ["--interaction=nonstopmode", "--halt-on-error", traceTexPath], {
    cwd: caseDir,
    env: {
      ...process.env,
      TEXMFVAR: process.env.TEXMFVAR ?? "/private/tmp",
      TEXMFCACHE: process.env.TEXMFCACHE ?? "/private/tmp",
    },
    maxBuffer: 20 * 1024 * 1024,
    stdio: "ignore",
  });
  return parseTexGlyphTrace(readFileSync(traceOutputPath, "utf8"));
}

function compareGlyphTraces(oursTrace, texTrace) {
  const lineGlyphText = (line) => line.glyphs.map((glyph) => texGlyphText(glyph.code)).join("");
  const oursLines = oursTrace.lines.map(lineGlyphText);
  const texLines = texTrace.lines.map(lineGlyphText);
  const lineTextMatch = JSON.stringify(oursLines) === JSON.stringify(texLines);
  let glyphCodeMatch = oursTrace.lines.length === texTrace.lines.length;
  let maxGlyphDx = 0;
  let maxGlyphDy = 0;
  let comparedGlyphs = 0;

  const lineCount = Math.min(oursTrace.lines.length, texTrace.lines.length);
  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const oursLine = oursTrace.lines[lineIndex];
    const texLine = texTrace.lines[lineIndex];
    const oursOriginX = oursLine.glyphs[0]?.x ?? 0;
    const texOriginX = texLine.glyphs[0]?.x ?? 0;
    if (oursLine.glyphs.length !== texLine.glyphs.length) {
      glyphCodeMatch = false;
    }
    const glyphCount = Math.min(oursLine.glyphs.length, texLine.glyphs.length);
    for (let glyphIndex = 0; glyphIndex < glyphCount; glyphIndex += 1) {
      const oursGlyph = oursLine.glyphs[glyphIndex];
      const texGlyph = texLine.glyphs[glyphIndex];
      if (oursGlyph.code !== texGlyph.code) {
        glyphCodeMatch = false;
      }
      const oursRelativeX = oursGlyph.x - oursOriginX;
      const texRelativeX = texGlyph.x - texOriginX;
      maxGlyphDx = Math.max(maxGlyphDx, Math.abs(oursRelativeX - texRelativeX));
      maxGlyphDy = Math.max(maxGlyphDy, Math.abs(oursGlyph.y - texGlyph.y));
      comparedGlyphs += 1;
    }
  }

  return {
    lineTextMatch,
    glyphCodeMatch,
    maxGlyphDx: Number(maxGlyphDx.toFixed(6)),
    maxGlyphDy: Number(maxGlyphDy.toFixed(6)),
    comparedGlyphs,
    oursLines,
    texLines,
  };
}

function buildTexDocument(caseData, pageWidth, pageHeight) {
  return String.raw`\documentclass{article}
\usepackage[paperwidth=${formatPt(pageWidth)}pt,paperheight=${formatPt(pageHeight)}pt,margin=0pt]{geometry}
\usepackage{tikz}
\pagestyle{empty}
\begin{document}
\font\test=cmr10 at 10pt\test
\noindent\begin{tikzpicture}[x=1pt,y=1pt]
\node[text width=${formatPt(caseData.width)}pt, align=${caseData.alignment.tikz}, inner sep=0pt, outer sep=0pt, anchor=north west, execute at begin node={\parindent=${formatPt(caseData.parindent)}pt\test}] at (0,0) {${caseData.text}};
\end{tikzpicture}
\end{document}
`;
}

function texOracleCacheKey(caseData, pageWidth, pageHeight) {
  return createHash("sha256")
    .update(JSON.stringify({
      version: 1,
      text: caseData.text,
      width: caseData.width,
      parindent: caseData.parindent,
      alignment: caseData.alignment.tikz,
      pageWidth,
      pageHeight,
    }))
    .digest("hex")
    .slice(0, 24);
}

function runTexOracle(texPath, pdfPath, texPdfToCairoSvgPath, texDvisvgmSvgPath, caseDir) {
  execFileSync("lualatex", ["--interaction=nonstopmode", "--halt-on-error", texPath], {
    cwd: caseDir,
    env: {
      ...process.env,
      TEXMFVAR: process.env.TEXMFVAR ?? "/private/tmp",
      TEXMFCACHE: process.env.TEXMFCACHE ?? "/private/tmp",
    },
    maxBuffer: 20 * 1024 * 1024,
    stdio: "ignore",
  });
  execFileSync("pdftocairo", ["-svg", pdfPath, texPdfToCairoSvgPath], {
    cwd: caseDir,
    stdio: "ignore",
  });
  execFileSync("dvisvgm", ["--pdf", pdfPath, "-n", "-o", texDvisvgmSvgPath], {
    cwd: caseDir,
    stdio: "ignore",
  });
}

function copyTexOracleArtifacts(from, to) {
  copyFileSync(from.texPath, to.texPath);
  copyFileSync(from.pdfPath, to.pdfPath);
  copyFileSync(from.texPdfToCairoSvgPath, to.texPdfToCairoSvgPath);
  copyFileSync(from.texDvisvgmSvgPath, to.texDvisvgmSvgPath);
}

function ensureTexOracle(caseData, pageWidth, pageHeight, paths, options) {
  const texSource = buildTexDocument(caseData, pageWidth, pageHeight);
  if (!options.cache) {
    writeFileSync(paths.texPath, texSource, "utf8");
    runTexOracle(
      paths.texPath,
      paths.pdfPath,
      paths.texPdfToCairoSvgPath,
      paths.texDvisvgmSvgPath,
      paths.caseDir
    );
    return { status: "bypassed", key: null };
  }

  const key = texOracleCacheKey(caseData, pageWidth, pageHeight);
  const cacheDir = join(options.cacheDir, key);
  const cachedPaths = {
    texPath: join(cacheDir, "case.tex"),
    pdfPath: join(cacheDir, "case.pdf"),
    texPdfToCairoSvgPath: join(cacheDir, "tex-pdftocairo.svg"),
    texDvisvgmSvgPath: join(cacheDir, "tex-dvisvgm.svg"),
  };
  const cacheComplete =
    existsSync(cachedPaths.texPath) &&
    existsSync(cachedPaths.pdfPath) &&
    existsSync(cachedPaths.texPdfToCairoSvgPath) &&
    existsSync(cachedPaths.texDvisvgmSvgPath);

  if (cacheComplete && !options.refreshCache) {
    copyTexOracleArtifacts(cachedPaths, paths);
    return { status: "hit", key };
  }

  writeFileSync(paths.texPath, texSource, "utf8");
  runTexOracle(
    paths.texPath,
    paths.pdfPath,
    paths.texPdfToCairoSvgPath,
    paths.texDvisvgmSvgPath,
    paths.caseDir
  );
  mkdirSync(cacheDir, { recursive: true });
  copyTexOracleArtifacts(paths, cachedPaths);
  return { status: "miss", key };
}

function buildTexTraceDocument(caseData) {
  return String.raw`\documentclass{article}
\usepackage{tikz}
\pagestyle{empty}
\makeatletter
\begin{document}
\font\test=cmr10 at 10pt\test
\newbox\tracebox
\setbox\tracebox=\vbox{%
\hsize=${formatPt(caseData.width)}pt
\pretolerance=100
\tolerance=9999
\emergencystretch=30pt
\parindent=${formatPt(caseData.parindent)}pt
\test
${texTraceAlignmentSetup(caseData.alignment.label)}
\noindent%
${caseData.text}\par
}
\directlua{dofile("trace.lua")}
\end{document}
`;
}

function texTraceAlignmentSetup(alignment) {
  switch (alignment) {
    case "right":
      return String.raw`\pgfutil@raggedleft\leftskip0pt plus2em \spaceskip.3333em \xspaceskip.5em\relax`;
    case "center":
      return String.raw`\leftskip0pt plus2em \rightskip0pt plus2em \spaceskip.3333em \xspaceskip.5em \parfillskip=0pt \hbadness10000\relax`;
    case "justify":
      return String.raw`\leftskip0pt\rightskip0pt\relax`;
    case "left":
    default:
      return String.raw`\pgfutil@raggedright\rightskip0pt plus2em \spaceskip.3333em \xspaceskip.5em\relax`;
  }
}

function texTraceLuaSource() {
  return String.raw`local out = assert(io.open("tex-glyph-trace.tsv", "w"))
local function pt(value)
  return (value or 0) / 65536
end
local function glyph_text(char)
  if char == 11 then return "ff"
  elseif char == 12 then return "fi"
  elseif char == 13 then return "fl"
  elseif char == 14 then return "ffi"
  elseif char == 15 then return "ffl"
  else return utf8.char(char) end
end
local function escape_text(value)
  return string.gsub(value, "[\t\r\n\\]", function(char)
    if char == "\t" then return "\\t" end
    if char == "\r" then return "\\r" end
    if char == "\n" then return "\\n" end
    return "\\\\"
  end)
end
local function glue_width(node_value, parent)
  local width = node_value.width or 0
  if not parent then return width end
  local sign = parent.glue_sign or 0
  local order = parent.glue_order or 0
  local set = parent.glue_set or 0
  if sign == 1 and order == (node_value.stretch_order or 0) then
    width = width + set * (node_value.stretch or 0)
  elseif sign == 2 and order == (node_value.shrink_order or 0) then
    width = width - set * (node_value.shrink or 0)
  end
  return width
end
local function disc_is_line_end(disc)
  local current = disc.next
  while current do
    local kind = node.type(current.id)
    if kind == "glyph" or kind == "hlist" or kind == "vlist" or kind == "rule" then
      return false
    elseif kind == "glue" and (current.width or 0) ~= 0 then
      return false
    elseif kind == "kern" and (current.kern or 0) ~= 0 then
      return false
    end
    current = current.next
  end
  return true
end
local append_node_list
local append_hlist
function append_node_list(parts, glyphs, list, parent, cursor, baseline)
  local x = cursor
  if not list then return x end
  for child in node.traverse(list) do
    local kind = node.type(child.id)
    if kind == "glyph" then
      table.insert(parts, glyph_text(child.char))
      table.insert(glyphs, { char = child.char, x = x, y = baseline, width = child.width or 0 })
      x = x + (child.width or 0)
    elseif kind == "glue" then
      if #parts > 0 then table.insert(parts, " ") end
      x = x + glue_width(child, parent)
    elseif kind == "kern" then
      x = x + (child.kern or 0)
    elseif kind == "disc" then
      if disc_is_line_end(child) then
        x = append_node_list(parts, glyphs, child.pre, nil, x, baseline)
      else
        x = append_node_list(parts, glyphs, child.replace, nil, x, baseline)
      end
    elseif kind == "hlist" then
      x = append_hlist(parts, glyphs, child, x, baseline)
    end
  end
  return x
end
function append_hlist(parts, glyphs, hlist, cursor, baseline)
  append_node_list(parts, glyphs, hlist.list, hlist, cursor, baseline)
  return cursor + (hlist.width or 0)
end
local function collect_line(line, baseline)
  local glyphs = {}
  local parts = {}
  append_node_list(parts, glyphs, line.list, line, 0, baseline)
  return table.concat(parts):gsub("%s+$", ""), glyphs
end
local line_index = 0
local y = 0
for child in node.traverse(tex.box.tracebox.list) do
  local kind = node.type(child.id)
  if kind == "hlist" then
    line_index = line_index + 1
    local baseline = y + (child.height or 0)
    local text, glyphs = collect_line(child, baseline)
    out:write(string.format("LINE\t%d\t%.6f\t%.6f\t%d\t%s\n", line_index, pt(child.width), pt(baseline), child.badness or -1, escape_text(text)))
    for _, glyph in ipairs(glyphs) do
      out:write(string.format("GLYPH\t%d\t%d\t%.6f\t%.6f\t%.6f\n", line_index, glyph.char, pt(glyph.x), pt(glyph.y), pt(glyph.width)))
    end
    y = y + (child.height or 0) + (child.depth or 0)
  elseif kind == "glue" then
    y = y + (child.width or 0)
  elseif kind == "kern" then
    y = y + (child.kern or 0)
  end
end
out:close()
`;
}

function extractSvgRows(svg) {
  const rows = new Map();
  const usePattern = /<use\b[^>]*\bx="([^"]+)"[^>]*\by="([^"]+)"/g;
  for (const match of svg.matchAll(usePattern)) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    const key = y.toFixed(3);
    const row = rows.get(key) ?? { y, xStart: x, xEnd: x, glyphCount: 0 };
    row.xStart = Math.min(row.xStart, x);
    row.xEnd = Math.max(row.xEnd, x);
    row.glyphCount += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.y - b.y);
}

function rasterize(svgPath, pngPath, widthPx, heightPx) {
  execFileSync("rsvg-convert", [
    "-w", String(widthPx),
    "-h", String(heightPx),
    "-b", "white",
    "-f", "png",
    "-o", pngPath,
    svgPath,
  ]);
}

function compareMetric(metric, expectedPath, actualPath) {
  const result = spawnSync("magick", ["compare", "-metric", metric, expectedPath, actualPath, "null:"], {
    encoding: "utf8",
  });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`magick compare failed: ${result.stderr || result.stdout}`);
  }
  const raw = `${result.stdout}${result.stderr}`.trim();
  const match = raw.match(/([-+]?\d+(?:\.\d+)?)(?:\s+\(([-+]?\d+(?:\.\d+)?)\))?/);
  if (!match) {
    throw new Error(`Could not parse ${metric} output: ${raw}`);
  }
  return {
    raw,
    value: Number(match[1]),
    normalized: match[2] === undefined ? null : Number(match[2]),
  };
}

function writeCsv(rows, path) {
  const headers = [
    "id",
    "feature",
    "alignment",
    "width",
    "parindent",
    "oursLines",
    "texRows",
    "texNoiseAeNorm",
    "oursAeNorm",
    "ratio",
    "texNoiseRmseNorm",
    "oursRmseNorm",
    "lineTextMatch",
    "glyphCodeMatch",
    "maxGlyphDx",
    "maxGlyphDy",
    "texOracleCache",
    "traceFlagged",
    "visualFlagged",
    "flagged",
  ];
  const body = rows.map((row) => headers.map((header) => JSON.stringify(row[header] ?? "")).join(","));
  writeFileSync(path, `${headers.join(",")}\n${body.join("\n")}\n`, "utf8");
}

function aggregateBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = row[key];
    const group = groups.get(value) ?? [];
    group.push(row);
    groups.set(value, group);
  }
  return [...groups.entries()].map(([value, group]) => {
    const ratios = group.map((row) => row.ratio).filter(Number.isFinite);
    const ours = group.map((row) => row.oursAeNorm).filter(Number.isFinite);
    const noise = group.map((row) => row.texNoiseAeNorm).filter(Number.isFinite);
    return {
      [key]: value,
      cases: group.length,
      flagged: group.filter((row) => row.flagged).length,
      meanRatio: mean(ratios),
      maxRatio: Math.max(...ratios),
      meanOursAeNorm: mean(ours),
      meanTexNoiseAeNorm: mean(noise),
    };
  });
}

function mean(values) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!existsSync(distEntry) || !existsSync(parseLengthEntry)) {
    throw new Error("Missing core dist files. Run `npm run -w @tikz-editor/core build` first.");
  }
  requireCommands(["lualatex", "pdftocairo", "dvisvgm", "rsvg-convert", "magick"]);

  const deps = {
    ...(await import(distEntry)),
    ...(await import(parseLengthEntry)),
  };
  const runDir = join(resolve(options.outDir), `seed-${options.seed}-cases-${options.cases}-scale-${options.scale}-${timestampSlug()}`);
  mkdirSync(runDir, { recursive: true });

  const random = mulberry32(options.seed);
  const cases = Array.from({ length: options.cases }, (_, index) => generateCase(index, random));
  const rows = [];
  const errors = [];
  const texOracleCache = {
    hits: 0,
    misses: 0,
    bypassed: 0,
  };

  for (const caseData of cases) {
    const caseDir = join(runDir, caseData.id);
    mkdirSync(caseDir, { recursive: true });
    const layout = deps.layoutSimpleTexParagraph(caseData.text, {
      paragraphId: caseData.id,
      width: caseData.width,
      alignment: caseData.alignment.layout,
      parindent: caseData.parindent,
      tikzTextWidthNode: true,
    });
    if (!layout.supported || !layout.report) {
      errors.push({ id: caseData.id, error: layout.fallbackReason ?? "unsupported" });
      continue;
    }
    const oursTrace = buildOursTrace(layout, deps);

    const lineTops = computeLineTops(layout.report, deps.parseLength);
    const pageWidth = Math.max(360, caseData.width + 20);
    const pageHeight = Math.max(180, (lineTops.at(-1) ?? 0) + lineHeightPt + 20);
    const widthPx = Math.ceil(pageWidth * options.scale);
    const heightPx = Math.ceil(pageHeight * options.scale);
    const texPath = join(caseDir, "case.tex");
    const pdfPath = join(caseDir, "case.pdf");
    const oursSvgPath = join(caseDir, "ours.svg");
    const texPdfToCairoSvgPath = join(caseDir, "tex-pdftocairo.svg");
    const texDvisvgmSvgPath = join(caseDir, "tex-dvisvgm.svg");
    const oursPngPath = join(caseDir, "ours.png");
    const texPdfToCairoPngPath = join(caseDir, "tex-pdftocairo.png");
    const texDvisvgmPngPath = join(caseDir, "tex-dvisvgm.png");
    const texOraclePaths = {
      caseDir,
      texPath,
      pdfPath,
      texPdfToCairoSvgPath,
      texDvisvgmSvgPath,
    };

    writeFileSync(join(caseDir, "input.json"), JSON.stringify({
      ...caseData,
      alignment: caseData.alignment.label,
      oursLines: layout.report.lines.map(reportLineText),
      pageWidth,
      pageHeight,
      scale: options.scale,
    }, null, 2), "utf8");
    writeFileSync(oursSvgPath, renderOursSvg(caseData, layout, pageWidth, pageHeight, deps), "utf8");

    try {
      const oracle = ensureTexOracle(
        caseData,
        pageWidth,
        pageHeight,
        texOraclePaths,
        options
      );
      if (oracle.status === "hit") {
        texOracleCache.hits += 1;
      } else if (oracle.status === "miss") {
        texOracleCache.misses += 1;
      } else {
        texOracleCache.bypassed += 1;
      }
      rasterize(oursSvgPath, oursPngPath, widthPx, heightPx);
      rasterize(texPdfToCairoSvgPath, texPdfToCairoPngPath, widthPx, heightPx);
      rasterize(texDvisvgmSvgPath, texDvisvgmPngPath, widthPx, heightPx);
      const texTrace = buildTexSvgTrace(readFileSync(texDvisvgmSvgPath, "utf8"), oursTrace);
      const traceComparison = compareGlyphTraces(oursTrace, texTrace);
      writeFileSync(join(caseDir, "ours-glyph-trace.json"), JSON.stringify(oursTrace, null, 2), "utf8");
      writeFileSync(join(caseDir, "tex-glyph-trace.json"), JSON.stringify(texTrace, null, 2), "utf8");
      writeFileSync(join(caseDir, "trace-comparison.json"), JSON.stringify(traceComparison, null, 2), "utf8");

      const texNoiseAe = compareMetric("AE", texPdfToCairoPngPath, texDvisvgmPngPath);
      const oursAe = compareMetric("AE", texPdfToCairoPngPath, oursPngPath);
      const texNoiseRmse = compareMetric("RMSE", texPdfToCairoPngPath, texDvisvgmPngPath);
      const oursRmse = compareMetric("RMSE", texPdfToCairoPngPath, oursPngPath);
      const ratio = texNoiseAe.normalized && texNoiseAe.normalized > 0
        ? oursAe.normalized / texNoiseAe.normalized
        : null;
      const texRows = extractSvgRows(readFileSync(texPdfToCairoSvgPath, "utf8"));
      const traceFlagged =
        !traceComparison.lineTextMatch ||
        !traceComparison.glyphCodeMatch ||
        traceComparison.maxGlyphDx > options.glyphDxTolerance ||
        traceComparison.maxGlyphDy > options.glyphDyTolerance;
      const visualFlagged = ratio !== null && ratio > options.thresholdRatio;
      const flagged = traceFlagged;
      if (flagged || visualFlagged) {
        execFileSync("magick", [
          texPdfToCairoPngPath,
          oursPngPath,
          "+append",
          join(caseDir, "side-by-side.png"),
        ]);
        spawnSync("magick", [
          "compare",
          texPdfToCairoPngPath,
          oursPngPath,
          join(caseDir, "diff.png"),
        ]);
      }
      const row = {
        id: caseData.id,
        feature: caseData.feature,
        alignment: caseData.alignment.label,
        width: caseData.width,
        parindent: caseData.parindent,
        oursLines: layout.report.lines.length,
        texRows: texRows.length,
        texNoiseAeNorm: texNoiseAe.normalized,
        oursAeNorm: oursAe.normalized,
        ratio,
        texNoiseRmseNorm: texNoiseRmse.normalized,
        oursRmseNorm: oursRmse.normalized,
        lineTextMatch: traceComparison.lineTextMatch,
        glyphCodeMatch: traceComparison.glyphCodeMatch,
        maxGlyphDx: traceComparison.maxGlyphDx,
        maxGlyphDy: traceComparison.maxGlyphDy,
        texOracleCache: oracle.status,
        traceFlagged,
        visualFlagged,
        flagged,
      };
      rows.push(row);
      console.log(
        `${row.flagged ? "FLAG" : "ok"} ${row.id} ${row.alignment}/${row.feature} ` +
        `lines=${row.oursLines}/${row.texRows} AE=${row.oursAeNorm?.toFixed(4)} ` +
        `noise=${row.texNoiseAeNorm?.toFixed(4)} ratio=${row.ratio?.toFixed(2)} ` +
        `text=${row.lineTextMatch ? "ok" : "diff"} glyphs=${row.glyphCodeMatch ? "ok" : "diff"} ` +
        `cache=${row.texOracleCache}`
      );
    } catch (error) {
      errors.push({ id: caseData.id, error: error instanceof Error ? error.message : String(error) });
      console.error(`ERROR ${caseData.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const summary = {
    runDir,
    seed: options.seed,
    casesRequested: options.cases,
    casesCompleted: rows.length,
    errors,
    thresholdRatio: options.thresholdRatio,
    glyphDxTolerance: options.glyphDxTolerance,
    glyphDyTolerance: options.glyphDyTolerance,
    texOracleCache,
    cacheDir: options.cache ? options.cacheDir : null,
    flagged: rows.filter((row) => row.flagged),
    aggregate: {
      byAlignment: aggregateBy(rows, "alignment"),
      byFeature: aggregateBy(rows, "feature"),
    },
  };
  writeFileSync(join(runDir, "summary.json"), JSON.stringify({ ...summary, rows }, null, 2), "utf8");
  writeCsv(rows, join(runDir, "summary.csv"));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
