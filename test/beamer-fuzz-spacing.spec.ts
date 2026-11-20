import { describe, expect, it } from "vitest";
import { renderBeamerFrame } from "../packages/core/src/beamer/index.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";

function slide(body: string, size = 11, theme = "Boadilla", aspectRatio = "43"): string {
  return String.raw`\documentclass[${size}pt,aspectratio=${aspectRatio}]{beamer}
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
    name: "starts a rounded block's flush environment without an extra lineskip",
    source: slide(String.raw`\begin{block}{Alpha}\begin{flushleft}\begin{tikzpicture}\draw (0,0) rectangle (2,1);\node at (1,.5){Box};\end{tikzpicture}\end{flushleft}\par Tail\end{block}\par Witness`),
    baselines: [["Alpha", 46.952881], ["Box", 72.597809], ["Tail", 104.221405], ["Witness", 124.395721]],
  },
  {
    name: "combines a terminal display skip with a default block's closing list skip",
    source: slide(String.raw`\begin{exampleblock}{Alpha}\begin{enumerate}\item First\item \begin{itemize}\item Second\item \[\begin{aligned}a+b&=c\\d-e&=f\end{aligned}\]\end{itemize}\end{enumerate}\end{exampleblock}\par\begin{tikzpicture}\node {Witness};\end{tikzpicture}`, 9, "default"),
    baselines: [["Alpha", 40.755554], ["Witness", 109.287582]],
  },
  {
    name: "inserts interline glue only once for a list after a block in a column",
    source: slide(String.raw`\begin{columns}[onlytextwidth,t]\begin{column}{.54\textwidth}\begin{exampleblock}{Block title}Block body\end{exampleblock}\par\begin{description}\item[First] \[E=mc^2\]\item[Next] Label\end{description}\end{column}\begin{column}{.42\textwidth}Peer column\end{column}\end{columns}`, 10, "Madrid"),
    baselines: [["Blocktitle", 65.651886], ["First", 103.182831], ["NextLabel", 131.683731]],
  },
  {
    name: "carries display depth and combines closing center glue before a column list",
    source: slide(String.raw`\begin{columns}[onlytextwidth,T]
\begin{column}{.62\textwidth}Peer column\end{column}
\begin{column}{.34\textwidth}
\begin{center}\[\begin{pmatrix}a&b\\c&d\end{pmatrix}\begin{pmatrix}x\\y\end{pmatrix}\]\end{center}
\par
\begin{description}\item[Stage 1] The first line is a reference point.\end{description}
\end{column}\end{columns}\par Witness`, 9),
    baselines: [["Stage1Thefirstlineis", 87.633789], ["Witness", 116.982117]],
  },
  {
    name: "inherits the enclosing cramped list's topsep inside a column",
    source: slide(String.raw`\begin{exampleblock}{Outer block}
\begin{itemize}\item First.
\item \begin{columns}[onlytextwidth,t]
\begin{column}{.46\textwidth}\begin{flushright}\begin{tikzpicture}\node {Picture};\end{tikzpicture}\end{flushright}\end{column}
\begin{column}{.50\textwidth}\begin{flushleft}\begin{exampleblock}{Incremental analysis}
\begin{tabular}{lrr}Method&Cost&Error\\\hline Local0&3&22\\Cached1&4&20\\\end{tabular}
\end{exampleblock}\end{flushleft}\end{column}
\end{columns}\end{itemize}\end{exampleblock}\par Witness`, 11, "Madrid", "169"),
    baselines: [["Incrementalanalysis", 101.288498], ["MethodCostError", 118.833603], ["Witness", 189.050339]],
  },
  {
    name: "retains parent paragraph glue when a nested list follows a display",
    source: slide(String.raw`\begin{columns}[onlytextwidth,T]
\begin{column}{.54\textwidth}Peer column\end{column}
\begin{column}{.42\textwidth}
{\small\color{blue}\centering
\begin{itemize}
\item {\scriptsize\color{blue}\centering\[\begin{aligned}a+b&=c\\ d-e&=f\end{aligned}\]\par}
\item \begin{description}
\item[Stage 1] \begin{tikzpicture}\node {Picture};\end{tikzpicture}
\item[Stage 2] Content after.
\end{description}\end{itemize}\par}
\end{column}\end{columns}\par Witness`, 10, "Madrid", "169"),
    baselines: [["Picture", 98.303329], ["Stage2Contentafter.", 111.697495], ["Witness", 121.00209]],
  },
  {
    name: "exits a nested list only once before an overlay item's terminal display",
    source: slide(String.raw`\visible<1,3>{
\begin{enumerate}
\item Intro.
\item<2-> \begin{description}
\item<1->[Stage 1] Content.
\item<2->[Stage 2] More content.
\end{description}
\par
\[\begin{pmatrix}a&b\\c&d\end{pmatrix}\begin{pmatrix}x\\y\end{pmatrix}\]
\end{enumerate}}
\par \begin{tikzpicture}[font=\scriptsize]
\fill<2-3>[magenta] (0,0) rectangle (.8,.3);
\node[anchor=west] at (2,0.15) {Witness};
\end{tikzpicture}
\only<4>{}`, 10, "Madrid"),
    baselines: [["Intro.", 50.12532], ["Witness", 127.170013]],
  },
  {
    name: "retains scoped outer topsep after closing nested lists",
    source: slide(String.raw`Top line.\par
{\small\centering
\begin{description}
\item[Stage 1] \begin{itemize}\item First inner item.\end{itemize}
\item[Stage 2] \begin{enumerate}\item Second inner item.\end{enumerate}
\end{description}\par}
\par Witness`, 12, "Madrid", "169"),
    baselines: [["Topline.", 53.242203], ["Witness", 114.234146]],
  },
  {
    name: "uses the reset list registers after a nested rounded minipage",
    source: slide(String.raw`\begin{exampleblock}{Outer}
\begin{itemize}\item Intro.
\item \begin{itemize}
\item \begin{alertblock}{Inner}\begin{description}\item[Stage] \begin{tikzpicture}\node {Picture};\end{tikzpicture}\end{description}\end{alertblock}
\item \begin{enumerate}\item First content.\item Second content.\item Third content.\end{enumerate}
\end{itemize}
\item {\scriptsize\color{blue}\centering Tail.\par}
\end{itemize}\end{exampleblock}
\par Witness`, 12, "Madrid"),
    baselines: [["Firstcontent.", 137.84903], ["Secondcontent.", 152.099487], ["Thirdcontent.", 166.34993], ["Witness", 196.366135]],
  },
  {
    name: "starts a display after nested columns without another empty-line baseline",
    source: slide(String.raw`\begin{columns}[onlytextwidth,T]\begin{column}{.46\textwidth}\begin{columns}[onlytextwidth,c]\begin{column}{.38\textwidth}Alpha\end{column}\begin{column}{.58\textwidth}\[E=\sum_{i=1}^{n}w_i x_i\]\end{column}\end{columns}\par\[E=\sum_{i=1}^{n}w_i x_i\]\par Tail\end{column}\begin{column}{.46\textwidth}Peer\end{column}\end{columns}\par Witness`, 12),
    baselines: [["Alpha", 66.31813], ["Tail", 136.525543], ["Witness", 145.501419]],
  },
  {
    name: "keeps the negative paragraph skip of an inherited item before an external block",
    source: slide(String.raw`\begin{itemize}\item First\item \begin{columns}[onlytextwidth,t]\begin{column}{.38\textwidth}\begin{itemize}\item \begin{block}{Alpha}Inside\end{block}\item Second\item Third\end{itemize}\end{column}\begin{column}{.58\textwidth}Peer\end{column}\end{columns}\end{itemize}\par\begin{tikzpicture}\node {Witness};\end{tikzpicture}`, 9, "Madrid"),
    baselines: [["Alpha", 71.001877], ["Inside", 84.294708], ["Second", 112.410843], ["Third", 122.861176], ["Witness", 135.520981]],
  },
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
    name: "starts consecutive displays from the correct empty-line baseline",
    source: slide(String.raw`\begin{columns}[onlytextwidth,T]
\begin{column}{.4\textwidth}Peer.\end{column}
\begin{column}{.55\textwidth}
\[E=\sum_{i=1}^{n}w_i x_i\]
\par
\[\begin{aligned}a+b&=c\\ d-e&=f\end{aligned}\]
\end{column}\end{columns}\par Witness`, 10, "Madrid", "169"),
    baselines: [["Peer.", 49.650345], ["a+b=c", 87.693069], ["Witness", 112.906906]],
  },
  {
    name: "combines below-display glue with the next alignment environment's topsep",
    source: slide(String.raw`\begin{columns}[onlytextwidth,T]
\begin{column}{.4\textwidth}Peer.\end{column}
\begin{column}{.55\textwidth}
\begin{flushleft}\[\begin{aligned}a+b&=c\\ d-e&=f\end{aligned}\]\end{flushleft}\par
\begin{center}\[\begin{pmatrix}a&b\\c&d\end{pmatrix}\begin{pmatrix}x\\y\end{pmatrix}\]\end{center}
\par Tail.
\end{column}\end{columns}\par Witness`, 10, "Madrid", "169"),
    baselines: [["a+b=c", 63.805649], ["abx", 108.457169], ["Witness", 147.96907]],
  },
  {
    name: "uses the last item depth before a display following a column list",
    source: slide(String.raw`\begin{columns}[onlytextwidth,T]
\begin{column}{.4\textwidth}Peer.\end{column}
\begin{column}{.55\textwidth}
\begin{description}
\item[Stage 1] Content.
\item[Stage 2] \begin{enumerate}\item First.\end{enumerate}
\end{description}\par
\visible<1->{\[\begin{aligned}a+b&=c\\ d-e&=f\end{aligned}\]}
\par Tail.
\end{column}\end{columns}\par Witness`, 10, "Madrid", "169"),
    baselines: [["a+b=c", 87.290451], ["Tail.", 123.011612], ["Witness", 130.659363]],
  },
  {
    name: "keeps a list and its surrounding center environment in the same column flow",
    source: slide(String.raw`\begin{itemize}
\item Intro.
\item \begin{columns}[onlytextwidth,t]
\begin{column}{.46\textwidth}Peer.\end{column}
\begin{column}{.50\textwidth}\begin{center}
\begin{itemize}\item Content in the center.\item \begin{tikzpicture}\node {Picture};\end{tikzpicture}\end{itemize}
\end{center}\end{column}\end{columns}\end{itemize}
\par Witness`, 10, "Madrid", "169"),
    baselines: [["Peer.", 61.525757], ["Contentinthecenter.", 71.976089], ["Picture", 83.703903], ["Witness", 97.041077]],
  },
  {
    name: "uses normal display skips after a scoped ragged-left paragraph",
    source: slide(String.raw`\begin{alertblock}{Message passing}
{\footnotesize\color{black}\raggedleft
\begin{tikzpicture}\node {Picture};\end{tikzpicture}\par}
\par
{\footnotesize\color{teal}\raggedleft
\[\begin{pmatrix}a&b\\c&d\end{pmatrix}\begin{pmatrix}x\\y\end{pmatrix}\]\par}
\end{alertblock}
\par Witness`, 10, "Boadilla", "169"),
    baselines: [["Picture", 63.035385], ["abx", 87.732788], ["Witness", 118.100616]],
  },
  {
    name: "inserts leading interline glue before a scoped block in a centered column",
    source: slide(String.raw`\begin{description}
\item[Stage 2] \begin{columns}[onlytextwidth,c]
\begin{column}{.46\textwidth}
{\small\color{blue}\raggedright\begin{alertblock}{Message passing}
\[\begin{aligned}a+b&=c\\ d-e&=f\end{aligned}\]
\end{alertblock}\par}\end{column}
\begin{column}{.50\textwidth}Peer.\end{column}
\end{columns}\end{description}
\par Witness`, 12, "Madrid", "169"),
    baselines: [["Messagepassing", 63.225632], ["Peer.", 78.600174], ["Witness", 131.862442]],
  },
  {
    name: "breaks after the anonymous center label before an overwide table",
    source: slide(String.raw`\begin{columns}[onlytextwidth,T]\begin{column}{.22\textwidth}Alpha\par\begin{center}\begin{tabular}{lrr}Method&Cost&Error\\\hline Fresh&12&17\\Local&14&1\\\end{tabular}\end{center}\par Tail\end{column}\begin{column}{.7\textwidth}Peer\end{column}\end{columns}\par Witness`, 12),
    baselines: [["Alpha", 48.556689], ["MethodCostError", 82.425209], ["Tail", 132.850907], ["Peer", 48.556689], ["Witness", 141.826791]],
  },
  {
    name: "retains the empty leading box before a scoped center environment in a nested column",
    source: slide(String.raw`\begin{columns}[onlytextwidth,T]
\begin{column}{.62\textwidth}
\begin{columns}[onlytextwidth,c]
\begin{column}{.46\textwidth}
Before \rule[-6pt]{18pt}{18pt} after.
\par
\textrm{A local update} can change the measurements used by several neighboring components. The estimate is $\sum_{i=1}^{n}x_i$.
\end{column}
\begin{column}{.50\textwidth}
{\small\color{blue}\centering{\footnotesize\color{black}\raggedright
\begin{center}\begin{tabular}{lrr}Method&Cost&Error\\\hline
Local0&29&27\\
Cached1&15&4\\
\end{tabular}\end{center}\par}\par}
\end{column}\end{columns}
\end{column}
\begin{column}{.34\textwidth}Peer.\end{column}
\end{columns}\par Witness`, 11, "default"),
    baselines: [["Peer.", 44.097488], ["MethodCostError", 91.351578], ["Cached1154", 112.632248], ["Witness", 151.144791]],
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

  it("retains the nested enumerate marker size when a rounded block starts a minipage", async () => {
    const rendered = await renderBeamerFrame(slide(String.raw`\begin{description}
\item[Stage 1] \begin{enumerate}\item Text\end{enumerate}
\item[Stage 2] \begin{enumerate}
\item \begin{alertblock}{Incremental analysis}
\begin{enumerate}\item Before and after.\item \[E=\sum_{i=1}^{n}w_i x_i\]\end{enumerate}
\end{alertblock}
\item Trailing item.
\end{enumerate}\end{description}\par Witness`, 10));
    expect(rendered.diagnostics).toEqual([]);
    const trace = buildNativeBeamerPageTrace(rendered, computerModernTexMetricProvider);
    const innerLabel = trace.lines.find(line => line.role === "block-body" && line.text === "2");
    expect(innerLabel?.baselineY).toBeCloseTo(90.253922, 2);
    const markers = trace.rectangles.filter(rect => rect.role === "list-marker" && rect.id.includes(":block:0:body:"));
    expect(markers).toHaveLength(3);
    expect(markers[1]?.width).toBeCloseTo(6.259689, 2);
    expect(markers[2]?.width).toBeCloseTo(6.259689, 2);
  });
});
