import { describe, expect, it } from "vitest";

import { renderBeamerFrame, scanBeamerDocument } from "../packages/core/src/beamer/index.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { scanTikzFigures } from "../packages/core/src/parser/figure-scan.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";

const LIVE = String.raw`\begin{tikzpicture}\draw (0,0) -- (1,0);\end{tikzpicture}`;
const SECOND = String.raw`\begin{tikzpicture*}\draw (2,0) -- (2,1);\end{tikzpicture*}`;
const FALSE = String.raw`\begin{tikzpicture}\draw (9,9) -- (10,10);\end{tikzpicture}`;

describe("figure inventory lexical boundaries", () => {
  it.each(["\n", "\r\n", "\r"])("ignores complete commented examples with %j line endings", (lineBreak) => {
    const prefix = `% ${FALSE}${lineBreak}% another example ${FALSE}${lineBreak}`;
    const source = `${prefix}${LIVE}`;
    const parsed = parseTikz(source);
    expect(scanTikzFigures(source)).toHaveLength(1);
    expect(parsed.figures).toHaveLength(1);
    expect(parsed.figure.span).toEqual({ from: prefix.length, to: source.length });
    expect(source.slice(parsed.figure.body[0]?.span.from, parsed.figure.body[0]?.span.to)).toBe(String.raw`\draw (0,0) -- (1,0);`);
    expect(parsed.figures[0]).toMatchObject({ startLine: 3, endLine: 3 });
    expect(parsed.diagnostics).toEqual([]);
    expect(renderTikzToSvg(source).svg.svg).toBe(renderTikzToSvg(LIVE).svg.svg);
  });

  it.each(["\n", "\r\n", "\r"])("skips commented begins and ends within a live figure with %j line endings", (lineBreak) => {
    const source = [
      String.raw`\begin{tikzpicture}`,
      String.raw`% \begin{tikzpicture*}\end{tikzpicture}`,
      String.raw`\draw (0,0) -- (1,0);`,
      String.raw`% \end{tikzpicture}\begin{tikzpicture}`,
      String.raw`\end{tikzpicture}`
    ].join(lineBreak);
    const parsed = parseTikz(source);
    expect(parsed.figures).toHaveLength(1);
    expect(parsed.figures[0]?.endSpan.from).toBe(source.lastIndexOf(String.raw`\end{tikzpicture}`));
    expect(parsed.figures[0]).toMatchObject({ startLine: 1, endLine: 5 });
    expect(parsed.figure.body).toHaveLength(1);
    expect(parsed.diagnostics).toEqual([]);
    expect(renderTikzToSvg(source).svg.svg).toBe(renderTikzToSvg(LIVE).svg.svg);
  });

  it.each([
    { name: "escaped backslashes", prefix: String.raw`\\begin{tikzpicture} fake \\end{tikzpicture}` },
    { name: "longer control words", prefix: String.raw`\beginning{tikzpicture} fake \ending{tikzpicture}` },
    { name: "verbatim", prefix: `\\begin{verbatim}${FALSE}\\end{verbatim}` },
    { name: "starred verbatim", prefix: `\\begin{verbatim*}${FALSE}\\end{verbatim*}` },
    { name: "inline verb", prefix: `\\verb|${FALSE}|` },
    { name: "starred inline verb", prefix: `\\verb*+${FALSE}+` },
    { name: "percent-delimited verb", prefix: `\\verb%${FALSE}%` }
  ])("keeps $name inert before two selectable live pictures", ({ prefix }) => {
    const source = `${prefix}\n${LIVE}\n${SECOND}`;
    const first = parseTikz(source);
    const second = parseTikz(source, { activeFigureId: "figure:1" });
    expect(scanTikzFigures(source)).toHaveLength(2);
    expect(first.figures.map(({ id }) => id)).toEqual(["figure:0", "figure:1"]);
    expect(source.slice(first.figure.span.from, first.figure.span.to)).toBe(LIVE);
    expect(source.slice(second.figure.span.from, second.figure.span.to)).toBe(SECOND);
    expect(first.diagnostics).toEqual([]);
    expect(second.diagnostics).toEqual([]);
    expect(renderTikzToSvg(source).svg.svg).toBe(renderTikzToSvg(LIVE).svg.svg);
    expect(renderTikzToSvg(source, { parse: { activeFigureId: "figure:1" } }).svg.svg).toBe(renderTikzToSvg(SECOND).svg.svg);
  });

  it("consumes escaped percent and pairs live controls after an escaped backslash", () => {
    const prefix = String.raw`\% escaped percent \\`;
    const source = `${prefix}${LIVE}`;
    const parsed = parseTikz(source);
    expect(parsed.figures).toHaveLength(1);
    expect(parsed.figure.span.from).toBe(prefix.length);
    expect(parsed.figure.body).toHaveLength(1);
    expect(parsed.diagnostics).toEqual([]);
  });

  it("skips a verbatim closing delimiter inside a live picture", () => {
    const source = String.raw`\begin{tikzpicture}
\node {\verb|\end{tikzpicture}|};
\draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const scanned = scanTikzFigures(source);
    expect(scanned).toHaveLength(1);
    expect(scanned[0]?.endSpan.from).toBe(source.lastIndexOf(String.raw`\end{tikzpicture}`));
    expect(scanned[0]?.span.to).toBe(source.length);
  });

  it.each([
    { name: "commented", prefix: `% ${FALSE}` },
    { name: "verbatim", prefix: `\\begin{verbatim}${FALSE}\\end{verbatim}` }
  ])("keeps $name examples out of Beamer nested figure roots", async ({ prefix }) => {
    const second = SECOND.replaceAll("tikzpicture*", "tikzpicture");
    const source = [
      String.raw`\documentclass{beamer}`,
      String.raw`\begin{document}`,
      String.raw`\begin{frame}[fragile]{Lexical boundaries}`,
      prefix,
      LIVE.replace(String.raw`\draw`, String.raw`% \end{tikzpicture}` + "\n" + String.raw`\draw`),
      second,
      String.raw`\end{frame}`,
      String.raw`\end{document}`
    ].join("\n");
    const document = scanBeamerDocument(source);
    const roots = document.frames[0]?.children;
    expect(roots).toHaveLength(2);
    expect(roots?.map(({ id }) => id)).toEqual(["frame:0:tikzpicture:0", "frame:0:tikzpicture:1"]);
    expect(source.slice(roots?.[0]?.span.from, roots?.[0]?.span.to)).toContain(String.raw`\draw (0,0) -- (1,0);`);
    expect(source.slice(roots?.[1]?.span.from, roots?.[1]?.span.to)).toBe(second);
    const rendered = await renderBeamerFrame(source, { frameIndex: 0 });
    expect(rendered.layout.items.filter((item) => item.kind === "tikzpicture").map(({ rootId }) => rootId))
      .toEqual(["frame:0:tikzpicture:0", "frame:0:tikzpicture:1"]);
  });
});
