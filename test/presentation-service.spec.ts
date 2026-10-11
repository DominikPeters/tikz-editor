import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PresentationService } from "../packages/app/src/presentation/service.js";
import type { PlatformPresentationApi, PresentationMessage, PresentationOptions } from "../packages/app/src/presentation/types.js";
import { setActiveEditorPlatform } from "../packages/app/src/platform/current.js";
import { useEditorStore } from "../packages/app/src/store/store.js";
import { makeInitialState } from "../packages/app/src/store/reducer.js";

const SOURCE = String.raw`\documentclass{beamer}\begin{document}\begin{frame}A\pause B\end{frame}\end{document}`;
const OPTIONS: PresentationOptions = { mode: "window", audienceDisplay: null, presenterDisplay: null, showPresenter: false, countdownMinutes: null };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

describe("presentation ownership and lifecycle", () => {
  let service: PresentationService;
  const original = useEditorStore.getState();
  let messages: PresentationMessage[], receive: (message: PresentationMessage) => void, lost: () => void;
  let power: boolean[], firstClose: ReturnType<typeof deferred>;
  let slowClose = false;
  beforeEach(() => {
    messages = []; power = []; firstClose = deferred(); slowClose = false;
    let opens = 0;
    const api: PlatformPresentationApi = {
      displays: () => Promise.resolve([]),
      connect: (_id, handler) => { receive = handler; return Promise.resolve({ send: message => { messages.push(message); }, close() {} }); },
      open: (_id, _options, outputLost) => {
        const first = opens++ === 0; lost = outputLost;
        return Promise.resolve({ close: () => first && slowClose ? firstClose.promise : Promise.resolve(), showPresenter() {}, closeView() {}, recoverOutput() {}, swapDisplays() {} });
      },
      keepAwake: active => { power.push(active); return Promise.resolve(); },
    };
    setActiveEditorPlatform({ id: "presentation-owner-test", presentation: api, persistence: { load: () => null, save() {} } });
    useEditorStore.setState(makeInitialState());
    useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT", source: SOURCE });
    service = new PresentationService();
  });
  afterEach(async () => { firstClose.resolve(); await service.stop(); useEditorStore.setState(original); });

  it("keeps presentation attached to its original document when editor tabs change", async () => {
    const doc = useEditorStore.getState().documents[useEditorStore.getState().activeDocumentId];
    await service.start(doc, OPTIONS, 0);
    const current = service.getState().snapshot!.current;
    useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT" });
    expect(service.getState().snapshot!.documentId).toBe(doc.id);
    expect(service.getState().snapshot!.current).toBe(current);
    service.command({ type: "next" });
    await vi.waitFor(() => expect(service.getState().snapshot!.current!.cursor.step).toBe(2));
  });

  it("keeps a lost-output notice until explicit recovery and uses a lightweight heartbeat for synchronized windows", async () => {
    const doc = useEditorStore.getState().documents[useEditorStore.getState().activeDocumentId];
    await service.start(doc, OPTIONS, 0);
    lost();
    const snapshot = service.getState().snapshot!;
    receive({ type: "hello", sessionId: snapshot.sessionId, role: "audience", sequence: snapshot.sequence });
    expect(service.getState().snapshot!.outputAvailable).toBe(false);
    expect(messages.at(-1)?.type).toBe("alive");
    service.command({ type: "recover-output" });
    await vi.waitFor(() => expect(service.getState().snapshot!.outputAvailable).toBe(true));
  });

  it("waits for an older session to release its power assertion before acquiring the next one", async () => {
    const doc = useEditorStore.getState().documents[useEditorStore.getState().activeDocumentId];
    await service.start(doc, OPTIONS, 0);
    slowClose = true;
    const stopping = service.stop();
    const starting = service.start(doc, OPTIONS, 0);
    await Promise.resolve();
    expect(power).toEqual([true]);
    firstClose.resolve();
    await Promise.all([stopping, starting]);
    expect(power).toEqual([true, false, true]);
  });
});
