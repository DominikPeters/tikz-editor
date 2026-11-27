/**
 * E17 legend geometry (behaviour L), discovery digest. The harness names the
 * legend matrix (`legend style={name=…-legend}`); TikZ names the matrix'
 * cell nodes `<matrix>-<row>-<column>`, read here with \xanchor after the
 * axis. Tier 2 gives the legend box, images and glyphs.
 *   node --import tsx scripts/pgfplots-oracle/experiments/e17-legend.mts [only-id-prefix]
 */
import { runExperiment, saveText } from "./lib.js";
import type { PathPrimitive } from "../schema.js";
import { LEGEND_CASES } from "./e17-cases.js";

const only = process.argv[2];
const after = (id: string) => {
  let s = "";
  for (let r = 1; r <= 4; r += 1) for (let c = 1; c <= 8; c += 1) for (const an of ["center", "north east", "south west", "base"]) s += `\\xanchor{pgfplotsoracle-${id}-a1-legend-${r}-${c}}{${an}}`;
  return s;
};
const cases = LEGEND_CASES.filter(([id]) => !only || id.startsWith(only)).map(([id, opt, plots]) => ({ id, meta: { opt }, body: `\\begin{tikzpicture}\\begin{axis}[${opt}]\n${plots}\n\\end{axis}${after(id)}\\end{tikzpicture}` }));
const res = runExperiment("e17-legend", cases, {});
const f = (v: number) => (Math.round(v * 10000) / 10000).toString();
let text = "";
for (const r of res) {
  text += `=== ${r.id}  [${r.meta.opt as string}]\n`;
  const lg = r.axis?.descriptions?.legend;
  if (lg) text += `legend: ${["south west", "north east", "center", "base"].map((a) => `${a}=(${f(lg.anchors[a]!.x)},${f(lg.anchors[a]!.y)})`).join(" ")} text="${lg.text ?? ""}"\n`;
  text += `rect: ${r.axis?.rect ? `${f(r.axis.rect.r00.x)},${f(r.axis.rect.r00.y)} ${f(r.axis.rect.r11.x)},${f(r.axis.rect.r11.y)}` : "-"}  bbox ${r.bbox ? `${f(r.bbox.minX)},${f(r.bbox.minY)} ${f(r.bbox.maxX)},${f(r.bbox.maxY)}` : ""}\n`;
  const cells = new Map<string, Record<string, { x: number; y: number }>>();
  for (const [k, p] of Object.entries(r.pts)) {
    const m = /legend-(\d+)-(\d+)\|(.*)$/u.exec(k);
    if (!m) continue;
    const key = `${m[1]}-${m[2]}`;
    if (!cells.has(key)) cells.set(key, {});
    cells.get(key)![m[3]!] = p;
  }
  for (const [k, a] of [...cells].sort()) text += `  cell ${k}: c=(${f(a.center!.x)},${f(a.center!.y)}) sw=(${f(a["south west"]!.x)},${f(a["south west"]!.y)}) ne=(${f(a["north east"]!.x)},${f(a["north east"]!.y)}) base=${f(a.base!.y)}\n`;
  const prims = r.tier2.primitives;
  // Everything after the last glyph of the axis descriptions / plot marks: print all primitives with order.
  for (const p of prims) {
    if (p.type === "path") {
      const q = p as PathPrimitive;
      if (q.clipDepth > 0) continue;
      const segs = q.segments.map((s) => (s.op === "Z" ? "Z" : s.op === "C" ? `C(${f(s.x)},${f(s.y)})` : `${s.op}(${f(s.x)},${f(s.y)})`)).join(" ");
      if (segs.length > 400) continue;
      text += `  #${q.order} ${q.operation} ${q.paint ? `${q.paint.space}[${q.paint.components.map(f).join(",")}]` : ""} lw=${q.lineWidth ?? ""} dash=${q.dash ? q.dash.array.join("/") : ""} ${segs}\n`;
    } else if (p.type === "glyphs") {
      text += `  #${p.order} glyphs ${p.font} ${f(p.size)} "${p.text}" @(${f(p.glyphs[0]!.x)},${f(p.glyphs[0]!.y)}) [${p.paint.components.map(f).join(",")}]\n`;
    }
  }
}
console.log(saveText("e17-legend", `digest${only ? `-${only}` : ""}.txt`, text));
