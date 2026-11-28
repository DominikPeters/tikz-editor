/**
 * `\addplot` inside `\begin{scope}…\end{scope}` in an axis body (behaviour
 * AC5): grammar and AST (flat body between scope markers, plot ids in body
 * order), incremental parsing, evaluation (scope options as plot options,
 * transformations, clip) and the plot edits that cross a scope.
 */
import { describe, expect, it } from "vitest";

import type { AddPlotStatement, AxisScopeBegin, AxisStatement, Statement } from "../packages/core/src/ast/types.js";
import { axisBodyStatements, walkStatements } from "../packages/core/src/ast/walk.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { applyReorderPlotsAction } from "../packages/core/src/edit/pgfplots/axis-actions.js";
import { createIncrementalParseSession, parseTikz } from "../packages/core/src/parser/index.js";
import { getAxisEvaluations } from "../packages/core/src/pgfplots/evaluate-axis.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import type { ScenePath } from "../packages/core/src/semantic/types.js";

const picture = (body: string): string => `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;
const axisPicture = (body: string, options = "xmin=0,xmax=4,ymin=0,ymax=10"): string => `\\pgfplotsset{compat=1.18}\n${picture(`\\begin{axis}[${options}]\n${body}\n\\end{axis}`)}`;

function axisOf(source: string): AxisStatement {
  const axis = parseTikz(source, { includeContextDefinitions: true }).figure.body.find((statement): statement is AxisStatement & Statement => statement.kind === "Axis");
  if (!axis) throw new Error("no axis");
  return axis;
}
const plotsOf = (axis: AxisStatement): AddPlotStatement[] => axis.body.filter((item): item is AddPlotStatement => item.kind === "AddPlot");

function render(source: string) {
  const parsed = parseTikz(source, { includeContextDefinitions: true });
  const semantic = evaluateTikzFigure(parsed.figure, source);
  const [evaluation] = getAxisEvaluations(semantic.scene);
  if (!evaluation) throw new Error("no axis evaluation");
  const map = evaluation.layout.map;
  const t = evaluation.frameTransform;
  // World point back to data units.
  const toData = (p: { x: number; y: number }) => {
    const det = t.a * t.d - t.b * t.c;
    const lx = (t.d * (p.x - t.e) - t.c * (p.y - t.f)) / det;
    const ly = (-t.b * (p.x - t.e) + t.a * (p.y - t.f)) / det;
    return { x: Math.round(((lx - map.origin.x) / map.xUnit.x) * 1000) / 1000, y: Math.round(((ly - map.origin.y) / map.yUnit.y) * 1000) / 1000 };
  };
  const paths = semantic.scene.elements.filter((element): element is ScenePath => element.kind === "Path");
  const line = (plotId: string) => paths.find((path) => path.sourceRef.sourceId === plotId && path.id.endsWith(":line"));
  const linePoints = (plotId: string) => (line(plotId)?.commands ?? []).flatMap((c) => (c.kind === "Z" || c.kind === "A" ? [] : [toData(c.to)]));
  return { parsed, semantic, evaluation, paths, line, linePoints, toData };
}

describe("pgfplots axis scopes: grammar and AST", () => {
  const SOURCE = axisPicture(String.raw`\addplot coordinates {(0,1) (1,1)};
\begin{scope}[red, dashed]
  \addplot coordinates {(0,2) (1,2)};
  \addlegendentry{b}
  \begin{scope}[thick]
    \draw (axis cs:0,0) -- (axis cs:1,1);
    \addplot coordinates {(0,3) (1,3)};
  \end{scope}
