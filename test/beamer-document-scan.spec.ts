import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { scanBeamerDocument } from "../packages/core/src/index.js";

describe("Beamer document scanner", () => {
  it("builds a source-backed inventory for the KKT fixture", () => {
    const source = readFileSync(
      join(process.cwd(), "test/fixtures/beamer/kkt_theorem_beamer.tex"),
      "utf8"
    );

    const document = scanBeamerDocument(source);

    expect(document.source).toBe(source);
    expect(document.diagnostics).toEqual([]);
    expect(document.preamble.documentClass?.className.value).toBe("beamer");
    expect(document.preamble.documentClass?.options?.value).toBe(
      "aspectratio=169"
    );
    expect(document.preamble.themes.map((theme) => [theme.kind, theme.name.value]))
      .toEqual([
        ["theme", "Madrid"],
        ["color-theme", "seahorse"],
      ]);
    expect(document.preamble.metadata.title?.value.value).toBe(
      "The Karush-Kuhn-Tucker Theorem"
    );
    expect(document.frames).toHaveLength(20);
    expect(document.sections).toEqual([]);
    expect(document.roots).toHaveLength(20);

    const first = document.frames[0];
    expect(first?.id).toBe("frame:0");
    expect(first?.title).toBeUndefined();
    expect(first?.children).toHaveLength(1);
    expect(
      source.slice(first?.children[0]?.span.from, first?.children[0]?.span.to)
    ).toMatch(/^\\begin\{tikzpicture\}[\s\S]*\\end\{tikzpicture\}$/u);

    const representative = document.frames[1];
    expect(representative?.title?.value).toBe("Why KKT conditions matter");
    expect(representative?.options).toBeUndefined();
    expect(representative?.children).toHaveLength(1);
    expect(source.slice(representative?.span.from, representative?.span.to))
      .toMatch(/^\\begin\{frame\}\{Why KKT conditions matter\}/u);
    expect(
      source.slice(
        representative?.bodySpan.from,
        representative?.bodySpan.to
      )
    ).toContain(String.raw`\begin{columns}[T,totalwidth=\textwidth]`);
  });

  it("tracks sections, frame headers, body titles, options, and nested figures", () => {
    const source = String.raw`\documentclass[aspectratio=43]{beamer}
\AtBeginSection[]{%
  \begin{frame}{Derived section page}
    \tableofcontents[currentsection]
  \end{frame}
}
\usetheme[progressbar=frametitle]{metropolis}
\title[Short]{Long title}
\begin{document}
% \section{Commented out}
\section[Intro]{Introduction}
\begin{frame}<2->[t,fragile=singleslide,label=motivation]{Header title}{Header subtitle}
  \begin{tikzpicture}
    \node {demo};
  \end{tikzpicture}
\end{frame}
\subsection*{Details}
\begin{frame}[plain]
  \frametitle<1->[Short body]{Body title}
  \framesubtitle{Body subtitle}
\end{frame}
\end{document}`;

    const document = scanBeamerDocument(source);

    expect(document.frames).toHaveLength(2);
    expect(document.sections).toHaveLength(2);
    expect(document.preamble.atBeginSectionSpans).toHaveLength(1);
    const atBeginSectionSpan = document.preamble.atBeginSectionSpans[0];
    expect(
      source.slice(atBeginSectionSpan?.from, atBeginSectionSpan?.to)
    ).toContain(String.raw`\begin{frame}{Derived section page}`);
    expect(document.preamble.metadata.title?.shortValue?.value).toBe("Short");
    expect(document.preamble.metadata.title?.value.value).toBe("Long title");
    expect(document.preamble.themes[0]?.options?.value).toBe(
      "progressbar=frametitle"
    );

    const [section, subsection] = document.sections;
    expect(section).toMatchObject({
      id: "section:0",
      level: 1,
      starred: false,
      parentSectionId: null,
    });
    expect(section?.shortTitle?.value).toBe("Intro");
    expect(section?.title.value).toBe("Introduction");
    expect(subsection).toMatchObject({
      id: "section:1",
      level: 2,
      starred: true,
      parentSectionId: "section:0",
    });

    const [first, second] = document.frames;
    expect(first).toMatchObject({
      id: "frame:0",
      sectionId: "section:0",
      subsectionId: null,
    });
    expect(first?.overlay?.value).toBe("2-");
    expect(first?.options).toMatchObject({
      alignment: "top",
      fragile: true,
      plain: false,
      label: "motivation",
    });
    expect(first?.title?.value).toBe("Header title");
    expect(first?.subtitle?.value).toBe("Header subtitle");
    expect(first?.children).toHaveLength(1);

    expect(second).toMatchObject({
      id: "frame:1",
      sectionId: "section:0",
      subsectionId: "section:1",
    });
    expect(second?.options).toMatchObject({
      alignment: "center",
      fragile: false,
      plain: true,
    });
    expect(second?.title?.value).toBe("Body title");
    expect(second?.subtitle?.value).toBe("Body subtitle");
    expect(document.roots.map((root) => root.id)).toEqual([
      "section:0",
      "frame:0",
      "section:1",
      "frame:1",
    ]);
    expect(document.roots.map((root) => root.sourceOrder)).toEqual([0, 1, 2, 3]);
  });

  it("ignores commented and verbatim frame delimiters", () => {
    const source = String.raw`\documentclass{beamer}
\begin{document}
% \begin{frame}{Comment}
% \end{frame}
\begin{frame}[fragile]{Real}
\begin{verbatim}
\end{frame}
\begin{frame}{not structural}
\end{verbatim}
\end{frame}
\end{document}`;

    const document = scanBeamerDocument(source);

    expect(document.frames).toHaveLength(1);
    expect(document.frames[0]?.title?.value).toBe("Real");
    expect(document.diagnostics).toEqual([]);
  });

  it("keeps an incomplete frame in the inventory and reports structural errors", () => {
    const source = String.raw`\documentclass{beamer}
\begin{document}
\end{frame}
\begin{frame}{Draft}
  unfinished`;

    const document = scanBeamerDocument(source);

    expect(document.frames).toHaveLength(1);
    expect(document.frames[0]?.title?.value).toBe("Draft");
    expect(document.frames[0]?.endSpan).toBeNull();
    expect(document.frames[0]?.span.to).toBe(source.length);
    expect(document.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "beamer-unterminated-document",
      "beamer-unmatched-frame-end",
      "beamer-unterminated-frame",
    ]);
  });
});
