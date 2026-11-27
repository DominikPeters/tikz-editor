#!/usr/bin/env node
// LuaLaTeX ground truth for Latin Modern optical sizes in text mode.
//
// For each LaTeX size command (\tiny ... \Huge) of the 10pt, 11pt and 12pt
// article classes and each family/series/shape combination, records which
// font file LuaLaTeX's default (fontspec-less, TU encoding) setup selects
// (`\fontname\font` inside the box) and the \wd/\ht/\dp of ~200 strings set
// in an \hbox. The editor's text engine is checked against it by
// test/tex-lm-optical-text-oracle.spec.ts.
//
// Boxes depend only on (font file, size), so they are stored once per
// distinct pair; each configuration refers to its pair.
//
//   node scripts/capture-lm-optical-text-oracle.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { texOracleEnv } from "./lib/tex-oracle.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(repoRoot, "test", "fixtures", "fonts", "lm-optical-text-oracle.json");

export const SIZE_COMMANDS = ["tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge"];
export const CLASS_SIZES = [10, 11, 12];
// [id, TeX declarations]
export const COMBOS = [
  ["rm-m-n", ""],
  ["rm-bx-n", "\\bfseries"],
  ["rm-m-it", "\\itshape"],
  ["rm-bx-it", "\\bfseries\\itshape"],
  ["rm-m-sl", "\\slshape"],
  ["rm-bx-sl", "\\bfseries\\slshape"],
  ["rm-m-sc", "\\scshape"],
  ["rm-bx-sc", "\\bfseries\\scshape"],
  ["sf-m-n", "\\sffamily"],
  ["sf-bx-n", "\\sffamily\\bfseries"],
  ["sf-m-it", "\\sffamily\\itshape"],
  ["sf-m-sl", "\\sffamily\\slshape"],
  ["sf-bx-it", "\\sffamily\\bfseries\\itshape"],
  ["sf-m-sc", "\\sffamily\\scshape"],
  ["tt-m-n", "\\ttfamily"],
  ["tt-bx-n", "\\ttfamily\\bfseries"],
  ["tt-m-it", "\\ttfamily\\itshape"],
  ["tt-m-sl", "\\ttfamily\\slshape"],
  ["tt-m-sc", "\\ttfamily\\scshape"],
];

// Plain-text strings: words, ligatures, kerning pairs, digits and plot-style
// labels, punctuation, TeX ligatures (-- ``''), accented Latin-1 letters and
// interword spaces. Characters special to TeX are avoided.
const WORDS = [
  "x", "y", "A", "g", "Ag", "Hello", "World", "Time", "Temperature", "Pressure", "Velocity", "Frequency",
  "Amplitude", "Voltage", "Current", "Power", "Energy", "Density", "Iteration", "Epoch", "Accuracy", "Loss",
  "Error", "Speedup", "Throughput", "Latency", "Memory", "Samples", "Count", "Probability", "Distance",
  "Year", "Month", "Day", "Week", "Hour", "Minute", "Second", "Output", "Input", "Signal", "Noise",
  "office", "affine", "fluffy", "baffle", "waffle", "fjord", "efficient", "difficult", "shuffle", "official",
  "AV", "AW", "AY", "AT", "To", "Te", "Ty", "Wa", "We", "Yo", "LT", "LV", "LY", "VA", "Va", "Vo", "PA", "FA",
  "kerning", "Typography", "WAVE", "AVATAR", "Tokyo", "Wolfgang", "Yvonne", "Lyon", "Paris", "Venice",
  "0", "1", "2", "5", "10", "20", "50", "100", "250", "1000", "0.5", "0.25", "1.5", "2.0", "3.14", "-1", "-0.5",
  "1,000", "10,000", "2019", "2020", "2021", "2022", "2023", "2024", "1e3", "10.5", "99.9",
  "Run 1", "Run 2", "Model A", "Model B", "Baseline", "Ours", "Method 1", "Method 2", "Data", "Fit",
  "Experiment", "Simulation", "Theory", "Measured", "Predicted", "linear fit", "quadratic", "exponential",
  "Time (s)", "Distance (m)", "Speed [km/h]", "Force (N)", "Mass (kg)", "Energy [J]", "Rate (1/s)",
  "x-axis", "y-axis", "left--right", "pages 1--10", "a---b", "``quoted''", "`single'", "it's", "e.g.",
  "i.e.", "etc.", "Fig.", "Eq.", "vs.", "N/A", "50/50", "(a)", "[b]", "a; b", "a: b", "a, b", "Wait!", "Why?",
  "@home", "a+b", "a=b", "a<b", "a*b", "|x|",
  "café", "naïve", "über", "Straße", "François", "São Paulo", "Ångström",
  "Zürich", "Malmö", "España", "résumé", "École",
  "The quick brown fox", "jumps over the lazy dog", "Sphinx of black quartz", "judge my vow",
  "Pack my box with", "five dozen liquor jugs", "THE QUICK BROWN FOX", "MiXeD CaSe TeXt",
  "abcdefghijklm", "nopqrstuvwxyz", "ABCDEFGHIJKLM", "NOPQRSTUVWXYZ", "0123456789",
  "Mean squared error", "Number of nodes", "Training steps", "Validation set", "Test set",
  "Normalized frequency", "Relative error", "Wall-clock time", "Cumulative reward", "Batch size",
];
export const STRINGS = WORDS;

