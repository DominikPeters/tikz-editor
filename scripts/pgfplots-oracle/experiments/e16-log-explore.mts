/**
 * E16 log axes, exploration: what the limits, map, tick values and labels
 * look like on semilog/loglog axes and `xmode=log`.
 * Records limits (raw TeX strings), the rel/axis cs probe points, ticks
 * (\tick, \ticknum, label glyphs) and Tier 2 tick marks on the bottom edge.
 */
import { runExperiment, saveTable, strokes, subpaths, tickValues, tickLabels } from "./lib.js";

const variants: [string, string, string][] = [
  ["ll-1-1000", "loglogaxis", "\\addplot coordinates {(1,1) (10,5) (1000,100)};"],
  ["ll-tight", "loglogaxis", "enlargelimits=false|\\addplot coordinates {(1,1) (10,5) (1000,100)};"],
  ["sx-2-50", "semilogxaxis", "\\addplot coordinates {(2,1) (50,3)};"],
  ["sy-0p01-5", "semilogyaxis", "\\addplot coordinates {(0,0.01) (1,5)};"],
  ["xmode", "axis", "xmode=log|\\addplot coordinates {(1,1) (1e6,2)};"],
  ["ll-exp-lim", "loglogaxis", "xmin=1,xmax=100,ymin=0.1,ymax=10|\\addplot coordinates {(1,1) (100,10)};"],
  ["ll-short", "loglogaxis", "xmin=2,xmax=8,ymin=3,ymax=30|\\addplot coordinates {(2,3) (8,30)};"],
  ["ll-wide", "loglogaxis", "xmin=1e-10,xmax=1e10,ymin=1,ymax=1e30|\\addplot coordinates {(1,1) (8,30)};"],
  ["ll-xtick", "loglogaxis", "xmin=1,xmax=1000,xtick={1,5,50,500}|\\addplot coordinates {(1,1) (1000,30)};"],
  ["ll-minor", "loglogaxis", "xmin=1,xmax=1000,minor tick num=0|\\addplot coordinates {(1,1) (1000,30)};"],
  ["ll-grid", "loglogaxis", "xmin=1,xmax=1000,grid=both|\\addplot coordinates {(1,1) (1000,30)};"],
  ["ll-basis2", "loglogaxis", "log basis x=2,xmin=1,xmax=64|\\addplot coordinates {(1,1) (64,30)};"],
  ["ll-fixed", "loglogaxis", "log ticks with fixed point,xmin=1,xmax=1000|\\addplot coordinates {(1,1) (1000,30)};"],
  ["sy-neg", "semilogyaxis", "\\addplot coordinates {(0,-1) (1,0) (2,1) (3,10)};"],
];
const cases = variants.map(([id, env, spec]) => {
  const [opts, plots] = spec.includes("|") ? spec.split("|") : ["", spec];
  return { id, meta: { env, opts }, body: `\\begin{tikzpicture}\\begin{${env}}[${opts}]\n${plots}\n\\end{${env}}\\end{tikzpicture}` };
});
const res = runExperiment("e16-log-explore", cases, {});
for (const r of res) {
  const a = r.axis;
  if (!a) { console.log(r.id, "no axis"); continue; }
  const y0 = a.rect!.r00.y; const x0 = a.rect!.r00.x;
  const ticks = strokes(r.tier2).filter((p) => p.paint?.components.join() === "0.5" && p.clipDepth === 0).flatMap((p) => subpaths(p));
  const bottom = ticks.filter((sp) => sp.length === 2 && Math.abs(sp[0]!.x - sp[1]!.x) < 1e-3 && Math.abs(Math.min(sp[0]!.y, sp[1]!.y) - y0) < 0.01);
  const left = ticks.filter((sp) => sp.length === 2 && Math.abs(sp[0]!.y - sp[1]!.y) < 1e-3 && Math.abs(Math.min(sp[0]!.x, sp[1]!.x) - x0) < 0.01);
  const len = (sp: { x: number; y: number }[]) => Math.hypot(sp[1]!.x - sp[0]!.x, sp[1]!.y - sp[0]!.y);
  console.log(`--- ${r.id} ${String(r.meta.env)} [${String(r.meta.opts)}]`);
  console.log(` limitsRaw ${JSON.stringify(a.limitsRaw)} rect ${JSON.stringify(a.rect?.r11)}`);
  console.log(` limitCorners ${JSON.stringify(a.limitCorners)}`);
  console.log(` xticks ${tickValues(a, "x").join(" ")} idx ${(a.ticks?.x ?? []).map((t) => t.index).join(" ")} labels ${tickLabels(a, "x").join(" | ")}`);
  console.log(` yticks ${tickValues(a, "y").join(" ")} idx ${(a.ticks?.y ?? []).map((t) => t.index).join(" ")} labels ${tickLabels(a, "y").join(" | ")}`);
  console.log(` bottom marks x: ${bottom.map((sp) => `${sp[0]!.x.toFixed(3)}/${len(sp).toFixed(2)}`).join(" ")}`);
  console.log(` left marks y: ${left.map((sp) => `${sp[0]!.y.toFixed(3)}/${len(sp).toFixed(2)}`).join(" ")}`);
}
saveTable("e16-log-explore", "explore.json", res.map((r) => ({ id: r.id, axis: r.axis })));
