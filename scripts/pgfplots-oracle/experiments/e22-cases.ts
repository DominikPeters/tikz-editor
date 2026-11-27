/**
 * E22 axis equal and unit vector ratios (behaviour AA): random two-point data
 * rectangles under `axis equal`, `axis equal image`, `unit vector ratio`,
 * `unit vector ratio*`, `unit rescale keep size`, combined with
 * `enlargelimits`, explicit limits, `scale only axis`, width/height, `scale`
 * and log axes. Seed 0 (E22_SEED unset) is the discovery sweep; any other
 * seed is a fresh validation sweep. Checked with
 *   node --import tsx scripts/pgfplots-oracle/experiments/check-cases.mts ./e22-cases.ts
 * (`e22-axis-equal.mts` prints the raw limits and boxes).
 */
import { axisBody } from "./lib.js";

export const SEED = Number(process.env.E22_SEED ?? 0);
let state = (SEED * 2654435761 + 12345) >>> 0;
const rnd = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const round = (v: number, d = 2) => Number(v.toFixed(d));

const MODES = ["axis equal", "axis equal image", "unit vector ratio=2 1", "unit vector ratio*=2 1", "unit vector ratio=1 3",
  "unit vector ratio=1.5", "unit vector ratio=1 1,unit rescale keep size=false", "unit vector ratio=1 1,unit rescale keep size=true",
  "unit vector ratio=0.5 1,unit rescale keep size=unless limits declared"] as const;
const EXTRAS = ["", "", "enlargelimits=false", "scale only axis", "width=7cm", "height=5cm", "width=180pt,height=240pt", "xmin=-1", "ymax=12",
  "xmin=-1,xmax=9", "xmin=-1,xmax=9,ymin=0,ymax=3", "enlargelimits=0.3", "enlarge x limits=false", "scale=0.8"] as const;

export const CASES: Array<{ id: string; meta: Record<string, unknown>; body: string }> = [];
const n = SEED === 0 ? 160 : 140;
for (let i = 0; i < n; i++) {
  const x0 = round((rnd() - 0.5) * 10); const y0 = round((rnd() - 0.5) * 10);
  const dx = round(0.5 + rnd() * pick([2, 10, 40])); const dy = round(0.5 + rnd() * pick([2, 10, 40]));
  const mode = pick(MODES);
  const extra = pick(EXTRAS);
  const log = i % 17 === 5;
  const opts = [mode, extra, log ? "xmode=log,ymode=log" : ""].filter((s) => s !== "").join(",");
  const pts = log ? `(${round(1 + rnd() * 3)},${round(1 + rnd() * 3)}) (${round(10 + rnd() * 900)},${round(5 + rnd() * 90)})` : `(${x0},${y0}) (${round(x0 + dx)},${round(y0 + dy)})`;
  CASES.push({ id: `s${SEED}-${i}`, meta: { opts, pts }, body: axisBody(opts, `\\addplot coordinates {${pts}};`) });
}
export const NAME = `e22-axis-equal-${SEED}`;
