/**
 * E05 Tier 2 structure of axis decorations: paint order, styles, tick marks,
 * grid lines, axis box, clip. Prints a readable digest per case.
 * Usage: e05-tier2.mts [filter]
 */
import { axisBody, runExperiment, saveText, subpaths } from "./lib.js";
import type { PathPrimitive } from "../schema.js";

const P = "\\addplot coordinates {(0,0) (1,2) (2,1)};";
const variants: [string, string, string?][] = [
  ["default", ""],
  ["grid-major", "grid=major"],
  ["grid-both", "grid=both,minor tick num=1"],
  ["minor1", "minor tick num=1"],
  ["outside", "tick align=outside"],
  ["center", "tick align=center"],
  ["tickpos-left", "tick pos=left"],
  ["tickpos-right", "xtick pos=right,ytick pos=right"],
  ["xticklabelpos-right", "xticklabel pos=right"],
  ["axis-on-top", "axis on top"],
  ["clip-false", "clip=false"],
  ["two-plots", "", "\\addplot coordinates {(0,1) (2,0)};\\draw (axis cs:0.5,0.5) -- (axis cs:1.5,1.5); \\node at (axis cs:1,1) {N};"],
  ["descr", "xlabel=X,ylabel=Y,title=T"],
  ["explicit-ticks", "xtick={0,0.5,2},ytick={0,1,2},minor xtick={0.25,1}"],
  ["noticks", "xtick=\\empty,ytick=\\empty"],
  ["linewidth", "every axis/.append style={thick}"],
];
const filter = process.argv[2];
const cases = variants.filter(([n]) => !filter || n.includes(filter)).map(([name, opt, extra]) => ({ id: name, body: axisBody(`xmin=0,xmax=2,ymin=0,ymax=2,${opt}`, P + (extra ?? "")), meta: { opt } }));
const res = runExperiment("e05-tier2", cases, {});
const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();
let text = "";
for (const r of res) {
  text += `\n=== ${r.id} [${(r.meta as { opt: string }).opt}]\n`;
  for (const p of r.tier2.primitives) {
    if (p.type === "path") {
      const q = p as PathPrimitive;
      const sp = subpaths(q);
      const lens = sp.map((pts) => pts.length > 1 ? fmt(Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y)) : "0");
      const desc = sp.length <= 12 ? sp.map((pts) => pts.map((pt) => `(${fmt(pt.x)},${fmt(pt.y)})`).join("")).join(" | ") : `${sp.length} subpaths; first: ${sp.slice(0, 3).map((pts) => pts.map((pt) => `(${fmt(pt.x)},${fmt(pt.y)})`).join("")).join(" | ")}; seglens ${[...new Set(lens)].join(",")}`;
      text += `${q.order} ${q.operation} ${q.paint ? `${q.paint.space}[${q.paint.components.join(",")}]` : ""} lw=${q.lineWidth ?? ""} cap=${q.lineCap ?? ""} join=${q.lineJoin ?? ""} dash=${q.dash ? JSON.stringify(q.dash) : ""} clip=${q.clipDepth} ${q.rect ? "RECT " : ""}${desc}\n`;
    } else if (p.type === "glyphs") {
      text += `${p.order} glyphs ${p.font} ${p.size} "${p.text}" at (${fmt(p.glyphs[0]?.x ?? 0)},${fmt(p.glyphs[0]?.y ?? 0)}) paint=${p.paint.components.join(",")} clip=${p.clipDepth}\n`;
    } else text += `${p.order} ${p.type}\n`;
  }
}
console.log(saveText("e05-tier2", `digest${filter ? `-${filter}` : ""}.txt`, text));
