import { isRecord } from "../validation";
import { getActiveEditorPlatform } from "../platform/current";
import { useEditorStore } from "../store/store";
import type { DocumentSession } from "../store/types";
import { createBrowserPresentationApi } from "./browser-platform";
import { PresentationController } from "./controller";
import { BeamerPresentationRenderer, remapPresentationCursor } from "./renderer";
import { afterNextPaint } from "../ui/frame-scheduling";
import type { PlatformPresentationApi, PresentationCommand, PresentationMessage, PresentationOptions, PresentationSnapshot, PresentationTransport, PresentationWindows } from "./types";

const OPTIONS_KEY = "tikz-editor:presentation-options";
const DEFAULT_OPTIONS: PresentationOptions = { mode: "display", audienceDisplay: null, presenterDisplay: null, showPresenter: null, countdownMinutes: null };
export function loadPresentationOptions(): PresentationOptions {
  try {
    const raw = getActiveEditorPlatform().persistence.load(OPTIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const saved = isRecord(parsed) ? parsed : {};
    return { mode: saved.mode === "window" || saved.mode === "rehearse" ? saved.mode : "display",
      audienceDisplay: typeof saved.audienceDisplay === "string" ? saved.audienceDisplay : null,
      presenterDisplay: typeof saved.presenterDisplay === "string" ? saved.presenterDisplay : null,
      showPresenter: typeof saved.showPresenter === "boolean" ? saved.showPresenter : null,
      countdownMinutes: typeof saved.countdownMinutes === "number" && saved.countdownMinutes > 0 && saved.countdownMinutes <= 1440 ? saved.countdownMinutes : null };
  } catch { return { ...DEFAULT_OPTIONS }; }
}
export function savePresentationOptions(options: PresentationOptions): void {
  try { getActiveEditorPlatform().persistence.save(OPTIONS_KEY, JSON.stringify(options)); }
  catch { /* Presenting does not depend on writable preferences. */ }
}

type ServiceState = { snapshot: PresentationSnapshot | null; focus: "editor" | "audience" | "presenter"; error: string | null };

/** Catch synchronous platform failures while retaining the launch click's user activation. */
function callPlatform<T>(action: () => T | PromiseLike<T>): Promise<T> {
  return new Promise(resolve => { resolve(action()); });
}

export class PresentationService {
  private state: ServiceState = { snapshot: null, focus: "editor", error: null };
  private listeners = new Set<() => void>();
  private controller: PresentationController | null = null;
  private renderer: BeamerPresentationRenderer | null = null;
  private transport: PresentationTransport | null = null;
  private windows: PresentationWindows | null = null;
  private api: PlatformPresentationApi | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeController: (() => void) | null = null;
  private revision = 0;
  private replacing: PresentationController | null = null;
  private observedDocument: DocumentSession | null = null;
  private launchCommands: PresentationCommand[] = [];
  private outputNeedsSelection = false;
  private cleaningUp: Promise<void> | null = null;
  private powerAcquisition: Promise<void> | null = null;
  getState = (): ServiceState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<ServiceState>): void { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  clearError = (): void => { this.update({ error: null }); };
  // Called on every pointer-down in the editor: publish only a change of focus.
  focusEditor = (): void => { if (this.state.focus !== "editor") this.update({ focus: "editor" }); };
  private send(message: PresentationMessage): void {
    void callPlatform(() => this.transport?.send(message)).catch((error: unknown) => {
      console.info("[tikz-editor] Couldn’t send a presentation update", error);
    });
  }
  private publish = (): void => {
    const snapshot = this.controller?.getSnapshot();
    if (!snapshot) return;
    this.update({ snapshot });
    this.send({ type: "snapshot", sessionId: snapshot.sessionId, snapshot });
  };
  private receive = (message: PresentationMessage): void => {
    if (message.sessionId !== this.controller?.getSnapshot().sessionId) return;
    if (message.type === "hello") {
      if (message.role === "presenter") this.controller.setPresenterVisible(true);
      if (message.role === "audience" && !this.outputNeedsSelection) this.controller.setOutputAvailable(true);
      const snapshot = this.controller.getSnapshot();
      if (message.sequence === snapshot.sequence) this.send({ type: "alive", sessionId: snapshot.sessionId, sequence: snapshot.sequence });
      else this.publish();
    } else if (message.type === "command") this.command(message.command);
    else if (message.type === "focus") this.update({ focus: message.role });
    else if (message.type === "closed") {
      if (message.role === "presenter") this.controller.setPresenterVisible(false);
      else { this.outputNeedsSelection = true; this.controller.setOutputAvailable(false); }
    }
  };

  async start(document: DocumentSession, options: PresentationOptions, frame: number): Promise<void> {
    if (this.controller) return;
    const api = getActiveEditorPlatform().presentation ?? createBrowserPresentationApi();
    const sessionId = crypto.randomUUID();
    const emptyRenderer = { frames: [], page: () => Promise.reject(new Error("No document")), pageCount: () => Promise.resolve(0) };
    const controller = new PresentationController({ sessionId, documentId: document.id, title: document.title, renderer: emptyRenderer,
      budgetMs: options.countdownMinutes == null ? null : options.countdownMinutes * 60_000 });
    this.controller = controller; this.api = api; this.observedDocument = document;
    this.outputNeedsSelection = false;
    this.unsubscribeController = controller.subscribe(this.publish);
    // The document owns the launch too, before windows and assets are ready.
    this.unsubscribe = useEditorStore.subscribe(state => {
      const current = state.documents[document.id];
      if (!current) { void this.stop(); return; }
      controller.setTitle(current.title);
      if (current.source !== this.observedDocument?.source || current.fileRef !== this.observedDocument.fileRef) {
        this.observedDocument = current;
        if (this.renderer) this.refresh();
      }
    });
    this.update({ snapshot: controller.getSnapshot(), error: null });
    const connection = callPlatform(() => api.connect(sessionId, this.receive));
    const opening = callPlatform(() => api.open(sessionId, options,
      () => { if (this.controller === controller) { this.outputNeedsSelection = true; controller.setOutputAvailable(false); } },
      () => { if (this.controller === controller) { this.outputNeedsSelection = false; controller.setOutputAvailable(true); } }));
    // Adopt each handle as it arrives. Stop owns adopted handles; handles
    // arriving after cancellation release themselves, exactly once.
    void connection.then(transport => {
      if (this.controller === controller) this.transport = transport;
      else void callPlatform(() => { transport.close(); }).catch((error: unknown) => {
        console.info("[tikz-editor] Couldn’t close a presentation transport", error);
      });
    }, () => {});
    void opening.then(windows => {
      if (this.controller === controller) this.windows = windows;
      else void callPlatform(() => windows.close()).catch((error: unknown) => {
        console.info("[tikz-editor] Couldn’t close a presentation window", error);
      });
    }, () => {});
    // Attach rejection handlers immediately; either native operation can fail first.
    try {
      await Promise.all([connection, opening]);
      if (this.controller !== controller) return;
      await this.cleaningUp;
      if (this.controller !== controller) return;
      controller.setOutputAvailable(options.mode !== "rehearse");
      this.powerAcquisition = callPlatform(() => api.keepAwake?.(true)).catch((error: unknown) => {
        console.info("[tikz-editor] Couldn’t prevent display sleep", error);
      });
      const launchDocument = useEditorStore.getState().documents[document.id];
      if (!launchDocument) { await this.stop(); return; }
      const renderer = await BeamerPresentationRenderer.create(launchDocument.source, launchDocument.fileRef);
      if (this.controller !== controller) return;
      this.renderer = renderer;
      const buffered = this.launchCommands;
      this.launchCommands = [];
      const initialJump = buffered[0]?.type === "jump" ? buffered.shift() : undefined;
      await controller.replace(renderer, { frame: initialJump?.type === "jump" ? initialJump.frame : frame, step: 1, continuation: 1 }, launchDocument.title);
      if (this.controller !== controller) return;
      for (const command of buffered) this.command(command);
      // Edits made while windows/assets were opening are adopted too.
      const current = useEditorStore.getState().documents[document.id];
      if (current && (current.source !== launchDocument.source || current.fileRef !== launchDocument.fileRef)) {
        this.observedDocument = current; this.refresh();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn’t start the presentation.";
      if (this.controller === controller) {
        const stopping = this.stop();
        this.update({ error: message });
        await stopping;
      }
    }
  }

  refresh = (): void => {
    const controller = this.controller;
    if (!controller) return;
    this.revision++;
    if (this.replacing !== controller) void this.replaceUntilCurrent(controller);
  };
  // One update at a time. The one in flight is kept, since it shows the edits
  // made so far, and the latest source is taken up once it is done. Each
  // starts after the editor has painted the edit that asked for it.
  private async replaceUntilCurrent(controller: PresentationController): Promise<void> {
    this.replacing = controller;
    try {
      let revision: number;
      do {
        await new Promise<void>((resolve) => { afterNextPaint(resolve); });
        if (this.controller !== controller) return;
        revision = this.revision;
        await this.replaceDocument(revision);
      } while (revision !== this.revision && this.controller === controller);
    } finally {
      if (this.replacing === controller) this.replacing = null;
    }
  }
  private async replaceDocument(revision: number): Promise<void> {
    const controller = this.controller, previous = this.renderer;
    const doc = controller ? useEditorStore.getState().documents[controller.getSnapshot().documentId] : null;
    if (!controller || !previous || !doc) return;
    try {
      const next = await BeamerPresentationRenderer.create(doc.source, doc.fileRef);
      if (this.controller !== controller) return;
      const cursor = controller.getSnapshot().current?.cursor ?? { frame: 0, step: 1, continuation: 1 };
      const mapped = remapPresentationCursor(previous, next, cursor);
      const committed = await controller.replace(next, mapped, doc.title);
      if (committed && this.controller === controller) this.renderer = next;
    } catch (error) {
      if (revision === this.revision && this.controller === controller) {
        console.info("[tikz-editor] Couldn’t update presentation source", error);
        controller.setError("Couldn’t update the slides. The last valid slide is still displayed.");
      }
    }
  }

  command = (command: PresentationCommand): void => {
    const controller = this.controller;
    if (!controller) return;
    if (command.type === "stop") { void this.stop(); return; }
    if (command.type === "close-view") {
      void callPlatform(() => this.windows?.closeView(command.role))
        .then(() => { if (this.controller === controller) this.focusEditor(); })
        .catch((error: unknown) => { if (this.controller === controller) controller.setError(error instanceof Error ? error.message : "Couldn’t close the presentation window."); });
      return;
    }
    if (!this.renderer && ["next", "previous", "next-frame", "previous-frame", "jump"].includes(command.type)) {
      if (command.type === "jump") this.launchCommands = [];
      if (command.type === "next" && !controller.getSnapshot().timer.started) controller.timer("start");
      this.launchCommands.push(command);
      return;
    }
    if (command.type === "show-presenter" || command.type === "recover-output" || command.type === "swap-displays") {
      void callPlatform(() => command.type === "show-presenter" ? this.windows?.showPresenter() : command.type === "recover-output" ? this.windows?.recoverOutput(null) : this.windows?.swapDisplays()).then(result => {
        if (this.controller !== controller) return;
        if (command.type === "recover-output") { this.outputNeedsSelection = false; controller.setOutputAvailable(true); }
        if (command.type === "swap-displays" && result) savePresentationOptions({ ...loadPresentationOptions(), ...result });
      }).catch((error: unknown) => { if (this.controller === controller) controller.setError(error instanceof Error ? error.message : "Couldn’t change presentation windows."); });
      return;
    }
    void controller.command(command);
  };
  async recoverOutput(displayId: string | null): Promise<void> {
    const controller = this.controller;
    await this.windows?.recoverOutput(displayId);
    if (!controller || this.controller !== controller) return;
    this.outputNeedsSelection = false;
    controller.setOutputAvailable(true);
  }
  async stop(): Promise<void> {
    const controller = this.controller;
    if (!controller) { await this.cleaningUp; return; }
    controller.stop();
    this.unsubscribe?.(); this.unsubscribe = null;
    this.unsubscribeController?.(); this.unsubscribeController = null;
    this.revision++;
    this.launchCommands = [];
    const transport = this.transport, windows = this.windows, api = this.api;
    const previousCleanup = this.cleaningUp, powerAcquisition = this.powerAcquisition;
    this.powerAcquisition = null;
    this.controller = null; this.renderer = null; this.transport = null; this.windows = null; this.api = null;
    this.update({ snapshot: null, focus: "editor" });
    const cleanup = (async () => {
      try { await callPlatform(() => windows?.close()); }
      catch (error) { console.info("[tikz-editor] Couldn’t close a presentation window", error); }
      try { transport?.close(); }
      catch (error) { console.info("[tikz-editor] Couldn’t close a presentation transport", error); }
      // A cancelled intermediate launch must not let a successor overtake an
      // older session's cleanup, or release power it never acquired itself.
      await previousCleanup;
      if (powerAcquisition) {
        await powerAcquisition;
        await callPlatform(() => api?.keepAwake?.(false)).catch((error: unknown) => {
          console.info("[tikz-editor] Couldn’t release presentation power assertion", error);
        });
      }
    })();
    this.cleaningUp = cleanup;
    await cleanup;
    if (this.cleaningUp === cleanup) this.cleaningUp = null;
  }
}
export const presentationService = new PresentationService();
