/**
 * E20: \closedcycle, trailing path operations, nodes on a plot path (pos),
 * error bars and symbolic coordinates (behaviour sections W and X).
 */
import { axisBody, runExperiment } from "./lib.js";
import { digest } from "./digest.js";

const C = "coordinates {(1,2) (2,3) (4,1)}";
const cases: Array<[string, string, string, string?]> = [
  ["closed-default", "", `\\addplot[fill=blue!20] ${C} \\closedcycle;`],
  ["closed-zero-inside", "ymin=-1", `\\addplot[fill=blue!20] ${C} \\closedcycle;`],
  ["closed-negative", "", "\\addplot[fill=blue!20] coordinates {(1,-2) (2,-3) (4,-1)} \\closedcycle;"],
  ["closed-stacked", "stack plots=y", `\\addplot[fill=blue!20] ${C} \\closedcycle;\n\\addplot[fill=red!20] coordinates {(1,1) (2,1) (4,2)} \\closedcycle;`],
  ["closed-area-style", "area style", `\\addplot+ ${C} \\closedcycle;`],
  ["trailing-cycle", "", `\\addplot[fill=green!20] ${C} -- (axis cs:4,0) -- (axis cs:1,0) -- cycle;`],
  ["fill-opacity", "", `\\addplot[fill=blue, fill opacity=0.3, draw=red] ${C} \\closedcycle;`],
  ["node-pos", "xmin=0,xmax=5,ymin=0,ymax=4", `\\addplot coordinates {(1,1) (2,3) (4,1)} node[pos=0.5,name=pa] {} node[pos=0.25,name=pb] {} node[pos=1,name=pc] {} coordinate[pos=0.75] (pd);`, "\\xpt{pa}\\xpt{pb}\\xpt{pc}\\xpt{pd}"],
  ["node-pos-text", "xmin=0,xmax=5,ymin=0,ymax=4", `\\addplot coordinates {(1,1) (2,3) (4,1)} node[pos=0.5,above] {A} node[pos=1,right] {B};`],
  ["err-explicit", "xmin=0,xmax=5,ymin=0,ymax=5", "\\addplot+[error bars/.cd, y dir=both, y explicit] coordinates {(1,2) +- (0,0.5) (2,3) +- (0,1) (3,1) += (0,0.5) -= (0,0.25)};"],
  ["err-x", "xmin=0,xmax=5,ymin=0,ymax=5", "\\addplot+[error bars/.cd, x dir=both, x explicit, y dir=plus, y fixed=0.4] coordinates {(1,2) +- (0.3,0) (2,3) +- (0.5,0)};"],
  ["err-table", "xmin=0,xmax=5,ymin=0,ymax=5", "\\addplot+[error bars/.cd, y dir=both, y explicit] table [x=a, y=b, y error=e] {\na b e\n1 2 0.5\n2 3 0.25\n};"],
  ["err-relative", "xmin=0,xmax=5,ymin=0,ymax=5", "\\addplot+[error bars/.cd, y dir=both, y fixed relative=0.1] coordinates {(1,2) (2,3)};"],
  ["err-explicit-relative", "xmin=0,xmax=5,ymin=0,ymax=5", "\\addplot+[error bars/.cd, y dir=both, y explicit relative] coordinates {(1,2) +- (0,0.5) (2,3) +- (0,0.1)};"],
  ["err-style", "xmin=0,xmax=5,ymin=0,ymax=5", "\\addplot+[error bars/.cd, y dir=both, y fixed=0.5, error bar style={red, thick}, error mark options={rotate=90, blue, mark size=3pt}] coordinates {(1,2) (2,3)};"],
  ["err-mark", "xmin=0,xmax=5,ymin=0,ymax=5", "\\addplot+[error bars/.cd, y dir=both, y fixed=0.5, error mark=*] coordinates {(1,2)};"],
  ["err-limits", "", "\\addplot+[error bars/.cd, y dir=both, y fixed=2] coordinates {(1,2) (2,3)};"],
  ["symbolic", "symbolic x coords={a,b,c}, xtick=data", "\\addplot coordinates {(a,2) (b,3) (c,1)};"],
  ["symbolic-bar", "ybar, symbolic x coords={low,mid,high}, xtick=data", "\\addplot coordinates {(low,2) (mid,3) (high,1)};\n\\addplot coordinates {(low,1) (mid,2) (high,2)};"],
  ["symbolic-y", "symbolic y coords={u,v,w}, ytick=data", "\\addplot coordinates {(1,u) (2,w) (3,v)};"],
  ["symbolic-partial", "symbolic x coords={a,b,c,d}", "\\addplot coordinates {(b,2) (d,3)};"],
];
const res = runExperiment("e20-area-errors", cases.map(([id, opt, plots, after]) => ({ id, meta: { opt }, body: axisBody(opt, plots).replace("\\end{tikzpicture}", `${after ?? ""}\\end{tikzpicture}`) })), { probes: process.env.E20_PROBES ? (process.env.E20_PROBES.split(",") as never) : ["limits", "map", "ticks"], trace: true });
for (const r of res) {
  const lines = digest(r, { max: 40 }).split("\n").filter((line) => !/DeviceGray\(0\.5\) lw0\.2|DeviceGray\(0\) lw0\.4 clip0  M[-0-9.]+,[-0-9.]+ L[-0-9.]+,[-0-9.]+ L[-0-9.]+,[-0-9.]+ L[-0-9.]+,[-0-9.]+ L[-0-9.]+,[-0-9.]+ Z$/u.test(line));
  const ticks = `xt ${(r.axis?.ticks?.x ?? []).map((t) => `${t.value}:${t.label?.text ?? ""}`).join(" ")} | yt ${(r.axis?.ticks?.y ?? []).map((t) => `${t.value}:${t.label?.text ?? ""}`).join(" ")}`;
  const pts = Object.entries(r.pts).map(([k, p]) => `${k}=(${p.x.toFixed(3)},${p.y.toFixed(3)})`).join(" ");
  const map = r.axis?.map ? `map o=(${r.axis.map.origin.x.toFixed(3)},${r.axis.map.origin.y.toFixed(3)}) u=(${r.axis.map.xUnit.x.toFixed(4)},${r.axis.map.yUnit.y.toFixed(4)})` : "";
  console.log(`== ${r.id}\n${ticks}\n${map} ${pts}\n${lines.join("\n")}`);
}
