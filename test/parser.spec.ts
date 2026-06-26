import { describe, expect, it } from "vitest";

import { parseTikz } from "../packages/core/src/parser/index.js";
import { loadFixture } from "./helpers.js";

function collectCstText(source: string, result: ReturnType<typeof parseTikz>, typeName: string): string[] {
  const ranges: string[] = [];
  const cursor = result.tree.cursor();
  do {
    if (cursor.type.name === typeName) {
      ranges.push(source.slice(cursor.from, cursor.to));
    }
  } while (cursor.next());
  return ranges;
}

function collectAstNodeTexts(value: unknown, texts: string[] = []): string[] {
  if (!value || typeof value !== "object") {
    return texts;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectAstNodeTexts(item, texts);
    }
    return texts;
  }
  const record = value as Record<string, unknown>;
  if (record.kind === "Node" && typeof record.text === "string") {
    texts.push(record.text);
  }
  for (const child of Object.values(record)) {
    collectAstNodeTexts(child, texts);
  }
  return texts;
}

describe("parseTikz", () => {
  it("parses minimal tikzpicture into a non-empty IR", () => {
    const source = loadFixture("minimal.tex");
    const result = parseTikz(source);

    expect(result.figure.kind).toBe("Figure");
    expect(result.figure.body.length).toBeGreaterThan(0);
    expect(result.figure.body[0]?.kind).toBe("Path");
  });

  it("parses inline tikz commands into path statements", () => {
    const source = String.raw`\tikz \draw (0,0) -- (1,1);`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    expect(result.figure.body).toHaveLength(1);
    expect(result.figure.body[0]?.kind).toBe("Path");
    if (result.figure.body[0]?.kind === "Path") {
      expect(result.figure.body[0].command).toBe("draw");
    }
  });

  it("parses inline tikz options and braced bodies", () => {
    const source = String.raw`\tikz[rotate=30]{\draw[step=1mm] (0,0) grid (2,2);};`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    expect(result.figure.options?.entries.some((entry) => entry.kind === "kv" && entry.key === "rotate")).toBe(true);
    expect(result.figure.body.some((statement) => statement.kind === "Path")).toBe(true);
  });

  it("parses graph command forms into GraphOperation path items", () => {
    const source = String.raw`\begin{tikzpicture}
  \graph [nodes={draw}] { a -> b -> {c, d} };
  \path graph [nodes={circle}] { x -- y };
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.figure.body).toHaveLength(2);
    expect(result.figure.body[0]?.kind).toBe("Path");
    expect(result.figure.body[1]?.kind).toBe("Path");

    if (result.figure.body[0]?.kind === "Path") {
      expect(result.figure.body[0].command).toBe("graph");
      const graphItem = result.figure.body[0].items.find((item) => item.kind === "GraphOperation");
      expect(graphItem).toBeDefined();
      if (graphItem?.kind === "GraphOperation") {
        expect(graphItem.spec?.segments.length ?? 0).toBeGreaterThan(0);
        const firstChain = graphItem.spec?.segments[0]?.chain;
        expect(firstChain?.nodes.length ?? 0).toBeGreaterThan(0);
      }
    }
    if (result.figure.body[1]?.kind === "Path") {
      expect(result.figure.body[1].command).toBe("path");
      const graphItem = result.figure.body[1].items.find((item) => item.kind === "GraphOperation");
      expect(graphItem).toBeDefined();
      if (graphItem?.kind === "GraphOperation") {
        expect(graphItem.spec?.segments.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("parses node text with nested braces", () => {
    const source = `\\begin{tikzpicture}\\draw (0,0) node {A {B} C};\\end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }

    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (node?.kind === "Node") {
      expect(node.text).toContain("A {B} C");
    }
  });

  it("keeps a recovered node text span from swallowing the path semicolon", () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0,0) {I'm testing the Mathjax \\ rendering \textit{d;
\end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }

    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (node?.kind === "Node") {
      expect(node.text).toBe(String.raw`I'm testing the Mathjax \\ rendering \textit{d`);
      expect(source.slice(node.textSpan.from, node.textSpan.to)).toBe(node.text);
    }
  });

  it("does not reuse the structural node close brace as recovered node text", () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0,0) {I'm testing the Mathjax \\ rendering \textit{d};
\end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }

    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (node?.kind === "Node") {
      expect(node.text).toBe(String.raw`I'm testing the Mathjax \\ rendering \textit{d`);
      expect(source.slice(node.textSpan.from, node.textSpan.to)).toBe(node.text);
    }
  });

  it("parses escaped braces inside node text math", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[vertex] (abc) at (0,3.9) {$\{a,b,c\}$};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.figure.body).toHaveLength(1);
    expect(result.figure.body[0]?.kind).toBe("Path");
    if (result.figure.body[0]?.kind === "Path") {
      const node = result.figure.body[0].items.find((item) => item.kind === "Node");
      expect(node?.kind).toBe("Node");
      if (node?.kind === "Node") {
        expect(node.text).toBe("$\\{a,b,c\\}$");
      }
    }
  });

  it("parses node bodies through dedicated node text CST nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (test) at (0, 1.5) {this is a node with text and it is a rectangle including $x=\int_0^1 y dx$ style math};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    const nodeNames: string[] = [];
    const nodeTextRanges: string[] = [];
    const cursor = result.tree.cursor();
    do {
      nodeNames.push(cursor.type.name);
      if (cursor.type.name === "NodeTextGroup" || cursor.type.name === "NodeTextDollarMath") {
        nodeTextRanges.push(source.slice(cursor.from, cursor.to));
      }
    } while (cursor.next());

    expect(nodeNames).toContain("NodePathStatement");
    expect(nodeTextRanges).toContain(
      String.raw`{this is a node with text and it is a rectangle including $x=\int_0^1 y dx$ style math}`
    );
    expect(nodeTextRanges).toContain(String.raw`$x=\int_0^1 y dx$`);
    expect(result.figure.body[0]?.kind).toBe("Path");
    if (result.figure.body[0]?.kind === "Path") {
      expect(result.figure.body[0].command).toBe("node");
      const node = result.figure.body[0].items.find((item) => item.kind === "Node");
      expect(node?.kind).toBe("Node");
      if (node?.kind === "Node") {
        expect(node.text).toBe(
          String.raw`this is a node with text and it is a rectangle including $x=\int_0^1 y dx$ style math`
        );
      }
    }
  });

  it("parses difficult node text across standalone and path-attached nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (standalone) at (0,0) {outer {inner $x_{1}$} text \nodepart{lower} tail};
  \draw (0,0) -- (1,0)
    node[midway,above] {edge {nested \textbf{bold}} and $a_b$}
    to node[pos=.7,below] {to node with $$\sum_i x_i$$ and {braces}} (2,0);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    const nodeTextGroups = collectCstText(source, result, "NodeTextGroup");
    const dollarMath = collectCstText(source, result, "NodeTextDollarMath");

    expect(collectCstText(source, result, "NodePathStatement")).toHaveLength(1);
    expect(nodeTextGroups).toContain(String.raw`{outer {inner $x_{1}$} text \nodepart{lower} tail}`);
    expect(nodeTextGroups).toContain(String.raw`{edge {nested \textbf{bold}} and $a_b$}`);
    expect(nodeTextGroups).toContain(String.raw`{to node with $$\sum_i x_i$$ and {braces}}`);
    expect(dollarMath).toEqual(expect.arrayContaining([String.raw`$x_{1}$`, String.raw`$a_b$`, String.raw`$$\sum_i x_i$$`]));

    const astTexts = collectAstNodeTexts(result.figure);
    expect(astTexts).toEqual(
      expect.arrayContaining([
        String.raw`outer {inner $x_{1}$} text \nodepart{lower} tail`,
        String.raw`edge {nested \textbf{bold}} and $a_b$`,
        String.raw`to node with $$\sum_i x_i$$ and {braces}`
      ])
    );
  });

  it("keeps nodepart commands and escaped delimiters inside node text", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,circle split] {Top\nodepart{lower}{Bottom $x$ and \$5 with 100\%}};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "missing-semicolon")).toBe(false);

    const nodeTextGroups = collectCstText(source, result, "NodeTextGroup");
    expect(nodeTextGroups).toContain(String.raw`{Top\nodepart{lower}{Bottom $x$ and \$5 with 100\%}}`);
    expect(nodeTextGroups).toContain(String.raw`{lower}`);
    expect(nodeTextGroups).toContain(String.raw`{Bottom $x$ and \$5 with 100\%}`);
    expect(collectCstText(source, result, "NodeTextDollarMath")).toEqual([String.raw`$x$`]);
    expect(collectAstNodeTexts(result.figure)).toContain(String.raw`Top\nodepart{lower}{Bottom $x$ and \$5 with 100\%}`);
  });

  it("keeps comments reachable in CST", () => {
    const source = loadFixture("comments.tex");
    const result = parseTikz(source);

    const cursor = result.tree.cursor();
    const comments: string[] = [];
    do {
      if (cursor.type.name === "Comment") {
        comments.push(source.slice(cursor.from, cursor.to));
      }
    } while (cursor.next());

    expect(comments.length).toBeGreaterThan(0);
    expect(comments.some((comment) => comment.includes("keep this comment"))).toBe(true);
    expect(comments.some((comment) => comment.includes("trailing"))).toBe(true);
  });

  it("accepts comments inside option lists", () => {
    const source = String.raw`\begin{tikzpicture}
  [fill=yellow!80!black, % only sets the color
   every path/.style={draw}]  % all paths are drawn
  \fill (0,0) rectangle +(1,1);
\end{tikzpicture}`;
    const result = parseTikz(source);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "missing-option-close")).toBe(false);
  });

  it("maps unknown commands to UnknownStatement", () => {
    const source = loadFixture("unknown.tex");
    const result = parseTikz(source);

    expect(result.figure.body).toHaveLength(1);
    expect(result.figure.body[0]?.kind).toBe("UnknownStatement");
  });

  it("parses standalone font-size commands without swallowing following path statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \huge
  \node (x) at (0,0) {X};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.figure.body.length).toBe(2);
    expect(result.figure.body[0]?.kind).toBe("UnknownStatement");
    expect(result.figure.body[1]?.kind).toBe("Path");
  });

  it("accepts font-size commands inside node font options", () => {
    const source = String.raw`\begin{tikzpicture}
  \node [font=\small] at (0,0) {hi};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.figure.body).toHaveLength(1);
    expect(result.figure.body[0]?.kind).toBe("Path");
    if (result.figure.body[0]?.kind === "Path") {
      const node = result.figure.body[0].items.find((item) => item.kind === "Node");
      expect(node?.kind).toBe("Node");
      if (node?.kind === "Node") {
        const fontEntry = node.options?.entries.find((entry) => entry.kind === "kv" && entry.key === "font");
        expect(fontEntry?.kind).toBe("kv");
        if (fontEntry?.kind === "kv") {
          expect(fontEntry.valueRaw).toBe("\\small");
        }
      }
    }
  });

  it("parses standalone colorlet commands without requiring semicolons", () => {
    const source = String.raw`\begin{tikzpicture}
  \colorlet{mycolor}{blue}
  \fill[mycolor] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.figure.body).toHaveLength(2);
    expect(result.figure.body[0]?.kind).toBe("Colorlet");
    if (result.figure.body[0]?.kind === "Colorlet") {
      expect(result.figure.body[0].commandRaw).toBe("\\colorlet");
      expect(result.figure.body[0].nameRaw).toBe("mycolor");
      expect(result.figure.body[0].valueRaw).toBe("blue");
    }
  });

  it("parses standalone definecolor commands without requiring semicolons", () => {
    const source = String.raw`\begin{tikzpicture}
  \definecolor{brand}{HTML}{1A2B3C}
  \fill[brand] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.figure.body).toHaveLength(2);
    expect(result.figure.body[0]?.kind).toBe("DefineColor");
    if (result.figure.body[0]?.kind === "DefineColor") {
      expect(result.figure.body[0].commandRaw).toBe("\\definecolor");
      expect(result.figure.body[0].nameRaw).toBe("brand");
      expect(result.figure.body[0].modelRaw).toBe("HTML");
      expect(result.figure.body[0].specificationRaw).toBe("1A2B3C");
    }
  });

  it("parses standalone \\usetikzlibrary commands with or without spacing before groups", () => {
    const source = String.raw`\begin{tikzpicture}
  \usetikzlibrary{shapes.geometric}
  \usetikzlibrary {shadows,shapes.symbols}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.figure.body).toHaveLength(3);
    expect(result.figure.body[0]?.kind).toBe("TikzLibrary");
    expect(result.figure.body[1]?.kind).toBe("TikzLibrary");
    expect(result.figure.body[2]?.kind).toBe("Path");
    if (result.figure.body[0]?.kind === "TikzLibrary") {
      expect(result.figure.body[0].libraries).toContain("shapes.geometric");
    }
    if (result.figure.body[1]?.kind === "TikzLibrary") {
      expect(result.figure.body[1].libraries).toContain("shadows");
    }
  });

  it("accepts \\usetikzlibrary preamble commands before tikzpicture without parse errors", () => {
    const source = String.raw`\usetikzlibrary{shapes.geometric}
\usetikzlibrary {shadows,shapes.symbols}
\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.figure.body).toHaveLength(1);
    expect(result.figure.body[0]?.kind).toBe("Path");
  });

  it("collects a stable figure inventory across multiple tikzpicture environments", () => {
    const source = String.raw`\documentclass{article}
\begin{document}
\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}
\begin{tikzpicture*}
  \draw (0,0) -- (0,1);
\end{tikzpicture*}
\end{document}`;
    const result = parseTikz(source, { recover: true });

    expect(result.figures).toHaveLength(2);
    expect(result.activeFigureId).toBe(result.figures[0]?.id ?? null);
    expect(result.figure.span.from).toBe(result.figures[0]?.span.from);
  });

  it("counts mixed line endings consistently when computing figure inventory line numbers", () => {
    const source =
      "preface\r" +
      "intro\r\n" +
      "body\n" +
      "\\begin{tikzpicture}\n" +
      "  \\draw (0,0) -- (1,0);\r\n" +
      "\\end{tikzpicture}";
    const result = parseTikz(source, { recover: true });

    expect(result.figures).toHaveLength(1);
    expect(result.figures[0]?.startLine).toBe(4);
    expect(result.figures[0]?.endLine).toBe(6);
  });

  it("counts lone carriage returns as line breaks in figure inventory line numbers", () => {
    const source = "heading\r\\begin{tikzpicture}\n  \\draw (0,0) -- (1,0);\n\\end{tikzpicture}";
    const result = parseTikz(source, { recover: true });

    expect(result.figures).toHaveLength(1);
    expect(result.figures[0]?.startLine).toBe(2);
  });

  it("supports selecting the active figure by id", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}
\begin{tikzpicture}
  \draw (0,0) -- (0,1);
\end{tikzpicture}`;
    const firstPass = parseTikz(source, { recover: true });
    const secondFigureId = firstPass.figures[1]?.id ?? null;
    expect(secondFigureId).not.toBeNull();

    const result = parseTikz(source, { recover: true, activeFigureId: secondFigureId });
    expect(result.activeFigureId).toBe(secondFigureId);
    expect(result.figure.span.from).toBe(firstPass.figures[1]?.span.from);
  });

  it("filters template tikzpictures with unresolved # placeholders from figure inventory", () => {
    const source = String.raw`\newcommand{\templ}[1]{
\begin{tikzpicture}
  \node at (0,0) {#1};
\end{tikzpicture}
}
\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = parseTikz(source, { recover: true });

    expect(result.figures).toHaveLength(1);
    expect(result.activeFigureId).toBe("figure:0");
    expect(result.figure.body.some((statement) => statement.kind === "Path")).toBe(true);
  });

  it("ignores escaped and doubled # placeholders when filtering template figures", () => {
    const source = String.raw`\newcommand{\ok}[1]{
\begin{tikzpicture}
  % #1 in comments should be ignored
  \node at (0,0) {\#1 ##1};
\end{tikzpicture}
}
\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = parseTikz(source, { recover: true });

    expect(result.figures).toHaveLength(2);
    expect(result.figures.map((figure) => figure.id)).toEqual(["figure:0", "figure:1"]);
  });

  it("falls back to the first visible figure when activeFigureId points past filtered template figures", () => {
    const source = String.raw`\newcommand{\templ}[1]{
\begin{tikzpicture}
  \node at (0,0) {#1};
\end{tikzpicture}
}
\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = parseTikz(source, { recover: true, activeFigureId: "figure:1" });

    expect(result.figures).toHaveLength(1);
    expect(result.activeFigureId).toBe("figure:0");
  });

  it("does not filter normal figures that contain local macro definitions with # placeholders", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\pair}[2]{#1/#2}
  \node at (0,0) {\pair{A}{B}};
\end{tikzpicture}`;
    const result = parseTikz(source, { recover: true });

    expect(result.figures).toHaveLength(1);
    expect(result.activeFigureId).toBe("figure:0");
  });

  it("maps macro command definition variants with grouped names, arity, defaults, and operators", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\pair}[2][left]{#1/#2}
  \renewcommand*{\oldname}{renewed}
  \providecommand{\fallback}{fallback}
  \DeclareRobustCommand{\robust}[1]{\textbf{#1}}
  \DeclareMathOperator{\rank}{rank}
  \DeclareMathOperator*{\argmax}{arg\,max}
\end{tikzpicture}`;
    const result = parseTikz(source, { recover: true });
    const commands = result.figure.body.filter((statement) => statement.kind === "MacroCommandDefinition");

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(commands.map((statement) => statement.commandRaw)).toEqual([
      "\\newcommand",
      "\\renewcommand",
      "\\providecommand",
      "\\DeclareRobustCommand",
      "\\DeclareMathOperator",
      "\\DeclareMathOperator"
    ]);
    expect(commands[0]).toMatchObject({
      nameRaw: "\\pair",
      arity: 2,
      optionalDefaultRaw: "left",
      bodyRaw: "#1/#2",
      starred: false
    });
    expect(commands[1]).toMatchObject({
      nameRaw: "\\oldname",
      arity: 0,
      bodyRaw: "renewed",
      starred: true
    });
    expect(commands[3]).toMatchObject({
      nameRaw: "\\robust",
      arity: 1,
      bodyRaw: "\\textbf{#1}"
    });
    expect(commands[4]).toMatchObject({
      nameRaw: "\\rank",
      bodyRaw: "\\operatorname{rank}",
      starred: false
    });
    expect(commands[5]).toMatchObject({
      nameRaw: "\\argmax",
      bodyRaw: "\\operatorname*{arg\\,max}",
      starred: true
    });
    for (const command of commands) {
      expect(command.nameSpan).toBeDefined();
      expect(command.bodySpan).toBeDefined();
    }
  });

  it("maps style definition statement forms with grouped names, append payloads, and pgfkeys", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{every node/.style={draw}, empty style/.style=}
  \tikzstyle{boxed}+=[fill=red]
  \tikzstyle plain=[draw=blue]
  \pgfkeys{/tikz/.cd, thick/.style={line width=2pt}}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = parseTikz(source, { recover: true });

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.figure.body.map((statement) => statement.kind)).toEqual([
      "TikzSet",
      "TikzStyle",
      "TikzStyle",
      "Pgfkeys",
      "Path"
    ]);
    const tikzSet = result.figure.body[0];
    expect(tikzSet?.kind).toBe("TikzSet");
    if (tikzSet?.kind === "TikzSet") {
      expect(tikzSet.payloadRaw).toContain("every node");
      expect(tikzSet.payloadSpan).toBeDefined();
      expect(tikzSet.optionList.entries.length).toBeGreaterThan(0);
    }

    const appended = result.figure.body[1];
    expect(appended?.kind).toBe("TikzStyle");
    if (appended?.kind === "TikzStyle") {
      expect(appended.styleNameRaw).toBe("boxed");
      expect(appended.definitionKind).toBe("append");
      expect(appended.payloadRaw).toBe("[fill=red]");
      expect(appended.styleNameSpan).toBeDefined();
    }

    const plain = result.figure.body[2];
    expect(plain?.kind).toBe("TikzStyle");
    if (plain?.kind === "TikzStyle") {
      expect(plain.styleNameRaw).toBe("plain");
      expect(plain.definitionKind).toBe("style");
      expect(plain.payloadRaw).toBe("[draw=blue]");
    }

    const pgfkeys = result.figure.body[3];
    expect(pgfkeys?.kind).toBe("Pgfkeys");
    if (pgfkeys?.kind === "Pgfkeys") {
      expect(pgfkeys.payloadRaw).toContain("/tikz/.cd");
      expect(pgfkeys.optionList.entries.length).toBeGreaterThan(0);
    }
  });

  it("keeps figure ids stable when figure spans change", () => {
    const sourceA = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}
\begin{tikzpicture}
  \draw (0,0) -- (0,1);
\end{tikzpicture}`;
    const sourceB = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (12,0);
\end{tikzpicture}
\begin{tikzpicture}
  \draw (0,0) -- (0,1);
\end{tikzpicture}`;

    const first = parseTikz(sourceA, { recover: true });
    const second = parseTikz(sourceB, { recover: true, activeFigureId: first.figures[0]?.id });

    expect(first.figures.map((figure) => figure.id)).toEqual(["figure:0", "figure:1"]);
    expect(second.figures.map((figure) => figure.id)).toEqual(["figure:0", "figure:1"]);
    expect(second.activeFigureId).toBe("figure:0");
  });

  it("returns no active figure when activeFigureId is explicitly null", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}
\begin{tikzpicture}
  \draw (0,0) -- (0,1);
\end{tikzpicture}`;
    const result = parseTikz(source, { recover: true, activeFigureId: null });
    expect(result.figures).toHaveLength(2);
    expect(result.activeFigureId).toBeNull();
    expect(result.figure.body).toHaveLength(0);
  });

  it("does not tokenize `inner` as standalone `in` within option keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \node [draw, inner sep=5pt] at (0,0) {Hi};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    const inTokens: string[] = [];
    result.tree.iterate({
      enter(node) {
        if (node.name === "InKw") {
          inTokens.push(source.slice(node.from, node.to));
        }
      }
    });
    expect(inTokens).toHaveLength(0);

    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }

    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (node?.kind === "Node") {
      expect(node.options?.entries.some((entry) => entry.kind === "kv" && entry.key === "inner sep")).toBe(true);
    }
  });

  it("ignores empty node names when checking malformed coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \node () at (0,0) {Hi};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "malformed-coordinate")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }
    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (node?.kind === "Node") {
      expect(node.name).toBeUndefined();
    }
  });

  it("parses grouped style payloads containing <= and >= punctuation", () => {
    const source = String.raw`\begin{tikzpicture}[
    arw/.style={thick,shorten >=1mm,shorten <=1mm,->}]
  \draw[arw] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "missing-option-close")).toBe(false);
    const styleEntry = result.figure.options?.entries.find(
      (entry) => entry.kind === "kv" && entry.key === "arw/.style"
    );
    expect(styleEntry?.kind).toBe("kv");
  });

  it("parses standalone style-definition commands without requiring semicolons", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{highlight/.style={draw=red}}
  \tikzstyle{legacy}=[thick]
  \pgfkeys{/tikz/.cd, helper/.style={dashed}}
  \draw[highlight,legacy,helper] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.figure.body.length).toBe(4);
    expect(result.figure.body[0]?.kind).toBe("TikzSet");
    expect(result.figure.body[1]?.kind).toBe("TikzStyle");
    expect(result.figure.body[2]?.kind).toBe("Pgfkeys");
    expect(result.figure.body[3]?.kind).toBe("Path");

    if (result.figure.body[0]?.kind === "TikzSet") {
      expect(result.figure.body[0].commandRaw).toBe("\\tikzset");
    }
    if (result.figure.body[1]?.kind === "TikzStyle") {
      expect(result.figure.body[1].commandRaw).toBe("\\tikzstyle");
      expect(result.figure.body[1].styleNameRaw).toBe("legacy");
    }
    if (result.figure.body[2]?.kind === "Pgfkeys") {
      expect(result.figure.body[2].commandRaw).toBe("\\pgfkeys");
    }
  });

  it("parses standalone macro definition and alias commands without requiring semicolons", () => {
    const source = String.raw`\begin{tikzpicture}
  \def\x{3}
  \let\y\x
  \draw (\x,0) -- (\y,1);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.figure.body.length).toBe(3);
    expect(result.figure.body[0]?.kind).toBe("MacroDefinition");
    expect(result.figure.body[1]?.kind).toBe("MacroAlias");
    expect(result.figure.body[2]?.kind).toBe("Path");

    if (result.figure.body[0]?.kind === "MacroDefinition") {
      expect(result.figure.body[0].nameRaw).toBe("\\x");
      expect(result.figure.body[0].valueRaw.trim()).toBe("3");
    }
    if (result.figure.body[1]?.kind === "MacroAlias") {
      expect(result.figure.body[1].nameRaw).toBe("\\y");
      expect(result.figure.body[1].targetRaw).toBe("\\x");
    }
  });

  it("accepts control-symbol macros in groups, options, and unknown statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[font=\small, label={right:A\,B\!C}] at (0,0) {A\,B\!C};
  \foo \, \! \;;
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.figure.body).toHaveLength(2);
    expect(result.figure.body[0]?.kind).toBe("Path");
    expect(result.figure.body[1]?.kind).toBe("UnknownStatement");
  });

  it("allows trailing semicolons after standalone macro commands", () => {
    const source = String.raw`\begin{tikzpicture}
  \def\x{3};
  \let\y=\x;
  \draw (\x,0) -- (\y,1);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.figure.body[0]?.kind).toBe("MacroDefinition");
    expect(result.figure.body[1]?.kind).toBe("MacroAlias");
    expect(result.figure.body[2]?.kind).toBe("Path");
  });

  it("parses standalone newcommand definitions with grouped names and arity", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\pair}[2]{#1/#2}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.figure.body.length).toBe(2);
    expect(result.figure.body[0]?.kind).toBe("MacroCommandDefinition");
    expect(result.figure.body[1]?.kind).toBe("Path");
    if (result.figure.body[0]?.kind === "MacroCommandDefinition") {
      expect(result.figure.body[0].commandRaw).toBe("\\newcommand");
      expect(result.figure.body[0].nameRaw).toBe("\\pair");
      expect(result.figure.body[0].arity).toBe(2);
      expect(result.figure.body[0].bodyRaw).toContain("#1/#2");
    }
  });

  it("parses renewcommand definitions with ungrouped names", () => {
    const source = String.raw`\begin{tikzpicture}
  \renewcommand\labelmacro[1]{\textsf{#1}}
  \node at (0,0) {\labelmacro{A}};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.figure.body.length).toBe(2);
    expect(result.figure.body[0]?.kind).toBe("MacroCommandDefinition");
    expect(result.figure.body[1]?.kind).toBe("Path");
    if (result.figure.body[0]?.kind === "MacroCommandDefinition") {
      expect(result.figure.body[0].commandRaw).toBe("\\renewcommand");
      expect(result.figure.body[0].nameRaw).toBe("\\labelmacro");
      expect(result.figure.body[0].arity).toBe(1);
      expect(result.figure.body[0].bodyRaw).toContain(String.raw`\textsf{#1}`);
    }
  });

  it("captures starred newcommand definitions", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand*{\tagged}[1]{#1}
  \node at (0,0) {\tagged{A}};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.figure.body[0]?.kind).toBe("MacroCommandDefinition");
    if (result.figure.body[0]?.kind === "MacroCommandDefinition") {
      expect(result.figure.body[0].starred).toBe(true);
      expect(result.figure.body[0].nameRaw).toBe("\\tagged");
      expect(result.figure.body[0].arity).toBe(1);
    }
  });

  it("parses optional/default argument metadata for newcommand definitions", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\pair}[2][left]{#1/#2}
  \node at (0,0) {\pair{R}};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.figure.body[0]?.kind).toBe("MacroCommandDefinition");
    if (result.figure.body[0]?.kind === "MacroCommandDefinition") {
      expect(result.figure.body[0].arity).toBe(2);
      expect(result.figure.body[0].optionalDefaultRaw).toBe("left");
      expect(result.figure.body[0].bodyRaw).toContain("#1/#2");
    }
  });

  it("returns diagnostics while still producing IR for incomplete input", () => {
    const source = loadFixture("incomplete.tex");
    const result = parseTikz(source);

    expect(result.figure.body.length).toBeGreaterThan(0);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  describe("context-aware parse error messages", () => {
    it("reports error in path statement with bad syntax", () => {
      const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- ] ;
\end{tikzpicture}`;
      const result = parseTikz(source);
      const errors = result.diagnostics.filter((d) => d.code === "parse-error");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.message.includes("path") || e.message.includes("\\draw"))).toBe(true);
    });

    it("reports error in option list", () => {
      const source = String.raw`\begin{tikzpicture}
  \draw[thick, } (0,0) -- (1,1);
\end{tikzpicture}`;
      const result = parseTikz(source);
      const errors = result.diagnostics.filter((d) => d.code === "parse-error");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.message.includes("option list"))).toBe(true);
    });

    it("reports error in coordinate", () => {
      const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,];
\end{tikzpicture}`;
      const result = parseTikz(source);
      const errors = result.diagnostics.filter((d) => d.code === "parse-error");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.message.includes("coordinate") || e.message.includes("path"))).toBe(true);
    });

    it("reports error in \\foreach statement", () => {
      const source = String.raw`\begin{tikzpicture}
  \foreach \x in {1,2,3
    \draw (\x,0) -- (\x,1);
\end{tikzpicture}`;
      const result = parseTikz(source);
      const errors = result.diagnostics.filter((d) => d.code === "parse-error");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.message.includes("foreach") || e.message.includes("braces"))).toBe(true);
    });

    it("reports error in \\def statement", () => {
      const source = String.raw`\begin{tikzpicture}
  \def\mycolor
  \draw (0,0) -- (1,1);
\end{tikzpicture}`;
      const result = parseTikz(source);
      const errors = result.diagnostics.filter((d) => d.code === "parse-error");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.message.includes("\\def"))).toBe(true);
    });

    it("warns about missing semicolon when statement has no trailing semicolon", () => {
      const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,1)
\end{tikzpicture}`;
      const result = parseTikz(source);
      const warnings = result.diagnostics.filter((d) => d.code === "missing-semicolon");
      expect(warnings.length).toBe(1);
      expect(warnings[0].message).toContain("semicolon");
    });

    it("warns about missing semicolon when parser merges two statements", () => {
      const source = String.raw`\begin{tikzpicture}
  \node[draw] (A) at (-1, -1) {A};
  \node[draw] (B) at (1.5, -0.5) {B}
  \node[draw] (C) at (0, 1.5) {C};
  \draw (A) edge (B)
        (B) edge (C)
        (C) edge (A);
\end{tikzpicture}`;
      const result = parseTikz(source);
      const semicolonWarnings = result.diagnostics.filter((d) => d.code === "missing-semicolon");
      expect(semicolonWarnings.length).toBeGreaterThan(0);
      expect(semicolonWarnings.some((w) => w.message.includes("\\node"))).toBe(true);
    });

    it("reports unexpected token at top level", () => {
      const source = String.raw`\begin{tikzpicture}
  hello world
\end{tikzpicture}`;
      const result = parseTikz(source);
      // Should not produce generic "Syntax error while parsing TikZ input." for any error
      const genericErrors = result.diagnostics.filter(
        (d) => d.code === "parse-error" && d.message === "Syntax error while parsing TikZ input."
      );
      expect(genericErrors).toHaveLength(0);
    });
  });

  it("accepts named and polar coordinates without malformed warnings", () => {
    const source = String.raw`\begin{tikzpicture}
      \draw (origin) -- (30:2cm);
    \end{tikzpicture}`;
    const result = parseTikz(source);

    const malformed = result.diagnostics.filter((diagnostic) => diagnostic.code === "malformed-coordinate");
    expect(malformed).toHaveLength(0);

    const firstPath = result.figure.body.find((statement) => statement.kind === "Path");
    expect(firstPath?.kind).toBe("Path");
    if (firstPath?.kind !== "Path") {
      return;
    }

    const coordinates = firstPath.items.filter((item) => item.kind === "Coordinate");
    expect(coordinates).toHaveLength(2);
    if (coordinates[0]?.kind === "Coordinate") {
      expect(coordinates[0].form).toBe("named");
    }
    if (coordinates[1]?.kind === "Coordinate") {
      expect(coordinates[1].form).toBe("polar");
    }
  });

  it("parses standalone node commands as path statements with node content", () => {
    const source = String.raw`\begin{tikzpicture}
      \node[draw] at (0,0) {Center};
    \end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }

    expect(statement.command).toBe("node");
    expect(statement.items.some((item) => item.kind === "Node")).toBe(true);
    expect(statement.items.some((item) => item.kind === "Coordinate")).toBe(true);
  });

  it("parses standalone coordinate commands as path statements", () => {
    const source = String.raw`\begin{tikzpicture}
      \coordinate (A) at (0,0);
    \end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }

    expect(statement.command).toBe("coordinate");
    const coordinates = statement.items.filter((item) => item.kind === "Coordinate");
    expect(coordinates).toHaveLength(2);
    if (coordinates[0]?.kind === "Coordinate") {
      expect(coordinates[0].form).toBe("named");
    }
    if (coordinates[1]?.kind === "Coordinate") {
      expect(coordinates[1].form).toBe("cartesian");
    }
    expect(statement.items.some((item) => item.kind === "PathKeyword" && item.keyword === "at")).toBe(true);
  });

  it("parses standalone node commands that use node contents without trailing braces", () => {
    const source = String.raw`\begin{tikzpicture}
      \node[name=title,alias=headline,node contents=Hello,at={(1,2)}];
    \end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }

    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (node?.kind === "Node") {
      expect(node.text).toBe("Hello");
      expect(node.textSource).toBe("option");
      expect(node.name).toBe("title");
      expect(node.aliases).toEqual(["headline"]);
      expect(node.atRaw).toBe("(1,2)");
    }
  });

  it("parses standalone node commands with option lists before and after explicit node names", () => {
    const source = String.raw`\begin{tikzpicture}
  \node [draw] (s) [label=$s$]  {};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);

    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }

    expect(statement.command).toBe("node");
    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (node?.kind !== "Node") {
      return;
    }

    expect(node.name).toBe("s");
    expect(node.options?.entries.some((entry) => entry.kind === "flag" && entry.key === "draw")).toBe(true);
    expect(node.options?.entries.some((entry) => entry.kind === "kv" && entry.key === "label" && entry.valueRaw === "$s$")).toBe(true);
  });

  it("parses node labels with math superscripts inside option lists", () => {
    const source = String.raw`\begin{tikzpicture}
  \node [draw] (s) [label=$s^2$]  {};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);

    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }

    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (node?.kind !== "Node") {
      return;
    }

    expect(node.options?.entries.some((entry) => entry.kind === "kv" && entry.key === "label" && entry.valueRaw === "$s^2$")).toBe(true);
  });

  it("accepts rich TeX math expressions in node label option values", () => {
    const source = String.raw`\begin{tikzpicture}
  \node [draw] (s) [label=$\frac{a_b}{c^2} + f(x) - \alpha$] {};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);

    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }

    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (node?.kind !== "Node") {
      return;
    }

    expect(
      node.options?.entries.some(
        (entry) =>
          entry.kind === "kv" && entry.key === "label" && entry.valueRaw === String.raw`$\frac{a_b}{c^2} + f(x) - \alpha$`
      )
    ).toBe(true);
  });

  it("parses standalone matrix commands as node statements with implicit matrix options", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,row sep=4mm,column sep=6mm] (m) {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }

    expect(statement.command).toBe("node");
    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (node?.kind === "Node") {
      expect(node.text).toContain("A & B");
      expect(node.text).toContain("C & D");
      expect(node.options?.entries.some((entry) => entry.kind === "flag" && entry.key === "matrix")).toBe(true);
      expect(node.options?.entries.some((entry) => entry.kind === "flag" && entry.key === "matrix of nodes")).toBe(true);
    }
  });

  it("parses matrix ampersand replacement separators without hard parse errors", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,ampersand replacement=\&] {
    A \& B \\
    C \& D \\
  };
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }
    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (node?.kind === "Node") {
      expect(node.text).toContain(String.raw`A \& B`);
      expect(node.text).toContain(String.raw`C \& D`);
    }
  });

  it("accepts escaped dollar and percent symbols in node text", () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0,0) {\$1};
  \node at (0,1) {100\%};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    const pathStatements = result.figure.body.filter((statement) => statement.kind === "Path");
    expect(pathStatements).toHaveLength(2);

    const nodeTexts = pathStatements
      .flatMap((statement) => (statement.kind === "Path" ? statement.items : []))
      .filter((item) => item.kind === "Node")
      .map((item) => (item.kind === "Node" ? item.text : ""));

    expect(nodeTexts).toContain(String.raw`\$1`);
    expect(nodeTexts).toContain(String.raw`100\%`);
  });

  it("accepts \\( ... \\) inline math delimiters in node text", () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0,0) {This is math: \( x + y\)};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }

    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (node?.kind === "Node") {
      expect(node.text).toBe(String.raw`This is math: \( x + y\)`);
    }
  });

  it("captures inline node placement coordinates in path syntax", () => {
    const source = String.raw`\begin{tikzpicture}
      \draw (0,0) node[draw] at (1,0) {A};
    \end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (statement?.kind !== "Path") {
      return;
    }

    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (node?.kind === "Node") {
      expect(node.atRaw).toBe("(1,0)");
      expect(node.text).toBe("A");
      expect(node.textSource).toBe("group");
    }
  });

  it("recognizes node text, 'at', and 'cycle' in a mixed drawing snippet", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[thick, ->] (0,0) -- (2,1);
  \fill[red] (1,1) circle;
  \node[above] at (2,1) {Headd};
  % A comment
  \draw (0,0) -- (1,0) -- (1,1) -- cycle;
\end{tikzpicture}`;
    const result = parseTikz(source);

    const nodeStatement = result.figure.body.find(
      (statement) => statement.kind === "Path" && statement.command === "node"
    );
    expect(nodeStatement?.kind).toBe("Path");
    if (!nodeStatement || nodeStatement.kind !== "Path") {
      return;
    }

    const nodeItem = nodeStatement.items.find((item) => item.kind === "Node");
    expect(nodeItem?.kind).toBe("Node");
    if (nodeItem?.kind === "Node") {
      expect(nodeItem.text).toBe("Headd");
    }

    const hasAtKeyword = nodeStatement.items.some((item) => item.kind === "PathKeyword" && item.keyword === "at");
    expect(hasAtKeyword).toBe(true);

    const drawWithCycle = result.figure.body.find(
      (statement) =>
        statement.kind === "Path" &&
        statement.items.some((item) => item.kind === "PathKeyword" && item.keyword === "cycle")
    );
    expect(drawWithCycle?.kind).toBe("Path");

    const unknownPathTexts: string[] = [];
    result.tree.iterate({
      enter(node) {
        if (node.name === "UnknownPathItem") {
          unknownPathTexts.push(source.slice(node.from, node.to));
        }
      }
    });

    expect(unknownPathTexts).not.toContain("at");
    expect(unknownPathTexts).not.toContain("circle");
    expect(unknownPathTexts).not.toContain("cycle");
    expect(unknownPathTexts).not.toContain("{Headd}");
  });

  it("parses relative and incremental coordinates (+ and ++)", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- ++(1,0) -- +(1,1) -- cycle;
\end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body.find((item) => item.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      return;
    }

    const coordinates = statement.items.filter((item) => item.kind === "Coordinate");
    expect(coordinates.length).toBeGreaterThanOrEqual(3);
    expect(coordinates.some((item) => item.kind === "Coordinate" && item.relativePrefix === "++")).toBe(true);
    expect(coordinates.some((item) => item.kind === "Coordinate" && item.relativePrefix === "+")).toBe(true);
  });

  it("merges consecutive leading path option lists into statement options", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill [decorate,decoration={zigzag}] [fill=blue!20,draw=blue,thick] (0,0) -- (1,0) -- cycle;
\end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body.find((item) => item.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path" || !statement.options) {
      return;
    }

    const keys = statement.options.entries
      .filter((entry) => entry.kind === "kv")
      .map((entry) => (entry.kind === "kv" ? entry.key : ""));
    const flags = statement.options.entries
      .filter((entry) => entry.kind === "flag")
      .map((entry) => (entry.kind === "flag" ? entry.key : ""));

    expect(flags).toContain("decorate");
    expect(keys).toContain("decoration");
    expect(keys).toContain("fill");
    expect(keys).toContain("draw");
    expect(flags).toContain("thick");
  });

  it("parses coordinate-local options like ([xshift=3pt] 1,1)", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- ([xshift=3pt] 1,1) -- +([shift=(135:5pt)] 30:2cm);
\end{tikzpicture}`;
    const result = parseTikz(source);

    const malformed = result.diagnostics.filter((diagnostic) => diagnostic.code === "malformed-coordinate");
    expect(malformed).toHaveLength(0);

    const statement = result.figure.body.find((item) => item.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      return;
    }

    const shifted = statement.items.find((item) => item.kind === "Coordinate" && item.x === "1" && item.y === "1");
    expect(shifted?.kind).toBe("Coordinate");
    if (shifted?.kind === "Coordinate") {
      expect(shifted.optionsSpan).toBeDefined();
    }
  });

  it("classifies explicit cs and calc coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (canvas cs:x=0cm,y=2mm) -- ($(1,1) + (2,0)$);
\end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body.find((item) => item.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      return;
    }

    const forms = statement.items
      .filter((item) => item.kind === "Coordinate")
      .map((item) => (item.kind === "Coordinate" ? item.form : "unknown"));

    expect(forms).toContain("explicit");
    expect(forms).toContain("calc");
  });

  it("parses perpendicular and intersection coordinate syntaxes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (a |- b) -- (intersection of 0,0--1,1 and 0,1--1,0)
        -- (intersection cs:first line={(0,0)--(1,1)}, second line={(0,1)--(1,0)});
\end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body.find((item) => item.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      return;
    }

    const coordinates = statement.items.filter((item) => item.kind === "Coordinate");
    expect(coordinates.length).toBe(3);
    expect(coordinates.some((item) => item.kind === "Coordinate" && item.form === "named" && item.x.includes("|-"))).toBe(true);
    expect(coordinates.some((item) => item.kind === "Coordinate" && item.form === "named" && item.x.includes("intersection of"))).toBe(
      true
    );
    expect(
      coordinates.some(
        (item) => item.kind === "Coordinate" && item.form === "explicit" && item.x.toLowerCase().includes("intersection cs:")
      )
    ).toBe(true);
  });

  it("parses node names with options and text in path syntax", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) node(a) [draw] {A}  (1,1) node(b) [draw] {B};
  \draw (a.north) |- (b.west);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);

    const firstPath = result.figure.body[0];
    expect(firstPath?.kind).toBe("Path");
    if (!firstPath || firstPath.kind !== "Path") {
      return;
    }

    const nodeTexts = firstPath.items
      .filter((item) => item.kind === "Node")
      .map((item) => (item.kind === "Node" ? item.text : ""));
    expect(nodeTexts).toEqual(["A", "B"]);

    const unknownPathTexts: string[] = [];
    result.tree.iterate({
      enter(node) {
        if (node.name === "UnknownPathItem") {
          unknownPathTexts.push(source.slice(node.from, node.to));
        }
      }
    });

    expect(unknownPathTexts).not.toContain("{A}");
    expect(unknownPathTexts).not.toContain("{B}");
  });

  it("covers core path operations up to parabola/sine/cosine without unknown fallbacks", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -| (1,1) |- (0,1) -- cycle;
  \draw (0,0) .. controls (1,1) and (2,1) .. (3,0);
  \draw (0,0) rectangle (1,1);
  \draw (0,0) circle [radius=1cm];
  \draw (0,0) ellipse [x radius=1cm, y radius=.5cm];
  \draw (0,0) arc[start angle=0, end angle=90, radius=1cm];
  \draw (0,0) grid [step=1] (2,2);
  \draw (0,0) parabola bend (1,1) (2,0);
  \draw (0,0) sin (1,1) cos (2,0);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);

    const keywords = result.figure.body
      .filter((statement) => statement.kind === "Path")
      .flatMap((statement) =>
        statement.kind === "Path"
          ? statement.items
              .filter((item) => item.kind === "PathKeyword")
              .map((item) => (item.kind === "PathKeyword" ? item.keyword : ""))
          : []
      );

    expect(keywords).toEqual(
      expect.arrayContaining(["cycle", "controls", "and", "rectangle", "circle", "ellipse", "arc", "grid", "parabola", "bend", "sin", "cos"])
    );

    const unknown = result.figure.body
      .filter((statement) => statement.kind === "Path")
      .flatMap((statement) =>
        statement.kind === "Path"
          ? statement.items.filter((item) => item.kind === "UnknownPathItem").map((item) => (item.kind === "UnknownPathItem" ? item.raw.trim() : ""))
          : []
      );

    expect(unknown).toHaveLength(0);
  });

  it("maps `plot coordinates {...}` to a typed PlotOperation item", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw plot coordinates {(0,0) (1,1) (2,0)};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    const statement = result.figure.body.find((item) => item.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      return;
    }

    const plot = statement.items.find((item) => item.kind === "PlotOperation");
    expect(plot?.kind).toBe("PlotOperation");
    if (plot?.kind === "PlotOperation") {
      expect(plot.mode).toBe("coordinates");
      expect(plot.dataRaw?.trim().startsWith("{")).toBe(true);
      expect(plot.dataRaw?.trim().endsWith("}")).toBe(true);
    }

    expect(statement.items.some((item) => item.kind === "PathKeyword" && item.keyword === "plot")).toBe(false);
  });

  it("maps `plot[domain=...,samples=...] (...)` to expression PlotOperation", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw plot[domain=0:2,samples=7] (\x,{exp(\x/2)});
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    const statement = result.figure.body.find((item) => item.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      return;
    }

    const plot = statement.items.find((item) => item.kind === "PlotOperation");
    expect(plot?.kind).toBe("PlotOperation");
    if (plot?.kind === "PlotOperation") {
      expect(plot.mode).toBe("expression");
      const keys = plot.options?.entries
        .filter((entry) => entry.kind === "kv")
        .map((entry) => (entry.kind === "kv" ? entry.key : ""));
      expect(keys).toEqual(expect.arrayContaining(["domain", "samples"]));
      expect(plot.dataRaw).toContain("(");
      expect(plot.dataRaw).toContain(")");
    }
  });

  it("maps `plot function{...}` and `plot file{...}` to typed PlotOperation modes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw plot function{sin(\x)};
  \draw plot file{data.dat};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    const plots = result.figure.body
      .filter((statement) => statement.kind === "Path")
      .flatMap((statement) => (statement.kind === "Path" ? statement.items : []))
      .filter((item) => item.kind === "PlotOperation");

    expect(plots.length).toBe(2);
    const modes = plots.map((item) => (item.kind === "PlotOperation" ? item.mode : "unknown"));
    expect(modes).toEqual(expect.arrayContaining(["function", "file"]));
  });

  it("maps top-level and path pic syntax to PicOperation items", () => {
    const source = String.raw`\begin{tikzpicture}
  \pic at (1,0) {foo};
  \path (0,0) pic {foo};
  \path pic [rotate=30] at (1,0) {foo};
  \pic [pic type=foo];
  \path (0,0) pic [pic type=foo] (1,0);
  \path pic foreach \x in {1,2} at (\x,0) {foo};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    const paths = result.figure.body.filter((statement) => statement.kind === "Path");
    expect(paths).toHaveLength(6);
    const pics = paths.flatMap((statement) =>
      statement.kind === "Path" ? statement.items.filter((item) => item.kind === "PicOperation") : []
    );
    expect(pics).toHaveLength(6);

    const [topLevel, pathPlaced, rotated, typeFromOption, pathTypeFromOption, foreachPic] = pics;
    expect(topLevel?.kind).toBe("PicOperation");
    if (topLevel?.kind === "PicOperation") {
      expect(topLevel.atRaw).toBe("(1,0)");
      expect(topLevel.typeRaw).toBe("foo");
    }
    expect(pathPlaced?.kind).toBe("PicOperation");
    if (pathPlaced?.kind === "PicOperation") {
      expect(pathPlaced.typeSource).toBe("group");
      expect(pathPlaced.typeRaw).toBe("foo");
    }
    expect(rotated?.kind).toBe("PicOperation");
    if (rotated?.kind === "PicOperation") {
      expect(rotated.options?.entries.some((entry) => entry.kind === "kv" && entry.key === "rotate")).toBe(true);
      expect(rotated.atRaw).toBe("(1,0)");
    }
    expect(typeFromOption?.kind).toBe("PicOperation");
    if (typeFromOption?.kind === "PicOperation") {
      expect(typeFromOption.typeSource).toBe("option");
      expect(typeFromOption.typeRaw).toBe("foo");
    }
    expect(pathTypeFromOption?.kind).toBe("PicOperation");
    if (pathTypeFromOption?.kind === "PicOperation") {
      expect(pathTypeFromOption.typeSource).toBe("option");
      expect(pathTypeFromOption.typeRaw).toBe("foo");
    }
    expect(foreachPic?.kind).toBe("PicOperation");
    if (foreachPic?.kind === "PicOperation") {
      expect(foreachPic.foreachClauses).toHaveLength(1);
      expect(foreachPic.atRaw).toBe("(\\x,0)");
    }
  });

  it("parses to, edge, svg, let, decorate, and coordinate operations with typed IR items", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) to [edge label=x, edge label'=y] node [above] {t} (3,2);
  \path (0,0) edge [->] node [below] {e} (2,1);
  \draw decorate[decoration=zigzag] {(0,0) -- (1,0)};
  \filldraw [fill=red!20] (0,1) svg[scale=2] {h 10 v 10 h -10} -- cycle;
  \path let \p1 = (1,1), \p2 = (2,0) in (0,0) -- (\p2);
  \path coordinate (p1) at (1,0) coordinate (p2) at (2,1);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);

    const items = result.figure.body
      .filter((statement) => statement.kind === "Path")
      .flatMap((statement) => (statement.kind === "Path" ? statement.items : []));

    expect(items.some((item) => item.kind === "ToOperation")).toBe(true);
    expect(items.some((item) => item.kind === "EdgeOperation")).toBe(true);
    expect(items.some((item) => item.kind === "SvgOperation")).toBe(true);
    expect(items.some((item) => item.kind === "LetOperation")).toBe(true);
    expect(items.some((item) => item.kind === "DecorateOperation")).toBe(true);
    expect(items.filter((item) => item.kind === "CoordinateOperation").length).toBeGreaterThanOrEqual(2);

    const svg = items.find((item) => item.kind === "SvgOperation");
    expect(svg?.kind).toBe("SvgOperation");
    if (svg?.kind === "SvgOperation") {
      expect(svg.dataRaw).toBe("{h 10 v 10 h -10}");
    }
  });

  it("parses nested decorate operations as typed path items", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw decorate[decoration=crosses] {
    decorate[decoration=zigzag] {(0,0) -- (1,0)}
  };
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    const path = result.figure.body.find((statement) => statement.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind !== "Path") {
      return;
    }

    const decorateOps = path.items.filter((item) => item.kind === "DecorateOperation");
    expect(decorateOps.length).toBeGreaterThanOrEqual(1);
    const first = decorateOps[0];
    if (first?.kind === "DecorateOperation") {
      expect(first.subpathRaw.trim().startsWith("{")).toBe(true);
      expect(first.subpathRaw.trim().endsWith("}")).toBe(true);
    }
  });

  it("parses label/pin options and edge quotes syntax without hard parse errors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,"label" left,pin=45:P,label={[red]above:X}] at (0,0) {A};
  \draw (0,0) edge["left","right"' near end] (2,0);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);

    const firstPath = result.figure.body[0];
    expect(firstPath?.kind).toBe("Path");
    if (firstPath?.kind === "Path") {
      const node = firstPath.items.find((item) => item.kind === "Node");
      expect(node?.kind).toBe("Node");
      if (node?.kind === "Node") {
        expect(node.options?.entries.some((entry) => entry.kind === "kv" && entry.key === "label")).toBe(true);
        expect(node.options?.entries.some((entry) => entry.kind === "kv" && entry.key === "pin")).toBe(true);
        expect(node.options?.entries.some((entry) => entry.kind === "unknown" && entry.raw.trim().startsWith("\""))).toBe(true);
      }
    }

    const secondPath = result.figure.body[1];
    expect(secondPath?.kind).toBe("Path");
    if (secondPath?.kind === "Path") {
      const edge = secondPath.items.find((item) => item.kind === "EdgeOperation");
      expect(edge?.kind).toBe("EdgeOperation");
      if (edge?.kind === "EdgeOperation") {
        expect(edge.options?.entries.some((entry) => entry.kind === "unknown" && entry.raw.trim().startsWith("\""))).toBe(true);
      }
    }
  });

  it("recognizes action command aliases as path commands", () => {
    const source = String.raw`\begin{tikzpicture}
  \pattern (0,0) circle (1ex);
  \shadedraw (0,0) circle (1ex);
  \useasboundingbox (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const result = parseTikz(source);

    const commands = result.figure.body
      .filter((statement) => statement.kind === "Path")
      .map((statement) => (statement.kind === "Path" ? statement.command : "path"));

    expect(commands).toEqual(expect.arrayContaining(["pattern", "shadedraw", "useasboundingbox"]));
  });

  it("parses scope and foreach constructs used in actions examples without hard errors", () => {
    const source = String.raw`\begin{tikzpicture}[|-|, dash pattern=on 4pt off 2pt]
  \begin{scope}[line width=1pt]
    \draw[line cap=round] (0,1 ) -- +(1,0);
    \draw[line cap=butt]  (0,.5) -- +(1,0);
  \end{scope}
  \foreach \lw in {0.5,1,1.5,2,2.5}
    \draw[line width=\lw pt,double] (\lw,0) -- ++(4mm,0);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    expect(result.figure.options?.entries.length).toBeGreaterThan(0);

    const scope = result.figure.body.find((statement) => statement.kind === "Scope");
    expect(scope?.kind).toBe("Scope");
    if (scope?.kind === "Scope") {
      expect(scope.options?.entries.some((entry) => entry.kind === "kv" && entry.key === "line width")).toBe(true);
      expect(scope.body.some((statement) => statement.kind === "Path")).toBe(true);
    }

    const foreach = result.figure.body.find((statement) => statement.kind === "Foreach");
    expect(foreach?.kind).toBe("Foreach");
    if (foreach?.kind === "Foreach") {
      expect(foreach.prefixRaw).toContain("\\lw");
      expect(foreach.bodyRaw.length).toBeGreaterThan(0);
      expect(foreach.variablesRaw).toContain("\\lw");
      expect(foreach.listRaw).toContain("0.5");
    }
  });

  it("parses foreach headers when comments contain the word `in`", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x [count=\i, % in comments should be ignored
               var=\v] in {1,2}
    \node at (\x,0) {\v};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    const foreach = result.figure.body.find((statement) => statement.kind === "Foreach");
    expect(foreach?.kind).toBe("Foreach");
    if (foreach?.kind === "Foreach") {
      expect(foreach.variablesRaw).toContain("\\x");
      expect(foreach.listRaw).toContain("1,2");
      expect(foreach.options?.entries.some((entry) => entry.kind === "kv" && entry.key === "count")).toBe(true);
      expect(foreach.options?.entries.some((entry) => entry.kind === "kv" && entry.key === "var")).toBe(true);
    }
  });

  it("treats control sequences starting with \\tikz as ordinary foreach variables when longer", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \tikzfoo in {0,1}
    \node at (\tikzfoo,0) {\tikzfoo};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    const foreach = result.figure.body.find((statement) => statement.kind === "Foreach");
    expect(foreach?.kind).toBe("Foreach");
    if (foreach?.kind === "Foreach") {
      expect(foreach.variablesRaw).toBe(String.raw`\tikzfoo`);
    }
  });

  it("emits a specific parse diagnostic when foreach ranges use `..` instead of `...`", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,..,10} \node at (\x,0) {\x};
\end{tikzpicture}`;
    const result = parseTikz(source);

    const invalidRange = result.diagnostics.find((diagnostic) => diagnostic.code === "invalid-foreach-range-ellipsis");
    expect(invalidRange).toBeDefined();
    expect(invalidRange?.severity).toBe("error");
    expect(invalidRange?.message).toContain("use `...`");
    expect(invalidRange?.span).toBeDefined();
    if (!invalidRange?.span) {
      return;
    }

    expect(source.slice(invalidRange.span.from, invalidRange.span.to)).toBe("..");
  });

  it("parses path foreach operations as typed path items", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) foreach \x in {1,2} { -- (\x,0) };
\end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body.find((entry) => entry.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      return;
    }

    const foreachItem = statement.items.find((item) => item.kind === "PathForeach");
    expect(foreachItem?.kind).toBe("PathForeach");
    if (foreachItem?.kind === "PathForeach") {
      expect(foreachItem.variablesRaw).toContain("\\x");
      expect(foreachItem.listRaw).toContain("1,2");
      expect(foreachItem.bodyRaw).toContain("--");
    }
  });

  it("parses node foreach clauses and keeps a foreach-free node template", () => {
    const source = String.raw`\begin{tikzpicture}
  \path (0,0) -- (2,0) node foreach \p in {0.25,0.75} [pos=\p] {\p};
\end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body.find((entry) => entry.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      return;
    }

    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (node?.kind === "Node") {
      expect(node.foreachClauses).toHaveLength(1);
      expect(node.foreachClauses?.[0]?.variablesRaw).toContain("\\p");
      expect(node.foreachClauses?.[0]?.listRaw).toContain("0.25");
      expect(node.templateRaw.includes("foreach")).toBe(false);
    }
  });

  it("parses child operations with nested child bodies", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {left} child { node {left-left} } }
    child { node {right} };
\end{tikzpicture}`;
    const result = parseTikz(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    const statement = result.figure.body.find((entry) => entry.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      return;
    }

    const childItems = statement.items.filter((item) => item.kind === "ChildOperation");
    expect(childItems).toHaveLength(2);
    const firstChild = childItems[0];
    expect(firstChild?.kind).toBe("ChildOperation");
    if (firstChild?.kind === "ChildOperation") {
      expect(firstChild.body.some((item) => item.kind === "Node")).toBe(true);
      expect(firstChild.body.some((item) => item.kind === "ChildOperation")).toBe(true);
    }
  });

  it("maps child body node text spans back to original source offsets", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {left} child { node {left-left} } }
    child { node {right} };
\end{tikzpicture}`;
    const result = parseTikz(source);
    const statement = result.figure.body.find((entry) => entry.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      return;
    }

    const firstChild = statement.items.find((item) => item.kind === "ChildOperation");
    expect(firstChild?.kind).toBe("ChildOperation");
    if (!firstChild || firstChild.kind !== "ChildOperation") {
      return;
    }

    const firstChildRoot = firstChild.body.find((item) => item.kind === "Node");
    expect(firstChildRoot?.kind).toBe("Node");
    if (!firstChildRoot || firstChildRoot.kind !== "Node") {
      return;
    }
    expect(source.slice(firstChildRoot.textSpan.from, firstChildRoot.textSpan.to)).toBe("left");

    const nestedChild = firstChild.body.find((item) => item.kind === "ChildOperation");
    expect(nestedChild?.kind).toBe("ChildOperation");
    if (!nestedChild || nestedChild.kind !== "ChildOperation") {
      return;
    }
    const nestedRoot = nestedChild.body.find((item) => item.kind === "Node");
    expect(nestedRoot?.kind).toBe("Node");
    if (!nestedRoot || nestedRoot.kind !== "Node") {
      return;
    }
    expect(source.slice(nestedRoot.textSpan.from, nestedRoot.textSpan.to)).toBe("left-left");
  });

  it("parses child foreach clauses and keeps a foreach-free child template", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child foreach \x in {a,b} { node {\x} };
\end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body.find((entry) => entry.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      return;
    }

    const child = statement.items.find((item) => item.kind === "ChildOperation");
    expect(child?.kind).toBe("ChildOperation");
    if (child?.kind === "ChildOperation") {
      expect(child.foreachClauses).toHaveLength(1);
      expect(child.foreachClauses?.[0]?.variablesRaw).toContain("\\x");
      expect(child.foreachClauses?.[0]?.listRaw).toContain("a,b");
      expect(child.templateRaw.includes("foreach")).toBe(false);
    }
  });

  it("parses edge from parent and edge to parent aliases as typed tree operations", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {left} edge from parent node[left] {L} }
    child { node {right} edge to parent node[right] {R} };
\end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body.find((entry) => entry.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      return;
    }

    const firstChild = statement.items.find((item) => item.kind === "ChildOperation");
    expect(firstChild?.kind).toBe("ChildOperation");
    if (firstChild?.kind !== "ChildOperation") {
      return;
    }

    const nestedEdges = firstChild.body.filter((item) => item.kind === "EdgeFromParentOperation");
    expect(nestedEdges).toHaveLength(1);
    if (nestedEdges[0]?.kind === "EdgeFromParentOperation") {
      expect(nestedEdges[0].alias).toBe("edge from parent");
      expect(nestedEdges[0].nodes?.length).toBeGreaterThan(0);
    }

    const secondChild = statement.items.filter((item) => item.kind === "ChildOperation")[1];
    expect(secondChild?.kind).toBe("ChildOperation");
    if (secondChild?.kind === "ChildOperation") {
      const secondNestedEdge = secondChild.body.find((item) => item.kind === "EdgeFromParentOperation");
      expect(secondNestedEdge?.kind).toBe("EdgeFromParentOperation");
      if (secondNestedEdge?.kind === "EdgeFromParentOperation") {
        expect(secondNestedEdge.alias).toBe("edge to parent");
      }
    }
  });

  it("does not fall back to UnknownPathItem for chapter tree syntax", () => {
    const source = String.raw`\begin{tikzpicture}
  \path[grow=right, level distance=8mm, sibling distance=6mm]
    node {root}
    child { node {a} edge from parent node[above] {A} }
    child foreach \x in {b,c} { node {\x} };
\end{tikzpicture}`;
    const result = parseTikz(source);

    const statement = result.figure.body.find((entry) => entry.kind === "Path");
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      return;
    }

    const hasUnknownAtTopLevel = statement.items.some((item) => item.kind === "UnknownPathItem");
    const hasUnknownInChildren = statement.items.some(
      (item) => item.kind === "ChildOperation" && item.body.some((nested) => nested.kind === "UnknownPathItem")
    );
    expect(hasUnknownAtTopLevel).toBe(false);
    expect(hasUnknownInChildren).toBe(false);
  });

  it("supports node text validator hooks and reports TeX validation diagnostics", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) node {ok} -- (1,0) node {bad};
\end{tikzpicture}`;
    const result = parseTikz(source, {
      nodeTextValidator: ({ node }) =>
        node.text === "bad"
          ? {
              code: "invalid-node-tex",
              message: "Invalid node TeX."
            }
          : null
    });

    const textDiagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === "invalid-node-tex");
    expect(textDiagnostics).toHaveLength(1);
    expect(textDiagnostics[0]?.severity).toBe("error");
    expect(textDiagnostics[0]?.message).toBe("Invalid node TeX.");
  });
});
