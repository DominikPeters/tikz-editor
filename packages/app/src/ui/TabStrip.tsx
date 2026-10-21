import { useRef, useState } from "react";
import { useEditorStore } from "../store/store";
import css from "./TabStrip.module.css";
import { NEW_BEAMER_SOURCE } from "../presentation/launch";

function reorder(order: string[], fromId: string, toId: string): string[] {
  const from = order.indexOf(fromId);
  const to = order.indexOf(toId);
  if (from === -1 || to === -1 || from === to) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, fromId);
  return next;
}

export function TabStrip({
  onRequestCloseDocument
}: {
  onRequestCloseDocument?: (documentId: string) => void;
} = {}) {
  const documents = useEditorStore((s) => s.documents);
  const tabOrder = useEditorStore((s) => s.tabOrder);
  const activeDocumentId = useEditorStore((s) => s.activeDocumentId);
  const dispatch = useEditorStore((s) => s.dispatch);

  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const previewOrder =
    dragId.current && dragOverId
      ? reorder(tabOrder, dragId.current, dragOverId)
      : tabOrder;

  return (
    <div className={css.strip} role="tablist" aria-label="Documents" data-testid="tab-strip" data-select="chrome">
      {previewOrder.map((id) => {
        const doc = documents[id];
        if (!doc) {
          return null;
        }
        const active = id === activeDocumentId;
        const dragging = id === dragId.current && dragOverId !== null;
        return (
          <div
            key={id}
            className={[css.tab, active ? css.tabActive : "", dragging ? css.tabDragging : ""].filter(Boolean).join(" ")}
            role="tab"
            aria-selected={active}
            data-testid={`tab-${id}`}
            draggable
            onDragStart={() => { dragId.current = id; }}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragId.current && dragId.current !== id) setDragOverId(id);
            }}
            onDrop={() => {
              if (dragId.current && dragOverId && dragId.current !== dragOverId) {
                dispatch({ type: "REORDER_TABS", fromId: dragId.current, toId: dragOverId });
              }
              dragId.current = null;
              setDragOverId(null);
            }}
            onDragEnd={() => {
              dragId.current = null;
              setDragOverId(null);
            }}
          >
            <button
              type="button"
              className={css.tabButton}
              onClick={() => { dispatch({ type: "SWITCH_DOCUMENT", documentId: id }); }}
              data-testid={`tab-switch-${id}`}
            >
              <span className={css.title}>{doc.title}</span>
              {doc.dirty ? (
                <svg className={css.dirty} width="6" height="6" viewBox="0 0 6 6" aria-label="Unsaved changes">
                  <title>Unsaved changes</title>
                  <circle cx="3" cy="3" r="3" />
                </svg>
              ) : null}
              {doc.externalChangeStatus !== "none" ? (
                <svg className={css.externalChange} width="7" height="7" viewBox="0 0 7 7" aria-label="File changed on disk">
                  <title>File changed on disk</title>
                  <path d="M3.5 0 7 7H0Z" />
                </svg>
              ) : null}
            </button>
            <button
              type="button"
              className={css.close}
              aria-label={`Close ${doc.title}`}
              onClick={() => {
                if (onRequestCloseDocument) {
                  onRequestCloseDocument(id);
                  return;
                }
                dispatch({ type: "CLOSE_DOCUMENT", documentId: id });
              }}
              data-testid={`tab-close-${id}`}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
                <line x1="1" y1="1" x2="7" y2="7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                <line x1="7" y1="1" x2="1" y2="7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className={css.add}
        onClick={() => { dispatch(useEditorStore.getState().documentKind === "beamer" ? { type: "NEW_DOCUMENT", source: NEW_BEAMER_SOURCE } : { type: "NEW_DOCUMENT" }); }}
        aria-label="New document"
        data-testid="tab-new"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <line x1="5" y1="1" x2="5" y2="9" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
