import { describe, expect, it } from "vitest";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import {
  augmentScopeOverlayWithMatrices,
  buildScopeOverlayIndex,
  isSvgPointWithinScopeBounds,
  resolveFocusedScopeIdForSelection,
  resolveScopeAwareMarqueeSelection,
  resolveScopeAwareContextMenuTarget,
  resolveScopeAwarePointerDownTarget,
  resolveScopeAwarePointerUpDrillTarget,
  scopeWorldBounds
} from "../../packages/app/src/ui/canvas-panel/scope-overlay.js";
import { sb, sp, wb } from "../coords-helpers.js";

describe("scope overlay selection resolver", () => {
  const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \begin{scope}
    \draw (0,1) -- (1,1);
    \begin{scope}
      \draw (0,2) -- (1,2);
    \end{scope}
  \end{scope}
\end{tikzpicture}`;

  const parsed = parseTikz(source, { recover: true });
  const overlay = buildScopeOverlayIndex(parsed.figure.body, new Map([
    ["path:0", sb(0, 0, 1, 0)],
    ["path:2", sb(0, 1, 1, 1)],
    ["path:4", sb(0, 2, 1, 2)]
  ]));

  it("bounds a scope by its members, including nested scopes", () => {
    const world = new Map([
      ["path:0", wb(0, 0, 1, 0)],
      ["path:2", wb(0, 1, 1, 1)],
      ["path:4", wb(-1, 2, 1, 3)]
    ]);
    expect(scopeWorldBounds(overlay, "scope:1", world)).toMatchObject({ minX: -1, minY: 1, maxX: 1, maxY: 3 });
    expect(scopeWorldBounds(overlay, "scope:3", world)).toMatchObject({ minX: -1, minY: 2, maxX: 1, maxY: 3 });
    expect(scopeWorldBounds(overlay, "path:0", world)).toBeNull();
  });

  it("selects the outermost enclosing scope on first pointer-down", () => {
    const resolved = resolveScopeAwarePointerDownTarget({
      hitTargetId: "path:4",
      hitSourceId: "path:4",
      scopeOverlay: overlay
    });

    expect(resolved).toBe("scope:1");
  });

  it("respects focused scope when resolving pointer-down targets", () => {
    const resolvedIntoInnerScope = resolveScopeAwarePointerDownTarget({
      hitTargetId: "path:4",
      hitSourceId: "path:4",
      focusedScopeId: "scope:1",
      scopeOverlay: overlay
    });
    expect(resolvedIntoInnerScope).toBe("scope:3");

    const resolvedIntoLeaf = resolveScopeAwarePointerDownTarget({
      hitTargetId: "path:4",
      hitSourceId: "path:4",
      focusedScopeId: "scope:3",
      scopeOverlay: overlay
    });
    expect(resolvedIntoLeaf).toBe("path:4");
  });

  it("drills down one level on pointer-up from the selected scope", () => {
    const drillToInnerScope = resolveScopeAwarePointerUpDrillTarget({
      selectedScopeId: "scope:1",
      hitSourceId: "path:4",
      scopeOverlay: overlay
    });
    expect(drillToInnerScope).toBe("scope:3");

    const drillToLeaf = resolveScopeAwarePointerUpDrillTarget({
      selectedScopeId: "scope:3",
      hitSourceId: "path:4",
      scopeOverlay: overlay
    });
    expect(drillToLeaf).toBe("path:4");
  });

  it("computes focused scope transitions for scope -> scope -> leaf", () => {
    expect(resolveFocusedScopeIdForSelection("scope:1", overlay)).toBeNull();
    expect(resolveFocusedScopeIdForSelection("scope:3", overlay)).toBe("scope:1");
    expect(resolveFocusedScopeIdForSelection("path:4", overlay)).toBe("scope:3");
  });

  it("preserves selected ancestor scope for context-menu hits without drilling", () => {
    const resolved = resolveScopeAwareContextMenuTarget({
      hitTargetId: "path:4",
      hitSourceId: "path:4",
      selectedSourceIds: new Set(["scope:1"]),
      scopeOverlay: overlay
    });
    expect(resolved).toBe("scope:1");
  });

  it("computes scope bounds as unions of descendant statement bounds", () => {
    const outer = overlay.boundsByScopeId.get("scope:1");
    const inner = overlay.boundsByScopeId.get("scope:3");
    expect(outer).toEqual(sb(0, 1, 1, 2));
    expect(inner).toEqual(sb(0, 2, 1, 2));
  });

  it("supports focused-scope outside-click reset checks via bounds", () => {
    expect(isSvgPointWithinScopeBounds("scope:1", sp(0.5, 1.5), overlay)).toBe(true);
    expect(isSvgPointWithinScopeBounds("scope:1", sp(2, 2), overlay)).toBe(false);
  });

  it("marquee selects unscoped elements and only the outermost fully-contained scopes", () => {
    const selected = resolveScopeAwareMarqueeSelection({
      selectionBounds: sb(-0.1, -0.1, 1.1, 2.1),
      sourceBoundsById: new Map([
        ["path:0", sb(0, 0, 1, 0)],
        ["path:2", sb(0, 1, 1, 1)],
        ["path:4", sb(0, 2, 1, 2)]
      ]),
      scopeOverlay: overlay
    });

    expect(selected).toEqual(["path:0", "scope:1"]);
  });

  it("marquee can select an inner scope when its parent is not fully contained", () => {
    const selected = resolveScopeAwareMarqueeSelection({
      selectionBounds: sb(-0.1, 1.5, 1.1, 2.1),
      sourceBoundsById: new Map([
        ["path:0", sb(0, 0, 1, 0)],
        ["path:2", sb(0, 1, 1, 1)],
        ["path:4", sb(0, 2, 1, 2)]
      ]),
      scopeOverlay: overlay
    });

    expect(selected).toEqual(["scope:3"]);
  });
});

describe("scope overlay matrix augmentation", () => {
  it("registers virtual matrix scopes and supports matrix drill-down from scope to cell", () => {
    const base = buildScopeOverlayIndex([], new Map());
    const sceneElements = [
      {
        kind: "Text",
        id: "scene:text:1",
        runtimeId: "runtime:text:1",
        sourceRef: { sourceId: "node:0:0:matrix-cell:1:1" },
        matrixCell: {
          matrixSourceId: "path:0",
          cellSourceId: "node:0:0:matrix-cell:1:1",
          row: 1,
          column: 1,
          textMode: "text",
          textSpan: { from: 0, to: 1 },
          cellSpan: { from: 0, to: 1 }
        }
      }
    ] as any[];

    const augmented = augmentScopeOverlayWithMatrices(
      base,
      sceneElements,
      new Map([
        ["node:0:0:matrix-cell:1:1", sb(0, 0, 1, 1)]
      ])
    );

    expect(augmented.scopesById.has("path:0")).toBe(true);
    expect(augmented.boundsByScopeId.get("path:0")).toEqual(sb(0, 0, 1, 1));
    expect(augmented.ancestorScopeIdsBySourceId.get("node:0:0:matrix-cell:1:1")).toEqual(["path:0"]);

    const resolvedDown = resolveScopeAwarePointerDownTarget({
      hitTargetId: "node:0:0:matrix-cell:1:1",
      hitSourceId: "node:0:0:matrix-cell:1:1",
      scopeOverlay: augmented
    });
    expect(resolvedDown).toBe("path:0");

    const resolvedDownMatrix = resolveScopeAwarePointerDownTarget({
      hitTargetId: "path:0",
      hitSourceId: "path:0",
      scopeOverlay: augmented
    });
    expect(resolvedDownMatrix).toBe("path:0");

    const resolvedDrill = resolveScopeAwarePointerUpDrillTarget({
      selectedScopeId: "path:0",
      hitSourceId: "node:0:0:matrix-cell:1:1",
      scopeOverlay: augmented
    });
    expect(resolvedDrill).toBe("node:0:0:matrix-cell:1:1");
  });

  it("keeps additive matrix-cell targeting stable even when focused on the matrix scope", () => {
    const base = buildScopeOverlayIndex([], new Map());
    const sceneElements = [
      {
        kind: "Text",
        id: "scene:text:1",
        runtimeId: "runtime:text:1",
        sourceRef: { sourceId: "node:0:0:matrix-cell:1:1" },
        matrixCell: {
          matrixSourceId: "path:0",
          cellSourceId: "node:0:0:matrix-cell:1:1",
          row: 1,
          column: 1,
          textMode: "text",
          textSpan: { from: 0, to: 1 },
          cellSpan: { from: 0, to: 1 }
        }
      },
      {
        kind: "Text",
        id: "scene:text:2",
        runtimeId: "runtime:text:2",
        sourceRef: { sourceId: "node:0:0:matrix-cell:1:2" },
        matrixCell: {
          matrixSourceId: "path:0",
          cellSourceId: "node:0:0:matrix-cell:1:2",
          row: 1,
          column: 2,
          textMode: "text",
          textSpan: { from: 0, to: 1 },
          cellSpan: { from: 0, to: 1 }
        }
      },
      {
        kind: "Text",
        id: "scene:text:3",
        runtimeId: "runtime:text:3",
        sourceRef: { sourceId: "node:0:0:matrix-cell:2:1" },
        matrixCell: {
          matrixSourceId: "path:0",
          cellSourceId: "node:0:0:matrix-cell:2:1",
          row: 2,
          column: 1,
          textMode: "text",
          textSpan: { from: 0, to: 1 },
          cellSpan: { from: 0, to: 1 }
        }
      }
    ] as any[];
    const augmented = augmentScopeOverlayWithMatrices(
      base,
      sceneElements,
      new Map([
        ["node:0:0:matrix-cell:1:1", sb(0, 0, 1, 1)],
        ["node:0:0:matrix-cell:1:2", sb(1, 0, 2, 1)],
        ["node:0:0:matrix-cell:2:1", sb(0, 1, 1, 2)]
      ])
    );

    expect(
      resolveScopeAwarePointerDownTarget({
        hitTargetId: "node:0:0:matrix-cell:1:1",
        hitSourceId: "node:0:0:matrix-cell:1:1",
        scopeOverlay: augmented,
        focusedScopeId: "path:0"
      })
    ).toBe("node:0:0:matrix-cell:1:1");
    expect(
      resolveScopeAwarePointerDownTarget({
        hitTargetId: "node:0:0:matrix-cell:1:2",
        hitSourceId: "node:0:0:matrix-cell:1:2",
        scopeOverlay: augmented,
        focusedScopeId: "path:0"
      })
    ).toBe("node:0:0:matrix-cell:1:2");
    expect(
      resolveScopeAwarePointerDownTarget({
        hitTargetId: "node:0:0:matrix-cell:2:1",
        hitSourceId: "node:0:0:matrix-cell:2:1",
        scopeOverlay: augmented,
        focusedScopeId: "path:0"
      })
    ).toBe("node:0:0:matrix-cell:2:1");
  });
});
