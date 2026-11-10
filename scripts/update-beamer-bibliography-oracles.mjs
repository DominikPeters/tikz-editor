#!/usr/bin/env node
// Regenerate from LuaLaTeX, never from the native renderer.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOracleBeamerPageTrace } from "./lib/beamer-frame-compare.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtures = join(root, "test/fixtures/beamer/bibliography-fidelity");
const reuse = process.argv[2] === "--reuse-dir" ? resolve(process.argv[3]) : null;
const output = reuse ?? mkdtempSync(join(tmpdir(), "beamer-bibliography-oracle-"));
for (const name of readdirSync(fixtures).filter((name) => name.endsWith(".tex")).sort()) {
  const stem = name.slice(0, -4);
  const input = join(fixtures, name);
  if (!reuse) execFileSync(process.execPath, [
    join(root, "scripts/probe-beamer-frame.mjs"), "--input", input,
    "--frame", "1", "--trace-only", "--out-dir", output, "--name", stem,
  ], { cwd: root, stdio: "inherit" });
  const report = JSON.parse(readFileSync(join(output, stem, "report.json"), "utf8"));
  const trace = normalizeOracleBeamerPageTrace(report.pageTrace.selectedPage, report.tex.selectedPage);
  const snapshot = {
    engine: report.environment.engineBanner,
    beamer: report.environment.beamerClass,
    trace: {
      ...trace,
      // Keep the glyphs in their lines; omit duplicate debug node trees.
      boxes: [], glyphs: [],
      rules: trace.rules.filter((rule) => rule.width > 0 && rule.totalHeight > 0),
      lines: trace.lines.map((line) => ({ ...line, glyphs: line.glyphs.map(({ path: _path, fontId: _fontId, ...glyph }) => glyph) })),
    },
  };
  writeFileSync(join(fixtures, `${stem}.oracle.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Updated ${stem}.oracle.json`);
}
console.log(`LuaLaTeX PDFs and raw traces: ${output}`);
