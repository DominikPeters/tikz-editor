import { useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "../store/store";
import { useFigureThumbnails } from "./useFigureThumbnails";
import css from "./FigureNavigator.module.css";
import { hasMultipleRoots } from "../root-inventory";

const stripScrollByDocumentId = new Map<string, number>();

type NavigatorRoot = {
  id: string;
  span: { from: number; to: number };
  label: string;
  tooltip: string;
  stepCount?: number;
  deckFrameIndex?: number;
};

export function FigureNavigator() {
  const snapshot = useEditorStore((s) => s.snapshot);
  const source = snapshot.source;
  const deck = snapshot.deck;
  const tikzFigures = snapshot.figures;
  const figures: readonly NavigatorRoot[] = useMemo(
    () =>
      deck
        ? deck.frames.map((frame) => ({
            id: frame.id,
            span: frame.span,
            label: frame.title
              ? `${frame.frameIndex + 1}. ${frame.title}`
              : `Slide ${frame.frameIndex + 1}`,
            tooltip: frame.title ?? `Slide ${frame.frameIndex + 1}`,
            stepCount: frame.stepCount,
            deckFrameIndex: frame.frameIndex
          }))
        : tikzFigures.map((figure, index) => ({
            id: figure.id,
            span: figure.span,
            label: `Figure ${index + 1} (L${figure.startLine})`,
            tooltip: `Figure ${index + 1}`
          })),
    [deck, tikzFigures]
  );
  const activeRootId = useEditorStore((s) => s.activeRootId);
  const activeDocumentId = useEditorStore((s) => s.activeDocumentId);
  const dispatch = useEditorStore((s) => s.dispatch);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const thumbRefByFigureId = useRef(new Map<string, HTMLButtonElement>());
  const [visibleFigureIds, setVisibleFigureIds] = useState<string[]>([]);

  const activeIndex = useMemo(
    () => (activeRootId ? figures.findIndex((figure) => figure.id === activeRootId) : -1),
    [activeRootId, figures]
  );
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) {
      setVisibleFigureIds([]);
      return;
    }

    let raf = 0;
    const updateVisible = () => {
      raf = 0;
      stripScrollByDocumentId.set(activeDocumentId, strip.scrollLeft);
      const overscanPx = 220;
      const visibleMinX = strip.scrollLeft - overscanPx;
      const visibleMaxX = strip.scrollLeft + strip.clientWidth + overscanPx;
      const nextVisible: string[] = [];
      for (const figure of figures) {
        const thumb = thumbRefByFigureId.current.get(figure.id);
        if (!thumb) {
          continue;
        }
        const left = thumb.offsetLeft;
        const right = left + thumb.offsetWidth;
        if (right >= visibleMinX && left <= visibleMaxX) {
          nextVisible.push(figure.id);
        }
      }
      setVisibleFigureIds((current) => (current.join("|") === nextVisible.join("|") ? current : nextVisible));
    };
    const scheduleUpdate = () => {
      if (raf) {
        return;
      }
      raf = window.requestAnimationFrame(updateVisible);
    };

    scheduleUpdate();
    strip.addEventListener("scroll", scheduleUpdate, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleUpdate) : null;
    observer?.observe(strip);
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      strip.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      observer?.disconnect();
      if (raf) {
        window.cancelAnimationFrame(raf);
      }
    };
  }, [activeDocumentId, figures]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) {
      return;
    }
    const targetScrollLeft = stripScrollByDocumentId.get(activeDocumentId) ?? 0;
    const raf = window.requestAnimationFrame(() => {
      strip.scrollLeft = targetScrollLeft;
    });
    return () => { window.cancelAnimationFrame(raf); };
  }, [activeDocumentId, figures.length]);

  const priorityFigureIds = useMemo(() => {
    const ids: string[] = [...visibleFigureIds];
    if (activeIndex < 0) {
      for (const figure of figures.slice(0, 6)) {
        if (!ids.includes(figure.id)) {
          ids.push(figure.id);
        }
      }
      return ids;
    }
    for (let index = Math.max(0, activeIndex - 2); index <= Math.min(figures.length - 1, activeIndex + 3); index += 1) {
      const figure = figures[index];
      if (figure && !ids.includes(figure.id)) {
        ids.push(figure.id);
      }
    }
    return ids;
  }, [activeIndex, figures, visibleFigureIds]);
  const maxToRender = useMemo(() => Math.max(8, visibleFigureIds.length + 4), [visibleFigureIds.length]);
  const thumbnails = useFigureThumbnails(source, figures, {
    documentKey: activeDocumentId,
    graphicsPreviewBundleKey: snapshot.graphicsPreviewBundleKey,
    priorityFigureIds,
    maxToRender,
    refreshDelayMs: 350
  });

  if (!hasMultipleRoots(figures.length)) {
    return null;
  }

  const canGoPrev = activeIndex > 0;
  const canGoNext = activeIndex >= 0 && activeIndex < figures.length - 1;

  const selectAt = (index: number) => {
    const figure = figures[index];
    if (!figure) {
      return;
    }
    dispatch({ type: "SET_ACTIVE_ROOT", rootId: figure.id });
  };

  return (
    <div className={css.panel} data-testid="figure-navigator">
      <button
        type="button"
        className={css.navButton}
        disabled={!canGoPrev}
        onClick={() => { selectAt(activeIndex - 1); }}
        aria-label="Previous figure"
      >
        {"<"}
      </button>
      <div className={css.strip} ref={stripRef} data-testid="figure-navigator-strip">
        {figures.map((figure) => {
          const thumbnail = thumbnails.get(figure.id);
          const isActive = figure.id === activeRootId;
          return (
            <button
              type="button"
              key={figure.id}
              className={[css.thumb, isActive ? css.thumbActive : ""].filter(Boolean).join(" ")}
              onClick={() => { dispatch({ type: "SET_ACTIVE_ROOT", rootId: figure.id }); }}
              title={figure.tooltip}
              aria-label={figure.tooltip}
              ref={(node) => {
                if (!node) {
                  thumbRefByFigureId.current.delete(figure.id);
                  return;
                }
                thumbRefByFigureId.current.set(figure.id, node);
              }}
            >
              <div className={css.thumbPreview}>
                {thumbnail ? <img src={thumbnail} alt={`${figure.tooltip} preview`} /> : "Rendering…"}
                {figure.stepCount != null && figure.stepCount > 1 ? (
                  <span className={css.thumbStepBadge} data-testid="navigator-step-badge">
                    {figure.stepCount}
                  </span>
                ) : null}
              </div>
              <div className={css.thumbLabel}>{figure.label}</div>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={css.navButton}
        disabled={!canGoNext}
        onClick={() => { selectAt(activeIndex + 1); }}
        aria-label="Next figure"
      >
        {">"}
      </button>
    </div>
  );
}
