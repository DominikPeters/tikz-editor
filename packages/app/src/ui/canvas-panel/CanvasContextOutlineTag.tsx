import { useEffect, useRef, useState } from "react";
import { valueTagText } from "./canvas-value-tag";
import type { CanvasContextOutline } from "./useCanvasContextOutlines";
import css from "./CanvasPanel.module.css";

/**
 * The focus outline's tag (R8, V4). A construct's values show on it in
 * source form and open the value editor (O8); otherwise the tag opens its
 * menu, as the ▾ beside a value tag does: the construct's variants
 * (textbf ↔ textit, inline ↔ display), Unwrap, Select and Edit source.
 * The canvas keeps the keyboard throughout.
 */
export function ContextOutlineTag(props: { outline: CanvasContextOutline; onPick: (id: string) => void }) {
  const { outline, onPick } = props;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", close, true);
    return () => { window.removeEventListener("pointerdown", close, true); };
  }, [open]);

  const keepFocus = (event: React.PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  const pick = (id: string) => {
    setOpen(false);
    onPick(id);
  };
  const variants = outline.menu.filter((entry) => entry.group === "variant");
  const actions = outline.menu.filter((entry) => entry.group === "action");
  const hasMenu = outline.menu.length > 0;

  return (
    <span ref={root} className={css.contextOutlineTagGroup}>
      {outline.values ? (
        <button
          type="button"
          className={`${css.contextOutlineTagButton} ${css.contextOutlineValueTag}`}
          title="Edit values"
          data-testid="canvas-context-outline-values"
          onPointerDown={keepFocus}
          onClick={() => { pick("values"); }}
        >
          {valueTagText(outline.values.command, outline.values.values, outline.width)}
        </button>
      ) : (
        <button
          type="button"
          className={css.contextOutlineTagButton}
          data-testid="canvas-context-outline-tag"
          aria-haspopup={hasMenu ? "menu" : undefined}
          aria-expanded={hasMenu ? open : undefined}
          onPointerDown={keepFocus}
          onClick={() => { if (hasMenu) setOpen(!open); }}
        >
          {outline.tag}
        </button>
      )}
      {outline.values && hasMenu ? (
        <button
          type="button"
          className={css.contextOutlineTagButton}
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={open}
          data-testid="canvas-context-outline-more"
          onPointerDown={keepFocus}
          onClick={() => { setOpen(!open); }}
        >
          ▾
        </button>
      ) : null}
      {open ? (
        <span className={css.contextOutlineMenu} role="menu" data-testid="canvas-context-outline-menu">
          {variants.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              className={`${css.contextOutlineMenuItem} ${css.contextOutlineMenuVariant}`}
              onPointerDown={keepFocus}
              onClick={() => { pick(entry.id); }}
            >
              {entry.label}
            </button>
          ))}
          {variants.length > 0 && actions.length > 0 ? <span className={css.contextOutlineMenuSeparator} role="separator" /> : null}
          {actions.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              className={css.contextOutlineMenuItem}
              onPointerDown={keepFocus}
              onClick={() => { pick(entry.id); }}
            >
              {entry.label}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