// The strings contain no TeX-special characters; under TU encoding `<`, `|`
// and `@` are ordinary glyphs, so they are typeset as written.
function texString(text) {
  return text;
}

function documentFor(classSize) {
  const rows = [];
  for (const command of SIZE_COMMANDS) {
    for (const [combo, declarations] of COMBOS) {
      rows.push(`\\begingroup\\${command}${declarations}\\probefont{${command}}{${combo}}%`);
      STRINGS.forEach((text, index) => rows.push(`\\setbox0=\\hbox{${texString(text)}}\\directlua{box(${index})}%`));
      rows.push("\\endgroup");
    }
  }
  return String.raw`\documentclass[${classSize}pt]{article}
\directlua{dofile("probe.lua")}
\makeatletter
\def\probefont#1#2{\setbox0=\hbox{\xdef\probename{\fontname\font}\xdef\probesize{\f@size}}\directlua{config("#1", "#2", "\luaescapestring{\probename}", "\probesize")}}
\makeatother
\begin{document}
${rows.join("\n")}
\directlua{finish()}
x
\end{document}
`;
}

const LUA = String.raw`
local out = {}
function config(command, combo, name, size)
  out[#out + 1] = "C " .. command .. " " .. combo .. " " .. size .. " " .. name
end
function box(index)
  local b = tex.box[0]
  out[#out + 1] = "B " .. index .. " " .. b.width .. " " .. b.height .. " " .. b.depth
end
function finish()
  local f = io.open("probe.txt", "w")
  f:write(table.concat(out, "\n"))
  f:close()
end
`;

function capture(classSize) {
  const dir = mkdtempSync(join(tmpdir(), "lm-optical-oracle-"));
  try {
    writeFileSync(join(dir, "probe.lua"), LUA);
    writeFileSync(join(dir, "probe.tex"), documentFor(classSize));
    execFileSync("lualatex", ["--interaction=nonstopmode", "--halt-on-error", "probe.tex"], {
      cwd: dir, env: texOracleEnv(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
    return readFileSync(join(dir, "probe.txt"), "utf8").split("\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fontFile(name) {
  // e.g. "[lmroman9-regular]:+tlig;" at 9.0pt -> lmroman9-regular
  const match = /\[?([a-z0-9-]+)\]?(?::|\s|"|$)/i.exec(name.replace(/^"/, ""));
  if (!match) throw new Error(`Unrecognised font name ${name}`);
  return match[1];
}

const SP = 65536;
const configs = [];
const faces = new Map();
for (const classSize of CLASS_SIZES) {
  let current = null;
  for (const line of capture(classSize)) {
    const parts = line.split(" ");
    if (parts[0] === "C") {
      const [, command, combo, size] = parts;
      const font = fontFile(parts.slice(4).join(" "));
      const key = `${font}@${size}`;
      if (!faces.has(key)) faces.set(key, { font, sizePt: Number(size), boxes: [] });
      current = { face: faces.get(key), fresh: faces.get(key).boxes.length === 0 };
      configs.push({ classPt: classSize, command, combo, sizePt: Number(size), font, face: key });
    } else if (parts[0] === "B" && current?.fresh) {
      const [, , wd, ht, dp] = parts.map(Number);
      current.face.boxes.push([wd, ht, dp].map(value => Math.round(value / SP * 1e5) / 1e5));
    }
  }
}
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify({
  generator: "scripts/capture-lm-optical-text-oracle.mjs",
  engine: execFileSync("lualatex", ["--version"], { encoding: "utf8" }).split("\n")[0],
  units: "pt (sp / 65536, rounded to 1e-5)",
  strings: STRINGS,
  configs,
  faces: Object.fromEntries(faces),
})}\n`);
console.log(`Wrote ${configs.length} configurations, ${faces.size} faces, ${STRINGS.length} strings to ${OUTPUT}`);
