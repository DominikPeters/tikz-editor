#!/usr/bin/env node
// Analyze a corpus of Beamer .tex files and report construct frequencies and
// per-frame subset-coverage classification for the Beamer editor plan
// (design/beamer-editor.md, Phase B0).
//
// Frames are classified into tiers against the planned editor subset:
//   core     — everything in the Phase B2 subset (text, lists, columns,
//              blocks/theorems, overlays, includegraphics, tikzpicture,
//              math islands, vspace/scalebox, ...)
//   b4       — additionally needs Phase B4 constructs (tabular, footnote,
//              colorbox, minipage, tcolorbox-ish boxes, ...)
//   fallback — contains constructs outside the plan (verbatim/listings,
//              media, unknown environments)
// Custom-macro usage and unknown commands are reported separately (they map
// to macro expansion / inline fallback, not to a frame tier).
//
// Usage:
//   node scripts/scan-beamer-corpus.mjs [files-or-dirs...]
//     [--list paths.txt] [--json report.json] [--top 20]
//   (default input: artifacts/beamer-corpus)

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

// --- subset definitions -----------------------------------------------------

const MATH_INTERNAL_ENVS = new Set([
  "aligned", "alignedat", "cases", "dcases", "rcases", "split", "gathered",
  "array", "subarray", "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix",
  "Vmatrix", "smallmatrix"
]);

const DISPLAY_MATH_ENVS = new Set([
  "equation", "equation*", "align", "align*", "alignat", "alignat*",
  "gather", "gather*", "multline", "multline*", "displaymath", "eqnarray",
  "eqnarray*", "math"
]);

const VERBATIM_ENVS = new Set([
  "verbatim", "verbatim*", "semiverbatim", "lstlisting", "minted", "alltt",
  "Verbatim", "BVerbatim"
]);

const CORE_ENVS = new Set([
  "itemize", "enumerate", "description",
  "columns", "column",
  "block", "alertblock", "exampleblock",
  "theorem", "lemma", "corollary", "proposition", "definition", "example",
  "examples", "proof", "fact", "claim", "remark", "conjecture", "observation",
  "center", "flushleft", "flushright", "quote", "quotation",
  "tikzpicture", "figure", "figure*", "table", "table*",
  "overprint", "overlayarea", "onlyenv", "visibleenv", "uncoverenv",
  "actionenv", "abstract",
  ...DISPLAY_MATH_ENVS
]);

const B4_ENVS = new Set([
  "tabular", "tabular*", "tabularx", "tabu", "longtable", "booktabs",
  "minipage", "multicols", "wrapfigure", "subfigure", "tcolorbox",
  "beamercolorbox", "adjustbox", "thebibliography"
]);

const FALLBACK_ENVS = new Set([
  ...VERBATIM_ENVS, "animateinline", "frame", "pgfpicture", "picture",
  "columnsonlytextwidth"
]);

// Commands that push a frame to a tier (counted per frame body, outside
// tikzpicture/math/verbatim content).
const B4_CMDS = [
  "footnote", "colorbox", "fcolorbox", "framebox", "fbox", "cite", "citep",
  "citet", "footcite", "parencite", "textcite", "autocite", "footfullcite",
  "url", "href", "multicolumn", "multirow", "cellcolor", "rowcolor", "cmidrule"
];
const FALLBACK_CMDS = [
  "movie", "animategraphics", "includevideo", "sound", "verb", "lstinline",
  "mintinline", "transduration", "transfade", "transdissolve", "hyperlink",
  "beamerbutton", "beamergotobutton", "againframe"
];

// Counted for the frequency report (all tier-neutral or core).
const REPORT_CMDS = [
  "frametitle", "framesubtitle", "titlepage", "tableofcontents",
  "includegraphics", "vspace", "vfill", "hspace", "hfill",
  "smallskip", "medskip", "bigskip",
  "scalebox", "resizebox", "rotatebox",
  "centering", "raggedright", "raggedleft",
  "alert", "textcolor", "structure", "emph", "textbf", "textit", "texttt",
  "textsc", "underline",
  "only", "uncover", "visible", "invisible", "alt", "temporal", "onslide",
  "pause", "item",
  "footnote", "colorbox", "fcolorbox", "cite", "url", "href",
  "tiny", "scriptsize", "footnotesize", "small", "normalsize", "large",
  "Large", "LARGE", "huge", "Huge",
  ...FALLBACK_CMDS
];

