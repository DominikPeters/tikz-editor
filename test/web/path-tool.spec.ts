import { describe, expect, it } from "vitest";
import { PT_PER_CM } from "../../packages/core/src/edit/format.js";
import {
  appendPathToolSegmentFromGesture,
  createPathToolDraft,
  generateAppendSegmentSource,
  generatePathToolSource,
  pathToolCloseRadiusWorld,
  pathToolShouldClose
} from "../../packages/app/src/ui/canvas-panel/path-tool.js";
import { wp } from "../coords-helpers.js";

const cm = (value: number): number => value * PT_PER_CM;

describe("path-tool state machine", () => {
  it("starts a draft on first click", () => {
    const draft = createPathToolDraft(wp(cm(1), cm(2)));
    expect(draft.startWorld).toEqual(wp(cm(1), cm(2)));
    expect(draft.segments).toHaveLength(0);
  });

  it("stores an anchor reference for an anchored draft start", () => {
    const draft = createPathToolDraft(
      wp(cm(1), cm(2)),
      undefined,
      { nodeName: "A", anchor: "east" }
    );
    expect(draft.startAnchor).toEqual({ nodeName: "A", anchor: "east" });
  });

  it("adds a straight segment for click-only placement", () => {
    const draft = createPathToolDraft(wp(cm(0), cm(0)));
    const next = appendPathToolSegmentFromGesture(draft, {
      endWorld: wp(cm(1), cm(0)),
      endAnchor: { nodeName: "B", anchor: "north" },
      bendWorld: wp(cm(0.5), cm(0)),
      asBezier: false
    });

    expect(next.segments).toHaveLength(1);
    expect(next.segments[0]).toEqual({
      kind: "line",
      to: wp(cm(1), cm(0)),
      toAnchor: { nodeName: "B", anchor: "north" }
    });
  });

  it("adds a bezier segment for click-hold-drag placement", () => {
    const draft = createPathToolDraft(wp(cm(0), cm(0)));
    const next = appendPathToolSegmentFromGesture(draft, {
      endWorld: wp(cm(2), cm(0)),
      bendWorld: wp(cm(1), cm(1)),
      asBezier: true
    });

    expect(next.segments).toHaveLength(1);
    const segment = next.segments[0];
    expect(segment?.kind).toBe("bezier");
    if (!segment || segment.kind !== "bezier") {
      throw new Error("Expected a bezier segment.");
    }
    expect(segment.to).toEqual(wp(cm(2), cm(0)));
  });

  it("recognizes close intent when clicking near the first point", () => {
    const base = createPathToolDraft(wp(cm(0), cm(0)));
    const withFirst = appendPathToolSegmentFromGesture(base, {
      endWorld: wp(cm(1), cm(0)),
      bendWorld: wp(cm(0.5), cm(0)),
      asBezier: false
    });
    const withSecond = appendPathToolSegmentFromGesture(withFirst, {
      endWorld: wp(cm(1), cm(1)),
      bendWorld: wp(cm(1), cm(0.5)),
      asBezier: false
    });

    const closeRadius = pathToolCloseRadiusWorld(1);
    expect(pathToolShouldClose(withSecond, wp(cm(0.05), cm(0.05)), closeRadius)).toBe(true);
  });

  it("finalizes open paths on escape", () => {
    const base = createPathToolDraft(
      wp(cm(0), cm(0)),
      undefined,
      { nodeName: "A", anchor: "west" }
    );
    const withSegment = appendPathToolSegmentFromGesture(base, {
      endWorld: wp(cm(1), cm(0)),
      endAnchor: { nodeName: "B", anchor: "east" },
      bendWorld: wp(cm(0.5), cm(0)),
      asBezier: false
    });

    const snippet = generatePathToolSource(withSegment, { closed: false });
    expect(snippet).toBe("\\draw (A.west) -- (B.east);");
  });

  it("applies creation stroke color when finalizing new paths", () => {
    const base = createPathToolDraft(wp(cm(0), cm(0)));
    const withSegment = appendPathToolSegmentFromGesture(base, {
      endWorld: wp(cm(1), cm(0)),
      bendWorld: wp(cm(0.5), cm(0)),
      asBezier: false
    });

    const snippet = generatePathToolSource(withSegment, { closed: false, strokeColor: "red" });
    expect(snippet).toBe("\\draw[draw=red] (0,0) -- (1,0);");
  });

  it("does not finalize degenerate drafts with no segments", () => {
    const draft = createPathToolDraft(wp(cm(0), cm(0)));
    expect(generatePathToolSource(draft, { closed: false })).toBeNull();
  });

  it("keeps anchor references when appending to the end of an existing path", () => {
    const base = createPathToolDraft(
      wp(cm(0), cm(0)),
      { elementId: "path:0", end: "end" },
      { nodeName: "A", anchor: "west" }
    );
    const withSegment = appendPathToolSegmentFromGesture(base, {
      endWorld: wp(cm(1), cm(0)),
      endAnchor: { nodeName: "B", anchor: "east" },
      bendWorld: wp(cm(0.5), cm(0)),
      asBezier: false
    });

    expect(generateAppendSegmentSource(withSegment)).toBe("-- (B.east)");
  });

  it("keeps anchor references when prepending to the start of an existing path", () => {
    const base = createPathToolDraft(
      wp(cm(0), cm(0)),
      { elementId: "path:0", end: "start" },
      { nodeName: "A", anchor: "west" }
    );
    const withSegment = appendPathToolSegmentFromGesture(base, {
      endWorld: wp(cm(1), cm(0)),
      endAnchor: { nodeName: "B", anchor: "east" },
      bendWorld: wp(cm(0.5), cm(0)),
      asBezier: false
    });

    expect(generateAppendSegmentSource(withSegment)).toBe("(B.east) --");
  });
});
