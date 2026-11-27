// Capture the pgfmath oracle: run a table of expressions through real
// LuaLaTeX `\pgfmathparse`, once with PGF's default fixed-point engine and
// once with the fpu library (`/pgf/fpu`, output format=fixed), and write
// test/fixtures/pgfmath/oracle.json. `test/pgfmath-oracle.spec.ts` compares
// the editor's evaluator against it without needing TeX.
//
//   node scripts/capture-pgfmath-oracle.mjs
//
// Only PGF itself is loaded (tikz + the fpu library); nothing from pgfplots.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const fixturePath = fileURLToPath(new URL("../test/fixtures/pgfmath/oracle.json", import.meta.url));

// ---------------------------------------------------------------------------
// The expression table. Each case: { expr, family, modes?, setup? }.
// `family` selects the comparison tolerance in the spec. `setup` is
// { seed?, trig?, functions? } applied inside the case's TeX group.

const cases = [];
const seen = new Set();
function add(family, expr, extra = {}) {
  const key = `${expr}|${JSON.stringify(extra.setup ?? {})}`;
  if (seen.has(key)) return;
  seen.add(key);
  cases.push({ family, expr, ...extra });
}

// Literals and number syntax. "+0" defeats PGF's digits-only fast path.
for (const literal of ["0", "7", "42", "3.25", ".5", "5.", "16383", "0.1", "0.33333", "1234.5678", "16383.5"]) {
  add("literal", literal);
  add("literal", `${literal}+0`);
}
for (const literal of ["010+0", "0777+0", "017+0", "00+0", "0x1F+0", "0XfF+0", "0xff+1", "0b101+0", "0B11+0", "1 2+0", " 3 + 4", "+5", "--5", "-+5", "+-5"]) {
  add("literal", literal);
}
for (const literal of ["1e3", "1E2", "1.5e-3", "2e+2", "1e-4", "1.25e1", "3e0", "1e-5+0", "-2e2", "1e3+1", "1e4"]) {
  add("literal", literal);
}
for (const unit of ["pt", "cm", "mm", "in", "bp", "pc", "dd", "cc", "sp", "em", "ex", "px", "nd", "nc"]) {
  add("units", `1${unit}`);
  add("units", `2.5${unit}+0`);
}
for (const expr of [
  "1cm+2mm", "2pt+3", "3+2pt", "2*5pt", "5pt*2", "6pt/2", "6pt/3pt", "1cm/1cm", "2pt*3pt", "3/2pt",
  "(2pt)^3", "2pt^2", "2 cm", "sin(2pt)", "max(1pt,2)", "min(2,1cm)", "2pt<3", "2pt==2", "scalar(5pt)",
  "scalar(1cm)+0", "scalar(1cm)+1pt", "1pt+scalar(1cm)", "abs(-3pt)", "-1in", "1in-1cm", "veclen(3pt,4pt)",
  "1cm*0", "0.5\\wd0", "2pt!", "2pt r", "1.5em+1ex", "3mu", "1pt?2:3"
]) {
  if (expr.includes("\\wd")) continue;
  add("units", expr);
}

// Operator precedence and associativity (PGF's shunting-yard quirks).
for (const expr of [
  "2^3^2", "-2^2", "(-2)^2", "2^-2", "2^-1*4", "-3!", "3!^2", "2*3r", "3r^2", "2+3r", "1||0&&0", "0&&1||1",
  "1?2:3?4:5", "0?2:3?4:5", "0?2:0?4:5", "1<2<3", "3>2>1", "1+2*3-4/2", "(1+2)*3", "2*(3+4)*5", "10-4-3",
  "100/10/5", "2*-3+4", "!0+1", "!1+1", "!2^2", "-2*-3", "-(2+3)", "2--3", "5-+2", "sin 30", "sin 30^2",
  "sin -30", "sin(30)^2", "2*sin 30", "1+2==3", "1+2<4", "1==1==1", "2*3!", "3!*2", "3!!", "4!/2", "2r",
  "0.5r*2", "(1)r", "1<2?10:20", "0||0?1:2", "!0?7:8", "1?2+3:4+5", "2^2^0", "(2^3)^2", "2^(3^2)", "-1^2",
  "-(1)^2", "+3", "1+-2", "1*+2", "2^+3"
]) {
  add("precedence", expr);
}

