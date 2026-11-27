#!/usr/bin/env node
// Scan the arXiv pgfplots corpus harvested by scripts/harvest-pgfplots-corpus.mjs
// and tally feature usage per distinct paper (a proxy for distinct authors).
//
// Reads artifacts/pgfplots-corpus/state.json and src/<id>/, writes
//   artifacts/pgfplots-corpus/report.json
//   artifacts/pgfplots-corpus/report.md
//   artifacts/pgfplots-corpus/axes/<id>/<nn>.tex  (+ axes/index.json)
//
// Key names are taken from what the corpus itself uses, classified against
// the key list documented in pgfplots-docs/ (manual sources only). pgfplots
// implementation files are never read: the harvester does not extract them,
// and this scanner skips the same name patterns defensively.
//
// Usage:
//   node scripts/scan-pgfplots-corpus.mjs [--corpus artifacts/pgfplots-corpus]
//     [--docs pgfplots-docs] [--no-snippets]

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const FORBIDDEN_NAME = /^(pgfplots|tikzlibrarypgfplots|pgflibrary)|\.code\.tex$|\.lua$/i;
const SOURCE_EXT = /\.(tex|tikz|pgf|sty|cls)$/i;
const AXIS_ENVS = [
  "axis", "semilogxaxis", "semilogyaxis", "loglogaxis", "groupplot",
  "polaraxis", "ternaryaxis", "smithchart"
];
const AXIS_ENV_RE = new RegExp(String.raw`\\begin\s*\{(${AXIS_ENVS.join("|")})\}`, "g");
const GENERATORS = [
  ["matlab2tikz", /matlab2tikz/i],
  ["tikzplotlib", /tikzplotlib|matplotlib2tikz/i],
  ["PGFPlotsX", /PGFPlotsX/],
  ["Julia Plots", /Plots\.jl/]
];

function parseArgs(argv) {
  const options = { corpus: "artifacts/pgfplots-corpus", docs: "pgfplots-docs", snippets: true };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--corpus") options.corpus = argv[++i];
    else if (arg === "--docs") options.docs = argv[++i];
    else if (arg === "--no-snippets") options.snippets = false;
    else if (arg === "--debug-paper") options.debugPaper = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

// --- documented key names (from the manual sources) -------------------------

function documentedKeys(docsDir) {
  const keys = new Set();
  if (!existsSync(docsDir)) return keys;
  const envRe = /\\begin\{([A-Za-z]*(?:key|keylist|plottype))\}\s*(?:\[[^\]]*\]\s*)?\{/g;
  const addName = (rawName) => {
    let name = rawName.replace(/\\(marg|meta|mchoice|oarg|declare)\{[^}]*\}/g, "")
      .split("=")[0].replace(/\((initially|default)[^)]*\)?/, "");
    name = name.replace(/\\([xyz])\\\s/g, "@$1@ ").replace(/\\([xyz])(?![A-Za-z])\s*/g, "@$1@")
      .replace(/\\space\b\s*/g, " ").replace(/\\\s/g, " ").replace(/\|/g, "");
    name = name.replace(/^\s*\/(pgfplots|tikz|pgf)\//, "").replace(/\s+/g, " ").trim();
    if (!name || /[\\{}$]/.test(name)) return;
    const variants = /@[xyz]@/.test(name) ? ["x", "y", "z"].map((axis) => name.replace(/@[xyz]@/g, axis)) : [name];
    for (const variant of variants) keys.add(variant.replace(/\/\.(style|code|append style)$/, "").replace(/\s+/g, " ").trim());
  };
  for (const file of readdirSync(docsDir)) {
    if (!/^pgfplots.*\.tex$/.test(file) || /\.code\.tex$/.test(file)) continue;
    const text = readFileSync(join(docsDir, file), "utf8");
    for (const match of text.matchAll(envRe)) {
      const start = match.index + match[0].length - 1;
      const end = matchBrace(text, start, "{", "}");
      if (end < 0) continue;
      const body = text.slice(start + 1, end).replace(/%\n\s*/g, "");
      const items = /list$/.test(match[1]) ? splitTopLevel(body, ",") : [body];
      for (const item of items) addName(item);
    }
    for (const match of text.matchAll(/\\pgfplotsshortstylekey\s+([^=]+)=/g)) addName(match[1]);
  }
  return keys;
}

// --- low-level TeX scanning ---------------------------------------------------

// Length-preserving: comments become spaces so offsets match the raw text.
function stripComments(text) {
  return text.replace(/(^|[^\\])(%.*)$/gm, (_, pre, comment) => pre + " ".repeat(comment.length));
}

function generatorNear(raw, start) {
  const window = raw.slice(Math.max(0, start - 1500), start);
  for (const [name, re] of GENERATORS) if (re.test(window)) return name;
  return null;
}

// Signatures of generated axes when the header comment was removed.
function generatorBySignature(envOptions) {
  const keys = new Map(envOptions.map((e) => [e.key, e.value ?? ""]));
  if (keys.has("axis background") && keys.has("scale only axis") && /\bin\b|in\)/.test(keys.get("at") ?? "")) return "matlab2tikz (signature)";
  if (/!\d+\.\d{6,}!/.test(`${keys.get("x grid style") ?? ""} ${keys.get("y grid style") ?? ""}`)) return "tikzplotlib (signature)";
  return null;
}