// Commands we never report as "unknown" (common LaTeX/beamer text-mode noise).
const KNOWN_NOISE_CMDS = new Set([
  ...REPORT_CMDS, ...B4_CMDS,
  "begin", "end", "item", "label", "ref", "eqref", "autoref", "cref", "Cref",
  "par", "newline", "linebreak", "nolinebreak", "noindent", "indent",
  "textwidth", "textheight", "linewidth", "columnwidth", "paperwidth",
  "quad", "qquad", "enspace", "thinspace", "phantom", "hphantom", "vphantom",
  "ldots", "dots", "textellipsis", "slash",
  "textquotedblleft", "textquotedblright", "textquoteleft", "textquoteright",
  "color", "textsl", "textup", "textrm", "textsf", "textmd", "textnormal",
  "rmfamily", "sffamily", "ttfamily", "bfseries", "mdseries", "itshape",
  "upshape", "scshape", "slshape", "em", "bf", "it", "tt", "sc", "sf", "rm",
  "and", "thanks", "author", "title", "subtitle", "institute", "date",
  "inserttitle", "insertauthor", "insertdate", "insertframenumber",
  "inserttotalframenumber", "insertsection", "insertsubsection",
  "section", "subsection", "subsubsection", "appendix",
  "caption", "captionof", "subcaption",
  "hline", "cline", "toprule", "midrule", "bottomrule", "addlinespace",
  "arraystretch", "tabcolsep",
  "left", "right", "big", "Big", "bigg", "Bigg",
  "checkmark", "times", "cdot", "dag", "ddag", "S", "P", "pounds",
  "copyright", "textregistered", "texttrademark", "textdegree", "textbullet",
  "textbackslash", "textasciitilde", "textasciicircum", "textgreater",
  "textless", "textbar", "textunderscore", "textdollar", "textperthousand",
  "aa", "AA", "ae", "AE", "oe", "OE", "o", "O", "ss", "l", "L", "i", "j",
  "c", "v", "u", "H", "t", "d", "b", "k", "r", "accent",
  "TeX", "LaTeX", "LaTeXe", "BibTeX",
  "newcommand", "renewcommand", "providecommand", "def", "edef", "gdef",
  "xdef", "let", "newenvironment", "renewenvironment", "NewDocumentCommand",
  "NewDocumentEnvironment", "DeclareMathOperator", "newtheorem", "newcounter",
  "setcounter", "addtocounter", "stepcounter", "value", "the",
  "usepackage", "documentclass", "usetheme", "usecolortheme", "usefonttheme",
  "useinnertheme", "useoutertheme", "setbeamertemplate", "setbeamercolor",
  "setbeamerfont", "setbeamersize", "setbeamercovered", "beamertemplatenavigationsymbolsempty",
  "definecolor", "colorlet", "graphicspath", "input", "include",
  "AtBeginSection", "AtBeginSubsection", "AtBeginDocument", "frame",
  "mode", "logo", "titlegraphic", "subject", "keywords",
  "vskip", "hskip", "kern", "strut", "rule", "hrule", "vrule", "hrulefill",
  "dotfill", "makebox", "mbox", "parbox", "raisebox", "smash", "llap", "rlap",
  "newpage", "clearpage", "pagebreak", "nopagebreak", "samepage",
  "ignorespaces", "unskip", "relax", "protect", "expandafter", "csname",
  "endcsname", "if", "else", "fi", "ifx", "ifnum", "ifdim", "ifmmode",
  "footnotemark", "footnotetext", "thefootnote", "footnoterule",
  "displaystyle", "textstyle", "scriptstyle", "limits", "nolimits",
  "do", "makeatletter", "makeatother", "selectfont", "fontsize", "usefont",
  "normalfont", "scriptscriptstyle",
  // columns syntax and inline TikZ (core constructs, counted via envs)
  "column", "tikz", "node", "draw", "fill", "path", "coordinate",
  "setlength", "itemsep", "parsep", "parskip", "topsep", "leftmargin"
]);

// --- low-level TeX text utilities -------------------------------------------

