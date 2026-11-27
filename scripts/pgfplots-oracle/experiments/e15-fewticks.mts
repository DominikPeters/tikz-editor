/**
 * E15 the "few ticks" corner (OPEN in the behaviour log, rule I1b): small
 * axes with try min ticks <= 3. Fixed range width r, sliding lo; records step.
 * Usage: e15-fewticks.mts [r] [L] [tmt]
 */
import { runExperiment, saveTable, tickValues } from "./lib.js";

const r = Number(process.argv[2] ?? 8100); const L = Number(process.argv[3] ?? 50); const tmt = Number(process.argv[4] ?? 2);
const cases = Array.from({ length: 60 }, (_, i) => {
  const lo = Number((-r + (i * 3 * r) / 60).toPrecision(6)); const hi = Number((lo + r).toPrecision(8));
  return { id: `f${i}`, meta: { lo, hi }, body: `\\begin{tikzpicture}\\begin{axis}[scale only axis,width=${L}pt,height=100pt,xmin=${lo},xmax=${hi},ymin=0,ymax=1,scaled ticks=false,try min ticks=${tmt}]\\addplot coordinates {(${lo},0) (${hi},1)};\\end{axis}\\end{tikzpicture}` };
});
const res = runExperiment(`e15-fewticks-r${r}-L${L}-t${tmt}`, cases, { probes: ["limits", "ticks"] });
const rows = res.map((x) => ({ id: x.id, ...x.meta, ticks: tickValues(x.axis, "x") }));
for (const row of rows as Record<string, unknown>[]) console.log(row.lo, row.hi, (row.ticks as number[]).join(" "));
saveTable(`e15-fewticks-r${r}-L${L}-t${tmt}`, "fewticks.tsv", rows);
