// Renders every pgfplots oracle fixture with the editor and compares the
// result with its saved LuaLaTeX oracle (scripts/pgfplots-oracle/README.md)
// through the harness comparison, at the design tolerances.
//
// Tolerances: the harness defaults (0.02pt layout, glyphs and curves; 1e-6
// of the range for tick values; exact discrete outputs), except
// - colour 0.002: the editor stores colours as 8-bit hex, so a component is
//   off by up to half a step (1/510 = 0.00196; e.g. brown!60!black's 0.3
//   becomes 77/255). The oracle side is exact; 1e-3 would test the colour
//   model's resolution, not the renderer.
// - the four `… of origin` axis anchors: 0.05pt, oracle noise (compare.ts,
//   `originProjectionPt`; behaviour A7).
//
// Each fixture lists the finding codes it is known to produce, with the
// cause. A new code fails the test; a listed code that no longer occurs
// fails too, so the list cannot go stale.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { renderObservedPicture, type AdaptedPicture } from "../scripts/pgfplots-oracle/adapter.js";
import { compareTier1, compareTier2, type CompareResult } from "../scripts/pgfplots-oracle/compare.js";
import { parsePgfplotsOracle } from "../scripts/pgfplots-oracle/schema.js";

const dir = join(__dirname, "fixtures", "pgfplots");
const names = readdirSync(dir).filter((f) => f.endsWith(".tex")).map((f) => f.slice(0, -4)).sort();

const TOLERANCES = { colour: 0.002 };

const OVERLAP_LABELS = "ticks past the limits of a ratio-shortened direction (behaviour AA2) have overlapping labels; the harness gives each text box glyphs of its neighbours (positions and glyphs match)";
const ERROR_MARK_BOX = "pgfplots places each error mark in an empty, rotated zero-width TeX box (\\pgfsys@hbox); the editor draws the mark as a path, with no box";
const SYMBOLIC_TICK_PROBE = "symbolic x coords set their own xticklabel, which replaces the harness' tick probe (README: lost probes); labels are checked in Tier 2";
const CANVAS_PROBES = "the picture's TikZ transformation reaches the axis as a canvas transformation (behaviour Z1); the harness' Tier 1 node probes are read in the axis' untransformed frame (node anchors do not include a low-level canvas transformation), so Tier 1 positions and the texts found in their quads are not comparable; Tier 2 (painted output) is";
const KNOWN: Record<string, { tier1?: Record<string, string>; tier2?: Record<string, string> }> = {
  "axis-lines-reverse": { tier1: { "axis-anchor": "`right of origin` is 0.0504pt off the box edge in the oracle (behaviour A7a projection noise, as function-trig-rad)" } },
  "legend-empty-entry": { tier2: { "textbox-missing": "an empty node text paints nothing; TeX still typesets an empty box (seen by the text-box walk), the editor emits no text element for it" } },
  "picture-scale": { tier1: Object.fromEntries(["rect", "map", "tick-label", "tick-label-text", "description", "description-text", "legend-entry"].map((code) => [code, CANVAS_PROBES])) },
  "picture-xscale-rotate": {
    tier1: Object.fromEntries(["rect", "map", "tick-label", "tick-label-text", "description", "description-text"].map((code) => [code, CANVAS_PROBES])),
    tier2: { "textbox-text": "rotated canvas: the harness assigns the ylabel glyph to the axis' nesting-0 box instead of the label box (glyph-to-box assignment uses axis-aligned probes)" }
  },
  "axis-equal-image-short": {
    tier1: { "tick-label-text": OVERLAP_LABELS },
    tier2: { "textbox-text": OVERLAP_LABELS }
  },
  "errorbars-explicit": { tier2: { "textbox-missing": ERROR_MARK_BOX } },
  "errorbars-style": { tier2: { "textbox-missing": ERROR_MARK_BOX } },
  "context-every-path": { tier2: { "textbox-missing": ERROR_MARK_BOX } },
  "symbolic-coords": { tier1: { "tick-count": SYMBOLIC_TICK_PROBE } },
  "symbolic-partial": { tier1: { "tick-count": SYMBOLIC_TICK_PROBE } },
  "function-large": {
    tier1: { map: "the oracle's axis cs probe at |y| ~ 3e6 reads points up to 7.7pt off its own rel axis cs rectangle (TeX fixed point, behaviour N2/K5); the plotted curves match in Tier 2" }
  },
  "function-trig-rad": {
    tier1: { "axis-anchor": "`right of origin` is 0.054pt off the box edge in the oracle (behaviour A7a: projection noise, 0.042pt on the first 28 fixtures; the y part, 0.02pt, is the limit noise N2)" }
  },
  ...Object.fromEntries(["scaled-ticks-base10", "scaled-ticks-one-axis"].map((name) => [name, {
    tier1: { map: "the oracle's axis cs probe at |x| ~ 1e4 is 0.2pt off its own rectangle (TeX fixed point, behaviour N2/K5); plot geometry matches in Tier 2" }
  }])),
  "scaled-ticks": {
    tier1: { map: "the oracle's axis cs probe at |y| ~ 1e4 is 0.16pt off its own rectangle (TeX fixed point, behaviour N2); plot geometry matches in Tier 2" }
  },
  "log-basis-two": {
    tier1: Object.fromEntries(["bbox", "limits", "map", "axis-anchor"].map((code) => [code, "TeX stores log2(64) as 6.00073 (fixed-point ln of the basis), 0.024pt at the box edge; not emulated (behaviour Q1)"]))
  },
  "log-small-range": {
    tier1: { "axis-anchor": "the origin anchor (data 1) lies 97pt outside the box; TeX's stored xmin ln 2 = 0.69305 (exact 0.693147) moves its extrapolation by 0.021pt (behaviour Q5)" }
  }
};

