import { describe, expect, it } from "vitest";

import { expandForeachFigure } from "../packages/core/src/foreach/expand.js";
import { parseForeachHeaderRaw, stripForeachCommandPrefix } from "../packages/core/src/foreach/header.js";
import { expandForeachList } from "../packages/core/src/foreach/list.js";
import {
  buildForeachIterations,
  parseForeachOptions,
  resolveForeachVariables
} from "../packages/core/src/foreach/options.js";
import {
  parseNodeItemsFromTemplate,
  parsePathItemsFromFragmentWithMapping,
  parsePathItemsFromFragmentWithSyntheticMapping,
  parseStatementsFromBodyWithMapping
} from "../packages/core/src/foreach/snippet-parse.js";
import { substituteForeachBindingsWithMap } from "../packages/core/src/foreach/substitute.js";
import { parseOptionListRaw } from "../packages/core/src/options/parse.js";
import { parseTikz } from "../packages/core/src/parser/index.js";

const LOOP_SPAN = { from: 10, to: 20 };

function parseOptions(raw: string) {
  return parseOptionListRaw(raw, 100);
}

function parseFigure(source: string) {
  const parsed = parseTikz(source, { recover: true });
  expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  return parsed.figure;
}

describe("foreach helpers", () => {
  it("expands numeric, decimal, prefixed, and alphabetic dotted foreach lists", () => {
    expect(expandForeachList("{1,3,...,9}", { parseExpressions: false })).toEqual(["1", "3", "5", "7", "9"]);
    expect(expandForeachList("{3,2,...,-1}", { parseExpressions: false })).toEqual(["3", "2", "1", "0", "-1"]);
    expect(expandForeachList("{0,0.25,...,1}", { parseExpressions: false })).toEqual(["0", "0.25", "0.5", "0.75", "1"]);
    expect(expandForeachList("{p1,p2,p...,p5}", { parseExpressions: false })).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(expandForeachList("{A,C,...,G,z,y,...,w}", { parseExpressions: false })).toEqual([
      "A",
      "C",
      "E",
      "G",
      "z",
      "y",
      "x",
      "w"
    ]);
  });

  it("leaves malformed dotted entries intact and preserves nested top-level entries", () => {
    expect(expandForeachList("", { parseExpressions: false })).toEqual([]);
    expect(expandForeachList("{{a,b}, c, 1,...}", { parseExpressions: false })).toEqual(["{a,b}", "c", "1", "..."]);
    expect(expandForeachList("{x1,x2,...,y4}", { parseExpressions: false })).toEqual(["x1", "x2", "...", "y4"]);
    expect(expandForeachList("{1,...,a}", { parseExpressions: false })).toEqual(["1", "...", "a"]);
    expect(expandForeachList("1,2,...,4", { parseExpressions: false })).toEqual(["1", "2", "3", "4"]);
    expect(expandForeachList("{1,{2},...,4}", { parseExpressions: false })).toEqual(["1", "{2}", "...", "4"]);
    expect(expandForeachList("{, ,}", { parseExpressions: false })).toEqual([]);
    expect(expandForeachList("{\\{,1,...,3}", { parseExpressions: false })).toEqual([String.raw`\{`, "1", "2", "3"]);
  });

  it("expands foreach lists from parsed numeric expressions", () => {
    expect(expandForeachList("{1+1,3+1,...,8}", { parseExpressions: true })).toEqual(["1+1", "3+1", "6", "8"]);
    expect(expandForeachList("{0.3,0.2,...,0}", { parseExpressions: false })).toEqual(["0.3", "0.2", "0.1", "0"]);
  });

  it("parses foreach headers without treating comments or nested text as the in keyword", () => {
    expect(stripForeachCommandPrefix(String.raw`  \foreach \x in {1}`)).toBe(String.raw`\x in {1}`);
    expect(stripForeachCommandPrefix(" foreach \\x in {1}")).toBe(String.raw`\x in {1}`);

    const parsed = parseForeachHeaderRaw(String.raw`\x [count=\i, var=\v] in {{pin}, {a in b}, c}`);
    expect(parsed).toMatchObject({
      variablesRaw: String.raw`\x`,
      listRaw: "{{pin}, {a in b}, c}",
      optionsRaw: String.raw`[count=\i, var=\v]`,
      isValid: true
    });
    expect(parsed.optionsSpan).toEqual({ from: 3, to: 21 });

    const commentMasked = parseForeachHeaderRaw(String.raw`\x % in {wrong}
in {right}`);
    expect(commentMasked.variablesRaw).toBe(String.raw`\x`);
    expect(commentMasked.listRaw).toBe("{right}");

    const invalid = parseForeachHeaderRaw(String.raw`\x [count=\i]`);
    expect(invalid.isValid).toBe(false);
    expect(invalid.variablesRaw).toBe(String.raw`\x`);
    expect(invalid.optionsRaw).toBe(String.raw`[count=\i]`);

    expect(stripForeachCommandPrefix("  \\other \\x in {1}")).toBe(String.raw`\other \x in {1}`);
    expect(parseForeachHeaderRaw("")).toMatchObject({ isValid: false, variablesRaw: "", listRaw: "" });

    const nestedLeft = parseForeachHeaderRaw(String.raw`\x(a)[ignored] {\y}[also ignored] [count=\i] in {1}`);
    expect(nestedLeft.variablesRaw).toBe(String.raw`\x(a) {\y}`);
    expect(nestedLeft.optionsRaw).toBe(String.raw`[ignored]`);

    const unterminatedOption = parseForeachHeaderRaw(String.raw`\x [broken in {1}`);
    expect(unterminatedOption.isValid).toBe(false);
    expect(unterminatedOption.variablesRaw).toBe(String.raw`\x [broken in {1}`);
  });

  it("normalizes supported foreach option rules and reports unsupported entries", () => {
    const config = parseForeachOptions(parseOptions(String.raw`[
      var=\y,
      evaluate=\x as \xx using \x*\x,
      remember=\x as \prev (initially -1),
      count=\i from 0,
      parse=false,
      expand list=off,
      unknown flag,
      evaluate=not-a-control-sequence,
      var=not-a-control-sequence
    ]`));

    expect(config.variablesFromOptions).toEqual([String.raw`\y`]);
    expect(config.evaluateRules).toMatchObject([{ variable: String.raw`\x`, target: String.raw`\xx`, expression: String.raw`\x*\x` }]);
    expect(config.rememberRules).toMatchObject([{ variable: String.raw`\x`, target: String.raw`\prev`, initial: "-1" }]);
    expect(config.countRules).toMatchObject([{ target: String.raw`\i`, current: 0 }]);
    expect(config.parseExpressions).toBe(false);
    expect(config.expandList).toBe(false);
    expect(config.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "foreach-unsupported-option:unknown flag",
      "foreach-unsupported-option:evaluate",
      "foreach-unsupported-option:var"
    ]);

    const defaults = parseForeachOptions(undefined);
    expect(defaults.parseExpressions).toBe(false);

    const enabled = parseForeachOptions(parseOptions(String.raw`[parse, expand list]`));
    expect(enabled.parseExpressions).toBe(true);
    expect(enabled.expandList).toBe(true);

    const malformed = parseForeachOptions(parseOptions(String.raw`[
      remember=not-a-control-sequence,
      count=not-a-control-sequence,
      count=\i from nope,
      parse=maybe,
      expand list=maybe,
      unknown=value
    ]`));
    expect(malformed.countRules).toMatchObject([{ target: String.raw`\i`, current: 1 }]);
    expect(malformed.parseExpressions).toBe(true);
    expect(malformed.expandList).toBe(true);
    expect(malformed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "foreach-unsupported-option:remember",
      "foreach-unsupported-option:count",
      "foreach-unsupported-option:unknown"
    ]);
  });

  it("evaluates foreach expressions into existing variables and keeps nested list groups intact", () => {
    const result = buildForeachIterations({
      variablesRaw: String.raw`\x/\y`,
      listRaw: String.raw`{{{1/2}}, {3/4}}`,
      options: parseOptions(String.raw`[evaluate=\x using \x+10, remember=\missing]`),
      baseBindings: {},
      loopSpan: LOOP_SPAN
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.iterations.map((iteration) => iteration.bindings)).toEqual([
      { "\\x": "11", "\\y": "2", "\\missing": "0" },
      { "\\x": "13", "\\y": "4", "\\missing": "0" }
    ]);
  });

  it("builds iteration bindings for split entries, fallback values, counts, remember, and failed evaluate rules", () => {
    const result = buildForeachIterations({
      variablesRaw: String.raw`\x/\y`,
      listRaw: String.raw`{1/2,{3/4},5}`,
      options: parseOptions(String.raw`[
        var=\z,
        count=\i from 0,
        remember=\x as \previous (initially start),
        evaluate=\missing as \bad using \missing+
      ]`),
      baseBindings: { "\\base": "B" },
      loopSpan: LOOP_SPAN
    });

    expect(resolveForeachVariables(String.raw`\x/\y`, parseForeachOptions(parseOptions(String.raw`[var=\x,var=\z]`)))).toEqual([
      String.raw`\x`,
      String.raw`\y`,
      String.raw`\z`
    ]);
    expect(result.iterations.map((iteration) => iteration.bindings)).toEqual([
      {
        "\\x": "1",
        "\\y": "2",
        "\\z": "2",
        "\\i": "0",
        "\\bad": String.raw`\missing+`,
        "\\previous": "start"
      },
      {
        "\\x": "3",
        "\\y": "4",
        "\\z": "4",
        "\\i": "1",
        "\\bad": String.raw`\missing+`,
        "\\previous": "1"
      },
      {
        "\\x": "5",
        "\\y": "5",
        "\\z": "5",
        "\\i": "2",
        "\\bad": String.raw`\missing+`,
        "\\previous": "3"
      }
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "foreach-evaluate-failed:token",
      "foreach-evaluate-failed:token",
      "foreach-evaluate-failed:token"
    ]);
  });

  it("reports invalid iteration headers and empty lists", () => {
    expect(buildForeachIterations({
      variablesRaw: "not-a-variable",
      listRaw: "{1}",
      options: undefined,
      baseBindings: {},
      loopSpan: LOOP_SPAN
    }).diagnostics[0]?.code).toBe("invalid-foreach-header");

    expect(buildForeachIterations({
      variablesRaw: String.raw`\x`,
      listRaw: "{}",
      options: undefined,
      baseBindings: {},
      loopSpan: LOOP_SPAN
    }).diagnostics[0]?.code).toBe("invalid-foreach-list");
  });

  it("maps substituted output spans back to the original foreach template", () => {
    const substituted = substituteForeachBindingsWithMap(String.raw`\draw\x -- \xx -- \missing;`, {
      "\\x": "alpha",
      "\\xx": String.raw`\nodeName`
    });

    expect(substituted.output).toBe(String.raw`\draw{}alpha -- \nodeName -- \missing;`);
    expect(substituted.mapSpan({ from: 0, to: 5 })).toEqual({ from: 0, to: 5 });
    expect(substituted.mapSpan({ from: substituted.output.indexOf("alpha"), to: substituted.output.indexOf("alpha") + 5 })).toEqual({
      from: 5,
      to: 6
    });
    expect(substituted.mapSpan({ from: -1, to: 1 })).toBeNull();
    expect(substituted.mapSpan({ from: 2, to: 1 })).toBeNull();
    expect(substituteForeachBindingsWithMap("", { "\\x": "1" }).mapSpan({ from: 0, to: 0 })).toEqual({ from: 0, to: 0 });
    expect(substituteForeachBindingsWithMap("abc", {}).mapSpan({ from: 1, to: 1 })).toEqual({ from: 1, to: 1 });

    const emptyReplacement = substituteForeachBindingsWithMap(String.raw`\x`, { "\\x": "" });
    expect(emptyReplacement.output).toBe("");
    expect(emptyReplacement.mapSpan({ from: 0, to: 0 })).toBeNull();
  });

  it("parses statement, path, and node snippets with original source mapping", () => {
    const statements = parseStatementsFromBodyWithMapping("  { \\draw (0,0) -- (1,0); } ", { from: 50, to: 78 });
    expect(statements.hasParseError).toBe(false);
    expect(statements.parseResult.figure.body).toHaveLength(1);
    const statement = statements.parseResult.figure.body[0];
    expect(statement?.kind).toBe("Path");
    expect(statement ? statements.sourceMapper.mapSpan(statement.span) : null).toEqual({ from: 54, to: 75 });
    expect(statements.sourceMapper.mapOffset(0)).toBeNull();

    const path = parsePathItemsFromFragmentWithMapping("  { -- (1,0) node {A} }  ", { from: 200, to: 224 });
    expect(path.hasParseError).toBe(false);
    expect(path.value.some((item) => item.kind === "Coordinate")).toBe(true);
    expect(path.value.some((item) => item.kind === "Node")).toBe(true);
    expect(path.sourceMapper.mapOffset(0)).toBeNull();

    const syntheticPath = parsePathItemsFromFragmentWithSyntheticMapping("???", { from: 0, to: 3 });
    expect(syntheticPath.hasParseError).toBe(false);

    const node = parseNodeItemsFromTemplate("node[draw] at (0,0) {A}");
    expect(node.hasParseError).toBe(false);
    expect(node.value.some((item) => item.kind === "Node")).toBe(true);
    expect(parseNodeItemsFromTemplate("???").hasParseError).toBe(false);
  });

  it("expands path, node, child, macro, conditional, and budget edge cases through the figure expander", () => {
    const source = String.raw`\begin{tikzpicture}
\def\one{\draw (1,0) -- (1,1);}
\foreach \x in {0,1} {\one}
\draw (0,0) foreach \p in {1,2} { -- (\p,0) } node foreach \n in {A,B} {\n}
  child foreach \c in {L,R} { node {\c} };
\draw (0,0) child { node {plain} };
\foreach \q in {0,1} {\breakforeach\draw (\q,0) -- (\q,1);}
\end{tikzpicture}`;
    const expanded = expandForeachFigure(parseFigure(source), source, 20);
    const paths = expanded.figureBody.filter((statement) => statement.kind === "Path");

    expect(paths.length).toBeGreaterThanOrEqual(4);
    expect(expanded.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-breakforeach")).toBe(true);
    expect(expanded.diagnostics.filter((diagnostic) => diagnostic.code === "unsupported-breakforeach")).toHaveLength(1);
    expect(paths.some((path) => path.kind === "Path" && path.items.some((item) => item.kind === "ChildOperation"))).toBe(true);

    for (const statement of paths) {
      expect(expanded.statementAttribution.get(statement)?.foreachStack).toBeDefined();
      const sourceMap = expanded.statementSourceMaps.get(statement);
      if (sourceMap) {
        expect(sourceMap.mapSpan(statement.span)).not.toEqual({ from: statement.span.from, to: statement.span.to });
      }
    }
  });

  it("expands callable macros with optional and required arguments inside foreach bodies", () => {
    const source = String.raw`\begin{tikzpicture}
\newcommand{\markpoint}[2][blue]{\node[#1] at (#2,0) {#1};}
\foreach \x in {1,2} {
  \markpoint[red]{\x}
  \markpoint{\x}
}
\end{tikzpicture}`;

    const expanded = expandForeachFigure(parseFigure(source), source);
    const nodes = expanded.figureBody.filter((statement) => statement.kind === "Path");

    expect(nodes).toHaveLength(4);
    expect(expanded.diagnostics).toEqual([]);
    expect(nodes.map((statement) => statement.id)).toEqual(["path:2", "path:3", "path:4", "path:5"]);
  });

  it("expands top-level callable macro invocations by reading source arguments", () => {
    const source = String.raw`\begin{tikzpicture}
\newcommand{\markpoint}[2][blue]{\node[#1] at (#2,0) {#1};}
\markpoint[red]{1};
\markpoint{2};
\newcommand{\single}[1]{\draw (#1,0) -- (#1,1);}
\single\foo;
\single 3;
\end{tikzpicture}`;

    const expanded = expandForeachFigure(parseFigure(source), source);
    const paths = expanded.figureBody.filter((statement) => statement.kind === "Path");

    expect(expanded.diagnostics).toEqual([]);
    expect(paths).toHaveLength(4);
    expect(paths.map((statement) => statement.id)).toEqual(["path:4", "path:5", "path:6", "path:7"]);
    expect(paths[0]?.items.some((item) => item.kind === "Node" && item.raw.includes("[red]"))).toBe(true);
    expect(paths[1]?.items.some((item) => item.kind === "Node" && item.raw.includes("[blue]"))).toBe(true);
    for (const path of paths) {
      expect(expanded.statementMacroAttribution.get(path)?.length).toBeGreaterThan(0);
      expect(expanded.statementSourceMaps.get(path)?.sourceKind).toBe("macro");
    }
  });

  it("reindexes diverse path items generated by callable macro bodies", () => {
    const source = String.raw`\begin{tikzpicture}
\newcommand{\complexpath}[3][red]{\draw[#1] (#2,0) -- (#2,1) to node {T#3} (#2,2) edge node {E#3} (#2,3) child { node {C#3} edge from parent node {P#3} child { node {L#3} } } plot coordinates {(0,0) (1,1)} svg {M 0 0 L 1 1} let \p1=(0,0) in (#2,4) decorate { -- (#2,5) } coordinate (Q#3) at (#2,6);}
\newcommand{\mark}[2]{\node at (#1,0) {#2};}
\complexpath[blue]{1}{A};
\complexpath{2}{B};
\mark\foo Z;
\end{tikzpicture}`;

    const expanded = expandForeachFigure(parseFigure(source), source);
    const paths = expanded.figureBody.filter((statement) => statement.kind === "Path");

    expect(expanded.diagnostics).toEqual([]);
    expect(paths).toHaveLength(3);

    const complex = paths[0];
    expect(complex?.kind).toBe("Path");
    if (!complex || complex.kind !== "Path") {
      throw new Error("Expected complex macro to expand to a path");
    }
    expect(complex.items.map((item) => item.kind)).toEqual([
      "PathOption",
      "Coordinate",
      "PathKeyword",
      "Coordinate",
      "ToOperation",
      "EdgeOperation",
      "ChildOperation",
      "PlotOperation",
      "SvgOperation",
      "LetOperation",
      "Coordinate",
      "DecorateOperation",
      "CoordinateOperation",
      "PathKeyword",
      "Coordinate"
    ]);
    expect(complex.items.map((item) => item.id)).toContain("svg-operation:2:8");
    expect(complex.items.map((item) => item.id)).toContain("let-operation:2:9");
    expect(complex.items.map((item) => item.id)).toContain("coordinate-operation:2:12");
    expect(complex.items.map((item) => item.id)).toContain("decorate-operation:2:11");

    const edge = complex.items.find((item) => item.kind === "EdgeOperation");
    expect(edge?.kind).toBe("EdgeOperation");
    if (edge?.kind === "EdgeOperation") {
      expect(edge.nodes?.map((node) => node.id)).toEqual(["edge-operation:2:5:node:0"]);
    }

    const child = complex.items.find((item) => item.kind === "ChildOperation");
    expect(child?.kind).toBe("ChildOperation");
    if (child?.kind === "ChildOperation") {
      expect(child.body.map((item) => item.id)).toEqual([
        "node:2:child-operation:2:6:body:0",
        "edge-from-parent-operation:2:child-operation:2:6:body:1",
        "child-operation:2:child-operation:2:6:body:2"
      ]);
    }

    expect(paths[2]?.items.some((item) => item.kind === "Node" && item.raw.includes("Z"))).toBe(true);
    for (const path of paths) {
      expect(expanded.statementMacroAttribution.get(path)?.length).toBeGreaterThan(0);
      expect(expanded.statementSourceMaps.get(path)?.sourceKind).toBe("macro");
    }
  });

  it("emits diagnostics for malformed foreach bodies and expansion limits", () => {
    const invalidHeader = String.raw`\begin{tikzpicture}\foreach in {1} {\draw (0,0);}\end{tikzpicture}`;
    expect(expandForeachFigure(parseFigure(invalidHeader), invalidHeader).diagnostics[0]?.code).toBe("invalid-foreach-header");

    const unsupportedBreak = String.raw`\begin{tikzpicture}\foreach \x in {1} {\breakforeach\draw (0,0);}\end{tikzpicture}`;
    expect(expandForeachFigure(parseFigure(unsupportedBreak), unsupportedBreak).diagnostics.some((diagnostic) => diagnostic.code === "unsupported-breakforeach")).toBe(true);

    const limited = String.raw`\begin{tikzpicture}\foreach \x in {0,1,2} {\draw (\x,0);}\end{tikzpicture}`;
    const limitedExpanded = expandForeachFigure(parseFigure(limited), limited, 1);
    expect(limitedExpanded.diagnostics.some((diagnostic) => diagnostic.code === "foreach-expansion-limit")).toBe(true);
    expect(limitedExpanded.figureBody).toHaveLength(1);
  });

  it("reports malformed path, node, and child foreach clauses without dropping surrounding paths", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) foreach in {1} { -- (1,0) };
\draw (0,0) node foreach in {A} {A};
\draw (0,0) child foreach in {L} { node {L} };
\end{tikzpicture}`;

    const expanded = expandForeachFigure(parseFigure(source), source);

    expect(expanded.figureBody.filter((statement) => statement.kind === "Path")).toHaveLength(3);
    expect(expanded.diagnostics.filter((diagnostic) => diagnostic.code === "invalid-foreach-header")).toHaveLength(3);
  });

  it("applies expansion limits inside path, node, and child foreach clauses", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) foreach \x in {1,2,3} { -- (\x,0) };
\draw (0,0) node foreach \n in {A,B} {\n};
\draw (0,0) child foreach \c in {L,R} { node {\c} };
\end{tikzpicture}`;

    const expanded = expandForeachFigure(parseFigure(source), source, 2);

    expect(expanded.figureBody.filter((statement) => statement.kind === "Path")).toHaveLength(3);
    expect(expanded.diagnostics.some((diagnostic) => diagnostic.code === "foreach-expansion-limit")).toBe(true);
  });

  it("builds clause variants for node, child, and pic foreach forms", () => {
    const source = String.raw`\begin{tikzpicture}
\path (0,0)
  node foreach \x in {0,1} foreach \y in {a,b} {\x\y};
\draw (0,0)
  child foreach \x in {0,1} {
    node {\x}
    edge from parent node {edge}
    child { node {leaf} edge from parent }
  };
\pic foreach \x in {0,1} at (\x,0) {mark};
\end{tikzpicture}`;

    const expanded = expandForeachFigure(parseFigure(source), source);
    const paths = expanded.figureBody.filter((statement) => statement.kind === "Path");
    const nodes = paths.flatMap((path) => path.items.filter((item) => item.kind === "Node"));
    const children = paths.flatMap((path) => path.items.filter((item) => item.kind === "ChildOperation"));
    const pics = paths.flatMap((path) => path.items.filter((item) => item.kind === "PicOperation"));

    expect(expanded.diagnostics).toEqual([]);
    expect(nodes).toHaveLength(4);
    expect(children).toHaveLength(2);
    expect(pics).toHaveLength(2);
    expect(nodes.map((item) => {
      const foreachStack = expanded.pathItemForeachStack.get(item) ?? [];
      expect(foreachStack).toHaveLength(2);
      return `${foreachStack[0]?.bindings["\\x"]}${foreachStack[1]?.bindings["\\y"]}`;
    })).toEqual(["0a", "0b", "1a", "1b"]);
    for (const items of [children, pics]) {
      expect(items.map((item) => {
        const foreachStack = expanded.pathItemForeachStack.get(item) ?? [];
        expect(foreachStack).toHaveLength(1);
        return foreachStack[0]?.bindings["\\x"];
      })).toEqual(["0", "1"]);
    }
  });

  it("reindexes non-path statements expanded from macro bodies", () => {
    const bodyRaw = String.raw`
  \tikzset{loop style/.style={draw}}
  \tikzstyle{legacy}=[blue]
  \pgfkeys{/tikz/.cd, helper/.style={dashed}}
  \usetikzlibrary{calc}
  \colorlet{loopcolor}{red}
  \definecolor{brand}{RGB}{1,2,3}
  \let\alias\base
  \def\local{1}
  \newcommand{\cmd}[1]{\draw (#1,0) -- (#1,1);}
`;
    const figure = {
      kind: "Figure" as const,
      span: { from: 0, to: bodyRaw.length },
      body: [
        {
          kind: "MacroDefinition" as const,
          id: "macro-definition:0",
          span: { from: 0, to: 15 },
          raw: String.raw`\def\base{red}`,
          commandRaw: "\\def" as const,
          nameRaw: String.raw`\base`,
          valueRaw: "red"
        },
        {
          kind: "Foreach" as const,
          id: "foreach:0",
          span: { from: 20, to: 40 },
          prefixRaw: String.raw`\foreach \x in {0}`,
          variablesRaw: String.raw`\x`,
          listRaw: "{0}",
          bodyRaw,
          bodySpan: { from: 0, to: bodyRaw.length }
        }
      ]
    };

    const expanded = expandForeachFigure(figure, bodyRaw);

    expect(expanded.diagnostics).toEqual([]);
    expect(expanded.figureBody.map((statement) => statement.kind)).toEqual([
      "MacroDefinition",
      "TikzSet",
      "TikzStyle",
      "Pgfkeys",
      "TikzLibrary",
      "Colorlet",
      "DefineColor",
      "MacroAlias",
      "MacroDefinition",
      "MacroCommandDefinition"
    ]);
    expect(expanded.figureBody.map((statement) => statement.id)).toEqual([
      "macro-definition:0",
      "tikz-set:9",
      "tikz-style:10",
      "pgfkeys:11",
      "tikz-library:12",
      "colorlet:13",
      "definecolor:14",
      "macro-alias:15",
      "macro-definition:16",
      "macro-command-definition:17"
    ]);
    expect(expanded.templateLocalIdByExpandedId.get("tikz-set:9")).toBe("tikz-set:0");
    expect(expanded.templateLocalIdByExpandedId.get("macro-command-definition:17")).toBe("macro-command-definition:8");
  });

  it("reindexes nested path items generated by child foreach bodies", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0)
  child foreach \side in {L} {
    node {\side}
    edge from parent node {edge}
    child { node {leaf} edge from parent }
  };
\end{tikzpicture}`;

    const expanded = expandForeachFigure(parseFigure(source), source);
    const path = expanded.figureBody.find((statement) => statement.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (!path || path.kind !== "Path") {
      throw new Error("Expected expanded path statement");
    }

    const child = path.items.find((item) => item.kind === "ChildOperation");
    expect(child?.kind).toBe("ChildOperation");
    if (!child || child.kind !== "ChildOperation") {
      throw new Error("Expected expanded child operation");
    }

    expect(child.id).toBe("child-operation:0:2");
    expect(child.body.map((item) => item.id)).toEqual([
      "node:0:0",
      "edge-from-parent-operation:0:1"
    ]);
    expect(expanded.pathItemForeachStack.get(child)?.[0]?.bindings["\\side"]).toBe("L");
  });
});
