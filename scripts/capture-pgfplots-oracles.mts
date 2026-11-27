/**
 * pgfplots LuaLaTeX black-box oracle (design/pgfplots.md section 5).
 * See scripts/pgfplots-oracle/README.md.
 *
 *   npm run oracle:pgfplots                      # refresh test/fixtures/pgfplots/*.oracle.json
 *   npm run oracle:pgfplots -- refresh --only default-axis
 *   npm run oracle:pgfplots -- disturbance      # probes vs. bare document, per probe kind
 *   npm run oracle:pgfplots -- noise-floor      # LuaLaTeX vs pdfLaTeX on the fixtures
 *   npm run oracle:pgfplots -- timing           # cold single, cold batch, warm
 *   npm run oracle:pgfplots -- mutation [--oracle file.oracle.json]
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { compareTier1, compareTier2, DEFAULT_TOLERANCES } from "./pgfplots-oracle/compare.js";
import { ARTIFACT_DIR, FIXTURE_DIR, listFixtures, oracleFromResult, stableJson, type Fixture } from "./pgfplots-oracle/fixtures.js";
import { runMutationTest, formatMutationTable } from "./pgfplots-oracle/mutations.js";
import { splitMutoolTrace } from "./pgfplots-oracle/mutool-trace.js";
import { runOracleCases, type CaseResult } from "./pgfplots-oracle/run.js";
import { parsePgfplotsOracle } from "./pgfplots-oracle/schema.js";
import { BARE_VARIANT, FULL_VARIANT, PROBE_KINDS, buildStandaloneDocument, type BatchCase, type CaseVariant, type OracleEngine } from "./pgfplots-oracle/tex-source.js";

interface Options { command: string; only: string[]; noCache: boolean; oracle: string | null; out: string | null }

function parseArgs(argv: string[]): Options {
  const options: Options = { command: "refresh", only: [], noCache: false, oracle: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--only") options.only.push(...(argv[++i] ?? "").split(",").filter(Boolean));
    else if (arg === "--no-cache") options.noCache = true;
    else if (arg === "--oracle") options.oracle = argv[++i] ?? null;
    else if (arg === "--out") options.out = argv[++i] ?? null;
    else if (arg === "--help" || arg === "-h") options.command = "help";
    else if (!arg.startsWith("-")) options.command = arg;
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
}

const cacheDir = (options: Options) => (options.noCache ? null : join(ARTIFACT_DIR, "cache"));

function runCases(cases: BatchCase[], engine: OracleEngine, options: Options, label: string, extraPreamble = "") {
  const report = runOracleCases(cases, { engine, cacheDir: cacheDir(options), workDir: join(ARTIFACT_DIR, "work", `${label}-${engine}`), extraPreamble });
  console.log(`[${label}/${engine}] ${cases.length} cases: ${report.compiledCases} compiled, ${report.cachedCases} cached; TeX ${report.texSeconds.toFixed(2)}s, mutool ${report.mutoolSeconds.toFixed(2)}s, total ${report.totalSeconds.toFixed(2)}s`);
  return report;
}

function refresh(options: Options): void {
  const fixtures = listFixtures(FIXTURE_DIR, options.only);
  if (fixtures.length === 0) throw new Error("No fixtures selected.");
  const report = runCases(fixtures.map((f) => ({ id: f.name, body: f.body, variant: FULL_VARIANT })), "lualatex", options, "refresh");
  for (const fixture of fixtures) {
    const result = report.results.get(fixture.name);
    if (!result) throw new Error(`No result for ${fixture.name}`);
    const oracle = parsePgfplotsOracle(JSON.parse(JSON.stringify(oracleFromResult(fixture, result))));
    const path = join(FIXTURE_DIR, `${fixture.name}.oracle.json`);
    writeFileSync(path, stableJson(oracle));
    const axes = oracle.tier1.axes.map((a) => `${a.id}: ${a.ticks?.x.length ?? 0}x/${a.ticks?.y.length ?? 0}y ticks`).join(", ");
    // A probe is lost (not wrong) when the fixture's own options override the
    // probe's key, e.g. a custom xticklabel or `title style={name=...}`.
    for (const a of oracle.tier1.axes) {
      const missing = [
        !a.limits && "limits", !a.map && "map", !a.rect && "rect", !a.anchors && "axis anchors",
        !a.ticks?.x.length && "x ticks", !a.ticks?.y.length && "y ticks",
      ].filter(Boolean);
      if (missing.length > 0) console.warn(`  WARNING ${fixture.name} ${a.id}: probes missing: ${missing.join(", ")}`);
    }
    if (!oracle.tier1.boundingBox) console.warn(`  WARNING ${fixture.name}: picture bounding box missing`);
    console.log(`  wrote ${path} (${oracle.tier2.primitives.length} primitives, ${oracle.tier2.textBoxes.length} text boxes; ${axes})`);
  }
  writeFileSync(join(ARTIFACT_DIR, "standalone-example.tex"), buildStandaloneDocument(fixtures[0]?.body ?? ""));
}

const POSITIVE_CONTROLS = [
  { name: "invisible stroke", inject: String.raw`\draw[draw opacity=0] (rel axis cs:0,0) -- (rel axis cs:1,1);` },
];
// Informational: does a named coordinate (no `overlay`) far outside the axis change the output?
// (Observed: no. The map probe uses `overlay` regardless.)
const INFO_VARIANTS = [
  { name: "coordinate without overlay outside the axis", inject: String.raw`\coordinate (pgfplotsoracleinfo) at (rel axis cs:1.5,0.5);` },
];

function variantName(variant: CaseVariant): string {
  if (variant.probes.length === 0) return variant.textboxTrace ? "trace" : "bare";
  if (variant.probes.length === PROBE_KINDS.length) return variant.textboxTrace ? "all+trace" : "all";
  return variant.probes.join("+") + (variant.textboxTrace ? "+trace" : "");
}

/**
 * Each probe kind (and the text-box walk) alone, then everything, against a
 * bare document. Uses the raw mutool trace: identical means byte-identical
 * painting, the strongest check available. A separate uninstrumented
 * compile (no oracle macros at all) anchors the bare variant.
 */
