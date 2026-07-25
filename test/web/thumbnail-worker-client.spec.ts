import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const imageAssetCacheMocks = vi.hoisted(() => ({
  getDocumentGraphicsPreviewBundle: vi.fn()
}));

vi.mock("../../packages/app/src/image-asset-cache", () => imageAssetCacheMocks);

type WorkerListener = (event: { data?: unknown }) => void;

class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly posted: unknown[] = [];
  private readonly listeners = new Map<string, WorkerListener[]>();

  constructor(_url: URL, _options?: { type?: string }) {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: WorkerListener): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    // no-op for tests
  }

  emitMessage(data: unknown): void {
    const listeners = this.listeners.get("message") ?? [];
    for (const listener of listeners) {
      listener({ data });
    }
  }
}

describe("thumbnail-worker-client", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubGlobal("Worker", FakeWorker);
    imageAssetCacheMocks.getDocumentGraphicsPreviewBundle.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("routes render request through the shared worker and resolves by requestId", async () => {
    const client = await import("../../packages/app/src/ui/workers/thumbnail-worker-client");
    const request = {
      type: "render" as const,
      requestId: "req-1",
      groupId: "grp-1",
      source: "\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}",
      figureId: "figure:0",
      figureSignature: "sig-1",
      parseOptions: {
        activeRootId: "figure:0",
        includeContextDefinitions: true,
        recover: true
      },
      svgOptions: { padding: 8 }
    };

    const pending = client.requestThumbnail(request);
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0];
    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0]).toMatchObject({
      type: "render",
      requestId: "req-1",
      groupId: "grp-1"
    });

    worker.emitMessage({
      type: "result",
      ok: true,
      requestId: "req-1",
      groupId: "grp-1",
      figureId: "figure:0",
      figureSignature: "sig-1",
      svg: "<svg />"
    });

    await expect(pending).resolves.toMatchObject({
      ok: true,
      requestId: "req-1",
      svg: "<svg />"
    });
  });

  it("cancels a whole request group and rejects pending promises", async () => {
    const client = await import("../../packages/app/src/ui/workers/thumbnail-worker-client");

    const requestA = {
      type: "render" as const,
      requestId: "req-a",
      groupId: "grp-z",
      source: "\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}",
      figureId: "figure:0",
      figureSignature: "sig-a",
      parseOptions: {
        activeRootId: "figure:0",
        includeContextDefinitions: true,
        recover: true
      },
      svgOptions: { padding: 8 }
    };
    const requestB = {
      ...requestA,
      requestId: "req-b",
      figureSignature: "sig-b"
    };

    const pendingA = client.requestThumbnail(requestA);
    const pendingB = client.requestThumbnail(requestB);

    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0];

    client.cancelGroup("grp-z");
    const cancelMessages = worker.posted.filter((entry) =>
      typeof entry === "object" && entry != null && (entry as { type?: string }).type === "cancelGroup"
    );
    expect(cancelMessages).toHaveLength(1);
    expect(cancelMessages[0]).toMatchObject({ type: "cancelGroup", groupId: "grp-z" });

    await expect(pendingA).rejects.toThrow("thumbnail-group-cancelled");
    await expect(pendingB).rejects.toThrow("thumbnail-group-cancelled");
  });

  it("registers a serializable graphics bundle once and sends only its key with renders", async () => {
    const bundle = {
      version: 1 as const,
      cacheKey: "graphics:abc",
      entries: [
        {
          requestKey: "fig.png\n",
          resolution: {
            status: "resolved" as const,
            mimeType: "image/png" as const,
            dataBase64: "preview-bytes",
            naturalWidthPt: 20,
            naturalHeightPt: 10,
            revision: "r1"
          }
        }
      ]
    };
    imageAssetCacheMocks.getDocumentGraphicsPreviewBundle.mockReturnValue(bundle);
    const client = await import("../../packages/app/src/ui/workers/thumbnail-worker-client");
    const baseRequest = {
      type: "render" as const,
      groupId: "grp-images",
      source: String.raw`\begin{frame}\includegraphics{fig.png}\end{frame}`,
      figureId: "beamer-frame:0",
      figureSignature: "sig-images",
      graphicsPreviewBundleKey: bundle.cacheKey,
      deckFrameIndex: 0,
      parseOptions: {
        activeRootId: "beamer-frame:0",
        includeContextDefinitions: true,
        recover: true
      }
    };

    const first = client.requestThumbnail({
      ...baseRequest,
      requestId: "req-image-1"
    });
    const worker = FakeWorker.instances[0];
    expect(worker.posted[0]).toEqual({ type: "registerGraphics", bundle });
    expect(worker.posted[1]).toMatchObject({
      type: "render",
      requestId: "req-image-1",
      graphicsPreviewBundleKey: bundle.cacheKey
    });
    worker.emitMessage({
      type: "result",
      ok: true,
      requestId: "req-image-1",
      groupId: "grp-images",
      figureId: "beamer-frame:0",
      figureSignature: "sig-images",
      svg: "<svg />"
    });
    await first;

    const second = client.requestThumbnail({
      ...baseRequest,
      requestId: "req-image-2"
    });
    expect(worker.posted.filter((message) =>
      typeof message === "object" &&
      message != null &&
      (message as { type?: string }).type === "registerGraphics"
    )).toHaveLength(1);
    worker.emitMessage({
      type: "result",
      ok: true,
      requestId: "req-image-2",
      groupId: "grp-images",
      figureId: "beamer-frame:0",
      figureSignature: "sig-images",
      svg: "<svg />"
    });
    await second;
  });
});
