import { describe, expect, it } from "vitest";
import {
  applyPlannedSetPropertyAction,
  cleanupIdiomaticPropertyWrites,
  planPropertyWrite,
  PROPERTY_WRITE_CLEANUP_NOOP_REASON
} from "../packages/core/src/edit/property-write-planner.js";
import {
  buildArrowTipSetPropertyMutation,
  buildNodeInnerSepSetPropertyMutation,
  buildNodeMinimumDimensionSetPropertyMutations,
  buildNodeShapeSetPropertyMutation,
  buildPathMorphingDecorationSetPropertyMutations
} from "../packages/core/src/edit/property-write-builders.js";
import { parseTikz } from "../packages/core/src/parser/index.js";

function expectSuccessSource(
  result: ReturnType<typeof applyPlannedSetPropertyAction>,
  expectedSource: string
): void {
  expect(result.kind).toBe("success");
  if (result.kind !== "success") {
    return;
  }
  expect(result.newSource).toBe(expectedSource);
}

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

function resolveFirstNodeId(source: string): string {
  const parsed = parseTikz(source);
  for (const statement of parsed.figure.body) {
    if (statement.kind !== "Path") {
      continue;
    }
    const node = statement.items.find((item) => item.kind === "Node");
    if (node && node.kind === "Node") {
      return node.id;
    }
  }
  throw new Error("Expected at least one node item");
}

describe("property write planner", () => {
  it("keeps unsupported conservative writes as the selected result", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const plan = planPropertyWrite({
      source,
      action: {
        elementId: "missing",
        key: "draw",
        value: "red"
      }
    });

    expect(plan.conservative).toEqual(plan.selected);
    expect(plan.selected).toMatchObject({ kind: "unsupported" });
    expect(plan.certificates).toEqual([]);
  });

  it("uses conservative writes for preview, drag-frame, and comment interactions", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue] (0,0) -- (1,0);
\end{tikzpicture}`;

    const preview = planPropertyWrite({
      source,
      mode: "preview",
      action: {
        elementId: "path:0",
        key: "draw",
        value: "none"
      }
    });
    expect(preview.selected).toEqual(preview.conservative);
    expect(preview.certificates).toEqual([]);

    const dragFrame = planPropertyWrite({
      source,
      parseOptions: { propertyWriteMode: "drag-frame" },
      action: {
        elementId: "path:0",
        key: "draw",
        value: "none"
      }
    });
    expect(dragFrame.selected).toEqual(dragFrame.conservative);

    const comment = planPropertyWrite({
      source,
      action: {
        elementId: "path:0",
        key: "draw",
        value: "blue",
        commentMode: "disable",
        commentSourceText: "blue"
      }
    });
    expect(comment.selected).toEqual(comment.conservative);
  });

  it("returns the conservative result when no cleanup candidate applies", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const plan = planPropertyWrite({
      source,
      action: {
        elementId: "path:0",
        key: "line width",
        value: "2pt"
      }
    });

    expect(plan.selected).toEqual(plan.conservative);
    expect(plan.certificates).toEqual([]);
  });

  it("cleans no-options paint commands and reports explicit changed ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyPlannedSetPropertyAction(source, {
      elementId: "path:0",
      key: "draw",
      value: "none"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\path (0,0) -- (1,0);");
    expect(result.changedSourceIds).toEqual(["path:0"]);
  });

  it("omits explicit no-arrow defaults when omission is render-equivalent", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[red, thick, ->] (0,0) -- (1,0);
\end{tikzpicture}`;
    const mutation = buildArrowTipSetPropertyMutation(
      { startRaw: "", endRaw: ">", clearKeys: ["arrows", "-", "->", "<-", "<->"] },
      "end",
      "none"
    );

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: "path:0",
        ...mutation
      }),
      String.raw`\begin{tikzpicture}
  \draw[red, thick] (0,0) -- (1,0);
\end{tikzpicture}`
    );
  });

  it("keeps explicit no-arrow overrides when inherited arrows would reappear", () => {
    const source = String.raw`\begin{tikzpicture}[->]
  \draw[->] (0,0) -- (1,0);
\end{tikzpicture}`;
    const mutation = buildArrowTipSetPropertyMutation(
      { startRaw: "", endRaw: ">", clearKeys: ["arrows", "-", "->", "<-", "<->"] },
      "end",
      "none"
    );

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: "path:0",
        ...mutation
      }),
      String.raw`\begin{tikzpicture}[->]
  \draw[-] (0,0) -- (1,0);
\end{tikzpicture}`
    );
  });

  it("does not omit arrow options when only one side returns to default", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[<->] (0,0) -- (1,0);
\end{tikzpicture}`;
    const mutation = buildArrowTipSetPropertyMutation(
      { startRaw: "<", endRaw: ">", clearKeys: ["arrows", "-", "->", "<-", "<->"] },
      "start",
      "none"
    );

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: "path:0",
        ...mutation
      }),
      String.raw`\begin{tikzpicture}
  \draw[->] (0,0) -- (1,0);
\end{tikzpicture}`
    );
  });

  it("omits explicit default stroke colors when omission is render-equivalent", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[red] (0,0) -- (1,0);
\end{tikzpicture}`;

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: "path:0",
        key: "draw",
        value: "black",
        clearKeys: ["red"]
      }),
      String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`
    );
  });

  it("keeps explicit default stroke colors when inherited stroke color would reappear", () => {
    const source = String.raw`\begin{tikzpicture}[draw=blue]
  \draw[red] (0,0) -- (1,0);
