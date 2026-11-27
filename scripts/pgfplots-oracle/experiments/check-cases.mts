/**
 * Renders experiment cases with the editor and compares them with the
 * experiment's (cached) LuaLaTeX results through the harness comparison:
 * the validation step of an experiment (behaviour log, "VERIFIED").
 *   node --import tsx scripts/pgfplots-oracle/experiments/check-cases.mts <module> [id-prefix]
 * <module> exports `CASES: Array<{ id, body }>` and `NAME` (the experiment name).
 */
import { renderObservedPicture } from "../adapter.js";
import { compareTier1, compareTier2 } from "../compare.js";
import { runExperiment } from "./lib.js";

const modulePath = process.argv[2];
if (!modulePath) throw new Error("usage: check-cases.mts <module> [id-prefix]");
const mod = (await import(modulePath)) as { CASES: Array<{ id: string; body: string }>; NAME: string };
const only = process.argv[3];
const cases = mod.CASES.filter((c) => !only || c.id.startsWith(only));
const results = runExperiment(mod.NAME, cases, { quiet: true });
let worstLayout = 0; let worstPath = 0; let worstGlyph = 0; let failing = 0;
for (const r of results) {
  const body = cases.find((c) => c.id === r.id)?.body ?? "";
  const picture = await renderObservedPicture(body);
  const tier1 = compareTier1({ boundingBox: r.bbox, axes: r.axes }, picture.tier1, { tolerances: { colour: 0.002 } });
  const tier2 = compareTier2({ ...r.tier2, textBoxes: [] }, { ...picture.tier2, textBoxes: [] }, { tolerances: { colour: 0.002 } });
  const max = (s: Record<string, number>, keys: string[]) => Math.max(0, ...keys.map((k) => s[k] ?? 0));
  const l = max(tier1.stats.maxDelta, ["bbox", "rect", "map", "tick-label", "description"]);
  const pth = max(tier2.stats.maxDelta, ["path-straight", "path-curve"]);
  const g = max(tier2.stats.maxDelta, ["glyph"]);
  worstLayout = Math.max(worstLayout, l); worstPath = Math.max(worstPath, pth); worstGlyph = Math.max(worstGlyph, g);
  const codes = [...new Set([...tier1.findings, ...tier2.findings].map((f) => f.code))];
  if (codes.length > 0) failing += 1;
  console.log(`${r.id.padEnd(16)} T1 ${tier1.pass ? "pass" : "FAIL"} T2 ${tier2.pass ? "pass" : "FAIL"} layout ${l.toFixed(4)} path ${pth.toFixed(4)} glyph ${g.toFixed(4)} ${codes.join(",")}`);
  if (process.env.VERBOSE) for (const f of [...tier1.findings, ...tier2.findings].slice(0, Number(process.env.VERBOSE) > 1 ? Number(process.env.VERBOSE) : 8)) console.log(`    ${f.code} ${f.where} ${f.message}`);
  const diag = picture.diagnostics.filter((d) => d.severity !== "info").map((d) => d.code);
  if (diag.length > 0) console.log(`    diagnostics: ${diag.join(", ")}`);
}
console.log(`cases ${results.length}, failing ${failing}; worst layout ${worstLayout.toFixed(4)} pt, path ${worstPath.toFixed(4)} pt, glyph ${worstGlyph.toFixed(4)} pt`);
