/**
 * E20 bisect when the decade above the last major tick gets its minor log
 * ticks: hi (log10 of xmax) varies just above the last major decade.
 * Classifier: number of minor tick marks on the bottom edge (Tier 2).
 */
import { bisectAll, type BisectTask } from "./bisect.js";
import { saveTable, strokes, subpaths, type ExpResult } from "./lib.js";

const num = (e: number) => { const k = Math.floor(e); return `${(10 ** (e - k)).toFixed(12)}e${k}`; };
const body = (a: number, b: number, L: number) => `\\begin{tikzpicture}\\begin{loglogaxis}[scale only axis,width=${L}pt,height=100pt,xmin=${num(a)},xmax=${num(b)},ymin=1,ymax=10]
\\addplot coordinates {(${num(a)},1) (${num(b)},10)};
\\end{loglogaxis}\\end{tikzpicture}`;
const minorCount = (r: ExpResult) => {
  const y0 = r.axis?.rect?.r00.y ?? 0;
  return String(strokes(r.tier2).filter((p) => p.paint?.components.join() === "0.5" && p.clipDepth === 0).flatMap((p) => subpaths(p))
    .filter((sp) => sp.length === 2 && Math.abs(sp[0]!.x - sp[1]!.x) < 1e-3 && Math.abs(Math.min(sp[0]!.y, sp[1]!.y) - y0) < 0.01 && Math.abs(sp[1]!.y - sp[0]!.y) < 3.5).length);
};
const tasks: BisectTask[] = [];
for (const [a, last, L] of [[0, 2, 195], [0.3, 3, 195], [-5.7, -2, 195], [0, 2, 100], [0, 5, 195], [-3.2, 1, 300]] as const) {
  tasks.push({ name: `hi@a=${a},last=${last},L=${L}`, lo: last + 0.05, hi: last + 0.95, body: (v) => body(a, v, L), classify: minorCount });
}
const res = bisectAll("e20-log-minor-bisect", tasks, (_t, lo, hi) => hi - lo <= 1e-5, { probes: ["limits", "ticks"], k: 14, maxRounds: 6 });
for (const r of res) console.log(`${r.name.padEnd(28)} transition in [${r.lo}, ${r.hi}]  ${r.classLo} -> ${r.classHi}`);
console.log(saveTable("e20-log-minor-bisect", "transitions.tsv", res as unknown as Record<string, unknown>[]));
