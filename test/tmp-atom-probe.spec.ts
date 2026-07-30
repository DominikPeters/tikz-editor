import { it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/index.js";

const SOURCE = String.raw`\documentclass{beamer}
\newcommand{\generatedword}{Generated}
\begin{document}
\begin{frame}{Title \generatedword}
Prose \generatedword text.
\only<2->{Overlay text}
\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}
\end{frame}
\end{document}`;

it("inspect atomic segments", async () => {
  for (const step of [1, 2]) {
    const page = await prepareBeamerDocument(SOURCE).renderFrame({ frameIndex: 0, step });
    console.log("STEP", step);
    for (const paragraph of page.layout.paragraphs) {
      const segs = paragraph.report.lines.flatMap(l => l.segments)
        .filter(s => s.sourceRangePolicy && s.sourceRangePolicy !== "caret")
        .map(s => ({p: s.sourceRangePolicy, k: s.kind, slice: SOURCE.slice(Number(s.sourceStartRaw ?? 0), Number(s.sourceEndRaw ?? 0)).slice(0, 40)}));
      if (segs.length) console.log(" ", paragraph.paragraphId, JSON.stringify(segs));
      if (paragraph.hiddenSourceSpans?.length) console.log("  hidden:", JSON.stringify(paragraph.hiddenSourceSpans));
    }
    console.log("  items:", JSON.stringify(page.layout.items.filter(i => i.visibility === "hidden").map(i => ({id: i.id, kind: i.kind}))));
    console.log("  embeddedTikz:", JSON.stringify(page.layout.embeddedTikz.map(t => ({id: t.itemId, span: t.sourceSpan, bounds: t.bounds}))));
  }
});
