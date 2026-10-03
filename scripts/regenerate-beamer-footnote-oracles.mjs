#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  beamerPageTraceLuaSource, beamerProbeInstrumentation, fileSha256,
  parseBeamerPageTraceTsv, parseBeamerProbeLog,
} from "./lib/beamer-frame-oracle.mjs";
import { normalizeOracleBeamerPageTrace } from "./lib/beamer-frame-compare.mjs";
import { texOracleEnv } from "./lib/tex-oracle.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtures = join(root, "test/fixtures/beamer/footnotes-fidelity");
const options = { check: false, cases: null, outDir: join(root, "artifacts/beamer-footnote-oracle-regeneration") };
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--check") options.check = true;
  else if (arg === "--cases" && process.argv[i + 1]) options.cases = process.argv[++i].split(",");
  else if (arg === "--out-dir" && process.argv[i + 1]) options.outDir = resolve(process.argv[++i]);
  else throw new Error(`Unknown or incomplete argument: ${arg}`);
}
const readJson = path => JSON.parse(readFileSync(path, "utf8"));
const catalog = readdirSync(fixtures).filter(name => name.endsWith(".oracle.json")).map(name => name.slice(0, -12));
if (options.cases?.some(name => !catalog.includes(name))) throw new Error("Unknown fixture name in --cases.");
const selected = catalog.filter(name => !options.cases || options.cases.includes(name));
if (!selected.length) throw new Error("No selected fixtures.");
// These two snapshots were originally made by compiling the full authored
// document. In particular, isolating counters.tex's frames resets its counter.
const fullDeck = name => name === "counters" || name === "block-auto";
selected.sort((a, b) => Number(fullDeck(a)) - Number(fullDeck(b)) || a.localeCompare(b));
mkdirSync(options.outDir, { recursive: true });
let environment;

function frameProbe(name) {
  const directory = mkdtempSync(join(options.outDir, `${name}-`));
  execFileSync(process.execPath, [join(root, "scripts/probe-beamer-frame.mjs"),
    "--input", join(fixtures, `${name}.tex`), "--frame", "1", "--trace-only",
    "--out-dir", directory, "--name", "frame"], { cwd: root, stdio: "pipe" });
  const report = readJson(join(directory, "frame/report.json"));
  environment = report.environment;
  return report;
}

function fullDocumentProbe(name) {
  const directory = mkdtempSync(join(options.outDir, `${name}-`));
  const source = readFileSync(join(fixtures, `${name}.tex`), "utf8");
  const beginDocument = String.raw`\begin{document}`;
  if (source.split(beginDocument).length !== 2) throw new Error(`${name}: expected one document body.`);
  writeFileSync(join(directory, "probe.tex"), source.replace(beginDocument, `${beamerProbeInstrumentation()}\n${beginDocument}`));
  writeFileSync(join(directory, "beamer-page-trace.lua"), beamerPageTraceLuaSource());
  for (let pass = 0; pass < 2; pass++) execFileSync("lualatex", [
    "--interaction=nonstopmode", "--halt-on-error", "--no-shell-escape",
    `--output-directory=${directory}`, "probe.tex",
  ], { cwd: directory, env: texOracleEnv({ TIKZ_BEAMER_TRACE_DIR: directory }), stdio: "pipe" });
  return {
    tex: parseBeamerProbeLog(readFileSync(join(directory, "probe.log"), "utf8")),
    pageTrace: parseBeamerPageTraceTsv(readFileSync(join(directory, "beamer-page-trace.tsv"), "utf8")),
  };
}

let failures = 0;
for (const name of selected) {
  const oraclePath = join(fixtures, `${name}.oracle.json`);
  const original = readJson(oraclePath);
  if (fullDeck(name) && !environment) frameProbe("leading");
  const report = fullDeck(name) ? fullDocumentProbe(name) : frameProbe(name);
  if (report.pageTrace.pages.length !== original.pages.length) throw new Error(`${name}: compiled page count changed; review authored frame/step correspondence.`);
  const pages = original.pages.map((page, index) => ({ ...page,
    trace: normalizeOracleBeamerPageTrace(report.pageTrace.pages[index], report.tex.pages[index]),
  }));
  const snapshot = { ...original, sourceSha256: fileSha256(join(fixtures, `${name}.tex`)), environment, pages };
  if (options.check) {
    const matches = snapshot.sourceSha256 === original.sourceSha256 && isDeepStrictEqual(pages, original.pages) &&
      environment.engineBanner === original.environment.engineBanner && environment.beamerClassSha256 === original.environment.beamerClassSha256;
    console.log(`[footnote-oracles] ${name}: ${matches ? "unchanged" : "changed"}`);
    if (!matches) failures++;
  } else {
    writeFileSync(oraclePath, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`[footnote-oracles] regenerated ${name}`);
  }
}
if (failures) process.exitCode = 1;
