import { describe, expect, it } from "vitest";

import type {
  AddLegendEntryStatement,
  AddPlotStatement,
  AxisBodyItem,
  AxisStatement,
  LegendStatement,
  PlotCoordinatesInput,
  Statement
} from "../packages/core/src/ast/types.js";
import { axisBodyStatements, walkStatements } from "../packages/core/src/ast/walk.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { createMinimalTikzSourceArtifact, createStandaloneLatexExportArtifact } from "../packages/core/src/export/index.js";
import { findPathStatementById } from "../packages/core/src/edit/statement-find.js";
import { parseStatementSnapshot } from "../packages/core/src/edit/statement-ops.js";
import { createIncrementalParseSession, parseTikz } from "../packages/core/src/parser/index.js";
import { getAxisEvaluations } from "../packages/core/src/pgfplots/evaluate-axis.js";
import { readCoordinateList } from "../packages/core/src/pgfplots/coordinate-list.js";
import { readInlineTable } from "../packages/core/src/pgfplots/inline-table.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";

const picture = (body: string): string => `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;

function errors(source: string) {
  return parseTikz(source).diagnostics.filter((diagnostic) => diagnostic.severity === "error");
}

function axisAt(source: string, index = 0): AxisStatement {
  const axes = parseTikz(source).figure.body.filter((statement): statement is AxisStatement & Statement => statement.kind === "Axis");
  const axis = axes[index];
  if (!axis) throw new Error(`No axis ${index} in ${source}`);
  return axis;
}

function plots(axis: AxisStatement): AddPlotStatement[] {
  return axis.body.filter((item): item is AddPlotStatement => item.kind === "AddPlot");
}

function onlyPlot(source: string): AddPlotStatement {
  const [plot] = plots(axisAt(source));
  if (!plot) throw new Error("No plot");
  return plot;
}

function coordinatesOf(plot: AddPlotStatement): PlotCoordinatesInput {
  if (plot.input.kind !== "coordinates") throw new Error(`Expected coordinates, got ${plot.input.kind}`);
  return plot.input;
}

const slice = (source: string, span: { from: number; to: number }): string => source.slice(span.from, span.to);

describe("pgfplots axis statements", () => {
  it("reads an axis with options, plots, legend entries and nested TikZ, and keeps the statement after it", () => {
    const source = picture(String.raw`  \begin{axis}[xmin=0, xmax=2]
    \addplot coordinates {(0,0) (1,1)};
    \addlegendentry{data}
    \draw (axis cs:1,1) -- (2,2);
  \end{axis}
  \draw (0,0) -- (1,1);`);
    const parsed = parseTikz(source);
    expect(errors(source)).toEqual([]);
    expect(parsed.figure.body.map((statement) => [statement.kind, statement.id])).toEqual([["Axis", "axis:0"], ["Path", "path:2"]]);
    const axis = axisAt(source);
    expect(axis.environment).toBe("axis");
    expect(axis.terminated).toBe(true);
    expect(slice(source, axis.beginSpan)).toBe("\\begin{axis}");
    expect(axis.endSpan && slice(source, axis.endSpan)).toBe("\\end{axis}");
    expect(axis.optionsSpan && slice(source, axis.optionsSpan)).toBe("[xmin=0, xmax=2]");
    expect(axis.options?.entries.map((entry) => entry.kind === "kv" ? `${entry.key}=${entry.valueRaw}` : entry.raw)).toEqual(["xmin=0", "xmax=2"]);
    expect(axis.body.map((item) => [item.kind, item.id])).toEqual([
      ["AddPlot", "axis:0:plot:0"],
      ["AddLegendEntry", "axis:0:legend-entry:0"],
      ["Path", "path:1"]
    ]);
    expect(slice(source, axis.span).startsWith("\\begin{axis}")).toBe(true);
    expect(slice(source, axis.span).endsWith("\\end{axis}")).toBe(true);
  });

  it("reads the log axis environments", () => {
    for (const environment of ["semilogxaxis", "semilogyaxis", "loglogaxis"] as const) {
      const source = picture(`\\begin{${environment}}\n\\addplot coordinates {(1,1) (10,100)};\n\\end{${environment}}`);
      expect(axisAt(source).environment).toBe(environment);
      expect(errors(source)).toEqual([]);
    }
  });

  it("reads option lists with comments, nested braces, brackets and commas in braces, math and styles", () => {
    const options = String.raw`[
    xmin=0, % the left end ]
    title={A, B] and C},
    xlabel={$\alpha_{x}$},
    every axis plot/.style={thick, mark=*},
    legend style={at={(0.5,-0.1)}, anchor=north},
  ]`;
    const source = picture(`\\begin{axis}${options}\n\\addplot {x};\n\\end{axis}`);
    const axis = axisAt(source);
    expect(errors(source)).toEqual([]);
    expect(axis.optionsSpan && slice(source, axis.optionsSpan)).toBe(options);
    expect(axis.options?.entries.filter((entry) => entry.kind === "kv").map((entry) => entry.kind === "kv" ? entry.key : "")).toEqual([
      "xmin", "title", "xlabel", "every axis plot/.style", "legend style"
    ]);
  });

  it("reads an axis without options, and one whose body starts with a comment", () => {
    const source = picture("\\begin{axis}\n% data\n\\addplot {x};\n\\end{axis}");
    const axis = axisAt(source);
    expect(axis.options).toBeUndefined();
    expect(plots(axis)).toHaveLength(1);
    expect(errors(source)).toEqual([]);
  });

  it("reads an axis inside a scope, and two axes in one picture", () => {
    const source = picture(String.raw`\begin{scope}[xshift=1cm]
  \begin{axis}[name=a] \addplot {x}; \end{axis}
