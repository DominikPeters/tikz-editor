// Regenerate the checked-in TeX oracle for \pgfmathprintnumber and the
// /pgf/number format/ keys (test/fixtures/pgf-number-format/cases.json).
// Ordinary Vitest runs read the fixture and need no TeX installation.
//
// Every case runs \pgfmathprintnumberto[<options>]{<input>}\result inside a
// group in one LuaLaTeX run and records \detokenize of the token list PGF
// stored. Cases for which TeX reports an error are kept with `texError` so the
// spec can show them as excluded.
//
//   node scripts/capture-pgf-number-format-oracle.mjs
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const fixture = fileURLToPath(new URL("../test/fixtures/pgf-number-format/cases.json", import.meta.url));

// --- inputs ---------------------------------------------------------------
const integers = ["0", "1", "-1", "2", "7", "-12", "10", "100", "999", "1000", "-1000", "12345", "123456", "1234567", "-9876543", "1000000000000000"];
const decimals = [
  "0.5", "-0.5", "0.05", "0.005", "0.25", "0.125", "0.75", "-0.75", "1.5", "2.5", "-2.5", "3.25",
  "9.995", "99.995", "999.9995", "9.9999", "0.99999", "0.0099", "0.00049", "0.00051", "0.995", "0.0995",
  "4.568", "24415.98123", "123456.12345", "3.14159265358979", "-3.14159265358979", "2.718281828",
  "1.000", "1.10", "100.00", "0.1000", "1003.75", "1006.75", "123.345", "0.0012", "0.0014", "1000.0123",
  "100.0567", "0.010073452", "1.23567", "-0.001", "-0.004", "-0.006", "-0.05", "19999.9996", "0.333333", "0.666667",
  "12.5", "-17.875", "0.1", "0.2", "0.3", "33.333", "1.05", "1.15", "1.25", "1.35", "2.45", "-99.5"
];
const sci = ["1e-12", "-2.5e-7", "1.5e-3", "6.42e-16", "1.23456789e10", "-4.2e15", "5e-04", "0.000010003452", "1E3", "2e+2", "9.99e5", "-1.0e-2", "7.77e1", "1e15", "3e-5"];
const exotic = [".5", "-.75", "+3.2", "007.50", "1Y1.5e2]", "2Y3.25e-1]", "0Y0.0e0]", "inf", "-inf", "nan", "0e5", "0.0", "-0", "123456999", "123456999.12", "123456789012345678901234567890", "0.000000000000123456789"];
const allNumbers = [...integers, ...decimals, ...sci, ...exotic];
const finiteSubset = [
  "0", "1", "-1", "12", "1000", "-1000", "1234567", "0.5", "-0.5", "0.05", "0.125", "1.5", "9.995", "999.9995", "0.99999",
  "0.0099", "4.568", "24415.98123", "123456.12345", "3.14159265358979", "-3.14159265358979", "1.000", "100.00", "0.1000",
  "-0.004", "1e-12", "-2.5e-7", "1.5e-3", "1.23456789e10", "-4.2e15", "5e-04", "+3.2", "007.50", "inf", "-inf", "nan", "0e5"
];
const fracNumbers = ["0", "1", "-1", "12", "0.5", "-0.5", "0.25", "0.125", "0.75", "-0.75", "1.5", "2.5", "3.25", "-17.875", "0.333333", "0.666667", "0.2", "0.1", "0.3", "12.5", "33.333", "1.05", "2.718281828", "3.14159265358979", "0.05", "1e-3", "7.77e1", "1.25", "-2.5", "0.0625"];

