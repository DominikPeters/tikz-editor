/**
 * E19: bar plots (behaviour section U). Digest per case: limits, the bar
 * paths in data units, their paint (fill, stroke) and paint order.
 */
import { axisBody, runExperiment } from "./lib.js";
import { digest } from "./digest.js";

const C = "coordinates {(1,2) (2,3) (3,1)}";
const D = "coordinates {(1,1) (2,2) (3,4)}";
const cases: Array<[string, string, string]> = [
  ["ybar-axis", "ybar", `\\addplot ${C};`],
  ["ybar-plot", "", `\\addplot+[ybar] ${C};`],
  ["ybar-plot-noplus", "", `\\addplot[ybar] ${C};`],
  ["ybar-two", "ybar", `\\addplot ${C};\n\\addplot ${D};`],
  ["ybar-three-shift", "ybar=5pt", `\\addplot ${C};\n\\addplot ${D};\n\\addplot ${C};`],
  ["ybar-width-pt", "ybar, bar width=4pt", `\\addplot ${C};\n\\addplot ${D};`],
  ["ybar-width-unit", "ybar, bar width=0.3", `\\addplot ${C};`],
  ["ybar-shift-explicit", "", `\\addplot+[ybar, bar shift=3pt] ${C};`],
  ["ybar-ymin-positive", "ybar, ymin=0.5", `\\addplot ${C};`],
  ["ybar-negative", "ybar", "\\addplot coordinates {(1,2) (2,-1) (3,1)};"],
  ["ybar-limits-explicit", "ybar, xmin=0, xmax=4, ymin=0, ymax=5", `\\addplot ${C};`],
  ["xbar-axis", "xbar", "\\addplot coordinates {(2,1) (3,2) (1,3)};"],
  ["xbar-two", "xbar", "\\addplot coordinates {(2,1) (3,2) (1,3)};\n\\addplot coordinates {(1,1) (2,2) (4,3)};"],
  ["stacked", "ybar stacked", `\\addplot ${C};\n\\addplot ${D};`],
  ["stacked-negative", "ybar stacked", "\\addplot coordinates {(1,2) (2,-1) (3,1)};\n\\addplot coordinates {(1,1) (2,-2) (3,-3)};"],
  ["xbar-stacked", "xbar stacked", "\\addplot coordinates {(2,1) (3,2)};\n\\addplot coordinates {(1,1) (2,2)};"],
  ["ybar-interval", "ybar interval", "\\addplot coordinates {(0,2) (1,3) (3,1) (4,1)};"],
  ["ybar-interval-rel", "ybar interval=0.6", "\\addplot coordinates {(0,2) (1,3) (3,1) (4,1)};\n\\addplot coordinates {(0,1) (1,1) (3,2) (4,2)};"],
  ["ybar-interval-plot", "", "\\addplot+[ybar interval] coordinates {(0,2) (1,3) (3,1) (4,1)};"],
  ["ybar-fill-opts", "ybar", `\\addplot[fill=green, draw=black] ${C};`],
  ["ybar-mark", "", `\\addplot+[ybar, mark=*] ${C};`],
  ["ybar-clip-false", "ybar, clip=false, ymin=1.5", `\\addplot ${C};`],
  ["nodes-near", "ybar, nodes near coords", `\\addplot ${C};`],
  ["nodes-near-xbar", "xbar, nodes near coords", "\\addplot coordinates {(2,1) (3,2)};"],
  ["nodes-near-line", "nodes near coords", `\\addplot ${C};`],
  ["nodes-near-explicit", "nodes near coords, point meta=explicit symbolic", "\\addplot coordinates {(1,2) [a] (2,3) [bb]};"],
  ["nodes-near-align", "ybar, nodes near coords, nodes near coords align={horizontal}", `\\addplot ${C};`],
  ["nodes-near-every", "ybar, nodes near coords, every node near coord/.append style={red,font=\\tiny}", `\\addplot ${C};`],
];
const res = runExperiment("e19-bars", cases.map(([id, opt, plots]) => ({ id, meta: { opt }, body: axisBody(opt, plots) })), { probes: ["limits", "map", "ticks"], trace: true });
for (const r of res) {
  const lines = digest(r, { max: 30 }).split("\n").filter((line) => !/DeviceGray\(0\.5\) lw0\.2|DeviceGray\(0\) lw0\.4 clip0  M[-0-9.]+,[-0-9.]+ L[-0-9.]+,[-0-9.]+ L[-0-9.]+,[-0-9.]+ L[-0-9.]+,[-0-9.]+ L[-0-9.]+,[-0-9.]+ Z$/u.test(line));
  const ticks = `xt ${(r.axis?.ticks?.x ?? []).map((t) => t.value).join(" ")} | yt ${(r.axis?.ticks?.y ?? []).map((t) => t.value).join(" ")}`;
  console.log(`== ${r.id}\n${ticks}\n${lines.join("\n")}`);
}
