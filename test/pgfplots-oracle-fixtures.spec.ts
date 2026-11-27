// Validates the saved pgfplots oracle fixtures without TeX: schema, source
// freshness, and self-consistency between Tier 1 probes and the Tier 2 trace.
// Refresh the fixtures with `npm run oracle:pgfplots` (see
// scripts/pgfplots-oracle/README.md). Nothing here renders pgfplots yet.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { applyMap, comparePicture, compareTier1, compareTier2, splitSubpaths } from "../scripts/pgfplots-oracle/compare.js";
import { runMutationTest } from "../scripts/pgfplots-oracle/mutations.js";
import { parsePgfplotsOracle, type OracleAxis, type PathPrimitive, type PgfplotsOracle, type Point } from "../scripts/pgfplots-oracle/schema.js";

const dir = join(__dirname, "fixtures", "pgfplots");
const names = readdirSync(dir).filter((f) => f.endsWith(".tex")).map((f) => f.slice(0, -4)).sort();

function load(name: string): PgfplotsOracle {
  return parsePgfplotsOracle(JSON.parse(readFileSync(join(dir, `${name}.oracle.json`), "utf8")));
}

// Tier 2 paths come from PGF's pt->bp conversion (factor 0.99627, pgfsys.code.tex),
// Tier 1 from \pgfpointanchor; they agree to ~1e-5 relative, i.e. < 0.005pt here.
const CROSS_TIER = 0.01;
const near = (a: Point, b: Point, tol = CROSS_TIER) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;

function strokes(oracle: PgfplotsOracle): PathPrimitive[] {
  return oracle.tier2.primitives.filter((p): p is PathPrimitive => p.type === "path" && p.operation === "stroke");
}

function subpathEnds(p: PathPrimitive): Point[][] {
  return splitSubpaths(p.segments).map((sub) => sub.flatMap((s) => (s.op === "M" || s.op === "L" ? [{ x: s.x, y: s.y }] : [])));
}

function axisOf(oracle: PgfplotsOracle): OracleAxis {
  const axis = oracle.tier1.axes[0];
  if (!axis) throw new Error("no axis");
  return axis;
}

/**
 * Fixtures whose own options defeat a generic check below, with why. The
 * checks themselves stay strict; these fixtures are covered by the renderer
 * comparison (test/pgfplots-oracle-compare.spec.ts).
 */
const SKIP: Record<string, Partial<Record<"probes" | "map" | "tickPlacement" | "singleAxis" | "clip", string>>> = {
  "empty-axis": { probes: "no \\addplot: \\pgfplotsextra (limits, map probes) does not run (H3)", map: "no limits probe", tickPlacement: "no limits probe" },
  xticklabels: { probes: "xticklabels/ytick=\\empty replace the tick probe (README: lost probes)", tickPlacement: "no tick probe" },
  "scaled-ticks": { map: "axis cs probe at |y| ~ 1e4 carries ~0.16pt noise (behaviour N2)", tickPlacement: "\\tick is the scaled value (J4)" },
  "function-large": { map: "axis cs probe at |y| ~ 3e6 carries up to 7.7pt noise (behaviour N2/K5)", tickPlacement: "\\tick is the scaled value (J4)" },
  "tick-align-outside": { tickPlacement: "labels are shifted by the outside ticks (D1)" },
  "bars-ybar": { tickPlacement: "the ybar style puts the x ticks outside (U5); labels shift by the tick length (D1)" },
  "bars-xbar": { tickPlacement: "the xbar style puts the y ticks outside (U5); labels shift by the tick length (D1)" },
  "bars-nodes-near": { tickPlacement: "the ybar style puts the x ticks outside (U5); labels shift by the tick length (D1)" },
  "tick-styles": { tickPlacement: "x ticks on top, y labels on the right" },
  "symbolic-coords": { probes: "symbolic axes: map/rect probes off, tick probe replaced (harness)", map: "no map probe on a symbolic axis", tickPlacement: "no x tick probe", clip: "no rect probe" },
  "symbolic-partial": { probes: "symbolic axes: map/rect probes off, tick probe replaced (harness)", map: "no map probe on a symbolic axis", tickPlacement: "no x tick probe", clip: "no rect probe" },
  "scope-shift": { singleAxis: "a path outside the axis grows the picture" },
  "two-axes": { singleAxis: "two axes" },
  "cycle-list-named": { singleAxis: "two axes" },
  "soa-at-anchor": { singleAxis: "a mark outside the axis grows the picture" },
  "axis-on-top": { clip: "clip=false", singleAxis: "unclipped content" },
  "embedded-tikz": { singleAxis: "unclipped node" }
};

