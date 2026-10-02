import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { clientPoint, px } from "@tikz-editor/core/coords/index";
import { beamerColumnResizePatches, beamerImageResizePatches, beamerSpacingResizePatches, type BeamerSpacingTarget, type BeamerColumnDivider, type BeamerFrameLayout, type BeamerImageResizeTarget } from "@tikz-editor/core/beamer/index";
import type { SourcePatch } from "@tikz-editor/core/edit/types";
import { beginDocumentEdit, canContinueDocumentEdit, restoreDocumentEdit, trackDocumentEdit, type DocumentEditSession } from "../../edit-session";
import { useEditorStore } from "../../store/store";
import { rootKey } from "../../root-key";
import { clientToSvgPoint } from "./geometry";

export type DeckResizeTarget = { kind: "columns"; divider: BeamerColumnDivider }
  | { kind: "spacing"; spacing: BeamerSpacingTarget }
  | { kind: "image"; image: BeamerImageResizeTarget; corner: "nw" | "ne" | "sw" | "se" };
type Session = {
  edit: DocumentEditSession;
  step: number;
  patches: SourcePatch[];
  imageFrom?: number;
  cleanup: () => void;
};

function patchesFor(source: string, target: DeckResizeTarget, dx: number, dy: number): SourcePatch[] {
  if (target.kind === "columns") return beamerColumnResizePatches(source, target.divider, dx);
  if (target.kind === "spacing") return beamerSpacingResizePatches(source, target.spacing, dy);
  const { width, height } = target.image.bounds;
  const sx = target.corner.endsWith("e") ? 1 : -1;
  const sy = target.corner.startsWith("s") ? 1 : -1;
  const factor = 1 + (sx * dx * width + sy * dy * height) / (width * width + height * height);
  return beamerImageResizePatches(source, target.image, factor);
}
function patchedSource(source: string, patches: SourcePatch[]): string {
  return [...patches].reverse().reduce((text, patch) => text.slice(0, patch.oldSpan.from) + patch.replacement + text.slice(patch.oldSpan.to), source);
}