\end{scope}
\begin{axis}[at={(a.south east)}] \addplot {x^2}; \end{axis}
\begin{loglogaxis} \addplot {x}; \end{loglogaxis}`);
    expect(errors(source)).toEqual([]);
    const body = parseTikz(source).figure.body;
    expect(body.map((statement) => statement.kind)).toEqual(["Scope", "Axis", "Axis"]);
    const scope = body[0];
    if (scope?.kind !== "Scope") throw new Error("Expected a scope");
    expect(scope.body.map((statement) => [statement.kind, statement.id])).toEqual([["Axis", "axis:1"]]);
    expect(body.map((statement) => statement.id)).toEqual(["scope:0", "axis:2", "axis:3"]);
    expect(plots(axisAt(source, 0)).map((plot) => plot.id)).toEqual(["axis:2:plot:0"]);
  });

  it("diagnoses an unterminated axis and keeps reading its plots", () => {
    const source = picture("\\begin{axis}\n  \\addplot coordinates {(0,0) (1,1)};");
    const axis = axisAt(source);
    expect(axis.terminated).toBe(false);
    expect(axis.endSpan).toBeUndefined();
    expect(plots(axis)).toHaveLength(1);
    const diagnostics = errors(source);
    expect(diagnostics.some((diagnostic) => diagnostic.code === "unterminated-environment" && diagnostic.message.includes("\\end{axis}"))).toBe(true);
  });

  it("diagnoses an axis ended by another axis environment", () => {
    const source = picture("\\begin{axis}\n  \\addplot {x};\n\\end{loglogaxis}");
    const axis = axisAt(source);
    expect(axis.endEnvironment).toBe("loglogaxis");
    expect(errors(source).map((diagnostic) => diagnostic.code)).toContain("mismatched-environment-end");
  });

  it("does not take axis commands outside an axis, or in macro bodies, as axis commands", () => {
    const source = String.raw`\newcommand{\myplot}{\addplot {x}; \legend{a}}
\begin{tikzpicture}
  \addplot {x};
\end{tikzpicture}`;
    const parsed = parseTikz(source, { includeContextDefinitions: true });
    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["MacroCommandDefinition", "UnknownStatement"]);
  });
});

describe("pgfplots \\addplot", () => {
  const inAxis = (body: string): string => picture(`\\begin{axis}\n${body}\n\\end{axis}`);

  it("reads \\addplot, \\addplot+ and \\addplot3 with their options", () => {
    const source = inAxis(String.raw`\addplot[red] {x};
\addplot+ [only marks] {x};
\addplot3 [surf] {x*y};
\addplot {x};`);
    const [plain, increment, threeD, bare] = plots(axisAt(source));
    expect(plain?.dimension).toBe(2);
    expect(plain?.increment).toBe(false);
    expect(plain?.optionsSpan && slice(source, plain.optionsSpan)).toBe("[red]");
    expect(increment?.increment).toBe(true);
    expect(increment?.incrementSpan && slice(source, increment.incrementSpan)).toBe("+");
    expect(increment?.optionsSpan && slice(source, increment.optionsSpan)).toBe("[only marks]");
    expect(threeD?.dimension).toBe(3);
    expect(threeD && slice(source, threeD.commandSpan)).toBe("\\addplot3");
    expect(bare?.options).toBeUndefined();
    expect(plots(axisAt(source)).map((plot) => plot.plotIndex)).toEqual([0, 1, 2, 3]);
    expect(errors(source)).toEqual([]);
  });

  it("reads the older `plot [options]` form", () => {
    const source = inAxis(String.raw`\addplot [red] plot [id=a, domain=0:1] gnuplot {x**2};
\addplot [blue] plot coordinates {(0,0) (1,1)};`);
    const [first, second] = plots(axisAt(source));
    expect(first?.legacyPlot && slice(source, first.legacyPlot.keywordSpan)).toBe("plot");
    expect(first?.legacyPlot?.optionsSpan && slice(source, first.legacyPlot.optionsSpan)).toBe("[id=a, domain=0:1]");
    expect(first?.input).toMatchObject({ kind: "other", name: "gnuplot", argumentRaw: "x**2" });
    expect(second?.legacyPlot?.options).toBeUndefined();
    expect(second && coordinatesOf(second).points).toHaveLength(2);
    expect(errors(source)).toEqual([]);
  });

  it("reads an expression, its long form and a parametric input", () => {
    const source = inAxis(String.raw`\addplot {x^2};
