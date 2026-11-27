// Unit tests of the pgfplots axis pipeline stages (packages/core/src/pgfplots)
// and of its integration with the evaluator. The oracle comparison lives in
// test/pgfplots-oracle-compare.spec.ts; these hold the rules of
// design/pgfplots-behaviour.md that the stages implement.
import { describe, expect, it } from "vitest";

import { parseOptionListRaw } from "../packages/core/src/options/parse.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { getAxisEvaluations } from "../packages/core/src/pgfplots/evaluate-axis.js";
import { expandPgfplotsOptions, createInitialStyleRegistry } from "../packages/core/src/pgfplots/keys.js";
import { computeLimits } from "../packages/core/src/pgfplots/limits.js";
import { layoutMatrix, legendGrid, legendPairs } from "../packages/core/src/pgfplots/legend.js";
import { boxSize } from "../packages/core/src/pgfplots/layout.js";
import { resolveAxisModel, resolvePlotModel } from "../packages/core/src/pgfplots/model.js";
import { plotHandlerCommands } from "../packages/core/src/pgfplots/plot-handlers.js";
import { automaticTickStep, computeTicks } from "../packages/core/src/pgfplots/ticks.js";
import type { AxisStatement } from "../packages/core/src/ast/types.js";

const PREAMBLE = "\\pgfplotsset{compat=1.18}\n";

function evaluate(body: string) {
  const source = PREAMBLE + body;
  const parsed = parseTikz(source, { includeContextDefinitions: true });
  const result = evaluateTikzFigure(parsed.figure, source);
  const ids = parsed.figure.body.filter((s) => s.kind !== "PgfplotsSet").map((s) => s.id);
  return Object.assign(result, { ids });
}

function axisOf(body: string): AxisStatement {
  const parsed = parseTikz(body);
  const axis = parsed.figure.body.find((s): s is AxisStatement => s.kind === "Axis");
  if (!axis) throw new Error("no axis");
  return axis;
}

function model(options: string) {
  return resolveAxisModel({ axis: axisOf(`\\begin{tikzpicture}\\begin{axis}[${options}]\\end{axis}\\end{tikzpicture}`), settings: [], bodySettings: [] });
}

describe("pgfplots key tree", () => {
  it("expands user styles with arguments and applies short style keys to element styles", () => {
    const registry = createInitialStyleRegistry();
    const seen: string[] = [];
    expandPgfplotsOptions([parseOptionListRaw("[my/.style={xmin=#1, grid}, my=3, xlabel style={red}, /pgfplots/ymax=2]")], registry, (use) => seen.push(`${use.key}=${use.value ?? ""}`));
    expect(seen).toEqual(["xmin=3", "grid=", "ymax=2"]);
    expect(registry.get("every axis x label")?.map((l) => l.raw)).toEqual(["[red]"]);
  });

  it("warns once per unsupported key name and reads documented keys", () => {
    const m = model("xmin=-1, xmax=pi, colorbar, colorbar, legend to name=x, width=8cm, scale only axis");
    expect(m.x.min).toBe(-1);
    expect(m.x.max).toBeCloseTo(Math.PI, 6);
    expect(m.width).toBeCloseTo(8 * 72.27 / 2.54, 6);
    expect(m.unsupported.map((u) => u.key)).toEqual(["colorbar", "colorbar"]);
    const result = evaluate(String.raw`\begin{tikzpicture}\begin{axis}[colorbar, colorbar, legend pos=north west]\addplot coordinates {(0,0) (1,1)};\end{axis}\end{tikzpicture}`);
    expect(result.diagnostics.filter((d) => d.code === "unsupported-pgfplots-key:colorbar")).toHaveLength(1);
  });
});

