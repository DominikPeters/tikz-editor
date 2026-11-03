import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AppMenuDefinition, AppMenuItem } from "../app-menu";
import type { PlatformMenu } from "../platform/types";
import type { CommandBindings } from "./editor-command-runtime";
import { useWorkspaceListStore } from "../store/workspace-list-store";
import type { UserWorkspace } from "../store/workspace-storage";
import { BUILT_IN_WORKSPACES } from "./DockLayout";
import { applyWorkspace, findActiveWorkspaceId } from "./workspace-apply";
import { formatAccelerator } from "./key-labels";
import { assignAccessKeys } from "./menu-access-keys";
import css from "./AppMenuBar.module.css";

type RecentFiles = NonNullable<PlatformMenu["recentFiles"]>;

// What one open menu shows, built from the definition plus live state
// (bindings, workspaces, recent files).
type Entry =
  | { kind: "separator" }
  | {
      kind: "action";
      label: string;
      checked?: boolean;
      enabled: boolean;
      shortcut?: string;
      testId?: string;
      run: () => unknown;
    }
  | { kind: "submenu"; label: string; key: string; entries: Entry[] };

type EntryContext = {
  bindings: CommandBindings;
  userWorkspaces: readonly UserWorkspace[];
  recent: { files: readonly string[]; api: RecentFiles; refresh: () => void } | null;
};

function basename(path: string): string {
  return path.split(/[\\/]/u).pop() ?? path;
}

function toEntries(items: readonly AppMenuItem[], path: string, context: EntryContext): Entry[] {
  return items.flatMap((item, index): Entry[] => {
    const key = `${path}-${index}`;
    switch (item.kind) {
      case "separator":
        return [{ kind: "separator" }];
      case "recent-files": {
        const recent = context.recent;
        if (!recent) return [];
        const entries: Entry[] = recent.files.length > 0
          ? [
              ...recent.files.map((file, fileIndex): Entry => ({
                kind: "action",
                label: basename(file),
                enabled: true,
                testId: `menu-recent-${fileIndex}`,
                run: () => { recent.api.open(file); }
              })),
              { kind: "separator" },
              { kind: "action", label: "Clear Open Recent", enabled: true, run: async () => { await recent.api.clear(); recent.refresh(); } }
            ]
          : [{ kind: "action", label: "No Recent Files", enabled: false, run: () => null }];
        return [{ kind: "submenu", label: item.label, key, entries }];
      }
      case "workspace-list": {
        const activeWorkspaceId = findActiveWorkspaceId();
        const workspace = (id: string, name: string): Entry => ({
          kind: "action",
          label: name,
          checked: id === activeWorkspaceId,
          enabled: true,
          testId: `menu-workspace-${id}`,
          run: () => { applyWorkspace(id); }
        });
        return [
          ...BUILT_IN_WORKSPACES.map((builtIn) => workspace(builtIn.id, builtIn.name)),
          ...(context.userWorkspaces.length > 0 ? [{ kind: "separator" } as const] : []),
          ...context.userWorkspaces.map((user) => workspace(user.id, user.name))
        ];
      }
      case "submenu":
        return [{ kind: "submenu", label: item.label, key, entries: toEntries(item.items, key, context) }];
      case "command": {
        const binding = context.bindings[item.commandId];
        return [{
          kind: "action",
          label: item.label,
          ...(binding?.checked == null ? {} : { checked: binding.checked }),
          enabled: binding?.enabled === true,
          shortcut: formatAccelerator(item.accelerator),
          testId: `menu-cmd-${item.commandId}`,
          run: () => binding?.run("menu")
        }];
      }
    }
  });
}

function Label({ text, accessIndex }: { text: string; accessIndex: number | null | undefined }) {
  if (accessIndex == null) return <>{text}</>;
  return (
    <>
      {text.slice(0, accessIndex)}
      <span className={css.accessKey}>{text.charAt(accessIndex)}</span>
      {text.slice(accessIndex + 1)}
    </>
  );
}

