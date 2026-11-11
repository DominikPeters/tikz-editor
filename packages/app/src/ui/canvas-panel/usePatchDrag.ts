import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { clientPoint, px } from "@tikz-editor/core/coords/index";
import type { SourcePatch } from "@tikz-editor/core/edit/types";
import { restoreDocumentEdit, trackDocumentEdit, type DocumentEditSession } from "../../edit-session";
import { useEditorStore } from "../../store/store";
import { clientToSvgPoint } from "./geometry";

/**
 * A canvas drag that rewrites source: each pointer move recomputes patches
 * against the source the drag began from and previews them transiently;
 * release commits them as one undoable edit, Escape or any intervening edit
 * cancels. Shared by slide handles (columns, spacing, image size and crop)
 * and image crop in TikZ figures.
 */
export type PatchDragSession<Target> = {
  edit: DocumentEditSession;
  target: Target;
  patches: SourcePatch[];
  cleanup: () => void;
};

export function patchedSource(source: string, patches: readonly SourcePatch[]): string {
  return [...patches].reverse().reduce((text, patch) => text.slice(0, patch.oldSpan.from) + patch.replacement + text.slice(patch.oldSpan.to), source);
}

export function usePatchDrag<Target>({ svgRef, valid, patchesFor, afterStop }: {
  svgRef: RefObject<SVGSVGElement | null>;
  /** Whether the drag still owns the document; checked on every store change. */
  valid: (session: PatchDragSession<Target>) => boolean;
  /** Patches for a drag by (dx, dy) SVG units from where it began, against `base`. */
  patchesFor: (base: string, target: Target, dx: number, dy: number) => SourcePatch[];
  /** After the source is restored (and, on commit, the patches applied). */
  afterStop?: (session: PatchDragSession<Target>, restored: boolean) => void;
}) {
  const session = useRef<PatchDragSession<Target> | null>(null);
  const [dragging, setDragging] = useState<Target | null>(null);
  const callbacks = useRef({ valid, patchesFor, afterStop });
  callbacks.current = { valid, patchesFor, afterStop };

  const stop = useCallback((commit: boolean) => {
    const current = session.current;
    if (!current) return;
    session.current = null;
    current.cleanup();
    const { dispatch } = useEditorStore.getState();
    const canCommit = callbacks.current.valid(current);
    const restored = restoreDocumentEdit(current.edit, useEditorStore.getState, dispatch);
    dispatch({ type: "SET_ACTIVE_INSPECTOR_EDIT", documentId: null });
    if (commit && canCommit && restored && current.patches.length) {
      dispatch({ type: "APPLY_SOURCE_PATCHES", documentId: current.edit.documentId,
        baseRevision: current.edit.latestRevision, patches: current.patches, changedSourceIds: [] });
    }
    callbacks.current.afterStop?.(current, restored);
    setDragging(null);
  }, []);

  // Synchronous ownership checks avoid overwriting typing, undo, tab changes, or a step change.
  useEffect(() => useEditorStore.subscribe(() => {
    if (session.current && !callbacks.current.valid(session.current)) stop(false);
  }), [stop]);
  useEffect(() => () => { stop(false); }, [stop]);

  const begin = useCallback((event: ReactPointerEvent<SVGElement>, current: PatchDragSession<Target>): boolean => {
    const svg = svgRef.current;
    if (session.current || !svg) return false;
    const pointerCapture: Partial<Pick<SVGSVGElement, "setPointerCapture" | "hasPointerCapture" | "releasePointerCapture">> = svg;
    const origin = clientToSvgPoint(clientPoint(px(event.clientX), px(event.clientY)), svg);
    // Freeze the view transform as well as the source: reflow must not move the drag origin.
    const inverse = svg.getScreenCTM()?.inverse();
    if (!origin || !inverse) return false;
    const pointerId = event.pointerId;
    let frame: number | null = null;
    let latest: PointerEvent | null = null;
    const preview = (sample: PointerEvent) => {
      if (session.current !== current) return;
      if (!callbacks.current.valid(current)) { stop(false); return; }
      const point = svg.createSVGPoint(); point.x = sample.clientX; point.y = sample.clientY;
      const next = point.matrixTransform(inverse);
      current.patches = callbacks.current.patchesFor(current.edit.baseSource, current.target, next.x - origin.x, next.y - origin.y);
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
    const up = (sample: PointerEvent) => {
      if (sample.pointerId !== pointerId) return;
      preview(sample);
      stop(true);
      // WebKit can retarget the drag's compatibility click to the capturing
      // SVG, where it looks like a background click and clears the restored
      // selection. Consume that click, then remove the listener even when the
      // browser generates no click, so the next real click works.
      const consumeClick = (click: MouseEvent) => { click.preventDefault(); click.stopPropagation(); };
      window.addEventListener("click", consumeClick, { capture: true, once: true });
      setTimeout(() => { window.removeEventListener("click", consumeClick, true); }, 0);
    };
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
      if (pointerCapture.hasPointerCapture?.(pointerId)) pointerCapture.releasePointerCapture?.(pointerId);
    };
    session.current = current;
    pointerCapture.setPointerCapture?.(pointerId);
    useEditorStore.getState().dispatch({ type: "SET_ACTIVE_INSPECTOR_EDIT", documentId: current.edit.documentId });
    setDragging(current.target);
    return true;
  }, [stop, svgRef]);
  const active = useCallback(() => session.current != null, []);
  const current = useCallback(() => session.current, []);

  return useMemo(() => ({ dragging, begin, stop, active, current }), [dragging, begin, stop, active, current]);
}
