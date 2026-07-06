import { describe, expect, it } from "vitest";
import type { Statement } from "../../packages/core/src/ast/types.js";
import {
  angleDeg,
  magneticSnapAngleDeg,
  normalizeSignedDeg,
  resolveDraggedRotateDeg,
  resolveRotateHandlePosition,
  snapAngleDeg
} from "../../packages/app/src/ui/canvas-panel/rotate-handle.js";
import { resolveStatementRotateDegrees } from "../../packages/app/src/ui/canvas-panel/panel-helpers.js";
import { sb, sp, wp } from "../coords-helpers.js";

describe("rotate handle geometry", () => {
  it("places the rotate handle outward from the top edge midpoint", () => {
    const frame = {
      sourceId: "path:0",
      centerWorld: wp(0, 0),
      centerSvg: sp(100, 100),
      cornersByRole: {
        "top-left": { world: wp(-1, 1), svg: sp(80, 80) },
        "top-right": { world: wp(1, 1), svg: sp(120, 80) },
        "bottom-right": { world: wp(1, -1), svg: sp(120, 120) },
        "bottom-left": { world: wp(-1, -1), svg: sp(80, 120) }
      },
      polygonSvg: [
        sp(80, 80),
        sp(120, 80),
        sp(120, 120),
        sp(80, 120)
      ],
      boundsSvg: sb(80, 80, 120, 120)
    };

    const result = resolveRotateHandlePosition(frame, 2, 24);
    expect(result.anchorSvg.x).toBeCloseTo(100, 6);
    expect(result.anchorSvg.y).toBeCloseTo(80, 6);
    expect(result.handleSvg.x).toBeCloseTo(100, 6);
    expect(result.handleSvg.y).toBeCloseTo(68, 6);
  });
});

describe("rotate angle utilities", () => {
  it("normalizes signed angles around the wrap boundary", () => {
    expect(normalizeSignedDeg(190)).toBeCloseTo(-170, 9);
    expect(normalizeSignedDeg(-190)).toBeCloseTo(170, 9);
    expect(normalizeSignedDeg(-170 - 170)).toBeCloseTo(20, 9);
  });

  it("snaps angles to the nearest increment when requested", () => {
    expect(snapAngleDeg(22, 15)).toBe(15);
    expect(snapAngleDeg(23, 15)).toBe(30);
  });

  it("returns the raw angle when snapping is disabled", () => {
    expect(snapAngleDeg(22.75, 0)).toBe(22.75);
    expect(snapAngleDeg(22.75, -1)).toBe(22.75);
  });

  it("magnetically snaps to right angles within threshold", () => {
    expect(magneticSnapAngleDeg(87, 90, 7)).toBe(90);
    expect(magneticSnapAngleDeg(94, 90, 7)).toBe(90);
    expect(magneticSnapAngleDeg(-178, 90, 7)).toBe(-180);
  });

  it("keeps free rotation when outside magnetic threshold", () => {
    expect(magneticSnapAngleDeg(82, 90, 7)).toBe(82);
    expect(magneticSnapAngleDeg(100, 90, 7)).toBe(100);
  });

  it("snaps Shift rotation to absolute 15-degree multiples", () => {
    // base=2 and pointer-delta=15 -> rawRotate=17; absolute snapping should go to 15.
    expect(
      resolveDraggedRotateDeg({
        baseRotateDeg: 2,
        startPointerAngleDeg: 10,
        currentPointerAngleDeg: 25,
        shiftKey: true,
        ctrlOrMetaKey: false
      })
    ).toBe(15);
  });

  it("disables 90-degree magnetic snapping when ctrl/meta is held", () => {
    const withMagnet = resolveDraggedRotateDeg({
      baseRotateDeg: 0,
      startPointerAngleDeg: 0,
      currentPointerAngleDeg: 87,
      shiftKey: false,
      ctrlOrMetaKey: false
    });
    const withoutMagnet = resolveDraggedRotateDeg({
      baseRotateDeg: 0,
      startPointerAngleDeg: 0,
      currentPointerAngleDeg: 87,
      shiftKey: false,
      ctrlOrMetaKey: true
    });

    expect(withMagnet).toBe(90);
    expect(withoutMagnet).toBe(87);
  });

  it("computes world-space angles from center and pointer", () => {
    expect(angleDeg(wp(0, 0), wp(1, 1))).toBeCloseTo(45, 9);
    expect(angleDeg(wp(0, 0), wp(-1, -1))).toBeCloseTo(-135, 9);
  });
});

