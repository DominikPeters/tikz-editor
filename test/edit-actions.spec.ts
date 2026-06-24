import { describe, expect, it } from "vitest";
import type { WorldPoint } from "../packages/core/src/coords/points.js";
import { frameToWorldTransform } from "../packages/core/src/coords/transforms.js";
import type { EditHandle } from "../packages/core/src/semantic/types.js";
import type { NodeTextEngine } from "../packages/core/src/text/types.js";
import { identityMatrix, scaleMatrix } from "../packages/core/src/semantic/transform.js";
import {
  applyEditAction,
  PATH_ATTACHED_NODE_EDIT_NOOP_REASON,
  PROPERTY_WRITE_CLEANUP_NOOP_REASON
} from "../packages/core/src/edit/actions.js";
import { isUngroupableScopeStatement } from "../packages/core/src/edit/actions/group-ungroup-actions.js";
import { buildParentReorderReplacement } from "../packages/core/src/edit/actions/reorder-elements.js";
import {
  applyPathAttachedNodeInspectorAction,
  resolveDraggedPathAttachedNodeDirection
} from "../packages/core/src/edit/actions/path-attached-node-actions.js";
import { applyPasteStatementsAction } from "../packages/core/src/edit/actions/paste-duplicate.js";
import {
  ADORNMENT_EDIT_NOOP_REASON,
  applyAdornmentSetProperty,
  applyAdornmentValueRewrite
} from "../packages/core/src/edit/actions/adornment-set-property.js";
import {
  PIN_EDGE_DASH_PROPERTY_KEY,
  PIN_EDGE_DRAW_PROPERTY_KEY,
  PIN_EDGE_LINE_WIDTH_PROPERTY_KEY
} from "../packages/core/src/edit/adornment-keys.js";
import {
  PATH_ATTACHED_NODE_POSITION_VALUE_KEY,
  PATH_ATTACHED_NODE_SIDE_KEY
} from "../packages/core/src/edit/path-attached-node-keys.js";
import { PT_PER_CM } from "../packages/core/src/edit/format.js";
import { makeStyleSourceTargetId, TIKZPICTURE_GLOBAL_TARGET_ID } from "../packages/core/src/edit/property-target.js";
import { computeSourceFingerprint } from "../packages/core/src/utils/source-fingerprint.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { createMathJaxNodeTextEngine } from "../packages/core/src/text/mathjax-engine.js";
import { collectSourceWorldBounds } from "../packages/core/src/edit/snapping/geometry.js";
import { applySourcePatches } from "../packages/core/src/edit/source-patches.js";
import { renameSnippetDeclaredNames } from "../packages/core/src/edit/name-conflicts.js";
import { wb, wp } from "./coords-helpers.js";

const cm = (v: number) => v * PT_PER_CM;

function mergeTestBounds(
  left: ReturnType<typeof wb>,
  right: ReturnType<typeof wb>
) {
  return wb(
    Math.min(left.minX, right.minX),
    Math.min(left.minY, right.minY),
    Math.max(left.maxX, right.maxX),
    Math.max(left.maxY, right.maxY)
  );
}

function scopeBodyBounds(source: string): ReturnType<typeof wb> | null {
  const parsed = parseTikz(source, { recover: true });
  const evaluated = evaluateTikzFigure(parsed.figure, source);
  const boundsBySource = collectSourceWorldBounds(evaluated.scene.elements);
  const scope = parsed.figure.body.find((statement) => statement.kind === "Scope");
  if (!scope || scope.kind !== "Scope") {
    return null;
  }

  let merged: ReturnType<typeof wb> | null = null;
  for (const child of scope.body) {
    const bounds = boundsBySource.get(child.id);
    if (!bounds) {
      continue;
    }
    merged = merged ? mergeTestBounds(merged, bounds) : bounds;
  }
  return merged;
}

function makeHandle(
  source: string,
  overrides: Partial<EditHandle> & {
    world: WorldPoint;
    sourceSpan: { from: number; to: number };
    sourceId?: string;
  }
): EditHandle {
  const { world, sourceSpan, sourceId, ...rest } = overrides;
  const span = sourceSpan;
  const transform = rest.transform ?? identityMatrix();
  const kind = rest.kind ?? "path-point";
  const rewriteMode = rest.rewriteMode ?? "direct";
  return {
    id: `handle-${span.from}-${span.to}`,
    runtimeId: `runtime:handle-${span.from}-${span.to}`,
    sourceRef: {
      sourceId: sourceId ?? "elem-1",
      sourceSpan: span,
      sourceFingerprint: computeSourceFingerprint(source)
    },
    handleType: "coordinate",
    coordinateSpace: "frame-local",
    kind,
    world: world,
    local: rest.local ?? world,
    frame: rest.frame ?? transform,
    transform,
    sourceText: source.slice(span.from, span.to),
    coordinateForm: overrides.coordinateForm ?? "cartesian",
    rewriteMode,
    ...rest
  } as EditHandle;
}

function expectPatchesReconstructSource(
  previousSource: string,
  result: Extract<ReturnType<typeof applyEditAction>, { kind: "success" | "partial" }>
): void {
  const replayed = applySourcePatches(previousSource, result.patches);
  expect(replayed.kind).toBe("success");
  if (replayed.kind !== "success") return;
  expect(replayed.source).toBe(result.newSource);
}

// ── moveHandle ─────────────────────────────────────────────────────────────────

describe("applyEditAction – moveHandle", () => {
  it("moves a cartesian handle to a new world position", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const handle = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan: { from: 6, to: 11 }
    });

    const result = applyEditAction(source, [handle], {
      kind: "moveHandle",
      handleId: handle.id,
      newWorld: wp(cm(5), cm(6))
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toBe("\\draw (5,6) -- (3,4);");
      expect(result.patches).toHaveLength(1);
      expectPatchesReconstructSource(source, result);
    }
  });

  it("accepts opaque source identities for stale-handle checks", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const sourceFingerprint = `source-revision:doc-a:7:${source.length}`;
    const sourceSpan = { from: 6, to: 11 };
    const handle = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan,
      sourceRef: {
        sourceId: "path:0",
        sourceSpan,
        sourceFingerprint
      }
    });

    const result = applyEditAction(
      source,
      [handle],
      {
        kind: "moveHandle",
        handleId: handle.id,
        newWorld: wp(cm(5), cm(6))
      },
      { parseOptions: { sourceFingerprint } }
    );

    expect(result.kind).toBe("success");
  });

  it("rejects stale handles when opaque source identities differ", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const sourceSpan = { from: 6, to: 11 };
    const handle = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan,
      sourceRef: {
        sourceId: "path:0",
        sourceSpan,
        sourceFingerprint: `source-revision:doc-a:7:${source.length}`
      }
    });

    const result = applyEditAction(
      source,
      [handle],
      {
        kind: "moveHandle",
        handleId: handle.id,
        newWorld: wp(cm(5), cm(6))
      },
      { parseOptions: { sourceFingerprint: `source-revision:doc-b:7:${source.length}` } }
    );

    expect(result.kind).toBe("error");
  });

  it("returns unsupported for unknown handle id", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const result = applyEditAction(source, [], {
      kind: "moveHandle",
      handleId: "nonexistent",
      newWorld: wp(cm(5), cm(6))
    });
    expect(result.kind).toBe("error");
  });

  it("returns unsupported for unsupported coordinate form", () => {
    const source = "\\draw ($0.5*(A)+0.5*(B)$) -- (1,1);";
    const handle = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan: { from: 6, to: 25 },
      coordinateForm: "calc",
      rewriteMode: "unsupported"
    });

    const result = applyEditAction(source, [handle], {
      kind: "moveHandle",
      handleId: handle.id,
      newWorld: wp(cm(3), cm(4))
    });
    expect(result.kind).toBe("unsupported");
  });
});

describe("applyEditAction – connectHandle", () => {
  it("rewrites path endpoints to named node anchors", () => {
    const source = "\\draw (0,0) -- (1,1);";
    const raw = "(1,1)";
    const from = source.indexOf(raw);
    const handle = makeHandle(source, {
      world: wp(cm(1), cm(1)),
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:0"
    });

    const result = applyEditAction(source, [handle], {
      kind: "connectHandle",
      handleId: handle.id,
      nodeName: "A",
      anchor: "east"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toBe("\\draw (0,0) -- (A.east);");
    expect(result.changedSourceIds).toEqual(["path:0"]);
  });

  it("rewrites center anchors to bare node references", () => {
    const source = "\\draw (0,0) -- (1,1);";
    const raw = "(1,1)";
    const from = source.indexOf(raw);
    const handle = makeHandle(source, {
      world: wp(cm(1), cm(1)),
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:0"
    });

    const result = applyEditAction(source, [handle], {
      kind: "connectHandle",
      handleId: handle.id,
      nodeName: "A",
      anchor: "center"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toBe("\\draw (0,0) -- (A);");
  });

  it("names unnamed node targets only when an endpoint is connected", () => {
    const source = "\\begin{tikzpicture}\n\\node at (0,0) {node};\n\\draw (1,0) -- (2,0);\n\\end{tikzpicture}";
    const raw = "(2,0)";
    const from = source.indexOf(raw);
    const handle = makeHandle(source, {
      world: wp(cm(2), cm(0)),
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:1"
    });

    const result = applyEditAction(source, [handle], {
      kind: "connectHandle",
      handleId: handle.id,
      nodeName: "",
      nodeSourceId: "path:0",
      anchor: "east"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toBe("\\begin{tikzpicture}\n\\node (node1) at (0,0) {node};\n\\draw (1,0) -- (node1.east);\n\\end{tikzpicture}");
    expect(result.changedSourceIds).toEqual([]);
  });

  it("inserts lazy node names after standalone node options", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw, shape=star, minimum width=2.2cm, minimum height=1.4cm] at (0.88,2.2) {};
  \draw (0.13,3.66) -- (0.88,2.2);
\end{tikzpicture}`;
    const raw = "(0.88,2.2)";
    const from = source.lastIndexOf(raw);
    const handle = makeHandle(source, {
      world: wp(cm(0.88), cm(2.2)),
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:1"
    });

    const result = applyEditAction(source, [handle], {
      kind: "connectHandle",
      handleId: handle.id,
      nodeName: "",
      nodeSourceId: "path:0",
      anchor: "north"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toBe(String.raw`\begin{tikzpicture}
  \node[draw, shape=star, minimum width=2.2cm, minimum height=1.4cm] (node1) at (0.88,2.2) {};
  \draw (0.13,3.66) -- (node1.north);
\end{tikzpicture}`);
    expect(result.changedSourceIds).toEqual([]);
  });

  it("rejects handles whose source span is shared by expansion", () => {
    const source = "\\draw (0,0) -- (1,1);";
    const raw = "(1,1)";
    const from = source.indexOf(raw);
    const first = makeHandle(source, {
      id: "h-first",
      world: wp(cm(1), cm(1)),
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:0"
    });
    const second = makeHandle(source, {
      id: "h-second",
      world: wp(cm(1), cm(1)),
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:1"
    });

    const result = applyEditAction(source, [first, second], {
      kind: "connectHandle",
      handleId: first.id,
      nodeName: "A",
      anchor: "east"
    });

    expect(result.kind).toBe("unsupported");
  });

  it("rejects stale handles when fingerprint mismatches source", () => {
    const sourceA = "\\draw (0,0) -- (1,1);";
    const sourceB = "\\draw (9,9) -- (8,8);";
    const raw = "(1,1)";
    const from = sourceA.indexOf(raw);
    const handle = makeHandle(sourceA, {
      world: wp(cm(1), cm(1)),
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:0"
    });

    const result = applyEditAction(sourceB, [handle], {
      kind: "connectHandle",
      handleId: handle.id,
      nodeName: "A",
      anchor: "east"
    });

    expect(result.kind).toBe("error");
  });

  it("rejects missing, curve, non-endpoint, malformed, stale-text, and incomplete connections", () => {
    const source = "\\draw (0,0) -- (1,1);";
    const raw = "(1,1)";
    const from = source.indexOf(raw);
    const base = makeHandle(source, {
      world: wp(cm(1), cm(1)),
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:0"
    });

    expect(applyEditAction(source, [base], {
      kind: "connectHandle",
      handleId: "missing",
      nodeName: "A",
      anchor: "east"
    })).toMatchObject({ kind: "error" });

    expect(applyEditAction(source, [{ ...base, curveEdit: { segmentIndex: 0, role: "control1" } } as unknown as EditHandle], {
      kind: "connectHandle",
      handleId: base.id,
      nodeName: "A",
      anchor: "east"
    })).toMatchObject({ kind: "unsupported" });

    expect(applyEditAction(source, [{ ...base, kind: "node-position" } as unknown as EditHandle], {
      kind: "connectHandle",
      handleId: base.id,
      nodeName: "A",
      anchor: "east"
    })).toMatchObject({ kind: "unsupported" });

    const malformedSpan = {
      ...base,
      sourceRef: {
        ...base.sourceRef,
        sourceSpan: { from: -1, to: 1 }
      }
    };
    expect(applyEditAction(source, [malformedSpan], {
      kind: "connectHandle",
      handleId: base.id,
      nodeName: "A",
      anchor: "east"
    })).toMatchObject({ kind: "unsupported" });

    expect(applyEditAction(source, [{ ...base, sourceText: "(9,9)" }], {
      kind: "connectHandle",
      handleId: base.id,
      nodeName: "A",
      anchor: "east"
    })).toMatchObject({ kind: "error" });

    expect(applyEditAction(source, [base], {
      kind: "connectHandle",
      handleId: base.id,
      nodeName: "   ",
      anchor: "east"
    })).toMatchObject({ kind: "error" });

    expect(applyEditAction(source, [base], {
      kind: "connectHandle",
      handleId: base.id,
      nodeName: "A",
      anchor: "   "
    })).toMatchObject({ kind: "error" });
  });

  it("moves the connected path statement after a later named node definition", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (-2.5, 2.5) -- (2.5, 2.5);
  \node[draw] (A) at (-1, -1) {A};
\end{tikzpicture}`;
    const startRaw = "(-2.5, 2.5)";
    const startFrom = source.indexOf(startRaw);
    const handle = makeHandle(source, {
      world: wp(cm(-2.5), cm(2.5)),
      sourceSpan: { from: startFrom, to: startFrom + startRaw.length },
      sourceId: "path:0"
    });

    const result = applyEditAction(source, [handle], {
      kind: "connectHandle",
      handleId: handle.id,
      nodeName: "A",
      anchor: "center"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    const drawIndex = result.newSource.indexOf("\\draw (A) -- (2.5, 2.5);");
    const nodeIndex = result.newSource.indexOf("\\node[draw] (A) at (-1, -1) {A};");
    expect(drawIndex).toBeGreaterThan(nodeIndex);
    expect(result.changedSourceIds).toEqual([]);
    expectPatchesReconstructSource(source, result);
  });

  it("keeps connection order stable for earlier, scoped, alias, and coordinate producers", () => {
    const earlierSource = String.raw`\begin{tikzpicture}
  \node (A) at (0,0) {A};
  \draw (1,0) -- (2,0);
\end{tikzpicture}`;
    const earlierRendered = renderTikzToSvg(earlierSource);
    const earlierHandle = earlierRendered.semantic.editHandles.find(
      (handle) => handle.kind === "path-point" && earlierSource.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to) === "(1,0)"
    );
    if (!earlierHandle) {
      throw new Error("Expected earlier-source endpoint handle");
    }
    const earlierResult = applyEditAction(earlierSource, [earlierHandle], {
      kind: "connectHandle",
      handleId: earlierHandle.id,
      nodeName: "A",
      anchor: "center"
    });
    expect(earlierResult.kind).toBe("success");
    if (earlierResult.kind !== "success") return;
    expect(earlierResult.newSource.indexOf("\\node (A)")).toBeLessThan(earlierResult.newSource.indexOf("\\draw (A)"));
    expect(earlierResult.changedSourceIds).toEqual([earlierHandle.sourceRef.sourceId]);

    const scopedSource = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) -- (1,0);
  \end{scope}
  \node (A) at (2,0) {A};
\end{tikzpicture}`;
    const scopedRendered = renderTikzToSvg(scopedSource);
    const scopedHandle = scopedRendered.semantic.editHandles.find(
      (handle) => handle.kind === "path-point" && scopedSource.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to) === "(0,0)"
    );
    if (!scopedHandle) {
      throw new Error("Expected scoped endpoint handle");
    }
    const scopedResult = applyEditAction(scopedSource, [scopedHandle], {
      kind: "connectHandle",
      handleId: scopedHandle.id,
      nodeName: "A",
      anchor: "center"
    });
    expect(scopedResult.kind).toBe("success");
    if (scopedResult.kind !== "success") return;
    expect(scopedResult.newSource.indexOf("\\begin{scope}")).toBeLessThan(scopedResult.newSource.indexOf("\\node (A)"));
    expect(scopedResult.changedSourceIds).toEqual([scopedHandle.sourceRef.sourceId]);

    const aliasSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \node[alias=B] (A) at (2,0) {A};
\end{tikzpicture}`;
    const aliasRendered = renderTikzToSvg(aliasSource);
    const aliasHandle = aliasRendered.semantic.editHandles.find(
      (handle) => handle.kind === "path-point" && aliasSource.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to) === "(0,0)"
    );
    if (!aliasHandle) {
      throw new Error("Expected alias endpoint handle");
    }
    const aliasResult = applyEditAction(aliasSource, [aliasHandle], {
      kind: "connectHandle",
      handleId: aliasHandle.id,
      nodeName: "B",
      anchor: "center"
    });
    expect(aliasResult.kind).toBe("success");
    if (aliasResult.kind !== "success") return;
    expect(aliasResult.newSource.indexOf("\\node[alias=B]")).toBeLessThan(aliasResult.newSource.indexOf("\\draw (B)"));
    expect(aliasResult.changedSourceIds).toEqual([]);

    const coordinateSource = String.raw`\begin{tikzpicture}
  \draw (0,0) coordinate (P) -- (1,0);
\end{tikzpicture}`;
    const coordinateRendered = renderTikzToSvg(coordinateSource);
    const coordinateHandle = coordinateRendered.semantic.editHandles.find(
      (handle) => handle.kind === "path-point" && coordinateSource.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to) === "(1,0)"
    );
    if (!coordinateHandle) {
      throw new Error("Expected coordinate endpoint handle");
    }
    const coordinateResult = applyEditAction(coordinateSource, [coordinateHandle], {
      kind: "connectHandle",
      handleId: coordinateHandle.id,
      nodeName: "P",
      anchor: "center"
    });
    expect(coordinateResult.kind).toBe("success");
    if (coordinateResult.kind !== "success") return;
    expect(coordinateResult.newSource).toContain("\\draw (0,0) coordinate (P) -- (P);");
    expect(coordinateResult.changedSourceIds).toEqual([coordinateHandle.sourceRef.sourceId]);
  });
});

describe("applyEditAction – patch replay invariants", () => {
  it("replays moveHandle patches to the reported newSource", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const handle = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan: { from: 6, to: 11 }
    });
    const result = applyEditAction(source, [handle], {
      kind: "moveHandle",
      handleId: handle.id,
      newWorld: wp(cm(7), cm(8))
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expectPatchesReconstructSource(source, result);
  });

  it("replays connectHandle patches when replacement and statement reorder both occur", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[red] (-1, 1) -- (1, 1);
  \node[draw] (C) at (0, 0) {C};
\end{tikzpicture}`;
    const raw = "(1, 1)";
    const from = source.indexOf(raw);
    const handle = makeHandle(source, {
      world: wp(cm(1), cm(1)),
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:0"
    });
    const result = applyEditAction(source, [handle], {
      kind: "connectHandle",
      handleId: handle.id,
      nodeName: "C",
      anchor: "north west"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw[red] (-1, 1) -- (C.north west);");
    expectPatchesReconstructSource(source, result);
  });

  it("replays non-handle reorder patches to the reported newSource", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:0"],
      direction: "bringToFront"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expectPatchesReconstructSource(source, result);
  });
});

// ── moveElement ────────────────────────────────────────────────────────────────

describe("applyEditAction – moveElement", () => {
  it("returns unsupported for empty or duplicate-normalized moveElements selections", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const result = applyEditAction(source, [], {
      kind: "moveElements",
      elementIds: [" ", "", " "] as string[],
      delta: wp(cm(1), cm(1))
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("No element ids");
    }
  });

  it("rejects stale handles when moving elements with opaque source identities", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const sourceFingerprint = `source-revision:doc-a:7:${source.length}`;
    const nextSourceFingerprint = `source-revision:doc-a:8:${source.length}`;
    const firstSpan = { from: 6, to: 11 };
    const secondSpan = { from: 15, to: 20 };
    const first = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan: firstSpan,
      sourceId: "path:0",
      sourceRef: {
        sourceId: "path:0",
        sourceSpan: firstSpan,
        sourceFingerprint
      }
    });
    const second = makeHandle(source, {
      world: wp(cm(3), cm(4)),
      sourceSpan: secondSpan,
      sourceId: "path:0",
      sourceRef: {
        sourceId: "path:0",
        sourceSpan: secondSpan,
        sourceFingerprint
      }
    });

    const result = applyEditAction(
      source,
      [first, second],
      {
        kind: "moveElements",
        elementIds: ["path:0"],
        delta: wp(cm(1), cm(1))
      },
      { parseOptions: { sourceFingerprint: nextSourceFingerprint } }
    );

    expect(result.kind).toBe("error");
  });

  it("moves all handles of an element by a delta", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const h1 = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan: { from: 6, to: 11 },
      sourceId: "elem-1"
    });
    const h2 = makeHandle(source, {
      world: wp(cm(3), cm(4)),
      sourceSpan: { from: 15, to: 20 },
      id: "handle-15-20",
      sourceId: "elem-1"
    });

    const result = applyEditAction(source, [h1, h2], {
      kind: "moveElement",
      elementId: "elem-1",
      delta: wp(cm(1), cm(1))
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toBe("\\draw (2,3) -- (4,5);");
    }
  });

  it("moves handles for multiple element ids in one action", () => {
    const source = "\\node (A) at (1,2) {}; \\node (B) at (3,4) {};";
    const h1 = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan: { from: 14, to: 19 },
      sourceId: "path:0"
    });
    const h2 = makeHandle(source, {
      world: wp(cm(3), cm(4)),
      sourceSpan: { from: 34, to: 39 },
      id: "handle-34-39",
      sourceId: "path:1"
    });

    const result = applyEditAction(source, [h1, h2], {
      kind: "moveElements",
      elementIds: ["path:0", "path:1"],
      delta: wp(cm(1), cm(0))
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("(2,2)");
      expect(result.newSource).toContain("(4,4)");
    }
  });

  it("returns unsupported when element has no handles", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "nonexistent",
      delta: wp(cm(1), cm(1))
    });
    expect(result.kind).toBe("unsupported");
  });

  it("returns unsupported when every selected handle is non-rewritable", () => {
    const source = "\\draw (A) -- (B);";
    const firstRaw = "(A)";
    const secondRaw = "(B)";
    const firstFrom = source.indexOf(firstRaw);
    const secondFrom = source.indexOf(secondRaw);
    const first = makeHandle(source, {
      world: wp(0, 0),
      sourceSpan: { from: firstFrom, to: firstFrom + firstRaw.length },
      sourceId: "path:0",
      coordinateForm: "named",
      rewriteMode: "unsupported"
    });
    const second = makeHandle(source, {
      world: wp(1, 1),
      sourceSpan: { from: secondFrom, to: secondFrom + secondRaw.length },
      sourceId: "path:0",
      coordinateForm: "named",
      rewriteMode: "unsupported"
    });

    const result = applyEditAction(source, [first, second], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(1, 1)
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("All handles");
    }
  });

  it("skips handles whose source text no longer matches the current span", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const raw = "(1,2)";
    const from = source.indexOf(raw);
    const handle = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:0",
      sourceText: "(9,9)"
    });

    const result = applyEditAction(source, [handle], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(1), cm(1))
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("No coordinate rewrites");
    }
  });

  it("returns partial when some handles are unsupported", () => {
    const source = "\\draw (0,0) .. controls (A) .. (1,2);";
    const unsupportedRaw = "(A)";
    const unsupportedFrom = source.indexOf(unsupportedRaw);
    const unsupported = makeHandle(source, {
      world: wp(cm(0), cm(0)),
      sourceSpan: { from: unsupportedFrom, to: unsupportedFrom + unsupportedRaw.length },
      sourceId: "elem-1",
      kind: "path-control",
      coordinateForm: "named",
      rewriteMode: "unsupported"
    });
    const supportedRaw = "(1,2)";
    const supportedFrom = source.lastIndexOf(supportedRaw);
    const supported = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan: { from: supportedFrom, to: supportedFrom + supportedRaw.length },
      sourceId: "elem-1"
    });

    const result = applyEditAction(source, [unsupported, supported], {
      kind: "moveElement",
      elementId: "elem-1",
      delta: wp(cm(1), cm(0))
    });

    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.skippedHandles).toHaveLength(1);
      expect(result.newSource).toBe("\\draw (0,0) .. controls (A) .. (2,2);");
    }
  });

  it("returns partial for moveElements when only some handles on a selected element rewrite", () => {
    const source = "\\draw (0,0) .. controls (A) .. (1,2);";
    const unsupportedRaw = "(A)";
    const unsupportedFrom = source.indexOf(unsupportedRaw);
    const unsupported = makeHandle(source, {
      world: wp(cm(0), cm(0)),
      sourceSpan: { from: unsupportedFrom, to: unsupportedFrom + unsupportedRaw.length },
      sourceId: "path:0",
      kind: "path-control",
      coordinateForm: "named",
      rewriteMode: "unsupported"
    });
    const supportedRaw = "(1,2)";
    const supportedFrom = source.lastIndexOf(supportedRaw);
    const supported = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan: { from: supportedFrom, to: supportedFrom + supportedRaw.length },
      sourceId: "path:0"
    });

    const result = applyEditAction(source, [unsupported, supported], {
      kind: "moveElements",
      elementIds: ["path:0"],
      delta: wp(cm(1), cm(0))
    });

    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") return;
    expect(result.reason).toContain("unsupported coordinate forms");
    expect(result.skippedHandles).toEqual([unsupported.id]);
    expect(result.newSource).toBe("\\draw (0,0) .. controls (A) .. (2,2);");
    expectPatchesReconstructSource(source, result);
  });

  it("applies patches in correct order (handles at different offsets)", () => {
    // Both handles in same source; higher-offset patch applied first
    const source = "\\node (A) at (1,2) {}; \\node (B) at (3,4) {};";
    const h1 = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan: { from: 14, to: 19 },
      sourceId: "multi"
    });
    const h2 = makeHandle(source, {
      world: wp(cm(3), cm(4)),
      sourceSpan: { from: 34, to: 39 },
      id: "handle-34-39",
      sourceId: "multi"
    });

    const result = applyEditAction(source, [h1, h2], {
      kind: "moveElement",
      elementId: "multi",
      delta: wp(cm(10), cm(10))
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("(11,12)");
      expect(result.newSource).toContain("(13,14)");
    }
  });

  it("moves matrix statements by rewriting inline at coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] at (0,0) {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("at (1,2)");
    expect(result.newSource).not.toContain("at=(1,2)");
  });

  it("moves nodes without explicit placement by inserting an inline at coordinate", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (A) {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);

    const result = applyEditAction(source, semantic.editHandles, {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(2), cm(3))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("  \\node (A) at (2,3) {A};");
    expectPatchesReconstructSource(source, result);
  });

  it("moves tree roots without rewriting child operation bodies into coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \path[grow=right] node[draw,level distance=15mm, sibling distance=10mm, rounded corners=2pt,fill=blue!10] at (0,0) {Root}
    child { node[draw,fill=green!12] {Leaf A} }
    child {
      node[draw,fill=green!12] {Branch}
      child { node[draw,fill=yellow!16] {Leaf B1} }
      child { node[draw,fill=yellow!16] {Leaf B2} }
    };
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);

    const result = applyEditAction(source, semantic.editHandles, {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(0.29), cm(0.12))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("child { node[draw,fill=green!12] {Leaf A} }");
    expect(result.newSource).toContain("child { node[draw,fill=yellow!16] {Leaf B1} }");
    expect(result.newSource).toContain("child { node[draw,fill=yellow!16] {Leaf B2} }");
    expect(result.newSource).not.toMatch(/\n\s*\([^)]+\)\s*\n\s*\([^)]+\)\s*;/);
    expect(result.newSource).toMatch(/at\s*\([^)]+\)\s*\{Root\}/);
    expectPatchesReconstructSource(source, result);
  });

  it("moves tree roots without explicit at by inserting inline placement", () => {
    const source = String.raw`\begin{tikzpicture}
  \path[grow=right,level distance=15mm,sibling distance=10mm]
    node[draw,rounded corners=2pt,fill=blue!10] {Root}
    child { node[draw,fill=green!12] {Leaf A} }
    child {
      node[draw,fill=green!12] {Branch}
      child { node[draw,fill=yellow!16] {Leaf B1} }
      child { node[draw,fill=yellow!16] {Leaf B2} }
    };
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);

    const result = applyEditAction(source, semantic.editHandles, {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(0.29), cm(0.12))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toMatch(/node\[draw,rounded corners=2pt,fill=blue!10\]\s*at\s*\([^)]+\)\s*\{Root\}/);
    expect(result.newSource).toContain("child { node[draw,fill=green!12] {Leaf A} }");
    expect(result.newSource).toContain("child { node[draw,fill=yellow!16] {Leaf B1} }");
    expect(result.newSource).toContain("child { node[draw,fill=yellow!16] {Leaf B2} }");
    expectPatchesReconstructSource(source, result);
  });

  it("moves tree roots incrementally from the root node position (not full-tree bounds center)", () => {
    const source = String.raw`\begin{tikzpicture}
  \path[grow=right,level distance=15mm,sibling distance=10mm]
    node[draw,rounded corners=2pt,fill=blue!10] at (0,0) {Root}
    child { node[draw,fill=green!12] {Leaf A} }
    child {
      node[draw,fill=green!12] {Branch}
      child { node[draw,fill=yellow!16] {Leaf B1} }
      child { node[draw,fill=yellow!16] {Leaf B2} }
    };
\end{tikzpicture}`;

    const first = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(0.1), cm(0))
    });
    expect(first.kind).toBe("success");
    if (first.kind !== "success") return;
    expect(first.newSource).toMatch(/at\s*\(0\.1,0\)\s*\{Root\}/);

    const second = applyEditAction(first.newSource, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(0.1), cm(0))
    });
    expect(second.kind).toBe("success");
    if (second.kind !== "success") return;
    expect(second.newSource).toMatch(/at\s*\(0\.2,0\)\s*\{Root\}/);
    expect(second.newSource).not.toMatch(/at\s*\(1\.[0-9]+,0\)\s*\{Root\}/);
    expectPatchesReconstructSource(first.newSource, second);
  });

  it("moves matrix statements by normalizing buggy at options into inline placement", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,at={(0,0)}] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\matrix[matrix of nodes] at (1,2) {");
    expect(result.newSource).not.toContain("at={");
  });

  it("moves matrix statements without placement by inserting inline at (...)", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\matrix[matrix of nodes] at (1,2) {");
    expect(result.newSource).not.toContain("at=(");
  });

  it("moves matrix statements with ampersand replacement using inline placement syntax", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[
    matrix of nodes,
    ampersand replacement=\&,
  ] (m) {
    A \& B \& C \\
    D \& E \& F \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(-0.21), cm(0.17))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("ampersand replacement=\\&");
    expect(result.newSource).toContain("] (m) at (-0.21,0.17) {");
    expect(result.newSource).not.toContain("at=");
    expect(result.newSource).not.toContain(",,");
  });

  it("formats matrix placement through a provided frame-local placement handle", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] at (0,0) {
    A \\
  };