\end{tikzpicture}`;

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: "path:0",
        key: "draw",
        value: "black",
        clearKeys: ["red"]
      }),
      String.raw`\begin{tikzpicture}[draw=blue]
  \draw[black] (0,0) -- (1,0);
\end{tikzpicture}`
    );
  });

  it("omits explicit disabled fills when omission is render-equivalent", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=red] (0,0) rectangle (1,1);
\end{tikzpicture}`;

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: "path:0",
        key: "fill",
        value: "none",
        clearKeys: ["red"]
      }),
      String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
\end{tikzpicture}`
    );
  });

  it("keeps explicit disabled fills when command-default fill would reappear", () => {
    const source = String.raw`\begin{tikzpicture}
  \filldraw[fill=red] (0,0) rectangle (1,1);
\end{tikzpicture}`;

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: "path:0",
        key: "fill",
        value: "none",
        clearKeys: ["red"]
      }),
      String.raw`\begin{tikzpicture}
  \filldraw[fill=none] (0,0) rectangle (1,1);
\end{tikzpicture}`
    );
  });

  it("omits explicit default grid steps when omission is render-equivalent", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) grid[step=2cm] (3,3);
\end{tikzpicture}`;

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: resolveFirstGridKeywordId(source),
        key: "step",
        value: "1cm",
        clearKeys: ["xstep", "x step", "ystep", "y step"]
      }),
      String.raw`\begin{tikzpicture}
  \draw (0,0) grid (3,3);
\end{tikzpicture}`
    );
  });

  it("keeps explicit default grid steps when inherited grid step would reappear", () => {
    const source = String.raw`\begin{tikzpicture}[step=0.5cm]
  \draw (0,0) grid[step=2cm] (3,3);
\end{tikzpicture}`;

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: resolveFirstGridKeywordId(source),
        key: "step",
        value: "1cm",
        clearKeys: ["xstep", "x step", "ystep", "y step"]
      }),
      String.raw`\begin{tikzpicture}[step=0.5cm]
  \draw (0,0) grid[step=1cm] (3,3);
\end{tikzpicture}`
    );
  });

  it("omits explicit default grid x steps when omission is render-equivalent", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) grid[xstep=2cm] (3,3);
\end{tikzpicture}`;

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: resolveFirstGridKeywordId(source),
        key: "xstep",
        value: "1cm",
        clearKeys: ["x step"]
      }),
      String.raw`\begin{tikzpicture}
  \draw (0,0) grid (3,3);
\end{tikzpicture}`
    );
  });

  it("keeps explicit default grid x steps when inherited x step would reappear", () => {
    const source = String.raw`\begin{tikzpicture}[xstep=0.5cm]
  \draw (0,0) grid[xstep=2cm] (3,3);
\end{tikzpicture}`;

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: resolveFirstGridKeywordId(source),
        key: "xstep",
        value: "1cm",
        clearKeys: ["x step"]
      }),
      String.raw`\begin{tikzpicture}[xstep=0.5cm]
  \draw (0,0) grid[xstep=1cm] (3,3);
