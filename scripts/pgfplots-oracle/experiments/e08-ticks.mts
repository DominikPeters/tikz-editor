/**
 * E08 automatic tick placement (linear axes). Each case: explicit limits
 * [lo, hi] on x and y (enlargelimits=false), axis box Lx x Ly pt (scale only
 * axis). Records major tick values, hence the step.
 * Usage: e08-ticks.mts <sweep> [seed]
 *   sweep = range   : lo=0, hi=10^u over 5 decades, L fixed (195 x 162)
 *           length  : fixed range, L varied 20..1000 pt
 *           random  : random lo, hi, L (fresh validation)
 *           font    : random as above, with tick label font / label width variations
 *           msbt    : random, with max space between ticks / try min ticks varied
 *           fewticks: random, small axes (15..125pt) with try min ticks <= 3 (rule I1b)
 */
import { runExperiment, saveTable, tickValues } from "./lib.js";

const sweep = process.argv[2] ?? "range";
const seed = Number(process.argv[3] ?? 0);
let s = seed * 7919 + 101;
const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const sig = (v: number, n = 6) => Number(v.toPrecision(n));
interface Spec { xlo: number; xhi: number; ylo: number; yhi: number; Lx: number; Ly: number; extra?: string }
const specs: Spec[] = [];
if (sweep === "range") {
  for (let i = 0; i < 400; i += 1) { const u = -2 + (5 * i) / 400; const r = sig(10 ** u); specs.push({ xlo: 0, xhi: r, ylo: 0, yhi: r, Lx: 195, Ly: 162 }); }
} else if (sweep === "length") {
  for (let i = 0; i < 300; i += 1) { const L = sig(20 + i * 3.3, 5); specs.push({ xlo: 0, xhi: 1, ylo: 0, yhi: 7, Lx: L, Ly: L }); }
} else {
  const n = Number(process.argv[4] ?? 300);
  for (let i = 0; i < n; i += 1) {
    const mag = 10 ** Math.floor(-3 + rand() * 7);
    const xr = sig(mag * (0.5 + rand() * 9.5)); const yr = sig(mag * (0.5 + rand() * 9.5));
    const xlo = sig((rand() - 0.5) * 4 * xr * (rand() < 0.3 ? 10 : 1), 5); const ylo = sig((rand() - 0.5) * 4 * yr, 5);
    const spec: Spec = { xlo, xhi: sig(xlo + xr), ylo, yhi: sig(ylo + yr), Lx: sig(30 + rand() * 600, 5), Ly: sig(30 + rand() * 600, 5) };
    if (sweep === "font") spec.extra = pick(["tick label style={font=\\Huge}", "tick label style={font=\\tiny}", "xticklabel style={text width=3cm}", "xlabel=x,ylabel=y", "tick label style={/pgf/number format/precision=5}"]);
    if (sweep === "fewticks") { spec.Lx = sig(15 + rand() * 110, 5); spec.Ly = sig(15 + rand() * 110, 5); spec.extra = pick(["try min ticks=1", "try min ticks=2", "try min ticks=3", "try min ticks=3,max space between ticks=50"]); }
    if (sweep === "msbt") spec.extra = pick(["max space between ticks=20", "max space between ticks=60", "max space between ticks=100", "try min ticks=2", "try min ticks=8", "max space between ticks=25,try min ticks=6", "max space between ticks=50,try min ticks=3"]);
    specs.push(spec);
  }
}
const cases = specs.map((sp, i) => ({
  id: `t${i}`,
  meta: { ...sp },
  body: `\\begin{tikzpicture}\\begin{axis}[scale only axis,width=${sp.Lx}pt,height=${sp.Ly}pt,xmin=${sp.xlo},xmax=${sp.xhi},ymin=${sp.ylo},ymax=${sp.yhi},scaled ticks=false${sp.extra ? `,${sp.extra}` : ""}]
\\addplot coordinates {(${sp.xlo},${sp.ylo}) (${sp.xhi},${sp.yhi})};
\\end{axis}\\end{tikzpicture}`,
}));
const res = runExperiment(`e08-ticks-${sweep}-seed${seed}`, cases, { probes: ["limits", "ticks"] });
const rows = res.map((r) => {
  const xs = tickValues(r.axis, "x"); const ys = tickValues(r.axis, "y");
  return { id: r.id, ...r.meta, xticks: xs, yticks: ys, xstep: xs.length > 1 ? sig(xs[1]! - xs[0]!, 4) : "", ystep: ys.length > 1 ? sig(ys[1]! - ys[0]!, 4) : "", xidx0: r.axis?.ticks?.x[0]?.index ?? "", yidx0: r.axis?.ticks?.y[0]?.index ?? "" };
});
console.log(saveTable(`e08-ticks-${sweep}-seed${seed}`, "ticks.tsv", rows));
