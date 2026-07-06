#!/usr/bin/env node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ensureDistBuildFresh } from "./ensure-dist-build.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT_DIR = join(repoRoot, "artifacts", "paragraph-break-compare");
const DEFAULT_ALIGNMENTS = ["left", "justify", "center", "right"];
const DEFAULT_WIDTHS = [120, 160, 220, 280, 360];
const DEFAULT_CASE_COUNT = 25;
const DEFAULT_MIN_WORDS = 20;
const DEFAULT_MAX_WORDS = 90;
const DEFAULT_WORD_BANK_TEXT = `
Lorem ipsum dolor sit amet consectetuer adipiscing elit Aenean commodo ligula eget dolor
Aenean massa Cum sociis natoque penatibus et magnis dis parturient montes nascetur ridiculus mus
Donec quam felis ultricies nec pellentesque eu pretium quis sem Nulla consequat massa quis enim
Donec pede justo fringilla vel aliquet nec vulputate eget arcu In enim justo rhoncus ut imperdiet a
venenatis vitae justo Nullam dictum felis eu pede mollis pretium Integer tincidunt Cras dapibus
Vivamus elementum semper nisi Aenean vulputate eleifend tellus Aenean leo ligula porttitor eu
consequat vitae eleifend ac enim Aliquam lorem ante dapibus in viverra quis feugiat a tellus
Phasellus viverra nulla ut metus varius laoreet Quisque rutrum Aenean imperdiet Etiam ultricies nisi
vel augue Curabitur ullamcorper ultricies nisi Nam eget dui Etiam rhoncus Maecenas tempus tellus eget
condimentum rhoncus sem quam semper libero sit amet adipiscing sem neque sed ipsum Nam quam nunc
blandit vel luctus pulvinar hendrerit id lorem Maecenas nec odio et ante tincidunt tempus Donec vitae
sapien ut libero venenatis faucibus Nullam quis ante
`;

const LIGATURE_NORMALIZATION = new Map([
  ["\uFB00", "ff"],
  ["\uFB01", "fi"],
  ["\uFB02", "fl"],
  ["\uFB03", "ffi"],
  ["\uFB04", "ffl"],
  ["\uFB05", "ft"],
  ["\uFB06", "st"],
]);

function usage() {
  return `
Usage:
  node scripts/compare-paragraph-breaks.mjs --text "..." [--align left] [--width 380]
  node scripts/compare-paragraph-breaks.mjs --fuzz 100 [--seed 123] [--out-dir path]

Options:
  --text <text>          Plain paragraph text to compare.
  --input <file>         Read plain paragraph text from a file.
  --align <mode>         One of left, right, center, justify. Default: left.
  --width <pt>           Text width in pt. Default: 380.
  --fuzz <count>         Run randomized comparisons instead of a single case.
  --seed <n>             Seed for reproducible fuzzing.
  --alignments <csv>     Fuzz alignments. Default: left,justify,center,right
  --widths <csv>         Fuzz widths in pt. Default: 120,160,220,280,360
  --min-words <n>        Fuzz minimum word count. Default: 20
  --max-words <n>        Fuzz maximum word count. Default: 90
  --word-bank <file>     Plain text file used to build the fuzz word bank.
  --out-dir <dir>        Artifact output root.
  --help                 Show this message.
`.trim();
}

