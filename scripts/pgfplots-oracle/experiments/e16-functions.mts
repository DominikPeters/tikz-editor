/**
 * E16 function plots (behaviour M): sample positions, float evaluation
 * error, unbounded coordinates. Each case is one expression plot on an axis
 * with explicit, exactly representable limits; the ideal canvas points are
 * computed with the editor's float pgfmath (`compilePgfMathExpression`,
 * mode float) and mapped through the axis box as painted (Tier 2), which
 * removes the PDF pt->bp scale noise (N3). Usage:
 *   node --import tsx scripts/pgfplots-oracle/experiments/e16-functions.mts [set]
 * set = a (discovery) | b (fresh validation sweep).
 */
import { compilePgfMathExpression, parsePgfMathFunctionDeclarations, type PgfMathDeclaredFunction } from "../../../packages/core/src/semantic/pgfmath/evaluator.js";
import { expandForeachList } from "../../../packages/core/src/foreach/list.js";
import { runExperiment, saveTable, strokes, subpaths } from "./lib.js";
import type { PathPrimitive, Point } from "../schema.js";

type Spec = {
  id: string;
  /** y expression, or [x expr, y expr] for parametric. */
  expr: string | [string, string];
  domain?: [string, string];
  samples?: number;
  samplesAt?: string;
  variable?: string;
  rad?: boolean;
  declare?: string;
  unbounded?: "jump" | "discard";
  limits: [number, number, number, number];
};

