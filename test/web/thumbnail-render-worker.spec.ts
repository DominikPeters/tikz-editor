import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThumbnailRenderRequest, ThumbnailWorkerRequestMessage } from "../../packages/app/src/ui/workers/thumbnail-worker-types";

const mocks = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("@tikz-editor/core/render/index", () => ({ renderTikzToSvgAsync: mocks.render }));
vi.mock("@tikz-editor/core/text/tex/fonts/glyph-outlines", () => ({
  withTexGlyphOutlines: (render: () => Promise<unknown>) => render()
}));
vi.mock("@tikz-editor/core/beamer/index", () => ({ prepareBeamerDocument: vi.fn() }));

describe("thumbnail render worker lifecycle", () => {
  const worker = {
    onmessage: null as ((event: MessageEvent<ThumbnailWorkerRequestMessage>) => void) | null,
    postMessage: vi.fn()
  };
  const send = (message: ThumbnailWorkerRequestMessage) => {
    worker.onmessage?.({ data: message } as MessageEvent<ThumbnailWorkerRequestMessage>);
  };
  const request = (groupId: string): ThumbnailRenderRequest => ({
    type: "render", requestId: groupId, groupId, source: "", figureId: "figure:0", figureSignature: "signature",
    parseOptions: { activeRootId: "figure:0", includeContextDefinitions: true }
  });
  const flush = async () => {
    for (let index = 0; index < 6; index++) await Promise.resolve();
  };

  beforeEach(async () => {
    vi.resetModules();
    mocks.render.mockReset().mockResolvedValue({ svg: { svg: "<svg/>" } });
    worker.postMessage.mockReset();
    vi.stubGlobal("self", worker);
    await import("../../packages/app/src/ui/workers/thumbnail-render.worker");
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("drops registered image resolvers while an in-progress render keeps its resolver", async () => {
    send({ type: "registerGraphics", bundle: { version: 1, cacheKey: "graphics", entries: [] } });
    send({ ...request("first"), graphicsPreviewBundleKey: "graphics" });
    send({ type: "unregisterGraphics", cacheKey: "graphics" });
    send({ ...request("second"), graphicsPreviewBundleKey: "graphics" });
    await flush();
    expect(mocks.render).toHaveBeenCalledTimes(2);
    expect(mocks.render.mock.calls[0]?.[1].evaluate.graphicsResolver.cacheKey).toBe("graphics");
    expect(mocks.render.mock.calls[1]?.[1].evaluate.graphicsResolver).toBeUndefined();
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
  });

  it("removes queued work and suppresses the result of cancelled running work", async () => {
    let finish!: (value: { svg: { svg: string } }) => void;
    mocks.render.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    send(request("cancelled"));
    send({ ...request("cancelled"), requestId: "queued" });
    send({ type: "cancelGroup", groupId: "cancelled" });
    finish({ svg: { svg: "<svg/>" } });
    await flush();
    expect(mocks.render).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it("does not retain cancellation marks for groups with no running work", async () => {
    send({ type: "cancelGroup", groupId: "idle" });
    send(request("idle"));
    await flush();
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ groupId: "idle", ok: true }));
  });
});
