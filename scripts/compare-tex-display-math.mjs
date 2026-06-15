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

const args = readArgs();
const cases = args.cases.length > 0
  ? args.cases
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
    ];

const results = cases.map((caseSpec) => compareCase(caseSpec, args));
const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({ tolerance: args.tolerance, results }, null, 2));
if (failed.length > 0) {
  process.exitCode = 1;
}

function compareCase(caseSpec, args) {
  const tolerance = args.tolerance;
  const ours = ourTrace(caseSpec);
  const tex = texTrace(caseSpec, args);
  const mismatches = [];
  if (!ours.supported) {
    mismatches.push(`our layout unsupported: ${ours.errors.join("; ")}`);
    return { ...caseSpec, ok: false, mismatches, ours, tex };
  }
  compareTopLevelItems(mismatches, ours.topLevel, tex.topLevel, tolerance);
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
    item.kind === "paragraph" || item.kind === "display-math"
  );
  const texHlists = tex.filter((item) => item.kind === "hlist");
  compareItemLists(
    mismatches,
    "hlist",
    ourHlists.map(semanticHlistItem),
    texHlists,
    tolerance
  );

  const ourVerticalGlues = ours.filter((item) => item.kind === "glue");
  const texVerticalGlues = tex.filter((item) => item.kind === "glue");
  compareItemLists(mismatches, "vertical glue", ourVerticalGlues, texVerticalGlues, tolerance);
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
      sourceSpan: item.sourceSpan,
    })),
    glyphs: ourGlyphTraceFromReport(result.report),
  };
}

function ourGlyphTraceFromReport(report) {
  if (!report) {
    return [];
  }
  return report.lines.flatMap((line) =>
    line.segments.flatMap((segment) => {
      if (segment.kind !== "text" && segment.kind !== "math") {
        return [];
      }
      return [{
        kind: segment.kind,
        text: segment.text,
        x: round(segment.x),
        y: round(line.y ?? 0),
        width: round(segment.width),
      }];
    })
  );
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

function texSource(caseSpec) {
  return String.raw`\documentclass{article}
\newbox\tikzdisplaybox
\begin{document}
\setbox\tikzdisplaybox=\vbox{\hsize=` + caseSpec.width + String.raw`pt \noindent ` + caseSpec.source + String.raw`\par}
\directlua{dofile('trace.lua')}
\end{document}
`;
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
local whatsit_id=node.id('whatsit')
local function sp(v) return (v or 0)/65536 end
local function font_name(font_id)
  local registered=font.fonts and font.fonts[font_id]
  if registered and registered.name then return tostring(registered.name) end
  local ok, tex_name=pcall(function() return tex.fontname(font_id) end)
  if ok and tex_name then return tostring(tex_name) end
  local f=font.getfont(font_id)
  return tostring(f and (f.name or f.fontname or f.fullname or f.psname or f.filename))
end
local function node_width(n) return sp(n.width or 0) end
local function node_height(n) return sp(n.height or 0) end
local function node_depth(n) return sp(n.depth or 0) end
local function glue_width(n)
  return sp(n.width or (n.spec and n.spec.width) or 0)
end
local function kern_width(n) return sp(n.kern or n.width or 0) end
local function walk_hlist(list, origin_x, baseline_y)
  local x=origin_x
  for n in node.traverse(list) do
    if n.id==glyph_id then
      emit({kind='glyph', x=x, y=baseline_y, font=font_name(n.font), char=n.char, width=node_width(n)})
      x=x+node_width(n)
    elseif n.id==glue_id then
      x=x+glue_width(n)
    elseif n.id==kern_id then
      x=x+kern_width(n)
    elseif n.id==hlist_id then
      walk_hlist(n.list, x, baseline_y + sp(n.shift or 0))
      x=x+node_width(n)
    elseif n.id==vlist_id then
      walk_vlist(n.list, x, baseline_y + sp(n.shift or 0), node_height(n), 1)
      x=x+node_width(n)
    elseif n.id~=whatsit_id then
      x=x+node_width(n)
    end
  end
end
function walk_vlist(list, origin_x, top_y, height, level)
  local y=top_y
  local index=0
  for n in node.traverse(list) do
    if n.id==glue_id then
      local size=glue_width(n)
      if level==0 then emit({scope='top', kind='glue', index=index, y=y, size=size}) end
      y=y+size
    elseif n.id==kern_id then
      y=y+kern_width(n)
    elseif n.id==hlist_id then
      local child_y=y
      local baseline=child_y+node_height(n)
      if level==0 then emit({scope='top', kind='hlist', index=index, x=origin_x + sp(n.shift or 0), y=child_y, width=node_width(n), height=node_height(n), depth=node_depth(n)}) end
      walk_hlist(n.list, origin_x + sp(n.shift or 0), baseline)
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
walk_vlist(tex.box.tikzdisplaybox.list, 0, 0, node_height(tex.box.tikzdisplaybox), 0)
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
  let tolerance = 0.05;
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
    }
  }
  return { cases, keepTemp, tolerance };
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