// Arithmetic grid.
const arithValues = ["0", "1", "-1", "2", "3.5", "-4.25", "0.125", "10", "-12.5", "100", "0.3", "7"];
for (const a of arithValues) {
  for (const b of arithValues) {
    add("linear", `${a}+${b}`);
    add("linear", `${a}-${b}`);
    add("product", `${a}*${b}`);
    if (b !== "0") add("quotient", `${a}/${b}`);
  }
}
for (const expr of [
  "add(2,3)", "subtract(2,3)", "multiply(2.5,4)", "divide(9,4)", "neg(3)", "neg(-2.5)", "reciprocal(4)",
  "reciprocal(0.25)", "reciprocal(-8)", "real(3)", "real(2.5)", "abs(-7.5)", "abs(3)", "sign(-2)", "sign(0)",
  "sign(4.5)", "1/3", "2/3", "1/7", "10/3", "-10/3", "1000/7", "1/16", "5/0.5", "0.1+0.2", "16383+0.5",
  "8191.5*2", "100*100", "128*128-1", "-8192*2", "0.001*0.001", "12345/10"
]) {
  add(expr.startsWith("sign") || expr.startsWith("abs") || expr.startsWith("neg") || expr.startsWith("real") || expr.startsWith("add") || expr.startsWith("subtract") ? "linear" : "quotient", expr);
}

// Powers.
for (const base of ["2", "3", "-2", "0.5", "10", "1.5", "-3"]) {
  for (const exponent of ["0", "1", "2", "3", "-1", "-2", "5"]) {
    add("power-int", `${base}^${exponent}`);
  }
}
for (const expr of [
  "pow(2,10)", "pow(2,0.5)", "pow(9,0.5)", "pow(10,1.5)", "2^0.5", "3^1.2", "5^-0.5", "0^0", "0^2", "0^-1",
  "pow(0,0)", "pow(1.5,2.5)", "4^0.25", "100^0.5", "2^13", "2^14", "(-8)^(1/3)", "(-2)^0.5", "e^2", "e^1"
]) {
  add(/\^\d+$|^pow\(\d+,\d+\)$|\^-\d+$/u.test(expr) && !expr.startsWith("(-") ? "power-int" : "power", expr);
}

// Comparisons and logic.
const compareValues = ["1", "2", "-1", "1.5", "0", "1.00001"];
for (const a of compareValues) {
  for (const b of compareValues) {
    for (const op of ["<", ">", "==", "!=", "<=", ">="]) {
      add("exact", `${a}${op}${b}`);
    }
  }
}
for (const [fn, args] of [
  ["equal", "1,1"], ["equal", "1,2"], ["notequal", "1,2"], ["notequal", "3,3"], ["greater", "2,1"], ["greater", "1,2"],
  ["less", "1,2"], ["less", "2,2"], ["notgreater", "2,2"], ["notgreater", "3,2"], ["notless", "2,2"], ["notless", "1,2"],
  ["and", "1,1"], ["and", "1,0"], ["and", "0,0"], ["and", "2,-1"], ["or", "0,0"], ["or", "0,1"], ["or", "1,1"],
  ["not", "0"], ["not", "1"], ["not", "-3"], ["ifthenelse", "1,2,3"], ["ifthenelse", "0,2,3"], ["ifthenelse", "0.5,7,8"],
  ["ifthenelse", "1<2,10,20"], ["approxequalto", "1,1.00001"], ["approxequalto", "1,1.001"], ["true", null], ["false", null]
]) {
  add("exact", args == null ? fn : `${fn}(${args})`);
}
for (const expr of ["1&&1", "1&&0", "0||0", "0||2", "!0", "!1", "!-1", "!!3", "true&&false", "true||false", "1==1&&2==2", "1<2||0", "(1<2)+(3<4)"]) {
  add("exact", expr);
}

// Rounding.
for (const value of ["2.5", "-2.5", "3.5", "-3.5", "2.4", "-2.4", "2.6", "-2.6", "0", "7", "-7", "0.5", "-0.5", "1.99999", "-0.25", "12.75"]) {
  for (const fn of ["round", "floor", "ceil", "int", "frac"]) {
    add("exact", `${fn}(${value})`);
  }
}

