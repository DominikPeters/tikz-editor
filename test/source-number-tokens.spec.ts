import { describe, expect, it } from "vitest";
import { parser } from "../packages/lezer-tikz/src/index.js";
import { fractionDigits } from "../packages/app/src/scrub-utils.js";

describe("source number tokens", () => {
  it.each([".33", ".11", "1.", "1e-3", ".5e+2", "0.33"])("includes the whole literal %s in one token", literal => {
    const source = String.raw`\node at ($(C)+(${literal},-.2)$) {Label};`;
    const start = source.indexOf(literal);
    const tokens: { from: number; to: number; text: string }[] = [];
    parser.parse(source).iterate({ enter(node) {
      if (node.name === "Number") tokens.push({ from: node.from, to: node.to, text: source.slice(node.from,node.to) });
    } });
    expect(tokens.find(token => token.from === start)).toEqual({ from: start, to: start + literal.length, text: literal });
  });

  it.each([["1e-3",3],[".33",2],["1.20e-2",4],[".5e+2",0],["1.",0]])("preserves fractional precision for %s", (literal,digits) => {
    expect(fractionDigits(String(literal))).toBe(digits);
  });
});
