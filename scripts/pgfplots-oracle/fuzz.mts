/**
 * Generator-based fuzz of the pgfplots renderer (design/pgfplots.md 5.3):
 * random valid axes from the supported feature set, compiled with the oracle
 * harness (Tier 1 probes + Tier 2 trace, harness preamble, compat 1.18) and
 * compared with the editor at the oracle spec's tolerances.
 *
 *   npm run fuzz:pgfplots -- [--seed N] [--cases 300] [--batch 25] [--no-shrink] [--replay file.json]
 *
 * Every case is stored as its *choices* (environment, axis option list,
 * plots with their option lists and inputs), not as a seed, so a case can be
 * replayed and shrunk by deleting choices. Shrinking removes one axis option
 * or one plot (or one plot option) at a time while the failure keeps at
 * least one of its original finding codes; candidates of one round are
 * compiled in one batch. Outputs: artifacts/pgfplots-fuzz/<seed>/
 * (cases.json, failures.json with shrunk cases, summary.txt).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { renderObservedPicture } from "./adapter.js";
import { compareTier1, compareTier2, type CompareResult } from "./compare.js";
import { runOracleCases, type CaseResult } from "./run.js";
import { FULL_VARIANT, type BatchCase } from "./tex-source.js";

const root = resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const opt = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const seed = Number(opt("--seed") ?? "1");
const total = Number(opt("--cases") ?? "300");
const batchSize = Number(opt("--batch") ?? "25");
const shrinkEnabled = !args.includes("--no-shrink");
const replay = opt("--replay");
const outDir = join(root, "artifacts", "pgfplots-fuzz", replay ? "replay" : String(seed));
const cacheDir = join(root, "artifacts", "pgfplots-fuzz", "cache");
const TOLERANCES = { colour: 0.002 };

// ---------------------------------------------------------------------------
// Choices

export type Plot = { plus: boolean; opts: string[]; input: string; legend?: string };
export type FuzzCase = { id: string; env: string; axisOpts: string[]; plots: Plot[]; extra: string[] };

function rng(s: number): () => number {
  let a = s >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function generate(index: number, r: () => number): FuzzCase {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;
  const chance = (p: number) => r() < p;
  const num = (lo: number, hi: number, digits = 1) => Number((lo + r() * (hi - lo)).toFixed(digits));
  const logY = chance(0.15); const logX = !logY && chance(0.07);
  const env = logY && logX ? "loglogaxis" : logY ? "semilogyaxis" : logX ? "semilogxaxis" : "axis";
  const bars = env === "axis" && chance(0.15) ? pick(["ybar", "xbar", "ybar stacked"]) : null;
  const axisOpts: string[] = [];
  // Size: avoid exact multiples of 35pt (tick-step transitions decided by noise, behaviour P note).
  const size = pick(["", "w", "wh", "soa"]);
  // Box lengths (target − 45pt, or the `scale only axis` size − 50 below) at an exact multiple of 35pt
  // decide the tick count by TeX's fixed-point noise (behaviour I1 note); move them off.
  const offGrid = (target: number) => [target - 45, target - 50].some((len) => Math.abs(len / 35 - Math.round(len / 35)) * 35 < 1) ? target + 7 : target;
  const w = offGrid(Math.round(num(150, 330, 0)));
  const h = offGrid(Math.round(num(110, 260, 0)));
  if (size === "w") axisOpts.push(`width=${w}pt`);
  if (size === "wh") axisOpts.push(`width=${w}pt`, `height=${h}pt`);
  if (size === "soa") axisOpts.push("scale only axis", `width=${w - 50}pt`, `height=${h - 50}pt`);
  if (bars) axisOpts.push(bars);
  if (!bars && chance(0.2)) axisOpts.push(`xmin=${num(-6, -1)}`, `xmax=${num(1, 6)}`);
  if (!bars && !logY && chance(0.15)) axisOpts.push(`ymin=${num(-10, -1)}`);
  if (chance(0.15)) axisOpts.push(pick(["enlargelimits=false", "enlargelimits=0.05", "enlarge x limits=false", "enlarge y limits=upper"]));
  if (chance(0.3)) axisOpts.push(pick(["grid=major", "grid=both", "xmajorgrids", "ymajorgrids"]));
  if (env === "axis" && chance(0.15)) axisOpts.push(`minor tick num=${pick([1, 3, 4])}`);
  if (chance(0.15)) axisOpts.push(`tick align=${pick(["inside", "outside", "center"])}`);
  if (chance(0.4)) axisOpts.push(`xlabel={${pick(["$x$", "Time", "Error rate", "$\\alpha$"])}}`);
  if (chance(0.4)) axisOpts.push(`ylabel={${pick(["$y$", "Value", "Accuracy", "$f(x)$"])}}`);
  if (chance(0.25)) axisOpts.push(`title={${pick(["Result", "Run A", "Comparison"])}}`);
  if (!bars && env === "axis" && chance(0.15)) axisOpts.push(pick(["axis lines=left", "axis lines=middle", "axis lines*=left", "axis lines=box"]));
  if (!bars && env === "axis" && chance(0.07)) axisOpts.push(pick(["x dir=reverse", "y dir=reverse"]));
  if (chance(0.1)) axisOpts.push(pick(["clip=false", "axis on top"]));
  if (chance(0.1)) axisOpts.push(pick(["cycle list name=black white", "cycle list name=color list", "cycle list name=exotic", "no markers"]));
  if (env === "axis" && !bars && chance(0.1)) axisOpts.push(`xtick distance=${pick([0.5, 1, 2, 5])}`);
  if (chance(0.08)) axisOpts.push("thick");
  const legend = chance(0.35);
  if (legend && chance(0.6)) axisOpts.push(`legend pos=${pick(["north west", "north east", "south east", "south west", "outer north east"])}`);
  if (legend && chance(0.15)) axisOpts.push("legend columns=2");
  if (legend && chance(0.15)) axisOpts.push(`legend cell align=${pick(["left", "right"])}`);

  const plots: Plot[] = [];
  const n = 1 + Math.floor(r() * (bars ? 3 : 4));
  const xs = Array.from({ length: 3 + Math.floor(r() * 5) }, (_, i) => i + 1);
  for (let i = 0; i < n; i += 1) {
    const plus = chance(0.6);
    const opts: string[] = [];
    let input: string;
    if (bars) {
      input = `coordinates {${xs.map((x) => (bars === "xbar" ? `(${num(1, 9)},${x})` : `(${x},${num(1, 9)})`)).join(" ")}}`;
      if (!plus && chance(0.5)) opts.push(pick(["fill=blue!30", "fill=red!40,draw=red"]));
    } else {
      const kind = pick(["expr", "expr", "coords", "table"]);
      const positive = logY;
      if (kind === "expr") {
        const f = positive ? pick(["exp(x)", "x^2+1", "exp(-x)+0.5", "2^x"]) : pick(["x^2", "sin(deg(x))", "2*x+1", "exp(-x^2)", "x^3-2*x", "cos(deg(x))*3"]);
        if (chance(0.6)) opts.push(`domain=${logX ? "0.1:10" : `${num(-5, -0.5)}:${num(0.5, 5)}`}`);
        else if (logX) opts.push("domain=0.1:10");
        if (chance(0.4)) opts.push(`samples=${pick([5, 11, 21, 40])}`);
        input = `{${f}}`;
      } else {
        const pts = xs.map((x) => [logX ? x * x : x, positive ? num(0.5, 500, 2) : num(-5, 9)]);
        input = kind === "coords" ? `coordinates {${pts.map(([x, y]) => `(${x},${y})`).join(" ")}}` : `table {\nx y\n${pts.map(([x, y]) => `${x} ${y}`).join("\n")}\n}`;
      }
      if (chance(0.25)) opts.push(pick(["smooth", "const plot", "only marks", "ycomb", "sharp plot"]));
      if (chance(0.3)) opts.push(`mark=${pick(["*", "square*", "triangle*", "o", "x", "+", "none", "diamond*"])}`);
      if (chance(0.2)) opts.push(pick(["thick", "very thick", "dashed", "dotted", "densely dashed", "line width=1pt"]));
      if (chance(0.3)) opts.push(pick(["red", "blue", "green!60!black", "orange", "color=violet", "black"]));
      if (chance(0.08)) opts.push("mark size=3pt");
    }
    plots.push({ plus, opts, input, ...(legend ? { legend: pick(["Data", "Model", "$x^2$", "Baseline", "Ours"]) + String(i) } : {}) });
  }
  return { id: `f${seed}-${index}`, env, axisOpts, plots, extra: [] };
}

export function body(c: FuzzCase): string {
  const plots = c.plots.map((p) => `\\addplot${p.plus ? "+" : ""}${p.opts.length > 0 || !p.plus ? `[${p.opts.join(", ")}]` : ""} ${p.input};${p.legend ? `\n\\addlegendentry{${p.legend}}` : ""}`);
  return `\\begin{tikzpicture}\n\\begin{${c.env}}[${c.axisOpts.join(", ")}]\n${plots.join("\n")}\n${c.extra.join("\n")}\\end{${c.env}}\n\\end{tikzpicture}\n`;
}

// ---------------------------------------------------------------------------
// Running

/**
 * `visible`: a failure a reader would see — something missing or extra, a different text or tick
 * count, or a position off by more than 0.5pt. Others are near-tolerance numerical differences.
 */