// Integer arithmetic.
for (const [a, b] of [["7", "3"], ["-7", "3"], ["7", "-3"], ["-7", "-3"], ["7.5", "2"], ["-7.5", "2"], ["10", "2.5"], ["4", "1.5"], ["9", "4"], ["0", "5"], ["5", "7"], ["-1", "3"], ["12", "5"], ["100", "7"]]) {
  add("exact", `mod(${a},${b})`);
  add("exact", `Mod(${a},${b})`);
  add("exact", `div(${a},${b})`);
}
for (const [a, b] of [["12", "18"], ["17", "5"], ["0", "9"], ["-12", "8"], ["100", "75"], ["7", "7"], ["48", "-36"]]) {
  add("exact", `gcd(${a},${b})`);
}
for (const value of ["0", "1", "2", "3", "4", "9", "17", "21", "97", "100", "-7", "7.9", "1009", "1001"]) {
  add("exact", `isprime(${value})`);
  add("exact", `iseven(${value})`);
  add("exact", `isodd(${value})`);
}
for (const value of ["0", "1", "2", "3", "5", "7", "2.5", "-3", "4.9"]) {
  add("exact", `factorial(${value})`);
  add("exact", `${value.startsWith("-") ? `(${value})` : value}!`);
}

// Trigonometry. sin/cos come from a table interpolated linearly per degree.
for (const angle of ["0", "1", "15", "30", "33.3", "45", "60", "75", "89", "90", "120", "135", "150", "180", "210", "270", "300", "359", "360", "400", "-30", "-90", "-135", "720", "0.5", "1000", "12.345"]) {
  add("trig", `sin(${angle})`);
  add("trig", `cos(${angle})`);
}
for (const angle of ["0", "10", "30", "45", "60", "80", "-45", "135", "200", "-60"]) {
  add("trig-ratio", `tan(${angle})`);
  add("trig-ratio", `cot(${angle === "0" ? "90" : angle})`);
  add("trig-ratio", `sec(${angle})`);
  add("trig-ratio", `cosec(${angle === "0" ? "30" : angle})`);
}
for (const value of ["0", "0.5", "-0.5", "1", "-1", "0.1", "0.9", "-0.99", "0.70711", "0.25"]) {
  add("inverse-trig", `asin(${value})`);
  add("inverse-trig", `acos(${value})`);
}
for (const value of ["0", "1", "-1", "0.5", "2", "10", "-3", "100", "0.1", "1000"]) {
  add("inverse-trig", `atan(${value})`);
}
for (const [y, x] of [["1", "1"], ["1", "-1"], ["-1", "-1"], ["-1", "1"], ["0", "1"], ["0", "-1"], ["1", "0"], ["-1", "0"], ["3", "4"], ["-5", "12"], ["0.5", "2"], ["0", "0"]]) {
  add("inverse-trig", `atan2(${y},${x})`);
}
for (const expr of ["deg(1)", "deg(pi)", "deg(-0.5)", "rad(180)", "rad(90)", "rad(1)", "radians(1)", "3.5r", "pi r", "(pi/2)r", "-1r", "deg(2*pi)", "rad(-45)"]) {
  add("trig-convert", expr);
}
for (const expr of ["pi", "e", "pi+0", "e+0", "2*pi", "pi/2", "e*e", "-pi"]) {
  add("constant", expr);
}

// exp, logarithms, roots, hyperbolic functions.
for (const value of ["0", "1", "-1", "2", "0.5", "-0.5", "5", "-5", "9", "-9", "-10", "0.001", "3.3", "-2.2"]) {
  add("exp", `exp(${value})`);
}
for (const value of ["1", "2", "0.5", "10", "100", "1000", "0.01", "2.71828", "16383", "0.001", "7.5", "3"]) {
  add("log", `ln(${value})`);
  add("log", `log10(${value})`);
  add("log", `log2(${value})`);
}
for (const value of ["0", "1", "2", "4", "9", "0.25", "0.5", "10", "100", "1000", "12345", "16383", "0.01", "3.14159", "50"]) {
  add("sqrt", `sqrt(${value})`);
}
for (const [a, b] of [["3", "4"], ["5", "12"], ["1", "1"], ["0", "7"], ["-3", "4"], ["100", "100"], ["0.3", "0.4"], ["1000", "2000"], ["8000", "8000"], ["0.01", "0.02"]]) {
  add("veclen", `veclen(${a},${b})`);
}
for (const value of ["0", "0.5", "1", "-1", "2", "-2.5", "3", "0.1"]) {
  add("hyperbolic", `sinh(${value})`);
  add("hyperbolic", `cosh(${value})`);
  add("hyperbolic", `tanh(${value})`);
}