describe("statement rotate extraction", () => {
  it("extracts rotate and /tikz/rotate values with last-key precedence", () => {
    const statement: Statement = {
      kind: "Path",
      id: "path:0",
      span: { from: 0, to: 10 },
      command: "draw",
      items: [],
      options: {
        span: { from: 5, to: 15 },
        raw: "[rotate=10, /tikz/rotate=12]",
        entries: [
          { kind: "kv", key: "rotate", valueRaw: "10", span: { from: 6, to: 15 }, raw: "rotate=10" },
          { kind: "kv", key: "/tikz/rotate", valueRaw: "12", span: { from: 17, to: 31 }, raw: "/tikz/rotate=12" }
        ]
      }
    };

    expect(resolveStatementRotateDegrees(statement)).toBe(12);
  });

  it("extracts rotate around angle values for handle drags", () => {
    const statement: Statement = {
      kind: "Path",
      id: "path:0",
      span: { from: 0, to: 10 },
      command: "draw",
      items: [],
      options: {
        span: { from: 5, to: 40 },
        raw: "[rotate around={32:(3.09,0.79)}]",
        entries: [
          {
            kind: "kv",
            key: "rotate around",
            valueRaw: "{32:(3.09,0.79)}",
            span: { from: 6, to: 39 },
            raw: "rotate around={32:(3.09,0.79)}"
          }
        ]
      }
    };

    expect(resolveStatementRotateDegrees(statement)).toBe(32);
  });

  it("uses the last recognized rotate-like transform for handle drags", () => {
    const statement: Statement = {
      kind: "Path",
      id: "path:0",
      span: { from: 0, to: 10 },
      command: "draw",
      items: [],
      options: {
        span: { from: 5, to: 55 },
        raw: "[rotate around={32:(3.09,0.79)}, rotate=10]",
        entries: [
          {
            kind: "kv",
            key: "rotate around",
            valueRaw: "{32:(3.09,0.79)}",
            span: { from: 6, to: 39 },
            raw: "rotate around={32:(3.09,0.79)}"
          },
          { kind: "kv", key: "rotate", valueRaw: "10", span: { from: 41, to: 50 }, raw: "rotate=10" }
        ]
      }
    };

    expect(resolveStatementRotateDegrees(statement)).toBe(10);
  });

  it("falls back to zero for missing or invalid rotate values", () => {
    const noRotate: Statement = {
      kind: "Path",
      id: "path:0",
      span: { from: 0, to: 10 },
      command: "draw",
      items: [],
      options: { span: { from: 0, to: 2 }, raw: "[]", entries: [] }
    };
    const invalidRotate: Statement = {
      kind: "Path",
      id: "path:1",
      span: { from: 0, to: 10 },
      command: "draw",
      items: [],
      options: {
        span: { from: 0, to: 12 },
        raw: "[rotate=foo]",
        entries: [{ kind: "kv", key: "rotate", valueRaw: "foo", span: { from: 1, to: 11 }, raw: "rotate=foo" }]
      }
    };

    expect(resolveStatementRotateDegrees(noRotate)).toBe(0);
    expect(resolveStatementRotateDegrees(invalidRotate)).toBe(0);
    expect(resolveStatementRotateDegrees(null)).toBe(0);
  });
});
