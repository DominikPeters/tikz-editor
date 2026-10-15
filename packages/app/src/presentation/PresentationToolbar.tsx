import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { RiAddLine, RiPlayLine, RiSlideshow3Line } from "@remixicon/react";
import { parseDocumentRootId, formatDocumentRootId } from "@tikz-editor/core/document/root-id";
import { editBeamerSlides } from "@tikz-editor/core/beamer";
import { useEditorStore } from "../store/store";
import { useSettingsStore } from "../settings/useSettingsStore";
import { CaretDownIcon } from "../ui/tool-config";
import toolbarCss from "../ui/Toolbar.module.css";
import menuCss from "../ui/AppMenuBar.module.css";
import { launchPresentation } from "./launch";
import { presentationService } from "./service";
import css from "./PresentationControls.module.css";

export function NewSlideButton() {
  const kind = useEditorStore(state => state.documentKind);
  const locked = useEditorStore(state => !!state.documents[state.activeDocumentId]?.assistantLockReason);
  if (kind !== "beamer") return null;
  return <button type="button" className={[toolbarCss.btn, css.labelButton, css.newSlide].join(" ")} disabled={locked} onClick={() => {
    const state = useEditorStore.getState(), root = parseDocumentRootId(state.activeRootId ?? "");
    const frameId = root?.kind === "beamer-frame-tikz" ? formatDocumentRootId({ kind: "beamer-frame", index: root.frameIndex }) : state.activeRootId;
    const edit = { kind: "insert" as const, destination: frameId ? { kind: "after" as const, frameId } : { kind: "end" as const } };
    if (editBeamerSlides(state.source, edit)) state.dispatch({ type: "EDIT_DECK_SLIDES", documentId: state.activeDocumentId, baseRevision: state.sourceRevision, edit });
  }}><RiAddLine size={18} aria-hidden="true" /><span>New Slide</span></button>;
}

export function PresentationToolbar({ onOptions }: { onOptions: () => void }) {
  const kind = useEditorStore(state => state.documentKind);
  const uiFontSizePx = useSettingsStore(state => state.settings.general.uiFontSizePx);
  const { snapshot } = useSyncExternalStore(presentationService.subscribe, presentationService.getState);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target instanceof Node ? event.target : null) && !menuRef.current?.contains(event.target instanceof Node ? event.target : null)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); ref.current?.querySelector<HTMLButtonElement>('[aria-label="Presentation actions"]')?.focus(); } };
    window.addEventListener("pointerdown", close); window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); };
  }, [open]);
  if (kind !== "beamer" && !snapshot) return null;
  const action = (run: () => void) => () => { setOpen(false); run(); };
  const menuItemClass = [menuCss.item, menuCss.itemNoCheck].join(" ");
  return <div ref={ref} className={css.toolbarControls}>
    {snapshot ? <span className={css.presenting} title={snapshot.title}>Presenting: {snapshot.title}</span> : null}
    <div className={toolbarCss.splitButton}>
      <button type="button" className={[toolbarCss.btn, toolbarCss.splitButtonMain, css.presentButton].join(" ")} data-testid="present-button" onClick={() => { setOpen(false); if (snapshot) presentationService.command({ type: "show-presenter" }); else launchPresentation("current"); }}>
        {snapshot ? <RiSlideshow3Line size={18} aria-hidden="true" /> : <RiPlayLine size={18} aria-hidden="true" />}
        <span>{snapshot ? "Presenter View" : "Present"}</span>
      </button>
      <button type="button" className={[toolbarCss.btn, toolbarCss.splitButtonCaret].join(" ")} aria-label="Presentation actions" aria-haspopup="menu" aria-expanded={open} onClick={() => { const rect = ref.current?.getBoundingClientRect(); if (rect) setMenuPosition({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) }); setOpen(value => !value); }}><CaretDownIcon size={8} /></button>
    </div>
    {open ? createPortal(<div ref={menuRef} className={[menuCss.popup, css.menu].join(" ")} style={{ position: "fixed", ...menuPosition, "--app-ui-scale": uiFontSizePx / 11 } as CSSProperties} role="menu" aria-label="Presentation actions" data-select="chrome" onKeyDown={event => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
      const index = items.findIndex(button => button === event.target);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }}>
      {snapshot ? <>
        <button type="button" className={menuItemClass} role="menuitem" onClick={action(() => { presentationService.command({ type: "show-presenter" }); })}>Show Presenter View</button>
        <button type="button" className={menuItemClass} role="menuitem" onClick={action(onOptions)}>Audience Display…</button>
        <button type="button" className={menuItemClass} role="menuitem" onClick={action(() => { presentationService.command({ type: "stop" }); })}>End Presentation</button>
      </> : <>
        <button type="button" className={menuItemClass} role="menuitem" onClick={action(() => { launchPresentation("beginning"); })}>From Beginning</button>
        <button type="button" className={menuItemClass} role="menuitem" onClick={action(() => { launchPresentation("current"); })}>From Current Slide</button>
        <button type="button" className={menuItemClass} role="menuitem" onClick={action(() => { launchPresentation("current", "window"); })}>Present in a Window</button>
        <button type="button" className={menuItemClass} role="menuitem" onClick={action(() => { launchPresentation("current", "rehearse"); })}>Rehearse</button>
        <button type="button" className={menuItemClass} role="menuitem" onClick={action(onOptions)}>Presentation Options…</button>
      </>}
    </div>, document.body) : null}
  </div>;
}
