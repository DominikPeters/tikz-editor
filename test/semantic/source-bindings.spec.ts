import { describe, expect, it } from "vitest";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import { createIncrementalSemanticSession } from "../../packages/core/src/semantic/incremental.js";
import { createSourceSpanResolver } from "../../packages/core/src/semantic/source-bindings.js";
import { createTexNodeTextEngine } from "../../packages/core/src/text/tex-node-text-engine.js";
import { retainSceneTextLayout } from "../../packages/core/src/text/render-scope.js";
import { getTextLayoutReportProvider } from "../../packages/core/src/text/layout-context.js";
import { emitSvg } from "../../packages/core/src/svg/emit.js";
import { diffSvgModels } from "../../packages/core/src/svg/patch.js";

describe("semantic source bindings", () => {
  it("reuses text SVG while resolving current and previous caret reports independently", async () => {
    const source = String.raw`\begin{tikzpicture}
\node at (0,0) {A};
\node at (5,0) {Later};
\draw (-5,-5) -- (10,5);
\end{tikzpicture}`;
    const textEngine = await createTexNodeTextEngine();
    const session = createIncrementalSemanticSession({ textEngine });
    const firstScope = textEngine.createRenderScope!();
    const first = firstScope.run(() => session.evaluate({ source, figure: parseTikz(source).figure }));
    const firstSvg = firstScope.run(() => emitSvg(first.semantic.scene, { textEngine, textSourceCoordinates: "layout" }));
    retainSceneTextLayout(firstScope, first.semantic.scene);
    const later = first.semantic.scene.elements.find(element => element.kind === "Text" && element.text === "Later");
    if (later?.kind !== "Text" || later.textRenderInfo?.mode !== "tex") throw new Error("Expected TeX text");
    const paragraphId = later.textRenderInfo.paragraphId!;
    const oldReport = getTextLayoutReportProvider(firstScope.layoutContext)!.getParagraphReport!(paragraphId)!;
    const before = JSON.stringify(oldReport);

    const updated = source.replace("{A}", "{A longer label}");
    const nextScope = textEngine.createRenderScope!(firstScope.layoutContext);
    const next = nextScope.run(() => session.evaluate({ source: updated, figure: parseTikz(updated).figure,
      hints: { changedSourceIds: ["path:0"] } }));
    expect(next.stats.replayMode).toBe("selective");
    const reuse = { previousModel: firstSvg.model, affectedSourceIds: ["path:0"] };
    const nextSvg = nextScope.run(() => emitSvg(next.semantic.scene, { textEngine, textSourceCoordinates: "layout", reuse }));
    retainSceneTextLayout(nextScope, next.semantic.scene);
    const changes = diffSvgModels(firstSvg.model, nextSvg.model);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "upsertPart", part: { sourceId: "path:0" } });
    const currentReport = getTextLayoutReportProvider(nextScope.layoutContext)!.getParagraphReport!(paragraphId)!;
    expect(currentReport.lines[0].segments[0].sourceStartRaw).toBe(updated.indexOf("Later"));
    expect(oldReport.lines[0].segments[0].sourceStartRaw).toBe(source.indexOf("Later"));
    expect(JSON.stringify(oldReport)).toBe(before);
    // Export/default emission uses document offsets even when its previous
    // model came from a canvas preview with local coordinates.
    const exported = nextScope.run(() => emitSvg(next.semantic.scene, { textEngine, reuse }));
    expect(exported.svg).toContain(`data-source-start="${updated.indexOf("Later")}"`);
  });

  it("keeps repeated statements distinct and shares geometry through longer and shorter edits", () => {
    let source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,0);
\draw (2,1) -- (4,1);
\draw (2,1) -- (4,1);
\end{tikzpicture}`;
    const session = createIncrementalSemanticSession();
    const initial = session.evaluate({ source, figure: parseTikz(source).figure });
    const before = JSON.stringify(initial.semantic);
    const trailing = initial.semantic.scene.elements.slice(1);
    for (const replacement of ["(10.123,0)", "(0,0)", "(12345,0)"]) {
      source = source.replace(/\\draw \([^)]*\)/, `\\draw ${replacement}`);
      const figure = parseTikz(source).figure;
      const next = session.evaluate({ source, figure, hints: { changedSourceIds: [figure.body[0].id] } });
      expect(next.stats.replayMode).toBe("selective");
      expect(next.semantic).toEqual(evaluateTikzFigure(figure, source));
      const elements = next.semantic.scene.elements.slice(1);
      elements.forEach((element, index) => {
        const old = trailing[index];
        expect(element.sourceRef).not.toBe(old.sourceRef);
        expect(element.style).toBe(old.style);
        expect(element.transform).toBe(old.transform);
        if (element.kind !== "Path" || old.kind !== "Path") throw new Error("Expected paths");
        expect(element.commands).toBe(old.commands);
      });
    }
    expect(JSON.stringify(initial.semantic)).toBe(before);
  });

  it("maps disjoint edits and enclosing spans with explicit boundary ownership", () => {
    const resolve = createSourceSpanResolver([
      { oldSpan: { from: 5, to: 5 }, newSpan: { from: 5, to: 8 }, replacement: "abc" },
      { oldSpan: { from: 15, to: 19 }, newSpan: { from: 18, to: 19 }, replacement: "x" }
    ]);
    expect(resolve({ from: 0, to: 5 })).toEqual({ from: 0, to: 5 });
    expect(resolve({ from: 5, to: 10 })).toEqual({ from: 8, to: 13 });
    expect(resolve({ from: 0, to: 25 })).toEqual({ from: 0, to: 25 });
    expect(resolve({ from: 20, to: 25 })).toEqual({ from: 20, to: 25 });
    expect(() => resolve({ from: 16, to: 20 })).toThrow("overlaps replaced source");
  });
});
