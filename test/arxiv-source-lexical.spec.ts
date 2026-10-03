import { describe, expect, it } from "vitest";
import { extractArxivTikzCandidates } from "../packages/app/src/arxiv-source";
import type { ArxivSourcePayload } from "../packages/app/src/platform/types";
import { renderTikzToSvg } from "../packages/core/src/render";

const figure = String.raw`\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}`;
function paper(source: string): ArxivSourcePayload {
  return { id: "2605.06194", files: [{ path: "main.tex", source, size: source.length }] };
}

describe("arXiv importer lexical boundaries", () => {
  it("keeps the complete original figure when comments contain nested begin/end markers", () => {
    const source = String.raw`\begin{tikzpicture}
% \end{tikzpicture} and \begin{tikzpicture}
\draw (0,0) -- (1,1);
\end{tikzpicture}`;
    const candidates = extractArxivTikzCandidates(paper(source));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ source, contextualSource: source, lineStart: 1, lineEnd: 4 });
  });

  it("does not select fully commented figures or a commented opener", () => {
    const source = `% ${figure}\n% \\begin{tikzpicture}\n${figure}`;
    expect(extractArxivTikzCandidates(paper(source)).map((candidate) => candidate.source)).toEqual([figure]);
  });

  it("keeps escaped percent live while an escaped backslash before percent starts a comment", () => {
    const source = String.raw`\% ` + figure + "\n" + String.raw`\\% ` + figure;
    const candidates = extractArxivTikzCandidates(paper(source));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].source).toBe(figure);
    expect(candidates[0].contextualSource).toBe(String.raw`\% ` + figure);
  });

  it.each([
    String.raw`\\begin{tikzpicture} ignored \\end{tikzpicture}`,
    String.raw`\beginning{tikzpicture} ignored \ending{tikzpicture}`,
    String.raw`\begintikzpicture ignored \endtikzpicture`
  ])("does not mistake escaped controls or longer control words for delimiters: %s", (prefix) => {
    const source = `${prefix}\n${figure}`;
    const candidates = extractArxivTikzCandidates(paper(source));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ source: figure, contextualSource: source, lineStart: 2, lineEnd: 2 });
  });

  it.each(["verb", "verb*"])("ignores fake figures and comment characters in inline %s", (command) => {
    const prefix = `\\${command}|% ${figure}|`;
    const source = `${prefix}\n${figure}`;
    expect(extractArxivTikzCandidates(paper(source))).toMatchObject([
      { source: figure, contextualSource: source, lineStart: 2, lineEnd: 2 }
    ]);
  });

  it("limits an unfinished inline verb to its original line", () => {
    const source = String.raw`\verb|` + figure + `\r\n${figure}`;
    expect(extractArxivTikzCandidates(paper(source))).toMatchObject([{ source: figure, lineStart: 2, lineEnd: 2 }]);
  });

  it.each(["verbatim", "verbatim*"])("ignores delimiters inside %s environments", (environment) => {
    const prefix = `\\begin {${environment}}\n% ${figure}\n${figure}\n\\end{${environment}}\n`;
    const source = `${prefix}${figure}`;
    expect(extractArxivTikzCandidates(paper(source))).toMatchObject([
      { source: figure, contextualSource: source, lineStart: 5, lineEnd: 5 }
    ]);
  });

  it.each(["verbatim", "verbatim*"])("does not recover pictures from an unfinished %s environment", (environment) => {
    expect(extractArxivTikzCandidates(paper(`\\begin{${environment}}\n${figure}`))).toEqual([]);
  });

  it("keeps the real outer end when inline and environment verbatim contain false closing markers", () => {
    const source = String.raw`\begin{tikzpicture}
\verb|\end{tikzpicture}| \verb*|\begin{tikzpicture}|
\begin{verbatim}
\end{tikzpicture}
\begin{tikzpicture}
\end{verbatim}
\draw (0,0)--(1,0);
\end{tikzpicture}`;
    expect(extractArxivTikzCandidates(paper(source))).toMatchObject([
      { source, contextualSource: source, lineStart: 1, lineEnd: 8 }
    ]);
  });

  it.each(["\n", "\r", "\r\n"])("preserves contextual offsets and line metadata for EOL %j", (eol) => {
    const preamble = String.raw`\tikzset{retained/.style={red}}` + eol;
    const first = [String.raw`\begin{tikzpicture}`, "% fake \\end{tikzpicture}", String.raw`\draw (0,0)--(1,0);`, String.raw`\end{tikzpicture}`].join(eol);
    const between = eol + String.raw`\def\kept{still-here}` + eol;
    const second = [String.raw`\begin{tikzpicture}`, String.raw`\draw[retained] (0,0)--(2,0);`, String.raw`\end{tikzpicture}`].join(eol);
    const source = preamble + first + between + second + eol + "ignored suffix";
    const candidates = extractArxivTikzCandidates(paper(source));
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ source: first, lineStart: 2, lineEnd: 5, id: "main.tex:2:1" });
    expect(candidates[1]).toMatchObject({ source: second, lineStart: 7, lineEnd: 9, id: "main.tex:7:2" });
    const context = candidates[1].contextualSource;
    expect(context.length).toBe(source.indexOf(second) + second.length);
    expect(context.slice(0, preamble.length)).toBe(preamble);
    expect(context.slice(preamble.length, preamble.length + first.length)).toBe(first.replace(/[^\r\n]/gu, " "));
    expect(context.slice(preamble.length + first.length)).toBe(between + second);
    expect(context.match(/\r\n|\r|\n/gu)).toEqual(source.slice(0, context.length).match(/\r\n|\r|\n/gu));
  });

  it("retains whitespace-tolerant delimiters and the complete outer nested-picture span", () => {
    const outer = String.raw`\begin${" "}
{ tikzpicture }
\draw (0,0)--(1,1);
\begin{tikzpicture}\draw (0,0)--(2,0);\end { tikzpicture }
\end
{tikzpicture }`;
    const source = `prefix\n${outer}\n${figure}`;
    const candidates = extractArxivTikzCandidates(paper(source));
    expect(candidates.map((candidate) => candidate.source)).toEqual([outer, figure]);
    expect(candidates[0]).toMatchObject({ lineStart: 2, lineEnd: 7 });
    expect(candidates[1]).toMatchObject({ lineStart: 8, lineEnd: 8 });
  });

  it("preserves UTF-16 spans when blanking an earlier figure containing astral text", () => {
    const first = String.raw`\begin{tikzpicture}\node {😀};\end{tikzpicture}`;
    const source = `😀 preamble\r\n${first}\r\n${figure}`;
    const candidate = extractArxivTikzCandidates(paper(source))[1];
    const from = source.indexOf(figure);
    expect(candidate).toMatchObject({ source: figure, lineStart: 3, lineEnd: 3 });
    expect(candidate.contextualSource).toHaveLength(source.length);
    expect(candidate.contextualSource.slice(from)).toBe(figure);
    expect(candidate.contextualSource.slice(0, source.indexOf(first))).toBe("😀 preamble\r\n");
    expect(candidate.contextualSource.slice(source.indexOf(first), from)).toBe(" ".repeat(first.length) + "\r\n");
  });

  it("retains unmatched-delimiter behavior and does not broaden picture names or comment trivia", () => {
    const source = String.raw`\end{tikzpicture}
\begin{tikzpicture*}\end{tikzpicture*}
\begin% no importer delimiter here
{tikzpicture}\end{tikzpicture}
` + figure;
    expect(extractArxivTikzCandidates(paper(source)).map((candidate) => candidate.source)).toEqual([figure]);
    expect(extractArxivTikzCandidates(paper(String.raw`\begin{tikzpicture}` + figure))).toEqual([]);
  });

  it("retains contextual definitions when a later extracted figure is rendered", () => {
    const preamble = String.raw`\tikzset{retained/.style={red,line width=2pt}}`;
    const second = String.raw`\begin{tikzpicture}\draw[retained] (0,0)--(2,0);\end{tikzpicture}`;
    const source = `${preamble}\n${figure}\n${second}`;
    const candidate = extractArxivTikzCandidates(paper(source))[1];
    expect(candidate.contextualSource).toContain(preamble);
    expect(candidate.contextualSource).not.toContain("(1,1)");
    const result = renderTikzToSvg(candidate.contextualSource, { parse: { recover: true, includeContextDefinitions: true } });
    expect(result.parse.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(result.semantic.scene.elements).toHaveLength(1);
    expect(result.svg.svg).toContain('stroke="#ff0000"');
  });
});
