/**
 * E10 the small-axis regime of automatic ticks (try min ticks active).
 * Coarse sweep of range r in [1,10] (lo = 0 or an offset) for a grid of axis
 * lengths L and try-min-ticks values; transitions of the step give the
 * effective divisor n_eff = r_t / threshold. Usage: e10-minticks.mts [lo]
 */
import { runExperiment, saveTable, tickValues } from "./lib.js";

const lo = Number(process.argv[2] ?? 0);
const Ls = [10, 30, 50, 60, 69, 80, 100, 120, 140, 160];
const tmts = [1, 2, 3, 4, 6];
const NR = 40;
const cases = [];
for (const L of Ls) for (const tmt of tmts) for (let i = 0; i <= NR; i += 1) {
  const r = Number((10 ** (i / NR)).toPrecision(6));
  const hi = Number((lo + r).toPrecision(8));
  cases.push({ id: `L${L}-t${tmt}-i${i}`, meta: { L, tmt, r, lo, hi }, body: `\\begin{tikzpicture}\\begin{axis}[scale only axis,width=${L}pt,height=100pt,xmin=${lo},xmax=${hi},ymin=0,ymax=1,scaled ticks=false,try min ticks=${tmt}]
\\addplot coordinates {(${lo},0) (${hi},1)};
\\end{axis}\\end{tikzpicture}` });
}
const res = runExperiment(`e10-minticks-lo${lo}`, cases, { probes: ["limits", "ticks"], batchSize: 250 });
const rows = res.map((r) => { const xs = tickValues(r.axis, "x"); return { id: r.id, ...r.meta, n: xs.length, step: xs.length > 1 ? Number((xs[1]! - xs[0]!).toPrecision(3)) : "", ticks: xs }; });
console.log(saveTable(`e10-minticks-lo${lo}`, "steps.tsv", rows));
