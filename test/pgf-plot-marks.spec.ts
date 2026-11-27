import { describe, expect, it } from "vitest";

import oracle from "./fixtures/pgf-plot-marks/marks.oracle.json" with { type: "json" };
import {
  PLOT_MARK_NAMES,
  plotMarkPrimitives,
  plotMarkRequiresLibrary,
  selectPlotMarkIndices,
  type PlotMarkSegment
} from "../packages/core/src/semantic/path/plot-marks.js";
import { resolveColorToCss } from "../packages/core/src/semantic/style/colors.js";
import type { ScenePath, ScenePathCommand } from "../packages/core/src/semantic/types.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { evaluateSemantic } from "./semantic/helpers.js";

// Geometry must match PGF's own output (pdflatex + mutool trace) within this many pt.
const TOLERANCE_PT = 0.01;

type Rgb = number[];
type OracleSegment = { op: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number };
type OracleOperation = { paint: string; segments?: OracleSegment[]; color?: Rgb; lineWidth?: number; dash?: number[] | null };
type OracleCase = { id: string; mark: string; variant: string; source: string; operations: OracleOperation[] };
type ModuleInputs = {
  size: number;
  stroke: Rgb;
  fill: Rgb;
  markColor: Rgb | "none" | null;
  ballColor: Rgb;
  lineWidth: number;
  matrix: number[];
};
type Operation = { paint: string; segments: OracleSegment[]; color: Rgb | null };

const cases = oracle.cases as OracleCase[];
const variants = new Map(oracle.variants.map((variant) => [variant.id, variant.module as ModuleInputs]));
const canvases = new Map(oracle.variants.map((variant) => [variant.id, variant.canvas]));
/** TeX's 1cm in pt: every oracle case plots the single point (1,0). */
const ONE_CM = 28.45274;

const rgbString = (rgb: Rgb): string => `rgb(${rgb.join(",")})`;

function cssToRgb(css: string | null): Rgb | null {
  if (css == null) return null;
  const resolved = resolveColorToCss(css) ?? css;
  const hex = /^#([0-9a-f]{6})$/iu.exec(resolved)?.[1];
  if (hex) return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const rgb = /^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/u.exec(resolved);
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map((value) => Number(value) / 255);
  throw new Error(`Unrecognised colour ${css}`);
}

/** Module colours are the `rgb(r,g,b)` strings passed in (unit components), or a named default such as white. */
function moduleColour(text: string | null): Rgb | null {
  const components = /^rgb\(([^)]*)\)$/u.exec(text ?? "")?.[1];
  return components === undefined ? cssToRgb(text) : components.split(",").map(Number);
}

function transformSegment(segment: PlotMarkSegment, m: number[]): OracleSegment {
  const map = (x: number, y: number): [number, number] => [
    (m[0] ?? 1) * x + (m[2] ?? 0) * y + (m[4] ?? 0),
    (m[1] ?? 0) * x + (m[3] ?? 1) * y + (m[5] ?? 0)
  ];
  if (segment.op === "Z") return { op: "Z" };
  if (segment.op === "C") {
    const [x1, y1] = map(segment.x1, segment.y1);
    const [x2, y2] = map(segment.x2, segment.y2);
    const [x, y] = map(segment.x, segment.y);
    return { op: "C", x1, y1, x2, y2, x, y };
  }
  const [x, y] = map(segment.x, segment.y);
  return { op: segment.op, x, y };
}

function moduleOperations(entry: OracleCase): Operation[] {
  const inputs = variants.get(entry.variant);
  if (!inputs) throw new Error(`Unknown variant ${entry.variant}`);
  const m = inputs.matrix;
  const linearIdentity = m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1;
  const primitives = plotMarkPrimitives(entry.mark, {
    size: inputs.size,
    strokeColor: rgbString(inputs.stroke),
    fillColor: rgbString(inputs.fill),
    markColor: inputs.markColor === "none" ? "none" : inputs.markColor ? rgbString(inputs.markColor) : null,
    ballColor: rgbString(inputs.ballColor),
    linearIdentity
  });
  if (!primitives) throw new Error(`Module does not know ${entry.mark}`);
  const operations: Operation[] = [];
  for (const primitive of primitives) {
    if (primitive.kind === "text") continue;
    const segments = primitive.segments.map((segment) => transformSegment(segment, m));
    if (primitive.kind === "shade") {
      operations.push({ paint: "clip", segments, color: null });
      continue;
    }
    if (primitive.paint !== "stroke") operations.push({ paint: "fill", segments, color: moduleColour(primitive.fill) });
    if (primitive.paint !== "fill") operations.push({ paint: "stroke", segments, color: moduleColour(primitive.stroke) });
  }
  return operations;
}

