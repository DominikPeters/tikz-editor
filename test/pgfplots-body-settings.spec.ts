// Settings inside the axis body (design/pgfplots-behaviour.md section AB):
// keys read at an `\addplot` capture the state there, drawing keys and axis
// keys use the state at `\end{axis}`, brace groups keep their settings. The
// expected values are the TeX digests of experiment E24
// (scripts/pgfplots-oracle/experiments/e24-cases.ts), in data units.
import { describe, expect, it } from "vitest";

import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { getAxisEvaluations } from "../packages/core/src/pgfplots/evaluate-axis.js";
import { setPgfplotsEvaluationCachesEnabled } from "../packages/core/src/pgfplots/eval-cache.js";
import { applyMatrix, inverseMatrix } from "../packages/core/src/semantic/transform.js";
import type { ScenePath } from "../packages/core/src/semantic/types.js";

const PREAMBLE = "\\pgfplotsset{compat=1.18}\n";
const F = "xmin=0,xmax=4,ymin=0,ymax=10";

function render(options: string, body: string) {
  const source = `${PREAMBLE}\\begin{tikzpicture}\\begin{axis}[${options}]\n${body}\n\\end{axis}\\end{tikzpicture}`;
  const parsed = parseTikz(source, { includeContextDefinitions: true });
  const result = evaluateTikzFigure(parsed.figure, source);
  const scene = result.scene;
  const axis = getAxisEvaluations(scene)[0];
  if (!axis) throw new Error("no axis");
  const inverse = inverseMatrix(axis.frameTransform) ?? axis.frameTransform;
  const toData = (w: { x: number; y: number }) => {
    const q = applyMatrix(inverse, w as never);
    const m = axis.layout.map;
    return [Math.round(((q.x - m.origin.x) / m.xUnit.x) * 1000) / 1000, Math.round(((q.y - m.origin.y) / m.yUnit.y) * 1000) / 1000];
  };
  const paths = scene.elements.filter((e): e is ScenePath => e.kind === "Path");
  /** The line of plot n as data points. */
  const line = (n: number) => {
    const path = paths.find((p) => p.id === `scene-path:axis:1:plot:${String(n)}:line`) ?? paths.find((p) => p.id.endsWith(`:plot:${String(n)}:line`));
    if (!path) return null;
    return path.commands.flatMap((c) => (c.kind === "Z" ? [] : [toData(c.to)]));
  };
  const style = (n: number) => paths.find((p) => p.id.endsWith(`:plot:${String(n)}:line`))?.style;
  const marks = (n: number) => paths.filter((p) => p.id.includes(`:plot:${String(n)}:mark:`)).length;
  return { scene, axis, line, style, marks, diagnostics: result.diagnostics };
}