describe("pgfplots stages", () => {
  it("A2-A4: box size from width/height, scale only axis, unit vectors and scale", () => {
    const limits = { xmin: 0, xmax: 4, ymin: 0, ymax: 2 };
    expect(boxSize(model(""), limits)).toEqual({ width: 195, height: 162 });
    expect(boxSize(model("width=7cm"), limits).height).toBeCloseTo(7 * 72.27 / 2.54 * 207 / 240 - 45, 9);
    expect(boxSize(model("scale only axis, width=150pt, height=100pt, scale=0.5"), limits)).toEqual({ width: 75, height: 50 });
    expect(boxSize(model("x=5pt"), limits)).toEqual({ width: 20, height: 162 });
  });

  it("H1-H3: enlargement, degenerate ranges, empty axes", () => {
    const pts = [{ x: 0, y: 1, jump: false }, { x: 4, y: 5, jump: false }];
    const auto = computeLimits(model(""), [pts], { x: 195, y: 162 });
    expect(auto.kind === "ok" && auto.limits).toEqual({ xmin: -0.4, xmax: 4.4, ymin: 0.6, ymax: 5.4 });
    const fixed = computeLimits(model("xmin=0.5"), [[{ x: 1, y: 1, jump: false }, { x: 3, y: 2, jump: false }]], { x: 195, y: 162 });
    expect(fixed.kind === "ok" && fixed.limits.xmax).toBeCloseTo(3.25, 12);
    const single = computeLimits(model("enlargelimits=false"), [[{ x: 2, y: 3, jump: false }]], { x: 195, y: 162 });
    expect(single.kind === "ok" && single.limits).toEqual({ xmin: 1.6, xmax: 2.4, ymin: 2.4, ymax: 3.6 });
    const empty = computeLimits(model(""), [], { x: 195, y: 162 });
    expect(empty.kind === "ok" && empty.limits.xmin).toBeCloseTo(-0.1, 12);
    expect(computeLimits(model("xmin=3, xmax=1"), [], { x: 195, y: 162 }).kind).toBe("inverted");
  });

  it("I1/I1b: tick step thresholds and the few-ticks fallback", () => {
    const dir = { maxSpaceBetweenTicks: 35, tryMinTicks: 4 };
    expect(automaticTickStep(-0.4, 4.4, 195, dir)).toBe(1);
    expect(automaticTickStep(0, 0.0749, 195, dir)).toBeCloseTo(0.01, 12);
    expect(automaticTickStep(0, 0.0751, 195, dir)).toBeCloseTo(0.02, 12);
    expect(automaticTickStep(0.3, 0.9, 20, { maxSpaceBetweenTicks: 35, tryMinTicks: 2 })).toBeCloseTo(0.5, 12);
  });

  it("I4, J1, J2: tick lists, \\ticknum, scaled ticks and labels", () => {
    const dir = model("").x;
    const auto = computeTicks({ dir, lo: -0.4, hi: 4.4, length: 195, data: [] });
    if (auto.kind !== "ok") throw new Error("ticks");
    expect(auto.ticks.major.map((t) => [t.value, t.index, t.label])).toEqual([[0, 1, "$0$"], [1, 2, "$1$"], [2, 3, "$2$"], [3, 4, "$3$"], [4, 5, "$4$"]]);
    const list = computeTicks({ dir: model("xtick={0.2,0.9,...,4.5}").x, lo: 0, hi: 5, length: 195, data: [] });
    expect(list.kind === "ok" && list.ticks.major.map((t) => t.value)).toEqual([0.2, 0.9, 1.6, 2.3, 3, 3.7, 4.4]);
    const scaled = computeTicks({ dir, lo: 10000, hi: 30000, length: 195, data: [] });
    expect(scaled.kind === "ok" && scaled.ticks.scaleExponent).toBe(4);
    expect(scaled.kind === "ok" && scaled.ticks.major[0]?.label).toBe("$1$");
    const big = computeTicks({ dir, lo: 1000, hi: 2000, length: 195, data: [] });
    expect(big.kind === "ok" && big.ticks.major.map((t) => t.label)[0]).toBe("$1{,}000$");
  });
});

