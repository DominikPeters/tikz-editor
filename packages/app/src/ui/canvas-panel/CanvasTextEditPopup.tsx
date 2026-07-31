import {
  useEffect,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SyntheticEvent as ReactSyntheticEvent
} from "react";
import type { CanvasTextEditFocusSurface } from "./canvas-text-edit-machine";
import type { TextEditingSession } from "./types";
import css from "./CanvasPanel.module.css";

export type CanvasTextFormatCommandId =
  | "bold"
  | "italic"
  | "underline"
  | "mono"
  | "alert"
  | "bullets"
  | "numbered"
  | "outdent"
  | "indent";

export type CanvasTextFormatToolbarItem = {
  id: CanvasTextFormatCommandId;
  label: string;
  glyph: string;
  glyphClass?: "bold" | "italic" | "underline" | "mono" | "alert";
  active: boolean;
  disabled: boolean;
};

export type CanvasTextFormatColorSwatch = {
  /** LaTeX color name written into `\textcolor{...}`. */
  name: string;
  /** Display color for the swatch button. */
  css: string;
};

export type CanvasTextFormatToolbarModel = {
  items: readonly CanvasTextFormatToolbarItem[];
  colorSwatches: readonly CanvasTextFormatColorSwatch[];
  /** Raw color argument of the enclosing `\textcolor`, if any. */
  activeColor: string | null;
  colorDisabled: boolean;
  onCommand: (id: CanvasTextFormatCommandId) => void;
  onColor: (name: string | null) => void;
};

export type CanvasTextEditPopupModel = {
  session: TextEditingSession;
  /** Floating popup near the edited content, or a bar docked at the canvas bottom. */
  surface: "popup" | "bar";
  /** Which surface owns the keyboard; the popup renders unfocused chrome when it is "canvas". */
  focusSurface: CanvasTextEditFocusSurface;
  placement: {
    centerX: number;
    top: number;
    maxWidth: number;
    textareaWidth: number;
  };
  measuredHeight: number | null;
  toolbar: CanvasTextFormatToolbarModel | null;
  popupRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  textareaSizing: { rows: number } | null;
  caretOverlay: { left: number; top: number; height: number } | null;
  hideNativeCaret: boolean;
  /**
   * Selection rendered by the popup itself while the canvas owns focus (an
   * unfocused textarea hides its native selection). Textarea-relative px.
   */
  inactiveSelectionRects: readonly { left: number; top: number; width: number; height: number }[] | null;
  onPopupPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onTextareaFocus: (event: ReactFocusEvent<HTMLTextAreaElement>) => void;
  onTextareaSelect: (event: ReactSyntheticEvent<HTMLTextAreaElement>) => void;
  onTextareaCopy: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaCut: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaDrop: (event: ReactDragEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
};

/**
 * Hidden textarea that captures keyboard and IME input while the canvas
 * surface owns focus. Mirrors the session buffer and selection so native
 * editing semantics (word deletes, composition) report correct offsets.
 */
export type CanvasFocusInputModel = {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  /** Viewport-px anchor near the canvas caret so IME candidates open in place. */
  position: { left: number; top: number } | null;
  onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onSelect: (event: ReactSyntheticEvent<HTMLTextAreaElement>) => void;
  onCopy: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onCut: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLTextAreaElement>) => void;
};

export type CanvasScopeEditBorder = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type CanvasTextEditViewModel = {
  session: TextEditingSession | null;
  popup: CanvasTextEditPopupModel | null;
  focusSurface: CanvasTextEditFocusSurface;
  canvasFocusInput: CanvasFocusInputModel | null;
  /** Dashed PowerPoint-style edit outline around the scope container, viewport px. */
  scopeEditBorder: CanvasScopeEditBorder | null;
};

const GLYPH_CLASS_NAMES: Record<
  NonNullable<CanvasTextFormatToolbarItem["glyphClass"]>,
  string
> = {
  bold: css.textEditToolbarGlyphBold,
  italic: css.textEditToolbarGlyphItalic,
  underline: css.textEditToolbarGlyphUnderline,
  mono: css.textEditToolbarGlyphMono,
  alert: css.textEditToolbarGlyphAlert
};

/** Keeps pointer interactions from moving focus out of the session inputs. */
function keepSessionFocus(event: ReactPointerEvent<HTMLElement>) {
  event.preventDefault();
}

