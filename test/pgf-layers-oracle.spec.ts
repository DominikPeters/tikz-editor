/**
 * The editor's scene against pdfTeX for PGF layers and environments: every
 * primitive painted, in paint order, as `mutool trace` reads the PDF
 * (scripts/capture-pgf-layer-oracles.mts writes the oracles). The point is
 * paint order, which is what layers change; geometry, paint, line width,
 * dash and clipping are compared too.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderObservedSource } from "../scripts/pgfplots-oracle/adapter.js";
import { compareTier2 } from "../scripts/pgfplots-oracle/compare.js";
import { PGF_LAYER_FIXTURE_DIR, sourceSha256, type PgfLayerOracle } from "../scripts/pgf-layers-oracle.js";

/**
 * Tolerances: colours to 0.005 (the editor keeps 8-bit colours: TeX's
 * `orange` is 1 .5 0, ours 1 .502 0); positions to 0.2pt, because node boxes
 * of the editor's text engine are up to 0.17pt narrower than TeX's
 * (background-behind-nodes), which is not what this check is about.
 */
const TOLERANCES = { colour: 0.005, layoutPt: 0.2, glyphPt: 0.2, curvePt: 0.2 };

/** Known differences, by fixture: `code where`, with the reason. */
const KNOWN: Record<string, Record<string, string>> = {
  // A bare `\fill` on the layer under a coloured scope: TeX fills black (the
  // scope's colour is PDF state the layer does not see), the editor uses the
  // scope's colour, which it cannot tell from the text colour that does carry in.
  "on-background-layer": { "paint fill#1.0": "fill colour from the scope's text colour" },
  // TeX's undeclared-layer error unbalances the groups and nothing is painted;
  // the editor reports the error and draws the content where it stands.
  undeclared: {
    "path-extra stroke#0.0": "TeX error",
    "path-extra stroke#1.0": "TeX error",
    "path-extra stroke#2.0": "TeX error"
  }
};

const fixtures = readdirSync(PGF_LAYER_FIXTURE_DIR).filter((file) => file.endsWith(".oracle.json")).map((file) => file.slice(0, -".oracle.json".length)).sort();

describe("PGF layers against pdfTeX (mutool trace)", () => {
  it("has the oracles", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
  });

  for (const name of fixtures) {
    it(`${name}: paints the same primitives in the same order`, async () => {
      const source = readFileSync(join(PGF_LAYER_FIXTURE_DIR, `${name}.tex`), "utf8");
      const oracle = JSON.parse(readFileSync(join(PGF_LAYER_FIXTURE_DIR, `${name}.oracle.json`), "utf8")) as PgfLayerOracle;
      expect(oracle.sourceSha256, `stale oracle for ${name}: run npx tsx scripts/capture-pgf-layer-oracles.mts --only ${name}`).toBe(sourceSha256(source));
      const observed = await renderObservedSource(source);
      const result = compareTier2(oracle.tier2, observed.tier2, { tolerances: TOLERANCES, textBoxes: false, fontNames: false });
      const known = KNOWN[name] ?? {};
      const unexpected = result.findings.filter((finding) => !(`${finding.code} ${finding.where}` in known)).map((finding) => `${finding.code} ${finding.where}: ${finding.message}`);
      expect(unexpected).toEqual([]);
      expect(result.findings.filter((finding) => finding.code === "paint-order")).toEqual([]);
      // Every known difference still occurs: a fix should remove it from the list.
      for (const key of Object.keys(known)) {
        expect(result.findings.map((finding) => `${finding.code} ${finding.where}`), `known difference ${key} no longer occurs`).toContain(key);
      }
    }, 60_000);
  }
});
