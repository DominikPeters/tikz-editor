import { describe, expect, it } from "vitest";
import type { Tree } from "@lezer/common";
import { parseTexSyntax } from "@tikz-editor/lezer-tex";
import { parseSimpleTexParagraphIr } from "../packages/core/src/text/tex/ir.js";

function syntaxErrors(tree: Tree) {
  const errors: { from: number; to: number }[] = [];
  tree.iterate({ enter(node) { if (node.type.isError) errors.push({ from: node.from, to: node.to }); } });
  return errors;
}
const alignment = (body: string) => String.raw`Alpha \begin{align*}a&=b\\\intertext{${body}}c&=d\end{align*} Beta`;

describe("AMS intertext uses a text-mode argument", () => {
  it.each([
    "where $x$ holds", "where $x_i=y^2$ holds", "where ${x}$ holds",
    String.raw`where \textbf{equations} and \(x_i=y^2\) hold`,
    String.raw`price \$5 and $x$`, "where equations hold",
  ])("retains the authored outer display and text/inline grammar for %s", body => {
    const source = alignment(body);
    const tree = parseTexSyntax(source, { top: "TexFragment" });
    expect(syntaxErrors(tree)).toEqual([]);
    const environment = tree.topNode.getChildren("FragmentItem").map(item => item.getChild("TexItem")?.getChild("MathEnvironment"))
      .find(node => node !== null && node !== undefined);
    expect(environment).toBeDefined();
    // MathItems preceding intertext are separate siblings.
    const textCommand = environment?.getChildren("MathItem").map(item => item.getChild("MathTextCommand"))
      .find(node => node?.getChild("MathTextCmd"));
    expect(textCommand).toBeDefined();
    const group = textCommand?.getChild("Group");
    expect(group).not.toBeNull();
    expect(source.slice(group!.from + 1, group!.to - 1)).toBe(body);
    expect(source.slice(environment!.getChild("EndMathEnvironment")!.from, environment!.to)).toBe(String.raw`\end{align*}`);
    const displays = parseSimpleTexParagraphIr(source).items.filter(item => item.kind === "display-math");
    expect(displays).toHaveLength(1);
    expect(displays[0]).toMatchObject({ sourceStart: source.indexOf(String.raw`\begin{align*}`),
      sourceEnd: source.indexOf(String.raw`\end{align*}`) + String.raw`\end{align*}`.length });
    if (displays[0].kind === "display-math") {
      expect(source.slice(displays[0].contentStart, displays[0].contentEnd)).toBe(displays[0].content);
      expect(displays[0].content).toContain(String.raw`\intertext{` + body + "}");
    }
  });

  it.each([
    String.raw`Alpha \begin{align*}a&=b\\\intertext{where $x$ holds c&=d\end{align*} Beta`,
    String.raw`Alpha \begin{align*}a&=b\\\intertext{where $x holds}c&=d\end{align*} Beta`,
  ])("marks malformed intertext recovery explicitly: %s", source => {
    expect(syntaxErrors(parseTexSyntax(source, { top: "TexFragment" })).length).toBeGreaterThan(0);
    expect(parseSimpleTexParagraphIr(source).items.some(item => item.kind === "display-math")).toBe(false);
  });
});
