import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/index.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";

describe("Beamer initial vertical flow", () => {
  it("normalizes every named size and uses the final repeated declaration", async () => {
    const source = String.raw`\documentclass{beamer}\begin{document}
\begin{frame}[plain,t]\small Alpha \normalsize Beta \small Gamma\end{frame}
\end{document}`;
    const rendered = await prepareBeamerDocument(source).renderFrame({ frameIndex: 0, step: 1 });
    const trace = buildNativeBeamerPageTrace(rendered, computerModernTexMetricProvider);
    for (const [code, size] of [[65, 10], [66, 10.95], [71, 10]] as const) {
      const glyph = trace.lines.flatMap(line => line.glyphs).find(glyph => glyph.code === code)!;
      expect(glyph.fontSize).toBeCloseTo(size, 4);
    }
    expect(rendered.diagnostics).toEqual([]);
  });

  it("suppresses the first interline glue on plain frames, including tall inline material", async () => {
    const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}[plain,t]\rule{1pt}{30pt}Alpha\end{frame}
\begin{frame}[t]\rule{1pt}{30pt}Alpha\end{frame}
\end{document}`;
    const prepared = prepareBeamerDocument(source);
    // Verified against LuaLaTeX: beamerbaseframe's initial empty vbox is
    // followed by \nointerlineskip only on plain frames.
    for (const [frameIndex, baseline] of [[0, 35.690460], [1, 36.690460]] as const) {
      const rendered = await prepared.renderFrame({ frameIndex, step: 1 });
      const trace = buildNativeBeamerPageTrace(rendered, computerModernTexMetricProvider);
      const line = trace.lines.find(line => line.text === "Alpha")!;
      expect(line).toBeDefined();
      expect(Math.abs(line.baselineY - baseline)).toBeLessThan(.01);
      expect(rendered.diagnostics).toEqual([]);
    }
  });
});