// min/max, variadic.
for (const expr of ["max(1,2,3)", "min(1,2,3)", "max(-1,-5)", "min(4,2,8)", "max(5)", "min(5)", "max(1.5,1.25)", "min(-0.5,0.5)", "max(2,7,1,9,3)", "min(3,3)", "max(0,-0.001)"]) {
  add("exact", expr);
}

// Text values, arrays and base conversion.
for (const expr of [
  "{1,2,3}[0]", "{1,2,3}[2]", "{1,2,3}[1]*2", "2*{1,2,3}[1]", "{4,5,6}[1+1]", "array({7,8,9},1)", "array({7,8,9},0)",
  "dim({1,2,3})", "dim({5})", "{{1,2},{3,4}}[1][0]", "{\"a\",\"b\"}[1]", "({1,2,3}[2])^2", "{1,2,3}", "{1.5,2.5}[1]+1",
  "\"abc\"", "\"12\"+1", "ifthenelse(1,\"yes\",\"no\")", "1?\"yes\":\"no\"", "hex(255)", "Hex(255)", "oct(8)", "bin(5)", "hex(0)",
  "bin(255)", "hex(4095)", "oct(511)", "Hex(3054)", "hex(15.7)", "{1,2,3}[1.7]"
]) {
  add("text", expr);
}

// Random functions with explicit seeds (PGF's Park-Miller generator).
for (const seed of [1, 42, 2024]) {
  for (const expr of ["rnd", "rand", "random()", "random(10)", "random(3,7)", "random(7,3)", "rnd+rnd", "rnd()", "rand()", "random(100)+random(100)", "1+rnd*0"]) {
    add("random", expr, { setup: { seed } });
  }
}

// Errors: the evaluator must report an error where TeX does.
for (const expr of [
  "1/0", "sqrt(-1)", "ln(0)", "ln(-1)", "log10(-5)", "foo(1)", "bar", "20000+0", "16384+0", "1e5+1", "100*200",
  "exp(10)", "exp(12)", "8!", "factorial(10)", "pow(2,15)", "2^14*2", "mod(1,0)", "Mod(5,0)", "div(1,0)", "1/0.00001",
  "tan(90)", "cot(0)", "sec(90)", "cosec(0)", "reciprocal(0)", "{1,2}[5]", "array({1,2},3)", "\"ab\"+1", "1+", "(1+2",
  "1..2+0", "2pt3", "1 ? 2", "pi()", "sin(1,2)", "atan2(1)", "(-2)^0.5", "veclen(16000,16000)", "max(20000,1)", "16383.99*2",
  "-16384+0", "10000+10000", "sin(", "1+@", "09+0"
]) {
  add("error", expr);
}

// trig format=rad.
for (const expr of ["sin(pi/2)", "cos(pi)", "sin(1)", "cos(0.5)", "tan(pi/4)", "asin(1)", "acos(0)", "atan(1)", "atan2(1,1)", "sin(30)", "deg(pi)", "rad(180)", "sec(0)", "cot(pi/4)", "3r", "sin(pi/6)"]) {
  add("trig-rad", expr, { setup: { trig: "rad" } });
}

// declare function.
const fns = String.raw`f(\x)=\x*\x; g(\a,\b)=\a+2*\b; h(\x)=\x^2; c=3; k(\t)=f(\t)+1; u(\x)=\x+1pt; s(\x)=sin(\x)*2;`;
for (const expr of ["f(3)", "f(-2)", "g(1,2)", "g(-1,0.5)", "h(-2)", "h(3)", "c", "c*2", "k(2)", "f(c)", "u(1)", "2pt+f(1)", "f(1)+2pt", "s(30)", "f(f(2))", "h(-2)+0", "f(1.5)", "g(f(2),c)", "-f(2)", "h(0.5)"]) {
  add("declare", expr, { setup: { functions: fns } });
}

// ---------------------------------------------------------------------------
// TeX driver.

