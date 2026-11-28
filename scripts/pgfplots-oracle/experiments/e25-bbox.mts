/** E25 helper: Tier 1 bounding box, axis rectangle and page size per case. */
import { runExperiment } from "./lib.js";
import { CASES, NAME } from "./e25-cases.js";

const res = runExperiment(NAME, CASES, { probes: ["limits", "map", "axisAnchors", "descriptions"], quiet: true });
const f = (v: number | undefined) => (v ?? Number.NaN).toFixed(3);
for (const r of res) {
  const b = r.bbox; const rect = r.axis?.rect; const page = (r.tier2 as { page?: { width: number; height: number } }).page;
  console.log(`${r.id.padEnd(28)} bbox ${f(b?.minX)},${f(b?.minY)} ${f(b?.maxX)},${f(b?.maxY)} page ${f(page?.width)}x${f(page?.height)} rect ${JSON.stringify(rect)?.slice(0, 90)}`);
}