\addplot expression {exp(-x)};
\addplot[domain=0:1] ({cos(x)},{sin(x)});
\addplot3 ({x}, {y}, {x*y});
\addplot (x, x^2);`);
    const [square, long, circle, surface, bare] = plots(axisAt(source));
    expect(square?.input).toMatchObject({ kind: "expression", expression: "x^2" });
    expect(long?.input).toMatchObject({ kind: "expression", expression: "exp(-x)" });
    expect(long?.input.kind === "expression" && long.input.keywordSpan && slice(source, long.input.keywordSpan)).toBe("expression");
    expect(circle?.input.kind === "parametric" && circle.input.components.map((component) => component.raw)).toEqual(["{cos(x)}", "{sin(x)}"]);
    expect(surface?.input.kind === "parametric" && surface.input.components.map((component) => component.raw)).toEqual(["{x}", "{y}", "{x*y}"]);
    expect(bare?.input.kind === "parametric" && bare.input.components.map((component) => slice(source, component.span))).toEqual(["x", "x^2"]);
    expect(errors(source)).toEqual([]);
  });

  it("reads coordinates with exact per-point spans, errors, meta, comments and empty lines", () => {
    const body = String.raw`\addplot+[error bars/.cd, y dir=both, y explicit] coordinates {
    (0,0)   +- (0.1,0.2) % the first ) point
    (1, {sin(0.5)}) [2]

    % after a jump
    (2,\h*8) += (0,1) -= (0,0.5) [a b]
    (Jan, 3)(3e-2,-1.2345e3)
  };`;
    const source = inAxis(body);
    const input = coordinatesOf(onlyPlot(source));
    expect(errors(source)).toEqual([]);
    expect(input.points.map((point) => slice(source, point.span))).toEqual([
      "(0,0)   +- (0.1,0.2)",
      "(1, {sin(0.5)}) [2]",
      "(2,\\h*8) += (0,1) -= (0,0.5) [a b]",
      "(Jan, 3)",
      "(3e-2,-1.2345e3)"
    ]);
    expect(input.points.map((point) => point.components.map((component) => component.raw))).toEqual([
      ["0", "0"], ["1", "{sin(0.5)}"], ["2", "\\h*8"], ["Jan", "3"], ["3e-2", "-1.2345e3"]
    ]);
    for (const point of input.points) {
      for (const component of point.components) {
        expect(slice(source, component.span)).toBe(component.raw);
      }
      expect(slice(source, point.coordinateSpan).startsWith("(")).toBe(true);
    }
    expect(input.points.map((point) => point.afterEmptyLine)).toEqual([false, false, true, false, false]);
    const [first, second, third] = input.points;
    expect(first?.errors.map((error) => [error.kind, slice(source, error.coordinateSpan), error.components.map((part) => part.raw)])).toEqual([["+-", "(0.1,0.2)", ["0.1", "0.2"]]]);
    expect(second?.meta?.raw).toBe("2");
    expect(second?.meta && slice(source, second.meta.bracketSpan)).toBe("[2]");
    expect(third?.errors.map((error) => error.kind)).toEqual(["+=", "-="]);
    expect(third?.meta?.raw).toBe("a b");
    expect(input.unparsed).toEqual([]);
    expect(slice(source, input.keywordSpan)).toBe("coordinates");
  });

  it("reads 3D coordinates and keeps text it cannot read", () => {
    const source = inAxis("\\addplot3 coordinates {(0,0,1) junk (1,1,2)};");
    const input = coordinatesOf(onlyPlot(source));
    expect(input.points.map((point) => point.components.length)).toEqual([3, 3]);
    expect(input.unparsed.map((part) => part.raw)).toEqual(["junk"]);
  });

  it("reads inline tables raw, file names and loaded tables", () => {
    const source = inAxis(String.raw`\addplot table [x=a,y=b] {
 a b
 1 2
};
\addplot table {data/file name.dat};
\addplot table [x index=0] \loadedtable;
\addplot table [y=L2] {\loadedtable};
\addplot table from \loadedtable;
\addplot table [row sep=\\] {a b\\ 1 2\\};`);
    const [inline, file, macro, bracedMacro, fromMacro, rowSep] = plots(axisAt(source));
    expect(inline?.input.kind === "table" && inline.input.source).toMatchObject({ kind: "inline", raw: "\n a b\n 1 2\n", terminated: true });
    expect(inline?.input.kind === "table" && inline.input.optionsSpan && slice(source, inline.input.optionsSpan)).toBe("[x=a,y=b]");
    expect(file?.input.kind === "table" && file.input.source).toMatchObject({ kind: "file", name: "data/file name.dat" });
    expect(macro?.input.kind === "table" && macro.input.source).toMatchObject({ kind: "macro", name: "\\loadedtable" });
    expect(bracedMacro?.input.kind === "table" && bracedMacro.input.source).toMatchObject({ kind: "macro", name: "\\loadedtable" });
    expect(fromMacro?.input.kind === "table" && fromMacro.input.fromSpan && slice(source, fromMacro.input.fromSpan)).toBe("from");
    expect(fromMacro?.input.kind === "table" && fromMacro.input.source.kind).toBe("macro");
    expect(rowSep?.input.kind === "table" && rowSep.input.source).toMatchObject({ kind: "inline", raw: "a b\\\\ 1 2\\\\" });
    expect(errors(source)).toEqual([]);
  });

  it("keeps inline table data that the TikZ tokens would misread as one span", () => {
    const data = "\n  x   y  % a comment with } inside\n  0 (  1\n  1   [\n";
    const source = inAxis(`\\addplot table {${data}};\n\\draw (0,0) -- (1,1);`);
    const axis = axisAt(source);
    const [plot] = plots(axis);
    expect(plot?.input.kind === "table" && plot.input.source).toMatchObject({ kind: "inline", raw: data });
    expect(axisBodyStatements(axis).map((statement) => statement.kind)).toEqual(["Path"]);
    expect(errors(source)).toEqual([]);
  });

  it("records gnuplot, function, shell, file, graphics and fill between inputs as other inputs", () => {
    const source = inAxis(String.raw`\addplot gnuplot [id=sq] {x**2};