function CanvasTextFormatToolbar({
  toolbar,
  sessionKey
}: {
  toolbar: CanvasTextFormatToolbarModel;
  sessionKey: string;
}) {
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  useEffect(() => {
    setColorMenuOpen(false);
  }, [sessionKey]);
  const activeSwatch =
    toolbar.colorSwatches.find((swatch) => swatch.name === toolbar.activeColor) ?? null;
  return (
    <div className={css.textEditToolbar} data-testid="canvas-text-format-toolbar">
      {toolbar.items.map((item) => (
        <span key={item.id} className={css.textEditToolbarSlot}>
          {item.id === "bullets" ? <span className={css.textEditToolbarDivider} /> : null}
          <button
            type="button"
            className={[
              css.textEditToolbarButton,
              item.active ? css.textEditToolbarButtonActive : ""
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label={item.label}
            title={item.label}
            aria-pressed={item.active}
            disabled={item.disabled}
            onPointerDown={keepSessionFocus}
            onClick={() => { toolbar.onCommand(item.id); }}
            data-testid={`text-format-${item.id}`}
          >
            <span className={item.glyphClass ? GLYPH_CLASS_NAMES[item.glyphClass] : undefined}>
              {item.glyph}
            </span>
          </button>
          {item.id === "mono" ? (
            <span className={css.textEditToolbarColorWrap}>
              <button
                type="button"
                className={[
                  css.textEditToolbarButton,
                  toolbar.activeColor != null ? css.textEditToolbarButtonActive : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-label="Text color"
                title="Text color"
                disabled={toolbar.colorDisabled}
                onPointerDown={keepSessionFocus}
                onClick={() => { setColorMenuOpen((open) => !open); }}
                data-testid="text-format-color"
              >
                <span
                  className={css.textEditToolbarColorGlyph}
                  style={{ borderBottomColor: activeSwatch?.css ?? "currentcolor" }}
                >
                  A
                </span>
              </button>
              {colorMenuOpen ? (
                <span
                  className={css.textEditToolbarColorMenu}
                  data-testid="text-format-color-menu"
                >
                  {toolbar.colorSwatches.map((swatch) => (
                    <button
                      key={swatch.name}
                      type="button"
                      className={[
                        css.textEditToolbarSwatch,
                        swatch.name === toolbar.activeColor
                          ? css.textEditToolbarSwatchActive
                          : ""
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={{ background: swatch.css }}
                      aria-label={`Color ${swatch.name}`}
                      title={swatch.name}
                      onPointerDown={keepSessionFocus}
                      onClick={() => {
                        toolbar.onColor(swatch.name);
                        setColorMenuOpen(false);
                      }}
                      data-testid={`text-format-color-${swatch.name}`}
                    />
                  ))}
                  <button
                    type="button"
                    className={css.textEditToolbarSwatchNone}
                    aria-label="Remove color"
                    title="Remove color"
                    onPointerDown={keepSessionFocus}
                    onClick={() => {
                      toolbar.onColor(null);
                      setColorMenuOpen(false);
                    }}
                    data-testid="text-format-color-none"
                  >
                    ×
                  </button>
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

export function CanvasTextEditPopup({
  model,
  prefersNonBlinkingTextInsertionIndicator,
  caretBlinkVisible
}: {
  model: CanvasTextEditPopupModel;
  prefersNonBlinkingTextInsertionIndicator: boolean;
  caretBlinkVisible: boolean;
}) {
  const { session, placement, surface } = model;
  const barOwnsKeyboard = model.focusSurface === "bar";
  return (
    <div
      ref={model.popupRef}
      className={[
        surface === "bar" ? css.textEditBar : css.textEditPopup,
        barOwnsKeyboard ? "" : css.textEditSurfaceUnfocused
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        surface === "bar"
          ? undefined
          : {
              left: placement.centerX,
              top: placement.top,
              maxWidth: placement.maxWidth,
              transform: "translateX(-50%)",
              visibility: model.measuredHeight == null ? "hidden" : "visible"
            }
      }
      onPointerDown={model.onPopupPointerDown}
      data-testid="canvas-text-edit-popup"
      data-text-edit-surface={surface}
      data-text-edit-focus={model.focusSurface}
      data-text-edit-target-id={session.sourceId}
    >
      {session.isForeachTemplateEdit ? (
        <div className={css.textEditPopupTag} data-testid="canvas-text-edit-foreach-tag">foreach</div>
      ) : null}
      {model.toolbar ? (
        <CanvasTextFormatToolbar
          toolbar={model.toolbar}
          sessionKey={session.sourceId}
        />
      ) : null}
      <div className={css.textEditTextareaLayer}>
        <textarea
          ref={model.textareaRef}
          className={[
            css.textEditTextarea,
            session.editMode === "inline-typo" ? css.textEditTextareaInlineTypo : "",
            session.isScopeSession ? css.textEditTextareaScope : "",
            surface === "bar" ? css.textEditTextareaBar : "",
            model.hideNativeCaret ? css.textEditTextareaHideNativeCaret : ""
          ]
            .filter(Boolean)
            .join(" ")}
          value={session.text}
          spellCheck={false}
          rows={
            session.editMode === "inline-typo"
              ? 1
              : model.textareaSizing?.rows
          }
          style={
            surface === "bar"
              ? undefined
              : model.textareaSizing != null || session.editMode === "inline-typo"
                ? { width: placement.textareaWidth }
                : undefined
          }
          onFocus={model.onTextareaFocus}
          onSelect={model.onTextareaSelect}
          onCopy={model.onTextareaCopy}
          onCut={model.onTextareaCut}
          onPaste={model.onTextareaPaste}
          onDrop={model.onTextareaDrop}
          onKeyDown={model.onTextareaKeyDown}
          data-testid="canvas-text-edit-textarea"
          data-select="text"
        />
        {model.inactiveSelectionRects?.map((rect, index) => (
          <div
            key={`inactive-selection:${index}:${rect.left}:${rect.top}:${rect.width}:${rect.height}`}
            className={css.textEditSelectionRectInactive}
            aria-hidden="true"
            data-testid="canvas-text-edit-inactive-selection-rect"
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          />
        ))}
        {model.caretOverlay ? (
          <div
            className={[
              css.textEditViewportCaret,
              barOwnsKeyboard ? "" : css.textEditViewportCaretInactive,
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
              // The unfocused surface keeps a static, lower-contrast caret;
              // only the focused surface blinks.
              opacity: barOwnsKeyboard ? (caretBlinkVisible ? 1 : 0) : 1
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
