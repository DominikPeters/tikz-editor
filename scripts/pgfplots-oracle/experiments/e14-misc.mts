/**
 * E14 corner cases: label placement without tick labels, the empty axis,
 * tick-scale label interaction with xlabel. Prints a digest.
 */
import { runExperiment, saveTable, tickValues, tickLabels, rectOf } from "./lib.js";

const P = "\\addplot coordinates {(0,0) (1,1)};";
const variants: [string, string, string][] = [
  ["xlabel-noticks", "xlabel=X,ylabel=Y,xtick=\\empty,ytick=\\empty", P],
  ["xlabel-noticks-outside", "xlabel=X,ylabel=Y,xtick=\\empty,ytick=\\empty,tick align=outside", P],
  ["xlabel-emptylabels", "xlabel=X,ylabel=Y,xticklabels={},yticklabels={}", P],
  ["xlabel-scaled", "xlabel=X,ylabel=Y,xmin=0,xmax=20000,ymin=0,ymax=0.001", "\\addplot coordinates {(0,0) (20000,0.001)};"],
  ["empty", "xlabel=X", ""],
  ["empty-limits", "xmin=2,xmax=4,ymin=-1,ymax=1", ""],
  ["title-topticks-labels", "title=T,xticklabel pos=right", P],
  ["label-shift", "xlabel=X,ylabel=Y,label shift=7pt", P],
];
const cases = variants.map(([id, opt, plots]) => ({ id, meta: { opt }, body: `\\begin{tikzpicture}\\begin{axis}[${opt}]\n${plots}\n\\end{axis}\\end{tikzpicture}` }));
const after = ["x", "y"].map((l) => ["north"].map((an) => `\\xanchor{pgfplotsoracle-ID-a1-${l}S}{${an}}`).join("")).join("");
for (const c of cases) c.body = c.body.replace("\\end{tikzpicture}", `${after.replaceAll("ID", c.id)}\\end{tikzpicture}`);
const res = runExperiment("e14-misc", cases, {});
const f = (v: number | undefined) => (v === undefined ? "-" : Number(v.toFixed(4)));
const rows = res.map((r) => {
  const a = r.axis; const d = a?.descriptions ?? {};
  return {
    id: r.id, opt: r.meta.opt, limits: JSON.stringify(a?.limitsRaw ?? null), rect: JSON.stringify(rectOf(a)),
    xt: tickValues(a, "x").join(" "), xl: tickLabels(a, "x").join(" "), yt: tickValues(a, "y").join(" "),
    xlabelN: d.xlabel ? `${f(d.xlabel.anchors.north!.x)},${f(d.xlabel.anchors.north!.y)}` : "",
    ylabelS: d.ylabel ? `${f(d.ylabel.anchors.south!.x)},${f(d.ylabel.anchors.south!.y)}` : "",
    titleS: d.title ? `${f(d.title.anchors.south!.x)},${f(d.title.anchors.south!.y)}` : "",
    xtickTop: a?.ticks?.x[0]?.label ? `${f(a.ticks.x[0].label.anchors.south!.y)} north ${f(a.ticks.x[0].label.anchors.north!.y)}` : "",
    bbox: r.bbox ? `${f(r.bbox.minX)},${f(r.bbox.minY)} ${f(r.bbox.maxX)},${f(r.bbox.maxY)}` : "",
    glyphs: r.tier2.primitives.filter((p) => p.type === "glyphs").length,
    xS: (() => { const p = r.pts[`pgfplotsoracle-${r.id}-a1-xS|north`]; return p ? `${f(p.x)},${f(p.y)}` : ""; })(),
  };
});
for (const r of rows) console.log(Object.entries(r).map(([k, v]) => `${k}=${v}`).join("  "));
console.log(saveTable("e14-misc", "misc.tsv", rows));
