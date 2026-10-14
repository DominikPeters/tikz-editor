import { describe, expect, it } from "vitest";

import { createIncrementalParseSession, parseTikz } from "../packages/core/src/parser/index.js";
import { computeMinimalReplacementPatch } from "../packages/core/src/edit/patch.js";

const PICTURE_PREFIX = "\\begin{tikzpicture}\n";

function wrap(body: string): string {
  return `${PICTURE_PREFIX}${body}\n\\end{tikzpicture}`;
}

/** Span of the first node's text (between its braces) in `source`. */
function nodeTextSpan(source: string, text: string): { from: number; to: number } {
  const from = source.indexOf(text);
  expect(from).toBeGreaterThan(-1);
  return { from, to: from + text.length };
}

function statementSpans(result: ReturnType<typeof parseTikz>): Array<{ from: number; to: number }> {
  return result.figure.body.map((statement) => ({ ...statement.span }));
}

describe("parseTikz structural masks", () => {
  const balancedBody = [
    "\\node at (0,0) {hello};",
    "\\node at (2,0) {world};",
    "\\draw (0,0) -- (2,0);"
  ].join("\n");

  it("keeps document structure stable while the masked span is unbalanced", () => {
    const midEdit = wrap([
      "\\node at (0,0) {hello \\textbf{};",
      "\\node at (2,0) {world};",
      "\\draw (0,0) -- (2,0);"
    ].join("\n"));
    const mask = nodeTextSpan(midEdit, "hello \\textbf{");

    const unmasked = parseTikz(midEdit, { recover: true });
    const masked = parseTikz(midEdit, { recover: true, structuralMasks: [mask] });

    // Without the mask, recovery swallows the rest of the picture into one
    // statement; with it, all three statements survive.
    expect(unmasked.figure.body.length).toBe(1);
    expect(masked.figure.body.length).toBe(3);
    expect(midEdit.slice(masked.figure.body[1].span.from, masked.figure.body[1].span.to))
      .toBe("\\node at (2,0) {world};");
  });

  it("suppresses the unclosed-node-text diagnostic while masked", () => {
    const midEdit = wrap("\\node at (0,0) {hello \\textbf{};");
    const mask = nodeTextSpan(midEdit, "hello \\textbf{");

    const unmasked = parseTikz(midEdit, { recover: true });
    const masked = parseTikz(midEdit, { recover: true, structuralMasks: [mask] });

    expect(unmasked.diagnostics.some((d) => d.message.includes("Unclosed node text"))).toBe(true);
    expect(masked.diagnostics.some((d) => d.message.includes("Unclosed node text"))).toBe(false);
  });

  it("slices node text from the real input, not the masked parse source", () => {
    const midEdit = wrap("\\node at (0,0) {hello \\textbf{};");
    const mask = nodeTextSpan(midEdit, "hello \\textbf{");
    const masked = parseTikz(midEdit, { recover: true, structuralMasks: [mask] });

    const statement = masked.figure.body[0];
    const texts: string[] = [];
    const collect = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(collect); return; }
      const record = value as Record<string, unknown>;
      if (record.kind === "Node" && typeof record.text === "string") {
        texts.push(record.text);
      }
      Object.values(record).forEach(collect);
    };
    collect(statement);
    expect(texts).toContain("hello \\textbf{");
  });

  it("keeps stray close-brace and dollar edits contained", () => {
    for (const editedText of ["hel}lo", "hello $", "hello \\textbf{ more", "{{{"]) {
      const body = [
        `\\node at (0,0) {${editedText}};`,
        "\\node at (2,0) {world};",
        "\\draw (0,0) -- (2,0);"
      ].join("\n");
      const source = wrap(body);
      const masked = parseTikz(source, {
        recover: true,
        structuralMasks: [nodeTextSpan(source, editedText)]
      });
      expect(masked.figure.body.length, `edited text: ${editedText}`).toBe(3);
    }
  });

  it("keeps figure terminators inside the edited text from truncating the picture", () => {
    const editedText = "hello \\end{tikzpicture}";
    const source = wrap([
      `\\node at (0,0) {${editedText}};`,
      "\\node at (2,0) {world};",
      "\\draw (0,0) -- (2,0);"
    ].join("\n"));
    const masked = parseTikz(source, {
      recover: true,
      structuralMasks: [nodeTextSpan(source, editedText)]
    });

    expect(masked.figures).toHaveLength(1);
    expect(masked.figures[0]?.span.to).toBe(source.length);
    expect(masked.figure.body.length).toBe(3);
    expect(source.slice(masked.figure.body[1].span.from, masked.figure.body[1].span.to))
      .toBe("\\node at (2,0) {world};");
  });

  it("is a no-op for balanced content", () => {
    const source = wrap(balancedBody);
    const mask = nodeTextSpan(source, "hello");
    const unmasked = parseTikz(source, { recover: true });
    const masked = parseTikz(source, { recover: true, structuralMasks: [mask] });
    expect(statementSpans(masked)).toEqual(statementSpans(unmasked));
    expect(masked.diagnostics).toEqual(unmasked.diagnostics);
  });

  it("preserves newlines inside the masked span", () => {
    const multiLineText = "first line \\textbf{\nsecond line";
    const source = wrap(`\\node[align=left] at (0,0) {${multiLineText}};\n\\node at (2,0) {world};`);
    const masked = parseTikz(source, {
      recover: true,
      structuralMasks: [nodeTextSpan(source, multiLineText)]
    });
    expect(masked.figure.body.length).toBe(2);
  });

  it("clamps out-of-range mask spans without crashing", () => {
    const source = wrap(balancedBody);
    expect(() =>
      parseTikz(source, {
        recover: true,
        structuralMasks: [{ from: -5, to: source.length + 100 }]
      })
    ).not.toThrow();
  });
});

