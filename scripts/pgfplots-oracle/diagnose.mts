/**
 * Prints the comparison findings of one or more fixtures (editor vs saved
 * oracle), grouped by code, for triage:
 *   node --import tsx scripts/pgfplots-oracle/diagnose.mts <fixture> [...]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderObservedPicture } from "./adapter.js";
import { compareTier1, compareTier2, type CompareResult } from "./compare.js";
import { FIXTURE_DIR } from "./fixtures.js";
import { parsePgfplotsOracle } from "./schema.js";

const TOLERANCES = { colour: 0.002 };
const show = (tier: string, result: CompareResult) => {
  const byCode = new Map<string, string[]>();
  for (const f of result.findings) byCode.set(f.code, [...(byCode.get(f.code) ?? []), `${f.where}: ${f.message}`]);
  for (const [code, items] of byCode) {
    console.log(`  ${tier} ${code} (${items.length})`);
    for (const item of items.slice(0, 6)) console.log(`     ${item}`);
  }
};
for (const name of process.argv.slice(2)) {
  const oracle = parsePgfplotsOracle(JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.oracle.json`), "utf8")));
  const picture = await renderObservedPicture(readFileSync(join(FIXTURE_DIR, `${name}.tex`), "utf8"));
  console.log(`=== ${name}`);
  for (const d of picture.diagnostics) console.log(`  diag ${d.severity} ${d.code ?? ""}: ${d.message.slice(0, 140)}`);
  show("T1", compareTier1(oracle.tier1, picture.tier1, { tolerances: TOLERANCES }));
  show("T2", compareTier2(oracle.tier2, picture.tier2, { tolerances: TOLERANCES }));
}
