#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  layoutTexMathList,
  parseTexMath,
  texMathSymbolCommandNames,
} from "../packages/core/dist/text/tex/math/index.js";
import { texOracleEnv } from "./lib/tex-oracle.mjs";

const matrixEnvironments = ["matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix"];
const binomialCommands = [String.raw`\binom`, String.raw`\dbinom`, String.raw`\tbinom`];
const fractionCommands = [String.raw`\frac`, String.raw`\dfrac`, String.raw`\tfrac`];
const lineCommands = [String.raw`\overline`, String.raw`\underline`];
const accentCommands = [
  String.raw`\bar`,
  String.raw`\dot`,
  String.raw`\ddot`,
  String.raw`\hat`,
  String.raw`\mathring`,
  String.raw`\tilde`,
  String.raw`\vec`,
];
const amsMathCommands = [
  String.raw`\boxed`,
  String.raw`\dddot`,
  String.raw`\ddddot`,
  String.raw`\injlim`,
  String.raw`\implies`,
  String.raw`\impliedby`,
  String.raw`\overunderset`,
  String.raw`\overset`,
  String.raw`\projlim`,
  String.raw`\smash`,
  String.raw`\underset`,
  String.raw`\varinjlim`,
  String.raw`\varliminf`,
  String.raw`\varlimsup`,
  String.raw`\varprojlim`,
  ...texMathSymbolCommandNames({ requiredLatexPackage: "amsmath" }),
];
const amsMathDelimiterCommands = [
  String.raw`\lvert`,
  String.raw`\rvert`,
  String.raw`\lVert`,
  String.raw`\rVert`,
];
const amsSymbolCommands = [
  String.raw`\approxeq`,
  String.raw`\Bbbk`,
  String.raw`\blacksquare`,
  String.raw`\boxdot`,
  String.raw`\circleddash`,
  String.raw`\dasharrow`,
  String.raw`\dashleftarrow`,
  String.raw`\dashrightarrow`,
  String.raw`\digamma`,
  String.raw`\dotplus`,
  String.raw`\geqslant`,
  String.raw`\gtrsim`,
  String.raw`\Join`,
  String.raw`\leqslant`,
  String.raw`\lesssim`,
  String.raw`\llcorner`,
  String.raw`\lrcorner`,
  String.raw`\ngeqslant`,
  String.raw`\nleqslant`,
  String.raw`\nVdash`,
  String.raw`\square`,
  String.raw`\Subset`,
  String.raw`\Supset`,
  String.raw`\thickapprox`,
  String.raw`\thicksim`,
  String.raw`\ulcorner`,
  String.raw`\urcorner`,
  String.raw`\varnothing`,
  String.raw`\Vdash`,
  ...texMathSymbolCommandNames({ requiredLatexPackage: "amssymb" }),
];
const mathtoolsColonRelationCommands = [
  String.raw`\dblcolon`,
  String.raw`\coloneq`,
  String.raw`\coloneqq`,
  String.raw`\Coloneq`,
  String.raw`\Coloneqq`,
  String.raw`\eqcolon`,
  String.raw`\eqqcolon`,
  String.raw`\Eqcolon`,
  String.raw`\Eqqcolon`,
  String.raw`\colonapprox`,
  String.raw`\Colonapprox`,
  String.raw`\approxcolon`,
  String.raw`\Approxcolon`,
  String.raw`\colonsim`,
  String.raw`\Colonsim`,
  String.raw`\simcolon`,
  String.raw`\Simcolon`,
  String.raw`\colondash`,
  String.raw`\Colondash`,
  String.raw`\dashcolon`,
  String.raw`\Dashcolon`,
];

const kernelMathTextCommands = [
  String.raw`\textrm`,
  String.raw`\textsf`,
  String.raw`\texttt`,
  String.raw`\textnormal`,
  String.raw`\textbf`,
  String.raw`\textmd`,
  String.raw`\textit`,
  String.raw`\textsl`,
  String.raw`\textsc`,
  String.raw`\textup`,
  String.raw`\emph`,
];

const args = readArgs();
const generatedAlignedFormulas = args.alignedFuzzCases > 0
  ? generateAlignedFuzzFormulas(args.alignedFuzzCases, args.seed)
  : [];
const generatedMathFormulas = args.mathFuzzCases > 0
  ? generateMathFuzzFormulas(args.mathFuzzCases, args.seed)
  : [];
