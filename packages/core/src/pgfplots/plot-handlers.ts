/**
 * Plot handlers of an axis plot (behaviour P1), in canvas coordinates.
 *
 * pgfplots draws with PGF's plot handlers (pgflibraryplothandlers.code.tex,
 * LPPL): the same geometry as the TikZ `plot` handlers in
 * `semantic/path/evaluate-plot.ts`, which emits through the TikZ path
 * machinery; this is the pure form for the axis evaluator. Each run of
 * points between jumps (empty lines, `unbounded coords=jump`) is handled
 * separately, as PGF's jump macro restarts the handler.
 */
import type { Point } from "./layout.js";
import type { PlotHandlerName } from "./model.js";

export type HandlerCommand = { kind: "M" | "L"; to: Point } | { kind: "C"; c1: Point; c2: Point; to: Point };

export function plotHandlerCommands(
  points: ReadonlyArray<{ p: Point; jump: boolean }>,
  handler: PlotHandlerName,
  options: { tension: number; combBase: (p: Point) => Point }
): HandlerCommand[] {
  const runs: Point[][] = [];
  for (const { p, jump } of points) {
    if (jump || runs.length === 0) runs.push([]);
    runs[runs.length - 1]?.push(p);
  }
  const out: HandlerCommand[] = [];
  for (const run of runs) out.push(...runCommands(run, handler, options));
  return out;
}

function runCommands(points: readonly Point[], handler: PlotHandlerName, options: { tension: number; combBase: (p: Point) => Point }): HandlerCommand[] {
  const out: HandlerCommand[] = [];
  const first = points[0];
  if (!first) return out;
  const at = (i: number): Point => points[Math.max(0, Math.min(points.length - 1, i))] ?? first;
  switch (handler) {
    case "sharp":
      points.forEach((p, i) => out.push({ kind: i === 0 ? "M" : "L", to: p }));
      return out;
    case "smooth": {
      // \pgfplothandlercurveto: support points at ±(0.2775·tension)·(next − previous); the first
      // segment starts with the first point as its control, the last ends with the last point.
      const f = 0.2775 * options.tension;
      out.push({ kind: "M", to: first });
      for (let i = 0; i < points.length - 1; i += 1) {
        const prev = at(i - 1); const cur = at(i); const next = at(i + 1); const next2 = at(i + 2);
        const c1 = i === 0 ? cur : { x: cur.x + f * (next.x - prev.x), y: cur.y + f * (next.y - prev.y) };
        const c2 = i === points.length - 2 ? next : { x: next.x - f * (next2.x - cur.x), y: next.y - f * (next2.y - cur.y) };
        out.push({ kind: "C", c1, c2, to: next });
      }
      return out;
    }
    case "const-left": case "const-right": case "const-mid":
    case "jump-left": case "jump-right": case "jump-mid": {
      out.push({ kind: "M", to: first });
      for (let i = 1; i < points.length; i += 1) {
        const a = at(i - 1); const b = at(i);
        const mid = (a.x + b.x) / 2;
        if (handler === "const-left") out.push({ kind: "L", to: { x: b.x, y: a.y } }, { kind: "L", to: b });
        else if (handler === "const-right") out.push({ kind: "L", to: { x: a.x, y: b.y } }, { kind: "L", to: b });
        else if (handler === "const-mid") out.push({ kind: "L", to: { x: mid, y: a.y } }, { kind: "L", to: { x: mid, y: b.y } }, { kind: "L", to: b });
        else if (handler === "jump-left") out.push({ kind: "L", to: { x: b.x, y: a.y } }, { kind: "M", to: b });
        else if (handler === "jump-right") out.push({ kind: "M", to: { x: a.x, y: b.y } }, { kind: "L", to: b });
        else out.push({ kind: "L", to: { x: mid, y: a.y } }, { kind: "M", to: { x: mid, y: b.y } }, { kind: "L", to: b });
      }
      return out;
    }
    case "ycomb": case "xcomb":
      for (const p of points) out.push({ kind: "M", to: options.combBase(p) }, { kind: "L", to: p });
      return out;
  }
}