// --- formats ----------------------------------------------------------------
const range = (n) => [...Array(n).keys()];
const coreFormats = [
  "",
  ...range(9).map(p => `fixed,precision=${p}`),
  ...range(9).map(p => `fixed,fixed zerofill,precision=${p}`),
  ...range(9).map(p => `sci,precision=${p}`),
  ...range(6).map(p => `sci,sci zerofill,precision=${p}`),
  ...[0, 1, 3, 4, 6].map(p => `std,precision=${p}`),
  "std=-3:3", "std=-2", "std=-1:2,precision=3", "std,sci precision=4", "std,zerofill,precision=3",
  "zerofill", "zerofill=false", "precision=4",
  "relative*=1", "relative*=2", "relative*=-3", "relative*=3,precision=0", "relative*=3,precision=0,relative style=fixed",
  "relative=2", "relative=-2", "relative=3,relative round mode=mantissa", "relative*=1,every relative/.style=sci",
  "relative*=2,every relative/.style={fixed,fixed zerofill}", "relative*=0,precision=4",
  ...[1, 2, 3, 4, 6].map(p => `fixed relative,precision=${p}`),
  "int detect", "int detect,precision=1", "int trunc", "int trunc,1000 sep={}"
];
const styleFormats = [
  "read comma as period",
  "set decimal separator={{{,}}}", "dec sep={,}", "dec sep={{,}}", "dec sep={{{,}}}", "set thousands separator={\\,}",
  "1000 sep={\\,}", "1000 sep={}", "1000 sep={.}", "1000 sep={{{,}}}", "1000 sep={\\ }", "fixed,precision=6,1000 sep in fractionals",
  "fixed,fixed zerofill,precision=7,1000 sep in fractionals,1000 sep={\\,}",
  "min exponent for 1000 sep=4", "min exponent for 1000 sep=6", "use period", "use comma", "use comma,fixed,precision=4",
  "skip 0.", "skip 0.,fixed,precision=3", "skip 0.,fixed zerofill,precision=2", "skip 0.,sci",
  "showpos", "print sign", "showpos,sci", "showpos,fixed zerofill", "showpos,int trunc", "showpos=false",
  "sci,sci e", "sci,sci E", "sci,sci subscript", "sci,sci superscript", "sci,sci 10e", "sci,sci 10^e", "sci e", "sci,sci e,precision=4,zerofill",
  "sci,sci generic={mantissa sep=\\times,exponent={10^{#1}}}",
  "sci,sci generic={mantissa sep={\\cdot},exponent={E#1},empty mantissa sep={!}},retain unit mantissa=false",
  "sci generic={mantissa sep=,exponent={\\mathrm{e}{#1}}}",
  "@dec sep mark={|}", "@sci exponent mark={!},sci", "@dec sep mark={|},@sci exponent mark={!}",
  "assume math mode", "assume math mode=false", "verbatim", "verbatim,sci", "verbatim,fixed,precision=5",
  "retain unit mantissa=false", "sci,retain unit mantissa=false", "sci,sci e,retain unit mantissa=false",
  "sci,sci subscript,retain unit mantissa=false,showpos", "sci,precision=0,retain unit mantissa=false",
  "/pgf/number format/fixed,/pgf/number format/precision=1", "use comma,showpos,sci,zerofill"
];
const fracFormats = [
  "frac", "frac,frac denom=8", "frac,frac denom=3", "frac,frac whole=false", "frac,frac shift=2", "frac,frac shift=6",
  "frac,frac TeX=\\tfrac", "frac,showpos", "frac,verbatim", "frac,frac whole=false,frac denom=16"
];

const cases = [];
const add = (input, options) => cases.push({ id: cases.length, input, options });
for (const options of coreFormats) for (const input of allNumbers) add(input, options);
for (const options of styleFormats) for (const input of finiteSubset) add(input, options);
for (const options of fracFormats) for (const input of fracNumbers) add(input, options);
for (const input of ["1,5", "-0,25", "12,5e3", ",5"]) add(input, "read comma as period");
for (const input of ["1,5", "-0,25"]) add(input, "read comma as period,use comma");
for (const options of ["fixed relative,precision=0", "sci,precision=0,sci zerofill", "fixed,precision=0,fixed zerofill,showpos"]) {
  for (const input of finiteSubset) add(input, options);
}
// Invalid inputs: PGF reports an error and prints NaN.
for (const input of ["1,5", "abc", "1.2.3", "--1", "12a"]) add(input, "");

// --- seeded fuzz --------------------------------------------------------------
let seed = 0x5eed1234;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const pick = (list) => list[Math.floor(random() * list.length)];
const digits = (count, alphabet) => Array.from({ length: count }, () => pick(alphabet)).join("");
const fuzzNumber = () => {
  const alphabet = pick(["0123456789", "99999995", "0000059", "1234567890999"]);
  const sign = pick(["", "", "-", "+"]);
  const integer = digits(Math.floor(random() * 8), alphabet);
  const fraction = random() < 0.75 ? "." + digits(1 + Math.floor(random() * 10), alphabet) : "";
  const exponent = random() < 0.35 ? pick(["e", "E"]) + String(Math.floor(random() * 29) - 14) : "";
  const body = integer + fraction;
  return sign + (body === "" || body === "." ? "0" : body) + exponent;
};
const fuzzFormat = () => [
  pick(["", "fixed", "sci", "std", "std=-2:2", "std=-5", "fixed relative", "relative*=1", "relative*=-2", "relative=1", "int trunc"]),
  pick(["", "precision=0", "precision=1", "precision=2", "precision=3", "precision=5", "precision=7"]),
  pick(["", "", "fixed zerofill", "sci zerofill", "zerofill"]),
  pick(["", "", "use comma", "1000 sep={\\,}", "1000 sep in fractionals", "min exponent for 1000 sep=3"]),
  pick(["", "", "showpos", "skip 0.", "sci e", "sci subscript", "retain unit mantissa=false", "sci precision=1"])
].filter(part => part !== "").join(",");
for (let index = 0; index < 2500; index += 1) add(fuzzNumber(), fuzzFormat());
const fuzzFraction = () => {
  const sign = pick(["", "-"]);
  const integer = digits(Math.floor(random() * 3), "0123456789");
  return sign + (integer === "" ? "0" : integer) + "." + digits(1 + Math.floor(random() * 4), "0123456789");
};
for (let index = 0; index < 400; index += 1) {
  add(fuzzFraction(), ["frac", pick(["", "frac denom=4", "frac denom=10", "frac denom=16", "frac denom=100", "frac whole=false", "frac shift=1", "frac shift=3"]), pick(["", "showpos"])].filter(Boolean).join(","));
}