function disturbance(options: Options): void {
  const fixtures = listFixtures(FIXTURE_DIR, options.only);
  const variants: CaseVariant[] = [
    BARE_VARIANT,
    { probes: [], textboxTrace: true },
    ...PROBE_KINDS.map((kind) => ({ probes: [kind], textboxTrace: false })),
    { probes: PROBE_KINDS, textboxTrace: false },
    FULL_VARIANT,
  ];
  const rows: string[] = [];
  const summary: Record<string, { identical: number; total: number; worst: string }> = {};
  for (const engine of ["lualatex", "pdflatex"] as const) {
    const cases = fixtures.flatMap((f) => variants.map((variant, index) => ({ id: `${f.name}-v${index}`, body: f.body, variant })));
    // Positive controls: edits that must register as different, proving the check is sensitive.
    for (const [index, control] of [...POSITIVE_CONTROLS, ...INFO_VARIANTS].entries()) {
      for (const f of fixtures) cases.push({ id: `${f.name}-c${index}`, body: f.body.replace(/\\end\{axis\}/u, `${control.inject}\\end{axis}`), variant: BARE_VARIANT });
    }
    const report = runCases(cases, engine, { ...options, noCache: true }, "disturbance");
    // Fully uninstrumented control: same fixture through the plain preamble.
    const control = uninstrumentedTraces(fixtures, engine);
    for (const fixture of fixtures) {
      const bare = report.results.get(`${fixture.name}-v0`);
      if (!bare) throw new Error("missing bare variant");
      const controlXml = control.get(fixture.name);
      const controlSame = controlXml === paintingKey(bare);
      rows.push(`${engine}\t${fixture.name}\tbare-vs-uninstrumented\t${controlSame ? "identical" : "DIFFERENT"}`);
      const key = `${engine}:bare-vs-uninstrumented`;
      summary[key] ??= { identical: 0, total: 0, worst: "" };
      summary[key].total += 1;
      if (controlSame) summary[key].identical += 1;
      POSITIVE_CONTROLS.forEach((control, index) => {
        const result = report.results.get(`${fixture.name}-c${index}`);
        const differs = !!result && paintingKey(result) !== paintingKey(bare);
        rows.push(`${engine}\t${fixture.name}\tcontrol: ${control.name}\t${differs ? "different (as required)" : "IDENTICAL - check is blind"}`);
        const k = `${engine}:positive control ${control.name} (differs)`;
        summary[k] ??= { identical: 0, total: 0, worst: "" };
        summary[k].total += 1;
        if (differs) summary[k].identical += 1;
      });
      INFO_VARIANTS.forEach((info, offset) => {
        const result = report.results.get(`${fixture.name}-c${POSITIVE_CONTROLS.length + offset}`);
        const differs = !!result && paintingKey(result) !== paintingKey(bare);
        rows.push(`${engine}\t${fixture.name}\tinfo: ${info.name}\t${differs ? "different" : "identical"}`);
      });
      variants.forEach((variant, index) => {
        if (index === 0) return;
        if (engine === "pdflatex" && variant.textboxTrace && variant.probes.length === 0) return;
        const result = report.results.get(`${fixture.name}-v${index}`);
        if (!result) throw new Error("missing variant");
        const identical = paintingKey(result) === paintingKey(bare);
        let detail = "identical";
        if (!identical) {
          const t2 = compareTier2(bare.tier2, result.tier2, { textBoxes: false });
          detail = `DIFFERENT: ${t2.findings.length} tier-2 findings; ${t2.findings.slice(0, 3).map((f) => f.message).join(" | ")}`;
        }
        const name = variantName(engine === "pdflatex" ? { ...variant, textboxTrace: false } : variant);
        rows.push(`${engine}\t${fixture.name}\t${name}\t${detail}`);
        const k = `${engine}:${name}`;
        summary[k] ??= { identical: 0, total: 0, worst: "" };
        summary[k].total += 1;
        if (identical) summary[k].identical += 1; else summary[k].worst = detail;
      });
    }
  }
  const text = rows.join("\n");
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(join(ARTIFACT_DIR, "disturbance.tsv"), `${text}\n`);
  console.log(text);
  console.log("\nSummary (identical/total):");
  for (const [key, value] of Object.entries(summary)) console.log(`  ${key}: ${value.identical}/${value.total}${value.worst ? `  ${value.worst}` : ""}`);
}

