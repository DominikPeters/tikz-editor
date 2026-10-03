import { renderTikzToSvgAsync } from "@tikz-editor/core/render/index";
import { prepareBeamerDocument, type PreparedBeamerDocument } from "@tikz-editor/core/beamer/index";
import {
  createDocumentGraphicsResolverFromPreviewBundle,
  type DocumentGraphicsResolver
} from "@tikz-editor/core/graphics/index";
import type {
  ThumbnailRenderRequest,
  ThumbnailWorkerRequestMessage,
  ThumbnailWorkerResponseMessage
} from "./thumbnail-worker-types";

type ThumbnailWorkerGlobalScope = {
  onmessage: ((event: MessageEvent<ThumbnailWorkerRequestMessage>) => void) | null;
  postMessage: (message: ThumbnailWorkerResponseMessage) => void;
};

const workerContext = self as unknown as ThumbnailWorkerGlobalScope;

const queue: ThumbnailRenderRequest[] = [];
const cancelledGroupIds = new Set<string>();
const graphicsResolvers = new Map<string, DocumentGraphicsResolver>();
let busy = false;

workerContext.onmessage = (event: MessageEvent<ThumbnailWorkerRequestMessage>) => {
  const message = event.data;
  if (!message) {
    return;
  }

  if (message.type === "registerGraphics") {
    rememberGraphicsResolver(
      message.bundle.cacheKey,
      createDocumentGraphicsResolverFromPreviewBundle(message.bundle)
    );
    return;
  }

  if (message.type === "cancelGroup") {
    cancelledGroupIds.add(message.groupId);
    removeQueuedRequest((entry) => entry.groupId === message.groupId);
    return;
  }

  if (cancelledGroupIds.has(message.groupId)) {
    return;
  }
  queue.push(message);
  void pumpQueue();
};

async function pumpQueue(): Promise<void> {
  if (busy) {
    return;
  }

  const next = shiftNextRenderable();
  if (!next) {
    return;
  }

  busy = true;
  try {
    const graphicsResolver = resolveGraphicsResolver(next.graphicsPreviewBundleKey);
    const svg = next.deckFrameIndex != null
      ? await renderDeckFrameThumbnail(next.source, next.deckFrameIndex, graphicsResolver)
      : (await renderTikzToSvgAsync(next.source, {
          parse: {
            recover: next.parseOptions.recover ?? true,
            activeFigureId: next.parseOptions.activeRootId,
            includeContextDefinitions: next.parseOptions.includeContextDefinitions
          },
          evaluate: { graphicsResolver },
          svg: {
            padding: next.svgOptions?.padding
          }
        })).svg.svg;

    if (isCancelled(next)) {
      return;
    }

    const response: ThumbnailWorkerResponseMessage = {
      type: "result",
      ok: true,
      requestId: next.requestId,
      groupId: next.groupId,
      figureId: next.figureId,
      figureSignature: next.figureSignature,
      svg
    };
    workerContext.postMessage(response);
  } catch (error) {
    if (isCancelled(next)) {
      return;
    }
    const response: ThumbnailWorkerResponseMessage = {
      type: "result",
      ok: false,
      requestId: next.requestId,
      groupId: next.groupId,
      figureId: next.figureId,
      figureSignature: next.figureSignature,
      error: error instanceof Error ? error.message : String(error)
    };
    workerContext.postMessage(response);
  } finally {
    busy = false;
    cleanupCancellationMarks();
    if (queue.length > 0) {
      void pumpQueue();
    }
  }
}

function shiftNextRenderable(): ThumbnailRenderRequest | null {
  while (queue.length > 0) {
    const next = queue.shift() ?? null;
    if (!next) {
      return null;
    }
    if (isCancelled(next)) {
      continue;
    }
    return next;
  }
  return null;
}

function isCancelled(request: { groupId: string }): boolean {
  return cancelledGroupIds.has(request.groupId);
}

function removeQueuedRequest(predicate: (entry: ThumbnailRenderRequest) => boolean): void {
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const entry = queue[index];
    if (!entry || !predicate(entry)) {
      continue;
    }
    queue.splice(index, 1);
  }
}

function cleanupCancellationMarks(): void {
  // Keep the set bounded; remove marks no longer relevant for queued work.
  const queuedGroupIds = new Set(queue.map((entry) => entry.groupId));

  for (const groupId of cancelledGroupIds) {
    if (!queuedGroupIds.has(groupId)) {
      cancelledGroupIds.delete(groupId);
    }
  }
}

// Document-level Beamer passes are shared across the whole thumbnail sweep.
let deckPrepared: { source: string; prepared: PreparedBeamerDocument } | null = null;

async function renderDeckFrameThumbnail(
  source: string,
  frameIndex: number,
  graphicsResolver: DocumentGraphicsResolver | undefined
): Promise<string> {
  if (deckPrepared?.source !== source) {
    deckPrepared = { source, prepared: prepareBeamerDocument(source) };
  }
  // Sorter thumbnails show the frame's final overlay step (handout view).
  const step = Math.max(1, deckPrepared.prepared.frameStepCount(frameIndex));
  const result = await deckPrepared.prepared.renderFrame({
    frameIndex,
    step,
    graphicsResolver
  });
  return result.svg.svg;
}

function rememberGraphicsResolver(
  cacheKey: string,
  resolver: DocumentGraphicsResolver
): void {
  graphicsResolvers.set(cacheKey, resolver);
}

function resolveGraphicsResolver(
  cacheKey: string | undefined
): DocumentGraphicsResolver | undefined {
  if (!cacheKey) {
    return undefined;
  }
  const resolver = graphicsResolvers.get(cacheKey);
  if (!resolver) {
    return undefined;
  }
  return resolver;
}
