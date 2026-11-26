import { describe, expect, it } from "vitest";
import { prepareBeamerDocument, type BeamerFrameLayout } from "../packages/core/src/beamer/index.js";

// Baselines are LuaLaTeX page traces (scripts/compare-beamer-frame.mjs). The
// frame body is a vbox of the frame text height: `\vfill` stretches at the
// same order as the c/b/t frame skips (beamerbaseframe.sty `\beamer@frametopskip`,
// `\beamer@framebottomskip`), so the free height splits by glue weight.
const POSTER = String.raw`\usepackage[orientation=portrait,size=a0,scale=1.4]{beamerposter}`;
const document = (frameOptions: string, body: string, preamble = "") => String.raw`\documentclass{beamer}
${preamble}
\begin{document}\begin{frame}${frameOptions}{T}
${body}
\end{frame}\end{document}`;

async function baselines(source: string): Promise<Map<string, number>> {
  const layout: BeamerFrameLayout = (await prepareBeamerDocument(source).renderFrame({ frameIndex: 0, step: 1 })).layout;
  const result = new Map<string, number>();
  for (const paragraph of layout.paragraphs) {
    for (const line of paragraph.report.lines) {
      const placement = paragraph.vlistLayout.linePlacements.find(candidate => candidate.lineIndex === line.lineIndex);
      if (placement) {
        result.set(line.segments.map(segment => segment.text).join(""), paragraph.bounds.y + Number(placement.y) + Number(line.ascent));
      }
    }
  }
  return result;
}

describe("frame \\vfill packing", () => {
  const cases: { name: string; options: string; body: string; preamble?: string; expected: Record<string, number> }[] = [
    { name: "top frame, two fills", options: "[t]", body: String.raw`Alpha\par\vfill Beta\par\vfill Gamma`,
      expected: { Alpha: 42.1767, Beta: 122.3265, Gamma: 202.4764 } },
    { name: "bottom frame, one fill", options: "[b]", body: String.raw`Alpha\par\vfill Beta`,
      expected: { Alpha: 145.9562, Beta: 269.0262 } },
    { name: "centred frame, leading and trailing fill", options: "", body: String.raw`\vfill Alpha\par Beta\vfill`,
      expected: { Alpha: 133.7929, Beta: 147.3929 } },
    { name: "top frame, fills ending paragraphs", options: "[t]", body: String.raw`Alpha\vfill Beta text here\par More\vfill\vfill End`,
      expected: { Alpha: 42.1767, "Beta text here": 102.2891, More: 115.8891, End: 222.5138 } },
    { name: "centred frame, fill between blocks", options: "", body: String.raw`\begin{block}{A}one\end{block}\vfill\begin{block}{B}two\end{block}`,
      expected: { A: 92.1262, one: 105.7262, B: 177.9662, two: 191.5662 } },
    { name: "poster top frame, two fills", options: "[t]", preamble: POSTER, body: String.raw`Alpha\par\vfill Beta\par\vfill Gamma`,
      expected: { Alpha: 119.3979, Beta: 1219.85, Gamma: 2320.302 } },
    { name: "poster centred frame, leading and trailing fill", options: "", preamble: POSTER, body: String.raw`\vfill Alpha\par Beta\vfill`,
      expected: { Alpha: 1546.1726, Beta: 1588.1726 } },
  ];
  it.each(cases)("$name matches the LuaLaTeX page", async ({ options, body, preamble, expected }) => {
    const placed = await baselines(document(options, body, preamble));
    for (const [text, baseline] of Object.entries(expected)) {
      expect(placed.get(text), text).toBeCloseTo(baseline, 2);
    }
  });
});