describe("pgfplots axis evaluation", () => {
  it("draws an axis as one object with stable ids, warns about missing compat, never throws on bad input", () => {
    const result = evaluate(String.raw`\begin{tikzpicture}
\begin{axis}[name=ax, xlabel={$x$}]
\addplot coordinates {(0,0) (1,2)};
\addplot table {
a b
0 1
1 0
};
\end{axis}
\draw (ax.south east) -- (ax.outer north east);
\end{tikzpicture}`);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const ids = result.scene.elements.map((e) => e.sourceRef.sourceId);
    const [axisId = "", pathId = ""] = result.ids;
    expect(axisId).toMatch(/^axis:\d+$/u);
    expect(ids).toEqual(expect.arrayContaining([axisId, `${axisId}:plot:0`, `${axisId}:plot:1`, pathId]));
    expect(new Set(result.scene.elements.map((e) => e.id)).size).toBe(result.scene.elements.length);
    const after = result.scene.elements.find((e) => e.sourceRef.sourceId === pathId);
    const axis = getAxisEvaluations(result.scene)[0];
    expect(after?.kind === "Path" && after.commands[0]?.kind === "M" && after.commands[0].to.x).toBeCloseTo(axis?.layout.box.x1 ?? NaN, 6);
    const noCompat = evaluateTikzFigure(parseTikz(String.raw`\begin{tikzpicture}\begin{axis}\end{axis}\end{tikzpicture}`).figure, String.raw`\begin{tikzpicture}\begin{axis}\end{axis}\end{tikzpicture}`);
    expect(noCompat.diagnostics.map((d) => d.code)).toContain("pgfplots-compat");
    for (const bad of ["xtick distance=1e-9", "xmin=5, xmax=1", "xtick={a,b}", "width=\\textwidth", "xmin=1e300, xmax=1e301"]) {
      expect(() => evaluate(String.raw`\begin{tikzpicture}\begin{axis}[${bad}]\addplot coordinates {(0,0) (1,1)};\end{axis}\end{tikzpicture}`)).not.toThrow();
    }
  });

  it("omits unsupported plots and says so, never drawing them", () => {
    const result = evaluate(String.raw`\begin{tikzpicture}\begin{axis}
\addplot coordinates {(a,1) (b,2)};
\addplot table {data.dat};
\addplot ({cos(x)},{sin(x)},{x});
\end{axis}\end{tikzpicture}`);
    expect(result.diagnostics.filter((d) => d.code === "unsupported-pgfplots-plot")).toHaveLength(2);
    // Without a document folder the table file cannot be read; the diagnostic names it.
    expect(result.diagnostics.filter((d) => d.code === "pgfplots-table-file-unavailable").map((d) => d.message)).toEqual([expect.stringContaining("`data.dat`")]);
    expect(result.scene.elements.some((e) => e.sourceRef.sourceId.includes(":plot:"))).toBe(false);
  });

  it("registers axis coordinate systems while the axis is open; an unknown cs is diagnosed, not read as canvas", () => {
    const result = evaluate(String.raw`\begin{tikzpicture}\begin{axis}[xmin=0, xmax=2, ymin=0, ymax=2]
\draw (axis cs:1,1) -- (rel axis cs:1,1) -- (2,0);
\end{axis}
\draw (axis cs:1,1) -- (foo cs:x=1,y=2);
\end{tikzpicture}`);
    const axis = getAxisEvaluations(result.scene)[0];
    const inside = result.scene.elements.find((e) => e.kind === "Path" && !e.sourceRef.sourceId.startsWith("axis:"));
    if (inside?.kind !== "Path" || !axis) throw new Error("expected the embedded path");
    const pts = inside.commands.flatMap((c) => (c.kind === "M" || c.kind === "L" ? [[c.to.x, c.to.y]] : []));
    const { x0, y0, x1, y1 } = axis.layout.box;
    expect(pts[0]?.[0]).toBeCloseTo((x0 + x1) / 2, 6);
    expect(pts[1]).toEqual([x1, y1]);
    expect(pts[2]?.[0]).toBeCloseTo(x1, 6);
    expect(pts[2]?.[1]).toBeCloseTo(y0, 6);
    const codes = result.diagnostics.map((d) => d.code ?? "");
    expect(codes.some((c) => c.includes("unsupported-coordinate-system:axis"))).toBe(true);
    expect(codes.some((c) => c.includes("unsupported-coordinate-system:foo"))).toBe(true);
  });

  it("edit handles of bare coordinates in an axis write data units (the data map is the frame transform)", () => {
    const source = String.raw`\begin{tikzpicture}
\begin{axis}[xmin=0, xmax=2, ymin=0, ymax=2]
\draw (1,1) -- (2,0);
\end{axis}
\end{tikzpicture}`;
    const result = evaluateTikzFigure(parseTikz(source, { includeContextDefinitions: true }).figure, source);
    const handle = result.editHandles.find((h) => h.sourceRef.sourceId === "path:1");
    if (!handle) throw new Error("no handle");
    expect(handle.world.x).toBeCloseTo(97.5, 6);
    const moved = applyEditAction(source, result.editHandles, { kind: "moveHandle", handleId: handle.id, newWorld: { x: handle.world.x + 48.75, y: handle.world.y }, bypassSnapping: true } as never);
    expect(moved.kind === "success" && moved.newSource).toContain("\\draw (1.5,1) -- (2,0);");
  });

  it("Q1/Q5: bare coordinates and axis cs on a log axis map their logarithm; dragging writes data values", () => {
    const source = String.raw`\begin{tikzpicture}
\begin{loglogaxis}[xmin=1, xmax=1000, ymin=1, ymax=100]
\draw (10,10) -- (axis cs:100,1);
\end{loglogaxis}
\end{tikzpicture}`;
    const result = evaluateTikzFigure(parseTikz(source, { includeContextDefinitions: true }).figure, source);
    const axis = getAxisEvaluations(result.scene)[0];
    if (!axis) throw new Error("no axis");
    const { x0, y0, x1, y1 } = axis.layout.box;
    const path = result.scene.elements.find((e) => e.kind === "Path" && e.sourceRef.sourceId === "path:1");
    if (path?.kind !== "Path") throw new Error("no path");
    const pts = path.commands.flatMap((c) => (c.kind === "M" || c.kind === "L" ? [[c.to.x, c.to.y]] : []));
    // 10 is one third of [1, 1000] in log space, half of [1, 100].
    expect(pts[0]?.[0]).toBeCloseTo(x0 + (x1 - x0) / 3, 6);
    expect(pts[0]?.[1]).toBeCloseTo(y0 + (y1 - y0) / 2, 6);
    expect(pts[1]?.[0]).toBeCloseTo(x0 + (2 * (x1 - x0)) / 3, 6);
    expect(pts[1]?.[1]).toBeCloseTo(y0, 6);
    const handle = result.editHandles.find((h) => h.sourceRef.sourceId === "path:1");
    if (!handle) throw new Error("no handle");
    // One third of the box further right is one decade: 10 → 100; a sixth of the height up: 10 → 10^1.5.
    const moved = applyEditAction(source, result.editHandles, { kind: "moveHandle", handleId: handle.id, newWorld: { x: handle.world.x + (x1 - x0) / 3, y: handle.world.y + (y1 - y0) / 4 }, bypassSnapping: true } as never);
    expect(moved.kind === "success" && moved.newSource).toContain("\\draw (100,31.6");
    const bad = evaluate(String.raw`\begin{tikzpicture}\begin{semilogyaxis}\addplot coordinates {(0,1) (1,10)};\draw (1,-2) -- (1,5);\end{semilogyaxis}\end{tikzpicture}`);
    expect(bad.diagnostics.some((d) => (d.code ?? "").includes("invalid-log-axis-coordinate"))).toBe(true);
  });

  it("move on the axis is refused cleanly (moving axes is not implemented)", () => {
    const source = PREAMBLE + String.raw`\begin{tikzpicture}\begin{axis}\addplot coordinates {(0,0) (1,1)};\end{axis}\end{tikzpicture}`;
    expect(() => applyEditAction(source, [], { kind: "moveElement", elementId: "axis:0", delta: { x: 1, y: 0 } } as never)).not.toThrow();
  });
});

