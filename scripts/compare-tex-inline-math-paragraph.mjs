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
const cases = args.source !== null
  ? exactCases(args.source, args.widths)
  : fuzzCases.length > 0 ? fuzzCases : fixedCases(args.widths);
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
      oursMathGlyphCount: result.ours.mathGlyphs?.length,
      texMathGlyphCount: result.tex.mathGlyphs?.length,
    })),
  }, null, 2));
} else {
  console.log(JSON.stringify({ results }, null, 2));
}

if (failed.length > 0) {
  process.exitCode = 1;
}

function compareCase(caseSpec, options) {
  const ours = ourTrace(caseSpec);
  let tex;
  try {
    tex = texTrace(caseSpec, options);
  } catch (error) {
    const details = oracleErrorDetails(error);
    return {
      ...caseSpec,
      ok: false,
      mismatches: [`TeX oracle failed: ${error instanceof Error ? error.message : String(error)}${details}`],
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
  if (options.compareGlyphs) {
    compareMathGlyphs(mismatches, ours.mathGlyphs, tex.mathGlyphs, options.glyphTolerance);
  }
  return {
    ...caseSpec,
    ok: mismatches.length === 0,
    mismatches,
    ours,
    tex,
  };
}

function oracleErrorDetails(error) {
  if (!error || typeof error !== "object") {
    return "";
  }
  const stdout = "stdout" in error ? String(error.stdout ?? "") : "";
  const stderr = "stderr" in error ? String(error.stderr ?? "") : "";
  const details = `${stdout}\n${stderr}`.trim();
  return details ? `\n${tail(details, 1600)}` : "";
}

function tail(value, maxLength) {
  return value.length <= maxLength ? value : value.slice(value.length - maxLength);
}

function ourTrace(caseSpec) {
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
      mathGlyphs: [],
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
    mathGlyphs: ourMathGlyphTrace(result.report.lines),
  };
}

function ourMathGlyphTrace(lines) {
  const glyphs = [];
  for (const [lineIndex, line] of lines.entries()) {
    for (const segment of line.segments) {
      if (segment.kind !== "math" || !segment.mathSvgBody) {
        continue;
      }
      glyphs.push(...glyphsFromMathSvgBody(
        segment.mathSvgBody,
        segment.x,
        0,
        lineIndex
      ));
    }
  }
  return glyphs;
}

function glyphsFromMathSvgBody(svgBody, originX, baselineY, lineIndex) {
  const fragmentViewBox = readFragmentViewBox(svgBody);
  const fragmentBoundaryTolerance = 1e-5;
  const glyphs = [];
  const pathPattern = /<path\b[^>]*>/g;
  for (const match of svgBody.matchAll(pathPattern)) {
    const tag = match[0];
    const fontId = readSvgAttribute(tag, "data-tex-font");
    const code = Number(readSvgAttribute(tag, "data-tex-glyph"));
    const transform = readSvgAttribute(tag, "transform") ?? "";
    const translate = /translate\(([-0-9.]+)\s+([-0-9.]+)\)/.exec(transform);
    if (!fontId || !Number.isFinite(code) || !translate) {
      continue;
    }
    const rawX = Number(translate[1]) / 100;
    if (
      fragmentViewBox &&
      (
        rawX < fragmentViewBox.xStart - fragmentBoundaryTolerance ||
        rawX >= fragmentViewBox.xEnd - fragmentBoundaryTolerance
      )
    ) {
      continue;
    }
    glyphs.push({
      lineIndex,
      x: round(originX + rawX - (fragmentViewBox?.xStart ?? 0)),
      y: round(baselineY + Number(translate[2]) / 100),
      fontId,
      code,
    });
  }
  return glyphs;
}

function readFragmentViewBox(svgBody) {
  const fragment = /<svg\b[^>]*\bdata-tex-math-fragment="true"[^>]*>/u.exec(svgBody)?.[0];
  if (!fragment) {
    return null;
  }
  const viewBox = readSvgAttribute(fragment, "viewBox");
  if (!viewBox) {
    return null;
  }
  const [rawX, , rawWidth] = viewBox.trim().split(/\s+/u).map((value) => Number(value));
  if (!Number.isFinite(rawX) || !Number.isFinite(rawWidth)) {
    return null;
  }
  const xStart = rawX / 100;
  return {
    xStart,
    xEnd: xStart + rawWidth / 100,
  };
}

function readSvgAttribute(tag, name) {
  const pattern = new RegExp(`${name}="([^"]*)"`);
  return pattern.exec(tag)?.[1];
}

function texTrace(caseSpec, options) {
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
  const mathGlyphs = output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("TMG "))
    .map(parseMathGlyphTraceLine)
    .filter((glyph) => glyph !== null);
  const result = { lines, mathGlyphs };
  if (cachePath) {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(result, null, 2), "utf8");
  }
  return result;
}