describe("incremental structural masks", () => {
  const initial = wrap("\\node at (0,0) {hello};\n\\node at (2,0) {world};\n\\draw (0,0) -- (2,0);");

  it("contains unfinished text and picture delimiters while reusing the following statements", () => {
    const session = createIncrementalParseSession();
    session.evaluate({ source: initial, sourceRevision: 0 });
    let source = initial;
    for (const [index, text] of ["hello \\textbf{", "hello \\end{tikzpicture}\n{{{", "finished"].entries()) {
      const oldText = index === 0 ? "hello" : index === 1 ? "hello \\textbf{" : "hello \\end{tikzpicture}\n{{{";
      const next = source.replace(oldText, text);
      const masks = [nodeTextSpan(next, text)];
      const result = session.evaluate({ source: next, sourceRevision: index + 1,
        structuralMasks: masks, changedSourceIds: ["path:0"],
        patches: [computeMinimalReplacementPatch(source, next)], patchBaseRevision: index });
      const cold = parseTikz(next, { recover: true, structuralMasks: masks });
      expect(result.stats).toMatchObject({ strategy: "incremental", reparsedStatementCount: 1, reusedStatementCount: 2 });
      expect(result.parse.figure).toEqual(cold.figure);
      expect(result.parse.figures).toEqual(cold.figures);
      expect(result.parse.diagnostics).toEqual(cold.diagnostics);
      expect(result.parse.tree).toMatchObject({ length: cold.tree.length, topNode: { name: cold.tree.topNode.name } });
      source = next;
    }
  });

  it("reparses when a mask is removed without a source change", () => {
    const source = initial.replace("hello", "hello \\textbf{");
    const session = createIncrementalParseSession();
    session.evaluate({ source, structuralMasks: [nodeTextSpan(source, "hello \\textbf{")] });
    const result = session.evaluate({ source });
    expect(result.stats).toMatchObject({ strategy: "full", fallbackReason: "structural-mask-changed" });
    expect(result.parse.figure).toEqual(parseTikz(source, { recover: true }).figure);
    expect(result.parse.figure.body).toHaveLength(1);
  });

  it("invalidates a mask change outside the edited statement", () => {
    const session = createIncrementalParseSession();
    session.evaluate({ source: initial, sourceRevision: 0 });
    const source = initial.replace("hello", "longer");
    const masks = [nodeTextSpan(source, "world")];
    const result = session.evaluate({ source, sourceRevision: 1, structuralMasks: masks,
      changedSourceIds: ["path:0"], patches: [computeMinimalReplacementPatch(initial, source)], patchBaseRevision: 0 });
    expect(result.stats).toMatchObject({ strategy: "full", fallbackReason: "structural-mask-changed" });
    expect(result.parse.figure).toEqual(parseTikz(source, { recover: true, structuralMasks: masks }).figure);
  });

  it("rebases an unchanged mask past an earlier edit", () => {
    const source = initial.replace("world", "world \\textbf{");
    const session = createIncrementalParseSession();
    session.evaluate({ source, sourceRevision: 0, structuralMasks: [nodeTextSpan(source, "world \\textbf{")] });
    const next = source.replace("hello", "a much longer first label");
    const masks = [nodeTextSpan(next, "world \\textbf{")];
    const result = session.evaluate({ source: next, sourceRevision: 1, structuralMasks: masks,
      changedSourceIds: ["path:0"], patches: [computeMinimalReplacementPatch(source, next)], patchBaseRevision: 0 });
    expect(result.stats.strategy).toBe("incremental");
    expect(result.parse.figure).toEqual(parseTikz(next, { recover: true, structuralMasks: masks }).figure);
  });
});