describe("pgfplots function plots (behaviour M)", () => {
  const plotPoints = (body: string) => {
    const result = evaluate(String.raw`\begin{tikzpicture}${body}\end{tikzpicture}`);
    const axis = getAxisEvaluations(result.scene)[0];
    const paths = result.scene.elements.filter((e) => e.kind === "Path" && e.sourceRef.sourceId.includes(":plot:") && e.id.endsWith("line"));
    const toData = (p: { x: number; y: number }) => axis ? { x: (p.x - axis.layout.map.origin.x) / axis.layout.map.xUnit.x, y: (p.y - axis.layout.map.origin.y) / axis.layout.map.yUnit.y } : p;
    return { result, axis, paths: paths.map((path) => (path.kind === "Path" ? path.commands.flatMap((c) => (c.kind === "M" || c.kind === "L" ? [{ kind: c.kind, ...toData(c.to) }] : [])) : [])) };
  };

  it("M1/M2: samples equally spaced over the domain, both ends included; float mode, no TeX dimension limit", () => {
    const { result, axis, paths } = plotPoints(String.raw`\begin{axis}\addplot[domain=0:1e5, samples=3] {x^2};\end{axis}`);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(paths[0]?.map((p) => p.x)).toEqual([0, 50000, 100000].map((v) => expect.closeTo(v, 3)));
    expect(axis?.layout.limits.ymax).toBeCloseTo(1.1e10, -3);
  });

  it("M3: variable, samples at, trig format plots, parametric, declare function and macros", () => {
    const { paths } = plotPoints(String.raw`\pgfmathsetmacro{\k}{2}\begin{axis}[declare function={f(\a)=\a+1;}]
\addplot[samples at={0,1,...,3}] {f(x)*\k};
\addplot[variable=t, domain=0:pi, samples=3, trig format plots=rad] ({cos(t)},{sin(t)});
\end{axis}`);
    expect(paths[0]?.map((p) => [p.x, p.y])).toEqual([[0, 2], [1, 4], [2, 6], [3, 8]].map(([x, y]) => [expect.closeTo(x ?? 0, 6), expect.closeTo(y ?? 0, 6)]));
    expect(paths[1]?.map((p) => [p.x, p.y])).toEqual([[1, 0], [0, 1], [-1, 0]].map(([x, y]) => [expect.closeTo(x ?? 0, 6), expect.closeTo(y ?? 0, 6)]));
  });

  it("M4: unbounded samples are discarded (initial) or interrupt the line (jump); restrict y to domain jumps", () => {
    const discard = plotPoints(String.raw`\begin{axis}\addplot[domain=-2:2, samples=5] {1/x};\end{axis}`).paths[0];
    expect(discard?.map((p) => p.kind).join("")).toBe("MLLL");
    const jump = plotPoints(String.raw`\begin{axis}\addplot[domain=-2:2, samples=5, unbounded coords=jump] {1/x};\end{axis}`).paths[0];
    expect(jump?.map((p) => p.kind).join("")).toBe("MLML");
    const restricted = plotPoints(String.raw`\begin{axis}\addplot[domain=-2:2, samples=5, restrict y to domain=0:1.5] {x};\end{axis}`).paths[0];
    expect(restricted?.map((p) => [p.kind, p.x])).toEqual([["M", expect.closeTo(0, 6)], ["L", expect.closeTo(1, 6)]]);
  });
});