const SETS: Record<string, Spec[]> = {
  a: [
    { id: "a-sq", expr: "x^2", limits: [-6, 6, -1, 26] },
    { id: "a-cube", expr: "x^3 - 3*x", domain: ["-2", "2"], samples: 31, limits: [-3, 3, -3, 3] },
    { id: "a-sin", expr: "sin(x)", domain: ["0", "360"], samples: 37, limits: [0, 360, -1.5, 1.5] },
    { id: "a-sinrad", expr: "sin(x)", domain: ["0", "2*pi"], samples: 50, rad: true, limits: [0, 7, -1.5, 1.5] },
    { id: "a-exp", expr: "exp(x)", domain: ["0", "10"], samples: 21, limits: [0, 10, 0, 25000] },
    { id: "a-ln", expr: "ln(x)", domain: ["0.1", "5"], samples: 40, limits: [0, 5, -3, 2] },
    { id: "a-sqrt", expr: "sqrt(x)", domain: ["0", "4"], samples: 17, limits: [0, 4, 0, 2] },
    { id: "a-big", expr: "1e6*x", domain: ["0", "3"], samples: 7, limits: [0, 3, 0, 4000000] },
    { id: "a-tiny", expr: "1e-4*x^2", domain: ["-1", "1"], samples: 9, limits: [-1, 1, 0, 0.0002] },
    { id: "a-gauss", expr: "exp(-x^2/2)/sqrt(2*pi)", domain: ["-4", "4"], samples: 61, limits: [-4, 4, 0, 0.5] },
    { id: "a-recip", expr: "1/x", domain: ["-2", "2"], samples: 5, limits: [-2, 2, -3, 3] },
    { id: "a-recipjump", expr: "1/x", domain: ["-2", "2"], samples: 5, unbounded: "jump", limits: [-2, 2, -3, 3] },
    { id: "a-at", expr: "x*x", samplesAt: "-2,-1.5,...,2", limits: [-2, 2, 0, 4] },
    { id: "a-at2", expr: "0.5*x", samplesAt: "0,1,3,7,15", limits: [0, 16, 0, 8] },
    { id: "a-var", expr: "t^2 - 1", variable: "t", domain: ["-1", "1"], samples: 11, limits: [-1, 1, -1, 0] },
    { id: "a-param", expr: ["cos(x)", "sin(2*x)"], domain: ["0", "360"], samples: 73, limits: [-1, 1, -1, 1] },
    { id: "a-decl", expr: "g(x)+1", declare: "g(\\a)=\\a^2/3;", domain: ["-3", "3"], samples: 13, limits: [-3, 3, 0, 4] },
    { id: "a-thirds", expr: "x", domain: ["0", "1"], samples: 4, limits: [0, 1, 0, 1] },
    { id: "a-abs", expr: "abs(x) - floor(x)", domain: ["-2.5", "2.5"], samples: 26, limits: [-3, 3, -1, 6] },
    { id: "a-tan", expr: "tan(x)", domain: ["-80", "80"], samples: 33, limits: [-80, 80, -6, 6] },
    { id: "a-negpow", expr: "x^(-2)", domain: ["1", "10"], samples: 19, limits: [0, 10, 0, 1] },
    { id: "a-pi", expr: "cos(deg(x))*x", domain: ["-pi", "pi"], samples: 25, limits: [-4, 4, -4, 4] },
  ],
  b: [
    { id: "b-poly", expr: "0.1*x^4 - x^2 + 2", domain: ["-3.3", "3.3"], samples: 47, limits: [-4, 4, -1, 5] },
    { id: "b-cosh", expr: "(exp(x)+exp(-x))/2", domain: ["-3", "3"], samples: 29, limits: [-3, 3, 0, 11] },
    { id: "b-atan", expr: "atan(x)", domain: ["-10", "10"], samples: 41, limits: [-10, 10, -100, 100] },
    { id: "b-sinc", expr: "sin(deg(x))/x", domain: ["0.01", "20"], samples: 80, limits: [0, 20, -0.5, 1.2] },
    { id: "b-huge", expr: "x^5", domain: ["0", "20"], samples: 11, limits: [0, 20, 0, 4000000] },
    { id: "b-small", expr: "0.001*sin(x)", domain: ["0", "720"], samples: 49, limits: [0, 720, -0.002, 0.002] },
    { id: "b-rad", expr: "cos(x)*exp(-x/5)", domain: ["0", "4*pi"], samples: 101, rad: true, limits: [0, 13, -1, 1] },
    { id: "b-param", expr: ["t*cos(t)", "t*sin(t)"], variable: "t", domain: ["0", "6*pi"], samples: 91, rad: true, limits: [-20, 20, -20, 20] },
    { id: "b-at", expr: "sqrt(x)", samplesAt: "0,0.25,...,4", limits: [0, 4, 0, 2] },
    { id: "b-log10", expr: "log10(x)", domain: ["1", "1000"], samples: 37, limits: [0, 1000, 0, 3] },
    { id: "b-mod", expr: "mod(x,3)", domain: ["0", "9"], samples: 19, limits: [0, 9, 0, 3] },
    { id: "b-recip", expr: "1/(x-1)", domain: ["-1", "3"], samples: 9, limits: [-1, 3, -3, 3] },
    { id: "b-recipjump", expr: "1/(x-1)", domain: ["-1", "3"], samples: 9, unbounded: "jump", limits: [-1, 3, -3, 3] },
    { id: "b-lnneg", expr: "ln(x)", domain: ["-2", "3"], samples: 11, limits: [-2, 3, -2, 2] },
    { id: "b-decl", expr: "h(x,2)", declare: "h(\\a,\\b)=\\a^\\b - \\b*\\a;", domain: ["-2", "4"], samples: 25, limits: [-2, 4, -2, 9] },
    { id: "b-odd", expr: "x/3", domain: ["0", "1"], samples: 7, limits: [0, 1, 0, 1] },
    { id: "b-rev", expr: "x^2", domain: ["2", "-2"], samples: 9, limits: [-2, 2, 0, 4] },
    { id: "b-ten", expr: "10*x", domain: ["0.1", "0.7"], samples: 13, limits: [0, 1, 0, 10] },
    { id: "b-ellipse", expr: ["3*cos(x)", "2*sin(x)"], domain: ["0", "360"], samples: 61, limits: [-4, 4, -3, 3] },
    { id: "b-step", expr: "round(x)", domain: ["-2", "2"], samples: 21, limits: [-3, 3, -3, 3] },
    { id: "b-sec", expr: "sec(x)", domain: ["-60", "60"], samples: 25, limits: [-60, 60, 0, 3] },
    { id: "b-max", expr: "max(x,0.5*x^2)", domain: ["-3", "3"], samples: 37, limits: [-3, 3, -3, 5] },
  ],
};

const set = process.argv[2] ?? "a";
const specs = SETS[set];
if (!specs) throw new Error(`unknown set ${set}`);

function plotOptions(s: Spec): string {
  const o: string[] = ["black", "no markers"];
  if (s.domain) o.push(`domain=${s.domain[0]}:${s.domain[1]}`);
  if (s.samples) o.push(`samples=${s.samples}`);
  if (s.samplesAt) o.push(`samples at={${s.samplesAt}}`);
  if (s.variable) o.push(`variable=${s.variable}`);
  if (s.rad) o.push("trig format plots=rad");
  if (s.unbounded) o.push(`unbounded coords=${s.unbounded}`);
  return o.join(",");
}

const cases = specs.map((s) => {
  const [xmin, xmax, ymin, ymax] = s.limits;
  const input = Array.isArray(s.expr) ? `({${s.expr[0]}},{${s.expr[1]}})` : `{${s.expr}}`;
  const axisOpt = `scale only axis,width=200pt,height=150pt,xmin=${xmin},xmax=${xmax},ymin=${ymin},ymax=${ymax},clip=false${s.declare ? `,declare function={${s.declare}}` : ""}`;
  return { id: s.id, meta: { spec: s }, body: `\\begin{tikzpicture}\\begin{axis}[${axisOpt}]\n\\addplot[${plotOptions(s)}] ${input};\n\\end{axis}\\end{tikzpicture}` };
});
const results = runExperiment("e16-functions", cases, { probes: ["limits"] });