type Row = { name: string; tier1: CompareResult; tier2: CompareResult; picture: AdaptedPicture };
const rows: Row[] = [];

function codes(result: CompareResult): string[] {
  return [...new Set(result.findings.map((f) => f.code))].sort();
}

function maxError(result: CompareResult, keys: readonly string[]): number {
  return Math.max(0, ...keys.map((k) => result.stats.maxDelta[k] ?? 0));
}

describe("pgfplots: editor vs LuaLaTeX oracle", () => {
  it.each(names)("%s", async (name) => {
    const oracle = parsePgfplotsOracle(JSON.parse(readFileSync(join(dir, `${name}.oracle.json`), "utf8")));
    const picture = await renderObservedPicture(readFileSync(join(dir, `${name}.tex`), "utf8"));
    const tier1 = compareTier1(oracle.tier1, picture.tier1, { tolerances: TOLERANCES });
    const tier2 = compareTier2(oracle.tier2, picture.tier2, { tolerances: TOLERANCES });
    rows.push({ name, tier1, tier2, picture });
    const known = KNOWN[name] ?? {};
    expect(codes(tier1), JSON.stringify(tier1.findings.slice(0, 5), null, 1)).toEqual(Object.keys(known.tier1 ?? {}).sort());
    expect(codes(tier2), JSON.stringify(tier2.findings.slice(0, 5), null, 1)).toEqual(Object.keys(known.tier2 ?? {}).sort());
    expect(picture.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  }, 60_000);

  it("writes the result table to artifacts/pgfplots-oracle/compare.tsv", () => {
    const out = join(__dirname, "..", "artifacts", "pgfplots-oracle");
    mkdirSync(out, { recursive: true });
    const lines = ["fixture\ttier1\tt1-max-layout-pt\ttier2\tt2-max-path-pt\tt2-max-glyph-pt\tunmatched-expected\tunmatched-observed\tcodes"];
    for (const row of [...rows].sort((a, b) => a.name.localeCompare(b.name))) {
      const missing = row.tier2.findings.filter((f) => f.code.endsWith("-missing")).length;
      const extra = row.tier2.findings.filter((f) => f.code.endsWith("-extra")).length;
      lines.push([
        row.name, row.tier1.pass ? "pass" : "fail",
        maxError(row.tier1, ["bbox", "rect", "map", "axis-anchor", "tick-label", "description", "limits"]).toFixed(4),
        row.tier2.pass ? "pass" : "fail",
        maxError(row.tier2, ["path-straight", "path-curve"]).toFixed(4),
        maxError(row.tier2, ["glyph", "textbox"]).toFixed(4),
        String(missing), String(extra), [...codes(row.tier1), ...codes(row.tier2)].join(",")
      ].join("\t"));
    }
    writeFileSync(join(out, "compare.tsv"), `${lines.join("\n")}\n`);
    expect(rows.length).toBe(names.length);
  });
});