\addplot function {sin(x)};
\addplot shell [prefix=a] {echo 1 2};
\addplot file {data.dat};
\addplot graphics [xmin=0] {picture.png};
\addplot fill between [of=a and b];`);
    expect(plots(axisAt(source)).map((plot) => plot.input.kind === "other"
      ? [plot.input.name, plot.input.argumentRaw ?? null, plot.input.optionsSpan ? slice(source, plot.input.optionsSpan) : null]
      : plot.input.kind)).toEqual([
      ["gnuplot", "x**2", "[id=sq]"],
      ["function", "sin(x)", null],
      ["shell", "echo 1 2", "[prefix=a]"],
      ["file", "data.dat", null],
      ["graphics", "picture.png", "[xmin=0]"],
      ["fill between", null, "[of=a and b]"]
    ]);
    expect(errors(source)).toEqual([]);
  });

  it("reads trailing path operations as a path of their own", () => {
    const source = inAxis(String.raw`\addplot+[mark=none] coordinates {(0,0) (1,1)} node[pos=0.5, above] {mid} -- (axis cs:1,0) \closedcycle;
\addplot {x} |- (0,0) -- cycle;`);
    const [first, second] = plots(axisAt(source));
    expect(first?.trailingPath?.kind).toBe("Path");
    expect(first?.trailingPath && slice(source, first.trailingPath.span)).toBe("node[pos=0.5, above] {mid} -- (axis cs:1,0) \\closedcycle");
    expect(first?.trailingPath?.items.map((item) => item.kind)).toEqual(["Node", "PathKeyword", "Coordinate", "UnknownPathItem"]);
    const coordinate = first?.trailingPath?.items.find((item) => item.kind === "Coordinate");
    expect(coordinate?.kind === "Coordinate" && coordinate.raw).toBe("(axis cs:1,0)");
    expect(second?.trailingPath?.items.map((item) => item.kind)).toContain("Coordinate");
    // Trailing paths take statement indices of their own, so item ids never collide.
    const ids = [first?.trailingPath?.id, second?.trailingPath?.id];
    expect(new Set(ids).size).toBe(2);
    expect(errors(source)).toEqual([]);
  });

  it("closes a plot whose semicolon is missing at the next axis command or the axis end, and diagnoses it", () => {
    const source = inAxis(String.raw`\addplot {x^2}
