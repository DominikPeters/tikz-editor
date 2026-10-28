import { isRecord } from "../../validation";
import { createDocumentGraphicsResolverFromPreviewBundle } from "@tikz-editor/core/graphics/index";
import { documentGraphicsPreviewBundleBytes, getDocumentGraphicsPreviewBundle } from "../../image-asset-cache";
import type {
  ThumbnailRegisterGraphicsMessage,
  ThumbnailRenderFailure,
  ThumbnailRenderRequest,
  ThumbnailRenderSuccess,
  ThumbnailWorkerResponseMessage
} from "./thumbnail-worker-types";

type PendingRequest = {
  resolve: (value: ThumbnailRenderSuccess | ThumbnailRenderFailure) => void;
  reject: (reason?: unknown) => void;
  groupId: string;
  graphicsPreviewBundleKey: string | undefined;
};

let sharedWorker: Worker | null = null;
let workerInitFailed = false;
const pendingRequests = new Map<string, PendingRequest>();
const requestIdsByGroup = new Map<string, Set<string>>();
// Keep main-thread registration state and worker-owned image data in sync.
// In-flight bundles are pinned; the current bundle stays warm between the
// sequential requests in a thumbnail sweep, even if a single image is huge.
const registeredGraphicsBundles = new Map<string, number>();
const MAX_GRAPHICS_BUNDLES = 16;
const MAX_GRAPHICS_BUNDLE_BYTES = 48 * 1024 * 1024;
let registeredGraphicsBundleBytes = 0;
let latestGraphicsBundleKey: string | undefined;

function getWorker(): Worker | null {
  if (workerInitFailed) {
    return null;
  }
  if (sharedWorker) {
    return sharedWorker;
  }
  try {
    sharedWorker = new Worker(new URL("./thumbnail-render.worker.ts", import.meta.url), { type: "module" });
    sharedWorker.addEventListener("message", onWorkerMessage);
    sharedWorker.addEventListener("error", onWorkerError);
    sharedWorker.addEventListener("messageerror", onWorkerError);
    return sharedWorker;
  } catch {
    workerInitFailed = true;
    return null;
  }
}