describe("TikZ fixes the pgfplots oracle exposed", () => {
  it("densely/loosely dashed follow tikz.code.tex", () => {
    const result = evaluateTikzFigure(parseTikz(String.raw`\begin{tikzpicture}\draw[densely dashed] (0,0)--(1,0);\draw[loosely dashed] (0,1)--(1,1);\end{tikzpicture}`).figure, "");
    expect(result.scene.elements.map((e) => e.style.dashArray)).toEqual([[3, 2], [3, 6]]);
  });

  it("node em lengths use the ambient font, not the node font (\\tikz@textfont acts inside the box)", () => {
    const src = String.raw`\begin{tikzpicture}\node[font=\small] {A};\node at (2,0) {A};\end{tikzpicture}`;
    const result = evaluateTikzFigure(parseTikz(src).figure, src);
    const [small, normal] = result.scene.elements.filter((e) => e.kind === "Text");
    const pad = (e: typeof small) => (e?.kind === "Text" ? (e.nodeVisualHeight ?? 0) - (e.textBlockHeight ?? 0) : NaN);
    expect(pad(small)).toBeCloseTo(pad(normal), 9);
    expect(pad(normal)).toBeCloseTo(2 * 3.333, 2);
  });

  it("text depth alone replaces only the depth of the text box; the glyphs keep their baseline (tikz.code.tex \\dp)", () => {
    const src = String.raw`\begin{tikzpicture}\node[text depth=5pt] (a) {x};\node (b) at (2,0) {x};\end{tikzpicture}`;
    const result = evaluateTikzFigure(parseTikz(src).figure, src);
    const [deep, plain] = result.scene.elements.filter((e) => e.kind === "Text");
    if (deep?.kind !== "Text" || plain?.kind !== "Text") throw new Error("no text");
    // Height above the baseline unchanged, depth 5pt: the box grows by 5pt - natural depth, the glyphs move up by half of it.
    const grow = (deep.nodeVisualHeight ?? 0) - (plain.nodeVisualHeight ?? 0);
    expect(grow).toBeGreaterThan(0);
    expect(deep.position.y - 0).toBeCloseTo(grow / 2, 6);
  });
});