\addplot {x};
\addlegendentry{a}
\addplot coordinates {(0,0)}
\end{axis}
\draw (0,0) -- (1,1);
\begin{axis}
\addplot {x}`);
    const parsed = parseTikz(source);
    const axis = axisAt(source);
    expect(plots(axis).map((plot) => [plot.terminated, plot.input.kind])).toEqual([[false, "expression"], [true, "expression"], [false, "coordinates"]]);
    expect(plots(axis).every((plot) => plot.trailingPath === undefined)).toBe(true);
    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["Axis", "Path", "Axis"]);
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.code === "missing-semicolon")).toHaveLength(3);
  });

  it("ends an unknown command at the next axis command, as TeX reads a macro call", () => {
    const source = inAxis(String.raw`\pgfplotsinvokeforeach{1,2}{\addplot {#1*x};}
\addplot {x};
\mymacro{a}
\addlegendentry{b}`);
    const axis = axisAt(source);
    expect(axis.body.map((item) => item.kind)).toEqual(["UnknownStatement", "AddPlot", "UnknownStatement", "AddLegendEntry"]);
    expect(parseTikz(source).diagnostics.filter((diagnostic) => diagnostic.code === "missing-semicolon")).toEqual([]);
    expect(errors(source)).toEqual([]);
  });

  it("closes a TikZ path whose semicolon is missing before \\end{axis}", () => {
    const source = picture("\\begin{axis}\n\\draw (0,0) -- (1,1)\n\\end{axis}\n\\draw (2,2) -- (3,3);");
    const body = parseTikz(source).figure.body;
    expect(body.map((statement) => statement.kind)).toEqual(["Axis", "Path"]);
    expect(axisBodyStatements(axisAt(source)).map((statement) => statement.kind)).toEqual(["Path"]);
  });
});

describe("pgfplots legends and settings", () => {
  const inAxis = (body: string): string => picture(`\\begin{axis}\n${body}\n\\end{axis}`);

  it("reads \\addlegendentry right after a plot, with options, expanded, and without a semicolon", () => {
    const source = inAxis(String.raw`\addplot {x}; \addlegendentry{$x$}
\addplot {x^2};\addlegendentry[red]{square}
\addlegendentryexpanded{$x^\p$};`);
    const entries = axisAt(source).body.filter((item): item is AddLegendEntryStatement => item.kind === "AddLegendEntry");
    expect(entries.map((entry) => [entry.id, entry.text, entry.expanded])).toEqual([
      ["axis:0:legend-entry:0", "$x$", false],
      ["axis:0:legend-entry:1", "square", false],
      ["axis:0:legend-entry:2", "$x^\\p$", true]
    ]);
    expect(entries[1]?.optionsSpan && slice(source, entries[1].optionsSpan)).toBe("[red]");
    for (const entry of entries) expect(slice(source, entry.textSpan)).toBe(entry.text);
    expect(axisAt(source).body.map((item) => item.kind)).toEqual(["AddPlot", "AddLegendEntry", "AddPlot", "AddLegendEntry", "AddLegendEntry"]);
    expect(errors(source)).toEqual([]);
  });

  it("reads \\legend lists, comma- or \\\\-delimited, with and without a semicolon", () => {
    const source = inAxis(String.raw`\addplot {x};
\legend{a,{b, c},$d=2$}
\legend{$a=1, b=2$\\$a=2$\\};`);
    const legends = axisAt(source).body.filter((item): item is LegendStatement => item.kind === "Legend");
    expect(legends.map((legend) => [legend.delimiter, legend.entries.map((entry) => entry.raw)])).toEqual([
      [",", ["a", "{b, c}", "$d=2$"]],
      ["\\\\", ["$a=1, b=2$", "$a=2$"]]
    ]);
    expect(errors(source)).toEqual([]);
  });

  it("reads \\addlegendimage, \\pgfplotsextra and \\pgfplotsset in an axis", () => {
    const source = inAxis(String.raw`\addlegendimage{red, mark=*}
\pgfplotsextra{\pgfpathmoveto{\pgfpointorigin}}
\pgfplotsset{cycle list name=exotic}
\addplot {x};`);
    const body: AxisBodyItem[] = axisAt(source).body;
    expect(body.map((item) => [item.kind, item.id])).toEqual([
      ["AddLegendImage", "axis:0:legend-image:0"],
      ["PgfplotsExtra", "axis:0:extra:0"],
      ["PgfplotsSet", "pgfplots-set:1"],
      ["AddPlot", "axis:0:plot:0"]
    ]);
    const image = body[0];
    expect(image?.kind === "AddLegendImage" && image.options.entries.map((entry) => entry.raw)).toEqual(["red", "mark=*"]);
    expect(body[1]?.kind === "PgfplotsExtra" && body[1].bodyRaw).toBe("\\pgfpathmoveto{\\pgfpointorigin}");
    expect(errors(source)).toEqual([]);
  });

  it("reads \\pgfplotsset in a picture and in the preamble, with compat and libraries", () => {
    const source = String.raw`\documentclass{article}
\usepackage{pgfplots}
\pgfplotsset{compat=1.17, width=6cm}
\usepgfplotslibrary{fillbetween, groupplots}
\begin{document}
\begin{tikzpicture}
  \pgfplotsset{every axis/.append style={thick}}
  \begin{axis} \addplot {x}; \end{axis}
\end{tikzpicture}
\end{document}`;
    const parsed = parseTikz(source, { includeContextDefinitions: true });
    const kinds = parsed.figure.body.map((statement) => statement.kind);
    expect(kinds).toEqual(["PgfplotsSet", "PgfplotsLibrary", "PgfplotsSet", "Axis"]);
    const [preambleSet, library] = parsed.figure.body;
    expect(preambleSet?.kind === "PgfplotsSet" && preambleSet.compat?.raw).toBe("1.17");
    expect(preambleSet?.kind === "PgfplotsSet" && preambleSet.compat && slice(source, preambleSet.compat.span)).toBe("1.17");
    expect(library?.kind === "PgfplotsLibrary" && library.libraries).toEqual(["fillbetween", "groupplots"]);
  });
});

describe("pgfplots: evaluation entry", () => {
  it("draws the axis, its plot and embedded TikZ, and the statements around it", () => {
    const source = picture(String.raw`\draw (0,0) -- (1,0);
\begin{axis}[xmin=0]
  \addplot coordinates {(0,0) (1,1)};
  \draw (axis cs:0,0) -- (axis cs:1,1);
  \node at (axis cs:0.5,0.5) {inside};
\end{axis}
\draw (0,1) -- (1,1);`);
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const ids = new Set(semantic.scene.elements.map((element) => element.sourceRef.sourceId));
    expect([...ids]).toEqual(expect.arrayContaining(["path:0", "axis:1", "axis:1:plot:0", "path:2", "path:3", "path:4"]));
    expect(semantic.diagnostics.filter((diagnostic) => diagnostic.code === "unsupported-pgfplots-axis")).toEqual([]);
    expect(semantic.diagnostics.filter((diagnostic) => diagnostic.code === "unsupported-statement" || diagnostic.code === "unsupported-environment")).toEqual([]);
    expect(semantic.featureUsage.pgfplots_axis).toBe("used-supported");
    expect(semantic.featureUsage.pgfplots_addplot_coordinates).toBe("used-supported");
  });

  it("expands loops and macros around and inside an axis without choking; log axes are evaluated too", () => {
    const source = picture(String.raw`\def\n{3}
\foreach \i in {1,2} {
  \begin{axis}[name=a\i] \addplot {\i*x}; \draw (0,0) -- (\i,0); \end{axis}
}
\begin{axis}
  \foreach \j in {1,2} { \draw (0,\j) -- (1,\j); }
  \addplot coordinates {(0,\n)};
\end{axis}
\begin{loglogaxis}\addplot coordinates {(1,1) (10,10)};\end{loglogaxis}
\draw (0,0) -- (\n,0);`);
    const semantic = evaluateTikzFigure(parseTikz(source).figure, source);
    expect(semantic.diagnostics.filter((diagnostic) => diagnostic.code === "unsupported-pgfplots-axis")).toHaveLength(0);
    expect(getAxisEvaluations(semantic.scene).some((axis) => axis.model.x.mode === "log" && axis.model.y.mode === "log")).toBe(true);
    expect(semantic.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const ids = semantic.scene.elements.map((element) => element.sourceRef.sourceId);
    // Elements of the loop's axes are attributed to the loop; the macro in the third axis' coordinates is expanded.
    expect(ids.filter((id) => id.startsWith("foreach:")).length).toBeGreaterThan(10);
    expect(ids.some((id) => /^axis:\d+:plot:0$/u.test(id))).toBe(true);
  });
});

describe("pgfplots: traversal, lookup and source-preserving edits", () => {
  const AXIS = String.raw`\begin{axis}[xmin=0]
    \addplot coordinates {(0,0) (1,1)};
    \draw (axis cs:0,0) -- (axis cs:1,1);
    \draw (5,5) -- (6,6); % \end{axis} in a comment
  \end{axis}`;
  const SOURCE = picture(`  \\draw (0,0) -- (1,0);\n  ${AXIS}\n  \\draw (0,1) -- (1,1);\n  \\draw (0,2) -- (1,2);`);

  function succeed(result: ReturnType<typeof applyEditAction>): string {
    if (result.kind !== "success") throw new Error(`Expected success, got ${JSON.stringify(result)}`);
    return result.newSource;
  }

  it("numbers statements inside and after the axis, and finds them by id", () => {
    const parsed = parseTikz(SOURCE);
    expect(parsed.figure.body.map((statement) => statement.id)).toEqual(["path:0", "axis:1", "path:4", "path:5"]);
    expect(axisBodyStatements(axisAt(SOURCE)).map((statement) => statement.id)).toEqual(["path:2", "path:3"]);
    const visited: string[] = [];
    walkStatements(parsed.figure.body, { onStatement: (statement) => visited.push(statement.id) });
    expect(visited).toEqual(["path:0", "axis:1", "path:2", "path:3", "path:4", "path:5"]);
    expect(findPathStatementById(parsed.figure.body, "path:3")?.id).toBe("path:3");
    const snapshot = parseStatementSnapshot(SOURCE);
    expect(snapshot.byId.get("path:3")).toMatchObject({ depth: 1, index: 1, parentKey: "root/1" });
  });

  it("deletes a statement after the axis without touching it", () => {
    const next = succeed(applyEditAction(SOURCE, [], { kind: "deleteElement", elementId: "path:4" }));
    expect(next).toContain(AXIS);
    expect(next).not.toContain("(0,1) -- (1,1)");
  });

  it("deletes a statement inside the axis and keeps the rest of it", () => {
    const next = succeed(applyEditAction(SOURCE, [], { kind: "deleteElement", elementId: "path:2" }));
    expect(next).not.toContain("\\draw (axis cs:0,0)");
    expect(next).toContain("\\addplot coordinates {(0,0) (1,1)};");
    expect(next).toContain("\\draw (5,5) -- (6,6); % \\end{axis} in a comment");
    expect(axisBodyStatements(axisAt(next)).map((statement) => statement.kind)).toEqual(["Path"]);
    expect(plots(axisAt(next))).toHaveLength(1);
  });

  it("deletes the whole axis", () => {
    const next = succeed(applyEditAction(SOURCE, [], { kind: "deleteElement", elementId: "axis:1" }));
    expect(next).not.toContain("axis");
    expect(parseTikz(next).figure.body.map((statement) => statement.kind)).toEqual(["Path", "Path", "Path"]);
  });

  it("reorders statements past and inside the axis without corrupting it", () => {
    let successes = 0;
    for (const direction of ["sendToBack", "sendBackward", "bringForward", "bringToFront"] as const) {
      for (const elementId of ["path:0", "path:4", "path:5", "path:2", "path:3"]) {
        const result = applyEditAction(SOURCE, [], { kind: "reorderElements", elementIds: [elementId], direction });
        if (result.kind !== "success") continue;
        successes += 1;
        const parsed = parseTikz(result.newSource);
        expect(errors(result.newSource)).toEqual([]);
        const axis = axisAt(result.newSource);
        expect(plots(axis)).toHaveLength(1);
        expect(axisBodyStatements(axis)).toHaveLength(2);
        expect(parsed.figure.body.filter((statement) => statement.kind === "Path")).toHaveLength(3);
        expect(result.newSource).toContain("\\addplot coordinates {(0,0) (1,1)};");
      }
    }
    expect(successes).toBeGreaterThanOrEqual(8);
  });
});

describe("pgfplots: incremental parsing matches a full parse", () => {
  const BASE = picture(String.raw`  \draw (0,0) -- (1,0);
  \begin{axis}[xmin=0, title={A}]
    \addplot+[red] coordinates {(0,0) (1,1) +- (0.1,0.1) [2]};
    \addlegendentry{data}
    \addplot table [x=a,y=b] {
      a b
      0 1
    };
    \draw (axis cs:0,0) -- (axis cs:1,1);
    \node at (2,2) {N};
  \end{axis}
  \draw (0,1) -- (1,1);`);

  const edits: Array<{ name: string; next: string; strategy?: "incremental" | "full" }> = [
    { name: "one coordinate of a plot", next: BASE.replace("(1,1) +-", "(1,2) +-"), strategy: "incremental" },
    { name: "an axis option value", next: BASE.replace("xmin=0", "xmin=-1"), strategy: "incremental" },
    { name: "a plot's options", next: BASE.replace("[red]", "[blue, thick]"), strategy: "incremental" },
    { name: "a legend entry", next: BASE.replace("{data}", "{Data set}"), strategy: "incremental" },
    { name: "a table row", next: BASE.replace("0 1\n", "0 3\n"), strategy: "incremental" },
    { name: "a TikZ statement inside the axis", next: BASE.replace("(axis cs:1,1)", "(axis cs:2,1)"), strategy: "incremental" },
    { name: "a node inside the axis", next: BASE.replace("{N}", "{M}"), strategy: "incremental" },
    { name: "a statement before the axis", next: BASE.replace("(1,0);", "(2,0);"), strategy: "incremental" },
    { name: "a statement after the axis", next: BASE.replace("(1,1);\n\\end", "(3,1);\n\\end"), strategy: "incremental" },
    { name: "a point added", next: BASE.replace("(0,0) (1,1)", "(0,0) (0.5,0.5) (1,1)") },
    { name: "a plot added", next: BASE.replace("\\addlegendentry{data}", "\\addlegendentry{data}\n    \\addplot {x};") },
    { name: "a trailing path added", next: BASE.replace("[2]};", "[2]} \\closedcycle;") },
    { name: "the axis environment renamed", next: BASE.replace("{axis}[", "{loglogaxis}[").replace("\\end{axis}", "\\end{loglogaxis}") },
    { name: "the axis end deleted", next: BASE.replace("  \\end{axis}\n", "") },
    { name: "a semicolon deleted", next: BASE.replace("[2]};", "[2]}") },
    { name: "a nested end typed into the body", next: BASE.replace("\\addlegendentry", "\\end{axis} \\addlegendentry") }
  ];

  for (const edit of edits) {
    it(`after editing ${edit.name}`, () => {
      expect(edit.next).not.toBe(BASE);
      const session = createIncrementalParseSession();
      session.prime(parseTikz(BASE), { sourceRevision: 1 });
      const result = session.evaluate({ source: edit.next, sourceRevision: 2, inferChanges: true });
      const full = parseTikz(edit.next);
      expect(result.parse.figure).toEqual(full.figure);
      expect(result.parse.diagnostics).toEqual(full.diagnostics);
      if (edit.strategy) expect(result.stats.strategy).toBe(edit.strategy);
    });
  }
});

describe("pgfplots readers", () => {
  it("reads coordinate lists at any offset", () => {
    const text = "xx{ (1,2) +- (0.5, 0.5)\n\n(3,4) }";
    const reading = readCoordinateList(text, 3, text.length - 1);
    expect(reading.points.map((point) => slice(text, point.span))).toEqual(["(1,2) +- (0.5, 0.5)", "(3,4)"]);
    expect(reading.points.map((point) => point.afterEmptyLine)).toEqual([false, true]);
  });

  it("does not take a comment line for an empty line", () => {
    const text = "(1,2)\n% note\n(3,4)\n%\n\n(5,6)";
    expect(readCoordinateList(text, 0, text.length).points.map((point) => point.afterEmptyLine)).toEqual([false, false, true]);
  });

  it("splits an inline table into a header, rows and cells with spans", () => {
    const text = "{\n  a   b\tc\n  % comment\n  # another\n  1 2 3\n\n  4 {5 6} 7 % trailing\n}";
    const reading = readInlineTable(text, 1, text.length - 1);
    expect(reading.header?.cells.map((cell) => cell.raw)).toEqual(["a", "b", "c"]);
    expect(reading.rows.map((row) => row.cells.map((cell) => cell.raw))).toEqual([["1", "2", "3"], ["4", "{5 6}", "7"]]);
    expect(reading.rows.map((row) => row.afterEmptyLine)).toEqual([false, true]);
    expect(reading.comments.map((span) => slice(text, span))).toEqual(["% comment", "# another"]);
    for (const row of [reading.header, ...reading.rows]) {
      for (const cell of row?.cells ?? []) expect(slice(text, cell.span)).toBe(cell.raw);
    }
  });

  it("reads a table without a header, with \\\\ row separators and other column separators", () => {
    const numeric = "1 2\n3 4";
    expect(readInlineTable(numeric, 0, numeric.length).header).toBeUndefined();
    expect(readInlineTable(numeric, 0, numeric.length, { header: true }).header?.cells.map((cell) => cell.raw)).toEqual(["1", "2"]);
    const rows = "x,y\\\\ 1,2\\\\ 3,4\\\\";
    const reading = readInlineTable(rows, 0, rows.length, { rowSeparator: "\\\\", columnSeparator: "comma" });
    expect(reading.header?.cells.map((cell) => cell.raw)).toEqual(["x", "y"]);
    expect(reading.rows.map((row) => row.cells.map((cell) => cell.raw))).toEqual([["1", "2"], ["3", "4"]]);
    const nan = "a b\nnan 1e-3";
    expect(readInlineTable(nan, 0, nan.length).rows.map((row) => row.cells.map((cell) => cell.raw))).toEqual([["nan", "1e-3"]]);
  });
});

describe("pgfplots: export requirements", () => {
  it("requires pgfplots on the scene only when an axis is used", () => {
    const withAxis = picture("\\begin{axis} \\addplot {x}; \\end{axis}");
    expect(renderTikzToSvg(withAxis).semantic.scene.requiredPackages).toEqual(["pgfplots"]);
    expect(renderTikzToSvg(picture("\\draw (0,0) -- (1,1);")).semantic.scene.requiredPackages).toEqual([]);
  });

  it("writes the package, a default compat level and nothing pgfplots-specific without an axis", () => {
    const artifact = createStandaloneLatexExportArtifact({
      source: picture("\\begin{axis}[xmin=0] \\addplot coordinates {(0,0) (1,1)}; \\end{axis}"),
      activeFigureId: "figure:0"
    });
    const preamble = artifact.text.slice(0, artifact.text.indexOf("\\begin{document}"));
    expect(preamble).toContain("\\usepackage{tikz}\n\\usepackage{pgfplots}\n\\pgfplotsset{compat=1.18}\n");
    expect(artifact.text).toContain("\\begin{axis}[xmin=0]");
    const plain = createStandaloneLatexExportArtifact({ source: picture("\\draw (0,0) -- (1,1);"), activeFigureId: "figure:0" });
    expect(plain.text).not.toContain("pgfplots");
  });

  it("carries the document's package options, libraries and preamble settings, with its own compat", () => {
    const source = String.raw`\documentclass{article}
\usepackage{tikz}
% \usepackage{pgfplots} is commented out here
\usepackage[override]{pgfplots}
\pgfplotsset{compat=1.17, every axis/.append style={thick}}
\usepgfplotslibrary{fillbetween}
\pgfplotsset{width=6cm}
\begin{document}
\begin{tikzpicture}
  \begin{axis} \addplot {x}; \end{axis}
\end{tikzpicture}
\end{document}`;
    const artifact = createStandaloneLatexExportArtifact({ source, activeFigureId: "figure:0" });
    const preamble = artifact.text.slice(0, artifact.text.indexOf("\\begin{document}"));
    expect(preamble).toContain([
      "\\usepackage[override]{pgfplots}",
      "\\usepgfplotslibrary{fillbetween}",
      "\\pgfplotsset{compat=1.17, every axis/.append style={thick}}",
      "\\pgfplotsset{width=6cm}"
    ].join("\n"));
    expect(preamble).not.toContain("compat=1.18");
    const minimal = createMinimalTikzSourceArtifact({ source, activeFigureId: "figure:0" });
    expect(minimal.text).toContain("\\usepgfplotslibrary{fillbetween}\n\\pgfplotsset{compat=1.17");
    expect(minimal.text).not.toContain("\\usepackage");
  });
});
