import { renderTikzToSvgAsync } from "@tikz-editor/core/render/index";
import { prepareBeamerDocument, type PreparedBeamerDocument } from "@tikz-editor/core/beamer/index";
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
const cancelledRequestIds = new Set<string>();
const cancelledGroupIds = new Set<string>();
let busy = false;

workerContext.onmessage = (event: MessageEvent<ThumbnailWorkerRequestMessage>) => {
  const message = event.data;
  if (!message) {
    return;
  }

  if (message.type === "cancelRequest") {
    cancelledRequestIds.add(message.requestId);
    removeQueuedRequest((entry) => entry.requestId === message.requestId);
    return;
  }

  if (message.type === "cancelGroup") {
    cancelledGroupIds.add(message.groupId);
    removeQueuedRequest((entry) => entry.groupId === message.groupId);
    return;
  }

  if (cancelledRequestIds.has(message.requestId) || cancelledGroupIds.has(message.groupId)) {
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
    const svg = next.deckFrameIndex != null
      ? await renderDeckFrameThumbnail(next.source, next.deckFrameIndex)
      : (await renderTikzToSvgAsync(next.source, {
          parse: {
            recover: next.parseOptions.recover ?? true,
            activeFigureId: next.parseOptions.activeRootId,
            includeContextDefinitions: next.parseOptions.includeContextDefinitions
          },
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

function isCancelled(request: { requestId: string; groupId: string }): boolean {
  return cancelledRequestIds.has(request.requestId) || cancelledGroupIds.has(request.groupId);
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
  // Keep sets bounded; remove marks no longer relevant for queued work.
  const queuedRequestIds = new Set(queue.map((entry) => entry.requestId));
  const queuedGroupIds = new Set(queue.map((entry) => entry.groupId));

  for (const requestId of cancelledRequestIds) {
    if (!queuedRequestIds.has(requestId)) {
      cancelledRequestIds.delete(requestId);
    }
  }
  for (const groupId of cancelledGroupIds) {
    if (!queuedGroupIds.has(groupId)) {
      cancelledGroupIds.delete(groupId);
    }
  }
}

// Document-level Beamer passes are shared across the whole thumbnail sweep.
let deckPrepared: { source: string; prepared: PreparedBeamerDocument } | null = null;

async function renderDeckFrameThumbnail(source: string, frameIndex: number): Promise<string> {
  if (deckPrepared?.source !== source) {
    deckPrepared = { source, prepared: prepareBeamerDocument(source) };
  }
  // Sorter thumbnails show the frame's final overlay step (handout view).
  const step = Math.max(1, deckPrepared.prepared.frameStepCount(frameIndex));
  const result = await deckPrepared.prepared.renderFrame({ frameIndex, step });
  return result.svg.svg;
}
