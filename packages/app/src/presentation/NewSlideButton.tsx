import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { RiAddLine } from "@remixicon/react";
import { parseDocumentRootId, formatDocumentRootId } from "@tikz-editor/core/document/root-id";
import { BEAMER_SLIDE_TEMPLATES, beamerSlideTemplates, editBeamerSlides, resolveBeamerPageGeometry, scanBeamerDocument, type BeamerSlideEdit, type BeamerSlideTemplateId } from "@tikz-editor/core/beamer";
import { useEditorStore } from "../store/store";
import { useSettingsStore } from "../settings/useSettingsStore";
import { CaretDownIcon } from "../ui/tool-config";
import { useFigureThumbnails, type ThumbnailRootEntry } from "../ui/useFigureThumbnails";
import toolbarCss from "../ui/Toolbar.module.css";
import menuCss from "../ui/AppMenuBar.module.css";
import css from "./PresentationControls.module.css";

// The button repeats the layout last chosen from the gallery, except a
// title page, which a deck rarely wants twice.
let lastTemplate: BeamerSlideTemplateId = "title-only";

function insertSlide(template: BeamerSlideTemplateId) {
  const state = useEditorStore.getState(), root = parseDocumentRootId(state.activeRootId ?? "");
  const frameId = root?.kind === "beamer-frame-tikz" ? formatDocumentRootId({ kind: "beamer-frame", index: root.frameIndex }) : state.activeRootId;
  const edit: BeamerSlideEdit = { kind: "insert", destination: frameId ? { kind: "after", frameId } : { kind: "end" }, template };
  if (editBeamerSlides(state.source, edit)) state.dispatch({ type: "EDIT_DECK_SLIDES", documentId: state.activeDocumentId, baseRevision: state.sourceRevision, edit });
}

export function NewSlideButton() {
  const kind = useEditorStore(state => state.documentKind);
  const locked = useEditorStore(state => !!state.documents[state.activeDocumentId]?.assistantLockReason);
  const uiFontSizePx = useSettingsStore(state => state.settings.general.uiFontSizePx);
  const [template, setTemplate] = useState(lastTemplate);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLDivElement>(null);
  const close = (focus: boolean) => {
    setPosition(null);
    if (focus) ref.current?.querySelector<HTMLButtonElement>('[aria-label="Slide layouts"]')?.focus();
  };
  useEffect(() => {
    if (!position) return;
    const outside = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!ref.current?.contains(target) && !galleryRef.current?.contains(target)) setPosition(null);
    };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") close(true); };
    window.addEventListener("pointerdown", outside); window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape); };
  }, [position]);
  // Kept inside the window, shifted left where the toolbar is narrow.
  useLayoutEffect(() => {
    const overflow = (galleryRef.current?.getBoundingClientRect().right ?? 0) - (window.innerWidth - 8);
    if (position && overflow > 0.5 && position.left > 8) setPosition({ ...position, left: Math.max(8, position.left - overflow) });
  }, [position]);
  if (kind !== "beamer") return null;
  const name = BEAMER_SLIDE_TEMPLATES.find(candidate => candidate.id === template)?.name;
  const choose = (id: BeamerSlideTemplateId) => {
    if (id !== "title") { lastTemplate = id; setTemplate(id); }
    close(false);
    insertSlide(id);
  };
  return <div ref={ref} className={[toolbarCss.splitButton, css.newSlide].join(" ")}>
    <button type="button" className={[toolbarCss.btn, toolbarCss.splitButtonMain, css.labelButton, css.newSlideMain].join(" ")} disabled={locked}
      title={`New slide: ${name}`} onClick={() => { setPosition(null); insertSlide(template); }}>
      <RiAddLine size={18} aria-hidden="true" /><span>New Slide</span>
    </button>
    <button type="button" className={[toolbarCss.btn, toolbarCss.splitButtonCaret].join(" ")} disabled={locked} aria-label="Slide layouts" aria-haspopup="menu" aria-expanded={!!position}
      onClick={() => {
        const rect = ref.current?.getBoundingClientRect();
        setPosition(position || !rect ? null : { top: rect.bottom + 4, left: Math.max(8, rect.left) });
      }}><CaretDownIcon size={8} /></button>
    {position ? createPortal(<div ref={galleryRef} className={[menuCss.popup, css.gallery].join(" ")} data-select="chrome"
      style={{ position: "fixed", ...position, "--app-ui-scale": uiFontSizePx / 11 } as CSSProperties}>
      <SlideLayoutGallery current={template} onChoose={choose} />
    </div>, document.body) : null}
  </div>;
}