\end{scope}
\addplot coordinates {(0,4) (1,4)};`);

  it("reads axis commands inside nested scopes, in body order, without diagnostics", () => {
    const parsed = parseTikz(SOURCE, { includeContextDefinitions: true });
    expect(parsed.diagnostics.filter((d) => d.severity === "error" || d.severity === "warning")).toEqual([]);
    const axis = axisOf(SOURCE);
    expect(axis.body.map((item) => item.kind)).toEqual([
      "AddPlot", "AxisScopeBegin", "AddPlot", "AddLegendEntry", "AxisScopeBegin", "Path", "AddPlot", "AxisScopeEnd", "AxisScopeEnd", "AddPlot"
    ]);
    expect(plotsOf(axis).map((plot) => plot.id)).toEqual(["axis:1:plot:0", "axis:1:plot:1", "axis:1:plot:2", "axis:1:plot:3"]);
    const scopes = axis.body.filter((item): item is AxisScopeBegin => item.kind === "AxisScopeBegin");
    expect(scopes.map((scope) => [scope.id, scope.endId, scope.options?.raw])).toEqual([
      ["axis:1:scope:0", "axis:1:scope:0:end", "[red, dashed]"],
      ["axis:1:scope:1", "axis:1:scope:1:end", "[thick]"]
    ]);
    expect(SOURCE.slice(scopes[0]?.span.from, scopes[0]?.span.to)).toBe("\\begin{scope}[red, dashed]");
    expect(SOURCE.slice(scopes[1]?.scopeSpan.from, scopes[1]?.scopeSpan.to).endsWith("\\end{scope}")).toBe(true);
  });

  it("walks the TikZ statements inside an axis scope as statements of the axis", () => {
    const axis = axisOf(SOURCE);
    expect(axisBodyStatements(axis).map((statement) => statement.kind)).toEqual(["Path"]);
    const kinds: string[] = [];
    walkStatements([axis as Statement], { onStatement: (statement) => { kinds.push(statement.kind); } });
    expect(kinds).toEqual(["Axis", "Path"]);
  });

  it("keeps \\addplot in a plain picture scope an unknown statement (not an axis command)", () => {
    const source = picture(String.raw`\begin{scope}[red]
  \addplot coordinates {(0,0) (1,1)};
\end{scope}`);
    const parsed = parseTikz(source);
    const scope = parsed.figure.body[0];
    expect(scope?.kind).toBe("Scope");
    const semantic = evaluateTikzFigure(parsed.figure, source);
    expect(semantic.diagnostics.map((d) => d.code)).toContain("pgfplots-command-outside-axis");
  });

  it("reads a scope inside a \\foreach body and a font environment in the axis", () => {
    const source = axisPicture(String.raw`\foreach \k in {1,2} {
  \begin{scope}[dashed]
    \addplot coordinates {(0,\k) (2,\k+1)};
  \end{scope}
}
\begin{small}\begin{scope}[red]\addplot coordinates {(0,5) (1,5)};\end{scope}\end{small}`);
    const parsed = parseTikz(source, { includeContextDefinitions: true });
    expect(parsed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const { semantic } = render(source);
    expect(semantic.diagnostics.filter((d) => d.code === "unsupported-statement" || d.code === "unsupported-environment")).toEqual([]);
    // The loop's plots are dashed (the scope inside the loop), the last one red and solid.
    const lines = semantic.scene.elements.filter((element): element is ScenePath => element.kind === "Path" && element.id.endsWith(":line"));
    expect(lines).toHaveLength(3);
    expect(lines.slice(0, 2).every((path) => (path.style.dashArray?.length ?? 0) > 0)).toBe(true);
    expect(lines[2]?.style.dashArray ?? null).toBeNull();
    expect(lines[2]?.style.stroke).toBe("#ff0000");
  });
});

describe("pgfplots axis scopes: incremental parsing matches a full parse", () => {
  const BASE = axisPicture(String.raw`\addplot coordinates {(0,1) (1,1)};
\begin{scope}[red]
  \addplot+[thick] coordinates {(0,2) (1,2)};
  \addlegendentry{b}
  \draw (axis cs:0,0) -- (axis cs:1,1);
  \begin{scope}[xshift=1cm]
    \addplot coordinates {(0,3) (1,3)};
  \end{scope}
