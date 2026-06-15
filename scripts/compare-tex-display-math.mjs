#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTexDerivedInlineMathBoxProvider,
  layoutSimpleTexParagraph,
} from "../packages/core/dist/text/tex/index.js";
import { texOracleEnv } from "./lib/tex-oracle.mjs";

const matrixEnvironments = ["matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix"];
const binomialCommands = [String.raw`\binom`, String.raw`\dbinom`, String.raw`\tbinom`];
const fractionCommands = [String.raw`\frac`, String.raw`\dfrac`, String.raw`\tfrac`];
const lineCommands = [String.raw`\overline`, String.raw`\underline`];
const accentCommands = [String.raw`\bar`, String.raw`\dot`, String.raw`\ddot`, String.raw`\hat`, String.raw`\tilde`, String.raw`\vec`];

const args = readArgs();
const generatedDisplayFuzzCases = args.displayFuzzCases > 0
  ? generateDisplayFuzzCases(args.displayFuzzCases, args.seed)
  : [];
const cases = args.cases.length > 0
  ? args.cases
  : generatedDisplayFuzzCases.length > 0
    ? generatedDisplayFuzzCases
  : [
      {
        id: "short-display-skip",
        source: String.raw`Alpha \[\sum_i^n\] Beta`,
        width: 120,
      },
      {
        id: "normal-display-skip",
        source: String.raw`Alpha Beta Gamma \[\sum_i^n\] Delta`,
        width: 120,
      },
      {
        id: "equation-star-display",
        source: String.raw`Alpha \begin{equation*}\sum_i^n\end{equation*} Beta`,
        width: 120,
      },
      {
        id: "styled-fraction-display",
        source: String.raw`Alpha \[\dfrac{1}{2}+\tfrac{x}{y}\] Beta`,
        width: 160,
      },
      {
        id: "ellipsis-display",
        source: String.raw`Alpha \[x_1,\ldots,x_n+\cdots\] Beta`,
        width: 160,
      },
      {
        id: "align-star-display",
        source: String.raw`Alpha \begin{align*}a&=b\\c&=d\end{align*} Beta`,
        width: 120,
      },
    ];

const results = cases.map((caseSpec) => compareCase(caseSpec, args));
const failed = results.filter((result) => !result.ok);
if (args.summaryOnly) {
  console.log(JSON.stringify({
    tolerance: args.tolerance,
    passed: results.length - failed.length,
    failed: failed.length,
    failures: failed.map((result) => ({
      id: result.id,
      width: result.width,
      mismatches: result.mismatches,
      source: result.source,
    })),
    ...(generatedDisplayFuzzCases.length > 0 ? {
      seed: args.seed,
      mode: "display-fuzz",
    } : {}),
  }, null, 2));
} else {
  console.log(JSON.stringify({ tolerance: args.tolerance, results }, null, 2));
}
if (failed.length > 0) {
  process.exitCode = 1;
}

function compareCase(caseSpec, args) {
  const tolerance = args.tolerance;
  const ours = ourTrace(caseSpec);
  let tex;
  try {
    tex = texTrace(caseSpec, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...caseSpec,
      ok: false,
      mismatches: [`TeX oracle failed: ${message}`],
      ours,
      tex: { topLevel: [], glyphs: [] },
    };
  }
  const mismatches = [];
  if (!ours.supported) {
    mismatches.push(`our layout unsupported: ${ours.errors.join("; ")}`);
    return { ...caseSpec, ok: false, mismatches, ours, tex };
  }
  compareTopLevelItems(mismatches, ours.topLevel, tex.topLevel, tolerance);
  compareDisplayMathGlyphs(mismatches, ours.topLevel, ours.glyphs, tex.topLevel, tex.glyphs, tolerance);
  return {
    ...caseSpec,
    ok: mismatches.length === 0,
    mismatches,
    ours,
    tex,
  };
}

function compareTopLevelItems(mismatches, ours, tex, tolerance) {
  const ourHlists = ours.filter((item) =>
    item.kind === "paragraph" ||
    item.kind === "display-math" ||
    item.hboxRole?.kind === "display-align-row"
  );
  const texHlists = tex.filter((item) => item.kind === "hlist");
  compareItemLists(
    mismatches,
    "hlist",
    ourHlists.map(semanticHlistItem),
    texHlists,
    tolerance
  );

  const ourVerticalGlues = ours.filter(isVisibleVerticalGlue);
  const texVerticalGlues = tex.filter(isVisibleVerticalGlue);
  compareItemLists(mismatches, "vertical glue", ourVerticalGlues, texVerticalGlues, tolerance);
}

function isVisibleVerticalGlue(item) {
  return item.kind === "glue" && (item.size ?? 0) > 0;
}

