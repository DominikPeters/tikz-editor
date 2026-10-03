#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { beamerPageTraceLuaSource, beamerProbeInstrumentation, fileSha256, firstVersionLine, parseBeamerClassVersion, parseBeamerPageTraceTsv, parseBeamerProbeLog } from "./lib/beamer-frame-oracle.mjs";
import { normalizeOracleBeamerPageTrace } from "./lib/beamer-frame-compare.mjs";
import { texOracleEnv } from "./lib/tex-oracle.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtures = join(root, "test/fixtures/beamer/continuations-fidelity");
const options = { check: false, cases: null, outDir: join(root, "artifacts/beamer-continuation-oracle-regeneration") };
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--check") options.check = true;
  else if (arg === "--cases" && process.argv[i + 1]) options.cases = process.argv[++i].split(",");
  else if (arg === "--out-dir" && process.argv[i + 1]) options.outDir = resolve(process.argv[++i]);
  else throw new Error(`Unknown or incomplete argument: ${arg}`);
}
const catalog = readdirSync(fixtures).filter(name => name.endsWith(".tex")).map(name => name.slice(0, -4));
if (options.cases?.some(name => !catalog.includes(name))) throw new Error("Unknown fixture name in --cases.");
const selected = catalog.filter(name => !options.cases || options.cases.includes(name));
mkdirSync(options.outDir, { recursive: true });
const beamerClassPath = execFileSync("kpsewhich", ["beamer.cls"], { encoding: "utf8" }).trim();
const environment = {
  engine: "lualatex",
  engineBanner: firstVersionLine(execFileSync("lualatex", ["--version"], { encoding: "utf8" })),
  beamerClassPath, beamerClassSha256: fileSha256(beamerClassPath),
  beamerClass: parseBeamerClassVersion(readFileSync(beamerClassPath, "utf8")),
};
let failures = 0;
for (const name of selected) {
  const directory = mkdtempSync(join(options.outDir, `${name}-`));
  const source = readFileSync(join(fixtures, `${name}.tex`), "utf8");
  const beginDocument = String.raw`\begin{document}`;
  if (source.split(beginDocument).length !== 2) throw new Error(`${name}: expected one document body.`);
  writeFileSync(join(directory, "probe.tex"), source.replace(beginDocument, `${beamerProbeInstrumentation()}\n${beginDocument}`));
  writeFileSync(join(directory, "beamer-page-trace.lua"), beamerPageTraceLuaSource());
  for (let pass = 0; pass < 2; pass++) execFileSync("lualatex", [
    "--interaction=nonstopmode", "--halt-on-error", "--no-shell-escape", `--output-directory=${directory}`, "probe.tex",
  ], { cwd: directory, env: texOracleEnv({ TIKZ_BEAMER_TRACE_DIR: directory }), stdio: "pipe" });
  const tex = parseBeamerProbeLog(readFileSync(join(directory, "probe.log"), "utf8"));
  const traces = parseBeamerPageTraceTsv(readFileSync(join(directory, "beamer-page-trace.tsv"), "utf8"));
  const countersMap = [{ frameIndex: 0, continuation: 1 }, { frameIndex: 0, continuation: 2 }, { frameIndex: 1 }, { frameIndex: 2, continuation: 1 }, { frameIndex: 2, continuation: 2 }];
  if (name === "counters" && traces.pages.length !== countersMap.length) throw new Error("counters: review changed authored page correspondence.");
  const pages = traces.pages.map((page, index) => ({
    ...(name === "counters" ? countersMap[index] : { frameIndex: 0, continuation: index + 1 }),
    step: 1, trace: normalizeOracleBeamerPageTrace(page, tex.pages[index]),
  }));
  const oraclePath = join(fixtures, `${name}.oracle.json`);
  const snapshot = { sourceSha256: fileSha256(join(fixtures, `${name}.tex`)), environment, pages };
  if (options.check) {
    const original = JSON.parse(readFileSync(oraclePath, "utf8"));
    const matches = isDeepStrictEqual(snapshot, original);
    console.log(`[continuation-oracles] ${name}: ${matches ? "unchanged" : "changed"}`);
    if (!matches) failures++;
  } else {
    writeFileSync(oraclePath, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`[continuation-oracles] regenerated ${name} (${pages.length} pages)`);
  }
}
if (failures) process.exitCode = 1;