describe("pgfplots plot styling (behaviour P)", () => {
  it("P1: PGF plot handlers; smooth uses PGF's initial tension 0.5 (0.2775 x tension support factor)", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }].map((p) => ({ p, jump: false }));
    const smooth = plotHandlerCommands(pts, "smooth", { tension: 0.5, combBase: (q) => q });
    expect(smooth.map((c) => c.kind).join("")).toBe("MCC");
    const second = smooth[2];
    expect(second?.kind === "C" ? second.c1 : null).toEqual({ x: 10 + 0.13875 * 20, y: 10 });
    expect(plotHandlerCommands(pts, "const-left", { tension: 0.5, combBase: (q) => q }).map((c) => c.to)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 0 }]);
    expect(plotHandlerCommands(pts, "jump-mid", { tension: 0.5, combBase: (q) => q }).map((c) => c.kind).join("")).toBe("MLMLLML");
    expect(plotHandlerCommands([...pts.slice(0, 2), { p: { x: 30, y: 5 }, jump: true }], "sharp", { tension: 0.5, combBase: (q) => q }).map((c) => c.kind).join("")).toBe("MLM");
  });

  it("P2/P4: named cycle lists, cycle list shift, every axis plot no N, axis-level no markers", () => {
    const axis = axisOf(String.raw`\begin{tikzpicture}\begin{axis}[cycle list name=linestyles*, cycle list shift=1, no markers, every axis plot no 0/.style={red}]\addplot coordinates {(0,0) (1,1)};\addplot+[mark=*] coordinates {(0,0) (1,1)};\end{axis}\end{tikzpicture}`);
    const m = resolveAxisModel({ axis, settings: [], bodySettings: [] });
    const plots = axis.body.filter((item) => item.kind === "AddPlot").map((statement, i) => resolvePlotModel(m, statement, i));
    expect(plots[0]?.pathKeys.map((u) => u.key)).toEqual(["red", "dashed"]);
    expect(plots[1]?.pathKeys.map((u) => u.key)).toEqual(["dotted"]);
    expect(plots.map((p) => p.mark)).toEqual([null, null]);
  });
});

