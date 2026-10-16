#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beamerPageTraceLuaSource, beamerProbeInstrumentation, fileSha256, parseBeamerPageTraceTsv, parseBeamerProbeLog } from "./lib/beamer-frame-oracle.mjs";
import { normalizeOracleBeamerPageTrace } from "./lib/beamer-frame-compare.mjs";
import { texOracleEnv } from "./lib/tex-oracle.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtures = join(root, "test/fixtures/beamer/titlepages-fidelity");
const output = join(root, "artifacts/beamer-titlepage-oracle-regeneration");
mkdirSync(output, { recursive: true });
const selected = process.argv.slice(2);
for (const name of readdirSync(fixtures).filter(name => name.endsWith(".tex") &&
  (selected.length === 0 || selected.includes(name.slice(0, -4))))) {
  const directory = mkdtempSync(join(output, `${name.slice(0, -4)}-`));
  const source = readFileSync(join(fixtures, name), "utf8");
  writeFileSync(join(directory, "probe.tex"), source.replace(String.raw`\begin{document}`, `${beamerProbeInstrumentation()}\n\\begin{document}`));
  writeFileSync(join(directory, "beamer-page-trace.lua"), beamerPageTraceLuaSource());
  for (let pass = 0; pass < 2; pass++) execFileSync("lualatex", [
    "--interaction=nonstopmode", "--halt-on-error", "--no-shell-escape", `--output-directory=${directory}`, "probe.tex",
  ], { cwd: directory, env: texOracleEnv({ TIKZ_BEAMER_TRACE_DIR: directory }), stdio: "pipe" });
  const tex = parseBeamerProbeLog(readFileSync(join(directory, "probe.log"), "utf8"));
  const traces = parseBeamerPageTraceTsv(readFileSync(join(directory, "beamer-page-trace.tsv"), "utf8"));
  const pages = traces.pages.map((page, index) => normalizeOracleBeamerPageTrace(page, tex.pages[index]));
  const snapshot = { sourceSha256: fileSha256(join(fixtures, name)), engine: "LuaLaTeX / TeX Live 2025", pages };
  writeFileSync(join(fixtures, name.replace(/\.tex$/u, ".oracle.json")), `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`[titlepage-oracles] ${name}: ${pages.length} pages`);
}
