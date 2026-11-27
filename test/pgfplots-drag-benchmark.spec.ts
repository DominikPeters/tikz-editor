// Drag benchmark for axis evaluation caches (design/pgfplots.md 4.3): a
// document with five expression plots of 200 samples and a 5000-row inline
// table, dragged as an axis (`at=` changes) and as a neighbouring node.
// Prints ms per frame with the caches off and on; asserts that the warm
// scenes equal the cold ones. Set PGFPLOTS_BENCH_FRAMES to change the length.
import { describe, expect, it } from "vitest";

import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { pgfplotsEvaluationCacheStats, resetPgfplotsEvaluationCacheStats, setPgfplotsEvaluationCachesEnabled } from "../packages/core/src/pgfplots/eval-cache.js";

const FRAMES = Number(process.env.PGFPLOTS_BENCH_FRAMES ?? 6);

function documentWith(at: string, nodeX: number): string {
  const rows = Array.from({ length: 5000 }, (_, i) => `${String(i / 100)} ${String(Math.round(Math.sin(i / 300) * 1000) / 1000)}`).join("\n");
  const plots = [1, 2, 3, 4, 5].map((k) => `  \\addplot[domain=0:50, samples=200] {sin(deg(x/${String(k)}))*${String(k)}};`).join("\n");
  return String.raw`\pgfplotsset{compat=1.18}
\begin{tikzpicture}
\node[draw] (n) at (${String(nodeX)},-2) {neighbour};
\begin{axis}[width=10cm, height=7cm, at={${at}}]
${plots}
  \addplot[red] table {
x y
${rows}
};
\end{axis}
\end{tikzpicture}`;
}

function evaluateTimed(source: string): { ms: number; scene: string } {
  const parsed = parseTikz(source, { includeContextDefinitions: true });
  const start = performance.now();
  const result = evaluateTikzFigure(parsed.figure, source);
  const ms = performance.now() - start;
  return { ms, scene: JSON.stringify(result.scene.elements) };
}

function frames(kind: "axis" | "neighbour"): string[] {
  return Array.from({ length: FRAMES }, (_, i) => kind === "axis" ? documentWith(`(${String(i * 0.1)}cm,0cm)`, 0) : documentWith("(0cm,0cm)", i * 0.1));
}

describe("pgfplots drag benchmark", () => {
  it("reports ms per frame with and without the axis caches; warm equals cold", () => {
    const report: string[] = [];
    for (const kind of ["axis", "neighbour"] as const) {
      const sources = frames(kind);
      setPgfplotsEvaluationCachesEnabled(false);
      // Warm up the JIT so the first measured series is not penalised.
      evaluateTimed(sources[0] ?? ""); evaluateTimed(sources[0] ?? "");
      const cold = sources.map(evaluateTimed);
      setPgfplotsEvaluationCachesEnabled(true);
      resetPgfplotsEvaluationCacheStats();
      evaluateTimed(sources[0] ?? "");
      const warm = sources.map(evaluateTimed);
      const stats = pgfplotsEvaluationCacheStats();
      warm.forEach((frame, i) => { expect(frame.scene).toBe(cold[i]?.scene); });
      const mean = (list: Array<{ ms: number }>) => list.reduce((sum, f) => sum + f.ms, 0) / list.length;
      report.push(`${kind} drag: ${mean(cold).toFixed(1)} ms/frame without caches, ${mean(warm).toFixed(1)} ms/frame with (plot data hits ${String(stats.hits)}, misses ${String(stats.misses)})`);
      expect(stats.hits).toBeGreaterThanOrEqual(FRAMES * 6);
    }
    console.log(report.join("\n"));
  }, 600_000);
});
