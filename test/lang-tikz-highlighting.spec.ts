import { highlightTree, tagHighlighter, tags as t } from "@lezer/highlight";
import { describe, expect, it } from "vitest";

import { tikzLanguage } from "@tikz-editor/lang-tikz";

type HighlightRange = {
  from: number;
  to: number;
  classes: string;
};

const testHighlighter = tagHighlighter([
  { tag: t.keyword, class: "keyword" },
  { tag: t.typeName, class: "typeName" },
  { tag: t.className, class: "className" },
  { tag: t.labelName, class: "labelName" }
]);

function collectHighlights(source: string): HighlightRange[] {
  const tree = tikzLanguage.parser.parse(source);
  const ranges: HighlightRange[] = [];
  highlightTree(tree, testHighlighter, (from, to, classes) => {
    ranges.push({ from, to, classes });
  });
  return ranges;
}

function hasClassAt(ranges: readonly HighlightRange[], from: number, to: number, className: string): boolean {
  return ranges.some((range) => range.from === from && range.to === to && range.classes.split(" ").includes(className));
}

describe("@tikz-editor/lang-tikz highlighting", () => {
  it("does not style keyword-looking color names as path keywords", () => {
    const source = String.raw`\colorlet{sin}{red}
\colorlet{sincolor}{blue}`;
    const ranges = collectHighlights(source);
    const sinFrom = source.indexOf("{sin}") + 1;
    const sinTo = sinFrom + "sin".length;
    const sincolorFrom = source.indexOf("sincolor");
    const sincolorTo = sincolorFrom + "sincolor".length;

    expect(hasClassAt(ranges, sinFrom, sinTo, "typeName")).toBe(false);
    expect(hasClassAt(ranges, sinFrom, sinTo, "keyword")).toBe(false);
    expect(hasClassAt(ranges, sincolorFrom, sincolorTo, "typeName")).toBe(false);
    expect(hasClassAt(ranges, sincolorFrom, sincolorTo, "keyword")).toBe(false);
  });

  it("styles recognized path keywords in path context", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) sin (1,1) cos (2,0);
  \node at (0,0) {x};
\end{tikzpicture}`;
    const ranges = collectHighlights(source);
    const sinFrom = source.indexOf(" sin ") + 1;
    const cosFrom = source.indexOf(" cos ") + 1;
    const atFrom = source.indexOf(" at ") + 1;

    expect(hasClassAt(ranges, sinFrom, sinFrom + "sin".length, "typeName")).toBe(true);
    expect(hasClassAt(ranges, cosFrom, cosFrom + "cos".length, "typeName")).toBe(true);
    expect(hasClassAt(ranges, atFrom, atFrom + "at".length, "keyword")).toBe(true);
  });

  it("styles positioning of as an option-list keyword", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (node) at (0,3.2) {node};
  \node[draw, below right={0.47cm and 0.45cm} of node, office=1, offset=2] {node};
  \node[draw, below right=0.47cm and 0.45cm of node] {node};
\end{tikzpicture}`;
    const ranges = collectHighlights(source);
    const ofFrom = source.indexOf(" of node") + 1;
    const andFrom = source.indexOf(" and ") + 1;
    const unbracedAndFrom = source.lastIndexOf(" and ") + 1;
    const officeFrom = source.indexOf("office");
    const offsetFrom = source.indexOf("offset");

    expect(hasClassAt(ranges, ofFrom, ofFrom + "of".length, "keyword")).toBe(true);
    expect(hasClassAt(ranges, andFrom, andFrom + "and".length, "keyword")).toBe(true);
    expect(hasClassAt(ranges, unbracedAndFrom, unbracedAndFrom + "and".length, "keyword")).toBe(true);
    expect(hasClassAt(ranges, officeFrom, officeFrom + "office".length, "keyword")).toBe(false);
    expect(hasClassAt(ranges, offsetFrom, offsetFrom + "offset".length, "keyword")).toBe(false);
  });
});