\end{tikzpicture}`;
    const raw = "(0,0)";
    const from = source.indexOf(raw);
    const placementHandle = makeHandle(source, {
      kind: "node-position",
      world: wp(0, 0),
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:0",
      frame: frameToWorldTransform(2, 0, 0, 1, 0, 0),
      transform: scaleMatrix(2, 1)
    });

    const result = applyEditAction(source, [placementHandle], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(2), 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("at (1,0)");
    expectPatchesReconstructSource(source, result);
  });

  it("moves scopes by rewriting xshift and yshift options", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=2pt, yshift=3pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(5.6, -2.4)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xshift=8pt");
    expect(result.newSource).toContain("yshift=1pt");
    expectPatchesReconstructSource(source, result);

    const fine = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(5.6, -2.4),
      formatPrecision: "fine"
    });
    expect(fine.kind).toBe("success");
    if (fine.kind !== "success") return;
    expect(fine.newSource).toContain("xshift=7.6pt");
    expect(fine.newSource).toContain("yshift=0.6pt");
  });

  it("moves scopes with scale before shift by adjusting shift in local scope units", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[scale=2, shift={(2pt,3pt)}]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, 6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toMatch(/shift=\{\(4pt,6pt\)\}|shift=\(4pt,6pt\)/);
    expectPatchesReconstructSource(source, result);
  });

  it("moves scopes with scale before xshift/yshift by adjusting shifts in local scope units", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[scale=2, xshift=2pt, yshift=3pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, 6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xshift=4pt");
    expect(result.newSource).toContain("yshift=6pt");
    expectPatchesReconstructSource(source, result);
  });

  it("ignores non-translation flags before scope xshift and yshift entries", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[draw, xshift=2pt, yshift=3pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, 6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("draw");
    expect(result.newSource).toContain("xshift=6pt");
    expect(result.newSource).toContain("yshift=9pt");
    expectPatchesReconstructSource(source, result);
  });

  it("moves scopes through rotated and anisotropic transform prefixes", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[rotate=90, xscale=2, yscale=4, shift={(1pt,2pt)}]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(8, -4)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toMatch(/shift=\{\(-1pt,0pt\)\}|shift=\(-1pt,0pt\)/);
    expectPatchesReconstructSource(source, result);
  });

  it("ignores non-transform flags while applying scope transform prefixes", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[draw,scale=2,shift={(1pt,2pt)}]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, 6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("draw");
    expect(result.newSource).toMatch(/shift=\{\(3pt,5pt\)\}|shift=\(3pt,5pt\)/);
    expectPatchesReconstructSource(source, result);
  });

  it("falls back to absolute scope shifts when a transform prefix is not numeric", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[rotate=\angle, xshift=2pt, yshift=3pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, -6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("rotate=\\angle");
    expect(result.newSource).toContain("xshift=6pt");
    expect(result.newSource).toContain("yshift=-3pt");
    expectPatchesReconstructSource(source, result);
  });

  it("falls back to absolute scope shifts for nonnumeric scale prefixes", () => {
    const scaleSource = String.raw`\begin{tikzpicture}
  \begin{scope}[scale=\s, shift={(2pt,3pt)}]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const scale = applyEditAction(scaleSource, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, -6)
    });

    expect(scale.kind).toBe("success");
    if (scale.kind !== "success") return;
    expect(scale.newSource).toContain("scale=\\s");
    expect(scale.newSource).not.toContain("shift={");
    expect(scale.newSource).toContain("xshift=2pt");
    expect(scale.newSource).toContain("yshift=-3pt");
    expectPatchesReconstructSource(scaleSource, scale);

    const xscaleSource = String.raw`\begin{tikzpicture}
  \begin{scope}[xscale=\sx, shift={(2pt,3pt)}]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const xscale = applyEditAction(xscaleSource, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, -6)
    });

    expect(xscale.kind).toBe("success");
    if (xscale.kind !== "success") return;
    expect(xscale.newSource).toContain("xscale=\\sx");
    expect(xscale.newSource).not.toContain("shift={");
    expect(xscale.newSource).toContain("xshift=2pt");
    expect(xscale.newSource).toContain("yshift=-3pt");
    expectPatchesReconstructSource(xscaleSource, xscale);

    const yscaleSource = String.raw`\begin{tikzpicture}
  \begin{scope}[yscale=\sy, xshift=2pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const yscale = applyEditAction(yscaleSource, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, 6)
    });

    expect(yscale.kind).toBe("success");
    if (yscale.kind !== "success") return;
    expect(yscale.newSource).toContain("yscale=\\sy");
    expect(yscale.newSource).toContain("xshift=6pt");
    expect(yscale.newSource).toContain("yshift=6pt");
    expectPatchesReconstructSource(yscaleSource, yscale);
  });

  it("removes scope shift components when a move cancels them out", () => {
    const xOnly = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=2pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const movedXOnly = applyEditAction(xOnly, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(-2, 0)
    });

    expect(movedXOnly.kind).toBe("success");
    if (movedXOnly.kind !== "success") return;
    expect(movedXOnly.newSource).not.toContain("xshift");
    expect(movedXOnly.newSource).not.toContain("yshift");
    expectPatchesReconstructSource(xOnly, movedXOnly);

    const yOnly = String.raw`\begin{tikzpicture}
  \begin{scope}[yshift=3pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const movedYOnly = applyEditAction(yOnly, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(0, -3)
    });

    expect(movedYOnly.kind).toBe("success");
    if (movedYOnly.kind !== "success") return;
    expect(movedYOnly.newSource).not.toContain("xshift");
    expect(movedYOnly.newSource).not.toContain("yshift");
    expectPatchesReconstructSource(yOnly, movedYOnly);

    const explicitZero = String.raw`\begin{tikzpicture}[
  box/.style={draw,rounded corners=2pt,fill=blue!10,minimum width=2.4cm,minimum height=9mm,align=center},
  >=Stealth
]
  \begin{scope}[yshift=0pt]
    \node[box] (start) at (0,0) {Start};
    \node[box] (step)  at (0,-1.6) {Process};
    \node[box] (check) at (0,-3.2) {Check};
    \draw[->] (start) -- (step);
    \draw[->] (step)  -- (check);
  \end{scope}
  \node[box,fill=green!15] (done) at (4,-3.2) {Done};
  \draw[->] (check) -- node[above] {ok} (done);
\end{tikzpicture}`;
    const movedExplicitZero = applyEditAction(explicitZero, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, 0)
    });

    expect(movedExplicitZero.kind).toBe("success");
    if (movedExplicitZero.kind !== "success") return;
    expect(movedExplicitZero.newSource).toContain("xshift=4pt");
    expect(movedExplicitZero.newSource).not.toContain("yshift");
    expectPatchesReconstructSource(explicitZero, movedExplicitZero);

    const tinyMoveExplicitZero = applyEditAction(explicitZero, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(0.4, 0.4)
    });

    expect(tinyMoveExplicitZero.kind).toBe("success");
    if (tinyMoveExplicitZero.kind !== "success") return;
    expect(tinyMoveExplicitZero.newSource).not.toContain("xshift=0pt");
    expect(tinyMoveExplicitZero.newSource).not.toContain("yshift=0pt");
    expect(tinyMoveExplicitZero.newSource).not.toContain("yshift");
    expectPatchesReconstructSource(explicitZero, tinyMoveExplicitZero);
  });

  it("rejects no-op scope moves for each scope placement rewrite path", () => {
    const withoutOptions = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const noOptions = applyEditAction(withoutOptions, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(0, 0)
    });
    expect(noOptions.kind).toBe("unsupported");
    if (noOptions.kind === "unsupported") {
      expect(noOptions.reason).toContain("already matches");
    }

    const xshiftSource = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=2pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const xshift = applyEditAction(xshiftSource, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(0, 0)
    });
    expect(xshift.kind).toBe("unsupported");
    if (xshift.kind === "unsupported") {
      expect(xshift.reason).toContain("already matches");
    }

    const shiftSource = String.raw`\begin{tikzpicture}
  \begin{scope}[shift=(2pt,3pt)]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const shift = applyEditAction(shiftSource, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(0, 0)
    });
    expect(shift.kind).toBe("unsupported");
    if (shift.kind === "unsupported") {
      expect(shift.reason).toContain("already matches");
    }
  });

  it("falls back to xshift and yshift when a scope shift prefix is not invertible", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[scale=0, shift=(2pt,3pt)]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, 6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("scale=0");
    expect(result.newSource).not.toContain("shift=(");
    expect(result.newSource).toContain("xshift=2pt");
    expect(result.newSource).toContain("yshift=9pt");
    expectPatchesReconstructSource(source, result);
  });

  it("falls back to xshift and yshift when scope transform prefixes are not invertible", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[scale=0, xshift=2pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, 6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xshift=6pt");
    expect(result.newSource).toContain("yshift=6pt");
    expectPatchesReconstructSource(source, result);
  });

  it("moves scopes without options by inserting xshift and yshift", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, -6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\begin{scope}[xshift=4pt, yshift=-6pt]");
    expectPatchesReconstructSource(source, result);
  });

  it("moves scopes with unrelated options by adding shift keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[draw]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, -6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\begin{scope}[draw, xshift=4pt, yshift=-6pt]");
    expectPatchesReconstructSource(source, result);
  });

  it("moves scopes and regular elements together in moveElements", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=1pt]
    \draw (0,0) -- (1,0);
  \end{scope}
  \draw (1,1) -- (2,2);
\end{tikzpicture}`;
    const raw = "(1,1)";
    const from = source.lastIndexOf(raw);
    const handle = makeHandle(source, {
      world: wp(cm(1), cm(1)),
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:2"
    });

    const result = applyEditAction(source, [handle], {
      kind: "moveElements",
      elementIds: ["scope:0", "path:2"],
      delta: wp(3, 2)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xshift=4pt");
    expect(result.newSource).toContain("(1.11,1.07)");
    expectPatchesReconstructSource(source, result);
  });

  it("returns partial when a scope moves but another selected element cannot", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=1pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElements",
      elementIds: ["missing-path", "scope:0"],
      delta: wp(3, 2)
    });

    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") return;
    expect(result.newSource).toContain("xshift=4pt");
    expect(result.reason).toContain("No handles found");
    expect(result.changedSourceIds).toEqual(["missing-path", "scope:0", "path:1"]);
    expectPatchesReconstructSource(source, result);
  });

  it("expands changed ids for nested moved scopes without duplicates", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=1pt]
    \draw (0,0) -- (1,0);
    \begin{scope}
      \draw (2,0) -- (3,0);
    \end{scope}
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElements",
      elementIds: ["scope:0", "scope:0"],
      delta: wp(2, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xshift=3pt");
    expect(result.changedSourceIds).toEqual(["scope:0", "path:1", "scope:2", "path:3"]);
    expectPatchesReconstructSource(source, result);
  });

  it("returns unsupported when matrix placement is already at the requested position", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] at (0,0) {
    A \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(0, 0)
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("already matches");
    }
  });

  it("rewrites tree root at options and rejects no-op tree root moves", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node[draw,at={(0,0)}] {Root}
    child { node {Leaf} };
\end{tikzpicture}`;

    const moved = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(1), cm(2))
    });
    expect(moved.kind).toBe("success");
    if (moved.kind !== "success") return;
    expect(moved.newSource).toContain("at=(1,2)");
    expectPatchesReconstructSource(source, moved);

    const noOp = applyEditAction(moved.newSource, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(0, 0)
    });
    expect(noOp.kind).toBe("unsupported");
    if (noOp.kind === "unsupported") {
      expect(noOp.reason).toContain("already matches");
    }
  });

  it("prefers rewriting inline at when both inline and option placement are present", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,at={(10,10)}] at (0,0) {
    A \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("at={(10,10)}");
    expect(result.newSource).toContain("] at (1,2)");
  });

  it("returns partial when only the matrix portion of a mixed moveElements selection can move", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] at (0,0) {
    A \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElements",
      elementIds: ["missing-path", "path:0"],
      delta: wp(cm(1), cm(1))
    });

    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") return;
    expect(result.newSource).toContain("at (1,1)");
    expect(result.reason).toContain("No handles found");
    expect(result.changedSourceIds).toEqual(["missing-path", "path:0"]);
    expectPatchesReconstructSource(source, result);
  });
});

describe("applyEditAction – moveElement with positioning", () => {
  it("rewrites right=1cm of A to compound direction when dragged diagonally", () => {
    const source = String.raw`\begin{tikzpicture}
\node (A) at (0,0) {A};
\node[right=1cm of A] (B) {B};
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const evaluated = evaluateTikzFigure(parsed.figure, source);
    const handles = evaluated.editHandles;

    // Find the positioning handle for node B
    const posHandle = handles.find((h) => h.rewriteMode === "positioning");
    expect(posHandle).toBeDefined();
    if (!posHandle) return;

    // The positioning handle's sourceId is the statement ID for node B
    const elementId = posHandle.sourceRef.sourceId;

    // Move node B up and further right
    const result = applyEditAction(source, handles, {
      kind: "moveElement",
      elementId,
      delta: wp(cm(1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    // Should have rewritten the positioning option
    expect(result.newSource).toContain("above right=");
    expect(result.newSource).toContain("of A");
    // Should NOT contain the original "right=1cm of A"
    expect(result.newSource).not.toContain("right=1cm of A");
  });

  it("rewrites below right positioning to above right when dragged upward across the target center", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
\node (A) at (0,0) {A};
\node[below right={1cm and 1cm} of A] (B) {B};
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const evaluated = evaluateTikzFigure(parsed.figure, source);
    const handles = evaluated.editHandles;
    const posHandle = handles.find((handle) => handle.rewriteMode === "positioning");

    expect(posHandle).toBeDefined();
    if (!posHandle) return;

    const result = applyEditAction(source, handles, {
      kind: "moveElement",
      elementId: posHandle.sourceRef.sourceId,
      delta: wp(0, cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("above right={-0.23cm and 1cm} of A");
  });
});

describe("applyEditAction – node relative positioning conversions", () => {
  function pathStatementIds(source: string): string[] {
    const parsed = parseTikz(source, { recover: true });
    return parsed.figure.body
      .filter((statement) => statement.kind === "Path")
      .map((statement) => statement.id);
  }

  function nodeCenter(source: string, sourceId: string, evaluateOptions?: Parameters<typeof evaluateTikzFigure>[2]): WorldPoint {
    const parsed = parseTikz(source, { recover: true });
    const evaluated = evaluateTikzFigure(parsed.figure, source, evaluateOptions);
    const handle = evaluated.editHandles.find(
      (candidate) => candidate.sourceRef.sourceId === sourceId && candidate.kind === "node-position"
    );
    expect(handle).toBeDefined();
    return handle!.world;
  }

  function expectPointClose(actual: WorldPoint, expected: WorldPoint): void {
    expect(Math.abs(actual.x - expected.x)).toBeLessThan(0.15);
    expect(Math.abs(actual.y - expected.y)).toBeLessThan(0.15);
  }

  function expectAbsoluteRelativeAbsoluteRoundTrip(
    source: string,
    options: {
      targetNodeName?: string;
      evaluateOptions?: Parameters<typeof evaluateTikzFigure>[2];
    } = {}
  ): void {
    const [targetId, nodeId] = pathStatementIds(source);
    const targetNodeName = options.targetNodeName ?? "A";
    const before = nodeCenter(source, nodeId!, options.evaluateOptions);

    const relative = applyEditAction(source, [], {
      kind: "positionNodeRelativeTo",
      nodeId: nodeId!,
      targetNodeName,
      targetNodeSourceId: targetId!
    }, {
      evaluateOptions: options.evaluateOptions
    });

    expect(relative.kind).toBe("success");
    if (relative.kind !== "success") return;
    expect(relative.newSource).toContain(`of ${targetNodeName}`);
    expectPatchesReconstructSource(source, relative);

    const [, relativeNodeId] = pathStatementIds(relative.newSource);
    const absolute = applyEditAction(relative.newSource, [], {
      kind: "convertNodePositionToAbsolute",
      nodeId: relativeNodeId!
    }, {
      evaluateOptions: options.evaluateOptions
    });

    expect(absolute.kind).toBe("success");
    if (absolute.kind !== "success") return;
    expect(absolute.newSource).toContain(" at (");
    expect(absolute.newSource).not.toContain(`of ${targetNodeName}`);
    expectPointClose(nodeCenter(absolute.newSource, pathStatementIds(absolute.newSource)[1]!, options.evaluateOptions), before);
    expectPatchesReconstructSource(relative.newSource, absolute);
  }

  it("converts an absolute node to modern right-of positioning", () => {
    const source = String.raw`\begin{tikzpicture}
\node[draw] (A) at (0,0) {A};
\node[draw] (B) at (2,0) {B};
\end{tikzpicture}`;
    const [targetId, nodeId] = pathStatementIds(source);
    const before = nodeCenter(source, nodeId!);

    const result = applyEditAction(source, [], {
      kind: "positionNodeRelativeTo",
      nodeId: nodeId!,
      targetNodeName: "A",
      targetNodeSourceId: targetId!
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("right=");
    expect(result.newSource).toContain("of A");
    expect(result.newSource).not.toContain("at (2,0)");
    expectPointClose(nodeCenter(result.newSource, nodeId!), before);
    expectPatchesReconstructSource(source, result);
  });

  it("preserves shaped node placement when converting to relative positioning", () => {
    const source = String.raw`\begin{tikzpicture}
\node[draw,circle,minimum size=1cm] (A) at (0,0) {A};
\node[draw,diamond,minimum size=1cm] (B) at (2,0) {B};
\end{tikzpicture}`;
    const [targetId, nodeId] = pathStatementIds(source);
    const before = nodeCenter(source, nodeId!);

    const result = applyEditAction(source, [], {
      kind: "positionNodeRelativeTo",
      nodeId: nodeId!,
      targetNodeName: "A",
      targetNodeSourceId: targetId!
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("right=");
    expect(result.newSource).toContain("of A");
    expectPointClose(nodeCenter(result.newSource, nodeId!), before);
  });

  it("serializes diagonal relative positioning with vertical and horizontal distances", () => {
    const source = String.raw`\begin{tikzpicture}
\node (A) at (0,0) {A};
\node (B) at (2,2) {B};
\end{tikzpicture}`;
    const [targetId, nodeId] = pathStatementIds(source);

    const result = applyEditAction(source, [], {
      kind: "positionNodeRelativeTo",
      nodeId: nodeId!,
      targetNodeName: "A",
      targetNodeSourceId: targetId!
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("above right={");
    expect(result.newSource).toContain("} of A");
  });

  it("converts a relatively positioned node back to absolute positioning", () => {
    const source = String.raw`\begin{tikzpicture}
\node (A) at (0,0) {A};
\node[right=1cm of A] (B) {B};
\end{tikzpicture}`;
    const [, nodeId] = pathStatementIds(source);
    const before = nodeCenter(source, nodeId!);

    const result = applyEditAction(source, [], {
      kind: "convertNodePositionToAbsolute",
      nodeId: nodeId!
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(" at (");
    expect(result.newSource).not.toContain("right=1cm of A");
    expectPointClose(nodeCenter(result.newSource, nodeId!), before);
    expectPatchesReconstructSource(source, result);
  });

  it("round trips cardinal absolute positioning through relative positioning", () => {
    expectAbsoluteRelativeAbsoluteRoundTrip(String.raw`\begin{tikzpicture}
\node[draw] (A) at (0,0) {A};
\node[draw] (B) at (2,0) {B};
\end{tikzpicture}`);
  });

  it("round trips diagonal absolute positioning through relative positioning", () => {
    expectAbsoluteRelativeAbsoluteRoundTrip(String.raw`\begin{tikzpicture}
\node[draw] (A) at (0,0) {A};
\node[draw] (B) at (2,2) {B};
\end{tikzpicture}`);
  });

  it("round trips shaped absolute positioning through relative positioning", () => {
    expectAbsoluteRelativeAbsoluteRoundTrip(String.raw`\begin{tikzpicture}
\node[draw,circle,minimum size=1cm] (A) at (0,0) {A};
\node[draw,diamond,minimum size=1cm] (B) at (2.6,1.8) {B};
\end{tikzpicture}`);
  });

  it("round trips text nodes with different inner sep through diagonal relative positioning", async () => {
    const textEngine = await createMathJaxNodeTextEngine();
    expectAbsoluteRelativeAbsoluteRoundTrip(String.raw`\begin{tikzpicture}
  \node[draw, inner sep=4pt] (a) at (-0.2,2.66) {node a};
  \node[draw, inner sep=1pt] (b) at (1.35,1.8) {node b};
\end{tikzpicture}`, {
      targetNodeName: "a",
      evaluateOptions: { textEngine }
    });
  });

  it("rejects relative positioning that would need a negative distance", () => {
    const source = String.raw`\begin{tikzpicture}
\node[draw] (A) at (0,0) {A};
\node[draw] (B) at (0,0) {B};
\end{tikzpicture}`;
    const [targetId, nodeId] = pathStatementIds(source);

    const result = applyEditAction(source, [], {
      kind: "positionNodeRelativeTo",
      nodeId: nodeId!,
      targetNodeName: "A",
      targetNodeSourceId: targetId!
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("negative positioning distance");
  });

  it("rejects path-attached target nodes", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,0) node[midway] (A) {A};
\node (B) at (2,0) {B};
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const evaluated = evaluateTikzFigure(parsed.figure, source);
    const targetSourceId = evaluated.nodeAnchorTargets.find(
      (target) => target.nodeName === "A" && target.anchor === "center"
    )?.nodeSourceId;
    const [, nodeId] = pathStatementIds(source);

    expect(targetSourceId).toBeDefined();
    const result = applyEditAction(source, [], {
      kind: "positionNodeRelativeTo",
      nodeId: nodeId!,
      targetNodeName: "A",
      targetNodeSourceId: targetSourceId!
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("Path-attached target nodes");
  });
});

describe("applyEditAction – node adornments", () => {
  it("duplicates a single label option without duplicating the whole node", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label=right:L] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "duplicateAdornment",
      targetId: "node-adornment:node:0:2:label:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("label=right:L, label=right:L");
  });

  it("deletes only the selected pin option", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin=above:P,label=right:L] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteAdornment",
      targetId: "node-adornment:node:0:2:pin:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("pin=above:P");
    expect(result.newSource).toContain("label=right:L");
  });

  it("normalizes surrounding commas and whitespace when deleting adornments", () => {
    const firstSource = String.raw`\begin{tikzpicture}
  \node[draw,pin=above:P,  label=right:L] at (0,0) {A};
\end{tikzpicture}`;
    const first = applyEditAction(firstSource, [], {
      kind: "deleteAdornment",
      targetId: "node-adornment:node:0:2:pin:0"
    });
    expect(first.kind).toBe("success");
    if (first.kind !== "success") {
      throw new Error("Expected pin deletion to succeed");
    }
    expect(first.newSource).toContain("\\node[draw,label=right:L]");

    const lastSource = String.raw`\begin{tikzpicture}
  \node[draw, pin=above:P, label=right:L] at (0,0) {A};
\end{tikzpicture}`;
    const last = applyEditAction(lastSource, [], {
      kind: "deleteAdornment",
      targetId: "node-adornment:node:0:2:label:1"
    });
    expect(last.kind).toBe("success");
    if (last.kind !== "success") {
      throw new Error("Expected label deletion to succeed");
    }
    expect(last.newSource).toContain("\\node[draw, pin=above:P]");
  });

  it("rejects missing adornment deletion targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin=above:P,label=right:L] at (0,0) {A};
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "deleteAdornment",
      targetId: "node-adornment:missing"
    })).toEqual({
      kind: "unsupported",
      reason: "Selected adornment could not be resolved for deletion."
    });
  });

  it("preserves pin edge options when editing pin text", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin={[pin edge={draw=blue,dashed,line width=1pt}]above:P}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: "__adornment_text__",
      value: "Q"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("pin edge={draw=blue,dashed,line width=1pt}");
    expect(result.newSource).toContain("above:Q");
  });

  it("preserves pin edge options when editing pin draw color", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin={[pin edge={draw=blue,dashed,line width=1pt},fill=yellow]above:P}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("pin edge={draw=blue,dashed,line width=1pt}");
    expect(result.newSource).toContain("fill=yellow");
    expect(result.newSource).toContain("draw=red");
  });

  it("rejects invalid adornment property writes before rewriting source", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label=right:L] at (0,0) {A};
\end{tikzpicture}`;

    const invalidAngle = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "__adornment_angle__",
      value: "not-a-number"
    });
    expect(invalidAngle.kind).toBe("error");

    const invalidDistance = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "__adornment_distance__",
      value: "not-a-length"
    });
    expect(invalidDistance.kind).toBe("error");

    const emptyKey = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "   ",
      value: "red"
    });
    expect(emptyKey.kind).toBe("error");
  });

  it("normalizes adornment angles, text fallbacks, and no-op rewrites", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label=right:L] at (0,0) {A};
