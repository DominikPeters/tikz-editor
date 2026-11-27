/**
 * Shared pieces of the corpus scripts (corpus-run.mts, corpus-compare.mts):
 * snippet discovery, the "is this diagnostic an unsupported feature" rule,
 * and the resolver that supplies table files from the extracted e-prints.
 * The corpus itself (artifacts/pgfplots-corpus) is untracked and never
 * committed.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

import type { DocumentGraphicsResolver } from "../../packages/core/src/graphics/types.js";

export function walkTex(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walkTex(path) : name.endsWith(".tex") ? [path] : [];
  });
}

/** Feature name of a diagnostic, or null when it does not say something is unsupported. */
export function unsupportedFeature(code: string | undefined, message: string): string | null {
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

export type SnippetMeta = { paper?: string; file?: string; compat?: string[]; libraries?: string[]; generated?: string | null };

export function snippetMeta(snippet: string): SnippetMeta {
  const meta = /% meta: (\{.*\})/u.exec(snippet)?.[1];
  try { return meta ? (JSON.parse(meta) as SnippetMeta) : {}; } catch { return {}; }
}

/** Directories (most specific first) where a snippet's paper keeps the files its source names. */
export function paperDirectories(filesDir: string, paper: string, snippet: string): string[] {
  const file = String(snippetMeta(snippet).file ?? "");
  const base = join(filesDir, paper);
  const own = join(base, dirname(file));
  return own === base ? [base] : [own, base];
}

/** Table files of a snippet's paper, found next to the paper's source file that held the axis. */
export function corpusFiles(filesDir: string | undefined, paper: string, snippet: string): DocumentGraphicsResolver {
  const base = join(filesDir ?? "", paper);
  const dirs = paperDirectories(filesDir ?? "", paper, snippet);
  return {
    cacheKey: `corpus:${paper}`,
    resolve: () => ({ status: "missing" }),
    readTextFile: (name) => {
      for (const dir of dirs) {
        const path = normalize(join(dir, name));
        if (!path.startsWith(base)) continue;
        if (existsSync(path) && statSync(path).isFile()) return { status: "resolved", text: readFileSync(path, "utf8") };
      }
      return { status: "missing" };
    }
  };
}
