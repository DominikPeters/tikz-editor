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
  it("lowers columns into ordered, source-backed flow nodes", () => {
    const source = readFileSync(FIXTURE_PATH, "utf8");
    const document = scanBeamerDocument(source);
    const ir = parseBeamerFrameBody({
      source,
      frame: document.frames[1]!,
    });

    expect(ir.diagnostics).toEqual([]);
    expect(ir.children).toHaveLength(1);
    const columns = ir.children[0]!;
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
      frame: document.frames[0]!,
    });
    const columns = ir.children[0]!;
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
      frame: document.frames[0]!,
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
});