describe("pgfplots legends (behaviour L)", () => {
  const entries = (texts: string[]) => texts.map((text) => ({ text, options: "", span: { from: 0, to: 0 } }));
  const legendModel = { columns: 1, plotPos: "left" as const, reverse: false, transpose: false };

  it("L4: pairs entries with images in order, drops empty entries with their image, stops at the shorter list", () => {
    expect(legendPairs(entries(["a", "", "c"]), 3, legendModel).map((p) => [p.entry.text, p.image])).toEqual([["a", 0], ["c", 2]]);
    expect(legendPairs(entries(["a", "b", "c"]), 1, legendModel)).toHaveLength(1);
    expect(legendPairs(entries(["a", "b"]), 3, { ...legendModel, reverse: true }).map((p) => p.entry.text)).toEqual(["b", "a"]);
  });

  it("L4: legend columns fill rows; -1 is one row; transpose legend swaps rows and columns", () => {
    expect(legendGrid([1, 2, 3], { ...legendModel, columns: 2 })).toEqual([[1, 2], [3]]);
    expect(legendGrid([1, 2, 3], { ...legendModel, columns: -1 })).toEqual([[1, 2, 3]]);
    expect(legendGrid([1, 2, 3, 4], { ...legendModel, columns: 2, transpose: true })).toEqual([[1, 3], [2, 4]]);
  });

  it("L3: PGF matrix layout aligns cell origins per column and row; heights and depths start at 0", () => {
    const layout = layoutMatrix([
      [{ minX: -0.2, minY: -0.2, maxX: 17, maxY: 0.2 }, { minX: -4, minY: -3, maxX: 4, maxY: 3 }],
      [{ minX: 6, minY: -2, maxX: 10, maxY: 2 }, { minX: -5, minY: -2, maxX: 5, maxY: 4 }]
    ], [0, 1], 0);
    expect(layout.width).toBeCloseTo(0.2 + 17 + 1 + 5 + 5, 9);
    expect(layout.origins[0]?.[1]?.x).toBeCloseTo(17.2 + 1 + 5, 9);
    expect(layout.depth).toBeCloseTo(2, 9);
    expect(layout.origins[0]?.[0]?.y).toBeCloseTo(4 + 3, 9);
    expect(layout.height).toBeCloseTo(4 + 3 + 3, 9);
  });

  it("draws the legend after the descriptions, with the documented default style, and counts it for the axis box", () => {
    const result = evaluate(String.raw`\begin{tikzpicture}\begin{axis}[title=T, legend pos=outer north east]
\addplot coordinates {(0,0) (1,1)};\addlegendentry{a}
\addplot+[forget plot] coordinates {(0,1) (1,2)};
\addlegendimage{empty legend}\addlegendentry{sep}
\end{axis}\end{tikzpicture}`);
    expect(result.diagnostics.filter((d) => d.code?.includes("legend"))).toEqual([]);
    const axis = getAxisEvaluations(result.scene)[0];
    const legend = axis?.labels.find((l) => l.role === "legend");
    expect(legend?.probe).toBeTruthy();
    const ids = result.scene.elements.map((e) => e.id);
    const title = ids.findIndex((id) => id.includes(":label:title"));
    const legendBox = ids.findIndex((id) => id.includes(":label:legend"));
    expect(title).toBeGreaterThanOrEqual(0);
    expect(legendBox).toBeGreaterThan(title);
    expect(axis?.labels.filter((l) => l.role === "legend-entry").map((l) => l.text)).toEqual(["a", "sep"]);
    expect(axis && legend?.probe ? axis.layout.bbox.maxX : 0).toBeCloseTo(legend?.probe?.anchor("east").x ?? NaN, 1);
  });
});
