import { useEffect, useMemo, useRef, useState } from "react";
import { computeSourceFingerprint } from "@tikz-editor/core/utils/source-fingerprint";
import { cancelGroup, requestThumbnail } from "./workers/thumbnail-worker-client";
import type { ThumbnailRenderRequest } from "./workers/thumbnail-worker-types";

/**
 * Any document root with a source span renders a thumbnail; deck frames
 * carry their frame index and render through the Beamer path.
 */
export type ThumbnailRootEntry = {
  id: string;
  span: { from: number; to: number };
  deckFrameIndex?: number;
};

type FigureEntry = ThumbnailRootEntry;

type UseFigureThumbnailsOptions = {
  documentKey?: string;
  graphicsPreviewBundleKey?: string | null;
  priorityFigureIds?: readonly string[];
  maxToRender?: number;
  refreshDelayMs?: number;
  /** Reuse an existing render without caching it as a final-overlay thumbnail. */
  externalThumbnail?: { figureId: string; deckFrameIndex?: number; url: string | null };
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

function makeFigureSignature(
  source: string,
  figure: FigureEntry,
  documentFingerprint: string | null
): string {
  const from = Math.max(0, Math.min(source.length, figure.span.from));
  const to = Math.max(from, Math.min(source.length, figure.span.to));
  const slice = source.slice(from, to);
  const sliceFingerprint = computeSourceFingerprint(slice);
  return figure.deckFrameIndex == null
    ? `tikz:${sliceFingerprint}`
    : `deck:${documentFingerprint ?? computeSourceFingerprint(source)}:${sliceFingerprint}`;
}

function makeCacheKey(
  documentKey: string,
  figureId: string,
  figureSignature: string
): string {
  return `${documentKey}|${figureId}|${figureSignature}`;
}

export function useFigureThumbnails(
  source: string,
  figures: readonly FigureEntry[],
  options: UseFigureThumbnailsOptions = {}
): ReadonlyMap<string, string> {
  const {
    documentKey = "__default__",
    graphicsPreviewBundleKey = null,
    priorityFigureIds = EMPTY_PRIORITY_FIGURE_IDS,
    maxToRender = 8,
    refreshDelayMs = 350,
    externalThumbnail
  } = options;
  const externalFigureId = externalThumbnail?.figureId;
  const externalDeckFrameIndex = externalThumbnail?.deckFrameIndex;
  const externalUrl = externalThumbnail?.url;
  const [stableInput, setStableInput] = useState<{
    source: string;
    figures: readonly FigureEntry[];
    documentKey: string;
    graphicsPreviewBundleKey: string | null;
  }>({
    source,
    figures,
    documentKey,
    graphicsPreviewBundleKey
  });
  const lastThumbnailByDocumentKeyRef = useRef(new Map<string, Map<string, string>>());
  const requestTokenByFigureRef = useRef(new Map<string, number>());
  const stableSource = stableInput.source;
  const stableFigures = stableInput.figures;

  useEffect(() => {
    setStableInput({ source, figures, documentKey, graphicsPreviewBundleKey });
    if (!lastThumbnailByDocumentKeyRef.current.has(documentKey)) {
      lastThumbnailByDocumentKeyRef.current.set(documentKey, new Map<string, string>());
    }
  }, [documentKey, figures, graphicsPreviewBundleKey, source]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => { setStableInput((current) => ({ ...current, source, figures })); },
      refreshDelayMs
    );
    return () => { window.clearTimeout(timer); };
  }, [documentKey, figures, refreshDelayMs, source]);

  const figureSignatures = useMemo(() => {
    const map = new Map<string, string>();
    const documentFingerprint = stableFigures.some(
      (figure) => figure.deckFrameIndex != null
    )
      ? computeSourceFingerprint(stableSource)
      : null;
    for (const figure of stableFigures) {
      map.set(
        figure.id,
        `${makeFigureSignature(stableSource, figure, documentFingerprint)}:graphics=${
          stableInput.graphicsPreviewBundleKey ?? ""
        }`
      );
    }
    return map;
  }, [stableFigures, stableInput.graphicsPreviewBundleKey, stableSource]);
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
      if (figure.id === externalFigureId && externalUrl) {
        lastThumbnailByFigureId.set(figure.id, externalUrl);
        next.set(figure.id, externalUrl);
        continue;
      }
      const signature = figureSignatures.get(figure.id);
      if (signature) {
        const cached = thumbnailCache.get(
          makeCacheKey(documentKey, figure.id, signature)
        );
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
  }, [documentKey, externalFigureId, externalUrl, figureSignatures, figures, lastThumbnailByFigureId, tick]);

  useEffect(() => {
    if (stableFigures.length === 0 || maxToRender <= 0) {
      return;
    }

    const figureById = new Map(stableFigures.map((figure) => [figure.id, figure]));
    const missingIds = stableFigures
      // Frame indices also exclude the previous source revision's thumbnail ID
      // while edited frame content is acquiring a new fingerprint.
      .filter(figure => figure.id !== externalFigureId &&
        (externalDeckFrameIndex == null || figure.deckFrameIndex !== externalDeckFrameIndex))
      .map((figure) => figure.id)
      .filter((figureId) => {
        const signature = figureSignatures.get(figureId);
        return (
          !signature ||
          !thumbnailCache.has(makeCacheKey(documentKey, figureId, signature))
        );
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
    const ownedRequests = new Map<string, Promise<string | null>>();

    const queue = async (): Promise<void> => {
      for (const figureId of orderedMissing) {
        if (cancelled) {
          return;
        }
        const figureSignature = figureSignatures.get(figureId);
        if (!figureSignature) {
          continue;
        }
        const key = makeCacheKey(documentKey, figureId, figureSignature);
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
            ...(stableInput.graphicsPreviewBundleKey
              ? { graphicsPreviewBundleKey: stableInput.graphicsPreviewBundleKey }
              : {}),
            ...(figure.deckFrameIndex != null ? { deckFrameIndex: figure.deckFrameIndex } : {}),
            parseOptions: {
              recover: true,
              activeRootId: figure.id,
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
              if (thumbnailInFlight.get(key) === inFlight) thumbnailInFlight.delete(key);
            });
          thumbnailInFlight.set(key, inFlight);
          ownedRequests.set(key, inFlight);
        }
        const url = await inFlight;
        if (cancelled) {
          return;
        }
        if (!url) {
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
    };

    void queue();

    return () => {
      cancelled = true;
      cancelGroup(groupId);
      // A new queue must not reuse promises canceled by this queue's cleanup.
      for (const [key, request] of ownedRequests) {
        if (thumbnailInFlight.get(key) === request) thumbnailInFlight.delete(key);
      }
      for (const timer of timers) {
        if (timer.kind === "idle" && typeof window.cancelIdleCallback === "function") {
          window.cancelIdleCallback(timer.id);
          continue;
        }
        window.clearTimeout(timer.id);
      }
    };
  }, [documentKey, externalDeckFrameIndex, externalFigureId, figureKey, figureSignatures, maxToRender, priorityFigureIds, priorityKey, stableFigures, stableInput.graphicsPreviewBundleKey, stableSource]);

  return thumbnails;
}
