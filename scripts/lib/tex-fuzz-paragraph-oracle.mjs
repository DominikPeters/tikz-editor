import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { TexFuzzDiskCache, texFuzzCacheKey } from "./tex-fuzz-cache.mjs";
import { texFuzzOracleEnvironment } from "./tex-fuzz-oracle.mjs";
import { texOracleEnv } from "./tex-oracle.mjs";

export const TEX_FUZZ_PARAGRAPH_ORACLE_VERSION = "paragraph-lines-v1";

/**
 * Compare our paragraph report with a TeX observation at the first useful
 * semantic layers. Space widths are scaled points and tolerate 0.02pt.
 * @param {{ readonly lines: readonly { readonly segments: readonly { readonly kind: string, readonly text?: string, readonly width: number }[] }[] }} report
 * @param {ParagraphOracleObservation} tex
 */
export function compareTexFuzzParagraphGeometry(report, tex) {
  const oursLines = report.lines.map((line) => ({
    text: line.segments.map((segment) => segment.text ?? "").join("").trim(),
    spacesSp: line.segments.filter((segment) => segment.kind === "space")
      .map((segment) => Math.round(segment.width * 65_536)),
  }));
  const texLines = tex.lines.map((line) => ({ text: line.text.trim(), spacesSp: line.interwordWidthsSp }));
  const lineTextMatch = JSON.stringify(oursLines.map((line) => line.text))
    === JSON.stringify(texLines.map((line) => line.text));
  const maxSpaceDeltaSp = lineTextMatch ? oursLines.reduce((maximum, line, lineIndex) => {
    const texLine = texLines[lineIndex];
    if (!texLine || line.spacesSp.length !== texLine.spacesSp.length) return Number.POSITIVE_INFINITY;
    return Math.max(maximum, ...line.spacesSp.map((space, spaceIndex) =>
      Math.abs(space - (texLine.spacesSp[spaceIndex] ?? space))
    ));
  }, 0) : Number.POSITIVE_INFINITY;
  return {
    matches: lineTextMatch && maxSpaceDeltaSp <= 1_311,
    code: lineTextMatch ? "paragraph-space-width" : "paragraph-line-text",
    maxSpaceDeltaSp,
    oursLines,
    texLines,
  };
}

/** @typedef {{ readonly id: string, readonly source: string, readonly width: number }} ParagraphOracleCase */
/** @typedef {{ readonly index: number, readonly widthSp: number, readonly glueSet: number, readonly glueSign: number, readonly text: string, readonly interwordWidthsSp: readonly number[] }} ParagraphOracleLine */
/** @typedef {{ readonly id: string, readonly supported: boolean, readonly lines: readonly ParagraphOracleLine[], readonly error?: string }} ParagraphOracleObservation */

const luaTrace = String.raw`
local glyph_id = node.id("glyph")
local glue_id = node.id("glue")
local hlist_id = node.id("hlist")
local vlist_id = node.id("vlist")
local disc_id = node.id("disc")
tfz_out = assert(io.open("geometry.tsv", "w"))
local function hex(value)
  return (value:gsub(".", function(char) return string.format("%02x", string.byte(char)) end))
end
local function glyph_text(n)
  if n.components then
    local parts = {}
    for component in node.traverse(n.components) do parts[#parts + 1] = glyph_text(component) end
    if #parts > 0 then return table.concat(parts) end
  end
  local ligatures = { [11]="ff", [12]="fi", [13]="fl", [14]="ffi", [15]="ffl",
    [0xFB00]="ff", [0xFB01]="fi", [0xFB02]="fl", [0xFB03]="ffi", [0xFB04]="ffl" }
  return ligatures[n.char] or utf8.char(n.char)
end
local function line_text(list)
  local parts = {}
  local cur = list
  while cur do
    if cur.id == glyph_id then parts[#parts + 1] = glyph_text(cur)
    elseif cur.id == glue_id and (cur.width or 0) > 0 then parts[#parts + 1] = " "
    elseif cur.id == hlist_id and cur.list then parts[#parts + 1] = line_text(cur.list)
    elseif cur.id == disc_id and (cur.replace or cur.no_break) then
      parts[#parts + 1] = line_text(cur.replace or cur.no_break)
    end
    cur = cur.next
  end
  return (table.concat(parts):gsub("%s+$", ""))
end
local function interword_widths(line)
  local values = {}
  local cur = line.list
  while cur do
    if cur.id == glue_id and (cur.width or 0) > 0 then
      local width = cur.width or 0
      if line.glue_sign == 1 and (cur.stretch_order or 0) == (line.glue_order or 0) then
        width = width + (line.glue_set or 0) * (cur.stretch or 0)
      elseif line.glue_sign == 2 and (cur.shrink_order or 0) == (line.glue_order or 0) then
        width = width - (line.glue_set or 0) * (cur.shrink or 0)
      end
      values[#values + 1] = tostring(math.floor(width + 0.5))
    end
    cur = cur.next
  end
  return #values > 0 and table.concat(values, ",") or "-"
end
function tfz_emit(token, width_sp)
  local line_index = 0
  local function visit(list)
    local cur = list
    while cur do
      if cur.id == hlist_id and cur.list and math.abs((cur.width or 0) - width_sp) <= 2 then
        tfz_out:write("TFZG " .. token .. " " .. tostring(line_index)
          .. " " .. tostring(cur.width or 0) .. " " .. string.format("%.12g", cur.glue_set or 0)
          .. " " .. tostring(cur.glue_sign or 0) .. " " .. hex(line_text(cur.list))
          .. " " .. interword_widths(cur) .. "\n")
        line_index = line_index + 1
      elseif (cur.id == hlist_id or cur.id == vlist_id) and cur.list then visit(cur.list) end
      cur = cur.next
    end
  end
  visit(tex.box.tfzbox.list)
  tfz_out:write("TFZG-END " .. token .. " " .. tostring(line_index) .. "\n")
end`;

