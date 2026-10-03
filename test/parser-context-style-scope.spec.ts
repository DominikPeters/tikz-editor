import { describe, expect, it } from "vitest";

import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { collectContextDefinitions } from "../packages/core/src/transform/cst-to-ast.js";

const STYLE_COMMANDS = [
  { name: "tikzset", definition: (color: string) => `\\tikzset{paint/.style={draw=${color}}}` },
  { name: "tikzstyle", definition: (color: string) => `\\tikzstyle{paint}=[draw=${color}]` },
  { name: "pgfkeys", definition: (color: string) => `\\pgfkeys{/tikz/paint/.style={draw=${color}}}` }
];
const GROUPS = [
  { name: "braces", begin: "{", end: "}" },
  { name: "begingroup", begin: "\\begingroup", end: "\\endgroup" },
  { name: "bgroup", begin: "\\bgroup", end: "\\egroup" },
  { name: "figure", begin: "\\begin{figure}", end: "\\end{figure}" },
  { name: "tikzpicture", begin: "\\begin{tikzpicture}", end: "\\end{tikzpicture}" },
  { name: "scope", begin: "\\begin{scope}", end: "\\end{scope}" }
];
const PICTURE = String.raw`\begin{tikzpicture}\draw[paint] (0,0) -- (1,0);\end{tikzpicture}`;

function strokeInLastPicture(source: string): string | null | undefined {
  const inventory = parseTikz(source);
  const activeFigureId = inventory.figures.at(-1)?.id;
  const parsed = parseTikz(source, { activeFigureId, includeContextDefinitions: true });
  expect(parsed.diagnostics).toEqual([]);
  const path = evaluateTikzFigure(parsed.figure, source).scene.elements.find((element) => element.kind === "Path");
  expect(path?.kind).toBe("Path");
  return path?.style.stroke;
}