\end{scope}`);
  const edits: Array<{ name: string; next: string }> = [
    { name: "a coordinate of a plot in a scope", next: BASE.replace("(1,2)", "(1,2.5)") },
    { name: "a plot's options in a scope", next: BASE.replace("+[thick]", "+[thin]") },
    { name: "the scope options", next: BASE.replace("[red]", "[blue,dashed]") },
    { name: "the nested scope options", next: BASE.replace("[xshift=1cm]", "[yshift=2mm]") },
    { name: "a TikZ statement in a scope", next: BASE.replace("(axis cs:1,1)", "(axis cs:2,1)") },
    { name: "a legend entry in a scope", next: BASE.replace("{b}", "{bee}") },
    { name: "a plot added in the nested scope", next: BASE.replace("(1,3)};", "(1,3)};\n    \\addplot {x};") },
    { name: "the nested scope removed", next: BASE.replace("  \\begin{scope}[xshift=1cm]\n", "").replace("  \\end{scope}\n\\end{scope}", "\\end{scope}") },
    { name: "a scope end deleted", next: BASE.replace("  \\end{scope}\n", "") },
    { name: "a scope wrapped around the first plot", next: BASE.replace("\\addplot coordinates {(0,1) (1,1)};", "\\begin{scope}\\addplot coordinates {(0,1) (1,1)};\\end{scope}") }
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
    });
  }
});

describe("pgfplots axis scopes: evaluation (behaviour AC5)", () => {
  it("draws plots in a scope with the scope options appended to theirs; the cycle list keeps counting", () => {
    const source = axisPicture(String.raw`\addplot coordinates {(0,1) (2,1)};
\begin{scope}[red,dashed]
  \addplot+[blue] coordinates {(0,2) (2,2)};
\end{scope}
\addplot coordinates {(0,3) (2,3)};`);
    const { semantic, line } = render(source);
    expect(semantic.diagnostics.filter((d) => d.severity === "error" || d.severity === "warning")).toEqual([]);
    const inScope = line("axis:1:plot:1");
    expect(inScope?.style.dashArray?.length).toBeGreaterThan(0);
    expect(inScope?.style.stroke).not.toBe(line("axis:1:plot:0")?.style.stroke);
    // Cycle entry 2 (brown!60!black) for the plot after the scope.
    expect(line("axis:1:plot:2")?.style.dashArray ?? null).toBeNull();
    expect(line("axis:1:plot:2")?.style.stroke).not.toBe(line("axis:1:plot:0")?.style.stroke);
  });

  it("moves a plot line by twice a scope's transformation and its marks once; the limits ignore it", () => {
    const source = axisPicture(String.raw`\begin{scope}[yscale=2]
  \addplot[mark=*] coordinates {(0,1) (2,3)};
\end{scope}`);
    const { linePoints, paths, toData } = render(source);
    expect(linePoints("axis:1:plot:0")).toEqual([{ x: 0, y: 4 }, { x: 2, y: 12 }]);
    const marks = paths.filter((path) => path.sourceRef.sourceId === "axis:1:plot:0" && /:mark:\d+:0$/u.test(path.id));
    // A circle mark's centre: the middle of its points' extent.
    const centres = marks.map((mark) => {
      const points = mark.commands.flatMap((c) => (c.kind === "M" || c.kind === "L" || c.kind === "C" ? [c.to] : []));
      const xs = points.map((q) => q.x); const ys = points.map((q) => q.y);
      return toData({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
    });
    expect(centres).toEqual([{ x: 0, y: 2 }, { x: 2, y: 6 }]);
    const auto = render(axisPicture(String.raw`\begin{scope}[xshift=1cm]\addplot coordinates {(0,1) (2,3)};\end{scope}`, ""));
    expect(auto.evaluation.layout.limits.xmin).toBeCloseTo(-0.2, 6);
    expect(auto.evaluation.layout.limits.xmax).toBeCloseTo(2.2, 6);
  });

  it("clips the plot lines after a \\clip in the scope, not the marks or what follows the scope", () => {
    const source = axisPicture(String.raw`\begin{scope}
  \clip (axis cs:0,0) rectangle (axis cs:1,10);
  \addplot[mark=*] coordinates {(0,1) (2,3)};
