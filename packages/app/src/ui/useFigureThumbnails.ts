import { useEffect, useMemo, useRef, useState } from "react";
import { computeSourceFingerprint } from "@tikz-editor/core/utils/source-fingerprint";
import { cancelGroup, requestThumbnail } from "./workers/thumbnail-worker-client";
import type { ThumbnailRenderRequest } from "./workers/thumbnail-worker-types";
import { BoundedLru } from "../bounded-lru";

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
  /** Reuse an existing render without caching it as a final-overlay thumbnail. */
  externalThumbnail?: { figureId: string; deckFrameIndex?: number; url: string | null };
};
const EMPTY_PRIORITY_FIGURE_IDS: readonly string[] = [];

// Data URLs, so bounded by size: a long editing session renders many versions.
const thumbnailCache = new BoundedLru<string, string>(512, 48 * 1024 * 1024);
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

/**
 * A deck frame also depends on the rest of the document. Text outside the
 * frames (preamble, sections) can change any of them, so it is compared
 * directly; other frames' bodies matter only through cross-frame state
 * (theorem and equation numbers, references, frame-break page counts).
 */
function textOutsideDeckFrames(source: string, figures: readonly FigureEntry[]): string | null {
  const frames = figures.filter((figure) => figure.deckFrameIndex != null)
    .map((figure) => figure.span).sort((a, b) => a.from - b.from);
  if (frames.length === 0) return null;
  const parts: string[] = [];
  let cursor = 0;
  for (const span of frames) {
    parts.push(source.slice(cursor, Math.max(cursor, span.from)));
    cursor = Math.max(cursor, span.to);
  }
  parts.push(source.slice(cursor));
  return parts.join("\u0000");
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
    externalThumbnail
  } = options;
  const externalFigureId = externalThumbnail?.figureId;
  const externalDeckFrameIndex = externalThumbnail?.deckFrameIndex;
  const externalUrl = externalThumbnail?.url;
  const lastThumbnailByDocumentKeyRef = useRef(new Map<string, Map<string, string>>());

  // An edited frame refreshes at once. The others take the whole document as
  // their context when text outside the frames changes, or once the edit
  // leaves the frame (the active frame changes): an edit inside a frame
  // reaches them only through cross-frame numbering and references, and
  // rerendering every visible frame at each key would almost always redraw
  // the same images.
  const outsideFrames = useMemo(() => textOutsideDeckFrames(source, figures), [figures, source]);
  const contextKey = outsideFrames == null ? null : `${documentKey}\u0000${externalDeckFrameIndex ?? ""}\u0000${outsideFrames}`;
  const [context, setContext] = useState({ key: contextKey, source });
  if (context.key !== contextKey) setContext({ key: contextKey, source });
  const contextSource = context.key === contextKey ? context.source : source;
  const documentFingerprint = useMemo(
    () => outsideFrames == null ? null : computeSourceFingerprint(contextSource),
    [contextSource, outsideFrames]
  );

  const figureSignatures = useMemo(() => {
    const map = new Map<string, string>();
    for (const figure of figures) {
      map.set(
        figure.id,
        `${makeFigureSignature(source, figure, documentFingerprint)}:graphics=${
          graphicsPreviewBundleKey ?? ""
        }`
      );
    }
    return map;
  }, [documentFingerprint, figures, graphicsPreviewBundleKey, source]);
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

  // Requests started here that have not settled, by cache key. A queue that a
  // new render supersedes leaves running the requests the new one still
  // wants: while typing, cancelling at every key would discard each render
  // the worker is in the middle of, so nothing would finish until a pause.
  const liveRequestsRef = useRef(new Map<string, { groupId: string; promise: Promise<string | null> }>());

  useEffect(() => {
    const live = liveRequestsRef.current;
    const wanted = new Map<string, { figure: FigureEntry; signature: string }>();
    if (figures.length > 0 && maxToRender > 0) {
      const missing = figures
        // Frame indices also exclude the previous source revision's thumbnail ID
        // while edited frame content is acquiring a new fingerprint.
        .filter(figure => figure.id !== externalFigureId &&
          (externalDeckFrameIndex == null || figure.deckFrameIndex !== externalDeckFrameIndex))
        .filter((figure) => {
          const signature = figureSignatures.get(figure.id);
          return signature && !thumbnailCache.has(makeCacheKey(documentKey, figure.id, signature));
        });
      const prioritized = priorityFigureIds.flatMap((figureId) => missing.filter((figure) => figure.id === figureId));
      const ordered = [...prioritized, ...missing.filter((figure) => !prioritized.includes(figure))].slice(0, maxToRender);
      for (const figure of ordered) {
        const signature = figureSignatures.get(figure.id) ?? "";
        wanted.set(makeCacheKey(documentKey, figure.id, signature), { figure, signature });
      }
    }
    for (const [key, request] of live) {
      if (wanted.has(key)) continue;
      cancelGroup(request.groupId);
      live.delete(key);
      // A new queue must not reuse a promise canceled here.
      if (thumbnailInFlight.get(key) === request.promise) thumbnailInFlight.delete(key);
    }
    if (wanted.size === 0) {
      return;
    }

    const lifecycle = { cancelled: false };
    const isCancelled = () => lifecycle.cancelled;
    const timers: Array<{ kind: "idle" | "timeout"; id: number }> = [];
    const startRequest = (key: string, figure: FigureEntry, figureSignature: string): Promise<string | null> => {
      const groupId = `figure-thumb-group-${(thumbnailGroupCounter += 1).toString(36)}`;
      const request: ThumbnailRenderRequest = {
        type: "render",
        requestId: `figure-thumb-${(thumbnailRequestCounter += 1).toString(36)}`,
        groupId,
        source,
        figureId: figure.id,
        figureSignature,
        ...(graphicsPreviewBundleKey
          ? { graphicsPreviewBundleKey }
          : {}),
        ...(figure.deckFrameIndex != null ? { deckFrameIndex: figure.deckFrameIndex } : {}),
        parseOptions: {
          recover: true,
          activeRootId: figure.id,
          includeContextDefinitions: true
        },
        svgOptions: { padding: 8 }
      };
      const promise: Promise<string | null> = requestThumbnail(request)
        .then((result) => result.ok ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}` : null)
        .catch(() => null)
        .then((url) => {
          // A request canceled after its frame left the queue (it scrolled
          // away or now mirrors the main render) may still answer.
          if (live.get(key)?.promise !== promise) return null;
          live.delete(key);
          if (thumbnailInFlight.get(key) === promise) thumbnailInFlight.delete(key);
          if (url) {
            thumbnailCache.set(key, url, url.length * 2);
            setTick((value) => value + 1);
          }
          return url;
        });
      live.set(key, { groupId, promise });
      thumbnailInFlight.set(key, promise);
      return promise;
    };

    const queue = async (): Promise<void> => {
      for (const [key, { figure, signature }] of wanted) {
        if (isCancelled()) {
          return;
        }
        if (thumbnailCache.has(key)) {
          continue;
        }
        const url = await (thumbnailInFlight.get(key) ?? startRequest(key, figure, signature));
        if (isCancelled()) {
          return;
        }
        if (!url) {
          continue;
        }
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
      lifecycle.cancelled = true;
      for (const timer of timers) {
        if (timer.kind === "idle" && typeof window.cancelIdleCallback === "function") {
          window.cancelIdleCallback(timer.id);
          continue;
        }
        window.clearTimeout(timer.id);
      }
    };
  }, [documentKey, externalDeckFrameIndex, externalFigureId, figureSignatures, figures, graphicsPreviewBundleKey, maxToRender, priorityFigureIds, source]);

  useEffect(() => {
    const live = liveRequestsRef.current;
    return () => {
      for (const [key, request] of live) {
        cancelGroup(request.groupId);
        if (thumbnailInFlight.get(key) === request.promise) thumbnailInFlight.delete(key);
      }
      live.clear();
    };
  }, []);

  return thumbnails;
}
