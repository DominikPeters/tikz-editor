import { describe, expect, it } from "vitest";

import { worldPoint as makeWorldPoint } from "../../packages/core/src/coords/points.js";
import { pt } from "../../packages/core/src/coords/scalars.js";
import type { OptionListAst, OptionEntry } from "../../packages/core/src/options/types.js";
import type { StyleChainEntry } from "../../packages/core/src/semantic/style-chain.js";
import { defaultStyle } from "../../packages/core/src/semantic/style/defaults.js";
import type { PlacementSegment } from "../../packages/core/src/semantic/path/types.js";
import {
  approximatePlacementSegmentLength,
  closestPointOnPlacementSegment,
  normalizePathPosition,
  pointAtPlacementSegment,
  resolveDraggedPathAttachedNodeDirection,
  resolveExplicitDirectionFromPoint,
  resolvePathAttachedDirectionUnit,
  resolvePathAttachedNodeRegime,
  resolvePathAttachedNodeSloped,
  resolvePathPositionFraction,
  resolvePathPositionPreset,
  tangentAtPlacementSegment
} from "../../packages/core/src/semantic/path/path-attached.js";

const span = { from: 0, to: 0 };

function p(x: number, y: number) {
  return makeWorldPoint(pt(x), pt(y));
}

function flag(key: string): OptionEntry {
  return { kind: "flag", key, raw: key, span };
}

function kv(key: string, valueRaw: string): OptionEntry {
  return { kind: "kv", key, valueRaw, raw: `${key}=${valueRaw}`, span };
}

function options(...entries: OptionEntry[]): OptionListAst {
  return { raw: "", span, entries };
}

function style(...lists: OptionListAst[]): StyleChainEntry {
  const resolvedStyle = defaultStyle();
  return {
    kind: "command",
    before: resolvedStyle,
    after: resolvedStyle,
    resolvedContributions: {},
    rawOptions: lists
  };
}