type Outcome = { id: string; status: "pass" | "fail" | "tex-failed" | "editor-error"; codes: string[]; findings: string[]; diagnostics: string[]; visible?: boolean; maxDelta?: number };
const STRUCTURAL = /-(missing|extra|presence|text|count)$|^(tick-index|tick-value|paint|dash|line-width|paint-order)$/u;

/** Compiles cases in batches; a failing batch is bisected so one bad case does not lose the rest. */
function oracle(cases: FuzzCase[], label: string): Map<string, CaseResult | null> {
  const out = new Map<string, CaseResult | null>();
  const runBatch = (list: FuzzCase[], depth: number): void => {
    if (list.length === 0) return;
    try {
      const report = runOracleCases(list.map((c): BatchCase => ({ id: c.id, body: body(c), variant: FULL_VARIANT })), { engine: "lualatex", cacheDir, workDir: join(outDir, "work", `${label}-${depth}`) });
      for (const c of list) out.set(c.id, report.results.get(c.id) ?? null);
    } catch {
      if (list.length === 1) { out.set(list[0]?.id ?? "", null); return; }
      const mid = Math.ceil(list.length / 2);
      runBatch(list.slice(0, mid), depth + 1);
      runBatch(list.slice(mid), depth + 1);
    }
  };
  runBatch(cases, 0);
  return out;
}

