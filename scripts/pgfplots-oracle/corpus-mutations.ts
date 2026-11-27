/**
 * Mutation check of the real-document differential (corpus-compare.mts
 * --mutate <name>): known rendering errors injected into the *editor* side
 * only, either into the source the editor renders (the TeX side keeps the
 * original) or into the editor's adapted Tier 2. The comparison must flag
 * every effective mutation on snippets that match without it.
 */
import type { AdaptedPicture } from "./adapter.js";
import { splitSubpaths } from "./compare.js";
import type { Box, PathSegment, Paint, Tier2 } from "./schema.js";

export interface CorpusMutation {
  name: string;
  /** Whether the mutation applies to this snippet (given the unmutated rendering). */
  applies(source: string, base: AdaptedPicture): boolean;
  /** Mutated source for the editor (TeX keeps the original). */
  source?(source: string, base: AdaptedPicture): string;
  /** Mutated editor Tier 2. */
  tier2?(picture: AdaptedPicture): Tier2;
}

const AXIS_BEGIN = /\\begin\{(?:axis|semilogxaxis|semilogyaxis|loglogaxis)\}/u;

/** Appends `keys` to the first axis' option list (adds one when there is none). */
export function appendAxisOptions(source: string, keys: string): string {
  const match = AXIS_BEGIN.exec(source);
  if (!match) return source;
  let i = match.index + match[0].length;
  while (/\s/u.test(source[i] ?? "")) i += 1;
  if (source[i] !== "[") return `${source.slice(0, match.index + match[0].length)}[${keys}]${source.slice(match.index + match[0].length)}`;
  let depth = 0;
  for (let j = i; j < source.length; j += 1) {
    const c = source[j];
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === "]" && depth === 0) return `${source.slice(0, j)},${keys}${source.slice(j)}`;
  }
  return source;
}

/** Removes the first `\addplot … ;` of the first axis (braces respected). */
export function dropFirstPlot(source: string): string {
  const start = source.search(/\\addplot\b/u);
  if (start < 0) return source;
  let depth = 0;
  for (let j = start; j < source.length; j += 1) {
    const c = source[j];
    if (c === "{" || c === "[" || c === "(") depth += 1;
    else if (c === "}" || c === "]" || c === ")") depth -= 1;
    else if (c === ";" && depth <= 0) return source.slice(0, start) + source.slice(j + 1);
  }
  return source;
}

function shiftSegments(segments: PathSegment[], dx: number, dy: number): PathSegment[] {
  return segments.map((s) => s.op === "Z" ? s : s.op === "C" ? { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy, x: s.x + dx, y: s.y + dy } : { ...s, x: s.x + dx, y: s.y + dy });
}

function legendBox(picture: AdaptedPicture): Box | undefined {
  const legend = picture.tier1.axes[0]?.descriptions?.legend;
  const sw = legend?.anchors["south west"]; const ne = legend?.anchors["north east"];
  return sw && ne ? { minX: sw.x - 0.5, minY: sw.y - 0.5, maxX: ne.x + 0.5, maxY: ne.y + 0.5 } : undefined;
}

const clone = (t: Tier2): Tier2 => JSON.parse(JSON.stringify(t)) as Tier2;

function inBox(points: Array<{ x: number; y: number }>, b: Box): boolean {
  return points.length > 0 && points.every((p) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY);
}

function plotPaints(t: Tier2): Paint[] {
  const out: Paint[] = [];
  for (const p of t.primitives) {
    if (p.type !== "path" || p.operation !== "stroke" || p.clipDepth === 0 || !p.paint) continue;
    if (!out.some((q) => JSON.stringify(q.components) === JSON.stringify(p.paint?.components))) out.push(p.paint);
  }
  return out;
}

export const CORPUS_MUTATIONS: CorpusMutation[] = [
  {
    name: "legend-shift",
    applies: (_s, base) => legendBox(base) !== undefined,
    tier2: (picture) => {
      const t = clone(picture.tier2);
      const box = legendBox(picture);
      if (!box) return t;
      for (const p of t.primitives) {
        if (p.type === "path") {
          const subs = splitSubpaths(p.segments);
          const pts = subs.flat().flatMap((s) => (s.op === "Z" ? [] : [{ x: s.x, y: s.y }]));
          if (inBox(pts, box)) { p.segments = shiftSegments(p.segments, 0, -2); delete p.rect; }
        } else if (p.type === "glyphs" && inBox(p.glyphs, box)) p.glyphs = p.glyphs.map((g) => ({ ...g, y: g.y - 2 }));
      }
      return t;
    }
  },
  {
    name: "dropped-plot",
    applies: (s) => /\\addplot\b/u.test(s) && (s.match(/\\addplot\b/gu) ?? []).length >= 1,
    source: (s) => dropFirstPlot(s)
  },
  {
    name: "tick-step",
    applies: (_s, base) => {
      const axis = base.axes[0];
      return !!axis && axis.model.x.mode !== "log" && axis.layout.ticks.x.major.length >= 2;
    },
    source: (s, base) => {
      const major = base.axes[0]?.layout.ticks.x.major ?? [];
      const step = Math.abs((major[1]?.value ?? 0) - (major[0]?.value ?? 0));
      return appendAxisOptions(s, `xtick distance=${String(2 * step)}`);
    }
  },
  {
    name: "colour-swap",
    applies: (_s, base) => plotPaints(base.tier2).length >= 1,
    tier2: (picture) => {
      const t = clone(picture.tier2);
      const paints = plotPaints(t);
      const [a, b] = paints;
      if (!a) return t;
      const key = (p: Paint) => JSON.stringify(p.components);
      const other: Paint = b ?? { ...a, components: a.components.map((c) => 1 - c) };
      for (const p of t.primitives) {
        if (p.type !== "path" || !p.paint || p.clipDepth === 0) continue;
        if (key(p.paint) === key(a)) p.paint = { ...other };
        else if (b && key(p.paint) === key(b)) p.paint = { ...a };
      }
      return t;
    }
  },
  {
    name: "missing-grid",
    applies: (s) => /\bgrid\b|\b[xy]majorgrids\b|\bgrid style\b/u.test(s),
    source: (s) => appendAxisOptions(s, "grid=none")
  }
];
