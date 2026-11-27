/**
 * E21 axis lines: `axis lines`, `axis x line`, starred variants, hide axis,
 * separate axis lines. Dumps limits, rectangle, every Tier 2 path outside
 * the clip (axis lines, ticks, arrow tips) in paint order, tick label and
 * description anchors. Usage: e21-axis-lines.mts [name] '<opts>' ...
 * (with no option lists: the built-in variant list).
 */
import { runExperiment, strokes } from "./lib.js";

const name = process.argv[2] ?? "base";
const given = process.argv.slice(3);
const builtin: string[] = [
  "", "axis lines=left", "axis lines=middle", "axis lines=center", "axis lines=right", "axis lines=box", "axis lines=none",
  "axis lines*=left", "axis lines*=middle", "axis x line=bottom,axis y line=left", "axis x line=top,axis y line=right",
  "axis x line=middle,axis y line=none", "hide axis", "hide x axis", "axis lines=middle,xmin=1,xmax=5,ymin=1,ymax=4",
  "axis lines=left,xlabel=X,ylabel=Y", "axis lines=middle,xlabel=X,ylabel=Y", "axis lines=box,separate axis lines=false",
];
const list = given.length > 0 ? given : builtin;
const plot = "\\addplot coordinates {(-2,-1) (0,1) (3,2.5)};";
const cases = list.map((opts, i) => ({ id: `c${i}`, meta: { opts }, body: `\\begin{tikzpicture}\\begin{axis}[${opts}]\n${plot}\n\\end{axis}\\end{tikzpicture}` }));
const res = runExperiment(`e21-${name}`, cases, {});
const f = (v: number) => v.toFixed(3);
for (const r of res) {
  const a = r.axis;
  console.log(`=== ${r.id} [${String(r.meta.opts)}] limits ${a?.limitsRaw?.xmin}..${a?.limitsRaw?.xmax} x ${a?.limitsRaw?.ymin}..${a?.limitsRaw?.ymax}  rect ${a?.rect ? `${f(a.rect.r00.x)},${f(a.rect.r00.y)} ${f(a.rect.r11.x)},${f(a.rect.r11.y)}` : "-"}  bbox ${r.bbox ? `${f(r.bbox.minX)},${f(r.bbox.minY)} ${f(r.bbox.maxX)},${f(r.bbox.maxY)}` : ""}`);
  for (const p of r.tier2.primitives) {
    if (p.type !== "path" || p.clipDepth > 0 || p.operation === "clip") continue;
    const segs = p.segments.map((s) => (s.op === "Z" ? "Z" : s.op === "C" ? `C${f(s.x)},${f(s.y)}` : `${s.op}${f(s.x)},${f(s.y)}`));
    const paint = p.paint?.components.map((c) => c.toFixed(2)).join("/") ?? "";
    const isStroke = p.operation === "stroke";
    console.log(`  ${p.order} ${p.operation} ${paint} lw=${isStroke ? (p.lineWidth ?? 0).toFixed(2) : "-"} ${isStroke ? `cap=${p.lineCap} join=${p.lineJoin}` : ""} ${segs.length > 14 ? `${segs.slice(0, 14).join(" ")} …(${segs.length})` : segs.join(" ")}`);
  }
  const tl = (letter: "x" | "y") => (a?.ticks?.[letter] ?? []).map((t) => {
    const an = t.label?.anchors; if (!an) return `${t.value}:-`;
    return `${Number(t.value.toPrecision(4))}:${t.label?.text}@n(${f(an.north!.x)},${f(an.north!.y)})e(${f(an.east!.x)},${f(an.east!.y)})`;
  }).join(" ");
  console.log(`  xt ${tl("x")}`);
  console.log(`  yt ${tl("y")}`);
  for (const k of ["xlabel", "ylabel", "title"] as const) {
    const d = a?.descriptions?.[k]; if (!d) continue;
    const an = d.anchors;
    console.log(`  ${k} center(${f(an.center!.x)},${f(an.center!.y)}) sw(${f(an["south west"]!.x)},${f(an["south west"]!.y)}) ne(${f(an["north east"]!.x)},${f(an["north east"]!.y)})`);
  }
  void strokes;
}
