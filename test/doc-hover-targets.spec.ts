import { describe, expect, it } from "vitest";

import { parseSyntax } from "@tikz-editor/lezer-tikz";
import { resolveDocHoverTarget } from "../packages/core/src/completion/doc-hover.js";

function resolveAt(sourceWithCursor: string) {
  const marker = "<|>";
  const pos = sourceWithCursor.indexOf(marker);
  if (pos < 0) {
    throw new Error("Missing <|> cursor marker");
  }
  const source = sourceWithCursor.slice(0, pos) + sourceWithCursor.slice(pos + marker.length);
  const tree = parseSyntax(source);
  return resolveDocHoverTarget({ source, tree, pos });
}

function fakeNode(name: string, from: number, to: number, parent: unknown = null) {
  return { name, from, to, parent };
}

function resolveWithFakeNode(source: string, node: unknown, pos = 0) {
  const tree = {
    resolveInner: () => node
  };
  return resolveDocHoverTarget({ source, tree: tree as never, pos });
}

describe("resolveDocHoverTarget", () => {
  it("returns null for empty source", () => {
    const tree = parseSyntax("");
    expect(resolveDocHoverTarget({ source: "", tree, pos: 0 })).toBeNull();
  });

  it("falls back from TikzFile boundary nodes to adjacent syntax nodes", () => {
    const left = fakeNode("DrawCmd", 0, 5);
    const right = fakeNode("PathOperator", 6, 8);
    const tikzFile = fakeNode("TikzFile", 0, 8);
    const tree = {
      resolveInner: (pos: number) => {
        if (pos === 4) return left;
        if (pos === 7) return right;
        return tikzFile;
      }
    };

    const leftTarget = resolveDocHoverTarget({ source: String.raw`\draw --`, tree: tree as never, pos: 5 });
    const rightTarget = resolveDocHoverTarget({ source: String.raw`\draw --`, tree: tree as never, pos: 6 });

    expect(leftTarget?.kind).toBe("command");
    expect(rightTarget?.kind).toBe("operator");
    expect(resolveDocHoverTarget({ source: "x", tree: { resolveInner: () => tikzFile } as never, pos: 0 })).toBeNull();
  });

  it("resolves option keys using parser-derived key spans", () => {
    const target = resolveAt(String.raw`\draw[line wi<|>dth=2pt, red] (0,0) -- (1,1);`);
    expect(target).not.toBeNull();
    expect(target?.kind).toBe("option-key");
    expect(target?.query).toBe("line width");
    expect(target?.candidates[0]).toBe("line width");
    expect(target?.candidates).toContain("/tikz/line width");
  });

  it("resolves option values back to their option key", () => {
    const target = resolveAt(String.raw`\draw[line width=2<|>pt] (0,0) -- (1,1);`);
    expect(target).not.toBeNull();
    expect(target?.kind).toBe("option-value");
    expect(target?.query).toBe("line width");
  });

  it("resolves flag options", () => {
    const flag = resolveAt(String.raw`\draw[thi<|>ck, red] (0,0) -- (1,1);`);
    expect(flag).not.toBeNull();
    expect(flag?.kind).toBe("option-key");
    expect(flag?.query).toBe("thick");
    expect(flag?.candidates).toContain("/tikz/thick");
  });

  it("normalizes namespaced option hover candidates", () => {
    const tikzSource = "[/tikz/rounded corners=true]";
    const tikzOptionList = fakeNode("OptionList", 0, tikzSource.length);
    const tikzTarget = resolveWithFakeNode(tikzSource, fakeNode("Identifier", 1, 22, tikzOptionList), 8);
    expect(tikzTarget?.candidates).toEqual(["/tikz/rounded corners", "rounded corners"]);

    const pgfSource = "[/pgf/line width=0.4pt]";
    const pgfOptionList = fakeNode("OptionList", 0, pgfSource.length);
    const pgfTarget = resolveWithFakeNode(pgfSource, fakeNode("Identifier", 1, 16, pgfOptionList), 8);
    expect(pgfTarget?.candidates).toEqual(["/pgf/line width", "line width"]);

    const namespaceOnlySource = "[/tikz/=true]";
    const namespaceOnlyOptionList = fakeNode("OptionList", 0, namespaceOnlySource.length);
    const namespaceOnlyTarget = resolveWithFakeNode(
      namespaceOnlySource,
      fakeNode("Identifier", 1, 7, namespaceOnlyOptionList),
      3
    );
    expect(namespaceOnlyTarget?.candidates).toEqual(["/tikz/"]);
  });

  it("resolves supported commands", () => {
    const target = resolveAt(String.raw`\dr<|>aw (0,0) -- (1,1);`);
    expect(target).not.toBeNull();
    expect(target?.kind).toBe("command");
    expect(target?.query).toBe(String.raw`\draw`);
  });

  it("resolves supported operators", () => {
    const target = resolveAt(String.raw`\draw (0,0) -<|>| (1,1);`);
    expect(target).not.toBeNull();
    expect(target?.kind).toBe("operator");
    expect(target?.query).toBe("-|");
  });

  it("resolves supported keywords", () => {
    const target = resolveAt(String.raw`\draw (0,0) t<|>o (1,1);`);
    expect(target).not.toBeNull();
    expect(target?.kind).toBe("keyword");
    expect(target?.query).toBe("to");
    expect(target?.candidates).toContain("/tikz/to");
  });

  it("returns null in comments", () => {
    const target = resolveAt(String.raw`% \draw[line wi<|>dth=2pt]`);
    expect(target).toBeNull();
  });

  it("returns null away from supported tokens and option spans", () => {
    expect(resolveAt(String.raw`\draw[line width=2pt] (0,0<|>) -- (1,1);`)).toBeNull();
    expect(resolveAt(String.raw`\draw[draw=red,<|>] (0,0) -- (1,1);`)).toBeNull();
  });

  it("handles malformed synthetic hover tokens defensively", () => {
    expect(resolveWithFakeNode("", fakeNode("DrawCmd", 0, 0))).toBeNull();
    expect(resolveWithFakeNode("draw", fakeNode("DrawCmd", 0, 4))).toBeNull();
    expect(resolveWithFakeNode("\\", fakeNode("DrawCmd", 0, 1))).toBeNull();
    expect(resolveWithFakeNode("+", fakeNode("PathOperator", 0, 1))).toBeNull();
    expect(resolveWithFakeNode("   ", fakeNode("PathOperator", 0, 3))).toBeNull();
  });

});
