import { describe, expect, it } from "vitest";

import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { PT_PER_CM } from "../packages/core/src/edit/format.js";
import {
  analyzeExplicitPathStatement,
  buildPathBodyFromSegments,
  resolveActivePathPointHandle,
  resolveEligibleExplicitPath,
  resolvePathControlHandle
} from "../packages/core/src/edit/path-editing.js";
import type { PathStatement } from "../packages/core/src/ast/types.js";
import type { EditHandle } from "../packages/core/src/semantic/types.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { wp } from "./coords-helpers.js";

const cm = (value: number) => value * PT_PER_CM;

function handleIdFor(source: string, rendered: ReturnType<typeof renderTikzToSvg>, raw: string): string {
  const handle = rendered.semantic.editHandles.find(
    (candidate) => source.slice(candidate.sourceRef.sourceSpan.from, candidate.sourceRef.sourceSpan.to) === raw
  );
  if (!handle) {
    throw new Error(`Handle not found for ${raw}`);
  }
  return handle.id;
}

describe("path edit actions", () => {
  it("rejects malformed explicit paths with precise analysis reasons", () => {
    const cases = [
      {
        body: "\\draw -- (1,0);",
        reason: "Only explicit coordinate"
      },
      {
        body: "\\draw (0,0) -- cycle -- (1,0);",
        reason: "Cycle must be the last"
      },
      {
        body: "\\draw (0,0) -- node[midway]{} (1,0);",
        reason: "inline nodes"
      },
      {
        body: "\\draw (0,0) [red] -- (1,0);",
        reason: "mid-path options"
      },
      {
        body: "\\draw (0,0) (1,0);",
        reason: "coordinates"
      },
      {
        body: "\\draw (0,0) -- --;",
        reason: "Paths using `--`"
      },
      {
        body: "\\draw (0,0) to (1,0);",
        reason: "to-operations"
      },
      {
        body: "\\draw (0,0) edge (1,0);",
        reason: "edge operations"
      },
      {
        body: "\\draw (0,0) child { node {x} };",
        reason: "child operations"
      },
      {
        body: "\\draw (0,0) coordinate (C);",
        reason: "coordinate operations"
      },
      {
        body: "\\draw (0,0) .. (1,0);",
        reason: "cubic segments"
      },
      {
        body: "\\draw (0,0) .. controls -- (1,0);",
        reason: "cubic segments"
      },
      {
        body: "\\draw (0,0) .. controls (1,0) and -- (2,0);",
        reason: "cubic segments"
      },
      {
        body: "\\draw (0,0) .. controls (1,0) (2,0);",
        reason: "cubic segments"
      },
      {
        body: "\\draw (0,0) .. controls (1,0) .. node {} (2,0);",
        reason: "cubic segments"
      },
      {
        body: "\\draw (0,0) .. controls (1,0) .. cycle -- (2,0);",
        reason: "terminal `cycle`"
      },
      {
        body: "\\draw (0,0) .. controls (1,0) .. (2,0) node {};",
        reason: "cubic segments"
      }
    ];

    for (const entry of cases) {
      const source = String.raw`\begin{tikzpicture}
  ${entry.body}
\end{tikzpicture}`;
      const result = resolveEligibleExplicitPath(source, "path:0");
      expect(result).toMatchObject({
        kind: "ineligible",
        reason: expect.stringContaining(entry.reason)
      });
    }
  });

  it("handles sparse synthetic path analyses defensively", () => {
    const emptyStatement = {
      kind: "Path",
      id: "path:synthetic",
      span: { from: 0, to: 0 },
      options: [],
      items: []
    } as unknown as PathStatement;

    expect(analyzeExplicitPathStatement("", emptyStatement)).toEqual({
      kind: "ineligible",
      reason: "Path has no editable items."
    });

    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const eligible = resolveEligibleExplicitPath(source, "path:0");
    expect(eligible.kind).toBe("eligible");
    if (eligible.kind !== "eligible") {
      throw new Error("Expected editable path");
    }

    const body = buildPathBodyFromSegments(eligible.analysis, source, 0, [0, 99]);
    expect(body).toBe("(0,0) -- (1,0)");
  });

  it("reports precise path-point handle resolution failures", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const eligibility = resolveEligibleExplicitPath(source, "path:0");
    expect(eligibility.kind).toBe("eligible");
    if (eligibility.kind !== "eligible") {
      throw new Error("Expected editable path");
    }
    const handle = rendered.semantic.editHandles.find(
      (candidate) => source.slice(candidate.sourceRef.sourceSpan.from, candidate.sourceRef.sourceSpan.to) === "(0,0)"
    );
    expect(handle).toBeDefined();
    if (!handle) {
      throw new Error("Expected endpoint handle");
    }

    expect(resolveActivePathPointHandle(rendered.semantic.editHandles, eligibility.analysis, null, source)).toMatchObject({
      kind: "missing",
      reason: expect.stringContaining("Choose")
    });
    expect(resolveActivePathPointHandle(rendered.semantic.editHandles, eligibility.analysis, "missing", source)).toMatchObject({
      kind: "missing",
      reason: expect.stringContaining("no longer available")
    });
    expect(resolveActivePathPointHandle([{ ...handle, sourceRef: { ...handle.sourceRef, sourceId: "path:1" } }], eligibility.analysis, handle.id, source)).toMatchObject({
      kind: "missing",
      reason: expect.stringContaining("does not belong")
    });
    expect(resolveActivePathPointHandle([{ ...handle, kind: "node-position" } as unknown as typeof handle], eligibility.analysis, handle.id, source)).toMatchObject({
      kind: "missing",
      reason: expect.stringContaining("anchor point")
    });
    expect(resolveActivePathPointHandle([handle, { ...handle, id: "duplicate" }], eligibility.analysis, handle.id, source)).toMatchObject({
      kind: "missing",
      reason: expect.stringContaining("expanded source")
    });
    expect(resolveActivePathPointHandle([{ ...handle, sourceText: "(9,9)" }], eligibility.analysis, handle.id, source)).toMatchObject({
      kind: "missing",
      reason: expect.stringContaining("stale")
    });

    const operatorFrom = source.indexOf("--");
    const operatorHandle = {
      ...handle,
      sourceRef: {
        ...handle.sourceRef,
        sourceSpan: { from: operatorFrom, to: operatorFrom + 2 }
      },
      sourceText: "--"
    };
    expect(resolveActivePathPointHandle([operatorHandle], eligibility.analysis, handle.id, source)).toMatchObject({
      kind: "missing",
      reason: expect.stringContaining("not an editable anchor")
    });
  });

  it("rejects stale and expanded cubic control handles", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const eligibility = resolveEligibleExplicitPath(source, "path:0");
    expect(eligibility.kind).toBe("eligible");
    if (eligibility.kind !== "eligible") {
      throw new Error("Expected editable cubic path");
    }
    const segment = eligibility.analysis.segments[0];
    if (!segment || segment.kind !== "cubic") {
      throw new Error("Expected cubic segment controls");
    }
    const control = eligibility.analysis.statement.items[segment.control1Index];
    if (!control || control.kind !== "Coordinate") {
      throw new Error("Expected first control coordinate");
    }
    const controlHandle = rendered.semantic.editHandles.find(
      (candidate) =>
        candidate.kind === "path-control"
        && candidate.sourceRef.sourceSpan.from === control.span.from
        && candidate.sourceRef.sourceSpan.to === control.span.to
    );
    expect(controlHandle).toBeDefined();
    if (!controlHandle) {
      throw new Error("Expected path-control handle");
    }

    expect(resolvePathControlHandle(rendered.semantic.editHandles, "path:0", control, source)).toBe(controlHandle);
    expect(resolvePathControlHandle([], "path:0", control, source)).toBeNull();
    expect(resolvePathControlHandle([controlHandle, { ...controlHandle, id: "duplicate" }], "path:0", control, source)).toBeNull();
    expect(resolvePathControlHandle([{ ...controlHandle, sourceText: "(9,9)" }], "path:0", control, source)).toBeNull();
    expect(resolvePathControlHandle([{ ...controlHandle, kind: "path-point" } as EditHandle], "path:0", control, source)).toBeNull();
  });

  it("splits an open polyline at an interior point", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "splitPath",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(1,0)")
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
    expect(result.newSource).toContain("\\draw (1,0) -- (2,0);");
  });

  it("rejects splitting endpoint and unresolved handles", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const endpoint = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "splitPath",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(0,0)")
    });
    expect(endpoint.kind).toBe("unsupported");
    if (endpoint.kind === "unsupported") {
      expect(endpoint.reason).toContain("interior");
    }

    const missing = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "splitPath",
      elementId: "path:0",
      handleId: "missing-handle"
    });
    expect(missing.kind).toBe("unsupported");

    const staleSource = source.replace("(1,0)", "(9,0)");
    const stale = applyEditAction(staleSource, rendered.semantic.editHandles, {
      kind: "splitPath",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(1,0)")
    });
    expect(stale.kind).toBe("unsupported");
    if (stale.kind === "unsupported") {
      expect(stale.reason).toContain("stale");
    }

    const missingPath = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "splitPath",
      elementId: "path:missing",
      handleId: handleIdFor(source, rendered, "(1,0)")
    });
    expect(missingPath.kind).toBe("unsupported");
  });

  it("splits a cycle-closed polygon into one open path", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (1,1) -- cycle;
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "splitPath",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(1,0)")
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (1,0) -- (1,1) -- (0,0);");
    expect(result.newSource).not.toContain("cycle");
  });

  it("rejects splitting a curve-cycle path when the opened body cannot be ordered safely", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1) .. controls (2,-1) and (1,-1) .. cycle;
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "splitPath",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(3,1)")
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("opened");
    }
  });

  it("joins two open paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,0) -- (3,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "joinPaths",
      elementIds: ["path:0", "path:1"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) -- (1,0) -- (2,0) -- (3,0);");
    expect(result.newSource.match(/\\draw/g)?.length).toBe(1);
  });

  it("rejects invalid join selections, cross-scope paths, and closed paths", () => {
    const simple = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const duplicate = applyEditAction(simple, [], {
      kind: "joinPaths",
      elementIds: ["path:0", "path:0"]
    });
    expect(duplicate.kind).toBe("unsupported");
    if (duplicate.kind === "unsupported") {
      expect(duplicate.reason).toContain("exactly two");
    }

    const crossScope = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \begin{scope}
    \draw (2,0) -- (3,0);
  \end{scope}
\end{tikzpicture}`;
    const scoped = applyEditAction(crossScope, [], {
      kind: "joinPaths",
      elementIds: ["path:0", "path:1"]
    });
    expect(scoped.kind).toBe("unsupported");
    if (scoped.kind === "unsupported") {
      expect(scoped.reason).toContain("same scope");
    }

    const closed = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,0) -- (3,0) -- cycle;
\end{tikzpicture}`;
    const closedResult = applyEditAction(closed, [], {
      kind: "joinPaths",
      elementIds: ["path:0", "path:1"]
    });
    expect(closedResult.kind).toBe("unsupported");
    if (closedResult.kind === "unsupported") {
      expect(closedResult.reason).toContain("open explicit paths");
    }

    const ineligible = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
  \draw (2,0) -- (3,0);
\end{tikzpicture}`;
    const ineligibleResult = applyEditAction(ineligible, [], {
      kind: "joinPaths",
      elementIds: ["path:0", "path:1"]
    });
    expect(ineligibleResult.kind).toBe("unsupported");
    if (ineligibleResult.kind === "unsupported") {
      expect(ineligibleResult.reason).toContain("rectangle");
    }

    const secondIneligible = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,0) rectangle (3,1);
\end{tikzpicture}`;
    const secondIneligibleResult = applyEditAction(secondIneligible, [], {
      kind: "joinPaths",
      elementIds: ["path:0", "path:1"]
    });
    expect(secondIneligibleResult.kind).toBe("unsupported");
    if (secondIneligibleResult.kind === "unsupported") {
      expect(secondIneligibleResult.reason).toContain("rectangle");
    }
  });

  it("reverses an open polyline", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "reversePath",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (2,0) -- (1,0) -- (0,0);");
  });

  it("reverses cubic segments by swapping controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1) .. controls (4,1) and (5,0) .. (6,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "reversePath",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(
      "\\draw (6,0) .. controls (5,0) and (4,1) .. (3,1) .. controls (2,1) and (1,0) .. (0,0);"
    );
  });

  it("reverses shorthand cubic controls and closed cubic cycles", () => {
    const shorthand = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,1) .. (2,0);
\end{tikzpicture}`;
    const shorthandResult = applyEditAction(shorthand, [], {
      kind: "reversePath",
      elementId: "path:0"
    });

    expect(shorthandResult.kind).toBe("success");
    if (shorthandResult.kind !== "success") return;
    expect(shorthandResult.newSource).toContain("\\draw (2,0) .. controls (1,1) .. (0,0);");

    const closedCubic = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1) .. controls (2,-1) and (1,-1) .. cycle;
\end{tikzpicture}`;
    const closedResult = applyEditAction(closedCubic, [], {
      kind: "reversePath",
      elementId: "path:0"
    });

    expect(closedResult.kind).toBe("success");
    if (closedResult.kind !== "success") return;
    expect(closedResult.newSource).toContain(".. controls (1,-1) and (2,-1) .. (3,1)");
    expect(closedResult.newSource).toContain(".. cycle;");
  });

  it("reverses a closed polygon while preserving cycle closure", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (1,1) -- cycle;
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "reversePath",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) -- (1,1) -- (1,0) -- cycle;");
  });

  it("closes and reopens an explicit polyline", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (1,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const closed = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "toggleClosedPath",
      elementId: "path:0",
      closed: true
    });

    expect(closed.kind).toBe("success");
    if (closed.kind !== "success") return;
    expect(closed.newSource).toContain("-- cycle;");

    const reopenedRender = renderTikzToSvg(closed.newSource);
    const reopened = applyEditAction(closed.newSource, reopenedRender.semantic.editHandles, {
      kind: "toggleClosedPath",
      elementId: "path:0",
      closed: false
    });

    expect(reopened.kind).toBe("success");
    if (reopened.kind !== "success") return;
    expect(reopened.newSource).not.toContain("cycle");
    expect(reopened.newSource).toContain("\\draw (0,0) -- (1,0) -- (1,1);");
  });

  it("rejects no-op close/open requests", () => {
    const open = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const alreadyOpen = applyEditAction(open, [], {
      kind: "toggleClosedPath",
      elementId: "path:0",
      closed: false
    });
    expect(alreadyOpen.kind).toBe("unsupported");
    if (alreadyOpen.kind === "unsupported") {
      expect(alreadyOpen.reason).toContain("already open");
    }

    const closed = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- cycle;
\end{tikzpicture}`;
    const alreadyClosed = applyEditAction(closed, [], {
      kind: "toggleClosedPath",
      elementId: "path:0",
      closed: true
    });
    expect(alreadyClosed.kind).toBe("unsupported");
    if (alreadyClosed.kind === "unsupported") {
      expect(alreadyClosed.reason).toContain("already closed");
    }
  });

  it("rejects reversing or toggling unresolved and degenerate paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0);
\end{tikzpicture}`;

    const missingReverse = applyEditAction(source, [], {
      kind: "reversePath",
      elementId: "path:missing"
    });
    expect(missingReverse.kind).toBe("unsupported");

    const degenerateReverse = applyEditAction(source, [], {
      kind: "reversePath",
      elementId: "path:0"
    });
    expect(degenerateReverse.kind).toBe("unsupported");

    const missingToggle = applyEditAction(source, [], {
      kind: "toggleClosedPath",
      elementId: "path:missing",
      closed: true
    });
    expect(missingToggle.kind).toBe("unsupported");
  });

  it("opens a curve-cycle path by dropping the closing cubic cycle segment", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1) .. controls (2,-1) and (1,-1) .. cycle;
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "toggleClosedPath",
      elementId: "path:0",
      closed: false
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) .. controls (1,0) and (2,1) .. (3,1);");
    expect(result.newSource).not.toContain("cycle");
  });

  it("deletes an interior point from a polyline", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "deletePathPoint",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(1,0)")
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) -- (2,0);");
  });

  it("deletes an interior point between cubic segments", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1) .. controls (4,1) and (5,0) .. (6,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "deletePathPoint",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(3,1)")
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) .. controls (1,0) and (5,0) .. (6,0);");
  });

  it("deletes a point from a closed polygon while preserving the cycle", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (1,1) -- cycle;
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "deletePathPoint",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(1,0)")
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) -- (1,1) -- cycle;");
  });

  it("deletes the start point from a closed polygon by rotating the path start", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (1,1) -- cycle;
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "deletePathPoint",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(0,0)")
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (1,0) -- (1,1) -- cycle;");
  });

  it("deletes a point from a closed cubic path", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1) .. controls (4,1) and (5,0) .. (6,0) .. controls (5,-1) and (1,-1) .. cycle;
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "deletePathPoint",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(3,1)")
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(
      "\\draw (0,0) .. controls (1,0) and (5,0) .. (6,0) .. controls (5,-1) and (1,-1) .. cycle;"
    );
  });

  it("rejects deleting endpoints, tiny closed paths, and mixed line-cubic anchors", () => {
    const open = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const openRendered = renderTikzToSvg(open);
    const endpoint = applyEditAction(open, openRendered.semantic.editHandles, {
      kind: "deletePathPoint",
      elementId: "path:0",
      handleId: handleIdFor(open, openRendered, "(0,0)")
    });
    expect(endpoint.kind).toBe("unsupported");
    if (endpoint.kind === "unsupported") {
      expect(endpoint.reason).toContain("interior");
    }

    const tinyClosed = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- cycle;
\end{tikzpicture}`;
    const tinyRendered = renderTikzToSvg(tinyClosed);
    const tooFew = applyEditAction(tinyClosed, tinyRendered.semantic.editHandles, {
      kind: "deletePathPoint",
      elementId: "path:0",
      handleId: handleIdFor(tinyClosed, tinyRendered, "(0,0)")
    });
    expect(tooFew.kind).toBe("unsupported");
    if (tooFew.kind === "unsupported") {
      expect(tooFew.reason).toContain("too few");
    }

    const mixed = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) .. controls (1,1) and (2,1) .. (2,0);
\end{tikzpicture}`;
    const mixedRendered = renderTikzToSvg(mixed);
    const unsupportedConversion = applyEditAction(mixed, mixedRendered.semantic.editHandles, {
      kind: "deletePathPoint",
      elementId: "path:0",
      handleId: handleIdFor(mixed, mixedRendered, "(1,0)")
    });
    expect(unsupportedConversion.kind).toBe("unsupported");
    if (unsupportedConversion.kind === "unsupported") {
      expect(unsupportedConversion.reason).toContain("unsupported segment conversion");
    }

    const missingHandle = applyEditAction(open, openRendered.semantic.editHandles, {
      kind: "deletePathPoint",
      elementId: "path:0",
      handleId: "missing-handle"
    });
    expect(missingHandle.kind).toBe("unsupported");
  });

  it("converts a cubic anchor to corner", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1) .. controls (4,1) and (5,0) .. (6,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "setPathPointKind",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(3,1)"),
      pointKind: "corner"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("and (2,1) .. (3,1) .. controls (4,1)");
  });

  it("converts a cubic anchor to smooth", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,2) and (2,2) .. (3,1) .. controls (4,2) and (5,0) .. (6,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "setPathPointKind",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(3,1)"),
      pointKind: "smooth"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("and (2,2) .. (3,1) .. controls (4,2)");
  });

  it("converts an interior polyline point to smooth cubic segments", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (-2.33,0) -- (-2.72,1.74) -- (-0.86,2.27);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "setPathPointKind",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(-2.72,1.74)"),
      pointKind: "smooth"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(".. controls");
    expect(result.newSource).not.toContain(" -- (-2.72,1.74) -- ");
  });

  it("rejects smoothing a line corner whose neighboring anchors collapse the tangent", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (0,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "setPathPointKind",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(1,0)"),
      pointKind: "smooth"
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("Bezier bend");
    }
  });

  it("keeps already aligned cubic controls editable as a smooth point", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,0) .. (3,0) .. controls (4,0) and (5,0) .. (6,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "setPathPointKind",
      elementId: "path:0",
      handleId: handleIdFor(source, rendered, "(3,0)"),
      pointKind: "smooth"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(".. controls");
  });

  it("rejects converting endpoints and line-cubic mixed anchors to corner", () => {
    const endpointSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const endpointRender = renderTikzToSvg(endpointSource);
    const endpoint = applyEditAction(endpointSource, endpointRender.semantic.editHandles, {
      kind: "setPathPointKind",
      elementId: "path:0",
      handleId: handleIdFor(endpointSource, endpointRender, "(0,0)"),
      pointKind: "smooth"
    });
    expect(endpoint.kind).toBe("unsupported");
    if (endpoint.kind === "unsupported") {
      expect(endpoint.reason).toContain("interior");
    }

    const mixedSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) .. controls (1,1) and (2,1) .. (2,0);
\end{tikzpicture}`;
    const mixedRender = renderTikzToSvg(mixedSource);
    const mixed = applyEditAction(mixedSource, mixedRender.semantic.editHandles, {
      kind: "setPathPointKind",
      elementId: "path:0",
      handleId: handleIdFor(mixedSource, mixedRender, "(1,0)"),
      pointKind: "corner"
    });
    expect(mixed.kind).toBe("unsupported");
    if (mixed.kind === "unsupported") {
      expect(mixed.reason).toContain("cubic");
    }

    const missingHandle = applyEditAction(mixedSource, mixedRender.semantic.editHandles, {
      kind: "setPathPointKind",
      elementId: "path:0",
      handleId: "missing-handle",
      pointKind: "smooth"
    });
    expect(missingHandle.kind).toBe("unsupported");
  });

  it("rejects point-kind rewrites when neighboring anchor or control handles are unavailable", () => {
    const lineSource = String.raw`\begin{tikzpicture}
  \draw (-2.33,0) -- (-2.72,1.74) -- (-0.86,2.27);
\end{tikzpicture}`;
    const lineRender = renderTikzToSvg(lineSource);
    const lineMiddleHandleId = handleIdFor(lineSource, lineRender, "(-2.72,1.74)");
    const missingNeighbor = applyEditAction(
      lineSource,
      lineRender.semantic.editHandles.filter((handle) => handle.id === lineMiddleHandleId),
      {
        kind: "setPathPointKind",
        elementId: "path:0",
        handleId: lineMiddleHandleId,
        pointKind: "smooth"
      }
    );
    expect(missingNeighbor.kind).toBe("unsupported");
    if (missingNeighbor.kind === "unsupported") {
      expect(missingNeighbor.reason).toContain("Neighboring anchors");
    }

    const cubicSource = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1) .. controls (4,1) and (5,0) .. (6,0);
\end{tikzpicture}`;
    const cubicRender = renderTikzToSvg(cubicSource);
    const missingControls = applyEditAction(
      cubicSource,
      cubicRender.semantic.editHandles.filter((handle) => handle.kind !== "path-control"),
      {
        kind: "setPathPointKind",
        elementId: "path:0",
        handleId: handleIdFor(cubicSource, cubicRender, "(3,1)"),
        pointKind: "corner"
      }
    );
    expect(missingControls.kind).toBe("unsupported");
    if (missingControls.kind === "unsupported") {
      expect(missingControls.reason).toContain("could not be resolved");
    }
  });

  it("appends segments to the end of an open path", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, renderTikzToSvg(source).semantic.editHandles, {
      kind: "appendToPath",
      elementId: "path:0",
      end: "end",
      start: wp(2 * PT_PER_CM, 0),
      segments: [{ kind: "line", to: wp(3 * PT_PER_CM, 0) }, { kind: "line", to: wp(4 * PT_PER_CM, 0) }]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) -- (1,0) -- (2,0) -- (3,0) -- (4,0);");
  });

  it("prepends segments to the start of an open path", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    // Drawn from the path's start outwards: (0,0) to (-1,0) to (-2,0).
    const result = applyEditAction(source, renderTikzToSvg(source).semantic.editHandles, {
      kind: "appendToPath",
      elementId: "path:0",
      end: "start",
      start: wp(0, 0),
      segments: [{ kind: "line", to: wp(-1 * PT_PER_CM, 0) }, { kind: "line", to: wp(-2 * PT_PER_CM, 0) }]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (-2,0) -- (-1,0) -- (0,0) -- (1,0) -- (2,0);");
  });

  it("rejects appending to a closed path", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (1,1) -- cycle;
\end{tikzpicture}`;
    const handles = renderTikzToSvg(source).semantic.editHandles;
    const result = applyEditAction(source, handles, {
      kind: "appendToPath",
      elementId: "path:0",
      end: "end",
      start: wp(0, 0),
      segments: [{ kind: "line", to: wp(2 * PT_PER_CM, 0) }]
    });

    expect(result.kind).toBe("unsupported");

    const missing = applyEditAction(source, handles, {
      kind: "appendToPath",
      elementId: "path:missing",
      end: "end",
      start: wp(0, 0),
      segments: [{ kind: "line", to: wp(2 * PT_PER_CM, 0) }]
    });
    expect(missing.kind).toBe("unsupported");
  });

  it("inserts a point into a line segment at the closest point", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "insertPathPoint",
      elementId: "path:0",
      segmentIndex: 0,
      point: wp(cm(0.75), cm(1))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) -- (0.75,0) -- (2,0);");
  });

  it("inserts a point into a cubic segment by subdividing controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "insertPathPoint",
      elementId: "path:0",
      segmentIndex: 0,
      point: wp(cm(1.5), cm(0.5))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(".. controls");
    expect(result.newSource.match(/\.\. controls/g)?.length).toBe(2);
    expect(result.newSource).toContain(".. (3,1);");
  });

  it("inserts a point into a shorthand cubic segment", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,1) .. (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "insertPathPoint",
      elementId: "path:0",
      segmentIndex: 0,
      point: wp(cm(1), cm(0.5))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource.match(/\.\. controls/g)?.length).toBe(2);
    expect(result.newSource).toContain(".. (2,0);");
  });

  it("inserts a point into a closed path while preserving the closing segment", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) -- (2,2) -- cycle;
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "insertPathPoint",
      elementId: "path:0",
      segmentIndex: 0,
      point: wp(cm(1), cm(1))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) -- (1,0) -- (2,0) -- (2,2) -- cycle;");
  });

  it("inserts a point into the closing segment of a cycle", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) -- (2,2) -- cycle;
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "insertPathPoint",
      elementId: "path:0",
      segmentIndex: 2,
      point: wp(cm(0.75), cm(0.75))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("-- cycle;");
    expect(result.newSource.match(/--/g)?.length).toBe(4);
  });

  it("rejects point insertion with invalid segment indices or missing handles", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const invalidSegment = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "insertPathPoint",
      elementId: "path:0",
      segmentIndex: 10,
      point: wp(cm(1), 0)
    });
    expect(invalidSegment.kind).toBe("unsupported");
    if (invalidSegment.kind === "unsupported") {
      expect(invalidSegment.reason).toContain("Invalid segment");
    }

    const missingHandles = applyEditAction(source, [], {
      kind: "insertPathPoint",
      elementId: "path:0",
      segmentIndex: 0,
      point: wp(cm(1), 0)
    });
    expect(missingHandles.kind).toBe("unsupported");
    if (missingHandles.kind === "unsupported") {
      expect(missingHandles.reason).toContain("endpoint positions");
    }

    const staleSource = source.replace("(2,0)", "(3,0)");
    const staleHandles = applyEditAction(staleSource, rendered.semantic.editHandles, {
      kind: "insertPathPoint",
      elementId: "path:0",
      segmentIndex: 0,
      point: wp(cm(1), 0)
    });
    expect(staleHandles.kind).toBe("unsupported");
    if (staleHandles.kind === "unsupported") {
      expect(staleHandles.reason).toContain("endpoint positions");
    }

    const missingPath = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "insertPathPoint",
      elementId: "path:missing",
      segmentIndex: 0,
      point: wp(cm(1), 0)
    });
    expect(missingPath.kind).toBe("unsupported");
  });

  it("rejects cubic insertion when control handles are unavailable", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(
      source,
      rendered.semantic.editHandles.filter((handle) => handle.kind !== "path-control"),
      {
        kind: "insertPathPoint",
        elementId: "path:0",
        segmentIndex: 0,
        point: wp(cm(1.5), cm(0.5))
      }
    );

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("control point positions");
    }
  });

  it("rejects cubic insertion when control handles are stale", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) .. controls (1,0) and (2,1) .. (3,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(
      source,
      rendered.semantic.editHandles.map((handle) =>
        handle.kind === "path-control" ? { ...handle, sourceText: "(stale)" } : handle
      ),
      {
        kind: "insertPathPoint",
        elementId: "path:0",
        segmentIndex: 0,
        point: wp(cm(1.5), cm(0.5))
      }
    );

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("control point positions");
    }
  });

  it("rejects shorthand shapes for topology edits", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "toggleClosedPath",
      elementId: "path:0",
      closed: false
    });

    expect(result).toEqual({
      kind: "unsupported",
      reason: expect.stringContaining("rectangle")
    });
  });
});
