import { afterEach, describe, expect, it } from "vitest";
import { claimCachedDeckSnapshot, computeSnapshot, type SessionSnapshot } from "../packages/app/src/compute";
import { buildEditParseOptions } from "../packages/app/src/edit-parse-options";
import { resetSharedEditAnalysisManager } from "../packages/app/src/edit-analysis-manager";
import { executeDocumentEdit } from "../packages/app/src/edit-execution";
import { getInspectorDescriptor } from "../packages/core/src/edit/inspector";
import { computeMinimalReplacementPatch } from "../packages/core/src/edit/patch";
import { resolvePropertyTarget } from "../packages/core/src/edit/property-target";

const paths = Array.from({ length: 32 }, (_, index) => `\\draw[fill=orange!20] (${index / 10},1) rectangle (${index / 10 + .2},2);`).join("\n");
const SOURCE = String.raw`\documentclass{beamer}
\usepackage{tikz}
\begin{document}
\begin{frame}{Layer}
Before.
\begin{tikzpicture}[overlay, remember picture, shift={(current page.south west)}]
${paths}
\end{tikzpicture}

Text after the picture, with $x^2$.
\begin{itemize}\item An item after the picture.\end{itemize}
\begin{tikzpicture}[overlay, remember picture]\draw[blue] (1,1) -- (2,2);\end{tikzpicture}
\end{frame}
\begin{frame}{Another}Another slide.\end{frame}
\end{document}`;

afterEach(() => resetSharedEditAnalysisManager());

/** The slide's layout stands while the picture keeps its length; else it is laid out again (drawingLayerPage). */
const keepsLength = (before: string, after: string) => before.length === after.length;

function paragraphGeometry(snapshot: SessionSnapshot) {
  return snapshot.deck!.activeFrame!.layout.paragraphs.map(paragraph => ({
    sourceSpan: paragraph.sourceSpan, bounds: paragraph.bounds, editableTextSpans: paragraph.editableTextSpans,
    listStructure: paragraph.listStructure,
    segments: paragraph.report.lines.map(line => line.segments.map(segment => ({
      x: segment.x, width: segment.width, text: segment.text,
      from: segment.sourceStartRaw, to: segment.sourceEndRaw
    })))
  }));
}