// Given text[pos] === open, return index of the matching close (or -1).
function matchBrace(text, pos, open, close) {
  let depth = 0;
  let braceDepth = 0;
  for (let i = pos; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") { i++; continue; }
    if (open === "[") {
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
      if (braceDepth > 0) continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipWs(text, pos) {
  while (pos < text.length && /\s/.test(text[pos])) pos++;
  return pos;
}

function readOptional(text, pos) {
  const at = skipWs(text, pos);
  if (text[at] !== "[") return { value: null, end: pos };
  const end = matchBrace(text, at, "[", "]");
  if (end < 0) return { value: null, end: pos };
  return { value: text.slice(at + 1, end), end: end + 1 };
}

function readGroup(text, pos) {
  const at = skipWs(text, pos);
  if (text[at] !== "{") return { value: null, end: pos };
  const end = matchBrace(text, at, "{", "}");
  if (end < 0) return { value: null, end: pos };
  return { value: text.slice(at + 1, end), end: end + 1 };
}

function splitTopLevel(text, separator, { parens = true } = {}) {
  const parts = [];
  let depth = 0;
  let paren = 0;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") { current += ch + (text[i + 1] ?? ""); i++; continue; }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth = Math.max(0, depth - 1);
    else if (parens && depth === 0 && ch === "(") paren++;
    else if (parens && depth === 0 && ch === ")") paren = Math.max(0, paren - 1);
    if (ch === separator && depth === 0 && paren === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  if (parens && paren > 0) return splitTopLevel(text, separator, { parens: false });
  return parts.map((part) => part.trim()).filter(Boolean);
}

function unbrace(value) {
  const v = value.trim();
  if (v.startsWith("{") && matchBrace(v, 0, "{", "}") === v.length - 1) return v.slice(1, -1).trim();
  return v;
}

// --- option-list normalisation ---------------------------------------------

const BASE_COLORS = new Set([
  "red", "green", "blue", "cyan", "magenta", "yellow", "black", "gray", "grey", "white",
  "darkgray", "lightgray", "brown", "lime", "olive", "orange", "pink", "purple", "teal", "violet"
]);

// Common TikZ keys (styling/placement). Treated as supported from Phase 1
// since the editor already renders TikZ paths and nodes.
const TIKZ_KEYS = new Set(`
thick thin very thick very thin ultra thick ultra thin semithick line width
dashed dotted densely dashed loosely dashed densely dotted loosely dotted dash pattern dash phase
dashdotted densely dashdotted loosely dashdotted dashdotdotted densely dashdotdotted solid dash
color draw fill fill opacity opacity draw opacity text opacity text font scale xscale yscale
shift xshift yshift rotate anchor inner sep outer sep inner xsep inner ysep align text width
minimum size minimum width minimum height rounded corners sharp corners line cap line join
miter limit smooth tension pos above below left right above left above right below left
below right pin label transform shape baseline node distance shading pattern pattern color
postaction preaction double double distance decorate decoration overlay remember picture
nodes every node shape circle rectangle sloped midway near start near end at start at end
draw=none fill=none text depth text height every path every label every pin
font arrows > < >= line width rotate around shorten > shorten < shade top color bottom color
left color right color ball color inner color outer color even odd rule nonzero rule
mark mark options mark size every mark mark phase mark repeat mark indices
radius x radius y radius trim left trim right use as bounding box clip local bounding box
execute at begin node execute at end node
`.trim().split(/\s+/));
// Multi-word keys (the single-word split above only keeps one-word keys right).
for (const k of [
  "very thick", "very thin", "ultra thick", "ultra thin", "line width", "densely dashed",
  "loosely dashed", "densely dotted", "loosely dotted", "dash pattern", "dash phase",
  "densely dashdotted", "loosely dashdotted", "densely dashdotdotted", "fill opacity",
  "draw opacity", "text opacity", "inner sep", "outer sep", "inner xsep", "inner ysep",
  "text width", "minimum size", "minimum width", "minimum height", "rounded corners",
  "sharp corners", "line cap", "line join", "miter limit", "above left", "above right",
  "below left", "below right", "transform shape", "node distance", "pattern color",
  "double distance", "remember picture", "every node", "near start", "near end", "at start",
  "at end", "text depth", "text height", "every path", "every label", "every pin",
  "shorten >", "shorten <", "rotate around", "top color", "bottom color", "left color",
  "right color", "ball color", "inner color", "outer color", "even odd rule", "nonzero rule",
  "mark options", "mark size", "every mark", "mark phase", "mark repeat", "mark indices",
  "x radius", "y radius", "trim left", "trim right", "use as bounding box", "local bounding box",
  "execute at begin node", "execute at end node", "line legend", "style", "every picture", "dash dot", "dash dot dot", "name path", "name path global", "cells", "nodes", "row sep", "column sep", "every axis label/.append style", "text", "font", "anchor"
]) TIKZ_KEYS.add(k);

function isArrowSpec(entry) {
  return /^[<>|()[\]A-Za-z0-9.' ]*-[<>|()[\]A-Za-z0-9.' ]*$/.test(entry)
    && !/\s-\s/.test(entry) && entry.length <= 24 && /[<>|[\]]|latex|stealth|to|Latex|Stealth|triangle|Straight/.test(entry);
}

function isColorSpec(entry, paper) {
  if (paper.colors.has(entry)) return true;
  if (/^[A-Za-z][A-Za-z0-9]*(!\s*[\d.]+(\s*!\s*[A-Za-z][A-Za-z0-9]*)?)+(!\s*[\d.]+)?$/.test(entry)) return true;
  if (BASE_COLORS.has(entry)) return true;
  return /^[A-Z][a-z]+([A-Z][a-z]*)+$|^[A-Z][a-z]+$/.test(entry); // dvipsnames/svgnames CamelCase
}

// Normalise one option entry -> { key, handler, value } or a pseudo-key.
function normEntry(entry, paper) {
  const text = entry.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.startsWith("\\")) return { key: "(macro in options)", value: text };
  const eq = findTopEquals(text);
  let key = eq < 0 ? text : text.slice(0, eq).trim();
  const value = eq < 0 ? null : text.slice(eq + 1).trim();
  key = key.replace(/^\/(pgfplots|tikz|pgf)\//, "").replace(/^\/pgfplots\/table\//, "table/");
  let handler = null;
  const handlerMatch = /\/\.(style|append style|prefix style|code|cd|estyle|default|initial|add|style 2 args|style n args|list|value forbidden|is choice|search also)(\s*\d+\s*\{\d+\})?$/.exec(key);
  if (handlerMatch) {
    handler = handlerMatch[1];
    key = key.slice(0, handlerMatch.index);
  }
  if (eq < 0 && !handler) {
    if (isArrowSpec(text)) return { key: "(arrow spec)", value: text };
    if (paper && !paper.knownKey(text) && isColorSpec(text, paper)) return { key: "(color)", value: text };
  }
  if (/^every axis plot no \d+$/.test(key)) key = "every axis plot no N";
  if (/^colormap\/./.test(key)) key = "colormap/<name>";
  if (/^cycle list\/./.test(key)) key = "cycle list/<name>";
  return { key, handler, value };
}

function findTopEquals(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") { i++; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === "=" && depth === 0) return i;
  }
  return -1;
}

// Parse an option list. `.cd` switches the key family for following keys.
function parseOptions(text, paper) {
  const out = [];
  let family = "";
  for (const raw of splitTopLevel(text, ",")) {
    const entry = normEntry(raw, paper);
    if (!entry) continue;
    if (entry.handler === "cd") {
      family = entry.key === "pgfplots" || entry.key === "tikz" || entry.key === "" ? "" : `${entry.key}/`;
      continue;
    }
    if (family && !entry.key.startsWith("(")) entry.key = family + entry.key;
    out.push(entry);
  }
  return out;
}

// Keys whose value is itself a (plot/axis) style we want to look into.
const STYLE_CONTAINERS = new Set([
  "every axis plot", "every axis plot post", "every axis", "every axis plot no N",
  "group style", "every axis legend", "error bars", "every node near coord",
  "nodes near coords style"
]);

// --- per-paper scanning -------------------------------------------------------

function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      const st = statSync(path, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isDirectory()) walk(path);
      else if (st.isFile() && SOURCE_EXT.test(name) && !FORBIDDEN_NAME.test(name)) out.push(path);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

function findEnvEnd(text, env, from) {
  const re = new RegExp(String.raw`\\(begin|end)\s*\{${env}\}`, "g");
  re.lastIndex = from;
  let depth = 1;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    depth += m[1] === "begin" ? 1 : -1;
    if (depth === 0) return { start: m.index, end: m.index + m[0].length };
  }
  return null;
}

function classifyTable(content) {
  const v = content.trim();
  if (/^\\[A-Za-z@]+$/.test(v)) return "table-macro";
  if (/\n/.test(v) || /\\\\/.test(v) || /^\S+\s+\S+/.test(v) && /\d/.test(v) && !/\.(dat|csv|txt|tsv|data|tab|out)\b/i.test(v)) return "table-inline";
  return "table-file";
}

function parseAddplots(body, paper) {
  const plots = [];
  const re = /\\addplot(3)?\b\s*(\+)?/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const plot = { is3d: Boolean(m[1]), plus: Boolean(m[2]), options: [], tableOptions: [], input: "other", extras: [] };
    let pos = m.index + m[0].length;
    const opts = readOptional(body, pos);
    if (opts.value !== null) { plot.options = parseOptions(opts.value, paper); pos = opts.end; }
    pos = skipWs(body, pos);
    // Old syntax: \addplot plot[...] ...
    if (/^plot\b/.test(body.slice(pos, pos + 5))) {
      pos += 4;
      const o2 = readOptional(body, pos);
      if (o2.value !== null) { plot.options.push(...parseOptions(o2.value, paper)); pos = o2.end; }
      pos = skipWs(body, pos);
    }
    const rest = body.slice(pos, pos + 40);
    let kw = /^(coordinates|table|expression|gnuplot|shell|file|graphics|fill between|function)\b/.exec(rest)?.[1];
    if (kw) {
      pos += kw.length;
      const o3 = readOptional(body, pos);
      if (o3.value !== null) {
        const parsed = parseOptions(o3.value, paper);
        if (kw === "table") plot.tableOptions = parsed;
        else plot.options.push(...parsed.map((e) => ({ ...e, key: kw === "fill between" ? `fill between/${e.key}` : e.key })));
        pos = o3.end;
      }
      const group = readGroup(body, pos);
      if (kw === "table") {
        if (group.value !== null) { plot.input = classifyTable(group.value); pos = group.end; }
        else {
          const bare = /^\s*(\\[A-Za-z@]+|\S+)/.exec(body.slice(pos));
          plot.input = bare && bare[1].startsWith("\\") ? "table-macro" : "table-file";
          if (bare) pos += bare[0].length;
        }
      } else {
        if (kw === "function") kw = "gnuplot";
        plot.input = kw.replace(" ", "-");
        if (group.value !== null) {
          if (kw === "coordinates") {
            if (/\+-|\+=|-=/.test(group.value)) plot.extras.push("coordinates with error offsets");
            if (/\)\s*\[[^\]]*\]/.test(group.value)) plot.extras.push("coordinates with explicit meta");
            if (/\(\s*[A-Za-z][^,()]*,/.test(group.value)) plot.extras.push("coordinates with symbolic x");
          }
          pos = group.end;
        }
      }
    } else if (body[pos] === "{") {
      plot.input = "expression";
      const group = readGroup(body, pos);
      if (group.value !== null) pos = group.end;
    } else if (body[pos] === "(") {
      plot.input = "parametric";
      const end = matchBrace(body, pos, "(", ")");
      if (end > 0) pos = end + 1;
    }
    // Rest of the statement up to the top-level ';'.
    let depth = 0;
    let end = pos;
    for (; end < body.length; end++) {
      const ch = body[end];
      if (ch === "\\") { end++; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ";" && depth <= 0) break;
      if (depth < 0) break;
    }
    const tail = body.slice(pos, end);
    if (/\\closedcycle/.test(tail)) plot.extras.push("\\closedcycle");
    if (/--\s*cycle/.test(tail)) plot.extras.push("-- cycle");
    if (/\bnode\b/.test(tail)) plot.extras.push("node on plot path");
    if (/\bcoordinate\b/.test(tail)) plot.extras.push("coordinate on plot path");
    plots.push(plot);
    re.lastIndex = Math.max(re.lastIndex, end);
  }
  return plots;
}

