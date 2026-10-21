import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import css from "./CustomDropdown.module.css";

export type CustomDropdownOption<TValue extends string> = {
  value: TValue;
  label: string;
};

export type CustomDropdownSeparator = {
  kind: "separator";
  id: string;
};

export type CustomDropdownItem<TValue extends string> =
  | CustomDropdownOption<TValue>
  | CustomDropdownSeparator;

type CustomDropdownProps<TValue extends string> = {
  ariaLabel: string;
  disabled?: boolean;
  options: readonly CustomDropdownItem<TValue>[];
  value: TValue;
  onChange?: (value: TValue) => void;
  onOpen?: () => void;
  onOptionHover?: (value: TValue) => void;
  onOptionHoverEnd?: () => void;
  onOptionHoverLeave?: () => void;
  renderOption?: (option: CustomDropdownOption<TValue>, state: { selected: boolean }) => ReactNode;
  renderValue?: (option: CustomDropdownOption<TValue> | null) => ReactNode;
  menuHeader?: ReactNode;
  rootClassName?: string;
  triggerClassName?: string;
  menuClassName?: string;
  optionClassName?: string;
  optionSelectedClassName?: string;
  /** When true, the trigger becomes a text input that allows free-form typing with filtered suggestions. */
  editable?: boolean;
  /** Called on blur/Enter with the raw typed text (editable mode only). */
  onCommit?: (rawText: string) => void;
  /** Placeholder text for the input (editable mode only). */
  placeholder?: string;
  /** When true in editable mode, auto-focuses the input on mount. */
  autoFocus?: boolean;
};

const MENU_GAP_PX = 2;
const MENU_VIEWPORT_PADDING_PX = 8;
const MENU_MAX_HEIGHT_PX = 220;
const MENU_MIN_HEIGHT_PX = 80;

