import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import { resolveBeamerPageGeometry, scanBeamerDocument, type BeamerDocumentModel, type BeamerSlideDestination } from "@tikz-editor/core/beamer/index";
import { formatDocumentRootId, parseDocumentRootId } from "@tikz-editor/core/document/root-id";
import { computeSourceFingerprint } from "@tikz-editor/core/utils/source-fingerprint";
import { getActiveEditorPlatform } from "../platform/current";
import { useEditorStore } from "../store/store";
import { isInteractiveEdit } from "./compute-trigger";
import { useFigureThumbnails } from "./useFigureThumbnails";
import { useSlideManager } from "./slide-manager/useSlideManager";
import css from "./RootNavigator.module.css";

type Root = { id: string; span: { from: number; to: number }; label: string; thumbnailId: string; stepCount?: number; deckFrameIndex?: number };
type Entry = { kind: "frame"; root: Root } | { kind: "section"; id: string; title: string; level: number };
type Layout = "strip" | "vertical" | "grid";
type Drop = { key: string; edge: "before" | "after"; destination: BeamerSlideDestination };
const scrollByDocument = new Map<string, { left: number; top: number }>();
const collapsedByDocument = new Map<string, Set<string>>();
const DRAG_TYPE = "application/x-tikz-editor-slides";

