#!/usr/bin/env node
// Regenerate test/fixtures/pgf-plot-marks/marks.oracle.json: the paint
// operations PGF actually emits for every plot mark, read back from the
// compiled PDF with `mutool trace`. Ordinary Vitest runs consume the JSON and
// need no TeX installation.
//
// Each case is one tikzpicture (one standalone page) holding a single
// one-point `plot`. Its degenerate path (a lone moveto) gives the mark origin;
// every later path operation on the page belongs to the mark. Coordinates
// are stored in pt relative to that origin, y up.
//
// Usage: node scripts/capture-pgf-plot-marks-oracle.mjs [--keep]
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixturePath = fileURLToPath(new URL("../test/fixtures/pgf-plot-marks/marks.oracle.json", import.meta.url));
const sourcePath = fileURLToPath(new URL("../test/fixtures/pgf-plot-marks/marks.tex", import.meta.url));
const BP_TO_PT = 72.27 / 72;

const MARKS = [
  "*", "x", "+", "-", "|", "o", "asterisk", "star", "10-pointed star", "oplus", "oplus*", "otimes", "otimes*",
  "square", "square*", "triangle", "triangle*", "diamond", "diamond*", "halfdiamond*", "halfsquare*",
  "halfsquare right*", "halfsquare left*", "pentagon", "pentagon*", "Mercedes star", "Mercedes star flipped",
  "halfcircle", "halfcircle*", "heart", "ball"
];

/**
 * Variants. `module` describes the same situation as plain inputs for the
 * pure mark module: size (pt), colours as RGB, mark colour (null = unset,
 * "none"), and the linear map from mark-local coordinates to the page.
 * `canvas` is the path's own canvas transform: the plotted point (1,0) lands
 * at canvas * (1cm, 0).
 */
const VARIANTS = [
  {
    id: "default",
    canvas: [1, 0, 0, 1],
    path: "",
    plot: "",
    module: { size: 2, stroke: [0, 0, 0], fill: [0, 0, 0], markColor: null, ballColor: [0, 0, 1], lineWidth: 0.4, matrix: [1, 0, 0, 1, 0, 0] }
  },
  {
    id: "colours-large",
    canvas: [1, 0, 0, 1],
    path: "draw=blue, fill=yellow, line width=0.8pt, mark color=red",
    plot: "mark size=3.5pt",
    module: { size: 3.5, stroke: [0, 0, 1], fill: [1, 1, 0], markColor: [1, 0, 0], ballColor: [0, 0, 1], lineWidth: 0.8, matrix: [1, 0, 0, 1, 0, 0] }
  },
  {
    id: "mark-options",
    canvas: [1, 0, 0, 1],
    path: "red",
    plot: "mark size=2.5pt, mark options={rotate=30, xscale=1.5, fill=orange, mark color=none, ball color=green, line width=0.6pt}",
    module: {
      size: 2.5,
      stroke: [1, 0, 0],
      fill: [1, 0.5, 0],
      markColor: "none",
      ballColor: [0, 1, 0],
      lineWidth: 0.6,
      // rotate=30 then xscale=1.5: points are scaled first, then rotated.
      matrix: [1.5 * Math.cos(Math.PI / 6), 1.5 * Math.sin(Math.PI / 6), -Math.sin(Math.PI / 6), Math.cos(Math.PI / 6), 0, 0]
    }
  },
  {
    id: "canvas-transform",
    canvas: [2 * Math.cos(Math.PI / 9), Math.sin(Math.PI / 9), -2 * Math.sin(Math.PI / 9), Math.cos(Math.PI / 9)],
    path: "xscale=2, rotate=20, dashed",
    plot: "",
    module: {
      size: 2,
      stroke: [0, 0, 0],
      fill: [0, 0, 0],
      markColor: null,
      ballColor: [0, 0, 1],
      lineWidth: 0.4,
      // xscale=2 then rotate=20: points are rotated first, then x-scaled.
      matrix: [2 * Math.cos(Math.PI / 9), Math.sin(Math.PI / 9), -2 * Math.sin(Math.PI / 9), Math.cos(Math.PI / 9), 0, 0]
    }
  }
];