function parseArgs(argv) {
  const options = {
    text: null,
    inputPath: null,
    align: "left",
    widthPt: 380,
    fuzzCount: 0,
    seed: 12345,
    alignments: [...DEFAULT_ALIGNMENTS],
    widths: [...DEFAULT_WIDTHS],
    minWords: DEFAULT_MIN_WORDS,
    maxWords: DEFAULT_MAX_WORDS,
    wordBankPath: null,
    outDir: DEFAULT_OUT_DIR,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--text" && next != null) {
      options.text = next;
      i += 1;
      continue;
    }
    if (arg === "--input" && next != null) {
      options.inputPath = resolve(next);
      i += 1;
      continue;
    }
    if (arg === "--align" && next != null) {
      options.align = next;
      i += 1;
      continue;
    }
    if (arg === "--width" && next != null) {
      options.widthPt = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--fuzz" && next != null) {
      options.fuzzCount = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--seed" && next != null) {
      options.seed = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--alignments" && next != null) {
      options.alignments = next.split(",").map((entry) => entry.trim()).filter(Boolean);
      i += 1;
      continue;
    }
    if (arg === "--widths" && next != null) {
      options.widths = next.split(",").map((entry) => Number(entry.trim())).filter(Number.isFinite);
      i += 1;
      continue;
    }
    if (arg === "--min-words" && next != null) {
      options.minWords = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--max-words" && next != null) {
      options.maxWords = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--word-bank" && next != null) {
      options.wordBankPath = resolve(next);
      i += 1;
      continue;
    }
    if (arg === "--out-dir" && next != null) {
      options.outDir = resolve(next);
      i += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  return options;
}

function commandExists(command) {
  const result = spawnSync("which", [command], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "case";
}

function createSeededRng(seed) {
  let state = (seed >>> 0) || 1;
  return function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rng, min, maxInclusive) {
  return min + Math.floor(rng() * (maxInclusive - min + 1));
}

function sampleOne(rng, values) {
  return values[Math.floor(rng() * values.length)];
}

function normalizeVisibleText(text) {
  let normalized = text;
  for (const [ligature, replacement] of LIGATURE_NORMALIZATION) {
    normalized = normalized.split(ligature).join(replacement);
  }
  return normalized.replace(/[ \t\r\n]+$/g, "");
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapePlainTextForTeX(text) {
  const unsupported = /[\\{}%#$&_~^]/;
  if (unsupported.test(text)) {
    throw new Error(
      "Paragraph compare script currently supports plain text without TeX special characters \\ { } % # $ & _ ~ ^."
    );
  }
  return text
    .replaceAll("\r\n", " ")
    .replaceAll("\n", " ")
    .replaceAll("\r", " ");
}

function buildTikzSnippet({ text, align, widthPt }) {
  return String.raw`\begin{tikzpicture}
  \node[align=${align}, text width=${widthPt}pt] at (0,0) {${escapePlainTextForTeX(text)}};
\end{tikzpicture}`;
}

function buildWordBank(sourceText) {
  return [...new Set(
    sourceText
      .split(/[^A-Za-z]+/)
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word.length >= 3)
  )];
}

function titleCaseWord(word) {
  return word.length ? word[0].toUpperCase() + word.slice(1) : word;
}

function buildRandomParagraph(rng, wordBank, options) {
  const count = randomInt(rng, options.minWords, options.maxWords);
  const pieces = [];
  let capitalizeNext = true;

  for (let index = 0; index < count; index += 1) {
    let word = sampleOne(rng, wordBank);
    if (capitalizeNext) {
      word = titleCaseWord(word);
      capitalizeNext = false;
    }
    pieces.push(word);

    const roll = rng();
    if (index === count - 1) {
      pieces[pieces.length - 1] += ".";
      continue;
    }
    if (roll < 0.12) {
      pieces[pieces.length - 1] += ".";
      capitalizeNext = true;
    } else if (roll < 0.23) {
      pieces[pieces.length - 1] += ",";
    } else if (roll < 0.27) {
      pieces[pieces.length - 1] += ";";
    }
  }

  return pieces.join(" ");
}

function luaStringLiteral(value) {
  return `[=[${value.replaceAll("]=]", "]=] .. ']=]' .. [=[")}]=]`;
}

function buildLuaTeXOracleScript({ outputPath, align, widthPt }) {
  const luaOutputPath = luaStringLiteral(outputPath);
  const luaAlign = luaStringLiteral(align);

  return String.raw`
  local node = node
  local glyph_id = node.id("glyph")
  local glue_id = node.id("glue")
  local kern_id = node.id("kern")
  local hlist_id = node.id("hlist")
  local vlist_id = node.id("vlist")
  local disc_id = node.id("disc")
  local penalty_id = node.id("penalty")
  local ligatures = {
    [0xFB00] = "ff",
    [0xFB01] = "fi",
    [0xFB02] = "fl",
    [0xFB03] = "ffi",
    [0xFB04] = "ffl",
    [0xFB05] = "ft",
    [0xFB06] = "st",
  }
  local function json_escape(value)
    local backslash = string.char(92)
    local quote = string.char(34)
    value = value:gsub(backslash, backslash .. backslash)
    value = value:gsub(quote, backslash .. quote)
    value = value:gsub(string.char(10), backslash .. "n")
    value = value:gsub(string.char(13), backslash .. "r")
    value = value:gsub(string.char(9), backslash .. "t")
    return quote .. value .. quote
  end
  local function glyph_text(n)
    local replacement = ligatures[n.char]
    if replacement then
      return replacement
    end
    return utf8.char(n.char)
  end
  local function line_text(list)
    local parts = {}
    local has_vlist = false
    local cur = list
    while cur do
      if cur.id == glyph_id then
        parts[#parts + 1] = glyph_text(cur)
      elseif cur.id == glue_id and (cur.width or 0) > 0 then
        parts[#parts + 1] = " "
      elseif cur.id == hlist_id then
        local nested, nested_has_vlist = line_text(cur.list)
        if #nested > 0 then
          parts[#parts + 1] = nested
        end
        has_vlist = has_vlist or nested_has_vlist
      elseif cur.id == vlist_id then
        has_vlist = true
        local nested = line_text(cur.list)
        if #nested > 0 then
          parts[#parts + 1] = nested
        end
      elseif cur.id == disc_id then
        -- Inactive discretionary nodes remain inside line boxes; selected
        -- line-break hyphens are already materialized as glyphs.
      end
      cur = cur.next
    end
    local text = table.concat(parts)
    return (text:gsub("%s+$", "")), has_vlist
  end
  local function sp_to_pt(value)
    return (value or 0) / 65536
  end
  local function finite_glue_metric(glue, field)
    local order = glue[field .. "_order"] or 0
    if order ~= 0 then
      return 0
    end
    return glue[field] or 0
  end
  local function list_metrics(list)
    local width = 0
    local stretch = 0
    local shrink = 0
    local cur = list
    while cur do
      if cur.id == glyph_id or cur.id == kern_id then
        width = width + (cur.width or 0)
      elseif cur.id == glue_id then
        width = width + (cur.width or 0)
        stretch = stretch + finite_glue_metric(cur, "stretch")
        shrink = shrink + finite_glue_metric(cur, "shrink")
      elseif cur.id == hlist_id or cur.id == vlist_id then
        width = width + (cur.width or 0)
      elseif cur.id == disc_id then
        -- A selected discretionary replacement is materialized in the line;
        -- inactive discretionary alternatives do not contribute natural width.
      elseif cur.id == penalty_id then
        -- Penalties do not contribute horizontal width.
      end
      cur = cur.next
    end
    return width, stretch, shrink
  end
  local function glue_sign_name(value)
    if value == 1 then
      return "stretching"
    end
    if value == 2 then
      return "shrinking"
    end
    return "normal"
  end
  local function estimated_badness(ratio)
    if ratio == nil then
      return nil
    end
    local absolute = math.abs(ratio)
    if absolute == math.huge then
      return 10000
    end
    local badness = math.floor(100 * absolute * absolute * absolute + 0.5)
    if badness > 10000 then
      return 10000
    end
    return badness
  end
  local lines = {}
  local function collect_lines(list)
    local cur = list
    while cur do
      if cur.id == hlist_id and cur.list then
        local width_pt = (cur.width or 0) / 65536
        local text, has_vlist = line_text(cur.list)
        if not has_vlist and #text > 0 and math.abs(width_pt - ${widthPt}) < 0.05 then
          local natural_width, stretch, shrink = list_metrics(cur.list)
          local delta = (cur.width or 0) - natural_width
          local ratio = nil
          if delta > 0 and stretch > 0 then
            ratio = delta / stretch
          elseif delta < 0 and shrink > 0 then
            ratio = delta / shrink
          elseif delta ~= 0 then
            ratio = math.huge
          else
            ratio = 0
          end
          lines[#lines + 1] = {
            text = text,
            hyphenated = text:sub(-1) == "-",
            widthPt = width_pt,
            naturalWidthPt = sp_to_pt(natural_width),
            finiteStretchPt = sp_to_pt(stretch),
            finiteShrinkPt = sp_to_pt(shrink),
            glueSet = cur.glue_set or 0,
            glueSign = glue_sign_name(cur.glue_sign or 0),
            glueOrder = cur.glue_order or 0,
            badness = estimated_badness(ratio),
          }
        end
      end
      if cur.list then
        collect_lines(cur.list)
      end
      cur = cur.next
    end
  end
  local box = tex.box[0]
  collect_lines(box.list)
  local out = {}
  local quote = string.char(34)
  out[#out + 1] = "{"
  out[#out + 1] = quote .. "alignment" .. quote .. ":" .. json_escape(${luaAlign}) .. ","
  out[#out + 1] = quote .. "widthPt" .. quote .. ":" .. tostring(${widthPt}) .. ","
  out[#out + 1] = quote .. "lineCount" .. quote .. ":" .. tostring(#lines) .. ","
  out[#out + 1] = quote .. "lines" .. quote .. ":["
  for i, line in ipairs(lines) do
    if i > 1 then
      out[#out + 1] = ","
    end
    out[#out + 1] =
      "{"
      .. quote .. "index" .. quote .. ":" .. tostring(i - 1) .. ","
      .. quote .. "text" .. quote .. ":" .. json_escape(line.text) .. ","
      .. quote .. "hyphenated" .. quote .. ":" .. tostring(line.hyphenated) .. ","
      .. quote .. "widthPt" .. quote .. ":" .. string.format("%.6f", line.widthPt)
      .. ","
      .. quote .. "naturalWidthPt" .. quote .. ":" .. string.format("%.6f", line.naturalWidthPt)
      .. ","
      .. quote .. "finiteStretchPt" .. quote .. ":" .. string.format("%.6f", line.finiteStretchPt)
      .. ","
      .. quote .. "finiteShrinkPt" .. quote .. ":" .. string.format("%.6f", line.finiteShrinkPt)
      .. ","
      .. quote .. "glueSet" .. quote .. ":" .. string.format("%.9f", line.glueSet)
      .. ","
      .. quote .. "glueSign" .. quote .. ":" .. json_escape(line.glueSign)
      .. ","
      .. quote .. "glueOrder" .. quote .. ":" .. tostring(line.glueOrder)
      .. ","
      .. quote .. "badness" .. quote .. ":" .. tostring(line.badness or "null")
      .. "}"
  end
  out[#out + 1] = "]}"
  local file = assert(io.open(${luaOutputPath}, "w"))
  file:write(table.concat(out))
  file:close()
`;
}

function buildLuaTeXOracleDocument({ text, align, widthPt }) {
  const snippet = buildTikzSnippet({ text, align, widthPt });

  return String.raw`\documentclass{standalone}
\usepackage[T1]{fontenc}
\usepackage{tikz}
\begin{document}
\makeatletter
\pretolerance=100
\tolerance=200
\hyphenpenalty=50
\exhyphenpenalty=50
\adjdemerits=10000
\doublehyphendemerits=10000
\finalhyphendemerits=5000
\emergencystretch=0pt
\setbox0=\hbox{${snippet}}
\directlua{dofile("oracle.lua")}
\end{document}
`;
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function runLuaTeXOracle(caseSpec, caseDir) {
  if (!commandExists("lualatex")) {
    throw new Error("lualatex command not found.");
  }

  const workDir = mkdtempSync(join(tmpdir(), "tikz-editor-luatex-oracle-"));
  const texPath = join(workDir, "oracle.tex");
  const luaPath = join(workDir, "oracle.lua");
  const oracleJsonTempPath = join(workDir, "oracle.json");
  const oracleJsonPath = join(caseDir, "oracle.json");
  const oracleLogPath = join(caseDir, "oracle.log");

  try {
    const texSource = buildLuaTeXOracleDocument(caseSpec);
    const luaSource = buildLuaTeXOracleScript({
      outputPath: "oracle.json",
      align: caseSpec.align,
      widthPt: caseSpec.widthPt,
    });
    writeFileSync(texPath, texSource, "utf8");
    writeFileSync(luaPath, luaSource, "utf8");
    writeFileSync(join(caseDir, "oracle.tex"), texSource, "utf8");
    writeFileSync(join(caseDir, "oracle.lua"), luaSource, "utf8");
    const result = runCommand(
      "lualatex",
      ["-interaction=nonstopmode", "-halt-on-error", "oracle.tex"],
      { cwd: workDir }
    );
    writeFileSync(oracleLogPath, `${result.stdout ?? ""}\n${result.stderr ?? ""}`, "utf8");
    if (result.status !== 0) {
      throw new Error(`lualatex failed with exit code ${result.status}. See ${oracleLogPath}`);
    }
    if (!existsSync(oracleJsonTempPath)) {
      throw new Error(`LuaTeX oracle did not produce ${basename(oracleJsonPath)}.`);
    }
    writeFileSync(oracleJsonPath, readFileSync(oracleJsonTempPath, "utf8"), "utf8");
    return JSON.parse(readFileSync(oracleJsonPath, "utf8"));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function loadRendererModules() {
  const distEntry = ensureDistBuildFresh(repoRoot);
  const coreModule = await import(pathToFileURL(distEntry).href);
  const mathJaxModule = await import(
    pathToFileURL(resolve(repoRoot, "packages/core/dist/text/mathjax-engine.js")).href
  );
  const knuthPlassModule = await import(
    pathToFileURL(resolve(repoRoot, "packages/core/dist/text/knuth-plass/index.js")).href
  );
  return {
    renderTikzToSvgAsync: coreModule.renderTikzToSvgAsync,
    getActiveMathJaxOutputJax: mathJaxModule.getActiveMathJaxOutputJax,
    getKnuthPlassReportsFromOutputJax: knuthPlassModule.getKnuthPlassReportsFromOutputJax,
  };
}

function normalizeLineTextFromSegments(segments) {
  const text = segments
    .map((segment) => (segment.kind === "text" || segment.kind === "space" ? segment.text ?? "" : ""))
    .join("");
  return normalizeVisibleText(text);
}

async function runOurRenderer(caseSpec, caseDir, renderer) {
  const source = buildTikzSnippet(caseSpec);
  const sourcePath = join(caseDir, "input.tikz");
  writeFileSync(sourcePath, source, "utf8");

  const result = await renderer.renderTikzToSvgAsync(source);
  writeFileSync(join(caseDir, "ours.svg"), result.svg.svg, "utf8");

  const textElement = result.semantic.scene.elements.find((element) => element.kind === "Text");
  if (!textElement || textElement.kind !== "Text") {
    throw new Error("Renderer output does not contain a scene text element.");
  }
  if (textElement.textRenderInfo?.mode !== "mathjax") {
    throw new Error("Renderer output for the compared case is not MathJax-backed text.");
  }

  const paragraphId = textElement.textRenderInfo.paragraphId;
  const outputJax = renderer.getActiveMathJaxOutputJax();
  const reports = renderer.getKnuthPlassReportsFromOutputJax(outputJax);
  const report = [...reports].reverse().find((entry) => entry.paragraphId === paragraphId) ?? null;
  if (!report) {
    throw new Error(`Could not find paragraph report for ${paragraphId ?? "null"}.`);
  }

  const payload = {
    paragraphId,
    alignment: report.alignment,
    layoutMode: report.layoutMode,
    linebreakingMode: report.linebreakingMode,
    errors: report.errors,
    lines: report.lines.map((line) => {
      const text = normalizeLineTextFromSegments(line.segments);
      return {
        index: line.lineIndex,
        text,
        hyphenated: text.endsWith("-"),
        xStart: line.xStart,
        xEnd: line.xEnd,
        naturalWidth: line.naturalWidth,
        targetWidth: line.targetWidth,
        badness: line.badness,
        glueSetRatio: line.glueSetRatio,
        spaceCount: line.spaceCount,
        spaceDeltaPerGap: line.spaceDeltaPerGap,
        breakKind: line.break?.kind ?? null,
      };
    }),
  };

  writeFileSync(join(caseDir, "ours.json"), JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function compareParagraphLines(oracle, ours) {
  const oracleLines = oracle.lines ?? [];
  const ourLines = ours.lines ?? [];
  const maxLines = Math.max(oracleLines.length, ourLines.length);
  const perLine = [];
  let exactTextAgreement = true;
  let exactHyphenAgreement = true;

  for (let index = 0; index < maxLines; index += 1) {
    const oracleLine = oracleLines[index] ?? null;
    const ourLine = ourLines[index] ?? null;
    const textMatches = (oracleLine?.text ?? null) === (ourLine?.text ?? null);
    const hyphenMatches =
      (oracleLine?.hyphenated ?? null) === (ourLine?.hyphenated ?? null);
    exactTextAgreement &&= textMatches;
    exactHyphenAgreement &&= hyphenMatches;
    perLine.push({
      index,
      textMatches,
      hyphenMatches,
      oracle: oracleLine,
      ours: ourLine,
    });
  }

  return {
    exactLineTextAgreement: exactTextAgreement && oracleLines.length === ourLines.length,
    exactHyphenAgreement: exactHyphenAgreement && oracleLines.length === ourLines.length,
    lineCountAgreement: oracleLines.length === ourLines.length,
    perLine,
  };
}

function writeHtmlReport(runDir, summary, cases) {
  const rows = cases
    .map((entry) => {
      const status =
        entry.status === "ok"
          ? entry.comparison.exactLineTextAgreement
            ? "match"
            : "mismatch"
          : entry.status;
      return `<tr>
<td>${escapeHtml(entry.id)}</td>
<td>${escapeHtml(entry.align)}</td>
<td>${entry.widthPt}</td>
<td>${status}</td>
<td>${entry.oracle?.lines.length ?? "-"}</td>
<td>${entry.ours?.lines.length ?? "-"}</td>
<td>${escapeHtml(entry.ours?.linebreakingMode ?? entry.errorStage ?? "unknown")}</td>
<td><a href="./${entry.slug}/case.json">case.json</a></td>
</tr>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Paragraph Break Compare</title>
<style>
body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 24px; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
th { background: #f5f5f5; }
</style>
<h1>Paragraph Break Compare</h1>
<pre>${escapeHtml(JSON.stringify(summary, null, 2))}</pre>
<table>
<thead>
<tr><th>Case</th><th>Align</th><th>Width</th><th>Status</th><th>Oracle Lines</th><th>Our Lines</th><th>Our Mode</th><th>Artifact</th></tr>
</thead>
<tbody>
${rows}
</tbody>
</table>
</html>`;

  writeFileSync(join(runDir, "index.html"), html, "utf8");
}

async function runCase(caseSpec, renderer, runDir, index) {
  const slug = `${String(index + 1).padStart(3, "0")}-${slugify(`${caseSpec.align}-${caseSpec.widthPt}-${caseSpec.text.slice(0, 48)}`)}`;
  const caseDir = join(runDir, slug);
  mkdirSync(caseDir, { recursive: true });

  try {
    const oracle = runLuaTeXOracle(caseSpec, caseDir);
    const ours = await runOurRenderer(caseSpec, caseDir, renderer);
    const comparison = compareParagraphLines(oracle, ours);
    const payload = {
      status: "ok",
      id: caseSpec.id,
      slug,
      align: caseSpec.align,
      widthPt: caseSpec.widthPt,
      text: caseSpec.text,
      oracle,
      ours,
      comparison,
    };
    writeFileSync(join(caseDir, "case.json"), JSON.stringify(payload, null, 2), "utf8");
    return payload;
  } catch (error) {
    const payload = {
      status: "error",
      errorStage: existsSync(join(caseDir, "oracle.json")) ? "renderer" : "oracle",
      error: error instanceof Error ? error.message : String(error),
      id: caseSpec.id,
      slug,
      align: caseSpec.align,
      widthPt: caseSpec.widthPt,
      text: caseSpec.text,
    };
    writeFileSync(join(caseDir, "case.json"), JSON.stringify(payload, null, 2), "utf8");
    return payload;
  }
}

function summarizeCases(cases, seed) {
  const comparableCases = cases.filter((entry) => entry.status === "ok");
  const totalComparable = comparableCases.length || 1;
  const exactLineMatches = comparableCases.filter((entry) => entry.comparison.exactLineTextAgreement).length;
  const exactHyphenMatches = comparableCases.filter((entry) => entry.comparison.exactHyphenAgreement).length;
  const lineCountMatches = comparableCases.filter((entry) => entry.comparison.lineCountAgreement).length;
  const byAlign = {};

  for (const entry of cases) {
    const key = entry.align;
    const bucket = byAlign[key] ?? {
      cases: 0,
      comparableCases: 0,
      errorCases: 0,
      exactLineMatches: 0,
      exactHyphenMatches: 0,
      lineCountMatches: 0,
    };
    bucket.cases += 1;
    if (entry.status === "ok") {
      bucket.comparableCases += 1;
      bucket.exactLineMatches += entry.comparison.exactLineTextAgreement ? 1 : 0;
      bucket.exactHyphenMatches += entry.comparison.exactHyphenAgreement ? 1 : 0;
      bucket.lineCountMatches += entry.comparison.lineCountAgreement ? 1 : 0;
    } else {
      bucket.errorCases += 1;
    }
    byAlign[key] = bucket;
  }

  return {
    seed,
    cases: cases.length,
    comparableCases: comparableCases.length,
    errorCases: cases.length - comparableCases.length,
    exactLineTextAgreementRate: exactLineMatches / totalComparable,
    exactHyphenAgreementRate: exactHyphenMatches / totalComparable,
    lineCountAgreementRate: lineCountMatches / totalComparable,
    byAlign,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  if (options.widthPt <= 0 || !Number.isFinite(options.widthPt)) {
    throw new Error(`Invalid width: ${options.widthPt}`);
  }

  mkdirSync(options.outDir, { recursive: true });
  const runDir = join(options.outDir, timestampSlug());
  mkdirSync(runDir, { recursive: true });

  const renderer = await loadRendererModules();
  const cases = [];

  if (options.fuzzCount > 0) {
    const rng = createSeededRng(options.seed);
    const wordBankSource = options.wordBankPath
      ? readFileSync(options.wordBankPath, "utf8")
      : DEFAULT_WORD_BANK_TEXT;
    const wordBank = buildWordBank(wordBankSource);
    if (!wordBank.length) {
      throw new Error("Word bank is empty.");
    }

    for (let index = 0; index < options.fuzzCount; index += 1) {
      const caseSpec = {
        id: `fuzz-${index + 1}`,
        align: sampleOne(rng, options.alignments),
        widthPt: sampleOne(rng, options.widths),
        text: buildRandomParagraph(rng, wordBank, options),
      };
      const payload = await runCase(caseSpec, renderer, runDir, index);
      cases.push(payload);
      if (payload.status === "ok") {
        const marker = payload.comparison.exactLineTextAgreement ? "match" : "mismatch";
        console.log(
          `[paragraph-compare] ${caseSpec.id}: ${caseSpec.align} ${caseSpec.widthPt}pt ${marker} ` +
            `oracle=${payload.oracle.lines.length} ours=${payload.ours.lines.length} mode=${payload.ours.linebreakingMode}`
        );
      } else {
        console.log(
          `[paragraph-compare] ${caseSpec.id}: ${caseSpec.align} ${caseSpec.widthPt}pt error ` +
            `stage=${payload.errorStage} ${payload.error}`
        );
      }
    }
  } else {
    const text = options.text ?? (options.inputPath ? readFileSync(options.inputPath, "utf8") : null);
    if (!text) {
      throw new Error("Provide either --text, --input, or --fuzz.");
    }
    const caseSpec = {
      id: "single-case",
      align: options.align,
      widthPt: options.widthPt,
      text,
    };
    const payload = await runCase(caseSpec, renderer, runDir, 0);
    if (payload.status !== "ok") {
      throw new Error(payload.error);
    }
    cases.push(payload);
    console.log(JSON.stringify(payload, null, 2));
  }

  const summary = summarizeCases(cases, options.seed);
  writeFileSync(join(runDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  writeHtmlReport(runDir, summary, cases);
  console.log(`[paragraph-compare] wrote report to ${runDir}`);
}

main().catch((error) => {
  console.error(`[paragraph-compare] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
