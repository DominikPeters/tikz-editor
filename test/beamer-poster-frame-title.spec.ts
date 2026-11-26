import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/index.js";

const body = String.raw`
\title[Short title]{A Long Title for the Probe}
\author[Short Author]{Some Author}
\institute[Short Inst]{Some Institute}
\date{2026}
\begin{document}
\section{First section}
\subsection{First subsection}
\begin{frame}{Frame title}
  \begin{block}{Block title}
    Some text in the block.
  \end{block}
\end{frame}
\end{document}`;
const poster = (use: string) => String.raw`\documentclass{beamer}
\usepackage[orientation=portrait,size=a0,scale=1.4]{beamerposter}
` + use + body;
const deck = (use: string) => String.raw`\documentclass{beamer}
` + use + body;

async function lines(source: string) {
  const { layout } = await prepareBeamerDocument(source).renderFrame({ frameIndex: 0, step: 1 });
  const result = new Map<string, { x: number; baseline: number }>();
  for (const paragraph of layout.paragraphs) {
    for (const line of paragraph.report.lines) {
      const placement = paragraph.vlistLayout.linePlacements.find(candidate => candidate.lineIndex === line.lineIndex);
      if (placement) {
        result.set(line.segments.map(segment => segment.text).join(""), {
          x: paragraph.bounds.x + Number(placement.x),
          baseline: paragraph.bounds.y + Number(placement.y) + Number(line.ascent),
        });
      }
    }
  }
  return result;
}

// LuaLaTeX page traces. These frame-title templates open with
// `\vskip-<d>ex` in the frame-title font (not the headline font), and the
// shadow template's minipage follows its shading picture after one
// end-of-line space of the frame-title font.
describe("frame titles at poster size", () => {
  const cases = [
    { name: "smoothbars deck", source: deck(String.raw`\useoutertheme{smoothbars}`), title: 39.9592, block: 143.1387 },
    { name: "smoothbars poster", source: poster(String.raw`\useoutertheme{smoothbars}`), title: 118.0385, block: 1453.9223 },
    { name: "smoothbars without subsections, poster", source: poster(String.raw`\useoutertheme[subsection=false]{smoothbars}`), title: 96.3161, block: 1440.8889 },
    { name: "smoothtree deck", source: deck(String.raw`\useoutertheme{smoothtree}`), title: 41.7895, block: 143.9173 },
    { name: "smoothtree poster", source: poster(String.raw`\useoutertheme{smoothtree}`), title: 127.4483, block: 1458.6992 },
  ];
  it.each(cases)("$name matches the LuaLaTeX baselines", async ({ source, title, block }) => {
    const placed = await lines(source);
    expect(placed.get("Frame title")?.baseline).toBeCloseTo(title, 2);
    expect(placed.get("Block title")?.baseline).toBeCloseTo(block, 2);
  });

  it.each([
    { name: "shadow deck", source: deck(String.raw`\useoutertheme{shadow}`), x: 13.2303 },
    { name: "shadow poster", source: poster(String.raw`\useoutertheme{shadow}`), x: 24.236 },
    { name: "Warsaw poster", source: poster(String.raw`\usetheme{Warsaw}`), x: 24.236 },
  ])("$name starts the title after the frame-title font's space", async ({ source, x }) => {
    expect((await lines(source)).get("Frame title")?.x).toBeCloseTo(x, 2);
  });
});
