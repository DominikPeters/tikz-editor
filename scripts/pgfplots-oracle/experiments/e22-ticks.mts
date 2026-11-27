/**
 * E22b: automatic ticks on a direction whose box `axis equal image` shrinks
 * (behaviour AA2). Sweeps the offset of a short x range under `axis equal
 * image` and prints TeX's tick list next to the limits, plus the same box
 * and limits drawn without a ratio (`scale only axis`, explicit limits).
 *   node --import tsx scripts/pgfplots-oracle/experiments/e22-ticks.mts [range] [mode]
 */
import { axisBody, rectOf, runExperiment, tickValues } from "./lib.js";

const range = Number(process.argv[2] ?? 0.86);
const mode = process.argv[3] ?? "axis equal image,enlargelimits=false";
const cases = [];
for (let i = 0; i <= 20; i++) {
  const a = Number((i * 0.023).toFixed(3));
  cases.push({ id: `t${i}`, meta: { a }, body: axisBody(mode, `\\addplot coordinates {(${a},-1.34) (${Number((a + range).toFixed(3))},10.93)};`) });
}
const res = runExperiment(`e22-ticks-${range}-${mode.replace(/[^a-z0-9]+/giu, "")}`, cases, { probes: ["limits", "map", "ticks"] });
for (const r of res) {
  const rect = rectOf(r.axis);
  const l = r.axis?.limits;
  console.log(`${r.id.padEnd(4)} a=${String(r.meta.a).padEnd(6)} x[${l?.xmin.toFixed(4)}, ${l?.xmax.toFixed(4)}] w=${rect?.rw.toFixed(3)} h=${rect?.rh.toFixed(3)} xt ${tickValues(r.axis, "x").map((v) => Number(v.toFixed(5))).join(" ")} | yt ${tickValues(r.axis, "y").join(" ")}`);
}