function sceneSegments(commands: readonly ScenePathCommand[], origin: { x: number; y: number }): OracleSegment[] {
  return commands.map((command): OracleSegment => {
    if (command.kind === "Z") return { op: "Z" };
    if (command.kind === "C") {
      return {
        op: "C",
        x1: command.c1.x - origin.x, y1: command.c1.y - origin.y,
        x2: command.c2.x - origin.x, y2: command.c2.y - origin.y,
        x: command.to.x - origin.x, y: command.to.y - origin.y
      };
    }
    if (command.kind === "M" || command.kind === "L") return { op: command.kind, x: command.to.x - origin.x, y: command.to.y - origin.y };
    throw new Error(`Unexpected ${command.kind} in a mark`);
  });
}

/** Largest coordinate difference between two segment lists (throws on structural mismatch). */
function maxSegmentError(actual: readonly OracleSegment[], expected: readonly OracleSegment[], label: string): number {
  expect(actual.map((segment) => segment.op).join(""), `${label}: segment ops`).toBe(expected.map((segment) => segment.op).join(""));
  let error = 0;
  actual.forEach((segment, index) => {
    const reference = expected[index];
    for (const key of ["x", "y", "x1", "y1", "x2", "y2"] as const) {
      const a = segment[key];
      const b = reference?.[key];
      if (a === undefined && b === undefined) continue;
      error = Math.max(error, Math.abs((a ?? Number.NaN) - (b ?? Number.NaN)));
    }
  });
  return error;
}

function expectColour(actual: Rgb | null, expected: Rgb | undefined, label: string): void {
  expect(actual, label).not.toBeNull();
  expect(expected, label).toBeDefined();
  (actual ?? []).forEach((component, index) => {
    expect(Math.abs(component - (expected?.[index] ?? Number.NaN)), `${label}: colour ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`).toBeLessThan(0.01);
  });
}

describe("PGF plot marks: pure module vs TeX", () => {
  it("covers every mark of the plotmarks library in the oracle", () => {
    const oracleMarks = new Set(cases.map((entry) => entry.mark));
    for (const name of PLOT_MARK_NAMES) {
      if (name === "text") continue;
      expect(oracleMarks.has(name), name).toBe(true);
    }
    expect(oracle.pgfVersion).toBe("3.1.10");
  });

  const errors = new Map<string, number>();
  for (const entry of cases) {
    it(`matches ${entry.id}`, () => {
      const actual = moduleOperations(entry);
      expect(actual.map((operation) => operation.paint), entry.id).toEqual(entry.operations.map((operation) => operation.paint));
      let error = 0;
      actual.forEach((operation, index) => {
        const reference = entry.operations[index];
        if (!reference) throw new Error("missing reference");
        error = Math.max(error, maxSegmentError(operation.segments, reference.segments ?? [], `${entry.id} #${String(index)}`));
        if (operation.paint !== "clip") expectColour(operation.color, reference.color, `${entry.id} #${String(index)}`);
      });
      errors.set(entry.mark, Math.max(errors.get(entry.mark) ?? 0, error));
      expect(error, entry.id).toBeLessThanOrEqual(TOLERANCE_PT);
    });
  }

  it("reports the largest error per mark", () => {
    if (process.env.PLOT_MARK_ERRORS) {
      console.log([...errors].map(([mark, error]) => `${mark}: ${error.toFixed(5)}pt`).join("\n"));
    }
    for (const error of errors.values()) expect(error).toBeLessThanOrEqual(TOLERANCE_PT);
  });
});

