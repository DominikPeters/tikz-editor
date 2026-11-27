/**
 * Runs the editor's axis evaluator over the untracked arXiv axis corpus
 * (artifacts/pgfplots-corpus/axes/<paper>/<n>-axis.tex; never committed)
 * and reports how many axes render without unsupported-key/plot
 * diagnostics, and the unsupported keys/features ranked by distinct paper.
 *
 *   node --import tsx scripts/pgfplots-oracle/corpus-run.mts [corpus-root] [--out file.json] [--files dir]
 *
 * `--files dir`: extracted e-prints, `dir/<paper>/…`; table files the
 * snippets name are read from there (relative to the snippet's source file),
 * as the app reads them from the document's folder. Without it every file
 * table reports `pgfplots-table-file-unavailable`.
 * `corpus-root` is the directory holding `axes/` (default
 * artifacts/pgfplots-corpus of this checkout; a worktree passes the main
 * checkout's absolute path). Output: `<corpus-root>/editor-run.json` (or
 * `--out`) and a summary on stdout.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";

import type { DocumentGraphicsResolver } from "../../packages/core/src/graphics/types.js";
import { getAxisEvaluations } from "../../packages/core/src/pgfplots/evaluate-axis.js";
import { renderTikzToSvgAsync } from "../../packages/core/src/render/index.js";
import { createTexNodeTextEngine } from "../../packages/core/src/text/tex-node-text-engine.js";

const root = resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outFile = outIndex >= 0 ? args[outIndex + 1] : undefined;
const filesIndex = args.indexOf("--files");
const filesDir = filesIndex >= 0 && args[filesIndex + 1] ? resolve(args[filesIndex + 1] ?? "") : undefined;
const positional = args.filter((arg, index) => !arg.startsWith("--") && (outIndex < 0 || index !== outIndex + 1) && (filesIndex < 0 || index !== filesIndex + 1));
const corpusRoot = resolve(positional[0] ?? join(root, "artifacts", "pgfplots-corpus"));
const corpus = join(corpusRoot, "axes");

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
  if (code === "pgfplots-table-file-unavailable") return "plot: table file not available";
  if (code.startsWith("unsupported-pgfplots-") || code === "unsupported-pgfplots-axis") return `feature: ${code.slice("unsupported-pgfplots-".length)}`;
  if (code.startsWith("unknown-plot-mark") || code.startsWith("unsupported-plot-mark")) return `mark: ${code.split(":")[1] ?? ""}`;
  return null;
}

/** Table files of a snippet's paper, found next to the paper's source file that held the axis. */
function corpusFiles(paper: string, snippet: string): DocumentGraphicsResolver {
  const meta = /% meta: (\{.*\})/u.exec(snippet)?.[1];
  let file = "";
  try { file = meta ? String((JSON.parse(meta) as { file?: string }).file ?? "") : ""; } catch { file = ""; }
  const base = join(filesDir ?? "", paper);
  return {
    cacheKey: `corpus:${paper}`,
    resolve: () => ({ status: "missing" }),
    readTextFile: (name) => {
      for (const dir of [join(base, dirname(file)), base]) {
        const path = normalize(join(dir, name));
        if (!path.startsWith(base)) continue;
        if (existsSync(path) && statSync(path).isFile()) return { status: "resolved", text: readFileSync(path, "utf8") };
      }
      return { status: "missing" };
    }
  };
}

const textEngine = await createTexNodeTextEngine();
const files = walk(corpus).sort();
let axes = 0; let clean = 0; let threw = 0; let parsed = 0; let noAxis = 0;
const parseErrorFiles: string[] = [];
const byFeature = new Map<string, Set<string>>();
const occurrences = new Map<string, number>();
const failures: Array<{ file: string; error: string }> = [];
for (const file of files) {
  const paper = file.slice(corpus.length + 1).split("/")[0] ?? file;
  const source = readFileSync(file, "utf8");
  try {
    const result = await renderTikzToSvgAsync(source, { textEngine, parse: { includeContextDefinitions: true }, ...(filesDir ? { graphicsResolver: corpusFiles(paper, source) } : {}) });
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
    if (result.parse.diagnostics.some((d) => d.severity === "error")) {
      features.add("parse: error");
      parseErrorFiles.push(file.slice(corpus.length + 1));
    }
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
const parseErrorPapers = new Set(parseErrorFiles.map((f) => f.split("/")[0]));
writeFileSync(outFile ? resolve(outFile) : join(corpusRoot, "editor-run.json"), JSON.stringify({ files: files.length, papers: papers.size, axes, clean, threw, parsed, noAxis, parseErrorFiles, ranked, failures }, null, 2));
console.log(`snippets ${files.length} (papers ${papers.size}), axes ${axes}, rendered without unsupported diagnostics: ${clean}, threw: ${threw}, snippets with no axis evaluated: ${noAxis}`);
console.log(`snippets with parse errors: ${parseErrorFiles.length} (papers ${parseErrorPapers.size})`);
for (const row of ranked.slice(0, 40)) console.log(`${String(row.papers).padStart(4)} papers ${String(row.snippets).padStart(4)} snippets  ${row.name}`);
for (const f of failures.slice(0, 5)) console.log("THREW", f.file, f.error);