const formulas = args.formulas.length > 0
  ? args.formulas
  : generatedMathFormulas.length > 0
    ? generatedMathFormulas
  : generatedAlignedFormulas.length > 0
    ? generatedAlignedFormulas
  : [
      "a+1",
      "x-y",
      "xy",
      "a=b",
      "(z)",
      "a{b}",
      "a\\mathinner{b}",
      "\\frac{1}{2}",
      "\\frac{x+y}{2}",
      "\\dfrac{1}{2}",
      "\\tfrac{1}{2}",
      "x+\\dfrac{n}{k}+\\tfrac{n}{k}",
      "\\binom{n}{k}",
      "\\dbinom{n}{k}",
      "\\tbinom{n}{k}",
      "x+\\binom{n}{k}",
      "x_\\frac{1}{2}",
      "\\sqrt{x}",
      "\\sqrt{x+y}",
      "\\sqrt{\\frac{1}{2}}",
      "\\sqrt{\\sqrt{\\frac{1}{2}}}",
      "\\sqrt{\\sqrt{\\sqrt{\\sqrt{\\frac{1}{2}}}}}",
      "\\overline{x}",
      "\\underline{x}",
      "\\overline{x+y}",
      "\\underline{\\frac{1}{2}}",
      "a^{\\overline{x}}",
      "a^{\\underline{x}}",
      "\\overline{x}^2",
      "\\left(x\\right)",
      "\\left(\\frac{1}{2}\\right)",
      "\\left.\\frac{1}{2}\\right]",
      "\\left[\\sqrt{\\sqrt{\\sqrt{\\sqrt{\\frac{1}{2}}}}}\\right]",
      "\\left|x\\right|",
      "\\left\\Vert x\\right\\Vert",
      "\\left\\langle x\\right\\rangle",
      "\\left\\lbrace x\\right\\rbrace",
      "\\left\\backslash x\\right/",
      "\\left\\langle\\frac{1}{2}\\right\\rangle",
      "\\left\\lfloor\\sqrt{\\sqrt{\\sqrt{\\sqrt{\\frac{1}{2}}}}}\\right\\rfloor",
      "\\hat{x}",
      "\\bar{x}",
      "\\vec{x}",
      "\\tilde{x}",
      "\\dot{x}",
      "\\ddot{x}",
      "\\hat{y}",
      "\\hat{xy}",
      "\\hat{\\frac{1}{2}}",
      "\\text{if}",
      "x+\\text{if}",
      "\\text{office}",
      "\\textrm{if}",
      "\\textsf{if}",
      "\\texttt{if}",
      "\\textnormal{if}",
      "\\textbf{if}",
      "\\textbf{\\textmd{if}}",
      "\\textit{if}",
      "\\textit{\\textup{if}}",
      "\\textsl{if}",
      "\\textsc{if}",
      "\\emph{if}",
      "\\mbox{\\textbf{Bold} text}",
      "\\mbox{\\texttt{if}}",
      "\\makebox{if}",
      "\\makebox[20pt][l]{if}",
      "\\makebox[20pt][c]{if}",
      "\\makebox[20pt][r]{if}",
      "\\makebox[24pt][s]{a b}",
      "\\llap{if}",
      "\\rlap{if}",
      "x_{\\text{if}}",
      "x_{y_{\\textbf{if}}}",
      "x_{\\mbox{$y$}}",
      "x_{\\text{$y$}}",
      "\\mathrm{ABC123}",
      "\\mathit{ABC123}",
      "\\mathbf{ABC123}",
      "\\mathsf{ABC123}",
      "\\mathtt{ABC123}",
      "\\mathcal{ABC}",
      "\\mathit{a+b}",
      "\\mathtt{a+b}",
      "\\mathcal{A+B}",
      "x_{\\mathbf{i}}",
      "x_{y_{\\mathsf{i}}}",
      "x_{\\mathtt{i}}",
      "x_{y_{\\mathcal{A}}}",
      "\\alpha+\\beta=\\gamma",
      "\\Gamma+\\Delta+\\Omega",
      "x\\leq y\\neq z",
      "a\\times b\\cdot c",
      "\\infty\\in A\\subset B",
      "\\pm x\\mp y",
      "A\\to B\\leftarrow C",
      "A\\Rightarrow B\\Leftrightarrow C",
      "x\\mapsto y",
      "p\\wedge q\\vee r",
      "\\forall x\\exists y\\in A",
      "A\\cup B\\cap C\\setminus D",
      "A\\supset B\\subseteq C\\supseteq D",
      "x\\notin A",
      "x\\not= y",
      "x\\not\\in A",
      "x\\not\\leq y",
      "\\ldots",
      "\\cdots",
      "\\dots",
      "a\\ldots b",
      "a+\\cdots+b",
      "x_1,\\ldots,x_n",
      "\\sum",
      "\\sum_i^n",
      "\\begin{aligned}a&=b\\\\c&=d\\end{aligned}",
      "\\begin{aligned}x_i&=y^2\\\\\\frac{1}{2}&=z\\end{aligned}",
      "\\begin{aligned}a&=b&c&=d\\\\e&=f&g&=h\\end{aligned}",
      "\\begin{aligned}\\sum_i^n&=x\\\\\\sqrt{x}&=y\\end{aligned}",
      "\\begin{matrix}a&b\\\\c&d\\end{matrix}",
      "\\begin{array}{cc}a&b\\\\c&d\\end{array}",
      "\\begin{array}{lr}a&b\\\\x&y\\end{array}",
      "\\begin{cases}a&b\\\\x&y\\end{cases}",
      "\\begin{smallmatrix}a&b\\\\x&y\\end{smallmatrix}",
      "\\operatorname{rank}",
      "\\operatorname*{arg\\,max}_{x}",
      "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}",
      "\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}",
      "\\begin{Bmatrix}a&b\\\\c&d\\end{Bmatrix}",
      "\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}",
      "\\begin{Vmatrix}a&b\\\\c&d\\end{Vmatrix}",
      "\\substack{i\\\\j}",
      "x_{\\substack{i\\\\j}}",
      "\\sum_{\\substack{i=1\\\\j=2}}^n",
      "\\begin{subarray}{c}i\\\\j\\end{subarray}",
      "\\begin{subarray}{l}i\\\\j\\end{subarray}",
      "\\prod_i^n",
      "\\coprod_i^n",
      "\\bigcup_i^n",
      "\\bigcap_i^n",
      "\\int",
      "\\int_0^1",
      "\\oint_0^1",
      "\\lim_{x}",
      "x^2",
      "x_i",
      "x_i^2",
      "y^2",
      "y_i",
      "y_i^2",
      "{x+y}",
      "{x+y}^2",
      "x^{y_i}",
    ];
const tolerance = args.tolerance;
const results = formulas.map((formula) => compareFormula(formula, tolerance));
const failed = results.filter((result) => !result.ok);
if (args.summaryOnly) {
  console.log(JSON.stringify({
    tolerance,
    cases: formulas.length,
    failed: failed.length,
    seed: args.seed,
    mode: generatedMathFormulas.length > 0
      ? "math-fuzz"
      : generatedAlignedFormulas.length > 0
        ? "aligned-fuzz"
        : "fixed",
    failures: failed,
  }, null, 2));
} else {
  console.log(JSON.stringify({ tolerance, results }, null, 2));
}
if (failed.length > 0) {
  process.exitCode = 1;
}

