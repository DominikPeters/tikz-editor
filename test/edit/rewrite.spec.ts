import { describe, expect, it } from "vitest";

import type { WorldPoint } from "../../packages/core/src/coords/points.js";
import { frameToWorldTransform } from "../../packages/core/src/coords/transforms.js";
import type { EditHandle } from "../../packages/core/src/semantic/types.js";
import { identityMatrix, scaleMatrix, rotationMatrix, multiplyMatrix, translationMatrix } from "../../packages/core/src/semantic/transform.js";
import { rewriteCoordinate, supportsUnsupportedCoordinateDetach } from "../../packages/core/src/edit/rewrite.js";
import { PT_PER_CM } from "../../packages/core/src/edit/format.js";
import type { EditHandleSourceRef } from "../../packages/core/src/semantic/types.js";
import { flp, wp } from "../coords-helpers.js";

const cm = (value: number): number => value * PT_PER_CM;

function makeHandle(
  overrides: Omit<Partial<EditHandle>, "sourceRef" | "runtimeId"> & {
    runtimeId?: string;
    world: WorldPoint;
    sourceRef?: Partial<EditHandleSourceRef> & { sourceSpan: { from: number; to: number } };
    coordinateSpace?: "frame-local" | "world-only";
  }
): EditHandle {
  const sourceRefOverrides: Partial<EditHandleSourceRef> = overrides.sourceRef ?? {};
  const mergedSourceRef: EditHandleSourceRef = {
    sourceId: sourceRefOverrides.sourceId ?? "test-source-id",
    sourceSpan: sourceRefOverrides.sourceSpan ?? { from: 0, to: 0 },
    sourceFingerprint: sourceRefOverrides.sourceFingerprint ?? "test"
  };
  const { sourceRef: _unusedSourceRef, runtimeId, ...rest } = overrides;
  const transform = rest.transform ?? identityMatrix();
  const kind = rest.kind ?? "path-point";
  if ("positioningContext" in rest && rest.positioningContext) {
    return {
      id: "test-handle",
      runtimeId: runtimeId ?? "runtime:test-handle",
      handleType: "node-positioning",
      kind: "node-position",
      sourceText: "",
      coordinateForm: "cartesian",
      transform,
      rewriteMode: "positioning",
      ...rest,
      sourceRef: mergedSourceRef
    } as EditHandle;
  }

  if ("pathAttachmentContext" in rest && rest.pathAttachmentContext) {
    return {
      id: "test-handle",
      runtimeId: runtimeId ?? "runtime:test-handle",
      handleType: "path-attachment",
      kind: "node-position",
      sourceText: "",
      coordinateForm: "cartesian",
      transform,
      rewriteMode: "positioning",
      ...rest,
      sourceRef: mergedSourceRef
    } as EditHandle;
  }

  if ("curveEdit" in rest && rest.curveEdit) {
    return {
      id: "test-handle",
      runtimeId: runtimeId ?? "runtime:test-handle",
      handleType: "curve-control",
      kind,
      sourceText: "",
      coordinateForm: "cartesian",
      transform,
      rewriteMode: "direct",
      ...rest,
      sourceRef: mergedSourceRef
    } as EditHandle;
  }

  const rewriteMode = rest.rewriteMode ?? "direct";
  const coordinateSpace =
    rewriteMode === "unsupported" && rest.coordinateForm === "named" && !("local" in rest) && !("frame" in rest)
      ? "world-only"
      : "frame-local";
  return {
    id: "test-handle",
    runtimeId: runtimeId ?? "runtime:test-handle",
    handleType: "coordinate",
    coordinateSpace,
    kind,
    sourceText: "",
    coordinateForm: "cartesian",
    transform,
    rewriteMode,
    local: coordinateSpace === "frame-local" ? (rest.local ?? rest.world) : undefined,
    frame: coordinateSpace === "frame-local" ? (rest.frame ?? transform) : undefined,
    ...rest,
    sourceRef: mergedSourceRef
  } as EditHandle;
}