\end{tikzpicture}`;

    const wrappedAngle = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "__adornment_angle__",
      value: "-45"
    });
    expect(wrappedAngle.kind).toBe("success");
    if (wrappedAngle.kind !== "success") {
      throw new Error("Expected wrapped adornment angle rewrite to succeed");
    }
    expect(wrappedAngle.newSource).toContain("label=below right:L");

    const numericAngle = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "__adornment_angle__",
      value: "22"
    });
    expect(numericAngle.kind).toBe("success");
    if (numericAngle.kind !== "success") {
      throw new Error("Expected numeric adornment angle rewrite to succeed");
    }
    expect(numericAngle.newSource).toContain("label=22:L");

    const emptyText = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "__adornment_text__",
      value: ""
    });
    expect(emptyText.kind).toBe("success");
    if (emptyText.kind !== "success") {
      throw new Error("Expected empty adornment text rewrite to succeed");
    }
    expect(emptyText.newSource).toContain("label=right:label");

    const noOp = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "__adornment_angle__",
      value: "0"
    });
    expect(noOp).toEqual({
      kind: "unsupported",
      reason: ADORNMENT_EDIT_NOOP_REASON
    });
  });

  it("keeps exported adornment setters defensive for non-adornment targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const nonAdornmentTarget = {
      id: "path:0",
      kind: "style-source",
      span: { from: 0, to: source.length }
    } as Parameters<typeof applyAdornmentSetProperty>[1];

    expect(applyAdornmentSetProperty(source, nonAdornmentTarget, {
      elementId: "path:0",
      key: "draw",
      value: "red"
    })).toEqual({
      kind: "unsupported",
      reason: "Adornment target does not have a writable value span."
    });
    expect(applyAdornmentValueRewrite(source, nonAdornmentTarget, undefined, "path:0")).toEqual({
      kind: "unsupported",
      reason: "Adornment target does not have a writable value span."
    });
  });

  it("rewrites generic adornment options while honoring clear keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label={[fill=yellow,draw=blue,text=green]right:L}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "draw",
      value: "red",
      clearKeys: ["", "draw", "fill"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("draw=red");
    expect(result.newSource).toContain("text=green");
    expect(result.newSource).not.toContain("fill=yellow");
    expect(result.newSource).not.toContain("draw=blue");
  });

  it("removes generic adornment options and braces comma-containing label text", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label={[fill=yellow]right:L}] at (0,0) {A};
\end{tikzpicture}`;

    const removed = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "fill",
      value: ""
    });
    expect(removed.kind).toBe("success");
    if (removed.kind !== "success") return;
    expect(removed.newSource).not.toContain("fill=yellow");

    const text = applyEditAction(removed.newSource, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "__adornment_text__",
      value: "A,B"
    });
    expect(text.kind).toBe("success");
    if (text.kind !== "success") return;
    expect(text.newSource).toContain("right:{A,B}");
  });
});

describe("applyEditAction – alignElements", () => {
  const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,2) -- (3,2);
\end{tikzpicture}`;

  it("returns unsupported when fewer than two unique elements are selected", () => {
    const result = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:0", " "],
      mode: "left"
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("at least 2");
    }
  });

  it("aligns left/center/right using selection bounds", () => {
    const left = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "left"
    });
    expect(left.kind).toBe("success");
    if (left.kind === "success") {
      expect(left.newSource).toContain("\\draw (0,2) -- (1,2);");
    }

    const center = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "center"
    });
    expect(center.kind).toBe("success");
    if (center.kind === "success") {
      expect(center.newSource).toContain("\\draw (1,0) -- (2,0);");
      expect(center.newSource).toContain("\\draw (1,2) -- (2,2);");
    }

    const right = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "right"
    });
    expect(right.kind).toBe("success");
    if (right.kind === "success") {
      expect(right.newSource).toContain("\\draw (2,0) -- (3,0);");
    }
  });

  it("aligns top/middle/bottom in world y-up coordinates", () => {
    const top = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "top"
    });
    expect(top.kind).toBe("success");
    if (top.kind === "success") {
      expect(top.newSource).toContain("\\draw (0,2) -- (1,2);");
    }

    const middle = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "middle"
    });
    expect(middle.kind).toBe("success");
    if (middle.kind === "success") {
      expect(middle.newSource).toContain("\\draw (0,1) -- (1,1);");
      expect(middle.newSource).toContain("\\draw (2,1) -- (3,1);");
    }

    const bottom = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "bottom"
    });
    expect(bottom.kind).toBe("success");
    if (bottom.kind === "success") {
      expect(bottom.newSource).toContain("\\draw (2,0) -- (3,0);");
    }
  });

  it("returns unsupported for no-op aligns", () => {
    const aligned = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;
    const result = applyEditAction(aligned, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "left"
    });
    expect(result.kind).toBe("unsupported");
  });

  it("fails atomically when any selected element is non-rewritable", () => {
    const mixed = String.raw`\begin{tikzpicture}
  \coordinate (A) at (2,0);
  \coordinate (B) at (3,0);
  \draw (0,0) -- (1,0);
  \draw (A) -- (B);
\end{tikzpicture}`;

    const result = applyEditAction(mixed, [], {
      kind: "alignElements",
      elementIds: ["path:2", "path:3"],
      mode: "left"
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("unsupported coordinate forms");
    }
  });
});

describe("applyEditAction – distributeElements", () => {
  it("returns unsupported when fewer than three unique elements are selected", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,0) -- (3,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "distributeElements",
      elementIds: ["path:0", "path:1", "path:1"],
      axis: "horizontal"
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("at least 3");
    }
  });

  it("distributes horizontal gaps with endpoints fixed", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,0) -- (3,0);
  \draw (10,0) -- (11,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "distributeElements",
      elementIds: ["path:0", "path:1", "path:2"],
      axis: "horizontal"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
      expect(result.newSource).toContain("\\draw (5,0) -- (6,0);");
      expect(result.newSource).toContain("\\draw (10,0) -- (11,0);");
    }
  });

  it("distributes vertical gaps with endpoints fixed", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,10) -- (1,10);
  \draw (0,6) -- (1,6);
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "distributeElements",
      elementIds: ["path:0", "path:1", "path:2"],
      axis: "vertical"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,10) -- (1,10);");
      expect(result.newSource).toContain("\\draw (0,5) -- (1,5);");
      expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
    }
  });

  it("returns unsupported for no-op distributions", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,4) -- (1,4);
  \draw (0,2) -- (1,2);
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "distributeElements",
      elementIds: ["path:0", "path:1", "path:2"],
      axis: "vertical"
    });
    expect(result.kind).toBe("unsupported");
  });

  it("fails atomically when any selected element is non-rewritable", () => {
    const mixed = String.raw`\begin{tikzpicture}
  \coordinate (A) at (2,0);
  \coordinate (B) at (3,0);
  \draw (0,0) -- (1,0);
  \draw (A) -- (B);
  \draw (10,0) -- (11,0);
\end{tikzpicture}`;
    const result = applyEditAction(mixed, [], {
      kind: "distributeElements",
      elementIds: ["path:2", "path:3", "path:4"],
      axis: "horizontal"
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("unsupported coordinate forms");
    }
  });
});

// ── setProperty ───────────────────────────────────────────────────────────────

describe("applyEditAction – setProperty", () => {
  const lineWidthPresetKeys = [
    "ultra thin",
    "very thin",
    "thin",
    "semithick",
    "thick",
    "very thick",
    "ultra thick"
  ];

  function resolveFirstGridKeywordId(source: string): string {
    const parsed = parseTikz(source);
    for (const statement of parsed.figure.body) {
      if (statement.kind !== "Path") {
        continue;
      }
      const keyword = statement.items.find((item) => item.kind === "PathKeyword" && item.keyword === "grid");
      if (keyword && keyword.kind === "PathKeyword") {
        return keyword.id;
      }
    }
    throw new Error("Expected at least one grid path keyword");
  }

  it("updates an existing command option key", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, line width=0.4pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "line width",
      value: "1.2pt"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[blue, line width=1.2pt] (0,0) -- (1,0);");
      expect(result.patches).toHaveLength(1);
    }
  });

  it("rejects empty setProperty keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "   ",
      value: "red"
    });

    expect(result).toEqual({
      kind: "error",
      message: "Cannot set an empty option key"
    });
  });

  it("returns unsupported for no-op setProperty writes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "blue",
      clearKeys: ["", "draw"]
    });

    expect(result).toEqual({
      kind: "unsupported",
      reason: "setProperty would not change the source."
    });
  });

  it("disables and enables multiline command options by comment toggling exact source text", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[
    blue,
    line width={max(1pt,2pt)},
    decoration={markings, mark=at position 0.5 with {\arrow{>}}},
    % keep this note
  ] (0,0) -- (1,0);
\end{tikzpicture}`;

    const disabled = applyEditAction(
      source,
      [],
      {
        kind: "setProperty",
        elementId: "path:0",
        level: "command",
        key: "line width",
        value: "ignored",
        commentMode: "disable",
        commentSourceText: "line width={max(1pt,2pt)},"
      },
      { parseOptions: { indentSize: 4 } }
    );

    expect(disabled.kind).toBe("success");
    if (disabled.kind !== "success") {
      throw new Error("Expected comment disable to succeed");
    }
    expect(disabled.newSource).toContain("    % line width={max(1pt,2pt)},");
    expect(disabled.newSource).toContain("    % keep this note");
    expect(disabled.newSource).toContain("decoration={markings, mark=at position 0.5 with {\\arrow{>}}}");

    const enabled = applyEditAction(disabled.newSource, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "line width",
      value: "ignored",
      commentMode: "enable",
      commentSourceText: "% line width={max(1pt,2pt)},"
    });

    expect(enabled.kind).toBe("success");
    if (enabled.kind !== "success") {
      throw new Error("Expected comment enable to succeed");
    }
    expect(enabled.newSource).toContain("  line width={max(1pt,2pt)},");
    expect(enabled.newSource).not.toContain("% line width={max(1pt,2pt)}");
  });

  it("comment toggles inline options and preserves escaped percent signs", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=blue, text={100\% sure}, dashed] (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "dashed",
      value: "ignored",
      commentMode: "disable"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected inline comment toggle to succeed");
    }
    expect(result.newSource).toContain("text={100\\% sure}");
    expect(result.newSource).toContain("% dashed,");
  });

  it("falls back from stale exact comment text to normalized keys in nested option lists", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=blue, decorate, decoration={markings, mark=at position 0.5 with {\arrow{>}}}, preaction={[draw=red]}, text={a,b[c]}] (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "ignored",
      commentMode: "disable",
      commentSourceText: "draw=green"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected nested option comment toggle to succeed");
    }
    expect(result.newSource).toContain("% draw=blue,");
    expect(result.newSource).toContain("decoration={markings, mark=at position 0.5 with {\\arrow{>}}}");
    expect(result.newSource).toContain("preaction={[draw=red]}");
    expect(result.newSource).toContain("text={a,b[c]}");
  });

  it("reports unsupported comment toggles for missing or ineligible matches", () => {
    const noMatch = applyEditAction(String.raw`\begin{tikzpicture}
  \draw[blue] (0,0) -- (1,0);
\end{tikzpicture}`, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "fill",
      value: "ignored",
      commentMode: "disable"
    });
    expect(noMatch).toEqual({
      kind: "unsupported",
      reason: "Could not find a matching declaration to toggle."
    });

    const noOptions = applyEditAction(String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "ignored",
      commentMode: "disable"
    });
    expect(noOptions).toEqual({
      kind: "unsupported",
      reason: "No writable option list is available for comment toggling."
    });
  });

  it("comment toggles around empty and malformed commented option fragments", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[
    % ,
    draw=red
  ] (0,0) -- (1,0);
\end{tikzpicture}`;

    const disabled = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "ignored",
      commentMode: "disable"
    });

    expect(disabled.kind).toBe("success");
    if (disabled.kind !== "success") {
      throw new Error("Expected comment toggle with empty commented fragment to succeed");
    }
    expect(disabled.newSource).toContain(String.raw`% ,
    % draw=red,`);

    const malformed = String.raw`\begin{tikzpicture}
  \draw[
    % ],
    % draw=red,
    fill=blue
  ] (0,0) -- (1,0);
\end{tikzpicture}`;
    const enabled = applyEditAction(malformed, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "ignored",
      commentMode: "enable"
    });

    expect(enabled.kind).toBe("success");
    if (enabled.kind !== "success") {
      throw new Error("Expected comment toggle with malformed commented fragment to succeed");
    }
    expect(enabled.newSource).toContain(String.raw`% ],
    draw=red,
    fill=blue`);
  });

  it("rejects empty comment-toggle keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: " ",
      value: "ignored",
      commentMode: "disable"
    });

    expect(result).toEqual({
      kind: "error",
      message: "Cannot toggle an empty option key"
    });
  });

  it("rejects comment toggles for matrix-cell property targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[draw=red]| B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: "ignored",
      commentMode: "disable"
    });

    expect(result).toEqual({
      kind: "unsupported",
      reason: "Property comment toggles are unavailable for this source target."
    });
  });

  it("comment toggles style-source entries in bare option values", () => {
    const source = String.raw`\begin{tikzpicture}[accent/.style={draw=red, fill=blue}]
  \draw[accent] (0,0) -- (1,0);
\end{tikzpicture}`;
    const styleStart = source.indexOf("accent/.style");
    const styleEnd = source.indexOf("}]", styleStart) + 1;
    const styleTargetId = makeStyleSourceTargetId({ from: styleStart, to: styleEnd });

    const disabled = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: styleTargetId,
      level: "named-style",
      key: "draw",
      value: "ignored",
      commentMode: "disable"
    });

    expect(disabled.kind).toBe("success");
    if (disabled.kind !== "success") {
      throw new Error("Expected style-source disable to succeed");
    }
    expect(disabled.newSource).toContain(String.raw`accent/.style={
  % draw=red,
  fill=blue
}`);

    const enabledStart = disabled.newSource.indexOf("accent/.style");
    const enabledEnd = disabled.newSource.indexOf("}", enabledStart) + 1;
    const enabledTargetId = makeStyleSourceTargetId({ from: enabledStart, to: enabledEnd });
    const enabled = applyEditAction(disabled.newSource, [], {
      kind: "setProperty",
      elementId: enabledTargetId,
      level: "named-style",
      key: "draw",
      value: "ignored",
      commentMode: "enable"
    });

    expect(enabled.kind).toBe("success");
    if (enabled.kind !== "success") {
      throw new Error("Expected style-source enable to succeed");
    }
    expect(enabled.newSource).toContain(String.raw`accent/.style={
  draw=red,
  fill=blue
}`);
  });

  it("comment toggles braced tikzset style values", () => {
    const source = String.raw`\tikzset{accent/.style={draw=red, fill=blue}}`;
    const styleStart = source.indexOf("accent/.style");
    const styleEnd = source.lastIndexOf("}");
    const styleTargetId = makeStyleSourceTargetId({ from: styleStart, to: styleEnd });

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: styleTargetId,
      level: "named-style",
      key: "fill",
      value: "ignored",
      commentMode: "disable"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected braced tikzset style toggle to succeed");
    }
    expect(result.newSource).toContain(String.raw`accent/.style={
  draw=red,
  % fill=blue,
}`);
  });

  it("comment toggles legacy bracketed tikzstyle values and empty multiline styles", () => {
    const legacy = String.raw`\tikzstyle{accent}=[draw=red, fill=blue]`;
    const legacyTarget = makeStyleSourceTargetId({ from: 0, to: legacy.length });

    const disabled = applyEditAction(legacy, [], {
      kind: "setProperty",
      elementId: legacyTarget,
      level: "named-style",
      key: "fill",
      value: "ignored",
      commentMode: "disable"
    });

    expect(disabled.kind).toBe("success");
    if (disabled.kind !== "success") {
      throw new Error("Expected legacy tikzstyle toggle to succeed");
    }
    expect(disabled.newSource).toContain("% fill=blue");
    expect(disabled.newSource).toContain("[");
    expect(disabled.newSource).toContain("]");

    const emptyStyle = String.raw`accent/.style={

}`;
    const emptyTarget = makeStyleSourceTargetId({ from: 0, to: emptyStyle.length });
    const inserted = applyEditAction(emptyStyle, [], {
      kind: "setProperty",
      elementId: emptyTarget,
      level: "named-style",
      key: "draw",
      value: "red"
    });

    expect(inserted.kind).toBe("success");
    if (inserted.kind !== "success") {
      throw new Error("Expected empty style insertion to succeed");
    }
    expect(inserted.newSource).toBe(String.raw`accent/.style={draw=red}`);
  });

  it("supports writing named line width flags while clearing numeric line width", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, line width=0.2pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "very thin",
      value: "true",
      clearKeys: ["line width", ...lineWidthPresetKeys.filter((key) => key !== "very thin")]
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[blue, very thin] (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("line width=");
    }
  });

  it("supports writing numeric line width while clearing preset flags", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, very thin] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "line width",
      value: "1.3pt",
      clearKeys: lineWidthPresetKeys
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[blue, line width=1.3pt] (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("very thin");
    }
  });

  it("inserts a new command option list when none exists", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[red] (0,0) -- (1,0);");
    }
  });

  it("serializes fill color as a bare option when setting color on a \\fill path", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "fill",
      value: "yellow"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\fill[yellow] (0,0) rectangle (1,1);");
    }
  });

  it("replaces existing bare draw color flags instead of appending duplicates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, thick] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[red, thick] (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("blue");
    }
  });

  it("serializes updated draw key values as bare colors on \\draw paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=blue, thick] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "green"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[green, thick] (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("draw=");
    }
  });

  it("rewrites no-draw \\draw paths to \\path when certified", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, thick] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "none"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\path[thick] (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("\\draw[none");
      expect(result.newSource).not.toContain("draw=none");
    }
  });

  it("rewrites no-fill \\fill paths to \\path when certified", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill[yellow] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "fill",
      value: "none"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\path (0,0) rectangle (1,1);");
      expect(result.newSource).not.toContain("\\fill[none");
      expect(result.newSource).not.toContain("fill=none");
    }
  });

  it("rewrites fill-only paint to \\fill when inherited draw is absent", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=none] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "fill",
      value: "red"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\fill[red] (0,0) rectangle (1,1);");
      expect(result.newSource).not.toContain("draw=none");
    }
  });

  it("keeps explicit draw disabling when inherited draw would change cleanup semantics", () => {
    const source = String.raw`\begin{tikzpicture}[draw]
  \draw[draw=none] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "fill",
      value: "red"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[draw=none, fill=red] (0,0) rectangle (1,1);");
    }
  });

  it("uses conservative property writes in preview mode", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, thick] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(
      source,
      [],
      {
        kind: "setProperty",
        elementId: "path:0",
        level: "command",
        key: "draw",
        value: "none"
      },
      { parseOptions: { propertyWriteMode: "preview" } }
    );

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[draw=none, thick] (0,0) -- (1,0);");
    }
  });

  it("cleans existing conservative paint writes on drag-end cleanup", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=none, fill=red] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "cleanupPropertyWrites"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\fill[red] (0,0) rectangle (1,1);");
      expect(result.newSource).not.toContain("draw=none");
    }
  });

  it("limits targeted paint cleanup to requested element ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=none, fill=red] (0,0) rectangle (1,1);
  \draw[draw=none, fill=blue] (2,0) rectangle (3,1);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "cleanupPropertyWrites",
      elementIds: ["path:0"]
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\fill[red] (0,0) rectangle (1,1);");
      expect(result.newSource).toContain("\\draw[draw=none, fill=blue] (2,0) rectangle (3,1);");
    }
  });

  it("reports no-op cleanup for empty targets and already idiomatic paint", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill[red] (0,0) rectangle (1,1);
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "cleanupPropertyWrites",
      elementIds: ["  "]
    })).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });
    expect(applyEditAction(source, [], {
      kind: "cleanupPropertyWrites"
    })).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });
  });

  it("cleans paint commands inside scopes and disabled filldraw combinations", () => {
    const nestedSource = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw[draw=none, fill=red] (0,0) rectangle (1,1);
  \end{scope}
\end{tikzpicture}`;
    const nested = applyEditAction(nestedSource, [], {
      kind: "cleanupPropertyWrites"
    });
    expect(nested.kind).toBe("success");
    if (nested.kind !== "success") {
      throw new Error("Expected nested cleanup to succeed");
    }
    expect(nested.newSource).toContain("\\fill[red] (0,0) rectangle (1,1);");

    const bothDisabled = applyEditAction(String.raw`\begin{tikzpicture}
  \filldraw[draw=false, fill=false] (0,0) rectangle (1,1);
\end{tikzpicture}`, [], {
      kind: "cleanupPropertyWrites"
    });
    expect(bothDisabled).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });

    const fillOnlyFilldraw = applyEditAction(String.raw`\begin{tikzpicture}
  \filldraw[draw=false, fill=red] (0,0) rectangle (1,1);
\end{tikzpicture}`, [], {
      kind: "cleanupPropertyWrites"
    });
    expect(fillOnlyFilldraw).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });

    const drawOnlyFilldraw = applyEditAction(String.raw`\begin{tikzpicture}
  \filldraw[draw=blue, fill=false] (0,0) rectangle (1,1);
\end{tikzpicture}`, [], {
      kind: "cleanupPropertyWrites"
    });
    expect(drawOnlyFilldraw).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });
  });

  it("skips cosmetic drag-end paint cleanup for large sources without conservative paint tokens", () => {
    const source = String.raw`\begin{tikzpicture}
  \filldraw[fill=blue!20] (0,0) rectangle (1,1);
${Array.from({ length: 5000 }, (_, index) => `  % large document filler ${index}`).join("\n")}
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "cleanupPropertyWrites",
      elementIds: ["path:0"]
    });

    expect(result).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });
  });

  it("omits local default-equivalent properties when certified", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[line cap=round] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "line cap",
      value: "butt"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("line cap=butt");
    }
  });

  it("keeps default-valued properties when omission would expose an inherited value", () => {
    const source = String.raw`\begin{tikzpicture}[line cap=round]
  \draw[line cap=round] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "line cap",
      value: "butt"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[line cap=butt] (0,0) -- (1,0);");
    }
  });

  it("inserts node options when targeting a node item id", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) node {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      throw new Error("Expected first statement to be a path");
    }
    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (!node || node.kind !== "Node") {
      throw new Error("Expected a node item");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: node.id,
      level: "command",
      key: "fill",
      value: "yellow"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,0) node[fill=yellow] {A};");
    }
  });

  it("appends transparent inside an existing named node option list", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (B) at (1.5, -0.5) {B};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      throw new Error("Expected first statement to be a path");
    }
    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (!node || node.kind !== "Node") {
      throw new Error("Expected a node item");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: node.id,
      level: "command",
      key: "transparent",
      value: "true"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected node transparent rewrite to succeed");
    }
    expect(result.newSource).toContain("\\node[draw, transparent] (B) at (1.5, -0.5) {B};");
    expect(result.newSource).not.toContain("\\node[transparent][draw]");
  });

  it("inserts a matrix-cell option prefix when setting a property on a matrix-of-nodes cell", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell setProperty insertion to succeed");
    }
    expect(result.newSource).toContain("A & |[draw=red]| B");
  });

  it("rejects empty matrix-cell setProperty keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: " ",
      value: "red"
    });

    expect(result).toEqual({
      kind: "error",
      message: "Cannot set an empty option key"
    });
  });

  it("rejects clearing absent matrix-cell options", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: ""
    });

    expect(result).toEqual({
      kind: "unsupported",
      reason: "setProperty would not change the source."
    });
  });

  it("updates existing matrix-cell option prefixes", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[draw=red]| B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "fill",
      value: "yellow"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell option rewrite to succeed");
    }
    expect(result.newSource).toContain("|[draw=red, fill=yellow]| B");
  });

  it("normalizes matrix-cell clearKeys while setting a new primary option", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[draw=red, fill=yellow]| B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "fill",
      value: "blue",
      clearKeys: [" ", "draw", "fill"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell clearKeys rewrite to succeed");
    }
    expect(result.newSource).toContain("|[fill=blue]| B");
    expect(result.newSource).not.toContain("draw=red");
  });

  it("rejects no-op rewrites on existing matrix-cell option prefixes", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[draw=red]| B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result).toEqual({
      kind: "unsupported",
      reason: "setProperty would not change the source."
    });
  });

  it("rejects matrix-cell property writes on plain matrices", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result.kind).toBe("unsupported");
  });

  it("removes matrix-cell option prefix when clearing the only supported key", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[draw=red]| B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: ""
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell prefix removal to succeed");
    }
    expect(result.newSource).toContain("A & B \\\\");
    expect(result.newSource).not.toContain("|[draw=red]|");
  });

  it("removes matrix-cell option prefixes with whitespace around the option pipes", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & | [draw=red] |   B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: ""
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected spaced matrix-cell prefix removal to succeed");
    }
    expect(result.newSource).toContain("A & B \\\\");
    expect(result.newSource).not.toContain("[draw=red]");
  });

  it("keeps remaining matrix-cell options when clearing one of several keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[draw=red,fill=yellow]| B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: ""
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell partial key removal to succeed");
    }
    expect(result.newSource).toContain("|[fill=yellow]| B");
    expect(result.newSource).not.toContain("draw=red");
  });

  it("supports broader matrix-cell property keys like line width", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "line width",
      value: "1pt"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell line width insertion to succeed");
    }
    expect(result.newSource).toContain("A & |[line width=1pt]| B");
  });

  it("clears broader matrix-cell keys and removes empty option prefixes", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[line width=1pt]| B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "line width",
      value: ""
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell line width clear to succeed");
    }
    expect(result.newSource).toContain("A & B \\\\");
    expect(result.newSource).not.toContain("|[line width=1pt]|");
  });

  it("updates matrix-level row/column spacing properties", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,row sep=2mm,column sep=3mm] {
    A & B \\
  };
\end{tikzpicture}`;

    const rowSepResult = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "row sep",
      value: "5mm"
    });
    expect(rowSepResult.kind).toBe("success");
    if (rowSepResult.kind !== "success") {
      throw new Error("Expected matrix row sep update to succeed");
    }
    expect(rowSepResult.newSource).toContain("row sep=5mm");

    const columnSepResult = applyEditAction(rowSepResult.newSource, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "column sep",
      value: "7mm"
    });
    expect(columnSepResult.kind).toBe("success");
    if (columnSepResult.kind !== "success") {
      throw new Error("Expected matrix column sep update to succeed");
    }
    expect(columnSepResult.newSource).toContain("column sep=7mm");
  });

  it("updates matrix-level draw/fill properties", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;

    const drawResult = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "blue"
    });
    expect(drawResult.kind).toBe("success");
    if (drawResult.kind !== "success") {
      throw new Error("Expected matrix draw update to succeed");
    }
    expect(drawResult.newSource).toContain("draw=blue");

    const fillResult = applyEditAction(drawResult.newSource, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "fill",
      value: "yellow"
    });
    expect(fillResult.kind).toBe("success");
    if (fillResult.kind !== "success") {
      throw new Error("Expected matrix fill update to succeed");
    }
    expect(fillResult.newSource).toContain("fill=yellow");
  });

  it("keeps matrix-level inspector writes inside one option list", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[
    matrix of nodes,
    ampersand replacement=\&,
  ] (m) {
    A \& B \& C \\
    D \& E \& F \\
  };
\end{tikzpicture}`;

    const updates = [
      ["draw", "red"],
      ["column sep", "0.2pt"],
      ["row sep", "0.4pt"],
      ["row sep", "0.3pt"],
      ["row sep", "0.2pt"],
      ["column sep", "0.1pt"],
      ["row sep", "0.1pt"]
    ] as const;

    let current = source;
    for (const [key, value] of updates) {
      const result = applyEditAction(current, [], {
        kind: "setProperty",
        elementId: "path:0",
        level: "command",
        key,
        value
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error(`Expected matrix property '${key}' to update`);
      }
      current = result.newSource;
    }

    expect(current).toContain("\\matrix[");
    expect(current).toContain("matrix of nodes");
    expect(current).toContain("ampersand replacement=\\&");
    expect(current).toContain("draw=red");
    expect(current).toContain("column sep=0.1pt");
    expect(current).toContain("row sep=0.1pt");
    expect(current).not.toContain("][");
    expect(current.match(/\[/g)?.length ?? 0).toBe(1);
  });

  it("adds matrix rows at start, middle, and end using 1-based insert-at indices", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;

    const addStart = applyEditAction(source, [], {
      kind: "addMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 1
    });
    expect(addStart.kind).toBe("success");
    if (addStart.kind !== "success") {
      throw new Error("Expected addMatrixRow at start to succeed");
    }
    expect(addStart.changedSourceIds).toEqual(["path:0"]);

    const addMiddle = applyEditAction(source, [], {
      kind: "addMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 2
    });
    expect(addMiddle.kind).toBe("success");

    const addEnd = applyEditAction(source, [], {
      kind: "addMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 3
    });
    expect(addEnd.kind).toBe("success");
  });

  it("removes matrix rows with index validation", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
    C & D \\
    E & F \\
  };
\end{tikzpicture}`;

    const removeMiddle = applyEditAction(source, [], {
      kind: "removeMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 2
    });
    expect(removeMiddle.kind).toBe("success");
    if (removeMiddle.kind !== "success") {
      throw new Error("Expected removeMatrixRow to succeed");
    }
    expect(removeMiddle.newSource).not.toContain("C & D");

    const invalid = applyEditAction(source, [], {
      kind: "removeMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 4
    });
    expect(invalid.kind).toBe("unsupported");
  });

  it("adds and removes matrix columns at arbitrary indices for ragged matrices", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B & C \\
    D & E \\
    F \\
  };
