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
import { boxSize } from "../packages/core/src/pgfplots/layout.js";
import { resolveAxisModel } from "../packages/core/src/pgfplots/model.js";
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
    const m = model("xmin=-1, xmax=pi, ybar, ybar, legend pos=north west, width=8cm, scale only axis");
    expect(m.x.min).toBe(-1);
    expect(m.x.max).toBeCloseTo(Math.PI, 6);
    expect(m.width).toBeCloseTo(8 * 72.27 / 2.54, 6);
    expect(m.unsupported.map((u) => u.key)).toEqual(["ybar", "ybar", "legend pos"]);
    const result = evaluate(String.raw`\begin{tikzpicture}\begin{axis}[ybar, ybar, legend pos=north west]\addplot coordinates {(0,0) (1,1)};\end{axis}\end{tikzpicture}`);
    expect(result.diagnostics.filter((d) => d.code === "unsupported-pgfplots-key:ybar")).toHaveLength(1);
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
\addplot ({cos(x)},{sin(x)});
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

  it("move on the axis is refused cleanly (moving axes is not implemented)", () => {
    const source = PREAMBLE + String.raw`\begin{tikzpicture}\begin{axis}\addplot coordinates {(0,0) (1,1)};\end{axis}\end{tikzpicture}`;
    expect(() => applyEditAction(source, [], { kind: "moveElement", elementId: "axis:0", delta: { x: 1, y: 0 } } as never)).not.toThrow();
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
});
