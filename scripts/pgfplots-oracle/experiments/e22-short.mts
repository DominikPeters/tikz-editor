/**
 * E22c (behaviour AA2): automatic ticks of short axes without any ratio.
 * Explicit limits [lo, lo + range] on a `scale only axis` box of length L,
 * for the (lo, range, L) of E22 cases whose ratio-shortened direction kept
 * ticks beyond its limits. Prints TeX's tick list.
 *   node --import tsx scripts/pgfplots-oracle/experiments/e22-short.mts
 */
import { axisBody, runExperiment, tickValues } from "./lib.js";

// [lo, hi, length]
const rows: Array<[number, number, number]> = [
  [-4.108, -1.372, 19.18], [0.2, 2.28, 28.04], [1.768, 6.112, 11.82], [0.231, 1.539, 3.27], [0.455, 2.195, 47.95],
  [0.27, 1.13, 11.35], [-4.44, -2.2, 10.47], [2.587, 5.503, 156.96], [3.5559, 16.0841, 42.07], [-3.636, -0.804, 49.75],
  [-4.807, -2.903, 45.5], [0.023, 0.883, 11.35], [0.046, 0.906, 11.35], [0.207, 1.067, 11.35], [0.2, 2.28, 60], [0.2, 2.28, 100],
];
const cases = rows.map(([lo, hi, len], i) => ({ id: `r${i}`, meta: { lo, hi, len }, body: axisBody(`scale only axis,width=${len}pt,height=100pt,xmin=${lo},xmax=${hi},ymin=0,ymax=1`, "\\addplot coordinates {(0,0)};") }));
const res = runExperiment("e22-short", cases, { probes: ["limits", "map", "ticks"] });
for (const r of res) console.log(`${r.id.padEnd(4)} x[${String(r.meta.lo)}, ${String(r.meta.hi)}] L=${String(r.meta.len)} xt ${tickValues(r.axis, "x").map((v) => Number(v.toFixed(5))).join(" ")}`);
