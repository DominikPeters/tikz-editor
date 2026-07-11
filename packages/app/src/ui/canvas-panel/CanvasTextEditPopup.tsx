import type {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
  SyntheticEvent as ReactSyntheticEvent
} from "react";
import type { TextEditingSession } from "./types";
import css from "./CanvasPanel.module.css";

export type CanvasTextEditPopupModel = {
  session: TextEditingSession;
  placement: {
    centerX: number;
    top: number;
    maxWidth: number;
    textareaWidth: number;
  };
  measuredHeight: number | null;
  popupRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  textareaSizing: { rows: number } | null;
  caretOverlay: { left: number; top: number; height: number } | null;
  hideNativeCaret: boolean;
  onPopupPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onTextareaSelect: (event: ReactSyntheticEvent<HTMLTextAreaElement>) => void;
  onTextareaCopy: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaCut: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaDrop: (event: ReactDragEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
};

export type CanvasTextEditViewModel = {
  session: TextEditingSession | null;
  popup: CanvasTextEditPopupModel | null;
};

export function CanvasTextEditPopup({
  model,
  prefersNonBlinkingTextInsertionIndicator,
  caretBlinkVisible
}: {
  model: CanvasTextEditPopupModel;
  prefersNonBlinkingTextInsertionIndicator: boolean;
  caretBlinkVisible: boolean;
}) {
  const { session, placement } = model;
  return (
    <div
      ref={model.popupRef}
      className={css.textEditPopup}
      style={{
        left: placement.centerX,
        top: placement.top,
        maxWidth: placement.maxWidth,
        transform: "translateX(-50%)",
        visibility: model.measuredHeight == null ? "hidden" : "visible"
      }}
      onPointerDown={model.onPopupPointerDown}
      data-testid="canvas-text-edit-popup"
    >
      {session.isForeachTemplateEdit ? (
        <div className={css.textEditPopupTag} data-testid="canvas-text-edit-foreach-tag">foreach</div>
      ) : null}
      <div className={css.textEditTextareaLayer}>
        <textarea
          ref={model.textareaRef}
          className={[
            css.textEditTextarea,
            model.hideNativeCaret ? css.textEditTextareaHideNativeCaret : ""
          ]
            .filter(Boolean)
            .join(" ")}
          value={session.text}
          spellCheck={false}
          rows={model.textareaSizing?.rows}
          style={model.textareaSizing != null ? { width: placement.textareaWidth } : undefined}
          onSelect={model.onTextareaSelect}
          onCopy={model.onTextareaCopy}
          onCut={model.onTextareaCut}
          onPaste={model.onTextareaPaste}
          onDrop={model.onTextareaDrop}
          onKeyDown={model.onTextareaKeyDown}
          data-testid="canvas-text-edit-textarea"
          data-select="text"
        />
        {model.caretOverlay ? (
          <div
            className={[
              css.textEditViewportCaret,
              prefersNonBlinkingTextInsertionIndicator ? css.textCaretNoBlink : ""
            ]
              .filter(Boolean)
              .join(" ")}
            aria-hidden="true"
            style={{
              left: model.caretOverlay.left,
              top: model.caretOverlay.top,
              height: model.caretOverlay.height,
              animation: "none",
              opacity: caretBlinkVisible ? 1 : 0
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
