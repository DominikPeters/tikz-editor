import { describe, expect, it } from "vitest";
import { renderBeamerFrame } from "../packages/core/src/beamer/index.js";
import { flattenPositionedTexVListItems } from "../packages/core/src/text/tex/vlist/index.js";
const deck = (body: string) => String.raw`\documentclass{beamer}\begin{document}\begin{frame}${body}\end{frame}\end{document}`;

describe("Beamer display font and AMS registers", () => {
  it.each([["", 6.09914], [String.raw`\small`, 5.57], [String.raw`\Huge`, 13.08688]])(
    "uses surrounding %s font for both math styles", async (command, expectedWidth) => {
      const frame = await renderBeamerFrame(deck(String.raw`${command} $x$ \[x\]`));
      expect(frame.diagnostics).toEqual([]);
      const paragraph = frame.layout.paragraphs.find(item => item.role === "body")!;
      const inline = paragraph.report.lines.flatMap(line => line.segments).find(segment => segment.kind === "math")!;
      const display = flattenPositionedTexVListItems(paragraph.vlistLayout.items).find(entry => entry.item.kind === "display-math")!;
      expect(display.metrics.width).toBeCloseTo(Number(expectedWidth), 3);
      expect(display.metrics.width).toBeCloseTo(inline.width, 5);
    });

  it("uses full AMS split extent at a leading equation while preserving ordinary short skips", async () => {
    for (const [content, expected] of [["x", [0, 6.5]], [String.raw`\begin{split}a&=b\\c&=d\end{split}`, [11, 11]]] as const) {
      const frame = await renderBeamerFrame(deck(String.raw`\begin{equation}${content}\end{equation} Beta`));
      expect(frame.diagnostics).toEqual([]);
      const paragraph = frame.layout.paragraphs.find(item => item.role === "body")!;
      const skips = flattenPositionedTexVListItems(paragraph.vlistLayout.items).flatMap(entry =>
        entry.item.kind === "glue" && entry.item.origin?.kind === "display-math-boundary" ? [entry.item.size] : []);
      expect(skips).toEqual(expected);
    }
  });
  it("preserves a T-column's structural zero leading baseline before cases", async () => {
    // The retained cases-in-column frame19 LuaLaTeX oracle uses this preamble and body.
    const source = String.raw`\documentclass[aspectratio=169]{beamer}
\usepackage{amsmath}\usepackage{booktabs}\usepackage{graphicx}
\usetheme{Madrid}\usecolortheme{seahorse}\title{Corpus priorities}\author{}\date{}
\begin{document}\begin{frame}{Cases in columns}
\begin{columns}[T,totalwidth=\textwidth]
\begin{column}{.47\textwidth}
\[f(x)=\begin{cases}0&\text{if }x<0\\x&\text{if }x\geq0\end{cases}\]
Alpha.
\end{column}
\begin{column}{.47\textwidth}Other column.\end{column}
\end{columns}\end{frame}\end{document}`;
    const frame = await renderBeamerFrame(source);
    expect(frame.diagnostics).toEqual([]);
    const paragraph = frame.layout.paragraphs.find(item => item.role === "body" &&
      flattenPositionedTexVListItems(item.vlistLayout.items).some(entry => entry.item.kind === "display-math"))!;
    const items = flattenPositionedTexVListItems(paragraph.vlistLayout.items);
    const display = items.find(entry => entry.item.kind === "display-math")!;
    expect(paragraph.bounds.y + display.y + display.metrics.height).toBeCloseTo(120.596008, 3);
    const prefix = items.find(entry => entry.item.kind === "glue" && entry.item.origin?.kind === "display-math-interline" && entry.item.origin.side === "above");
    expect(prefix?.item.kind === "glue" ? prefix.item.size : undefined).toBe(0);
  });

});