function parseMathGlyphTraceLine(line) {
  const match = /^TMG line=(?<line>\d+) x=(?<x>[-.\d]+) y=(?<y>[-.\d]+) f=(?<font>\S+) c=(?<char>\d+)/u.exec(line);
  if (!match?.groups) {
    return null;
  }
  return {
    lineIndex: Number(match.groups.line),
    x: round(Number(match.groups.x)),
    y: round(Number(match.groups.y)),
    fontId: match.groups.font,
    code: Number(match.groups.char),
  };
}

function latexOracleSource(caseSpec) {
  return String.raw`\documentclass{article}
\begin{document}
\fontencoding{TU}\fontfamily{lmr}\selectfont
\language=-1
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

local glyph_id=node.id('glyph')
local glue_id=node.id('glue')
local kern_id=node.id('kern')
local hlist_id=node.id('hlist')
local vlist_id=node.id('vlist')
local disc_id=node.id('disc')
local whatsit_id=node.id('whatsit')
local math_id=node.id('math')
local rule_id=node.id('rule')
local function sp(v) return (v or 0)/65536 end
local function normalize_font_name(name)
  if string.sub(name, 1, 1) == "[" then
    local close = string.find(name, "]", 2, true)
    if close then return string.sub(name, 2, close - 1) end
  end
  return name
end
local function font_name(font_id)
  local registered=font.fonts and font.fonts[font_id]
  if registered and registered.name then return normalize_font_name(tostring(registered.name)) end
  local ok, tex_name=pcall(function() return tex.fontname(font_id) end)
  if ok and tex_name then return normalize_font_name(tostring(tex_name)) end
  local f=font.getfont(font_id)
  return normalize_font_name(tostring(f and (f.name or f.fontname or f.fullname or f.psname or f.filename)))
end
local function node_width(n) return sp(n.width or 0) end
local function node_height(n) return sp(n.height or 0) end
local function node_depth(n) return sp(n.depth or 0) end
local function glue_order(n, stretch)
  if stretch then
    return n.stretch_order or (n.spec and n.spec.stretch_order) or 0
  end
  return n.shrink_order or (n.spec and n.spec.shrink_order) or 0
end
local function glue_width(n, box)
  local w = n.width or (n.spec and n.spec.width) or 0
  if box and (box.glue_sign or 0) ~= 0 then
    local target_order = box.glue_order or 0
    if box.glue_sign == 1 and glue_order(n, true) == target_order then
      w = w + ((n.stretch or (n.spec and n.spec.stretch) or 0) * (box.glue_set or 0))
    elseif box.glue_sign == 2 and glue_order(n, false) == target_order then
      w = w - ((n.shrink or (n.spec and n.spec.shrink) or 0) * (box.glue_set or 0))
    end
  end
  return sp(w)
end
local function kern_width(n) return sp(n.kern or n.width or 0) end
local function starts_with(value, prefix)
  return string.sub(value, 1, string.len(prefix)) == prefix
end
local function is_math_font_name(name)
  return starts_with(name, "cmmi") or starts_with(name, "cmsy") or starts_with(name, "cmex")
end
local function is_math_script_text_font(name)
  return starts_with(name, "cmr7") or starts_with(name, "cmr5")
end
local function is_math_operator_char(char)
  return char == 43 or char == 45 or char == 61 or char == 40 or char == 41 or
    char == 44 or char == 47 or char == 91 or char == 93 or
    (char >= 48 and char <= 57)
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

local walk_vlist
local function walk_hlist(list, line_index, origin_x, baseline_y, in_math, box, math_context)
  if not list then return origin_x end
  local x = origin_x
  local last_math_like = math_context or false
  for n in node.traverse(list) do
    if n.id==math_id then
      in_math = n.subtype == 0
    elseif n.id==glyph_id then
      local current_font = font_name(n.font)
      local math_like = in_math or is_math_font_name(current_font) or
        is_math_script_text_font(current_font) or
        (last_math_like and is_math_operator_char(n.char))
      if math_like then
        texio.write_nl(
          'TMG line=' .. line_index ..
          ' x=' .. x ..
          ' y=' .. baseline_y ..
          ' f=' .. current_font ..
          ' c=' .. n.char
        )
      end
      last_math_like = math_like
      x=x+node_width(n)
    elseif n.id==glue_id then
      x=x+glue_width(n, box)
    elseif n.id==kern_id then
      x=x+kern_width(n)
    elseif n.id==hlist_id then
      walk_hlist(n.list, line_index, x, baseline_y + sp(n.shift or 0), in_math, n, last_math_like)
      x=x+node_width(n)
    elseif n.id==vlist_id then
      walk_vlist(n.list, line_index, x, baseline_y + sp(n.shift or 0), node_height(n), node_width(n), in_math or last_math_like)
      x=x+node_width(n)
    elseif n.id==disc_id then
      x=walk_hlist(n.replace or n.pre, line_index, x, baseline_y, in_math, box, last_math_like)
    elseif n.id~=whatsit_id then
      x=x+node_width(n)
      last_math_like = false
    end
  end
  return x
end

function walk_vlist(list, line_index, origin_x, baseline_y, height, width, in_math)
  local y = baseline_y - height
  for n in node.traverse(list) do
    if n.id==kern_id then
      y=y+kern_width(n)
    elseif n.id==glue_id then
      y=y+glue_width(n, nil)
    elseif n.id==hlist_id then
      local child_baseline = y + node_height(n)
      walk_hlist(n.list, line_index, origin_x + sp(n.shift or 0), child_baseline, in_math, n, in_math)
      y=y+node_height(n)+node_depth(n)
    elseif n.id==vlist_id then
      local child_baseline = y + node_height(n)
      walk_vlist(n.list, line_index, origin_x + sp(n.shift or 0), child_baseline, node_height(n), node_width(n), in_math)
      y=y+node_height(n)+node_depth(n)
    elseif n.id==rule_id then
      y=y+node_height(n)+node_depth(n)
    else
      y=y+node_height(n)+node_depth(n)
    end
  end
end

local line_index = 0
for n in node.traverse(tex.box[0].list) do
  if node.type(n.id) == "hlist" then
    texio.write_nl(
      "term",
      "TIL " .. collect(n.list, false)
    )
    walk_hlist(n.list, line_index, 0, 0, false, n, false)
    line_index = line_index + 1
  end
end`;
}