\end{tikzpicture}`
    );
  });

  it("omits explicit default grid y steps when omission is render-equivalent", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) grid[ystep=2cm] (3,3);
\end{tikzpicture}`;

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: resolveFirstGridKeywordId(source),
        key: "ystep",
        value: "1cm",
        clearKeys: ["y step"]
      }),
      String.raw`\begin{tikzpicture}
  \draw (0,0) grid (3,3);
\end{tikzpicture}`
    );
  });

  it("keeps explicit default grid y steps when inherited y step would reappear", () => {
    const source = String.raw`\begin{tikzpicture}[ystep=0.5cm]
  \draw (0,0) grid[ystep=2cm] (3,3);
\end{tikzpicture}`;

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: resolveFirstGridKeywordId(source),
        key: "ystep",
        value: "1cm",
        clearKeys: ["y step"]
      }),
      String.raw`\begin{tikzpicture}[ystep=0.5cm]
  \draw (0,0) grid[ystep=1cm] (3,3);
\end{tikzpicture}`
    );
  });

  it("omits explicit default node shapes when omission is render-equivalent", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,circle] at (0,0) {A};
\end{tikzpicture}`;
    const mutation = buildNodeShapeSetPropertyMutation("rectangle");

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: resolveFirstNodeId(source),
        ...mutation
      }),
      String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`
    );
  });

  it("keeps explicit default node shapes when inherited shape would reappear", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={circle}]
  \node[draw,circle] at (0,0) {A};
\end{tikzpicture}`;
    const mutation = buildNodeShapeSetPropertyMutation("rectangle");

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: resolveFirstNodeId(source),
        ...mutation
      }),
      String.raw`\begin{tikzpicture}[every node/.style={circle}]
  \node[draw, shape=rectangle] at (0,0) {A};
\end{tikzpicture}`
    );
  });

  it("omits explicit default node inner sep when omission is render-equivalent", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw, inner sep=10pt] at (0,0) {A};
\end{tikzpicture}`;
    const mutation = buildNodeInnerSepSetPropertyMutation(3.333);

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: resolveFirstNodeId(source),
        ...mutation
      }),
      String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`
    );
  });

  it("keeps explicit default node inner sep when inherited inner sep would reappear", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={inner sep=10pt}]
  \node[draw, inner sep=6pt] at (0,0) {A};
\end{tikzpicture}`;
    const mutation = buildNodeInnerSepSetPropertyMutation(3.333);

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: resolveFirstNodeId(source),
        ...mutation
      }),
      String.raw`\begin{tikzpicture}[every node/.style={inner sep=10pt}]
  \node[draw, inner sep=.3333em] at (0,0) {A};
\end{tikzpicture}`
    );
  });

  it("omits explicit default node minimum widths when omission is render-equivalent", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw, minimum width=20pt] at (0,0) {A};
\end{tikzpicture}`;
    const [mutation] = buildNodeMinimumDimensionSetPropertyMutations(
      { minimumWidth: 20, minimumHeight: 1 },
      "minimum width",
      1
    );

    expect(mutation).toBeDefined();
    if (!mutation) {
      return;
    }

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: resolveFirstNodeId(source),
        ...mutation
      }),
      String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`
    );
  });

  it("keeps explicit default node minimum widths when inherited width would reappear", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={minimum width=40pt}]
  \node[draw, minimum width=20pt] at (0,0) {A};
\end{tikzpicture}`;
    const [mutation] = buildNodeMinimumDimensionSetPropertyMutations(
      { minimumWidth: 20, minimumHeight: 1 },
      "minimum width",
      1
    );

    expect(mutation).toBeDefined();
    if (!mutation) {
      return;
    }

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: resolveFirstNodeId(source),
        ...mutation
      }),
      String.raw`\begin{tikzpicture}[every node/.style={minimum width=40pt}]
  \node[draw, minimum width=1pt] at (0,0) {A};