\end{tikzpicture}`;

    const addColumn = applyEditAction(source, [], {
      kind: "addMatrixColumn",
      matrixSourceId: "path:0",
      columnIndex: 2
    });
    expect(addColumn.kind).toBe("success");
    if (addColumn.kind !== "success") {
      throw new Error("Expected addMatrixColumn to succeed");
    }
    expect(addColumn.changedSourceIds).toEqual(["path:0"]);

    const removeColumn = applyEditAction(addColumn.newSource, [], {
      kind: "removeMatrixColumn",
      matrixSourceId: "path:0",
      columnIndex: 3
    });
    expect(removeColumn.kind).toBe("success");
  });

  it("transposes rectangular matrices", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "transposeMatrix",
      matrixSourceId: "path:0"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected transposeMatrix to succeed");
    }
    expect(result.newSource).toMatch(/A\s*&\s*C\s*\\\\/);
    expect(result.newSource).toMatch(/B\s*&\s*D/);
  });

  it("transposes ragged matrices by padding then trimming trailing empties", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B & C \\
    D & E \\
    F \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "transposeMatrix",
      matrixSourceId: "path:0"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected ragged transpose to succeed");
    }
    expect(result.newSource).toMatch(/A\s*&\s*D\s*&\s*F\s*\\\\/);
    expect(result.newSource).toMatch(/B\s*&\s*E\s*\\\\/);
    expect(result.newSource).toMatch(/\n\s*C\s*}\s*;/);
  });

  it("handles empty matrix transposes without inventing cells", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "transposeMatrix",
      matrixSourceId: "path:0"
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("Matrix text span is unavailable for structural editing.");
    }
  });

  it("keeps custom ampersand replacement parseable across structural edits", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,ampersand replacement=\&] {
    A \& B \\
    C \& D \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addMatrixColumn",
      matrixSourceId: "path:0",
      columnIndex: 2
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected addMatrixColumn with ampersand replacement to succeed");
    }
    const rendered = renderTikzToSvg(result.newSource);
    expect(rendered.semantic.featureUsage.matrix_node).toBe("used-supported");
  });

  it("normalizes away boundary gap overrides in structural matrix rewrites", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A &[2mm] B \\[3mm]
    C & D \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 2
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected addMatrixRow with gap overrides to succeed");
    }
    expect(result.newSource).not.toContain("&[");
    expect(result.newSource).not.toContain("\\\\[");
  });

  it("rejects invalid matrix structural targets and indices", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;

    for (const action of [
      { kind: "addMatrixRow", matrixSourceId: "missing", rowIndex: 1 },
      { kind: "removeMatrixRow", matrixSourceId: "missing", rowIndex: 1 },
      { kind: "addMatrixColumn", matrixSourceId: "missing", columnIndex: 1 },
      { kind: "removeMatrixColumn", matrixSourceId: "missing", columnIndex: 1 },
      { kind: "transposeMatrix", matrixSourceId: "missing" }
    ] as const) {
      expect(applyEditAction(source, [], action).kind).toBe("unsupported");
    }

    for (const rowIndex of [0, 4, 1.5]) {
      expect(applyEditAction(source, [], {
        kind: "addMatrixRow",
        matrixSourceId: "path:0",
        rowIndex
      }).kind).toBe("unsupported");
    }
    for (const columnIndex of [0, 4, 1.5]) {
      expect(applyEditAction(source, [], {
        kind: "addMatrixColumn",
        matrixSourceId: "path:0",
        columnIndex
      }).kind).toBe("unsupported");
    }
    for (const rowIndex of [0, 3, 1.5]) {
      expect(applyEditAction(source, [], {
        kind: "removeMatrixRow",
        matrixSourceId: "path:0",
        rowIndex
      }).kind).toBe("unsupported");
    }
    for (const columnIndex of [0, 3, 1.5]) {
      expect(applyEditAction(source, [], {
        kind: "removeMatrixColumn",
        matrixSourceId: "path:0",
        columnIndex
      }).kind).toBe("unsupported");
    }
  });

  it("rejects removal of the final matrix row or column", () => {
    const oneRow = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] { A & B };
\end{tikzpicture}`;
    const oneColumn = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A \\
    B \\
  };
\end{tikzpicture}`;

    expect(applyEditAction(oneRow, [], {
      kind: "removeMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 1
    }).kind).toBe("unsupported");
    expect(applyEditAction(oneColumn, [], {
      kind: "removeMatrixColumn",
      matrixSourceId: "path:0",
      columnIndex: 1
    }).kind).toBe("unsupported");
  });

  it("routes tree-child layout keys to child options", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=2mm] { node[draw] {leaf} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leafText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "leaf"
    );
    if (!leafText || leafText.kind !== "Text" || !leafText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: "level distance",
      value: "5mm"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected tree-child layout update to succeed");
    }
    expect(result.newSource).toContain("child[level distance=5mm]");
    expect(result.newSource).toContain("node[draw] {leaf}");
  });

  it("clears existing tree-child layout options", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=2mm, sibling distance=3mm] { node[draw] {leaf} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leafText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "leaf"
    );
    if (!leafText || leafText.kind !== "Text" || !leafText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: "level distance",
      value: ""
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected tree-child layout clear to succeed");
    }
    expect(result.newSource).toContain("child[sibling distance=3mm]");
    expect(result.newSource).not.toContain("level distance");
  });

  it("routes tree-child node style keys to child root node options", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=2mm] { node[draw] {leaf} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leafText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "leaf"
    );
    if (!leafText || leafText.kind !== "Text" || !leafText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: "fill",
      value: "yellow"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected tree-child node style update to succeed");
    }
    expect(result.newSource).toContain("child[level distance=2mm]");
    expect(result.newSource).toContain("node[");
    expect(result.newSource).toContain("draw");
    expect(result.newSource).toContain("fill=yellow");
    expect(result.newSource).toContain("{leaf}");
  });

  it("supports broader tree-child node property writes (e.g. line width)", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=2mm] { node[draw] {leaf} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leafText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "leaf"
    );
    if (!leafText || leafText.kind !== "Text" || !leafText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: "line width",
      value: "1.5pt"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected broader tree-child node write to succeed");
    }
    expect(result.newSource).toContain("child[level distance=2mm]");
    expect(result.newSource).toContain("node[");
    expect(result.newSource).toContain("draw");
    expect(result.newSource).toContain("line width=1.5pt");
    expect(result.newSource).toContain("{leaf}");
  });

  it("rejects empty tree-child setProperty keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=2mm] { node[draw] {leaf} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leafText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "leaf"
    );
    if (!leafText || leafText.kind !== "Text" || !leafText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: " ",
      value: "red"
    });

    expect(result).toEqual({
      kind: "error",
      message: "Cannot set an empty option key"
    });
  });

  it("inserts missing tree-child option lists at the correct level", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {leaf} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leafText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "leaf"
    );
    if (!leafText || leafText.kind !== "Text" || !leafText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const layoutInsert = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: "sibling distance",
      value: "4mm"
    });
    expect(layoutInsert.kind).toBe("success");
    if (layoutInsert.kind !== "success") {
      throw new Error("Expected tree-child layout insert to succeed");
    }
    expect(layoutInsert.newSource).toContain("child[sibling distance=4mm] { node {leaf} }");

    const nodeInsert = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: "draw",
      value: "red"
    });
    expect(nodeInsert.kind).toBe("success");
    if (nodeInsert.kind !== "success") {
      throw new Error("Expected tree-child node options insert to succeed");
    }
    expect(nodeInsert.newSource).toContain("child { node[draw=red]");
    expect(nodeInsert.newSource).toContain("{leaf}");
  });

  it("rejects tree-child setProperty writes for child foreach", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child foreach \x in {A,B} { node {\x} };
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const path = parsed.figure.body.find((statement) => statement.kind === "Path");
    if (!path || path.kind !== "Path") {
      throw new Error("Expected path statement");
    }
    const childOperation = path.items.find((item) => item.kind === "ChildOperation");
    if (!childOperation || childOperation.kind !== "ChildOperation") {
      throw new Error("Expected child operation");
    }
    const syntheticChildId = `${path.id}:tree-child:1:${childOperation.id}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: syntheticChildId,
      level: "command",
      key: "draw",
      value: "red"
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("child foreach");
    }
  });

  it("updates an existing grid keyword option list by keyword id", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) grid[step=2mm] (2,2);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: resolveFirstGridKeywordId(source),
      level: "command",
      key: "step",
      value: "0.5cm",
      clearKeys: ["xstep", "x step", "ystep", "y step"]
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,0) grid[step=0.5cm] (2,2);");
    }
  });

  it("inserts a grid keyword option list when none exists", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) grid (2,2);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: resolveFirstGridKeywordId(source),
      level: "command",
      key: "xstep",
      value: "0.4cm",
      clearKeys: ["x step"]
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,0) grid[xstep=0.4cm] (2,2);");
    }
  });

  it("updates an existing tikzpicture global option key", () => {
    const source = String.raw`\begin{tikzpicture}[xscale=1.2, yscale=0.8]
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: TIKZPICTURE_GLOBAL_TARGET_ID,
      level: "command",
      key: "xscale",
      value: "2"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\begin{tikzpicture}[xscale=2, yscale=0.8]");
    }
  });

  it("inserts a tikzpicture global option list when missing", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: TIKZPICTURE_GLOBAL_TARGET_ID,
      level: "command",
      key: "xscale",
      value: "1.5"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\begin{tikzpicture}[xscale=1.5]");
    }
  });

  it("keeps a shadow preset as a flag when setProperty receives true", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[copy shadow] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "drop shadow",
      value: "true",
      clearKeys: ["copy shadow", "circular drop shadow", "circular glow", "general shadow", "double copy shadow"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw[drop shadow] (0,0) -- (1,0);");
    expect(result.newSource).not.toContain("copy shadow");
  });

  it("writes nested shadow options with braces", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[drop shadow] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "drop shadow",
      value: "{shadow xshift=2pt,shadow yshift=-3pt,opacity=0.25}",
      clearKeys: ["copy shadow", "circular drop shadow", "circular glow", "general shadow", "double copy shadow"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(
      "\\draw[drop shadow={shadow xshift=2pt,shadow yshift=-3pt,opacity=0.25}] (0,0) -- (1,0);"
    );
    expect(result.newSource).not.toContain("drop shadow=shadow xshift=2pt");
  });

  it("returns unsupported when the target id is missing", () => {
    const result = applyEditAction("\\draw (0,0);", [], {
      kind: "setProperty",
      elementId: "missing",
      level: "command",
      key: "color",
      value: "red"
    });
    expect(result.kind).toBe("unsupported");
  });
});

describe("applyEditAction – resizeElement", () => {
  it("returns specific unsupported reasons for invalid resize targets and roles", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;

    const missingId = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "   ",
      role: "right",
      newWorld: wp(10, 0)
    });
    expect(missingId.kind).toBe("unsupported");
    if (missingId.kind === "unsupported") {
      expect(missingId.reason).toContain("Missing element id");
    }

    const unknown = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "missing",
      role: "right",
      newWorld: wp(10, 0)
    });
    expect(unknown.kind).toBe("unsupported");

    const badRole = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "center" as never,
      newWorld: wp(10, 0)
    });
    expect(badRole.kind).toBe("unsupported");
    if (badRole.kind === "unsupported") {
      expect(badRole.reason).toContain("Unsupported resize role");
    }

    const rectangleBadRole = applyEditAction(String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
\end{tikzpicture}`, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "center" as never,
      newWorld: wp(10, 0)
    });
    expect(rectangleBadRole.kind).toBe("unsupported");
    if (rectangleBadRole.kind === "unsupported") {
      expect(rectangleBadRole.reason).toContain("Unsupported resize role");
    }

    const circleBadRole = applyEditAction(String.raw`\begin{tikzpicture}
  \draw (0,0) circle (1cm);
\end{tikzpicture}`, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "center" as never,
      newWorld: wp(cm(1), cm(1))
    });
    expect(circleBadRole.kind).toBe("unsupported");
    if (circleBadRole.kind === "unsupported") {
      expect(circleBadRole.reason).toContain("Unsupported resize role");
    }

    const scopeBadRole = applyEditAction(String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) rectangle (1,1);
  \end{scope}
