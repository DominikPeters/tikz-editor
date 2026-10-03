/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderTikzToSvg } from "../../packages/core/src/render/index";
import { createEditGeometrySession } from "../../packages/core/src/edit/geometry-session";
import * as patches from "../../packages/core/src/edit/source-patches";
import { pt, worldPoint, worldVector } from "../../packages/core/src/coords/index";
import { beginDocumentEdit, trackDocumentEdit } from "../../packages/app/src/edit-session";
import { executeDocumentEdit } from "../../packages/app/src/edit-execution";
import { makeEmptySnapshot } from "../../packages/app/src/compute";
import { editorReducer, makeInitialState } from "../../packages/app/src/store/reducer";
import { useEditorStore } from "../../packages/app/src/store/store";
import type { EditorAction } from "../../packages/app/src/store/types";
import { worldToSvgPoint } from "../../packages/app/src/ui/canvas-panel/geometry";
import { useCanvasDragController } from "../../packages/app/src/ui/canvas-panel/useCanvasDragController";
import type { ApplyActionWithFeedbackFn, DragState } from "../../packages/app/src/ui/canvas-panel/types";
import type { ToolCreateMode } from "../../packages/app/src/ui/tool-config";
import { canvasDragKindFromDragState } from "../../packages/app/src/ui/canvas-panel/panel-helpers";