\end{tikzpicture}`
    );
  });

  it("omits explicit default node minimum heights when omission is render-equivalent", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw, minimum height=20pt] at (0,0) {A};
\end{tikzpicture}`;
    const [mutation] = buildNodeMinimumDimensionSetPropertyMutations(
      { minimumWidth: 1, minimumHeight: 20 },
      "minimum height",
      1
    );

    expect(mutation).toBeDefined();
    if (!mutation) {
      return;
    }

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: resolveFirstNodeId(source),
        ...mutation
      }),
      String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`
    );
  });

  it("keeps explicit default node minimum heights when inherited height would reappear", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={minimum height=40pt}]
  \node[draw, minimum height=20pt] at (0,0) {A};
\end{tikzpicture}`;
    const [mutation] = buildNodeMinimumDimensionSetPropertyMutations(
      { minimumWidth: 1, minimumHeight: 20 },
      "minimum height",
      1
    );

    expect(mutation).toBeDefined();
    if (!mutation) {
      return;
    }

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: resolveFirstNodeId(source),
        ...mutation
      }),
      String.raw`\begin{tikzpicture}[every node/.style={minimum height=40pt}]
  \node[draw, minimum height=1pt] at (0,0) {A};
\end{tikzpicture}`
    );
  });

  it("omits explicit disabled decorations when omission is render-equivalent", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[red, thick, decorate, decoration=snake] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [mutation] = buildPathMorphingDecorationSetPropertyMutations("none");

    expect(mutation).toBeDefined();
    if (!mutation) {
      return;
    }

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: "path:0",
        ...mutation
      }),
      String.raw`\begin{tikzpicture}
  \draw[red, thick] (0,0) -- (1,0);
\end{tikzpicture}`
    );
  });

  it("keeps explicit disabled decorations when inherited decorations would reappear", () => {
    const source = String.raw`\begin{tikzpicture}[decorate, decoration=snake]
  \draw[decorate, decoration=coil] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [mutation] = buildPathMorphingDecorationSetPropertyMutations("none");

    expect(mutation).toBeDefined();
    if (!mutation) {
      return;
    }

    expectSuccessSource(
      applyPlannedSetPropertyAction(source, {
        elementId: "path:0",
        ...mutation
      }),
      String.raw`\begin{tikzpicture}[decorate, decoration=snake]
  \draw[decorate=false] (0,0) -- (1,0);
\end{tikzpicture}`
    );
  });

  it("exercises disabled draw/fill cleanup rewrites for each paint command target", () => {
    const invisibleDraw = cleanupIdiomaticPropertyWrites(String.raw`\begin{tikzpicture}
  \draw[draw=false, fill=false] (0,0) rectangle (1,1);
\end{tikzpicture}`);
    expect(invisibleDraw).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });

    const fillOnly = cleanupIdiomaticPropertyWrites(String.raw`\begin{tikzpicture}
  \draw[draw=false, fill=red] (0,0) rectangle (1,1);
\end{tikzpicture}`);
    expect(fillOnly).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });

    const drawOnly = cleanupIdiomaticPropertyWrites(String.raw`\begin{tikzpicture}
  \filldraw[draw=blue, fill=false] (0,0) rectangle (1,1);
\end{tikzpicture}`);
    expect(drawOnly).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });
  });

  it("does not try paint-command cleanup for non-paint path commands", () => {
    const source = String.raw`\begin{tikzpicture}
  \clip[draw=none] (0,0) rectangle (1,1);
\end{tikzpicture}`;

    const plan = planPropertyWrite({
      source,
      action: {
        elementId: "path:0",
        key: "draw",
        value: "red"
      }
    });

    expect(plan.selected).toEqual(plan.conservative);
  });

  it("handles bare draw and fill flags while considering paint cleanup", () => {
    for (const source of [
      String.raw`\begin{tikzpicture}
  \path[draw] (0,0) -- (1,0);
\end{tikzpicture}`,
      String.raw`\begin{tikzpicture}
  \path[fill] (0,0) rectangle (1,1);
\end{tikzpicture}`
    ]) {
      expect(cleanupIdiomaticPropertyWrites(source)).toEqual({
        kind: "unsupported",
        reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
      });
    }
  });

  it("treats whitespace-only targeted cleanup as a no-op", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[red] (0,0) -- (1,0);
\end{tikzpicture}`;

    expect(cleanupIdiomaticPropertyWrites(source, {}, [" ", "\t"])).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });
  });
});
