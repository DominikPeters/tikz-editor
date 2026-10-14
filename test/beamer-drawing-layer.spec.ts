import { describe, expect, it } from "vitest";

import { BEAMER_DRAWING_LAYER, BEAMER_TIKZ_LAYER, BEAMER_TIKZ_LAYER_DEFINITION, beamerDrawingLayerInsertions, beamerTikzLayerPreambleInsertion, beamerTikzLayerState, renderBeamerFrame, scanBeamerDocument } from "../packages/core/src/beamer/index.js";
import { createBeamerSyntaxContext } from "../packages/core/src/beamer/syntax.js";
import { formatDocumentRootId, parseDocumentRootId } from "../packages/core/src/document/root-id.js";
import { worldPoint } from "../packages/core/src/coords/points.js";
import { pt } from "../packages/core/src/coords/scalars.js";
import { computeSnapshot } from "../packages/app/src/compute";
import { deckDrawingLayerRootId } from "../packages/app/src/drawing-layer";
import { executeDocumentEdit } from "../packages/app/src/edit-execution";
import { patchesMatchSourceTransition } from "../packages/core/src/edit/source-patches.js";

import { reconcileEditingIdentities } from "../packages/app/src/editing-identities";

const LAYER = String.raw`\begin{tikzpicture}[remember picture, overlay, shift={(current page.south west)}]
  \draw[fill=orange!20] (1.2,5.5) rectangle (5.0,7.1);
  \node[anchor=north west, draw] at (8.3,7.9) {Key result};
\end{tikzpicture}`;

const SOURCE = String.raw`\documentclass{beamer}
\usepackage{tikz}
\begin{document}
\begin{frame}{With a layer}
A first paragraph of text.

${LAYER}
\end{frame}
\begin{frame}{Without}
Some text here.
\end{frame}
\begin{frame}{A list}
\begin{itemize}
\item First
\item Second % a note
\end{itemize}
\end{frame}
\begin{frame}{A display}
Text
\[ x^2 \]
\end{frame}
\end{document}`;

const PT_PER_CM = 28.4527559055;

function bodyOf(source: string, frameIndex: number) {
  return scanBeamerDocument(source).frames[frameIndex].bodySpan;
}

describe("drawing layer root ids", () => {
  it("address a frame's overlay pictures apart from its pictures", () => {
    const layer = { kind: "beamer-frame-tikz", frameIndex: 2, index: 1, layer: true } as const;
    expect(formatDocumentRootId(layer)).toBe("frame:2:overlay:1");
    expect(parseDocumentRootId("frame:2:overlay:1")).toEqual(layer);
    expect(parseDocumentRootId("frame:2:tikzpicture:1")).toEqual({ kind: "beamer-frame-tikz", frameIndex: 2, index: 1 });
  });
});

const DEFINED = SOURCE.replace("\\usepackage{tikz}\n", "\\usepackage{tikz}\n" + BEAMER_TIKZ_LAYER_DEFINITION + "\n");
const THEIRS = SOURCE.replace("\\usepackage{tikz}\n", "\\usepackage{tikz}\n\\newenvironment{tikzlayer}{\\begin{center}}{\\end{center}}\n");