describe("context style group lifetime", () => {
  it.each([
    String.raw`\verb|{|`, String.raw`\verb*|{|`, String.raw`\verb|\begingroup|`,
    String.raw`\begin{verbatim}{\end{verbatim}`, String.raw`\begin{verbatim*}\begingroup\end{verbatim*}`
  ])("ignores inert opening groups before a real closed style group: %s", (literal) => {
    const prefix = String.raw`\tikzset{paint/.style={draw=red}}{\tikzset{paint/.style={draw=blue}}` + literal + "}";
    expect(strokeInLastPicture(`${prefix}\n${PICTURE}`)).toBe("#ff0000");
  });

  it.each([
    String.raw`\verb|}|`, String.raw`\verb*|\endgroup|`, String.raw`\begin{verbatim}}\end{verbatim}`,
    String.raw`\begin{verbatim*}\endgroup\end{verbatim*}`
  ])("keeps an enclosing style group open across inert closing groups: %s", (literal) => {
    const prefix = String.raw`\tikzset{paint/.style={draw=red}}{\tikzset{paint/.style={draw=blue}}` + literal;
    const definitions = collectContextDefinitions(prefix).filter((statement) => statement.kind === "TikzSet");
    expect(definitions.map((statement) => statement.optionList.entries[0])).toMatchObject([
      { valueRaw: "{draw=red}" }, { valueRaw: "{draw=blue}" }
    ]);
  });

  it.each(STYLE_COMMANDS.flatMap((command) => GROUPS.map((group) => ({ ...command, group }))))(
    "restores outer $name after a completed $group.name group",
    ({ definition, group }) => {
      const global = definition("red");
      const prefix = `${global}\n${group.begin}\n${definition("blue")}\n${group.end}\n`;
      const source = `${prefix}${PICTURE}`;
      const definitions = collectContextDefinitions(prefix).filter((statement) => statement.kind === "TikzSet" || statement.kind === "TikzStyle" || statement.kind === "Pgfkeys");
      expect(definitions).toHaveLength(1);
      expect(definitions[0]?.span).toEqual({ from: 0, to: global.length });
      expect(source.slice(definitions[0]?.span.from, definitions[0]?.span.to)).toBe(global);
      expect(strokeInLastPicture(source)).toBe("#ff0000");
    }
  );

  it.each(STYLE_COMMANDS)("keeps $name visible inside an enclosing group until it closes", ({ definition }) => {
    const source = `${definition("red")}\n{${definition("blue")}\n{${definition("green")}}\n${PICTURE}}\n${PICTURE}`;
    const first = parseTikz(source, { activeFigureId: "figure:0", includeContextDefinitions: true });
    const path = evaluateTikzFigure(first.figure, source).scene.elements.find((element) => element.kind === "Path");
    expect(path?.style.stroke).toBe("#0000ff");
    expect(strokeInLastPicture(source)).toBe("#ff0000");
  });

  it.each(STYLE_COMMANDS)("restores $name across nested scopes and the completed picture", ({ definition }) => {
    const source = [
      definition("red"),
      String.raw`\begin{tikzpicture}`,
      definition("green"),
      String.raw`\begin{scope}`,
      definition("blue"),
      String.raw`\end{scope}`,
      String.raw`\draw[paint] (0,0) -- (1,0);`,
      String.raw`\end{tikzpicture}`,
      PICTURE
    ].join("\n");
    const first = parseTikz(source, { activeFigureId: "figure:0", includeContextDefinitions: true });
    const path = evaluateTikzFigure(first.figure, source).scene.elements.find((element) => element.kind === "Path");
    expect(path?.style.stroke).toBe("#00ff00");
    expect(strokeInLastPicture(source)).toBe("#ff0000");
  });

  it("treats a dormant style handler payload as definition data", () => {
    const prefix = String.raw`\tikzset{paint/.style={draw=red}}
{
\tikzset{handler/.code={\endgroup}}
\tikzset{paint/.style={draw=blue}}
}`;
    expect(strokeInLastPicture(`${prefix}\n${PICTURE}`)).toBe("#ff0000");
  });

  it.each([
    String.raw`\def\unused{\endgroup}`,
    String.raw`\newcommand{\unused}{\endgroup}`,
    String.raw`\newcommand{\unused}[1][\egroup]{\end{figure}}`
  ])("skips dormant command bodies while assigning style scope: %s", (definition) => {
    const prefix = String.raw`\tikzset{paint/.style={draw=red}}
\begingroup` + `\n${definition}\n` + String.raw`\tikzset{paint/.style={draw=blue}}
\endgroup`;
    expect(strokeInLastPicture(`${prefix}\n${PICTURE}`)).toBe("#ff0000");
  });

  it("keeps macro/color restoration and loaded libraries alongside filtered styles", () => {
    const prefix = String.raw`\def\distance{1}\colorlet{tone}{red}\definecolor{brand}{HTML}{FF0000}
\tikzset{paint/.style={draw=tone}}
\begin{tikzpicture}
\def\distance{2}\colorlet{tone}{blue}\definecolor{brand}{HTML}{0000FF}
\usetikzlibrary{patterns}
\tikzset{paint/.style={draw=blue}}
\end{tikzpicture}`;
    const definitions = collectContextDefinitions(prefix);
    expect(definitions.filter((statement) => statement.kind === "MacroDefinition").map((statement) => statement.valueRaw)).toEqual(["1"]);
    expect(definitions.filter((statement) => statement.kind === "Colorlet").map((statement) => statement.valueRaw)).toEqual(["red"]);
    expect(definitions.filter((statement) => statement.kind === "DefineColor").map((statement) => statement.specificationRaw)).toEqual(["FF0000"]);
    expect(definitions.filter((statement) => statement.kind === "TikzLibrary").map((statement) => statement.libraries)).toEqual([["patterns"]]);
    expect(strokeInLastPicture(`${prefix}\n${PICTURE}`)).toBe("#ff0000");
  });
});
