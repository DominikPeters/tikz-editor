import { useEffect, useMemo, useRef, useState } from "react";
import { cancelGroup, requestThumbnail } from "../workers/thumbnail-worker-client";

export type DocumentThumbnailSource = {
  id: string;
  source: string;
  activeRootId: string | null;
  /** Last computed snapshot SVG; a no-cost fast path while it is still current. */
  snapshotSvg: string | null;
  snapshotSource: string | null;
  /** A deck shows its first slide. */
  deck: boolean;
};

export type DocumentThumbnail = {
  url: string;
  /** Decks: how many frames the document has. */
  frameCount?: number;
};

const documentThumbnailCache = new Map<string, DocumentThumbnail>();
const MAX_CACHE_ENTRIES = 48;
let galleryGroupCounter = 0;
let galleryRequestCounter = 0;

function sourceSignature(source: string): string {
  return `${source.length}:${source.slice(0, 48)}:${source.slice(-48)}`;
}

function cacheKey(documentId: string, signature: string): string {
  return `${documentId}|${signature}`;
}

function storeInCache(key: string, value: DocumentThumbnail): void {
  documentThumbnailCache.delete(key);
  documentThumbnailCache.set(key, value);
  while (documentThumbnailCache.size > MAX_CACHE_ENTRIES) {
    const oldest = documentThumbnailCache.keys().next().value;
    if (oldest == null) {
      break;
    }
    documentThumbnailCache.delete(oldest);
  }
}

/**
 * Cover thumbnails (data URLs) for the iPad document gallery, keyed by
 * document id: a TikZ document's active picture, a deck's first slide. Uses the shared thumbnail render worker; results are cached
 * per document source signature so reopening the gallery is instant.
 */
export function useDocumentThumbnails(
  documents: readonly DocumentThumbnailSource[],
  enabled: boolean
): ReadonlyMap<string, DocumentThumbnail> {
  const [tick, setTick] = useState(0);
  const documentsRef = useRef(documents);
  documentsRef.current = documents;

  const inputKey = useMemo(
    () => documents.map((doc) => cacheKey(doc.id, sourceSignature(doc.source))).join("\n"),
    [documents]
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const docs = documentsRef.current;
    if (docs.length === 0) {
      return;
    }
    let cancelled = false;
    // A call, so the check after each await is not narrowed away; the cleanup flips it mid-run.
    const isCancelled = (): boolean => cancelled;
    const groupId = `doc-gallery-thumbs-${(galleryGroupCounter += 1).toString(36)}`;

    const run = async (): Promise<void> => {
      for (const doc of docs) {
        if (isCancelled()) {
          return;
        }
        const signature = sourceSignature(doc.source);
        const key = cacheKey(doc.id, signature);
        if (documentThumbnailCache.has(key)) {
          continue;
        }
        if (!doc.deck && doc.snapshotSvg && doc.snapshotSource === doc.source) {
          storeInCache(key, { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(doc.snapshotSvg)}` });
          setTick((value) => value + 1);
          continue;
        }
        const requestId = `doc-gallery-thumb-${(galleryRequestCounter += 1).toString(36)}`;
        const result = await (doc.deck
          ? requestThumbnail({
              type: "render",
              requestId,
              groupId,
              source: doc.source,
              figureId: `doc-gallery:${doc.id}:0`,
              figureSignature: signature,
              deckFrameIndex: 0,
              parseOptions: { recover: true, activeRootId: `doc-gallery:${doc.id}`, includeContextDefinitions: true }
            })
          : requestThumbnail({
              type: "render",
              requestId,
              groupId,
              source: doc.source,
              // An unknown figure id resolves to the first figure, so this is safe
              // for documents whose figures have not been parsed yet.
              figureId: doc.activeRootId ?? "figure:0",
              figureSignature: signature,
              parseOptions: {
                recover: true,
                activeRootId: doc.activeRootId ?? "figure:0",
                includeContextDefinitions: true
              },
              svgOptions: { padding: 8 }
            })).catch(() => null);
        if (isCancelled() || !result?.ok) {
          continue;
        }
        storeInCache(key, {
          url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`,
          ...(result.frameCount === undefined ? {} : { frameCount: result.frameCount })
        });
        setTick((value) => value + 1);
      }
    };

    void run();
    return () => {
      cancelled = true;
      cancelGroup(groupId);
    };
  }, [enabled, inputKey]);

  return useMemo(() => {
    void tick;
    void inputKey;
    const map = new Map<string, DocumentThumbnail>();
    for (const doc of documentsRef.current) {
      const cached = documentThumbnailCache.get(cacheKey(doc.id, sourceSignature(doc.source)));
      if (cached) {
        map.set(doc.id, cached);
      }
    }
    return map;
  }, [inputKey, tick]);
}