function caseSource(mark, variant) {
  const plotOptions = [`mark=${mark}`, variant.plot].filter(Boolean).join(", ");
  const pathOptions = variant.path ? `[${variant.path}]` : "";
  return String.raw`\begin{tikzpicture}
  \draw${pathOptions} plot[${plotOptions}] coordinates {(1,0)};
\end{tikzpicture}`;
}

function attrs(tag) {
  const result = {};
  for (const match of tag.matchAll(/([A-Za-z_:][A-Za-z0-9_:]*)="([^"]*)"/gu)) result[match[1]] = match[2];
  return result;
}

const nums = (text) => (text ?? "").trim().split(/[\s,]+/u).filter(Boolean).map(Number);

function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det; const b = -m[1] / det; const c = -m[2] / det; const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

function toRgb(space, components) {
  if (space === "DeviceGray") return [components[0], components[0], components[0]];
  if (space === "DeviceCMYK") {
    const [c, m, y, k] = components;
    return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
  }
  return components.slice(0, 3);
}

const round = (value) => Math.round(value * 1e5) / 1e5 + 0;

/** Parse one page of `mutool trace` output into painted items in page user space (bp). */
function parsePage(xml) {
  const items = [];
  const itemPattern = /<(fill_path|stroke_path|clip_path)\b([^>]*)>([\s\S]*?)<\/\1>|<fill_shade\b([^>]*)\/>|<fill_text\b([^>]*)>/gu;
  for (const match of xml.matchAll(itemPattern)) {
    if (match[1]) {
      const a = attrs(match[2]);
      const matrix = nums(a.transform);
      const segments = [];
      for (const op of match[3].matchAll(/<(moveto|lineto|curveto|closepath)\b([^>]*)\/>/gu)) {
        const p = attrs(op[2]);
        if (op[1] === "closepath") segments.push({ op: "Z" });
        else if (op[1] === "curveto") segments.push({ op: "C", pts: [[+p.x1, +p.y1], [+p.x2, +p.y2], [+p.x3, +p.y3]] });
        else segments.push({ op: op[1] === "moveto" ? "M" : "L", pts: [[+p.x, +p.y]] });
      }
      items.push({
        kind: match[1] === "fill_path" ? "fill" : match[1] === "stroke_path" ? "stroke" : "clip",
        matrix,
        segments,
        color: a.colorspace ? toRgb(a.colorspace, nums(a.color)) : null,
        alpha: a.alpha === undefined ? 1 : Number(a.alpha),
        lineWidth: a.linewidth === undefined ? null : Number(a.linewidth) * BP_TO_PT,
        dash: a.dash === undefined ? null : nums(a.dash).map((value) => value * BP_TO_PT),
        evenOdd: a.winding === "eofill" || a.winding === "evenodd"
      });
    } else if (match[4] !== undefined) {
      const a = attrs(match[4]);
      items.push({ kind: "shade", type: a.type, inner: nums(a.inner), outer: nums(a.outer) });
    } else {
      items.push({ kind: "text" });
    }
  }
  return items;
}

/** Drop movetos that start no drawn segment (PGF's trailing `\pgfpathmoveto`s). */
function dropDanglingMoves(segments) {
  return segments.filter((segment, index) => {
    if (segment.op !== "M") return true;
    const next = segments[index + 1];
    return next !== undefined && next.op !== "M" && next.op !== "Z";
  });
}