const codesOf = (r: CompareResult) => r.findings.map((f) => `T${f.tier}:${f.code}`);

async function judge(c: FuzzCase, result: CaseResult | null | undefined): Promise<Outcome> {
  if (!result) return { id: c.id, status: "tex-failed", codes: [], findings: [], diagnostics: [] };
  const picture = await renderObservedPicture(body(c));
  const diagnostics = picture.diagnostics.map((d) => `${d.severity}:${d.code ?? d.message.slice(0, 60)}`);
  const t1 = compareTier1(result.tier1, picture.tier1, { tolerances: TOLERANCES });
  const t2 = compareTier2(result.tier2, picture.tier2, { tolerances: TOLERANCES });
  const codes = [...new Set([...codesOf(t1), ...codesOf(t2)])].sort();
  const findings = [...t1.findings, ...t2.findings].slice(0, 12).map((f) => `${f.code} ${f.where}: ${f.message}`.slice(0, 200));
  // A case the editor diagnoses as unsupported is a correct refusal, not a rendering failure.
  const unsupported = picture.diagnostics.some((d) => (d.code ?? "").startsWith("unsupported-") || (d.code ?? "").startsWith("invalid-pgfplots"));
  if (unsupported) return { id: c.id, status: "editor-error", codes, findings, diagnostics };
  const all = [...t1.findings, ...t2.findings];
  const maxDelta = Math.max(0, ...all.map((f) => f.delta ?? 0));
  const visible = all.some((f) => STRUCTURAL.test(f.code) && f.code !== "textbox-missing" && f.code !== "textbox-extra") || maxDelta > 0.5;
  return { id: c.id, status: codes.length === 0 ? "pass" : "fail", codes, findings, diagnostics, visible, maxDelta };
}

function reductions(c: FuzzCase): FuzzCase[] {
  const out: FuzzCase[] = [];
  let k = 0;
  const next = (patch: Partial<FuzzCase>): FuzzCase => ({ ...c, ...patch, id: `${c.id}-s${k++}` });
  c.axisOpts.forEach((_, i) => out.push(next({ axisOpts: c.axisOpts.filter((__, j) => j !== i) })));
  if (c.plots.length > 1) c.plots.forEach((_, i) => out.push(next({ plots: c.plots.filter((__, j) => j !== i) })));
  c.plots.forEach((p, i) => {
    p.opts.forEach((_, o) => out.push(next({ plots: c.plots.map((q, j) => (j === i ? { ...q, opts: q.opts.filter((__, m) => m !== o) } : q)) })));
    if (p.legend) out.push(next({ plots: c.plots.map((q, j) => (j === i ? { plus: q.plus, opts: q.opts, input: q.input } : q)) }));
    if (p.plus) out.push(next({ plots: c.plots.map((q, j) => (j === i ? { ...q, plus: false } : q)) }));
  });
  if (c.env !== "axis") out.push(next({ env: "axis" }));
  return out;
}