function compareItemLists(mismatches, label, ours, tex, tolerance) {
  if (ours.length !== tex.length) {
    mismatches.push(`${label} count differs: ours=${ours.length} tex=${tex.length}`);
  }
  const count = Math.min(ours.length, tex.length);
  for (let index = 0; index < count; index++) {
    const left = ours[index];
    const right = tex[index];
    if (!left || !right) {
      continue;
    }
    if (left.kind !== right.kind) {
      mismatches.push(`${label} ${index} kind differs: ours=${left.kind} tex=${right.kind}`);
      continue;
    }
    compareNumber(mismatches, `${label} ${index} y`, left.y, right.y, tolerance);
    compareNumber(mismatches, `${label} ${index} width`, left.width, right.width, tolerance);
    compareNumber(mismatches, `${label} ${index} height`, left.height, right.height, tolerance);
    compareNumber(mismatches, `${label} ${index} depth`, left.depth, right.depth, tolerance);
    if (left.kind === "glue" && right.kind === "glue") {
      compareNumber(mismatches, `${label} ${index} size`, left.size, right.size, tolerance);
    }
    compareNumber(mismatches, `${label} ${index} x`, left.x, right.x, tolerance);
  }
}

function semanticHlistItem(item) {
  return {
    ...item,
    kind: "hlist",
    role: item.kind,
  };
}

function ourTrace(caseSpec) {
  const result = layoutSimpleTexParagraph(caseSpec.source, {
    paragraphId: `tex-display-math:${caseSpec.id}`,
    width: caseSpec.width,
    parindent: 0,
    hyphenator: { hyphenate: () => [] },
    mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
  });
  if (!result.supported || !result.vlistLayout) {
    return {
      supported: false,
      errors: result.errors ?? [result.fallbackReason ?? "unknown failure"],
      topLevel: [],
      glyphs: [],
    };
  }
  return {
    supported: true,
    errors: result.errors,
    topLevel: result.vlistLayout.boxReport.tree.map((item) => ({
      kind: item.itemKind,
      x: round(item.x),
      y: round(item.y),
      width: round(item.width),
      height: round(item.height),
      depth: round(item.depth),
      size: item.glue ? round(item.glue.size) : undefined,
      glue: item.glue,
      displayMath: item.displayMath,
      hboxRole: item.hboxRole,
      sourceSpan: item.sourceSpan,
    })),
    glyphs: ourGlyphTraceFromVListItems(result.vlistLayout.items),
  };
}

function ourGlyphTraceFromVListItems(items) {
  const glyphs = [];
  collectOurGlyphTraceFromVListItems(glyphs, items);
  return glyphs;
}

function collectOurGlyphTraceFromVListItems(glyphs, items) {
  for (const item of items) {
    if (item.item?.kind === "display-math") {
      glyphs.push(...glyphsFromMathSvgBody(
        item.item.box.svgBody,
        item.x,
        item.y + item.metrics.height,
        item.item.kind
      ));
    } else if (item.item?.kind === "hbox") {
      for (const renderItem of item.item.box.renderItems ?? []) {
        if (renderItem.kind !== "tex-math-svg") {
          continue;
        }
        glyphs.push(...glyphsFromMathSvgBody(
          renderItem.svgBody,
          item.x + renderItem.x,
          item.y + renderItem.baseline,
          item.item.role?.kind ?? item.item.kind
        ));
      }
    }
    if (item.children?.length) {
      collectOurGlyphTraceFromVListItems(glyphs, item.children);
    }
  }
}

function glyphsFromMathSvgBody(svgBody, originX, baselineY, role) {
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
    glyphs.push({
      kind: "glyph",
      role,
      x: round(originX + Number(translate[1]) / 100),
      y: round(baselineY + Number(translate[2]) / 100),
      fontId,
      code,
    });
  }
  return glyphs;
}

function readSvgAttribute(tag, name) {
  const pattern = new RegExp(`${name}="([^"]*)"`);
  return pattern.exec(tag)?.[1];
}

