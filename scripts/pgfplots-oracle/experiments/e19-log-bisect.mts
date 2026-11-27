/**
 * E19 bisect the transitions of the automatic log tick step: the x range R
 * (decades) of a loglogaxis [1, 10^R] at fixed box length L.
 * Classifier: the x tick step in decades. Output: transition table.
 */
import { bisectAll, type BisectTask } from "./bisect.js";
import { saveTable, type ExpResult } from "./lib.js";

const num = (e: number) => { const k = Math.floor(e); return `${(10 ** (e - k)).toFixed(12)}e${k}`; };
const body = (a: number, R: number, L: number, extra = "") => `\\begin{tikzpicture}\\begin{loglogaxis}[scale only axis,width=${L}pt,height=100pt,xmin=${num(a)},xmax=${num(a + R)},ymin=1,ymax=10${extra}]
\\addplot coordinates {(${num(a)},1) (${num(a + R)},10)};
\\end{loglogaxis}\\end{tikzpicture}`;
const step = (r: ExpResult) => { const xs = (r.axis?.ticks?.x ?? []).map((t) => t.value / Math.log(10)); return xs.length > 1 ? Number((xs[1]! - xs[0]!).toPrecision(2)).toString() : `n${xs.length}`; };
const tasks: BisectTask[] = [];
const spec: Array<[number, number, number, number?]> = [
  [195, 0.055, 0.0605], [195, 0.12, 0.14], [195, 0.25, 0.31], [195, 0.5, 0.62], [195, 1.22, 1.43], [195, 1.53, 2.0], [195, 9.0, 10.1], [195, 13.0, 15.4],
  [300, 0.08, 0.13], [300, 0.5, 1.0], [300, 1.5, 3.5], [300, 12, 20],
  [120, 0.03, 0.06], [120, 0.5, 1.0], [120, 1.0, 2.5], [120, 4, 8],
];
for (const [L, lo, hi] of spec) tasks.push({ name: `R@L=${L}[${lo},${hi}]`, lo, hi, body: (v) => body(0, v, L), classify: step });
const res = bisectAll("e19-log-bisect", tasks, (_t, lo, hi) => (hi - lo) <= 1e-5 * Math.abs(hi), { probes: ["limits", "ticks"], k: 14, maxRounds: 6 });
for (const r of res) console.log(`${r.name.padEnd(28)} transition in [${r.lo}, ${r.hi}]  ${r.classLo} -> ${r.classHi}`);
console.log(saveTable("e19-log-bisect", "transitions.tsv", res as unknown as Record<string, unknown>[]));