function stripComments(source) {
  return source.split("\n").map((line) => {
    let from = 0;
    while (from < line.length) {
      const idx = line.indexOf("%", from);
      if (idx < 0) return line;
      let backslashes = 0;
      for (let j = idx - 1; j >= 0 && line[j] === "\\"; j--) backslashes++;
      if (backslashes % 2 === 0) return line.slice(0, idx);
      from = idx + 1;
    }
    return line;
  }).join("\n");
}

function matchGroupEnd(source, openIdx, open = "{", close = "}") {
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") { i++; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Remove bodies of given environments, recording the removed env names.
// Used for tikzpicture (atomic box: inner envs/commands belong to the TikZ
// pipeline) and verbatim-ish content.
function removeEnvBodies(source, envNames, counter) {
  let result = source;
  for (const env of envNames) {
    const begin = `\\begin{${env}}`;
    const end = `\\end{${env}}`;
    let idx = result.indexOf(begin);
    while (idx >= 0) {
      const close = result.indexOf(end, idx + begin.length);
      if (close < 0) break;
      counter[env] = (counter[env] ?? 0) + 1;
      result = `${result.slice(0, idx)}\\REMOVEDenv{${env}}${result.slice(close + end.length)}`;
      idx = result.indexOf(begin);
    }
  }
  return result;
}

// Replace inline/display math with placeholders; returns the count.
function stripMath(source) {
  let mathCount = 0;
  let result = source.replace(/\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, () => {
    mathCount++;
    return " \\REMOVEDmath ";
  });
  // $$...$$ then $...$ (ignoring \$)
  result = result.replace(/(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$/g, () => {
    mathCount++;
    return " \\REMOVEDmath ";
  });
  result = result.replace(/(?<!\\)\$[^$]*?(?<!\\)\$/g, () => {
    mathCount++;
    return " \\REMOVEDmath ";
  });
  return { result, mathCount };
}

function countMatches(source, regex) {
  let count = 0;
  while (regex.exec(source)) count++;
  return count;
}

// --- frame extraction --------------------------------------------------------

function extractFrames(source) {
  const frames = [];
  const beginRe = /\\begin\{frame\}/g;
  let match = beginRe.exec(source);
  while (match) {
    const endIdx = source.indexOf("\\end{frame}", beginRe.lastIndex);
    if (endIdx < 0) break;
    let cursor = beginRe.lastIndex;
    let overlaySpec = null;
    let options = null;
    let title = null;

    const skipSpaces = () => {
      while (cursor < endIdx && /\s/.test(source[cursor])) cursor++;
    };
    skipSpaces();
    if (source[cursor] === "<") {
      const close = source.indexOf(">", cursor);
      if (close > 0 && close < endIdx) {
        overlaySpec = source.slice(cursor + 1, close);
        cursor = close + 1;
      }
    }
    skipSpaces();
    if (source[cursor] === "[") {
      const close = matchGroupEnd(source, cursor, "[", "]");
      if (close > 0 && close < endIdx) {
        options = source.slice(cursor + 1, close);
        cursor = close + 1;
      }
    }
    skipSpaces();
    for (let group = 0; group < 2 && source[cursor] === "{"; group++) {
      const close = matchGroupEnd(source, cursor);
      if (close < 0 || close > endIdx) break;
      if (group === 0) title = source.slice(cursor + 1, close);
      cursor = close + 1;
      skipSpaces();
    }

    frames.push({ overlaySpec, options, title, body: source.slice(cursor, endIdx) });
    beginRe.lastIndex = endIdx + "\\end{frame}".length;
    match = beginRe.exec(source);
  }
  return frames;
}

// --- per-file analysis --------------------------------------------------------

const OVERLAY_HOLDER = /\\(only|uncover|visible|invisible|alt|temporal|onslide|action|item|alert|textbf|textit|emph|structure|color|includegraphics|column)\s*<([^<>\n]{1,60})>/g;
const ENV_OVERLAY = /\\begin\{[a-zA-Z*]+\}\s*<([^<>\n]{1,60})>/g;

function analyzeOverlays(body, frameHeadSpec) {
  const specs = [];
  for (const regex of [OVERLAY_HOLDER, ENV_OVERLAY]) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(body))) specs.push(m[m.length - 1]);
  }
  if (frameHeadSpec) specs.push(frameHeadSpec);
  const pauses = countMatches(body, /\\pause\b/g);
  let maxStep = 0;
  for (const spec of specs) {
    for (const num of spec.match(/\d+/g) ?? []) {
      maxStep = Math.max(maxStep, Number(num));
    }
  }
  return { specCount: specs.length, pauses, maxStep };
}

