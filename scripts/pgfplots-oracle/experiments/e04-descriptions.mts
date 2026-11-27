/**
 * E04 tick-label and description placement (xlabel, ylabel, title) for
 * default boxed axes. Random combinations of tick label font, tick align,
 * major tick length, y range (label width), label texts and fonts.
 * Usage: e04-descriptions.mts [seed] [count]
 */
import { axisBody, runExperiment, saveTable } from "./lib.js";

const seed = Number(process.argv[2] ?? 0);
const count = Number(process.argv[3] ?? 160);
let s = seed * 7919 + 11;
const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const fonts = ["", "\\tiny", "\\scriptsize", "\\small", "\\large", "\\Huge"];
const aligns = ["", "inside", "outside", "center"];
const lens = ["", "5pt", "10pt", "0pt", "2.5pt"];
const yr = [[0, 1], [0, 1000], [-50000, 50000], [0.001, 0.002], [-3, 3], [10, 20]];
const xr = [[0, 1], [-1000, 1000], [0, 7], [100, 200]];
const xlabels = ["", "x", "Long label gy", "$\\int_0^1 f$", "\\Large Big"];
const ylabels = ["", "y", "A y label gy", "$\\sum_{i}^{N} a_i$"];
const titles = ["", "T", "A title gy", "\\Large Big title"];
const cases = [];
for (let i = 0; i < count; i += 1) {
  const f = pick(fonts); const al = pick(aligns); const len = pick(lens); const [y0, y1] = pick(yr); const [x0, x1] = pick(xr);
  const xl = pick(xlabels); const yl = pick(ylabels); const tt = pick(titles); const lf = pick(fonts);
  const soa = rand() < 0.3;
  const opts = [
    `xmin=${x0},xmax=${x1},ymin=${y0},ymax=${y1}`,
    f && `tick label style={font=${f}}`, al && `tick align=${al}`, len && `major tick length=${len}`,
    xl && `xlabel={${xl}}`, yl && `ylabel={${yl}}`, tt && `title={${tt}}`, lf && `label style={font=${lf}}`,
    soa ? "scale only axis,width=150pt,height=120pt" : "",
  ].filter(Boolean).join(",");
  cases.push({ id: `d${i}`, body: axisBody(opts, `\\addplot coordinates {(${x0},${y0}) (${x1},${y1})};`), meta: { f, al, len, y0, y1, x0, x1, xl, yl, tt, lf, soa } });
}
const res = runExperiment(`e04-desc-seed${seed}`, cases, {});
const rows = res.map((r) => {
  const a = r.axis!; const rect = a.rect!; const X0 = rect.r00.x; const Y0 = rect.r00.y; const X1 = rect.r10.x; const Y1 = rect.r01.y;
  const xt = a.ticks?.x ?? []; const yt = a.ticks?.y ?? [];
  const xs = xt.filter((t) => t.label); const ys = yt.filter((t) => t.label);
  const d = a.descriptions ?? {};
  const map = a.map!;
  // x tick label: north anchor relative to (tick X, Y0)
  const xoff = xs.map((t) => ({ dx: t.label!.anchors.north!.x - (map.origin.x + t.value * map.xUnit.x), dy: t.label!.anchors.north!.y - Y0 }));
  const yoff = ys.map((t) => ({ dx: t.label!.anchors.east!.x - X0, dy: t.label!.anchors.east!.y - (map.origin.y + t.value * map.yUnit.y) }));
  const minSouth = xs.length ? Math.min(...xs.map((t) => t.label!.anchors.south!.y)) : NaN;
  const minWest = ys.length ? Math.min(...ys.map((t) => t.label!.anchors.west!.x)) : NaN;
  const xlab = d.xlabel?.anchors; const ylab = d.ylabel?.anchors; const tit = d.title?.anchors;
  return {
    id: r.id, ...r.meta,
    nx: xs.length, ny: ys.length,
    xlab_dx: xoff.length ? Math.max(...xoff.map((o) => Math.abs(o.dx))) : "", xlab_dy: xoff[0]?.dy ?? "", xlab_dy_spread: xoff.length ? Math.max(...xoff.map((o) => o.dy)) - Math.min(...xoff.map((o) => o.dy)) : "",
    ylab_dx: yoff[0]?.dx ?? "", ylab_dy: yoff.length ? Math.max(...yoff.map((o) => Math.abs(o.dy))) : "",
    minSouthRel: minSouth - Y0, minWestRel: minWest - X0,
    xl_north_y: xlab ? xlab.north!.y - Y0 : "", xl_north_x: xlab ? xlab.north!.x - (X0 + X1) / 2 : "", xl_gap: xlab ? xlab.north!.y - minSouth : "",
    yl_south_x: ylab ? ylab.south!.x - X0 : "", yl_south_y: ylab ? ylab.south!.y - (Y0 + Y1) / 2 : "", yl_gap: ylab ? ylab.south!.x - minWest : "",
    yl_north_x: ylab ? ylab.north!.x - X0 : "",
    ti_south_y: tit ? tit.south!.y - Y1 : "", ti_south_x: tit ? tit.south!.x - (X0 + X1) / 2 : "",
  };
});
console.log(saveTable(`e04-desc-seed${seed}`, "desc.tsv", rows));