function evalNum(src: string): number {
  const c = compilePgfMathExpression(src, { mode: "float" });
  if (!c.ok) throw new Error(src);
  const v = c.fn();
  if (typeof v !== "number") throw new Error(src);
  return v;
}

function ideal(s: Spec): Array<Point | null> {
  const variable = s.variable ?? "x";
  const functions: Map<string, PgfMathDeclaredFunction> | undefined = s.declare ? new Map((parsePgfMathFunctionDeclarations(s.declare) ?? []).map((d) => [d.name, d])) : undefined;
  const comp = (e: string) => {
    const c = compilePgfMathExpression(e, { mode: "float", trigFormat: s.rad ? "rad" : "deg", ...(functions ? { functions } : {}), variables: [variable, `\\${variable}`] });
    if (!c.ok) throw new Error(`${e}: ${c.message}`);
    return (t: number) => { const v = c.fn([t, t]); return typeof v === "number" ? v : Number.NaN; };
  };
  let ts: number[];
  if (s.samplesAt) ts = expandForeachList(s.samplesAt, { parseExpressions: true }).map(evalNum);
  else {
    const a = evalNum(s.domain?.[0] ?? "-5"); const b = evalNum(s.domain?.[1] ?? "5"); const n = s.samples ?? 25;
    ts = Array.from({ length: n }, (_, i) => (i === n - 1 ? b : a + ((b - a) * i) / (n - 1)));
  }
  const fy = comp(Array.isArray(s.expr) ? s.expr[1] : s.expr);
  const fx = Array.isArray(s.expr) ? comp(s.expr[0]) : (t: number) => t;
  return ts.map((t) => { const x = fx(t); const y = fy(t); return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null; });
}

const rows: Record<string, unknown>[] = [];
let worst = 0;
for (const r of results) {
  const s = r.meta.spec as Spec;
  const all = strokes(r.tier2);
  const box = all.find((p) => p.clipDepth === 0 && p.segments.length === 6 && p.segments[5]?.op === "Z");
  const plot = all.filter((p) => p !== box && p.clipDepth >= 0 && (p.lineWidth ?? 0) > 0.3 && p.paint?.components.every((c) => c === 0) && p.segments.length > 1 && !(p.segments.length === 6 && p.segments[5]?.op === "Z"));
  const plotPath: PathPrimitive | undefined = plot[plot.length - 1];
  if (!box || !plotPath) { rows.push({ id: r.id, error: "no box/plot" }); continue; }
  const xs = box.segments.flatMap((q) => (q.op === "Z" ? [] : [q.x])); const ys = box.segments.flatMap((q) => (q.op === "Z" ? [] : [q.y]));
  const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
  const [xmin, xmax, ymin, ymax] = s.limits;
  const map = (p: Point): Point => ({ x: x0 + ((p.x - xmin) / (xmax - xmin)) * (x1 - x0), y: y0 + ((p.y - ymin) / (ymax - ymin)) * (y1 - y0) });
  const expected = ideal(s);
  // Expected subpaths: discard joins over nulls; jump splits there.
  const expSub: Point[][] = [];
  let cur: Point[] = [];
  for (const p of expected) {
    if (p === null) { if (s.unbounded === "jump" && cur.length) { expSub.push(cur); cur = []; } continue; }
    cur.push(map(p));
  }
  if (cur.length) expSub.push(cur);
  const got = subpaths(plotPath);
  let maxErr = 0;
  const sameShape = got.length === expSub.length && got.every((g, i) => g.length === expSub[i]!.length);
  if (sameShape) got.forEach((g, i) => g.forEach((q, j) => { const e = expSub[i]![j]!; maxErr = Math.max(maxErr, Math.hypot(q.x - e.x, q.y - e.y)); }));
  worst = Math.max(worst, sameShape ? maxErr : Infinity);
  rows.push({ id: r.id, gotSub: got.map((g) => g.length).join("+"), expSub: expSub.map((g) => g.length).join("+"), sameShape, maxErrPt: sameShape ? Number(maxErr.toFixed(5)) : "-" });
}
for (const row of rows) console.log(Object.entries(row).map(([k, v]) => `${k}=${String(v)}`).join("  "));
console.log(`worst=${worst}`);
console.log(saveTable("e16-functions", `functions-${set}.tsv`, rows));
