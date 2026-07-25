import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { collectTikzSnippetsFromDocs } from "../packages/core/src/corpus/index.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";

describe("decorations corpus regression", () => {
  const docsRoot = join(process.cwd(), "pgf-docs");
  const testCase = existsSync(docsRoot) ? it : it.skip;

  testCase("removes generic decoration unsupported diagnostics for decorations manual files", () => {
    const snippets = collectTikzSnippetsFromDocs(docsRoot).filter(
      (snippet) =>
        snippet.filePath === "pgfmanual-en-library-decorations.tex" ||
        snippet.filePath === "pgfmanual-en-tikz-decorations.tex"
    );

    const unsupportedCounts = new Map<string, number>();
    for (const snippet of snippets) {
      const parsed = parseTikz(snippet.source, { recover: true });
      const semantic = evaluateTikzFigure(parsed.figure, parsed.source);
      for (const diagnostic of semantic.diagnostics) {
        const code = diagnostic.code ?? "";
        if (!code.startsWith("unsupported")) {
          continue;
        }
        unsupportedCounts.set(code, (unsupportedCounts.get(code) ?? 0) + 1);
      }
    }

    expect(unsupportedCounts.get("unsupported-option-key:decoration") ?? 0).toBe(0);
    expect(unsupportedCounts.get("unsupported-option-flag:decorate") ?? 0).toBe(0);
  }, 20000);
});