function compareFormula(formula, tolerance) {
  const ours = ourTrace(formula);
  let tex;
  try {
    tex = texTrace(formula);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      formula,
      ok: false,
      mismatches: [`TeX oracle failed: ${message}`],
      ours,
      tex: { items: [], width: 0 },
    };
  }
  const mismatches = [];
  if (!ours.supported) {
    mismatches.push(`our layout unsupported: ${ours.errors.map((error) => error.message).join("; ")}`);
    return { formula, ok: false, mismatches, ours, tex };
  }
  const compareItems = comparisonItemsForFormula(formula, ours.items, tex.items);
  if (compareItems.ours.length !== compareItems.tex.length) {
    mismatches.push(`item count differs: ours=${compareItems.ours.length} tex=${compareItems.tex.length}`);
  }
  const count = Math.min(compareItems.ours.length, compareItems.tex.length);
  for (let index = 0; index < count; index++) {
    const left = compareItems.ours[index];
    const right = compareItems.tex[index];
    if (left.kind !== right.kind) {
      mismatches.push(`item ${index} kind differs: ours=${left.kind} tex=${right.kind}`);
      continue;
    }
    if (left.kind === "glyph" && right.kind === "glyph") {
      if (left.fontId !== right.fontId || left.code !== right.code) {
        mismatches.push(`glyph ${index} differs: ours=${left.fontId}/${left.code} tex=${right.fontId}/${right.code}`);
      }
      compareNumber(mismatches, `glyph ${index} x`, left.x, right.x, tolerance);
      compareNumber(mismatches, `glyph ${index} y`, left.y, right.y, tolerance);
      compareNumber(mismatches, `glyph ${index} width`, left.width, right.width, tolerance);
    } else if (left.kind === "glue" && right.kind === "glue") {
      compareNumber(mismatches, `glue ${index} x`, left.x, right.x, tolerance);
      compareNumber(mismatches, `glue ${index} y`, left.y, right.y, tolerance);
      compareNumber(mismatches, `glue ${index} width`, left.width, right.width, tolerance);
    } else if (left.kind === "kern" && right.kind === "kern") {
      compareNumber(mismatches, `kern ${index} x`, left.x, right.x, tolerance);
      compareNumber(mismatches, `kern ${index} y`, left.y, right.y, tolerance);
      compareNumber(mismatches, `kern ${index} width`, left.width, right.width, tolerance);
    } else if (left.kind === "rule" && right.kind === "rule") {
      compareNumber(mismatches, `rule ${index} x`, left.x, right.x, tolerance);
      compareNumber(mismatches, `rule ${index} width`, left.width, right.width, tolerance);
      if (!isIndefiniteVerticalRuleTrace(right)) {
        compareNumber(mismatches, `rule ${index} y`, left.y, right.y, tolerance);
        compareNumber(mismatches, `rule ${index} height`, left.height, right.height, tolerance);
      }
    }
  }
  compareNumber(mismatches, "total width", ours.width, tex.width, tolerance);
  return {
    formula,
    ok: mismatches.length === 0,
    mismatches,
    ours,
    tex,
  };
}

function comparisonItemsForFormula(formula, ours, tex) {
  if (
    formula.includes(String.raw`\begin{aligned}`) ||
    hasArrayEnvironment(formula) ||
    hasCasesEnvironment(formula) ||
    hasSmallMatrixEnvironment(formula) ||
    hasMatrixEnvironment(formula) ||
    hasOperatorNameCommand(formula) ||
    hasBinomialCommand(formula) ||
    hasStyledFractionCommand(formula)
    || hasSubstackCommand(formula)
    || hasSubarrayEnvironment(formula)
    || hasSidesetCommand(formula)
    || hasAmsMathCommand(formula)
    || hasAccentCommand(formula)
    || hasMathtoolsColonRelationCommand(formula)
  ) {
    return {
      ours: visibleMathItems(ours),
      tex: visibleMathItems(tex),
    };
  }
  return { ours, tex };
}

function visibleMathItems(items) {
  return items.filter((item) =>
    item.kind === "glyph" ||
    (item.kind === "rule" && item.width !== 0)
  );
}

function isIndefiniteVerticalRuleTrace(item) {
  return item.kind === "rule" && item.height < 0;
}

function ourTrace(formula) {
  const parsed = parseTexMath(formula);
  const result = layoutTexMathList(parsed.list);
  if (!result.supported) {
    return {
      supported: false,
      errors: result.errors,
      items: [],
      width: 0,
    };
  }
  return {
    supported: true,
    items: flattenOurItems(result.hlist.items, 0, 0),
    width: result.hlist.width,
  };
}

function flattenOurItems(items, originX, originY) {
  const traceItems = [];
  for (const item of items) {
    if (item.kind === "hlist") {
      traceItems.push(...flattenOurItems(item.items, originX + item.x, originY + item.y));
      continue;
    }
    if (item.kind === "glyph") {
      traceItems.push({
        kind: "glyph",
        fontId: item.fontId,
        code: item.code,
        x: round(originX + item.x),
        y: round(originY + item.y),
        width: item.width,
      });
      continue;
    }
    if (item.kind === "rule") {
      traceItems.push({
        kind: "rule",
        x: round(originX + item.x),
        y: round(originY + item.y),
        width: item.width,
        height: item.height,
      });
      continue;
    }
    if (item.kind === "glue") {
      traceItems.push({
        kind: "glue",
        x: round(originX + item.x),
        y: round(originY),
        width: item.width,
      });
      continue;
    }
    traceItems.push({
      kind: "kern",
      x: round(originX + item.x),
      y: round(originY),
      width: item.width,
    });
  }
  return traceItems;
}