function texTrace(caseSpec, args) {
  const tempDir = mkdtempSync(join(tmpdir(), "tikz-tex-display-math-compare-"));
  try {
    writeFileSync(join(tempDir, "trace.lua"), traceLuaSource(), "utf8");
    writeFileSync(join(tempDir, "case.tex"), texSource(caseSpec), "utf8");
    execFileSync("lualatex", ["--interaction=nonstopmode", "--halt-on-error", "case.tex"], {
      cwd: tempDir,
      env: texOracleEnv(),
      stdio: "pipe",
      maxBuffer: 10 * 1024 * 1024,
    });
    const tracePath = join(tempDir, "trace.jsonl");
    const trace = parseTexTrace(readFileSync(tracePath, "utf8"));
    if (args.keepTemp) {
      trace.tempDir = tempDir;
      trace.logPath = join(tempDir, "case.log");
      trace.tracePath = tracePath;
      return trace;
    }
    return trace;
  } finally {
    if (!args.keepTemp) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function parseTexTrace(log) {
  const topLevel = [];
  const glyphs = [];
  for (const line of log.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const entry = JSON.parse(line);
    if (entry.scope === "top" && entry.kind === "hlist") {
      topLevel.push({
        kind: "hlist",
        index: entry.index,
        x: round(entry.x),
        y: round(entry.y),
        width: round(entry.width),
        height: round(entry.height),
        depth: round(entry.depth),
      });
      continue;
    }
    if (entry.scope === "top" && entry.kind === "glue") {
      const size = round(entry.size);
      topLevel.push({
        kind: "glue",
        index: entry.index,
        x: 0,
        y: round(entry.y),
        width: 0,
        height: Math.max(0, size),
        depth: 0,
        size,
      });
      continue;
    }
    if (entry.kind === "glyph") {
      glyphs.push({
        kind: "glyph",
        topIndex: entry.topIndex,
        x: round(entry.x),
        y: round(entry.y),
        fontId: entry.font,
        code: entry.char,
        width: round(entry.width),
      });
    }
  }
  return { topLevel, glyphs };
}

function compareDisplayMathGlyphs(mismatches, oursTopLevel, oursGlyphs, texTopLevel, texGlyphs, tolerance) {
  const texDisplayHlistIndices = matchedTexDisplayHlistIndices(oursTopLevel, texTopLevel);
  const displayTexGlyphs = texGlyphs.filter((glyph) =>
    texDisplayHlistIndices.has(glyph.topIndex)
  );
  compareGlyphLists(mismatches, "display math glyph", oursGlyphs, displayTexGlyphs, tolerance);
}

function matchedTexDisplayHlistIndices(oursTopLevel, texTopLevel) {
  const indices = new Set();
  const ourHlists = oursTopLevel.filter((item) =>
    item.kind === "paragraph" ||
    item.kind === "display-math" ||
    item.hboxRole?.kind === "display-align-row"
  );
  const texHlists = texTopLevel.filter((item) => item.kind === "hlist");
  const count = Math.min(ourHlists.length, texHlists.length);
  for (let index = 0; index < count; index++) {
    const ours = ourHlists[index];
    const tex = texHlists[index];
    if (
      (ours.kind === "display-math" || ours.hboxRole?.kind === "display-align-row") &&
      tex?.index !== undefined
    ) {
      indices.add(tex.index);
    }
  }
  return indices;
}

function compareGlyphLists(mismatches, label, ours, tex, tolerance) {
  if (ours.length !== tex.length) {
    mismatches.push(`${label} count differs: ours=${ours.length} tex=${tex.length}`);
  }
  const count = Math.min(ours.length, tex.length);
  for (let index = 0; index < count; index++) {
    const left = ours[index];
    const right = tex[index];
    if (!left || !right) {
      continue;
    }
    if (left.code !== right.code) {
      mismatches.push(`${label} ${index} code differs: ours=${left.code} tex=${right.code}`);
    }
    if (left.fontId !== right.fontId) {
      mismatches.push(`${label} ${index} font differs: ours=${left.fontId} tex=${right.fontId}`);
    }
    compareNumber(mismatches, `${label} ${index} x`, left.x, right.x, tolerance);
    compareNumber(mismatches, `${label} ${index} y`, left.y, right.y, tolerance);
  }
}

function texSource(caseSpec) {
  const amsmathPreamble = requiresAmsmath(caseSpec.source)
    ? String.raw`\usepackage{amsmath}` + "\n"
    : "";
  return String.raw`\documentclass{article}
` + amsmathPreamble + String.raw`
\newbox\tikzdisplaybox
\begin{document}
\setbox\tikzdisplaybox=\vbox{\hsize=` + caseSpec.width + String.raw`pt \noindent ` + caseSpec.source + String.raw`\par}
\directlua{dofile('trace.lua')}
\end{document}
`;
}

function requiresAmsmath(source) {
  return source.includes(String.raw`\begin{equation*}`) ||
    source.includes(String.raw`\begin{align*}`) ||
    hasMatrixEnvironment(source) ||
    hasCasesEnvironment(source) ||
    hasSmallMatrixEnvironment(source) ||
    hasOperatorNameCommand(source) ||
    hasBinomialCommand(source) ||
    hasStyledFractionCommand(source) ||
    hasSubstackCommand(source) ||
    hasEllipsisCommand(source) ||
    source.includes(String.raw`\text`);
}

function traceLuaSource() {
  return String.raw`local out=assert(io.open('trace.jsonl','w'))
local function emit(fields)
  out:write("{")
  local first=true
  for key,value in pairs(fields) do
    if not first then out:write(",") end
    first=false
    out:write(string.format("%q:", key))
    if type(value)=="number" then
      out:write(string.format("%.6f", value))
    else
      out:write(string.format("%q", tostring(value)))
    end
  end
  out:write("}\n")
end
local glyph_id=node.id('glyph')
local glue_id=node.id('glue')
local kern_id=node.id('kern')
local hlist_id=node.id('hlist')
local vlist_id=node.id('vlist')
local rule_id=node.id('rule')
local penalty_id=node.id('penalty')
local disc_id=node.id('disc')
local whatsit_id=node.id('whatsit')
local function sp(v) return (v or 0)/65536 end
local function font_name(font_id)
  local registered=font.fonts and font.fonts[font_id]
  if registered and registered.name then return normalize_font_name(tostring(registered.name)) end
  local ok, tex_name=pcall(function() return tex.fontname(font_id) end)
  if ok and tex_name then return normalize_font_name(tostring(tex_name)) end
  local f=font.getfont(font_id)
  return normalize_font_name(tostring(f and (f.name or f.fontname or f.fullname or f.psname or f.filename)))
end
function normalize_font_name(name)
  local bracketed=string.match(name, '^%[([^%]]+)%]')
  if bracketed then return bracketed end
  return name
end
local function node_width(n) return sp(n.width or 0) end
local function node_height(n) return sp(n.height or 0) end
local function node_depth(n) return sp(n.depth or 0) end
local function glue_field(n, field)
  return sp(n[field] or (n.spec and n.spec[field]) or 0)
end
local function glue_order(n, field)
  return n[field] or (n.spec and n.spec[field]) or 0
end
local function glue_width(n, parent)
  local width=glue_field(n, 'width')
  if parent then
    local sign=parent.glue_sign or 0
    local set=parent.glue_set or 0
    local order=parent.glue_order or 0
    if sign==1 and glue_order(n, 'stretch_order')==order then
      width=width + glue_field(n, 'stretch') * set
    elseif sign==2 and glue_order(n, 'shrink_order')==order then
      width=width - glue_field(n, 'shrink') * set
    end
  end
  return width
end
local function kern_width(n) return sp(n.kern or n.width or 0) end
local function walk_hlist(list, origin_x, baseline_y, top_index, parent)
  if not list then return origin_x end
  local x=origin_x
  for n in node.traverse(list) do
    if n.id==glyph_id then
      emit({kind='glyph', topIndex=top_index, x=x, y=baseline_y, font=font_name(n.font), char=n.char, width=node_width(n)})
      x=x+node_width(n)
    elseif n.id==glue_id then
      x=x+glue_width(n, parent)
    elseif n.id==kern_id then
      x=x+kern_width(n)
    elseif n.id==hlist_id then
      walk_hlist(n.list, x, baseline_y + sp(n.shift or 0), top_index, n)
      x=x+node_width(n)
    elseif n.id==vlist_id then
      walk_vlist(n.list, x, baseline_y + sp(n.shift or 0) - node_height(n), node_height(n), 1, top_index, n)
      x=x+node_width(n)
    elseif n.id==disc_id then
      x=walk_hlist(n.replace or n.pre, x, baseline_y, top_index, parent)
    elseif n.id~=whatsit_id then
      x=x+node_width(n)
    end
  end
  return x
end
function walk_vlist(list, origin_x, top_y, height, level, parent_top_index, parent)
  local y=top_y
  local index=0
  for n in node.traverse(list) do
    if n.id==glue_id then
      local size=glue_width(n, parent)
      if level==0 then emit({scope='top', kind='glue', index=index, y=y, size=size}) end
      y=y+size
    elseif n.id==kern_id then
      y=y+kern_width(n)
    elseif n.id==hlist_id then
      local child_y=y
      local baseline=child_y+node_height(n)
      if level==0 then emit({scope='top', kind='hlist', index=index, x=origin_x + sp(n.shift or 0), y=child_y, width=node_width(n), height=node_height(n), depth=node_depth(n)}) end
      local top_index = parent_top_index
      if level==0 then top_index=index end
      walk_hlist(n.list, origin_x + sp(n.shift or 0), baseline, top_index, n)
      y=y+node_height(n)+node_depth(n)
    elseif n.id==vlist_id then
      y=y+node_height(n)+node_depth(n)
    elseif n.id==rule_id then
      y=y+node_height(n)+node_depth(n)
    elseif n.id~=penalty_id and n.id~=whatsit_id then
      y=y+node_height(n)+node_depth(n)
    end
    index=index+1
  end
end
walk_vlist(tex.box.tikzdisplaybox.list, 0, 0, node_height(tex.box.tikzdisplaybox), 0, nil, tex.box.tikzdisplaybox)
out:close()
`;
}

function compareNumber(mismatches, label, left, right, tolerance) {
  if (Math.abs(left - right) > tolerance) {
    mismatches.push(`${label} differs: ours=${left} tex=${right}`);
  }
}

function readArgs() {
  const cases = [];
  let keepTemp = false;
  let summaryOnly = false;
  let tolerance = 0.05;
  let displayFuzzCases = 0;
  let seed = 20260615;
  for (let index = 2; index < process.argv.length; index++) {
    const arg = process.argv[index] ?? "";
    if (arg === "--case") {
      cases.push(parseCaseArg(process.argv[++index] ?? ""));
    } else if (arg.startsWith("--case=")) {
      cases.push(parseCaseArg(arg.slice("--case=".length)));
    } else if (arg === "--source") {
      const source = process.argv[++index] ?? "";
      cases.push({ id: `case-${cases.length + 1}`, source, width: 120 });
    } else if (arg.startsWith("--source=")) {
      cases.push({ id: `case-${cases.length + 1}`, source: arg.slice("--source=".length), width: 120 });
    } else if (arg === "--width") {
      const width = Number(process.argv[++index] ?? 120);
      if (cases.length > 0) {
        cases[cases.length - 1].width = width;
      }
    } else if (arg.startsWith("--width=")) {
      const width = Number(arg.slice("--width=".length));
      if (cases.length > 0) {
        cases[cases.length - 1].width = width;
      }
    } else if (arg === "--tolerance") {
      tolerance = Number(process.argv[++index] ?? tolerance);
    } else if (arg.startsWith("--tolerance=")) {
      tolerance = Number(arg.slice("--tolerance=".length));
    } else if (arg === "--keep-temp") {
      keepTemp = true;
    } else if (arg === "--summary-only") {
      summaryOnly = true;
    } else if (arg === "--align-matrix") {
      cases.push(...alignMatrixCases());
    } else if (arg === "--construct-matrix") {
      cases.push(...constructMatrixCases());
    } else if (arg === "--display-fuzz") {
      displayFuzzCases = readNonNegativeInteger(process.argv[++index] ?? "", "--display-fuzz");
    } else if (arg.startsWith("--display-fuzz=")) {
      displayFuzzCases = readNonNegativeInteger(arg.slice("--display-fuzz=".length), "--display-fuzz");
    } else if (arg === "--seed") {
      seed = readNonNegativeInteger(process.argv[++index] ?? "", "--seed");
    } else if (arg.startsWith("--seed=")) {
      seed = readNonNegativeInteger(arg.slice("--seed=".length), "--seed");
    }
  }
  return { cases, displayFuzzCases, keepTemp, seed, summaryOnly, tolerance };
}

function readNonNegativeInteger(raw, label) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Expected ${label} to be a non-negative integer.`);
  }
  return value;
}

function alignMatrixCases() {
  return [
    {
      id: "align-three-rows",
      width: 120,
      source: String.raw`Alpha \begin{align*}a&=b\\c&=d\\e&=f\end{align*} Beta`,
    },
    {
      id: "align-wide-width",
      width: 160,
      source: String.raw`Alpha \begin{align*}a&=b\\c&=d\end{align*} Beta`,
    },
    {
      id: "align-narrow-width",
      width: 90,
      source: String.raw`Alpha \begin{align*}a&=b\\c&=d\end{align*} Beta`,
    },
    {
      id: "align-two-pairs",
      width: 160,
      source: String.raw`Alpha \begin{align*}a&=b&c&=d\\e&=f&g&=h\end{align*} Beta`,
    },
    {
      id: "align-single-row",
      width: 120,
      source: String.raw`Alpha \begin{align*}a&=b\end{align*} Beta`,
    },
  ];
}

function constructMatrixCases() {
  return [
    {
      id: "display-script-combined",
      width: 140,
      source: String.raw`Alpha \[x_i^2+y^n\] Beta`,
    },
    {
      id: "display-fraction",
      width: 140,
      source: String.raw`Alpha \[\frac{1}{2}+x\] Beta`,
    },
    {
      id: "display-dfrac-tfrac",
      width: 160,
      source: String.raw`Alpha \[\dfrac{1}{2}+\tfrac{x}{y}\] Beta`,
    },
    {
      id: "display-binom",
      width: 140,
      source: String.raw`Alpha \[\binom{n}{k}+x\] Beta`,
    },
    {
      id: "display-dbinom-tbinom",
      width: 160,
      source: String.raw`Alpha \[\dbinom{n}{k}+\tbinom{n}{k}\] Beta`,
    },
    {
      id: "display-radical",
      width: 140,
      source: String.raw`Alpha \[\sqrt{x+1}\] Beta`,
    },
    {
      id: "display-overline-underline",
      width: 140,
      source: String.raw`Alpha \[\overline{x}+\underline{y}\] Beta`,
    },
    {
      id: "display-tall-radical",
      width: 160,
      source: String.raw`Alpha \[\sqrt{\frac{1}{2}}\] Beta`,
    },
    {
      id: "display-left-right-fraction",
      width: 160,
      source: String.raw`Alpha \[\left(\frac{1}{2}\right)\] Beta`,
    },
    {
      id: "display-matrix",
      width: 160,
      source: String.raw`Alpha \[\begin{matrix}a&b\\c&d\end{matrix}\] Beta`,
    },
    {
      id: "display-array",
      width: 160,
      source: String.raw`Alpha \[\begin{array}{lc}a&b\\x&y\end{array}\] Beta`,
    },
    {
      id: "display-cases",
      width: 160,
      source: String.raw`Alpha \[\begin{cases}a&b\\x&y\end{cases}\] Beta`,
    },
    {
      id: "display-smallmatrix",
      width: 160,
      source: String.raw`Alpha \[\begin{smallmatrix}a&b\\x&y\end{smallmatrix}\] Beta`,
    },
    {
      id: "display-operatorname",
      width: 160,
      source: String.raw`Alpha \[\operatorname*{arg\,max}_{x}\] Beta`,
    },
    {
      id: "display-pmatrix",
      width: 160,
      source: String.raw`Alpha \[\begin{pmatrix}a&b\\c&d\end{pmatrix}\] Beta`,
    },
    {
      id: "display-bmatrix",
      width: 160,
      source: String.raw`Alpha \[\begin{bmatrix}a&b\\c&d\end{bmatrix}\] Beta`,
    },
    {
      id: "display-Bmatrix",
      width: 160,
      source: String.raw`Alpha \[\begin{Bmatrix}a&b\\c&d\end{Bmatrix}\] Beta`,
    },
    {
      id: "display-vmatrix",
      width: 160,
      source: String.raw`Alpha \[\begin{vmatrix}a&b\\c&d\end{vmatrix}\] Beta`,
    },
    {
      id: "display-Vmatrix",
      width: 160,
      source: String.raw`Alpha \[\begin{Vmatrix}a&b\\c&d\end{Vmatrix}\] Beta`,
    },
    {
      id: "display-substack",
      width: 160,
      source: String.raw`Alpha \[\sum_{\substack{i=1\\j=2}}^n\] Beta`,
    },
    {
      id: "display-large-operator-limits",
      width: 160,
      source: String.raw`Alpha \[\prod_i^n+\sum_j^m\] Beta`,
    },
    {
      id: "display-text",
      width: 140,
      source: String.raw`Alpha \[x+\text{if}\] Beta`,
    },
    {
      id: "align-script-cells",
      width: 160,
      source: String.raw`Alpha \begin{align*}x_i^2&=y^n\\a&=b\end{align*} Beta`,
    },
    {
      id: "align-fraction-radical-cells",
      width: 180,
      source: String.raw`Alpha \begin{align*}\frac{1}{2}&=x\\\sqrt{y+1}&=z\end{align*} Beta`,
    },
    {
      id: "align-text-cells",
      width: 160,
      source: String.raw`Alpha \begin{align*}\text{if}&=x\\y&=\text{off}\end{align*} Beta`,
    },
  ];
}

function generateDisplayFuzzCases(count, seed) {
  const rng = makeRng(seed);
  return Array.from({ length: count }, (_, index) => {
    const width = choice(rng, [100, 120, 140, 160, 180, 220]);
    const useAlign = index % 2 === 1;
    return {
      id: `display-fuzz-${index + 1}`,
      width,
      source: useAlign
        ? `Alpha ${randomAlignStarSource(rng)} Beta`
        : `Alpha \\[${randomDisplayFormula(rng)}\\] Beta`,
    };
  });
}

function randomAlignStarSource(rng) {
  const rowCount = 1 + randomInt(rng, 3);
  const pairCount = 1 + randomInt(rng, 2);
  const rows = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const cells = [];
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      cells.push(randomAlignmentLeftCell(rng));
      cells.push(`=${randomAlignmentRightCell(rng)}`);
    }
    rows.push(cells.join("&"));
  }
  return String.raw`\begin{align*}` + rows.join(String.raw`\\`) + String.raw`\end{align*}`;
}

function randomDisplayFormula(rng) {
  const left = randomMathTerm(rng);
  const right = randomMathTerm(rng);
  const operator = choice(rng, ["+", "-", "="]);
  if (rng() < 0.25) {
    return `${randomLargeOperator(rng)}_${randomScriptAtom(rng)}^${randomScriptAtom(rng)}${operator}${right}`;
  }
  return `${left}${operator}${right}`;
}

function randomAlignmentLeftCell(rng) {
  return choice(rng, [
    randomMathAtom(rng),
    randomScriptTerm(rng),
    randomFraction(rng),
    randomBinomial(rng),
    randomRadical(rng),
    randomLineTerm(rng),
    randomAccentTerm(rng),
    randomTextTerm(rng),
    randomArray(rng),
    randomCases(rng),
    randomSmallMatrix(rng),
    randomMatrix(rng),
    randomOperatorName(rng),
    `${randomLargeOperator(rng)}_${randomScriptAtom(rng)}^${randomScriptAtom(rng)}`,
  ]);
}

function randomAlignmentRightCell(rng) {
  return choice(rng, [
    randomMathAtom(rng),
    randomScriptTerm(rng),
    randomFraction(rng),
    randomBinomial(rng),
    randomRadical(rng),
    randomLineTerm(rng),
    randomAccentTerm(rng),
    randomTextTerm(rng),
    randomArray(rng),
    randomCases(rng),
    randomSmallMatrix(rng),
    randomMatrix(rng),
    randomOperatorName(rng),
  ]);
}

function randomMathTerm(rng) {
  return choice(rng, [
    randomMathAtom(rng),
    randomScriptTerm(rng),
    randomFraction(rng),
    randomBinomial(rng),
    randomRadical(rng),
    randomLineTerm(rng),
    randomAccentTerm(rng),
    randomLeftRight(rng),
    randomTextTerm(rng),
    randomArray(rng),
    randomCases(rng),
    randomSmallMatrix(rng),
    randomMatrix(rng),
    randomOperatorName(rng),
  ]);
}

function randomTextTerm(rng) {
  return String.raw`\text{` + choice(rng, ["if", "off", "on", "min", "max"]) + "}";
}

function randomScriptTerm(rng) {
  const base = randomMathAtom(rng);
  const sub = randomScriptAtom(rng);
  const sup = randomScriptAtom(rng);
  return choice(rng, [`${base}_${sub}`, `${base}^${sup}`, `${base}_${sub}^${sup}`]);
}

function randomFraction(rng) {
  const command = choice(rng, fractionCommands);
  return command + "{" + randomMathAtom(rng) + String.raw`}{` + randomMathAtom(rng) + "}";
}

function randomBinomial(rng) {
  const command = choice(rng, binomialCommands);
  return command + "{" + randomMathAtom(rng) + String.raw`}{` + randomMathAtom(rng) + "}";
}

function randomRadical(rng) {
  return String.raw`\sqrt{` + choice(rng, [
    randomMathAtom(rng),
    `${randomMathAtom(rng)}+${randomMathAtom(rng)}`,
    randomFraction(rng),
  ]) + "}";
}

function randomLineTerm(rng) {
  const command = choice(rng, lineCommands);
  return command + "{" + choice(rng, [
    randomMathAtom(rng),
    `${randomMathAtom(rng)}+${randomMathAtom(rng)}`,
    randomFraction(rng),
  ]) + "}";
}

function randomAccentTerm(rng) {
  const command = choice(rng, accentCommands);
  const base = choice(rng, [
    randomMathAtom(rng),
    randomMathAtom(rng) + "+" + randomMathAtom(rng),
    randomFraction(rng),
  ]);
  return command + "{" + base + "}";
}

function randomLeftRight(rng) {
  const delimiterPair = choice(rng, [
    ["(", ")"],
    ["[", "]"],
    [String.raw`\langle`, String.raw`\rangle`],
    [String.raw`\lfloor`, String.raw`\rfloor`],
    [String.raw`\lceil`, String.raw`\rceil`],
    [String.raw`\lbrace`, String.raw`\rbrace`],
    [String.raw`\Vert`, String.raw`\Vert`],
  ]);
  return String.raw`\left` + delimiterPair[0] + randomFraction(rng) + String.raw`\right` + delimiterPair[1];
}

function randomMatrix(rng) {
  const environment = choice(rng, matrixEnvironments);
  const rowCount = 1 + randomInt(rng, 2);
  const columnCount = 1 + randomInt(rng, 3);
  const rows = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const cells = [];
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      cells.push(choice(rng, [
        randomMathAtom(rng),
        randomScriptTerm(rng),
        randomFraction(rng),
        randomBinomial(rng),
      ]));
    }
    rows.push(cells.join("&"));
  }
  return String.raw`\begin{` + environment + "}" + rows.join(String.raw`\\`) + String.raw`\end{` + environment + "}";
}

function randomArray(rng) {
  const columnCount = 1 + randomInt(rng, 3);
  const preamble = Array.from({ length: columnCount }, () =>
    choice(rng, ["l", "c", "r"])
  ).join("");
  const rowCount = 1 + randomInt(rng, 2);
  const rows = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const cells = [];
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      cells.push(choice(rng, [
        randomMathAtom(rng),
        randomScriptTerm(rng),
        randomFraction(rng),
        randomBinomial(rng),
      ]));
    }
    rows.push(cells.join("&"));
  }
  return String.raw`\begin{array}{` + preamble + "}" + rows.join(String.raw`\\`) + String.raw`\end{array}`;
}

function randomCases(rng) {
  const rowCount = 1 + randomInt(rng, 2);
  const rows = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const left = choice(rng, [
      randomMathAtom(rng),
      randomScriptTerm(rng),
      randomFraction(rng),
      randomBinomial(rng),
    ]);
    const right = choice(rng, [
      randomMathAtom(rng),
      randomScriptTerm(rng),
      randomFraction(rng),
      randomBinomial(rng),
    ]);
    rows.push(left + "&" + right);
  }
  return String.raw`\begin{cases}` + rows.join(String.raw`\\`) + String.raw`\end{cases}`;
}

function randomSmallMatrix(rng) {
  const rowCount = 1 + randomInt(rng, 2);
  const columnCount = 1 + randomInt(rng, 3);
  const rows = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const cells = [];
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      cells.push(choice(rng, [
        randomMathAtom(rng),
        randomScriptTerm(rng),
        randomFraction(rng),
        randomBinomial(rng),
      ]));
    }
    rows.push(cells.join("&"));
  }
  return String.raw`\begin{smallmatrix}` + rows.join(String.raw`\\`) + String.raw`\end{smallmatrix}`;
}

function randomOperatorName(rng) {
  const names = ["rank", "cone", "span", String.raw`arg\,max`, String.raw`proj\,lim`];
  const command = randomInt(rng, 4) === 0 ? String.raw`\operatorname*` : String.raw`\operatorname`;
  return command + "{" + choice(rng, names) + "}";
}

function hasMatrixEnvironment(source) {
  return matrixEnvironments.some((environment) =>
    source.includes(String.raw`\begin{` + environment + "}")
  );
}

function hasCasesEnvironment(source) {
  return source.includes(String.raw`\begin{cases}`);
}

function hasSmallMatrixEnvironment(source) {
  return source.includes(String.raw`\begin{smallmatrix}`);
}

function hasOperatorNameCommand(source) {
  return source.includes(String.raw`\operatorname`);
}

function hasBinomialCommand(source) {
  return binomialCommands.some((command) => source.includes(command));
}

function hasStyledFractionCommand(source) {
  return source.includes(String.raw`\dfrac`) || source.includes(String.raw`\tfrac`);
}

function hasSubstackCommand(source) {
  return source.includes(String.raw`\substack`);
}

function hasEllipsisCommand(source) {
  return source.includes(String.raw`\dots`) ||
    source.includes(String.raw`\ldots`) ||
    source.includes(String.raw`\cdots`);
}

function randomLargeOperator(rng) {
  return choice(rng, [String.raw`\sum`, String.raw`\prod`, String.raw`\bigcup`, String.raw`\bigcap`]);
}

function randomMathAtom(rng) {
  return choice(rng, [
    "a",
    "b",
    "c",
    "i",
    "j",
    "m",
    "n",
    "x",
    "y",
    "z",
    "1",
    "2",
    String.raw`\ldots`,
    String.raw`\cdots`,
    String.raw`\dots`,
  ]);
}

function randomScriptAtom(rng) {
  return choice(rng, ["a", "b", "c", "i", "j", "m", "n", "x", "y", "z", "1", "2"]);
}

function choice(rng, values) {
  return values[randomInt(rng, values.length)] ?? values[0];
}

function randomInt(rng, upperExclusive) {
  return Math.floor(rng() * upperExclusive);
}

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function parseCaseArg(value) {
  const parts = value.split("::");
  if (parts.length === 3) {
    return { id: parts[0], width: Number(parts[1]), source: parts[2] };
  }
  if (parts.length === 2) {
    return { id: parts[0], width: 120, source: parts[1] };
  }
  return { id: `case-${Date.now()}`, width: 120, source: value };
}

function round(value) {
  return Number(value.toFixed(6));
}