describe("PGF plot marks: TikZ plot vs TeX", () => {
  const errors = new Map<string, number>();
  for (const entry of cases) {
    it(`renders ${entry.id}`, () => {
      const result = evaluateSemantic(entry.source);
      const paths = result.scene.elements.filter((element): element is ScenePath => element.kind === "Path");
      const marks = paths.filter((path) => path.id.includes(":mark:"));
      const canvas = canvases.get(entry.variant) ?? [1, 0, 0, 1];
      const origin = { x: (canvas[0] ?? 1) * ONE_CM, y: (canvas[1] ?? 0) * ONE_CM };

      const operations: Array<Operation & { lineWidth: number | null; dashed: boolean }> = [];
      for (const mark of marks) {
        const segments = sceneSegments(mark.commands, origin);
        if (mark.style.shadeEnabled) {
          expect(mark.style.shading).toBe("ball");
          operations.push({ paint: "clip", segments, color: null, lineWidth: null, dashed: false });
          continue;
        }
        if (mark.style.fill != null && mark.style.fill !== "none") {
          operations.push({ paint: "fill", segments, color: cssToRgb(mark.style.fill), lineWidth: null, dashed: false });
        }
        if (mark.style.stroke != null && mark.style.stroke !== "none") {
          operations.push({
            paint: "stroke",
            segments,
            color: cssToRgb(mark.style.stroke),
            lineWidth: mark.style.lineWidth,
            dashed: mark.style.dashArray != null && mark.style.dashArray.length > 0
          });
        }
      }
      expect(operations.map((operation) => operation.paint), entry.id).toEqual(entry.operations.map((operation) => operation.paint));
      let error = 0;
      operations.forEach((operation, index) => {
        const reference = entry.operations[index];
        if (!reference) throw new Error("missing reference");
        const label = `${entry.id} #${String(index)}`;
        error = Math.max(error, maxSegmentError(operation.segments, reference.segments ?? [], label));
        if (operation.paint === "clip") return;
        expectColour(operation.color, reference.color, label);
        if (operation.paint === "stroke") {
          expect(Math.abs((operation.lineWidth ?? 0) - (reference.lineWidth ?? 0)), `${label}: line width`).toBeLessThan(0.01);
          expect(operation.dashed, `${label}: dash`).toBe(reference.dash != null);
        }
      });
      errors.set(entry.mark, Math.max(errors.get(entry.mark) ?? 0, error));
      expect(error, entry.id).toBeLessThanOrEqual(TOLERANCE_PT);
    });
  }

  it("reports the largest end-to-end error per mark", () => {
    if (process.env.PLOT_MARK_ERRORS) {
      console.log([...errors].map(([mark, error]) => `${mark}: ${error.toFixed(5)}pt`).join("\n"));
    }
    for (const error of errors.values()) expect(error).toBeLessThanOrEqual(TOLERANCE_PT);
  });
});

