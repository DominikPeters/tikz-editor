#!/usr/bin/env node
/**
 * Legacy golden capture + baseline benchmark for the Rust migration.
 *
 * Renders each corpus fixture through the legacy TypeScript pipeline
 * (`renderTikzToSvg`), writes golden SVGs to out-dir, and in --bench mode
 * re-renders the corpus N times printing total wall time (the legacy_target)
 * for the Rust A/B stages.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const outDir = resolve(repoRoot, "migration", "goldens");

const CORPUS = [
  ["minimal", "test/fixtures/minimal.tex"],
  ["node-graph", "test/fixtures/differential/node-graph.tex"],
  ["comments", "test/fixtures/comments.tex"],
  ["multiline", "test/fixtures/multiline.tex"],
  ["multi-figure-basic", "test/fixtures/multi-figure-basic.tex"],
  ["shapes-new", "test/fixtures/shapes-new.tex"],
  ["grid", "migration/corpus/grid.tex"],
  ["paths", "migration/corpus/paths.tex"],
  ["coords", "migration/corpus/coords.tex"],
  ["styles", "migration/corpus/styles.tex"],
  ["nodes", "migration/corpus/nodes.tex"],
];

const benchIterations = Number(process.env.BENCH_ITERATIONS ?? "8");

async function main() {
  let renderTikzToSvgAsync;
  try {
    ({ renderTikzToSvgAsync } = await import("@tikz-editor/core"));
  } catch {
    ({ renderTikzToSvgAsync } = await import("@tikz-editor/core/render/index.js"));
  }
  if (typeof renderTikzToSvgAsync !== "function") {
    throw new Error("renderTikzToSvgAsync not found in @tikz-editor/core");
  }

  const sources = CORPUS.map(([name, rel]) => {
    const source = readSource(rel);
    return { name, rel, source };
  });

  mkdirSync(outDir, { recursive: true });

  // Warm-up render (font load etc), then goldens.
  const goldens = [];
  for (const { name, rel, source } of sources) {
    const t0 = performance.now();
    const result = await renderTikzToSvgAsync(source);
    const ms = performance.now() - t0;
    const svg = result.svg.svg;
    writeFileSync(join(outDir, `${name}.svg`), svg);
    writeFileSync(join(outDir, `${name}.tex`), source);
    goldens.push({ name, rel, source, bytes: svg.length, ms });
    console.log(`golden ${name}: ${svg.length}B of svg, render ${ms.toFixed(0)}ms, diag ${result.renderDiagnostics.length}`);
  }

  if (process.env.BENCH !== "1") return;
  // Benchmark: fresh full pipeline each iteration (parse -> evaluate -> svg).
  const t0 = performance.now();
  let renders = 0;
  for (let i = 0; i < benchIterations; i++) {
    for (const { source } of sources) {
      await renderTikzToSvgAsync(source);
      renders++;
    }
  }
  const wallMs = performance.now() - t0;
  console.log(`BENCH legacy_baseline docs=${sources.length} iterations=${benchIterations} renders=${renders} wall_ms=${wallMs.toFixed(1)} per_render_ms=${(wallMs / renders).toFixed(2)}`);
}

function readSource(rel) {
  return readFileSync(join(repoRoot, rel), "utf8");
}

import { readFileSync } from "node:fs";

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
