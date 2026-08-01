import { describe, expect, it } from "vitest";

import { renderBeamerFrame } from "../packages/core/src/beamer/index.js";
import { maskSourceOutsideSpan } from "../packages/core/src/document/masking.js";
import { computeSnapshot } from "../packages/app/src/compute";

const SOURCE = [
  "\\documentclass{beamer}",
  "\\begin{document}",
  "\\begin{frame}{Nested demo}",
  "Intro line before the picture.",
  "\\begin{tikzpicture}",
  "\\node[draw, fill=blue!20] (a) at (0,0) {Alpha};",
  "\\node[draw] (b) at (3,1) {Beta};",
  "\\draw[->] (a) -- (b);",
  "\\end{tikzpicture}",
  "Text after the picture.",
  "\\end{frame}",
  "\\end{document}",
].join("\n");

describe("nested TikZ figure editing", () => {
  it("publishes the document root id on embedded picture layout items", async () => {
    const result = await renderBeamerFrame(SOURCE, { frameIndex: 0 });
    const items = result.layout.items.filter((item) => item.kind === "tikzpicture");
    expect(items).toHaveLength(1);
    expect(items[0].rootId).toBe("frame:0:tikzpicture:0");
  });

  it("masks everything outside a span while preserving offsets", () => {
    const masked = maskSourceOutsideSpan("abc\ndef\nghi", { from: 4, to: 7 });
    expect(masked).toBe("   \ndef\n   ");
    expect(masked.length).toBe(11);
  });

  it("computes a tikz-shaped snapshot for a nested picture root", async () => {
    const response = await computeSnapshot({
      id: "nested-test",
      documentId: "doc-nested",
      source: SOURCE,
      activeRootId: "frame:0:tikzpicture:0",
    });
    const snapshot = response.snapshot;
    // Tikz-shaped: deck empty, scene/handles present, real source retained.
    expect(snapshot.deck).toBeNull();
    expect(snapshot.source).toBe(SOURCE);
    expect(snapshot.figures).toHaveLength(1);
    expect(snapshot.editHandles.length).toBeGreaterThan(0);
    expect(snapshot.svg).not.toBeNull();
    // Absolute spans: the parsed figure sits exactly on the picture's
    // offsets in the REAL source.
    const figure = snapshot.figures[0];
    expect(SOURCE.slice(figure.span.from, figure.span.to)).toMatch(
      /^\\begin\{tikzpicture\}[\s\S]*\\end\{tikzpicture\}$/
    );
    // Edit handles reference true offsets: the Alpha node's coordinate
    // handle slices the REAL source to its coordinate text.
    expect(
      snapshot.editHandles.some(
        (handle) =>
          SOURCE.slice(
            handle.sourceRef.sourceSpan.from,
            handle.sourceRef.sourceSpan.to
          ) === "(0,0)"
      )
    ).toBe(true);
  });

  it("falls back to the deck when the addressed picture does not exist", async () => {
    const response = await computeSnapshot({
      id: "nested-missing",
      documentId: "doc-nested",
      source: SOURCE,
      activeRootId: "frame:0:tikzpicture:5",
    });
    expect(response.snapshot.deck).not.toBeNull();
  });
});
