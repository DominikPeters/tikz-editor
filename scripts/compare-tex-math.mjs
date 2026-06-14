#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  layoutTexMathList,
  parseTexMath,
} from "../packages/core/dist/text/tex/math/index.js";
import { texOracleEnv } from "./lib/tex-oracle.mjs";

const args = readArgs();
const formulas = args.formulas.length > 0
  ? args.formulas
  : ["a+1", "x-y", "xy", "a=b", "(z)"];
const tolerance = args.tolerance;
const results = formulas.map((formula) => compareFormula(formula, tolerance));
const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({ tolerance, results }, null, 2));
if (failed.length > 0) {
  process.exitCode = 1;
}

function compareFormula(formula, tolerance) {
  const ours = ourTrace(formula);
  const tex = texTrace(formula);
  const mismatches = [];
  if (!ours.supported) {
    mismatches.push(`our layout unsupported: ${ours.errors.map((error) => error.message).join("; ")}`);
    return { formula, ok: false, mismatches, ours, tex };
  }
  if (ours.items.length !== tex.items.length) {
    mismatches.push(`item count differs: ours=${ours.items.length} tex=${tex.items.length}`);
  }
  const count = Math.min(ours.items.length, tex.items.length);
  for (let index = 0; index < count; index++) {
    const left = ours.items[index];
    const right = tex.items[index];
    if (left.kind !== right.kind) {
      mismatches.push(`item ${index} kind differs: ours=${left.kind} tex=${right.kind}`);
      continue;
    }
    if (left.kind === "glyph" && right.kind === "glyph") {
      if (left.fontId !== right.fontId || left.code !== right.code) {
        mismatches.push(`glyph ${index} differs: ours=${left.fontId}/${left.code} tex=${right.fontId}/${right.code}`);
      }
      compareNumber(mismatches, `glyph ${index} x`, left.x, right.x, tolerance);
      compareNumber(mismatches, `glyph ${index} width`, left.width, right.width, tolerance);
    } else if (left.kind === "glue" && right.kind === "glue") {
      compareNumber(mismatches, `glue ${index} x`, left.x, right.x, tolerance);
      compareNumber(mismatches, `glue ${index} width`, left.width, right.width, tolerance);
    } else if (left.kind === "kern" && right.kind === "kern") {
      compareNumber(mismatches, `kern ${index} x`, left.x, right.x, tolerance);
      compareNumber(mismatches, `kern ${index} width`, left.width, right.width, tolerance);
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
    items: result.hlist.items.map((item) => {
      if (item.kind === "glyph") {
        return {
          kind: "glyph",
          fontId: item.fontId,
          code: item.code,
          x: item.x,
          width: item.width,
        };
      }
      if (item.kind === "glue") {
        return {
          kind: "glue",
          x: item.x,
          width: item.width,
        };
      }
      return {
        kind: "kern",
        x: item.x,
        width: item.width,
      };
    }),
    width: result.hlist.width,
  };
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
      const glyph = /^TIKZ_MATH_TRACE glyph x=(?<x>[-.\d]+) font=(?<font>\S+) char=(?<char>\d+) width=(?<width>[-.\d]+)/.exec(line);
      if (glyph?.groups) {
        items.push({
          kind: "glyph",
          x: round(Number(glyph.groups.x)),
          fontId: glyph.groups.font,
          code: Number(glyph.groups.char),
          width: round(Number(glyph.groups.width)),
        });
        continue;
      }
      const glue = /^TIKZ_MATH_TRACE glue x=(?<x>[-.\d]+) width=(?<width>[-.\d]+)/.exec(line);
      if (glue?.groups) {
        items.push({
          kind: "glue",
          x: round(Number(glue.groups.x)),
          width: round(Number(glue.groups.width)),
        });
        continue;
      }
      const kern = /^TIKZ_MATH_TRACE kern x=(?<x>[-.\d]+) width=(?<width>[-.\d]+)/.exec(line);
      if (kern?.groups) {
        items.push({
          kind: "kern",
          x: round(Number(kern.groups.x)),
          width: round(Number(kern.groups.width)),
        });
        continue;
      }
      const total = /^TIKZ_MATH_TRACE width=(?<width>[-.\d]+)/.exec(line);
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
  return String.raw`\documentclass{article}
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
local function sp(v) return (v or 0)/65536 end
local x = 0
for n in node.traverse(tex.box.m.list) do
  if n.id==glyph_id then
    local f=font.getfont(n.font)
    texio.write_nl(string.format('TIKZ_MATH_TRACE glyph x=%.6f font=%s char=%d width=%.6f', x, tostring(f and f.name), n.char, sp(n.width)))
    x=x+sp(n.width)
  elseif n.id==glue_id then
    local w=n.width or (n.spec and n.spec.width) or 0
    texio.write_nl(string.format('TIKZ_MATH_TRACE glue x=%.6f width=%.6f', x, sp(w)))
    x=x+sp(w)
  elseif n.id==kern_id then
    local w=n.kern or n.width
    texio.write_nl(string.format('TIKZ_MATH_TRACE kern x=%.6f width=%.6f', x, sp(w)))
    x=x+sp(w)
  end
end
texio.write_nl(string.format('TIKZ_MATH_TRACE width=%.6f', x))
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
    }
  }
  return { formulas, tolerance };
}

function round(value) {
  return Number(value.toFixed(6));
}