\end{scope}
\addplot coordinates {(0,2) (2,5)};`);
    const { line, paths } = render(source);
    expect(line("axis:1:plot:0")?.clipChain).toHaveLength(2);
    expect(line("axis:1:plot:1")?.clipChain).toHaveLength(1);
    const mark = paths.find((path) => path.sourceRef.sourceId === "axis:1:plot:0" && path.id.includes(":mark:"));
    expect(mark?.clipChain ?? []).toHaveLength(0);
  });

  it("keeps settings made in a scope local, as a group", () => {
    const source = axisPicture(String.raw`\begin{scope}
  \pgfplotsset{domain=2:3}
  \addplot[samples=2] {x};
\end{scope}
\addplot[samples=2] {x};`, "xmin=0,xmax=4,ymin=0,ymax=10,domain=0:1");
    const { linePoints } = render(source);
    expect(linePoints("axis:1:plot:0")).toEqual([{ x: 2, y: 2 }, { x: 3, y: 3 }]);
    expect(linePoints("axis:1:plot:1")).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });

  it("pairs a legend entry in a scope with its plot, and draws the legend image with the scope options", () => {
    const source = axisPicture(String.raw`\begin{scope}[dashed]
  \addplot coordinates {(0,1) (2,1)};
  \addlegendentry{u}
\end{scope}
\addplot coordinates {(0,2) (2,2)};
\addlegendentry{v}`);
    const { evaluation, paths } = render(source);
    expect(evaluation.legend.entries.map((entry) => entry.text)).toEqual(["u", "v"]);
    const images = paths.filter((path) => path.sourceRef.sourceId === "axis:1:legend" && path.style.stroke && path.commands.length === 3);
    expect(images.map((path) => (path.style.dashArray?.length ?? 0) > 0)).toEqual([true, false]);
  });

  it("warns about a scope on the background layer", () => {
    const source = `\\usetikzlibrary{backgrounds}\n${axisPicture(String.raw`\begin{scope}[on background layer]\addplot coordinates {(0,1) (2,1)};\end{scope}`)}`;
    const { semantic } = render(source);
    expect(semantic.diagnostics.map((d) => d.code)).toContain("unsupported-pgfplots-scope-background-layer");
  });
});

describe("pgfplots axis scopes: edits", () => {
  const SOURCE = axisPicture(String.raw`\addplot coordinates {(0,1) (2,1)};
\addlegendentry{a}
\begin{scope}[red]
  \addplot coordinates {(0,2) (2,2)};
  \addlegendentry{b}
  \addplot coordinates {(0,3) (2,3)};
  \addlegendentry{c}
\end{scope}`);

  it("deletes a plot in a scope with its legend entry, keeping the scope", () => {
    const result = applyEditAction(SOURCE, [], { kind: "deleteElements", elementIds: ["axis:1:plot:1"] });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\begin{scope}[red]");
    expect(result.newSource).not.toContain("{b}");
    expect(result.newSource).not.toContain("(0,2) (2,2)");
    expect(result.newSource).toContain("\\addlegendentry{c}");
  });

  it("reorders plots inside one scope, legend entries following", () => {
    const result = applyReorderPlotsAction(SOURCE, ["axis:1:plot:2"], "sendBackward");
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const next = result.newSource;
    expect(next.indexOf("(0,3) (2,3)")).toBeLessThan(next.indexOf("(0,2) (2,2)"));
    expect(next.indexOf("{c}")).toBeLessThan(next.indexOf("{b}"));
    expect(next.indexOf("\\begin{scope}[red]")).toBeLessThan(next.indexOf("(0,3) (2,3)"));
  });

  it("refuses to move a plot across a scope boundary", () => {
    const result = applyReorderPlotsAction(SOURCE, ["axis:1:plot:1"], "sendBackward");
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") expect(result.reason).toMatch(/scope/u);
  });
});
