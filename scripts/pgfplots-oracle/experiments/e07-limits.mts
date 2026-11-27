/**
 * E07 automatic limits and enlargelimits. Each case: data x-range [a,b]
 * (y = the same values mapped to [c,d]), plus an option set. Records final limits.
 * Usage: e07-limits.mts [seed]
 */
import { axisBody, runExperiment, saveTable } from "./lib.js";

const seed = Number(process.argv[2] ?? 0);
let s = seed * 7919 + 5;
const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const num = () => { const m = 10 ** Math.floor(-3 + rand() * 7); return Number(((rand() - 0.3) * 10 * m).toPrecision(4)); };
const optionSets = [
  "", "enlargelimits=false", "enlargelimits=true", "enlargelimits=0.2", "enlargelimits=upper", "enlargelimits=lower",
  "enlargelimits={abs=3}", "enlargelimits={abs=1cm}", "enlarge x limits=false", "enlargelimits={value=0.05,upper}",
  "enlarge y limits={rel=0.3}", "enlargelimits=0",
];
const cases = [];
let n = 0;
for (let i = 0; i < (seed === 0 ? 120 : 150); i += 1) {
  const a = num(); const span = Math.abs(num()) || 1; const b = Number((a + span).toPrecision(6));
  const c = num(); const dspan = Math.abs(num()) || 1; const d = Number((c + dspan).toPrecision(6));
  const opt = pick(optionSets);
  const pts = `(${a},${c}) (${Number(((a + b) / 2).toPrecision(6))},${d}) (${b},${Number(((c + d) / 2).toPrecision(6))})`;
  cases.push({ id: `l${n++}`, body: axisBody(opt, `\\addplot coordinates {${pts}};`), meta: { kind: "range", a, b, c, d, opt } });
}
// Degenerate and partial-limit cases (discovery only; listed explicitly).
const special: [string, string, string][] = [
  ["single-point", "", "\\addplot coordinates {(2,3)};"],
  ["single-point-zero", "", "\\addplot coordinates {(0,0)};"],
  ["single-point-big", "", "\\addplot coordinates {(1000,-0.02)};"],
  ["const-y", "", "\\addplot coordinates {(0,5) (1,5) (2,5)};"],
  ["const-y0", "", "\\addplot coordinates {(0,0) (1,0) (2,0)};"],
  ["const-x", "", "\\addplot coordinates {(3,0) (3,1)};"],
  ["empty", "", ""],
  ["empty-xmin", "xmin=2,xmax=4", ""],
  ["xmin-only", "xmin=0.5", "\\addplot coordinates {(0,0) (1,1) (2,4) (3,9)};"],
  ["xmax-only", "xmax=2.5", "\\addplot coordinates {(0,0) (1,1) (2,4) (3,9)};"],
  ["xlimits-clip-y", "xmin=0.5,xmax=2.5", "\\addplot coordinates {(0,0) (1,1) (2,4) (3,9)};"],
  ["ymin-only", "ymin=-1", "\\addplot coordinates {(0,0) (1,1) (2,4) (3,9)};"],
  ["expr-default", "", "\\addplot {x^2};"],
  ["expr-domain", "", "\\addplot[domain=0:1] {x};"],
  ["single-point-false", "enlargelimits=false", "\\addplot coordinates {(2,3)};"],
  ["const-y-false", "enlargelimits=false", "\\addplot coordinates {(0,5) (1,5) (2,5)};"],
  ["single-point-true", "enlargelimits=true", "\\addplot coordinates {(2,3)};"],
  ["single-point-0.3", "enlargelimits=0.3", "\\addplot coordinates {(2,3)};"],
  ["single-point-abs3", "enlargelimits={abs=3}", "\\addplot coordinates {(2,3)};"],
  ["single-point-upper", "enlargelimits=upper", "\\addplot coordinates {(2,3)};"],
  ["const-y-0.3", "enlargelimits=0.3", "\\addplot coordinates {(0,5) (1,5) (2,5)};"],
  ["single-point-neg", "", "\\addplot coordinates {(-4,-0.5)};"],
  ["two-plots", "", "\\addplot coordinates {(0,0) (1,1)}; \\addplot coordinates {(3,-2) (4,0)};"],
  ["draw-no-limits", "", "\\addplot coordinates {(0,0) (1,1)}; \\draw (axis cs:5,5) -- (axis cs:6,6);"],
  ["node-no-limits", "", "\\addplot coordinates {(0,0) (1,1)}; \\node at (axis cs:5,5) {n};"],
  ["xmin-ymin-max", "xmin=0,xmax=10,ymin=0,ymax=10", "\\addplot coordinates {(1,1) (2,2)};"],
  ["xmin-only-enl-true", "xmin=0.5,enlargelimits=true", "\\addplot coordinates {(0,0) (1,1) (2,4) (3,9)};"],
  ["min-gt-max", "xmin=3,xmax=1", "\\addplot coordinates {(0,0) (4,1)};"],
];
for (const [name, opt, plot] of special) cases.push({ id: `sp-${name}`, body: axisBody(opt, plot), meta: { kind: name, opt } });
const res = runExperiment(`e07-limits-seed${seed}`, cases, { probes: ["limits", "map"] });
const rows = res.map((r) => ({ id: r.id, ...r.meta, ...(r.axis?.limitsRaw ?? {}), W: r.axis?.rect ? r.axis.rect.r10.x - r.axis.rect.r00.x : "", H: r.axis?.rect ? r.axis.rect.r01.y - r.axis.rect.r00.y : "" }));
console.log(saveTable(`e07-limits-seed${seed}`, "limits.tsv", rows));