function main() {
  const keep = process.argv.includes("--keep");
  const cases = [];
  for (const mark of MARKS) {
    for (const variant of VARIANTS) cases.push({ id: `${mark}|${variant.id}`, mark, variant: variant.id, source: caseSource(mark, variant) });
  }
  const document = [
    String.raw`\documentclass[tikz]{standalone}`,
    String.raw`\usetikzlibrary{plotmarks}`,
    String.raw`\begin{document}`,
    ...cases.map((entry) => entry.source),
    String.raw`\end{document}`,
    ""
  ].join("\n");
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(sourcePath, document);

  const directory = mkdtempSync(join(tmpdir(), "pgf-plot-marks-oracle-"));
  try {
    writeFileSync(join(directory, "marks.tex"), document);
    execFileSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "marks.tex"], { cwd: directory, stdio: "pipe" });
    const log = execFileSync("pdflatex", ["--version"], { encoding: "utf8" }).split("\n")[0];
    const trace = execFileSync("mutool", ["trace", join(directory, "marks.pdf")], { encoding: "utf8", maxBuffer: 1 << 28 });
    const pages = [...trace.matchAll(/<page number="(\d+)"[^>]*>([\s\S]*?)<\/page>/gu)].map((match) => match[2]);
    if (pages.length !== cases.length) throw new Error(`Expected ${cases.length} pages, got ${pages.length}`);

    const revisionFile = execFileSync("kpsewhich", ["pgf.revision.tex"], { encoding: "utf8" }).trim();
    const pgfVersion = /\\def\\pgfversion\{([^}]*)\}/u.exec(readFileSync(revisionFile, "utf8"))?.[1] ?? null;
    const output = {
      description: "PGF plot mark paint operations, captured from pdflatex output with mutool trace by scripts/capture-pgf-plot-marks-oracle.mjs. Coordinates in pt relative to the plotted point, y up.",
      tex: log,
      pgfVersion,
      variants: VARIANTS,
      cases: []
    };

    cases.forEach((entry, index) => {
      const items = parsePage(pages[index]);
      const originItemIndex = items.findIndex((item) => item.kind !== "shade" && item.kind !== "text" && item.segments.length === 1 && item.segments[0].op === "M");
      if (originItemIndex < 0) throw new Error(`No origin path for ${entry.id}`);
      const originItem = items[originItemIndex];
      const base = originItem.matrix;
      const baseInverse = invert(base);
      const originPicture = apply(baseInverse, ...apply(base, ...originItem.segments[0].pts[0]));
      const toLocal = (matrix, [x, y]) => {
        const picture = apply(baseInverse, ...apply(matrix, x, y));
        return [round((picture[0] - originPicture[0]) * BP_TO_PT), round((picture[1] - originPicture[1]) * BP_TO_PT)];
      };
      const operations = [];
      let index2 = originItemIndex + 1;
      // Skip the plot path's remaining degenerate paints (fill and stroke of the lone moveto).
      while (index2 < items.length && items[index2].segments?.length === 1 && items[index2].segments[0].op === "M") index2 += 1;
      for (; index2 < items.length; index2 += 1) {
        const item = items[index2];
        if (item.kind === "text") { operations.push({ paint: "text" }); continue; }
        if (item.kind === "shade") {
          const clip = operations.at(-1);
          if (clip?.paint === "clip") clip.shade = { type: item.type, inner: item.inner, outer: item.outer };
          continue;
        }
        // The shading's own unit-box clip is in the shading's coordinate system.
        if (item.kind === "clip" && operations.at(-1)?.paint === "clip") continue;
        const segments = dropDanglingMoves(item.segments).map((segment) => {
          if (segment.op === "Z") return { op: "Z" };
          if (segment.op === "C") {
            const [p1, p2, p3] = segment.pts.map((point) => toLocal(item.matrix, point));
            return { op: "C", x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], x: p3[0], y: p3[1] };
          }
          const [x, y] = toLocal(item.matrix, segment.pts[0]);
          return { op: segment.op, x, y };
        });
        const operation = { paint: item.kind, segments };
        if (item.color) operation.color = item.color.map(round);
        if (item.kind === "stroke") {
          operation.lineWidth = round(item.lineWidth);
          operation.dash = item.dash ? item.dash.map(round) : null;
        }
        if (item.kind === "fill" && item.evenOdd) operation.evenOdd = true;
        operations.push(operation);
      }
      output.cases.push({ ...entry, operations });
    });

    // One line per variant and per paint operation keeps the fixture reviewable.
    const { cases: capturedCases, variants, ...header } = output;
    const lines = Object.entries(header).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
    lines.push(`  "variants": [\n${variants.map((variant) => `    ${JSON.stringify(variant)}`).join(",\n")}\n  ],`);
    lines.push(`  "cases": [\n${capturedCases.map(({ operations, ...rest }) => {
      const head = JSON.stringify(rest).slice(0, -1);
      return `    ${head},"operations":[\n${operations.map((operation) => `      ${JSON.stringify(operation)}`).join(",\n")}\n    ]}`;
    }).join(",\n")}\n  ]`);
    writeFileSync(fixturePath, `{\n${lines.join("\n")}\n}\n`);
    console.log(`Captured ${output.cases.length} cases to ${fixturePath}`);
    if (keep) console.log(`Kept ${directory}`);
  } finally {
    if (!keep) rmSync(directory, { recursive: true, force: true });
  }
}

main();