describe("the tikzlayer environment", () => {
  it.each([
    ["no definition", SOURCE, "none"],
    ["the editor's definition", DEFINED, "ours"],
    ["the editor's definition, spaced differently", SOURCE.replace("\\usepackage{tikz}\n", "\\usepackage{tikz}\n" + BEAMER_TIKZ_LAYER_DEFINITION.replace(/\n\s*/gu, "") + "\n"), "ours"],
    ["a definition of the author's", THEIRS, "theirs"],
    ["the editor's, later redefined", DEFINED.replace("\\begin{document}", "\\renewenvironment{tikzlayer}{}{}\n\\begin{document}"), "theirs"],
    ["a command of that name", SOURCE.replace("\\begin{document}", "\\newcommand\\tikzlayer{x}\n\\begin{document}"), "theirs"],
    ["a definition commented out", SOURCE.replace("\\begin{document}", "% \\newenvironment{tikzlayer}{}{}\n\\begin{document}"), "none"],
  ])("is the editor's only when every definition is its own: %s", (_, source, state) => {
    expect(beamerTikzLayerState(source)).toBe(state);
  });

  it("is a drawing layer only when it is the editor's", async () => {
    const layer = String.raw`\begin{tikzlayer}
\node at (2,3) {Added};
\end{tikzlayer}`;
    const ours = await renderBeamerFrame(DEFINED.replace("Some text here.", "Some text here.\n\n" + layer), { frameIndex: 1 });
    expect(ours.diagnostics).toEqual([]);
    expect(ours.layout.embeddedTikz.map(picture => picture.overlay?.rootId)).toEqual(["frame:1:overlay:0"]);
    // As TeX reads the author's own environment, not as a drawing.
    const theirs = await renderBeamerFrame(THEIRS.replace("Some text here.", "Some text here.\n\n" + layer), { frameIndex: 1 });
    expect(theirs.layout.embeddedTikz.some(picture => picture.overlay)).toBe(false);
  });
});

describe("where a new drawing layer goes", () => {
  it("is a tikzlayer at the end of the frame's top level, defined with the first one", () => {
    for (const frameIndex of [1, 2, 3]) {
      const [first] = beamerDrawingLayerInsertions(createBeamerSyntaxContext(SOURCE), bodyOf(SOURCE, frameIndex));
      expect(first).toEqual({ at: expect.any(Number), text: "\n\n" + BEAMER_TIKZ_LAYER, definesLayer: true });
      expect(SOURCE.slice(first.at, bodyOf(SOURCE, frameIndex).to).trim()).toBe("");
    }
    const [defined] = beamerDrawingLayerInsertions(createBeamerSyntaxContext(DEFINED), bodyOf(DEFINED, 2));
    expect(defined.definesLayer).toBeUndefined();
  });

  it("moves none of the frame's text (LuaLaTeX agrees: test/fixtures/beamer/overlay-pictures-fidelity)", async () => {
    for (const [source, frameIndex] of [[DEFINED, 1], [DEFINED, 2], [DEFINED, 3], [THEIRS, 1], [THEIRS, 2]] as const) {
      const [joined] = beamerDrawingLayerInsertions(createBeamerSyntaxContext(source), bodyOf(source, frameIndex));
      const inserted = source.slice(0, joined.at) + joined.text + source.slice(joined.at);
      const before = await renderBeamerFrame(source, { frameIndex });
      const after = await renderBeamerFrame(inserted, { frameIndex });
      // To 0.001pt: a paragraph that gains the layer's empty line adds 0pt to its height.
      const bounds = (layout: typeof before.layout) => layout.paragraphs.map(({ bounds }) => [bounds.x, bounds.y, bounds.width, bounds.height].map(value => value.toFixed(3)));
      expect({ frameIndex, theirs: source === THEIRS, bounds: bounds(after.layout) }).toEqual({ frameIndex, theirs: source === THEIRS, bounds: bounds(before.layout) });
      expect(after.layout.embeddedTikz.some(entry => entry.overlay)).toBe(true);
    }
  });

  it("is a plain picture where the document has a tikzlayer of its own: after a list \\nointerlineskip, after text a % line", () => {
    const context = createBeamerSyntaxContext(THEIRS);
    const [list] = beamerDrawingLayerInsertions(context, bodyOf(THEIRS, 2));
    expect(THEIRS.slice(0, list.at).endsWith("\\end{itemize}")).toBe(true);
    expect(list.text).toBe("\n\\nointerlineskip\n" + BEAMER_DRAWING_LAYER);
    const [plain] = beamerDrawingLayerInsertions(context, bodyOf(THEIRS, 1));
    expect(THEIRS.slice(0, plain.at).endsWith("Some text here.")).toBe(true);
    expect(plain.text).toBe("\n%\n" + BEAMER_DRAWING_LAYER);
    expect(beamerDrawingLayerInsertions(context, bodyOf(THEIRS, 3)).at(-1)?.text).toBe("\n\n" + BEAMER_DRAWING_LAYER);
  });

  it("puts the definition after TikZ, loading TikZ only where no package does", () => {
    expect(beamerTikzLayerPreambleInsertion(DEFINED, false)).toBeNull();
    const after = beamerTikzLayerPreambleInsertion(SOURCE, true)!;
    expect(SOURCE.slice(0, after.at).endsWith("\\usepackage{tikz}\n")).toBe(true);
    expect(after.text).toBe(BEAMER_TIKZ_LAYER_DEFINITION + "\n");
    for (const packageSource of [String.raw`\usepackage[foo]{tikz}`, String.raw`\RequirePackage{amsmath,tikz}`, String.raw`\usepackage{pgfplots}`]) {
      expect(beamerTikzLayerPreambleInsertion(SOURCE.replace(String.raw`\usepackage{tikz}`, packageSource), false)).toBeNull();
    }
    const missing = SOURCE.replace(String.raw`\usepackage{tikz}`, "% \\usepackage{tikz}");
    expect(beamerTikzLayerPreambleInsertion(missing, true)?.text).toBe("\\usepackage{tikz}\n" + BEAMER_TIKZ_LAYER_DEFINITION + "\n");
  });
});

