/**
 * E23 (behaviour T6): prints TeX's tick values (`\tick`), label texts and the
 * scale label (glyph runs near the scale label anchors) for `e23-cases.ts`.
 *   [E23_SET=b] node --import tsx scripts/pgfplots-oracle/experiments/e23-scaled.mts
 */
import { CASES, NAME } from "./e23-cases.js";
import { glyphRuns, runExperiment, tickLabels, tickValues } from "./lib.js";

const res = runExperiment(NAME, CASES, {});
for (const r of res) {
  const a = r.axis;
  console.log(`=== ${r.id} limits x[${a?.limits?.xmin}, ${a?.limits?.xmax}] y[${a?.limits?.ymin}, ${a?.limits?.ymax}]`);
  console.log(`  x \\tick ${tickValues(a, "x").join(" ")} | ${tickLabels(a, "x").join(" ")}`);
  console.log(`  y \\tick ${tickValues(a, "y").join(" ")} | ${tickLabels(a, "y").join(" ")}`);
  const runs = glyphRuns(r.tier2).map((g) => `${g.text}@(${g.glyphs[0]?.x.toFixed(1)},${g.glyphs[0]?.y.toFixed(1)})`);
  console.log(`  glyphs ${runs.join(" ")}`);
}
