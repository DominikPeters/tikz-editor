import { useCallback, useEffect, useMemo, useRef } from "react";
import { RiAddLine, RiCloseLine, RiDraftLine, RiFolderOpenLine } from "@remixicon/react";
import { useShallow } from "zustand/react/shallow";
import { APP_MENU_COMMAND_IDS, type AppMenuCommandId } from "../../app-menu";
import { useEditorStore } from "../../store/store";
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
    const list: Array<DocumentThumbnailSource & { title: string; dirty: boolean }> = [];
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
        activeFigureId: doc.activeFigureId,
        snapshotSvg: doc.snapshot.svg?.svg ?? null,
        snapshotSource: doc.snapshot.source
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

  const runCommand = useCallback((commandId: AppMenuCommandId) => {
    onClose();
    commandRuntime.runCommand(commandId, "platform");
  }, [commandRuntime, onClose]);

  const commandEnabled = useCallback((commandId: AppMenuCommandId): boolean => {
    return commandRuntime.bindings[commandId]?.enabled === true;
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
        <h2 className={css.title}>Documents</h2>
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
        <button
          type="button"
          className={css.closeButton}
          onClick={onClose}
          aria-label="Close documents"
          title="Close documents"
          data-testid="ipad-gallery-close"
        >
          <RiCloseLine size={22} aria-hidden />
        </button>
      </header>

      <div className={css.grid} role="list" aria-label="Open documents">
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
                <span className={css.thumb} aria-hidden>
                  {thumbnail ? (
                    <img src={thumbnail} alt="" draggable={false} />
                  ) : (
                    <RiDraftLine size={38} />
                  )}
                </span>
                <span className={css.cardLabel}>
                  <span className={css.cardTitle}>{doc.title}</span>
                  {doc.dirty ? <span className={css.dirtyDot} aria-label="Unsaved changes" /> : null}
                </span>
              </button>
              {galleryDocuments.length > 1 ? (
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