function MenuPopup({
  entries,
  popupKey,
  nested,
  openSubmenus,
  onRun
}: {
  entries: readonly Entry[];
  popupKey: string;
  nested: boolean;
  openSubmenus: readonly string[];
  onRun: (entry: Extract<Entry, { kind: "action" }>) => void;
}) {
  const hasCheckItems = entries.some((entry) => entry.kind === "action" && entry.checked !== undefined);
  const accessKeys = assignAccessKeys(entries.map((entry) => entry.kind === "separator" ? "" : entry.label));
  const accessKeyOf = (index: number) => {
    const entry = entries[index];
    const accessIndex = accessKeys[index];
    return entry && entry.kind !== "separator" && accessIndex != null ? entry.label.charAt(accessIndex).toLowerCase() : undefined;
  };

  return (
    <div
      className={[css.popup, nested ? css.popupNested : ""].filter(Boolean).join(" ")}
      role="menu"
      data-select="chrome"
      data-menu-popup={popupKey}
    >
      {entries.map((entry, index) => {
        if (entry.kind === "separator") {
          return <div key={`separator-${index}`} className={css.separator} role="separator" />;
        }
        if (entry.kind === "submenu") {
          return (
            <div key={entry.key} className={css.submenu} data-open={openSubmenus.includes(entry.key) || undefined}>
              <div
                className={[css.item, css.submenuTrigger, hasCheckItems ? "" : css.itemNoCheck].filter(Boolean).join(" ")}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openSubmenus.includes(entry.key)}
                tabIndex={-1}
                data-menu-item=""
                data-submenu={entry.key}
                data-access-key={accessKeyOf(index)}
              >
                {hasCheckItems ? <span className={css.check} /> : null}
                <span className={css.label}><Label text={entry.label} accessIndex={accessKeys[index]} /></span>
                <span className={css.submenuArrow}>›</span>
              </div>
              <MenuPopup entries={entry.entries} popupKey={entry.key} nested openSubmenus={openSubmenus} onRun={onRun} />
            </div>
          );
        }
        return (
          <button
            key={`${entry.testId ?? entry.label}-${index}`}
            type="button"
            role={entry.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={entry.checked}
            // Not `disabled`: arrow keys still move through disabled items, as in Win32 menus.
            aria-disabled={!entry.enabled || undefined}
            tabIndex={-1}
            className={[css.item, hasCheckItems ? "" : css.itemNoCheck].filter(Boolean).join(" ")}
            data-testid={entry.testId}
            data-menu-item=""
            data-access-key={accessKeyOf(index)}
            onClick={() => {
              if (entry.enabled) onRun(entry);
            }}
          >
            {hasCheckItems ? <span className={css.check}>{entry.checked ? "✓" : ""}</span> : null}
            <span className={css.label}><Label text={entry.label} accessIndex={accessKeys[index]} /></span>
            <span className={css.shortcut}>{entry.shortcut}</span>
          </button>
        );
      })}
    </div>
  );
}

function itemsOf(popup: Element): HTMLElement[] {
  return Array.from(popup.querySelectorAll<HTMLElement>("[data-menu-item]")).filter(
    (item) => item.closest("[data-menu-popup]") === popup
  );
}

function isAccessKeyEvent(event: KeyboardEvent | ReactKeyboardEvent): boolean {
  return event.key.length === 1 && /[\p{L}\p{N}]/u.test(event.key) && !event.ctrlKey && !event.metaKey;
}