const COLUMNS = 4;

/**
 * The deck's layouts drawn in its own theme: a deck of the preamble (and
 * whatever precedes the first frame) with one frame per layout.
 */
function SlideLayoutGallery({ current, onChoose }: { current: BeamerSlideTemplateId; onChoose: (id: BeamerSlideTemplateId) => void }) {
  const source = useEditorStore(state => state.source);
  const documentId = useEditorStore(state => state.activeDocumentId);
  const graphicsPreviewBundleKey = useEditorStore(state => state.snapshot.graphicsPreviewBundleKey);
  const document = useMemo(() => scanBeamerDocument(source), [source]);
  const prefix = source.slice(0, document.frames[0]?.span.from ?? document.documentBodySpan.to);
  const preview = useMemo(() => layoutPreviewDeck(prefix), [prefix]);
  const thumbnails = useFigureThumbnails(preview.source, preview.roots, {
    documentKey: `${documentId}:slide-layouts`, maxToRender: preview.roots.length,
    ...(graphicsPreviewBundleKey === undefined ? {} : { graphicsPreviewBundleKey }),
  });
  const aspectRatio = useMemo(() => {
    const { page } = resolveBeamerPageGeometry(document);
    return `${page.width} / ${page.height}`;
  }, [document]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLButtonElement>(`[data-template="${current}"]`)?.focus();
  }, [current]);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[event.key];
    if (step === undefined && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const index = items.findIndex(button => button === event.target);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : index + (step ?? 0);
    items[Math.min(Math.max(next, 0), items.length - 1)]?.focus();
  };
  const templates = beamerSlideTemplates(document);
  return <div ref={listRef} className={css.galleryGrid} role="menu" aria-label="Slide layouts" onKeyDown={move}>
    {templates.map(template => {
      const thumbnail = thumbnails.get(template.id);
      return <button key={template.id} type="button" role="menuitem" className={css.layout} data-template={template.id}
        aria-current={template.id === current || undefined} onClick={() => { onChoose(template.id); }}>
        <span className={css.layoutPreview} style={{ aspectRatio }}>
          {thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : null}
        </span>
        <span className={css.layoutName}>{template.name}</span>
      </button>;
    })}
  </div>;
}

function layoutPreviewDeck(prefix: string): { source: string; roots: ThumbnailRootEntry[] } {
  let source = prefix + (prefix.endsWith("\n") ? "" : "\n") + "\\end{document}\n";
  const ids: [BeamerSlideTemplateId, string][] = [];
  for (const { id } of beamerSlideTemplates(scanBeamerDocument(source))) {
    const result = editBeamerSlides(source, { kind: "insert", destination: { kind: "end" }, template: id });
    const frameId = result?.selectedFrameIds[0];
    if (!result || !frameId) continue;
    source = result.source;
    ids.push([id, frameId]);
  }
  const frames = new Map(scanBeamerDocument(source).frames.map((frame, index) => [frame.id, { span: frame.span, index }]));
  return { source, roots: ids.flatMap(([id, frameId]) => {
    const frame = frames.get(frameId);
    return frame ? [{ id, span: frame.span, deckFrameIndex: frame.index }] : [];
  }) };
}
