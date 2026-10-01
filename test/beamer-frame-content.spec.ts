import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseBeamerFrameBody,
  scanBeamerDocument,
} from "../packages/core/src/beamer/index.js";

const FIXTURE_PATH = new URL(
  "./fixtures/beamer/kkt_theorem_beamer.tex",
  import.meta.url
);

describe("Beamer frame content frontend", () => {
  it("lowers title-page and standalone vertical-space commands into frame flow", () => {
    const source = readFileSync(FIXTURE_PATH, "utf8");
    const document = scanBeamerDocument(source);
    const ir = parseBeamerFrameBody({
      source,
      frame: document.frames[0],
    });

    expect(ir.diagnostics).toEqual([]);
    expect(ir.children.map((node) => node.kind)).toEqual([
      "title-page",
      "vertical-space",
      "tikzpicture",
    ]);
    expect(ir.children[0]).toMatchObject({
      kind: "title-page",
      id: "frame:0:title-page:0",
    });
    expect(ir.children[1]).toMatchObject({
      kind: "vertical-space",
      id: "frame:0:vspace:0",
      starred: false,
      value: expect.objectContaining({ value: "-1em" }),
    });
  });

  it("lowers columns into ordered, source-backed flow nodes", () => {
    const source = readFileSync(FIXTURE_PATH, "utf8");
    const document = scanBeamerDocument(source);
    const ir = parseBeamerFrameBody({
      source,
      frame: document.frames[1],
    });

    expect(ir.diagnostics).toEqual([]);
    expect(ir.children).toHaveLength(1);
    const columns = ir.children[0];
    expect(columns.kind).toBe("columns");
    if (columns.kind !== "columns") {
      throw new Error("Expected columns.");
    }
    expect(columns.options?.value).toBe(String.raw`T,totalwidth=\textwidth`);
    expect(columns.alignment).toBe("T");
    expect(columns.columns.map((column) => column.alignment)).toEqual([
      "T",
      "T",
    ]);
    expect(columns.columns.map((column) => column.width.value)).toEqual([
      ".55\\textwidth",
      ".42\\textwidth",
    ]);
    expect(columns.columns[0]?.children.map((node) => node.kind)).toEqual([
      "paragraph",
      "vertical-space",
      "list",
    ]);
    expect(columns.columns[1]?.children.map((node) => node.kind)).toEqual([
      "tikzpicture",
    ]);
    for (const column of columns.columns) {
      for (const node of column.children) {
        expect(source.slice(node.span.from, node.span.to).trim()).not.toBe("");
      }
    }
  });

  it("preserves columns alignment and resolves per-column overrides", () => {
    const source = String.raw`
\documentclass{beamer}
\begin{document}
\begin{frame}
\begin{columns}[T,totalwidth={.8\textwidth}]
  \begin{column}[b]{\textwidth}Bottom\end{column}
\end{columns}
\end{frame}
\end{document}`;
    const document = scanBeamerDocument(source);
    const ir = parseBeamerFrameBody({
      source,
      frame: document.frames[0],
    });
    const columns = ir.children[0];
    expect(columns.kind).toBe("columns");
    if (columns.kind !== "columns") {
      throw new Error("Expected columns.");
    }

    expect(columns.alignment).toBe("T");
    expect(columns.columns[0]).toMatchObject({
      alignment: "bottom",
      options: expect.objectContaining({ value: "b" }),
      width: expect.objectContaining({ value: String.raw`\textwidth` }),
    });
  });

  it("retains non-column bodies as text leaves", () => {
    const source = String.raw`
\documentclass{beamer}
\begin{document}
\begin{frame}{A}Plain body.\end{frame}
\end{document}`;
    const document = scanBeamerDocument(source);
    const ir = parseBeamerFrameBody({
      source,
      frame: document.frames[0],
    });

    expect(ir.children).toEqual([
      expect.objectContaining({
        kind: "paragraph",
        span: expect.objectContaining({
          from: source.indexOf("Plain body."),
        }),
      }),
    ]);
  });

  it("extracts a frame-root TikZ picture with its owning center alignment", () => {
    const source = readFileSync(FIXTURE_PATH, "utf8");
    const document = scanBeamerDocument(source);
    const ir = parseBeamerFrameBody({
      source,
      frame: document.frames[15],
    });

    expect(ir.diagnostics).toEqual([]);
    expect(ir.children).toHaveLength(1);
    const tikz = ir.children[0];
    expect(tikz).toMatchObject({
      kind: "tikzpicture",
      horizontalAlignment: "center",
    });
    if (tikz.kind !== "tikzpicture") {
      throw new Error("Expected a centered TikZ picture.");
    }
    expect(source.slice(tikz.span.from, tikz.span.to)).toContain(
      String.raw`\begin{center}`
    );
    expect(source.slice(tikz.root.span.from, tikz.root.span.to)).toMatch(
      /^\\begin\{tikzpicture\}[\s\S]*\\end\{tikzpicture\}$/u
    );
  });

  it("lowers theme-decorated blocks at the frame root and inside columns", () => {
    const source = readFileSync(FIXTURE_PATH, "utf8");
    const document = scanBeamerDocument(source);
    const takeaways = parseBeamerFrameBody({
      source,
      frame: document.frames[19],
    });

    expect(takeaways.diagnostics).toEqual([]);
    expect(takeaways.children.map((node) => node.kind)).toEqual([
      "paragraph",
      "columns",
    ]);
    const columns = takeaways.children[1];
    expect(columns.kind).toBe("columns");
    if (columns.kind !== "columns") {
      throw new Error("Expected columns.");
    }
    expect(columns.columns).toHaveLength(3);
    expect(
      columns.columns.map((column) =>
        column.children.map((node) => node.kind)
      )
    ).toEqual([["block"], ["block"], ["block"]]);
    const blocks = columns.columns.map((column) => column.children[0]);
    for (const block of blocks) {
      expect(block.kind).toBe("block");
      if (block.kind !== "block") {
        throw new Error("Expected block.");
      }
      expect(block.environment).toBe("block");
      expect(block.children.map((node) => node.kind)).toEqual(["paragraph"]);
      expect(source.slice(block.span.from, block.span.to)).toContain(
        String.raw`\begin{block}`
      );
    }
    expect(
      blocks.map((block) => block.kind === "block" && block.title.value)
    ).toEqual(["Necessary", "Sufficient", "Useful"]);

    const pitfalls = parseBeamerFrameBody({
      source,
      frame: document.frames[18],
    });
    expect(pitfalls.children.map((node) => node.kind)).toEqual([
      "paragraph",
      "block",
    ]);
  });
});
