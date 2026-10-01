import { describe, expect, it } from "vitest";
import { beamerSpacingTargets, beamerSpacingResizePatches, prepareBeamerDocument, type BeamerFrameLayout } from "../packages/core/src/beamer/index.js";
import type { SourcePatch } from "../packages/core/src/edit/types.js";
const document = (body: string, preamble = "") => String.raw`\documentclass{beamer}
${preamble}
\begin{document}\begin{frame}[t]
${body}
\end{frame}\end{document}`;
async function render(source: string, step = 1) {
  return (await prepareBeamerDocument(source).renderFrame({ frameIndex: 0, step })).layout;
}
function apply(source: string, patches: SourcePatch[]) {
  return [...patches].reverse().reduce((text, patch) => text.slice(0, patch.oldSpan.from) + patch.replacement + text.slice(patch.oldSpan.to), source);
}
function textY(layout: BeamerFrameLayout, text: string) {
  for (const paragraph of layout.paragraphs) {
    const line = paragraph.report.lines.find(line => line.segments.map(segment => segment.text).join("").includes(text));
    const placement = line && paragraph.vlistLayout.linePlacements.find(candidate => candidate.lineIndex === line.lineIndex);
    if (placement) return paragraph.bounds.y + Number(placement.y);
  }
  throw new Error(`No rendered text ${text}`);
}
const contexts = {
  paragraph: (spacing: string) => String.raw`Before\par ${spacing} After`,
  blocks: (spacing: string) => String.raw`\begin{block}{A}Before\end{block}${spacing}\begin{block}{B}After\end{block}`,
  blockBody: (spacing: string) => String.raw`\begin{block}{A}Before\par ${spacing} After\end{block}`,
  column: (spacing: string) => String.raw`\begin{columns}[T]
\begin{column}{.5\textwidth}
Before\par
${spacing}
After
\end{column}
\begin{column}{.5\textwidth}Right\end{column}
\end{columns}`,
};

