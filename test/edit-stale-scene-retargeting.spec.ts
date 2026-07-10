import { describe, expect, it } from "vitest";
import { editorReducer, makeInitialState } from "../packages/app/src/store/reducer.js";
import type { EditorState } from "../packages/app/src/store/types.js";
import type { WorldPoint } from "../packages/core/src/coords/points.js";
import type { EditHandle } from "../packages/core/src/semantic/types.js";
import { identityMatrix } from "../packages/core/src/semantic/transform.js";
import { computeSourceFingerprint } from "../packages/core/src/utils/source-fingerprint.js";
import { makeEmptySnapshot } from "../packages/app/src/compute.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { PT_PER_CM } from "../packages/core/src/edit/format.js";
import { wp } from "./coords-helpers.js";

// Scene/source ids are positional (`path:${statementIndex}`, see
// packages/core/src/ast/ids.ts). The store applies elementId-targeted edit
// actions against the LIVE source (reducer APPLY_EDIT_ACTION recompute), while
// the UI derives those ids from the async, possibly LAGGING snapshot scene
// (canvas hit-testing, selection, inspector descriptors). Whenever the live
// source has gained or lost a statement that the snapshot hasn't caught up
// with, every stale id silently denotes a DIFFERENT element — and the edit
// lands on the wrong object. Handle-based actions are protected against this
// by source fingerprints (see the "guarded" tests at the bottom); elementId-
// based actions have no equivalent guard.
//
// The `it.fails` tests below encode the DESIRED behavior (edit lands on the
// element the user selected, or is rejected as stale). They currently fail —
// i.e. the bug is present. When the staleness guard/id remapping is
// implemented, they will start passing and vitest will flag them so they can
// be promoted to regular tests.

const cm = (v: number) => v * PT_PER_CM;

const RECT_CIRCLE = [
  "\\begin{tikzpicture}",
  "  \\draw (0,0) rectangle (1,1);",
  "  \\draw (3,0) circle (0.5);",
  "\\end{tikzpicture}"
].join("\n");

// The same figure after the user typed a new statement ABOVE the existing
// ones in the code editor: every statement index shifts by one.
const RECT_CIRCLE_EDITED = [
  "\\begin{tikzpicture}",
  "  \\node at (5,5) {note};",
  "  \\draw (0,0) rectangle (1,1);",
  "  \\draw (3,0) circle (0.5);",
  "\\end{tikzpicture}"
].join("\n");

const TWO_NODES = [
  "\\begin{tikzpicture}",
  "  \\node at (0,0) {A};",
  "  \\node at (2,0) {B};",
  "\\end{tikzpicture}"
].join("\n");

const TWO_NODES_EDITED = [
  "\\begin{tikzpicture}",
  "  \\draw (5,5) -- (6,6);",
  "  \\node at (0,0) {A};",
  "  \\node at (2,0) {B};",
  "\\end{tikzpicture}"
].join("\n");

const TWO_RECTS = [
  "\\begin{tikzpicture}",
  "  \\draw (0,0) rectangle (1,1);",
  "  \\draw (3,0) rectangle (4,1);",
  "\\end{tikzpicture}"
].join("\n");

const TWO_RECTS_EDITED = [
  "\\begin{tikzpicture}",
  "  \\node at (5,5) {note};",
  "  \\draw (0,0) rectangle (1,1);",
  "  \\draw (3,0) rectangle (4,1);",
  "\\end{tikzpicture}"
].join("\n");

function makeState(source: string, selectedIds: readonly string[] = []): EditorState {
  const initial = makeInitialState();
  return {
    ...initial,
    source,
    snapshot: { ...makeEmptySnapshot(source), source },
    selectedElementIds: new Set(selectedIds)
  };
}

function elementIdContaining(source: string, needle: string): string {
  const rendered = renderTikzToSvg(source, {
    parse: { recover: true, includeContextDefinitions: true }
  });
  const element = rendered.semantic.scene.elements.find((candidate) =>
    source.slice(candidate.sourceRef.sourceSpan.from, candidate.sourceRef.sourceSpan.to).includes(needle)
  );
  if (!element) {
    throw new Error(`No scene element found whose source contains "${needle}"`);
  }
  return element.sourceRef.sourceId;
}