describe("rewriteCoordinate", () => {
  describe("cartesian", () => {
    it("rewrites with identity transform", () => {
      const source = "\\draw (1,2) -- (3,4);";
      const handle = makeHandle({
        world: wp(cm(1), cm(2)),
        sourceRef: { sourceSpan: { from: 6, to: 11 } },
        coordinateForm: "cartesian"
      });
      const result = rewriteCoordinate(wp(cm(5), cm(6)), handle, source);
      expect(result).toBe("(5,6)");
    });

    it("preserves whitespace from original coordinate", () => {
      const source = "\\draw (1, 2) -- (3,4);";
      const handle = makeHandle({
        world: wp(cm(1), cm(2)),
        sourceRef: { sourceSpan: { from: 6, to: 12 } },
        coordinateForm: "cartesian"
      });
      const result = rewriteCoordinate(wp(cm(5), cm(6)), handle, source);
      expect(result).toBe("(5, 6)");
    });

    it("rewrites with xscale=2 — local x is halved", () => {
      const transform = scaleMatrix(2, 1);
      const source = "\\draw (1,2);";
      const handle = makeHandle({
        world: wp(cm(2), cm(2)),
        sourceRef: { sourceSpan: { from: 6, to: 11 } },
        coordinateForm: "cartesian",
        transform
      });
      // Move to world (4cm, 3cm) → local should be (2cm, 3cm)
      const result = rewriteCoordinate(wp(cm(4), cm(3)), handle, source);
      expect(result).toBe("(2,3)");
    });

    it("rewrites with rotate=90", () => {
      const transform = rotationMatrix(90);
      const source = "\\draw (0,1);";
      const handle = makeHandle({
        world: wp(cm(-1), cm(0)),
        sourceRef: { sourceSpan: { from: 6, to: 11 } },
        coordinateForm: "cartesian",
        transform
      });
      // Move to world (0, 1cm) → local should be (1, 0) after inverse rotation
      // rotate(90): (x,y) -> (-y, x). So inverse: (x,y) -> (y, -x)
      // world (0, cm(1)) -> local (cm(1), 0)
      const result = rewriteCoordinate(wp(0, cm(1)), handle, source);
      expect(result).not.toBeNull();
      // Parse the result to verify
      const match = result!.match(/^\(([^,]+),([^)]+)\)$/);
      expect(match).not.toBeNull();
      const x = parseFloat(match![1]);
      const y = parseFloat(match![2]);
      expect(x).toBeCloseTo(1, 2);
      expect(y).toBeCloseTo(0, 2);
    });

    it("rewrites with combined scale and translation", () => {
      const transform = multiplyMatrix(translationMatrix(cm(10), 0), scaleMatrix(2, 1));
      const source = "\\draw (1,2);";
      const handle = makeHandle({
        world: wp(cm(12), cm(2)),
        sourceRef: { sourceSpan: { from: 6, to: 11 } },
        coordinateForm: "cartesian",
        transform
      });
      // Move to world (cm(14), cm(4))
      // inverse: first undo translation (-10cm), then undo scale (/2)
      // (14-10)/2 = 2, 4/1 = 4
      const result = rewriteCoordinate(wp(cm(14), cm(4)), handle, source);
      expect(result).toBe("(2,4)");
    });

    it("formats fractional coordinates cleanly", () => {
      const source = "\\draw (1,2);";
      const handle = makeHandle({
        world: wp(cm(1), cm(2)),
        sourceRef: { sourceSpan: { from: 6, to: 11 } },
        coordinateForm: "cartesian"
      });
      const result = rewriteCoordinate(wp(cm(1.5), cm(2.25)), handle, source);
      expect(result).toBe("(1.5,2.25)");
    });
  });

  describe("polar", () => {
    it("rewrites preserving polar form", () => {
      const source = "\\draw (45:2);";
      const handle = makeHandle({
        world: wp(cm(Math.SQRT2), cm(Math.SQRT2)),
        sourceRef: { sourceSpan: { from: 6, to: 12 } },
        coordinateForm: "polar"
      });
      // Move to (0, 3cm) → angle=90, radius=3
      const result = rewriteCoordinate(wp(0, cm(3)), handle, source);
      expect(result).not.toBeNull();
      expect(result).toMatch(/^\(\d+(\.\d+)?:\d+(\.\d+)?\)$/);
      const match = result!.match(/^\(([^:]+):([^)]+)\)$/);
      expect(parseFloat(match![1])).toBeCloseTo(90, 1);
      expect(parseFloat(match![2])).toBeCloseTo(3, 2);
    });

    it("handles angle normalization (negative to positive)", () => {
      const source = "\\draw (0:1);";
      const handle = makeHandle({
        world: wp(cm(1), 0),
        sourceRef: { sourceSpan: { from: 6, to: 11 } },
        coordinateForm: "polar"
      });
      // Move to (0, -1cm) → angle=270, radius=1
      const result = rewriteCoordinate(wp(0, cm(-1)), handle, source);
      expect(result).not.toBeNull();
      const match = result!.match(/^\(([^:]+):([^)]+)\)$/);
      expect(parseFloat(match![1])).toBeCloseTo(270, 1);
      expect(parseFloat(match![2])).toBeCloseTo(1, 2);
    });

    it("preserves coordinate-local options and spacing", () => {
      const source = "\\draw ([xshift=3pt] 45: 2);";
      const rawCoordinate = "([xshift=3pt] 45: 2)";
      const from = source.indexOf(rawCoordinate);
      const to = from + rawCoordinate.length;
      const handle = makeHandle({
        world: wp(cm(Math.SQRT2), cm(Math.SQRT2)),
        sourceRef: { sourceSpan: { from, to } },
        coordinateForm: "polar"
      });
      const result = rewriteCoordinate(wp(0, cm(3)), handle, source);
      expect(result).toBe("([xshift=3pt] 90: 3)");
    });
  });

  describe("delta (relative coordinates)", () => {
    it("rewrites ++ coordinate as delta from base", () => {
      const source = "\\draw (0,0) -- ++(1,1);";
      const handle = makeHandle({
        world: wp(cm(1), cm(1)),
        sourceRef: { sourceSpan: { from: 18, to: 23 } },
        coordinateForm: "cartesian",
        rewriteMode: "delta",
        relativePrefix: "++",
        relativeBase: wp(0, 0)
      });
      // Move to (2cm, 3cm) → delta from base (0,0) = (2,3)
      const result = rewriteCoordinate(wp(cm(2), cm(3)), handle, source);
      // Relative prefix is outside the source span and must not be duplicated.
      expect(result).toBe("(2,3)");
    });

    it("rewrites + coordinate preserving prefix", () => {
      const source = "\\draw (0,0) -- +(1,0);";
      const handle = makeHandle({
        world: wp(cm(1), 0),
        sourceRef: { sourceSpan: { from: 17, to: 22 } },
        coordinateForm: "cartesian",
        rewriteMode: "delta",
        relativePrefix: "+",
        relativeBase: wp(0, 0)
      });
      const result = rewriteCoordinate(wp(cm(3), cm(1)), handle, source);
      // Relative prefix is outside the source span and must not be duplicated.
      expect(result).toBe("(3,1)");
    });

    it("preserves coordinate-local options for relative coordinates", () => {
      const source = "\\draw (1,1) -- ++([xshift=3pt] 1, 0);";
      const rawCoordinate = "([xshift=3pt] 1, 0)";
      const from = source.indexOf(rawCoordinate);
      const to = from + rawCoordinate.length;
      const handle = makeHandle({
        world: wp(cm(2), cm(1)),
        sourceRef: { sourceSpan: { from, to } },
        coordinateForm: "cartesian",
        rewriteMode: "delta",
        relativePrefix: "++",
        relativeBase: wp(cm(1), cm(1))
      });
      const result = rewriteCoordinate(wp(cm(3), cm(2)), handle, source);
      expect(result).toBe("([xshift=3pt] 2, 1)");
    });

    it("rewrites relative polar coordinates and rejects relative xyz coordinates", () => {
      const source = "\\draw (0,0) -- ++(45:1) -- ++(1,2,3);";
      const polarRaw = "(45:1)";
      const polarFrom = source.indexOf(polarRaw);
      const polarHandle = makeHandle({
        world: wp(cm(1), cm(1)),
        sourceRef: { sourceSpan: { from: polarFrom, to: polarFrom + polarRaw.length } },
        coordinateForm: "polar",
        rewriteMode: "delta",
        relativePrefix: "++",
        relativeBase: wp(cm(1), cm(1))
      });

      expect(rewriteCoordinate(wp(cm(1), cm(4)), polarHandle, source)).toBe("(90:3)");

      const xyzRaw = "(1,2,3)";
      const xyzFrom = source.indexOf(xyzRaw);
      const xyzHandle = makeHandle({
        world: wp(cm(1), cm(2)),
        sourceRef: { sourceSpan: { from: xyzFrom, to: xyzFrom + xyzRaw.length } },
        coordinateForm: "xyz",
        rewriteMode: "delta",
        relativePrefix: "++",
        relativeBase: wp(0, 0)
      });

      expect(rewriteCoordinate(wp(cm(2), cm(3)), xyzHandle, source)).toBeNull();
    });

    it("returns null when relativeBase is missing", () => {
      const source = "\\draw ++(1,1);";
      const handle = makeHandle({
        world: wp(cm(1), cm(1)),
        sourceRef: { sourceSpan: { from: 6, to: 12 } },
        coordinateForm: "cartesian",
        rewriteMode: "delta",
        relativePrefix: "++"
        // no relativeBase
      });
      const result = rewriteCoordinate(wp(cm(2), cm(2)), handle, source);
      expect(result).toBeNull();
    });

    it("returns null for malformed delta handles and singular delta transforms", () => {
      const source = "\\draw ++(1,1);";
      const directHandle = makeHandle({
        world: wp(cm(1), cm(1)),
        sourceRef: { sourceSpan: { from: 8, to: 13 } },
        coordinateForm: "cartesian",
        rewriteMode: "direct"
      }) as EditHandle & { rewriteMode: "delta" };

      expect(rewriteCoordinate(wp(cm(2), cm(2)), { ...directHandle, rewriteMode: "delta" }, source)).toBeNull();

      const singularHandle = makeHandle({
        world: wp(cm(1), cm(1)),
        sourceRef: { sourceSpan: { from: 8, to: 13 } },
        coordinateForm: "cartesian",
        rewriteMode: "delta",
        relativePrefix: "++",
        relativeBase: wp(0, 0),
        transform: scaleMatrix(0, 1)
      });

      expect(rewriteCoordinate(wp(cm(2), cm(2)), singularHandle, source)).toBeNull();
    });
  });

  describe("unsupported", () => {
    it("returns null for xyz direct coordinates", () => {
      const source = "\\draw (1,2,3);";
      const handle = makeHandle({
        world: wp(cm(1), cm(2)),
        sourceRef: { sourceSpan: { from: 6, to: 13 } },
        coordinateForm: "xyz",
        rewriteMode: "direct"
      });
      const result = rewriteCoordinate(wp(cm(2), cm(3)), handle, source);
      expect(result).toBeNull();
    });

    it("rewrites named path endpoints in unsupported mode to detached cartesian coordinates", () => {
      const source = "\\draw (A);";
      const handle = makeHandle({
        world: wp(cm(1), cm(1)),
        sourceRef: { sourceSpan: { from: 6, to: 9 } },
        kind: "path-point",
        coordinateForm: "named",
        rewriteMode: "unsupported"
      });
      const result = rewriteCoordinate(wp(cm(2), cm(2)), handle, source);
      expect(result).toBe("(2,2)");
    });

    it("detaches frame-local named path endpoints in local source units", () => {
      const source = "\\draw[xscale=2] (A);";
      const handle = makeHandle({
        world: wp(cm(2), cm(1)),
        sourceRef: { sourceSpan: { from: source.indexOf("(A)"), to: source.indexOf("(A)") + 3 } },
        kind: "path-point",
        coordinateForm: "named",
        rewriteMode: "unsupported",
        transform: scaleMatrix(2, 1),
        coordinateSpace: "frame-local",
        frame: frameToWorldTransform(2, 0, 0, 1, 0, 0),
        local: flp(cm(1), cm(1))
      });

      expect(supportsUnsupportedCoordinateDetach(handle)).toBe(true);
      expect(rewriteCoordinate(wp(cm(6), cm(4)), handle, source)).toBe("(3,4)");
    });

    it("returns null for unsupported non-endpoint handles", () => {
      const source = "\\draw (A) .. controls (B) .. (C);";
      const handle = makeHandle({
        world: wp(cm(1), cm(1)),
        sourceRef: { sourceSpan: { from: 21, to: 24 } },
        kind: "path-control",
        coordinateForm: "named",
        rewriteMode: "unsupported"
      });
      const result = rewriteCoordinate(wp(cm(2), cm(2)), handle, source);
      expect(result).toBeNull();
    });

    it("returns null for calc coordinates", () => {
      const source = "\\draw ($0.5*(A)+0.5*(B)$);";
      const handle = makeHandle({
        world: wp(cm(1), cm(1)),
        sourceRef: { sourceSpan: { from: 6, to: 25 } },
        coordinateForm: "calc",
        rewriteMode: "unsupported"
      });
      const result = rewriteCoordinate(wp(cm(2), cm(2)), handle, source);
      expect(result).toBeNull();
    });

    it("returns null for malformed unsupported and direct coordinate handles", () => {
      const source = "\\draw (A) -- (1,2) -- (45:1);";
      const malformedNamed = {
        ...makeHandle({
          world: wp(cm(1), cm(1)),
          sourceRef: { sourceSpan: { from: 6, to: 9 } },
          kind: "path-point",
          coordinateForm: "named",
          rewriteMode: "unsupported"
        }),
        handleType: "path-attachment"
      } as unknown as EditHandle;

      expect(rewriteCoordinate(wp(cm(2), cm(2)), malformedNamed, source)).toBeNull();

      const worldOnlyCartesian = makeHandle({
        world: wp(cm(1), cm(2)),
        sourceRef: { sourceSpan: { from: source.indexOf("(1,2)"), to: source.indexOf("(1,2)") + 5 } },
        coordinateForm: "cartesian",
        rewriteMode: "unsupported",
        coordinateSpace: "world-only"
      });

      expect(rewriteCoordinate(wp(cm(2), cm(3)), { ...worldOnlyCartesian, rewriteMode: "direct" } as unknown as EditHandle, source)).toBeNull();

      const worldOnlyPolar = {
        ...worldOnlyCartesian,
        coordinateForm: "polar",
        sourceRef: { sourceId: "test-source-id", sourceFingerprint: "test", sourceSpan: { from: source.indexOf("(45:1)"), to: source.indexOf("(45:1)") + 6 } }
      } as EditHandle;

      expect(rewriteCoordinate(wp(0, cm(2)), worldOnlyPolar, source)).toBeNull();
    });

    it("returns null when singular transforms prevent direct coordinate rewrites", () => {
      const source = "\\draw (1,2) -- (45:1);";
      const cartesianRaw = "(1,2)";
      const cartesianFrom = source.indexOf(cartesianRaw);
      const polarRaw = "(45:1)";
      const polarFrom = source.indexOf(polarRaw);

      const singularCartesian = makeHandle({
        world: wp(cm(1), cm(2)),
        sourceRef: { sourceSpan: { from: cartesianFrom, to: cartesianFrom + cartesianRaw.length } },
        coordinateForm: "cartesian",
        transform: scaleMatrix(0, 1)
      });
      const singularPolar = makeHandle({
        world: wp(cm(1), cm(1)),
        sourceRef: { sourceSpan: { from: polarFrom, to: polarFrom + polarRaw.length } },
        coordinateForm: "polar",
        transform: scaleMatrix(0, 1)
      });

      expect(rewriteCoordinate(wp(cm(2), cm(3)), singularCartesian, source)).toBeNull();
      expect(rewriteCoordinate(wp(cm(2), cm(3)), singularPolar, source)).toBeNull();
    });

    it("adds inline node at insertion with source-aware spacing", () => {
      const source = "\\node[draw]circle;";
      const insertBeforeWord = makeHandle({
        world: wp(0, 0),
        sourceRef: { sourceSpan: { from: 11, to: 11 } },
        coordinateForm: "cartesian",
        insertion: { kind: "node-inline-at" }
      });
      const insertAtEnd = makeHandle({
        world: wp(0, 0),
        sourceRef: { sourceSpan: { from: source.length, to: source.length } },
        coordinateForm: "cartesian",
        insertion: { kind: "node-inline-at" }
      });
      const insertAfterWhitespace = makeHandle({
        world: wp(0, 0),
        sourceRef: { sourceSpan: { from: 12, to: 12 } },
        coordinateForm: "cartesian",
        insertion: { kind: "node-inline-at" }
      });

      expect(rewriteCoordinate(wp(cm(1), cm(2)), insertBeforeWord, source)).toBe(" at (1,2) ");
      expect(rewriteCoordinate(wp(cm(1), cm(2)), insertAtEnd, source)).toBe(" at (1,2)");
      expect(rewriteCoordinate(wp(cm(1), cm(2)), insertAfterWhitespace, "\\node[draw] circle;")).toBe("at (1,2) ");
    });
  });

  describe("positioning", () => {
    it("rewrites right= to updated distance when dragged horizontally", () => {
      const source = "right=1cm of A";
      const handle = makeHandle({
        world: wp(cm(1), cm(0)),
        sourceRef: { sourceSpan: { from: 0, to: source.length } },
        sourceText: source,
        rewriteMode: "positioning",
        positioningContext: {
          direction: "right",
          targetNodeName: "A",
          targetCenter: wp(0, 0),
          currentCenter: wp(0, 0),
          legacyOf: false,
          targetAnchorHW: 0, targetAnchorHH: 0,
          currentAnchorHW: 0, currentAnchorHH: 0
        }
      });
      const result = rewriteCoordinate(wp(cm(2.5), cm(0)), handle, source);
      expect(result).toBe("right=2.5cm of A");
    });

    it("rewrites to compound direction when dragged diagonally", () => {
      const source = "right=1cm of A";
      const handle = makeHandle({
        world: wp(cm(1), cm(0)),
        sourceRef: { sourceSpan: { from: 0, to: source.length } },
        sourceText: source,
        rewriteMode: "positioning",
        positioningContext: {
          direction: "right",
          targetNodeName: "A",
          targetCenter: wp(0, 0),
          currentCenter: wp(0, 0),
          legacyOf: false,
          targetAnchorHW: 0, targetAnchorHH: 0,
          currentAnchorHW: 0, currentAnchorHH: 0
        }
      });
      const result = rewriteCoordinate(wp(cm(2), cm(1.5)), handle, source);
      expect(result).toBe("above right={1.5cm and 2cm} of A");
    });

    it("snaps to cardinal direction when one component is near zero", () => {
      const source = "above right={1cm and 1cm} of B";
      const handle = makeHandle({
        world: wp(cm(1), cm(1)),
        sourceRef: { sourceSpan: { from: 0, to: source.length } },
        sourceText: source,
        rewriteMode: "positioning",
        positioningContext: {
          direction: "above right",
          targetNodeName: "B",
          targetCenter: wp(0, 0),
          currentCenter: wp(0, 0),
          legacyOf: false,
          targetAnchorHW: 0, targetAnchorHH: 0,
          currentAnchorHW: 0, currentAnchorHH: 0
        }
      });
      // Move to nearly pure vertical
      const result = rewriteCoordinate(wp(cm(0.001), cm(3)), handle, source);
      expect(result).toBe("above=3cm of B");
    });

    it("can leave a diagonal quadrant when one axis clearly dominates", () => {
      const source = "above right={1cm and 1cm} of A";
      const handle = makeHandle({
        world: wp(cm(1), cm(1)),
        sourceRef: { sourceSpan: { from: 0, to: source.length } },
        sourceText: source,
        rewriteMode: "positioning",
        positioningContext: {
          direction: "above right",
          targetNodeName: "A",
          targetCenter: wp(0, 0),
          currentCenter: wp(0, 0),
          legacyOf: false,
          targetAnchorHW: 0, targetAnchorHH: 0,
          currentAnchorHW: 0, currentAnchorHH: 0
        }
      });
      const result = rewriteCoordinate(wp(cm(3), cm(0.6)), handle, source);
      expect(result).toBe("right=3cm of A");
    });

    it("handles negative directions (below left)", () => {
      const source = "right=1cm of A";
      const handle = makeHandle({
        world: wp(cm(1), cm(0)),
        sourceRef: { sourceSpan: { from: 0, to: source.length } },
        sourceText: source,
        rewriteMode: "positioning",
        positioningContext: {
          direction: "right",
          targetNodeName: "A",
          targetCenter: wp(0, 0),
          currentCenter: wp(0, 0),
          legacyOf: false,
          targetAnchorHW: 0, targetAnchorHH: 0,
          currentAnchorHW: 0, currentAnchorHH: 0
        }
      });
      const result = rewriteCoordinate(wp(cm(-2), cm(-1)), handle, source);
      expect(result).toBe("below left={1cm and 2cm} of A");
    });

    it("switches from below right to above right before anchor extents fully clear", () => {
      const source = "below right={1cm and 1cm} of A";
      const handle = makeHandle({
        world: wp(42.492603905500005, -45.97952790549999),
        sourceRef: { sourceSpan: { from: 0, to: source.length } },
        sourceText: source,
        rewriteMode: "positioning",
        positioningContext: {
          direction: "below right",
          targetNodeName: "A",
          targetCenter: wp(0, 0),
          currentCenter: wp(42.492603905500005, -45.97952790549999),
          legacyOf: false,
          targetAnchorHW: 7.0199240000000005,
          targetAnchorHH: 8.763385999999999,
          currentAnchorHW: 7.0199240000000005,
          currentAnchorHH: 8.763385999999999,
          anchorOffsetsByDirection: {
            above: {
              targetAnchor: wp(0, 8.763385999999999),
              currentAnchor: wp(0, -8.763385999999999)
            },
            below: {
              targetAnchor: wp(0, -8.763385999999999),
              currentAnchor: wp(0, 8.763385999999999)
            },
            left: {
              targetAnchor: wp(-7.0199240000000005, 0),
              currentAnchor: wp(7.0199240000000005, 0)
            },
            right: {
              targetAnchor: wp(7.0199240000000005, 0),
              currentAnchor: wp(-7.0199240000000005, 0)
            },
            "above left": {
              targetAnchor: wp(-7.0199240000000005, 8.763385999999999),
              currentAnchor: wp(7.0199240000000005, -8.763385999999999)
            },
            "above right": {
              targetAnchor: wp(7.0199240000000005, 8.763385999999999),
              currentAnchor: wp(-7.0199240000000005, -8.763385999999999)
            },
            "below left": {
              targetAnchor: wp(-7.0199240000000005, -8.763385999999999),
              currentAnchor: wp(7.0199240000000005, 8.763385999999999)
            },
            "below right": {
              targetAnchor: wp(7.0199240000000005, -8.763385999999999),
              currentAnchor: wp(-7.0199240000000005, 8.763385999999999)
            }
          }
        }
      });

      const result = rewriteCoordinate(
        wp(42.492603905500005, 10.925983905500004),
        handle,
        source
      );

      expect(result).toBe("above right={-0.23cm and 1cm} of A");
    });

    it("uses anchor extents when rewriting all cardinal positioning directions", () => {
      const base = {
        targetNodeName: "A",
        targetCenter: wp(0, 0),
        currentCenter: wp(0, 0),
        legacyOf: false,
        targetAnchorHW: cm(0.2),
        targetAnchorHH: cm(0.3),
        currentAnchorHW: cm(0.4),
        currentAnchorHH: cm(0.5)
      };

      for (const [direction, point, expected] of [
        ["left", wp(cm(-2), 0), "left=1.4cm of A"],
        ["above", wp(0, cm(2)), "above=1.2cm of A"],
        ["below", wp(0, cm(-2)), "below=1.2cm of A"]
      ] as const) {
        const handle = makeHandle({
          world: wp(0, 0),
          sourceRef: { sourceSpan: { from: 0, to: direction.length } },
          sourceText: direction,
          rewriteMode: "positioning",
          positioningContext: {
            ...base,
            direction
          }
        });

        expect(rewriteCoordinate(point, handle, direction)).toBe(expected);
      }
    });

    it("keeps the original direction when candidate cardinal shifts do not fit", () => {
      const source = "above right={1cm and 1cm} of A";
      const handle = makeHandle({
        world: wp(cm(1), cm(1)),
        sourceRef: { sourceSpan: { from: 0, to: source.length } },
        sourceText: source,
        rewriteMode: "positioning",
        positioningContext: {
          direction: "above right",
          targetNodeName: "A",
          targetCenter: wp(0, 0),
          currentCenter: wp(0, 0),
          legacyOf: false,
          targetAnchorHW: cm(10),
          targetAnchorHH: 0,
          currentAnchorHW: cm(10),
          currentAnchorHH: 0,
          anchorOffsetsByDirection: {
            above: {
              targetAnchor: wp(cm(-2), 0),
              currentAnchor: wp(0, 0)
            }
          }
        }
      });

      expect(rewriteCoordinate(wp(cm(0.1), cm(3)), handle, source)).toBe("above right={3cm and -19.9cm} of A");
    });

    it("handles unknown and malformed positioning contexts defensively", () => {
      const source = "beside=1cm of A";
      const unknownDirection = makeHandle({
        world: wp(0, 0),
        sourceRef: { sourceSpan: { from: 0, to: source.length } },
        sourceText: source,
        rewriteMode: "positioning",
        positioningContext: {
          direction: "beside",
          targetNodeName: "A",
          targetCenter: wp(0, 0),
          currentCenter: wp(0, 0),
          legacyOf: false,
          targetAnchorHW: 0,
          targetAnchorHH: 0,
          currentAnchorHW: 0,
          currentAnchorHH: 0
        }
      });

      expect(rewriteCoordinate(wp(0, 0), unknownDirection, source)).toBeNull();

      const malformed = {
        ...unknownDirection,
        handleType: "coordinate"
      } as unknown as EditHandle;

      expect(rewriteCoordinate(wp(cm(1), 0), malformed, source)).toBeNull();
    });
  });
});
