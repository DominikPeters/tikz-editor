import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { beamerBuildBoundaryPatch, beamerBuildRange, type BeamerBuildBoundary, type BeamerBuildModel, type BeamerBuildRow } from "@tikz-editor/core/beamer/index";
import type { SourcePatch } from "@tikz-editor/core/edit/types";
import { beginDocumentEdit, canContinueDocumentEdit, restoreDocumentEdit, trackDocumentEdit, type DocumentEditSession } from "../../edit-session";
import { useEditorStore } from "../../store/store";

type DragSession = {
  edit: DocumentEditSession;
  model: BeamerBuildModel;
  rowId: string;
  boundary: BeamerBuildBoundary;
  pointerId: number;
  originX: number;
  originStep: number;
  stepWidth: number;
  patch: SourcePatch | null;
  removeListeners: () => void;
};

export function useBuildBoundaryDrag() {
  const session = useRef<DragSession | null>(null);
  const [drag, setDrag] = useState<{ rowId: string; steps: number[] } | null>(null);
  const documentId = useEditorStore((s) => s.activeDocumentId);
  const frameId = useEditorStore((s) => s.activeRootId);
  const revision = useEditorStore((s) => s.sourceRevision);
  const locked = useEditorStore((s) => s.activeCanvasTextEditSourceId != null || s.documents[s.activeDocumentId]?.assistantLockReason != null);

  const stop = useCallback((commit: boolean) => {
    const current = session.current;
    if (!current) return;
    session.current = null;
    current.removeListeners();
    const { dispatch } = useEditorStore.getState();
    const canCommit = canContinueDocumentEdit(current.edit, useEditorStore.getState());
    const restored = restoreDocumentEdit(current.edit, useEditorStore.getState, dispatch);
    dispatch({ type: "SET_ACTIVE_INSPECTOR_EDIT", documentId: null });
    if (commit && canCommit && restored && current.patch) {
      dispatch({ type: "APPLY_SOURCE_PATCHES", documentId: current.edit.documentId,
        baseRevision: current.edit.latestRevision, patches: [current.patch], changedSourceIds: [] });
    }
    setDrag(null);
  }, []);

  useEffect(() => {
    if (session.current && (locked || !canContinueDocumentEdit(session.current.edit, useEditorStore.getState()))) stop(false);
  }, [documentId, frameId, locked, revision, stop]);
  useEffect(() => () => { stop(false); }, [stop]);

  const begin = (event: ReactPointerEvent<HTMLButtonElement>, model: BeamerBuildModel, row: BeamerBuildRow, boundary: BeamerBuildBoundary, steps: number[]) => {
    if (event.button !== 0 || locked || session.current) return;
    const range = beamerBuildRange(row);
    const originStep = boundary === "start" ? range?.from : range?.to;
    const state = useEditorStore.getState();
    if (originStep == null || state.source !== model.source || state.activeRootId !== model.frameId) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    // Focusing can commit a pending inspector field. Its new source owns the edit.
    if (useEditorStore.getState().source !== model.source) return;
    const edit = beginDocumentEdit(useEditorStore.getState(), []);
    const cellWidth = event.currentTarget.closest("td")?.getBoundingClientRect().width ?? 0;
    const current: DragSession = {
      edit, model, rowId: row.id, boundary, pointerId: event.pointerId,
      originX: event.clientX, originStep,
      stepWidth: cellWidth > 0 ? cellWidth : 24,
      patch: null, removeListeners: () => {},
    };
    const move = (sample: PointerEvent) => {
      if (sample.pointerId !== current.pointerId || session.current !== current) return;
      if (!canContinueDocumentEdit(edit, useEditorStore.getState())) { stop(false); return; }
      const nextStep = Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, originStep + Math.round((sample.clientX - current.originX) / current.stepWidth)));
      const patch = beamerBuildBoundaryPatch(model, row.id, boundary, nextStep);
      const nextSource = patch ? model.source.slice(0, patch.oldSpan.from) + patch.replacement + model.source.slice(patch.oldSpan.to) : model.source;
      current.patch = patch;
      if (nextSource === edit.latestSource) return;
      useEditorStore.getState().dispatch({ type: "SET_SOURCE_TRANSIENT", documentId: edit.documentId,
        source: nextSource, expectedSource: edit.latestSource, expectedSourceRevision: edit.latestRevision, changedSourceIds: [] });
      trackDocumentEdit(edit, useEditorStore.getState());
    };
    const up = (sample: PointerEvent) => {
      if (sample.pointerId !== current.pointerId) return;
      move(sample);
      stop(true);
    };
    const cancel = (sample: PointerEvent) => { if (sample.pointerId === current.pointerId) stop(false); };
    const blur = () => { stop(false); };
    const key = (sample: KeyboardEvent) => {
      if (sample.key === "Escape") { sample.preventDefault(); sample.stopPropagation(); stop(false); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", key, true);
    current.removeListeners = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", key, true);
    };
    session.current = current;
    state.dispatch({ type: "SET_ACTIVE_INSPECTOR_EDIT", documentId: edit.documentId });
    setDrag({ rowId: row.id, steps });
  };

  return { drag, begin };
}
