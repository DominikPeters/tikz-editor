import { describe, expect, it } from "vitest";

import { BEAMER_DRAWING_LAYER, beamerDrawingLayerInsertions, renderBeamerFrame, scanBeamerDocument } from "../packages/core/src/beamer/index.js";
import { createBeamerSyntaxContext } from "../packages/core/src/beamer/syntax.js";
import { formatDocumentRootId, parseDocumentRootId } from "../packages/core/src/document/root-id.js";
import { worldPoint } from "../packages/core/src/coords/points.js";
import { pt } from "../packages/core/src/coords/scalars.js";
import { computeSnapshot } from "../packages/app/src/compute";
import { deckDrawingLayerRootId } from "../packages/app/src/drawing-layer";
import { executeDocumentEdit } from "../packages/app/src/edit-execution";

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

describe("where a new drawing layer goes", () => {
  it("joins the body's last text, inside the lists it ends in and past a trailing comment", () => {
    const context = createBeamerSyntaxContext(SOURCE);
    const [plain] = beamerDrawingLayerInsertions(context, bodyOf(SOURCE, 1));
    expect(SOURCE.slice(0, plain.at).endsWith("Some text here.")).toBe(true);
    expect(plain.text).toBe("%\n" + BEAMER_DRAWING_LAYER);
    const [list] = beamerDrawingLayerInsertions(context, bodyOf(SOURCE, 2));
    expect(SOURCE.slice(0, list.at).endsWith("\\item Second % a note")).toBe(true);
  });

  it("moves none of the frame's text when it joins the last line", async () => {
    for (const frameIndex of [1, 2]) {
      const [joined] = beamerDrawingLayerInsertions(createBeamerSyntaxContext(SOURCE), bodyOf(SOURCE, frameIndex));
      const inserted = SOURCE.slice(0, joined.at) + joined.text + SOURCE.slice(joined.at);
      const before = await renderBeamerFrame(SOURCE, { frameIndex });
      const after = await renderBeamerFrame(inserted, { frameIndex });
      expect(after.layout.paragraphs.map(paragraph => paragraph.bounds)).toEqual(before.layout.paragraphs.map(paragraph => paragraph.bounds));
    }
  });

  it("offers a paragraph of its own as the fallback", () => {
    const candidates = beamerDrawingLayerInsertions(createBeamerSyntaxContext(SOURCE), bodyOf(SOURCE, 3));
    expect(candidates.at(-1)?.text).toBe("\n\n" + BEAMER_DRAWING_LAYER);
  });
});

describe("drawing layer snapshots", () => {
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
    const deck = await computeSnapshot({ id: "deck", documentId: "doc-layer", source: SOURCE, activeRootId: "frame:1" });
    expect(deckDrawingLayerRootId("frame:1", deck.snapshot)).toBe("frame:1:overlay:0");
    const { snapshot } = await computeSnapshot({ id: "virtual", documentId: "doc-layer", source: SOURCE, activeRootId: "frame:1:overlay:0" });
    const layer = snapshot.overlayLayer!;
    expect(layer.insertion?.text).toBe("%\n" + BEAMER_DRAWING_LAYER);
    // A rectangle from (2,3) to (4,4) cm on the page, given in the picture's world.
    const world = (x: number, y: number) => worldPoint(pt(x * PT_PER_CM + layer.evaluate.currentPage.minX), pt(y * PT_PER_CM + layer.evaluate.currentPage.minY));
    const toPicture = (point: ReturnType<typeof world>) => worldPoint(pt(point.x - layer.evaluate.currentPage.minX), pt(point.y - layer.evaluate.currentPage.minY));
    const result = executeDocumentEdit(
      { documentId: "doc-layer", source: SOURCE, sourceRevision: 1, activeRootId: "frame:1:overlay:0", snapshot },
      { kind: "addElement", at: toPicture(world(2, 3)), template: { kind: "rectangle", corner: toPicture(world(4, 4)) } }
    );
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.patches).toHaveLength(1);
    expect(result.newSource).toContain("Some text here.%\n" + String.raw`\begin{tikzpicture}[remember picture, overlay, shift={(current page.south west)}]`);
    expect(result.newSource).toContain(String.raw`\draw (2,3) rectangle (4,4);`);
    expect(result.newSource.match(/tikzpicture\}\[remember/gu)).toHaveLength(2);
    // Then the layer exists: the same root id addresses it.
    const after = await computeSnapshot({ id: "after", documentId: "doc-layer", source: result.newSource, activeRootId: "frame:1:overlay:0" });
    expect(after.snapshot.overlayLayer?.insertion).toBeNull();
    expect(after.snapshot.scene!.elements.length).toBeGreaterThan(0);
  });

  it("fall back to the deck for a layer that is neither there nor next", async () => {
    const response = await computeSnapshot({ id: "missing", documentId: "doc-layer", source: SOURCE, activeRootId: "frame:0:overlay:3" });
    expect(response.snapshot.deck).not.toBeNull();
  });
});
