/**
 * E17 automatic tick placement on log axes. Each case: a loglogaxis with
 * explicit limits [10^a, 10^b] on x (y fixed), scale only axis, box length L.
 * Records major tick values in log10 units (\tick is ln), \ticknum, minor
 * tick marks from Tier 2 (bottom edge, short strokes), label strings.
 * Usage: e17-log-ticks.mts <sweep> [seed] [n]
 *   range  : a=0, b = R for R in 0.05..40, L=195
 *   offset : a random, R random, L=195
 *   length : a=0, R in {0.5, 3, 12, 30}, L 20..800
 *   random : everything random (fresh validation)
 */
import { runExperiment, saveTable, strokes, subpaths } from "./lib.js";

const sweep = process.argv[2] ?? "range";
const seed = Number(process.argv[3] ?? 0);
let s = seed * 7919 + 101;
const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
const sig = (v: number, n = 6) => Number(v.toPrecision(n));
type Spec = { a: number; b: number; L: number; extra?: string };
const specs: Spec[] = [];
if (sweep === "range") {
  for (let i = 0; i < 300; i += 1) specs.push({ a: 0, b: sig(0.05 * 800 ** (i / 299), 5), L: 195 });
} else if (sweep === "offset") {
  for (let i = 0; i < 300; i += 1) { const a = sig(-20 + rand() * 40, 4); const R = sig(0.05 * 900 ** rand(), 4); specs.push({ a, b: sig(a + R, 6), L: 195 }); }
} else if (sweep === "smallL") {
  for (const a of [0, 0.3, -0.7]) for (let i = 0; i < 100; i += 1) specs.push({ a, b: sig(a + 0.5 + i * 0.4, 5), L: 60 });
} else if (sweep === "tmt") {
  for (const a of [0, 0.3]) for (let i = 0; i < 100; i += 1) specs.push({ a, b: sig(a + 0.5 + i * 0.4, 5), L: 195, extra: "try min ticks=7" });
} else if (sweep === "length") {
  for (const R of [0.5, 1.7, 3, 7, 12, 30]) for (let i = 0; i < 50; i += 1) specs.push({ a: 0, b: R, L: sig(20 + i * 16, 5) });
} else {
  const n = Number(process.argv[4] ?? 300);
  for (let i = 0; i < n; i += 1) {
    const a = sig(-30 + rand() * 60, 4); const R = sig(0.05 * 1200 ** rand(), 4);
    const spec: Spec = { a, b: sig(a + R, 6), L: sig(25 + rand() * 600, 5) };
    if (sweep === "tmtlog") spec.extra = ["try min ticks log=2", "try min ticks log=5", "try min ticks log=7,max space between ticks=50", "try min ticks=8", "max space between ticks=25"][Math.floor(rand() * 5)];
    if (sweep === "msbt") spec.extra = ["max space between ticks=20", "max space between ticks=60", "try min ticks=2", "try min ticks=7", "max space between ticks=50,try min ticks=3"][Math.floor(rand() * 5)];
    specs.push(spec);
  }
}
const num = (e: number) => { const k = Math.floor(e); return `${(10 ** (e - k)).toFixed(9)}e${k}`; };
const cases = specs.map((sp, i) => ({
  id: `t${i}`,
  meta: { ...sp },
  body: `\\begin{tikzpicture}\\begin{loglogaxis}[scale only axis,width=${sp.L}pt,height=100pt,xmin=${num(sp.a)},xmax=${num(sp.b)},ymin=1,ymax=10${sp.extra ? `,${sp.extra}` : ""}]
\\addplot coordinates {(${num(sp.a)},1) (${num(sp.b)},10)};\n\\end{loglogaxis}\\end{tikzpicture}`,
}));
const res = runExperiment(`e17-log-ticks-${sweep}-seed${seed}`, cases, { probes: ["limits", "ticks", "map"] });
const LN10 = Math.log(10);
const rows = res.map((r) => {
  const a = r.axis;
  const xs = (a?.ticks?.x ?? []).map((t) => sig(t.value / LN10, 6));
  const y0 = a?.rect?.r00.y ?? 0;
  const marks = strokes(r.tier2).filter((p) => p.paint?.components.join() === "0.5" && p.clipDepth === 0).flatMap((p) => subpaths(p))
    .filter((sp) => sp.length === 2 && Math.abs(sp[0]!.x - sp[1]!.x) < 1e-3 && Math.abs(Math.min(sp[0]!.y, sp[1]!.y) - y0) < 0.01);
  const minor = marks.filter((sp) => Math.abs(sp[1]!.y - sp[0]!.y) < 3.5).length;
  return {
    id: r.id, ...r.meta, xmin: a?.limitsRaw?.xmin, xmax: a?.limitsRaw?.xmax,
    ticks: xs, idx: (a?.ticks?.x ?? []).map((t) => t.index), step: xs.length > 1 ? sig(xs[1]! - xs[0]!, 4) : "", minor,
    labels: (a?.ticks?.x ?? []).map((t) => t.label?.text ?? ""),
  };
});
console.log(saveTable(`e17-log-ticks-${sweep}-seed${seed}`, "ticks.tsv", rows));
console.log(saveTable(`e17-log-ticks-${sweep}-seed${seed}`, "ticks.json", rows));