describe("path-attached helpers", () => {
  it("normalizes path positions from presets and pos options", () => {
    expect(normalizePathPosition(Number.NaN)).toBe(0.5);
    expect(normalizePathPosition(-1)).toBe(-1);
    expect(normalizePathPosition(2)).toBe(2);
    expect(resolvePathPositionFraction(undefined)).toBeNull();
    expect(resolvePathPositionFraction(options(flag("near start"), kv("pos", "{1.2}")))).toBe(1.2);
    expect(resolvePathPositionFraction(options(kv("pos", "bad"), flag("near end")))).toBe(0.75);
  });

  it("snaps path positions to presets using normalized and world thresholds", () => {
    const shortLine: PlacementSegment = { kind: "line", from: p(0, 0), to: p(20, 0) };
    const longLine: PlacementSegment = { kind: "line", from: p(0, 0), to: p(2000, 0) };

    expect(resolvePathPositionPreset(0.754, shortLine).preset).toBe("near end");
    expect(resolvePathPositionPreset(0.754, longLine).preset).toBe("near end");
    expect(resolvePathPositionPreset(0.126, shortLine).preset).toBe("very near start");
    expect(resolvePathPositionPreset(0.55, longLine).preset).toBeNull();
    expect(resolvePathPositionPreset(Number.POSITIVE_INFINITY, null).snappedT).toBe(0.5);
    expect(resolvePathPositionPreset(-0.01, shortLine)).toEqual({ preset: null, snappedT: -0.01 });
    expect(resolvePathPositionPreset(1.01, shortLine)).toEqual({ preset: null, snappedT: 1.01 });
  });

  it("samples line, hv, cubic, and arc placement segments", () => {
    const line: PlacementSegment = { kind: "line", from: p(0, 0), to: p(10, 0) };
    const hv: PlacementSegment = { kind: "hv", operator: "-|", from: p(0, 0), bend: p(10, 0), to: p(10, 10) };
    const cubic: PlacementSegment = { kind: "cubic", from: p(0, 0), c1: p(0, 10), c2: p(10, 10), to: p(10, 0) };
    const arc: PlacementSegment = {
      kind: "arc",
      from: p(10, 0),
      to: p(0, 10),
      params: { startAngle: 0, endAngle: 90, rx: 10, ry: 10 }
    };

    expect(approximatePlacementSegmentLength(line)).toBeCloseTo(10, 6);
    expect(approximatePlacementSegmentLength(hv)).toBeCloseTo(20, 6);
    expect(approximatePlacementSegmentLength(arc)).toBeCloseTo(Math.PI * 5, 6);
    expect(pointAtPlacementSegment(hv, 0.75)).toMatchObject({ x: 10, y: 5 });
    expect(pointAtPlacementSegment(cubic, 0.5).x).toBeCloseTo(5, 6);
    expect(pointAtPlacementSegment(arc, 0.5).x).toBeCloseTo(7.071, 3);

    expect(tangentAtPlacementSegment(line, 0.5)).toMatchObject({ x: 10, y: 0 });
    expect(tangentAtPlacementSegment(hv, 0.25)).toMatchObject({ x: 10, y: 0 });
    expect(tangentAtPlacementSegment(hv, 0.75)).toMatchObject({ x: 0, y: 10 });
    expect(tangentAtPlacementSegment(cubic, 0.5).x).toBeGreaterThan(0);
    expect(tangentAtPlacementSegment(cubic, 2)).toMatchObject({ x: -120, y: -90 });
    expect(tangentAtPlacementSegment(arc, 0.5).x).toBeLessThan(0);
    expect(tangentAtPlacementSegment({ ...arc, params: { ...arc.params, startAngle: 90, endAngle: 0 } }, 0.5).x).toBeGreaterThan(0);
  });

  it("finds closest points on straight, bent, cubic, and clockwise arc segments", () => {
    const degenerate: PlacementSegment = { kind: "line", from: p(2, 3), to: p(2, 3) };
    const hv: PlacementSegment = { kind: "hv", operator: "|-", from: p(0, 0), bend: p(0, 10), to: p(10, 10) };
    const cubic: PlacementSegment = { kind: "cubic", from: p(0, 0), c1: p(0, 10), c2: p(10, 10), to: p(10, 0) };
    const clockwiseArc: PlacementSegment = {
      kind: "arc",
      from: p(0, 10),
      to: p(10, 0),
      params: { startAngle: 90, endAngle: 0, rx: 10, ry: 10 }
    };

    expect(closestPointOnPlacementSegment(degenerate, p(50, 50))).toMatchObject({ t: 0, point: { x: 2, y: 3 } });
    expect(closestPointOnPlacementSegment(hv, p(7, 12)).t).toBeGreaterThan(0.5);
    expect(closestPointOnPlacementSegment(hv, p(-2, 4)).t).toBeLessThan(0.5);
    expect(closestPointOnPlacementSegment(cubic, p(5, 9)).point.y).toBeGreaterThan(7);
    expect(closestPointOnPlacementSegment(clockwiseArc, p(7, 7)).t).toBeCloseTo(0.5, 1);
    expect(
      closestPointOnPlacementSegment(
        { kind: "arc", from: p(10, 0), to: p(0, 10), params: { startAngle: 0, endAngle: 0, rx: 10, ry: 10 } },
        p(0, 0)
      ).t
    ).toBe(0);
  });

  it("projects drags onto extrapolated segments while keeping ordinary closest-point queries bounded", () => {
    const line: PlacementSegment = { kind: "line", from: p(0, 0), to: p(10, 0) };
    expect(closestPointOnPlacementSegment(line, p(20, 4)).t).toBe(1);
    expect(closestPointOnPlacementSegment(line, p(20, 4), { extrapolate: true }).t).toBe(2);
    expect(closestPointOnPlacementSegment(line, p(-5, 4), { extrapolate: true }).t).toBe(-0.5);
    const segments: PlacementSegment[] = [
      { kind: "hv", operator: "-|", from: p(0, 0), bend: p(10, 0), to: p(10, 10) },
      { kind: "cubic", from: p(0, 0), c1: p(0, 10), c2: p(10, 10), to: p(10, 0) },
      { kind: "arc", from: p(10, 0), to: p(0, 10), params: { startAngle: 0, endAngle: 90, rx: 10, ry: 10 } },
      { kind: "arc", from: p(0, 10), to: p(10, 0), params: { startAngle: 90, endAngle: 0, rx: 10, ry: 10 } }
    ];
    for (const segment of segments) {
      for (const t of [-0.5, 2, 5.25]) {
        const target = pointAtPlacementSegment(segment, t);
        const projected = closestPointOnPlacementSegment(segment, target, { extrapolate: true, referenceT: t });
        expect(projected.t).toBeCloseTo(t, 3);
        expect(projected.point.x).toBeCloseTo(target.x, 2);
        expect(projected.point.y).toBeCloseTo(target.y, 2);
      }
    }
  });

  it("resolves auto, swap, sloped, and explicit path-attached regimes", () => {
    const inherited = [style(options(kv("auto", "right"), kv("swap", "false"), flag("sloped")))];

    expect(resolvePathAttachedNodeRegime(options(flag("above left")), inherited)).toEqual({
      kind: "explicit-direction",
      direction: "above left",
      family: "cardinal-diagonal"
    });
    expect(resolvePathAttachedNodeRegime(options(flag("auto"), flag("swap")), inherited)).toMatchObject({
      kind: "auto-side",
      side: "right",
      swap: true,
      autoExplicit: true,
      swapExplicit: true
    });
    expect(resolvePathAttachedNodeRegime(options(kv("auto", "yes"), kv("swap", "off")), inherited)).toMatchObject({
      kind: "auto-side",
      side: "left",
      swap: false
    });
    expect(resolvePathAttachedNodeRegime(options(kv("auto", "0")), inherited)).toEqual({ kind: "neutral" });
    expect(resolvePathAttachedNodeRegime(options(kv("auto", "off")), inherited)).toEqual({ kind: "neutral" });
    expect(resolvePathAttachedNodeRegime(undefined, inherited)).toMatchObject({ kind: "auto-side", side: "right" });
    expect(resolvePathAttachedNodeSloped(undefined, inherited)).toBe(true);
    expect(resolvePathAttachedNodeSloped(options(kv("sloped", "on")), inherited)).toBe(true);
    expect(resolvePathAttachedNodeSloped(options(kv("sloped", "no")), inherited)).toBe(false);
  });

  it("resolves explicit dragged directions with axis thresholds", () => {
    const anchor = p(0, 0);

    expect(resolveExplicitDirectionFromPoint(p(0, 5), anchor, "cardinal-diagonal")).toBe("above");
    expect(resolveExplicitDirectionFromPoint(p(0, -5), anchor, "cardinal-diagonal")).toBe("below");
    expect(resolveExplicitDirectionFromPoint(p(5, 0), anchor, "cardinal-diagonal")).toBe("right");
    expect(resolveExplicitDirectionFromPoint(p(-5, 0), anchor, "cardinal-diagonal")).toBe("left");
    expect(resolveExplicitDirectionFromPoint(p(5, 5), anchor, "cardinal-diagonal")).toBe("above right");
    expect(resolveExplicitDirectionFromPoint(p(-5, 5), anchor, "cardinal-diagonal")).toBe("above left");
    expect(resolveExplicitDirectionFromPoint(p(5, -5), anchor, "cardinal-diagonal")).toBe("below right");
    expect(resolveExplicitDirectionFromPoint(p(-5, -5), anchor, "cardinal-diagonal")).toBe("below left");
    expect(resolveExplicitDirectionFromPoint(p(-5, 0), anchor, "base")).toBe("base left");
    expect(resolveExplicitDirectionFromPoint(p(5, 0), anchor, "base")).toBe("base right");
    expect(resolveExplicitDirectionFromPoint(p(5, 0), anchor, "mid")).toBe("mid right");
    expect(resolveExplicitDirectionFromPoint(p(-5, 0), anchor, "mid")).toBe("mid left");

    expect(resolveDraggedPathAttachedNodeDirection(anchor, p(0.5, -8), {
      kind: "explicit-direction",
      direction: "above",
      family: "cardinal-diagonal"
    })).toBe("below");
    expect(resolveDraggedPathAttachedNodeDirection(anchor, p(-8, 0.5), {
      kind: "explicit-direction",
      direction: "right",
      family: "cardinal-diagonal"
    })).toBe("left");
    expect(resolveDraggedPathAttachedNodeDirection(anchor, p(-8, 0), {
      kind: "explicit-direction",
      direction: "base right",
      family: "base"
    })).toBe("base left");
    expect(resolveDraggedPathAttachedNodeDirection(anchor, p(8, 0), {
      kind: "explicit-direction",
      direction: "mid left",
      family: "mid"
    })).toBe("mid right");
    expect(resolveDraggedPathAttachedNodeDirection(anchor, p(0, 8), {
      kind: "explicit-direction",
      direction: "above right",
      family: "cardinal-diagonal"
    })).toBe("above right");
    expect(resolveDraggedPathAttachedNodeDirection(anchor, p(0, -8), {
      kind: "explicit-direction",
      direction: "above right",
      family: "cardinal-diagonal"
    })).toBe("below right");
    expect(resolveDraggedPathAttachedNodeDirection(anchor, p(8, 0), {
      kind: "explicit-direction",
      direction: "above right",
      family: "cardinal-diagonal"
    })).toBe("above right");
    expect(resolveDraggedPathAttachedNodeDirection(anchor, p(-8, 0), {
      kind: "explicit-direction",
      direction: "above right",
      family: "cardinal-diagonal"
    })).toBe("above left");
    expect(resolveDraggedPathAttachedNodeDirection(anchor, p(8, 8), {
      kind: "explicit-direction",
      direction: "below left",
      family: "cardinal-diagonal"
    })).toBe("above right");
    expect(resolveDraggedPathAttachedNodeDirection(anchor, p(-8, 8), {
      kind: "explicit-direction",
      direction: "below right",
      family: "cardinal-diagonal"
    })).toBe("above left");
    expect(resolveDraggedPathAttachedNodeDirection(anchor, p(8, -8), {
      kind: "explicit-direction",
      direction: "above left",
      family: "cardinal-diagonal"
    })).toBe("below right");

    expect(resolvePathAttachedDirectionUnit("above right").x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(resolvePathAttachedDirectionUnit("below").y).toBe(-1);
    expect(resolvePathAttachedDirectionUnit("left").x).toBe(-1);
    expect(resolvePathAttachedDirectionUnit("base left").x).toBe(-1);
    expect(resolvePathAttachedDirectionUnit("unknown")).toMatchObject({ x: 0, y: 0 });
  });
});