describe("drawing layer snapshots", () => {
  it("removes a picture whose last drawing leaves empty scopes", async () => {
    const source = SOURCE.replace(LAYER, String.raw`\begin{tikzpicture}[overlay, remember picture]
\begin{scope}[red]\draw (0,0) -- (1,1);\end{scope}
\end{tikzpicture}`);
    const { snapshot } = await computeSnapshot({ id: "empty-scope", source, activeRootId: "frame:0", includeDrawingLayer: true });
    const result = executeDocumentEdit(
      { documentId: "empty-scope", source, sourceRevision: 1, activeRootId: "frame:0", snapshot },
      { kind: "deleteElements", elementIds: [...new Set(snapshot.scene!.elements.map(element => element.sourceRef.sourceId))] }
    );
    expect(result.kind).toBe("success");
    if (result.kind === "success") expect(result.newSource).not.toContain("\\begin{tikzpicture}");
  });
  it("provides drawing geometry while retaining the slide root and page", async () => {
    const { snapshot } = await computeSnapshot({ id: "slide-geometry", source: SOURCE, activeRootId: "frame:0", includeDrawingLayer: true });
    expect(snapshot.activeRootId).toBe("frame:0");
    expect(snapshot.deck?.activeFrame?.frameId).toBe("frame:0");
    expect(snapshot.overlayLayer?.pageCoordinates).toBe(true);
    expect(snapshot.svg?.viewBox.x).toBe(0);
    expect(snapshot.svg?.viewBox.y).toBe(0);
    const result = executeDocumentEdit(
      { documentId: "slide", source: SOURCE, sourceRevision: 1, activeRootId: "frame:0", snapshot },
      { kind: "deleteElements", elementIds: ["path:0", "path:1"] }
    );
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain(LAYER);
    expect(result.newSource).not.toContain("\\begin{tikzpicture}");
    expect(result.newSource).toContain("A first paragraph of text.");
    expect(patchesMatchSourceTransition(SOURCE, result.newSource, result.patches)).toBe(true);
  });

  it("removes a generated wrapper with its final object and keeps the slide active", async () => {
    const { snapshot } = await computeSnapshot({ id: "slide-virtual", source: SOURCE, activeRootId: "frame:2", drawingLayerRootId: "frame:2:overlay:0", includeDrawingLayer: true });
    const context = { documentId: "virtual-slide", source: SOURCE, sourceRevision: 1, activeRootId: "frame:2", snapshot };
    const added = executeDocumentEdit(context, { kind: "addElement", at: worldPoint(pt(60), pt(60)), template: { kind: "node", text: "Added" } });
    expect(added.kind).toBe("success");
    if (added.kind !== "success") return;
    expect(added.newSource).toContain("\\end{itemize}\n\n\\begin{tikzlayer}\n");
    expect(added.newSource).toContain("\\usepackage{tikz}\n" + BEAMER_TIKZ_LAYER_DEFINITION + "\n");
    const rendered = await computeSnapshot({ id: "slide-created", source: added.newSource, activeRootId: "frame:2", includeDrawingLayer: true });
    const removed = executeDocumentEdit({ ...context, source: added.newSource, snapshot: rendered.snapshot }, { kind: "deleteElements", elementIds: ["path:0"] });
    expect(removed.kind).toBe("success");
    if (removed.kind !== "success") return;
    // The definition stays.
    expect(removed.newSource).toBe(DEFINED);
    expect(patchesMatchSourceTransition(added.newSource, removed.newSource, removed.patches)).toBe(true);
  });

  it("can create a drawing on the first step when the frame ends in paused content", async () => {
    const source = SOURCE.replace("Some text here.", String.raw`First.\pause Second.`);
    const { snapshot } = await computeSnapshot({ id: "before-pause", source, activeRootId: "frame:1:overlay:0", deckStep: 1 });
    expect(snapshot.overlayLayer).toBeDefined();
    expect(snapshot.overlayLayer?.step).toBe(1);
    expect(snapshot.overlayLayer?.insertion).not.toBeNull();
    const result = executeDocumentEdit(
      { documentId: "before-pause", source, sourceRevision: 1, activeRootId: "frame:1:overlay:0", snapshot },
      { kind: "addElement", at: worldPoint(pt(20), pt(30)), template: { kind: "node", text: "Added" } }
    );
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    for (const step of [1, 2]) {
      const after = await renderBeamerFrame(result.newSource, { frameIndex: 1, step });
      expect(after.layout.embeddedTikz[0].overlay?.rootId).toBe("frame:1:overlay:0");
      expect(after.diagnostics).toEqual([]);
    }
  });

  it("adds TikZ to the preamble in the same transaction as the first drawing", async () => {
    const source = SOURCE.replace(String.raw`\usepackage{tikz}`, "% \\usepackage{tikz}");
    const { snapshot } = await computeSnapshot({ id: "no-package", source, activeRootId: "frame:1:overlay:0" });
    const result = executeDocumentEdit(
      { documentId: "no-package", source, sourceRevision: 1, activeRootId: "frame:1:overlay:0", snapshot },
      { kind: "addElement", at: worldPoint(pt(20), pt(30)), template: { kind: "node", text: "Added" } }
    );
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\usepackage{tikz}\n" + BEAMER_TIKZ_LAYER_DEFINITION + "\n\\begin{document}");
    expect(result.patches).toHaveLength(2);
    expect(patchesMatchSourceTransition(source, result.newSource, result.patches)).toBe(true);
  });

  it.each(["only", "uncover"])("creates a visible layer after existing pictures hidden by %s on this step", async command => {
    const source = SOURCE.replace(LAYER, `\\${command}<2>{${LAYER}}`);
    const deck = await computeSnapshot({ id: "hidden-deck", source, activeRootId: "frame:0", deckStep: 1 });
    const rootId = deckDrawingLayerRootId("frame:0", deck.snapshot);
    expect(rootId).toBe("frame:0:overlay:1");
    const { snapshot } = await computeSnapshot({ id: "hidden-layer", source, activeRootId: rootId, deckStep: 1 });
    expect(snapshot.overlayLayer?.insertion).not.toBeNull();
    expect(snapshot.overlayLayer?.step).toBe(1);
    const result = executeDocumentEdit(
      { documentId: "hidden", source, sourceRevision: 1, activeRootId: rootId, snapshot },
      { kind: "addElement", at: worldPoint(pt(20), pt(30)), template: { kind: "node", text: "Added" } }
    );
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(`\\${command}<2>{${LAYER}}`);
    const rendered = await renderBeamerFrame(result.newSource, { frameIndex: 0, step: 1 });
    expect(rendered.layout.embeddedTikz.map(picture => picture.overlay?.rootId)).toEqual([rootId]);
  });

  it("invalidates placement when remember picture changes", async () => {
    await computeSnapshot({ id: "remembered", source: SOURCE, activeRootId: "frame:0:overlay:0" });
    const source = SOURCE.replace("remember picture, overlay", "overlay");
    const { snapshot } = await computeSnapshot({ id: "not-remembered", source, activeRootId: "frame:0:overlay:0" });
    expect(snapshot.overlayLayer?.evaluate.currentPage.minX).toBe(0);
    expect(snapshot.overlayLayer?.evaluate.currentPage.minY).toBe(0);
  });

  it("clamps the requested step to the step actually rendered", async () => {
    const { snapshot } = await computeSnapshot({ id: "clamped", source: SOURCE, activeRootId: "frame:0:overlay:0", deckStep: 99 });
    expect(snapshot.overlayLayer?.step).toBe(1);
  });

  it("rejects edits during a switch to another layer, even in the same source", async () => {
    const source = SOURCE.replace(LAYER, LAYER + "\n" + LAYER);
    const { snapshot } = await computeSnapshot({ id: "switch-layer", source, activeRootId: "frame:0:overlay:0" });
    const result = executeDocumentEdit(
      { documentId: "switch", source, sourceRevision: 1, activeRootId: "frame:0:overlay:1", snapshot },
      { kind: "addElement", at: worldPoint(pt(20), pt(30)), template: { kind: "node", text: "Added" } }
    );
    expect(result.kind).toBe("unsupported");
  });

  it("owns editing identities separately for layers whose local parser root is figure:0", async () => {
    const source = SOURCE.replace(LAYER, LAYER + "\n" + LAYER);
    const first = await computeSnapshot({ id: "identity-layer-0", source, activeRootId: "frame:0:overlay:0" });
    const second = await computeSnapshot({ id: "identity-layer-1", source, activeRootId: "frame:0:overlay:1" });
    expect(first.snapshot.activeRootId).toBe(second.snapshot.activeRootId);
    const before = reconcileEditingIdentities(undefined, first.snapshot, "identities");
    const after = reconcileEditingIdentities({ ...before, selection: [before.entries[0].id] }, second.snapshot, "identities");
    expect(after.rootId).toBe("frame:0:overlay:1");
    expect(after.selection).toBeNull();
    const oldIds = new Set(before.entries.map(entry => entry.id));
    expect(after.entries.every(entry => !oldIds.has(entry.id))).toBe(true);
  });

  it("render an overlay picture in its own coordinates with the page as its view box and the slide as backdrop", async () => {
    const deck = await computeSnapshot({ id: "deck", documentId: "doc-layer", source: SOURCE, activeRootId: "frame:0" });
    const placed = deck.snapshot.deck!.activeFrame!.layout.embeddedTikz.find(picture => picture.overlay)!;
    expect(placed.overlay!.rootId).toBe("frame:0:overlay:0");
    expect(deckDrawingLayerRootId("frame:0", deck.snapshot)).toBe("frame:0:overlay:0");

    const response = await computeSnapshot({ id: "layer", documentId: "doc-layer", source: SOURCE, activeRootId: "frame:0:overlay:0" });
    const { snapshot } = response;
    expect(snapshot.deck).toBeNull();
    expect(snapshot.source).toBe(SOURCE);
    const layer = snapshot.overlayLayer!;
    expect(layer.insertion).toBeNull();
    expect(layer.origin).toEqual(placed.overlay!.origin);
    const page = deck.snapshot.deck!.activeFrame!.layout.page.page;
    expect(snapshot.svg!.viewBox).toEqual({ x: -layer.origin.x, y: layer.origin.y - page.height, width: page.width, height: page.height });
    expect(layer.evaluate.currentPage).toEqual({ minX: -layer.origin.x, minY: layer.origin.y - page.height, maxX: page.width - layer.origin.x, maxY: layer.origin.y });
    // The picture's shift puts its coordinates on the page's lower-left corner.
    expect(snapshot.scene!.rootTransform).toMatchObject({ a: 1, d: 1, e: -layer.origin.x, f: layer.origin.y - page.height });
    // Spans are the real source's.
    const figure = snapshot.figures[0];
    expect(SOURCE.slice(figure.span.from, figure.span.to)).toBe(LAYER);
    // The backdrop is the slide without the picture.
    expect(deck.snapshot.deck!.activeFrame!.svg).toContain(`data-source-id="path:0"`);
    expect(layer.backdropSvg).not.toContain(`data-source-id="path:0"`);
    expect(layer.backdropSvg.length).toBeGreaterThan(1000);
  });

  it("show a frame without one its layer still to come, and the first shape inserts it in one edit", async () => {
    const deck = await computeSnapshot({ id: "deck", documentId: "doc-layer", source: DEFINED, activeRootId: "frame:1" });
    expect(deckDrawingLayerRootId("frame:1", deck.snapshot)).toBe("frame:1:overlay:0");
    const { snapshot } = await computeSnapshot({ id: "virtual", documentId: "doc-layer", source: DEFINED, activeRootId: "frame:1:overlay:0" });
    const layer = snapshot.overlayLayer!;
    expect(layer.insertion?.text).toBe("\n\n" + BEAMER_TIKZ_LAYER);
    expect(layer.insertion?.preamble).toBeNull();
    expect(layer.evaluate.pictureOptions).toBe("remember picture, overlay, shift={(current page.south west)}");
    // A rectangle from (2,3) to (4,4) cm on the page, given in the picture's world.
    const world = (x: number, y: number) => worldPoint(pt(x * PT_PER_CM + layer.evaluate.currentPage.minX), pt(y * PT_PER_CM + layer.evaluate.currentPage.minY));
    const toPicture = (point: ReturnType<typeof world>) => worldPoint(pt(point.x - layer.evaluate.currentPage.minX), pt(point.y - layer.evaluate.currentPage.minY));
    const result = executeDocumentEdit(
      { documentId: "doc-layer", source: DEFINED, sourceRevision: 1, activeRootId: "frame:1:overlay:0", snapshot },
      { kind: "addElement", at: toPicture(world(2, 3)), template: { kind: "rectangle", corner: toPicture(world(4, 4)) } }
    );
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.patches).toHaveLength(1);
    expect(result.newSource).toContain("Some text here.\n\n\\begin{tikzlayer}\n");
    expect(result.newSource).toContain(String.raw`\draw (2,3) rectangle (4,4);`);
    expect(result.newSource.match(/\\begin\{tikzlayer\}/gu)).toHaveLength(1);
    // Then the layer exists: the same root id addresses it.
    const after = await computeSnapshot({ id: "after", documentId: "doc-layer", source: result.newSource, activeRootId: "frame:1:overlay:0" });
    expect(after.snapshot.overlayLayer?.insertion).toBeNull();
    expect(after.snapshot.scene!.elements.length).toBeGreaterThan(0);
  });

  it("make the layer of an empty frame a tikzlayer too, though it adds the frame's only paragraph", async () => {
    const source = DEFINED.replace("Some text here.\n", "");
    const { snapshot } = await computeSnapshot({ id: "empty", documentId: "doc-empty", source, activeRootId: "frame:1:overlay:0" });
    expect(snapshot.overlayLayer?.insertion?.text).toBe("\n" + BEAMER_TIKZ_LAYER);
  });

  it("fall back to the deck for a layer that is neither there nor next", async () => {
    const response = await computeSnapshot({ id: "missing", documentId: "doc-layer", source: SOURCE, activeRootId: "frame:0:overlay:3" });
    expect(response.snapshot.deck).not.toBeNull();
  });
});