function paintingKey(result: CaseResult): string {
  return `${result.tier2.page.width.toFixed(4)}x${result.tier2.page.height.toFixed(4)}|${normaliseXml(result.mutoolXml)}`;
}

/** Painting is compared without font subset tags, which depend on the glyph set of the whole document. */
function normaliseXml(xml: string): string {
  return xml.replace(/font="[A-Z]{6}\+/gu, "font=\"");
}

function uninstrumentedTraces(fixtures: Fixture[], engine: OracleEngine): Map<string, string> {
  // One document, the same page wrapper but no oracle macros: lrbox + shipout only.
  const dir = join(ARTIFACT_DIR, "work", `uninstrumented-${engine}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const lua = engine === "lualatex";
  const pages = fixtures.map((f) => String.raw`\begin{lrbox}{\plainbox}%
${f.body.trim()}%
\end{lrbox}%
${lua ? String.raw`\pagewidth` : String.raw`\pdfpagewidth`}=\wd\plainbox
${lua ? String.raw`\pageheight` : String.raw`\pdfpageheight`}=\dimexpr\ht\plainbox+\dp\plainbox\relax
\shipout\hbox{\box\plainbox}`).join("\n");
  const source = String.raw`\documentclass{article}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\pagestyle{empty}
\newsavebox\plainbox
\hoffset=-1in \voffset=-1in
\begin{document}
${pages}
\end{document}
`;
  writeFileSync(join(dir, "plain.tex"), source);
  const tex = spawn(engine, ["-interaction=nonstopmode", "-halt-on-error", "plain.tex"], dir);
  if (tex !== 0) throw new Error(`uninstrumented ${engine} run failed in ${dir}`);
  const xml = spawnOut("mutool", ["trace", join(dir, "plain.pdf")]);
  const result = new Map<string, string>();
  const pageXml = splitMutoolTrace(xml).map((page) => `${page.width.toFixed(4)}x${page.height.toFixed(4)}|${normaliseXml(page.xml)}`);
  fixtures.forEach((f, i) => result.set(f.name, pageXml[i] ?? ""));
  return result;
}

import { spawnSync } from "node:child_process";
function spawn(command: string, args: string[], cwd: string): number | null {
  return spawnSync(command, args, { cwd, encoding: "utf8", timeout: 300_000 }).status;
}
function spawnOut(command: string, args: string[]): string {
  return spawnSync(command, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).stdout;
}

/**
 * LuaLaTeX vs pdfLaTeX on the same fixtures (design 5.4). Two preambles:
 * "default" (LuaLaTeX text in Latin Modern OpenType, pdfLaTeX in CM Type 1:
 * font metrics differ, so text-dependent layout differs), and
 * "metric-matched" (`\usepackage[OT1]{fontenc}` plus `cmr` families in both, so both engines
 * typeset with the same TFM metrics: pure arithmetic/driver noise).
 */
function noiseFloor(options: Options): void {
  const fixtures = listFixtures(FIXTURE_DIR, options.only);
  const variant: CaseVariant = { probes: PROBE_KINDS, textboxTrace: false };
  const cases = fixtures.map((f) => ({ id: f.name, body: f.body, variant }));
  const loose = { ...DEFAULT_TOLERANCES, layoutPt: Infinity, curvePt: Infinity, glyphPt: Infinity, strokePt: Infinity, tickRelative: Infinity, colour: Infinity };
  const lines: string[] = [];
  for (const [label, extra] of [["default", ""], ["metric-matched", String.raw`\usepackage[OT1]{fontenc}\renewcommand{\rmdefault}{cmr}\renewcommand{\sfdefault}{cmss}\renewcommand{\ttdefault}{cmtt}`]] as const) {
    const lua = runCases(cases, "lualatex", options, `noise-${label}`, extra);
    const pdf = runCases(cases, "pdflatex", options, `noise-${label}`, extra);
    const worst: Record<string, number> = {};
    lines.push(`== preamble: ${label} ${extra}`);
    for (const fixture of fixtures) {
      const a = lua.results.get(fixture.name); const b = pdf.results.get(fixture.name);
      if (!a || !b) throw new Error("missing noise result");
      const t1 = compareTier1(a.tier1, b.tier1, { tolerances: loose });
      const t2 = compareTier2(a.tier2, b.tier2, { tolerances: { ...loose, searchRadiusPt: 4 }, textBoxes: false, fontNames: false });
      const strict1 = compareTier1(a.tier1, b.tier1);
      const strict2 = compareTier2(a.tier2, b.tier2, { textBoxes: false, fontNames: false });
      for (const [k, v] of [...Object.entries(t1.stats.maxDelta).map(([k, v]) => [`tier1:${k}`, v] as const), ...Object.entries(t2.stats.maxDelta).map(([k, v]) => [`tier2:${k}`, v] as const)]) worst[k] = Math.max(worst[k] ?? 0, v);
      lines.push(`${fixture.name}: tier1 max ${JSON.stringify(round(t1.stats.maxDelta))}; tier2 max ${JSON.stringify(round(t2.stats.maxDelta))}; unmatched ${t2.findings.filter((f) => f.code.endsWith("missing") || f.code.endsWith("extra")).length}; strict findings tier1=${strict1.findings.length} tier2=${strict2.findings.length}`);
      for (const f of [...strict1.findings, ...strict2.findings].slice(0, 4)) lines.push(`    ${f.tier}:${f.code} ${f.where}: ${f.message}`);
    }
    lines.push(`ALL (${label}): ${JSON.stringify(round(worst))}`);
  }
  console.log(lines.join("\n"));
  writeFileSync(join(ARTIFACT_DIR, "noise-floor.txt"), `${lines.join("\n")}\n`);
}

function round(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, Number(v.toPrecision(3))]));
}

function timing(options: Options): void {
  const fixtures = listFixtures(FIXTURE_DIR, options.only);
  // Ten distinct cases: fixture copies whose sources differ (by a comment) to defeat the cache.
  const ten: BatchCase[] = Array.from({ length: 10 }, (_, i) => {
    const f = fixtures[i % fixtures.length];
    return { id: `t${i}`, body: `${f.body}\n% timing copy ${i}`, variant: FULL_VARIANT };
  });
  const timingCache = join(ARTIFACT_DIR, "timing-cache");
  rmSync(timingCache, { recursive: true, force: true });
  const go = (cases: BatchCase[], label: string) => {
    const start = performance.now();
    const report = runOracleCases(cases, { engine: "lualatex", cacheDir: timingCache, workDir: join(ARTIFACT_DIR, "work", `timing-${label}`) });
    const seconds = (performance.now() - start) / 1000;
    console.log(`${label}: ${cases.length} cases, ${report.compiledCases} compiled, ${seconds.toFixed(2)}s wall (TeX ${report.texSeconds.toFixed(2)}s, mutool ${report.mutoolSeconds.toFixed(2)}s)`);
    return seconds;
  };
  const single = ten[0];
  go([{ ...single, id: "single", body: `${single.body}\n% single` }], "cold-single");
  go(ten, "cold-batch-10");
  go(ten, "warm-batch-10");
}

function mutation(options: Options): void {
  const files = options.oracle ? [options.oracle] : listFixtures(FIXTURE_DIR, options.only).map((f) => join(FIXTURE_DIR, `${f.name}.oracle.json`));
  const rows = files.flatMap((file) => runMutationTest(parsePgfplotsOracle(JSON.parse(readFileSync(file, "utf8"))), file));
  const table = formatMutationTable(rows);
  console.log(table);
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(join(ARTIFACT_DIR, "mutation-test.txt"), `${table}\n`);
  const failures = rows.filter((r) => !r.asExpected);
  if (failures.length > 0) { console.error(`${failures.length} mutation rows not as expected`); process.exitCode = 1; }
}

const options = parseArgs(process.argv.slice(2));
mkdirSync(ARTIFACT_DIR, { recursive: true });
const commands: Record<string, (o: Options) => void> = { refresh, disturbance, "noise-floor": noiseFloor, timing, mutation };
const command = commands[options.command];
if (!command) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(0, 12).join("\n"));
  if (options.command !== "help") process.exitCode = 1;
} else command(options);

export type { CaseResult };