\end{tikzpicture}`, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "center" as never,
      newWorld: wp(10, 0)
    });
    expect(scopeBadRole.kind).toBe("unsupported");
    if (scopeBadRole.kind === "unsupported") {
      expect(scopeBadRole.reason).toContain("Unsupported resize role");
    }
  });

  it("writes minimum width and minimum height when growing from a corner", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(100, 100)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=");
    expect(result.newSource).toContain("minimum height=");
  });

  it("rounds resize-authored minimum dimensions to integer points", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(45.4, 60.6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=91pt");
    expect(result.newSource).toContain("minimum height=121pt");

    const fine = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(45.4, 60.6),
      formatPrecision: "fine"
    });

    expect(fine.kind).toBe("success");
    if (fine.kind !== "success") return;
    expect(fine.newSource).toContain("minimum width=90.8pt");
    expect(fine.newSource).toContain("minimum height=121.2pt");
  });

  it("drops non-binding minimum dimensions when shrinking below intrinsic floor", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,minimum width=100pt,minimum height=80pt] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: wp(0, 0)
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("minimum width=");
    expect(result.newSource).not.toContain("minimum height=");
  });

  it("updates only the axis targeted by the resize role", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,minimum height=40pt] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(90, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=");
    expect(result.newSource).toContain("minimum height=40pt");
  });

  it("resizes non-rectangular shaped nodes by rewriting shape constraints", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,shape=diamond,minimum width=2.2cm,minimum height=1.4cm] at (0,0) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-right",
      newWorld: wp(100, 100)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("shape=diamond");
    expect(/minimum (width|height)=/.test(result.newSource)).toBe(true);
    expect(result.newSource).not.toContain("minimum width=2.2cm, minimum height=1.4cm");
  });

  it("resizes diamond nodes from side handles using companion dimensions", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,shape=diamond,aspect=2] at (0,0) {};
\end{tikzpicture}`;

    const horizontal = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(120, 0)
    });

    expect(horizontal.kind).toBe("success");
    if (horizontal.kind !== "success") return;
    expect(horizontal.newSource).toContain("minimum width=");
    expect(horizontal.newSource).not.toContain("minimum height=");

    const vertical = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top",
      newWorld: wp(0, 100)
    });

    expect(vertical.kind).toBe("success");
    if (vertical.kind !== "success") return;
    expect(vertical.newSource).toContain("minimum height=");
  });

  it("scales explicit diamond minimum dimensions during side resize", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,shape=diamond,minimum width=40pt,minimum height=20pt] at (0,0) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(120, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=");
    expect(result.newSource).toContain("minimum height=");
    expect(result.newSource).not.toContain("minimum width=40pt,minimum height=20pt");
  });

  it("can prefer a single constraint when resizing dependent shapes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,shape=isosceles triangle,minimum width=2.2cm,minimum height=1.4cm] at (0,0) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-right",
      newWorld: wp(120, 60)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("shape=isosceles triangle");
    expect(/minimum (width|height)=/.test(result.newSource)).toBe(true);
  });

  it("maps visual drag through inverse node transform when resizing transformed nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,xscale=0.1] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(30, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const match = /minimum width=([0-9.]+)pt/.exec(result.newSource);
    expect(match).not.toBeNull();
    const width = match ? Number(match[1]) : Number.NaN;
    expect(width).toBeGreaterThan(200);
  });

  it("drops non-binding minimum dimensions for unstyled nodes when shrinking", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[minimum width=100pt,minimum height=80pt] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(0, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("minimum width=");
    expect(result.newSource).not.toContain("minimum height=");
  });

  it("drops non-binding minimum width for positioned nodes when shrinking", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[minimum width=40pt] at (1,2) {node};
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const bounds = collectSourceWorldBounds(semantic.scene.elements).get("path:0");
    expect(bounds).toBeDefined();
    if (!bounds) return;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("minimum width=");
  });

  it("uses the provided text engine when computing intrinsic resize floors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,minimum width=120pt] at (0,0) {Long label text};
\end{tikzpicture}`;
    const fakeTextEngine: NodeTextEngine = {
      validate: () => null,
      measure: () => ({
        cacheKey: "fake-measure",
        width: 40,
        height: 10,
        baselineY: -2,
        midLineY: 0,
        paragraphId: "fake-paragraph",
        renderSourceText: "Long label text"
      }),
      renderFromCache: () => null
    };

    const result = applyEditAction(
      source,
      [],
      {
        kind: "resizeElement",
        elementId: "path:0",
        role: "right",
        newWorld: wp(45, 0)
      },
      { evaluateOptions: { textEngine: fakeTextEngine } }
    );

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=90pt");
  });

  it("rewrites text width instead of minimum width for horizontal resize when text width is set", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,text width=2cm] at (0,0) {This is wrapped text};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(120, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const textWidthMatch = /text width=([0-9.]+)pt/.exec(result.newSource);
    expect(textWidthMatch).not.toBeNull();
    expect(Number(textWidthMatch?.[1])).toBe(Math.round(Number(textWidthMatch?.[1])));
    expect(result.newSource).not.toContain("minimum width=");
  });

  it("preserves unknown node options while resizing text-width nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,{unparsed option},text width=2cm] at (0,0) {This is wrapped text};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(120, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("{unparsed option}");
    expect(result.newSource).toContain("text width=");
  });

  it("keeps existing minimum width unchanged when horizontal resize targets text width", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,text width=2cm,minimum width=100pt] at (0,0) {This is wrapped text};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(120, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=100pt");
    const textWidthMatch = /text width=([0-9.]+)pt/.exec(result.newSource);
    expect(textWidthMatch).not.toBeNull();
  });

  it("uses node inner sep overrides when resizing text-width nodes", () => {
    const innerSepSource = String.raw`\begin{tikzpicture}
  \node[draw,text width=2cm,inner sep=10pt] at (0,0) {This is wrapped text};
\end{tikzpicture}`;
    const innerSep = applyEditAction(innerSepSource, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(120, 0)
    });

    expect(innerSep.kind).toBe("success");
    if (innerSep.kind !== "success") return;
    const innerSepWidth = Number(/text width=([0-9.]+)pt/.exec(innerSep.newSource)?.[1]);
    expect(innerSepWidth).toBeLessThan(240);

    const innerXSepSource = String.raw`\begin{tikzpicture}
  \node[draw,text width=2cm,inner xsep=8pt] at (0,0) {This is wrapped text};
\end{tikzpicture}`;
    const innerXSep = applyEditAction(innerXSepSource, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(120, 0)
    });

    expect(innerXSep.kind).toBe("success");
    if (innerXSep.kind !== "success") return;
    const innerXSepWidth = Number(/text width=([0-9.]+)pt/.exec(innerXSep.newSource)?.[1]);
    expect(innerXSepWidth).toBeLessThan(240);
    expect(innerXSepWidth).toBeGreaterThan(innerSepWidth);
  });

  it("updates text width horizontally and minimum height vertically for corner resize", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,text width=2cm] at (0,0) {This is wrapped text};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(120, 120)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("text width=");
    expect(result.newSource).toContain("minimum height=");
    expect(result.newSource).not.toContain("minimum width=");
  });

  it("does not change text width for vertical-only resize", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,text width=2cm] at (0,0) {This is wrapped text};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top",
      newWorld: wp(0, 120)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("text width=2cm");
  });

  it("removes minimum height when vertical resize makes it non-binding", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,minimum height=50pt] at (0,0) {A};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const bounds = collectSourceWorldBounds(semantic.scene.elements).get("path:0");
    expect(bounds).toBeDefined();
    if (!bounds) {
      return;
    }

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom",
      newWorld: wp((bounds.minX + bounds.maxX) / 2, bounds.maxY - 20)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("minimum height=");
  });

  it("removes non-binding minimum height for multiline text-width corner resize", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw, text width=105.09pt, align=left, minimum height=50pt] at (0,0) {This is the first line which can read quite internationally and this is the second line which is more pedestrian};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const bounds = collectSourceWorldBounds(semantic.scene.elements).get("path:0");
    expect(bounds).toBeDefined();
    if (!bounds) {
      return;
    }

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(bounds.maxX - 20, bounds.maxY)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("text width=");
    expect(result.newSource).not.toContain("minimum height=");
  });

  it("resizes circle statements that use coordinate radius payloads", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) circle (1cm);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1.2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle (2cm)");
  });

  it("resizes filled circle statements that are emitted as path geometry", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (0,0) circle (1cm);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1.2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle (2cm)");
  });

  it("resizes ellipse statements that use explicit x/y radius options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2cm");
    expect(result.newSource).toContain("y radius=1cm");
  });

  it("resizes filled ellipse statements that are emitted as path geometry", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2cm");
    expect(result.newSource).toContain("y radius=1cm");
  });

  it("rewrites the last circle option list that owns a radius", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) circle [draw=blue] [radius=1cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(1.5), cm(1.2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle [draw=blue] [radius=1.5cm]");
  });

  it("preserves formatted ellipse payload coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse ( 1cm and 0.5cm );
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("ellipse ( 2cm and 1cm )");
  });

  it("preserves formatted circle payload coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) circle ( 1cm );
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1.2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle ( 2cm)");
  });

  it("resizes circle syntax with comments between the keyword and payload", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) circle % radius payload stays attached to circle
    (1cm);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(1.5), cm(1.2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("% radius payload stays attached to circle");
    expect(result.newSource).toContain("(1.5cm)");
  });

  it("preserves ellipse aspect ratio when preserveAspect is enabled", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(1.2), cm(0.4)),
      preserveAspect: true
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=1.2cm");
    expect(result.newSource).toContain("y radius=0.6cm");
  });

  it("uses the provided preserveAspectRatio instead of the current ratio", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1.2cm, y radius=0.4cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(0.5)),
      preserveAspect: true,
      preserveAspectRatio: 0.5
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2cm");
    expect(result.newSource).toContain("y radius=1cm");
  });

  it("rejects preserving ellipse aspect ratio without explicit radii", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse;
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1)),
      preserveAspect: true
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("explicit ellipse radii");
  });

  it("inserts ellipse radii when corner resizing an ellipse without explicit radii", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse;
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("ellipse[x radius=2cm, y radius=1cm]");
  });

  it("resizes ellipse statements where y radius is larger than x radius", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (-1.88,1.26) ellipse [x radius=0.38cm, y radius=0.88cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(-0.68), cm(2.76))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=1.2cm");
    expect(result.newSource).toContain("y radius=1.5cm");
  });

  it("resizes circle and ellipse options while preserving comments and flags", () => {
    const circleSource = String.raw`\begin{tikzpicture}
  \draw (0,0) circle % keep radius options close to the keyword
    [draw, radius=1cm];
\end{tikzpicture}`;
    const circle = applyEditAction(circleSource, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(1.5), cm(1.5))
    });

    expect(circle.kind).toBe("success");
    if (circle.kind !== "success") return;
    expect(circle.newSource).toContain("% keep radius options close to the keyword");
    expect(circle.newSource).toContain("[draw, radius=1.5cm]");

    const ellipseSource = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [draw, x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;
    const ellipse = applyEditAction(ellipseSource, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(1.5), cm(0.75))
    });

    expect(ellipse.kind).toBe("success");
    if (ellipse.kind !== "success") return;
    expect(ellipse.newSource).toContain("[draw, x radius=1.5cm, y radius=0.75cm]");
  });

  it("falls back to current ellipse ratio when preserveAspectRatio is invalid", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(0.5)),
      preserveAspect: true,
      preserveAspectRatio: Number.NaN
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2cm");
    expect(result.newSource).toContain("y radius=1cm");
  });

  it("resizes transform-rotated ellipse statements emitted as ellipse primitives", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45] (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1.2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2.26cm");
    expect(result.newSource).toContain("y radius=0.57cm");
  });

  it("resizes transform-rotated filled ellipse path statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45,fill=yellow] (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1.2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2.26cm");
    expect(result.newSource).toContain("y radius=0.57cm");
  });

  it("resizes transform-rotated rectangle statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45] (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: wp(cm(-1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw[rotate=45] (0.71,0) rectangle (2,2.12);");
  });

  it("keeps rotated rectangle corner drags continuous across world-topness changes", () => {
    let currentSource = String.raw`\begin{tikzpicture}[rotate=40]
  \draw (-3.73,-1.69) rectangle (2.91,2.78);
\end{tikzpicture}`;

    const dragX = 3.316;
    const dragYValues = [0.58, 0.2, -0.1, -0.3, -0.5, -0.7];
    const rewrittenTargetYValues: number[] = [];

    for (const dragY of dragYValues) {
      const result = applyEditAction(currentSource, [], {
        kind: "resizeElement",
        elementId: "path:0",
        role: "top-right",
        newWorld: wp(cm(dragX), cm(dragY))
      });

      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        return;
      }
      currentSource = result.newSource;

      const targetMatch = currentSource.match(/rectangle\s*\(\s*[-+0-9.]+\s*,\s*([-+0-9.]+)\s*\)/);
      expect(targetMatch).not.toBeNull();
      if (!targetMatch) {
        return;
      }
      rewrittenTargetYValues.push(Number(targetMatch[1]));
    }

    for (let index = 1; index < rewrittenTargetYValues.length; index += 1) {
      const prev = rewrittenTargetYValues[index - 1];
      const next = rewrittenTargetYValues[index];
      expect(Math.abs(next - prev)).toBeLessThan(2);
    }
  });

  it("keeps rotated node corner drags stable at existing corners", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,rotate=30] at (0,0) {A};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const nodeBoxPath = semantic.scene.elements.find(
      (element): element is Extract<typeof semantic.scene.elements[number], { kind: "Path" }> =>
        element.sourceRef.sourceId === "path:0" && element.kind === "Path"
    );
    expect(nodeBoxPath).toBeDefined();
    if (!nodeBoxPath) {
      return;
    }

    const corner = nodeBoxPath.commands.find(
      (command): command is Extract<typeof nodeBoxPath.commands[number], { kind: "M" | "L" }> =>
        command.kind === "M" || command.kind === "L"
    )?.to;
    expect(corner).toBeDefined();
    if (!corner) {
      return;
    }

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-right",
      newWorld: corner
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }
    expect(result.newSource).not.toContain("minimum width");
    expect(result.newSource).not.toContain("minimum height");
  });

  it("rejects no-op node resizes at the existing unrotated corner", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const bounds = collectSourceWorldBounds(semantic.scene.elements).get("path:0");
    expect(bounds).toBeDefined();
    if (!bounds) return;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(bounds.maxX, bounds.minY)
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("would not change");
  });

  it("resizes nodes with label/pin adornments using only the node geometry", () => {
    const plainSource = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;
    const adornedSource = String.raw`\begin{tikzpicture}
  \node[draw,label=right:L,pin=above:P] at (0,0) {A};
\end{tikzpicture}`;

    const plainResult = applyEditAction(plainSource, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(120, 120)
    });
    const adornedResult = applyEditAction(adornedSource, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(120, 120)
    });

    expect(plainResult.kind).toBe("success");
    expect(adornedResult.kind).toBe("success");
    if (plainResult.kind !== "success" || adornedResult.kind !== "success") {
      return;
    }

    const extractMinimum = (updatedSource: string, key: "minimum width" | "minimum height") =>
      updatedSource.match(new RegExp(`${key}=([0-9.]+)pt`))?.[1] ?? null;

    expect(extractMinimum(adornedResult.newSource, "minimum width")).toBe(
      extractMinimum(plainResult.newSource, "minimum width")
    );
    expect(extractMinimum(adornedResult.newSource, "minimum height")).toBe(
      extractMinimum(plainResult.newSource, "minimum height")
    );
    expect(adornedResult.newSource).toContain("label=right:L");
    expect(adornedResult.newSource).toContain("pin=above:P");
  });

  it("moves adorned nodes without rewriting label/pin option payloads", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label=right:L,pin=above:P] at (0,0) {A};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const result = applyEditAction(source, semantic.editHandles, {
      kind: "moveElements",
      elementIds: ["path:0"],
      delta: wp(1, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }

    expect(result.newSource).toContain("label=right:L");
    expect(result.newSource).toContain("pin=above:P");
    expect(result.newSource).toContain(" at (0.04,0) ");
    expect(result.newSource).not.toContain("\\node[draw,(");
  });

  it("blocks moveElements direct manipulation for fit nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (a) at (0,0) {};
  \node (b) at (1,0) {};
  \node[draw,fit=(a) (b)] (f) {};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const fitPathId =
      parsed.figure.body
        .find(
          (statement) =>
            statement.kind === "Path"
            && statement.items.some(
              (item) =>
                item.kind === "Node"
                && item.options?.entries.some(
                  (entry) => (entry.kind === "flag" || entry.kind === "kv") && entry.key === "fit"
                )
            )
        )?.id ?? null;
    expect(fitPathId).not.toBeNull();
    if (!fitPathId) {
      return;
    }

    const semantic = evaluateTikzFigure(parsed.figure, source);
    const result = applyEditAction(source, semantic.editHandles, {
      kind: "moveElements",
      elementIds: [fitPathId],
      delta: wp(1, 0)
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") {
      return;
    }
    expect(result.reason).toContain("fit");
    expect(result.reason).toContain("disabled");
  });

  it("resizes transform-rotated circle statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45] (0,0) circle (1cm);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1.2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw[rotate=45] (0,0) circle (2.26cm);");
  });

  it("rejects circle and rectangle resizes through non-invertible transforms", () => {
    const circle = applyEditAction(String.raw`\begin{tikzpicture}
  \draw[xscale=0] (0,0) circle (1cm);
\end{tikzpicture}`, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1))
    });
    expect(circle.kind).toBe("unsupported");
    if (circle.kind === "unsupported") {
      expect(circle.reason).toContain("local geometry");
    }

    const rectangle = applyEditAction(String.raw`\begin{tikzpicture}
  \draw[xscale=0] (0,0) rectangle (2,1);
\end{tikzpicture}`, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(3), cm(2))
    });
    expect(rectangle.kind).toBe("unsupported");
    if (rectangle.kind === "unsupported") {
      expect(rectangle.reason).toContain("local geometry");
    }
  });

  it("keeps side-only circle resizes circular using explicit radius options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) circle [radius=1cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top",
      newWorld: wp(0, cm(1.5))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle [radius=1.5cm]");
  });

  it("rejects invalid and no-op circle resizes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) circle (1cm);
\end{tikzpicture}`;

    const badRole = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "center" as never,
      newWorld: wp(cm(1), 0)
    });
    expect(badRole.kind).toBe("unsupported");
    if (badRole.kind === "unsupported") {
      expect(badRole.reason).toContain("Unsupported resize role");
    }

    const noOp = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(cm(1), 0)
    });
    expect(noOp.kind).toBe("unsupported");
    if (noOp.kind === "unsupported") {
      expect(noOp.reason).toContain("would not change");
    }
  });

  it("inserts per-shape radius options when circle radius is inherited from statement options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[radius=1cm] (0,0) circle;
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(1.5), cm(1.5))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle[radius=1.5cm]");
  });

  it("adds radius entries to an existing circle option list without radius keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) circle [draw=blue];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(1.25), cm(1.25))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle [draw=blue, x radius=1.25cm, y radius=1.25cm]");
  });

  it("normalizes circle x/y radius options back to a single radius", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) circle [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(cm(2), 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2cm");
    expect(result.newSource).toContain("y radius=0.5cm");
  });

  it("expands ellipse radius shorthand into x and y radius options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [radius=1cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(cm(2), 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2cm");
    expect(result.newSource).toContain("y radius=1cm");
    expect(result.newSource).not.toContain("[radius=1cm]");
  });

  it("rejects single-axis ellipse resize when no explicit radius can be inferred", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse;
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(cm(2), 0)
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("explicit circle/ellipse radii");
  });

  it("preserves ellipse aspect ratio for side-only drags", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const horizontal = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(cm(2), 0),
      preserveAspect: true
    });
    expect(horizontal.kind).toBe("success");
    if (horizontal.kind !== "success") return;
    expect(horizontal.newSource).toContain("x radius=2cm");
    expect(horizontal.newSource).toContain("y radius=1cm");

    const vertical = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top",
      newWorld: wp(0, cm(1.5)),
      preserveAspect: true
    });
    expect(vertical.kind).toBe("success");
    if (vertical.kind !== "success") return;
    expect(vertical.newSource).toContain("x radius=3cm");
    expect(vertical.newSource).toContain("y radius=1.5cm");
  });

  it("resizes rectangle statements using opposite-corner anchoring", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: wp(cm(-1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (-1,0) rectangle (2,2);");
  });

  it("resizes filled rectangle statements using opposite-corner anchoring", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: wp(cm(-1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw[fill=yellow] (-1,0) rectangle (2,2);");
  });

  it("updates rectangle relative target coordinates against the moved start corner", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle +(2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: wp(cm(-1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (-1,0) rectangle +(3,2);");
  });

  it("resizes rectangle statements from side handles without moving the opposite side", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const right = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(cm(3), cm(0.5))
    });
    expect(right.kind).toBe("success");
    if (right.kind !== "success") return;
    expect(right.newSource).toContain("\\draw (0,0) rectangle (3,1);");

    const top = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top",
      newWorld: wp(cm(1), cm(2))
    });
    expect(top.kind).toBe("success");
    if (top.kind !== "success") return;
    expect(top.newSource).toContain("\\draw (0,0) rectangle (2,2);");

    const left = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "left",
      newWorld: wp(cm(-1), cm(0.5))
    });
    expect(left.kind).toBe("success");
    if (left.kind !== "success") return;
    expect(left.newSource).toContain("\\draw (-1,0) rectangle (2,1);");

    const bottom = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom",
      newWorld: wp(cm(1), cm(-1))
    });
    expect(bottom.kind).toBe("success");
    if (bottom.kind !== "success") return;
    expect(bottom.newSource).toContain("\\draw (0,-1) rectangle (2,1);");
  });

  it("resizes rectangles whose authored start coordinate is the visual maximum corner", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (2,1) rectangle (0,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-left",
      newWorld: wp(cm(-1), cm(-1))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (2,1) rectangle (-1,-1);");
  });

  it("resizes rectangle statements from the bottom-right corner", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(3), cm(-1))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,-1) rectangle (3,1);");
  });

  it("rejects invalid and no-op rectangle resizes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const badRole = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "center" as never,
      newWorld: wp(cm(1), cm(0.5))
    });
    expect(badRole.kind).toBe("unsupported");
    if (badRole.kind === "unsupported") {
      expect(badRole.reason).toContain("Unsupported resize role");
    }

    const noOp = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(cm(2), cm(0.5))
    });
    expect(noOp.kind).toBe("unsupported");
    if (noOp.kind === "unsupported") {
      expect(noOp.reason).toContain("would not change");
    }
  });

  it("rejects rectangles without explicit editable start and target coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw rectangle (2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(cm(3), cm(0.5))
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("explicit start and target coordinates");
  });

  it("rejects rectangle resize when rectangle coordinates are not rewritable", () => {
    const source = String.raw`\begin{tikzpicture}
  \coordinate (A) at (0,0);
  \coordinate (B) at (2,1);
  \draw (A) rectangle (B);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:2",
      role: "right",
      newWorld: wp(cm(3), cm(0.5))
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("rewritable rectangle coordinates");
  });

  it("resizes rectangles inside nested scopes", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \begin{scope}
      \draw (0,0) rectangle (2,1);
    \end{scope}
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:2",
      role: "top-right",
      newWorld: wp(cm(3), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) rectangle (3,2);");
  });

  it("resizes scopes by rewriting scale and compensating shift", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "top-left",
      newWorld: wp(cm(-1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xscale=1.5");
    expect(result.newSource).toContain("yscale=2");
    const xshiftMatch = result.newSource.match(/xshift=([-0-9.]+)pt/);
    expect(xshiftMatch).not.toBeNull();
    expect(xshiftMatch ? Number(xshiftMatch[1]) : Number.NaN).toBeLessThan(-20);
    expect(result.newSource).not.toContain("yshift=");
    expect(result.changedSourceIds).toEqual(["scope:0", "path:1"]);
  });

  it("resizes scopes by replacing existing transform options while preserving other options", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[draw=blue,xscale=2,yshift=5pt]
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "bottom-right",
      newWorld: wp(cm(3), cm(-2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("[draw=blue");
    expect(result.newSource).not.toContain("yshift=5pt");
    expect(result.newSource).toContain("xscale=");
    expect(result.newSource).toContain("yscale=");
  });

  it("resizes scopes while preserving unknown entries in existing option lists", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[draw=blue,{unparsed option},xscale=2,yshift=5pt]
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "bottom-right",
      newWorld: wp(cm(3), cm(-2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("draw=blue");
    expect(result.newSource).toContain("{unparsed option}");
    expect(result.newSource).toContain("xscale=");
    expect(result.newSource).toContain("yscale=");
    expect(result.newSource).not.toContain("yshift=5pt");
  });

  it("expands changed ids for nested scope resizes", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) rectangle (2,1);
    \begin{scope}
      \draw (3,0) rectangle (4,1);
    \end{scope}
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "right",
      newWorld: wp(cm(5), cm(0.5))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.changedSourceIds).toEqual(["scope:0", "path:1", "scope:2", "path:3"]);
  });

  it("resizes nested scopes directly and expands only their nested contents", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \begin{scope}
      \draw (0,0) rectangle (2,1);
    \end{scope}
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:1",
      role: "right",
      newWorld: wp(cm(3), cm(0.5))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xscale=1.5");
    expect(result.changedSourceIds).toEqual(["scope:1", "path:2"]);
  });

  it("resizes scopes from left and bottom side handles", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const left = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "left",
      newWorld: wp(cm(-1), cm(0.5))
    });
    expect(left.kind).toBe("success");
    if (left.kind !== "success") return;
    expect(left.newSource).toContain("xscale=1.5");

    const bottom = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "bottom",
      newWorld: wp(cm(1), cm(-1))
    });
    expect(bottom.kind).toBe("success");
    if (bottom.kind !== "success") return;
    expect(bottom.newSource).toContain("yscale=2");

    const top = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "top",
      newWorld: wp(cm(1), cm(2))
    });
    expect(top.kind).toBe("success");
    if (top.kind !== "success") return;
    expect(top.newSource).toContain("yscale=2");
  });

  it("resizes scopes from the bottom-left corner and preserves non-transform option entries", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[draw=blue,rounded corners,xscale=2,yshift=5pt]
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "bottom-left",
      newWorld: wp(cm(-1), cm(-1))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("draw=blue");
    expect(result.newSource).toContain("rounded corners");
    expect(result.newSource).toContain("xscale=");
    expect(result.newSource).toContain("yscale=");
  });

  it("rejects no-op scope resizes", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "right",
      newWorld: wp(cm(2), cm(0.5))
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("would not change");
  });

  it("rejects non-finite scope resize transforms", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "right",
      newWorld: wp(cm(3), cm(0.5)),
      referenceScopeTransform: {
        xscale: Number.POSITIVE_INFINITY,
        yscale: 1,
        xshift: 0,
        yshift: 0
      }
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("non-finite transform");
  });

  it("rejects degenerate, rotated, and invalid-role scope resizes", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[rotate=30]
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const rotated = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "right",
      newWorld: wp(cm(3), 0)
    });
    expect(rotated.kind).toBe("unsupported");
    if (rotated.kind === "unsupported") {
      expect(rotated.reason).toContain("non-rotated scopes");
    }

    const degenerate = applyEditAction(source.replace("[rotate=30]", ""), [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "right",
      newWorld: wp(cm(3), 0),
      referenceBounds: wb(0, 0, 0, 10)
    });
    expect(degenerate.kind).toBe("unsupported");
    if (degenerate.kind === "unsupported") {
      expect(degenerate.reason).toContain("non-zero bounds");
    }

    const badRole = applyEditAction(source.replace("[rotate=30]", ""), [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "center" as never,
      newWorld: wp(cm(3), 0)
    });
    expect(badRole.kind).toBe("unsupported");
    if (badRole.kind === "unsupported") {
      expect(badRole.reason).toContain("Unsupported resize role");
    }

    const emptyScope = applyEditAction(String.raw`\begin{tikzpicture}
  \begin{scope}
  \end{scope}
\end{tikzpicture}`, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "right",
      newWorld: wp(cm(1), 0)
    });
    expect(emptyScope.kind).toBe("unsupported");
    if (emptyScope.kind === "unsupported") {
      expect(emptyScope.reason).toContain("No geometry bounds");
    }
  });

  it("preserves aspect ratio when resizing scopes from a corner", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "bottom-right",
      newWorld: wp(cm(4), cm(-1.2)),
      preserveAspect: true
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xscale=2");
    expect(result.newSource).toContain("yscale=2");
  });

  it("falls back from diamond side-specific resize when minimum size is set", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,shape=diamond,minimum size=40pt] at (0,0) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(120, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum size=40pt");
    expect(result.newSource).toContain("minimum width=");
  });

  it("infers diamond companion dimensions from one explicit minimum dimension", () => {
    const widthOnlySource = String.raw`\begin{tikzpicture}
  \node[draw,shape=diamond,aspect=2,minimum width=40pt] at (0,0) {};
\end{tikzpicture}`;
    const vertical = applyEditAction(widthOnlySource, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top",
      newWorld: wp(0, 120)
    });

    expect(vertical.kind).toBe("success");
    if (vertical.kind !== "success") return;
    expect(vertical.newSource).toContain("minimum width=40pt");
    expect(vertical.newSource).toContain("minimum height=");

    const heightOnlySource = String.raw`\begin{tikzpicture}
  \node[draw,shape=diamond,aspect=2,minimum height=20pt] at (0,0) {};
\end{tikzpicture}`;
    const horizontal = applyEditAction(heightOnlySource, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(120, 0)
    });

    expect(horizontal.kind).toBe("success");
    if (horizontal.kind !== "success") return;
    expect(horizontal.newSource).toContain("minimum width=");
    expect(horizontal.newSource).toContain("minimum height=20pt");
  });

  it("keeps the opposite scope edges fixed in semantic bounds during referenced top-right resize", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw[fill=red] (-2.5,1.5) rectangle (-0.8,-0.3);
    \draw[fill=blue] (-2.4,0) rectangle (-0.9,-2);
  \end{scope}
\end{tikzpicture}`;

    const before = scopeBodyBounds(source);
    expect(before).toBeDefined();
    if (!before) {
      return;
    }

    const parsed = parseTikz(source, { recover: true });
    const evaluated = evaluateTikzFigure(parsed.figure, source);
    const result = applyEditAction(source, evaluated.editHandles, {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "top-right",
      newWorld: wp(before.maxX + cm(2), before.maxY),
      referenceBounds: before,
      referenceScopeTransform: { xscale: 1, yscale: 1, xshift: 0, yshift: 0 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }

    const after = scopeBodyBounds(result.newSource);
    expect(after).toBeDefined();
    if (!after) {
      return;
    }

    expect(Math.abs(after.minX - before.minX)).toBeLessThan(0.5);
    expect(Math.abs(after.minY - before.minY)).toBeLessThan(0.5);
    expect(after.maxX).toBeGreaterThan(before.maxX);
  });

  it("returns unsupported for non-node elements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(10, 0)
    });

    expect(result.kind).toBe("unsupported");
  });

  it("reports changedSourceIds for successful resize edits", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(120, 120)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.changedSourceIds).toEqual(["path:0"]);
  });

  it("blocks resizeElement direct manipulation for fit nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (a) at (0,0) {};
  \node (b) at (1,0) {};
  \node[draw,fit=(a) (b)] (f) {};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const fitPathId =
      parsed.figure.body
        .find(
          (statement) =>
            statement.kind === "Path"
            && statement.items.some(
              (item) =>
                item.kind === "Node"
                && item.options?.entries.some(
                  (entry) => (entry.kind === "flag" || entry.kind === "kv") && entry.key === "fit"
                )
            )
        )?.id ?? null;
    expect(fitPathId).not.toBeNull();
    if (!fitPathId) {
      return;
    }

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: fitPathId,
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1))
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") {
      return;
    }
    expect(result.reason).toContain("fit");
    expect(result.reason).toContain("disabled");

    const fitPath = parsed.figure.body.find((statement) => statement.id === fitPathId);
    const fitNode = fitPath?.kind === "Path" ? fitPath.items.find((item) => item.kind === "Node") : null;
    expect(fitNode?.kind).toBe("Node");
    if (!fitNode || fitNode.kind !== "Node") {
      return;
    }

    const nodeResult = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: fitNode.id,
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1))
    });

    expect(nodeResult.kind).toBe("unsupported");
    if (nodeResult.kind !== "unsupported") {
      return;
    }
    expect(nodeResult.reason).toContain("fit");
    expect(nodeResult.reason).toContain("disabled");
  });
});

// ── addElement / unimplemented actions ─────────────────────────────────────────

