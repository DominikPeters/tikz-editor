import { describe, expect, it } from "vitest";
import { resolveCursorAt, validateDemoScript, type CursorKeyframe, type DemoScript } from "../../packages/app/src/embed/demo-script";

describe("resolveCursorAt", () => {
  const track: CursorKeyframe[] = [
    { t: 0, x: 0, y: 0 },
    { t: 100, x: 100, y: 0, ease: "linear" },
    { t: 200, x: 100, y: 50, ease: "easeOut" }
  ];

  it("returns null for an empty track", () => {
    expect(resolveCursorAt([], 0)).toBeNull();
    expect(resolveCursorAt([], 500)).toBeNull();
  });

  it("clamps to the first keyframe when t is before the start", () => {
    expect(resolveCursorAt(track, -50)).toEqual({ x: 0, y: 0, visible: true, pressed: false, cursor: "pointer" });
  });

  it("clamps to the last keyframe when t is past the end", () => {
    expect(resolveCursorAt(track, 10_000)).toEqual({ x: 100, y: 50, visible: true, pressed: false, cursor: "pointer" });
  });

  it("returns exact keyframe position when t matches", () => {
    const r = resolveCursorAt(track, 100)!;
    expect(r.x).toBe(100);
    expect(r.y).toBe(0);
  });

  it("interpolates linearly between keyframes", () => {
    const r = resolveCursorAt(track, 50)!;
    expect(r.x).toBe(50);
    expect(r.y).toBe(0);
  });

  it("applies the incoming keyframe's easing function", () => {
    const linear = resolveCursorAt(track, 150)!;
    expect(linear.y).toBe(43.75);

    const easeOutTrack: CursorKeyframe[] = [
      { t: 0, x: 0, y: 0 },
      { t: 100, x: 100, y: 0, ease: "easeOut" }
    ];
    const eased = resolveCursorAt(easeOutTrack, 50)!;
    expect(eased.x).toBeGreaterThan(50);
  });

  it("carries forward visibility and pressed state when keyframes omit them", () => {
    const withFlags: CursorKeyframe[] = [
      { t: 0, x: 0, y: 0, visible: true, pressed: true },
      { t: 100, x: 100, y: 0 }
    ];
    const r = resolveCursorAt(withFlags, 50)!;
    expect(r.pressed).toBe(true);
    expect(r.visible).toBe(true);
  });

  it("handles zero-span segments without NaN", () => {
    const dup: CursorKeyframe[] = [
      { t: 50, x: 0, y: 0 },
      { t: 50, x: 100, y: 0 }
    ];
    const r = resolveCursorAt(dup, 50)!;
    expect(Number.isFinite(r.x)).toBe(true);
    expect(Number.isFinite(r.y)).toBe(true);
  });
});

describe("validateDemoScript", () => {
  const base: DemoScript = {
    id: "t",
    duration: 1000,
    initialSource: "",
    cursor: [{ t: 0, x: 0, y: 0 }],
    events: []
  };

  it("accepts a sorted script", () => {
    expect(() => validateDemoScript(base)).not.toThrow();
  });

  it("throws on out-of-order cursor keyframes", () => {
    const bad: DemoScript = {
      ...base,
      cursor: [
        { t: 100, x: 0, y: 0 },
        { t: 50, x: 0, y: 0 }
      ]
    };
    expect(() => validateDemoScript(bad)).toThrow(/cursor keyframes must be sorted/);
  });

  it("throws on out-of-order events", () => {
    const bad: DemoScript = {
      ...base,
      events: [
        { t: 200, kind: "loadSource", source: "a" },
        { t: 100, kind: "loadSource", source: "b" }
      ]
    };
    expect(() => validateDemoScript(bad)).toThrow(/events must be sorted/);
  });

  it("throws on non-positive duration", () => {
    expect(() => validateDemoScript({ ...base, duration: 0 })).toThrow(/duration must be > 0/);
    expect(() => validateDemoScript({ ...base, duration: -1 })).toThrow(/duration must be > 0/);
  });
});