/** Normalise TeX's math minus for numeric comparison of label strings. */
const labelNumber = (text: string) => Number(text.replace(/−/gu, "-"));

describe("pgfplots oracle fixtures", () => {
  it("has the three Phase 0 fixtures and at least 25 in all", () => {
    expect(names).toEqual(expect.arrayContaining(["default-axis", "explicit-axis", "legend-marks"]));
    expect(names.length).toBeGreaterThanOrEqual(25);
  });

  describe.each(names)("%s", (name) => {
    const oracle = load(name);
    const axis = axisOf(oracle);

    it("matches its .tex source and pinned toolchain", () => {
      const source = readFileSync(join(dir, `${name}.tex`), "utf8");
      expect(oracle.case.sourceSha256, "stale oracle: run npm run oracle:pgfplots").toBe(createHash("sha256").update(source).digest("hex"));
      expect(oracle.toolchain.engine).toBe("lualatex");
      expect(oracle.toolchain.compat).toBe("1.18");
      expect(oracle.toolchain.pgfplotsVersion).toMatch(/^\d+\.\d+/u);
    });

    const skip = SKIP[name] ?? {};
    it.skipIf(skip.probes !== undefined)("has every Tier 1 probe kind", () => {
      expect(oracle.tier1.boundingBox).toBeDefined();
      expect(axis.limits && axis.rect && axis.map && axis.anchors && axis.ticks).toBeTruthy();
      expect(axis.ticks?.x.length).toBeGreaterThan(1);
      expect(axis.ticks?.y.length).toBeGreaterThan(1);
    });

    it("page is the picture bounding box", () => {
      const box = oracle.tier1.boundingBox!;
      expect(oracle.tier2.page.width).toBeCloseTo(box.maxX - box.minX, 3);
      expect(oracle.tier2.page.height).toBeCloseTo(box.maxY - box.minY, 3);
    });

    it.skipIf(skip.map !== undefined)("rel axis cs, axis cs at the limits and the axis anchors agree", () => {
      const { rect, map, limits, anchors } = axis;
      expect(near(applyMap(map!, limits!.xmin, limits!.ymin), rect!.r00, 1e-3)).toBe(true);
      expect(near(applyMap(map!, limits!.xmax, limits!.ymin), rect!.r10, 1e-3)).toBe(true);
      expect(near(applyMap(map!, limits!.xmin, limits!.ymax), rect!.r01, 1e-3)).toBe(true);
      expect(near(applyMap(map!, limits!.xmax, limits!.ymax), rect!.r11, 1e-3)).toBe(true);
      expect(near(anchors!["south west"], rect!.r00, 1e-4)).toBe(true);
      expect(near(anchors!["north east"], rect!.r11, 1e-4)).toBe(true);
      // 2D linear axis: the rectangle is axis-aligned.
      expect(map!.xUnit.y).toBeCloseTo(0, 6);
      expect(map!.yUnit.x).toBeCloseTo(0, 6);
    });

    it.skipIf(skip.singleAxis !== undefined)("single-axis picture: outer anchors span the picture bounding box", () => {
      const box = oracle.tier1.boundingBox!;
      expect(near(axis.anchors!["outer south west"], { x: box.minX, y: box.minY }, 1e-4)).toBe(true);
      expect(near(axis.anchors!["outer north east"], { x: box.maxX, y: box.maxY }, 1e-4)).toBe(true);
    });

    it.skipIf(skip.tickPlacement !== undefined)("ticks lie in the limits and their labels hang on the axis edges", () => {
      const { map, rect, limits } = axis;
      for (const tick of axis.ticks!.x) {
        expect(tick.value).toBeGreaterThanOrEqual(limits!.xmin);
        expect(tick.value).toBeLessThanOrEqual(limits!.xmax);
        const north = tick.label!.anchors.north;
        expect(north.x).toBeCloseTo(applyMap(map!, tick.value, 0).x, 3);
        expect(north.y).toBeCloseTo(rect!.r00.y, 3);
        expect(labelNumber(tick.label!.text!)).toBeCloseTo(tick.value, 9);
      }
      for (const tick of axis.ticks!.y) {
        expect(tick.value).toBeGreaterThanOrEqual(limits!.ymin);
        expect(tick.value).toBeLessThanOrEqual(limits!.ymax);
        const east = tick.label!.anchors.east;
        expect(east.y).toBeCloseTo(applyMap(map!, 0, tick.value).y, 3);
        expect(east.x).toBeCloseTo(rect!.r00.x, 3);
        expect(labelNumber(tick.label!.text!)).toBeCloseTo(tick.value, 9);
      }
      // \ticknum is strictly increasing.
      for (const list of [axis.ticks!.x, axis.ticks!.y]) {
        expect(list.map((t) => t.index)).toEqual([...list.map((t) => t.index)].sort((a, b) => a - b));
      }
    });

    it.skipIf(skip.map !== undefined || skip.clip !== undefined)("trace has the axis box as a closed stroked rectangle, and a matching clip", () => {
      const rect = axis.rect!;
      const box = strokes(oracle).find((p) => p.rect && near({ x: p.rect.minX, y: p.rect.minY }, rect.r00) && near({ x: p.rect.maxX, y: p.rect.maxY }, rect.r11));
      expect(box, "axis box stroke").toBeDefined();
      const clip = oracle.tier2.primitives.find((p): p is PathPrimitive => p.type === "path" && p.operation === "clip" && !!p.rect);
      expect(clip?.rect && near({ x: clip.rect.minX, y: clip.rect.minY }, rect.r00) && near({ x: clip.rect.maxX, y: clip.rect.maxY }, rect.r11)).toBe(true);
    });

    it.skipIf(skip.tickPlacement !== undefined)("trace has a tick mark at every x tick on the bottom edge and every y tick on the left edge", () => {
      const { map, rect } = axis;
      const subs = strokes(oracle).flatMap(subpathEnds).filter((pts) => pts.length === 2);
      for (const tick of axis.ticks!.x) {
        const x = applyMap(map!, tick.value, 0).x;
        expect(subs.some((pts) => pts.some((p) => near(p, { x, y: rect!.r00.y })) && Math.abs(pts[0].x - pts[1].x) < 1e-6), `x tick ${tick.value}`).toBe(true);
      }
      for (const tick of axis.ticks!.y) {
        const y = applyMap(map!, 0, tick.value).y;
        expect(subs.some((pts) => pts.some((p) => near(p, { x: rect!.r00.x, y })) && Math.abs(pts[0].y - pts[1].y) < 1e-6), `y tick ${tick.value}`).toBe(true);
      }
    });

    it.skipIf(skip.probes !== undefined)("every tick label has exactly one LuaTeX text box with the same text", () => {
      for (const tick of [...axis.ticks!.x, ...axis.ticks!.y]) {
        const matching = oracle.tier2.textBoxes.filter((tb) => tb.text === tick.label!.text && tb.nesting === 1 &&
          Math.abs(tb.origin.x + tb.width / 2 - tick.label!.anchors.center.x) < 0.01);
        expect(matching.length, `label ${tick.label!.text}`).toBeGreaterThanOrEqual(1);
      }
    });

    it("compares equal to itself and a mutation test behaves as designed", () => {
      expect(compareTier1(oracle.tier1, oracle.tier1).findings).toEqual([]);
      expect(compareTier2(oracle.tier2, oracle.tier2).findings).toEqual([]);
      expect(comparePicture(oracle, structuredClone(oracle)).pass).toBe(true);
      const rows = runMutationTest(oracle, name);
      expect(rows.filter((r) => !r.asExpected).map((r) => `${r.mutation}: ${JSON.stringify(r.detected)}`)).toEqual([]);
      // Mutations need a feature to mutate (a clipped blue plot, a legend, ticks); the controls always apply.
      expect(rows.filter((r) => r.applicable).length).toBeGreaterThanOrEqual(3);
    });
  });

  it("explicit-axis: explicit limits and ticks are honoured exactly, grid lines span the axis", () => {
    const oracle = load("explicit-axis");
    const axis = axisOf(oracle);
    expect(axis.limits).toEqual({ xmin: -1, xmax: 5, ymin: 0, ymax: 10 });
    expect(axis.ticks!.x.map((t) => t.value)).toEqual([-1, 0, 1, 2, 3, 4, 5]);
    expect(axis.ticks!.y.map((t) => t.value)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(axis.descriptions?.title?.text).toBe("Explicitlimits");
    expect(axis.descriptions?.xlabel?.text).toBe("Timet");
    expect(axis.descriptions?.ylabel?.text).toBe("Signal");
    // ylabel is rotated by 90 degrees: its text box runs upwards.
    const ylabel = oracle.tier2.textBoxes.find((tb) => tb.text === "Signal");
    expect(ylabel?.xAxis.x).toBeCloseTo(0, 6);
    expect(ylabel?.xAxis.y).toBeCloseTo(1, 6);
    const { rect, map } = axis;
    const subs = strokes(oracle).flatMap(subpathEnds);
    for (const tick of axis.ticks!.x) {
      const x = applyMap(map!, tick.value, 0).x;
      expect(subs.some((pts) => pts.length === 2 && near(pts[0], { x, y: rect!.r00.y }) && near(pts[1], { x, y: rect!.r01.y })), `grid x=${tick.value}`).toBe(true);
    }
  });

  it("legend-marks: embedded \\draw and \\node go through the data map; legend is named", () => {
    const oracle = load("legend-marks");
    const axis = axisOf(oracle);
    const map = axis.map!;
    const from = applyMap(map, 1.5, 1); const to = applyMap(map, 3.5, 3.5);
    const red = strokes(oracle).find((p) => p.paint && p.paint.components.join(",") === "1,0,0" && subpathEnds(p).some((pts) => pts.length === 2 && near(pts[0], from) && near(pts[1], to)));
    expect(red, "red \\draw between axis cs points").toBeDefined();
    expect(red?.lineWidth).toBeCloseTo(0.8, 2);
    const peak = oracle.tier2.textBoxes.find((tb) => tb.text === "peak");
    expect(peak).toBeDefined();
    // anchor=south at (axis cs:2.5,3.6): the box bottom (inner sep 0.3333em above node south) is above that point.
    const anchorPoint = applyMap(map, 2.5, 3.6);
    expect(peak!.origin.x + peak!.width / 2).toBeCloseTo(anchorPoint.x, 2);
    expect(peak!.origin.y - peak!.depth).toBeGreaterThan(anchorPoint.y);
    expect(axis.descriptions?.legend?.text).toBe("firstsecond");
    const legend = axis.descriptions!.legend!.anchors;
    // legend pos=north west: legend inside the upper-left corner of the axis.
    expect(legend["north west"].x).toBeGreaterThan(axis.rect!.r01.x);
    expect(legend["north west"].y).toBeLessThan(axis.rect!.r01.y);
    // scale only axis: the axis rectangle is exactly 6cm x 4cm.
    expect(axis.rect!.r10.x - axis.rect!.r00.x).toBeCloseTo(6 * 72.27 / 2.54, 2);
    expect(axis.rect!.r01.y - axis.rect!.r00.y).toBeCloseTo(4 * 72.27 / 2.54, 2);
  });
});
