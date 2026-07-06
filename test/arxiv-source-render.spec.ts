import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { extractArxivTikzCandidates } from "../packages/app/src/arxiv-source.js";
import type { ArxivSourcePayload } from "../packages/app/src/platform/types.js";
import { createMinimalTikzSourceArtifact } from "../packages/core/src/export/index.js";
import { renderTikzToSvgAsync } from "../packages/core/src/render/index.js";

type Diagnostic = {
  severity: "warning" | "error";
  message: string;
};

function describeDiagnostics(diagnostics: readonly Diagnostic[]): string {
  return diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.message)
    .join("; ");
}

describe("arXiv source rendering", () => {
  it("renders all TikZ figures extracted from arXiv:2605.06194", async () => {
    const source = readFileSync("test/fixtures/arxiv/2605.06194/corefewvoters-figures.tex", "utf8");
    const paper: ArxivSourcePayload = {
      id: "2605.06194",
      files: [
        {
          path: "corefewvoters.arXiv.v1.tex",
          source,
          size: source.length
        }
      ]
    };

    const candidates = extractArxivTikzCandidates(paper);

    expect(candidates).toHaveLength(9);

    const failures: string[] = [];
    let totalContextualBytes = 0;
    let totalMinimalBytes = 0;
    for (const [index, candidate] of candidates.entries()) {
      const minimal = createMinimalTikzSourceArtifact({
        source: candidate.contextualSource,
        activeFigureId: "figure:0"
      });
      totalContextualBytes += candidate.contextualSource.length;
      totalMinimalBytes += minimal.text.length;
      expect(minimal.text).toContain("\\begin{tikzpicture}");
      expect(minimal.text).not.toContain("\\begin{document}");

      const rendered = await renderTikzToSvgAsync(minimal.text, {
        parse: { recover: true, includeContextDefinitions: true },
        svg: { padding: 18 }
      });
      const parseErrors = rendered.parse.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
      const semanticErrors = rendered.semantic.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
      if (parseErrors.length > 0 || semanticErrors.length > 0) {
        failures.push(
          `${index + 1} (${candidate.path}:${candidate.lineStart}): ${describeDiagnostics(parseErrors)} ${describeDiagnostics(semanticErrors)}`.trim()
        );
        continue;
      }
      if (rendered.semantic.scene.elements.length === 0) {
        failures.push(`${index + 1} (${candidate.path}:${candidate.lineStart}): rendered no scene elements`);
        continue;
      }
      if (!rendered.svg.svg.includes("<svg")) {
        failures.push(`${index + 1} (${candidate.path}:${candidate.lineStart}): rendered no SVG root`);
      }
    }

    expect(failures).toEqual([]);
    expect(totalMinimalBytes).toBeLessThan(totalContextualBytes / 2);
  });
});
