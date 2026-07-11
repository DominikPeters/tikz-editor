import { describe, expect, it } from "vitest";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { collectSymbols } from "../packages/core/src/completion/index.js";

describe("collectSymbols", () => {
  it("collects node names, coordinate names, and style names", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{
    box/.style={draw,rounded corners},
    accent/.append style={fill=blue!20}
  }
  \tikzstyle{legacy}=[red]
  \pgfkeys{/tikz/helper/.style={thick}}

  \node (A) at (0,0) {A};
  \path (0,0) node[name=mid,alias=middle] {M}
    coordinate (p1) at (1,0)
    coordinate (p2) at (2,1);
\end{tikzpicture}`;
    const parseResult = parseTikz(source, { recover: true });

    const symbols = collectSymbols({ parseResult });

    expect(symbols.nodeNames).toEqual(expect.arrayContaining(["A", "mid", "middle"]));
    expect(symbols.coordinateNames).toEqual(expect.arrayContaining(["p1", "p2"]));
    expect(symbols.styleNames).toEqual(expect.arrayContaining(["accent", "box", "helper", "legacy"]));
  });

  it("collects standalone node command names and normalizes namespaced styles", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{
    /tikz/nsbox/.style={draw},
    /pgf/nshelper/.prefix style={line width=1pt},
    plain={not a style}
  }
  \node[draw] (standalone) at (0,0) {S};
  \node (bad name) at (1,0) {Bad};
\end{tikzpicture}`;
    const parseResult = parseTikz(source, { recover: true });

    const symbols = collectSymbols({ parseResult });

    expect(symbols.nodeNames).toContain("standalone");
    expect(symbols.nodeNames).toContain("bad name");
    expect(symbols.styleNames).toEqual(expect.arrayContaining(["nsbox", "nshelper"]));
    expect(symbols.styleNames).not.toContain("plain");
  });

  it("uses recovered parser output for malformed node and style declarations", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{/.style={draw}, later/.style={blue}}
  \pgfkeys{plain={not a style}}
  \tikzstyle{  /tikz/legacy spaced  }=[red]
  \tikzstyle broken
  \node[draw] {no name};
  \node[draw] (afterOptions) {A};
  \node (invalid name) {B};
\end{tikzpicture}`;
    const parseResult = parseTikz(source, { recover: true });

    const symbols = collectSymbols({ parseResult });

    expect(symbols.nodeNames).toContain("afterOptions");
    expect(symbols.nodeNames).toContain("invalid name");
    expect(symbols.styleNames).toEqual(expect.arrayContaining(["later", "legacy spaced"]));
    expect(symbols.styleNames).not.toContain("");
    expect(symbols.styleNames).not.toContain("plain");
  });

  it("keeps symbols after an unterminated brace group swallows the parse tail", () => {
    const source = String.raw`\begin{tikzpicture}
  \pgfkeys{\broken without close
  \node[draw] (standalone) at (0,0) {S};
\end{tikzpicture}`;
    const parseResult = parseTikz(source, { recover: true });

    const symbols = collectSymbols({ parseResult });

    expect(symbols.nodeNames).toContain("standalone");
  });

  it("keeps symbols below a style key being typed", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{typing/.sty
  \node (n1) at (0,0) {A};
\end{tikzpicture}`;
    const parseResult = parseTikz(source, { recover: true });

    const symbols = collectSymbols({ parseResult });

    expect(symbols.nodeNames).toContain("n1");
  });

  it("keeps later styles and nodes after an unclosed brace in node text", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (first) at (0,0) {open {brace};
  \tikzset{later/.style={draw}}
  \node (second) at (1,0) {B};
\end{tikzpicture}`;
    const parseResult = parseTikz(source, { recover: true });

    const symbols = collectSymbols({ parseResult });

    expect(symbols.nodeNames).toEqual(expect.arrayContaining(["first", "second"]));
    expect(symbols.styleNames).toContain("later");
  });

  it("collects node names from to/edge operation node payloads", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) to node (edgeLabel) {E} (1,1);
\end{tikzpicture}`;
    const parseResult = parseTikz(source, { recover: true });

    const symbols = collectSymbols({ parseResult });
    expect(symbols.nodeNames).toContain("edgeLabel");
  });

  it("infers node names from unnamed parsed node templates", () => {
    const parseResult = {
      source: "",
      figure: {
        body: [
          {
            kind: "Path",
            items: [
              {
                kind: "Node",
                id: "node:0",
                span: { from: 0, to: 0 },
                raw: "node (templateName) {T}",
                templateRaw: "node (templateName) {T}",
                aliases: ["", "aliasName"],
                textSource: "group",
                textSpan: { from: 0, to: 0 },
                text: "T"
              },
              {
                kind: "Node",
                id: "node:1",
                span: { from: 0, to: 0 },
                raw: "node (same) at (same) {S}",
                templateRaw: "node (same) {S}",
                atRaw: "(same)",
                textSource: "group",
                textSpan: { from: 0, to: 0 },
                text: "S"
              },
              {
                kind: "Node",
                id: "node:2",
                span: { from: 0, to: 0 },
                raw: "node {N}",
                templateRaw: "node {N}",
                textSource: "group",
                textSpan: { from: 0, to: 0 },
                text: "N"
              }
            ]
          }
        ]
      }
    };

    const symbols = collectSymbols({ parseResult: parseResult as never });

    expect(symbols.nodeNames).toContain("templateName");
    expect(symbols.nodeNames).toContain("aliasName");
    expect(symbols.nodeNames).not.toContain("same");
  });

  it("returns empty collections without a parse result", () => {
    expect(collectSymbols({ parseResult: null })).toEqual({
      nodeNames: [],
      styleNames: [],
      coordinateNames: []
    });
  });
});
