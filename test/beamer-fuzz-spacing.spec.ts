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
