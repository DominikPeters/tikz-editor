import { describe, expect, it } from "vitest";
import { editorReducer, makeInitialState } from "../packages/app/src/store/reducer.js";
import type { EditorState } from "../packages/app/src/store/types.js";
import type { WorldPoint } from "../packages/core/src/coords/points.js";
import type { EditHandle } from "../packages/core/src/semantic/types.js";
import { identityMatrix } from "../packages/core/src/semantic/transform.js";
import { computeSourceFingerprint } from "../packages/core/src/utils/source-fingerprint.js";
import { makeEmptySnapshot, type SessionSnapshot } from "../packages/app/src/compute.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { PT_PER_CM } from "../packages/core/src/edit/format.js";
import { wp } from "./coords-helpers.js";

// Positional ids can change while the canvas still displays an older scene.
// These fixtures publish a ready snapshot through the real identity lifecycle
// and verify that stale edits preserve source and explain the rejection.

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
  let state = editorReducer(makeInitialState(), { type: "CODE_EDITED", source });
  const rendered = renderTikzToSvg(source);
  const snapshot: SessionSnapshot = {
    ...makeEmptySnapshot(source),
    parseResult: rendered.parse,
    semanticResult: rendered.semantic,
    activeRootId: rendered.parse.activeFigureId,
    figures: rendered.parse.figures,
    scene: rendered.semantic.scene,
    editHandles: rendered.semantic.editHandles
  };
  state = editorReducer(state, { type: "COMPUTE_REQUESTED", requestId: "ready" });
  state = editorReducer(state, { type: "SNAPSHOT_READY", requestId: "ready", snapshot });
  expect(state.documents[state.activeDocumentId].editingIdentities).toBeDefined();
  for (const id of selectedIds) state = editorReducer(state, { type: "SELECT", id, additive: true });
  return state;
}

function expectStaleRejection(state: EditorState, source: string): void {
  expect(state.source).toBe(source);
  expect(state.lastEditWarningMessage).toContain("catching up");
}

function elementIdContaining(source: string, needle: string): string {
  const rendered = renderTikzToSvg(source, {
    parse: { recover: true, includeContextDefinitions: true }
  });
  const statement = rendered.parse.figure.body.find((candidate) =>
    source.slice(candidate.span.from, candidate.span.to).includes(needle)
  );
  if (!statement) {
    throw new Error(`No statement found whose source contains "${needle}"`);
  }
  expect(rendered.semantic.scene.elements.some(element => element.sourceRef.sourceId === statement.id)).toBe(true);
  return statement.id;
}

describe("stale scene ids with ready editing identities", () => {
  it("rejects an inspector property write after a source insertion", () => {
    const circleId = elementIdContaining(RECT_CIRCLE, "circle");
    let state = makeState(RECT_CIRCLE, [circleId]);
    state = editorReducer(state, { type: "CODE_EDITED", source: RECT_CIRCLE_EDITED });
    state = editorReducer(state, {
      type: "APPLY_EDIT_ACTION",
      action: { kind: "setProperty", elementId: circleId, level: "command", key: "fill", value: "blue" }
    });
    expectStaleRejection(state, RECT_CIRCLE_EDITED);
  });

  it("rejects a stale delete after duplication and preserves both rectangles and the circle", () => {
    let state = makeState(RECT_CIRCLE, ["path:0"]);
    state = editorReducer(state, {
      type: "APPLY_EDIT_ACTION", action: { kind: "duplicateElements", elementIds: ["path:0"] }
    });
    const afterDuplicate = state.source;
    expect(afterDuplicate.split("rectangle")).toHaveLength(3);
    expect(afterDuplicate).toContain("circle");
    state = editorReducer(state, {
      type: "APPLY_EDIT_ACTION", action: { kind: "deleteElement", elementId: elementIdContaining(RECT_CIRCLE, "circle") }
    });
    expectStaleRejection(state, afterDuplicate);
  });

  it("rejects node text updates from the old snapshot", () => {
    const nodeBId = elementIdContaining(TWO_NODES, "{B}");
    let state = makeState(TWO_NODES, [nodeBId]);
    state = editorReducer(state, { type: "CODE_EDITED", source: TWO_NODES_EDITED });
    state = editorReducer(state, {
      type: "APPLY_EDIT_ACTION", action: { kind: "updateNodeText", elementId: nodeBId, text: "Renamed" }
    });
    expectStaleRejection(state, TWO_NODES_EDITED);
  });

  it("rejects resize from the old snapshot", () => {
    const id = elementIdContaining(TWO_RECTS, "(3,0)");
    let state = makeState(TWO_RECTS, [id]);
    state = editorReducer(state, { type: "CODE_EDITED", source: TWO_RECTS_EDITED });
    state = editorReducer(state, {
      type: "APPLY_EDIT_ACTION", action: { kind: "resizeElement", elementId: id, role: "right", newWorld: wp(cm(6), cm(0.5)) }
    });
    expectStaleRejection(state, TWO_RECTS_EDITED);
  });
});

describe("current scene id positive controls", () => {
  it("writes the property to the selected circle", () => {
    let state = makeState(RECT_CIRCLE, ["path:1"]);
    state = editorReducer(state, { type: "APPLY_EDIT_ACTION", action: {
      kind: "setProperty", elementId: "path:1", level: "command", key: "fill", value: "blue"
    } });
    expect(state.source.split("\n").find(line => line.includes("circle"))).toContain("fill=blue");
    expect(state.source.split("\n").find(line => line.includes("rectangle"))).not.toContain("fill=blue");
  });

  it("deletes the current circle without deleting the rectangle", () => {
    let state = makeState(RECT_CIRCLE, ["path:1"]);
    state = editorReducer(state, { type: "APPLY_EDIT_ACTION", action: { kind: "deleteElement", elementId: "path:1" } });
    expect(state.source).not.toContain("circle");
    expect(state.source.split("rectangle")).toHaveLength(2);
  });

  it("renames the current node and preserves its sibling", () => {
    let state = makeState(TWO_NODES, ["path:1"]);
    state = editorReducer(state, { type: "APPLY_EDIT_ACTION", action: { kind: "updateNodeText", elementId: "path:1", text: "Renamed" } });
    expect(state.source).toContain("{A}");
    expect(state.source).toContain("{Renamed}");
    expect(state.source).not.toContain("{B}");
  });

  it("resizes the current second rectangle and preserves the first", () => {
    let state = makeState(TWO_RECTS, ["path:1"]);
    state = editorReducer(state, { type: "APPLY_EDIT_ACTION", action: {
      kind: "resizeElement", elementId: "path:1", role: "right", newWorld: wp(cm(6), cm(0.5))
    } });
    expect(state.source).toContain("(0,0) rectangle (1,1)");
    expect(state.source).not.toBe(TWO_RECTS);
    expect(state.lastEditWarningMessage).toBeNull();
  });
});

// The legacy no-identity reducer entry still relies on callers providing current
// ids. Its stale-id behavior is a separately qualified API contract candidate;
// it is not used as an expected-failure proxy for the hydrated app lifecycle.


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
