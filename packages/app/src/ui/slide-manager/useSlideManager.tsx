import { Actions } from "flexlayout-react";
import { useCallback, useEffect, useMemo, useState, type RefObject, type MouseEvent } from "react";
import { analyzeBeamerSlideMove, copyBeamerSlides, beamerSlideIsEditable, editBeamerSlides, type BeamerSlideMoveAnalysis, type BeamerDocumentModel, type BeamerSlideDestination, type BeamerSlideEdit } from "@tikz-editor/core/beamer/index";
import { formatDocumentRootId, parseDocumentRootId } from "@tikz-editor/core/document/root-id";
import { APP_MENU_COMMAND_IDS as IDS, type AppMenuItem } from "../../app-menu";
import { CANVAS_CONTEXT_MENU_DEFINITION } from "../../context-menu";
import { useEditorStore } from "../../store/store";
import { getActiveEditorPlatform } from "../../platform/current";
import { SlideMoveReview } from "./SlideMoveReview";
import { getDockLayoutHandle } from "../DockLayout";
import { CanvasContextMenu } from "../CanvasContextMenu";
import type { CommandBinding, CommandBindings } from "../editor-command-runtime";

export function useSlideManager(model: BeamerDocumentModel | null, containerRef: RefObject<HTMLDivElement | null>) {
  const documentId = useEditorStore(s => s.activeDocumentId);
  const doc = useEditorStore(s => s.documents[s.activeDocumentId]);
  const dispatch = useEditorStore(s => s.dispatch);
  const busy = useEditorStore(s => !!s.activeCanvasTextEditSourceId || !!s.activeInspectorEditDocumentId);
  const selection = doc.deckSlideSelection?.source === doc.source ? doc.deckSlideSelection : null;
  const root = parseDocumentRootId(doc.activeRootId ?? "");
  const frameId = root?.kind === "beamer-frame-tikz" ? formatDocumentRootId({ kind: "beamer-frame", index: root.frameIndex }) : doc.activeRootId;
  const ids = selection?.frameIds ?? (frameId ? [frameId] : []);
  const anchorId = selection?.anchorId ?? frameId;
  const editable = useMemo(() => model?.frames.filter(frame => beamerSlideIsEditable(doc.source, frame)).map(frame => frame.id) ?? [], [model, doc.source]);
  const enabled = !!model && model.source === doc.source && !doc.assistantLockReason && !busy;
  // Allow attempted moves so the analysis can explain structural restrictions.
  const movable = model?.frames.map(frame => frame.id) ?? [];
  const canMoveSelection = enabled && ids.length > 0 && ids.every(id => movable.includes(id));
  const canEditSelection = enabled && ids.length > 0 && ids.every(id => editable.includes(id));
  const [menu, setMenu] = useState<{ revision: number; documentId: string; anchor: { x: number; y: number }; bindings: CommandBindings } | null>(null);
  const [pending, setPending] = useState<{ documentId: string; revision: number; edit: Extract<BeamerSlideEdit, { kind: "move" }>; analysis: BeamerSlideMoveAnalysis } | null>(null);
  useEffect(() => { setPending(null); }, [documentId, doc.sourceRevision, enabled]);
  const currentReview = pending?.documentId === documentId && pending.revision === doc.sourceRevision && enabled ? pending : null;
  const closeMenu = useCallback(() => {
    setMenu(null);
    containerRef.current?.querySelector<HTMLButtonElement>('[data-slide-id] button[data-selected]')?.focus();
  }, [containerRef]);
  const select = (id: string, modifiers: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {}, open = true) => {
    if (!model) return;
    let next = [id];
    let anchor = id;
    if (modifiers.shiftKey && anchorId) {
      const from = model.frames.findIndex(frame => frame.id === anchorId), to = model.frames.findIndex(frame => frame.id === id);
      next = model.frames.slice(Math.max(0, Math.min(from, to)), Math.max(from, to) + 1).map(frame => frame.id);
      anchor = anchorId;
    } else if (modifiers.metaKey || modifiers.ctrlKey) {
      next = ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];
    }
    dispatch({ type: "SELECT_DECK_SLIDES", documentId, baseRevision: doc.sourceRevision, frameIds: next, anchorId: anchor,
      ...(open && !(modifiers.ctrlKey || modifiers.metaKey || modifiers.shiftKey) ? { activeFrameId: id } : {}) });
  };
  const edit = (operation: BeamerSlideEdit, revision = doc.sourceRevision) => {
    if (!enabled || revision !== doc.sourceRevision) return;
    if (operation.kind === "move") {
      const analysis = analyzeBeamerSlideMove(doc.source, operation);
      if (analysis.status !== "safe") {
        setPending({ documentId, revision, edit: operation, analysis });
        return;
      }
    }
    dispatch({ type: "EDIT_DECK_SLIDES", documentId, baseRevision: revision, edit: operation });
  };
  const copyText = (chosen = ids) => enabled ? copyBeamerSlides(doc.source, chosen) : null;
  const copy = async (chosen = ids) => {
    const text = copyText(chosen);
    if (text == null) return;
    try {
      const clipboard = getActiveEditorPlatform().clipboard;
      if (clipboard?.writeText) await clipboard.writeText(text);
      else await navigator.clipboard.writeText(text);
    } catch {
      window.alert("Could not copy the slides to the clipboard. Try Cmd/Ctrl+C while the Slides panel is focused.");
    }
  };
  const pasteText = (source: string, chosen = ids) => {
    if (!enabled) return;
    const last = model?.frames.filter(frame => chosen.includes(frame.id)).at(-1);
    const destination: BeamerSlideDestination = last ? { kind: "after", frameId: last.id } : { kind: "end" };
    edit({ kind: "paste", source, destination });
  };
  const paste = async (chosen = ids) => {
    if (!enabled) return;
    const state = useEditorStore.getState();
    const selectionBefore = state.documents[documentId]?.deckSlideSelection;
    const rootBefore = state.activeRootId;
    try {
      const clipboard = getActiveEditorPlatform().clipboard;
      const text = clipboard?.readText ? await clipboard.readText() : await navigator.clipboard.readText();
      const current = useEditorStore.getState();
      // Do not apply an asynchronous clipboard read to a changed document or selection.
      if (current.activeDocumentId !== documentId || current.sourceRevision !== doc.sourceRevision ||
        current.activeRootId !== rootBefore || current.documents[documentId]?.deckSlideSelection !== selectionBefore) return;
      pasteText(text, chosen);
    } catch {
      window.alert("Could not read slides from the clipboard. Try Cmd/Ctrl+V while the Slides panel is focused.");
    }
  };
  const contextMenu = (event: MouseEvent, frameId: string) => {
    if (!model) return;
    event.preventDefault(); event.stopPropagation();
    (event.currentTarget as HTMLElement).focus();
    const chosen = ids.includes(frameId) ? ids : [frameId];
    if (!ids.includes(frameId)) select(frameId);
    const valid = () => {
      const state = useEditorStore.getState();
      return state.activeDocumentId === documentId && state.sourceRevision === doc.sourceRevision;
    };
    const available = enabled && chosen.every(id => editable.includes(id));
    const bindings = Object.fromEntries<CommandBinding>(Object.values(IDS).map(id => [id, { enabled: false, run: () => {} }])) as CommandBindings;
    bindings[IDS.COPY] = { enabled: available, run: () => { if (valid()) void copy(chosen); } };
    bindings[IDS.PASTE] = { enabled, run: () => { if (valid()) void paste(chosen); } };
    bindings[IDS.DUPLICATE] = { enabled: available && editBeamerSlides(doc.source, { kind: "duplicate", frameIds: chosen }) != null,
      run: () => { if (valid()) edit({ kind: "duplicate", frameIds: chosen }); } };
    bindings[IDS.DELETE] = { enabled: available, run: () => { if (valid()) edit({ kind: "delete", frameIds: chosen }); } };
    bindings[IDS.UNDO] = { enabled: !doc.assistantLockReason && doc.historyIndex >= 0, run: () => { if (valid()) dispatch({ type: "UNDO" }); } };
    bindings[IDS.REDO] = { enabled: !doc.assistantLockReason && doc.historyIndex < doc.history.length - 1, run: () => { if (valid()) dispatch({ type: "REDO" }); } };
    const platform = getActiveEditorPlatform();
    if (platform.menu?.usesNativeContextMenus && platform.menu.showNativeContextMenu) {
      void platform.menu.showNativeContextMenu({ items: MENU_ITEMS, commandStates: bindings,
        onCommandRun: (id, origin) => { if (valid() && bindings[id].enabled) void bindings[id].run(origin); } });
    } else {
      const box = containerRef.current?.getBoundingClientRect();
      setMenu({ revision: doc.sourceRevision, documentId, anchor: { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }, bindings });
    }
  };
  return { ids, anchorId, select, edit, copy, copyText, paste, pasteText, enabled, editable, movable, canEditSelection, canMoveSelection, contextMenu,
    selectAll: () => { dispatch({ type: "SELECT_DECK_SLIDES", documentId, baseRevision: doc.sourceRevision,
      frameIds: model?.frames.map(frame => frame.id) ?? [], anchorId }); },
    review: currentReview ? <SlideMoveReview analysis={currentReview.analysis} onClose={() => { setPending(null); }}
      onConfirm={() => {
        dispatch({ type: "EDIT_DECK_SLIDES", documentId: currentReview.documentId, baseRevision: currentReview.revision, edit: currentReview.edit, allowWarnings: true });
        setPending(null);
      }} onReveal={span => {
        setPending(null);
        const layout = getDockLayoutHandle();
        if (layout && !layout.getModel().getNodeById("source")) layout.togglePanel("source");
        layout?.getModel().doAction(Actions.selectTab("source"));
        dispatch({ type: "REVEAL_SOURCE", documentId: currentReview.documentId, sourceRevision: currentReview.revision, span });
      }} /> : null,
    menu: menu?.documentId === documentId && menu.revision === doc.sourceRevision ?
      <CanvasContextMenu open anchor={menu.anchor} target="selection-multi" containerRef={containerRef} bindings={menu.bindings}
        definition={{ ...CANVAS_CONTEXT_MENU_DEFINITION, "selection-multi": MENU_ITEMS }} onClose={closeMenu}
        onCommandRun={(id, origin) => { if (menu.bindings[id].enabled) void menu.bindings[id].run(origin); }} /> : null };
}
const MENU_ITEMS: readonly AppMenuItem[] = [
  { kind: "command", commandId: IDS.COPY, label: "Copy" },
  { kind: "command", commandId: IDS.PASTE, label: "Paste" },
  { kind: "separator" },
  { kind: "command", commandId: IDS.DUPLICATE, label: "Duplicate" },
  { kind: "command", commandId: IDS.DELETE, label: "Delete" },
  { kind: "separator" },
  { kind: "command", commandId: IDS.UNDO, label: "Undo" },
  { kind: "command", commandId: IDS.REDO, label: "Redo" },
];
