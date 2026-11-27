/**
 * E02 size model: axis rectangle size vs width/height, scale only axis,
 * descriptions present or not, font size, x=/y= units, scale.
 * Usage: node --import tsx e02-size.mts [seed]   (seed changes the sweep values: fresh validation)
 */
import { axisBody, rectOf, runExperiment, saveTable } from "./lib.js";

const seed = Number(process.argv[2] ?? 0);
let s = seed * 7919 + 17;
const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
const PLOT = "\\addplot coordinates {(0,0) (1,1)};";
const cases: { id: string; body: string; meta: Record<string, unknown> }[] = [];
const decor = [
  { name: "none", opt: "" },
  { name: "labels", opt: "xlabel={An x label},ylabel={A y label},title={Title text}" },
  { name: "wideticks", opt: "xmin=0,xmax=1,ymin=100000.5,ymax=100001.5,yticklabel style={/pgf/number format/fixed}" },
  { name: "font", opt: "tick label style={font=\\Huge},label style={font=\\Huge},xlabel=X,ylabel=Y" },
  { name: "noticks", opt: "xtick=\\empty,ytick=\\empty" },
];
let n = 0;
for (let i = 0; i < 24; i += 1) {
  const w = seed === 0 ? 80 + i * 20 : Math.round((60 + rand() * 500) * 1000) / 1000;
  const h = seed === 0 ? 60 + i * 17 : Math.round((60 + rand() * 500) * 1000) / 1000;
  for (const soa of [false, true]) {
    for (const d of decor) {
      const opts = [`width=${w}pt`, `height=${h}pt`, soa ? "scale only axis" : "", d.name === "wideticks" ? "" : "xmin=0,xmax=1,ymin=0,ymax=1", d.opt].filter(Boolean).join(",");
      cases.push({ id: `s${n++}`, body: axisBody(opts, d.name === "wideticks" ? "\\addplot coordinates {(0,100000.6) (1,100001.4)};" : PLOT), meta: { w, h, soa, decor: d.name, mode: "wh" } });
    }
  }
}
// Only width / only height given (aspect ratio rule), units, scale.
for (let i = 0; i < 10; i += 1) {
  const v = seed === 0 ? 100 + i * 37 : Math.round((80 + rand() * 400) * 1000) / 1000;
  for (const soa of [false, true]) {
    cases.push({ id: `s${n++}`, body: axisBody(`width=${v}pt,${soa ? "scale only axis," : ""}xmin=0,xmax=1,ymin=0,ymax=1`, PLOT), meta: { w: v, soa, mode: "wonly" } });
    cases.push({ id: `s${n++}`, body: axisBody(`height=${v}pt,${soa ? "scale only axis," : ""}xmin=0,xmax=1,ymin=0,ymax=1`, PLOT), meta: { h: v, soa, mode: "honly" } });
  }
  const ux = seed === 0 ? 5 + i * 3 : Math.round((2 + rand() * 40) * 1000) / 1000;
  const uy = seed === 0 ? 4 + i * 2.5 : Math.round((2 + rand() * 40) * 1000) / 1000;
  cases.push({ id: `s${n++}`, body: axisBody(`x=${ux}pt,y=${uy}pt,xmin=0,xmax=5,ymin=-1,ymax=3`, PLOT), meta: { ux, uy, mode: "units" } });
  cases.push({ id: `s${n++}`, body: axisBody(`x=${ux}pt,xmin=0,xmax=5,ymin=-1,ymax=3`, PLOT), meta: { ux, mode: "xunit" } });
  const sc = seed === 0 ? 0.5 + i * 0.2 : Math.round((0.3 + rand() * 2) * 1000) / 1000;
  cases.push({ id: `s${n++}`, body: axisBody(`scale=${sc},xmin=0,xmax=1,ymin=0,ymax=1`, PLOT), meta: { scale: sc, mode: "scale" } });
  cases.push({ id: `s${n++}`, body: axisBody(`scale=${sc},scale only axis,width=150pt,height=100pt,xmin=0,xmax=1,ymin=0,ymax=1`, PLOT), meta: { scale: sc, mode: "scale-soa" } });
}
const res = runExperiment(`e02-size-seed${seed}`, cases, { probes: ["limits", "map", "axisAnchors", "pictureBox"] });
const rows = res.map((r) => ({ id: r.id, ...r.meta, ...rectOf(r.axis), xu: r.axis?.map?.xUnit.x, yu: r.axis?.map?.yUnit.y }));
console.log(saveTable(`e02-size-seed${seed}`, "rect.tsv", rows));