/** @param {readonly ParagraphOracleCase[]} cases */
function document(cases) {
  const bodies = cases.map((item, index) => {
    const token = `c${index}`;
    const widthSp = Math.round(item.width * 65_536);
    return String.raw`\begingroup
\setbox\tfzbox=\vbox{\hsize=${item.width}pt\parindent=0pt\noindent ${item.source}\par}
\directlua{tfz_emit("${token}", ${widthSp})}
\endgroup`;
  }).join("\n");
  return String.raw`\documentclass{article}
\usepackage{xcolor}
\usepackage{amsmath,amssymb}
\pagestyle{empty}
\newbox\tfzbox
\begin{document}
\hyphenpenalty=10000
\exhyphenpenalty=10000
\directlua{dofile("trace.lua")}
${bodies}
\directlua{tfz_out:close()}
\end{document}`;
}

/** @param {string} log @param {readonly ParagraphOracleCase[]} cases */
function parse(log, cases) {
  /** @type {Map<string, ParagraphOracleLine[]>} */
  const lines = new Map();
  for (const match of log.matchAll(/^TFZG (c\d+) (\d+) (-?\d+) ([^ ]+) (\d+) ([0-9a-f]*) ([0-9,-]+)$/gm)) {
    const token = match[1];
    const entries = lines.get(token) ?? [];
    entries.push({
      index: Number(match[2]),
      widthSp: Number(match[3]),
      glueSet: Number(match[4]),
      glueSign: Number(match[5]),
      text: Buffer.from(match[6], "hex").toString("utf8"),
      interwordWidthsSp: match[7] === "-" ? [] : match[7].split(",").map(Number),
    });
    lines.set(token, entries);
  }
  return cases.map((item, index) => ({ id: item.id, supported: lines.has(`c${index}`), lines: lines.get(`c${index}`) ?? [] }));
}

/** @param {readonly ParagraphOracleCase[]} cases @param {{ engine: string, timeoutMs: number }} options */
function compile(cases, options) {
  const directory = mkdtempSync(join(tmpdir(), "tikz-tex-fuzz-paragraph-"));
  const started = performance.now();
  try {
    writeFileSync(join(directory, "oracle.tex"), document(cases), "utf8");
    writeFileSync(join(directory, "trace.lua"), luaTrace, "utf8");
    execFileSync(options.engine, ["--interaction=batchmode", "--halt-on-error", "--draftmode", "oracle.tex"], {
      cwd: directory,
      env: texOracleEnv(),
      stdio: "ignore",
      timeout: options.timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
    });
    return { ok: true, elapsedMs: performance.now() - started, observations: parse(readFileSync(join(directory, "geometry.tsv"), "utf8"), cases) };
  } catch (error) {
    return { ok: false, elapsedMs: performance.now() - started, error: error instanceof Error ? error.message : String(error) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * Batched paragraph oracle with failure bisection and content-addressed cache.
 * @param {readonly ParagraphOracleCase[]} cases
 * @param {{ engine?: string, timeoutMs?: number, batchSize?: number, cacheDir?: string }} [options]
 */
export function runBatchedTexParagraphOracle(cases, options = {}) {
  const engine = options.engine ?? "lualatex";
  const timeoutMs = options.timeoutMs ?? 30_000;
  const batchSize = options.batchSize ?? 32;
  const environment = { ...texFuzzOracleEnvironment(engine), paragraphRunner: TEX_FUZZ_PARAGRAPH_ORACLE_VERSION };
  const cache = options.cacheDir ? new TexFuzzDiskCache(options.cacheDir) : undefined;
  const stats = { compilations: 0, elapsedMs: 0, bisectedFailures: 0, cacheHits: 0, cacheWrites: 0 };
  /** @type {Map<string, ParagraphOracleObservation>} */
  const observations = new Map();
  const misses = cases.filter((item) => {
    if (!cache) return true;
    const key = texFuzzCacheKey({ source: item.source, preamble: `width=${item.width}`, layer: "paragraph-lines", environment });
    const cached = cache.get(key);
    if (!cached || typeof cached !== "object") return true;
    stats.cacheHits += 1;
    observations.set(item.id, { id: item.id, ...cached });
    return false;
  });
  /** @param {readonly ParagraphOracleCase[]} batch @returns {ParagraphOracleObservation[]} */
  const execute = (batch) => {
    stats.compilations += 1;
    const result = compile(batch, { engine, timeoutMs });
    stats.elapsedMs += result.elapsedMs;
    if (result.ok) return result.observations;
    if (batch.length === 1) return [{ id: batch[0].id, supported: false, lines: [], error: result.error }];
    stats.bisectedFailures += 1;
    const middle = Math.floor(batch.length / 2);
    return [...execute(batch.slice(0, middle)), ...execute(batch.slice(middle))];
  };
  for (let offset = 0; offset < misses.length; offset += batchSize) {
    const batch = misses.slice(offset, offset + batchSize);
    const results = execute(batch);
    results.forEach((result, index) => {
      const item = batch[index];
      observations.set(item.id, result);
      if (cache) {
        const { id: _id, ...cached } = result;
        cache.set(texFuzzCacheKey({ source: item.source, preamble: `width=${item.width}`, layer: "paragraph-lines", environment }), cached);
        stats.cacheWrites += 1;
      }
    });
  }
  return { observations: cases.map((item) => observations.get(item.id)), stats, environment };
}