describe("source-backed Beamer spacing", () => {
  for (const [name, context] of Object.entries(contexts)) {
    it.each([["smallskip", 3], ["medskip", 6], ["bigskip", 12]] as const)(`${name}: converts \\%s only when resized`, async (command, size) => {
      const source = document(context(`\\${command}`));
      const layout = await render(source);
      const targets = beamerSpacingTargets(source, layout);
      expect(targets).toHaveLength(1);
      expect(targets[0].sizePt).toBe(size);
      expect(beamerSpacingResizePatches(source, targets[0], 0)).toEqual([]);
      const next = apply(source, beamerSpacingResizePatches(source, targets[0], 4));
      expect(next).toBe(source.replace(`\\${command}`, `\\vspace{${size + 4}pt}`));
      const nextLayout = await render(next);
      expect(beamerSpacingTargets(next, nextLayout)[0].sizePt).toBeCloseTo(size + 4, 4);
      expect(textY(nextLayout, "After") - textY(layout, "After")).toBeCloseTo(4, 3);
      expect(textY(nextLayout, "Before")).toBeCloseTo(textY(layout, "Before"), 3);
    });
  }
  it.each(["pt", "cm", "mm", "em", "ex"])("preserves %s units, the star, whitespace, and comments", async unit => {
    const source = document(String.raw`\begin{block}{A}Before\end{block}
\vspace* % keep comment
{ .5 ${unit} } % after
\begin{block}{B}After\end{block}`);
    const layout = await render(source);
    const target = beamerSpacingTargets(source, layout)[0];
    expect(target).toBeDefined();
    const next = apply(source, beamerSpacingResizePatches(source, target, target.unitPt / 2));
    expect(next).toBe(source.replace(`.5 ${unit}`, `1 ${unit}`));
    const nextLayout = await render(next);
    expect(beamerSpacingTargets(next, nextLayout)[0].sizePt).toBeCloseTo(target.sizePt * 2, 4);
    expect(textY(nextLayout, "After") - textY(layout, "After")).toBeCloseTo(target.sizePt, 3);
  });
  it.each(["0pt", "0em", "0ex", "-3pt", "-.5em"])("edits zero and negative space %s without changing its unit", async dimension => {
    const source = document(String.raw`Before\par\vspace{${dimension}}After`);
    const layout = await render(source);
    const target = beamerSpacingTargets(source, layout)[0];
    expect(target).toBeDefined();
    const next = apply(source, beamerSpacingResizePatches(source, target, 5));
    const nextLayout = await render(next);
    expect(beamerSpacingTargets(next, nextLayout)[0].sizePt).toBeCloseTo(target.sizePt + 5, 2);
    expect(textY(nextLayout, "After") - textY(layout, "After")).toBeCloseTo(5, 2);
  });
  it("places inline spacing after its owning line and preserves consumed whitespace", async () => {
    const source = document(String.raw`Before\medskip After\par Next`);
    const layout = await render(source);
    const target = beamerSpacingTargets(source, layout)[0];
    expect(target.horizontal).toBe(true);
    const next = apply(source, beamerSpacingResizePatches(source, target, 4));
    expect(next).toBe(source.replace("\\medskip ", "\\vspace{10pt}"));
    const nextLayout = await render(next);
    expect(textY(nextLayout, "BeforeAfter")).toBeCloseTo(textY(layout, "BeforeAfter"), 4);
    expect(textY(nextLayout, "Next") - textY(layout, "Next")).toBeCloseTo(4, 3);
  });
  it("keeps inline column spacing in the paragraph flow", async () => {
    const source = document(String.raw`\begin{columns}[T]\begin{column}{.5\textwidth}Before\medskip After\par Next\end{column}\begin{column}{.5\textwidth}Right\end{column}\end{columns}`);
    const layout = await render(source);
    const target = beamerSpacingTargets(source, layout)[0];
    expect(target.horizontal).toBe(true);
    const next = apply(source, beamerSpacingResizePatches(source, target, 4));
    const nextLayout = await render(next);
    expect(textY(nextLayout, "BeforeAfter")).toBeCloseTo(textY(layout, "BeforeAfter"), 3);
    expect(textY(nextLayout, "Next") - textY(layout, "Next")).toBeCloseTo(4, 3);
  });
  it("keeps source-line skips inside the same column paragraph", async () => {
    const source = document(String.raw`\begin{columns}[T]
\begin{column}{.5\textwidth}
Before
\medskip
After\par Next
\end{column}
\begin{column}{.5\textwidth}Right\end{column}
\end{columns}`);
    const layout = await render(source);
    const target = beamerSpacingTargets(source, layout)[0];
    expect(target.horizontal).toBe(true);
    expect(textY(layout, "Before After")).toBeDefined();
    const next = apply(source, beamerSpacingResizePatches(source, target, 4));
    const nextLayout = await render(next);
    expect(textY(nextLayout, "Before After")).toBeCloseTo(textY(layout, "Before After"), 3);
    expect(textY(nextLayout, "Next") - textY(layout, "Next")).toBeCloseTo(4, 3);
  });
  it("does not expose implicit paragraph, list, or theme gaps", async () => {
    const source = document(String.raw`One\par Two\begin{itemize}\item A\item B\end{itemize}\begin{block}{B}Body\end{block}`);
    expect(beamerSpacingTargets(source, await render(source))).toEqual([]);
  });
  it("leaves flexible fills and complex dimensions in source", async () => {
    const source = document(String.raw`Before\par\vfill\vspace{\dimexpr 2pt+3pt\relax}After`);
    expect(beamerSpacingTargets(source, await render(source))).toEqual([]);
  });
  it("excludes hidden overlays and expanded macro spacing", async () => {
    const source = document(String.raw`\only<2>{Before\par\medskip After}\mygap`, String.raw`\newcommand{\mygap}{\vspace{3pt}}`);
    expect(beamerSpacingTargets(source, await render(source))).toHaveLength(0);
    expect(beamerSpacingTargets(source, await render(source, 2))).toHaveLength(1);
  });
  it("preserves other commands and overlay wrappers when resizing one of several gaps", async () => {
    const source = document(String.raw`\only<1->{Before\par\smallskip\medskip\bigskip After}`);
    const layout = await render(source);
    const targets = beamerSpacingTargets(source, layout);
    expect(targets.map(target => target.command)).toEqual(["smallskip", "medskip", "bigskip"]);
    const next = apply(source, beamerSpacingResizePatches(source, targets[1], 2));
    expect(next).toBe(source.replace("\\medskip", "\\vspace{8pt}"));
    const nextTargets = beamerSpacingTargets(next, await render(next));
    expect(nextTargets.map(target => target.sizePt)).toEqual([3, 8, 12]);
  });
});