export function useDeckResize({ source, layout, svgRef, closeText }: {
  source: string;
  layout: BeamerFrameLayout | null;
  svgRef: RefObject<SVGSVGElement | null>;
  closeText: () => void;
}) {
  const session = useRef<Session | null>(null);
  const pendingSelection = useRef<{ documentId: string; frameId: string; source: string; from: number } | null>(null);
  const [dragging, setDragging] = useState<DeckResizeTarget | null>(null);

  const valid = useCallback((current: Session) => {
    const state = useEditorStore.getState();
    return canContinueDocumentEdit(current.edit, state) &&
      (state.deckStepByRootKey[rootKey(current.edit.documentId, current.edit.activeRootId)] ?? 1) === current.step &&
      !state.activeCanvasTextEditSourceId && !state.documents[current.edit.documentId]?.assistantLockReason;
  }, []);

  const stop = useCallback((commit: boolean) => {
    const current = session.current;
    if (!current) return;
    session.current = null;
    current.cleanup();
    const { dispatch } = useEditorStore.getState();
    const canCommit = valid(current);
    const restored = restoreDocumentEdit(current.edit, useEditorStore.getState, dispatch);
    dispatch({ type: "SET_ACTIVE_INSPECTOR_EDIT", documentId: null });
    if (commit && canCommit && restored && current.patches.length) {
      dispatch({ type: "APPLY_SOURCE_PATCHES", documentId: current.edit.documentId,
        baseRevision: current.edit.latestRevision, patches: current.patches, changedSourceIds: [] });
    }
    if (restored && current.imageFrom != null) {
      pendingSelection.current = { documentId: current.edit.documentId, frameId: current.edit.activeRootId!,
        source: useEditorStore.getState().documents[current.edit.documentId].source, from: current.imageFrom };
    }
    setDragging(null);
  }, [valid]);

  // Synchronous ownership checks avoid overwriting typing, undo, tab changes, or a step change.
  useEffect(() => useEditorStore.subscribe(() => {
    if (session.current && !valid(session.current)) stop(false);
  }), [stop, valid]);
  useEffect(() => () => { stop(false); }, [stop]);

  useEffect(() => {
    const state = useEditorStore.getState();
    const current = session.current;
    const pending = pendingSelection.current;
    const from = current?.imageFrom ?? (pending?.documentId === state.activeDocumentId && pending.frameId === layout?.frameId && pending.source === source ? pending.from : undefined);
    if (from == null || !layout || source !== state.source) return;
    const image = layout.graphics.find((item) => item.sourceSpan.from === from && item.visibility === "visible");
    if (image) state.dispatch({ type: "SET_DECK_OBJECT_SELECTION", frameId: layout.frameId, objectId: image.itemId });
    if (!current) pendingSelection.current = null;
  }, [source, layout]);

  const prepare = (target: DeckResizeTarget): Session | null => {
    if (session.current || !layout) return null;
    const initial = useEditorStore.getState();
    if (initial.source !== source || initial.snapshot.source !== source || initial.activeRootId !== layout.frameId ||
      Math.min(initial.deckStepByRootKey[rootKey(initial.activeDocumentId, layout.frameId)] ?? 1, layout.stepCount) !== layout.step ||
      initial.activeInspectorEditDocumentId || initial.documents[initial.activeDocumentId]?.assistantLockReason) return null;
    closeText();
    const state = useEditorStore.getState();
    if (state.sourceRevision !== initial.sourceRevision || state.activeCanvasTextEditSourceId) return null;
    pendingSelection.current = null;
    const edit = beginDocumentEdit(state, []);
    const imageFrom = target.kind === "image" ? layout.graphics.find((item) => item.itemId === target.image.objectId)?.sourceSpan.from : undefined;
    return { edit, imageFrom, step: state.deckStepByRootKey[rootKey(edit.documentId, layout.frameId)] ?? 1,
      patches: [], cleanup: () => {} };
  };

  const nudge = (target: DeckResizeTarget, dx: number, dy: number) => {
    const current = prepare(target);
    if (!current) return;
    const patches = patchesFor(source, target, dx, dy);
    const state = useEditorStore.getState();
    state.dispatch({ type: "APPLY_SOURCE_PATCHES", documentId: current.edit.documentId,
      baseRevision: current.edit.latestRevision, patches, changedSourceIds: [] });
    if (current.imageFrom != null) pendingSelection.current = { documentId: current.edit.documentId, frameId: layout!.frameId,
      source: useEditorStore.getState().source, from: current.imageFrom };
  };

  const begin = (event: ReactPointerEvent<SVGElement>, target: DeckResizeTarget) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.focus();
    const current = prepare(target);
    const svg = svgRef.current;
    if (!current || !svg) return;
    const origin = clientToSvgPoint(clientPoint(px(event.clientX), px(event.clientY)), svg);
    if (!origin) return;
    // Freeze the view transform as well as the source: reflow must not move the drag origin.
    const inverse = svg.getScreenCTM()?.inverse();
    const pointerId = event.pointerId;
    let frame: number | null = null;
    let latest: PointerEvent | null = null;
    const preview = (sample: PointerEvent) => {
      if (session.current !== current) return;
      if (!valid(current)) { stop(false); return; }
      const point = svg.createSVGPoint(); point.x = sample.clientX; point.y = sample.clientY;
      const next = inverse ? point.matrixTransform(inverse) : clientToSvgPoint(clientPoint(px(sample.clientX), px(sample.clientY)), svg);
      if (!next) return;
      current.patches = patchesFor(current.edit.baseSource, target, next.x - origin.x, next.y - origin.y);
      const nextSource = patchedSource(current.edit.baseSource, current.patches);
      if (nextSource === current.edit.latestSource) return;
      const { dispatch } = useEditorStore.getState();
      // Store subscribers run during dispatch; mark the expected transition before notifying them.
      const previous = current.edit.latestSource;
      const revision = current.edit.latestRevision;
      current.edit.latestSource = nextSource; current.edit.latestRevision = revision + 1;
      dispatch({ type: "SET_SOURCE_TRANSIENT", documentId: current.edit.documentId, source: nextSource,
        expectedSource: previous, expectedSourceRevision: revision, changedSourceIds: [] });
      trackDocumentEdit(current.edit, useEditorStore.getState());
    };
    const move = (sample: PointerEvent) => {
      if (sample.pointerId !== pointerId) return;
      latest = sample;
      frame ??= requestAnimationFrame(() => { frame = null; if (latest) preview(latest); });
    };
    const up = (sample: PointerEvent) => { if (sample.pointerId === pointerId) { preview(sample); stop(true); } };
    const cancel = (sample: PointerEvent) => { if (sample.pointerId === pointerId) stop(false); };
    const blur = () => { stop(false); };
    const key = (sample: KeyboardEvent) => {
      if (sample.key === "Escape") { sample.preventDefault(); sample.stopPropagation(); stop(false); }
    };
    const wheel = (sample: WheelEvent) => { sample.preventDefault(); sample.stopPropagation(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    svg.addEventListener("lostpointercapture", cancel);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", key, true);
    svg.addEventListener("wheel", wheel, { passive: false, capture: true });
    current.cleanup = () => {
      if (frame != null) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      svg.removeEventListener("lostpointercapture", cancel);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", key, true);
      svg.removeEventListener("wheel", wheel, true);
      if (svg.hasPointerCapture?.(pointerId)) svg.releasePointerCapture(pointerId);
    };
    session.current = current;
    svg.setPointerCapture?.(pointerId);
    useEditorStore.getState().dispatch({ type: "SET_ACTIVE_INSPECTOR_EDIT", documentId: current.edit.documentId });
    setDragging(target);
  };
  return { dragging, begin, nudge };
}
