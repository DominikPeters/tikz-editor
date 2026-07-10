import { useEffect, useRef, useState } from "react";
import type { AppMenuDefinition, AppMenuItem } from "../app-menu";
import type { CommandBindings } from "./editor-command-runtime";
import { useWorkspaceListStore } from "../store/workspace-list-store";
import { BUILT_IN_WORKSPACES } from "./DockLayout";
import { applyWorkspace, findActiveWorkspaceId } from "./workspace-apply";
import { formatAccelerator } from "./key-labels";
import css from "./AppMenuBar.module.css";

function MenuPopup({
  items,
  path,
  nested,
  bindings,
  onCommandRun
}: {
  items: readonly AppMenuItem[];
  path: string;
  nested: boolean;
  bindings: CommandBindings;
  onCommandRun: () => void;
}) {
  const userWorkspaces = useWorkspaceListStore((s) => s.userWorkspaces);
  const activeWorkspaceId = findActiveWorkspaceId();
  const hasWorkspaceList = items.some((item) => item.kind === "workspace-list");
  const hasCheckItems =
    hasWorkspaceList ||
    items.some((item) => item.kind === "command" && bindings[item.commandId].checked != null);

  return (
    <div className={[css.popup, nested ? css.popupNested : ""].filter(Boolean).join(" ")} role="menu" data-select="chrome">
      {items.map((item, index) => {
        const itemKey = `${path}-${index}`;
        if (item.kind === "separator") {
          return <div key={`${itemKey}-separator`} className={css.separator} role="separator" />;
        }

        if (item.kind === "recent-files") {
          return null;
        }

        if (item.kind === "workspace-list") {
          const workspaceEntries: Array<{ id: string; name: string; builtIn: boolean }> = [
            ...BUILT_IN_WORKSPACES.map((b) => ({ id: b.id, name: b.name, builtIn: true })),
          ];
          if (userWorkspaces.length > 0) {
            workspaceEntries.push({ id: "__sep__", name: "", builtIn: false });
            for (const u of userWorkspaces) {
              workspaceEntries.push({ id: u.id, name: u.name, builtIn: false });
            }
          }
          return (
            <div key={`${itemKey}-workspaces`}>
              {workspaceEntries.map((entry, j) => {
                if (entry.id === "__sep__") {
                  return (
                    <div
                      key={`${itemKey}-wssep-${j}`}
                      className={css.separator}
                      role="separator"
                    />
                  );
                }
                const checked = entry.id === activeWorkspaceId;
                return (
                  <button
                    key={`${itemKey}-ws-${entry.id}`}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    className={css.item}
                    data-testid={`menu-workspace-${entry.id}`}
                    onClick={() => {
                      applyWorkspace(entry.id);
                      onCommandRun();
                    }}
                  >
                    <span className={css.check}>{checked ? "\u2713" : ""}</span>
                    <span className={css.label}>{entry.name}</span>
                  </button>
                );
              })}
            </div>
          );
        }

        if (item.kind === "submenu") {
          return (
            <div key={`${itemKey}-submenu`} className={css.submenu}>
              <div
                className={[css.item, css.submenuTrigger, hasCheckItems ? "" : css.itemNoCheck]
                  .filter(Boolean)
                  .join(" ")}
                role="menuitem"
                aria-haspopup="menu"
              >
                {hasCheckItems ? <span className={css.check} /> : null}
                <span className={css.label}>{item.label}</span>
                <span className={css.submenuArrow}>›</span>
              </div>
              <MenuPopup
                items={item.items}
                path={`${itemKey}-submenu`}
                nested
                bindings={bindings}
                onCommandRun={onCommandRun}
              />
            </div>
          );
        }

        const binding = bindings[item.commandId];
        const role = binding.checked == null ? "menuitem" : "menuitemcheckbox";
        return (
          <button
            key={`${itemKey}-${item.commandId}`}
            type="button"
            role={role}
            aria-checked={binding.checked}
            disabled={!binding.enabled}
            className={[css.item, hasCheckItems ? "" : css.itemNoCheck].filter(Boolean).join(" ")}
            data-testid={`menu-cmd-${item.commandId}`}
            onClick={() => {
              if (!binding.enabled) {
                return;
              }
              void Promise.resolve(binding.run("menu")).then(() => {
                onCommandRun();
              });
            }}
          >
            {hasCheckItems ? <span className={css.check}>{binding.checked ? "✓" : ""}</span> : null}
            <span className={css.label}>{item.label}</span>
            <span className={css.shortcut}>{formatAccelerator(item.accelerator)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function AppMenuBar({
  definition,
  bindings
}: {
  definition: AppMenuDefinition;
  bindings: CommandBindings;
}) {
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const menuRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (!menuRootRef.current?.contains(target)) {
        setOpenSectionId(null);
      }
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => { window.removeEventListener("pointerdown", onPointerDown); };
  }, []);

  useEffect(() => {
    if (!openSectionId) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenSectionId(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [openSectionId]);

  return (
    <div
      className={css.menuBar}
      data-select="chrome"
      role="menubar"
      data-testid="app-menubar"
      ref={menuRootRef}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          setOpenSectionId(null);
        }
      }}
    >
      {definition.map((section) => {
        const isOpen = openSectionId === section.id;
        return (
          <div
            key={section.id}
            className={css.section}
            onMouseEnter={() => {
              if (openSectionId && openSectionId !== section.id) {
                setOpenSectionId(section.id);
              }
            }}
          >
            <button
              type="button"
              className={[css.trigger, isOpen ? css.triggerActive : ""].filter(Boolean).join(" ")}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              data-testid={`menu-section-${section.id}`}
              onClick={() => {
                setOpenSectionId((current) => current === section.id ? null : section.id);
              }}
            >
              {section.label}
            </button>

            {isOpen ? (
              <MenuPopup
                items={section.items}
                path={section.id}
                nested={false}
                bindings={bindings}
                onCommandRun={() => { setOpenSectionId(null); }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
