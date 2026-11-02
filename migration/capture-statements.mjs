#!/usr/bin/env node
/**
 * Capture legacy statement-AST dumps for Rust parity checks.
 *
 * For each corpus fixture the script calls the legacy `parseTikz` once per
 * scanned figure (activeFigureId cycling like the editor) and writes a stable
 * JSON dump of every figure's inventory spans + full statement tree to
 * `migration/expected/<name>.json`.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const outDir = resolve(repoRoot, "migration", "expected");

const CORPUS = [
  ["minimal", "test/fixtures/minimal.tex"],
  ["node-graph", "test/fixtures/differential/node-graph.tex"],
  ["comments", "migration/goldens/comments.tex"],
  ["multiline", "migration/goldens/multiline.tex"],
  ["multi-figure-basic", "migration/goldens/multi-figure-basic.tex"],
  ["shapes-new", "migration/goldens/shapes-new.tex"],
  ["grid", "migration/goldens/grid.tex"],
  ["paths", "migration/goldens/paths.tex"],
  ["coords", "migration/goldens/coords.tex"],
  ["styles", "migration/goldens/styles.tex"],
  ["nodes", "migration/corpus/nodes.tex"]
];

const { parseTikz } = await import("@tikz-editor/core");

function dumpFigure(inventory, figure, index) {
  const entry = { index };
  if (figure.span) entry.span = figure.span;
  if (figure.optionsSpan !== undefined) entry.optionsSpan = figure.optionsSpan;
  if (figure.options !== undefined) entry.options = figure.options;
  if (inventory) {
    if (inventory.span) entry.inventorySpan = inventory.span;
    if (inventory.beginSpan) entry.beginSpan = inventory.beginSpan;
    if (inventory.endSpan) entry.endSpan = inventory.endSpan;
  }
  entry.statements = figure.body ?? [];
  return entry;
}

function dumpStanding(source, name) {
  const base = parseTikz(source);
  const figures = base.figures ?? [];
  const dumpedFigures = [];
  if (figures.length === 0) {
    // Inline `\\tikz` bodies and bare bodies still map through `base.figure`.
    dumpedFigures.push(dumpFigure(null, base.figure, 0));
  } else {
    for (let index = 0; index < figures.length; index += 1) {
      const inventory = figures[index];
      const parsed = parseTikz(source, { activeFigureId: inventory.id });
      dumpedFigures.push(dumpFigure(inventory, parsed.figure, index));
    }
  }
  return {
    name,
    figures: dumpedFigures,
    diagnostics: (base.diagnostics ?? []).map((d) => ({
      severity: d.severity,
      code: d.code ?? null,
      span: d.span
    }))
  };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  let statementCount = 0;
  let pathItemCount = 0;
  for (const [name, rel] of CORPUS) {
    const source = readFileSync(join(repoRoot, rel), "utf8");
    const dump = dumpStanding(source, name);
    for (const figure of dump.figures) {
      statementCount += (figure.statements ?? []).length;
    }
    writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(dump, null, 1)}\n`);
    const figureTexts = dump.figures.map((f) => (f.statements ?? []).length).join(",");
    console.log(`expected ${name}: figures=${dump.figures.length} statements=${figureTexts}`);
  }
  console.log(`totals: statements=${statementCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