function bodyCommands(body) {
  const found = new Set();
  const checks = [
    ["\\addlegendentry", /\\addlegendentry\b/],
    ["\\legend", /\\legend\s*\{/],
    ["\\addlegendimage", /\\addlegendimage\b/],
    ["\\label (plot)", /\\label\s*[[{]/],
    ["\\pgfplotsinvokeforeach", /\\pgfplotsinvokeforeach\b/],
    ["\\foreach", /\\foreach\b/],
    ["\\pgfplotsforeachungrouped", /\\pgfplotsforeachungrouped\b/],
    ["\\pgfplotsextra", /\\pgfplotsextra\b/],
    ["\\pgfplotsset (in axis)", /\\pgfplotsset\b/],
    ["embedded \\draw/\\node/\\path", /\\(draw|node|path|fill|filldraw|coordinate|shade|clip)\b/],
    ["axis cs:", /\baxis cs\s*:/],
    ["rel axis cs:", /\brel axis cs\s*:/],
    ["axis description cs:", /\baxis description cs\s*:/],
    ["bare coordinates in embedded TikZ", /\\(draw|node|path|fill)\b[^;]*\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)/],
    ["\\coordindex/\\pgfplotspointmeta", /\\(coordindex|pgfplotspointmeta)/],
    ["\\pgfplotstablegetelem", /\\pgfplotstablegetelem\b/],
    ["\\ref (in axis)", /\\ref\s*\{/]
  ];
  for (const [name, re] of checks) if (re.test(body)) found.add(name);
  return found;
}

function scanPaper(id, dir, docKeys) {
  const files = listFiles(dir);
  const paper = {
    id,
    colors: new Set(),
    userStyles: new Map(), // name -> [entries]
    libraries: new Set(),
    compat: new Set(),
    pgfplotssetKeys: [],
    pgfplotssetBlocks: [],
    tikzsetBlocks: [],
    colorLines: [],
    tikzLibraryLines: [],
    generators: new Map(), // file -> generator
    misc: new Set(),
    axes: [],
    envs: []
  };
  paper.docKeys = docKeys;
  paper.knownKey = (k) => docKeys.has(k) || TIKZ_KEYS.has(k) || paper.userStyles.has(k);
  const texts = [];
  for (const path of files) {
    let raw;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const rel = relative(dir, path);
    const head = raw.split("\n").slice(0, 40).join("\n");
    for (const [name, re] of GENERATORS) {
      if (re.test(head)) { paper.generators.set(rel, name); break; }
    }
    texts.push({ rel, raw, text: stripComments(raw), isStyleFile: /\.(sty|cls)$/i.test(path) });
  }

  // Pass 1: preamble-ish global things, from every file.
  for (const { text } of texts) {
    for (const m of text.matchAll(/\\(?:definecolor|colorlet|providecolor)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
      paper.colors.add(m[1].trim());
      const lineEnd = text.indexOf("\n", m.index);
      paper.colorLines.push(text.slice(m.index, lineEnd < 0 ? undefined : lineEnd).trim());
    }
    for (const m of text.matchAll(/\\usepgfplotslibrary\s*\{([^}]*)\}/g)) {
      for (const lib of m[1].split(",")) if (lib.trim()) paper.libraries.add(lib.trim());
    }
    for (const m of text.matchAll(/\\usetikzlibrary\s*\{([^}]*)\}/g)) {
      paper.tikzLibraryLines.push(m[0]);
      for (const lib of m[1].split(",")) {
        const name = lib.trim();
        if (name.startsWith("pgfplots.")) paper.libraries.add(name.slice(9));
        if (name === "external") paper.misc.add("externalization");
      }
    }
    if (/\\tikzexternalize\b/.test(text)) paper.misc.add("externalization");
    if (/\\usepgfplotslibrary\s*\{[^}]*external/.test(text)) paper.misc.add("externalization");
    if (/\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*\bpgfplotstable\b/.test(text)) paper.misc.add("\\usepackage{pgfplotstable}");
    if (/\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*\bpgfplots\b/.test(text)) paper.misc.add("\\usepackage{pgfplots}");
    if (/\\pgfplotstableread\b/.test(text)) paper.misc.add("\\pgfplotstableread");
    if (/\\pgfplotstabletypeset\b/.test(text)) paper.misc.add("\\pgfplotstabletypeset");
    if (/\\pgfplotstablecreatecol|\\pgfplotstablesort|\\pgfplotstablevertcat|\\pgfplotstabletranspose/.test(text)) paper.misc.add("other \\pgfplotstable* macros");
    if (/\\begin\s*\{tikzpicture\}/.test(text)) paper.misc.add("tikzpicture");
    if (/\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*\btikz\b/.test(text)) paper.misc.add("\\usepackage{tikz}");
    if (/\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*\bstandalone\b|\\documentclass\s*(\[[^\]]*\])?\s*\{standalone\}/.test(text)) paper.misc.add("standalone");
    if (/\\ref\s*\{[^}]*\}/.test(text) && /legend to name/.test(text)) paper.misc.add("legend to name + \\ref");
    for (const m of text.matchAll(/\\tikzstyle\s*\{([^}]+)\}\s*=?\s*\[/g)) {
      const open = text.indexOf("[", m.index + m[0].length - 1);
      const end = matchBrace(text, open, "[", "]");
      if (end > 0) paper.userStyles.set(m[1].trim(), text.slice(open + 1, end));
    }
    for (const m of text.matchAll(/\\(pgfplotsset|tikzset|pgfkeys)\s*\{/g)) {
      const open = m.index + m[0].length - 1;
      const end = matchBrace(text, open, "{", "}");
      if (end < 0) continue;
      const content = text.slice(open + 1, end);
      (m[1] === "pgfplotsset" ? paper.pgfplotssetBlocks : paper.tikzsetBlocks).push(text.slice(m.index, end + 1));
      for (const entry of parseOptions(content, null)) {
        if ((entry.handler === "style" || entry.handler === "append style" || entry.handler === "estyle" || entry.handler?.startsWith("style ")) &&
            !docKeys.has(entry.key) && entry.value) {
          paper.userStyles.set(entry.key, unbrace(entry.value));
        }
      }
    }
  }
  // Pass 2: pgfplotsset keys, with colours/user styles now known.
  for (const block of paper.pgfplotssetBlocks) {
    const open = block.indexOf("{");
    for (const entry of parseOptions(block.slice(open + 1, -1), paper)) {
      paper.pgfplotssetKeys.push(entry);
      if (entry.key === "compat" && entry.value) paper.compat.add(unbrace(entry.value));
    }
  }
  // Compat may also be a package option: \usepackage[compat=1.x]{pgfplots}? (not
  // supported by pgfplots, but harmless to look for).

  // Pass 3: axis environments.
  for (const { rel, raw, text, isStyleFile } of texts) {
    if (isStyleFile) continue;
    AXIS_ENV_RE.lastIndex = 0;
    for (let m = AXIS_ENV_RE.exec(text); m; m = AXIS_ENV_RE.exec(text)) {
      const env = m[1];
      const close = findEnvEnd(text, env, m.index + m[0].length);
      if (!close) continue;
      const opts = readOptional(text, m.index + m[0].length);
      const envOptions = opts.value !== null ? parseOptions(opts.value, paper) : [];
      const bodyStart = opts.value !== null ? opts.end : m.index + m[0].length;
      const body = text.slice(bodyStart, close.start);
      const generated = paper.generators.get(rel) ?? generatorNear(raw, m.index) ?? generatorBySignature(envOptions);
      const envRecord = { env, file: rel, generated, start: m.index, end: close.end, text: text.slice(m.index, close.end), fileText: text, cells: 0 };
      paper.envs.push(envRecord);
      const cells = [];
      if (env === "groupplot") {
        const parts = body.split(/\\nextgroupplot\b/);
        for (const part of parts.slice(1)) {
          const o = readOptional(part, 0);
          cells.push({ options: o.value !== null ? parseOptions(o.value, paper) : [], body: o.value !== null ? part.slice(o.end) : part });
        }
        if (cells.length === 0) cells.push({ options: [], body });
      } else cells.push({ options: [], body });
      for (const cell of cells) {
        envRecord.cells++;
        paper.axes.push({
          env,
          file: rel,
          generated,
          envOptions,
          cellOptions: cell.options,
          plots: parseAddplots(cell.body, paper),
          commands: bodyCommands(cell.body)
        });
      }
      AXIS_ENV_RE.lastIndex = close.end;
    }
  }
  return paper;
}

// --- tokens and phase mapping -----------------------------------------------

function keyList(words) {
  return words.trim().split(/\s*\n\s*|\s*;\s*/).filter(Boolean);
}

// Feature sets per phase (cumulative), mapped from design/pgfplots.md §7.
// Keys are matched exactly, or by family prefix when they end in "/".
const PHASE_KEYS = {
  1: keyList(`
    width; height; scale only axis; xmin; xmax; ymin; ymax; xtick; ytick; xticklabels; yticklabels
    xlabel; ylabel; title; clip; every axis; every axis label; every axis title; label style
    xlabel style; ylabel style; title style; x label style; y label style; compat; sharp plot
    every axis x label; every axis y label; scale; clip marker paths; clip mode; axis on top
    normalsize; small; footnotesize; tiny; xlabel=; ylabel=
  `),
  2: keyList(`
    enlargelimits; enlarge x limits; enlarge y limits; minor tick num; minor x tick num; minor y tick num
    minor xtick; minor ytick; minor tick; xtick distance; ytick distance; scaled ticks; scaled x ticks; scaled y ticks
    xticklabel; yticklabel; xticklabel style; yticklabel style; ticklabel style; tick label style
    x tick label style; y tick label style; tick style; major tick style; minor tick style; every tick
    every major tick; every minor tick; major tick length; minor tick length; tick align; xtick align; ytick align
    xtick pos; ytick pos; tick pos; xticklabel pos; yticklabel pos; ticklabel pos; grid; xmajorgrids; ymajorgrids
    xminorgrids; yminorgrids; grid style; major grid style; minor grid style; every axis grid; every major grid
    every minor grid; x grid style; y grid style; max space between ticks; try min ticks; extra x ticks; extra y ticks; extra x tick labels
    extra y tick labels; extra tick style; extra x tick style; extra y tick style; extra description
    number format/; xtick style; ytick style; x tick style; y tick style; every x tick label; every y tick label
    every tick label; xticklabel shift; yticklabel shift; typeset ticklabels with strut; x tick scale label style
    y tick scale label style; every x tick scale label; every y tick scale label; xtick scale label code
    ytick scale label code; tick scale binop; xmajorticks; ymajorticks; xminorticks; yminorticks; major x tick style
    major y tick style; minor x tick style; minor y tick style; every x tick; every y tick; every major x tick
    every major y tick; every minor x tick; every minor y tick; xticklabel shift; tickwidth; major tick length
    subtickwidth; ticks; xticklabels at; tick label precision; precision; fixed; fixed zerofill; sci; zerofill; 1000 sep
    /pgf/number format/; every extra x tick; every extra y tick; extra x tick style
  `),
  3: keyList(`
    domain; samples; samples at; variable; smooth; mark; mark options; mark size; mark repeat; mark phase
    mark indices; every mark; no markers; no marks; mark list; cycle list; cycle list name; cycle multi list
    cycle list shift; legend entries; legend pos; legend style; legend columns; legend cell align
    legend plot pos; legend image post style; legend image code; every axis legend; legend reversed
    reverse legend; transpose legend; every axis plot; every axis plot post; every axis plot no N; forget plot
    declare function; line legend; every legend image post; legend cell align; legend image with text
    every legend entry; legend transposed; legend columns; mark=none; every axis plot/; draw=none
    /pgfplots/every axis plot; every axis legend/; legend style/; legend cell align
  `),
  4: keyList(`
    xmode; ymode; log basis x; log basis y; log ticks with fixed point; log origin; log origin x; log origin y; log base x; log base y; log base 10
    log plot exponent style; log number format code; log number format basis; axis lines; axis lines*; axis x line
    axis y line; axis x line*; axis y line*; axis line style; x axis line style; y axis line style
    every outer x axis line; every outer y axis line; every inner x axis line; every inner y axis line
    inner axis line style; outer axis line style; separate axis lines; axis line shift; axis x line shift
    axis y line shift; hide axis; hide x axis; hide y axis; axis equal; axis equal image; unit vector ratio
    unit vector ratio*; x; y; x dir; y dir; at; anchor; name; xlabel near ticks; ylabel near ticks
    xlabel absolute; ylabel absolute; label shift; xlabel shift; ylabel shift; axis background
    every axis x label/; axis lines/; disabledatascaling; scale mode; trim axis left; trim axis right
    xlabel style/; every 3d view? ; outer axis line style; axis line on top
  `),
  5: keyList(`
    ybar; xbar; ybar stacked; xbar stacked; bar width; bar shift; bar shift auto; stack plots; stack dir
    area style; area legend; const plot; const plot mark left; const plot mark right; const plot mark mid
    jump mark left; jump mark right; jump mark mid; ycomb; xcomb; comb; ybar interval; xbar interval
    only marks; scatter; scatter src; scatter/; point meta; nodes near coords; nodes near coords align
    every node near coord; nodes near coords style; error bars/; error bars; unbounded coords
    restrict x to domain; restrict y to domain; restrict x to domain*; restrict y to domain*
    x filter; y filter; filter point; skip coords between index; xticklabels from table; yticklabels from table
    ybar legend; xbar legend; ybar interval legend; table/; visualization depends on; x filter/; y filter/; filter discard warning; each nth point; skip coords between index
    y explicit; x explicit; y dir; x error; y error; error mark; error bar style; every error bar
    bar cycle list; reverse stacked plots; stacked ignores zero; point meta min; point meta max
    nodes near coords cs; coordinate style; every nodes near coord
  `)
};

const NON_KEY_PHASE = {
  "env:axis": 1,
  "input:coordinates": 1,
  "embedded \\draw/\\node/\\path": 1,
  "axis cs:": 1,
  "rel axis cs:": 1,
  "axis description cs:": 1,
  "bare coordinates in embedded TikZ": 1,
  "\\foreach": 1,
  "node on plot path": 1,
  "coordinate on plot path": 1,
  "(arrow spec)": 1,
  "(color)": 1,
  "input:expression": 3,
  "input:parametric": 3,
  "\\addplot+": 3,
  "\\addlegendentry": 3,
  "\\legend": 3,
  "\\addlegendimage": 3,
  "\\pgfplotsset (in axis)": 3,
  "\\label (plot)": 3,
  "env:semilogxaxis": 4,
  "env:semilogyaxis": 4,
  "env:loglogaxis": 4,
  "input:table-inline": 5,
  "input:table-file": 5,
  "input:table-macro": 5,
  "\\closedcycle": 5,
  "-- cycle": 5,
  "coordinates with error offsets": 5,
  "coordinates with explicit meta": 5,
  "\\coordindex/\\pgfplotspointmeta": 5
};

function phaseOfKey(key) {
  for (let phase = 1; phase <= 5; phase++) {
    for (const k of PHASE_KEYS[phase]) {
      if (k.endsWith("/") ? key.startsWith(k) || key === k.slice(0, -1) : key === k) return phase;
    }
  }
  if (key.startsWith("number format/")) return 2;
  if (key.startsWith("table/")) return 5;
  return null;
}

function tokenPhase(token, tikzKeys) {
  if (token in NON_KEY_PHASE) return NON_KEY_PHASE[token];
  const m = /^(akey|pkey|tkey|gkey):(.*)$/.exec(token);
  if (!m) return null;
  const [, kind, key] = m;
  if (kind === "tkey") return 5;
  const phase = phaseOfKey(key);
  if (phase) return phase;
  if (tikzKeys.has(key) || key === "(color)" || key === "(arrow spec)") return 1;
  return null;
}

function expandUserStyle(paper, entry, depth = 0) {
  if (depth > 4 || !paper.userStyles.has(entry.key) || paper.knownKey(entry.key) && !paper.userStyles.has(entry.key)) return [entry];
  const definition = paper.userStyles.get(entry.key);
  if (typeof definition !== "string") return [entry];
  return parseOptions(definition, paper).flatMap((sub) => expandUserStyle(paper, sub, depth + 1));
}

function entriesWithNested(paper, entries) {
  const out = [];
  for (const entry of entries) {
    const isUser = paper.userStyles.has(entry.key) && !(paper.knownKey(entry.key) && !paper.userStyles.has(entry.key));
    if (isUser && !entry.handler) {
      for (const sub of expandUserStyle(paper, entry)) out.push({ ...sub, viaUserStyle: entry.key });
      continue;
    }
    if (entry.handler && !["append style", "style", "prefix style"].includes(entry.handler)) {
      out.push(entry);
      continue;
    }
    // A user-style *definition* inside options is not an applied key.
    if (entry.handler && !paper.docKeys.has(entry.key) && !TIKZ_KEYS.has(entry.key) && !STYLE_CONTAINERS.has(entry.key)) continue;
    out.push(entry);
    if (STYLE_CONTAINERS.has(entry.key) && entry.value) {
      const prefix = entry.key === "group style" ? "group/" : entry.key === "error bars" ? "error bars/" : "";
      for (const sub of parseOptions(unbrace(entry.value), paper)) out.push({ ...sub, key: prefix + sub.key, nested: entry.key });
    }
  }
  return out;
}

function axisTokens(paper, axis) {
  const tokens = new Set();
  tokens.add(`env:${axis.env}`);
  if (axis.env === "groupplot") tokens.add("\\nextgroupplot");
  const axisEntries = entriesWithNested(paper, [...paper.pgfplotssetKeys, ...axis.envOptions, ...axis.cellOptions]);
  for (const e of axisEntries) if (e.key !== "compat") tokens.add(`akey:${e.key}`);
  for (const plot of axis.plots) {
    tokens.add(`input:${plot.input}`);
    if (plot.is3d) tokens.add("\\addplot3");
    if (plot.plus) tokens.add("\\addplot+");
    for (const e of entriesWithNested(paper, plot.options)) tokens.add(`pkey:${e.key}`);
    for (const e of plot.tableOptions) tokens.add(`tkey:${e.key}`);
    for (const x of plot.extras) tokens.add(x);
  }
  for (const c of axis.commands) tokens.add(c);
  return tokens;
}

// --- plot-type features --------------------------------------------------------

function plotTypeFeatures(paper, axis) {
  const keys = new Set();
  const all = [...axis.envOptions, ...axis.cellOptions, ...paper.pgfplotssetKeys, ...axis.plots.flatMap((p) => p.options)];
  for (const e of entriesWithNested(paper, all)) keys.add(e.key);
  const tkeys = new Set(axis.plots.flatMap((p) => p.tableOptions.map((e) => e.key)));
  const extras = new Set(axis.plots.flatMap((p) => p.extras));
  const inputs = new Set(axis.plots.map((p) => p.input));
  const has = (...names) => names.some((n) => keys.has(n));
  const prefix = (p) => [...keys].some((k) => k.startsWith(p));
  const f = [];
  if (has("ybar", "ybar stacked", "ybar interval")) f.push("ybar (any)");
  if (has("xbar", "xbar stacked", "xbar interval")) f.push("xbar (any)");
  if (has("ybar stacked", "xbar stacked") || keys.has("stack plots")) f.push("stacked (bar or stack plots)");
  if (has("ybar interval", "xbar interval")) f.push("bar interval");
  if ([...keys].some((k) => /^(const plot|jump mark)/.test(k))) f.push("const plot / jump mark");
  if (has("ycomb", "xcomb", "comb")) f.push("comb");
  if (keys.has("only marks")) f.push("only marks");
  if (keys.has("scatter") || prefix("scatter/")) f.push("scatter");
  if (prefix("error bars") || tkeys.has("y error") || tkeys.has("x error") || [...tkeys].some((k) => /error/.test(k)) || extras.has("coordinates with error offsets")) f.push("error bars");
  if (extras.has("\\closedcycle") || keys.has("area style")) f.push("area / \\closedcycle");
  if (inputs.has("fill-between") || prefix("fill between")) f.push("fill between");
  if (keys.has("hist") || prefix("hist/")) f.push("hist");
  if (keys.has("boxplot") || keys.has("boxplot prepared") || prefix("boxplot")) f.push("boxplot");
  if ([...keys].some((k) => /^contour/.test(k))) f.push("contour");
  if (keys.has("surf")) f.push("surf");
  if (keys.has("mesh") || prefix("mesh/")) f.push("mesh");
  if (keys.has("quiver") || prefix("quiver/")) f.push("quiver");
  if (keys.has("patch") || prefix("patch")) f.push("patch");
  if (keys.has("matrix plot") || keys.has("matrix plot*")) f.push("matrix plot");
  if (keys.has("smooth")) f.push("smooth");
  if (has("nodes near coords")) f.push("nodes near coords");
  if (prefix("colorbar")) f.push("colorbar");
  if (prefix("colormap") || keys.has("colormap name") || keys.has("colormap/<name>")) f.push("colormap");
  if (keys.has("point meta") || tkeys.has("meta") || extras.has("coordinates with explicit meta")) f.push("point meta");
  if ([...keys].some((k) => /^symbolic [xyz] coords$/.test(k)) || extras.has("coordinates with symbolic x")) f.push("symbolic coords");
  if (keys.has("date coordinates in")) f.push("date coordinates");
  if (keys.has("view") || axis.plots.some((p) => p.is3d)) f.push("3D (view / \\addplot3)");
  if (keys.has("unbounded coords")) f.push("unbounded coords");
  if ([...keys].some((k) => /^(restrict [xyz] to domain\*?|[xyz] filter|filter point)/.test(k))) f.push("coordinate filters / restrict");
  if (keys.has("legend to name")) f.push("legend to name");
  if ([...keys].some((k) => /^axis [xy] discontinuity$/.test(k))) f.push("axis discontinuity");
  if (keys.has("stack plots")) f.push("stack plots");
  if (keys.has("enlargelimits") || prefix("enlarge ")) f.push("enlargelimits");
  if (has("xmode", "ymode") || ["semilogxaxis", "semilogyaxis", "loglogaxis"].includes(axis.env)) f.push("log axis (env or xmode/ymode)");
  if (prefix("axis lines") || prefix("axis x line") || prefix("axis y line")) f.push("axis lines");
  if (prefix("grid") || prefix("xmajorgrids") || prefix("ymajorgrids") || prefix("xminorgrids") || prefix("yminorgrids")) f.push("grids");
  if (has("x dir", "y dir")) f.push("x/y dir reverse");
  if (has("axis equal", "axis equal image", "unit vector ratio", "unit vector ratio*")) f.push("axis equal / unit vector ratio");
  if (prefix("cycle list")) f.push("cycle list");
  return f;
}

// --- tallies -------------------------------------------------------------------

class Tally {
  constructor() { this.papers = new Map(); this.occ = new Map(); }
  add(name, paperId) {
    if (!this.papers.has(name)) this.papers.set(name, new Set());
    this.papers.get(name).add(paperId);
    this.occ.set(name, (this.occ.get(name) ?? 0) + 1);
  }
  rows(totalPapers, limit = Infinity) {
    return [...this.papers.entries()]
      .map(([name, set]) => ({ name, papers: set.size, fraction: +(set.size / totalPapers).toFixed(3), occurrences: this.occ.get(name) }))
      .sort((a, b) => b.papers - a.papers || b.occurrences - a.occurrences || a.name.localeCompare(b.name))
      .slice(0, limit);
  }
}

function newTallies() {
  return {
    environments: new Tally(), addplotForms: new Tally(), inputForms: new Tally(), plotTypes: new Tally(),
    axisKeys: new Tally(), plotKeys: new Tally(), tableKeys: new Tally(), pgfplotssetKeys: new Tally(),
    libraries: new Tally(), compat: new Tally(), legend: new Tally(), bodyCommands: new Tally(),
    misc: new Tally(), values: new Tally(), userStyleUse: new Tally()
  };
}

const VALUE_KEYS = new Set(["legend pos", "axis lines", "axis x line", "axis y line", "xmode", "ymode", "mark", "cycle list name", "colormap name", "enlargelimits", "grid", "tick pos", "xtick pos", "ytick pos", "scaled ticks", "scaled y ticks", "xtick", "ytick", "x dir", "y dir", "legend cell align", "tick align", "point meta"]);

function tallyAxis(t, paper, axis) {
  const pid = paper.id;
  t.environments.add(axis.env, pid);
  for (const plot of axis.plots) {
    t.addplotForms.add(plot.is3d ? (plot.plus ? "\\addplot3+" : "\\addplot3") : (plot.plus ? "\\addplot+" : "\\addplot"), pid);
    t.inputForms.add(plot.input, pid);
    for (const e of plot.options) {
      t.plotKeys.add(e.key + (e.handler ? `/.${e.handler}` : ""), pid);
      if (paper.userStyles.has(e.key) && !e.handler) t.userStyleUse.add("plot options use a user-defined style", pid);
      if (VALUE_KEYS.has(e.key) && e.value) t.values.add(`${e.key} = ${unbrace(e.value).slice(0, 40)}`, pid);
    }
    for (const e of plot.tableOptions) t.tableKeys.add(e.key, pid);
    for (const x of plot.extras) t.bodyCommands.add(x, pid);
  }
  for (const e of [...axis.envOptions, ...axis.cellOptions]) {
    t.axisKeys.add(e.key + (e.handler ? `/.${e.handler}` : ""), pid);
    if (paper.userStyles.has(e.key) && !e.handler) t.userStyleUse.add("axis options use a user-defined style", pid);
    if (VALUE_KEYS.has(e.key) && e.value) t.values.add(`${e.key} = ${unbrace(e.value).slice(0, 40)}`, pid);
    if (e.key === "group style" && e.value) {
      for (const sub of parseOptions(unbrace(e.value), paper)) t.axisKeys.add(`group style/${sub.key}`, pid);
    }
  }
  for (const c of axis.commands) t.bodyCommands.add(c, pid);
  for (const f of plotTypeFeatures(paper, axis)) t.plotTypes.add(f, pid);
  const keys = new Set([...axis.envOptions, ...axis.cellOptions, ...axis.plots.flatMap((p) => p.options), ...paper.pgfplotssetKeys].map((e) => e.key));
  const legendKeys = ["legend entries", "legend pos", "legend style", "legend columns", "legend to name", "legend cell align", "legend image post style", "legend image code", "legend plot pos", "reverse legend", "transpose legend", "every axis legend"];
  for (const k of legendKeys) if (keys.has(k)) t.legend.add(k, pid);
  for (const c of ["\\addlegendentry", "\\legend", "\\addlegendimage"]) if (axis.commands.has(c)) t.legend.add(c, pid);
  if (axis.plots.some((p) => p.options.some((e) => e.key === "forget plot"))) t.legend.add("forget plot", pid);
}

function main() {
  const options = parseArgs(process.argv);
  const corpus = resolve(process.cwd(), options.corpus);
  const state = JSON.parse(readFileSync(join(corpus, "state.json"), "utf8"));
  const docKeys = documentedKeys(resolve(process.cwd(), options.docs));
  const allPapers = Object.values(state.papers);
  const hits = allPapers.filter((p) => p.hit);

  const tAll = newTallies();
  const tHand = newTallies();
  const tGen = newTallies();
  const papers = [];
  const snippetIndex = [];
  const axesDir = join(corpus, "axes");
  if (options.snippets) { rmSync(axesDir, { recursive: true, force: true }); mkdirSync(axesDir, { recursive: true }); }

  for (const record of hits) {
    const paper = scanPaper(record.id, join(corpus, "src", record.id), docKeys);
    if (paper.axes.length === 0) continue;
    papers.push(paper);
    const pid = paper.id;
    for (const lib of paper.libraries) tAll.libraries.add(lib, pid);
    if (paper.compat.size === 0) tAll.compat.add("(no compat set)", pid);
    for (const c of paper.compat) tAll.compat.add(c, pid);
    for (const e of paper.pgfplotssetKeys) {
      tAll.pgfplotssetKeys.add(e.key + (e.handler ? `/.${e.handler}` : ""), pid);
    }
    if (paper.userStyles.size) tAll.misc.add("defines styles (\\pgfplotsset/\\tikzset .style or \\tikzstyle)", pid);
    for (const m of paper.misc) tAll.misc.add(m, pid);
    const gens = new Set(paper.axes.filter((a) => a.generated).map((a) => a.generated));
    for (const g of gens) tAll.misc.add(`generated axes: ${g}`, pid);
    if (gens.size && paper.axes.every((a) => a.generated)) tAll.misc.add("all axes generated (matlab2tikz/tikzplotlib/...)", pid);
    for (const axis of paper.axes) {
      tallyAxis(tAll, paper, axis);
      tallyAxis(axis.generated ? tGen : tHand, paper, axis);
    }
    if (options.snippets) writeSnippets(paper, axesDir, snippetIndex);
  }

  const N = papers.length;
  const handPapers = papers.filter((p) => p.axes.some((a) => !a.generated)).length;
  const genPapers = papers.filter((p) => p.axes.some((a) => a.generated)).length;

  // Coverage by phase.
  const tikzKeys = new Set([...TIKZ_KEYS]);
  const coverage = [];
  const uncoveredTally = new Tally();
  const soleBlocker = new Tally();
  const paperTokens = papers.map((paper) => {
    const perAxis = paper.axes.map((axis) => axisTokens(paper, axis));
    return { paper, perAxis, union: new Set(perAxis.flatMap((s) => [...s])) };
  });
  for (const { paper, perAxis } of paperTokens) {
    if (paper.id !== options.debugPaper) continue;
    perAxis.forEach((tokens, i) => console.log(`axis ${i} (${paper.axes[i].env}, ${paper.axes[i].file}):`,
      [...tokens].map((tok) => `${tok}=>${tokenPhase(tok, tikzKeys) ?? "-"}`).join("  ")));
  }
  for (let phase = 1; phase <= 5; phase++) {
    let covered = 0;
    let coveredHand = 0;
    let handTotal = 0;
    let axesCovered = 0;
    let axesTotal = 0;
    for (const { paper, perAxis } of paperTokens) {
      const ok = perAxis.map((tokens) => [...tokens].every((tok) => (tokenPhase(tok, tikzKeys) ?? 99) <= phase));
      axesTotal += ok.length;
      axesCovered += ok.filter(Boolean).length;
      if (ok.every(Boolean)) covered++;
      const handIdx = paper.axes.map((a, i) => (a.generated ? -1 : i)).filter((i) => i >= 0);
      if (handIdx.length) {
        handTotal++;
        if (handIdx.every((i) => ok[i])) coveredHand++;
      }
    }
    coverage.push({
      phase, papersFullyCovered: covered, fraction: +(covered / N).toFixed(3),
      handWrittenPapersFullyCovered: coveredHand, handWrittenFraction: +(coveredHand / Math.max(1, handTotal)).toFixed(3),
      axesCovered, axesTotal, axisFraction: +(axesCovered / Math.max(1, axesTotal)).toFixed(3)
    });
  }
  for (const { paper, union } of paperTokens) {
    const beyond = [...union].filter((tok) => tokenPhase(tok, tikzKeys) === null);
    for (const tok of beyond) uncoveredTally.add(tok, paper.id);
    if (beyond.length === 1) soleBlocker.add(beyond[0], paper.id);
  }
  // Greedy: which beyond-phase-5 token unlocks the most additional papers next.
  const greedy = [];
  {
    const remaining = paperTokens.map(({ union }) => new Set([...union].filter((tok) => tokenPhase(tok, tikzKeys) === null)));
    let base = remaining.filter((s) => s.size === 0).length;
    const supported = new Set();
    for (let step = 0; step < 25; step++) {
      const gain = new Map();
      for (const s of remaining) {
        if (s.size === 0) continue;
        const left = [...s].filter((tok) => !supported.has(tok));
        if (left.length === 0) continue;
        // Credit each missing token by 1/|left| so near-complete papers weigh more.
        for (const tok of left) gain.set(tok, (gain.get(tok) ?? 0) + 1 / left.length);
      }
      const best = [...gain.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!best) break;
      supported.add(best[0]);
      const nowCovered = remaining.filter((s) => [...s].every((tok) => supported.has(tok))).length;
      greedy.push({ step: step + 1, add: best[0], papersFullyCovered: nowCovered, fraction: +(nowCovered / N).toFixed(3), gained: nowCovered - base });
      base = nowCovered;
    }
  }

  const downloaded = allPapers.filter((p) => p.downloaded);
  const formats = new Tally();
  for (const p of allPapers) formats.add(p.format ?? p.status, p.id);
  const byCategory = {};
  const byYear = {};
  for (const p of downloaded) {
    for (const [table, key] of [[byCategory, p.category], [byYear, p.year]]) {
      table[key] ??= { downloaded: 0, hits: 0 };
      table[key].downloaded++;
      if (p.hit && papers.some((x) => x.id === p.id)) table[key].hits++;
    }
  }
  const axisEnvCount = papers.reduce((n, p) => n + p.envs.length, 0);
  const axesCount = papers.reduce((n, p) => n + p.axes.length, 0);
  const plotsCount = papers.reduce((n, p) => n + p.axes.reduce((m, a) => m + a.plots.length, 0), 0);

  const report = {
    generatedAt: new Date().toISOString(),
    runs: state.runs,
    summary: {
      candidatesProcessed: allPapers.length,
      downloaded: downloaded.length,
      pgfplotsPapers: N,
      hitRate: +(N / Math.max(1, downloaded.length)).toFixed(4),
      handWrittenAxisPapers: handPapers,
      generatedAxisPapers: genPapers,
      axisEnvironments: axisEnvCount,
      axes: axesCount,
      addplots: plotsCount,
      documentedKeysLoaded: docKeys.size,
      formats: formats.rows(allPapers.length),
      byCategory,
      byYear
    },
    all: Object.fromEntries(Object.entries(tAll).map(([k, t]) => [k, t.rows(N)])),
    handWritten: Object.fromEntries(Object.entries(tHand).map(([k, t]) => [k, t.rows(N)])),
    generated: Object.fromEntries(Object.entries(tGen).map(([k, t]) => [k, t.rows(N)])),
    coverage,
    beyondPhase5: uncoveredTally.rows(N).map((r) => ({ ...r, soleBlocker: soleBlocker.papers.get(r.name)?.size ?? 0 })),
    greedyNext: greedy,
    documentedKeyFlags: Object.fromEntries(tAll.axisKeys.rows(N).concat(tAll.plotKeys.rows(N)).map((r) => [r.name, docKeys.has(r.name.replace(/\/\.[a-z ]+$/, "")) || TIKZ_KEYS.has(r.name)]))
  };
  writeFileSync(join(corpus, "report.json"), `${JSON.stringify(report, null, 1)}\n`);
  writeFileSync(join(corpus, "report.md"), renderMarkdown(report, docKeys));
  if (options.snippets) writeFileSync(join(axesDir, "index.json"), `${JSON.stringify(snippetIndex, null, 1)}\n`);
  console.log(`Scanned ${N} pgfplots papers (${axisEnvCount} axis environments, ${axesCount} axes, ${plotsCount} \\addplot). Report: ${join(corpus, "report.md")}`);
}

// --- snippets ------------------------------------------------------------------

function enclosingPicture(fileText, start, end) {
  const before = fileText.slice(0, start);
  const open = before.lastIndexOf("\\begin{tikzpicture}");
  if (open < 0 || before.indexOf("\\end{tikzpicture}", open) >= 0) return null;
  const close = fileText.indexOf("\\end{tikzpicture}", end);
  if (close < 0) return null;
  const opts = readOptional(fileText, open + "\\begin{tikzpicture}".length);
  return { options: opts.value, otherContent: fileText.slice(opts.end, start).trim().length + fileText.slice(end, close).trim().length > 0 };
}

function writeSnippets(paper, axesDir, index) {
  const dir = join(axesDir, paper.id);
  mkdirSync(dir, { recursive: true });
  paper.envs.forEach((env, i) => {
    const picture = enclosingPicture(env.fileText, env.start, env.end);
    const meta = {
      paper: paper.id,
      file: env.file,
      env: env.env,
      cells: env.cells,
      generated: env.generated,
      compat: [...paper.compat],
      libraries: [...paper.libraries],
      pictureOptions: picture?.options ?? null,
      pictureHasOtherContent: picture?.otherContent ?? false
    };
    const libs = paper.libraries.size ? `\\usepgfplotslibrary{${[...paper.libraries].filter((l) => l !== "external").join(",")}}\n` : "";
    const name = `${String(i + 1).padStart(3, "0")}-${env.env}.tex`;
    const lines = [
      `% pgfplots corpus snippet (untracked, for local testing only)`,
      `% meta: ${JSON.stringify(meta)}`,
      "\\documentclass{standalone}",
      "\\usepackage{pgfplots}",
      libs.trimEnd(),
      ...paper.tikzLibraryLines.filter((l) => !/external/.test(l)),
      ...[...new Set(paper.colorLines)],
      ...paper.pgfplotssetBlocks,
      ...paper.tikzsetBlocks,
      "\\begin{document}",
      `\\begin{tikzpicture}${picture?.options ? `[${picture.options}]` : ""}`,
      env.text.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n"),
      "\\end{tikzpicture}",
      "\\end{document}",
      ""
    ].filter((l) => l !== "");
    writeFileSync(join(dir, name), lines.join("\n"));
    index.push({ snippet: `${paper.id}/${name}`, ...meta });
  });
}

// --- markdown --------------------------------------------------------------------

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function table(rows, { limit = Infinity, nameHeader = "feature", extra } = {}) {
  const head = `| ${nameHeader} | papers | % of pgfplots papers |${extra ? ` ${extra.header} |` : ""} occurrences |`;
  const sepLine = `|---|---:|---:|${extra ? "---:|" : ""}---:|`;
  const body = rows.slice(0, limit).map((r) => `| \`${r.name.replace(/\|/g, "\\|")}\` | ${r.papers} | ${pct(r.fraction)} |${extra ? ` ${extra.value(r)} |` : ""} ${r.occurrences} |`);
  return [head, sepLine, ...body].join("\n");
}

function renderMarkdown(report, docKeys) {
  const s = report.summary;
  const N = s.pgfplotsPapers;
  const handByName = (section, name) => report.handWritten[section].find((r) => r.name === name)?.papers ?? 0;
  const handCol = (section) => ({ header: "papers (hand-written axes)", value: (r) => handByName(section, r.name) });
  const docMark = (r) => (docKeys.has(r.name.replace(/\/\.[a-z ]+$/, "").replace(/^group style\//, "group/")) ? "manual" : TIKZ_KEYS.has(r.name) ? "TikZ" : "other");
  const lines = [];
  lines.push("# pgfplots usage in arXiv sources", "");
  lines.push(`Generated ${report.generatedAt} by \`scripts/scan-pgfplots-corpus.mjs\`. Counts are **distinct papers** (proxy for distinct authors); occurrences are given only for reference. Percentages are of the ${N} pgfplots-using papers.`, "");
  lines.push("## Sample", "");
  lines.push(`- Candidates processed: ${s.candidatesProcessed}; e-prints downloaded: ${s.downloaded}`);
  lines.push(`- Papers with at least one pgfplots axis: **${N}** (hit rate ${pct(s.hitRate)} of downloaded)`);
  lines.push(`- Axis environments: ${s.axisEnvironments}; axes (groupplot cells counted separately): ${s.axes}; \`\\addplot\` commands: ${s.addplots}`);
  lines.push(`- Papers with hand-written axes: ${s.handWrittenAxisPapers}; papers with generator-produced axes (matlab2tikz, tikzplotlib, ...): ${s.generatedAxisPapers}`);
  for (const run of report.runs) lines.push(`- Harvest run ${run.startedAt}: stopped because ${run.stoppedBecause ?? "(still running or interrupted)"}`);
  lines.push("", "E-print formats:", "", table(s.formats, { nameHeader: "format" }).replace(/% of pgfplots papers/, "% of candidates"), "");
  lines.push("By category (sampling stratum; cross-lists included):", "", "| category | downloaded | pgfplots papers | hit rate |", "|---|---:|---:|---:|");
  for (const [k, v] of Object.entries(s.byCategory).sort((a, b) => b[1].hits / b[1].downloaded - a[1].hits / a[1].downloaded)) lines.push(`| ${k} | ${v.downloaded} | ${v.hits} | ${pct(v.hits / v.downloaded)} |`);
  lines.push("", "By year:", "", "| year | downloaded | pgfplots papers | hit rate |", "|---|---:|---:|---:|");
  for (const [k, v] of Object.entries(s.byYear)) lines.push(`| ${k} | ${v.downloaded} | ${v.hits} | ${pct(v.hits / v.downloaded)} |`);

  const section = (title, key, opts = {}) => {
    lines.push("", `## ${title}`, "", table(report.all[key], { ...opts, extra: opts.extra ?? handCol(key) }));
  };
  section("Environments", "environments", { nameHeader: "environment" });
  section("\\addplot forms", "addplotForms", { nameHeader: "command" });
  section("Input forms", "inputForms", { nameHeader: "input" });
  section("Plot types and notable features", "plotTypes");
  section("Axis option keys (top 60)", "axisKeys", { limit: 60, nameHeader: "key", extra: { header: "hand-written / source", value: (r) => `${handByName("axisKeys", r.name)} / ${docMark(r)}` } });
  section("Plot option keys (top 40)", "plotKeys", { limit: 40, nameHeader: "key", extra: { header: "hand-written / source", value: (r) => `${handByName("plotKeys", r.name)} / ${docMark(r)}` } });
  section("table option keys", "tableKeys", { limit: 30, nameHeader: "key" });
  section("\\pgfplotsset keys (top 40)", "pgfplotssetKeys", { limit: 40, nameHeader: "key", extra: { header: "source", value: docMark } });
  section("compat levels", "compat", { nameHeader: "compat", extra: { header: "-", value: () => "" } });
  section("Libraries (\\usepgfplotslibrary / \\usetikzlibrary{pgfplots.*})", "libraries", { nameHeader: "library", extra: { header: "-", value: () => "" } });
  section("Legend usage", "legend");
  section("Axis-body commands and coordinate systems", "bodyCommands", { nameHeader: "item" });
  section("Paper-level items (packages, tables, externalization, generators)", "misc", { nameHeader: "item", extra: { header: "-", value: () => "" } });
  section("Selected key values", "values", { limit: 60, nameHeader: "key = value" });
  lines.push("", "## Generated axes only (matlab2tikz / tikzplotlib / ...)", "", "Generated files are reported separately because they set many keys mechanically.", "");
  lines.push(table(report.generated.axisKeys, { limit: 25, nameHeader: "axis key" }), "");
  lines.push(table(report.generated.plotKeys, { limit: 15, nameHeader: "plot key" }));

  lines.push("", "## Coverage by phase (design/pgfplots.md §7)", "");
  lines.push("A paper counts as covered at phase *k* when every token of every axis in it (environment, input form, axis/plot/table option key, legend/body command, nested keys of `every axis plot`-type styles, paper-level `\\pgfplotsset` keys, user styles expanded) maps to a phase ≤ *k*. Common TikZ styling keys and colours are assumed supported from Phase 1. Unknown keys count as unsupported.", "");
  lines.push("| phase | papers fully covered | % | % of papers with hand-written axes | axes covered | % of axes |", "|---|---:|---:|---:|---:|---:|");
  for (const c of report.coverage) lines.push(`| ${c.phase} | ${c.papersFullyCovered} | ${pct(c.fraction)} | ${pct(c.handWrittenFraction)} | ${c.axesCovered}/${c.axesTotal} | ${pct(c.axisFraction)} |`);
  lines.push("", "## Beyond Phase 5, ranked by paper count", "", "`sole blocker`: papers where this is the only thing outside Phases 1–5.", "");
  lines.push(table(report.beyondPhase5, { limit: 60, nameHeader: "token", extra: { header: "sole blocker", value: (r) => r.soleBlocker } }));
  lines.push("", "## Greedy next features after Phase 5", "", "| step | add | papers fully covered | % | gained |", "|---:|---|---:|---:|---:|");
  for (const g of report.greedyNext) lines.push(`| ${g.step} | \`${g.add}\` | ${g.papersFullyCovered} | ${pct(g.fraction)} | ${g.gained} |`);
  lines.push("", "Token prefixes: `akey:` axis option (incl. groupplot/\\nextgroupplot and paper-level \\pgfplotsset), `pkey:` \\addplot option, `tkey:` `table[...]` option, `env:` environment, `input:` \\addplot input form.", "");
  return lines.join("\n");
}

main();
