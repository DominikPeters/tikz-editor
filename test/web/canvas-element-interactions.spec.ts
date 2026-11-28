import { describe, expect, it } from "vitest";
import { clientPoint, pt, px, worldPoint } from "../../packages/core/src/coords/index.js";
import {
  collectSnapExcludedSourceIds,
  resolveDeferredElementDragStart,
  SCOPE_DRILL_DRAG_ACTIVATION_DISTANCE_SQ
} from "../../packages/app/src/ui/canvas-panel/useCanvasElementInteractions.js";

describe("resolveDeferredElementDragStart", () => {
  const pending = { startClient: clientPoint(px(100), px(50)), startWorld: worldPoint(pt(12), pt(-7)) };

  it("stays a click inside the activation threshold", () => {
    expect(resolveDeferredElementDragStart(pending, clientPoint(px(103), px(52)), SCOPE_DRILL_DRAG_ACTIVATION_DISTANCE_SQ)).toBeNull();
    expect(resolveDeferredElementDragStart(pending, clientPoint(px(104), px(50)), SCOPE_DRILL_DRAG_ACTIVATION_DISTANCE_SQ)).toBeNull();
  });

  it("anchors the drag at the pointerdown point, not where the threshold is crossed", () => {
    // A drag from a part of a selected axis/scope used to start at the crossing point and lose that travel.
    expect(resolveDeferredElementDragStart(pending, clientPoint(px(110), px(55)), SCOPE_DRILL_DRAG_ACTIVATION_DISTANCE_SQ)).toEqual(pending.startWorld);
    expect(resolveDeferredElementDragStart(pending, clientPoint(px(104), px(51)), SCOPE_DRILL_DRAG_ACTIVATION_DISTANCE_SQ)).toEqual(pending.startWorld);
  });
});

describe("collectSnapExcludedSourceIds", () => {
  it("excludes synthetic tree descendants when dragging a tree root", () => {
    const excluded = new Set(
      collectSnapExcludedSourceIds(
        ["path:0"],
        {
          scopesById: new Map(),
          ancestorScopeIdsBySourceId: new Map(),
          boundsByScopeId: new Map()
        },
        [
          { sourceRef: { sourceId: "path:0" } },
          { sourceRef: { sourceId: "path:0:tree-child:1:child-operation:0:1" } },
          { sourceRef: { sourceId: "path:0:tree-child:1:child-operation:0:1:tree-child:2:child-operation:0:2" } },
          { sourceRef: { sourceId: "path:1" } }
        ] as any
      )
    );

    expect(excluded.has("path:0")).toBe(true);
    expect(excluded.has("path:0:tree-child:1:child-operation:0:1")).toBe(true);
    expect(excluded.has("path:0:tree-child:1:child-operation:0:1:tree-child:2:child-operation:0:2")).toBe(true);
    expect(excluded.has("path:1")).toBe(false);
  });

  it("preserves scope descendant exclusion behavior", () => {
    const excluded = new Set(
      collectSnapExcludedSourceIds(
        ["scope:0"],
        {
          scopesById: new Map([["scope:0", {} as any]]),
          ancestorScopeIdsBySourceId: new Map([
            ["path:2", ["scope:0"]],
            ["path:3", []]
          ]),
          boundsByScopeId: new Map()
        },
        []
      )
    );

    expect(excluded.has("scope:0")).toBe(true);
    expect(excluded.has("path:2")).toBe(true);
    expect(excluded.has("path:3")).toBe(false);
  });
});