const BASE = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,0);
\end{tikzpicture}`;
const OTHER = String.raw`\begin{tikzpicture}
\draw (20,20) circle (2);
\end{tikzpicture}`;
const origin = worldPoint(pt(0), pt(0));
const end = worldPoint(pt(10), pt(10));

describe("canvas drag ownership and cancellation", () => {
  let root: Root;
  let oldState: ReturnType<typeof useEditorStore.getState>;
  let dragRef: { current: DragState | null };
  let surfaceRef: { current: SVGSVGElement | null };
  let selectedRef: { current: ReadonlySet<string> };
  let nextFrame: number;
  let frames: Map<number, FrameRequestCallback>;
  let cancel: () => void;
  const setToolDraft = vi.fn(), setBezierDraft = vi.fn(), setSegmentDraft = vi.fn(), setFreehandDraft = vi.fn();
  const setPendingBezier = vi.fn(), setCursor = vi.fn(), setSnapLines = vi.fn(), setPreview = vi.fn();
  const commitSegment = vi.fn(), finalizeFreehand = vi.fn(), cleanup = vi.fn();
  const noop = () => {};
  const state = () => useEditorStore.getState();
  const dispatch = (action: EditorAction) => { useEditorStore.setState(editorReducer(state(), action)); };
  const setDragState = (next: DragState | null) => {
    dragRef.current = next;
    dispatch({ type: "SET_ACTIVE_CANVAS_DRAG", kind: canvasDragKindFromDragState(next) });
  };
  const apply: ApplyActionWithFeedbackFn = (action, historyMergeKey, sourceOverride, geometry, recordInHistory) => {
    const current = state();
    const source = sourceOverride ?? current.source;
    const result = executeDocumentEdit({ documentId: current.activeDocumentId, source,
      sourceRevision: current.sourceRevision, activeRootId: current.activeRootId, snapshot: current.snapshot }, action, { geometry });
    if ((result.kind === "success" || result.kind === "partial") && result.newSource !== source) {
      dispatch({ type: "APPLY_EDIT_ACTION", action, historyMergeKey, recordInHistory, precomputedSource: source, precomputedResult: result });
      return { sourceChanged: true, newSource: result.newSource };
    }
    return { sourceChanged: false };
  };
  function ready() {
    const current = state();
    const rendered = renderTikzToSvg(current.source, { parse: { activeFigureId: current.activeRootId ?? undefined } });
    dispatch({ type: "COMPUTE_REQUESTED", requestId: "ready" });
    dispatch({ type: "SNAPSHOT_READY", requestId: "ready", snapshot: {
      ...makeEmptySnapshot(current.source), parseResult: rendered.parse, semanticResult: rendered.semantic,
      activeRootId: rendered.parse.activeFigureId, figures: rendered.parse.figures,
      scene: rendered.semantic.scene, editHandles: rendered.semantic.editHandles, svg: rendered.svg
    } });
    expect(state().documents[state().activeDocumentId].editingIdentities?.entries.length).toBeGreaterThan(0);
  }
  const suppress = { current: false }, liveFrames = { current: new Map() }, bounds = { current: new Map() };
  const pendingSelection = { current: null };
  const scopeOverlay = { scopesById: new Map(), ancestorScopeIdsBySourceId: new Map(), boundsByScopeId: new Map() };
  const svgRef = { current: null as ReturnType<typeof state>["snapshot"]["svg"] };
  function Harness() {
    const current = useEditorStore();
    selectedRef.current = current.selectedElementIds;
    svgRef.current = current.snapshot.svg;
    cancel = useCanvasDragController({
      schedulePropertyCleanup: cleanup, applyActionWithFeedback: apply, dispatch, dispatchCanvasTransform: noop,
      logSnapDebug: noop, queueSelectionForAddedElement: noop, snapshotSource: current.snapshot.source, source: current.source,
      snapshotScene: current.snapshot.scene, snapshotEditHandles: current.snapshot.editHandles,
      nodeAnchorTargets: [], matrixCellAnchorHints: [], svgResult: current.snapshot.svg,
      dragRef, suppressNextBackgroundClickRef: suppress, svgResultRef: svgRef,
      interactionSvgRef: surfaceRef, liveResizeFramesRef: liveFrames,
      selectedElementIdsRef: selectedRef, sourceBoundsSvgRef: bounds, scopeOverlay,
      pendingAddedSelectionRef: pendingSelection, setDragState,
      setSnapLines, setToolDraft, setBezierBendDraft: setBezierDraft, setPathSegmentDraft: setSegmentDraft, setFreehandDraft,
      commitPathToolSegment: commitSegment, appendFreehandSamplePoint: () => null, finalizeFreehandDraft: finalizeFreehand,
      setPendingBezier, setToolCursorWorld: setCursor, setMarqueeDraft: noop, setNodeAnchorOverlay: noop,
      setDragTooltip: noop, setWarning: noop, setPathAttachedNodePreview: setPreview,
      selectedAddShape: "rectangle", creationStrokeColor: "black", creationFillColor: "none"
    });
    return null;
  }
  function pointer(type: string, pointerId = 1, world = end) {
    const viewBox = state().snapshot.svg!.viewBox;
    const svg = worldToSvgPoint(world, viewBox);
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId, clientX: svg.x - viewBox.x, clientY: svg.y - viewBox.y,
      shiftKey: false, altKey: false, ctrlKey: false, metaKey: false });
    window.dispatchEvent(event);
  }
  function flush() {
    const scheduled = [...frames.values()];
    frames.clear();
    for (const callback of scheduled) callback(0);
  }
  function createDrag(mode: ToolCreateMode = "addLine"): DragState {
    return { kind: "tool-create", pointerId: 1, toolMode: mode, startWorld: origin,
      startEndpointAnchor: null, rawCurrentWorld: end, currentWorld: end, activeEndpointAnchor: null, snapContext: null };
  }
  function elementDrag(): Extract<DragState, { kind: "element" }> {
    const current = state(), snapshot = current.snapshot;
    return { kind: "element", pointerId: 1, elementIds: ["path:0"], startWorld: origin,
      lastAppliedTotalDelta: worldVector(pt(0), pt(0)), baseline: { source: current.source, editHandles: snapshot.editHandles },
      latestSource: current.source, editSession: beginDocumentEdit(current),
      geometry: createEditGeometrySession({ source: current.source, parsed: snapshot.parseResult!, semantic: snapshot.semanticResult! }, {}, { activeFigureId: current.activeRootId }),
      snapContext: null, initialSelection: null, selectionAnchorRatio: null, historyMergeKey: "test-owned-gesture" };
  }
  beforeEach(async () => {
    oldState = state();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    nextFrame = 0; frames = new Map();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
    dragRef = { current: null }; surfaceRef = { current: null }; selectedRef = { current: new Set() };
    useEditorStore.setState({ ...makeInitialState(), dispatch });
    dispatch({ type: "CODE_EDITED", source: BASE }); ready(); dispatch({ type: "SELECT", id: "path:0", additive: false });
    for (const mock of [setToolDraft, setBezierDraft, setSegmentDraft, setFreehandDraft, setPendingBezier, setCursor, setSnapLines, setPreview, commitSegment, finalizeFreehand, cleanup]) mock.mockClear();
    root = createRoot(document.createElement("div"));
    await act(async () => root.render(React.createElement(Harness)));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    useEditorStore.setState(oldState, true);
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it.each(["addLine", "addArrow", "addRectangle", "addEllipse", "addCircle", "addGrid", "addShape", "addBezier"] as ToolCreateMode[])(
    "discards cancelled %s creation and ignores a later release", async mode => {
      const history = state().history;
      await act(async () => setDragState(createDrag(mode)));
      await act(async () => { pointer("pointermove"); pointer("pointercancel"); flush(); pointer("pointerup"); });
      expect(state().source).toBe(BASE); expect(state().history).toBe(history);
      expect(dragRef.current).toBeNull(); expect(state().activeCanvasDragKind).toBeNull();
      expect(setToolDraft).toHaveBeenLastCalledWith(null); expect(setPendingBezier).toHaveBeenLastCalledWith(null);
      expect(setCursor).toHaveBeenLastCalledWith(null); expect(setSnapLines).toHaveBeenLastCalledWith([]);
    }
  );
  it.each(["tool-bezier-bend", "tool-path-segment", "tool-freehand"] as const)("discards interrupted %s without committing", async kind => {
    const drag: DragState = kind === "tool-bezier-bend"
      ? { kind, pointerId: 1, startWorld: origin, endWorld: end, rawCurrentWorld: end, currentWorld: end, snapContext: null }
      : kind === "tool-path-segment"
        ? { kind, pointerId: 1, startWorld: origin, endWorld: end, endEndpointAnchor: null, startPointerWorld: end,
          rawBendWorld: end, bendWorld: end, isBending: true, snapContext: null }
        : { kind, pointerId: 1, points: [origin, end], minSampleDistanceWorld: 1 };
    await act(async () => setDragState(drag));
    await act(async () => { pointer("pointercancel"); pointer("pointerup"); });
    expect(state().source).toBe(BASE); // The authored line represents an already committed path segment.
    expect(commitSegment).not.toHaveBeenCalled(); expect(finalizeFreehand).not.toHaveBeenCalled();
    expect(setSegmentDraft).toHaveBeenLastCalledWith(null); expect(setBezierDraft).toHaveBeenLastCalledWith(null);
    if (kind === "tool-freehand") expect(setFreehandDraft).toHaveBeenLastCalledWith(null);
  });
  it("clears creation on blur and still commits a normal release", async () => {
    await act(async () => setDragState(createDrag()));
    await act(async () => { window.dispatchEvent(new Event("blur")); pointer("pointerup"); });
    expect(state().source).toBe(BASE);
    await act(async () => setDragState(createDrag()));
    await act(async () => pointer("pointerup"));
    expect(state().source).not.toBe(BASE); expect(dragRef.current).toBeNull();
    await act(async () => dispatch({ type: "UNDO" })); expect(state().source).toBe(BASE);
  });
  it("ignores cancellation and release from an unrelated pointer", async () => {
    await act(async () => setDragState(createDrag()));
    await act(async () => { pointer("pointercancel", 99); pointer("pointerup", 99); });
    expect(dragRef.current?.kind).toBe("tool-create"); expect(state().source).toBe(BASE);
    await act(async () => pointer("pointerup")); expect(state().source).not.toBe(BASE);
  });
  it.each(["pointercancel", "blur", "Escape", "unmount"])("rolls back owned movement on %s and leaves no aborted redo entry", async interruption => {
    const history = state().history, index = state().historyIndex;
    await act(async () => setDragState(elementDrag()));
    await act(async () => { pointer("pointermove"); flush(); });
    expect(state().source).not.toBe(BASE); expect(state().history).toBe(history);
    await act(async () => {
      if (interruption === "unmount") root.unmount();
      else if (interruption === "blur") window.dispatchEvent(new Event("blur"));
      else if (interruption === "Escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
      else pointer("pointercancel");
      flush();
    });
    expect(state().source).toBe(BASE); expect(state().historyIndex).toBe(index); expect(state().history).toBe(history);
    dispatch({ type: "REDO" }); expect(state().source).toBe(BASE);
  });
  it("discards a queued final move on cancellation", async () => {
    const revision = state().sourceRevision;
    await act(async () => setDragState(elementDrag()));
    await act(async () => { pointer("pointermove"); pointer("pointercancel"); flush(); });
    expect(state().source).toBe(BASE); expect(state().sourceRevision).toBe(revision);
  });
  it("preserves intervening source edits without adding a stale gesture history entry", async () => {
    await act(async () => setDragState(elementDrag()));
    await act(async () => { pointer("pointermove"); flush(); });
    const changed = `${state().source}\n% newer edit`;
    await act(async () => dispatch({ type: "CODE_EDITED", source: changed }));
    const history = state().history;
    await act(async () => { pointer("pointercancel"); pointer("pointerup"); flush(); });
    expect(state().source).toBe(changed); expect(state().history).toBe(history);
    expect(state().history.filter(entry => entry.mergeKey === "test-owned-gesture")).toHaveLength(0);
  });
  it("records the complete drag baseline once and preserves disjoint patch replay through undo/redo", async () => {
    const compose = vi.spyOn(patches, "composeSourcePatches");
    const historyLength = state().history.length;
    await act(async () => setDragState(elementDrag()));
    for (let x = 1; x <= 60; x++) await act(async () => { pointer("pointermove", 1, worldPoint(pt(x), pt(0))); flush(); });
    expect(state().history).toHaveLength(historyLength);
    await act(async () => pointer("pointerup", 1, worldPoint(pt(65), pt(0))));
    const finalSource = state().source;
    expect(state().history).toHaveLength(historyLength + 1);
    const entry = state().history.at(-1)!;
    expect(entry.sourceBefore).toBe(BASE); expect(entry.sourceAfter).toBe(finalSource);
    expect(entry.forward.length).toBeLessThanOrEqual(4);
    expect(patches.applySourcePatches(BASE, entry.forward)).toEqual({ kind: "success", source: finalSource });
    expect(compose.mock.calls.length).toBeGreaterThanOrEqual(60);
    for (const [, steps] of compose.mock.calls) expect(steps.length).toBeLessThanOrEqual(2);
    expect(entry.forward.reduce((size, patch) => size + patch.replacement.length, 0)).toBeLessThan(100);
    await act(async () => dispatch({ type: "UNDO" })); expect(state().source).toBe(BASE);
    await act(async () => dispatch({ type: "REDO" })); expect(state().source).toBe(finalSource);
  });
  it("restores an owned inactive document when context cancellation runs", async () => {
    const originId = state().activeDocumentId;
    await act(async () => setDragState(elementDrag()));
    await act(async () => { pointer("pointermove"); flush(); });
    await act(async () => { dispatch({ type: "NEW_DOCUMENT", source: OTHER }); cancel(); ready(); });
    expect(state().source).toBe(OTHER); expect(state().documents[originId].source).toBe(BASE);
  });
  it("cancels when the interaction SVG surface is replaced", async () => {
    await act(async () => setDragState(elementDrag()));
    await act(async () => { pointer("pointermove"); flush(); });
    await act(async () => {
      surfaceRef.current = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      dispatch({ type: "SET_HOVERED_ELEMENT", id: "path:0" });
    });
    expect(dragRef.current).toBeNull(); expect(state().source).toBe(BASE);
  });
  it.each(["resize", "rotate", "handle"] as const)("uses the same owned rollback boundary for %s previews", async kind => {
    const drag = elementDrag();
    await act(async () => apply({ kind: "moveElements", elementIds: ["path:0"], delta: worldPoint(pt(10), pt(0)) }, undefined, BASE, drag.geometry, false));
    trackDocumentEdit(drag.editSession!, state());
    const handle = state().snapshot.editHandles[0];
    const seeded = { ...drag, kind, latestSource: state().source, elementId: "path:0", sourceId: "path:0",
      snapContext: null, role: "right", handleId: handle.id, handleEditingId: handle.editingId,
      handleKind: handle.kind, lastKnownWorld: handle.world, gridResizeSnap: null,
      activeEndpointAnchor: null, nodeAnchorTargets: [], matrixCellAnchorHints: [] } as unknown as DragState;
    await act(async () => setDragState(seeded));
    await act(async () => pointer("pointercancel"));
    expect(state().source).toBe(BASE); expect(dragRef.current).toBeNull();
  });
});
