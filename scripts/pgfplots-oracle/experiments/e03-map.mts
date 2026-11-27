/**
 * E03 data-to-canvas map exactness: where do `axis cs` points land compared
 * with the ideal affine map X = W (x - xmin)/(xmax - xmin), W = 240-45 pt,
 * for explicit limits over many magnitudes. Usage: e03-map.mts [seed]
 */
import { runExperiment, saveTable } from "./lib.js";

const seed = Number(process.argv[2] ?? 0);
/** Optional axis-box size in pt (scale only axis), argv[3]; default: the 240x207 default axis. */
const SIZE = process.argv[3] ? Number(process.argv[3]) : 0;
const W = SIZE || 195; const H = SIZE || 162;
const sizeOpt = SIZE ? `,scale only axis,width=${SIZE}pt,height=${SIZE}pt` : "";
let s = seed * 7919 + 3;
const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
const ranges: [number, number][] = seed === 0
  ? [[0, 1], [-3.7, 12.9], [1e-4, 3e-4], [1000, 1001], [1e5, 1.0001e5], [-1e6, 1e6], [0, 1e-6], [0, 16000], [-0.5, 0.5], [3, 7], [0, 1e9], [12345.678, 12399.1]]
  : Array.from({ length: 14 }, () => {
    const mag = 10 ** Math.floor(-6 + rand() * 14);
    const a = (rand() - 0.5) * 20 * mag * (rand() < 0.5 ? 1 : 100);
    return [Number(a.toPrecision(6)), Number((a + mag * (0.5 + rand() * 9)).toPrecision(6))] as [number, number];
  });
const fr = [0, 0.1, 0.25, 1 / 3, 0.5, 0.7, 0.9, 1];
const cases = ranges.map(([a, b], i) => {
  const pts = fr.map((f, k) => {
    const x = a + f * (b - a); const y = a + (1 - f) * (b - a);
    return { k, x: Number(x.toPrecision(12)), y: Number(y.toPrecision(12)) };
  });
  const id = `m${i}`;
  const body = `\\begin{tikzpicture}
\\begin{axis}[xmin=${a},xmax=${b},ymin=${a},ymax=${b}${sizeOpt}]
\\addplot coordinates {(${a},${a}) (${b},${b})};
${pts.map((p) => `\\coordinate (${id}p${p.k}) at (axis cs:${p.x},${p.y});`).join("\n")}
\\end{axis}
${pts.map((p) => `\\xpt{${id}p${p.k}}`).join("")}
\\end{tikzpicture}`;
  return { id, body, meta: { a, b, pts } };
});
const res = runExperiment(`e03-map-seed${seed}${SIZE ? `-size${SIZE}` : ""}`, cases, { probes: ["limits", "map"] });
const rows: Record<string, unknown>[] = [];
let worst = 0;
for (const r of res) {
  const { a, b, pts } = r.meta as { a: number; b: number; pts: { k: number; x: number; y: number }[] };
  for (const p of pts) {
    const got = r.pts[`${r.id}p${p.k}`];
    if (!got) continue;
    const ex = (W * (p.x - a)) / (b - a); const ey = (H * (p.y - a)) / (b - a);
    const dx = got.x - ex; const dy = got.y - ey;
    worst = Math.max(worst, Math.abs(dx), Math.abs(dy));
    rows.push({ id: r.id, a, b, x: p.x, y: p.y, X: got.x, Y: got.y, dx, dy, limits: JSON.stringify(r.axis?.limitsRaw) });
  }
}
console.log(saveTable(`e03-map-seed${seed}${SIZE ? `-size${SIZE}` : ""}`, "map.tsv", rows));
const byCase = new Map<string, number>();
for (const row of rows) byCase.set(`${row.a}..${row.b}`, Math.max(byCase.get(`${row.a}..${row.b}`) ?? 0, Math.abs(row.dx as number), Math.abs(row.dy as number)));
for (const [k, v] of byCase) console.log(`${k.padEnd(28)} max |d| = ${v.toFixed(5)} pt`);
console.log(`worst ${worst.toFixed(5)} pt`);