export function RootNavigator() {
  const documentId = useEditorStore(s => s.activeDocumentId);
  const source = useEditorStore(s => s.source);
  const revision = useEditorStore(s => s.sourceRevision);
  const snapshot = useEditorStore(s => s.snapshot);
  const deckMode = useEditorStore(s => s.documentKind === "beamer");
  const selectedRootId = useEditorStore(s => s.activeRootId);
  const rootRef = parseDocumentRootId(selectedRootId ?? "");
  const activeRootId = rootRef?.kind === "beamer-frame-tikz" ? formatDocumentRootId({ kind: "beamer-frame", index: rootRef.frameIndex }) : selectedRootId;
  const locked = useEditorStore(s => !!s.documents[s.activeDocumentId]?.assistantLockReason);
  const dispatch = useEditorStore(s => s.dispatch);
  const interactiveEdit = useEditorStore(isInteractiveEdit);
  const panelRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const dragPreview = useRef<HTMLElement | null>(null);
  const drag = useRef<{ documentId: string; revision: number; ids: string[]; token: string } | null>(null);
  const lastNavigation = useRef("");
  const lastNavigationDocument = useRef<string | null>(null);
  const lastFocusSource = useRef(source);
  const ownsFocus = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [layout, setLayout] = useState<Layout>("strip");
  const [visibleRootIds, setVisibleRootIds] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => collapsedByDocument.get(documentId) ?? new Set());
  // The canvas render has scanned the deck already. Its model serves here too,
  // rather than scanning the document again at each key before the key can
  // paint (12 ms in a 125 kB deck). While the next render is pending the
  // panel shows the last one; only a document not yet rendered is scanned.
  const renderedModel = deckMode && snapshot.deck?.document.source === source ? snapshot.deck.document : null;
  const [lastModel, setLastModel] = useState<{ documentId: string; model: BeamerDocumentModel } | null>(null);
  if (renderedModel && (lastModel?.model !== renderedModel || lastModel.documentId !== documentId)) {
    setLastModel({ documentId, model: renderedModel });
  }
  const reusedModel = deckMode ? renderedModel ?? (lastModel?.documentId === documentId ? lastModel.model : null) : null;
  const scannedModel = useMemo(() => deckMode && !reusedModel ? scanBeamerDocument(source) : null, [deckMode, reusedModel, source]);
  const model = reusedModel ?? scannedModel;
  const previewAspectRatio = useMemo(() => {
    if (!model) return;
    const { page } = resolveBeamerPageGeometry(model);
    return `${page.width} / ${page.height}`;
  }, [model]);
  const manager = useSlideManager(model, panelRef);
  // A new active-frame SVG does not change the deck inventory. Keep card and
  // thumbnail inputs stable instead of rebuilding them for every snapshot.
  const deckFrames = model && snapshot.deck?.document === model ? snapshot.deck.frames : undefined;
  const figures = model ? undefined : snapshot.figures;
  const roots: Root[] = useMemo(() => {
    const occurrences = new Map<string, number>();
    return model ? model.frames.map((frame, i) => {
      const fingerprint = computeSourceFingerprint(model.source.slice(frame.span.from, frame.span.to));
      const occurrence = occurrences.get(fingerprint) ?? 0; occurrences.set(fingerprint, occurrence + 1);
      return { id: frame.id, span: frame.span, label: frame.title?.value ? `${i + 1}. ${frame.title.value}` : `Slide ${i + 1}`,
        thumbnailId: `slide:${fingerprint}:${occurrence}`, deckFrameIndex: i,
        stepCount: deckFrames?.[i]?.stepCount };
    }) : (figures ?? []).map((figure, i) => ({ id: figure.id, span: figure.span, label: `Figure ${i + 1} (L${figure.startLine})`, thumbnailId: figure.id }));
  }, [model, deckFrames, figures]);
  const entries = useMemo(() => {
    if (!model) return roots.map<Entry>(root => ({ kind: "frame", root }));
    const byId = new Map(roots.map(root => [root.id, root]));
    const result: Entry[] = [];
    let hiddenLevel = 0;
    for (const node of model.roots) {
      if (node.kind === "section") {
        if (hiddenLevel && node.level > hiddenLevel) continue;
        hiddenLevel = collapsed.has(node.id) ? node.level : 0;
        result.push({ kind: "section", id: node.id, title: node.title.value, level: node.level });
      } else if (!hiddenLevel) {
        const root = byId.get(node.id);
        if (root) result.push({ kind: "frame", root });
      }
    }
    return result;
  }, [model, roots, collapsed]);

  // Cards move only when the shown slides, their labels or sections change:
  // an edit inside a slide shifts later source spans but no card, so it
  // must not make every card measure itself (a forced layout).
  const shownKey = useMemo(() => entries.map(entry => entry.kind === "frame"
    ? `f\u0000${entry.root.id}\u0000${entry.root.label}` : `s\u0000${entry.id}\u0000${entry.level}\u0000${entry.title}`).join("\n"), [entries]);
  useEffect(() => {
    setCollapsed(collapsedByDocument.get(documentId) ?? new Set());
    const viewport = viewportRef.current;
    const saved = scrollByDocument.get(documentId);
    const animation = requestAnimationFrame(() => {
      if (viewport) { viewport.scrollLeft = saved?.left ?? 0; viewport.scrollTop = saved?.top ?? 0; }
    });
    return () => { cancelAnimationFrame(animation); };
  }, [documentId]);
  useEffect(() => {
    drag.current = null; setDragging(false); setDrop(null);
    dragPreview.current?.remove(); dragPreview.current = null;
    return () => { dragPreview.current?.remove(); dragPreview.current = null; };
  }, [documentId, revision]);
  useEffect(() => {
    const panel = panelRef.current;
    const viewport = viewportRef.current;
    if (!panel || !viewport) return;
    const shownIds = shownKey.split("\n").flatMap(line => {
      const [kind, id] = line.split("\u0000");
      return kind === "f" && id ? [id] : [];
    });
    let frame = 0;
    const update = () => {
      frame = 0;
      setLayout(panel.clientWidth < 270 ? "vertical" : panel.clientHeight < 240 ? "strip" : "grid");
      const box = viewport.getBoundingClientRect();
      const visible = shownIds.filter(id => {
        const rect = buttons.current.get(id)?.getBoundingClientRect();
        return rect && rect.right >= box.left - 180 && rect.left <= box.right + 180 && rect.bottom >= box.top - 180 && rect.top <= box.bottom + 180;
      });
      setVisibleRootIds(current => current.join() === visible.join() ? current : visible);
      scrollByDocument.set(documentId, { left: viewport.scrollLeft, top: viewport.scrollTop });
    };
    const schedule = () => { frame ||= requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    observer.observe(panel); observer.observe(viewport);
    viewport.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => { observer.disconnect(); viewport.removeEventListener("scroll", schedule); cancelAnimationFrame(frame); };
  }, [documentId, shownKey, layout]);
  // Reveal the active card when it or the slides' arrangement changes, not at
  // every edit: scrolling into view measures the layout. Collapsing a section
  // is no reason to reopen it.
  const arrangementKey = useMemo(() => roots.map(root => `${root.id}\u0000${root.label}`).join("\n"), [roots]);
  useEffect(() => {
    const navigation = `${documentId}:${activeRootId}\n${arrangementKey}`;
    if (lastNavigation.current === navigation) return;
    lastNavigation.current = navigation;
    const switchedDocument = lastNavigationDocument.current !== documentId;
    lastNavigationDocument.current = documentId;
    if (switchedDocument && scrollByDocument.has(documentId)) return;
    const frame = model?.frames.find(frame => frame.id === activeRootId);
    if (frame && (collapsed.has(frame.sectionId ?? "") || collapsed.has(frame.subsectionId ?? ""))) {
      setCollapsed(current => {
        const next = new Set(current); next.delete(frame.sectionId ?? ""); next.delete(frame.subsectionId ?? "");
        collapsedByDocument.set(documentId, next); return next;
      });
    }
    buttons.current.get(activeRootId ?? "")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeRootId, arrangementKey, documentId, model, collapsed]);
  useEffect(() => {
    const releaseFocus = () => { ownsFocus.current = false; };
    document.addEventListener("pointerdown", releaseFocus, true);
    document.addEventListener("focusin", releaseFocus, true);
    return () => {
      document.removeEventListener("pointerdown", releaseFocus, true);
      document.removeEventListener("focusin", releaseFocus, true);
    };
  }, []);
  // Restore focus once the slides of an edit the panel made are shown.
  const shownSource = model?.source ?? source;
  useEffect(() => {
    if (lastFocusSource.current === shownSource) return;
    lastFocusSource.current = shownSource;
    if (!ownsFocus.current || !panelRef.current) return;
    const target = manager.ids.includes(activeRootId ?? "") ? activeRootId : manager.ids[0];
    const button = buttons.current.get(target ?? "");
    (button ?? panelRef.current).focus({ preventScroll: true });
  }, [shownSource, activeRootId, manager.ids]);

  const thumbnailRoots = useMemo(() => roots.map(root => ({ ...root, id: root.thumbnailId })), [roots]);
  // The active slide or picture shows the canvas's own render instead of
  // rendering it again in the worker. A picture rendered during a drag or
  // scrub keeps its pre-edit viewBox, so its thumbnail waits for the edit's end.
  const mainFrame = snapshot.deck?.activeFrame;
  const mainSvg = rootRef?.kind === "beamer-frame"
    ? mainFrame?.frameId === activeRootId ? mainFrame?.svg ?? null : null
    : rootRef?.kind === "tikz-figure" && snapshot.activeRootId === activeRootId && !interactiveEdit
      ? snapshot.svg?.svg ?? null : null;
  const mainUrl = useMemo(() => mainSvg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mainSvg)}` : null, [mainSvg]);
  const mirrorActiveRoot = rootRef?.kind === "beamer-frame" || rootRef?.kind === "tikz-figure";
  const externalThumbnail = useMemo(() => {
    if (!mirrorActiveRoot) return;
    const root = roots.find(root => root.id === activeRootId);
    if (!root) return;
    return { figureId: root.thumbnailId, deckFrameIndex: root.deckFrameIndex, url: mainUrl };
  }, [activeRootId, mainUrl, mirrorActiveRoot, roots]);
  const visibleIds = useMemo(() => {
    const byId = new Map(roots.map(root => [root.id, root.thumbnailId]));
    return visibleRootIds.flatMap(id => byId.get(id) ?? []);
  }, [roots, visibleRootIds]);
  const priorities = useMemo(() => [...new Set([...visibleIds, ...roots.filter(root => root.id === activeRootId).map(root => root.thumbnailId)])], [visibleIds, roots, activeRootId]);
  const thumbnails = useFigureThumbnails(model ? model.source : snapshot.source, thumbnailRoots, {
    documentKey: documentId, graphicsPreviewBundleKey: snapshot.graphicsPreviewBundleKey,
    priorityFigureIds: priorities, maxToRender: Math.max(8, visibleIds.length + 4),
    externalThumbnail,
  });
  // Cards are memoized on what they show; their handlers read the latest
  // panel state through this ref instead of being new closures each render.
  const cardHandlers = useRef<CardHandlers | null>(null);
  useLayoutEffect(() => {
    cardHandlers.current = {
      click: (id, event) => {
        event.currentTarget.focus({ preventScroll: true });
        if (deckMode) manager.select(id, event); else dispatch({ type: "SET_ACTIVE_ROOT", rootId: id });
      },
      contextMenu: (id, event) => { if (deckMode) manager.contextMenu(event, id); },
      dragStart: (id, label, event) => {
        const ids = manager.ids.includes(id) ? manager.ids : [id];
        if (!ids.every(value => manager.movable.includes(value))) { event.preventDefault(); return; }
        if (!manager.ids.includes(id)) manager.select(id);
        const token = `${documentId}:${revision}:${id}`;
        drag.current = { documentId, revision, ids, token }; setDragging(true);
        event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(DRAG_TYPE, token);
        if (ids.length > 1) {
          dragPreview.current?.remove();
          const ghost = document.createElement("div");
          ghost.className = css.dragPreview; ghost.setAttribute("aria-hidden", "true");
          ghost.dataset.testid = "slide-drag-preview";
          const image = event.currentTarget.querySelector("img")?.cloneNode(true);
          if (image) ghost.appendChild(image);
          else {
            const title = document.createElement("div");
            title.className = css.dragTitle; title.textContent = label; ghost.appendChild(title);
          }
          const count = document.createElement("span");
          count.textContent = `${ids.length} slides`; ghost.appendChild(count);
          panelRef.current?.appendChild(ghost); dragPreview.current = ghost;
          event.dataTransfer.setDragImage(ghost, 24, 24);
        }
      },
      dragEnd: () => { clearDrag(); },
    };
  });
  const clearDrag = () => { dragPreview.current?.remove(); dragPreview.current = null; drag.current = null; setDragging(false); setDrop(null); };
  const toggleSection = (id: string) => {
    const next = new Set(collapsed); if (next.has(id)) next.delete(id); else next.add(id);
    collapsedByDocument.set(documentId, next); setCollapsed(next);
  };
  const dragOver = (event: DragEvent) => {
    const session = drag.current;
    if (session?.documentId !== documentId || session.revision !== revision) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "move";
    let target = (event.target as Element).closest<HTMLElement>("[data-slide-id], [data-section-id]");
    // Gaps between cards are insertion targets too. Only the space after
    // the last row/card represents the end of the document.
    if (!target) {
      const candidates = Array.from(viewportRef.current?.querySelectorAll<HTMLElement>("[data-slide-id], [data-section-id]") ?? [])
        .map(element => ({ element, rect: element.getBoundingClientRect() }));
      const last = candidates.at(-1)?.rect;
      if (last && (layout === "strip" ? event.clientX <= last.right : event.clientY <= last.bottom)) {
        const distance = (rect: DOMRect) => Math.hypot(
          Math.max(rect.left - event.clientX, 0, event.clientX - rect.right),
          Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom));
        target = candidates.sort((a, b) => distance(a.rect) - distance(b.rect))[0]?.element ?? null;
      }
    }
    let next: Drop = { key: "end", edge: "after", destination: { kind: "end" } };
    if (target) {
      const rect = target.getBoundingClientRect();
      const horizontal = layout === "strip" || (layout === "grid" && !target.dataset.sectionId);
      const edge = (horizontal ? event.clientX < rect.left + rect.width / 2 : event.clientY < rect.top + rect.height / 2) ? "before" : "after";
      const sectionId = target.dataset.sectionId;
      next = sectionId ? { key: sectionId, edge, destination: { kind: "section", sectionId, edge } }
        : { key: target.dataset.slideId!, edge, destination: { kind: edge, frameId: target.dataset.slideId! } };
    }
    setDrop(next);
    const view = viewportRef.current;
    if (view) {
      const rect = view.getBoundingClientRect();
      const delta = (position: number, min: number, max: number) => position < min + 32 ? -18 : position > max - 32 ? 18 : 0;
      view.scrollBy(layout === "strip" ? delta(event.clientX, rect.left, rect.right) : 0, layout === "strip" ? 0 : delta(event.clientY, rect.top, rect.bottom));
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('[role="menu"], dialog, [role="dialog"]')) return;
    const command = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const handled = () => { event.preventDefault(); event.stopPropagation(); };
    if (key === "escape") { handled(); clearDrag(); return; }
    if (deckMode && command && !event.altKey && !event.shiftKey && (key === "c" || key === "v")) {
      event.stopPropagation();
      const clipboard = getActiveEditorPlatform().clipboard;
      // Browser copy/paste events carry DataTransfer data without an async
      // permission prompt. Native keyboard actions can use the platform bridge.
      if (key === "c" ? clipboard?.writeText : clipboard?.readText) {
        event.preventDefault();
        if (key === "c") void manager.copy(); else void manager.paste();
      }
      return;
    }
    if (deckMode && command && key === "a") { handled(); manager.selectAll(); return; }
    if (deckMode && command && key === "d") { handled(); if (manager.canEditSelection) manager.edit({ kind: "duplicate", frameIds: manager.ids }); return; }
    if (deckMode && (key === "delete" || key === "backspace")) { handled(); if (manager.canEditSelection) manager.edit({ kind: "delete", frameIds: manager.ids }); return; }
    if (command && (key === "z" || key === "y")) { handled(); if (!locked) dispatch({ type: event.shiftKey || key === "y" ? "REDO" : "UNDO" }); return; }
    const id = (event.target as HTMLElement).closest<HTMLElement>("[data-slide-id]")?.dataset.slideId;
    if (!id) return;
    if (key === " " && deckMode) { handled(); manager.select(id, { ctrlKey: true }, false); return; }
    const visible = entries.flatMap(entry => entry.kind === "frame" ? [entry.root.id] : []);
    const current = visible.indexOf(id);
    let index = current;
    if (key === "home") index = 0;
    else if (key === "end") index = visible.length - 1;
    else if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) {
      if (event.altKey && deckMode && manager.canMoveSelection) {
        handled();
        const selected = roots.filter(root => manager.ids.includes(root.id));
        const backward = key === "arrowleft" || key === "arrowup";
        const edge = roots.findIndex(root => root.id === (backward ? selected[0]?.id : selected.at(-1)?.id));
        const neighbor = roots[edge + (backward ? -1 : 1)];
        if (neighbor) manager.edit({ kind: "move", frameIds: manager.ids, destination: { kind: backward ? "before" : "after", frameId: neighbor.id } });
        return;
      }
      let step = 1;
      if (layout === "grid" && (key === "arrowup" || key === "arrowdown")) {
        const rect = buttons.current.get(id)?.getBoundingClientRect();
        if (rect) {
          const candidates = visible.map(value => ({ value, rect: buttons.current.get(value)!.getBoundingClientRect() }))
            .filter(item => key === "arrowup" ? item.rect.top < rect.top - 1 : item.rect.top > rect.top + 1)
            .sort((a, b) => (Math.abs(a.rect.top - rect.top) * 10 + Math.abs(a.rect.left - rect.left)) - (Math.abs(b.rect.top - rect.top) * 10 + Math.abs(b.rect.left - rect.left)));
          if (candidates[0]) index = visible.indexOf(candidates[0].value);
          step = 0;
        }
      }
      index += step * (key === "arrowleft" || key === "arrowup" ? -1 : 1);
    } else return;
    handled();
    const next = visible[Math.max(0, Math.min(index, visible.length - 1))];
    if (next) {
      if (deckMode) manager.select(next, event); else dispatch({ type: "SET_ACTIVE_ROOT", rootId: next });
      buttons.current.get(next)?.focus();
    }
  };

  return <div ref={panelRef} className={css.panel} data-testid="figure-navigator" data-slide-manager={deckMode || undefined}
    data-layout={layout} data-dragging={dragging || undefined} onKeyDown={onKeyDown} tabIndex={-1}
    onCopy={event => {
      if (!deckMode || (event.target as Element).closest('[role="dialog"], [role="menu"]')) return;
      event.preventDefault(); event.stopPropagation();
      const text = manager.copyText();
      if (text != null) event.clipboardData.setData("text/plain", text);
    }}
    onPaste={event => {
      if (!deckMode || (event.target as Element).closest('[role="dialog"], [role="menu"]')) return;
      event.preventDefault(); event.stopPropagation();
      manager.pasteText(event.clipboardData.getData("text/plain"));
    }}
    onPointerDownCapture={() => { ownsFocus.current = true; }}
    onFocusCapture={event => {
      ownsFocus.current = true;
      // WebKit can focus the panel on pointer down before the clicked card.
      // Focusing the previous selection must not scroll that card into view.
      if (event.target === event.currentTarget) buttons.current.get(manager.ids[0] ?? activeRootId ?? "")?.focus({ preventScroll: true });
    }}>
    {deckMode && manager.ids.length > 1 ? <div className={css.toolbar}><span>{manager.ids.length} selected</span></div> : null}
    <div ref={viewportRef} className={css.viewport} data-testid="figure-navigator-strip" onDragOver={dragOver}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null); }}
      onDrop={event => {
        event.preventDefault();
        const session = drag.current;
        if (session && drop && event.dataTransfer.getData(DRAG_TYPE) === session.token && session.documentId === documentId && session.revision === revision) {
          manager.edit({ kind: "move", frameIds: session.ids, destination: drop.destination }, session.revision);
        }
        clearDrag();
      }}>
      <div className={css.items} role="list" aria-label={deckMode ? "Slides" : "Figures"}>
        {entries.map(entry => entry.kind === "section" ?
          <div key={entry.id} role="heading" aria-level={entry.level + 1} data-section-id={entry.id} data-level={entry.level}
            data-drop={drop?.key === entry.id ? drop.edge : undefined} className={css.section}>
            <button type="button" aria-expanded={!collapsed.has(entry.id)} onClick={() => { toggleSection(entry.id); }}>
              <span aria-hidden="true">{collapsed.has(entry.id) ? "▸" : "▾"}</span><span>{entry.title || "Untitled section"}</span>
            </button>
          </div> : <SlideCard key={entry.root.id} handlers={cardHandlers} buttons={buttons} id={entry.root.id} label={entry.root.label}
            thumbnail={thumbnails.get(entry.root.thumbnailId)} stepCount={entry.root.stepCount}
            selected={deckMode ? manager.ids.includes(entry.root.id) : activeRootId === entry.root.id}
            active={activeRootId === entry.root.id} drop={drop?.key === entry.root.id ? drop.edge : undefined}
            draggable={deckMode && manager.enabled && manager.movable.includes(entry.root.id)}
            aspectRatio={layout === "strip" ? undefined : previewAspectRatio} />)}
        <div className={css.endDrop} data-drop={drop?.key === "end" ? "after" : undefined} aria-hidden="true" />
      </div>
      {!roots.length && deckMode ? <div className={css.empty}>No slides</div> : null}
    </div>
    {manager.menu}
    {manager.review}
  </div>;
}

type CardHandlers = {
  click: (id: string, event: MouseEvent<HTMLButtonElement>) => void;
  contextMenu: (id: string, event: MouseEvent<HTMLButtonElement>) => void;
  dragStart: (id: string, label: string, event: DragEvent<HTMLButtonElement>) => void;
  dragEnd: () => void;
};

const SlideCard = memo(function SlideCard({ handlers, buttons, id, label, thumbnail, stepCount, selected, active, drop, draggable, aspectRatio }: {
  handlers: RefObject<CardHandlers | null>;
  buttons: RefObject<Map<string, HTMLButtonElement>>;
  id: string;
  label: string;
  thumbnail: string | undefined;
  stepCount: number | undefined;
  selected: boolean;
  active: boolean;
  drop: Drop["edge"] | undefined;
  draggable: boolean;
  aspectRatio: string | undefined;
}) {
  const style = useMemo(() => aspectRatio ? { aspectRatio } : undefined, [aspectRatio]);
  return <div role="listitem" data-slide-id={id} data-drop={drop} className={css.card}>
    <button type="button" className={css.thumb} data-selected={selected || undefined} data-active={active || undefined}
      aria-pressed={selected} aria-current={active ? "true" : undefined} aria-label={label} title={label}
      ref={node => { if (node) buttons.current.set(id, node); else buttons.current.delete(id); }}
      onClick={event => { handlers.current?.click(id, event); }}
      onContextMenu={event => { handlers.current?.contextMenu(id, event); }}
      draggable={draggable}
      onDragStart={event => { handlers.current?.dragStart(id, label, event); }}
      onDragEnd={() => { handlers.current?.dragEnd(); }}>
      <div className={css.preview} style={style}>
        {thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : <span>Rendering…</span>}
        {stepCount != null && stepCount > 1 ? <span className={css.stepBadge} data-testid="navigator-step-badge" title={`${stepCount} overlay steps`}>{stepCount}</span> : null}
      </div>
      <div className={css.label}>{label}</div>
    </button>
  </div>;
});
