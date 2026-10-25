import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  BEAMER_PRESENTATION_THEMES,
  type BeamerThemeCatalogEntry,
  type BeamerThemeGroup,
} from "@tikz-editor/core/beamer/index";
import { computeSourceFingerprint } from "@tikz-editor/core/utils/source-fingerprint";
import { BoundedLru } from "../../bounded-lru";
import { deckStepRootKey } from "../../root-key";
import { useEditorStore } from "../../store/store";
import { cancelGroup, requestThumbnail } from "../workers/thumbnail-worker-client";
import { useThemePreviewStore } from "./theme-preview-store";
import css from "./ThemeGallery.module.css";

/**
 * The theme gallery (design/beamer-document-inspector.md, phase 2). Every
 * tile renders this deck's title slide, with the current slide inset, under
 * that theme, through the thumbnail worker's `presentationTheme` override:
 * the source is never touched until a tile is chosen. Hovering or focusing
 * a tile draws its current-slide render over the canvas page. The popover
 * covers the inspector column rather than the canvas, so that preview stays
 * in view.
 */
const GROUPS: ReadonlyArray<{ id: BeamerThemeGroup; label: string }> = [
  { id: "modern", label: "Modern" },
  { id: "no-navigation", label: "No Navigation Bar" },
  { id: "tree", label: "Tree Navigation" },
  { id: "sidebar", label: "Sidebar" },
  { id: "mini-frames", label: "Mini Frames" },
  { id: "section-tables", label: "Section Tables" },
];

// SVG data URLs keyed by source, theme, frame and step; shared across openings.
const renders = new BoundedLru<string, string>(400, 48 * 1024 * 1024);
let groupCounter = 0;
let requestCounter = 0;

type WantedFrame = { frameIndex: number; step?: number };

