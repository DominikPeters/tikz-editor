import { describe, expect, it } from "vitest";

import {
  parseBeamerFrameBody,
  renderBeamerFrame,
  renderBeamerFramePages,
  resolveBeamerTheoremCounterSeed,
  scanBeamerDocument,
} from "../packages/core/src/beamer/index.js";
import type { BeamerTheoremBodyNode } from "../packages/core/src/beamer/content-types.js";
import { buildNativeBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";
import { computerModernTexMetricProvider } from
  "../packages/core/src/text/tex/index.js";

const SOURCE = String.raw`\documentclass[envcountsect]{beamer}
\setbeamertemplate{theorems}[numbered]
\newtheorem{proposition}[theorem]{Proposition}
\theoremstyle{definition}
\newtheorem*{remark}{Remark}
\begin{document}
\section{One}
\begin{frame}{Theorems}
\begin{theorem}[Named]First.\end{theorem}
\begin{proposition}Second.\end{proposition}
\begin{remark}Third.\end{remark}
\end{frame}
\end{document}`;

function theoremNodes(source: string): BeamerTheoremBodyNode[] {
  const document = scanBeamerDocument(source);
  return parseBeamerFrameBody({
    source,
    frame: document.frames[0]!,
    document,
  }).children.filter(
    (node): node is BeamerTheoremBodyNode => node.kind === "theorem"
  );
}

describe("Beamer theorem families", () => {
  it("collects built-in and custom declarations with ordered styles", () => {
    const document = scanBeamerDocument(SOURCE);
    const proposition = document.preamble.theoremDeclarations.find(
      (declaration) => declaration.name === "proposition"
    );
    const remark = document.preamble.theoremDeclarations.find(
      (declaration) => declaration.name === "remark"
    );

    expect(document.preamble.theoremTemplate).toBe("numbered");
    expect(proposition).toMatchObject({
      displayName: { value: "Proposition" },
      style: "plain",
      sharedCounter: "theorem",
      starred: false,
    });
    expect(remark).toMatchObject({
      displayName: { value: "Remark" },
      style: "definition",
      counter: null,
      starred: true,
    });
  });

  it("uses Beamer's compatibility aliases without scanning macro bodies as declarations", () => {
    const source = String.raw`\documentclass{beamer}
\newcommand{\latenttheorem}{\newtheorem{ghost}{Ghost}}
\begin{document}
\begin{frame}
\begin{Theorem}Alias theorem.\end{Theorem}
\begin{Proof}Alias proof.\end{Proof}
\end{frame}
\end{document}`;
    const document = scanBeamerDocument(source);
    const nodes = parseBeamerFrameBody({
      source,
      frame: document.frames[0]!,
      document,
    }).children.filter(
      (node): node is BeamerTheoremBodyNode => node.kind === "theorem"
    );

    expect(document.preamble.theoremDeclarations.some(
      (declaration) => declaration.name === "ghost"
    )).toBe(false);
    expect(nodes.map((node) => ({
      environment: node.environment,
      title: node.titleMapped.text,
      proof: node.proof,
    }))).toEqual([
      { environment: "Theorem", title: "Theorem", proof: false },
      { environment: "Proof", title: "Proof.", proof: true },
    ]);
  });

  it("lowers theorem uses with shared counters and mapped headings", () => {
    const nodes = theoremNodes(SOURCE);

    expect(nodes.map((node) => ({
      environment: node.environment,
      number: node.number,
      title: node.titleMapped.text,
      style: node.theoremStyle,
    }))).toEqual([
      {
        environment: "theorem",
        number: "1.1",
        title: "Theorem 1.1 (Named)",
        style: "plain",
      },
      {
        environment: "proposition",
        number: "1.2",
        title: "Proposition 1.2",
        style: "plain",
      },
      {
        environment: "remark",
        number: null,
        title: "Remark",
        style: "definition",
      },
    ]);

    const named = nodes[0]!;
    const mappedNamedOffset = named.titleMapped.text.indexOf("Named");
    const sourceNamedOffset = SOURCE.indexOf("Named");
    expect(
      named.titleMapped.sourceMap.charOrigins[mappedNamedOffset]
    ).toEqual({
      kind: "direct",
      from: sourceNamedOffset,
      to: sourceNamedOffset + 1,
    });
    expect(named.titleMapped.sourceMap.charOrigins[0]).toMatchObject({
      kind: "generated",
      owner: named.title.span,
    });
  });

  it("uses example blocks and keeps theorem overlays in page geometry", async () => {
    const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Overlay theorem}
\begin{columns}
\begin{column}{0.5\textwidth}
\begin{example}<2->Example body.\end{example}
\end{column}
\end{columns}
\end{frame}
\end{document}`;
    const result = await renderBeamerFramePages(source);
    const trace = (page: number) =>
      buildNativeBeamerPageTrace(
        result.pages[page]!,
        computerModernTexMetricProvider
      );
    const visibleBody = (page: number) =>
      trace(page).lines.some((line) => line.text.includes("Examplebody"));

    expect(result.stepCount).toBe(2);
    expect(result.pages[0]!.layout.contentBounds).toEqual(
      result.pages[1]!.layout.contentBounds
    );
    expect(visibleBody(0)).toBe(false);
    expect(
      trace(0).coveredLines?.some((line) => line.text.includes("Examplebody")) ??
        false
    ).toBe(true);
    expect(visibleBody(1)).toBe(true);
  });

  it("selects source-defined AMS heading faces and the normal-font body variant", async () => {
    const amsSource = String.raw`\documentclass{beamer}
\setbeamertemplate{theorems}[ams style]
\theoremstyle{remark}
\newtheorem{remark}[theorem]{Remark}
\begin{document}
\begin{frame}\begin{remark}Upright body.\end{remark}\end{frame}
\end{document}`;
    const ams = await renderBeamerFrame(amsSource);
    const amsTitle = ams.layout.paragraphs.find(
      (paragraph) => paragraph.paragraphId.endsWith(":title")
    );

    expect(amsTitle?.report.lines[0]?.segments.find(
      (segment) => segment.kind === "text"
    )).toMatchObject({
      fontId: "lmsans12-oblique",
      fontAtPt: 12,
    });

    const normalSource = String.raw`\documentclass{beamer}
\setbeamertemplate{theorems}[normal font]
\begin{document}
\begin{frame}\begin{theorem}Upright theorem body.\end{theorem}\end{frame}
\end{document}`;
    const normal = await renderBeamerFrame(normalSource);
    const normalBody = normal.layout.paragraphs.find(
      (paragraph) => paragraph.paragraphId.endsWith(":body")
    );

    expect(normalBody?.report.lines[0]?.segments.find(
      (segment) => segment.kind === "text"
    )).toMatchObject({
      fontId: "lmsans10-regular",
    });
  });

  it("provides isolated-frame oracle seeds for preceding theorem counters", () => {
    const source = String.raw`\documentclass{beamer}
\setbeamertemplate{theorems}[numbered]
\newtheorem{proposition}[theorem]{Proposition}
\begin{document}
\section{One}
\begin{frame}\begin{theorem}First.\end{theorem}\end{frame}
\begin{frame}\begin{proposition}Second.\end{proposition}\end{frame}
\end{document}`;
    const document = scanBeamerDocument(source);

    expect(resolveBeamerTheoremCounterSeed(
      document,
      document.frames[1]!.span.from
    )).toEqual([{ counter: "theorem", value: 1 }]);
  });
});
