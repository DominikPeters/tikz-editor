import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from "react";
import { RiAddLine, RiArrowLeftSLine, RiCloseLine, RiDraftLine, RiFolderOpenLine } from "@remixicon/react";
import { detectDocumentKind } from "@tikz-editor/core/document/kind";
import { useShallow } from "zustand/react/shallow";
import { APP_MENU_COMMAND_IDS, type AppMenuCommandId } from "../../app-menu";
import { useEditorStore } from "../../store/store";
import { DEFAULT_SOURCE } from "../../store/workspace-state";
import type { EditorCommandRuntime } from "../editor-command-runtime";
import { useDocumentThumbnails, type DocumentThumbnailSource } from "./useDocumentThumbnails";
import css from "./IpadDocumentGallery.module.css";

export type IpadDocumentGalleryProps = {
  open: boolean;
  onClose: () => void;
  commandRuntime: EditorCommandRuntime;
  onRequestCloseDocument: (documentId: string) => void;
};

export function IpadDocumentGallery({
  open,
  onClose,
  commandRuntime,
  onRequestCloseDocument
}: IpadDocumentGalleryProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const { documents, tabOrder, activeDocumentId, dispatch } = useEditorStore(useShallow((s) => ({
    documents: s.documents,
    tabOrder: s.tabOrder,
    activeDocumentId: s.activeDocumentId,
    dispatch: s.dispatch
  })));

  const galleryDocuments = useMemo(() => {
    const list: Array<DocumentThumbnailSource & { title: string; dirty: boolean; blank: boolean }> = [];
    for (const id of tabOrder) {
      const doc = documents[id];
      if (!doc) {
        continue;
      }
      list.push({
        id: doc.id,
        title: doc.title,
        dirty: doc.dirty,
        source: doc.source,
        activeRootId: doc.activeRootId,
        snapshotSvg: doc.snapshot.svg?.svg ?? null,
        snapshotSource: doc.snapshot.source,
        deck: detectDocumentKind(doc.source) === "beamer",
        blank: !doc.dirty && doc.fileRef == null && doc.source === DEFAULT_SOURCE
      });
    }
    return list;
  }, [documents, tabOrder]);

  const thumbnails = useDocumentThumbnails(galleryDocuments, open);

  const switchToDocument = useCallback((documentId: string) => {
    if (documentId !== activeDocumentId) {
      dispatch({ type: "SWITCH_DOCUMENT", documentId });
    }
    onClose();
  }, [activeDocumentId, dispatch, onClose]);

  // The gallery stays up behind the file picker or the examples sheet and
  // goes once the command brings in a document; a cancelled pick leaves it.
  const runCommand = useCallback((commandId: AppMenuCommandId) => {
    commandRuntime.runCommand(commandId, "platform");
  }, [commandRuntime]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const known = new Set(useEditorStore.getState().tabOrder);
    return useEditorStore.subscribe((state, previous) => {
      if (state.tabOrder === previous.tabOrder) {
        return;
      }
      // A count that grows: closing the last document swaps in a fresh one, which is not a document arriving.
      if (state.tabOrder.length > previous.tabOrder.length && state.tabOrder.some((id) => !known.has(id))) {
        onClose();
      }
    });
  }, [onClose, open]);

  const commandEnabled = useCallback((commandId: AppMenuCommandId): boolean => {
    return commandRuntime.bindings[commandId].enabled === true;
  }, [commandRuntime]);

  useEffect(() => {
    if (!open) {
      return;
    }
    overlayRef.current?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [onClose, open]);

  if (!open) {
    return null;
  }
  const activeTitle = (activeDocumentId ? documents[activeDocumentId]?.title : undefined) ?? "Back";

  return (
    <div
      ref={overlayRef}
      className={css.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Documents"
      tabIndex={-1}
      data-select="chrome"
      data-testid="ipad-document-gallery"
    >
      <header className={css.header}>
        <button
          type="button"
          className={css.backButton}
          onClick={onClose}
          aria-label={`Back to ${activeTitle}`}
          data-testid="ipad-gallery-close"
        >
          <RiArrowLeftSLine size={30} aria-hidden />
          <span className={css.backLabel}>{activeTitle}</span>
        </button>
        <div className={css.headerActions}>
          <button
            type="button"
            className={[css.actionButton, css.actionPrimary].join(" ")}
            disabled={!commandEnabled(APP_MENU_COMMAND_IDS.NEW_DOCUMENT)}
            onClick={() => { runCommand(APP_MENU_COMMAND_IDS.NEW_DOCUMENT); }}
            data-testid="ipad-gallery-new-document"
          >
            <RiAddLine size={18} aria-hidden />
            New Document
          </button>
          <button
            type="button"
            className={css.actionButton}
            disabled={!commandEnabled(APP_MENU_COMMAND_IDS.OPEN_DOCUMENT)}
            onClick={() => { runCommand(APP_MENU_COMMAND_IDS.OPEN_DOCUMENT); }}
            data-testid="ipad-gallery-open-document"
          >
            <RiFolderOpenLine size={18} aria-hidden />
            Open…
          </button>
          <button
            type="button"
            className={css.actionButton}
            disabled={!commandEnabled(APP_MENU_COMMAND_IDS.OPEN_EXAMPLE)}
            onClick={() => { runCommand(APP_MENU_COMMAND_IDS.OPEN_EXAMPLE); }}
            data-testid="ipad-gallery-open-example"
          >
            Open Example…
          </button>
        </div>
        <h2 className={css.title}>Documents</h2>
      </header>

      <div
        className={css.grid}
        style={galleryGridStyle(galleryDocuments.length)}
        role="list"
        aria-label="Open documents"
      >
        {galleryDocuments.map((doc) => {
          const active = doc.id === activeDocumentId;
          const thumbnail = thumbnails.get(doc.id) ?? null;
          return (
            <div
              key={doc.id}
              className={[css.card, active ? css.cardActive : ""].filter(Boolean).join(" ")}
              role="listitem"
            >
              <button
                type="button"
                className={css.cardButton}
                onClick={() => { switchToDocument(doc.id); }}
                aria-current={active ? "true" : undefined}
                data-testid={`ipad-gallery-document-${doc.id}`}
              >
                <span className={[css.thumb, doc.deck ? css.thumbDeck : ""].filter(Boolean).join(" ")} aria-hidden>
                  {thumbnail ? (
                    <img src={thumbnail.url} alt="" draggable={false} />
                  ) : (
                    <RiDraftLine size={38} />
                  )}
                  {thumbnail?.frameCount != null ? (
                    <span className={css.slideCount}>
                      {thumbnail.frameCount === 1 ? "1 slide" : `${thumbnail.frameCount} slides`}
                    </span>
                  ) : null}
                </span>
                <span className={css.cardLabel}>
                  <span className={css.cardTitle}>{doc.title}</span>
                  {doc.dirty ? <span className={css.dirtyDot} aria-label="Unsaved changes" /> : null}
                </span>
              </button>
              {/* The last document can close too (a fresh one replaces it), unless it is already that. */}
              {galleryDocuments.length > 1 || !doc.blank ? (
                <button
                  type="button"
                  className={css.cardClose}
                  aria-label={`Close ${doc.title}`}
                  title={`Close ${doc.title}`}
                  onClick={() => { onRequestCloseDocument(doc.id); }}
                  data-testid={`ipad-gallery-close-${doc.id}`}
                >
                  <RiCloseLine size={17} aria-hidden />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Fewer open documents get larger cards; past a dozen the grid stays at its densest. */
function galleryGridStyle(count: number): CSSProperties & { "--gallery-card-min": string } {
  const min = count <= 2 ? 360 : count <= 8 ? 300 : count <= 12 ? 240 : 190;
  return { "--gallery-card-min": `${min}px` };
}
