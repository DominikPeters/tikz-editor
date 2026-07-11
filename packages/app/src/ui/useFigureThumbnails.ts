import { useEffect, useMemo, useRef, useState } from "react";
import type { ParseTikzResult } from "@tikz-editor/core/parser/index";
import { cancelGroup, requestThumbnail } from "./workers/thumbnail-worker-client";
import type { ThumbnailRenderRequest } from "./workers/thumbnail-worker-types";

type FigureEntry = ParseTikzResult["figures"][number];

type UseFigureThumbnailsOptions = {
  documentKey?: string;
  priorityFigureIds?: readonly string[];
  maxToRender?: number;
  refreshDelayMs?: number;
};
const EMPTY_PRIORITY_FIGURE_IDS: readonly string[] = [];

const thumbnailCache = new Map<string, string>();
const thumbnailInFlight = new Map<string, Promise<string | null>>();
let thumbnailGroupCounter = 0;
let thumbnailRequestCounter = 0;

export function resetFigureThumbnailStateForTests(): void {
  thumbnailCache.clear();
  thumbnailInFlight.clear();
  thumbnailGroupCounter = 0;
  thumbnailRequestCounter = 0;
}

function makeFigureSignature(source: string, figure: FigureEntry): string {
  const from = Math.max(0, Math.min(source.length, figure.span.from));
  const to = Math.max(from, Math.min(source.length, figure.span.to));
  const slice = source.slice(from, to);
  const head = slice.slice(0, 48);
  const tail = slice.slice(-48);
  return `${slice.length}:${head}:${tail}`;
}

function makeCacheKey(figureId: string, figureSignature: string): string {
  return `${figureId}|${figureSignature}`;
}