async function shrink(c: FuzzCase, original: Outcome): Promise<{ c: FuzzCase; outcome: Outcome; rounds: number }> {
  let current = c; let outcome = original; let rounds = 0;
  for (;;) {
    const candidates = reductions(current);
    if (candidates.length === 0) break;
    const results = oracle(candidates, `shrink-${current.id}-${rounds}`);
    let found = false;
    for (const candidate of candidates) {
      const o = await judge(candidate, results.get(candidate.id));
      if (o.status === "fail" && o.visible && o.codes.some((code) => original.codes.includes(code))) {
        // Keep the original identity for reporting; the reduced choices replace the old ones.
        current = { ...candidate, id: c.id };
        outcome = { ...o, id: c.id };
        found = true;
        break;
      }
    }
    rounds += 1;
    if (!found || rounds > 30) break;
  }
  return { c: current, outcome, rounds };
}

mkdirSync(outDir, { recursive: true });
const cases: FuzzCase[] = replay ? (JSON.parse(readFileSync(replay, "utf8")) as FuzzCase[]) : (() => { const r = rng(seed); return Array.from({ length: total }, (_, i) => generate(i, r)); })();
writeFileSync(join(outDir, "cases.json"), JSON.stringify(cases, null, 1));
const outcomes: Outcome[] = [];
for (let i = 0; i < cases.length; i += batchSize) {
  const batch = cases.slice(i, i + batchSize);
  const results = oracle(batch, `b${i}`);
  for (const c of batch) outcomes.push(await judge(c, results.get(c.id)));
  console.log(`${Math.min(i + batchSize, cases.length)}/${cases.length}: pass ${outcomes.filter((o) => o.status === "pass").length}, fail ${outcomes.filter((o) => o.status === "fail").length}, tex-failed ${outcomes.filter((o) => o.status === "tex-failed").length}, diagnosed ${outcomes.filter((o) => o.status === "editor-error").length}`);
}
writeFileSync(join(outDir, "outcomes.json"), JSON.stringify(outcomes, null, 1));
const codeCounts = new Map<string, number>();
for (const o of outcomes) for (const code of o.codes) codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
console.log(`finding codes over failing cases: ${[...codeCounts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
// Shrinking costs a TeX batch per round: shrink the first `--shrink-per-signature` (default 2) cases of each code signature.
const perSignature = Number(opt("--shrink-per-signature") ?? "2");
const shrunkPerSignature = new Map<string, number>();
const failures: Array<{ original: FuzzCase; shrunk: FuzzCase; outcome: Outcome; originalCodes: string[]; rounds: number }> = [];
for (const o of outcomes.filter((x) => x.status === "fail")) {
  if (!o.visible) continue;
  const c = cases.find((x) => x.id === o.id);
  if (!c) continue;
  const signature = o.codes.join(",");
  const done = shrunkPerSignature.get(signature) ?? 0;
  shrunkPerSignature.set(signature, done + 1);
  const s = shrinkEnabled && done < perSignature ? await shrink(c, o) : { c, outcome: o, rounds: 0 };
  failures.push({ original: c, shrunk: s.c, outcome: s.outcome, originalCodes: o.codes, rounds: s.rounds });
  console.log(`shrunk ${o.id} in ${s.rounds} rounds: ${s.outcome.codes.join(",")}\n${body(s.c)}`);
}
writeFileSync(join(outDir, "outcomes.json"), JSON.stringify(outcomes, null, 1));
writeFileSync(join(outDir, "failures.json"), JSON.stringify(failures, null, 1));
const byCodes = new Map<string, string[]>();
for (const f of failures) { const key = f.outcome.codes.join(","); byCodes.set(key, [...(byCodes.get(key) ?? []), f.original.id]); }
const summary = [
  `visible failures (missing/extra/text/count/paint, or > 0.5pt): ${outcomes.filter((o) => o.status === "fail" && o.visible).length}; near-tolerance only: ${outcomes.filter((o) => o.status === "fail" && !o.visible).length}`,
  `seed ${seed}: cases ${cases.length}; pass ${outcomes.filter((o) => o.status === "pass").length}, fail ${failures.length}, tex-failed ${outcomes.filter((o) => o.status === "tex-failed").length}, diagnosed by the editor ${outcomes.filter((o) => o.status === "editor-error").length}`,
  "failure signatures (shrunk):",
  ...[...byCodes].sort((a, b) => b[1].length - a[1].length).map(([k, ids]) => `  ${String(ids.length).padStart(3)}  ${k}  e.g. ${ids.slice(0, 4).join(" ")}`)
].join("\n");
writeFileSync(join(outDir, "summary.txt"), `${summary}\n`);
console.log(summary);