// --- TeX run ------------------------------------------------------------------
const luaWriter = String.raw`
nfresults = {}
function nfwrite(id, text) nfresults[#nfresults + 1] = tostring(id) .. "\t" .. text end
function nfflush(path)
  local file = io.open(path, "w")
  for _, line in ipairs(nfresults) do file:write(line, "\n") end
  file:close()
end`;

const body = cases.map(entry => `\\nfcase{${entry.id}}\\begingroup\\pgfmathprintnumberto[${entry.options}]{${entry.input}}\\nfresult\\nfout{${entry.id}}\\endgroup`).join("\n");
const source = String.raw`\documentclass{article}
\usepackage{pgf}
\usepgflibrary{fpu}
\pagestyle{empty}
\directlua{dofile("nfwriter.lua")}
\makeatletter
\def\nfcase#1{\typeout{NFCASE #1}}
\def\nfout#1{\directlua{nfwrite(#1, "\luaescapestring{\detokenize\expandafter{\nfresult}}")}}
\makeatother
\begin{document}
\directlua{nfwrite("PGF", "\luaescapestring{\pgfversion}")}
` + body + String.raw`
\directlua{nfflush("results.txt")}
\end{document}
`;

const directory = mkdtempSync(join(tmpdir(), "pgf-number-format-oracle-"));
try {
  writeFileSync(join(directory, "nfwriter.lua"), luaWriter);
  writeFileSync(join(directory, "oracle.tex"), source);
  try {
    execFileSync("lualatex", ["-interaction=nonstopmode", "oracle.tex"], { cwd: directory, stdio: "pipe", timeout: 900_000, maxBuffer: 1 << 28 });
  } catch (error) {
    // Errors in individual cases are expected; the log attributes them.
    if (error.code === "ETIMEDOUT" || error.signal) throw error;
  }
  const results = new Map();
  let pgfVersion = "";
  for (const line of readFileSync(join(directory, "results.txt"), "utf8").split("\n")) {
    if (line.length === 0) continue;
    const tab = line.indexOf("\t");
    const id = line.slice(0, tab);
    const text = line.slice(tab + 1);
    if (id === "PGF") pgfVersion = text;
    else results.set(Number(id), text);
  }
  const errors = new Map();
  let current = null;
  for (const line of readFileSync(join(directory, "oracle.log"), "latin1").split("\n")) {
    const marker = /^NFCASE (\d+)/u.exec(line);
    if (marker) { current = Number(marker[1]); continue; }
    // `! Package pgf ...` lines are \pgf@typeout warnings, not errors.
    if (line.startsWith("! ") && !line.startsWith("! Package pgf") && current !== null && !errors.has(current)) errors.set(current, line.slice(2).trim());
  }
  // Group by option list: { options, cases: [[input, expected] | [input, expected, texError]] }.
  const groups = new Map();
  let errorCount = 0;
  for (const entry of cases) {
    const expected = results.get(entry.id) ?? null;
    const texError = errors.get(entry.id) ?? (expected === null ? "no result recorded" : null);
    if (texError !== null) errorCount += 1;
    if (!groups.has(entry.options)) groups.set(entry.options, []);
    groups.get(entry.options).push(texError === null ? [entry.input, expected] : [entry.input, expected, texError]);
  }
  mkdirSync(dirname(fixture), { recursive: true });
  const header = {
    description: "\\pgfmathprintnumberto[options]{input}\\result inside a group; `expected` is \\detokenize of \\result from LuaLaTeX. Regenerate with scripts/capture-pgf-number-format-oracle.mjs",
    pgfVersion,
    caseCount: cases.length
  };
  const lines = [...groups].map(([options, entries]) => `  ${JSON.stringify({ options, cases: entries })}`).join(",\n");
  writeFileSync(fixture, `${JSON.stringify(header, null, 2).slice(0, -2)},\n  "groups": [\n${lines}\n  ]\n}\n`);
  console.log(`Captured ${cases.length} cases in ${groups.size} option lists from PGF ${pgfVersion}; ${errorCount} with TeX errors.`);
} finally {
  if (!process.env.KEEP_ORACLE_DIR) rmSync(directory, { recursive: true, force: true });
  else console.log(`kept ${directory}`);
}
