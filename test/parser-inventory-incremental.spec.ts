import { describe, expect, it } from "vitest";

import { createIncrementalParseSession, parseTikz } from "../packages/core/src/parser/index.js";

function documentWithLabel(text: string, lineBreak = "\n"): string {
  return [
    String.raw`\begin{tikzpicture}`,
    String.raw`\draw (0,0) -- (1,0);`,
    String.raw`\end{tikzpicture}`,
    String.raw`\begin{tikzpicture}`,
    `\\node {${text}};`,
    String.raw`\draw (1,0) -- (2,0);`,
    String.raw`\end{tikzpicture}`,
    String.raw`\begin{tikzpicture*}`,
    String.raw`\draw (2,0) -- (3,0);`,
    String.raw`\end{tikzpicture*}`
  ].join(lineBreak);
}

function expectIncrementalInventoryParity(source: string, next: string): void {
  const options = { activeFigureId: "figure:1" };
  const initial = parseTikz(source, options);
  const session = createIncrementalParseSession();
  session.prime(initial, options);
  const result = session.evaluate({ source: next, inferChanges: true, ...options });
  const fresh = parseTikz(next, options);
  expect(result.stats.strategy).toBe("incremental");
  expect(result.stats.reparsedStatementCount).toBe(1);
  expect(result.stats.reusedStatementCount).toBe(1);
  expect(result.parse.figures).toEqual(fresh.figures);
  expect(result.parse.figures[0]).toEqual(initial.figures[0]);
  expect(result.parse.figure).toEqual(fresh.figure);
  expect(result.parse.diagnostics).toEqual(fresh.diagnostics);
  expect(syntaxSpans(result.parse)).toEqual(syntaxSpans(fresh));
  expect(result.parse.figure.body.map(({ id }) => id)).toEqual(initial.figure.body.map(({ id }) => id));
  const reused = session.evaluate({ source: next, ...options });
  expect(reused.stats.strategy).toBe("reused");
  expect(reused.parse.figures).toEqual(fresh.figures);
}

function syntaxSpans(parse: ReturnType<typeof parseTikz>): string[] {
  const spans: string[] = [];
  parse.tree.iterate({ enter(node) { spans.push(`${node.name}:${node.from}:${node.to}`); } });
  return spans;
}

describe("incremental figure inventory lines", () => {
  it.each(["\n", "\r\n", "\r"])("updates all following figures after inserting %j in a statement", (lineBreak) => {
    expectIncrementalInventoryParity(documentWithLabel("First", lineBreak), documentWithLabel(`First${lineBreak}line`, lineBreak));
  });

  it.each(["\n", "\r\n", "\r"])("updates all following figures after removing %j from a statement", (lineBreak) => {
    expectIncrementalInventoryParity(documentWithLabel(`First${lineBreak}line`, lineBreak), documentWithLabel("Firstline", lineBreak));
  });

  it.each([
    { name: "joining CR and LF after deleting their separator", old: "\rX\n", next: "\r\n" },
    { name: "splitting CRLF with inserted text", old: "\r\n", next: "\rX\n" },
    { name: "completing CR with LF", old: "\r", next: "\r\n" },
    { name: "completing LF with CR", old: "\n", next: "\r\n" },
    { name: "removing the CR from CRLF", old: "\r\n", next: "\n" },
    { name: "removing the LF from CRLF", old: "\r\n", next: "\r" },
    { name: "changing CRLF into two breaks", old: "\r\n", next: "\n\r" },
    { name: "changing two breaks into CRLF", old: "\n\r", next: "\r\n" }
  ])("matches fresh inventory while $name", ({ old, next }) => {
    expectIncrementalInventoryParity(documentWithLabel(`Left${old}Right`), documentWithLabel(`Left${next}Right`));
  });

  it("keeps current lines and original source spans through repeated edits and reuse", () => {
    const session = createIncrementalParseSession();
    const options = { activeFigureId: "figure:1" };
    session.prime(parseTikz(documentWithLabel("First"), options), options);
    for (const label of ["First\nline", "First\r\nline\rmore", "First", "First\rline"]) {
      const source = documentWithLabel(label);
      const result = session.evaluate({ source, inferChanges: true, ...options });
      const fresh = parseTikz(source, options);
      expect(result.stats.strategy).toBe("incremental");
      expect(result.parse.figures).toEqual(fresh.figures);
      expect(result.parse.figure).toEqual(fresh.figure);
      const reused = session.evaluate({ source, ...options });
      expect(reused.stats.strategy).toBe("reused");
      expect(reused.parse.figures).toEqual(fresh.figures);
    }
  });

  it.each(["begin", "end"])("retains incremental parity beside a commented fake %s delimiter", (kind) => {
    const label = `First% \\${kind}{tikzpicture*}\nline`;
    expectIncrementalInventoryParity(documentWithLabel(label), documentWithLabel(label.replace("First", "Changed")));
    expectIncrementalInventoryParity(documentWithLabel(label), documentWithLabel(label.replace("% ", "% more ")));
  });

  it.each(["begin", "end"])("rebuilds inventory when an escaped percent activates a fake %s delimiter", (kind) => {
    const source = documentWithLabel(`First% \\${kind}{tikzpicture}\nline`);
    const next = source.replace(`% \\${kind}`, `\\% \\${kind}`);
    const options = { activeFigureId: "figure:1" };
    const session = createIncrementalParseSession();
    session.prime(parseTikz(source, options), options);
    const result = session.evaluate({ source: next, inferChanges: true, ...options });
    const fresh = parseTikz(next, options);
    expect(result.stats.strategy).toBe("full");
    expect(result.parse.figures).toEqual(fresh.figures);
    expect(result.parse.figure).toEqual(fresh.figure);
    expect(result.parse.diagnostics).toEqual(fresh.diagnostics);
  });

  it("keeps the lexical inventory current after editing inline verbatim content", () => {
    const source = documentWithLabel(String.raw`First \verb|\begin{tikzpicture}\end{tikzpicture}| line`);
    const next = source.replace("First", "Changed\nFirst");
    const options = { activeFigureId: "figure:1" };
    const session = createIncrementalParseSession();
    session.prime(parseTikz(source, options), options);
    const result = session.evaluate({ source: next, inferChanges: true, ...options });
    const fresh = parseTikz(next, options);
    expect(result.parse.figures).toEqual(fresh.figures);
    expect(result.parse.figures).toHaveLength(3);
    expect(result.parse.figure).toEqual(fresh.figure);
    expect(result.parse.diagnostics).toEqual(fresh.diagnostics);
  });
});
