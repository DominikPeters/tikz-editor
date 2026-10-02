import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { scanBeamerDocument, type BeamerSlideDestination } from "@tikz-editor/core/beamer/index";
import { formatDocumentRootId, parseDocumentRootId } from "@tikz-editor/core/document/root-id";
import { computeSourceFingerprint } from "@tikz-editor/core/utils/source-fingerprint";
import { useEditorStore } from "../store/store";
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
  const panelRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const drag = useRef<{ documentId: string; revision: number; ids: string[]; token: string } | null>(null);
  const lastNavigation = useRef("");
  const lastNavigationDocument = useRef<string | null>(null);
  const lastFocusSource = useRef(source);
  const ownsFocus = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [layout, setLayout] = useState<Layout>("strip");
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => collapsedByDocument.get(documentId) ?? new Set());
  const model = useMemo(() => deckMode ? scanBeamerDocument(source) : null, [deckMode, source]);
  const manager = useSlideManager(model, panelRef);
  const roots: Root[] = useMemo(() => {
    const occurrences = new Map<string, number>();
    return model ? model.frames.map((frame, i) => {
      const fingerprint = computeSourceFingerprint(source.slice(frame.span.from, frame.span.to));
      const occurrence = occurrences.get(fingerprint) ?? 0; occurrences.set(fingerprint, occurrence + 1);
      return { id: frame.id, span: frame.span, label: frame.title?.value ? `${i + 1}. ${frame.title.value}` : `Slide ${i + 1}`,
        thumbnailId: `slide:${fingerprint}:${occurrence}`, deckFrameIndex: i,
        stepCount: snapshot.source === source ? snapshot.deck?.frames[i]?.stepCount : undefined };
    }) : snapshot.figures.map((figure, i) => ({ id: figure.id, span: figure.span, label: `Figure ${i + 1} (L${figure.startLine})`, thumbnailId: figure.id }));
  }, [model, snapshot, source]);
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
  }, [documentId, revision]);
  useEffect(() => {
    const panel = panelRef.current;
    const viewport = viewportRef.current;
    if (!panel || !viewport) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setLayout(panel.clientWidth < 270 ? "vertical" : panel.clientHeight < 240 ? "strip" : "grid");
      const box = viewport.getBoundingClientRect();
      const visible = roots.filter(root => {
        const rect = buttons.current.get(root.id)?.getBoundingClientRect();
        return rect && rect.right >= box.left - 180 && rect.left <= box.right + 180 && rect.bottom >= box.top - 180 && rect.top <= box.bottom + 180;
      }).map(root => root.thumbnailId);
      setVisibleIds(current => current.join() === visible.join() ? current : visible);
      scrollByDocument.set(documentId, { left: viewport.scrollLeft, top: viewport.scrollTop });
    };
    const schedule = () => { frame ||= requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    observer.observe(panel); observer.observe(viewport);
    viewport.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => { observer.disconnect(); viewport.removeEventListener("scroll", schedule); cancelAnimationFrame(frame); };
  }, [documentId, roots, layout, collapsed]);
  useEffect(() => {
    const navigation = `${documentId}:${activeRootId}:${revision}`;
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
  }, [activeRootId, documentId, model, collapsed, revision]);
  useEffect(() => {
    const releaseFocus = () => { ownsFocus.current = false; };
    document.addEventListener("pointerdown", releaseFocus, true);
    document.addEventListener("focusin", releaseFocus, true);
    return () => {
      document.removeEventListener("pointerdown", releaseFocus, true);
      document.removeEventListener("focusin", releaseFocus, true);
    };
  }, []);
  useEffect(() => {
    if (lastFocusSource.current === source) return;
    lastFocusSource.current = source;
    if (!ownsFocus.current || !panelRef.current) return;
    const target = manager.ids.includes(activeRootId ?? "") ? activeRootId : manager.ids[0];
    const button = buttons.current.get(target ?? "") ?? panelRef.current.querySelector<HTMLButtonElement>("button");
    button?.focus();
  }, [source, activeRootId, manager.ids]);

  const thumbnailRoots = useMemo(() => roots.map(root => ({ ...root, id: root.thumbnailId })), [roots]);
  const priorities = useMemo(() => [...new Set([...visibleIds, ...roots.filter(root => root.id === activeRootId).map(root => root.thumbnailId)])], [visibleIds, roots, activeRootId]);
  const thumbnails = useFigureThumbnails(model ? source : snapshot.source, thumbnailRoots, {
    documentKey: documentId, graphicsPreviewBundleKey: snapshot.graphicsPreviewBundleKey,
    priorityFigureIds: priorities, maxToRender: Math.max(8, visibleIds.length + 4), refreshDelayMs: 350,
  });
  const clearDrag = () => { drag.current = null; setDragging(false); setDrop(null); };
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
    onPointerDownCapture={() => { ownsFocus.current = true; }}
    onFocusCapture={event => {
      ownsFocus.current = true;
      if (event.target === event.currentTarget) buttons.current.get(manager.ids[0] ?? activeRootId ?? "")?.focus();
    }}>
    {deckMode ? <div className={css.toolbar}>
      <button type="button" onClick={manager.insert} disabled={!manager.enabled}>New slide</button>
      {manager.ids.length > 1 ? <span>{manager.ids.length} selected</span> : null}
    </div> : null}
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
          </div> : (() => {
            const root = entry.root;
            const selected = deckMode ? manager.ids.includes(root.id) : activeRootId === root.id;
            const thumbnail = thumbnails.get(root.thumbnailId);
            return <div role="listitem" key={root.id} data-slide-id={root.id} data-drop={drop?.key === root.id ? drop.edge : undefined} className={css.card}>
              <button type="button" className={css.thumb} data-selected={selected || undefined} data-active={activeRootId === root.id || undefined}
                aria-pressed={selected} aria-current={activeRootId === root.id ? "true" : undefined} aria-label={root.label} title={root.label}
                ref={node => { if (node) buttons.current.set(root.id, node); else buttons.current.delete(root.id); }}
                onClick={event => { if (deckMode) manager.select(root.id, event); else dispatch({ type: "SET_ACTIVE_ROOT", rootId: root.id }); }}
                onContextMenu={event => { if (deckMode) manager.contextMenu(event, root.id); }}
                draggable={deckMode && manager.enabled && manager.movable.includes(root.id)}
                onDragStart={event => {
                  const ids = manager.ids.includes(root.id) ? manager.ids : [root.id];
                  if (!ids.every(id => manager.movable.includes(id))) { event.preventDefault(); return; }
                  if (!manager.ids.includes(root.id)) manager.select(root.id);
                  const token = `${documentId}:${revision}:${root.id}`;
                  drag.current = { documentId, revision, ids, token }; setDragging(true);
                  event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(DRAG_TYPE, token);
                }} onDragEnd={clearDrag}>
                <div className={css.preview}>{thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : <span>Rendering…</span>}
                  {root.stepCount != null && root.stepCount > 1 ? <span className={css.stepBadge} data-testid="navigator-step-badge" title={`${root.stepCount} overlay steps`}>{root.stepCount}</span> : null}
                </div>
                <div className={css.label}>{root.label}</div>
              </button>
            </div>;
          })())}
        <div className={css.endDrop} data-drop={drop?.key === "end" ? "after" : undefined} aria-hidden="true" />
      </div>
      {!roots.length && deckMode ? <div className={css.empty}>No slides</div> : null}
    </div>
    {manager.menu}
    {manager.review}
  </div>;
}
