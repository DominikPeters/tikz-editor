/**
 * E25: the TikZ context of an axis (behaviour AC): picture options, an
 * enclosing scope, `every path`/`every mark`/`every node`, and `\addplot`
 * inside a scope in the axis body. Prints a digest per case: paths (paint,
 * width, dash, clip depth, data units) and glyph runs with font, size and
 * colour. E25_SET=a|b|s|t.
 */
import { lastFailures, runExperiment } from "./lib.js";
import { digest } from "./digest.js";
import { CASES, NAME } from "./e25-cases.js";

const r2 = (v: number) => Math.round(v * 100) / 100;
const res = runExperiment(NAME, CASES, { probes: ["limits", "map", "axisAnchors", "descriptions"] });
for (const r of res) {
  const runs: string[] = [];
  for (const p of r.tier2.primitives) {
    if (p.type !== "glyphs") continue;
    const colour = p.paint ? p.paint.components.map(r2).join(",") : "-";
    const tag = `${p.font.replace(/^.*\+/u, "")}@${r2(p.size)}[${colour}${p.paint && p.paint.alpha !== 1 ? ` a${r2(p.paint.alpha)}` : ""}]`;
    const text = p.glyphs.map((g) => g.unicode).join("");
    const last = runs[runs.length - 1];
    if (last?.endsWith(tag)) runs[runs.length - 1] = `${last.slice(0, -tag.length)}${text}${tag}`;
    else runs.push(`${text}${tag}`);
  }
  const lines = digest(r).split("\n").filter((l) => !/ glyphs /u.test(l));
  console.log(`== ${r.id}\n${lines.join("\n")}\n  text: ${runs.join(" ")}`);
}
for (const f of lastFailures) console.log(`!! ${f.id}: ${f.error}`);