describe("pgfplots: settings inside the axis body (AB)", () => {
  it("AB1: a domain set between plots reaches only the later plot (E24 p-domain)", () => {
    const r = render(`${F},domain=0:1,samples=3`, "\\addplot[blue] {x};\n\\pgfplotsset{domain=2:3}\n\\addplot[red] {x^2};");
    expect(r.line(0)).toEqual([[0, 0], [0.5, 0.5], [1, 1]]);
    expect(r.line(1)).toEqual([[2, 4], [2.5, 6.25], [3, 9]]);
  });

  it("AB1: samples, \\pgfkeys, forget plot, cycle list and each nth point are read at the \\addplot", () => {
    expect(render(`${F},domain=0:1,samples=3`, "\\addplot[blue] {x};\n\\pgfplotsset{samples=5}\n\\addplot[red] {x+1};").line(1)).toHaveLength(5);
    expect(render(`${F},domain=0:1,samples=3`, "\\addplot[blue] {x};\n\\pgfkeys{/pgfplots/domain=2:3}\n\\addplot[red] {x};").line(1)).toEqual([[2, 2], [2.5, 2.5], [3, 3]]);
    // `\tikzset{domain=…}` is TikZ's domain, not pgfplots' (p-tikzset-domain).
    expect(render(`${F},domain=0:1,samples=3`, "\\addplot[blue] {x};\n\\tikzset{domain=2:3}\n\\addplot[red] {x};").line(1)).toEqual([[0, 0], [0.5, 0.5], [1, 1]]);
    const forget = render(`${F},domain=0:1,samples=2`, "\\addplot {x};\n\\pgfplotsset{forget plot}\n\\addplot {x+1};\n\\addplot {x+2};");
    expect([forget.style(0)?.stroke, forget.style(1)?.stroke, forget.style(2)?.stroke]).toEqual(["#0000ff", "#ff0000", "#ff0000"]);
    const cycle = render(`${F},domain=0:1,samples=2`, "\\addplot {x};\n\\pgfplotsset{cycle list={{green,mark=none},{orange,mark=none}}}\n\\addplot {x+1};\n\\addplot {x+2};");
    expect([cycle.style(0)?.stroke, cycle.style(1)?.stroke, cycle.style(2)?.stroke]).toEqual(["#0000ff", "#ff8000", "#00ff00"]);
    expect(render(`${F},domain=0:1,samples=5`, "\\addplot[blue] {x};\n\\pgfplotsset{each nth point=2}\n\\addplot[red] {x+1};").line(1)).toHaveLength(3);
  });

  it("AB1/V0: macros in data keys and expressions are read at the \\addplot, macros in style keys at \\end{axis}", () => {
    const r = render("xmin=0,xmax=4,ymin=0,ymax=10,samples=3", "\\def\\lo{0}\\def\\c{orange}\n\\addplot[\\c,domain=\\lo:2] {x};\n\\def\\lo{2}\\def\\c{teal}\n\\addplot[\\c,domain=\\lo:4] {x};");
    expect(r.line(0)).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(r.line(1)).toEqual([[2, 2], [3, 3], [4, 4]]);
    expect([r.style(0)?.stroke, r.style(1)?.stroke]).toEqual(["#008080", "#008080"]);
  });

  it("AB2: drawing styles set after a plot still reach it (every axis plot, mark size, smooth, only marks)", () => {
    const every = render(`${F},domain=0:1,samples=2`, "\\addplot {x};\n\\pgfplotsset{every axis plot/.append style={line width=2pt}}\n\\addplot {x+1};");
    expect([every.style(0)?.lineWidth, every.style(1)?.lineWidth]).toEqual([2, 2]);
    const smooth = render(`${F},domain=0:1,samples=3`, "\\addplot[blue] {x^2};\n\\pgfplotsset{smooth}\n\\addplot[red] {x^2+1};");
    expect(smooth.scene.elements.some((e) => e.kind === "Path" && e.id.endsWith(":plot:0:line") && e.commands.some((c) => c.kind === "C"))).toBe(true);
    const only = render(`${F},domain=0:1,samples=2`, "\\addplot[blue,mark=*] {x};\n\\pgfplotsset{only marks}\n\\addplot[red,mark=*] {x+1};");
    expect(only.line(0)).toBeNull();
  });

  it("AB2: a body-level mark is drawn only for plots read after it, and not when it was set in a group", () => {
    const top = render(`${F},domain=0:2,samples=3`, "\\addplot[blue] {x};\n\\tikzset{mark=triangle*}\n\\addplot[red] {x+1};");
    expect([top.marks(0), top.marks(1)]).toEqual([0, 3]);
    const group = render(`${F},domain=0:2,samples=2`, "{\\tikzset{mark=x}\n\\addplot[blue] {x};}\n\\addplot[red] {x+1};");
    expect([group.marks(0), group.marks(1)]).toEqual([0, 0]);
  });

  it("AB3: TikZ keys set by \\pgfplotsset in the body reach no path; colour and font reach the text", () => {
    const r = render(`${F},domain=0:1,samples=2,title=T`, "\\addplot[blue] {x};\n\\pgfplotsset{green,line width=2pt}\n\\addplot[red] {x+1};");
    expect([r.style(0)?.stroke, r.style(1)?.stroke, r.style(1)?.lineWidth]).toEqual(["#0000ff", "#ff0000", 0.4]);
    expect(r.diagnostics.map((d) => d.code)).toContain("pgfplots-body-tikz-key:line width");
    const title = r.scene.elements.find((e) => e.kind === "Text" && e.sourceRef.sourceId.endsWith(":title"));
    expect(title?.style.textColor).toBe("#00ff00");
  });

  it("AB4: settings and macro definitions inside a brace group stay in it", () => {
    const domain = render(`${F},domain=0:1,samples=3`, "{\\pgfplotsset{domain=2:3}\n\\addplot[blue] {x};}\n\\addplot[red] {x};");
    expect(domain.line(0)).toEqual([[2, 2], [2.5, 2.5], [3, 3]]);
    expect(domain.line(1)).toEqual([[0, 0], [0.5, 0.5], [1, 1]]);
    const def = render(`${F},domain=0:1,samples=2`, "\\def\\k{1}\n{\\def\\k{3}\n\\addplot[blue] {x+\\k};}\n\\addplot[red] {x+\\k};");
    expect(def.line(0)).toEqual([[0, 3], [1, 4]]);
    expect(def.line(1)).toEqual([[0, 1], [1, 2]]);
    const title = render("domain=0:1,samples=2", "\\addplot {x};\n{\\pgfplotsset{title=T}}");
    expect(title.axis.model.title).toBeUndefined();
  });

  it("AB5: axis keys set in the body hold for the axis; limits there are a TeX error", () => {
    const r = render("domain=0:1,samples=2", "\\addplot {x};\n\\pgfplotsset{title=T,xlabel=X,grid=major,legend pos=north west}");
    expect(r.axis.model.title?.text).toBe("T");
    expect(r.axis.model.x.label?.text).toBe("X");
    const limits = render("domain=0:1,samples=2", "\\addplot {x};\n\\pgfplotsset{xmin=-2}");
    expect(limits.diagnostics.find((d) => d.code === "pgfplots-limit-in-axis-body")?.severity).toBe("error");
    expect(limits.axis.layout.limits.xmin).toBeCloseTo(-0.1, 6);
  });

  it("the plot-data cache keys on the state captured at the \\addplot: warm equals cold after a setting changes", () => {
    const body = (d: string) => `\\addplot[blue] {x};\n\\pgfplotsset{domain=${d}}\n\\addplot[red] {x^2};`;
    setPgfplotsEvaluationCachesEnabled(true);
    render(`${F},domain=0:1,samples=3`, body("2:3"));
    const warm = render(`${F},domain=0:1,samples=3`, body("1:2"));
    setPgfplotsEvaluationCachesEnabled(false);
    const cold = render(`${F},domain=0:1,samples=3`, body("1:2"));
    setPgfplotsEvaluationCachesEnabled(true);
    expect(warm.line(1)).toEqual([[1, 1], [1.5, 2.25], [2, 4]]);
    expect(warm.line(1)).toEqual(cold.line(1));
    expect(warm.line(0)).toEqual(cold.line(0));
  });
});