describe("overlay editing on a slide", () => {
  it.each(["shared", "none"] as const)("resolves rectangle command options using %s analysis and edits them", async analysis => {
    const documentId = `overlay-inspector-${analysis}`;
    const { snapshot } = await computeSnapshot({ id: "inspector", documentId, source: SOURCE, sourceRevision: 0,
      activeRootId: "frame:0", includeDrawingLayer: true, drawingLayerRootId: "frame:0:overlay:0" });
    const input = { documentId, sourceRevision: 0, source: SOURCE, activeRootId: "frame:0", snapshot };
    const options = analysis === "shared" ? buildEditParseOptions({ ...input, analysis }) : buildEditParseOptions({ ...input, analysis });
    const element = snapshot.scene!.elements.find(element => element.sourceRef.sourceId === "path:0")!;
    const descriptor = getInspectorDescriptor(element, { source: SOURCE, editHandles: snapshot.editHandles, parseOptions: options });
    expect(descriptor.writeTargetId).toBe("path:0");
    expect(descriptor.readOnlyReason).toBeUndefined();
    const resolved = resolvePropertyTarget(SOURCE, "path:0", options);
    expect(resolved.kind).toBe("found");
    if (resolved.kind !== "found") return;
    expect(SOURCE.slice(resolved.target.span.from, resolved.target.span.to)).toContain("rectangle");
    const result = executeDocumentEdit({ documentId, source: SOURCE, sourceRevision: 0, activeRootId: "frame:0", snapshot },
      { kind: "setProperty", elementId: "path:0", level: "command", key: "fill", value: "red" });
    expect(result.kind).toBe("success");
    if (result.kind === "success") expect(result.newSource).toContain("\\draw[fill=red] (0,1) rectangle (0.2,2)");
  });

  it.each(["remember picture", "", "remember picture, scale=1.5, rotate=30"])(
    "reuses parsing, semantic checkpoints and SVG parts during drags, and the slide layout while the picture keeps its length (%s)", async options => {
      const documentId = `overlay-drag-${options}`;
      let source = SOURCE.replace("overlay, remember picture, shift={(current page.south west)}", `overlay, ${options}, shift={(current page.south west)}`);
      let { snapshot } = await computeSnapshot({ id: "seed", documentId, source, sourceRevision: 0,
        activeRootId: "frame:0", includeDrawingLayer: true, drawingLayerRootId: "frame:0:overlay:0" });
      for (let revision = 1; revision <= 3; revision++) {
        const next = source.replace(/\([\d.]+,1\) rectangle/u, `(${revision / 8},1) rectangle`);
        const patch = computeMinimalReplacementPatch(source, next);
        const before = snapshot;
        const result = await computeSnapshot({ id: `drag-${revision}`, documentId, source: next, sourceRevision: revision,
          activeRootId: "frame:0", includeDrawingLayer: true, drawingLayerRootId: "frame:0:overlay:0",
          trigger: "drag-element", changedSourceIds: ["path:0"], patches: [patch], patchBaseRevision: revision - 1 });
        snapshot = result.snapshot;
        expect(result.diagnostics).toEqual([]);
        expect(snapshot.incremental).toMatchObject({ parseStrategy: "incremental", strategy: "incremental", deckLayoutReused: keepsLength(source, next) });
        expect(snapshot.incremental!.reusedStatementCount).toBeGreaterThan(16);
        expect(snapshot.svgModel!.parts.find(part => part.sourceId === "path:31"))
          .toEqual(before.svgModel!.parts.find(part => part.sourceId === "path:31"));
        source = next;
      }
      const canonical = await computeSnapshot({ id: "canonical", documentId: `${documentId}-cold`, source,
        activeRootId: "frame:0", includeDrawingLayer: true, drawingLayerRootId: "frame:0:overlay:0" });
      expect(snapshot.svg?.svg).toBe(canonical.snapshot.svg?.svg);
      expect(paragraphGeometry(snapshot)).toEqual(paragraphGeometry(canonical.snapshot));
      const normalize = (value: unknown) => JSON.parse(JSON.stringify(value, (key, entry: unknown) =>
        key === "paragraphId" ? undefined : entry)) as unknown;
      expect(normalize(snapshot.deck!.activeFrame!.layout.paragraphs.map(paragraph => paragraph.vlistLayout)))
        .toEqual(normalize(canonical.snapshot.deck!.activeFrame!.layout.paragraphs.map(paragraph => paragraph.vlistLayout)));
      expect(snapshot.deck!.activeFrame!.layout.editScopes).toEqual(canonical.snapshot.deck!.activeFrame!.layout.editScopes);
      expect(snapshot.deck!.activeFrame!.layout.embeddedTikz[1].sourceSpan).toEqual(canonical.snapshot.deck!.activeFrame!.layout.embeddedTikz[1].sourceSpan);
      const glyphStart = source.indexOf("Text after");
      expect(snapshot.deck!.activeFrame!.svg).toContain(`data-source-start="${glyphStart}"`);
    }
  );

  it("reuses the slide layout for inspector scrubs inside a picture that keep its length", async () => {
    const request = { id: "inspector-seed", documentId: "overlay-inspector-reuse", source: SOURCE, sourceRevision: 0,
      activeRootId: "frame:0", includeDrawingLayer: true, drawingLayerRootId: "frame:0:overlay:0" };
    let { snapshot } = await computeSnapshot(request);
    let source = SOURCE;
    for (let revision = 1; revision <= 3; revision++) {
      const next = source.replace(/fill=[^\]]+/u, `fill=red!${revision * 10}`);
      const result = await computeSnapshot({ ...request, id: `inspector-${revision}`, source: next, sourceRevision: revision,
        trigger: "other", schedulingTrigger: "inspector-edit", changedSourceIds: ["path:0"],
        patches: [computeMinimalReplacementPatch(source, next)], patchBaseRevision: revision - 1 });
      expect(result.snapshot.incremental).toMatchObject({ parseStrategy: "incremental", strategy: "incremental", deckLayoutReused: keepsLength(source, next) });
      snapshot = result.snapshot;
      source = next;
    }
    const canonical = await computeSnapshot({ ...request, id: "inspector-cold", documentId: "overlay-inspector-cold", source });
    expect(snapshot.svg!.svg).toBe(canonical.snapshot.svg!.svg);
    expect(paragraphGeometry(snapshot)).toEqual(paragraphGeometry(canonical.snapshot));
  });

  it("keeps node typing incremental with structural masks, even for unfinished TeX", async () => {
    let source = SOURCE.replace("\\end{tikzpicture}", String.raw`\node[draw] (label) at (4,3) {Initial};
\draw (label.east) -- (6,3);
\end{tikzpicture}`);
    const request = { id: "typing-seed", documentId: "overlay-node-typing", source, sourceRevision: 0,
      activeRootId: "frame:0", includeDrawingLayer: true, drawingLayerRootId: "frame:0:overlay:0" };
    let { snapshot } = await computeSnapshot(request);
    for (const [index, text] of ["A longer label", String.raw`A longer $x^{2`, "Finished label"].entries()) {
      const node = snapshot.scene!.elements.find(element => element.kind === "Text")!;
      const span = node.kind === "Text" ? node.textSourceSpan! : { from: 0, to: 0 };
      const next = source.slice(0, span.from) + text + source.slice(span.to);
      const mask = { from: span.from, to: span.from + text.length };
      const result = await computeSnapshot({ ...request, id: `typing-${index}`, source: next, sourceRevision: index + 1,
        trigger: "other", schedulingTrigger: "canvas-text-edit", changedSourceIds: ["path:32"], textEditMaskSpan: mask,
        patches: [computeMinimalReplacementPatch(source, next)], patchBaseRevision: index });
      expect(result.snapshot.incremental).toMatchObject({ parseStrategy: "incremental", strategy: "incremental", deckLayoutReused: keepsLength(source, next) });
      expect(result.snapshot.scene!.elements.some(element => element.kind === "Text" && element.text === text)).toBe(true);
      snapshot = result.snapshot;
      source = next;
    }
    const canonical = await computeSnapshot({ ...request, id: "typing-cold", documentId: "overlay-typing-cold", source });
    expect(snapshot.svg!.svg).toBe(canonical.snapshot.svg!.svg);
    expect(paragraphGeometry(snapshot)).toEqual(paragraphGeometry(canonical.snapshot));
    const unmasked = await computeSnapshot({ ...request, id: "typing-ended", source, sourceRevision: 3 });
    expect(unmasked.snapshot.svg!.svg).toBe(canonical.snapshot.svg!.svg);
  });

  it("keeps a 500-statement, text-heavy layer incremental and matches a fresh render", async () => {
    const dense = Array.from({ length: 500 }, (_, index) => {
      const x = (index % 20) / 2;
      const y = Math.floor(index / 20) / 4;
      return index % 4 === 3
        ? `\\node[draw] (label${index}) at (${x},${y}) {Result ${index}: a text-heavy label with $x^2$};`
        : `\\draw[fill=orange!20] (${x},${y}) rectangle (${x + .2},${y + .15});`;
    }).join("\n");
    let source = SOURCE.replace(paths, dense);
    const request = { id: "stress-seed", documentId: "overlay-stress", source, sourceRevision: 0,
      activeRootId: "frame:0", includeDrawingLayer: true, drawingLayerRootId: "frame:0:overlay:0" };
    let { snapshot } = await computeSnapshot(request);
    const untouched = snapshot.svgModel!.parts.find(part => part.sourceId === "path:499");
    for (let revision = 1; revision <= 3; revision++) {
      const next = source.replace(/\([\d.]+,0\) rectangle/u, `(${revision / 8},0) rectangle`);
      const result = await computeSnapshot({ ...request, id: `stress-drag-${revision}`, source: next, sourceRevision: revision,
        trigger: "drag-element", changedSourceIds: ["path:0"],
        patches: [computeMinimalReplacementPatch(source, next)], patchBaseRevision: revision - 1 });
      expect(result.snapshot.incremental).toMatchObject({ parseStrategy: "incremental", strategy: "incremental", deckLayoutReused: keepsLength(source, next) });
      expect(result.snapshot.incremental!.reusedStatementCount).toBe(499);
      expect(result.snapshot.svgModel!.parts.find(part => part.sourceId === "path:499")).toEqual(untouched);
      snapshot = result.snapshot;
      source = next;
    }
    const cold = await computeSnapshot({ ...request, id: "stress-cold", documentId: "overlay-stress-cold", source });
    expect(snapshot.svg!.svg).toBe(cold.snapshot.svg!.svg);
    expect(paragraphGeometry(snapshot)).toEqual(paragraphGeometry(cold.snapshot));
  });

  it("keeps the slide body across statement insertion and deletion with safe full picture parsing", async () => {
    const request = { id: "structure-seed", documentId: "overlay-structure", source: SOURCE, sourceRevision: 0,
      activeRootId: "frame:0", includeDrawingLayer: true, drawingLayerRootId: "frame:0:overlay:0" };
    const seed = await computeSnapshot(request);
    const unchangedBounds = seed.snapshot.deck!.activeFrame!.layout.paragraphs[0].bounds;
    const inserted = SOURCE.replace("\\end{tikzpicture}", "\\draw[red] (4,2) rectangle (5,3);\n\\end{tikzpicture}");
    let source = SOURCE;
    const results: Array<{ source: string; snapshot: SessionSnapshot }> = [];
    for (const [index, next] of [inserted, SOURCE].entries()) {
      const result = await computeSnapshot({ ...request, id: `structure-${index}`, source: next, sourceRevision: index + 1,
        patches: [computeMinimalReplacementPatch(source, next)], patchBaseRevision: index });
      expect(result.snapshot.deck!.activeFrame!.layout.paragraphs[0].bounds).toEqual(unchangedBounds);
      results.push({ source: next, snapshot: result.snapshot });
      source = next;
    }
    for (const [index, result] of results.entries()) {
      const cold = await computeSnapshot({ ...request, id: `structure-cold-${index}`, documentId: `overlay-structure-cold-${index}`, source: result.source });
      expect(result.snapshot.svg!.svg).toBe(cold.snapshot.svg!.svg);
      expect(paragraphGeometry(result.snapshot)).toEqual(paragraphGeometry(cold.snapshot));
    }
  });

  it("lays math, links, footnotes and columns out again as a fresh render does after a picture changes length", async () => {
    const source = SOURCE.replace("Text after the picture, with $x^2$.", String.raw`Text after with $\frac{x^2}{1+y}$ and \href{https://example.test}{a link}.
\[\begin{aligned} a &= b+c \\ d &= e \end{aligned}\]
\begin{block}{Later block}Text with a \footnote{Later footnote.}\end{block}
\begin{columns}\column{.4\textwidth}Left.\column{.4\textwidth}Right.\end{columns}`);
    const request = { id: "rich-seed", documentId: "overlay-rich-reports", source, sourceRevision: 0,
      activeRootId: "frame:0", includeDrawingLayer: true, drawingLayerRootId: "frame:0:overlay:0" };
    await computeSnapshot(request);
    const next = source.replace("(0,1)", "(0.125,1)");
    const result = await computeSnapshot({ ...request, id: "rich-drag", source: next, sourceRevision: 1,
      trigger: "drag-element", changedSourceIds: ["path:0"], patches: [computeMinimalReplacementPatch(source, next)], patchBaseRevision: 0 });
    const canonical = await computeSnapshot({ ...request, id: "rich-cold", source: next, documentId: "overlay-rich-cold" });
    expect(result.snapshot.incremental?.deckLayoutReused).toBe(false);
    const normalize = (value: unknown) => JSON.parse(JSON.stringify(value, (key, entry: unknown) =>
      key === "paragraphId" ? undefined : entry)) as unknown;
    expect(normalize(result.snapshot.deck!.activeFrame!.layout.paragraphs))
      .toEqual(normalize(canonical.snapshot.deck!.activeFrame!.layout.paragraphs));
    expect(result.snapshot.deck!.activeFrame!.layout.spacing).toEqual(canonical.snapshot.deck!.activeFrame!.layout.spacing);
    expect(result.snapshot.deck!.activeFrame!.svgModel).toEqual(canonical.snapshot.deck!.activeFrame!.svgModel);
  });

  it("does not publish a canceled drag's slide or incremental baseline", async () => {
    const request = { id: "seed", documentId: "overlay-canceled", source: SOURCE, sourceRevision: 0,
      activeRootId: "frame:0", includeDrawingLayer: true, drawingLayerRootId: "frame:0:overlay:0" };
    const seed = await computeSnapshot(request);
    const source = SOURCE.replace("(0,1)", "(0.125,1)");
    const controller = new AbortController();
    const drag = { ...request, id: "canceled", source, sourceRevision: 1, trigger: "drag-element" as const,
      changedSourceIds: ["path:0"], patches: [computeMinimalReplacementPatch(SOURCE, source)], patchBaseRevision: 0 };
    await expect(computeSnapshot(drag, { budgetMs: 0, signal: controller.signal,
      yieldControl: async () => { controller.abort(); } })).rejects.toMatchObject({ name: "AbortError" });
    expect(claimCachedDeckSnapshot(drag)).toBeNull();
    // Pages painted with a layer stay out of the shared page cache (drawingLayerPage).
    expect(claimCachedDeckSnapshot(request)?.deck?.activeFrame).not.toBe(seed.snapshot.deck!.activeFrame);
    const retried = await computeSnapshot({ ...drag, id: "retry" });
    expect(retried.snapshot.incremental).toMatchObject({ parseStrategy: "incremental", strategy: "incremental", deckLayoutReused: keepsLength(SOURCE, source) });
    const canonical = await computeSnapshot({ ...request, id: "cold", documentId: "overlay-canceled-cold", source });
    expect(retried.snapshot.svg?.svg).toBe(canonical.snapshot.svg?.svg);
    expect(paragraphGeometry(retried.snapshot)).toEqual(paragraphGeometry(canonical.snapshot));
  });

  it("invalidates the slide layout and layer checkpoints when slide text or step changes", async () => {
    const documentId = "overlay-invalidated";
    await computeSnapshot({ id: "seed", documentId, source: SOURCE, sourceRevision: 0,
      activeRootId: "frame:0", includeDrawingLayer: true });
    const source = SOURCE.replace("Before.", "A much longer paragraph before the overlay picture.\\pause Later.");
    const result = await computeSnapshot({ id: "changed-text", documentId, source, sourceRevision: 1,
      activeRootId: "frame:0", includeDrawingLayer: true, trigger: "drag-element", changedSourceIds: ["path:0"] });
    expect(result.snapshot.incremental?.deckLayoutReused).not.toBe(true);
    const later = await computeSnapshot({ id: "step-2", documentId, source, sourceRevision: 1,
      activeRootId: "frame:0", includeDrawingLayer: true, deckStep: 2, trigger: "drag-element", changedSourceIds: ["path:0"] });
    expect(later.snapshot.deck!.activeFrame!.step).toBe(2);
    expect(later.snapshot.incremental?.strategy).not.toBe("incremental");
  });
});