function classifyFrame(frame, fileContext) {
  const reasons = new Set();
  let tier = "core";
  const escalate = (level, reason) => {
    reasons.add(reason);
    if (level === "fallback") tier = "fallback";
    else if (level === "b4" && tier === "core") tier = "b4";
  };

  const removedEnvs = {};
  let body = removeEnvBodies(frame.body, [...VERBATIM_ENVS], removedEnvs);
  body = removeEnvBodies(body, ["tikzpicture"], removedEnvs);
  for (const env of Object.keys(removedEnvs)) {
    if (VERBATIM_ENVS.has(env)) escalate("fallback", `env:${env}`);
  }
  const tikzCount = removedEnvs.tikzpicture ?? 0;

  const removedMathEnvs = {};
  body = removeEnvBodies(body, [...DISPLAY_MATH_ENVS], removedMathEnvs);
  const { result: noMath, mathCount: inlineMathCount } = stripMath(body);
  body = noMath;
  const mathCount = inlineMathCount
    + Object.values(removedMathEnvs).reduce((sum, count) => sum + count, 0);

  // environments
  const envCounts = {};
  for (const m of body.matchAll(/\\begin\{([a-zA-Z*@]+)\}/g)) {
    const env = m[1];
    if (env === "REMOVEDenv" || MATH_INTERNAL_ENVS.has(env)) continue;
    envCounts[env] = (envCounts[env] ?? 0) + 1;
    if (CORE_ENVS.has(env)) continue;
    if (B4_ENVS.has(env)) escalate("b4", `env:${env}`);
    else if (FALLBACK_ENVS.has(env)) escalate("fallback", `env:${env}`);
    else if (fileContext.definedEnvs.has(env)) escalate("fallback", "custom-env");
    else escalate("fallback", `env:${env}`);
  }
  if (tikzCount > 0) envCounts.tikzpicture = tikzCount;
  for (const [env, count] of Object.entries(removedMathEnvs)) {
    envCounts[env] = (envCounts[env] ?? 0) + count;
  }

  // tier-relevant commands
  for (const cmd of B4_CMDS) {
    if (new RegExp(`\\\\${cmd}\\b`).test(body)) escalate("b4", `cmd:${cmd}`);
  }
  for (const cmd of FALLBACK_CMDS) {
    if (new RegExp(`\\\\${cmd}\\b`).test(body)) escalate("fallback", `cmd:${cmd}`);
  }
  const frameOptions = frame.options ?? "";
  if (/\bfragile\b/.test(frameOptions)) escalate("fallback", "opt:fragile");
  if (/\ballowframebreaks\b/.test(frameOptions)) escalate("fallback", "opt:allowframebreaks");
  if (/\bshrink\b/.test(frameOptions)) escalate("b4", "opt:shrink");

  // command frequency + unknown/custom commands
  const cmdCounts = {};
  const customMacroUses = {};
  const unknownCmds = {};
  for (const m of body.matchAll(/\\([a-zA-Z]+)\b/g)) {
    const name = m[1];
    if (REPORT_CMDS.includes(name)) cmdCounts[name] = (cmdCounts[name] ?? 0) + 1;
    if (fileContext.definedMacros.has(name)) {
      customMacroUses[name] = (customMacroUses[name] ?? 0) + 1;
    } else if (!KNOWN_NOISE_CMDS.has(name) && name !== "REMOVEDmath" && name !== "REMOVEDenv") {
      unknownCmds[name] = (unknownCmds[name] ?? 0) + 1;
    }
  }

  const overlays = analyzeOverlays(body, frame.overlaySpec);

  return {
    title: frame.title?.slice(0, 80) ?? null,
    tier,
    reasons: [...reasons].sort(),
    envCounts,
    cmdCounts,
    mathCount,
    overlays,
    usesCustomMacros: Object.keys(customMacroUses).length > 0,
    customMacroUses,
    unknownCmds
  };
}

