/**
 * E09 bisect the transitions of the automatic tick step (linear axis):
 *  (a) axis length L at fixed range, (b) range r at fixed length.
 * Classifier: the x tick step (from \tick values). Output: transition table.
 */
import { bisectAll, type BisectTask } from "./bisect.js";
import { saveTable, tickValues, type ExpResult } from "./lib.js";

const body = (lo: number, hi: number, L: number, extra = "") => `\\begin{tikzpicture}\\begin{axis}[scale only axis,width=${L}pt,height=100pt,xmin=${lo},xmax=${hi},ymin=0,ymax=1,scaled ticks=false${extra}]
\\addplot coordinates {(${lo},0) (${hi},1)};
\\end{axis}\\end{tikzpicture}`;
const step = (r: ExpResult) => { const xs = tickValues(r.axis, "x"); return xs.length > 1 ? Number((xs[1]! - xs[0]!).toPrecision(3)).toString() : `n${xs.length}`; };
const tasks: BisectTask[] = [];
// (a) L transitions at r = 1 and r = 7, plus offset ranges; predicted at multiples of 35.
for (const [r, lo, hi] of [[1, 240, 250], [1, 485, 495], [7, 170, 180], [7, 345, 355], [7, 730, 740], [3, 135, 145], [3, 205, 215], [1, 100, 110], [1, 1, 5]] as const) {
  tasks.push({ name: `L@r=${r}[${lo},${hi}]`, lo, hi, body: (v) => body(0, r, v), classify: step });
}
// (b) r transitions at L = 195 (n=5) and L = 300 (n=8): thresholds of the mantissa.
for (const [L, lo, hi] of [[195, 0.06, 0.09], [195, 0.015, 0.02], [195, 0.03, 0.045], [195, 6, 9], [195, 1.5, 2], [195, 3, 4.5], [300, 0.1, 0.14], [300, 0.25, 0.3], [300, 0.55, 0.65]] as const) {
  tasks.push({ name: `r@L=${L}[${lo},${hi}]`, lo, hi, body: (v) => body(0, v, L), classify: step });
}
// (c) offset range: does lo matter? r transition at L=195 with lo = 0.37
tasks.push({ name: "r@L=195,lo=0.37[0.06,0.09]", lo: 0.06, hi: 0.09, body: (v) => body(0.37, Number((0.37 + v).toPrecision(10)), 195), classify: step });
const res = bisectAll("e09-tick-bisect", tasks, (t, lo, hi) => (hi - lo) <= 1e-6 * Math.abs(hi), { probes: ["limits", "ticks"], k: 14, maxRounds: 8 });
for (const r of res) console.log(`${r.name.padEnd(30)} transition in [${r.lo}, ${r.hi}]  ${r.classLo} -> ${r.classHi}`);
console.log(saveTable("e09-tick-bisect", "transitions.tsv", res as unknown as Record<string, unknown>[]));
