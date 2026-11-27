/**
 * E12 tick specifications: minor tick num, xtick distance, xtick={a,b,...,c},
 * xtick=data, xtick=\empty, explicit minor xtick, extra x ticks. Major/minor
 * x tick positions are read from Tier 2 (the tick-mark strokes on the bottom
 * edge, classified by length), labels from Tier 1.
 */
import { runExperiment, saveTable, subpaths, strokes, tickValues, tickLabels } from "./lib.js";

const P = "\\addplot coordinates {(0,0) (1.3,1) (2,0.5) (3.7,2) (5,1)};";
const variants: [string, string, string?][] = [
  ["plain", "xmin=0,xmax=5"],
  ["minor1", "xmin=0,xmax=5,minor tick num=1"],
  ["minor3", "xmin=0,xmax=5,minor x tick num=3"],
  ["minor4-step", "xmin=0,xmax=1,minor tick num=4"],
  ["minor-offgrid", "xmin=0.3,xmax=4.6,minor tick num=1"],
  ["dist-0p7", "xmin=0,xmax=5,xtick distance=0.7"],
  ["dist-2", "xmin=-1,xmax=5,xtick distance=2"],
  ["dist-2-off", "xmin=0.3,xmax=4.6,xtick distance=2"],
  ["dots", "xmin=0,xmax=5,xtick={0,0.5,...,3}"],
  ["dots-uneven", "xmin=0,xmax=5,xtick={0.2,0.9,...,4.5}"],
  ["dots-prefix", "xmin=0,xmax=5,xtick={-1,1,2,...,4,4.5}"],
  ["outside-list", "xmin=0,xmax=5,xtick={-2,0,2.5,5,7}"],
  ["data", "xmin=0,xmax=5,xtick=data"],
  ["empty", "xmin=0,xmax=5,xtick=\\empty"],
  ["empty-braces", "xmin=0,xmax=5,xtick={}"],
  ["minor-explicit", "xmin=0,xmax=5,minor xtick={0.25,1.75,4.9}"],
  // extra x ticks: not probed — the harness tick probe throws (extra ticks reuse \\ticknum).
  ["auto-enl", ""],
  ["tol-inside", "xmin=0.0001,xmax=4.9999"],
  ["tol-edge", "xmin=0.01,xmax=4.99"],
];
const cases = variants.map(([id, opt]) => ({ id, meta: { opt }, body: `\\begin{tikzpicture}\\begin{axis}[ymin=0,ymax=2,${opt}]\n${P}\n\\end{axis}\\end{tikzpicture}` }));
const res = runExperiment("e12-tickspecs", cases, {});
const rows = res.map((r) => {
  const a = r.axis!; const m = a.map!; const y0 = a.rect!.r00.y;
  const marks = strokes(r.tier2).filter((p) => p.paint?.components.join() === "0.5" && p.clipDepth === 0).flatMap((p) => subpaths(p))
    .filter((sp) => sp.length === 2 && Math.abs(sp[0]!.x - sp[1]!.x) < 1e-3 && Math.abs(Math.min(sp[0]!.y, sp[1]!.y) - y0) < 0.01);
  const toData = (x: number) => Number(((x - m.origin.x) / m.xUnit.x).toPrecision(6));
  const len = (sp: { y: number }[]) => Math.abs(sp[1]!.y - sp[0]!.y);
  return {
    id: r.id, ...r.meta, limits: `${a.limitsRaw?.xmin}..${a.limitsRaw?.xmax}`,
    major: marks.filter((sp) => len(sp) > 3.5).map((sp) => toData(sp[0]!.x)),
    minor: marks.filter((sp) => len(sp) <= 3.5).map((sp) => toData(sp[0]!.x)),
    tickvals: tickValues(a, "x"), labels: tickLabels(a, "x"),
  };
});
for (const r of rows) console.log(`${String(r.id).padEnd(15)} ${String((r as Record<string, unknown>).opt).padEnd(40)} major=[${(r.major as number[]).join(" ")}] minor=[${(r.minor as number[]).join(" ")}] labels=[${(r.labels as string[]).join(" ")}]`);
console.log(saveTable("e12-tickspecs", "tickspecs.tsv", rows));
