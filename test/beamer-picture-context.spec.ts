import { describe, expect, it } from "vitest";
import { computeSnapshot } from "../packages/app/src/compute";
import { executeDocumentEdit } from "../packages/app/src/edit-execution";
import { renderBeamerFrame } from "../packages/core/src/beamer/index";
import { maskSourceOutsideSpan, maskTikzPictureSource } from "../packages/core/src/document/masking";
import { parseTikz } from "../packages/core/src/parser/index";

const SOURCE = String.raw`\documentclass{beamer}
\usepackage{tikz}
\definecolor{brand}{HTML}{123456}
\def\corner{2}
\newcommand{\captiontext}{Key result}
\tikzset{accent/.style={fill=brand,draw=red,line width=3pt}}
\begin{document}
\begin{frame}{First}
\tikzset{accent/.style={fill=green,draw=red,line width=3pt}}
\begin{tikzpicture}[overlay,remember picture,shift={(current page.south west)}]
\draw[accent] (1,1) rectangle (\corner,2);
\node at (3,2) {\captiontext};
\end{tikzpicture}
\end{frame}
\begin{frame}{Second}
\begin{tikzpicture}[overlay,remember picture,shift={(current page.south west)}]
\draw[accent] (1,1) rectangle (\corner,2);
\end{tikzpicture}
\begin{tikzpicture}\draw[accent] (1,1) rectangle (\corner,2);\end{tikzpicture}
\end{frame}
\end{document}`;

describe("Beamer pictures inherit visible TikZ definitions", () => {
  it("keeps the source length and absolute declaration spans while removing closed scopes", () => {
    const picture = parseTikz(SOURCE).figures[1];
    const masked = maskTikzPictureSource(SOURCE, picture.span);
    expect(masked.length).toBe(SOURCE.length);
    expect(masked.slice(picture.span.from, picture.span.to)).toBe(SOURCE.slice(picture.span.from, picture.span.to));
    expect(masked).toContain(String.raw`\definecolor{brand}{HTML}{123456}`);
    expect(masked).toContain(String.raw`\def\corner{2}`);
    expect(masked).not.toContain("fill=green");
    const parsed = parseTikz(masked, { includeContextDefinitions: true });
    expect(parsed.figures).toHaveLength(1);
    const definition = parsed.figure.body.find(statement => statement.kind === "DefineColor")!;
    expect(SOURCE.slice(definition.span.from, definition.span.to)).toBe(String.raw`\definecolor{brand}{HTML}{123456}`);
  });

  it("renders preamble styles, colors and coordinate macros, with frame-local overrides", async () => {
    const first = await renderBeamerFrame(SOURCE, { frameIndex: 0 });
    const second = await renderBeamerFrame(SOURCE, { frameIndex: 1 });
    for (const frame of [first, second]) expect(frame.diagnostics).toEqual([]);
    const firstPath = first.layout.embeddedTikz[0].overlay!.elements.find(element => element.kind === "Path")!;
    const secondPath = second.layout.embeddedTikz.find(picture => picture.overlay)!.overlay!.elements.find(element => element.kind === "Path")!;
    expect(firstPath.style).toMatchObject({ fill: "#00ff00", stroke: "#ff0000", lineWidth: 3 });
    expect(secondPath.style).toMatchObject({ fill: "#123456", stroke: "#ff0000", lineWidth: 3 });
    expect(second.layout.embeddedTikz.find(picture => !picture.overlay)!.model.parts.map(part => part.markup).join("")).toContain('fill="#123456"');
    const parsed = await computeSnapshot({ id: "ordinary-context", documentId: "ordinary-context", source: SOURCE,
      activeRootId: "frame:1:tikzpicture:0" });
    expect(parsed.snapshot.scene!.elements.find(element => element.kind === "Path")!.style.fill).toBe("#123456");
  });

  it("preserves absolute offsets when Unicode outside the picture uses surrogate pairs", () => {
    const source = SOURCE.replace("\\begin{document}", "% 😀 before\n\\begin{document}")
      .replace("\\end{document}", "% 🚀 after\n\\end{document}");
    const span = parseTikz(source).figures[1].span;
    for (const mask of [maskSourceOutsideSpan, maskTikzPictureSource]) {
      const masked = mask(source, span);
      expect(masked.length).toBe(source.length);
      expect(masked.slice(span.from, span.to)).toBe(source.slice(span.from, span.to));
      const parsed = parseTikz(masked, { includeContextDefinitions: true });
      expect(parsed.figure.span).toEqual(span);
      const path = parsed.figure.body.find(statement => statement.kind === "Path")!;
      expect(source.slice(path.span.from, path.span.to)).toBe(String.raw`\draw[accent] (1,1) rectangle (\corner,2);`);
    }
  });

  it("edits an inherited style's picture without changing the original declarations", async () => {
    const request = { id: "context-edit", documentId: "context-edit", source: SOURCE, sourceRevision: 0,
      activeRootId: "frame:1", includeDrawingLayer: true, drawingLayerRootId: "frame:1:overlay:0" };
    const { snapshot } = await computeSnapshot(request);
    const element = snapshot.scene!.elements.find(element => element.kind === "Path")!;
    expect(element.style).toMatchObject({ fill: "#123456", lineWidth: 3 });
    const result = executeDocumentEdit({ ...request, snapshot }, { kind: "setProperty", elementId: element.sourceRef.sourceId,
      level: "command", key: "line width", value: "4pt" });
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    expect(result.newSource.slice(0, SOURCE.indexOf("\\begin{document}"))).toBe(SOURCE.slice(0, SOURCE.indexOf("\\begin{document}")));
    const after = await computeSnapshot({ ...request, id: "context-edited", source: result.newSource, sourceRevision: 1,
      patches: result.patches, patchBaseRevision: 0, changedSourceIds: result.changedSourceIds });
    expect(after.snapshot.incremental?.deckLayoutReused).toBe(true);
    expect(after.snapshot.scene!.elements.find(element => element.kind === "Path")!.style).toMatchObject({ fill: "#123456", lineWidth: 4 });
  });
});
