import { beginDocumentEdit, canContinueDocumentEdit, restoreDocumentEdit, trackDocumentEdit, type DocumentEditSession } from "../../edit-session";
import { createFrameEditQueue } from "../frame-edit-queue";
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { InspectorDescriptor } from "@tikz-editor/core/edit/inspector";
import type { EditorAction } from "../../store/types";
import { useEditorStore } from "../../store/store";
import { createNumberScrubState, updateNumberScrubState } from "./number-scrub";
import type { InspectorPropertyProvenanceMap, MultiInspectorModel } from "./panel-helpers";
import type { FrozenInspectorView } from "./useInspectorModel";

type NumberLabelScrubBinding = {
  writable: boolean;
  value: number;
  step: number;
  min?: number;
  max?: number;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
};

type HoverPreviewSession = {
  ownerKey: string;
  edit: DocumentEditSession;
};

type NumberLabelScrubSession = {
  pointerId: number;
  edit: DocumentEditSession;
  state: ReturnType<typeof createNumberScrubState>;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
};

export function useInspectorPreviewScrub(args: {
  dispatch: (action: EditorAction) => void;
  selectedSourceIds: string[];
  descriptor: InspectorDescriptor | null;
  multiModel: MultiInspectorModel | null;
  singlePropertyProvenance: InspectorPropertyProvenanceMap;
  multiPropertyProvenance: InspectorPropertyProvenanceMap;
  setFrozenInspectorView: (v: FrozenInspectorView | null) => void;
}) {
  const {
    dispatch,
    selectedSourceIds,
    descriptor,
    multiModel,
    singlePropertyProvenance,
    multiPropertyProvenance,
    setFrozenInspectorView
  } = args;

  const hoverPreviewSessionRef = useRef<HoverPreviewSession | null>(null);
  const numberLabelScrubSessionRef = useRef<NumberLabelScrubSession | null>(null);
  const numberLabelScrubListenersAttachedRef = useRef(false);
  const activeDocumentId = useEditorStore(state => state.activeDocumentId);
  const activeRootId = useEditorStore(state => state.activeRootId);
  const selectedIdsRef = useRef(selectedSourceIds);
  selectedIdsRef.current = selectedSourceIds;
  const beginEdit = useCallback(() => {
    const session = beginDocumentEdit(useEditorStore.getState(), [...selectedIdsRef.current]);
    dispatch({ type: "SET_ACTIVE_INSPECTOR_EDIT", documentId: session.documentId });
    return session;
  }, [dispatch]);
  const endEdit = useCallback(() => { dispatch({ type: "SET_ACTIVE_INSPECTOR_EDIT", documentId: null }); }, [dispatch]);
  const restore = useCallback((edit: DocumentEditSession) => restoreDocumentEdit(edit, useEditorStore.getState, dispatch), [dispatch]);

  const clearHoverPreviewSession = useCallback((ownerKey?: string) => {
    const current = hoverPreviewSessionRef.current;
    if (!current || (ownerKey && current.ownerKey !== ownerKey)) return;
    restore(current.edit);
    hoverPreviewSessionRef.current = null;
    endEdit();
    setFrozenInspectorView(null);
  }, [endEdit, restore, setFrozenInspectorView]);

  const restoreHoverPreviewBase = useCallback((ownerKey?: string) => {
    const current = hoverPreviewSessionRef.current;
    if (current && (!ownerKey || current.ownerKey === ownerKey)) restore(current.edit);
  }, [restore]);

  const applyHoverPreview = useCallback((ownerKey: string, applyPreview: () => void) => {
    let current = hoverPreviewSessionRef.current;
    if (current && !canContinueDocumentEdit(current.edit, useEditorStore.getState())) {
      clearHoverPreviewSession();
      return;
    }
    if (current?.ownerKey !== ownerKey) {
      if (current) restore(current.edit);
      current = { ownerKey, edit: beginEdit() };
      hoverPreviewSessionRef.current = current;
      setFrozenInspectorView({ selectedSourceIds: [...selectedSourceIds], descriptor, multiModel,
        singlePropertyProvenance, multiPropertyProvenance });
    }
    applyPreview();
    trackDocumentEdit(current.edit, useEditorStore.getState());
  }, [beginEdit, clearHoverPreviewSession, descriptor, multiModel, multiPropertyProvenance, restore,
    selectedSourceIds, setFrozenInspectorView, singlePropertyProvenance]);

  const commitAfterHoverPreview = useCallback((ownerKey: string, commit: () => void) => {
    const current = hoverPreviewSessionRef.current;
    if (current?.ownerKey === ownerKey) {
      const canCommit = canContinueDocumentEdit(current.edit, useEditorStore.getState()) && restore(current.edit);
      hoverPreviewSessionRef.current = null;
      endEdit();
      setFrozenInspectorView(null);
      if (!canCommit) return;
    }
    commit();
  }, [endEdit, restore, setFrozenInspectorView]);

  const stopNumberLabelScrubRef = useRef<(commit: boolean, pointerId?: number) => void>(() => {});

  const applyNumberLabelScrubMove = useCallback((event: PointerEvent) => {
    const session = numberLabelScrubSessionRef.current;
    if (event.pointerId !== session?.pointerId || !canContinueDocumentEdit(session.edit, useEditorStore.getState())) {
      return;
    }

    const result = updateNumberScrubState(session.state, {
      currentX: event.clientX,
      modifiers: {
        shiftKey: event.shiftKey,
        altKey: event.altKey
      }
    });
    session.state = result.nextState;
    if (result.didActivate) {
      document.body.classList.add("is-scrubbing");
    }
    if (result.nextValue == null) {
      return;
    }
    session.onPreview(result.nextValue);
    trackDocumentEdit(session.edit, useEditorStore.getState());
  }, []);

  const moveQueueRef = useRef<ReturnType<typeof createFrameEditQueue<NumberLabelScrubSession, PointerEvent>> | null>(null);
  const handleNumberLabelScrubPointerMove = useCallback((event: PointerEvent) => {
    const session = numberLabelScrubSessionRef.current;
    if (event.pointerId !== session?.pointerId) return;
    moveQueueRef.current ??= createFrameEditQueue((owner, sample) => {
      if (owner === numberLabelScrubSessionRef.current) applyNumberLabelScrubMove(sample);
    });
    moveQueueRef.current.push(session, event);
  }, [applyNumberLabelScrubMove]);
  const handleNumberLabelScrubPointerUp = useCallback((event: PointerEvent) => {
    const session = numberLabelScrubSessionRef.current;
    if (event.pointerId !== session?.pointerId) return;
    // The release position can be newer than the last move event.
    moveQueueRef.current?.cancel();
    applyNumberLabelScrubMove(event);
    stopNumberLabelScrubRef.current(true, event.pointerId);
  }, [applyNumberLabelScrubMove]);

  const handleNumberLabelScrubPointerCancel = useCallback((event: PointerEvent) => {
    stopNumberLabelScrubRef.current(false, event.pointerId);
  }, []);

  const handleNumberLabelScrubWindowBlur = useCallback(() => {
    stopNumberLabelScrubRef.current(false);
  }, []);

  const removeNumberLabelScrubListeners = useCallback(() => {
    if (!numberLabelScrubListenersAttachedRef.current) {
      return;
    }
    window.removeEventListener("pointermove", handleNumberLabelScrubPointerMove);
    window.removeEventListener("pointerup", handleNumberLabelScrubPointerUp);
    window.removeEventListener("pointercancel", handleNumberLabelScrubPointerCancel);
    window.removeEventListener("blur", handleNumberLabelScrubWindowBlur);
    numberLabelScrubListenersAttachedRef.current = false;
  }, [
    handleNumberLabelScrubPointerCancel,
    handleNumberLabelScrubPointerMove,
    handleNumberLabelScrubPointerUp,
    handleNumberLabelScrubWindowBlur
  ]);

  const stopNumberLabelScrub = useCallback((commit: boolean, pointerId?: number) => {
    const session = numberLabelScrubSessionRef.current;
    if (!session || (pointerId != null && pointerId !== session.pointerId)) {
      return;
    }
    numberLabelScrubSessionRef.current = null;
    removeNumberLabelScrubListeners();

    moveQueueRef.current?.cancel();
    const canCommit = canContinueDocumentEdit(session.edit, useEditorStore.getState());
    if (session.state.hasActivated && restore(session.edit) && commit && canCommit) {
      session.onCommit(session.state.lastValue);
    }

    endEdit();
    document.body.classList.remove("is-scrubbing");
  }, [endEdit, restore, removeNumberLabelScrubListeners]);

  useEffect(() => {
    stopNumberLabelScrubRef.current = stopNumberLabelScrub;
  }, [stopNumberLabelScrub]);

  const ensureNumberLabelScrubListeners = useCallback(() => {
    if (numberLabelScrubListenersAttachedRef.current) {
      return;
    }
    window.addEventListener("pointermove", handleNumberLabelScrubPointerMove);
    window.addEventListener("pointerup", handleNumberLabelScrubPointerUp);
    window.addEventListener("pointercancel", handleNumberLabelScrubPointerCancel);
    window.addEventListener("blur", handleNumberLabelScrubWindowBlur);
    numberLabelScrubListenersAttachedRef.current = true;
  }, [
    handleNumberLabelScrubPointerCancel,
    handleNumberLabelScrubPointerMove,
    handleNumberLabelScrubPointerUp,
    handleNumberLabelScrubWindowBlur
  ]);

  const beginNumberLabelScrub = useCallback((event: ReactPointerEvent<HTMLElement>, binding: NumberLabelScrubBinding) => {
    if (!binding.writable || event.button !== 0 || event.ctrlKey || event.metaKey) {
      return;
    }
    event.preventDefault();
    clearHoverPreviewSession();
    stopNumberLabelScrub(false);

    numberLabelScrubSessionRef.current = {
      pointerId: event.pointerId,
      edit: beginEdit(),
      state: createNumberScrubState({
        startX: event.clientX,
        startValue: binding.value,
        step: binding.step,
        min: binding.min,
        max: binding.max
      }),
      onPreview: binding.onPreview,
      onCommit: binding.onCommit
    };
    ensureNumberLabelScrubListeners();
  }, [beginEdit, clearHoverPreviewSession, ensureNumberLabelScrubListeners, stopNumberLabelScrub]);

  useEffect(() => {
    clearHoverPreviewSession();
    stopNumberLabelScrub(false);
  }, [activeDocumentId, activeRootId, selectedSourceIds, clearHoverPreviewSession, stopNumberLabelScrub]);

  useEffect(() => {
    return () => {
      clearHoverPreviewSession();
      stopNumberLabelScrub(false);
    };
  }, [clearHoverPreviewSession, stopNumberLabelScrub]);

  return {
    clearHoverPreviewSession,
    restoreHoverPreviewBase,
    applyHoverPreview,
    commitAfterHoverPreview,
    beginNumberLabelScrub
  };
}
