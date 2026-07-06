import { describe, expect, it } from "vitest";
import type { EditHandle } from "../packages/core/src/semantic/types.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { wp } from "./coords-helpers.js";
import { cm, expectPatchesReconstructSource, makeHandle } from "./edit-actions-helpers.js";

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
