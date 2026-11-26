import { describe, expect, it } from "vitest";

import { prepareBeamerDocument } from "../packages/core/src/beamer/index.js";
import { createBeamerProjectFiles } from "../packages/core/src/beamer/project-files.js";

// Probes mirror Gemini's templates in stock fonts. Expected values are the
// LuaLaTeX trace of the same sources (artifacts/beamerposter-probes/interpreter).
const HEADLINE_POSTER = String.raw`\documentclass[final]{beamer}
\usepackage[size=custom,width=60,height=40,scale=1.0]{beamerposter}
\setbeamercolor{headline}{fg=white,bg=blue!50!black}
\setbeamercolor{headline rule}{bg=red}
\setbeamerfont{headline title}{size=\Huge,series=\bfseries}
\setbeamerfont{headline author}{size=\Large}
\setbeamertemplate{headline}
{
  \begin{beamercolorbox}{headline}
    \begin{columns}
      \begin{column}{\paperwidth}
        \usebeamerfont{headline}
        \vskip3ex
        \centering
        \ifx \inserttitle \empty \else
        {\usebeamerfont{headline title}\usebeamercolor[fg]{headline title}\inserttitle\\[0.5ex]}
        \fi
        \ifx \beamer@shortauthor \empty \else
        {\usebeamerfont{headline author}\usebeamercolor[fg]{headline author}\insertauthor\\[1ex]}
        \fi
      \end{column}
    \end{columns}
    \vspace{5ex}
    \ifbeamercolorempty[bg]{headline rule}{}{
      \begin{beamercolorbox}[wd=\paperwidth,colsep=0.5ex]{headline rule}\end{beamercolorbox}
    }
  \end{beamercolorbox}
}
\setbeamertemplate{footline}{
  \begin{beamercolorbox}[vmode]{headline}
    \ifbeamercolorempty[bg]{headline rule}{}{
      \begin{beamercolorbox}[wd=\paperwidth,colsep=0.25ex]{headline rule}\end{beamercolorbox}
    }
    \vspace{1.5ex}
    \hspace{2cm}
    \centering
    left \hfill right
    \hspace{2cm}
    \vspace{1.5ex}
  \end{beamercolorbox}
}
\title{A probe title: with more words}
\author{Ann Author \and Bob Builder}
\begin{document}
\begin{frame}[t]
Body text
\end{frame}
\end{document}
`;
const BLOCK_POSTER = String.raw`\documentclass[final]{beamer}
\usepackage{ragged2e}
\usepackage[size=custom,width=60,height=40,scale=1.0]{beamerposter}
\setbeamercolor{block title}{fg=blue,bg=white}
\setbeamercolor{block separator}{bg=black}
\setbeamercolor{block body}{fg=black,bg=white}
\setbeamerfont{block title}{size=\large,series=\bfseries}
\setbeamertemplate{block begin}
{
  \begin{beamercolorbox}[colsep*=0ex,dp=2ex,center]{block title}
    \vskip0pt
    \usebeamerfont{block title}\insertblocktitle
    \vskip-1.25ex
    \begin{beamercolorbox}[colsep=0.025ex]{block separator}\end{beamercolorbox}
  \end{beamercolorbox}
  {\parskip0pt\par}
  \usebeamerfont{block body}
  \vskip-0.5ex
  \begin{beamercolorbox}[colsep*=0ex]{block body}
  \justifying
  \setlength{\parskip}{1ex}
  \vskip-2ex
}
\setbeamertemplate{block end}
{
  \end{beamercolorbox}
  \vskip0pt
  \vspace*{2ex}
}
\begin{document}
\begin{frame}[t]
\begin{block}{First title}
One short body paragraph for the probe.
\end{block}
\begin{block}{Second}
A body with enough words to wrap over more than one line so that the extent matters for the next block below it and the justification shows.
\end{block}
\end{frame}
\end{document}
`;

