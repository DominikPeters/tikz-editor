import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEditorStore } from "../../store/store";
import { getActiveEditorPlatform } from "../../platform/current";
import { changeGraphicsLocation, undoGraphicsInsertion, useGraphicsNoticeStore } from "../deck-graphics-insertion";
import css from "./CanvasPanel.module.css";

const VISIBLE_MS = 6000;
const ERROR_VISIBLE_MS = 4000;

/**
 * Where an inserted image was saved, as a transient capsule over the canvas
 * (the system HUD's material), with Undo and Change…. It leaves on its own,
 * stays while hovered, and goes once the document moves on.
 */
export function GraphicsNoticeToast(): ReactNode {
  const notice = useGraphicsNoticeStore((state) => state.notice);
  const dismiss = useGraphicsNoticeStore((state) => state.dismiss);
  const activeDocumentId = useEditorStore((state) => state.activeDocumentId);
  const source = useEditorStore((state) => state.source);
  const [hovered, setHovered] = useState(false);
  const busy = useRef(false);

  const stale = notice != null && (notice.documentId !== activeDocumentId || (notice.kind !== "error" && source !== notice.sourceAfter));
  useEffect(() => {
    if (notice && stale) dismiss(notice.id);
  }, [dismiss, notice, stale]);
  useEffect(() => {
    if (!notice || hovered) return;
    const timer = window.setTimeout(() => { dismiss(notice.id); }, notice.kind === "error" ? ERROR_VISIBLE_MS : VISIBLE_MS);
    return () => { window.clearTimeout(timer); };
  }, [dismiss, hovered, notice]);

  if (!notice || stale) return null;
  const run = (task: () => void | Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    void Promise.resolve().then(task).finally(() => { busy.current = false; });
  };
  let message: ReactNode;
  if (notice.kind === "error") message = notice.message;
  else if (notice.kind === "browser") message = <><b>{notice.fileName}</b> is stored in this browser only</>;
  else if (notice.kind === "linked") message = <>Using <b>{notice.folderLabel}{notice.fileName}</b></>;
  else if (notice.createdFolder) message = <>Created <b>{notice.createdFolder}/</b> and saved <b>{notice.fileName}</b></>;
  else message = <>Saved <b>{notice.fileName}</b> in <b>{notice.folderLabel}</b></>;
  const files = getActiveEditorPlatform().files;
  const canChange = notice.kind === "saved" && files?.chooseGraphicsLocation != null && files.readLocalAsset != null && files.writeGraphicsFile != null;

  return (
    <div
      className={css.graphicsNotice}
      role="status"
      data-testid="graphics-notice"
      onPointerEnter={() => { setHovered(true); }}
      onPointerLeave={() => { setHovered(false); }}
      onPointerDown={(event) => { event.stopPropagation(); }}
      onPointerUp={(event) => { event.stopPropagation(); }}
      onClick={(event) => { event.stopPropagation(); }}
      onDoubleClick={(event) => { event.stopPropagation(); }}
    >
      <span className={css.graphicsNoticeText}>{message}</span>
      {notice.kind !== "error" ? (
        <button type="button" className={css.graphicsNoticeButton}
          onClick={() => { run(() => { undoGraphicsInsertion(notice, useEditorStore.getState, useEditorStore.getState().dispatch); }); }}>
          Undo
        </button>
      ) : null}
      {canChange ? (
        <button type="button" className={css.graphicsNoticeButton}
          onClick={() => { run(() => changeGraphicsLocation(notice, useEditorStore.getState, useEditorStore.getState().dispatch)); }}>
          Change…
        </button>
      ) : null}
    </div>
  );
}
