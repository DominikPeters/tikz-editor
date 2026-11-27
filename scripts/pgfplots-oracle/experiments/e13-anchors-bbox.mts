/**
 * E13 axis position (at/anchor), current-axis anchors, and the picture bounding box.
 * For each case records rect, anchors, bbox and the union of the node boxes
 * (tick labels, descriptions; without outer sep) for comparison.
 */
import { runExperiment, saveTable } from "./lib.js";
import type { NodeGeometry } from "../schema.js";

const P = "\\addplot coordinates {(0,0) (1,1) (2,0.5)};";
const PM = "\\addplot+[mark size=6pt] coordinates {(0,0) (1,1) (2,0.5)};";
const variants: [string, string, string][] = [
  ["default", "", P],
  ["nomarks-inside", "", "\\addplot coordinates {(0.5,0.3) (1.5,0.7)};"],
  ["bigmarks-edge", "xmin=0,xmax=2,ymin=0,ymax=1", PM],
  ["bigmarks-clipfalse", "xmin=0,xmax=2,ymin=0,ymax=1,clip=false", PM],
  ["descr", "xlabel=X,ylabel=Y,title=Title", P],
  ["thick", "every axis/.append style={line width=3pt}", P],
  ["anchor-ne", "anchor=north east", P],
  ["at-anchor-center", "at={(10pt,20pt)},anchor=center", P],
  ["at-outer-ne", "at={(10pt,20pt)},anchor=outer north east,xlabel=X,title=T", P],
  ["at-outer-sw", "at={(10pt,20pt)},anchor=outer south west,ylabel=Y", P],
  ["anchor-origin", "anchor=origin,xmin=-1,xmax=2,ymin=-1,ymax=1", P],
  ["anchor-left-of-sw", "anchor=left of south west,ylabel=Y", P],
  ["tikz-outside", "", P + "\\draw (axis cs:3,3) -- (axis cs:4,4);"],
  ["node-outside", "clip=false", P + "\\node at (axis cs:4,0.5) {far};"],
];
const cases = variants.map(([id, opt, plots]) => ({ id, meta: { opt }, body: `\\begin{tikzpicture}\\begin{axis}[${opt}]\n${plots}\n\\end{axis}\\end{tikzpicture}` }));
const res = runExperiment("e13-anchors-bbox", cases, {});
const f = (v: number | undefined) => (v === undefined ? "" : Number(v.toFixed(4)));
const rows = res.map((r) => {
  const a = r.axis!; const rect = a.rect!; const A = a.anchors!;
  const nodes: NodeGeometry[] = [...Object.values(a.descriptions ?? {}), ...(a.ticks?.x ?? []).flatMap((t) => t.label ? [t.label] : []), ...(a.ticks?.y ?? []).flatMap((t) => t.label ? [t.label] : [])];
  // node box without outer sep: anchors include outer sep 0.2pt (0.5 * 0.4pt line width)
  const os = 0.2;
  const nb = nodes.map((n) => ({ minX: n.anchors["south west"]!.x + os, minY: n.anchors["south west"]!.y + os, maxX: n.anchors["north east"]!.x - os, maxY: n.anchors["north east"]!.y - os }));
  const lw = r.id === "thick" ? 3 : 0.4;
  const boxes = [...nb, { minX: rect.r00.x - lw / 2, minY: rect.r00.y - lw / 2, maxX: rect.r11.x + lw / 2, maxY: rect.r11.y + lw / 2 }];
  const u = { minX: Math.min(...boxes.map((b) => b.minX)), minY: Math.min(...boxes.map((b) => b.minY)), maxX: Math.max(...boxes.map((b) => b.maxX)), maxY: Math.max(...boxes.map((b) => b.maxY)) };
  return {
    id: r.id, ...r.meta,
    r00: `${f(rect.r00.x)},${f(rect.r00.y)}`, r11: `${f(rect.r11.x)},${f(rect.r11.y)}`,
    bbox: `${f(r.bbox?.minX)},${f(r.bbox?.minY)} ${f(r.bbox?.maxX)},${f(r.bbox?.maxY)}`,
    union: `${f(u.minX)},${f(u.minY)} ${f(u.maxX)},${f(u.maxY)}`,
    outerSW: `${f(A["outer south west"]?.x)},${f(A["outer south west"]?.y)}`, outerNE: `${f(A["outer north east"]?.x)},${f(A["outer north east"]?.y)}`,
    sw: `${f(A["south west"]?.x)},${f(A["south west"]?.y)}`, ne: `${f(A["north east"]?.x)},${f(A["north east"]?.y)}`,
    origin: `${f(A.origin?.x)},${f(A.origin?.y)}`, leftofsw: `${f(A["left of south west"]?.x)},${f(A["left of south west"]?.y)}`, belowsw: `${f(A["below south west"]?.x)},${f(A["below south west"]?.y)}`,
  };
});
for (const r of rows) console.log(Object.entries(r).map(([k, v]) => `${k}=${v}`).join("  "));
console.log(saveTable("e13-anchors-bbox", "anchors.tsv", rows));
