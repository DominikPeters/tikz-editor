import { describe, expect, it } from "vitest";
import { applyDeckEditAction, prepareBeamerDocument, type BeamerGraphicsPlacement } from "../packages/core/src/beamer/index.js";
import type { DocumentGraphicsResolver } from "../packages/core/src/graphics/index.js";

const resolver: DocumentGraphicsResolver = { cacheKey: "insert-test", resolve: () => ({ status: "resolved", mimeType: "image/png", dataBase64: "", naturalWidthPt: 120, naturalHeightPt: 60, revision: "1" }) };
const document = (body: string) => `\\documentclass{beamer}\n\\begin{document}\n\\begin{frame}{Results}${body}\\end{frame}\n\\end{document}`;

async function insert(source: string, placement: BeamerGraphicsPlacement, path = "figures/plot.png", widthFraction: number | null = 0.5) {
  const layout = (await prepareBeamerDocument(source).renderFrame({ frameIndex: 0, step: 1, graphicsResolver: resolver })).layout;
  const result = applyDeckEditAction(source, layout, { kind: "deckInsertGraphics", frameId: layout.frameId, path, widthFraction, placement });
  if (result.kind !== "success") throw new Error(result.kind === "unsupported" ? result.reason : result.kind);
  const after = (await prepareBeamerDocument(result.newSource).renderFrame({ frameIndex: 0, step: 1, graphicsResolver: resolver })).layout;
  expect(after.graphics).toHaveLength(1);
  return result.newSource;
}

describe("inserting an image on a slide", () => {
  it("appends a centred image after the last content, in its indentation", async () => {
    const source = document("\n  Some text.\n\n");
    expect(await insert(source, { kind: "end" })).toBe(document("\n  Some text.\n  \\begin{center}\n    \\includegraphics[width=0.5\\linewidth]{figures/plot.png}\n  \\end{center}\n\n"));
  });

  it("fills an empty frame", async () => {
    expect(await insert(document(""), { kind: "end" }, "a.png", null)).toBe(document("\n\\begin{center}\n  \\includegraphics{a.png}\n\\end{center}\n"));
    expect(await insert(document("\n"), { kind: "end" }, "a.png", null)).toBe(document("\n\\begin{center}\n  \\includegraphics{a.png}\n\\end{center}\n"));
  });

  it("goes in at a text caret, keeping words apart", async () => {
    const source = document("\nBefore after.\n");
    const caret = source.indexOf(" after");
    expect(await insert(source, { kind: "caret", offset: caret })).toContain("Before \\includegraphics[width=0.5\\linewidth]{figures/plot.png} after.");
  });

  it("goes after a selected object", async () => {
    const source = document("\n\\begin{block}{B}x\\end{block}\nTail\n");
    const span = { from: source.indexOf("\\begin{block}"), to: source.indexOf("\\end{block}") + "\\end{block}".length };
    expect(await insert(source, { kind: "after", span })).toContain("\\end{block}\n\\begin{center}\n  \\includegraphics[width=0.5\\linewidth]{figures/plot.png}\n\\end{center}\nTail");
  });

  it("refuses carets outside the frame text and paths TeX cannot read literally", async () => {
    const source = document("\n$x+y$ text\n");
    await expect(insert(source, { kind: "caret", offset: source.indexOf("+") })).rejects.toThrow("Images go in the text");
    await expect(insert(source, { kind: "end" }, "my%file.png")).rejects.toThrow("literally");
  });
});