function texTrace(formula) {
  const tempDir = mkdtempSync(join(tmpdir(), "tikz-tex-math-compare-"));
  try {
    writeFileSync(join(tempDir, "trace.lua"), traceLuaSource(), "utf8");
    writeFileSync(join(tempDir, "case.tex"), texSource(formula), "utf8");
    execFileSync("lualatex", ["--interaction=nonstopmode", "--halt-on-error", "case.tex"], {
      cwd: tempDir,
      env: texOracleEnv(),
      stdio: "pipe",
      maxBuffer: 10 * 1024 * 1024,
    });
    const log = readFileSync(join(tempDir, "case.log"), "utf8");
    const items = [];
    let width = 0;
    for (const line of log.split(/\r?\n/)) {
      const glyph = /^TMT g x=(?<x>[-.\d]+) y=(?<y>[-.\d]+) f=(?<font>\S+) c=(?<char>\d+) w=(?<width>[-.\d]+)/.exec(line);
      if (glyph?.groups) {
        items.push({
          kind: "glyph",
          x: round(Number(glyph.groups.x)),
          y: round(Number(glyph.groups.y)),
          fontId: glyph.groups.font,
          code: Number(glyph.groups.char),
          width: round(Number(glyph.groups.width)),
        });
        continue;
      }
      const glue = /^TMT glue x=(?<x>[-.\d]+) y=(?<y>[-.\d]+) w=(?<width>[-.\d]+)/.exec(line);
      if (glue?.groups) {
        items.push({
          kind: "glue",
          x: round(Number(glue.groups.x)),
          y: round(Number(glue.groups.y)),
          width: round(Number(glue.groups.width)),
        });
        continue;
      }
      const kern = /^TMT kern x=(?<x>[-.\d]+) y=(?<y>[-.\d]+) w=(?<width>[-.\d]+)/.exec(line);
      if (kern?.groups) {
        items.push({
          kind: "kern",
          x: round(Number(kern.groups.x)),
          y: round(Number(kern.groups.y)),
          width: round(Number(kern.groups.width)),
        });
        continue;
      }
      const rule = /^TMT rule x=(?<x>[-.\d]+) y=(?<y>[-.\d]+) w=(?<width>[-.\d]+) h=(?<height>[-.\d]+)/.exec(line);
      if (rule?.groups) {
        items.push({
          kind: "rule",
          x: round(Number(rule.groups.x)),
          y: round(Number(rule.groups.y)),
          width: round(Number(rule.groups.width)),
          height: round(Number(rule.groups.height)),
        });
        continue;
      }
      const total = /^TMT width=(?<width>[-.\d]+)/.exec(line);
      if (total?.groups) {
        width = round(Number(total.groups.width));
      }
    }
    return { items, width };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function texSource(formula) {
  const amsmathPreamble = formula.includes(String.raw`\begin{aligned}`) ||
    hasMatrixEnvironment(formula) ||
    hasCasesEnvironment(formula) ||
    hasSmallMatrixEnvironment(formula) ||
    hasOperatorNameCommand(formula) ||
    hasBinomialCommand(formula) ||
    hasStyledFractionCommand(formula) ||
    hasSubstackCommand(formula) ||
    hasSubarrayEnvironment(formula) ||
    hasSidesetCommand(formula) ||
    hasEllipsisCommand(formula) ||
    hasAmsMathCommand(formula) ||
    hasAccentCommand(formula) ||
    hasAmsMathDelimiterCommand(formula) ||
    formula.includes(String.raw`\text`)
    ? String.raw`\usepackage{amsmath}` + "\n"
    : "";
  const arrayPreamble = hasArrayPackagePreambleExtension(formula)
    ? String.raw`\usepackage{array}` + "\n"
    : "";
  const amssymbPreamble = hasAmsSymbolCommand(formula)
    ? String.raw`\usepackage{amssymb}` + "\n"
    : "";
  const mathtoolsPreamble = hasMathtoolsColonRelationCommand(formula)
    ? String.raw`\usepackage{mathtools}` + "\n"
    : "";
  return String.raw`\documentclass{article}
` + amsmathPreamble + amssymbPreamble + mathtoolsPreamble + arrayPreamble + String.raw`
\newbox\m
\begin{document}
\setbox\m=\hbox{$` + formula + String.raw`$}
\directlua{dofile('trace.lua')}
\end{document}
`;
}

function traceLuaSource() {
  return String.raw`local glyph_id=node.id('glyph')
local glue_id=node.id('glue')
local kern_id=node.id('kern')
local rule_id=node.id('rule')
local hlist_id=node.id('hlist')
local vlist_id=node.id('vlist')
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

local walk_vlist
local function node_width(n)
  return sp(n.width or 0)
end
local function node_height(n)
  return sp(n.height or 0)
end
local function node_depth(n)
  return sp(n.depth or 0)
end
local function glue_order(n, stretch)
  if stretch then
    return n.stretch_order or (n.spec and n.spec.stretch_order) or 0
  end
  return n.shrink_order or (n.spec and n.spec.shrink_order) or 0
end
local function glue_natural_width(n)
  return sp(n.width or (n.spec and n.spec.width) or 0)
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
local function kern_width(n)
  return sp(n.kern or n.width or 0)
end

local function walk_hlist(list, origin_x, baseline_y, box)
  if not list then return origin_x end
  local x = origin_x
  for n in node.traverse(list) do
    if n.id==glyph_id then
      texio.write_nl(string.format('TMT g x=%.6f y=%.6f f=%s c=%d w=%.6f', x, baseline_y, font_name(n.font), n.char, node_width(n)))
      x=x+node_width(n)
    elseif n.id==glue_id then
      local w=glue_width(n, box)
      if glue_natural_width(n) ~= 0 then
        texio.write_nl(string.format('TMT glue x=%.6f y=%.6f w=%.6f', x, baseline_y, w))
      end
      x=x+w
    elseif n.id==kern_id then
      local w=kern_width(n)
      texio.write_nl(string.format('TMT kern x=%.6f y=%.6f w=%.6f', x, baseline_y, w))
      x=x+w
    elseif n.id==rule_id then
      texio.write_nl(string.format('TMT rule x=%.6f y=%.6f w=%.6f h=%.6f', x, baseline_y-node_height(n), node_width(n), node_height(n)+node_depth(n)))
      x=x+node_width(n)
    elseif n.id==hlist_id then
      walk_hlist(n.list, x, baseline_y + sp(n.shift or 0), n)
      x=x+node_width(n)
    elseif n.id==vlist_id then
      walk_vlist(n.list, x, baseline_y + sp(n.shift or 0), node_height(n), node_width(n))
      x=x+node_width(n)
    elseif n.id==disc_id then
      x=walk_hlist(n.replace, x, baseline_y, box)
    elseif n.id~=whatsit_id then
      x=x+node_width(n)
    end
  end
  return x
end

function walk_vlist(list, origin_x, baseline_y, height, width)
  local y = baseline_y - height
  for n in node.traverse(list) do
    if n.id==kern_id then
      y=y+kern_width(n)
    elseif n.id==glue_id then
      y=y+glue_width(n, nil)
    elseif n.id==hlist_id then
      local child_baseline = y + node_height(n)
      walk_hlist(n.list, origin_x + sp(n.shift or 0), child_baseline, n)
      y=y+node_height(n)+node_depth(n)
    elseif n.id==vlist_id then
      local child_baseline = y + node_height(n)
      walk_vlist(n.list, origin_x + sp(n.shift or 0), child_baseline, node_height(n), node_width(n))
      y=y+node_height(n)+node_depth(n)
    elseif n.id==rule_id then
      local rule_width = node_width(n)
      if rule_width < 0 then rule_width = width end
      texio.write_nl(string.format('TMT rule x=%.6f y=%.6f w=%.6f h=%.6f', origin_x, y, rule_width, node_height(n)+node_depth(n)))
      y=y+node_height(n)+node_depth(n)
    else
      y=y+node_height(n)+node_depth(n)
    end
  end
end
walk_hlist(tex.box.m.list, 0, 0, tex.box.m)
texio.write_nl(string.format('TMT width=%.6f', node_width(tex.box.m)))
`;
}

function compareNumber(mismatches, label, left, right, tolerance) {
  if (Math.abs(left - right) > tolerance) {
    mismatches.push(`${label} differs: ours=${left} tex=${right}`);
  }
}

function readArgs() {
  const formulas = [];
  let tolerance = 0.01;
  let alignedFuzzCases = 0;
  let mathFuzzCases = 0;
  let seed = 20260615;
  let summaryOnly = false;
  for (let index = 2; index < process.argv.length; index++) {
    const arg = process.argv[index] ?? "";
    if (arg === "--formula") {
      formulas.push(process.argv[++index] ?? "");
    } else if (arg.startsWith("--formula=")) {
      formulas.push(arg.slice("--formula=".length));
    } else if (arg === "--tolerance") {
      tolerance = Number(process.argv[++index] ?? tolerance);
    } else if (arg.startsWith("--tolerance=")) {
      tolerance = Number(arg.slice("--tolerance=".length));
    } else if (arg === "--aligned-fuzz") {
      alignedFuzzCases = readNonNegativeInteger(process.argv[++index] ?? "", "--aligned-fuzz");
    } else if (arg.startsWith("--aligned-fuzz=")) {
      alignedFuzzCases = readNonNegativeInteger(arg.slice("--aligned-fuzz=".length), "--aligned-fuzz");
    } else if (arg === "--math-fuzz") {
      mathFuzzCases = readNonNegativeInteger(process.argv[++index] ?? "", "--math-fuzz");
    } else if (arg.startsWith("--math-fuzz=")) {
      mathFuzzCases = readNonNegativeInteger(arg.slice("--math-fuzz=".length), "--math-fuzz");
    } else if (arg === "--seed") {
      seed = readNonNegativeInteger(process.argv[++index] ?? "", "--seed");
    } else if (arg.startsWith("--seed=")) {
      seed = readNonNegativeInteger(arg.slice("--seed=".length), "--seed");
    } else if (arg === "--summary-only") {
      summaryOnly = true;
    }
  }
  return { formulas, tolerance, alignedFuzzCases, mathFuzzCases, seed, summaryOnly };
}

function readNonNegativeInteger(raw, label) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Expected ${label} to be a non-negative integer.`);
  }
  return value;
}

function generateAlignedFuzzFormulas(cases, seed) {
  const rng = makeRng(seed);
  const formulas = [];
  for (let index = 0; index < cases; index++) {
    const rowCount = 1 + randomInt(rng, 3);
    const pairCount = 1 + randomInt(rng, 2);
    const rows = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const cells = [];
      for (let pairIndex = 0; pairIndex < pairCount; pairIndex++) {
        cells.push(randomLeftAlignedCell(rng));
        cells.push(`=${randomRightAlignedCell(rng)}`);
      }
      rows.push(cells.join("&"));
    }
    formulas.push(String.raw`\begin{aligned}` + rows.join(String.raw`\\`) + String.raw`\end{aligned}`);
  }
  return formulas;
}

function generateMathFuzzFormulas(cases, seed) {
  const rng = makeRng(seed);
  const formulas = [];
  for (let index = 0; index < cases; index++) {
    formulas.push(randomBoundedMathFormula(rng));
  }
  return formulas;
}

function randomBoundedMathFormula(rng) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const formula = randomMathFormula(rng);
    if (formula.length <= 140) {
      return formula;
    }
  }
  return String.raw`\frac{x_1}{y^2}`;
}

function randomMathFormula(rng) {
  const termCount = 1 + randomInt(rng, 3);
  let formula = randomMathTerm(rng, 0);
  for (let index = 1; index < termCount; index++) {
    formula += randomMathInfix(rng) + randomMathTerm(rng, 0);
  }
  return formula;
}

function randomMathTerm(rng, depth) {
  const choices = depth > 0
    ? ["atom", "group", "accent"]
    : ["atom", "group", "fraction", "binomial", "radical", "line", "accent", "left-right", "array", "cases", "smallmatrix", "matrix", "operatorname", "substack", "mbox", "text-command"];
  const choice = choices[randomInt(rng, choices.length)] ?? "atom";
  let term;
  if (choice === "fraction") {
    term = randomFractionFormula(rng, randomSimpleExpression(rng), randomSimpleExpression(rng));
  } else if (choice === "binomial") {
    term = randomBinomialFormula(rng);
  } else if (choice === "radical") {
    term = String.raw`\sqrt{` + randomSimpleExpression(rng) + "}";
  } else if (choice === "line") {
    term = randomLineFormula(rng, depth);
  } else if (choice === "accent") {
    if (randomInt(rng, 3) === 0) {
      return maybeWithScripts(randomScriptableAccentFormula(rng), rng, depth);
    }
    term = randomAccentFormula(rng, depth);
  } else if (choice === "left-right") {
    term = randomLeftRightFormula(rng);
  } else if (choice === "array") {
    term = randomArrayFormula(rng);
  } else if (choice === "cases") {
    term = randomCasesFormula(rng);
  } else if (choice === "smallmatrix") {
    term = randomSmallMatrixFormula(rng);
  } else if (choice === "matrix") {
    term = randomMatrixFormula(rng);
  } else if (choice === "operatorname") {
    term = randomOperatorNameFormula(rng);
  } else if (choice === "substack") {
    term = randomSubstackFormula(rng);
  } else if (choice === "mbox") {
    term = randomMBoxMathFormula(rng);
  } else if (choice === "text-command") {
    term = randomTextCommandMathFormula(rng);
  } else if (choice === "group") {
    term = "{" + randomSimpleExpression(rng) + "}";
  } else {
    term = randomMathAtom(rng);
  }
  return isScriptableGeneratedTerm(choice)
    ? maybeWithScripts(term, rng, depth)
    : term;
}

function isScriptableGeneratedTerm(choice) {
  return [
    "atom",
    "group",
    "fraction",
    "binomial",
    "radical",
    "line",
    "left-right",
    "operatorname",
    "mbox",
    "text-command",
  ].includes(choice);
}

function randomTextCommandContent(rng) {
  const plain = [
    "if",
    "case A",
    "node",
  ][randomInt(rng, 3)] ?? "if";
  const nested = [
    String.raw`\textbf{Bold}`,
    String.raw`\textbf{\textmd{Medium}}`,
    String.raw`\textit{\textup{Up}}`,
    String.raw`\texttt{Type}`,
    String.raw`\textsl{Slant}`,
  ][randomInt(rng, 5)] ?? String.raw`\textbf{Bold}`;
  return randomInt(rng, 3) === 0 ? nested : plain;
}

function randomTextCommandMathFormula(rng) {
  const command = kernelMathTextCommands[randomInt(rng, kernelMathTextCommands.length)] ?? String.raw`\textrm`;
  return command + "{" + randomTextCommandContent(rng) + "}";
}

function randomMBoxMathFormula(rng) {
  const content = [
    "if",
    "for all",
    " node ",
    "case A",
    String.raw`\textbf{Bold} text`,
    String.raw`\texttt{if}`,
    String.raw`\textit{\textup{if}}`,
    String.raw`$x+y$ text`,
    String.raw`\rule[1pt]{8pt}{0.8pt}`,
    String.raw`\raisebox{2pt}{up}`,
  ][randomInt(rng, 10)] ?? "if";
  const variant = randomInt(rng, 6);
  if (variant === 0) {
    return String.raw`\makebox{` + content + "}";
  }
  if (variant === 1) {
    const width = [String.raw`12pt`, String.raw`20pt`, String.raw`0.4in`][randomInt(rng, 3)] ?? String.raw`20pt`;
    const align = ["l", "c", "r"][randomInt(rng, 3)] ?? "c";
    return String.raw`\makebox[` + width + "][" + align + "]{" + content + "}";
  }
  if (variant === 2) {
    return String.raw`\makebox[24pt][s]{a b}`;
  }
  if (variant === 3) {
    return String.raw`\llap{` + content + "}";
  }
  if (variant === 4) {
    return String.raw`\rlap{` + content + "}";
  }
  return String.raw`\mbox{` + content + "}";
}

function randomFractionFormula(rng, numerator, denominator) {
  const command = fractionCommands[randomInt(rng, fractionCommands.length)] ?? String.raw`\frac`;
  return command + "{" + numerator + "}{" +
      denominator + "}";
}

function randomBinomialFormula(rng) {
  const command = binomialCommands[randomInt(rng, binomialCommands.length)] ?? String.raw`\binom`;
  return command + "{" + randomSimpleExpression(rng) + "}{" +
      randomSimpleExpression(rng) + "}";
}

function randomLineFormula(rng, depth = 0) {
  const command = lineCommands[randomInt(rng, lineCommands.length)] ?? String.raw`\overline`;
  return command + "{" + randomDecoratedExpression(rng, depth) + "}";
}

function randomAccentFormula(rng, depth = 0) {
  const command = accentCommands[randomInt(rng, accentCommands.length)] ?? String.raw`\hat`;
  const base = randomAccentBase(rng, depth);
  return command + "{" + base + "}";
}

function randomScriptableAccentFormula(rng) {
  const command = accentCommands[randomInt(rng, accentCommands.length)] ?? String.raw`\hat`;
  const base = [
    randomMathAtom(rng),
    randomPlainExpression(rng),
    randomFractionFormula(rng, randomMathAtom(rng), randomMathAtom(rng)),
    String.raw`\sqrt{` + randomPlainExpression(rng) + "}",
    simpleNestedAccentFormula(rng),
  ][randomInt(rng, 5)] ?? "x";
  return command + "{" + base + "}";
}

function simpleNestedAccentFormula(rng) {
  const command = accentCommands[randomInt(rng, accentCommands.length)] ?? String.raw`\tilde`;
  const base = randomNonEllipsisMathAtom(rng);
  return command + "{" + base + "}";
}

function randomAccentBase(rng, depth) {
  const choices = depth >= 2
    ? ["atom", "simple"]
    : ["atom", "simple", "fraction", "radical", "line", "accent"];
  const choice = choices[randomInt(rng, choices.length)] ?? "atom";
  if (choice === "simple") {
    return depth > 0 ? randomNonEllipsisMathAtom(rng) : randomSimpleExpression(rng);
  }
  if (choice === "fraction") {
    return randomFractionFormula(rng, randomMathAtom(rng), randomMathAtom(rng));
  }
  if (choice === "radical") {
    return String.raw`\sqrt{` + randomSimpleExpression(rng) + "}";
  }
  if (choice === "line") {
    return randomLineFormula(rng, depth + 1);
  }
  if (choice === "accent") {
    return randomAccentFormula(rng, depth + 1);
  }
  return depth > 0 ? randomNonEllipsisMathAtom(rng) : randomMathAtom(rng);
}

function randomDecoratedExpression(rng, depth) {
  const choices = depth >= 2
    ? ["simple", "fraction"]
    : ["simple", "fraction", "radical", "accent"];
  const choice = choices[randomInt(rng, choices.length)] ?? "simple";
  if (choice === "fraction") {
    return randomFractionFormula(rng, randomMathAtom(rng), randomMathAtom(rng));
  }
  if (choice === "radical") {
    return String.raw`\sqrt{` + randomSimpleExpression(rng) + "}";
  }
  if (choice === "accent") {
    return randomAccentFormula(rng, depth + 1);
  }
  return randomSimpleExpression(rng);
}

function randomSimpleExpression(rng) {
  const count = 1 + randomInt(rng, 3);
  let formula = maybeWithScripts(randomMathAtom(rng), rng, 1);
  for (let index = 1; index < count; index++) {
    formula += randomMathInfix(rng) + maybeWithScripts(randomMathAtom(rng), rng, 1);
  }
  return formula;
}

function randomPlainExpression(rng, atomFactory = randomMathAtom) {
  const count = 1 + randomInt(rng, 3);
  let formula = atomFactory(rng);
  for (let index = 1; index < count; index++) {
    formula += randomMathInfix(rng) + atomFactory(rng);
  }
  return formula;
}

function randomLeftRightFormula(rng) {
  const pairs = [
    ["(", ")"],
    ["[", "]"],
    [String.raw`\lbrace`, String.raw`\rbrace`],
    [String.raw`\langle`, String.raw`\rangle`],
    [String.raw`\lfloor`, String.raw`\rfloor`],
    [String.raw`\lceil`, String.raw`\rceil`],
    ["|", "|"],
    [String.raw`\Vert`, String.raw`\Vert`],
    ["/", String.raw`\backslash`],
  ];
  const [left, right] = pairs[randomInt(rng, pairs.length)] ?? ["(", ")"];
  const leftSeparator = left.startsWith("\\") ? " " : "";
  return String.raw`\left` + left + leftSeparator + randomSimpleExpression(rng) + String.raw`\right` + right;
}

function randomMatrixFormula(rng) {
  const environment = randomMatrixEnvironment(rng);
  const rowCount = 1 + randomInt(rng, 2);
  const columnCount = 1 + randomInt(rng, 3);
  const rows = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const cells = [];
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      cells.push(randomMatrixCell(rng));
    }
    rows.push(cells.join("&"));
  }
  return String.raw`\begin{` + environment + "}" + rows.join(String.raw`\\`) + String.raw`\end{` + environment + "}";
}

function randomArrayFormula(rng) {
  const columnCount = 1 + randomInt(rng, 3);
  const preamble = Array.from({ length: columnCount }, () =>
    ["l", "c", "r"][randomInt(rng, 3)] ?? "c"
  ).join("");
  const rowCount = 1 + randomInt(rng, 2);
  const rows = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const cells = [];
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      cells.push(randomMatrixCell(rng));
    }
    rows.push(cells.join("&"));
  }
  return String.raw`\begin{array}{` + preamble + "}" + rows.join(String.raw`\\`) + String.raw`\end{array}`;
}

function randomCasesFormula(rng) {
  const rowCount = 1 + randomInt(rng, 2);
  const rows = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    rows.push(randomMatrixCell(rng) + "&" + randomMatrixCell(rng));
  }
  return String.raw`\begin{cases}` + rows.join(String.raw`\\`) + String.raw`\end{cases}`;
}

function randomSmallMatrixFormula(rng) {
  const rowCount = 1 + randomInt(rng, 2);
  const columnCount = 1 + randomInt(rng, 3);
  const rows = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const cells = [];
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      cells.push(randomMatrixCell(rng));
    }
    rows.push(cells.join("&"));
  }
  return String.raw`\begin{smallmatrix}` + rows.join(String.raw`\\`) + String.raw`\end{smallmatrix}`;
}

function randomOperatorNameFormula(rng) {
  const names = ["rank", "cone", "span", String.raw`arg\,max`, String.raw`proj\,lim`];
  const command = randomInt(rng, 4) === 0 ? String.raw`\operatorname*` : String.raw`\operatorname`;
  const name = names[randomInt(rng, names.length)] ?? "rank";
  return command + "{" + name + "}";
}

function randomSubstackFormula(rng) {
  const rowCount = 2 + randomInt(rng, 2);
  const rows = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    rows.push(randomSubstackRow(rng));
  }
  return String.raw`\substack{` + rows.join(String.raw`\\`) + "}";
}

function randomSubstackRow(rng) {
  return [
    randomMathAtom(rng),
    `${randomMathAtom(rng)}=${randomMathAtom(rng)}`,
    `${randomMathAtom(rng)}+${randomMathAtom(rng)}`,
    String.raw`\frac{` + randomMathAtom(rng) + "}{" + randomMathAtom(rng) + "}",
  ][randomInt(rng, 4)] ?? "i";
}

function hasMatrixEnvironment(source) {
  return matrixEnvironments.some((environment) =>
    source.includes(String.raw`\begin{` + environment + "}")
  );
}

function hasArrayEnvironment(source) {
  return source.includes(String.raw`\begin{array}`);
}

function hasArrayPackagePreambleExtension(source) {
  return source.includes(String.raw`\begin{array}`) && /[!<>]\s*\{/u.test(source);
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

function randomMatrixEnvironment(rng) {
  return matrixEnvironments[randomInt(rng, matrixEnvironments.length)] ?? "matrix";
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

function hasSubarrayEnvironment(source) {
  return source.includes(String.raw`\begin{subarray}`);
}

function hasSidesetCommand(source) {
  return source.includes(String.raw`\sideset`);
}

function hasEllipsisCommand(source) {
  return source.includes(String.raw`\dots`) ||
    source.includes(String.raw`\ldots`) ||
    source.includes(String.raw`\cdots`);
}

function hasAmsMathCommand(source) {
  return amsMathCommands.some((command) => source.includes(command));
}

function hasAccentCommand(source) {
  return accentCommands.some((command) => source.includes(command));
}

function hasAmsMathDelimiterCommand(source) {
  return amsMathDelimiterCommands.some((command) => source.includes(command));
}

function hasAmsSymbolCommand(source) {
  return amsSymbolCommands.some((command) => source.includes(command));
}

function hasMathtoolsColonRelationCommand(source) {
  return mathtoolsColonRelationCommands.some((command) => source.includes(command));
}

function randomMatrixCell(rng) {
  return [
    randomMathAtom(rng),
    randomMathAtom(rng) + "_{" + randomMathAtom(rng) + "}",
    randomMathAtom(rng) + "^{" + randomMathAtom(rng) + "}",
    randomFractionFormula(rng, randomMathAtom(rng), randomMathAtom(rng)),
    String.raw`\binom{` + randomMathAtom(rng) + "}{" + randomMathAtom(rng) + "}",
  ][randomInt(rng, 5)] ?? "x";
}

function maybeWithScripts(term, rng, depth) {
  if (depth >= 2) {
    return term;
  }
  const scriptChoice = randomInt(rng, 5);
  if (scriptChoice === 0) {
    return term + "^{" + randomMathScript(rng, depth + 1) + "}";
  }
  if (scriptChoice === 1) {
    return term + "_{" + randomMathScript(rng, depth + 1) + "}";
  }
  if (scriptChoice === 2) {
    return term + "_{" + randomMathScript(rng, depth + 1) + "}^{" + randomMathScript(rng, depth + 1) + "}";
  }
  return term;
}

function randomMathScript(rng, depth) {
  if (depth >= 2) {
    return randomScriptAtom(rng);
  }
  const choices = [
    randomScriptAtom(rng),
    randomScriptAtom(rng) + "^{" + randomScriptAtom(rng) + "}",
    randomScriptAtom(rng) + "_{" + randomScriptAtom(rng) + "}",
    String.raw`\frac{` + randomScriptAtom(rng) + "}{" + randomScriptAtom(rng) + "}",
    String.raw`\binom{` + randomScriptAtom(rng) + "}{" + randomScriptAtom(rng) + "}",
    randomAccentFormula(rng, depth + 1),
    randomSubstackFormula(rng),
  ];
  return choices[randomInt(rng, choices.length)] ?? "x";
}

function randomMathAtom(rng) {
  const atoms = [
    "a", "b", "c", "x", "y", "z",
    "1", "2", "3",
    String.raw`\ldots`,
    String.raw`\cdots`,
    String.raw`\dots`,
    String.raw`\alpha`,
    String.raw`\beta`,
    String.raw`\gamma`,
    String.raw`\infty`,
    String.raw`\sum`,
  ];
  return atoms[randomInt(rng, atoms.length)] ?? "x";
}

function randomNonEllipsisMathAtom(rng) {
  const atoms = [
    "a", "b", "c", "x", "y", "z",
    "1", "2", "3",
    String.raw`\alpha`,
    String.raw`\beta`,
    String.raw`\gamma`,
    String.raw`\infty`,
    String.raw`\sum`,
  ];
  return atoms[randomInt(rng, atoms.length)] ?? "x";
}

function randomScriptAtom(rng) {
  const atoms = [
    "a", "b", "c", "x", "y", "z",
    "1", "2", "3",
    String.raw`\alpha`,
    String.raw`\beta`,
    String.raw`\gamma`,
    String.raw`\infty`,
    String.raw`\sum`,
  ];
  return atoms[randomInt(rng, atoms.length)] ?? "x";
}

function randomMathInfix(rng) {
  const infixes = ["+", "-", "=", String.raw` \leq `, String.raw` \in `, String.raw` \subset `];
  return infixes[randomInt(rng, infixes.length)] ?? "+";
}

function randomLeftAlignedCell(rng) {
  const cells = [
    "a",
    "b",
    "x_i",
    "y^2",
    String.raw`\frac{1}{2}`,
    String.raw`\sqrt{x}`,
    String.raw`\sum_i^n`,
  ];
  return cells[randomInt(rng, cells.length)] ?? "a";
}

function randomRightAlignedCell(rng) {
  const cells = [
    "a",
    "b",
    "x",
    "y",
    "z",
    "x_i",
    "y^2",
    String.raw`\frac{1}{2}`,
    String.raw`\sqrt{x}`,
  ];
  return cells[randomInt(rng, cells.length)] ?? "x";
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

function round(value) {
  return Number(value.toFixed(6));
}
