/**
 * Runs the editor's axis evaluator over the untracked arXiv axis corpus
 * (artifacts/pgfplots-corpus/axes/<paper>/<n>-axis.tex; never committed)
 * and reports how many axes render without unsupported-key/plot
 * diagnostics, and the unsupported keys/features ranked by distinct paper.
 *
 *   node --import tsx scripts/pgfplots-oracle/corpus-run.mts [corpus-axes-dir] [out.json]
 *
 * The corpus directory defaults to this checkout's
 * artifacts/pgfplots-corpus/axes (pass an absolute path from a worktree).
 * Output: <out.json> (default artifacts/pgfplots-corpus/editor-run.json) and
 * a summary on stdout.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { getAxisEvaluations } from "../../packages/core/src/pgfplots/evaluate-axis.js";
import { renderTikzToSvgAsync } from "../../packages/core/src/render/index.js";
import { createTexNodeTextEngine } from "../../packages/core/src/text/tex-node-text-engine.js";

const root = resolve(import.meta.dirname, "..", "..");
const corpus = resolve(process.argv[2] ?? join(root, "artifacts", "pgfplots-corpus", "axes"));
const outFile = resolve(process.argv[3] ?? join(root, "artifacts", "pgfplots-corpus", "editor-run.json"));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : name.endsWith(".tex") ? [path] : [];
  });
}

/** Feature name of a diagnostic, or null when it does not say something is unsupported. */
function feature(code: string | undefined, message: string): string | null {
  if (!code) return null;
  if (code.startsWith("unsupported-pgfplots-key:")) return `key: ${code.slice("unsupported-pgfplots-key:".length)}`;
  if (code.startsWith("invalid-pgfplots-value:")) return `value: ${code.slice("invalid-pgfplots-value:".length)}`;
  if (code === "unsupported-pgfplots-plot") {
    const reason = /not drawn: (.*) is not supported yet/u.exec(message)?.[1] ?? message;
    return `plot: ${reason.replace(/`[^`]*`/gu, (m) => (/^`(table|col sep|x expr|y expr|x|y)/u.test(m) ? m.replace(/=.*`$/u, "`") : "`…`")).replace(/\s+/gu, " ").slice(0, 60)}`;
  }
  if (code.startsWith("unsupported-pgfplots-") || code === "unsupported-pgfplots-axis") return `feature: ${code.slice("unsupported-pgfplots-".length)}`;
  if (code.startsWith("unknown-plot-mark") || code.startsWith("unsupported-plot-mark")) return `mark: ${code.split(":")[1] ?? ""}`;
  return null;
}

const textEngine = await createTexNodeTextEngine();
const files = walk(corpus).sort();
let axes = 0; let clean = 0; let threw = 0; let parsed = 0; let noAxis = 0;
const byFeature = new Map<string, Set<string>>();
const occurrences = new Map<string, number>();
const failures: Array<{ file: string; error: string }> = [];
for (const file of files) {
  const paper = file.slice(corpus.length + 1).split("/")[0] ?? file;
  const source = readFileSync(file, "utf8");
  try {
    const result = await renderTikzToSvgAsync(source, { textEngine, parse: { includeContextDefinitions: true } });
    parsed += 1;
    const evaluations = getAxisEvaluations(result.semantic.scene);
    const axisCount = (source.match(/\\begin\{(?:axis|semilogxaxis|semilogyaxis|loglogaxis)\}/gu) ?? []).length;
    axes += axisCount;
    if (evaluations.length === 0) noAxis += 1;
    const features = new Set<string>();
    for (const d of result.semantic.diagnostics) {
      const f = feature(d.code, d.message);
      if (f) features.add(f);
    }
    if (result.parse.diagnostics.some((d) => d.severity === "error")) features.add("parse: error");
    for (const f of features) {
      if (!byFeature.has(f)) byFeature.set(f, new Set());
      byFeature.get(f)?.add(paper);
      occurrences.set(f, (occurrences.get(f) ?? 0) + 1);
    }
    if (features.size === 0 && evaluations.length === axisCount) clean += axisCount;
  } catch (error) {
    threw += 1;
    failures.push({ file, error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}`.slice(0, 600) : String(error) });
  }
}
const papers = new Set(files.map((f) => f.slice(corpus.length + 1).split("/")[0]));
const ranked = [...byFeature].map(([name, set]) => ({ name, papers: set.size, snippets: occurrences.get(name) ?? 0 })).sort((a, b) => b.papers - a.papers || b.snippets - a.snippets);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ files: files.length, papers: papers.size, axes, clean, threw, parsed, noAxis, ranked, failures }, null, 2));
console.log(`snippets ${files.length} (papers ${papers.size}), axes ${axes}, rendered without unsupported diagnostics: ${clean}, threw: ${threw}, snippets with no axis evaluated: ${noAxis}`);
for (const row of ranked.slice(0, 40)) console.log(`${String(row.papers).padStart(4)} papers ${String(row.snippets).padStart(4)} snippets  ${row.name}`);
for (const f of failures.slice(0, 5)) console.log("THREW", f.file, f.error);
