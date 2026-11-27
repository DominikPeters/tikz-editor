/**
 * E22 (behaviour AA): prints limits and box of each case of `e22-cases.ts`
 * and writes `artifacts/pgfplots-experiments/e22-axis-equal-<seed>/rows.json`.
 *   E22_SEED=<n> node --import tsx scripts/pgfplots-oracle/experiments/e22-axis-equal.mts
 */
import { CASES, NAME } from "./e22-cases.js";
import { rectOf, runExperiment, saveTable } from "./lib.js";

const res = runExperiment(NAME, CASES, { probes: ["limits", "map"] });
const rows = res.map((r) => {
  const rect = rectOf(r.axis);
  return { id: r.id, opts: r.meta.opts, pts: r.meta.pts, ...r.axis?.limits, w: rect?.rw, h: rect?.rh };
});
saveTable(NAME, "rows.json", rows);
for (const row of rows) console.log(`${String(row.id).padEnd(8)} ${String(row.opts).padEnd(70)} ${String(row.pts).padEnd(26)} x[${row.xmin?.toFixed(4)}, ${row.xmax?.toFixed(4)}] y[${row.ymin?.toFixed(4)}, ${row.ymax?.toFixed(4)}] box ${row.w?.toFixed(4)} x ${row.h?.toFixed(4)}`);
