/**
 * E06 default cycle list and \addplot option semantics as drawn (Tier 2).
 * Each plot i is a horizontal 2-point line at y=i; marks are found around (x=0, y=i).
 */
import { axisBody, runExperiment, saveText, subpaths } from "./lib.js";
import type { PathPrimitive } from "../schema.js";

const N = 14;
const plots = Array.from({ length: N }, (_, i) => `\\addplot coordinates {(0,${i}) (1,${i})};`).join("\n");
const cases = [
  { id: "cycle", body: axisBody(`xmin=-0.5,xmax=1.5,ymin=-1,ymax=${N},width=200pt,height=600pt,scale only axis`, plots) },
  { id: "variants", body: axisBody("xmin=-0.5,xmax=1.5,ymin=-1,ymax=6,scale only axis,width=200pt,height=300pt", [
    "\\addplot coordinates {(0,0) (1,0)};",
    "\\addplot+[red] coordinates {(0,1) (1,1)};",
    "\\addplot[red] coordinates {(0,2) (1,2)};",
    "\\addplot+[mark=none] coordinates {(0,3) (1,3)};",
    "\\addplot[mark=*] coordinates {(0,4) (1,4)};",
    "\\addplot coordinates {(0,5) (1,5)};",
  ].join("\n")) },
  { id: "plus", body: axisBody("xmin=-0.5,xmax=1.5,ymin=-1,ymax=6,scale only axis,width=200pt,height=300pt", [
    "\\addplot+[green] coordinates {(0,0) (1,0)};",
    "\\addplot+[thick,mark options={fill=yellow}] coordinates {(0,1) (1,1)};",
    "\\addplot+[only marks] coordinates {(0,2) (1,2)};",
    "\\addplot+[mark size=3pt] coordinates {(0,3) (1,3)};",
    "\\addplot+[draw=green] coordinates {(0,4) (1,4)};",
    "\\addplot+[color=green] coordinates {(0,5) (1,5)};",
  ].join("\n")) },
];
const res = runExperiment("e06-cycle", cases, { probes: ["limits", "map"] });
let text = "";
const f3 = (n: number) => (Math.round(n * 1000) / 1000).toString();
for (const r of res) {
  const map = r.axis!.map!;
  const nplots = r.id === "cycle" ? N : 6;
  text += `=== ${r.id}\n`;
  const paths = r.tier2.primitives.filter((p): p is PathPrimitive => p.type === "path");
  for (let i = 0; i < nplots; i += 1) {
    const cy = map.origin.y + i * map.yUnit.y; const cx = map.origin.x;
    const line = paths.find((p) => p.operation === "stroke" && p.clipDepth === 1 && subpaths(p).length === 1 && subpaths(p)[0]!.length === 2 && Math.abs(subpaths(p)[0]![0]!.y - cy) < 0.05);
    const marks = paths.filter((p) => p.clipDepth === 0 && p.segments.length > 0 && subpaths(p).some((sp) => sp.every((pt) => Math.abs(pt.x - cx) < 6 && Math.abs(pt.y - cy) < 6)));
    text += `plot ${i}: line ${line ? `${line.paint?.space}[${line.paint?.components.join(",")}] lw=${f3(line.lineWidth ?? 0)} dash=${JSON.stringify(line.dash ?? null)}` : "none"}\n`;
    for (const m of marks) {
      const segs = m.segments.map((s) => s.op === "Z" ? "Z" : s.op === "C" ? `C(${f3(s.x - cx)},${f3(s.y - cy)})` : `${s.op}(${f3(s.x - cx)},${f3(s.y - cy)})`).join(" ");
      text += `   mark ${m.operation} ${m.paint?.space}[${m.paint?.components.join(",")}] lw=${m.lineWidth ? f3(m.lineWidth) : ""} ${segs}\n`;
    }
  }
}
console.log(saveText("e06-cycle", "cycle.txt", text));