function collectDefinitions(source) {
  const definedMacros = new Set();
  const definedEnvs = new Set();
  for (const m of source.matchAll(/\\(?:re)?newcommand\*?\s*\{?\\([a-zA-Z]+)\}?/g)) definedMacros.add(m[1]);
  for (const m of source.matchAll(/\\providecommand\*?\s*\{?\\([a-zA-Z]+)\}?/g)) definedMacros.add(m[1]);
  for (const m of source.matchAll(/\\def\s*\\([a-zA-Z]+)/g)) definedMacros.add(m[1]);
  for (const m of source.matchAll(/\\NewDocumentCommand\s*\{?\\([a-zA-Z]+)\}?/g)) definedMacros.add(m[1]);
  for (const m of source.matchAll(/\\DeclareMathOperator\*?\s*\{?\\([a-zA-Z]+)\}?/g)) definedMacros.add(m[1]);
  for (const m of source.matchAll(/\\(?:re)?newenvironment\*?\s*\{([a-zA-Z*@]+)\}/g)) definedEnvs.add(m[1]);
  for (const m of source.matchAll(/\\NewDocumentEnvironment\s*\{([a-zA-Z*@]+)\}/g)) definedEnvs.add(m[1]);
  for (const m of source.matchAll(/\\newtcolorbox\s*(?:\[[^\]]*\])?\s*\{([a-zA-Z*@]+)\}/g)) definedEnvs.add(m[1]);
  for (const m of source.matchAll(/\\newtheorem\*?\s*\{([a-zA-Z*@]+)\}/g)) definedEnvs.add(m[1]);
  return { definedMacros, definedEnvs };
}

function analyzeFile(path, raw) {
  const source = stripComments(raw);
  const hasDocumentclass = /\\documentclass[^\n]*\{beamer\}/.test(source);
  const frames = extractFrames(source);
  if (!hasDocumentclass && frames.length === 0) {
    return { path, kind: "other" };
  }

  const fileContext = collectDefinitions(source);
  // theorem-like envs defined via \newtheorem behave like core blocks
  for (const env of fileContext.definedEnvs) {
    if (/\\newtheorem\*?\s*\{/.test(source) && new RegExp(`\\\\newtheorem\\*?\\s*\\{${env}\\}`).test(source)) {
      CORE_ENVS.add(env);
    }
  }

  const themes = [...source.matchAll(/\\usetheme(?:\[([^\]]*)\])?\{([a-zA-Z]+)\}/g)]
    .map((m) => ({ name: m[2], options: m[1] ?? null }));
  const colorThemes = [...source.matchAll(/\\usecolortheme(?:\[[^\]]*\])?\{([a-zA-Z]+)\}/g)].map((m) => m[1]);
  const fontThemes = [...source.matchAll(/\\usefonttheme(?:\[[^\]]*\])?\{([a-zA-Z]+)\}/g)].map((m) => m[1]);
  const aspectRatio = /aspectratio\s*=\s*(\d+)/.exec(source)?.[1] ?? null;

  return {
    path,
    kind: hasDocumentclass ? "deck" : "fragment",
    frames: frames.map((frame) => classifyFrame(frame, fileContext)),
    legacyFrameCmds: countMatches(source, /\\frame\s*\{/g),
    themes,
    colorThemes,
    fontThemes,
    aspectRatio,
    sections: countMatches(source, /\\section\*?\s*[{[]/g),
    atBeginSection: /\\AtBeginSection/.test(source),
    setbeamertemplate: countMatches(source, /\\setbeamertemplate\b/g),
    setbeamercolor: countMatches(source, /\\setbeamercolor\b/g),
    definecolor: countMatches(source, /\\definecolor\b/g),
    macroDefs: fileContext.definedMacros.size,
    envDefs: fileContext.definedEnvs.size
  };
}

// --- input collection ----------------------------------------------------------

function collectInputFiles(args) {
  const files = [];
  const visit = (path) => {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) {
        if (entry.startsWith(".")) continue;
        visit(join(path, entry));
      }
    } else if (path.endsWith(".tex")) {
      files.push(path);
    }
  };
  for (const arg of args) visit(resolve(process.cwd(), arg));
  return files;
}

// --- aggregation and report ------------------------------------------------------