function normalizeLineText(text) {
  return text
    .replaceAll("ﬀ", "ff")
    .replaceAll("ﬁ", "fi")
    .replaceAll("ﬂ", "fl")
    .replaceAll("ﬃ", "ffi")
    .replaceAll("ﬄ", "ffl")
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
      version: 11,
      source: caseSpec.source,
      width: caseSpec.width,
      parindent: 0,
      engine: "lualatex",
    }))
    .digest("hex");
  return resolve(cacheDir, `${key}.json`);
}

function compareMathGlyphs(mismatches, ours, tex, tolerance) {
  if (ours.length !== tex.length) {
    mismatches.push(`math glyph count differs: ours=${ours.length} tex=${tex.length}`);
  }
  const count = Math.min(ours.length, tex.length);
  for (let index = 0; index < count; index += 1) {
    const left = ours[index];
    const right = tex[index];
    if (!left || !right) {
      continue;
    }
    if (left.lineIndex !== right.lineIndex) {
      mismatches.push(`math glyph ${index} line differs: ours=${left.lineIndex + 1} tex=${right.lineIndex + 1}`);
    }
    if (left.code !== right.code) {
      mismatches.push(`math glyph ${index} code differs: ours=${left.code} tex=${right.code}`);
    }
    if (left.fontId !== right.fontId) {
      mismatches.push(`math glyph ${index} font differs: ours=${left.fontId} tex=${right.fontId}`);
    }
    compareNumber(mismatches, `math glyph ${index} x`, left.x, right.x, tolerance);
    compareNumber(mismatches, `math glyph ${index} y`, left.y, right.y, tolerance);
  }
}

function compareNumber(mismatches, label, left, right, tolerance) {
  if (Math.abs(left - right) > tolerance) {
    mismatches.push(`${label} differs: ours=${left} tex=${right}`);
  }
}

function round(value) {
  return Number(value.toFixed(6));
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

function exactCases(source, widths) {
  return widths.map((width) => ({
    id: `exact-${width}`,
    source,
    width,
  }));
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
    compareGlyphs: false,
    glyphTolerance: 0.05,
    source: null,
  };
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === "--summary-only") {
      parsed.summaryOnly = true;
    } else if (arg === "--compare-glyphs") {
      parsed.compareGlyphs = true;
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
    } else if (arg === "--glyph-tolerance") {
      parsed.glyphTolerance = Number(process.argv[++index] ?? parsed.glyphTolerance);
    } else if (arg === "--source") {
      parsed.source = process.argv[++index] ?? "";
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
