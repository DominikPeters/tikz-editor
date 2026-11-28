/**
 * E24 follow-up: the colour of every glyph run of a case set (which text a
 * colour set by a TikZ key in the axis body reaches, behaviour AB3).
 *   E24_SET=e node --import tsx scripts/pgfplots-oracle/experiments/e24-glyph-colours.mts
 */
import { runExperiment } from "./lib.js";
import { CASES, NAME } from "./e24-cases.js";

const res = runExperiment(NAME, CASES, { probes: ["limits", "map", "axisAnchors", "descriptions"], quiet: true });
for (const r of res) {
  const runs: string[] = [];
  for (const p of r.tier2.primitives) {
    if (p.type !== "glyphs") continue;
    const paint = (p as { paint?: { components: number[] } }).paint;
    const colour = paint ? paint.components.map((v) => Math.round(v * 100) / 100).join(",") : "-";
    const text = p.glyphs.map((g) => g.unicode).join("");
    const last = runs[runs.length - 1];
    if (last?.endsWith(`[${colour}]`)) runs[runs.length - 1] = `${last.slice(0, -colour.length - 2)}${text}[${colour}]`;
    else runs.push(`${text}[${colour}]`);
  }
  console.log(`${r.id}: ${runs.join(" ")}`);
}