export async function requestThumbnail(request: ThumbnailRenderRequest): Promise<ThumbnailRenderSuccess | ThumbnailRenderFailure> {
  const worker = getWorker();
  if (!worker) {
    return renderThumbnailFallback(request);
  }

  return new Promise<ThumbnailRenderSuccess | ThumbnailRenderFailure>((resolve, reject) => {
    pendingRequests.set(request.requestId, {
      resolve,
      reject,
      groupId: request.groupId,
      graphicsPreviewBundleKey: request.graphicsPreviewBundleKey
    });
    const idsForGroup = requestIdsByGroup.get(request.groupId) ?? new Set<string>();
    idsForGroup.add(request.requestId);
    requestIdsByGroup.set(request.groupId, idsForGroup);
    try {
      registerGraphicsBundleIfNeeded(worker, request.graphicsPreviewBundleKey);
      worker.postMessage(request);
      trimGraphicsBundles();
    } catch (error) {
      // Structured cloning can fail synchronously. Do not leave the rejected
      // request (and its promise callbacks) rooted in the shared maps.
      dropPending(request.requestId, request.groupId);
      trimGraphicsBundles();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function cancelGroup(groupId: string): void {
  if (!groupId) {
    return;
  }
  const worker = sharedWorker;
  const ids = requestIdsByGroup.get(groupId);
  if (!ids) return;
  for (const requestId of ids) {
    const pending = pendingRequests.get(requestId);
    if (!pending) {
      continue;
    }
    pending.reject(new Error("thumbnail-group-cancelled"));
    pendingRequests.delete(requestId);
  }
  requestIdsByGroup.delete(groupId);
  if (worker) {
    worker.postMessage({
      type: "cancelGroup",
      groupId
    });
  }
  trimGraphicsBundles();
}

function onWorkerMessage(event: MessageEvent<unknown>): void {
  const value = event.data;
  const message = parseWorkerResponse(value);
  if (!message) {
    return;
  }
  const pending = pendingRequests.get(message.requestId);
  if (!pending) {
    return;
  }
  dropPending(message.requestId, pending.groupId);
  trimGraphicsBundles();
  pending.resolve(message);
}

async function renderThumbnailFallback(request: ThumbnailRenderRequest): Promise<ThumbnailRenderSuccess | ThumbnailRenderFailure> {
  try {
    const previewBundle = request.graphicsPreviewBundleKey
      ? getDocumentGraphicsPreviewBundle(request.graphicsPreviewBundleKey)
      : null;
    const graphicsResolver = previewBundle
      ? createDocumentGraphicsResolverFromPreviewBundle(previewBundle)
      : undefined;
    const { withTexGlyphOutlines } = await import("@tikz-editor/core/text/tex/fonts/glyph-outlines");
    const svg = await withTexGlyphOutlines(async () => {
      if (request.deckFrameIndex != null) {
        const { prepareBeamerDocument } = await import("@tikz-editor/core/beamer/index");
        const prepared = prepareBeamerDocument(request.source, request.presentationTheme === undefined ? {} : { presentationTheme: request.presentationTheme });
        const finalStep = Math.max(1, prepared.frameStepCount(request.deckFrameIndex));
        const step = request.deckStep === undefined ? finalStep : Math.min(Math.max(1, request.deckStep), finalStep);
        return (await prepared.renderFrame({
          frameIndex: request.deckFrameIndex,
          step,
          ...(graphicsResolver === undefined ? {} : { graphicsResolver })
        })).svg.svg;
      }
      const { renderTikzToSvgAsync } = await import("@tikz-editor/core/render/index");
      return (await renderTikzToSvgAsync(request.source, {
        parse: {
          recover: request.parseOptions.recover ?? true,
          activeFigureId: request.parseOptions.activeRootId,
          includeContextDefinitions: request.parseOptions.includeContextDefinitions
        },
        evaluate: { ...(graphicsResolver === undefined ? {} : { graphicsResolver }) },
        svg: {
          ...((request.svgOptions?.padding) === undefined ? {} : { padding: request.svgOptions.padding })
        }
      })).svg.svg;
    });
    return {
      type: "result",
      ok: true,
      requestId: request.requestId,
      groupId: request.groupId,
      figureId: request.figureId,
      figureSignature: request.figureSignature,
      svg
    };
  } catch (error) {
    return {
      type: "result",
      ok: false,
      requestId: request.requestId,
      groupId: request.groupId,
      figureId: request.figureId,
      figureSignature: request.figureSignature,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function onWorkerError(): void {
  if (!sharedWorker) {
    return;
  }
  // Fail fast for currently waiting requests. Subsequent requests use fallback path.
  workerInitFailed = true;
  sharedWorker.terminate();
  sharedWorker = null;
  registeredGraphicsBundles.clear();
  registeredGraphicsBundleBytes = 0;
  latestGraphicsBundleKey = undefined;
  const pendingIds = [...pendingRequests.keys()];
  for (const requestId of pendingIds) {
    const pending = pendingRequests.get(requestId);
    if (!pending) {
      continue;
    }
    pending.reject(new Error("thumbnail-worker-error"));
    dropPending(requestId, pending.groupId);
  }
}

function registerGraphicsBundleIfNeeded(worker: Worker, cacheKey: string | undefined): void {
  if (!cacheKey) {
    return;
  }
  latestGraphicsBundleKey = cacheKey;
  const existingWeight = registeredGraphicsBundles.get(cacheKey);
  if (existingWeight !== undefined) {
    registeredGraphicsBundles.delete(cacheKey);
    registeredGraphicsBundles.set(cacheKey, existingWeight);
    return;
  }
  const bundle = getDocumentGraphicsPreviewBundle(cacheKey);
  if (!bundle) {
    return;
  }
  const message: ThumbnailRegisterGraphicsMessage = {
    type: "registerGraphics",
    bundle
  };
  worker.postMessage(message);
  const weight = documentGraphicsPreviewBundleBytes(bundle);
  registeredGraphicsBundles.set(cacheKey, weight);
  registeredGraphicsBundleBytes += weight;
}

function trimGraphicsBundles(): void {
  if (!sharedWorker || (registeredGraphicsBundles.size <= MAX_GRAPHICS_BUNDLES &&
    registeredGraphicsBundleBytes <= MAX_GRAPHICS_BUNDLE_BYTES)) return;
  const pinned = new Set([...pendingRequests.values()].map((request) => request.graphicsPreviewBundleKey));
  for (const [cacheKey, weight] of registeredGraphicsBundles) {
    if (registeredGraphicsBundles.size <= MAX_GRAPHICS_BUNDLES &&
      registeredGraphicsBundleBytes <= MAX_GRAPHICS_BUNDLE_BYTES) break;
    if (cacheKey === latestGraphicsBundleKey || pinned.has(cacheKey)) continue;
    sharedWorker.postMessage({ type: "unregisterGraphics", cacheKey });
    registeredGraphicsBundles.delete(cacheKey);
    registeredGraphicsBundleBytes -= weight;
  }
}

function dropPending(requestId: string, groupId: string): void {
  pendingRequests.delete(requestId);
  const ids = requestIdsByGroup.get(groupId);
  if (!ids) {
    return;
  }
  ids.delete(requestId);
  if (ids.size === 0) {
    requestIdsByGroup.delete(groupId);
  }
}

function parseWorkerResponse(value: unknown): ThumbnailWorkerResponseMessage | null {
  if (!isRecord(value) || value.type !== "result" || typeof value.requestId !== "string" ||
    typeof value.groupId !== "string" || typeof value.figureId !== "string" || typeof value.figureSignature !== "string") return null;
  const identity = { type: "result" as const, requestId: value.requestId, groupId: value.groupId,
    figureId: value.figureId, figureSignature: value.figureSignature };
  if (value.ok === true && typeof value.svg === "string") return { ...identity, ok: true, svg: value.svg };
  if (value.ok === false && typeof value.error === "string") return { ...identity, ok: false, error: value.error };
  return null;
}
