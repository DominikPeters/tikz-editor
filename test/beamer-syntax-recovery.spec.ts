import { describe, expect, it } from "vitest";

import { scanBeamerDocument } from "../packages/core/src/index.js";

const OPAQUE_ENVIRONMENTS = [
  "BVerbatim",
  "Verbatim",
  "alltt",
  "lstlisting",
  "minted",
  "semiverbatim",
  "verbatim",
  "verbatim*",
] as const;

describe("Beamer syntax recovery contract", () => {
  it.each(OPAQUE_ENVIRONMENTS)(
    "keeps structural-looking source opaque inside %s",
    (environment) => {
      const header = environment === "minted" ? "{tex}" : "";
      const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}[fragile]{Opaque ${environment}}
\begin{${environment}}${header}
{ unmatched literal brace
% literal percent \end{frame}
\begin{frame}{not structural}
\end{frame}
\end{${environment}}
\end{frame}
\begin{frame}{Later}
Visible
\end{frame}
\end{document}`;
      const document = scanBeamerDocument(source);

      expect(document.frames.map((frame) => frame.title?.value)).toEqual([
        `Opaque ${environment}`,
        "Later",
      ]);
      expect(document.diagnostics).toEqual([]);
      expectModelSpansInBounds(document, source.length);
    }
  );

  it("treats percent as content inside core verbatim termination lines", () => {
    const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}[fragile]{Verbatim percent}
\begin{verbatim}
literal % before \end{verbatim}
\end{frame}
\begin{frame}{Later}
Visible
\end{frame}
\end{document}`;
    const document = scanBeamerDocument(source);

    expect(document.frames.map((frame) => frame.title?.value)).toEqual([
      "Verbatim percent",
      "Later",
    ]);
    expect(document.diagnostics).toEqual([]);
  });

  it("masks an unterminated opaque body through the containing source limit", () => {
    const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}[fragile]{Draft}
\begin{verbatim}
\end{frame}
\begin{frame}{not structural}`;
    const document = scanBeamerDocument(source);

    expect(document.frames).toHaveLength(1);
    expect(document.frames[0]?.title?.value).toBe("Draft");
    expect(document.frames[0]?.endSpan).toBeNull();
    expect(document.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "beamer-unterminated-document",
      "beamer-unterminated-frame",
    ]);
    expectModelSpansInBounds(document, source.length);
  });

  it("discovers later frames after mismatched non-frame environments", () => {
    const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{block}
\end{exampleblock}
\begin{frame}{Recovered}
Visible
\end{frame}
\end{document}`;
    const document = scanBeamerDocument(source);

    expect(document.frames.map((frame) => frame.title?.value)).toEqual([
      "Recovered",
    ]);
    expect(document.diagnostics).toEqual([]);
    expectModelSpansInBounds(document, source.length);
  });

  it("retains a frame with an incomplete title argument", () => {
    const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}<2->[t]{Draft
unfinished`;
    const document = scanBeamerDocument(source);
    const frame = document.frames[0];

    expect(frame).toMatchObject({
      overlay: { value: "2-" },
      options: { alignment: "top" },
      title: undefined,
      endSpan: null,
    });
    expect(document.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "beamer-unterminated-document",
      "beamer-unterminated-frame",
    ]);
    expectModelSpansInBounds(document, source.length);
  });

  it("distinguishes escaped percent control symbols from comments", () => {
    const source = String.raw`\documentclass{beamer}
\begin{document}
\% not a comment \begin{frame}{Visible}
Body
\end{frame}
% \begin{frame}{Commented}
\end{document}`;
    const document = scanBeamerDocument(source);

    expect(document.frames.map((frame) => frame.title?.value)).toEqual([
      "Visible",
    ]);
    expect(document.diagnostics).toEqual([]);
  });
});

function expectModelSpansInBounds(
  document: ReturnType<typeof scanBeamerDocument>,
  sourceLength: number
): void {
  const spans = [
    ...(document.documentSpan ? [document.documentSpan] : []),
    document.documentBodySpan,
    document.preamble.span,
    ...document.sections.flatMap((section) => [
      section.span,
      section.commandSpan,
      section.title.span,
      section.title.contentSpan,
      ...(section.shortTitle
        ? [section.shortTitle.span, section.shortTitle.contentSpan]
        : []),
    ]),
    ...document.frames.flatMap((frame) => [
      frame.span,
      frame.beginSpan,
      frame.headerSpan,
      frame.bodySpan,
      ...(frame.endSpan ? [frame.endSpan] : []),
      ...(frame.title ? [frame.title.span, frame.title.contentSpan] : []),
      ...(frame.subtitle
        ? [frame.subtitle.span, frame.subtitle.contentSpan]
        : []),
    ]),
    ...document.diagnostics.map((diagnostic) => diagnostic.span),
  ];
  for (const span of spans) {
    expect(span.from).toBeGreaterThanOrEqual(0);
    expect(span.to).toBeGreaterThanOrEqual(span.from);
    expect(span.to).toBeLessThanOrEqual(sourceLength);
  }
}