export function ThemeGalleryPopover(props: {
  anchor: HTMLElement;
  currentThemeId: string | null;
  onApply: (entry: BeamerThemeCatalogEntry) => void;
  onClose: () => void;
}): JSX.Element {
  const { anchor, currentThemeId, onApply, onClose } = props;
  const source = useEditorStore((s) => s.source);
  const snapshot = useEditorStore((s) => s.snapshot);
  const documentId = useEditorStore((s) => s.activeDocumentId);
  const activeRootId = useEditorStore((s) => s.activeRootId);
  const activeStep = useEditorStore((s) => s.deckStepByRootKey[deckStepRootKey(s.activeDocumentId, s.activeRootId)] ?? 1);
  const showPreview = useThemePreviewStore((s) => s.show);
  const clearPreview = useThemePreviewStore((s) => s.clear);
  const rootRef = useRef<HTMLDivElement>(null);
  const focusedInitially = useRef(false);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const [tick, setTick] = useState(0);
  const [previewed, setPreviewed] = useState<string | null>(null);

  const frames = snapshot.deck?.frames ?? [];
  const pageBox = snapshot.deck?.activeFrame?.viewBox;
  const slideAspect = pageBox ? `${pageBox.width} / ${pageBox.height}` : undefined;
  const graphicsKey = snapshot.graphicsPreviewBundleKey ?? null;
  const current = frames.find((frame) => frame.id === activeRootId) ?? null;
  // The title slide is the first frame that typesets one; else the first frame.
  const title = frames.find((frame) => /\\(titlepage|maketitle)\b/u.test(source.slice(frame.span.from, frame.span.to))) ?? frames[0] ?? null;
  const currentIndex = current?.frameIndex ?? null;
  const currentStep = Math.min(activeStep, Math.max(1, current?.stepCount ?? 1));
  const titleIndex = title && title.frameIndex !== currentIndex ? title.frameIndex : null;
  const currentFrame = useMemo<WantedFrame | null>(
    () => (currentIndex == null ? null : { frameIndex: currentIndex, step: currentStep }),
    [currentStep, currentIndex]
  );
  const titleFrame = useMemo<WantedFrame | null>(() => (titleIndex == null ? null : { frameIndex: titleIndex }), [titleIndex]);
  const fingerprint = useMemo(() => computeSourceFingerprint(source), [source]);
  const keyFor = useCallback(
    (themeId: string, frame: WantedFrame): string =>
      `${fingerprint}|${graphicsKey ?? ""}|${themeId}|${frame.frameIndex}|${frame.step ?? "final"}`,
    [fingerprint, graphicsKey]
  );

  // Request every tile's renders, current theme first, in display order.
  useEffect(() => {
    const groupId = `theme-gallery-${(groupCounter += 1).toString(36)}`;
    // An object, so the async loop sees the cleanup's write.
    const run = { cancelled: false };
    const isCancelled = (): boolean => run.cancelled;
    const ordered = orderedThemes(currentThemeId);
    void (async () => {
      for (const entry of ordered) {
        for (const frame of [currentFrame, titleFrame]) {
          if (isCancelled() || !frame) continue;
          const key = keyFor(entry.id, frame);
          if (renders.has(key)) continue;
          const result = await requestThumbnail({
            type: "render",
            requestId: `theme-gallery-${(requestCounter += 1).toString(36)}`,
            groupId,
            source,
            figureId: `theme-gallery:${entry.id}:${frame.frameIndex}`,
            figureSignature: key,
            ...(graphicsKey ? { graphicsPreviewBundleKey: graphicsKey } : {}),
            deckFrameIndex: frame.frameIndex,
            ...(frame.step === undefined ? {} : { deckStep: frame.step }),
            presentationTheme: entry.name,
            parseOptions: { recover: true, activeRootId: `theme-gallery:${entry.id}`, includeContextDefinitions: true },
          }).catch(() => null);
          if (isCancelled()) return;
          if (result?.ok) {
            const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`;
            renders.set(key, url, url.length * 2);
            setTick((value) => value + 1);
          }
        }
      }
    })();
    return () => { run.cancelled = true; cancelGroup(groupId); };
  }, [currentFrame, currentThemeId, graphicsKey, keyFor, source, titleFrame]);

  // The canvas shows the previewed theme's current slide once it is rendered.
  const currentId = current?.id ?? null;
  useEffect(() => {
    void tick;
    // The current theme needs no preview: the canvas already shows it.
    if (previewed == null || previewed === currentThemeId || !currentFrame || currentId == null) {
      clearPreview();
      return;
    }
    const url = renders.get(keyFor(previewed, currentFrame));
    if (url) showPreview({ documentId, frameId: currentId, step: currentStep, source, themeId: previewed, url });
    else clearPreview();
  }, [currentStep, clearPreview, currentFrame, currentId, currentThemeId, documentId, keyFor, previewed, showPreview, source, tick]);
  useEffect(() => clearPreview, [clearPreview]);

  useLayoutEffect(() => {
    const place = (): void => {
      // Over the inspector's scrolling content, full height: the canvas
      // stays in view for the preview.
      const scope = anchor.closest("[data-inspector-panel]");
      const panelRect = (scope?.parentElement ?? anchor).getBoundingClientRect();
      const scale = Number(getComputedStyle(anchor).getPropertyValue("--app-ui-scale")) || 1;
      const width = Math.min(Math.max(panelRect.width - 8, 280 * scale + 48), window.innerWidth - 16);
      const left = Math.max(8, Math.min(panelRect.right - 4 - width, window.innerWidth - width - 8));
      const top = Math.max(8, panelRect.top + 4);
      const bottom = Math.min(window.innerHeight - 8, Math.max(panelRect.bottom - 4, top + 320));
      setPosition({ left, top, width, maxHeight: bottom - top });
    };
    place();
    const root = rootRef.current;
    const style = getComputedStyle(anchor);
    root?.style.setProperty("--app-ui-scale", style.getPropertyValue("--app-ui-scale"));
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !root?.contains(event.target) && !anchor.contains(event.target)) onClose();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", place);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("blur", onClose);
    };
  }, [anchor, onClose]);

  const positioned = position != null;
  useLayoutEffect(() => {
    if (!positioned || focusedInitially.current) return;
    focusedInitially.current = true;
    const selected = rootRef.current?.querySelector<HTMLButtonElement>("[aria-pressed='true']")
      ?? rootRef.current?.querySelector<HTMLButtonElement>("button[data-theme-id]");
    selected?.focus({ preventScroll: true });
    selected?.scrollIntoView({ block: "nearest" });
  }, [positioned]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      anchor.focus();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const tiles = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>("button[data-theme-id]") ?? []);
    const index = tiles.findIndex((tile) => tile === document.activeElement);
    const focused = tiles[index];
    if (!focused) return;
    event.preventDefault();
    const next = event.key === "ArrowLeft" || event.key === "ArrowRight"
      ? tiles[index + (event.key === "ArrowRight" ? 1 : -1)]
      : verticalNeighbor(tiles, focused, event.key === "ArrowDown" ? 1 : -1);
    next?.focus();
    next?.scrollIntoView({ block: "nearest" });
  };

  return createPortal(
    <div
      ref={rootRef}
      className={css.popover}
      role="dialog"
      aria-label="Themes"
      style={{
        ...(position ? { left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight } : { visibility: "hidden" }),
        ...(slideAspect ? { "--slide-aspect": slideAspect } : {}),
      }}
      onKeyDown={onKeyDown}
      onPointerLeave={() => { setPreviewed(null); }}
    >
      <div className={css.header}>
        <span className={css.title}>Themes</span>
      </div>
      <div className={css.scroll}>
        {GROUPS.map((group) => (
          <section key={group.id} className={css.group}>
            <h3 className={css.groupTitle}>{group.label}</h3>
            <div className={css.grid}>
              {BEAMER_PRESENTATION_THEMES.filter((entry) => entry.group === group.id).map((entry) => {
                const main = titleFrame ?? currentFrame;
                const mainUrl = main ? renders.get(keyFor(entry.id, main)) : undefined;
                const insetUrl = titleFrame && currentFrame ? renders.get(keyFor(entry.id, currentFrame)) : undefined;
                const selected = entry.id === currentThemeId;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={selected ? `${css.tile} ${css.tileSelected}` : css.tile}
                    data-theme-id={entry.id}
                    aria-pressed={selected}
                    aria-label={`${entry.label}${selected ? " (current)" : ""}`}
                    // Move, not enter: the popover opens under the pointer, and a
                    // tile that lands there should not preview until it moves.
                    onPointerMove={() => { setPreviewed(entry.id); }}
                    onFocus={() => { setPreviewed(entry.id); }}
                    onClick={() => {
                      onClose();
                      if (!selected) onApply(entry);
                      anchor.focus();
                    }}
                  >
                    <span className={css.thumb}>
                      {mainUrl ? <img className={css.thumbImage} src={mainUrl} alt="" draggable={false} /> : <span className={css.thumbPending} />}
                      {titleFrame && currentFrame ? (
                        <span className={css.inset}>
                          {insetUrl ? <img className={css.thumbImage} src={insetUrl} alt="" draggable={false} /> : <span className={css.thumbPending} />}
                        </span>
                      ) : null}
                    </span>
                    <span className={css.name}>{entry.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>,
    document.body
  );
}

/** The current theme first, so its tile and the first preview arrive soonest. */
function orderedThemes(currentThemeId: string | null): BeamerThemeCatalogEntry[] {
  const ordered = GROUPS.flatMap((group) => BEAMER_PRESENTATION_THEMES.filter((entry) => entry.group === group.id));
  return [
    ...ordered.filter((entry) => entry.id === currentThemeId),
    ...ordered.filter((entry) => entry.id !== currentThemeId),
  ];
}

/** The tile in the next or previous row closest to this one horizontally. */
function verticalNeighbor(tiles: readonly HTMLButtonElement[], focused: HTMLButtonElement, direction: 1 | -1): HTMLButtonElement | undefined {
  const from = focused.getBoundingClientRect();
  const candidates = tiles.filter((tile) => {
    const rect = tile.getBoundingClientRect();
    return direction === 1 ? rect.top > from.top + 1 : rect.top < from.top - 1;
  });
  if (candidates.length === 0) return undefined;
  const rowTop = direction === 1
    ? Math.min(...candidates.map((tile) => tile.getBoundingClientRect().top))
    : Math.max(...candidates.map((tile) => tile.getBoundingClientRect().top));
  return candidates
    .filter((tile) => Math.abs(tile.getBoundingClientRect().top - rowTop) < 1)
    .sort((a, b) => Math.abs(a.getBoundingClientRect().left - from.left) - Math.abs(b.getBoundingClientRect().left - from.left))[0];
}