describe("applyEditAction – addElement", () => {
  it("inserts a node snippet before \\end{tikzpicture}", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addElement",
      template: { kind: "node", text: "A" },
      at: wp(cm(2), cm(3))
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("  \\node at (2,3) {A};");
      expect(result.newSource).toContain("\\end{tikzpicture}");
      expect(result.patches).toHaveLength(1);
    }
  });

  it("inserts a bezier snippet with explicit controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addElement",
      template: {
        kind: "bezier",
        to: wp(cm(3), cm(1)),
        control1: wp(cm(1), cm(2)),
        control2: wp(cm(2), cm(2))
      },
      at: wp(cm(0), cm(0))
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("  \\draw (0,0) .. controls (1,2) and (2,2) .. (3,1);");
      expect(result.newSource).toContain("\\end{tikzpicture}");
      expect(result.patches).toHaveLength(1);
    }
  });

  it("inserts a line snippet with named anchor endpoints", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (A) at (0,0) {};
  \node (B) at (1,0) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addElement",
      template: {
        kind: "line",
        hasArrow: true,
        fromAnchor: { nodeName: "A", anchor: "center" },
        toAnchor: { nodeName: "B", anchor: "east" },
        to: wp(cm(2), cm(0))
      },
      at: wp(cm(0), cm(0))
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("  \\draw[->] (A) -- (B.east);");
      expect(result.newSource).toContain("\\end{tikzpicture}");
      expect(result.patches).toHaveLength(1);
    }
  });

  it("inserts a matrix snippet without delimiter options by default", () => {
    const source = String.raw`\begin{tikzpicture}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addElement",
      template: {
        kind: "matrix",
        rows: 2,
        columns: 3,
        matrixKind: "nodes"
      },
      at: wp(cm(1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\matrix [matrix of nodes] at (1,2) {");
      expect(result.newSource).toContain("A & B & C \\\\");
      expect(result.newSource).toContain("D & E & F \\\\");
      expect(result.newSource).not.toContain("left delimiter");
      expect(result.newSource).not.toContain("right delimiter");
      expect(result.patches).toHaveLength(1);
    }
  });
});

describe("applyEditAction – deleteElement", () => {
  it("rejects empty and unresolved delete selections", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "deleteElements",
      elementIds: [" ", " "]
    })).toEqual({
      kind: "unsupported",
      reason: "No element ids were provided for deleteElements"
    });

    expect(applyEditAction(source, [], {
      kind: "deleteElements",
      elementIds: ["missing", "missing"]
    })).toEqual({
      kind: "unsupported",
      reason: "No deletable source span was found for the selected element(s)"
    });
  });

  it("deletes a whole path statement", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).not.toContain("\\draw (0,0) -- (1,0);");
      expect(result.newSource).toContain("\\draw (0,1) -- (1,1);");
      expect(result.patches).toHaveLength(1);
    }
  });

  it("deletes nested scope statements and CRLF trailing statements cleanly", () => {
    const nestedSource = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) -- (1,0);
  \end{scope}
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;

    const nested = applyEditAction(nestedSource, [], {
      kind: "deleteElement",
      elementId: "path:1"
    });
    expect(nested.kind).toBe("success");
    if (nested.kind !== "success") {
      throw new Error("Expected nested statement deletion to succeed");
    }
    expect(nested.newSource).not.toContain("(0,0) -- (1,0)");
    expect(nested.newSource).toContain("\\begin{scope}");

    const crlfSource = "\\begin{tikzpicture}\r\n  \\draw (0,0) -- (1,0);\r\n  \\draw (0,1) -- (1,1);\r\n\\end{tikzpicture}";
    const crlf = applyEditAction(crlfSource, [], {
      kind: "deleteElement",
      elementId: "path:1"
    });
    expect(crlf.kind).toBe("success");
    if (crlf.kind !== "success") {
      throw new Error("Expected CRLF trailing statement deletion to succeed");
    }
    expect(crlf.newSource).toBe("\\begin{tikzpicture}\r\n  \\draw (0,0) -- (1,0);\r\n\\end{tikzpicture}");
  });

  it("deletes a single node path as a whole statement", () => {
    const source = String.raw`\begin{tikzpicture}
  \node {Only};
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "node:0:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected single-node path deletion to succeed");
    }
    expect(result.newSource).not.toContain("Only");
    expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
  });

  it("deletes multiple elements in one action", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElements",
      elementIds: ["path:0", "path:2"]
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).not.toContain("\\draw (0,0) -- (1,0);");
      expect(result.newSource).toContain("\\draw (0,1) -- (1,1);");
      expect(result.newSource).not.toContain("\\draw (0,2) -- (1,2);");
    }
  });

  it("deletes a same-line statement without swallowing the next statement", () => {
    const source = "\\begin{tikzpicture}\\draw (0,0) -- (1,0);   \\draw (0,1) -- (1,1);\\end{tikzpicture}";

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected same-line statement deletion to succeed");
    }
    expect(result.newSource).toBe("\\begin{tikzpicture}\\draw (0,1) -- (1,1);\\end{tikzpicture}");
  });

  it("prunes deleted node references from fit options", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (a) at (0,0) {};
  \node (b) at (1,0) {};
  \node[draw,fit=(a) (b)] (f) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }
    expect(result.newSource).not.toContain("(a)");
    expect(result.newSource).toContain("fit=(b)");
  });

  it("deletes a node item from a compound path without removing the path", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) node[above] {A} -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "node:0:1"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }
    expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
    expect(result.newSource).not.toContain("node[above]");
  });

  it("deletes a path-attached node inside an edge operation", () => {
    const source = String.raw`\begin{tikzpicture}
  \path (0,0) edge node[midway] {label} (1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const edge = statement.items.find((item) => item.kind === "EdgeOperation");
    if (!edge || edge.kind !== "EdgeOperation" || !edge.nodes?.[0]) throw new Error("Expected edge node");

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: edge.nodes[0].id
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected edge-node deletion to succeed");
    }
    expect(result.newSource).toContain("\\path (0,0) edge (1,0);");
    expect(result.newSource).not.toContain("label");
  });

  it("deletes path items with leading whitespace when there is no trailing gap", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0)--node[midway]{A}(1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "node:0:2"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected compact node deletion to succeed");
    }
    expect(result.newSource).toContain("\\draw (0,0)--(1,0);");
  });

  it("deletes a path-attached node inside a to operation", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) to node[midway] {label} (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "to-node:0:1:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }
    expect(result.newSource).toContain("\\draw (0,0) to (1,0);");
    expect(result.newSource).not.toContain("label");
  });

  it("collapses overlapping statement and child selections before deletion", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) node {A};
  \draw (1,0) -- (2,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElements",
      elementIds: ["path:0", "node:0:1", "path:0"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }
    expect(result.patches).toHaveLength(1);
    expect(result.newSource).not.toContain("node {A}");
    expect(result.newSource).toContain("\\draw (1,0) -- (2,0);");
  });

  it("removes fit and rotate fit when deleted names exhaust the fit list", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[alias=oldA] (a) at (0,0) {};
  \node[draw,fit={(oldA.south) (a)},rotate fit=30] (f) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }
    expect(result.newSource).not.toContain("fit=");
    expect(result.newSource).not.toContain("rotate fit");
    expect(result.changedSourceIds).toEqual(["node:0:1"]);
  });

  it("prunes deleted tree node names from mixed fit lists without touching malformed fits", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node (leaf) {leaf} };
  \node[draw,fit={(leaf) (0,0) (\ignored)}] (mixed) {};
  \node[draw,fit={not-a-coordinate}] (textfit) {};
  \node[draw,fit={}] (emptyfit) {};
  \node[draw,fit=] (emptyValueFit) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected tree delete with fit pruning to succeed");
    }
    expect(result.newSource).not.toContain("node (leaf)");
    expect(result.newSource).toContain("fit={(0,0) (\\ignored)}");
    expect(result.newSource).toContain("fit={not-a-coordinate}");
    expect(result.newSource).toContain("fit={}");
    expect(result.newSource).toContain("fit=] (emptyValueFit)");
    expect(result.changedSourceIds).toEqual(["node:0:1"]);
  });

  it("does not crash when a remaining node has a bare fit flag", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (gone) at (0,0) {};
  \node[draw,fit] (bareFit) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected bare-fit deletion to succeed");
    }
    expect(result.newSource).toContain("\\node[draw,fit] (bareFit) {};");
    expect(result.changedSourceIds).toEqual([]);
  });

  it("prunes valid deleted fit references while preserving malformed surrounding tokens", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (gone) at (0,0) {};
  \node[draw,fit={) (gone) (0,0)}] (malformedClose) {};
  \node[draw,fit=(kept)] (keptFit) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected malformed fit pruning to succeed");
    }
    expect(result.newSource).toContain("fit={(0,0)}");
    expect(result.newSource).toContain("fit=(kept)");
    expect(result.changedSourceIds).toEqual(["node:0:1"]);
  });
});

describe("applyEditAction – reorderElements", () => {
  it("rejects empty or unresolved reorder selections after id normalization", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: [" ", "", "path:0", "path:0", 42 as never],
      direction: "sendBackward"
    }).kind).toBe("success");
    expect(applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: [" ", 42 as never],
      direction: "sendBackward"
    }).kind).toBe("unsupported");
    expect(applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["missing"],
      direction: "bringForward"
    }).kind).toBe("unsupported");
  });

  it("brings a single statement forward by one slot", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:0"],
      direction: "bringForward"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource.indexOf("\\draw (0,1) -- (1,1);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,0) -- (1,0);")
    );
  });

  it("leaves boundary reorder requests unchanged while preserving selection ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;

    const alreadyBack = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:0"],
      direction: "sendBackward"
    });
    expect(alreadyBack.kind).toBe("success");
    if (alreadyBack.kind !== "success") return;
    expect(alreadyBack.newSource).toBe(source);
    expect(alreadyBack.patches).toEqual([]);
    expect(alreadyBack.selectedSourceIds).toEqual(["path:0"]);

    const alreadyFront = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:1"],
      direction: "bringForward"
    });
    expect(alreadyFront.kind).toBe("success");
    if (alreadyFront.kind !== "success") return;
    expect(alreadyFront.newSource).toBe(source);
    expect(alreadyFront.patches).toEqual([]);
    expect(alreadyFront.selectedSourceIds).toEqual(["path:1"]);
  });

  it("sends a single statement backward by one slot", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:1"],
      direction: "sendBackward"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource.indexOf("\\draw (0,1) -- (1,1);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,0) -- (1,0);")
    );
  });

  it("supports sendToBack and bringToFront", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;

    const toBack = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:2"],
      direction: "sendToBack"
    });
    expect(toBack.kind).toBe("success");
    if (toBack.kind === "success") {
      expect(toBack.newSource.indexOf("\\draw (0,2) -- (1,2);")).toBeLessThan(
        toBack.newSource.indexOf("\\draw (0,0) -- (1,0);")
      );
    }

    const toFront = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:0"],
      direction: "bringToFront"
    });
    expect(toFront.kind).toBe("success");
    if (toFront.kind === "success") {
      expect(toFront.newSource.indexOf("\\draw (0,2) -- (1,2);")).toBeLessThan(
        toFront.newSource.indexOf("\\draw (0,0) -- (1,0);")
      );
    }
  });

  it("keeps contiguous multi-selection stable while moving one step forward", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
  \draw (0,3) -- (1,3);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:1", "path:2"],
      direction: "bringForward"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource.indexOf("\\draw (0,3) -- (1,3);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,1) -- (1,1);")
    );
    expect(result.newSource.indexOf("\\draw (0,1) -- (1,1);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,2) -- (1,2);")
    );
  });

  it("moves non-contiguous multi-selection one step backward per statement", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
  \draw (0,3) -- (1,3);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:1", "path:3"],
      direction: "sendBackward"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource.indexOf("\\draw (0,1) -- (1,1);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,0) -- (1,0);")
    );
    expect(result.newSource.indexOf("\\draw (0,3) -- (1,3);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,2) -- (1,2);")
    );
  });

  it("keeps statements separated by newline+indent when reordering forward/backward", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (-3,-3) rectangle (3,3);\draw[fill=gray] (-1.31,1.23) rectangle (1,-0.29);

  \draw (-2.5, 2.5) -- (2.5, 2.5);
\end{tikzpicture}`;

    const backward = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:1"],
      direction: "sendBackward"
    });
    expect(backward.kind).toBe("success");
    if (backward.kind !== "success") return;
    expect(backward.newSource).not.toContain(";\\draw");
    expect(backward.newSource).toContain(";\n  \\draw");

    const forward = applyEditAction(backward.newSource, [], {
      kind: "reorderElements",
      elementIds: ["path:0"],
      direction: "bringForward"
    });
    expect(forward.kind).toBe("success");
    if (forward.kind !== "success") return;
    expect(forward.newSource).not.toContain(";\\draw");
    expect(forward.newSource).toContain(";\n  \\draw");
  });

  it("reorders mixed-parent selections per parent list", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \begin{scope}
    \draw (0,1) -- (1,1);
    \draw (0,2) -- (1,2);
  \end{scope}
  \draw (0,3) -- (1,3);
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const scope = parsed.figure.body.find((statement) => statement.kind === "Scope");
    expect(scope?.kind).toBe("Scope");
    if (!scope || scope.kind !== "Scope") {
      throw new Error("Expected a scope statement.");
    }
    const nestedFirst = scope.body.find((statement) => statement.kind === "Path");
    expect(nestedFirst?.kind).toBe("Path");
    if (!nestedFirst || nestedFirst.kind !== "Path") {
      throw new Error("Expected a nested path statement.");
    }

    const result = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:0", nestedFirst.id],
      direction: "bringToFront"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.newSource.indexOf("\\draw (0,3) -- (1,3);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,0) -- (1,0);")
    );
    expect(result.newSource.indexOf("\\draw (0,2) -- (1,2);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,1) -- (1,1);")
    );
  });

  it("uses CRLF separators and tolerates missing ids in direct replacement building", () => {
    const source = "\\begin{tikzpicture}\r\n  \\draw (0,0) -- (1,0);\r\n  \\draw (0,1) -- (1,1);\r\n\\end{tikzpicture}";
    const first = source.indexOf("\\draw (0,0)");
    const second = source.indexOf("\\draw (0,1)");
    const refs = [
      { id: "a", span: { from: first, to: source.indexOf(";", first) + 1 }, parentKey: "root", index: 0 },
      { id: "b", span: { from: second, to: source.indexOf(";", second) + 1 }, parentKey: "root", index: 1 }
    ];

    expect(buildParentReorderReplacement(source, [], [])).toBeNull();
    const replacement = buildParentReorderReplacement(source, refs as never, ["missing", "b", "a"]);
    expect(replacement?.text).toContain("\r\n  ");
    expect(replacement?.newSpansById.has("missing")).toBe(false);
    expect(replacement?.text.indexOf("\\draw (0,1)")).toBeLessThan(replacement?.text.indexOf("\\draw (0,0)") ?? 0);

    const adjacent = buildParentReorderReplacement("ab", [
      { id: "a", span: { from: 0, to: 1 }, parentKey: "root", index: 0 },
      { id: "b", span: { from: 1, to: 2 }, parentKey: "root", index: 1 }
    ] as never, ["b", "a"]);
    expect(adjacent?.text).toBe("b\na");
  });
});

describe("applyEditAction – group/ungroup", () => {
  it("rejects too-small, unresolved, and cross-parent group selections", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \begin{scope}
    \draw (0,1) -- (1,1);
  \end{scope}
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["path:0"]
    })).toEqual({
      kind: "unsupported",
      reason: "Group requires at least two selected statements."
    });

    expect(applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["path:0", "missing"]
    })).toEqual({
      kind: "unsupported",
      reason: "Group requires at least two selected statements."
    });

    const crossParent = applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["path:0", "path:2"]
    });
    expect(crossParent.kind).toBe("unsupported");
    if (crossParent.kind !== "unsupported") return;
    expect(crossParent.reason).toContain("same parent scope");
  });

  it("groups contiguous sibling statements into a scope", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["path:0", "path:1"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\begin{scope}");
    expect(result.newSource).toContain("\\end{scope}");
    expect(result.newSource.indexOf("\\begin{scope}")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,2) -- (1,2);")
    );
    expect(result.selectedSourceIds?.[0]?.startsWith("scope:")).toBe(true);
  });

  it("groups with configured indentation width", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \node[draw] (A) at (-1, -1) {A};
  \node[draw] (B) at (1, -1) {B};
  \draw (-1.35,-2.28) rectangle (2.2,-3.4);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["path:0", "path:1"]
    }, {
      parseOptions: {
        indentSize: 4
      }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\n      \\node[draw] (A) at (-1, -1) {A};");
    expect(result.newSource).toContain("\n      \\node[draw] (B) at (1, -1) {B};");
  });

  it("groups normalized statement ids while preserving CRLF separators", () => {
    const source = [
      String.raw`\begin{tikzpicture}`,
      String.raw`  \draw (0,0) -- (1,0);`,
      String.raw`  \draw (0,1) -- (1,1);`,
      String.raw`  \draw (0,2) -- (1,2);`,
      String.raw`\end{tikzpicture}`
    ].join("\r\n");

    const result = applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["node:ignored", "path:0", "path:0", "path:1"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\r\n  \\begin{scope}\r\n");
    expect(result.newSource).toContain("\r\n    \\draw (0,0) -- (1,0);");
    expect(result.newSource).toContain("\r\n    \\draw (0,1) -- (1,1);");
    expect(result.newSource).toContain("\r\n  \\draw (0,2) -- (1,2);");
  });

  it("infers grouping indentation from the shortest existing child indent", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
      \draw (0,0) -- (1,0);
        \draw (0,1) -- (1,1);
      \draw (0,2) -- (1,2);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["path:1", "path:2"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\n      \\begin{scope}\n");
    expect(result.newSource).toContain("\n        \\draw (0,0) -- (1,0);");
    expect(result.newSource).toContain("\n        \\draw (0,1) -- (1,1);");
  });

  it("keeps grouped children on their own source ids for downstream selection and drag", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (A) at (-1, -1) {A};
  \node[draw] (B) at (1, -1) {B};
  \draw (-1.35,-2.28) rectangle (2.2,-3.4);
\end{tikzpicture}`;

    const grouped = applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["path:0", "path:1"]
    });
    expect(grouped.kind).toBe("success");
    if (grouped.kind !== "success") return;

    const parsed = parseTikz(grouped.newSource, { recover: true, includeContextDefinitions: true });
    const semantic = evaluateTikzFigure(parsed.figure, grouped.newSource);
    const sourceIds = new Set(semantic.scene.elements.map((element) => element.sourceRef.sourceId));

    expect(sourceIds.has("path:1")).toBe(true);
    expect(sourceIds.has("path:2")).toBe(true);
    expect(sourceIds.has("scope:0")).toBe(false);
  });

  it("groups non-contiguous statements at a dependency-safe position", () => {
    const source = String.raw`\begin{tikzpicture}
  \coordinate (a) at (0,0);
  \draw (a) -- (1,0);
  \draw (2,0) -- (3,0);
  \draw (a) -- (1,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["path:0", "path:3"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    const beginScopeIndex = result.newSource.indexOf("\\begin{scope}");
    expect(beginScopeIndex).toBeGreaterThanOrEqual(0);
    expect(beginScopeIndex).toBeLessThan(result.newSource.indexOf("\\draw (a) -- (1,0);"));
    expect(beginScopeIndex).toBeLessThan(result.newSource.indexOf("\\draw (2,0) -- (3,0);"));
  });

  it("refuses grouping when no dependency-safe non-contiguous placement exists", () => {
    const source = String.raw`\begin{tikzpicture}
  \coordinate (a) at (0,0);
  \coordinate (b) at (a);
  \draw (b) -- (1,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["path:0", "path:2"]
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("dependency order");
  });

  it("ungroups a scope with no options", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) -- (1,0);
    \draw (0,1) -- (1,1);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "ungroupElements",
      elementIds: ["scope:0"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("\\begin{scope}");
    expect(result.newSource).not.toContain("\\end{scope}");
    expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
    expect(result.newSource).toContain("\\draw (0,1) -- (1,1);");
  });

  it("ungroup reindents inlined scope statements to the parent indentation level", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \begin{scope}
        \node[draw] (A) at (-1.1, -1.56) {A};
        \node[draw] (B) at (0.9, -1.56) {B};
  \end{scope}
  \draw (-1.3,-2.3) rectangle (2.2,-3.4);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "ungroupElements",
      elementIds: ["scope:0"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\n  \\node[draw] (A) at (-1.1, -1.56) {A};");
    expect(result.newSource).toContain("\n  \\node[draw] (B) at (0.9, -1.56) {B};");
    expect(result.newSource).not.toContain("\n        \\node[draw] (A) at (-1.1, -1.56) {A};");
    expect(result.newSource).not.toContain("\n        \\node[draw] (B) at (0.9, -1.56) {B};");
  });

  it("ungroup trims blank scope body edges before reindenting", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}

      \draw (0,0) -- (1,0);

  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "ungroupElements",
      elementIds: ["scope:0"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\n  \\draw (0,0) -- (1,0);\n");
    expect(result.newSource).not.toContain("\n\n  \\draw");
  });

  it("ungroups a scope with name-only options and drops name", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[name=mygroup]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "ungroupElements",
      elementIds: ["scope:0"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("\\begin{scope}");
    expect(result.newSource).not.toContain("name=mygroup");
    expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
  });

  it("refuses ungroup when scope has transform/style options", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[shift={(1,0)}]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "ungroupElements",
      elementIds: ["scope:0"]
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("without options");
  });

  it("refuses ungroup when scope options contain unsupported option syntax", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[{bad option}]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "ungroupElements",
      elementIds: ["scope:0"]
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("without options");
  });

  it("rejects invalid ungroup selections and non-scope statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "ungroupElements",
      elementIds: []
    })).toEqual({
      kind: "unsupported",
      reason: "Ungroup currently requires exactly one selected scope."
    });

    expect(applyEditAction(source, [], {
      kind: "ungroupElements",
      elementIds: ["path:0"]
    })).toEqual({
      kind: "unsupported",
      reason: "Ungroup currently supports scope selections only."
    });
  });

  it("ungroups empty and root-level scopes without inventing indentation", () => {
    const emptyScope = String.raw`\begin{tikzpicture}
  \begin{scope}[]
  \end{scope}
\end{tikzpicture}`;

    const emptyResult = applyEditAction(emptyScope, [], {
      kind: "ungroupElements",
      elementIds: ["scope:0"]
    });
    expect(emptyResult.kind).toBe("success");
    if (emptyResult.kind !== "success") {
      throw new Error("Expected empty scope ungroup to succeed");
    }
    expect(emptyResult.newSource).not.toContain("\\begin{scope}");
    expect(emptyResult.selectedSourceIds).toBeUndefined();

    const rootLevel = String.raw`\begin{tikzpicture}
\begin{scope}
\draw (0,0) -- (1,0);
\end{scope}
\end{tikzpicture}`;
    const rootResult = applyEditAction(rootLevel, [], {
      kind: "ungroupElements",
      elementIds: ["scope:0"]
    });
    expect(rootResult.kind).toBe("success");
    if (rootResult.kind !== "success") return;
    expect(rootResult.newSource).toContain("\n\\draw (0,0) -- (1,0);\n\\end{tikzpicture}");
  });

  it("classifies ungroupable scopes by option shape", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[name=ok]
    \draw (0,0) -- (1,0);
  \end{scope}
  \begin{scope}[shift={(1,0)}]
    \draw (0,1) -- (1,1);
  \end{scope}
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const scopes = parsed.figure.body.filter((statement) => statement.kind === "Scope");

    expect(scopes.map((scope) => isUngroupableScopeStatement(scope))).toEqual([true, false]);
  });
});

describe("applyEditAction – duplicateElements", () => {
  it("rejects empty and unresolved duplicate selections", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: [" ", " "]
    })).toEqual({
      kind: "unsupported",
      reason: "No element ids were provided for duplicateElements."
    });

    expect(applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["missing"]
    })).toEqual({
      kind: "unsupported",
      reason: "No duplicable statements were found for the selected element ids."
    });
  });

  it("duplicates selected statements after the same-parent anchor with default down-right offset", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["path:0"]
    });

    expect(result.kind === "success" || result.kind === "partial").toBe(true);
    if (result.kind !== "success" && result.kind !== "partial") return;

    expect(result.newSource.indexOf("\\draw (0,0) -- (1,0);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0.25,-0.25) -- (1.25,-0.25);")
    );
    expect(result.newSource.indexOf("\\draw (0.25,-0.25) -- (1.25,-0.25);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,1) -- (1,1);")
    );
    expect(result.selectedSourceIds?.length ?? 0).toBe(1);
  });

  it("renames duplicated named nodes to avoid name conflicts", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (C) at (0, 1.5) {C};
  \node[draw] (C2) at (2, 1.5) {C2};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["path:0"]
    });

    expect(result.kind === "success" || result.kind === "partial").toBe(true);
    if (result.kind !== "success" && result.kind !== "partial") return;
    expect(result.newSource).toContain("\\node[draw] (C3) at (0.25, 1.25) {C};");
  });

  it("uses spaced numeric suffixes for names that contain spaces", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (My Node) at (0, 1.5) {C};
  \node[draw] (My Node 2) at (2, 1.5) {C2};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["path:0"]
    });

    expect(result.kind === "success" || result.kind === "partial").toBe(true);
    if (result.kind !== "success" && result.kind !== "partial") return;
    expect(result.newSource).toContain("\\node[draw] (My Node 3) at (0.25, 1.25) {C};");
  });

  it("renames declared names across nested pasted snippets and rewrites references", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[alias={Alias}, name path={(Route)}, name path global=Trail] (A) at (0,0) {A};
  \node (A2) at (1,0) {A2};
  \node (Alias2) at (2,0) {Alias2};
  \path[name path local=Local] (A) -- (A2);
\end{tikzpicture}`;

    expect(renameSnippetDeclaredNames(source, [])).toEqual([]);
    expect(renameSnippetDeclaredNames(source, ["  \n  "])).toEqual(["  \n  "]);
    expect(renameSnippetDeclaredNames(source, ["\\draw (0,0) -- (1,0);"])).toEqual(["\\draw (0,0) -- (1,0);"]);

    const [renamed] = renameSnippetDeclaredNames(source, [
      String.raw`\begin{scope}[name path={Route}, alias=(Alias)]
  \node[alias={Alias}, name path local={(Local)}] (A) at (0,0) {A};
  \coordinate (A2) at (1,0);
  \path (A) edge node[alias=Alias] (B) {edge} (A2);
  \node (Root) {root} child { node[alias={Alias}] (Leaf) {leaf} edge from parent node (Edge Label) {} };
  \node (Placed) [right=of A, below=of Alias] {P};
  \draw[name path global=Trail] (A) -- (Alias);
\end{scope}`
    ]);

    expect(renamed).toContain("name path={Route2}");
    expect(renamed).toContain("alias=(Alias3)");
    expect(renamed).toContain("\\node[alias={Alias3}, name path local={(Local2)}] (A3)");
    expect(renamed).toContain("\\coordinate (A4) at");
    expect(renamed).toContain("(A3) edge node[alias=Alias3] (B)");
    expect(renamed).toContain("node[alias={Alias3}] (Leaf)");
    expect(renamed).toContain("edge from parent node (Edge Label)");
    expect(renamed).toContain("[right=of A3, below=of Alias3]");
    expect(renamed).toContain("(A3) -- (Alias3)");
    expect(renamed).toContain("name path global=Trail2");
  });

  it("renames conflicts across duplicate pasted snippets and unusual numeric suffixes", () => {
    const enormousSuffix = "9".repeat(400);
    const source = String.raw`\begin{tikzpicture}
  \node (Fresh) {fresh};
  \node (A) {a};
  \node (My Node 2) {spaced};
  \node (A${enormousSuffix}) {huge};
  \tikzset{kept/.style={draw}}
\end{tikzpicture}`;

    expect(renameSnippetDeclaredNames(source, ["\\node (Fresh2) {fresh};"])).toEqual(["\\node (Fresh2) {fresh};"]);

    const renamed = renameSnippetDeclaredNames(source, [
      "\\node (A) {one};\\node[alias={}] {empty alias};\\path (0,0) coordinate (Coord);\\node {anonymous};",
      "\\node (A) {two};\\node (My Node 2) {spaced};",
      `\\node (A${enormousSuffix}) {huge};`
    ]);

    expect(renamed[0]).toContain("\\node (A2) {one};");
    expect(renamed[1]).toContain("\\node (A2) {two};");
    expect(renamed[1]).toContain("\\node (My Node 3) {spaced};");
    expect(renamed[2]).toContain("\\node (A3) {huge};");
    expect(renamed[0]).toContain("alias={}");
    expect(renamed[0]).toContain("coordinate (Coord)");
  });

  it("duplicates without offset when delta is zero and falls back for non-finite components", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const zero = applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["path:0"],
      delta: wp(0, 0)
    });
    expect(zero.kind).toBe("success");
    if (zero.kind !== "success") {
      throw new Error("Expected zero-offset duplicate to succeed");
    }
    expect((zero.newSource.match(/\\draw \(0,0\) -- \(1,0\);/g) ?? []).length).toBe(2);

    const fallback = applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["path:0"],
      delta: wp(Number.POSITIVE_INFINITY, Number.NaN)
    });
    expect(fallback.kind === "success" || fallback.kind === "partial").toBe(true);
    if (fallback.kind !== "success" && fallback.kind !== "partial") return;
    expect(fallback.newSource).toContain("\\draw (0.25,-0.25) -- (1.25,-0.25);");
  });

  it("duplicates unmovable named-reference paths as partial inserts", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (A) at (0,0) {A};
  \node (B) at (1,0) {B};
  \draw (A) -- (B);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["path:2"]
    });

    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") {
      throw new Error("Expected named-reference duplicate to be partial");
    }
    expect(result.reason).toContain("Could not offset");
    expect(result.newSource).toContain("\\draw (A) -- (B);\n  \\draw (A) -- (B);");
    expectPatchesReconstructSource(source, result);
  });

  it("reuses offset preparation for identical snippets in mixed-parent duplicates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \begin{scope}
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["path:0", "path:2"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected mixed-parent duplicate to succeed");
    }
    expect((result.newSource.match(/\\draw \(0\.25,-0\.25\) -- \(1\.25,-0\.25\);/g) ?? []).length).toBe(2);
    expect(result.selectedSourceIds).toHaveLength(2);
  });
});

