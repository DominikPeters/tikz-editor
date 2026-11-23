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
    name: "closes a sibling list opened after a nested list's terminal display",
    source: slide(String.raw`Lead text.\par
\begin{description}
\item[Outer] \begin{description}
\item[First] \[\begin{aligned}a+b&=c\\d-e&=f\end{aligned}\]
\end{description}
\par
\begin{description}\item[Second] Sibling content.\end{description}
\par
Resumed outer paragraph.
\item[Tail] Last text.
\end{description}
\par Witness`, 10, "Madrid", "169"),
    baselines: [["SecondSiblingcontent.", 103.687973], ["Resumedouterparagraph.", 116.988403], ["Witness", 142.639206]],
  },
  {
    name: "ends a block at zero depth when an alignment closes over a larger display skip",
    source: slide(String.raw`Lead text.\par
\begin{alertblock}{Alpha}
\begin{itemize}\item Item text.\end{itemize}
\par
\begin{center}
{\small\color{blue}\centering Preceding paragraph.\par
\[\begin{aligned}a+b&=c\\d-e&=f\end{aligned}\]\par}
\end{center}
\end{alertblock}
\par \begin{tikzpicture}[font=\scriptsize]
\fill<2->[magenta] (0,0) rectangle (.8,.3);
\node[anchor=west] at (2,.15) {Witness};
\end{tikzpicture}`, 10, "default", "169"),
    baselines: [["Precedingparagraph.", 91.247971], ["a+b=c", 118.038773], ["Witness", 153.567093]],
  },
  {
    name: "closes both lists before opening a sibling list",
    source: slide(String.raw`Lead text.\par
\alt<1-2>{\begin{description}
\item[First] First text.
\item[Outer] \begin{description}
\item[Inner] Nested text.
\end{description}
\end{description}
\par
\begin{itemize}
\item Middle text.
\item \only<1-2>{\begin{enumerate}\item Last nested text.\end{enumerate}}
\end{itemize}
\par
\begin{description}\item[Last] Last text.\end{description}}{Alternate.}
\par Witness`, 10, "Madrid", "169"),
    baselines: [["InnerNestedtext.", 72.926041], ["Middletext.", 90.026581], ["LastLasttext.", 117.577454], ["Witness", 131.827896]],
  },
  {
    name: "retains the preceding list's closing glue when a centered list skips its own opening glue",
    source: slide(String.raw`Lead text.\par
\begin{description}
\item[Stage] Intro.\par
\begin{enumerate}\item First.\item Second.\end{enumerate}
\par
\begin{center}\begin{itemize}\item Centered text.\end{itemize}\end{center}
\end{description}
\par Witness`, 11, "Madrid"),
    baselines: [["Second.", 92.544174], ["Centeredtext.", 107.364639], ["Witness", 123.135147]],
  },
  {
    name: "shares a block's closing skip with the following center environment",
    source: slide(String.raw`Lead text.\par
\only<1,3>{\begin{exampleblock}{Alpha}
Block text.
\end{exampleblock}
\par
\begin{center}
Centered paragraph.
\end{center}}
\par Witness`, 11, "Madrid"),
    baselines: [["Blocktext.", 83.130066], ["Centeredparagraph.", 109.004562], ["Witness", 130.47525]],
  },
  {
    name: "keeps a post-display list's opening glue when its first label moves to a nested list",
    source: slide(String.raw`Lead text.\par
\begin{description}
\item[Outer] \alt<1,3>{\[E=\sum_{i=1}^{n}w_i x_i\]}{Alternate.}
\par
\begin{description}
\item[Middle] \begin{itemize}
\item Inner text.
\end{itemize}
\item[Next] More text.
\end{description}
\item[Tail] Last text.
\end{description}
\par Witness`, 12, "Boadilla", "169"),
    baselines: [["E=wx", 82.362167], ["MiddleInnertext.", 113.755035], ["Witness", 159.831497]],
  },
  {
    name: "shares the vertical skip between an extracted centered picture and flushleft",
    source: slide(String.raw`Lead text.\par
\uncover<1,3>{\begin{center}
\begin{tikzpicture}[font=\scriptsize]\node {Centered};\end{tikzpicture}
\end{center}
\par
\begin{flushleft}
{\scriptsize\color{black}\raggedleft
Aligned text.\par}
\end{flushleft}
\par Tail.}
\par Witness`, 9, "Madrid", "169"),
    baselines: [["Centered", 55.787582], ["Alignedtext.", 71.044754], ["Tail.", 87.147751], ["Witness", 97.550583]],
  },
  {
    name: "closes an alignment around a terminal list display before the next paragraph",
    source: slide(String.raw`Lead text.\par
\begin{columns}[onlytextwidth,c]
\begin{column}{.62\textwidth}
Peer one.\par Peer two.
\end{column}
\begin{column}{.34\textwidth}
\begin{flushleft}
\begin{enumerate}
\item First.
\item \[E=\sum_{i=1}^{n}w_i x_i\]
\end{enumerate}
\end{flushleft}
\par Tail.
\end{column}
\end{columns}
\par Witness`, 10, "Boadilla", "169"),
    baselines: [["Peerone.", 75.690231], ["E=wx", 87.989471], ["Tail.", 115.393768], ["Witness", 123.041519]],
  },
  {
    name: "ends a bottom-aligned column at zero depth after closing two lists",
    source: slide(String.raw`Lead text.\par
\begin{columns}[onlytextwidth,b]
\begin{column}{.46\textwidth}
Left one.\par Left two.\par Left three.\par Left four.
\end{column}
\begin{column}{.50\textwidth}
\begin{enumerate}
\item First.
\item Second.\par
\visible<1,3>{\begin{description}
\item[Stage] \begin{tabular}{lrr}Method&Cost&Error\\\hline
Local0&7&24\\
Cached1&2&10\\
Fresh2&12&21\\
Fresh3&26&11\\
\end{tabular}
\end{description}}
\end{enumerate}
\end{column}
\end{columns}
\par Witness`, 11, "Boadilla", "169"),
    baselines: [["Leftone.", 100.55188], ["Fresh32611", 135.436966], ["Witness", 152.233536]],
  },
  {
    name: "retains bottom-column depth when the terminal nested list inherits a pending label",
    source: slide(String.raw`Lead text.\par
\begin{columns}[onlytextwidth,b]
\begin{column}{.46\textwidth}
Left one.\par Left two.\par Left three.
\end{column}
\begin{column}{.50\textwidth}
\begin{description}
\item[Stage] Before.
\item[Last] \begin{enumerate}
\item First.
\item Closing paragraph.
\end{enumerate}
\end{description}
\end{column}
\end{columns}
\par Witness`, 9, "Madrid", "169"),
    baselines: [["Leftone.", 56.888367], ["Closingparagraph.", 77.694016], ["Witness", 88.096848]],
  },
  {
    name: "retains display depth in a bottom column when flushleft receives a pending label",
    source: slide(String.raw`Lead text.\par
\begin{alertblock}{Alpha}
\begin{enumerate}
\item First.
\item \begin{columns}[onlytextwidth,b]
\begin{column}{.46\textwidth}
Left one.\par Left two.\par Left three.\par Left four.
\end{column}
\begin{column}{.50\textwidth}
\begin{flushleft}
{\footnotesize\color{black}\raggedright
\[\begin{aligned}a+b&=c\\d-e&=f\end{aligned}\]\par}
\end{flushleft}
\end{column}
\end{columns}
\end{enumerate}
\end{alertblock}
\par Witness`, 9, "Boadilla", "169"),
    baselines: [["2", 91.797287], ["a+b=c", 99.402145], ["Witness", 129.674866]],
  },
  {
    name: "keeps a later item label when the preceding nested list inherited a pending label",
    source: slide(String.raw`Lead text.\par
\begin{columns}[onlytextwidth,t]
\begin{column}{.54\textwidth}
\begin{enumerate}
\item \begin{enumerate}\item Inner.\end{enumerate}
\item \begin{block}{Alpha}
\[\begin{pmatrix}a&b\\c&d\end{pmatrix}\begin{pmatrix}x\\y\end{pmatrix}\]
\end{block}
\par
\begin{tabular}{lrr}Method&Cost&Error\\\hline
Local0&7&24\\
Cached1&2&10\\
\end{tabular}
\end{enumerate}
\end{column}
\begin{column}{.42\textwidth}Peer.\end{column}
\end{columns}
\par Witness`, 9),
    baselines: [["2", 128.452789], ["MethodCostError", 119.137619], ["Witness", 150.328033]],
  },
  {
    name: "keeps the opening list skip after a standalone display in a block",
    source: slide(String.raw`Lead text.\par
\begin{exampleblock}{Alpha}
\begin{tikzpicture}[font=\scriptsize]\node {Picture};\end{tikzpicture}
\par
\[\begin{pmatrix}a&b\\c&d\end{pmatrix}\begin{pmatrix}x\\y\end{pmatrix}\]
\par
\begin{itemize}
\item First.
\item Second.
\end{itemize}
\par Tail.
\end{exampleblock}
\par Witness`, 10, "default", "169"),
    baselines: [["cdy", 102.078354], ["First.", 121.563629], ["Witness", 161.46489]],
  },
  {
    name: "keeps the display's leading baseline when an explicit paragraph ends the column's empty line",
    source: slide(String.raw`Lead text.\par
\begin{columns}[onlytextwidth,c]
\begin{column}{.46\textwidth}
Left one.\par Left two.\par Left three.\par Left four.\par Left five.\par Left six.\par Left seven.
\end{column}
\begin{column}{.50\textwidth}
\only<2>{\begin{enumerate}\item Hidden.\end{enumerate}}
\par
\[\begin{aligned}a+b&=c\\d-e&=f\end{aligned}\]
\par
\begin{flushleft}
\[\begin{aligned}g+h&=i\\j-k&=l\end{aligned}\]
\end{flushleft}
\end{column}
\end{columns}
\par Witness`, 12),
    baselines: [["Leftone.", 54.796082], ["a+b=c", 72.833298], ["g+h=i", 115.109634], ["Witness", 146.424576]],
  },
  {
    name: "combines a nested list's closing glue with the display skip before another equation",
    source: slide(String.raw`Lead text.\par
{\scriptsize\color{teal}\raggedleft
\begin{itemize}
\item First.\par
\begin{itemize}
\item Inner.
\item \[\begin{pmatrix}a&b\\c&d\end{pmatrix}\begin{pmatrix}x\\y\end{pmatrix}\]
\end{itemize}
\par
\visible<1,3>{\[E=\sum_{i=1}^{n}w_i x_i\]}
\item Tail.
\end{itemize}\par}
\par \begin{tikzpicture}[font=\scriptsize]\node {Witness};\end{tikzpicture}`, 10, "default"),
    baselines: [["cdy", 91.705856], ["E=wx", 111.960541], ["Witness", 146.1604]],
  },
  {
    name: "adjusts a nested list's terminal display skip before a separate picture",
    source: slide(String.raw`Lead text.\par
{\small\color{blue}\raggedleft
\begin{itemize}
\item First.
\item \begin{description}
\item[Stage 1] Before.
\item[Stage 2] \[\begin{aligned}a+b&=c\\d-e&=f\end{aligned}\]
\end{description}
\end{itemize}\par}
\par \begin{tikzpicture}[font=\scriptsize]\node {Witness};\end{tikzpicture}`, 12, "default", "169"),
    baselines: [["a+b=c", 109.430084], ["Witness", 149.551392]],
  },
  {
    name: "restores a pending list label when the paragraph break after a block is grouped",
    source: slide(String.raw`Lead text.\par
{\small\color{black}\raggedleft
\begin{itemize}
\item First.\par
\item \begin{itemize}
\item Inner text.
\end{itemize}
\item {\small\color{teal}\centering
\begin{exampleblock}{Alpha}
\begin{block}{Beta}Block text.\end{block}
\end{exampleblock}\par}
\end{itemize}\par}
\par \begin{tikzpicture}[font=\scriptsize]\node {Witness};\end{tikzpicture}`, 10, "Madrid", "169"),
    baselines: [["Innertext.", 73.875961], ["Blocktext.", 131.693848], ["Witness", 167.534683]],
  },
  {
    name: "combines closing alignment and display glue in a block with columns",
    source: slide(String.raw`Lead text.\par
\begin{block}{Alpha}
{\footnotesize\color{black}\raggedright
\begin{tikzpicture}[font=\scriptsize]\node {Picture};\end{tikzpicture}\par}
\par
\begin{columns}[onlytextwidth,b]
\begin{column}{.38\textwidth}Left.\end{column}
\begin{column}{.58\textwidth}Right.\end{column}
\end{columns}
\par
\begin{flushleft}
\[\begin{aligned}a+b&=c\\d-e&=f\end{aligned}\]
\end{flushleft}
\end{block}
\par \begin{tikzpicture}[font=\scriptsize]\node {Witness};\end{tikzpicture}`, 9, "default", "169"),
    baselines: [["Picture", 60.124817], ["a+b=c", 97.136124], ["Witness", 129.556213]],
  },
  {
    name: "resumes the empty paragraph after a display in a nested visibility action",
    source: slide(String.raw`Lead text.\par
\visible<1-2>{Visible text.\par
\only<1-2>{\[\begin{pmatrix}a&b\\c&d\end{pmatrix}\begin{pmatrix}x\\y\end{pmatrix}\]}}
\par \begin{tikzpicture}[font=\scriptsize]\node {Witness};\end{tikzpicture}
\only<3>{}`, 12, "Madrid"),
    baselines: [["cdy", 105.16124], ["Witness", 128.218933]],
  },
  {
    name: "ships overfull boxes and a display below their labels in a narrow description column",
    source: slide(String.raw`Lead text.\par
\begin{columns}[onlytextwidth,c]
\begin{column}{.14\textwidth}
\begin{description}
\item[Stage 1] \begin{tabular}{lrr}Method&Cost&Error\\\hline
Cached0&13&6\\
Cached1&9&3\\
\end{tabular}
\item[Stage 2] \begin{tikzpicture}\node[draw] {Picture};\end{tikzpicture}
\item[Stage 3] \[\begin{pmatrix}a&b\\c&d\end{pmatrix}\begin{pmatrix}x\\y\end{pmatrix}\]
\end{description}
\end{column}
\begin{column}{.76\textwidth}Peer text.\end{column}
\end{columns}
\par Witness`, 12, "default", "169"),
    baselines: [["MethodCostError", 76.32547], ["Peertext.", 123.701172], ["Picture", 132.678955], ["abx", 174.926315], ["Witness", 201.696289]],
  },
  {
    name: "uses zero depth for a bottom-aligned column ending with a centered display",
    source: slide(String.raw`Lead text.\par
\alt<1-2>{\begin{columns}[onlytextwidth,b]
\begin{column}{.46\textwidth}
Left one.\par Left two.\par Left three.\par Left four.\par Left five.\par Left six.
\end{column}
\begin{column}{.50\textwidth}
\begin{center}
{\small\color{blue}\centering
\[\begin{aligned}a+b&=c\\d-e&=f\end{aligned}\]\par}
\end{center}
\end{column}
\end{columns}}{Alternative text.}
\par Witness`, 11, "Madrid", "169"),
    baselines: [["a+b=c", 104.362686], ["Leftsix.", 122.033279], ["Witness", 134.95369]],
  },
  {
    name: "retains a rounded block's leading center registers before a nested list",
    source: slide(String.raw`Lead text.\par
\begin{block}{Alpha}
\begin{center}\begin{tikzpicture}\node {Picture};\end{tikzpicture}\end{center}
\par
\begin{enumerate}
\item \begin{description}
\item[Stage 1] \[\begin{pmatrix}a&b\\c&d\end{pmatrix}\begin{pmatrix}x\\y\end{pmatrix}\]
\item[Stage 2] Second.
\end{description}
\item Third.
\end{enumerate}
\par Tail.
\end{block}
\par Witness`, 9, "Boadilla", "169"),
    baselines: [["Picture", 69.009003], ["Stage2Second.", 126.245117], ["Tail.", 149.900864], ["Witness", 167.537216]],
  },
  {
    name: "keeps list paragraph spacing after a flush environment consumes the previous label",
    source: slide(String.raw`Lead text.\par
{\small
\begin{itemize}
\item \begin{flushleft}First text.\end{flushleft}
\item \only<2>{\begin{block}{Alpha}Block body.\end{block}}
\item Next text.
\end{itemize}\par}
\par Witness`, 10, "Madrid"),
    baselines: [["Nexttext.", 86.226532], ["Witness", 101.427017]],
  },
  {
    name: "ships an empty closing line when the nested list's paragraph hook clears a pending label",
    source: slide(String.raw`Lead text.\par
\begin{itemize}
\item<1-> First.
\item<2-> Second.\par
\begin{itemize}
\item<1-> Inner text.
\item<2-> Other text.
\end{itemize}
\item<3-> \begin{block}{Alpha}
\alt<1,3>{Block text.}{Alternative text.}
\end{block}
\par
{\small\color{black}\raggedleft
{\footnotesize\color{blue}\raggedright
\visible<1,3>{\begin{tabular}{lrr}Method&Cost&Error\\\hline
Local0&11&20\\
Local1&17&11\\
Cached2&10&19\\
\end{tabular}}\par}\par}
\end{itemize}
\par \begin{tikzpicture}[font=\scriptsize]\node[anchor=west] at (2,.15) {Witness};\end{tikzpicture}
\only<5>{}`),
    baselines: [["First.", 57.267166], ["Witness", 194.542877]],
  },
  {
    name: "retains the list paragraph skip when an item ends with an equation",
    source: slide(String.raw`Lead text.\par
{\footnotesize\color{blue}\raggedleft
\begin{itemize}
\item \begin{description}
\item[Stage 1] Some text.
\item[Stage 2] More text.
\end{description}
\item \alt<1-2>{\begin{center}
\[\begin{aligned}a+b&=c\\d-e&=f\end{aligned}\]
\end{center}}{Alternative estimate $x_0$.}
\end{itemize}\par}
\par Witness`, 10, "Madrid"),
    baselines: [["Stage1Sometext.", 59.150635], ["Stage2Moretext.", 68.175919], ["a+b=c", 92.069138], ["Witness", 121.795593]],
  },
  {
    name: "combines the closing flushright glue and a display skip before the next display",
    source: slide(String.raw`Lead text.\par
\begin{columns}[onlytextwidth,t]
\begin{column}{.62\textwidth}
\begin{columns}[onlytextwidth,b]
\begin{column}{.46\textwidth}First text.\end{column}
\begin{column}{.50\textwidth}Second text.\end{column}
\end{columns}
\par
\visible<1,3>{\begin{flushright}
\[E=\sum_{i=1}^{n}w_i x_i\]
\end{flushright}}
\par
\[\begin{pmatrix}a&b\\c&d\end{pmatrix}\begin{pmatrix}x\\y\end{pmatrix}\]
\par
Continued text.
\end{column}
\begin{column}{.34\textwidth}Peer text.\end{column}
\end{columns}
\par Witness`, 12, "Boadilla", "169"),
    baselines: [["abx", 165.122986], ["cdy", 178.898407], ["Continuedtext.", 198.193558], ["Witness", 207.180847]],
  },
  {
    name: "retains the closing list skip before a center environment with a color change",
    source: slide(String.raw`Lead text.\par
\begin{columns}[onlytextwidth,c]
\begin{column}{.62\textwidth}Peer text.\end{column}
\begin{column}{.34\textwidth}
\begin{enumerate}
\item<1-> First item.
\item<2-> \[\begin{aligned}a+b&=c\\d-e&=f\end{aligned}\]
\end{enumerate}
\par
{\small\color{black}\raggedright
\begin{center}Centered text.\end{center}\par}
\par
\begin{enumerate}\item Tail.\end{enumerate}
\end{column}\end{columns}
\par Witness`, 9, "default"),
    baselines: [["Peertext.", 83.955276], ["Centeredtext.", 106.924149], ["1.Tail.", 125.877243], ["Witness", 132.855209]],
  },
  {
    name: "combines a terminal display skip with a following center environment",
    source: slide(String.raw`Lead text.\par
\begin{columns}[onlytextwidth,c]
\begin{column}{.62\textwidth}Peer text.\end{column}
\begin{column}{.34\textwidth}
\begin{enumerate}
\item First item.
\item \[\begin{aligned}a+b&=c\\d-e&=f\end{aligned}\]
\end{enumerate}
\par
{\small\raggedright
\begin{center}Centered text.\end{center}\par}
\par Tail.
\end{column}\end{columns}
\par Witness`, 9, "default"),
    baselines: [["Peertext.", 77.252838], ["Centeredtext.", 96.369324], ["Tail.", 112.472336], ["Witness", 119.450302]],
  },
  {
    name: "keeps the opening skip for a nested list after a rounded block",
    source: slide(String.raw`Lead text.\par
\begin{description}
\item[Stage 1] First item.
\item[Stage 2] Next item.\par
\[E=\sum_{i=1}^{n}w_i x_i\]
\par
\begin{alertblock}{Alpha}Block body.\end{alertblock}
\par
\begin{enumerate}\item Tail.\end{enumerate}
\end{description}
\par Witness`, 9, "Boadilla", "169"),
    baselines: [["Alpha", 117.034348], ["Blockbody.", 130.986481], ["Tail.", 152.181656], ["Witness", 165.43457]],
  },
  {
    name: "top-aligns a column beginning with a grouped block",
    source: slide(String.raw`Lead text.\par
\begin{itemize}
\item Intro.
\item \begin{columns}[onlytextwidth,t]
\begin{column}{.46\textwidth}
\begin{alertblock}{Left title}Left body.\end{alertblock}
\end{column}
\begin{column}{.50\textwidth}
{\small\raggedright
\begin{block}{Right title}
\begin{tikzpicture}\node {Picture};\end{tikzpicture}
\end{block}\par}
\end{column}
\end{columns}
\item Next item.
\end{itemize}
\par Witness`, 10, "Madrid", "169"),
    baselines: [["Righttitle", 91.302414], ["Lefttitle", 91.416412], ["Picture", 108.598358], ["Nextitem.", 132.843201], ["Witness", 147.093643]],
  },
  {
    name: "keeps a rounded block's first list closing skip across a size change",
    source: slide(String.raw`Lead text.\par
\begin{block}{Alpha}
\begin{enumerate}\item First.\item Second.\end{enumerate}
\par
{\small\centering
\begin{description}\item[Stage 1] Third.\item[Stage 2] Fourth.\end{description}\par}
\end{block}
\par Witness`, 11, "Boadilla", "169"),
    baselines: [["Second.", 88.916031], ["Stage1Third.", 108.866669], ["Stage2Fourth.", 123.117111], ["Witness", 145.134064]],
  },
  {
    name: "adds the list paragraph skip once after an explicitly ended display",
    source: slide(String.raw`Lead text.\par
\begin{columns}[onlytextwidth,t]
\begin{column}{.46\textwidth}Peer text.\end{column}
\begin{column}{.50\textwidth}
{\small\centering
\begin{description}
\item[Stage 1] \[E=\sum_{i=1}^{n}w_i x_i\]
\par
Continued text.
\item[Stage 2] Next item.
\end{description}\par}
\end{column}
\end{columns}
\par Witness`, 11, "Boadilla", "169"),
    baselines: [["Continuedtext.", 118.737808], ["Stage2Nextitem.", 132.988251], ["Witness", 143.114914]],
  },
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
    name: "opens a nested list after an explicit paragraph following a display",
    source: slide(String.raw`\begin{description}
\item[Stage 1] \begin{flushleft}
\[E=\sum_{i=1}^{n}w_i x_i\]
\end{flushleft}
\par
\begin{description}
\item[Inner] \[E=\sum_{i=1}^{n}w_i x_i\]
\item[Next] Content.
\end{description}
\item[Stage 2] Tail.
\end{description}
\par Witness`, 10, "Madrid"),
    baselines: [["Inner", 96.281235], ["NextContent.", 138.798645], ["Witness", 166.349518]],
  },
  {
    name: "keeps the parent label pending across columns before a nested enumeration",
    source: slide(String.raw`\begin{enumerate}
\item Intro.
\item \begin{columns}[onlytextwidth,c]
\begin{column}{.46\textwidth}
\[E=\sum_{i=1}^{n}w_i x_i\]
\end{column}
\begin{column}{.50\textwidth}Peer.\end{column}
\end{columns}
\par
\begin{enumerate}
\item Inner content.
\item Following content.
\end{enumerate}
\item Tail.
\end{enumerate}
\par Witness`, 11, "Madrid"),
    baselines: [["Peer.", 72.542618], ["Innercontent.", 93.603897], ["Witness", 133.695175]],
  },
  {
    name: "opens an adjacent outer list when a nested item consumes its first label",
    source: slide(String.raw`\begin{alertblock}{Outer block}
\begin{description}
\item[Stage 1] First content.
\item[Stage 2] Second content.
\end{description}
\par
\begin{itemize}
\item \begin{enumerate}\item Inner content.\item Next content.\end{enumerate}
\end{itemize}
\end{alertblock}
\par Witness`, 11, "Madrid"),
    baselines: [["Innercontent.", 99.797791], ["Nextcontent.", 111.198151], ["Witness", 131.362549]],
  },
  {
    name: "combines closing list glue and flushleft glue within the same outer item",
    source: slide(String.raw`\begin{itemize}
\item Intro.\par
\begin{description}\item[Stage 1] First content.\item[Stage 2] Second content.\end{description}
\par
\begin{flushleft}
{\small\color{blue}\centering
\begin{tikzpicture}\node {Picture};\end{tikzpicture}\par}
\end{flushleft}
\item Tail.
\end{itemize}
\par Witness`, 11, "default"),
    baselines: [["Picture", 86.840576], ["Witness", 119.27742]],
  },
  {
    name: "combines a terminal default block's small skip with its closing list glue",
    source: slide(String.raw`\begin{alertblock}{Outer block}
\begin{enumerate}
\item First content.
\item \begin{block}{Child block}
\begin{center}\begin{tikzpicture}\node {Picture};\end{tikzpicture}\end{center}
\end{block}
\end{enumerate}
\end{alertblock}
\par Witness`, 9, "default", "169"),
    baselines: [["Childblock", 70.321487], ["Picture", 80.160645], ["Witness", 99.207489]],
  },
  {
    name: "uses the first centered columns box when placing a default block's body",
    source: slide(String.raw`\begin{exampleblock}{Outer block}
\begin{columns}[onlytextwidth,c]
\begin{column}{.62\textwidth}
\rule{1pt}{30pt}\par Tall content.
\end{column}
\begin{column}{.34\textwidth}Short content.\end{column}
\end{columns}
\end{exampleblock}
\par Witness`, 11, "default"),
    baselines: [["Shortcontent.", 72.559509], ["Tallcontent.", 89.60318], ["Witness", 100.737305]],
  },
  {
    name: "preserves the closing center skip in a default block",
    source: slide(String.raw`\begin{columns}[onlytextwidth,c]
\begin{column}{.38\textwidth}
\begin{alertblock}{Alpha}
\begin{center}\begin{tikzpicture}\node {Picture};\end{tikzpicture}\end{center}
\end{alertblock}
\end{column}
\begin{column}{.58\textwidth}Peer.\end{column}
\end{columns}\par Witness`, 11, "default", "169"),
    baselines: [["Peer.", 59.552444], ["Picture", 70.341248], ["Witness", 90.642776]],
  },
  {
    name: "suppresses the first list's opening skip in a rounded block with columns",
    source: slide(String.raw`\begin{alertblock}{Alpha}
\begin{enumerate}\item Intro.\item Next.\end{enumerate}
\par
\begin{columns}[onlytextwidth,b]
\begin{column}{.46\textwidth}First column.\end{column}
\begin{column}{.50\textwidth}Second column.\end{column}
\end{columns}
\end{alertblock}
\par Witness`, 10),
    baselines: [["Next.", 73.462555], ["Secondcolumn.", 87.713013], ["Witness", 106.461853]],
  },
  {
    name: "uses a smaller font's baseline when grouped prose follows a column list",
    source: slide(String.raw`\begin{columns}[onlytextwidth,c]
\begin{column}{.38\textwidth}
\rule{1pt}{42pt}\par Peer.
\end{column}
\begin{column}{.58\textwidth}
\begin{itemize}
\item Text.
\item<2-> \[E=\sum_{i=1}^{n}w_i x_i\]
\end{itemize}
\par
{\scriptsize\color{blue}\centering
\uncover<1,3>{\textbf{Intermediate results carry} both a numerical estimate and an explicit dependency set. The estimate is $\alpha+\beta$.}\par}
\end{column}\end{columns}
\par Witness`, 11, "default", "169"),
    baselines: [["Peer.", 101.056442], ["Intermediateresultscarrybothanumericalestimateandanexplicit", 109.303452], ["Witness", 128.048782]],
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
    name: "retains the outer item boundary before a list that consumes an alignment label",
    source: slide(String.raw`Lead text.\par
{\small\centering
\begin{description}
\item[Stage 1] \begin{itemize}
\item Alpha.
\item \[E=\sum_{i=1}^{n}w_i x_i\]
\end{itemize}
\item[Stage 2] \begin{flushleft}
\begin{enumerate}
\item \begin{columns}[onlytextwidth,t]
\begin{column}{.38\textwidth}First column.\end{column}
\begin{column}{.58\textwidth}Second column.\end{column}
\end{columns}
\item Tail.
\end{enumerate}
\end{flushleft}
\end{description}\par}
\par Witness`, 12, "Madrid", "169"),
    baselines: [["Firstcolumn.", 138.567368], ["Stage2", 151.487778], ["Tail.", 164.408203], ["Witness", 186.733902]],
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
    name: "suppresses a nested description's opening skip while its center label is pending",
    source: slide(String.raw`\begin{columns}[onlytextwidth,b]
\begin{column}{.54\textwidth}
\begin{center}
\only<1,3>{\begin{description}
\item[Stage 1] \begin{tikzpicture}\node {Picture};\end{tikzpicture}
\end{description}}
\end{center}
\end{column}
\begin{column}{.42\textwidth}Peer.\end{column}
\end{columns}\par Witness`, 11, "Madrid"),
    baselines: [["Picture", 57.249619], ["Stage1", 60.831284], ["Peer.", 60.831284], ["Witness", 73.751694]],
  },
  {
    name: "formats nested enumeration labels with the enclosing counter across a block",
    source: slide(String.raw`\begin{columns}[onlytextwidth,c]
\begin{column}{.46\textwidth}Peer.\end{column}
\begin{column}{.50\textwidth}
\begin{enumerate}
\item First.
\only<2>{\item Removed.}
\item[Special] Custom label.
\item \begin{exampleblock}{Incremental refinement}
\begin{enumerate}\item \[\begin{pmatrix}a&b\\c&d\end{pmatrix}\]\end{enumerate}
\end{exampleblock}
\end{enumerate}
\end{column}\end{columns}\par Witness`, 9, "default"),
    baselines: [["2.2.1", 74.01709], ["Witness", 102.941895]],
  },
  {
    name: "hyphenates a word that exceeds a narrow block's line width",
    source: slide(String.raw`\begin{columns}[onlytextwidth,T]
\begin{column}{.1564\textwidth}
\begin{alertblock}{Constraint propagation}
{\small\color{blue}\raggedleft
\textit{The final diagram} records the order in which information crosses the partition. Intermediate results carry both a numerical estimate and an explicit dependency set. The estimate is $\frac{a+b}{1+c}$.\par}
\end{alertblock}
\end{column}
\begin{column}{.80\textwidth}Peer.\end{column}
\end{columns}\par Witness`, 12, "Madrid"),
    baselines: [["Intermedi-", 166.375122], ["Witness", 260.676056]],
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
    name: "uses the active font's baseline before a scoped block after another block",
    source: slide(String.raw`\begin{columns}[onlytextwidth,T]
\begin{column}{.62\textwidth}Peer.\end{column}
\begin{column}{.34\textwidth}
\begin{block}{First block}
Before \rule[-2pt]{20pt}{12pt} after.
\par \begin{tikzpicture}\node {Box};\end{tikzpicture}
\end{block}
\par
{\scriptsize\color{teal}\raggedright
\visible<1->{\begin{block}{Next block}
\begin{tikzpicture}\node {Picture};\end{tikzpicture}
\end{block}}\par}
\end{column}\end{columns}
\par Witness`, 9, "default"),
    baselines: [["Nextblock", 83.838852], ["Picture", 91.066483], ["Witness", 99.907257]],
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
  {
    name: "ships a list's parsep before a display that starts a paragraph after an explicit par",
    source: slide(String.raw`Lead text.\par
{\footnotesize
\begin{itemize}
\item Item text.
\par
\[x\]
\end{itemize}\par}
\par Witness`, 10, "Madrid", "169"),
    baselines: [["Itemtext.", 59.150696], ["x", 79.101318], ["Witness", 95.251831]],
  },
  {
    name: "continues a display's paragraph without a parsep when no par follows the display",
    source: slide(String.raw`Lead text.\par
{\footnotesize
\begin{itemize}
\item Item text.
\par
\[x\]
More text.
\end{itemize}\par}
\par Witness`, 10, "Madrid", "169"),
    baselines: [["Itemtext.", 59.150665], ["x", 79.101303], ["Moretext.", 90.976685], ["Witness", 105.227127]],
  },
  {
    name: "uses the declared size's baselineskip for the glue above a block's title box",
    source: slide(String.raw`Lead text.\par
{\footnotesize\color{blue}\raggedleft
\begin{alertblock}{Title}
Body text.
\end{alertblock}\par}
\par Witness`, 11, "default", "43"),
    baselines: [["Title", 57.647461], ["Bodytext.", 68.097794], ["Witness", 83.868301]],
  },
  {
    name: "applies the outer list's parsep to a display after a nested list and to the closing skip",
    source: slide(String.raw`Lead text.\par
{\footnotesize
\begin{description}
\item[Outer] Outer text.
\par
\begin{description}
\item[Inner] Nested text.
\end{description}
\par
\[x\]
\end{description}\par}
\par Witness`, 10, "Madrid", "169"),
    baselines: [["OuterOutertext.", 59.150665], ["InnerNestedtext.", 71.976059], ["x", 93.826752], ["Witness", 109.977264]],
  },
  {
    name: "keeps the baseline glue before a list that follows a center display whose skip is absorbed",
    source: slide(String.raw`Lead text.\par
\begin{columns}[onlytextwidth,b]
\begin{column}{0.62\textwidth}
Left one.\par Left two.\par Left three.\par Left four.
\end{column}
\begin{column}{0.34\textwidth}
\begin{enumerate}
\item Text.\par
\begin{center}
\[x\]
\end{center}
\par
\begin{description}
\item[A] Item.
\end{description}
\end{enumerate}
\end{column}
\end{columns}
\par Witness`, 10, "Madrid", "169"),
    baselines: [["Leftfour.", 118.261459], ["x", 95.356232], ["AItem.", 118.156952], ["Witness", 129.661819]],
  },
  {
    name: "keeps a list's opening topsep after a display that begins a rounded block's body",
    source: slide(String.raw`Lead text.\par
\begin{alertblock}{Title}
\[x\]
\par
\begin{itemize}
\item Words.
\end{itemize}
\end{alertblock}
\par Witness`, 10, "Madrid", "169"),
    baselines: [["Title", 65.75618], ["x", 84.756775], ["Words.", 104.707413], ["Witness", 123.351746]],
  },
  {
    name: "adds the enclosing parsep to back-to-back nested list closings before a picture",
    source: slide(String.raw`Lead text.\par
{\footnotesize
\begin{description}
\item[Outer] Outer text.
\par
\begin{description}
\item[Inner] Inner text.
\end{description}
\end{description}\par}
\par \begin{tikzpicture}[font=\scriptsize]\node[anchor=west] at (2,0.15) {Witness};\end{tikzpicture}`, 10, "Madrid", "169"),
    baselines: [["InnerInnertext.", 71.97612], ["Witness", 83.943665]],
  },
  {
    name: "adds the enclosing parsep to back-to-back nested list closings before text",
    source: slide(String.raw`Lead text.\par
{\footnotesize
\begin{description}
\item[Outer] Outer text.
\par
\begin{description}
\item[Inner] Inner text.
\end{description}
\end{description}\par}
\par Witness`, 10, "Madrid", "169"),
    baselines: [["InnerInnertext.", 71.97612], ["Witness", 87.176605]],
  },
  {
    name: "treats a column group as text when its only list is in a hidden overlay branch",
    source: slide(String.raw`Lead text.\par
\begin{columns}[onlytextwidth,c]
\begin{column}{0.54\textwidth}
Left one.\par Left two.\par Left three.\par Left four.
\end{column}
\begin{column}{0.42\textwidth}
{\scriptsize\raggedleft
\alt<1>{Alt text.}{\begin{enumerate}\item A\end{enumerate}}\par}
\end{column}
\end{columns}
\par Witness`, 10, "Madrid", "169"),
    baselines: [["Lefttwo.", 66.427917], ["Alttext.", 71.105865], ["Leftthree.", 77.828278], ["Witness", 96.876389]],
  },
  {
    name: "does not collapse a list's closing skip with an alignment opened after a color change",
    source: slide(String.raw`Lead text.\par
{\footnotesize
\begin{itemize}
\item Alpha.
\item Beta.
\end{itemize}
\par
{\footnotesize\color{black}\raggedleft
\begin{flushright}
\[x\]
\end{flushright}\par}\par}
\par Witness`, 10, "Madrid", "169"),
    baselines: [["Beta.", 70.075974], ["x", 104.277054], ["Witness", 123.277649]],
  },
  {
    name: "suppresses the closing topsep of a list that starts on its item's label line",
    source: slide(String.raw`Lead text.\par
{\small
\begin{description}
\item[Outer] Words.
\item[Nested] \begin{enumerate}\item A\item B\end{enumerate}
\end{description}
\par
\begin{columns}[onlytextwidth,c]
\begin{column}{0.50\textwidth}
Column text.
\end{column}
\end{columns}\par}
\par Witness`, 9, "Madrid", "169"),
    baselines: [["B", 72.99231], ["Columntext.", 85.133698], ["Witness", 94.795502]],
  },
  {
    name: "ends a default block at zero depth when its list closes after a display",
    source: slide(String.raw`Lead text.\par
\begin{block}{Title}
\begin{description}
\item[Stage 1] Words.
\item[Stage 2] \[\begin{pmatrix}a&b\\c&d\end{pmatrix}\]
\end{description}
\end{block}
\par Witness`, 10, "default", "43"),
    baselines: [["Stage1Words.", 71.099792], ["cd", 104.787918], ["Witness", 128.158813]],
  },
  {
    name: "keeps the enclosing size's list registers when a scriptsize group opens inside footnotesize",
    source: slide(String.raw`Lead text.\par
{\footnotesize {\scriptsize
\begin{description}
\item[Stage 1] \[\begin{aligned}a+b&=c\\ d-e&=f\end{aligned}\]
\item[Stage 2] Words here.
\end{description}\par}}
\par Witness`, 10, "Madrid", "169"),
    baselines: [["Stage1", 57.725616], ["Stage2Wordshere.", 88.544601], ["Witness", 102.795044]],
  },
  {
    name: "adds the enclosing parsep to a nested sibling list's opening skip",
    source: slide(String.raw`Lead text.\par
{\footnotesize
\begin{description}
\item[Stage 2] Words.
\par
\begin{itemize}
\item Alpha text.
\end{itemize}
\par
\begin{itemize}
\item Beta text.
\end{itemize}
\end{description}\par}
\par Witness`, 10, "Madrid", "169"),
    baselines: [["Alphatext.", 71.976074], ["Betatext.", 86.701538], ["Witness", 101.902023]],
  },
  {
    name: "closes a list with the leaked topsep and parsep after a block holding a list, before text",
    source: slide(String.raw`Lead text.\par
{\footnotesize
\begin{description}
\item[Inner] \begin{exampleblock}{Title}
\begin{itemize}\item Block item.\end{itemize}
\end{exampleblock}
\end{description}\par}
\par Witness`, 10, "Madrid", "169"),
    baselines: [["InnerBlockitem.", 79.58107], ["Witness", 100.09697]],
  },
  {
    name: "applies the same leaked closing skip before a following picture",
    source: slide(String.raw`Lead text.\par
{\footnotesize
\begin{description}
\item[Inner] \begin{exampleblock}{Title}
\begin{itemize}\item Block item.\end{itemize}
\end{exampleblock}
\end{description}\par}
\par \begin{tikzpicture}[font=\scriptsize]\node[anchor=west] at (2,0.15) {Witness};\end{tikzpicture}`, 10, "Madrid", "169"),
    baselines: [["InnerBlockitem.", 79.58107], ["Witness", 96.864029]],
  },
  {
    name: "does not mistake an opening group's color for one between a closing list and the next paragraph",
    source: slide(String.raw`Lead text.\par
{\footnotesize\color{teal}\raggedleft
\begin{description}
\item[Outer] \begin{description}
\item[Inner] \begin{exampleblock}{Title}
\begin{enumerate}
\item Text.
\item \[x\]
\end{enumerate}
\end{exampleblock}
\end{description}
\end{description}\par}
\par Witness`, 10, "Madrid", "169"),
    baselines: [["InnerText.", 81.774429], ["x", 101.725052], ["Witness", 122.164948]],
  },
  {
    name: "closes a default block's list at the surrounding list depth",
    source: slide(String.raw`Lead text.\par
\begin{itemize}
\item Words.
\par
\begin{exampleblock}{Title}
\begin{description}
\item[Stage 1] Plain words.
\end{description}
\end{exampleblock}
\end{itemize}
\par Witness`, 10, "default", "43"),
    baselines: [["Words.", 53.989822], ["Title", 71.090363], ["Witness", 102.507843]],
  },
  {
    name: "uses lineskip before a display that follows a columns box deeper than its baseline glue",
    source: slide(String.raw`Lead text.\par
\begin{columns}[onlytextwidth,t]
\begin{column}{0.5\textwidth}
Left one.\par Left two.\par Left three.
\end{column}
\begin{column}{0.4\textwidth}
Right.
\end{column}
\end{columns}
\par
\[x\]
\par Witness`, 9, "Boadilla", "43"),
    baselines: [["Leftthree.", 66.263916], ["x", 77.710831], ["Witness", 92.8638]],
  },
  {
    name: "clears the pending parskip after a columns box that holds an alignment",
    source: slide(String.raw`Lead text.\par
{\footnotesize
\begin{description}
\item[Stage 2] \begin{columns}[onlytextwidth,T]
\begin{column}{0.42\textwidth}
\begin{center}Text.\end{center}
\end{column}
\end{columns}
\par
\begin{tabular}{lrr}Method&Cost&Error\\\hline Global0&8&17\\\end{tabular}
\end{description}\par}
\par Witness`, 12, "Madrid", "169"),
    baselines: [["Stage2Text.", 70.076736], ["MethodCostError", 83.814133], ["Witness", 113.576706]],
  },
  {
    name: "drops a trailing alignment's skip from a rounded block that ends a minipage around a nested block",
    source: slide(String.raw`Lead text.\par
\begin{alertblock}{Outer}\begin{alertblock}{Inner}Text.\end{alertblock}\par\begin{flushright}Plain.\end{flushright}\end{alertblock}
\par \begin{tikzpicture}[font=\scriptsize]\node[anchor=west] at (2,0.15) {Witness};\end{tikzpicture}`, 10, "Boadilla", "169"),
    baselines: [["Plain.", 121.017212], ["Witness", 136.428604]],
  },
  {
    name: "closes a scriptsize list with the enclosing small registers before a picture",
    source: slide(String.raw`Lead text.\par
{\small
\begin{itemize}\item First.\end{itemize}
\par
{\scriptsize\raggedleft
\begin{itemize}\item Second.\end{itemize}\par}\par}
\par \begin{tikzpicture}[font=\scriptsize]\node[anchor=west] at (2,0.15) {Witness};\end{tikzpicture}`, 11, "Boadilla", "43"),
    baselines: [["Second.", 79.023117], ["Witness", 94.100494]],
  },
  {
    name: "restores the normal item separation after a block that holds a list, once, even in a cramped frame",
    source: slide(String.raw`Lead.\par
{\footnotesize
\begin{itemize}
\item \begin{block}{T}\begin{enumerate}\item A\end{enumerate}\end{block}
\item Alpha.
\item Beta.
\end{itemize}\par}
\par Witness`, 11, "Madrid", "43"),
    baselines: [["Alpha.", 103.416687], ["Beta.", 115.767075], ["Witness", 132.48761]],
  },
  {
    name: "opens a nested list on the label line after a block that holds a list without the leaked skips",
    source: slide(String.raw`Lead.\par
{\footnotesize
\begin{itemize}
\item \begin{block}{T}\begin{enumerate}\item A\end{enumerate}\end{block}
\item \begin{itemize}
\item Alpha.
\item Beta.
\end{itemize}
\end{itemize}\par}
\par Witness`, 11, "Madrid", "43"),
    baselines: [["Alpha.", 104.366714], ["Beta.", 115.767075], ["Witness", 132.48761]],
  },
  {
    name: "keeps the item parsep before a nested list that follows a block holding a list in a later item",
    source: slide(String.raw`Lead.\par
{\footnotesize
\begin{itemize}
\item Short.
\item \begin{block}{T}\begin{enumerate}\item A\end{enumerate}\end{block}
\item \begin{itemize}
\item Alpha.
\item Beta.
\end{itemize}
\end{itemize}\par}
\par Witness`, 11, "Madrid", "43"),
    baselines: [["Alpha.", 116.790741], ["Beta.", 128.191101], ["Witness", 144.911636]],
  },
  {
    name: "keeps the baseline glue after a list that ends in a display when an earlier display precedes it",
    source: slide(String.raw`Lead.\par
{\small
\[E=x\]
\par
Between.\par
\begin{itemize}
\item \[a=c\]
\end{itemize}\par}
\par Witness`, 11, "Madrid", "43"),
    baselines: [["Between.", 88.93399], ["a=c", 117.434891], ["Witness", 138.905579]],
  },
  {
    name: "collapses an outer item's boundary into the below skip of a display that ended a nested list",
    source: slide(String.raw`Lead.\par
{\small
\begin{enumerate}
\item First text.
\par
\begin{enumerate}
\item \[E=x\]
\end{enumerate}
\item Second.
\end{enumerate}\par}
\par Witness`, 11, "Madrid", "43"),
    baselines: [["E=x", 93.684174], ["Witness", 129.405304]],
  },
  {
    name: "collapses the item boundary into a nested list's final display before a list in the next outer item",
    source: slide(String.raw`Lead.\par
{\small
\begin{enumerate}
\item First text.
\par
\begin{enumerate}
\item \[E=x\]
\end{enumerate}
\item \begin{itemize}
\item \[F=y\]
\item Alpha.
\end{itemize}
\end{enumerate}\par}
\par Witness`, 11, "Madrid", "43"),
    baselines: [["E=x", 93.684097], ["F=y", 122.184998], ["Alpha.", 139.285538], ["Witness", 157.906128]],
  },
  {
    name: "adds the item parsep to the larger of itemsep and the nested list's closing skip",
    source: slide(String.raw`Lead.\par
{\small
\begin{enumerate}
\item First text.
\par
\begin{enumerate}
\item Inner.
\end{enumerate}
\item \begin{itemize}
\item Alpha.
\end{itemize}
\end{enumerate}\par}
\par Witness`, 11, "Madrid", "43"),
    baselines: [["Inner.", 82.283844], ["Alpha.", 98.434357], ["Witness", 117.054947]],
  },
  {
    name: "ends an empty line when a column's content starts with \\par",
    source: slide(String.raw`Lead.\par
\begin{columns}[onlytextwidth,t]
\begin{column}{0.46\textwidth}
Left.
\end{column}
\begin{column}{0.50\textwidth}
\only<2>{X}
\par
Right.
\end{column}
\end{columns}
\par Witness`, 11, "Madrid", "43"),
    baselines: [["Left.", 61.953293], ["Right.", 74.873703], ["Witness", 85.186295]],
  },
  {
    name: "keeps a list's closing skip across empty groups and hidden overlay branches before columns",
    source: slide(String.raw`Lead.\par
\begin{exampleblock}{T}
\begin{description}
\item[S1] Text.
\end{description}
\par
\only<2->{Hidden.}
\par
\begin{columns}[onlytextwidth,b]
\begin{column}{0.62\textwidth}
Left.
\end{column}
\begin{column}{0.34\textwidth}
Right.
\end{column}
\end{columns}
\end{exampleblock}
\par Witness`, 11, "Madrid", "43"),
    baselines: [["Left.", 98.285812], ["Witness", 120.488693]],
  },
  {
    name: "closes a list before a columns box that follows it inside a centered environment",
    source: slide(String.raw`Lead.\par
\begin{center}
Text one.\par
\begin{enumerate}
\item Before after.
\end{enumerate}
\par
\begin{columns}[onlytextwidth,t]
\begin{column}{0.62\textwidth}
Left.
\end{column}
\end{columns}
\end{center}
\par Witness`, 11, "Madrid", "43"),
    baselines: [["Left.", 102.044464], ["Witness", 123.515152]],
  },
  {
    name: "keeps the interline glue after a list item whose label line is an empty trivlist, when the list opens a block",
    source: slide(String.raw`Lead.\par
\begin{block}{T}
\begin{itemize}
\item \begin{flushleft}
\end{flushleft}
Alpha.
\end{itemize}
\end{block}
\par Witness`, 11, "Madrid", "43"),
    baselines: [["Alpha.", 93.073288], ["Witness", 115.151321]],
  },
  {
    name: "omits the opening topsep of a list that starts a column inside a centered environment",
    source: slide(String.raw`Lead.\par
\begin{center}
\begin{columns}[onlytextwidth,t]
\begin{column}{0.54\textwidth}
\begin{itemize}
\item Alpha.
\end{itemize}
\end{column}
\begin{column}{0.42\textwidth}
Right.
\end{column}
\end{columns}
\end{center}
\par Witness`, 11, "Madrid", "43"),
    baselines: [["Right.", 70.503525], ["Alpha.", 83.42395], ["Witness", 102.161957]],
  },
  {
    name: "does not clamp the baseline glue before a display paragraph that follows a block in a column",
    source: slide(String.raw`Lead.\par
\begin{columns}[onlytextwidth,t]
\begin{column}{0.5\textwidth}
\begin{block}{Iter}
Block text.
\end{block}
\[E=x\]
\end{column}
\begin{column}{0.4\textwidth}
Right.
\end{column}
\end{columns}
\par Witness`, 11, "Madrid", "43"),
    baselines: [["Right.", 61.953171], ["E=x", 128.244141], ["Witness", 136.413742]],
  },
  {
    name: "keeps the enclosing parsep after a nested list that took a label pending past a block",
    source: slide(String.raw`Lead.\par
{\small
\begin{enumerate}
\item \begin{block}{GU}
\end{block}
\begin{itemize}
\item B
\end{itemize}
Cee
\end{enumerate}\par}
\par Witness`, 11, "default", "43"),
    baselines: [["Cee", 104.199], ["Witness", 122.819]],
  },
  {
    name: "drops the ending depth of a block whose flow ends with a display after columns",
    source: slide(String.raw`Lead.\par
\begin{alertblock}{M}
\begin{columns}[onlytextwidth,c]
\begin{column}{0.38\textwidth}
Left
\end{column}
\end{columns}
\[\begin{pmatrix}a&b\\c&d\end{pmatrix}\]
\end{alertblock}
\par Witness`, 11, "default", "43"),
    baselines: [["cd", 108.668259], ["Witness", 134.490112]],
  },
  {
    name: "shares a picture center's closing topsep with a grouped center that follows",
    source: slide(String.raw`Lead.\par
\begin{center}
\begin{tikzpicture}[font=\scriptsize]\node[draw] {P};\end{tikzpicture}
\end{center}
\par
{\begin{center}
Body text.
\end{center}}
\par Witness`, 11, "default", "43"),
    baselines: [["Bodytext.", 84.438263], ["Witness", 105.908951]],
  },
  {
    name: "adds the outer parskip when a nested list takes a label left pending past a block",
    source: slide(String.raw`Lead.\par
{\small
\begin{itemize}
\item First.
\item
\begin{alertblock}{Inc}
Body.
\end{alertblock}
\par
\begin{enumerate}
\item Enum.
\end{enumerate}
\end{itemize}\par}
\par Witness`, 11, "default", "43"),
    baselines: [["1.Enum.", 104.198837], ["Witness", 122.819427]],
  },
  {
    name: "raises a list's closing skip by its parskip after an alignment's closing topsep",
    source: slide(String.raw`Lead.\par
{\small
\begin{itemize}
\item First.
\item \begin{flushright}
Text
\par
\begin{center}
Cent.
\end{center}
\end{flushright}
\end{itemize}\par}
\par Witness`, 11, "default", "43"),
    baselines: [["Cent.", 87.573364], ["Witness", 106.193954]],
  },
  {
    name: "keeps the parskip after a label-line nested list apart from a following center's topsep",
    source: slide(String.raw`Lead.\par
{\small
\begin{itemize}
\item First.
\item
\begin{enumerate}
\item Enum.
\end{enumerate}
\par
\begin{center}
Cent.
\end{center}
\end{itemize}\par}
\par Witness`, 11, "default", "43"),
    baselines: [["Cent.", 87.573364], ["Witness", 106.193954]],
  },
  {
    name: "falls back to lineskip before a display that follows a deep block in a column",
    source: slide(String.raw`Lead.\par
\begin{columns}[onlytextwidth,t]
\begin{column}{0.46\textwidth}Left\end{column}
\begin{column}{0.50\textwidth}
\begin{block}{Iter}
\begin{tabular}{lrr}Method&Cost&Error\\\hline
Fresh0&13&10\\
Fresh1&23&13\\
Global2&8&2\\
\end{tabular}
\end{block}
\[E=\sum_{i=1}^{n}w_i x_i\]
\end{column}
\end{columns}
\par Witness`, 9, "default", "43"),
    baselines: [["E=wx", 123.583801], ["Witness", 141.40451]],
  },
  {
    name: "unskips a terminal display skip after columns in a rounded block",
    source: slide(String.raw`Lead.\par
\begin{alertblock}{Message passing}
\begin{columns}[onlytextwidth,c]
\begin{column}{0.38\textwidth}Left\end{column}
\begin{column}{0.58\textwidth}Right\end{column}
\end{columns}
\par
\[\begin{pmatrix}a&b\\c&d\end{pmatrix}\]
\end{alertblock}
\par Witness`, 9, "Madrid", "43"),
    baselines: [["cd", 102.898178], ["Witness", 123.56134]],
  },
  {
    name: "keeps a list's closing skip apart from a flushleft columns box after a vertical-mode color",
    source: slide(String.raw`Lead.\par
{\scriptsize
\begin{itemize}
\item A
\end{itemize}
{\color{blue}
\begin{flushleft}
\begin{columns}[onlytextwidth,t]
\begin{column}{0.54\textwidth}
Inner
\end{column}
\end{columns}
\end{flushleft}\par}\par}
\par Witness`, 10, "Madrid", "169"),
    baselines: [["Inner", 75.776199], ["Witness", 102.377045]],
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

  it("centers a minipage holding a list on the math axis below the preceding line", async () => {
    // A minipage is a vertical list of its own (minipage mode, the frame's \@listi). Its line is a
    // \vcenter on the math axis (32.99738+27.5224) set \lineskip below "Lead text." (depth 0.12045).
    // LuaLaTeX baselines: Inside 50.896469, A 70.496475, B 87.096481, After list 103.696487, Witness 112.41625.
    const source = String.raw`\documentclass{beamer}
\setbeamertemplate{navigation symbols}{}
\begin{document}
\begin{frame}[t]{Mini}
Lead text.\par
\begin{minipage}{4cm}
Inside.\par\smallskip
\begin{itemize}\item A\item B\end{itemize}
After list.
\end{minipage}\par
Witness.
\end{frame}
\end{document}`;
    const trace = buildNativeBeamerPageTrace(await renderBeamerFrame(source), computerModernTexMetricProvider);
    const baseline = (text: string) => trace.lines.find(line => line.text === text)?.baselineY ?? NaN;
    expect(baseline("Inside.")).toBeCloseTo(50.896469, 3);
    expect(baseline("A")).toBeCloseTo(70.496475, 3);
    expect(baseline("B")).toBeCloseTo(87.096481, 3);
    expect(baseline("Afterlist.")).toBeCloseTo(103.696487, 3);
    expect(baseline("Witness.")).toBeCloseTo(112.41625, 3);
  });

  it("lets a list inside a block end an enclosing trivlist's pending label", async () => {
    // The flushleft's \item label is still pending when the block starts; the inner list's
    // \endtrivlist clears @inlabel globally, so \endtrivlist of the flushleft ships no empty line and
    // its \addvspace merges with the block's closing skip. LuaLaTeX baselines.
    const source = String.raw`\documentclass[10pt]{beamer}
\usetheme{Boadilla}
\setbeamertemplate{navigation symbols}{}
\begin{document}
\begin{frame}[t]{Labels}
Lead.\par
\begin{flushleft}
\begin{exampleblock}{Title}
\begin{itemize}\item Inner.\end{itemize}
\end{exampleblock}
\end{flushleft}
Witness.
\end{frame}
\end{document}`;
    const trace = buildNativeBeamerPageTrace(await renderBeamerFrame(source), computerModernTexMetricProvider);
    const baseline = (text: string) => trace.lines.find(line => line.text === text)?.baselineY ?? NaN;
    expect(baseline("Inner.")).toBeCloseTo(82.732224, 3);
    expect(baseline("Witness.")).toBeCloseTo(107.357224, 3);
  });

  it("passes a pending trivlist label into a default block's first list", async () => {
    // The flushleft's label is pending when the block starts (its template resets \\everypar), so the
    // block body's itemize is a no-par list: no topsep, and no \\addvspace at its end. LuaLaTeX baselines.
    const source = String.raw`\documentclass{beamer}
\setbeamertemplate{navigation symbols}{}
\begin{document}
\begin{frame}[t]{Labels}
Lead.\par
\begin{flushleft}
\begin{exampleblock}{Title}
\begin{itemize}\item Inner.\end{itemize}
\end{exampleblock}
\end{flushleft}
Witness.
\end{frame}
\end{document}`;
    const trace = buildNativeBeamerPageTrace(await renderBeamerFrame(source), computerModernTexMetricProvider);
    const baseline = (text: string) => trace.lines.find(line => line.text === text)?.baselineY ?? NaN;
    expect(baseline("Inner.")).toBeCloseTo(84.376724, 3);
    expect(baseline("Witness.")).toBeCloseTo(106.97673, 3);
  });

  it("shows a label that the next covered item ships", async () => {
    // The block leaves the description label pending (its template resets \\everypar); \\item<2->'s \\@item
    // ships it as an empty line before Beamer covers that item, so it is visible on slide 1. LuaLaTeX baselines.
    const source = String.raw`\documentclass{beamer}
\setbeamertemplate{navigation symbols}{}
\begin{document}
\begin{frame}[t]{Labels}
Lead.\par
\begin{description}
\item<1->[Stage 1] \begin{alertblock}{Geometric}
Body.
\end{alertblock}
\item<2->[Stage 2] Second.
\end{description}
Witness.
\end{frame}
\end{document}`;
    const trace = buildNativeBeamerPageTrace(await renderBeamerFrame(source, { step: 1 }), computerModernTexMetricProvider);
    const baseline = (text: string) => trace.lines.find(line => line.text === text)?.baselineY ?? NaN;
    expect(baseline("Stage1")).toBeCloseTo(94.97673, 3);
    expect(baseline("Witness.")).toBeCloseTo(128.176743, 3);
  });

  it("breaks a label-only line on a negative measure", async () => {
    // The description's left margin is wider than the column: the label line (label box, \\penalty0) breaks
    // at the penalty in TeX's final pass, leaving an empty second line. LuaLaTeX baselines.
    const source = String.raw`\documentclass{beamer}
\setbeamertemplate{navigation symbols}{}
\begin{document}
\begin{frame}[t]{Labels}
Lead.\par
\begin{columns}[onlytextwidth,c]
\begin{column}{0.13\textwidth}
\begin{description}
\item[Stage 1] \begin{alertblock}{Geo}
Body.
\end{alertblock}
\item[Stage 2] Second.
\end{description}
\end{column}
\begin{column}{0.58\textwidth}Right.\end{column}
\end{columns}
Witness.
\end{frame}
\end{document}`;
    const trace = buildNativeBeamerPageTrace(await renderBeamerFrame(source), computerModernTexMetricProvider);
    const baseline = (text: string) => trace.lines.find(line => line.text === text)?.baselineY ?? NaN;
    expect(baseline("Stage1")).toBeCloseTo(96.097183, 3);
    expect(baseline("Stage2")).toBeCloseTo(126.297195, 3);
    expect(baseline("Witness.")).toBeCloseTo(162.216965, 3);
  });

  it("keeps the ambient list registers when a nested minipage leaves the list depth at zero", async () => {
    // The inner rounded block (a minipage) resets the shared \\@mplistdepth; the outer \\endlist then leaves it
    // at -1, so the description runs at depth 0, where no \\@list<n> exists: it keeps size9.clo's load-time
    // \\@listi registers (topsep 6pt, itemsep = parsep 4pt). LuaLaTeX baselines.
    const source = String.raw`\documentclass[9pt]{beamer}
\usetheme{Boadilla}
\setbeamertemplate{navigation symbols}{}
\begin{document}
\begin{frame}[t]{Depth}
Lead.\par
\begin{block}{Outer}
\begin{itemize}
\item \begin{exampleblock}{Inner}
\begin{itemize}
\item Deep.
\end{itemize}
\end{exampleblock}
\end{itemize}
\par
\begin{description}
\item[Stage 1] One.
\item[Stage 2] Two.
\end{description}
\end{block}
Witness.
\end{frame}
\end{document}`;
    const trace = buildNativeBeamerPageTrace(await renderBeamerFrame(source), computerModernTexMetricProvider);
    const baseline = (text: string) => trace.lines.find(line => line.text === text)?.baselineY ?? NaN;
    expect(baseline("Stage1One.")).toBeCloseTo(118.400803, 3);
    expect(baseline("Stage2Two.")).toBeCloseTo(137.3508, 3);
    expect(baseline("Witness.")).toBeCloseTo(157.6698, 3);
  });

  it("gives an alignment inside a block in a list the list's topsep", async () => {
    // The flushright reads the live \\topsep: inside the enumerate that is \\@listi's 3pt, not the class's
    // ambient 6pt (size9.clo). LuaLaTeX baselines.
    const source = String.raw`\documentclass[9pt]{beamer}
\setbeamertemplate{navigation symbols}{}
\begin{document}
\begin{frame}[t]{Topsep}
Lead.\par
\begin{enumerate}
\item First.
\par
\begin{alertblock}{Block}
\begin{flushright}
Right text.
\end{flushright}
\end{alertblock}
\end{enumerate}
Witness.
\end{frame}
\end{document}`;
    const trace = buildNativeBeamerPageTrace(await renderBeamerFrame(source), computerModernTexMetricProvider);
    const baseline = (text: string) => trace.lines.find(line => line.text === text)?.baselineY ?? NaN;
    expect(baseline("Righttext.")).toBeCloseTo(80.563797, 3);
    expect(baseline("Witness.")).toBeCloseTo(99.367798, 3);
  });

  it("uses LuaTeX's truncated pre-display gap to choose display skips", async () => {
    // \\predisplaysize = shift + (quad div 1000sp) * 2000: 61.4055pt + 17.97485pt at 9pt, just below the
    // aligned display's left edge (79.39168pt), so it takes \\abovedisplayshortskip. LuaLaTeX baselines.
    const source = String.raw`\documentclass[9pt]{beamer}
\setbeamertemplate{navigation symbols}{}
\begin{document}
\begin{frame}[t,shrink=5]{Displays}
Lead.\par
\begin{columns}[onlytextwidth,T]
\begin{column}{0.54\textwidth}Left.\end{column}
\begin{column}{0.42\textwidth}
\begin{description}
\item[Stage 2] \begin{itemize}
\item A local update.
\item \[\begin{pmatrix}a&b\\c&d\end{pmatrix}\]
\end{itemize}
\par
\[\begin{aligned}a+b&=c\\ d-e&=f\end{aligned}\]
\end{description}
\end{column}
\end{columns}
Witness.
\end{frame}
\end{document}`;
    const trace = buildNativeBeamerPageTrace(await renderBeamerFrame(source), computerModernTexMetricProvider);
    const baseline = (text: string) => trace.lines.find(line => line.text === text)?.baselineY ?? NaN;
    expect(baseline("a+b=c")).toBeCloseTo(118.765228, 3);
    expect(baseline("Witness.")).toBeCloseTo(142.022934, 3);
  });

  it("follows an overfull label's empty line with the short display skips", async () => {
    // The description's margin exceeds the narrow column: the label line breaks at its \\penalty0, leaving an
    // empty line before the display even when only declarations ({\\scriptsize\\centering) precede it. That
    // line has no visible node, so the display takes the short skips despite \\centering. LuaLaTeX baselines.
    const source = String.raw`\documentclass[12pt]{beamer}
\setbeamertemplate{navigation symbols}{}
\begin{document}
\begin{frame}[t]{Displays}
Lead.\par
\begin{columns}[onlytextwidth,t]
\begin{column}{0.54\textwidth}Left.\end{column}
\begin{column}{0.42\textwidth}
\begin{columns}[onlytextwidth,b]
\begin{column}{0.62\textwidth}
Tab.
\end{column}
\begin{column}{0.34\textwidth}
\begin{description}
\item[Stage 1] {\scriptsize\centering
\[\begin{pmatrix}a&b\\c&d\end{pmatrix}\begin{pmatrix}x\\y\end{pmatrix}\]\par}
\item[Stage 2] Before after.
\end{description}
\end{column}
\end{columns}
\end{column}
\end{columns}
Witness.
\end{frame}
\end{document}`;
    const trace = buildNativeBeamerPageTrace(await renderBeamerFrame(source), computerModernTexMetricProvider);
    const baseline = (text: string) => trace.lines.find(line => line.text === text)?.baselineY ?? NaN;
    expect(baseline("abx")).toBeCloseTo(91.681152, 3);
    // The overfull label line cannot stretch its \\leftskip: the label stays at the list margin.
    expect(trace.lines.find(line => line.text === "Stage1")?.x).toBeCloseTo(311.471771, 2);
    expect(baseline("Stage2")).toBeCloseTo(120.211273, 3);
    expect(baseline("Witness.")).toBeCloseTo(187.659271, 3);
  });

  it("keeps a column's closing glue when a color whatsit ends the column", async () => {
    // {\\color{blue}\\par} after the itemize appends a whatsit in vertical mode: \\endminipage's \\unskip finds no
    // glue, so the [b] column keeps \\endlist's skip and has zero depth. LuaLaTeX baselines.
    const source = String.raw`\documentclass{beamer}
\setbeamertemplate{navigation symbols}{}
\begin{document}
\begin{frame}[t]{Whatsit}
Lead.\par
\begin{columns}[onlytextwidth,b]
\begin{column}{0.4\textwidth}
Left one.\par Left two.
\end{column}
\begin{column}{0.5\textwidth}
\begin{itemize}
\item Right item.
\end{itemize}
\par
{\color{blue}\par}
\end{column}
\end{columns}
Witness.
\end{frame}
\end{document}`;
    const trace = buildNativeBeamerPageTrace(await renderBeamerFrame(source), computerModernTexMetricProvider);
    const baseline = (text: string) => trace.lines.find(line => line.text === text)?.baselineY ?? NaN;
    expect(baseline("Leftone.")).toBeCloseTo(51.552872, 3);
    expect(baseline("Rightitem.")).toBeCloseTo(59.897171, 3);
    expect(baseline("Witness.")).toBeCloseTo(78.752884, 3);
  });

  it("reads a nested list's registers from its body font, not the ambient size", async () => {
    // Beamer selects the subbody font (\small) before \list, which redefines \@listi: the inner
    // list's \itemsep and \parsep are \small's (4.5pt at 12pt), not \footnotesize's. LuaLaTeX baselines.
    const source = String.raw`\documentclass[12pt]{beamer}
\usetheme{Boadilla}
\setbeamertemplate{navigation symbols}{}
\begin{document}
\begin{frame}[t]{Registers}
Lead.\par
\begin{enumerate}
\item {\footnotesize
\begin{alertblock}{Title}
\begin{enumerate}\item One.\item Two.\end{enumerate}
\end{alertblock}\par}
\item Third.
\end{enumerate}
Witness.
\end{frame}
\end{document}`;
    const trace = buildNativeBeamerPageTrace(await renderBeamerFrame(source), computerModernTexMetricProvider);
    const baseline = (text: string) => trace.lines.find(line => line.text === text)?.baselineY ?? NaN;
    expect(baseline("One.")).toBeCloseTo(87.35083, 3);
    expect(baseline("Two.")).toBeCloseTo(109.950836, 3);
    expect(baseline("Third.")).toBeCloseTo(132.086288, 3);
    expect(baseline("Witness.")).toBeCloseTo(149.586288, 3);
  });

  it("keeps a column's block skip apart from a following alignment's after a color change", async () => {
    // \\color's whatsit follows the block's closing skip, so \\addvspace sees no \\lastskip and adds the
    // center's topsep in full; the block is the column's first material. LuaLaTeX baselines.
    const source = String.raw`\documentclass[9pt]{beamer}
\usetheme{Madrid}
\setbeamertemplate{navigation symbols}{}
\begin{document}
\begin{frame}[t]{Colors}
Lead.\par
\begin{columns}[onlytextwidth,t]
\begin{column}{0.46\textwidth}Left.\end{column}
\begin{column}{0.50\textwidth}
\begin{alertblock}{Block}
Body text.
\end{alertblock}
\par
{\color{blue}
\begin{center}
Centered text.
\end{center}\par}
Witness.
\end{column}
\end{columns}
\end{frame}
\end{document}`;
    const trace = buildNativeBeamerPageTrace(await renderBeamerFrame(source), computerModernTexMetricProvider);
    const baseline = (text: string) => trace.lines.find(line => line.text === text)?.baselineY ?? NaN;
    expect(baseline("Centeredtext.")).toBeCloseTo(112.599701, 3);
    expect(baseline("Witness.")).toBeCloseTo(129.549698, 3);
  });

  it("lets only a T column's leading alignment replace its head skip", async () => {
    // A later no-par trivlist (flushright in a description item) does not change the leading center's
    // \\vskip-1ex replacement. LuaLaTeX baselines.
    const source = String.raw`\documentclass[12pt]{beamer}
\usetheme{Madrid}
\setbeamertemplate{navigation symbols}{}
\begin{document}
\begin{frame}[t]{Columns}
Lead.\par
\begin{columns}[onlytextwidth,T]
\begin{column}{0.38\textwidth}
\begin{center}
Centered.
\end{center}
\begin{description}
\item[Stage] \begin{flushright}
Flush right.
\end{flushright}
\end{description}
\end{column}
\begin{column}{0.58\textwidth}
Right text.
\end{column}
\end{columns}
Witness.
\end{frame}
\end{document}`;
    const trace = buildNativeBeamerPageTrace(await renderBeamerFrame(source), computerModernTexMetricProvider);
    const baseline = (text: string) => trace.lines.find(line => line.text === text)?.baselineY ?? NaN;
    expect(baseline("Centered.")).toBeCloseTo(86.926987, 3);
    expect(baseline("StageFlushright.")).toBeCloseTo(114.426987, 3);
    expect(baseline("Witness.")).toBeCloseTo(126.214996, 3);
  });

  it("shares the block and alignment skips before a color change inside the alignment", async () => {
    const source = slide(String.raw`Lead.\par
\begin{columns}[onlytextwidth,t]
\begin{column}{0.38\textwidth}
\begin{block}{Incremental analysis}
\begin{tabular}{lr}Method&Cost\\\hline
Fresh&15\\
Cached&16\\
\end{tabular}
\end{block}
\par
\begin{flushright}{\small\color{teal}
\begin{columns}[onlytextwidth,t]
\begin{column}{0.62\textwidth}First nested cell.\end{column}
\begin{column}{0.34\textwidth}
\begin{tabular}{lr}Cost&Value\\\hline
Fresh&14\\
Global&12\\
\end{tabular}
\end{column}
\end{columns}\par}\end{flushright}
\end{column}
\begin{column}{0.58\textwidth}Outer witness.\end{column}
\end{columns}
\par Following text.`, 9, "Madrid", "169").replace("[t,shrink=5]", "[t]");
    const rendered = await renderBeamerFrame(source);
    expect(rendered.diagnostics).toEqual([]);
    const trace = buildNativeBeamerPageTrace(rendered, computerModernTexMetricProvider);
    expect(trace.lines.find(line => line.text === "Firstnestedcell.")?.baselineY).toBeCloseTo(141.05864, 2);
    expect(trace.lines.find(line => line.text === "Followingtext.")?.baselineY).toBeCloseTo(161.004639, 2);
  });

  it("centers an extracted picture inside a ragged-left group", async () => {
    const rendered = await renderBeamerFrame(slide(String.raw`Lead text.\par
{\footnotesize\color{blue}\raggedleft
\begin{columns}[onlytextwidth,t]
\begin{column}{.46\textwidth}Left.\end{column}
\begin{column}{.50\textwidth}Right.\end{column}
\end{columns}
\par
\begin{center}
\begin{tikzpicture}[font=\scriptsize]\node[draw] {Centered};\end{tikzpicture}
\end{center}\par}
\par Witness`, 12));
    expect(rendered.diagnostics).toEqual([]);
    const trace = buildNativeBeamerPageTrace(rendered, computerModernTexMetricProvider);
    expect(trace.lines.find(line => line.text === "Centered")?.x).toBeCloseTo(167.270462, 2);
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
