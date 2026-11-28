/**
 * E24: settings inside the axis body (behaviour section AB). Which keys set
 * between `\addplot`s by `\pgfplotsset`, `\tikzset`, `\pgfkeys` or macro
 * definitions reach earlier plots, later plots, and the axis itself; and what
 * a TeX group or a `scope` around them changes. Prints a digest per case
 * (paths in data units, paints, glyphs). Set `E24_SET=b` for the fresh
 * validation set.
 */
import { lastFailures, runExperiment } from "./lib.js";
import { digest } from "./digest.js";
import { CASES, NAME } from "./e24-cases.js";

const res = runExperiment(NAME, CASES, { probes: ["limits", "map", "axisAnchors", "descriptions"] });
for (const r of res) {
  const anchors = r.axis?.anchors;
  const ne = anchors?.["outer north east"]; const sw = anchors?.["outer south west"];
  console.log(`== ${r.id}${ne && sw ? `  outer ${(ne.x - sw.x).toFixed(3)}x${(ne.y - sw.y).toFixed(3)}` : ""}\n${digest(r)}`);
}
for (const f of lastFailures) console.log(`!! ${f.id}: ${f.error}`);