function aggregate(fileReports) {
  const decks = fileReports.filter((r) => r.kind === "deck");
  const fragments = fileReports.filter((r) => r.kind === "fragment");
  const analyzed = [...decks, ...fragments];
  const allFrames = analyzed.flatMap((r) => r.frames);

  const tally = (getCounts) => {
    const occurrences = {};
    const fileSet = {};
    const frameSet = {};
    for (const report of analyzed) {
      const seenInFile = new Set();
      for (const frame of report.frames) {
        for (const [name, count] of Object.entries(getCounts(frame))) {
          occurrences[name] = (occurrences[name] ?? 0) + count;
          frameSet[name] = (frameSet[name] ?? 0) + 1;
          seenInFile.add(name);
        }
      }
      for (const name of seenInFile) fileSet[name] = (fileSet[name] ?? 0) + 1;
    }
    return { occurrences, files: fileSet, frames: frameSet };
  };

  const envStats = tally((frame) => frame.envCounts);
  const cmdStats = tally((frame) => frame.cmdCounts);
  const unknownCmdStats = tally((frame) => frame.unknownCmds);
  const customMacroStats = tally((frame) => frame.customMacroUses);

  const tierCounts = { core: 0, b4: 0, fallback: 0 };
  const reasonCounts = {};
  let framesWithCustomMacros = 0;
  let framesWithUnknownCmds = 0;
  let framesWithOverlays = 0;
  let totalPauses = 0;
  let totalSpecs = 0;
  for (const frame of allFrames) {
    tierCounts[frame.tier]++;
    for (const reason of frame.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    if (frame.usesCustomMacros) framesWithCustomMacros++;
    if (Object.keys(frame.unknownCmds).length > 0) framesWithUnknownCmds++;
    if (frame.overlays.specCount > 0 || frame.overlays.pauses > 0) framesWithOverlays++;
    totalPauses += frame.overlays.pauses;
    totalSpecs += frame.overlays.specCount;
  }

  const themeCounts = {};
  for (const report of decks) {
    for (const theme of report.themes) {
      themeCounts[theme.name] = (themeCounts[theme.name] ?? 0) + 1;
    }
  }
  const aspectCounts = {};
  for (const report of decks) {
    const key = report.aspectRatio ?? "43 (default)";
    aspectCounts[key] = (aspectCounts[key] ?? 0) + 1;
  }

  return {
    counts: {
      files: fileReports.length,
      decks: decks.length,
      fragments: fragments.length,
      other: fileReports.length - analyzed.length,
      frames: allFrames.length,
      legacyFrameCmds: analyzed.reduce((sum, r) => sum + r.legacyFrameCmds, 0)
    },
    tierCounts,
    reasonCounts,
    overlay: { framesWithOverlays, totalSpecs, totalPauses },
    macroStats: {
      framesWithCustomMacros,
      framesWithUnknownCmds,
      totalMacroDefs: analyzed.reduce((sum, r) => sum + r.macroDefs, 0)
    },
    themeCounts,
    aspectCounts,
    envStats,
    cmdStats,
    unknownCmdStats,
    customMacroStats
  };
}

function printTable(title, stats, { top, totalFrames, totalFiles }) {
  const rows = Object.entries(stats.occurrences)
    .sort((a, b) => b[1] - a[1])
    .slice(0, top);
  if (rows.length === 0) return;
  console.log(`\n## ${title}\n`);
  console.log("| name | occurrences | files | % frames |");
  console.log("| --- | ---: | ---: | ---: |");
  for (const [name, count] of rows) {
    const framePct = ((stats.frames[name] ?? 0) / totalFrames * 100).toFixed(1);
    console.log(`| ${name} | ${count} | ${stats.files[name] ?? 0}/${totalFiles} | ${framePct}% |`);
  }
}

function printReport(agg, top) {
  const { counts, tierCounts } = agg;
  const totalFrames = Math.max(1, counts.frames);
  const totalFiles = counts.decks + counts.fragments;
  const pct = (n) => `${(n / totalFrames * 100).toFixed(1)}%`;

  console.log(`# Beamer corpus scan\n`);
  console.log(`Files: ${counts.files} (${counts.decks} decks, ${counts.fragments} fragments, ${counts.other} other)`);
  console.log(`Frames: ${counts.frames} (+ ${counts.legacyFrameCmds} legacy \\frame{} commands, not analyzed)`);

  console.log(`\n## Frame coverage tiers\n`);
  console.log(`| tier | frames | share |`);
  console.log(`| --- | ---: | ---: |`);
  console.log(`| core (B2 subset) | ${tierCounts.core} | ${pct(tierCounts.core)} |`);
  console.log(`| needs B4 | ${tierCounts.b4} | ${pct(tierCounts.b4)} |`);
  console.log(`| fallback | ${tierCounts.fallback} | ${pct(tierCounts.fallback)} |`);

  const reasonRows = Object.entries(agg.reasonCounts).sort((a, b) => b[1] - a[1]).slice(0, top);
  console.log(`\n## Why frames leave the core tier (frame counts)\n`);
  for (const [reason, count] of reasonRows) {
    console.log(`- ${reason}: ${count} (${pct(count)})`);
  }

  console.log(`\n## Overlays\n`);
  console.log(`- frames with overlay content: ${agg.overlay.framesWithOverlays} (${pct(agg.overlay.framesWithOverlays)})`);
  console.log(`- overlay specs: ${agg.overlay.totalSpecs}, \\pause uses: ${agg.overlay.totalPauses}`);

  console.log(`\n## Macros\n`);
  console.log(`- macro definitions: ${agg.macroStats.totalMacroDefs}`);
  console.log(`- frames using file-defined macros: ${agg.macroStats.framesWithCustomMacros} (${pct(agg.macroStats.framesWithCustomMacros)})`);
  console.log(`- frames with unknown commands: ${agg.macroStats.framesWithUnknownCmds} (${pct(agg.macroStats.framesWithUnknownCmds)})`);

  const themeRows = Object.entries(agg.themeCounts).sort((a, b) => b[1] - a[1]);
  console.log(`\n## Themes (decks)\n`);
  for (const [name, count] of themeRows.slice(0, top)) console.log(`- ${name}: ${count}`);
  console.log(`\n## Aspect ratios (decks)\n`);
  for (const [name, count] of Object.entries(agg.aspectCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`- ${name}: ${count}`);
  }

  const tableContext = { top, totalFrames, totalFiles };
  printTable("Environments (inside frames)", agg.envStats, tableContext);
  printTable("Commands (inside frames)", agg.cmdStats, tableContext);
  printTable("Unknown commands (candidates for subset/expansion review)", agg.unknownCmdStats, tableContext);
  printTable("File-defined macro uses", agg.customMacroStats, tableContext);
}

// --- main -------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { inputs: [], list: null, json: null, top: 20 };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list") options.list = argv[++i];
    else if (arg === "--json") options.json = argv[++i];
    else if (arg === "--top") options.top = Number(argv[++i]);
    else if (arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    else options.inputs.push(arg);
  }
  if (options.inputs.length === 0 && !options.list) {
    options.inputs.push("artifacts/beamer-corpus");
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv);
  let files = collectInputFiles(options.inputs);
  if (options.list) {
    const listed = readFileSync(resolve(process.cwd(), options.list), "utf8")
      .split("\n").map((line) => line.trim()).filter(Boolean)
      .map((line) => resolve(process.cwd(), line));
    files = files.concat(listed);
  }

  const seenHashes = new Set();
  const fileReports = [];
  let duplicates = 0;
  for (const file of files) {
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      console.warn(`skipped (unreadable): ${file}`);
      continue;
    }
    const hash = createHash("sha256").update(raw).digest("hex");
    if (seenHashes.has(hash)) {
      duplicates++;
      continue;
    }
    seenHashes.add(hash);
    try {
      fileReports.push(analyzeFile(file, raw));
    } catch (error) {
      console.warn(`skipped (analysis error): ${file}: ${error.message}`);
    }
  }

  const agg = aggregate(fileReports);
  printReport(agg, options.top);
  if (duplicates > 0) console.log(`\n(${duplicates} duplicate files skipped by content hash)`);

  if (options.json) {
    writeFileSync(resolve(process.cwd(), options.json), `${JSON.stringify({ aggregate: agg, files: fileReports }, null, 2)}\n`);
    console.log(`\nDetailed report written to ${options.json}`);
  }
}

main();