export function AppMenuBar({
  definition,
  bindings,
  recentFiles,
  keyboardAccess
}: {
  definition: AppMenuDefinition;
  bindings: CommandBindings;
  recentFiles?: RecentFiles | undefined;
  /** Alt, F10 and Alt+letter reach the menus, as on Windows and Linux. */
  keyboardAccess: boolean;
}) {
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [openSubmenus, setOpenSubmenus] = useState<readonly string[]>([]);
  const [accessKeysShown, setAccessKeysShown] = useState(false);
  const [recentList, setRecentList] = useState<readonly string[]>([]);
  const userWorkspaces = useWorkspaceListStore((s) => s.userWorkspaces);
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  // Where keyboard focus was before the menu bar took it, to give it back.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // The popup whose first item takes focus after the next render.
  const pendingFocusRef = useRef<string | null>(null);

  const sectionAccessKeys = assignAccessKeys(definition.map((section) => section.label));
  const sectionAccessKey = (index: number) => {
    const section = definition[index];
    const accessIndex = sectionAccessKeys[index];
    return section && accessIndex != null ? section.label.charAt(accessIndex).toLowerCase() : undefined;
  };

  const refreshRecent = useCallback(() => {
    if (!recentFiles) return;
    void recentFiles.list().then(setRecentList, () => { setRecentList([]); });
  }, [recentFiles]);

  const rememberFocus = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !menuRootRef.current?.contains(active)) {
      returnFocusRef.current = active;
    }
  };

  const close = useCallback((restoreFocus: boolean) => {
    setOpenSectionId(null);
    setOpenSubmenus([]);
    setAccessKeysShown(false);
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (restoreFocus && target?.isConnected) {
      target.focus();
    }
    // Body, say, cannot take focus back; then focus just leaves the menu bar.
    if (document.activeElement instanceof HTMLElement && menuRootRef.current?.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }, []);

  const openSection = useCallback((sectionId: string, focusFirstItem: boolean) => {
    setOpenSectionId(sectionId);
    setOpenSubmenus([]);
    if (focusFirstItem) pendingFocusRef.current = sectionId;
    const section = definition.find((candidate) => candidate.id === sectionId);
    if (section?.items.some((item) => item.kind === "recent-files")) refreshRecent();
  }, [definition, refreshRecent]);

  const focusTrigger = (sectionId: string | undefined) => {
    if (!sectionId) return;
    menuRootRef.current?.querySelector<HTMLElement>(`[data-menu-trigger="${CSS.escape(sectionId)}"]`)?.focus();
  };

  useLayoutEffect(() => {
    const popupKey = pendingFocusRef.current;
    if (!popupKey) return;
    pendingFocusRef.current = null;
    const popup = menuRootRef.current?.querySelector(`[data-menu-popup="${CSS.escape(popupKey)}"]`);
    if (popup) itemsOf(popup)[0]?.focus();
  }, [openSectionId, openSubmenus]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target instanceof Node ? event.target : null;
      if (target && !menuRootRef.current?.contains(target)) {
        close(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => { window.removeEventListener("pointerdown", onPointerDown); };
  }, [close]);

  useEffect(() => {
    if (!openSectionId) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !menuRootRef.current?.contains(document.activeElement)) {
        close(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [openSectionId, close]);

  // Alt on its own (pressed and released) or F10 moves focus to the menu bar;
  // Alt+letter opens that menu. Capture phase, so the editor never sees them.
  useEffect(() => {
    if (!keyboardAccess) return;
    let altAlone = false;
    function onKeyDown(event: KeyboardEvent) {
      altAlone = event.key === "Alt" && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.repeat;
      const active = menuRootRef.current?.contains(document.activeElement) === true;
      if (event.key === "F10" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        if (active || openSectionId) {
          close(true);
        } else {
          rememberFocus();
          setAccessKeysShown(true);
          focusTrigger(definition[0]?.id);
        }
        return;
      }
      if (event.altKey && !event.shiftKey && isAccessKeyEvent(event)) {
        const index = definition.findIndex((_, position) => sectionAccessKey(position) === event.key.toLowerCase());
        const section = definition[index];
        if (!section) return;
        event.preventDefault();
        event.stopPropagation();
        if (!active) rememberFocus();
        setAccessKeysShown(true);
        openSection(section.id, true);
      }
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.key !== "Alt" || !altAlone) return;
      altAlone = false;
      event.preventDefault();
      if (menuRootRef.current?.contains(document.activeElement) || openSectionId) {
        close(true);
      } else {
        rememberFocus();
        setAccessKeysShown(true);
        focusTrigger(definition[0]?.id);
      }
    }
    function onPointerDown() {
      altAlone = false;
    }
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  });

  const runEntry = useCallback((entry: Extract<Entry, { kind: "action" }>) => {
    void Promise.resolve(entry.run()).then(() => {
      close(true);
    });
  }, [close]);

  const moveSection = (from: string, delta: number, openIt: boolean) => {
    const index = definition.findIndex((section) => section.id === from);
    const next = definition[(index + delta + definition.length) % definition.length];
    if (!next) return;
    if (openIt) {
      openSection(next.id, true);
    } else {
      focusTrigger(next.id);
    }
  };

  // Arrow keys, Enter, Escape and access keys once focus is in the menu bar.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const triggerId = target.dataset.menuTrigger;
    if (triggerId !== undefined) {
      const handled = (() => {
        switch (event.key) {
          case "ArrowLeft": moveSection(triggerId, -1, openSectionId != null); return true;
          case "ArrowRight": moveSection(triggerId, 1, openSectionId != null); return true;
          case "ArrowDown":
          case "Enter":
          case " ": openSection(triggerId, true); return true;
          case "Escape": close(true); return true;
          default: {
            if (!isAccessKeyEvent(event) || event.altKey) return false;
            const index = definition.findIndex((_, position) => sectionAccessKey(position) === event.key.toLowerCase());
            const section = definition[index];
            if (section) openSection(section.id, true);
            return true;
          }
        }
      })();
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    const popup = target.closest("[data-menu-popup]");
    if (!popup || !openSectionId) return;
    const popupKey = popup.getAttribute("data-menu-popup") ?? "";
    const nested = popupKey !== openSectionId;
    const items = itemsOf(popup);
    const index = items.indexOf(target);
    const submenuKey = target.dataset.submenu;
    const openSubmenu = (key: string) => {
      const depth = nested ? openSubmenus.indexOf(popupKey) + 1 : 0;
      setOpenSubmenus([...openSubmenus.slice(0, depth), key]);
      pendingFocusRef.current = key;
    };

    const handled = (() => {
      switch (event.key) {
        case "ArrowDown": items[(index + 1) % items.length]?.focus(); return true;
        case "ArrowUp": items[(index - 1 + items.length) % items.length]?.focus(); return true;
        case "Home": items[0]?.focus(); return true;
        case "End": items[items.length - 1]?.focus(); return true;
        case "ArrowRight":
          if (submenuKey) openSubmenu(submenuKey);
          else moveSection(openSectionId, 1, true);
          return true;
        case "ArrowLeft":
          if (nested) {
            setOpenSubmenus(openSubmenus.slice(0, openSubmenus.indexOf(popupKey)));
            menuRootRef.current?.querySelector<HTMLElement>(`[data-submenu="${CSS.escape(popupKey)}"]`)?.focus();
          } else {
            moveSection(openSectionId, -1, true);
          }
          return true;
        case "Enter":
        case " ":
          if (submenuKey) {
            openSubmenu(submenuKey);
            return true;
          }
          return false;
        case "Escape":
          if (nested) {
            setOpenSubmenus(openSubmenus.slice(0, openSubmenus.indexOf(popupKey)));
            menuRootRef.current?.querySelector<HTMLElement>(`[data-submenu="${CSS.escape(popupKey)}"]`)?.focus();
          } else {
            setOpenSectionId(null);
            setOpenSubmenus([]);
            focusTrigger(openSectionId);
          }
          return true;
        case "Tab":
          close(true);
          return true;
        default: {
          if (!isAccessKeyEvent(event) || event.altKey) return false;
          const match = items.find((item) => item.dataset.accessKey === event.key.toLowerCase());
          if (match?.dataset.submenu) openSubmenu(match.dataset.submenu);
          else match?.click();
          return true;
        }
      }
    })();
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const context: EntryContext = {
    bindings,
    userWorkspaces,
    recent: recentFiles ? { files: recentList, api: recentFiles, refresh: refreshRecent } : null
  };

  return (
    <div
      className={css.menuBar}
      data-select="chrome"
      role="menubar"
      data-testid="app-menubar"
      data-access-keys={accessKeysShown || undefined}
      ref={menuRootRef}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && menuRootRef.current?.contains(next)) return;
        if (next != null) {
          returnFocusRef.current = null;
          close(false);
        }
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          close(false);
        }
      }}
    >
      {definition.map((section, sectionIndex) => {
        const isOpen = openSectionId === section.id;
        return (
          <div
            key={section.id}
            className={css.section}
            onMouseEnter={() => {
              if (openSectionId && openSectionId !== section.id) {
                openSection(section.id, false);
              }
            }}
          >
            <button
              type="button"
              className={[css.trigger, isOpen ? css.triggerActive : ""].filter(Boolean).join(" ")}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              tabIndex={-1}
              data-testid={`menu-section-${section.id}`}
              data-menu-trigger={section.id}
              onClick={() => {
                if (isOpen) {
                  close(false);
                } else {
                  openSection(section.id, false);
                }
              }}
            >
              <Label text={section.label} accessIndex={sectionAccessKeys[sectionIndex]} />
            </button>

            {isOpen ? (
              <MenuPopup
                entries={toEntries(section.items, section.id, context)}
                popupKey={section.id}
                nested={false}
                openSubmenus={openSubmenus}
                onRun={runEntry}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
