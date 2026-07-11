import { describe, expect, it } from "vitest";

import { frameToWorldTransform, worldTransform } from "../../packages/core/src/coords/transforms.js";
import { flp, wb, wp } from "../coords-helpers.js";
import {
  applyStatementEffectSummary,
  beginStatementEffectTracking,
  createSemanticContext,
  endStatementEffectTracking,
  readNamedCoordinate,
  resolveContextColorAliasValue,
  recordDependencyConsumer,
  recordDependencyProducer,
  markDependencyOpaque,
  readContextMacroBinding,
  restoreSemanticContext,
  retargetEditHandlesSourceFingerprint,
  snapshotSemanticContext,
  writeContextColorAlias,
  writeContextMacroBinding,
  writeNamedCoordinate
} from "../../packages/core/src/semantic/context.js";
import { defaultStyle } from "../../packages/core/src/semantic/style/defaults.js";
import type { EditHandle } from "../../packages/core/src/semantic/types.js";

describe("semantic context state helpers", () => {
  it("restores compact snapshots from an external edit-handle source", () => {
    const context = createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 0, 0));
    context.pictureBounds = wb(-1, -2, 3, 4);
    context.currentPoint = wp(10, 20);
    context.pathStartPoint = wp(5, 6);
    context.editHandles = [
      makeEditHandle("handle-a", "old-fingerprint"),
      makeEditHandle("handle-b", "old-fingerprint")
    ];

    const snapshot = snapshotSemanticContext(context, { editHandlesMode: "length" });
    const restored = createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 9, 9));
    const externalHandles = [
      makeEditHandle("handle-a", "external-fingerprint"),
      makeEditHandle("handle-b", "external-fingerprint"),
      makeEditHandle("handle-c", "external-fingerprint")
    ];

    restoreSemanticContext(restored, snapshot, { editHandleSource: externalHandles });

    expect(snapshot.editHandles).toBeNull();
    expect(restored.pictureBounds).toEqual({ minX: -1, minY: -2, maxX: 3, maxY: 4 });
    expect(restored.currentPoint).toEqual({ x: 10, y: 20 });
    expect(restored.pathStartPoint).toEqual({ x: 5, y: 6 });
    expect(restored.editHandles).toEqual(externalHandles.slice(0, 2));
    expect(() => restoreSemanticContext(restored, snapshot)).toThrow(
      "Missing edit handle source for compact semantic context restore"
    );

    const clonedSnapshot = snapshotSemanticContext(context);
    const restoredClone = createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 9, 9));
    restoreSemanticContext(restoredClone, clonedSnapshot);
    expect(restoredClone.editHandles).toEqual(context.editHandles);
  });

  it("retargets only stale edit-handle fingerprints", () => {
    const handles = [
      makeEditHandle("fresh", "next"),
      makeEditHandle("stale", "previous")
    ];

    retargetEditHandlesSourceFingerprint(handles, "next");

    expect(handles[0].sourceRef.sourceFingerprint).toBe("next");
    expect(handles[1]).toMatchObject({
      id: "stale",
      sourceRef: {
        sourceFingerprint: "next"
      }
    });
  });

  it("preserves copy-on-write color and macro registries across snapshots", () => {
    const context = createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 0, 0));
    writeContextColorAlias(context, "accent", "blue");
    writeContextMacroBinding(context, "\\value", {
      kind: "text",
      value: "before",
      provenance: []
    });
    const snapshot = snapshotSemanticContext(context);

    writeContextColorAlias(context, "accent", "red");
    writeContextMacroBinding(context, "\\value", {
      kind: "text",
      value: "after",
      provenance: []
    });

    const restored = createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 0, 0));
    restoreSemanticContext(restored, snapshot);
    expect(resolveContextColorAliasValue(restored, "accent")).toBe("blue");
    expect(readContextMacroBinding(restored, "\\value")).toMatchObject({
      kind: "text",
      value: "before"
    });

    writeContextColorAlias(restored, "accent", "green");
    const restoredAgain = createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 0, 0));
    restoreSemanticContext(restoredAgain, snapshot);
    expect(resolveContextColorAliasValue(restoredAgain, "accent")).toBe("blue");
  });

  it("tracks statement effects and replays their dependency summary", () => {
    const context = createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 0, 0));
    context.currentPoint = wp(1, 2);
    context.pathStartPoint = null;

    beginStatementEffectTracking(context);
    writeNamedCoordinate(context, "A", wp(3, 4), "producer");
    expect(readNamedCoordinate(context, "A", "consumer")).toEqual({ x: 3, y: 4 });
    recordDependencyProducer(context, "named-path", "route", "producer");
    recordDependencyConsumer(context, "named-path", "route", "consumer");
    context.currentPoint = wp(9, 2);
    context.pathStartPoint = wp(0, 0);

    const summary = endStatementEffectTracking(context, {
      beforeCurrentPoint: wp(1, 2),
      beforePathStartPoint: null,
      requiresSequentialContext: true
    });

    expect(summary).toMatchObject({
      producesNamedCoordinates: [{ key: "A", point: { x: 3, y: 4 } }],
      producesNamedPaths: ["route"],
      mutatesCurrentPoint: true,
      mutatesPathStartPoint: true,
      requiresSequentialContext: true,
      suffixSkipKind: "unsafe",
      opaque: false
    });
    expect(summary.consumesNamedResources).toEqual([
      { kind: "named-coordinate", key: "A" },
      { kind: "named-path", key: "route" }
    ]);

    const replay = createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 0, 0));
    applyStatementEffectSummary(replay, summary, { sourceId: "replayed" });
    expect(readNamedCoordinate(replay, "A")).toEqual({ x: 3, y: 4 });
    expect(replay.currentPoint).toEqual({ x: 9, y: 2 });
    expect(replay.pathStartPoint).toEqual({ x: 0, y: 0 });
    expect(replay.dependencyBuilder.build().nodes.map((node) => node.id)).toContain("source:replayed");

    const withoutTracker = endStatementEffectTracking(replay, {
      beforeCurrentPoint: null,
      beforePathStartPoint: null,
      requiresSequentialContext: false
    });
    expect(withoutTracker.mutatesCurrentPoint).toBe(true);
    expect(withoutTracker.opaqueReasons).toEqual([]);
  });

  it("resolves color alias chains conservatively", () => {
    const context = createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 0, 0));

    writeContextColorAlias(context, "   ", "red");
    writeContextColorAlias(context, "accent", "brand", {
      statementId: "color-a",
      span: { from: 1, to: 2 }
    });
    writeContextColorAlias(context, "brand", "blue");
    writeContextColorAlias(context, "cycle-a", "cycle-b");
    writeContextColorAlias(context, "cycle-b", "cycle-a");
    writeContextColorAlias(context, "empty-target", "");

    expect(resolveContextColorAliasValue(context, "   ")).toBeNull();
    expect(resolveContextColorAliasValue(context, "missing")).toBeNull();
    expect(resolveContextColorAliasValue(context, "accent", "consumer")).toBe("blue");
    expect(resolveContextColorAliasValue(context, "cycle-a", "consumer")).toBe("cycle-a");
    expect(resolveContextColorAliasValue(context, "empty-target", "consumer")).toBeNull();
    expect(context.symbolResolver.dependencyEdges.size).toBeGreaterThan(0);
  });

  it("records opaque statement effects only for the active source", () => {
    const context = createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 0, 0));
    context.dependencyActiveSourceId = "active";

    beginStatementEffectTracking(context);
    recordDependencyProducer(context, "named-coordinate", "ignored-without-source");
    recordDependencyConsumer(context, "named-coordinate", "ignored-without-source");
    markDependencyOpaque(context, "other", "macro-origin");
    markDependencyOpaque(context, "active", "foreach-origin");

    const summary = endStatementEffectTracking(context, {
      beforeCurrentPoint: null,
      beforePathStartPoint: null,
      requiresSequentialContext: false
    });

    expect(summary.opaque).toBe(true);
    expect(summary.opaqueReasons).toEqual(["foreach-origin"]);
  });
});

function makeEditHandle(id: string, sourceFingerprint: string): EditHandle {
  return {
    id,
    runtimeId: `runtime:${id}`,
    sourceRef: {
      sourceId: id,
      sourceSpan: { from: 0, to: 0 },
      sourceFingerprint
    },
    handleType: "coordinate",
    coordinateSpace: "frame-local",
    kind: "path-point",
    world: wp(0, 0),
    local: flp(0, 0),
    frame: frameToWorldTransform(1, 0, 0, 1, 0, 0),
    transform: worldTransform(1, 0, 0, 1, 0, 0),
    sourceText: "",
    coordinateForm: "cartesian",
    rewriteMode: "direct"
  };
}