export function useFigureThumbnails(
  source: string,
  figures: readonly FigureEntry[],
  options: UseFigureThumbnailsOptions = {}
): ReadonlyMap<string, string> {
  const {
    documentKey = "__default__",
    priorityFigureIds = EMPTY_PRIORITY_FIGURE_IDS,
    maxToRender = 8,
    refreshDelayMs = 350
  } = options;
  const [stableInput, setStableInput] = useState<{
    source: string;
    figures: readonly FigureEntry[];
    documentKey: string;
  }>({
    source,
    figures,
    documentKey
  });
  const lastThumbnailByDocumentKeyRef = useRef(new Map<string, Map<string, string>>());
  const requestTokenByFigureRef = useRef(new Map<string, number>());
  const stableSource = stableInput.source;
  const stableFigures = stableInput.figures;

  useEffect(() => {
    setStableInput({ source, figures, documentKey });
    if (!lastThumbnailByDocumentKeyRef.current.has(documentKey)) {
      lastThumbnailByDocumentKeyRef.current.set(documentKey, new Map<string, string>());
    }
  }, [documentKey, figures, source]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => { setStableInput((current) => ({ ...current, source, figures })); },
      refreshDelayMs
    );
    return () => { window.clearTimeout(timer); };
  }, [documentKey, figures, refreshDelayMs, source]);

  const figureSignatures = useMemo(() => {
    const map = new Map<string, string>();
    for (const figure of stableFigures) {
      map.set(figure.id, makeFigureSignature(stableSource, figure));
    }
    return map;
  }, [stableFigures, stableSource]);
  const figureKey = useMemo(
    () => stableFigures.map((figure) => `${figure.id}:${figureSignatures.get(figure.id) ?? ""}`).join("|"),
    [figureSignatures, stableFigures]
  );
  const priorityKey = useMemo(() => priorityFigureIds.join("|"), [priorityFigureIds]);
  const [tick, setTick] = useState(0);
  const lastThumbnailByFigureId =
    lastThumbnailByDocumentKeyRef.current.get(documentKey) ??
    (() => {
      const next = new Map<string, string>();
      lastThumbnailByDocumentKeyRef.current.set(documentKey, next);
      return next;
    })();

  const thumbnails = useMemo(() => {
    void tick;
    const next = new Map<string, string>();
    for (const figure of figures) {
      const signature = figureSignatures.get(figure.id);
      if (signature) {
        const cached = thumbnailCache.get(makeCacheKey(figure.id, signature));
        if (cached) {
          lastThumbnailByFigureId.set(figure.id, cached);
          next.set(figure.id, cached);
          continue;
        }
      }
      const last = lastThumbnailByFigureId.get(figure.id);
      if (last) {
        next.set(figure.id, last);
      }
    }
    return next;
  }, [figureSignatures, figures, lastThumbnailByFigureId, tick]);

  useEffect(() => {
    if (stableFigures.length === 0 || maxToRender <= 0) {
      return;
    }

    const figureById = new Map(stableFigures.map((figure) => [figure.id, figure]));
    const missingIds = stableFigures
      .map((figure) => figure.id)
      .filter((figureId) => {
        const signature = figureSignatures.get(figureId);
        return !signature || !thumbnailCache.has(makeCacheKey(figureId, signature));
      });
    if (missingIds.length === 0) {
      return;
    }

    const prioritized = priorityFigureIds.filter((figureId) => missingIds.includes(figureId));
    const orderedMissing = [...prioritized, ...missingIds.filter((figureId) => !prioritized.includes(figureId))]
      .slice(0, maxToRender);

    let cancelled = false;
    const groupId = `figure-thumb-group-${(thumbnailGroupCounter += 1).toString(36)}`;
    const timers: Array<{ kind: "idle" | "timeout"; id: number }> = [];
    let shouldRetryMissing = false;

    const queue = async (): Promise<void> => {
      for (const figureId of orderedMissing) {
        if (cancelled) {
          return;
        }
        const figureSignature = figureSignatures.get(figureId);
        if (!figureSignature) {
          continue;
        }
        const key = makeCacheKey(figureId, figureSignature);
        if (thumbnailCache.has(key)) {
          continue;
        }
        let inFlight = thumbnailInFlight.get(key);
        if (!inFlight) {
          const figure = figureById.get(figureId);
          if (!figure) {
            continue;
          }
          const requestId = `figure-thumb-${(thumbnailRequestCounter += 1).toString(36)}`;
          const tokenKey = `${documentKey}|${figureId}`;
          const nextToken = (requestTokenByFigureRef.current.get(tokenKey) ?? 0) + 1;
          requestTokenByFigureRef.current.set(tokenKey, nextToken);
          const request: ThumbnailRenderRequest = {
            type: "render",
            requestId,
            groupId,
            source: stableSource,
            figureId: figure.id,
            figureSignature,
            parseOptions: {
              recover: true,
              activeFigureId: figure.id,
              includeContextDefinitions: true
            },
            svgOptions: { padding: 8 }
          };
          inFlight = requestThumbnail(request)
            .then((result) => {
              if (!result.ok || cancelled) {
                return null;
              }
              const activeToken = requestTokenByFigureRef.current.get(tokenKey);
              if (activeToken !== nextToken) {
                return null;
              }
              return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`;
            })
            .catch(() => null)
            .finally(() => {
              thumbnailInFlight.delete(key);
            });
          thumbnailInFlight.set(key, inFlight);
        }
        const url = await inFlight;
        if (cancelled) {
          return;
        }
        if (!url) {
          shouldRetryMissing = true;
          continue;
        }
        thumbnailCache.set(key, url);
        setTick((value) => value + 1);
        await new Promise<void>((resolve) => {
          const hasIdleCallback = typeof window.requestIdleCallback === "function";
          if (hasIdleCallback) {
            const id = window.requestIdleCallback(() => { resolve(); }, { timeout: 80 });
            timers.push({ kind: "idle", id });
            return;
          }
          const id = window.setTimeout(() => { resolve(); }, 0);
          timers.push({ kind: "timeout", id });
        });
      }

      if (shouldRetryMissing && !cancelled) {
        const id = window.setTimeout(() => {
          setTick((value) => value + 1);
        }, 300);
        timers.push({ kind: "timeout", id });
      }
    };

    void queue();

    return () => {
      cancelled = true;
      cancelGroup(groupId);
      for (const timer of timers) {
        if (timer.kind === "idle" && typeof window.cancelIdleCallback === "function") {
          window.cancelIdleCallback(timer.id);
          continue;
        }
        window.clearTimeout(timer.id);
      }
    };
  }, [documentKey, figureKey, figureSignatures, maxToRender, priorityFigureIds, priorityKey, stableFigures, stableSource]);

  return thumbnails;
}
