import { describe, expect, it } from "vitest";
import {
  printTexFuzzAst,
  TexFuzzRandom,
  type TexFuzzNode,
} from "@tikz-editor/tex-fuzz";

const pt = (amount: number) => ({ amount, unit: "pt" as const });

function nestedNodes(nodes: readonly TexFuzzNode[]): readonly TexFuzzNode[] {
  return nodes.flatMap((node) => {
    const children = "children" in node ? nestedNodes(node.children) : [];
    const label = node.kind === "item" && node.label ? nestedNodes(node.label) : [];
    return [node, ...children, ...label];
  });
}

describe("TeX fuzz model and printer breadth", () => {
  it("prints scoped declarations and inline box families without changing v1 forms", () => {
    const ast = [
      { kind: "font", command: "textbf", children: [{ kind: "text", value: "old" }] },
      { kind: "font", command: "textsc", children: [{ kind: "text", value: "Caps" }] },
      { kind: "font-declaration", command: "sffamily", children: [{ kind: "text", value: "Sans" }] },
      { kind: "style-declaration", command: "Large", children: [{ kind: "text", value: "Big" }] },
      {
        kind: "style-declaration",
        command: "fontsize",
        size: pt(11),
        baselineSkip: pt(13),
        children: [{ kind: "text", value: "Sized" }],
      },
      {
        kind: "style-declaration",
        command: "color",
        color: "teal",
        children: [{ kind: "text", value: "Tint" }],
      },
      { kind: "math", delimiter: "paren", content: "x_i" },
      { kind: "line-break", command: "\\", starred: true, leading: pt(2) },
      {
        kind: "box",
        command: "framebox",
        width: pt(20),
        alignment: "r",
        children: [{ kind: "text", value: "Box" }],
      },
      {
        kind: "box",
        command: "fcolorbox",
        frameColor: "red",
        backgroundColor: "blue",
        children: [{ kind: "text", value: "Paint" }],
      },
      { kind: "dimension-box", command: "smash", children: [{ kind: "text", value: "Flat" }] },
      {
        kind: "raisebox",
        lift: pt(3),
        depth: pt(1),
        children: [{ kind: "text", value: "Up" }],
      },
      { kind: "rule", raise: pt(1), width: pt(8), height: pt(0.5) },
    ] satisfies readonly TexFuzzNode[];

    const printed = printTexFuzzAst(ast);
    expect(printed.source).toBe(
      String.raw`\textbf{old}\textsc{Caps}{\sffamily Sans}{\Large Big}{\fontsize{11pt}{13pt}\selectfont Sized}{\color{teal}Tint}\(x_i\)\\*[2pt]\framebox[20pt][r]{Box}\fcolorbox{red}{blue}{Paint}\smash{Flat}\raisebox{3pt}[0pt][1pt]{Up}\rule[1pt]{8pt}{0.5pt}`
    );
    expect(printed.sourceMap).toHaveLength(nestedNodes(ast).length);
  });

  it("prints display math and paragraph/document controls", () => {
    const ast = [
      { kind: "noindent" },
      { kind: "alignment", command: "centering" },
      { kind: "text", value: "Lead" },
      { kind: "paragraph-break", command: "par" },
      { kind: "display-math", delimiter: "align-star", content: "a&=b\\\\c&=d" },
      { kind: "vertical-glue", command: "vspace", starred: true, size: pt(-2) },
      { kind: "penalty", value: 250 },
      { kind: "vertical-rule", width: pt(24), height: pt(2), depth: pt(1) },
      {
        kind: "environment",
        name: "itemize",
        children: [
          { kind: "item", label: [{ kind: "text", value: "A" }] },
          { kind: "text", value: "Entry" },
        ],
      },
      {
        kind: "document-box",
        command: "parbox",
        position: "t",
        height: pt(24),
        innerPosition: "b",
        width: pt(40),
        children: [{ kind: "text", value: "Nested" }],
      },
      {
        kind: "document-box",
        command: "minipage",
        position: "b",
        width: pt(50),
        children: [{ kind: "text", value: "Page" }],
      },
    ] satisfies readonly TexFuzzNode[];

    const printed = printTexFuzzAst(ast);
    expect(printed.source).toBe(
      String.raw`\noindent \centering Lead\par \begin{align*}a&=b\\c&=d\end{align*}\vspace*{-2pt}\penalty 250 \hrule width 24pt height 2pt depth 1pt \begin{itemize}\item[A] Entry\end{itemize}\parbox[t][24pt][b]{40pt}{Nested}\begin{minipage}[b]{50pt}Page\end{minipage}`
    );
    expect(printed.sourceMap).toHaveLength(nestedNodes(ast).length);
  });

  it("maps every nested node to a unique, containing source span", () => {
    const ast = [
      {
        kind: "environment",
        name: "description",
        children: [
          {
            kind: "item",
            label: [{ kind: "font", command: "textit", children: [{ kind: "text", value: "Term" }] }],
          },
          {
            kind: "font-declaration",
            command: "bfseries",
            children: [{ kind: "box", command: "fbox", children: [{ kind: "text", value: "Body" }] }],
          },
        ],
      },
    ] satisfies readonly TexFuzzNode[];
    const printed = printTexFuzzAst(ast);
    const allNodes = nestedNodes(ast);

    expect(printed.sourceMap).toHaveLength(allNodes.length);
    expect(new Set(printed.sourceMap.map((span) => span.path)).size).toBe(allNodes.length);
    for (const span of printed.sourceMap) {
      expect(span.start).toBeGreaterThanOrEqual(0);
      expect(span.end).toBeGreaterThan(span.start);
      expect(span.end).toBeLessThanOrEqual(printed.source.length);
      const parentPath = span.path.replace(/\/(?:children|label)\/\d+$/, "");
      const parent = printed.sourceMap.find((candidate) => candidate.path === parentPath);
      if (parent) {
        expect(span.start).toBeGreaterThanOrEqual(parent.start);
        expect(span.end).toBeLessThanOrEqual(parent.end);
      }
    }
  });

  it("uses only recorded integer choices for weighted decisions", () => {
    const first = new TexFuzzRandom(0x1234_5678);
    const second = new TexFuzzRandom(0x1234_5678);
    const draw = (random: TexFuzzRandom) => Array.from(
      { length: 16 },
      (_, index) => random.weightedPick(`draw/${index}`, ["rare", "usual", "never"] as const, [1, 7, 0])
    );

    expect(draw(first)).toEqual(draw(second));
    expect(second.choices()).toEqual(first.choices());
    expect(first.choices()).toMatchInlineSnapshot(`
      [
        {
          "path": "draw/0",
          "upperExclusive": 8,
          "value": 6,
        },
        {
          "path": "draw/1",
          "upperExclusive": 8,
          "value": 1,
        },
        {
          "path": "draw/2",
          "upperExclusive": 8,
          "value": 3,
        },
        {
          "path": "draw/3",
          "upperExclusive": 8,
          "value": 7,
        },
        {
          "path": "draw/4",
          "upperExclusive": 8,
          "value": 3,
        },
        {
          "path": "draw/5",
          "upperExclusive": 8,
          "value": 3,
        },
        {
          "path": "draw/6",
          "upperExclusive": 8,
          "value": 0,
        },
        {
          "path": "draw/7",
          "upperExclusive": 8,
          "value": 5,
        },
        {
          "path": "draw/8",
          "upperExclusive": 8,
          "value": 7,
        },
        {
          "path": "draw/9",
          "upperExclusive": 8,
          "value": 1,
        },
        {
          "path": "draw/10",
          "upperExclusive": 8,
          "value": 5,
        },
        {
          "path": "draw/11",
          "upperExclusive": 8,
          "value": 6,
        },
        {
          "path": "draw/12",
          "upperExclusive": 8,
          "value": 7,
        },
        {
          "path": "draw/13",
          "upperExclusive": 8,
          "value": 6,
        },
        {
          "path": "draw/14",
          "upperExclusive": 8,
          "value": 1,
        },
        {
          "path": "draw/15",
          "upperExclusive": 8,
          "value": 6,
        },
      ]
    `);
    expect(first.choices().every((choice) => Number.isSafeInteger(choice.value))).toBe(true);
  });

  it("rejects non-integer weights and ambiguous box option shapes", () => {
    const random = new TexFuzzRandom(1);
    expect(() => random.weightedIndex("fraction", [1, 0.5])).toThrow(/Invalid integer weight/);
    expect(() => random.weightedIndex("zero", [0, 0])).toThrow(/must be positive/);
    expect(() => printTexFuzzAst([{
      kind: "box",
      command: "makebox",
      alignment: "r",
      children: [],
    }])).toThrow(/alignment without an explicit width/);
  });
});
