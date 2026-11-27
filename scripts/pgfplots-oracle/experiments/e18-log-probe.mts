/**
 * E18 log axes, targeted probes: one loglogaxis per line of a spec file
 * (or the built-in list), x limits given as written. Prints the x tick
 * values in log10 units, \ticknum, minor tick count and label strings.
 * Usage: e18-log-probe.mts <name> '<opts1>' '<opts2>' ...
 *   each opts is the axis option list; the plot spans the given xmin..xmax.
 */
import { runExperiment, strokes, subpaths } from "./lib.js";

const name = process.argv[2] ?? "probe";
const optsList = process.argv.slice(3);
const LN10 = Math.log(10);
const sig = (v: number, n = 6) => Number(v.toPrecision(n));
const cases = optsList.map((opts, i) => {
  const env = /^env=(\w+);/u.exec(opts)?.[1] ?? "loglogaxis";
  const body = opts.replace(/^env=\w+;/u, "");
  const [o, plot] = body.includes("|") ? body.split("|") : [body, ""];
  return { id: `p${i}`, meta: { opts }, body: `\\begin{tikzpicture}\\begin{${env}}[scale only axis,${o}]\n${plot || "\\addplot coordinates {(1,1) (10,10)};"}\n\\end{${env}}\\end{tikzpicture}` };
});
const res = runExperiment(`e18-${name}`, cases, {});
for (const r of res) {
  const a = r.axis;
  const y0 = a?.rect?.r00.y ?? 0;
  const marks = strokes(r.tier2).filter((p) => p.paint?.components.join() === "0.5" && p.clipDepth === 0).flatMap((p) => subpaths(p))
    .filter((sp) => sp.length === 2 && Math.abs(sp[0]!.x - sp[1]!.x) < 1e-3 && Math.abs(Math.min(sp[0]!.y, sp[1]!.y) - y0) < 0.01);
  const minor = marks.filter((sp) => Math.abs(sp[1]!.y - sp[0]!.y) < 3.5).length;
  const lx = (v: string | undefined) => sig(Number(v) / LN10, 7);
  console.log(`${r.id} [${String(r.meta.opts)}] xlim ${lx(a?.limitsRaw?.xmin)}..${lx(a?.limitsRaw?.xmax)} ylim ${a?.limitsRaw?.ymin}..${a?.limitsRaw?.ymax}`);
  console.log(`   x: ${(a?.ticks?.x ?? []).map((t) => `${sig(t.value / LN10)}#${t.index}`).join(" ")}  minor=${minor}  labels ${(a?.ticks?.x ?? []).map((t) => t.label?.text ?? "").join(" | ")}`);
  console.log(`   y: ${(a?.ticks?.y ?? []).map((t) => `${sig(t.value)}#${t.index}`).join(" ")} labels ${(a?.ticks?.y ?? []).map((t) => t.label?.text ?? "").join(" | ")}`);
}