function texCase(entry, id, mode) {
  const setup = [];
  if (mode === "float") setup.push(String.raw`\pgfkeys{/pgf/fpu,/pgf/fpu/output format=fixed}`);
  if (entry.setup?.seed != null) setup.push(String.raw`\pgfmathsetseed{${entry.setup.seed}}`);
  if (entry.setup?.trig) setup.push(String.raw`\pgfkeys{/pgf/trig format=${entry.setup.trig}}`);
  if (entry.setup?.functions) setup.push(String.raw`\pgfkeys{/pgf/declare function={${entry.setup.functions}}}`);
  return String.raw`\begingroup${setup.join("")}\typeout{@@B|${id}}\pgfmathparse{${entry.expr}}\typeout{@@R|${id}|\ifpgfmathunitsdeclared1\else0\fi|\detokenize\expandafter{\pgfmathresult}}\endgroup`;
}

function runTex(directory, entries, mode) {
  const body = entries.map(({ entry, id }) => texCase(entry, id, mode)).join("\n");
  const source = String.raw`\documentclass{article}
\usepackage{tikz}
\usepgflibrary{fpu}
\begin{document}
` + body + String.raw`
\typeout{@@END}
\end{document}
`;
  writeFileSync(join(directory, "oracle.tex"), source);
  try {
    execFileSync("lualatex", ["-interaction=nonstopmode", "oracle.tex"], {
      cwd: directory,
      stdio: "pipe",
      env: { ...process.env, max_print_line: "1000000", error_line: "254", half_error_line: "238" },
      timeout: 300_000
    });
  } catch {
    // Errors are expected; the log tells which case raised them.
  }
  return readFileSync(join(directory, "oracle.log"), "latin1");
}

function parseLog(log) {
  const results = new Map();
  let current = null;
  for (const line of log.split("\n")) {
    if (line.startsWith("@@B|")) {
      current = { id: Number(line.slice(4)), errors: [], done: false };
      results.set(current.id, current);
    } else if (line.startsWith("@@R|") && current) {
      const [, id, units, ...rest] = line.split("|");
      if (Number(id) === current.id) {
        current.done = true;
        current.units = units === "1";
        current.result = rest.join("|");
      }
    } else if (line.startsWith("! ") && current && !current.done) {
      current.errors.push(line.slice(2).trim());
    }
  }
  return results;
}

function capture(mode) {
  const directory = mkdtempSync(join(tmpdir(), `pgfmath-oracle-${mode}-`));
  const outcome = new Map();
  try {
    let pending = cases.map((entry, id) => ({ entry, id })).filter(({ entry }) => (entry.modes ?? ["fixed", "float"]).includes(mode));
    while (pending.length > 0) {
      const results = parseLog(runTex(directory, pending, mode));
      let stopped = -1;
      for (let index = 0; index < pending.length; index += 1) {
        const { id } = pending[index];
        const result = results.get(id);
        if (result?.done) {
          outcome.set(id, { result: result.result, units: result.units, errors: result.errors });
          continue;
        }
        // This case derailed TeX (a fatal error or swallowed input): record it
        // as an error and restart after it.
        outcome.set(id, { result: null, units: false, errors: [...(result?.errors ?? []), "derailed"] });
        stopped = index;
        break;
      }
      pending = stopped < 0 ? [] : pending.slice(stopped + 1);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return outcome;
}

const fixed = capture("fixed");
const float = capture("float");
const version = execFileSync("kpsewhich", ["pgf.revision.tex"], { encoding: "utf8" }).trim();
const revision = /\\def\\pgfrevision\{([^}]*)\}/u.exec(readFileSync(version, "utf8"))?.[1] ?? "unknown";
const out = {
  description: "pgfmath results from LuaLaTeX \\pgfmathparse; regenerate with node scripts/capture-pgfmath-oracle.mjs",
  pgfVersion: revision,
  cases: cases.map((entry, id) => ({
    expr: entry.expr,
    family: entry.family,
    ...(entry.setup ? { setup: entry.setup } : {}),
    fixed: fixed.get(id) ?? null,
    float: float.get(id) ?? null
  }))
};
mkdirSync(dirname(fixturePath), { recursive: true });
writeFileSync(fixturePath, `${JSON.stringify(out, null, 1)}\n`);
console.log(`Captured ${cases.length} expressions (fixed and float) from PGF ${revision}.`);
