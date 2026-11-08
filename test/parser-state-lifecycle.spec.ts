import { describe, expect, it } from "vitest";
import { createIncrementalParseSession, parseTikz, type ParseTikzOptions } from "../packages/core/src/parser/index.js";

const SOURCE = String.raw`% document context
\begin{tikzpicture}
\node at (0,0) {first};
\node at (1,0) {good};
\end{tikzpicture}`;

describe("parser validation state", () => {
  it("adds, replaces, and removes text validation on an unchanged cached source", () => {
    const session = createIncrementalParseSession();
    session.prime(parseTikz(SOURCE));
    const validators: ParseTikzOptions["nodeTextValidator"][] = [
      ({ node }) => node.text === "first" ? { message: "First validator" } : null,
      ({ node }) => node.text === "good" ? { message: "Second validator" } : null,
      undefined
    ];
    for (const nodeTextValidator of validators) {
      const current = session.evaluate({ source: SOURCE, nodeTextValidator });
      expect(current.parse.diagnostics).toEqual(parseTikz(SOURCE, { nodeTextValidator }).diagnostics);
    }
  });

  it("validates changed nodes against document source and document spans", () => {
    const session = createIncrementalParseSession();
    session.prime(parseTikz(SOURCE));
    const next = SOURCE.replace("{good}", "{bad}");
    const nodeTextValidator: ParseTikzOptions["nodeTextValidator"] = ({ node, source }) =>
      node.text === "bad" && source.startsWith("% document context") && source.slice(node.textSpan.from, node.textSpan.to) === "bad"
        ? { message: "Invalid document text" } : null;
    const current = session.evaluate({ source: next, inferChanges: true, nodeTextValidator });
    expect(current.parse.diagnostics).toEqual(parseTikz(next, { nodeTextValidator }).diagnostics);
    expect(current.parse.diagnostics).toHaveLength(1);
  });

  it("revalidates unchanged nodes when another statement changes their validation context", () => {
    const nodeTextValidator: ParseTikzOptions["nodeTextValidator"] = ({ node, source }) =>
      node.text === "first" && source.includes("{bad}") ? { message: "Context changed" } : null;
    const session = createIncrementalParseSession();
    session.prime(parseTikz(SOURCE, { nodeTextValidator }));
    const next = SOURCE.replace("{good}", "{bad}");
    const current = session.evaluate({ source: next, inferChanges: true, nodeTextValidator });
    expect(current.parse.diagnostics).toEqual(parseTikz(next, { nodeTextValidator }).diagnostics);
    expect(current.parse.diagnostics).toHaveLength(1);
  });

  it("retains an explicitly installed validator until it is explicitly cleared", () => {
    const nodeTextValidator: ParseTikzOptions["nodeTextValidator"] = ({ node }) =>
      node.text === "first" ? { message: "Invalid first node" } : null;
    const session = createIncrementalParseSession();
    session.prime(parseTikz(SOURCE));
    session.evaluate({ source: SOURCE, nodeTextValidator });
    expect(session.evaluate({ source: SOURCE }).parse.diagnostics).toHaveLength(1);
    session.evaluate({ source: SOURCE, nodeTextValidator: undefined });
    expect(session.evaluate({ source: SOURCE }).parse.diagnostics).toEqual([]);
  });

  it("does not install a validator whose evaluation throws", () => {
    const session = createIncrementalParseSession();
    session.prime(parseTikz(SOURCE));
    expect(() => session.evaluate({ source: SOURCE, nodeTextValidator: () => { throw new Error("Validation failed"); } })).toThrow("Validation failed");
    expect(session.evaluate({ source: SOURCE }).parse.diagnostics).toEqual([]);
  });

  it("keeps syntax diagnostics even when a validator uses the same diagnostic code", () => {
    const source = SOURCE.replace("{good}", "{good}\n\\draw (0,0) -- ;");
    const syntax = parseTikz(source).diagnostics;
    expect(syntax.length).toBeGreaterThan(0);
    const nodeTextValidator: ParseTikzOptions["nodeTextValidator"] = ({ node }) =>
      node.text === "first" ? { code: syntax[0].code, message: "Text validation" } : null;
    const session = createIncrementalParseSession();
    session.prime(parseTikz(source, { nodeTextValidator }));
    expect(session.evaluate({ source, nodeTextValidator: undefined }).parse.diagnostics).toEqual(syntax);
  });
});