describe("stale scene id retargeting (positional sourceIds + lagging snapshot)", () => {
  it.fails("inspector property write lands on the element the user selected, not on a shifted id", () => {
    // The user selects the circle on the canvas. The scene rendered from
    // RECT_CIRCLE resolves that click to "path:1".
    const circleId = elementIdContaining(RECT_CIRCLE, "circle");
    expect(circleId).toBe("path:1");

    let state = makeState(RECT_CIRCLE, [circleId]);

    // The user types a new statement above it in the code editor. Selection
    // survives CODE_EDITED by id, but every statement index below the
    // insertion has shifted; the snapshot has not been recomputed yet.
    state = editorReducer(state, { type: "CODE_EDITED", source: RECT_CIRCLE_EDITED });
    expect(state.selectedElementIds.has(circleId)).toBe(true);

    // Before SNAPSHOT_READY arrives, the user clicks a color swatch in the
    // inspector. The inspector dispatches setProperty with the stale id.
    state = editorReducer(state, {
      type: "APPLY_EDIT_ACTION",
      action: { kind: "setProperty", elementId: circleId, level: "command", key: "fill", value: "blue" }
    });

    // Desired: the fill lands on the circle (or the action is rejected as
    // stale). Actual today: "path:1" now denotes the RECTANGLE, which gets
    // fill=blue while the circle is untouched.
    const circleLine = state.source.split("\n").find((line) => line.includes("circle")) ?? "";
    const rectangleLine = state.source.split("\n").find((line) => line.includes("rectangle")) ?? "";
    expect(circleLine).toContain("fill=blue");
    expect(rectangleLine).not.toContain("fill=blue");
  });

  it.fails("delete after duplicate removes the element the user clicked, not the fresh duplicate", () => {
    // Pure-WYSIWYG sequence, no code editing involved. The user duplicates
    // the rectangle (path:0); the copy is inserted directly after the
    // original, so the circle shifts from path:1 to path:2.
    let state = makeState(RECT_CIRCLE, ["path:0"]);
    state = editorReducer(state, {
      type: "APPLY_EDIT_ACTION",
      action: { kind: "duplicateElements", elementIds: ["path:0"] }
    });

    // The canvas still shows the pre-duplicate scene (SNAPSHOT_READY has not
    // arrived). The user clicks the circle; stale hit-testing resolves the
    // click to "path:1". They press Delete.
    const staleCircleId = elementIdContaining(RECT_CIRCLE, "circle");
    state = editorReducer(state, {
      type: "APPLY_EDIT_ACTION",
      action: { kind: "deleteElement", elementId: staleCircleId }
    });

    // Desired: the circle is gone and both rectangles remain. Actual today:
    // the freshly inserted duplicate is deleted and the circle survives.
    expect(state.source).not.toContain("circle");
    expect(state.source.split("rectangle").length - 1).toBe(2);
  });

  it.fails("node text update renames the node the user was editing, not a shifted id", () => {
    const nodeBId = elementIdContaining(TWO_NODES, "{B}");
    expect(nodeBId).toBe("path:1");

    let state = makeState(TWO_NODES, [nodeBId]);
    state = editorReducer(state, { type: "CODE_EDITED", source: TWO_NODES_EDITED });
    state = editorReducer(state, {
      type: "APPLY_EDIT_ACTION",
      action: { kind: "updateNodeText", elementId: nodeBId, text: "Renamed" }
    });

    // Desired: B becomes "Renamed", A stays "A". Actual today: A is renamed
    // and B is untouched.
    expect(state.source).toContain("{A}");
    expect(state.source).not.toContain("{B}");
  });

  it.fails("resize applies to the element the gesture started on, not a shifted id", () => {
    // Same mechanism as the resize-drag staleness-guard exemption in
    // useCanvasDragController: a resize dispatched with a gesture-start id
    // after the statement list changed resizes a different element.
    const secondRectId = elementIdContaining(TWO_RECTS, "(3,0)");
    expect(secondRectId).toBe("path:1");

    let state = makeState(TWO_RECTS, [secondRectId]);
    state = editorReducer(state, { type: "CODE_EDITED", source: TWO_RECTS_EDITED });
    state = editorReducer(state, {
      type: "APPLY_EDIT_ACTION",
      action: { kind: "resizeElement", elementId: secondRectId, role: "right", newWorld: wp(cm(6), cm(0.5)) }
    });

    // Desired: the second rectangle is resized (or the action is rejected as
    // stale); the first rectangle is untouched. Actual today: the first
    // rectangle is resized.
    expect(state.source).toContain("(0,0) rectangle (1,1)");
  });
});

// Contrast: handle-based actions ARE protected against stale snapshots via
// source fingerprints (packages/core/src/edit/apply.ts). These tests document
// the guard that elementId-based actions lack.

function makeHandle(
  source: string,
  overrides: Partial<EditHandle> & {
    world: WorldPoint;
    sourceSpan: { from: number; to: number };
    sourceId: string;
  }
): EditHandle {
  const { world, sourceSpan, sourceId, ...rest } = overrides;
  const transform = rest.transform ?? identityMatrix();
  return {
    id: `handle-${sourceSpan.from}-${sourceSpan.to}`,
    runtimeId: `runtime:handle-${sourceSpan.from}-${sourceSpan.to}`,
    sourceRef: {
      sourceId,
      sourceSpan,
      sourceFingerprint: computeSourceFingerprint(source)
    },
    handleType: "coordinate",
    coordinateSpace: "frame-local",
    kind: "path-point",
    world,
    local: rest.local ?? world,
    frame: rest.frame ?? transform,
    transform,
    sourceText: source.slice(sourceSpan.from, sourceSpan.to),
    coordinateForm: "cartesian",
    rewriteMode: "direct",
    ...rest
  } as EditHandle;
}

describe("stale handle guard (already protected paths)", () => {
  it("rejects moveHandle when the handle predates a code edit", () => {
    const original = "\\draw (1,2) -- (3,4);";
    const edited = "\\draw (9,9) -- (3,4);";
    const handle = makeHandle(original, {
      world: wp(cm(1), cm(2)),
      sourceSpan: { from: 6, to: 11 },
      sourceId: "path:0"
    });

    const initial = makeInitialState();
    let state: EditorState = {
      ...initial,
      source: original,
      snapshot: { ...makeEmptySnapshot(original), source: original, editHandles: [handle] }
    };
    state = editorReducer(state, { type: "CODE_EDITED", source: edited });
    state = editorReducer(state, {
      type: "APPLY_EDIT_ACTION",
      action: { kind: "moveHandle", handleId: handle.id, newWorld: wp(cm(5), cm(5)) }
    });

    expect(state.source).toBe(edited);
    expect(state.lastEditWarningMessage ?? "").toMatch(/stale handle/i);
  });
});
