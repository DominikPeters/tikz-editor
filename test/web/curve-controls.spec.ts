import { describe, expect, it } from "vitest";
import type { EditHandle, SceneElement, ScenePath } from "../../packages/core/src/semantic/types.js";
import { identityMatrix } from "../../packages/core/src/semantic/transform.js";
import { deriveCurveControlLines } from "../../packages/app/src/ui/canvas-panel/curve-controls";
import { wp } from "../coords-helpers.js";

function makePath(sourceId: string, commands: ScenePath["commands"]): SceneElement {
  return {
    kind: "Path",
    id: `path:${sourceId}`,
    runtimeId: `runtime:path:${sourceId}`,
    layer: "main",
    sourceRef: {
      sourceId,
      sourceSpan: { from: 0, to: 0 },
      sourceFingerprint: "test-fingerprint"
    },
    style: {} as ScenePath["style"],
    styleChain: [],
    commands
  };
}

function makeControlHandle(id: string, sourceId: string): EditHandle {
  return {
    handleType: "curve-control",
    id,
    runtimeId: `runtime:handle:${id}`,
    sourceRef: {
      sourceId,
      sourceSpan: { from: 0, to: 5 },
      sourceFingerprint: "fingerprint"
    },
    kind: "path-control",
    world: wp(0, 0),
    transform: identityMatrix(),
    sourceText: "(0,0)",
    coordinateForm: "cartesian",
    rewriteMode: "direct"
  } as EditHandle;
}

function makeBendHandle(id: string, sourceId: string): EditHandle {
  return {
    ...makeControlHandle(id, sourceId),
    kind: "path-bend",
    world: wp(1.5, 1),
    curveEdit: {
      kind: "to-bend",
      operationItemId: "to:0",
      startWorld: wp(0, 0),
      endWorld: wp(3, 0),
      baseHeading: 0
    }
  } as EditHandle;
}

describe("deriveCurveControlLines", () => {
  it("derives two helper lines for one cubic Bezier command", () => {
    const elements = [
      makePath("path:0", [
        { kind: "M", to: wp(0, 0) },
        { kind: "C", c1: wp(1, 1), c2: wp(2, 1), to: wp(3, 0) }
      ])
    ];
    const lines = deriveCurveControlLines(elements, new Set(["path:0"]), [makeControlHandle("h0", "path:0")]);

    expect(lines).toHaveLength(2);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: "path:0", from: wp(0, 0), to: wp(1, 1) }),
        expect.objectContaining({ sourceId: "path:0", from: wp(3, 0), to: wp(2, 1) })
      ])
    );
  });

  it("supports multiple cubic commands across subpaths", () => {
    const elements = [
      makePath("path:0", [
        { kind: "M", to: wp(0, 0) },
        { kind: "C", c1: wp(1, 1), c2: wp(2, 1), to: wp(3, 0) },
        { kind: "C", c1: wp(4, 1), c2: wp(5, 1), to: wp(6, 0) },
        { kind: "M", to: wp(10, 0) },
        { kind: "C", c1: wp(11, 1), c2: wp(12, 1), to: wp(13, 0) }
      ])
    ];
    const lines = deriveCurveControlLines(elements, new Set(["path:0"]), [makeControlHandle("h0", "path:0")]);

    expect(lines).toHaveLength(6);
  });

  it("filters to selected sources that actually have path-control handles", () => {
    const elements = [
      makePath("path:0", [
        { kind: "M", to: wp(0, 0) },
        { kind: "C", c1: wp(1, 1), c2: wp(2, 1), to: wp(3, 0) }
      ]),
      makePath("path:1", [
        { kind: "M", to: wp(0, -2) },
        { kind: "C", c1: wp(1, -1), c2: wp(2, -1), to: wp(3, -2) }
      ])
    ];
    const handles: EditHandle[] = [
      makeControlHandle("h0", "path:0"),
      {
        ...makeControlHandle("h1", "path:1"),
        handleType: "coordinate",
        coordinateSpace: "frame-local",
        kind: "path-point"
      } as EditHandle
    ];

    const lines = deriveCurveControlLines(elements, new Set(["path:0", "path:1"]), handles);

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.sourceId === "path:0")).toBe(true);
  });

  it("derives helper lines from endpoints to bend handles", () => {
    const elements = [
      makePath("path:0", [
        { kind: "M", to: wp(0, 0) },
        { kind: "C", c1: wp(1, 1), c2: wp(2, 1), to: wp(3, 0) }
      ])
    ];
    const lines = deriveCurveControlLines(elements, new Set(["path:0"]), [makeBendHandle("hb", "path:0")]);
    expect(lines).toHaveLength(2);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: "path:0", from: wp(0, 0), to: wp(1.5, 1) }),
        expect.objectContaining({ sourceId: "path:0", from: wp(3, 0), to: wp(1.5, 1) })
      ])
    );
  });
});