async function layoutOf(source: string, projectFiles?: ReturnType<typeof createBeamerProjectFiles>) {
  const prepared = prepareBeamerDocument(source, projectFiles ? { projectFiles } : {});
  const rendered = await prepared.renderFrame({});
  const layout = rendered.layout;
  const backgrounds = layout.items.filter(item => item.kind === "background").map(item => item.bounds);
  const lines = layout.paragraphs.map(paragraph => {
    const line = paragraph.report.lines[0];
    const placement = paragraph.vlistLayout.linePlacements.find(candidate => candidate.lineIndex === line.lineIndex);
    // Inserted metadata keeps its source span (what the canvas edits); the rest is the template's own text.
    const text = source.slice(paragraph.sourceSpan.from, paragraph.sourceSpan.to);
    return { id: paragraph.paragraphId, x: paragraph.bounds.x, baseline: paragraph.bounds.y + Number(placement?.y ?? 0) + Number(line.ascent), text };
  });
  return { backgrounds, lines, diagnostics: [...prepared.theme.diagnostics, ...rendered.diagnostics], theme: prepared.theme };
}

describe("template interpreter: headline and footline", () => {
  it("lays out a Gemini-style headline and footline as LuaLaTeX does", async () => {
    const { backgrounds, lines } = await layoutOf(HEADLINE_POSTER);
    const headline = backgrounds.find(bounds => bounds.y === 0 && bounds.height > 100 && bounds.height < 300);
    expect(headline?.height).toBeCloseTo(186.418, 2);
    const rule = backgrounds.find(bounds => Math.abs(bounds.y - 181.09) < 0.01)!;
    expect(rule.height).toBeCloseTo(5.328, 2);
    const footline = backgrounds.find(bounds => Math.abs(bounds.y - 1103.002) < 0.01 && bounds.height > 10)!;
    expect(footline.height).toBeCloseTo(35.108, 2);
    const byText = (prefix: string) => lines.find(line => line.text.startsWith(prefix))!;
    expect(byText("A probe title").baseline).toBeCloseTo(93.984, 2);
    expect(byText("Ann Author").baseline).toBeCloseTo(153.164, 2);
    // \\hfill spreads the footline's pieces over its width.
    const footerLeft = lines.find(line => line.id.includes("footline:3"))!;
    const footerRight = lines.find(line => line.id.includes("footline:4"))!;
    expect(footerLeft.baseline).toBeCloseTo(1127.658, 2);
    expect(footerRight.x).toBeCloseTo(1619.528, 2);
  });

  it("keeps the title editable through the template's insert", async () => {
    const { lines } = await layoutOf(HEADLINE_POSTER);
    expect(lines.find(line => line.text.startsWith("A probe title"))?.text).toBe("A probe title: with more words");
    expect(lines.find(line => line.text.startsWith("Ann Author"))?.text).toBe("Ann Author \\and Bob Builder");
    const title = lines.find(line => line.id.includes("headline:2"))!;
    expect(HEADLINE_POSTER.slice(HEADLINE_POSTER.indexOf("\\title{") + 7).startsWith(title.text)).toBe(true);
  });

  it("draws title, author and institute when a poster headline is outside the vocabulary", async () => {
    const broken = HEADLINE_POSTER.replace("\\vskip3ex", "\\vskip3ex\\mysteryrule");
    const { lines, diagnostics } = await layoutOf(broken);
    expect(lines.some(line => line.text.startsWith("A probe title"))).toBe(true);
    const diagnostic = diagnostics.find(item => item.code === "beamer-template-unsupported");
    expect(diagnostic?.message).toContain("\\mysteryrule");
    expect(diagnostic?.message).toContain("headline");
  });

  it("draws nothing for a headline that is empty by intent", async () => {
    const { backgrounds } = await layoutOf(HEADLINE_POSTER.replace(/\\setbeamertemplate\{headline\}\n\{[\s\S]*?\n\}\n\\setbeamertemplate\{footline\}/u, "\\setbeamertemplate{headline}{}\n\\setbeamertemplate{footline}"));
    expect(backgrounds.some(bounds => bounds.y === 0 && bounds.height > 100 && bounds.height < 300)).toBe(false);
  });

  it("falls back to the stock footline of the theme when a footline cannot be laid out", async () => {
    const broken = HEADLINE_POSTER.replace("left \\hfill right", "left \\mysterybox right");
    const { diagnostics } = await layoutOf(broken);
    expect(diagnostics.some(item => item.code === "beamer-template-unsupported" && item.message.includes("footline"))).toBe(true);
  });

  it("runs a headline from a local theme file, with its macros", async () => {
    const theme = String.raw`\newcommand{\mybar}[1]{\vskip2ex #1}
\setbeamertemplate{headline}{\begin{beamercolorbox}[wd=\paperwidth]{headline}\mybar{\inserttitle}\end{beamercolorbox}}`;
    const source = String.raw`\documentclass{beamer}
\usepackage[size=custom,width=60,height=40,scale=1.0]{beamerposter}
\setbeamercolor{headline}{fg=white,bg=blue}
\usetheme{mine}
\title{Local theme title}
\begin{document}\begin{frame}x\end{frame}\end{document}`;
    const files = createBeamerProjectFiles(new Map([["beamerthememine.sty", theme]]), "k");
    const { lines, backgrounds, diagnostics } = await layoutOf(source, files);
    expect(lines.some(line => line.text.startsWith("Local theme title"))).toBe(true);
    expect(backgrounds.some(bounds => bounds.y === 0 && bounds.height > 20 && bounds.height < 300)).toBe(true);
    expect(diagnostics.some(item => item.code === "beamer-template-unsupported")).toBe(false);
  });
});