describe("applyEditAction – repeatElements", () => {
  it("rejects empty, no-op, and non-finite repeat requests", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const empty = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: [" ", "path:0", "path:0"],
      columns: 1,
      rows: 1,
      horizontalStep: cm(1),
      verticalStep: cm(1)
    });
    expect(empty).toEqual({
      kind: "unsupported",
      reason: "Repeat needs more than one row or column."
    });

    const missingSelection = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: [" "],
      columns: 2,
      rows: 1,
      horizontalStep: cm(1),
      verticalStep: cm(1)
    });
    expect(missingSelection).toEqual({
      kind: "unsupported",
      reason: "Select at least one authored element to repeat."
    });

    const nonFiniteStep = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 1,
      horizontalStep: Number.POSITIVE_INFINITY,
      verticalStep: cm(1)
    });
    expect(nonFiniteStep).toEqual({
      kind: "error",
      message: "Repeat step values must be finite numbers."
    });

    const nonFiniteColumns = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: Number.NaN,
      rows: 2,
      horizontalStep: cm(1),
      verticalStep: cm(1)
    });
    expect(nonFiniteColumns.kind).toBe("success");
    if (nonFiniteColumns.kind === "success") {
      expect(nonFiniteColumns.newSource).toContain(String.raw`\foreach \j in {0, ..., 1}`);
      expect(nonFiniteColumns.newSource).not.toContain(String.raw`\foreach \i`);
    }
  });

  it("rejects repeat selections that are missing, existing foreach statements, or cross-parent", () => {
    const missingSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const missing = applyEditAction(missingSource, [], {
      kind: "repeatElements",
      elementIds: ["path:99"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(1),
      verticalStep: cm(1)
    });
    expect(missing.kind).toBe("unsupported");
    if (missing.kind === "unsupported") {
      expect(missing.reason).toContain("direct authored statement");
    }

    const foreachSource = String.raw`\begin{tikzpicture}
  \foreach \x in {0,1} {
    \draw (\x,0) -- ++(1,0);
  }
\end{tikzpicture}`;
    const existingForeach = applyEditAction(foreachSource, [], {
      kind: "repeatElements",
      elementIds: ["foreach:0"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(1),
      verticalStep: cm(1)
    });
    expect(existingForeach.kind).toBe("unsupported");
    if (existingForeach.kind === "unsupported") {
      expect(existingForeach.reason).toContain("foreach");
    }

    const crossParentSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \begin{scope}
    \draw (0,1) -- (1,1);
  \end{scope}
\end{tikzpicture}`;
    const crossParent = applyEditAction(crossParentSource, [], {
      kind: "repeatElements",
      elementIds: ["path:0", "path:2"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(1),
      verticalStep: cm(1)
    });
    expect(crossParent.kind).toBe("unsupported");
    if (crossParent.kind === "unsupported") {
      expect(crossParent.reason).toContain("same parent scope");
    }
  });

  it("repeats a single draw statement by rewriting path coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 3,
      rows: 1,
      horizontalStep: cm(2),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \i in {0, ..., 2} {`);
    expect(result.newSource).toContain(String.raw`\draw (\i*2cm,0) -- (1cm+\i*2cm,0);`);
    expect(result.newSource).not.toContain("shift=");
    expect(parseTikz(result.newSource, { recover: true }).diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("normalizes duplicate changed ids for successful repeats without indentation", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: [" ", "path:0", "path:0"],
      columns: 2.8,
      rows: 1,
      horizontalStep: cm(1),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \i in {0, ..., 1}`);
    expect(result.changedSourceIds).toEqual(["path:0", "foreach:0"]);
  });

  it("rewrites coordinate options, xyz coordinates, and to/edge coordinate targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw ([xshift=1pt] 0,0,2) to[out=20,in=160] (1,0) edge (2,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 2,
      horizontalStep: cm(1),
      verticalStep: cm(0.5)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`([xshift=1pt] \i*1cm,-\j*0.5cm,2)`);
    expect(result.newSource).toContain(String.raw`to[out=20,in=160] (1cm+\i*1cm,-\j*0.5cm)`);
    expect(result.newSource).toContain(String.raw`edge (2cm+\i*1cm,-\j*0.5cm)`);
    expect(parseTikz(result.newSource, { recover: true }).diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("falls back to a shifted scope for relative and polar coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- ++(1,0) -- (45:1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(2),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\begin{scope}[shift={(\i*2cm,0)}]`);
    expect(result.newSource).toContain(String.raw`\draw (0,0) -- ++(1,0) -- (45:1);`);
  });

  it("falls back to shifted scopes for relative to targets and malformed coordinates", () => {
    const relativeTo = String.raw`\begin{tikzpicture}
  \draw (0,0) to ++(1,0);
\end{tikzpicture}`;
    const relativeResult = applyEditAction(relativeTo, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(2),
      verticalStep: cm(1)
    });
    expect(relativeResult.kind).toBe("success");
    if (relativeResult.kind !== "success") {
      throw new Error("Expected relative to-target repeat to succeed via fallback");
    }
    expect(relativeResult.newSource).toContain(String.raw`\begin{scope}[shift={(\i*2cm,0)}]`);
    expect(relativeResult.newSource).toContain(String.raw`\draw (0,0) to ++(1,0);`);

    const malformed = String.raw`\begin{tikzpicture}
  \draw (,0) -- (1,0);
\end{tikzpicture}`;
    const malformedResult = applyEditAction(malformed, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(2),
      verticalStep: cm(1)
    });
    expect(malformedResult.kind).toBe("success");
    if (malformedResult.kind !== "success") {
      throw new Error("Expected malformed-coordinate repeat to succeed via fallback");
    }
    expect(malformedResult.newSource).toContain(String.raw`\begin{scope}[shift={(\i*2cm,0)}]`);
    expect(malformedResult.newSource).toContain(String.raw`\draw (,0) -- (1,0);`);
  });

  it("keeps named-node declaration coordinates unshifted while shifting the node placement", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (A) at (0,0) node[draw] (A) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(2),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\draw (A) at (\i*2cm,0) node[draw] (A) {A};`);
  });

  it("chooses fallback loop variables when the snippet already uses preferred names", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw node {\i \col \x \dx \xx \j \row \y \dy \yy \v1} (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 2,
      horizontalStep: cm(1),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \v2 in {0, ..., 1}`);
    expect(result.newSource).toContain(String.raw`\foreach \v3 in {0, ..., 1}`);
  });

  it("normalizes zero step repeats without adding zero-offset expressions", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (1,2) -- (3,4);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 1,
      horizontalStep: 0,
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\draw (1cm,2) -- (3cm,4);`);
    expect(result.newSource).not.toContain("*0cm");
  });

  it("preserves CRLF newlines in repeat rewrites", () => {
    const source = "\\begin{tikzpicture}\r\n  \\draw (0,0) -- (1,0);\r\n\\end{tikzpicture}";

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(1),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\r\n");
    expect(result.newSource).not.toContain("\n  \\draw (0,0)");
  });

  it("repeats a node with at-placement by rewriting the at coordinate", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0, 1.5) {C};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(3),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \i in {0, ..., 1} {`);
    expect(result.newSource).toContain(String.raw`\node[draw] at (\i*3cm,1.5) {C};`);
    expect(result.newSource).not.toContain("shift=");
    expect(parseTikz(result.newSource, { recover: true }).diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("repeats a named node with at-placement by rewriting the at coordinate", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (C) at (0, 1.5) {C};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 3,
      rows: 2,
      horizontalStep: cm(3),
      verticalStep: cm(2)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\node[draw] (C) at (\i*3cm,1.5cm-\j*2cm) {C};`);
    expect(result.newSource).not.toContain(String.raw`\begin{scope}[shift=`);
    expect(result.newSource).not.toContain("shift=");
    expect(parseTikz(result.newSource, { recover: true }).diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("repeats a node in two dimensions without falling back to a shifted scope", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0, 1.5) {C};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 3,
      rows: 2,
      horizontalStep: cm(3),
      verticalStep: cm(2)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \j in {0, ..., 1} {`);
    expect(result.newSource).toContain(String.raw`\foreach \i in {0, ..., 2} {`);
    expect(result.newSource).toContain(String.raw`\node[draw] at (\i*3cm,1.5cm-\j*2cm) {C};`);
    expect(result.newSource).not.toContain(String.raw`\begin{scope}[shift=`);
    expect(result.newSource).not.toContain("shift=");
    expect(parseTikz(result.newSource, { recover: true }).diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("repeats a rectangle path in two dimensions by rewriting both corners", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 3,
      rows: 2,
      horizontalStep: cm(3),
      verticalStep: cm(2)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \j in {0, ..., 1} {`);
    expect(result.newSource).toContain(String.raw`\foreach \i in {0, ..., 2} {`);
    expect(result.newSource).toContain(String.raw`\draw (\i*3cm,-\j*2cm) rectangle (1cm+\i*3cm,1cm-\j*2cm);`);
    expect(result.newSource).not.toContain(String.raw`\begin{scope}[shift=`);
    expect(result.newSource).not.toContain("shift=");
    expect(parseTikz(result.newSource, { recover: true }).diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("repeats a line path in two dimensions without introducing a shifted scope", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 3,
      rows: 2,
      horizontalStep: cm(3),
      verticalStep: cm(2)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \j in {0, ..., 1} {`);
    expect(result.newSource).toContain(String.raw`\foreach \i in {0, ..., 2} {`);
    expect(result.newSource).toContain(String.raw`\draw (\i*3cm,-\j*2cm) -- (1cm+\i*3cm,-\j*2cm);`);
    expect(result.newSource).not.toContain(String.raw`\begin{scope}[shift=`);
    expect(result.newSource).not.toContain("shift=");
    expect(parseTikz(result.newSource, { recover: true }).diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("repeats a single scope without inserting an extra inner scope", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["scope:0"],
      columns: 1,
      rows: 2,
      horizontalStep: cm(1),
      verticalStep: cm(2)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \j in {0, ..., 1} {`);
    expect((result.newSource.match(/\\begin\{scope\}/g) ?? []).length).toBe(1);
    expect(result.newSource).toContain(String.raw`\begin{scope}[shift={(0,-\j*2cm)}]`);
  });

  it("repeats a scope in two dimensions without wrapping it in an extra shifted scope", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["scope:0"],
      columns: 3,
      rows: 2,
      horizontalStep: cm(3),
      verticalStep: cm(2)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \j in {0, ..., 1} {`);
    expect(result.newSource).toContain(String.raw`\foreach \i in {0, ..., 2} {`);
    expect(result.newSource).toContain(String.raw`\begin{scope}[shift={(\i*3cm,-\j*2cm)}]`);
    expect((result.newSource.match(/\\begin\{scope\}/g) ?? []).length).toBe(1);
  });

  it("wraps multi-statement repeats in an inner shifted scope", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0", "path:1"],
      columns: 2,
      rows: 2,
      horizontalStep: cm(2),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \j in {0, ..., 1} {`);
    expect(result.newSource).toContain(String.raw`\foreach \i in {0, ..., 1} {`);
    expect(result.newSource).toContain(String.raw`\begin{scope}[shift={(\i*2cm,-\j*1cm)}]`);
    expect(parseTikz(result.newSource, { recover: true }).diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("rejects non-contiguous repeat selections", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0", "path:2"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(2),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("contiguous");
  });

  it("rejects foreach-origin repeat selections", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,...,1} {
    \draw (\x,0) -- ++(1,0);
  }
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["foreach:0"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(2),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("foreach");
  });
});

describe("applyEditAction – pasteStatements", () => {
  it("rejects empty paste snippets", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "pasteStatements",
      snippets: ["   ", "\n"]
    })).toEqual({
      kind: "unsupported",
      reason: "No snippets were provided for pasteStatements."
    });
  });

  it("pastes non-statement snippets without trying to offset them", () => {
    const source = String.raw`\begin{tikzpicture}
\end{tikzpicture}`;
    let moveCallCount = 0;

    const result = applyPasteStatementsAction(source, {
      snippets: ["% retained comment"],
      delta: wp(4, 4)
    }, {
      applyMoveElements: () => {
        moveCallCount += 1;
        return { kind: "success", newSource: "" };
      },
      normalizeElementIds: (ids) => ids.map((id) => id.trim()).filter((id) => id.length > 0),
      uniqueStrings: (values) => [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))],
      defaultDuplicateOffsetPt: cm(0.25)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected comment paste to succeed");
    }
    expect(result.selectedSourceIds).toBeUndefined();
    expect(result.newSource).toContain("% retained comment");
    expect(moveCallCount).toBe(0);
  });

  it("reports paste offset failures from unsupported and error move attempts", () => {
    const source = String.raw`\begin{tikzpicture}
\end{tikzpicture}`;
    const deps = {
      normalizeElementIds: (ids: readonly string[]) => ids.map((id) => id.trim()).filter((id) => id.length > 0),
      uniqueStrings: (values: readonly string[]) => [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))],
      defaultDuplicateOffsetPt: cm(0.25)
    };

    const unsupported = applyPasteStatementsAction(source, {
      snippets: [String.raw`\draw (0,0) -- (1,0);`],
      delta: wp(4, 4)
    }, {
      ...deps,
      applyMoveElements: () => ({ kind: "unsupported", reason: "locked handles" })
    });
    expect(unsupported.kind).toBe("partial");
    if (unsupported.kind !== "partial") {
      throw new Error("Expected unsupported offset paste to be partial");
    }
    expect(unsupported.reason).toContain("locked handles");
    expect(unsupported.newSource).toContain(String.raw`\draw (0,0) -- (1,0);`);

    const errored = applyPasteStatementsAction(source, {
      snippets: [String.raw`\draw (0,0) -- (1,0);`],
      delta: wp(4, 4)
    }, {
      ...deps,
      applyMoveElements: () => ({ kind: "error", message: "invalid geometry" })
    });
    expect(errored.kind).toBe("partial");
    if (errored.kind !== "partial") {
      throw new Error("Expected errored offset paste to be partial");
    }
    expect(errored.reason).toContain("invalid geometry");
    expect(errored.newSource).toContain(String.raw`\draw (0,0) -- (1,0);`);
  });

  it("pastes snippets after anchor and returns selected source ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "pasteStatements",
      snippets: ["\\draw (0,0) -- (1,0);"],
      anchorElementId: "path:0"
    });

    expect(result.kind === "success" || result.kind === "partial").toBe(true);
    if (result.kind !== "success" && result.kind !== "partial") return;
    expect(result.newSource).toContain("\\draw (0.25,-0.25) -- (1.25,-0.25);");
    expect(result.selectedSourceIds?.length ?? 0).toBe(1);
  });

  it("pastes snippets before \\end{tikzpicture} when no anchor is provided", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "pasteStatements",
      snippets: ["\\draw (2,2) -- (3,2);"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (2.25,1.75) -- (3.25,1.75);");
    expect(result.newSource).toContain("\\draw (2.25,1.75) -- (3.25,1.75);\n\\end{tikzpicture}");
    const endIndex = result.newSource.lastIndexOf("\\end{tikzpicture}");
    expect(result.newSource.lastIndexOf("\\draw (2.25,1.75) -- (3.25,1.75);")).toBeLessThan(endIndex);
  });

  it("renames pasted named nodes and updates coordinate references", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (C) at (0, 1.5) {C};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "pasteStatements",
      snippets: [
        "\\node[draw] (C) at (0, 1.5) {C};",
        "\\draw (C) -- ++(1,0);"
      ]
    });

    expect(result.kind === "success" || result.kind === "partial").toBe(true);
    if (result.kind !== "success" && result.kind !== "partial") return;
    expect(result.newSource).toContain("\\node[draw] (C2) at (0.25, 1.25) {C};");
    expect(result.newSource).toContain("\\draw (C2) -- ++");
  });

  it("pastes with zero offset and preserves CRLF insertion style", () => {
    const source = "\\begin{tikzpicture}\r\n  \\draw (0,0) -- (1,0);\r\n\\end{tikzpicture}";

    const result = applyEditAction(source, [], {
      kind: "pasteStatements",
      snippets: ["\\draw (2,2) -- (3,2);"],
      delta: wp(0, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected zero-offset CRLF paste to succeed");
    }
    expect(result.newSource).toContain("  \\draw (2,2) -- (3,2);");
    expect(result.newSource).toContain("\r\n\\end{tikzpicture}");
  });

  it("returns partial when pasted named-reference coordinates cannot be offset", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "pasteStatements",
      snippets: ["\\draw (A) -- (B);"]
    });

    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") {
      throw new Error("Expected named-reference paste to be partial");
    }
    expect(result.reason).toContain("Could not offset");
    expect(result.newSource).toContain("\\draw (A) -- (B);");
  });
});

describe("applyEditAction – adornment placement", () => {
  it("rejects adornment actions when the target cannot be resolved", () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0,0) {A};
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "duplicateAdornment",
      targetId: "node-adornment:missing"
    }).kind).toBe("unsupported");
    expect(applyEditAction(source, [], {
      kind: "moveAdornment",
      targetId: "node-adornment:missing",
      ownerPoint: wp(0, 0),
      newWorld: wp(1, 0)
    }).kind).toBe("unsupported");
    expect(applyEditAction(source, [], {
      kind: "addNodeAdornment",
      nodeId: "node:missing",
      adornmentKind: "label",
      angle: "above",
      text: "X"
    }).kind).toBe("unsupported");
  });

  it("rejects adding node adornments to non-node source targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addNodeAdornment",
      nodeId: "path:0",
      adornmentKind: "label",
      angle: "above",
      text: "X"
    });

    expect(result).toEqual({
      kind: "unsupported",
      reason: "Selected target is not a node that can receive an adornment."
    });
  });

  it("inserts a new pin by creating a node option list when none exists", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (A) at (0,0) {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const statement = parsed.figure.body.find((entry) => entry.kind === "Path");
    if (!statement || statement.kind !== "Path") {
      throw new Error("Expected node path statement");
    }
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") {
      throw new Error("Expected node item");
    }

    const result = applyEditAction(source, [], {
      kind: "addNodeAdornment",
      nodeId: node.id,
      adornmentKind: "pin",
      angle: "right",
      text: "P"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected adornment insertion to create options");
    }
    expect(result.newSource).toBe(String.raw`\begin{tikzpicture}
  \node[pin=right:P] (A) at (0,0) {A};
\end{tikzpicture}`);
    expect(result.selectedSourceIds).toEqual([`node-adornment:${node.id}:pin:0`]);
  });

  it("inserts a new label inside an existing node option list", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (A) at (-1, -1) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addNodeAdornment",
      nodeId: "node:0:3",
      adornmentKind: "label",
      angle: "below",
      text: "Label"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected adornment insertion to succeed");
    }
    expect(result.newSource).toBe(String.raw`\begin{tikzpicture}
  \node[draw, label=below:Label] (A) at (-1, -1) {A};
\end{tikzpicture}`);
  });

  it("inserts new adornments before trailing option-list whitespace", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[
    draw,
  ] (A) at (-1, -1) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addNodeAdornment",
      nodeId: "node:0:3",
      adornmentKind: "label",
      angle: "above",
      text: "L"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected adornment insertion before trailing whitespace to succeed");
    }
    expect(result.newSource).toContain("draw,\n  , label=above:L]");
    expect(result.newSource).not.toContain("]\n, label");
  });

  it("omits a local label distance when dragging back to the implicit default distance", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label={[red,label distance=6pt]above:X}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveAdornment",
      targetId: "node-adornment:node:0:2:label:0",
      ownerPoint: wp(0, 0),
      newWorld: wp(0, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected adornment move to succeed");
    }
    expect(result.newSource).toContain("label={[");
    expect(result.newSource).toContain("center:X");
    expect(result.newSource).not.toContain("label distance=");
    expect(result.newSource).not.toContain("every label");
    expect(result.changedSourceIds).toEqual(["path:0"]);
  });

  it("moves adornments using explicit overrides and computed compass angles", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label=right:L] at (0,0) {A};
\end{tikzpicture}`;

    const explicit = applyEditAction(source, [], {
      kind: "moveAdornment",
      targetId: "node-adornment:node:0:2:label:0",
      ownerPoint: wp(0, 0),
      newWorld: wp(-10, 0),
      angleRaw: "123",
      distancePt: 42
    });
    expect(explicit.kind).toBe("success");
    if (explicit.kind !== "success") {
      throw new Error("Expected explicit adornment move to succeed");
    }
    expect(explicit.newSource).toContain("label distance=42pt");
    expect(explicit.newSource).toContain("123:L");

    const computed = applyEditAction(source, [], {
      kind: "moveAdornment",
      targetId: "node-adornment:node:0:2:label:0",
      ownerPoint: wp(0, 0),
      newWorld: wp(-10, -10)
    });
    expect(computed.kind).toBe("success");
    if (computed.kind !== "success") {
      throw new Error("Expected computed adornment move to succeed");
    }
    expect(computed.newSource).toContain("below left:L");
  });

  it("uses numeric computed angles when a moved adornment is away from compass presets", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label=right:L] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveAdornment",
      targetId: "node-adornment:node:0:2:label:0",
      ownerPoint: wp(0, 0),
      newWorld: wp(10, 4)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected non-compass adornment move to succeed");
    }
    expect(result.newSource).toContain("22:L");
    expect(result.newSource).toContain("label distance=11pt");

    const fine = applyEditAction(source, [], {
      kind: "moveAdornment",
      targetId: "node-adornment:node:0:2:label:0",
      ownerPoint: wp(0, 0),
      newWorld: wp(10, 4),
      formatPrecision: "fine"
    });
    expect(fine.kind).toBe("success");
    if (fine.kind !== "success") {
      throw new Error("Expected fine-precision adornment move to succeed");
    }
    expect(fine.newSource).toContain("label distance=10.8pt");
  });

  it("does not serialize synthetic every-pin styles when rewriting a pin repeatedly", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin=above:Pin] at (0,0) {A};
\end{tikzpicture}`;

    const firstRewrite = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: "__adornment_distance__",
      value: "23.5pt"
    });

    expect(firstRewrite.kind).toBe("success");
    if (firstRewrite.kind !== "success") {
      throw new Error("Expected first pin rewrite to succeed");
    }
    expect(firstRewrite.newSource).not.toContain("every pin");

    const secondRewrite = applyEditAction(firstRewrite.newSource, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: "__adornment_angle__",
      value: "40"
    });

    expect(secondRewrite.kind).toBe("success");
    if (secondRewrite.kind !== "success") {
      throw new Error("Expected second pin rewrite to succeed");
    }
    expect(secondRewrite.newSource).not.toContain("every pin");
  });

  it("rewrites pin-edge dash mode without disturbing other pin-edge options", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin={[pin edge={draw=blue,dashed,line width=1pt},fill=yellow]above:P}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: PIN_EDGE_DASH_PROPERTY_KEY,
      value: "densely dotted",
      clearKeys: ["dashed"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected pin-edge dash rewrite to succeed");
    }
    expect(result.newSource).toContain("pin edge={draw=blue, line width=1pt, densely dotted}");
    expect(result.newSource).not.toContain("pin edge={draw=blue,dashed");
    expect(result.newSource).toContain("fill=yellow");
  });

  it("removes pin-edge entirely when the last pin-edge style is cleared", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin={[pin edge={draw=blue}]above:P}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: PIN_EDGE_DRAW_PROPERTY_KEY,
      value: ""
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected pin-edge draw removal to succeed");
    }
    expect(result.newSource).not.toContain("pin edge");
    expect(result.newSource).toContain("pin=above:P");
  });

  it("rewrites pin-edge line width while normalizing braced pin-edge payloads", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin={[pin edge=dashed]above:P}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: PIN_EDGE_LINE_WIDTH_PROPERTY_KEY,
      value: "2pt"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected pin-edge line width rewrite to succeed");
    }
    expect(result.newSource).toContain("pin edge={dashed, line width=2pt}");
  });

  it("normalizes solid pin-edge dash mode by removing authored dash options", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin={[pin edge={draw=blue,dashed}]above:P}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: PIN_EDGE_DASH_PROPERTY_KEY,
      value: "solid"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected pin-edge solid rewrite to succeed");
    }
    expect(result.newSource).toContain("pin edge={draw=blue}");
    expect(result.newSource).not.toContain("dashed");
  });

  it("creates pin-edge options when absent and supports empty dash clearing", () => {
    const withoutPinEdge = String.raw`\begin{tikzpicture}
  \node[draw,pin=above:P] at (0,0) {A};
\end{tikzpicture}`;

    const created = applyEditAction(withoutPinEdge, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: PIN_EDGE_DRAW_PROPERTY_KEY,
      value: "red"
    });

    expect(created.kind).toBe("success");
    if (created.kind !== "success") {
      throw new Error("Expected pin-edge creation to succeed");
    }
    expect(created.newSource).toContain("pin edge={draw=red}");

    const dashed = String.raw`\begin{tikzpicture}
  \node[draw,pin={[pin edge={draw=blue,dashed}]above:P}] at (0,0) {A};
\end{tikzpicture}`;
    const clearedDash = applyEditAction(dashed, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: PIN_EDGE_DASH_PROPERTY_KEY,
      value: ""
    });

    expect(clearedDash.kind).toBe("success");
    if (clearedDash.kind !== "success") {
      throw new Error("Expected empty pin-edge dash rewrite to succeed");
    }
    expect(clearedDash.newSource).toContain("pin edge={draw=blue}");
    expect(clearedDash.newSource).not.toContain("dashed");
  });
});

describe("applyEditAction – path-attached nodes", () => {
  function firstPathNode(source: string) {
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");
    return { statement, node };
  }

  it("rewrites neutral path-attached nodes by position only", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[pos=0.4,fill=white] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "movePathAttachedNode",
      nodeId: node.id,
      hostPathSourceId: statement.id,
      pos: 0.75,
      preserveRegime: true
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("node[fill=white, near end] {A}");
    expect(result.newSource).not.toContain("above");
    expect(result.newSource).not.toContain("auto");
  });

  it("writes explicit directional distance when dragged", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[above] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "movePathAttachedNode",
      nodeId: node.id,
      hostPathSourceId: statement.id,
      pos: 0.5,
      preserveRegime: true,
      sideUpdate: { kind: "explicit-direction", direction: "above" },
      distanceUpdatePt: 2.6
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("node[above=3pt] {A}");

    const fine = applyEditAction(source, [], {
      kind: "movePathAttachedNode",
      nodeId: node.id,
      hostPathSourceId: statement.id,
      pos: 0.5,
      preserveRegime: true,
      sideUpdate: { kind: "explicit-direction", direction: "above" },
      distanceUpdatePt: 2.6,
      formatPrecision: "fine"
    });

    expect(fine.kind).toBe("success");
    if (fine.kind !== "success") return;
    expect(fine.newSource).toContain("node[above=2.6pt] {A}");
  });

  it("drops explicit directional distance when dragged back near zero", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[above=0.04pt] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "movePathAttachedNode",
      nodeId: node.id,
      hostPathSourceId: statement.id,
      pos: 0.5,
      preserveRegime: true,
      sideUpdate: { kind: "explicit-direction", direction: "above" },
      distanceUpdatePt: 0.01
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("node[above] {A}");
    expect(result.newSource).not.toContain("above=");
  });

  it("rewrites dragged path-attached nodes to named position presets", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[pos=0.24,above] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "movePathAttachedNode",
      nodeId: node.id,
      hostPathSourceId: statement.id,
      pos: 0.26,
      preserveRegime: true,
      sideUpdate: { kind: "explicit-direction", direction: "above" }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.newSource).toContain("node[above, near start] {A}");
    expect(result.newSource).not.toContain("pos=");
    expect(result.changedSourceIds).toEqual([statement.id]);
  });

  it("omits midway when a dragged path-attached node lands on the default position", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[pos=0.49,above] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "movePathAttachedNode",
      nodeId: node.id,
      hostPathSourceId: statement.id,
      pos: 0.5,
      preserveRegime: true,
      sideUpdate: { kind: "explicit-direction", direction: "above" }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.newSource).toContain("node[above] {A}");
    expect(result.newSource).not.toContain("midway");
    expect(result.newSource).not.toContain("pos=");
  });

  it("keeps auto regime and rewrites side via swap only", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[auto] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "movePathAttachedNode",
      nodeId: node.id,
      hostPathSourceId: statement.id,
      pos: 0.75,
      preserveRegime: true,
      sideUpdate: { kind: "auto-side", side: "right" }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.newSource).toContain("node[auto, near end, swap] {A}");
    expect(result.newSource).not.toContain("above");
    expect(result.newSource).not.toContain("below");
  });

  it("removes swap when an auto-side node is dragged back to its base side", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[auto,swap,pos=0.25] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "movePathAttachedNode",
      nodeId: node.id,
      hostPathSourceId: statement.id,
      pos: 0.25,
      preserveRegime: true,
      sideUpdate: { kind: "auto-side", side: "left" }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("node[auto, near start] {A}");
    expect(result.newSource).not.toContain("swap");
  });

  it("ignores directional distance updates for auto regime", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[auto] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "movePathAttachedNode",
      nodeId: node.id,
      hostPathSourceId: statement.id,
      pos: 0.5,
      preserveRegime: true,
      sideUpdate: { kind: "auto-side", side: "left" },
      distanceUpdatePt: 7
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toBe(PATH_ATTACHED_NODE_EDIT_NOOP_REASON);
  });

  it("supports inspector writes for path-attached side and sloped", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[above] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const sideResult = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: node.id,
      level: "command",
      key: "__path_attached_node_side__",
      value: "below"
    });
    expect(sideResult.kind).toBe("success");
    if (sideResult.kind !== "success") return;
    expect(sideResult.newSource).toContain("node[below] {A}");

    const slopedResult = applyEditAction(sideResult.newSource, [], {
      kind: "setProperty",
      elementId: node.id,
      level: "command",
      key: "sloped",
      value: "true"
    });
    expect(slopedResult.kind).toBe("success");
    if (slopedResult.kind !== "success") return;
    expect(slopedResult.newSource).toContain("node[below, sloped] {A}");
  });

  it("ignores unrelated path-attached inspector keys and reports no-op rewrites", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[above] {A};
\end{tikzpicture}`;
    const { statement, node } = firstPathNode(source);

    expect(applyPathAttachedNodeInspectorAction(source, {
      elementId: node.id,
      key: "fill",
      value: "red"
    })).toBeNull();

    const unresolved = applyPathAttachedNodeInspectorAction(source, {
      elementId: "node:missing",
      key: PATH_ATTACHED_NODE_SIDE_KEY,
      value: "below"
    });
    expect(unresolved?.kind).toBe("unsupported");

    const pathTarget = applyPathAttachedNodeInspectorAction(source, {
      elementId: statement.id,
      key: PATH_ATTACHED_NODE_SIDE_KEY,
      value: "below"
    });
    expect(pathTarget?.kind).toBe("unsupported");

    const noop = applyPathAttachedNodeInspectorAction(source, {
      elementId: node.id,
      key: PATH_ATTACHED_NODE_SIDE_KEY,
      value: "above"
    });
    expect(noop?.kind).toBe("unsupported");
    if (noop?.kind === "unsupported") {
      expect(noop.reason).toBe(PATH_ATTACHED_NODE_EDIT_NOOP_REASON);
    }
  });

  it("rewrites path-attached inspector sides within each explicit direction family", () => {
    const cases = [
      {
        source: String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[base left] {A};
\end{tikzpicture}`,
        value: "base right",
        expected: "node[base right] {A}",
        removed: "base left"
      },
      {
        source: String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[mid left] {A};
\end{tikzpicture}`,
        value: "mid right",
        expected: "node[mid right] {A}",
        removed: "mid left"
      },
      {
        source: String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[above left] {A};
\end{tikzpicture}`,
        value: "below right",
        expected: "node[below right] {A}",
        removed: "above left"
      }
    ];

    for (const entry of cases) {
      const { node } = firstPathNode(entry.source);
      const result = applyPathAttachedNodeInspectorAction(entry.source, {
        elementId: node.id,
        key: PATH_ATTACHED_NODE_SIDE_KEY,
        value: entry.value
      });

      expect(result?.kind).toBe("success");
      if (result?.kind !== "success") continue;
      expect(result.newSource).toContain(entry.expected);
      expect(result.newSource).not.toContain(entry.removed);
    }
  });

  it("keeps explicit auto=right when rewriting to the swapped side", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[auto=right] {A};
\end{tikzpicture}`;
    const { node } = firstPathNode(source);

    const result = applyPathAttachedNodeInspectorAction(source, {
      elementId: node.id,
      key: PATH_ATTACHED_NODE_SIDE_KEY,
      value: "left"
    });

    expect(result?.kind).toBe("success");
    if (result?.kind !== "success") return;
    expect(result.newSource).toContain("node[auto=right, swap] {A}");
  });

  it("rejects incompatible path-attached inspector side values by regime", () => {
    const autoSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[auto] {A};
\end{tikzpicture}`;
    const autoParsed = parseTikz(autoSource);
    const autoStatement = autoParsed.figure.body[0];
    if (!autoStatement || autoStatement.kind !== "Path") throw new Error("Expected path statement");
    const autoNode = autoStatement.items.find((item) => item.kind === "Node");
    if (!autoNode || autoNode.kind !== "Node") throw new Error("Expected auto node item");

    const badAutoSide = applyEditAction(autoSource, [], {
      kind: "setProperty",
      elementId: autoNode.id,
      level: "command",
      key: PATH_ATTACHED_NODE_SIDE_KEY,
      value: "above"
    });
    expect(badAutoSide.kind).toBe("error");

    const explicitSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[base left] {A};
\end{tikzpicture}`;
    const explicitParsed = parseTikz(explicitSource);
    const explicitStatement = explicitParsed.figure.body[0];
    if (!explicitStatement || explicitStatement.kind !== "Path") throw new Error("Expected path statement");
    const explicitNode = explicitStatement.items.find((item) => item.kind === "Node");
    if (!explicitNode || explicitNode.kind !== "Node") throw new Error("Expected explicit node item");

    const badExplicitSide = applyEditAction(explicitSource, [], {
      kind: "setProperty",
      elementId: explicitNode.id,
      level: "command",
      key: PATH_ATTACHED_NODE_SIDE_KEY,
      value: "above"
    });
    expect(badExplicitSide.kind).toBe("error");
  });

  it("rejects invalid path-attached inspector positions and neutral side edits", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[pos=0.4] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const invalidPosition = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: node.id,
      level: "command",
      key: PATH_ATTACHED_NODE_POSITION_VALUE_KEY,
      value: "not-a-number"
    });
    expect(invalidPosition.kind).toBe("error");

    const neutralSide = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: node.id,
      level: "command",
      key: PATH_ATTACHED_NODE_SIDE_KEY,
      value: "left"
    });
    expect(neutralSide.kind).toBe("unsupported");
  });

  it("supports resizeElement rewrites for path-attached nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[->] (0,0) -- node[above,draw] {A} (2,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: node.id,
      role: "bottom-right",
      newWorld: wp(60, 40)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toMatch(/node\[[^\]]*above[^\]]*draw/);
    expect(result.newSource).toContain("minimum width=");
  });

  it("supports resizeElement rewrites for edge-attached nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \path (0,0) edge node[draw] {A} (2,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const edge = statement.items.find((item) => item.kind === "EdgeOperation");
    if (!edge || edge.kind !== "EdgeOperation" || !edge.nodes?.[0]) throw new Error("Expected edge node");

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: edge.nodes[0].id,
      role: "bottom-right",
      newWorld: wp(60, 40)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("node[draw, minimum width=");
  });

  it("drops non-binding minimum width when shrinking a path-attached node at intrinsic floor", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[->] (-0.2,-0.4) -- node[fill=white, minimum width=16.92pt, pos=0.47] {ok} (2.8,-0.4);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");
    const evaluated = evaluateTikzFigure(parsed.figure, source);
    const bounds = collectSourceWorldBounds(evaluated.scene.elements).get(node.id);
    if (!bounds) throw new Error("Expected node bounds");
    const center = wp((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);

    const shrunk = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: node.id,
      role: "right",
      newWorld: center
    });
    expect(shrunk.kind).toBe("success");
    if (shrunk.kind !== "success") return;
    expect(shrunk.newSource).not.toContain("minimum width=");
  });

  it("writes rotate on path-attached node options without touching host path options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[->] (0,0) -- node[above,draw] {A} (2,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: node.id,
      level: "command",
      key: "rotate",
      value: "15"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toMatch(/node\[[^\]]*rotate=15/);
    expect(result.newSource).not.toMatch(/\\draw\[[^\]]*rotate=/);
  });

  it("preserves the current explicit vertical side when drag jitter stays near-axis", () => {
    const direction = resolveDraggedPathAttachedNodeDirection(
      wp(20, 0),
      wp(10, -0.5),
      { kind: "explicit-direction", direction: "above", family: "cardinal-diagonal" }
    );

    expect(direction).toBe("above");
  });
});

