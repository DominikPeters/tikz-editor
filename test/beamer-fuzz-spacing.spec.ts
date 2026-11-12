import { describe, expect, it } from "vitest";
import { renderBeamerFrame } from "../packages/core/src/beamer/index.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";

function slide(body: string, size = 11, theme = "Boadilla"): string {
  return String.raw`\documentclass[${size}pt]{beamer}
\usepackage{tikz}
\usetheme{${theme}}
\setbeamertemplate{navigation symbols}{}
\begin{document}
\begin{frame}[t,shrink=5]{Spacing}
${body}
\end{frame}
\end{document}`;
}

// Baselines checked against independent LuaLaTeX renders of these small cases.
// Assert painted positions, including the frame shrink transform.
const cases = [
  {
    name: "retains the anonymous flushleft item after external blocks",
    source: slide(String.raw`\begin{columns}[onlytextwidth,c]\begin{column}{.46\textwidth}\begin{flushleft}\begin{exampleblock}{Alpha}First\end{exampleblock}\begin{block}{Beta}Second\end{block}\end{flushleft}\par Tail\end{column}\begin{column}{.5\textwidth}Peer\end{column}\end{columns}\par Witness`),
    baselines: [["Alpha", 56.453539], ["Beta", 97.659095], ["Tail", 154.467184], ["Peer", 95.606793], ["Witness", 162.751208]],
  },
  {
    name: "restores alignment skips between separate cramped lists",
    source: slide(String.raw`\begin{exampleblock}{Alpha}\begin{itemize}\item First\item Second\end{itemize}\par\begin{flushright}Right\end{flushright}\par\begin{description}\item[Stage] Third\end{description}\end{exampleblock}\par Witness`),
    baselines: [["Right", 96.919545], ["StageThird", 121.240313], ["Witness", 143.443179]],
  },
  {
    name: "selects display skips from the empty line and equation width",
    source: slide(String.raw`\begin{columns}[onlytextwidth,T]\begin{column}{.22\textwidth}\[\begin{pmatrix}a&b\\c&d\end{pmatrix}\begin{pmatrix}x\\y\end{pmatrix}\]\end{column}\begin{column}{.7\textwidth}\[\begin{aligned}a+b&=c\\d-e&=f\end{aligned}\]\end{column}\end{columns}\par Witness`),
    baselines: [["Witness", 82.28911]],
  },
  {
    name: "uses normal skips after an explicit paragraph in center",
    source: slide(String.raw`\begin{center}Alpha\par \[\begin{pmatrix}a&b\\c&d\end{pmatrix}\begin{pmatrix}x\\y\end{pmatrix}\]\end{center}\par Witness`),
    baselines: [["Alpha", 50.047487], ["Witness", 118.828644]],
  },
  {
    name: "breaks after the anonymous center label before an overwide table",
    source: slide(String.raw`\begin{columns}[onlytextwidth,T]\begin{column}{.22\textwidth}Alpha\par\begin{center}\begin{tabular}{lrr}Method&Cost&Error\\\hline Fresh&12&17\\Local&14&1\\\end{tabular}\end{center}\par Tail\end{column}\begin{column}{.7\textwidth}Peer\end{column}\end{columns}\par Witness`, 12),
    baselines: [["Alpha", 48.556689], ["MethodCostError", 82.425209], ["Tail", 132.850907], ["Peer", 48.556689], ["Witness", 141.826791]],
  },
  {
    name: "inserts interline glue after nested columns",
    source: slide(String.raw`\begin{columns}[onlytextwidth,T]\begin{column}{.46\textwidth}\begin{columns}[onlytextwidth,b]\begin{column}{.46\textwidth}Alpha\end{column}\begin{column}{.5\textwidth}Beta\end{column}\end{columns}\par \begin{tabular}{lrr}Method&Cost&Error\\\hline Fresh&12&17\\Local&14&1\\\end{tabular}\par Tail\end{column}\begin{column}{.5\textwidth}Peer\end{column}\end{columns}\par Witness`),
    baselines: [["MethodCostError", 56.110348], ["Tail", 94.376904], ["Witness", 102.660928]],
  },
  {
    name: "keeps list depth and pending labels inside default blocks",
    source: slide(String.raw`\begin{columns}[onlytextwidth,c]\begin{column}{.46\textwidth}\begin{itemize}\item First\item\begin{alertblock}{Alpha}\begin{enumerate}\item Second\item \[\begin{pmatrix}a&b\\c&d\end{pmatrix}\begin{pmatrix}x\\y\end{pmatrix}\]\end{enumerate}\end{alertblock}\item\begin{alertblock}{Beta}Third\end{alertblock}\end{itemize}\end{column}\begin{column}{.5\textwidth}Peer\end{column}\end{columns}\par Witness`, 9, "default"),
    baselines: [["Alpha", 54.958853], ["Beta", 114.897377], ["Peer", 84.997941], ["Witness", 145.437041]],
  },
  {
    name: "honors pending parent items at sibling list and external block boundaries",
    source: slide(String.raw`\begin{itemize}\item\begin{enumerate}\item First\item Second\end{enumerate}\par\begin{description}\item[Stage]\begin{block}{Alpha}Third\end{block}\item[Next]\begin{columns}[onlytextwidth,T]\begin{column}{.46\textwidth}Fourth\end{column}\begin{column}{.5\textwidth}Fifth\end{column}\end{columns}\end{description}\item Tail\end{itemize}\par Witness`),
    baselines: [["Alpha", 74.713116], ["Fourth", 126.014972], ["Fifth", 126.129404], ["Tail", 151.155142], ["Witness", 166.92564]],
  },
  {
    name: "omits the anonymous alignment label consumed by a list inside a block",
    source: slide(String.raw`\begin{itemize}\item\begin{flushright}\begin{block}{Alpha}\begin{itemize}\item First\item Second\end{itemize}\end{block}\end{flushright}\item Tail\end{itemize}\par Witness`),
    baselines: [["Alpha", 49.803329], ["Tail", 99.274241], ["Witness", 115.044739]],
  },
] as const;

describe("Beamer fuzz spacing regressions", () => {
  it.each(cases)("$name", async ({ source, baselines }) => {
    const rendered = await renderBeamerFrame(source);
    expect(rendered.diagnostics).toEqual([]);
    const trace = buildNativeBeamerPageTrace(rendered, computerModernTexMetricProvider);
    for (const [text, expected] of baselines) {
      const line = trace.lines.find(candidate => candidate.text === text);
      expect(line, text).toBeDefined();
      expect(line!.baselineY, text).toBeCloseTo(expected, 2);
    }
  });
});