describe("PGF plot mark selection and TikZ keys", () => {
  it("follows \\pgfplothandlermark's repeat/phase counter and the 1-based mark indices list", () => {
    expect(selectPlotMarkIndices(5, {})).toEqual([0, 1, 2, 3, 4]);
    // repeat=2, phase=2 marks the 2nd and 4th points (checked in TeX).
    expect(selectPlotMarkIndices(5, { repeat: 2, phase: 2 })).toEqual([1, 3]);
    expect(selectPlotMarkIndices(7, { repeat: 3, phase: 1 })).toEqual([0, 3, 6]);
    expect(selectPlotMarkIndices(7, { repeat: 3, phase: 3 })).toEqual([2, 5]);
    expect(selectPlotMarkIndices(6, { indices: [1, 3, 4] })).toEqual([0, 2, 3]);
  });

  it("knows which marks need the plotmarks library and infers it on export", () => {
    expect(plotMarkRequiresLibrary("*")).toBe(false);
    expect(plotMarkRequiresLibrary("ball")).toBe(false);
    expect(plotMarkRequiresLibrary("triangle*")).toBe(true);
    const basic = renderTikzToSvg(String.raw`\begin{tikzpicture}\draw plot[mark=x] coordinates {(0,0)};\end{tikzpicture}`);
    expect(basic.semantic.scene.requiredTikzLibraries).not.toContain("plotmarks");
    const library = renderTikzToSvg(String.raw`\begin{tikzpicture}\draw plot[mark=diamond*] coordinates {(0,0)};\end{tikzpicture}`);
    expect(library.semantic.scene.requiredTikzLibraries).toContain("plotmarks");
  });

  const markCount = (source: string): number =>
    evaluateSemantic(source).scene.elements.filter((element) => element.kind === "Path" && element.id.includes(":mark:")).length;

  it("handles mark=none, no marks, mark repeat/phase/indices and scope-level mark keys", () => {
    const points = "coordinates {(0,0) (1,0) (2,0) (3,0) (4,0)}";
    expect(markCount(String.raw`\begin{tikzpicture}\draw plot[mark=x] ${points};\end{tikzpicture}`)).toBe(5);
    expect(markCount(String.raw`\begin{tikzpicture}\draw[mark=x] plot[mark=none] ${points};\end{tikzpicture}`)).toBe(0);
    expect(markCount(String.raw`\begin{tikzpicture}\draw[mark=x] plot[no marks] ${points};\end{tikzpicture}`)).toBe(0);
    expect(markCount(String.raw`\begin{tikzpicture}\draw[mark=x] plot[no markers] ${points};\end{tikzpicture}`)).toBe(0);
    expect(markCount(String.raw`\begin{tikzpicture}\draw plot[mark=x, mark repeat=2] ${points};\end{tikzpicture}`)).toBe(3);
    expect(markCount(String.raw`\begin{tikzpicture}\draw plot[mark=x, mark repeat=2, mark phase=2] ${points};\end{tikzpicture}`)).toBe(2);
    expect(markCount(String.raw`\begin{tikzpicture}\draw plot[mark=x, mark indices={1,3,...,5}] ${points};\end{tikzpicture}`)).toBe(3);
    expect(markCount(String.raw`\begin{tikzpicture}[mark=o, mark size=1pt]\draw plot ${points};\end{tikzpicture}`)).toBe(5);
  });

  it("places marks on the data points for const and jump handlers, and draws no path with only marks", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
  \draw[const plot mark mid, mark=x, mark repeat=2, mark phase=2] plot coordinates {(0,0) (1,1) (2,0) (3,1) (4,0)};
\end{tikzpicture}`);
    const marks = result.scene.elements.filter((element): element is ScenePath => element.kind === "Path" && element.id.includes(":mark:"));
    // The x mark's first move is at (-.707r, -.707r) from its point; TeX marks (1,1) and (3,1).
    const centres = marks.map((mark) => {
      const move = mark.commands[0];
      return move?.kind === "M" ? [Math.round(move.to.x + 1.41421), Math.round(move.to.y + 1.41421)] : null;
    });
    expect(centres).toEqual([[28, 28], [85, 28]]);

    const onlyMarks = evaluateSemantic(String.raw`\begin{tikzpicture}\draw plot[only marks, mark=*] coordinates {(0,0) (1,1)};\end{tikzpicture}`);
    const paths = onlyMarks.scene.elements.filter((element) => element.kind === "Path");
    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.id.includes(":mark:"))).toBe(true);
  });

  it("paints marks after the rest of the path, with every mark from \\tikzset and solid in mark options", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
  \tikzset{every mark/.style={fill=red}}
  \draw[dashed] plot[mark=square*] coordinates {(0,0) (1,0)} -- (2,1);
  \draw[dashed] plot[mark=square*, mark options={solid}] coordinates {(0,1)};
\end{tikzpicture}`);
    const paths = result.scene.elements.filter((element): element is ScenePath => element.kind === "Path");
    const firstMark = paths.findIndex((path) => path.id.includes(":mark:"));
    const tail = paths.findIndex((path) => !path.id.includes(":mark:") && path.commands.some((command) => command.kind === "L" && command.to.x > 56));
    expect(tail).toBeGreaterThanOrEqual(0);
    expect(firstMark).toBeGreaterThan(tail);
    const marks = paths.filter((path) => path.id.includes(":mark:"));
    expect(cssToRgb(marks[0]?.style.fill ?? null)).toEqual([1, 0, 0]);
    expect(marks[0]?.style.dashArray?.length ?? 0).toBeGreaterThan(0);
    expect(marks.at(-1)?.style.dashArray ?? null).toBeNull();
  });

  it("diagnoses unknown marks and the unrendered text mark", () => {
    const unknown = evaluateSemantic(String.raw`\begin{tikzpicture}\draw plot[mark=nonsense] coordinates {(0,0)};\end{tikzpicture}`);
    expect(unknown.diagnostics.some((diagnostic) => diagnostic.code === "unknown-plot-mark:nonsense")).toBe(true);
    const text = evaluateSemantic(String.raw`\begin{tikzpicture}\draw plot[mark=text] coordinates {(0,0)};\end{tikzpicture}`);
    expect(text.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-plot-mark:text")).toBe(true);
    const keys = evaluateSemantic(String.raw`\begin{tikzpicture}\draw[mark size=3pt, mark color=red, mark phase=1] plot[mark=o, mark options={scale=2}] coordinates {(0,0)};\end{tikzpicture}`);
    expect(keys.diagnostics.filter((diagnostic) => (diagnostic.code ?? "").startsWith("unsupported-option"))).toEqual([]);
  });
});