describe("applyEditAction – updateNodeText", () => {
  it("replaces only node text span for node path statement ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {$x+y$};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "updateNodeText",
      elementId: "path:0",
      text: "$x-y$"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected node text update to succeed");
    }
    expect(result.newSource).toBe(String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {$x-y$};
\end{tikzpicture}`);
    expect(result.patches).toHaveLength(1);
  });

  it("replaces the selected repeated path-attached node text when neighboring coordinates use macros", () => {
    const source = String.raw`\begin{tikzpicture}
  \def\r{0.9}
  \draw[<->, thick] (0.02,0) -- node[above, sloped] {$r$} (\r-0.02,0);
  \draw[<->, thick] (\r+0.02,0) -- node[above, sloped] {$r$} (2*\r-0.01,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "updateNodeText",
      elementId: "node:2:3",
      text: "$R$"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected node text update to succeed");
    }
    expect(result.newSource).toBe(String.raw`\begin{tikzpicture}
  \def\r{0.9}
  \draw[<->, thick] (0.02,0) -- node[above, sloped] {$r$} (\r-0.02,0);
  \draw[<->, thick] (\r+0.02,0) -- node[above, sloped] {$R$} (2*\r-0.01,0);
\end{tikzpicture}`);
    expect(result.patches).toHaveLength(1);
  });

  it("updates matrix cell text by synthetic matrix-cell ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "updateNodeText",
      elementId: "node:0:0:matrix-cell:1:2",
      text: "Beta"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix cell text update to succeed");
    }
    expect(result.newSource).toContain("A & Beta");
    expect(result.newSource).toContain("Beta \\\\");
    expect(result.patches).toHaveLength(1);
  });

  it("updates matrix-of-math-nodes cell text by synthetic matrix-cell ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of math nodes] {
    x^2 & y^2 \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "updateNodeText",
      elementId: "node:0:0:matrix-cell:1:2",
      text: "\\frac{1}{y}"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-of-math-nodes text update to succeed");
    }
    expect(result.newSource).toContain("x^2 & \\frac{1}{y}");
    expect(result.patches).toHaveLength(1);
  });

  it("updates tree child text by synthetic tree-child ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {left} child { node {left-left} } };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const left = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left"
    );
    const leftLeft = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left-left"
    );
    if (!left || left.kind !== "Text" || !left.treeChild || !leftLeft || leftLeft.kind !== "Text" || !leftLeft.treeChild) {
      throw new Error("Expected direct and nested tree-child text elements");
    }

    const nestedChildResult = applyEditAction(source, [], {
      kind: "updateNodeText",
      elementId: leftLeft.treeChild.childSourceId,
      text: "left-left*"
    });
    expect(nestedChildResult.kind).toBe("success");
    if (nestedChildResult.kind !== "success") {
      throw new Error("Expected nested tree-child text edit to succeed");
    }
    expect(nestedChildResult.newSource).toContain("node {left-left*}");

    const directChildResult = applyEditAction(source, [], {
      kind: "updateNodeText",
      elementId: left.treeChild.childSourceId,
      text: "left*"
    });
    expect(directChildResult.kind).toBe("success");
    if (directChildResult.kind !== "success") {
      throw new Error("Expected direct tree-child text edit to succeed");
    }
    expect(directChildResult.newSource).toContain("node {left*}");
  });

  it("rejects blank, missing, and no-op node text updates", () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0,0) {A};
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "updateNodeText",
      elementId: "  ",
      text: "B"
    }).kind).toBe("unsupported");
    expect(applyEditAction(source, [], {
      kind: "updateNodeText",
      elementId: "node:missing",
      text: "B"
    }).kind).toBe("unsupported");
    expect(applyEditAction(source, [], {
      kind: "updateNodeText",
      elementId: "path:0",
      text: "A"
    })).toEqual({
      kind: "unsupported",
      reason: "Node text update would not change the source."
    });
  });

  it("adds a child to a selected tree root", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {left} };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addTreeChild",
      parentSourceId: "path:0"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected addTreeChild on root to succeed");
    }
    expect(result.newSource).toContain("child { node {left} }");
    expect(result.newSource).toContain("child { node {New} }");
  });

  it("rejects tree child actions for empty, unresolved, non-tree, and foreach-expanded targets", () => {
    const plainSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    expect(applyEditAction(plainSource, [], {
      kind: "addTreeChild",
      parentSourceId: ""
    }).kind).toBe("unsupported");
    expect(applyEditAction(plainSource, [], {
      kind: "addTreeChild",
      parentSourceId: "path:0"
    }).kind).toBe("unsupported");
    expect(applyEditAction(plainSource, [], {
      kind: "addTreeChild",
      parentSourceId: "missing"
    })).toEqual({
      kind: "unsupported",
      reason: "Could not resolve tree parent missing."
    });
    expect(applyEditAction(plainSource, [], {
      kind: "addTreeChild",
      parentSourceId: TIKZPICTURE_GLOBAL_TARGET_ID
    })).toEqual({
      kind: "unsupported",
      reason: "Tree child insertion requires selecting a tree root or tree child."
    });
    expect(applyEditAction(plainSource, [], {
      kind: "addTreeSibling",
      siblingSourceId: "",
      position: "after"
    }).kind).toBe("unsupported");
    expect(applyEditAction(plainSource, [], {
      kind: "addTreeSibling",
      siblingSourceId: "path:0",
      position: "after"
    })).toEqual({
      kind: "unsupported",
      reason: "Could not resolve tree sibling path:0."
    });
    expect(applyEditAction(plainSource, [], {
      kind: "removeTreeChild",
      childSourceId: ""
    }).kind).toBe("unsupported");
    expect(applyEditAction(plainSource, [], {
      kind: "removeTreeChild",
      childSourceId: "path:0"
    })).toEqual({
      kind: "unsupported",
      reason: "Could not resolve tree child path:0."
    });

    const foreachSource = String.raw`\begin{tikzpicture}
  \path node {root}
    child foreach \x in {A,B} { node {\x} };
\end{tikzpicture}`;
    const parsed = parseTikz(foreachSource, { recover: true });
    const path = parsed.figure.body.find((statement) => statement.kind === "Path");
    if (!path || path.kind !== "Path") {
      throw new Error("Expected path statement");
    }
    const childOperation = path.items.find((item) => item.kind === "ChildOperation");
    if (!childOperation || childOperation.kind !== "ChildOperation") {
      throw new Error("Expected child operation");
    }
    const syntheticChildId = `${path.id}:tree-child:1:${childOperation.id}`;
    expect(applyEditAction(foreachSource, [], {
      kind: "addTreeChild",
      parentSourceId: syntheticChildId
    }).kind).toBe("unsupported");
    expect(applyEditAction(foreachSource, [], {
      kind: "addTreeSibling",
      siblingSourceId: syntheticChildId,
      position: "after"
    }).kind).toBe("unsupported");
    expect(applyEditAction(foreachSource, [], {
      kind: "removeTreeChild",
      childSourceId: syntheticChildId
    }).kind).toBe("unsupported");
  });

  it("inserts root children after explicit child indices with fallback to the last child", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {left} }
    child { node {right} };
\end{tikzpicture}`;

    const afterFirst = applyEditAction(source, [], {
      kind: "addTreeChild",
      parentSourceId: "path:0",
      afterChildIndex: 0
    });
    expect(afterFirst.kind).toBe("success");
    if (afterFirst.kind !== "success") {
      throw new Error("Expected indexed root child insertion");
    }
    expect(afterFirst.newSource).toMatch(/node \{left\}[\s\S]*child \{ node \{New\} \}[\s\S]*node \{right\}/);

    const afterOutOfRange = applyEditAction(source, [], {
      kind: "addTreeChild",
      parentSourceId: "path:0",
      afterChildIndex: 99
    });
    expect(afterOutOfRange.kind).toBe("success");
    if (afterOutOfRange.kind !== "success") {
      throw new Error("Expected fallback root child insertion");
    }
    expect(afterOutOfRange.newSource).toMatch(/node \{right\}[\s\S]*child \{ node \{New\} \}/);
  });

  it("adds the first child to a CRLF tree root before trailing semicolon whitespace", () => {
    const source = "\\begin{tikzpicture}\r\n  \\path node {root}   ;\r\n\\end{tikzpicture}";
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");

    const result = applyEditAction(source, [], {
      kind: "addTreeChild",
      parentSourceId: statement.id
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected addTreeChild on childless root to succeed");
    }
    expect(result.newSource).toContain("\\path node {root}   \r\n    child { node {New} };");
    renderTikzToSvg(result.newSource);
  });

  it("adds children to tree roots nested inside scopes", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \path node {root};
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addTreeChild",
      parentSourceId: "path:1"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected nested root child insertion to succeed");
    }
    expect(result.newSource).toContain("    \\path node {root}\n      child { node {New} };");
  });

  it("adds a child to a semicolonless tree root at the statement tail", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addTreeChild",
      parentSourceId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected semicolonless root child insertion to succeed");
    }
    expect(result.newSource).toContain("node {root}\n\n    child { node {New} }");
  });

  it("adds a nested child when a tree child is selected", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {left} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leftText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left"
    );
    if (!leftText || leftText.kind !== "Text" || !leftText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "addTreeChild",
      parentSourceId: leftText.treeChild.childSourceId
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected addTreeChild on child to succeed");
    }
    expect(result.newSource).toContain("child { node {left}");
    expect(result.newSource).toContain("child { node {New} }");
  });

  it("adds tree siblings before and after a selected child", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {left} }
    child { node {right} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leftText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left"
    );
    if (!leftText || leftText.kind !== "Text" || !leftText.treeChild) {
      throw new Error("Expected left tree child text element");
    }
    const leftId = leftText.treeChild.childSourceId;

    const after = applyEditAction(source, [], {
      kind: "addTreeSibling",
      siblingSourceId: leftId,
      position: "after"
    });
    expect(after.kind).toBe("success");
    if (after.kind !== "success") {
      throw new Error("Expected addTreeSibling(after) to succeed");
    }
    expect(after.newSource).toMatch(/node \{left\}[\s\S]*child \{ node \{New\} \}[\s\S]*node \{right\}/);

    const before = applyEditAction(source, [], {
      kind: "addTreeSibling",
      siblingSourceId: leftId,
      position: "before"
    });
    expect(before.kind).toBe("success");
    if (before.kind !== "success") {
      throw new Error("Expected addTreeSibling(before) to succeed");
    }
    expect(before.newSource).toMatch(/child \{ node \{New\} \}[\s\S]*node \{left\}/);
  });

  it("removes a selected tree child by synthetic id", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {left} }
    child { node {right} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const rightText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "right"
    );
    if (!rightText || rightText.kind !== "Text" || !rightText.treeChild) {
      throw new Error("Expected right tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "removeTreeChild",
      childSourceId: rightText.treeChild.childSourceId
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected removeTreeChild to succeed");
    }
    expect(result.newSource).toContain("child { node {left} }");
    expect(result.newSource).not.toContain("node {right}");
  });

  it("removes a selected CRLF tree child together with surrounding line whitespace", () => {
    const source = "\\begin{tikzpicture}\r\n  \\path node {root}\r\n    child { node {left} }\r\n    child { node {right} };\r\n\\end{tikzpicture}";
    const rendered = renderTikzToSvg(source);
    const leftText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left"
    );
    if (!leftText || leftText.kind !== "Text" || !leftText.treeChild) {
      throw new Error("Expected left tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "removeTreeChild",
      childSourceId: leftText.treeChild.childSourceId
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected CRLF removeTreeChild to succeed");
    }
    expect(result.newSource).not.toContain("node {left}");
    expect(result.newSource).toContain("\r\n    child { node {right} };");
  });

  it("removes a final CRLF tree child with trailing spaces before the semicolon", () => {
    const source = "\\begin{tikzpicture}\r\n  \\path node {root}\r\n    child { node {left} }\r\n    child { node {right} }   ;\r\n\\end{tikzpicture}";
    const rendered = renderTikzToSvg(source);
    const rightText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "right"
    );
    if (!rightText || rightText.kind !== "Text" || !rightText.treeChild) {
      throw new Error("Expected right tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "removeTreeChild",
      childSourceId: rightText.treeChild.childSourceId
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected final CRLF removeTreeChild to succeed");
    }
    expect(result.newSource).not.toContain("node {right}");
    expect(result.newSource).toContain("child { node {left} };");
  });

  it("keeps nested tree structure valid when adding children to deep descendants", () => {
    const source = String.raw`\begin{tikzpicture}
  \path[grow=right,level distance=15mm,sibling distance=10mm]
    node[draw,rounded corners=2pt,fill=blue!10] {Root}
    child { node[draw,fill=green!12] {Leaf A} }
    child {
      node[draw,fill=green!12] {Branch}
      child { node[draw,fill=yellow!16] {Leaf B1} }
      child { node[draw,fill=yellow!16] {Leaf B2} }
    };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leaves = rendered.semantic.scene.elements.filter(
      (entry) => entry.kind === "Text" && (entry.text === "Leaf B1" || entry.text === "Leaf B2")
    );
    expect(leaves).toHaveLength(2);

    for (const leaf of leaves) {
      if (leaf.kind !== "Text" || !leaf.treeChild) {
        throw new Error("Expected tree-child text for deep leaf");
      }
      const result = applyEditAction(source, [], {
        kind: "addTreeChild",
        parentSourceId: leaf.treeChild.childSourceId
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error("Expected addTreeChild on deep descendant to succeed");
      }
      const rerendered = renderTikzToSvg(result.newSource);
      const newTexts = rerendered.semantic.scene.elements.filter(
        (entry) => entry.kind === "Text" && entry.text === "New"
      );
      expect(newTexts.length).toBeGreaterThanOrEqual(1);
      expect(result.newSource).toContain("Leaf B1");
      expect(result.newSource).toContain("Leaf B2");
    }
  });

  it("keeps nested tree structure valid when adding siblings around deep descendants", () => {
    const source = String.raw`\begin{tikzpicture}
  \path[grow=right,level distance=15mm,sibling distance=10mm]
    node[draw,rounded corners=2pt,fill=blue!10] {Root}
    child { node[draw,fill=green!12] {Leaf A} }
    child {
      node[draw,fill=green!12] {Branch}
      child { node[draw,fill=yellow!16] {Leaf B1} }
      child { node[draw,fill=yellow!16] {Leaf B2} }
    };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leafB1 = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "Leaf B1"
    );
    const leafB2 = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "Leaf B2"
    );
    if (!leafB1 || leafB1.kind !== "Text" || !leafB1.treeChild || !leafB2 || leafB2.kind !== "Text" || !leafB2.treeChild) {
      throw new Error("Expected deep tree descendants");
    }

    const afterB1 = applyEditAction(source, [], {
      kind: "addTreeSibling",
      siblingSourceId: leafB1.treeChild.childSourceId,
      position: "after"
    });
    expect(afterB1.kind).toBe("success");
    if (afterB1.kind !== "success") {
      throw new Error("Expected addTreeSibling(after) on Leaf B1 to succeed");
    }
    renderTikzToSvg(afterB1.newSource);
    expect(afterB1.newSource).toContain("Leaf B1");
    expect(afterB1.newSource).toContain("Leaf B2");
    expect(afterB1.newSource).toContain("node {New}");

    const beforeB2 = applyEditAction(source, [], {
      kind: "addTreeSibling",
      siblingSourceId: leafB2.treeChild.childSourceId,
      position: "before"
    });
    expect(beforeB2.kind).toBe("success");
    if (beforeB2.kind !== "success") {
      throw new Error("Expected addTreeSibling(before) on Leaf B2 to succeed");
    }
    renderTikzToSvg(beforeB2.newSource);
    expect(beforeB2.newSource).toContain("Leaf B1");
    expect(beforeB2.newSource).toContain("Leaf B2");
    expect(beforeB2.newSource).toContain("node {New}");
  });
});
