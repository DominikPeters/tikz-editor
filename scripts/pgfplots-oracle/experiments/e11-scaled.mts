/**
 * E11 scaled ticks and tick label strings. Default settings (scaled ticks=true),
 * limits [lo, lo + r] on x and y over many magnitudes. Records, per axis: the
 * tick label strings, the true tick positions (label anchor -> data via map),
 * the \tick value the label code receives, and the tick-scale label node
 * (named ...-xS / -yS through the lib's \ticknum fallback) with its text.
 * Usage: e11-scaled.mts <sweep> [seed]   sweep = decades | random
 */
import { runExperiment, saveTable } from "./lib.js";
import type { GlyphRun } from "../schema.js";

const sweep = process.argv[2] ?? "decades";
const seed = Number(process.argv[3] ?? 0);
let s = seed * 7919 + 13;
const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
const sig = (v: number, n = 6) => Number(v.toPrecision(n));
const specs: { lo: number; hi: number; ylo: number; yhi: number }[] = [];
if (sweep === "decades") {
  for (let i = 0; i <= 140; i += 1) { const u = -7 + i * 0.1; const r = sig(10 ** u); specs.push({ lo: 0, hi: r, ylo: sig(-r), yhi: sig(r * 2.3) }); }
  for (const a of [1e3, 1e4, 1e5, 1e6, 99999, -50000, 0.5, 1.5e-3]) for (const r of [1, 10, 100, 0.01, 1000]) specs.push({ lo: a, hi: sig(a + r, 10), ylo: sig(-a), yhi: sig(-a + r * 3, 10) });
} else {
  for (let i = 0; i < 200; i += 1) {
    const mag = 10 ** Math.floor(-7 + rand() * 15); const r = sig(mag * (0.5 + rand() * 9.5));
    const lo = sig((rand() - 0.5) * 4 * r * (rand() < 0.3 ? 30 : 1), 5);
    const yr = sig(10 ** Math.floor(-7 + rand() * 15) * (0.5 + rand() * 9.5)); const ylo = sig((rand() - 0.5) * 4 * yr, 5);
    specs.push({ lo, hi: sig(lo + r, 10), ylo, yhi: sig(ylo + yr, 10) });
  }
}
const cases = specs.map((sp, i) => {
  const id = `s${i}`;
  return {
    id, meta: { ...sp },
    body: `\\begin{tikzpicture}\\begin{axis}[xmin=${sp.lo},xmax=${sp.hi},ymin=${sp.ylo},ymax=${sp.yhi}]
\\addplot coordinates {(${sp.lo},${sp.ylo}) (${sp.hi},${sp.yhi})};
\\end{axis}
${["x", "y"].map((l) => ["center", "north", "south", "east", "west", "north east", "south west", "base west"].map((a) => `\\xanchor{pgfplotsoracle-${id}-a1-${l}S}{${a}}`).join("")).join("\n")}
\\end{tikzpicture}`,
  };
});
const res = runExperiment(`e11-scaled-${sweep}-seed${seed}`, cases, { batchSize: 120 });
const rows = res.map((r) => {
  const a = r.axis!; const m = a.map!;
  const out: Record<string, unknown> = { id: r.id, ...r.meta };
  const glyphs = r.tier2.primitives.filter((p): p is GlyphRun => p.type === "glyphs").flatMap((g) => g.glyphs.map((x) => ({ ...x, size: g.size })));
  for (const l of ["x", "y"] as const) {
    const ts = a.ticks?.[l] ?? [];
    out[`${l}labels`] = ts.map((t) => t.label?.text ?? "?").join(" ");
    out[`${l}tick`] = ts.map((t) => t.valueRaw).join(" ");
    out[`${l}pos`] = ts.map((t) => {
      const an = t.label?.anchors; if (!an) return "?";
      const v = l === "x" ? (an.north!.x - m.origin.x) / m.xUnit.x : (an.east!.y - m.origin.y) / m.yUnit.y;
      return sig(v, 7);
    }).join(" ");
    const sw = r.pts[`pgfplotsoracle-${r.id}-a1-${l}S|south west`]; const ne = r.pts[`pgfplotsoracle-${r.id}-a1-${l}S|north east`];
    if (sw && ne) {
      const inside = glyphs.filter((g) => g.x >= sw.x - 0.1 && g.x <= ne.x + 0.1 && g.y >= sw.y - 0.1 && g.y <= ne.y + 0.1);
      out[`${l}scale`] = inside.map((g) => g.unicode).join("");
      for (const an of ["north east", "south west", "base west", "east", "west", "north", "south"]) {
        const p = r.pts[`pgfplotsoracle-${r.id}-a1-${l}S|${an}`]; if (p) out[`${l}S_${an.replace(" ", "_")}`] = `${sig(p.x - a.rect!.r00.x, 7)},${sig(p.y - a.rect!.r00.y, 7)}`;
      }
    } else out[`${l}scale`] = "";
    out.rectW = a.rect!.r10.x - a.rect!.r00.x; out.rectH = a.rect!.r01.y - a.rect!.r00.y;
  }
  return out;
});
console.log(saveTable(`e11-scaled-${sweep}-seed${seed}`, "scaled.tsv", rows));