describe("template interpreter: blocks", () => {
  it("splices block begin, the body and block end, as LuaLaTeX lays them out", async () => {
    const { backgrounds, lines } = await layoutOf(BLOCK_POSTER);
    const near = (y: number) => backgrounds.find(bounds => Math.abs(bounds.y - y) < 0.01)!;
    expect(near(6.69).height).toBeCloseTo(78.352, 2);
    expect(near(62.912).height).toBeCloseTo(0.684, 2);
    expect(near(80.681).height).toBeCloseTo(24.352, 2);
    expect(near(127.479).height).toBeCloseTo(78.352, 2);
    expect(near(201.469).height).toBeCloseTo(24.352, 2);
    const byText = (prefix: string) => lines.find(line => line.text.startsWith(prefix))!;
    expect(byText("First title").baseline).toBeCloseTo(43.69, 2);
    expect(byText("One short").baseline).toBeCloseTo(99.957, 2);
    expect(byText("Second").baseline).toBeCloseTo(164.479, 2);
    expect(byText("A body with").baseline).toBeCloseTo(220.746, 2);
  });

  it("draws a stock block and keeps the body when a half is outside the vocabulary", async () => {
    const broken = BLOCK_POSTER.replace("\\vskip-1.25ex", "\\vskip-1.25ex\\mysterycut");
    const { lines, diagnostics } = await layoutOf(broken);
    expect(lines.some(line => line.text.startsWith("One short"))).toBe(true);
    expect(lines.some(line => line.text.startsWith("First title"))).toBe(true);
    expect(diagnostics.find(item => item.code === "beamer-template-unsupported")?.message).toContain("\\mysterycut");
  });

  it("needs both halves: a lone block begin is reported and the stock block drawn", async () => {
    const lone = BLOCK_POSTER.replace(/\\setbeamertemplate\{block end\}\n\{[\s\S]*?\n\}\n/u, "");
    const { lines, diagnostics } = await layoutOf(lone);
    expect(lines.some(line => line.text.startsWith("One short"))).toBe(true);
    expect(diagnostics.some(item => item.code === "beamer-template-block-pair")).toBe(true);
  });
});
