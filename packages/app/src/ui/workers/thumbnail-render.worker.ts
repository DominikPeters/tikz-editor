import { renderTikzToSvgAsync } from "@tikz-editor/core/render/index";
import { withTexGlyphOutlines } from "@tikz-editor/core/text/tex/fonts/glyph-outlines";
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

const queue: ThumbnailRenderRequest[] = [];
const cancelledGroupIds = new Set<string>();
const graphicsResolvers = new Map<string, DocumentGraphicsResolver>();
let busy = false;
let activeGroupId: string | null = null;

self.onmessage = (event: MessageEvent<ThumbnailWorkerRequestMessage | null>) => {
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

  if (message.type === "unregisterGraphics") {
    graphicsResolvers.delete(message.cacheKey);
    return;
  }

  if (message.type === "cancelGroup") {
    // Messages from the client arrive in order: queued work can be removed
    // outright, and only the running request needs a cancellation mark.
    if (activeGroupId === message.groupId) cancelledGroupIds.add(message.groupId);
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
  activeGroupId = next.groupId;
  try {
    const graphicsResolver = resolveGraphicsResolver(next.graphicsPreviewBundleKey);
    const svg = await withTexGlyphOutlines(async () => next.deckFrameIndex != null
      ? await renderDeckFrameThumbnail(next.source, next.deckFrameIndex, graphicsResolver, next.presentationTheme, next.deckStep)
      : (await renderTikzToSvgAsync(next.source, {
          parse: {
            recover: next.parseOptions.recover ?? true,
            activeFigureId: next.parseOptions.activeRootId,
            includeContextDefinitions: next.parseOptions.includeContextDefinitions
          },
          evaluate: { ...(graphicsResolver === undefined ? {} : { graphicsResolver }) },
          svg: {
            ...((next.svgOptions?.padding) === undefined ? {} : { padding: next.svgOptions.padding })
          }
        })).svg.svg);

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
    self.postMessage(response);
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
    self.postMessage(response);
  } finally {
    busy = false;
    activeGroupId = null;
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
// Theme gallery previews keep their own, so they do not evict the sorter's;
// the gallery asks for one theme's frames together.
let deckPrepared: { source: string; prepared: PreparedBeamerDocument } | null = null;
let themePreviewPrepared: { source: string; theme: string; prepared: PreparedBeamerDocument } | null = null;

function preparedDeck(source: string, presentationTheme: string | undefined): PreparedBeamerDocument {
  if (presentationTheme === undefined) {
    if (deckPrepared?.source !== source) {
      deckPrepared = { source, prepared: prepareBeamerDocument(source) };
    }
    return deckPrepared.prepared;
  }
  if (themePreviewPrepared?.source !== source || themePreviewPrepared.theme !== presentationTheme) {
    themePreviewPrepared = { source, theme: presentationTheme, prepared: prepareBeamerDocument(source, { presentationTheme }) };
  }
  return themePreviewPrepared.prepared;
}

async function renderDeckFrameThumbnail(
  source: string,
  frameIndex: number,
  graphicsResolver: DocumentGraphicsResolver | undefined,
  presentationTheme: string | undefined,
  requestedStep: number | undefined
): Promise<string> {
  const prepared = preparedDeck(source, presentationTheme);
  // Sorter thumbnails show the frame's final overlay step (handout view).
  const finalStep = Math.max(1, prepared.frameStepCount(frameIndex));
  const step = requestedStep === undefined ? finalStep : Math.min(Math.max(1, requestedStep), finalStep);
  const result = await prepared.renderFrame({
    frameIndex,
    step,
    ...(graphicsResolver === undefined ? {} : { graphicsResolver })
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