export function CustomDropdown<TValue extends string>({
  ariaLabel,
  disabled = false,
  options,
  value,
  onChange,
  onOpen,
  onOptionHover,
  onOptionHoverEnd,
  onOptionHoverLeave,
  renderOption,
  renderValue,
  menuHeader,
  rootClassName,
  triggerClassName,
  menuClassName,
  optionClassName,
  optionSelectedClassName,
  editable = false,
  onCommit,
  placeholder,
  autoFocus = false
}: CustomDropdownProps<TValue>) {
  const [open, setOpen] = useState(false);
  const [menuMaxHeight, setMenuMaxHeight] = useState<number>(MENU_MAX_HEIGHT_PX);
  const [menuFixedStyle, setMenuFixedStyle] = useState<{ top: number; left: number; width: number; openUp: boolean }>({ top: 0, left: 0, width: 0, openUp: false });
  const [editText, setEditText] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);
  const suppressCommitRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuListRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectedOption = useMemo(
    () => options.find((option): option is CustomDropdownOption<TValue> => isCustomDropdownOption(option) && option.value === value) ?? null,
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    if (!editable || !isEditing || editText.length === 0) {
      return options;
    }
    const lower = editText.toLowerCase();
    return options.filter((item) => {
      if (!isCustomDropdownOption(item)) return false;
      return item.label.toLowerCase().includes(lower) || item.value.toLowerCase().includes(lower);
    });
  }, [editable, isEditing, editText, options]);

  const closeMenu = useCallback(() => {
    setOpen((current) => {
      if (!current) {
        return current;
      }
      onOptionHoverEnd?.();
      return false;
    });
  }, [onOptionHoverEnd]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent): void {
      const target = event.target instanceof Node ? event.target : null;
      if (!target) {
        return;
      }
      if (!rootRef.current?.contains(target) && !menuListRef.current?.parentElement?.contains(target)) {
        closeMenu();
      }
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => { window.removeEventListener("pointerdown", onPointerDown); };
  }, [closeMenu, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        if (editable) {
          suppressCommitRef.current = true;
          setEditText("");
          setIsEditing(false);
        }
        closeMenu();
        if (editable) {
          inputRef.current?.blur();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [closeMenu, editable, open]);

  useEffect(() => {
    if (disabled) {
      closeMenu();
    }
  }, [closeMenu, disabled]);

  // Auto-focus for editable mode
  useEffect(() => {
    if (editable && autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editable, autoFocus]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    function updateMenuPosition(): void {
      const rootElement = rootRef.current;
      const menuListElement = menuListRef.current;
      if (!rootElement || !menuListElement) {
        return;
      }

      const rootRect = rootElement.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rootRect.bottom - MENU_VIEWPORT_PADDING_PX - MENU_GAP_PX;
      const spaceAbove = rootRect.top - MENU_VIEWPORT_PADDING_PX - MENU_GAP_PX;
      const naturalHeight = menuListElement.scrollHeight;

      const openUp = naturalHeight > spaceBelow && spaceAbove > spaceBelow;
      const availableSpace = openUp ? spaceAbove : spaceBelow;
      const boundedMaxHeight = Math.min(
        MENU_MAX_HEIGHT_PX,
        Math.max(MENU_MIN_HEIGHT_PX, Math.floor(availableSpace))
      );

      const top = openUp
        ? rootRect.top - MENU_GAP_PX
        : rootRect.bottom + MENU_GAP_PX;
      const left = rootRect.left;
      const width = rootRect.width;

      setMenuFixedStyle((current) =>
        current.top === top && current.left === left && current.width === width && current.openUp === openUp
          ? current
          : { top, left, width, openUp }
      );
      setMenuMaxHeight((current) => (current === boundedMaxHeight ? current : boundedMaxHeight));
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open]);

  function commitEditableValue(): void {
    if (!editable || !isEditing || suppressCommitRef.current) {
      suppressCommitRef.current = false;
      return;
    }
    const text = editText.trim();
    setIsEditing(false);
    closeMenu();
    onCommit?.(text);
  }

  const displayOptions = editable ? filteredOptions : options;

  return (
    <div className={[css.root, rootClassName].filter(Boolean).join(" ")} ref={rootRef}>
      {editable ? (
        <input
          ref={inputRef}
          type="text"
          className={[css.trigger, css.triggerEditable, open ? css.triggerOpen : "", triggerClassName].filter(Boolean).join(" ")}
          aria-label={ariaLabel}
          disabled={disabled}
          placeholder={placeholder}
          value={isEditing ? editText : (selectedOption?.label ?? value)}
          onChange={(event) => {
            setEditText(event.target.value);
            setIsEditing(true);
            if (!open) {
              setOpen(true);
              onOpen?.();
            }
          }}
          onFocus={() => {
            const displayValue = selectedOption?.label ?? value;
            setEditText(displayValue);
            setIsEditing(true);
            setOpen(true);
            onOpen?.();
          }}
          onBlur={() => {
            commitEditableValue();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitEditableValue();
              inputRef.current?.blur();
            }
          }}
        />
      ) : (
        <button
          type="button"
          className={[css.trigger, open ? css.triggerOpen : "", triggerClassName].filter(Boolean).join(" ")}
          data-select="chrome"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={() => {
            if (disabled) {
              return;
            }
            if (open) {
              closeMenu();
              return;
            }
            setOpen(true);
            onOpen?.();
          }}
        >
          <span className={css.triggerValue}>
            {renderValue ? renderValue(selectedOption) : (selectedOption?.label ?? "")}
          </span>
          <span className={css.triggerCaret} aria-hidden="true">
            <svg className={css.triggerCaretIcon} viewBox="0 0 12 8" focusable="false">
              <path d="M1.5 1.5L6 6.5L10.5 1.5" />
            </svg>
          </span>
        </button>
      )}

      {open && displayOptions.length > 0 ? createPortal(
        <div
          className={[css.menu, css.menuFixed, menuClassName].filter(Boolean).join(" ")}
          style={{
            top: menuFixedStyle.openUp ? undefined : `${menuFixedStyle.top}px`,
            bottom: menuFixedStyle.openUp ? `${window.innerHeight - menuFixedStyle.top}px` : undefined,
            left: `${menuFixedStyle.left}px`,
            width: `${menuFixedStyle.width}px`
          }}
        >
          <div
            className={css.menuScroll}
            style={{ maxHeight: `${menuMaxHeight}px` }}
            role="listbox"
            aria-label={ariaLabel}
            ref={menuListRef}
            onPointerLeave={() => {
              if (onOptionHoverLeave) {
                onOptionHoverLeave();
                return;
              }
              onOptionHoverEnd?.();
            }}
          >
            {menuHeader ? <div className={css.menuHeader}>{menuHeader}</div> : null}
            {displayOptions.map((item) => {
              if (!isCustomDropdownOption(item)) {
                return <div key={item.id} role="separator" className={css.separator} data-select="chrome" />;
              }

              const selected = item.value === value;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="option"
                  data-select="chrome"
                  aria-selected={selected}
                  className={[
                    css.option,
                    selected ? css.optionSelected : "",
                    optionClassName,
                    selected ? optionSelectedClassName : ""
                  ].filter(Boolean).join(" ")}
                  onPointerDown={(e) => {
                    // Prevent input blur when clicking an option (editable mode)
                    if (editable) e.preventDefault();
                  }}
                  onPointerEnter={() => onOptionHover?.(item.value)}
                  onClick={() => {
                    if (editable) {
                      suppressCommitRef.current = true;
                      setEditText("");
                      setIsEditing(false);
                    }
                    onChange?.(item.value);
                    closeMenu();
                    if (editable) inputRef.current?.blur();
                  }}
                >
                  {renderOption ? renderOption(item, { selected }) : item.label}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

function isCustomDropdownOption<TValue extends string>(
  item: CustomDropdownItem<TValue>
): item is CustomDropdownOption<TValue> {
  return !("kind" in item);
}
