import { getActiveEditorPlatform } from "../platform/current";
import { useEditorStore } from "../store/store";
import type { DocumentSession } from "../store/types";
import { createBrowserPresentationApi } from "./browser-platform";
import { PresentationController } from "./controller";
import { BeamerPresentationRenderer, remapPresentationCursor } from "./renderer";
import type { PlatformPresentationApi, PresentationCommand, PresentationMessage, PresentationOptions, PresentationSnapshot, PresentationTransport, PresentationWindows } from "./types";

const OPTIONS_KEY = "tikz-editor:presentation-options";
const DEFAULT_OPTIONS: PresentationOptions = { mode: "display", audienceDisplay: null, presenterDisplay: null, showPresenter: null, countdownMinutes: null };
export function loadPresentationOptions(): PresentationOptions {
  try {
    const raw = getActiveEditorPlatform().persistence.load(OPTIONS_KEY);
    const saved = raw ? JSON.parse(raw) as Partial<PresentationOptions> : {};
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
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private observedDocument: DocumentSession | null = null;
  private launchCommands: PresentationCommand[] = [];
  private outputNeedsSelection = false;
  private cleaningUp: Promise<void> | null = null;
  getState = (): ServiceState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<ServiceState>): void { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  clearError = (): void => { this.update({ error: null }); };
  // Called on every pointer-down in the editor: publish only a change of focus.
  focusEditor = (): void => { if (this.state.focus !== "editor") this.update({ focus: "editor" }); };
  private publish = (): void => {
    const snapshot = this.controller?.getSnapshot();
    if (!snapshot) return;
    this.update({ snapshot });
    void this.transport?.send({ type: "snapshot", sessionId: snapshot.sessionId, snapshot });
  };
  private receive = (message: PresentationMessage): void => {
    if (message.sessionId !== this.controller?.getSnapshot().sessionId) return;
    if (message.type === "hello") {
      if (message.role === "presenter") this.controller.setPresenterVisible(true);
      if (message.role === "audience" && !this.outputNeedsSelection) this.controller.setOutputAvailable(true);
      const snapshot = this.controller.getSnapshot();
      if (message.sequence === snapshot.sequence) void this.transport?.send({ type: "alive", sessionId: snapshot.sessionId, sequence: snapshot.sequence });
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
    savePresentationOptions(options);
    const api = getActiveEditorPlatform().presentation ?? createBrowserPresentationApi();
    const sessionId = crypto.randomUUID();
    const emptyRenderer = { frames: [], page: () => Promise.reject(new Error("No document")), pageCount: () => Promise.resolve(0) };
    const controller = new PresentationController({ sessionId, documentId: document.id, title: document.title, renderer: emptyRenderer,
      budgetMs: options.countdownMinutes == null ? null : options.countdownMinutes * 60_000 });
    this.controller = controller; this.api = api; this.observedDocument = document;
    this.outputNeedsSelection = false;
    this.unsubscribeController = controller.subscribe(this.publish);
    this.update({ snapshot: controller.getSnapshot(), error: null });
    const connection = api.connect(sessionId, this.receive);
    const opening = api.open(sessionId, options, () => { if (this.controller === controller) { this.outputNeedsSelection = true; controller.setOutputAvailable(false); } });
    // Attach rejection handlers immediately; either native operation can fail first.
    try {
      const [transport, windows] = await Promise.all([connection, opening]);
      if (this.controller !== controller) { transport.close(); await windows.close(); return; }
      this.transport = transport; this.windows = windows;
      await this.cleaningUp;
      if (this.controller !== controller) return;
      controller.setOutputAvailable(options.mode !== "rehearse");
      void api.keepAwake?.(true).catch(error => { console.info("[tikz-editor] Couldn’t prevent display sleep", error); });
      const renderer = await BeamerPresentationRenderer.create(document.source, document.fileRef);
      if (this.controller !== controller) return;
      this.renderer = renderer;
      const buffered = this.launchCommands;
      this.launchCommands = [];
      const initialJump = buffered[0]?.type === "jump" ? buffered.shift() : undefined;
      await controller.replace(renderer, { frame: initialJump?.type === "jump" ? initialJump.frame : frame, step: 1, continuation: 1 }, document.title);
      if (this.controller !== controller) return;
      for (const command of buffered) this.command(command);
      this.unsubscribe = useEditorStore.subscribe(state => {
        const current = state.documents[document.id];
        if (!current) { void this.stop(); return; }
        controller.setTitle(current.title);
        if (current.source !== this.observedDocument?.source || current.fileRef !== this.observedDocument?.fileRef) {
          this.observedDocument = current;
          this.refresh();
        }
      });
      // Edits made while windows/assets were opening are adopted too.
      const current = useEditorStore.getState().documents[document.id];
      if (current && current.source !== document.source) { this.observedDocument = current; this.refresh(); }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn’t start the presentation.";
      // Collect handles even when the other operation rejects, then release them.
      const resources = await Promise.allSettled([connection, opening]);
      if (resources[0].status === "fulfilled") resources[0].value.close();
      if (resources[1].status === "fulfilled") await Promise.resolve(resources[1].value.close()).catch(() => {});
      if (this.controller === controller) { await this.stop(); this.update({ error: message }); }
    }
  }

  refresh = (): void => {
    if (!this.controller) return;
    this.revision++;
    if (this.updateTimer) clearTimeout(this.updateTimer);
    const revision = this.revision;
    this.updateTimer = setTimeout(() => { this.updateTimer = null; void this.replaceDocument(revision); }, 120);
  };
  private async replaceDocument(revision: number): Promise<void> {
    const controller = this.controller, previous = this.renderer;
    const doc = controller ? useEditorStore.getState().documents[controller.getSnapshot().documentId] : null;
    if (!controller || !previous || !doc) return;
    try {
      const next = await BeamerPresentationRenderer.create(doc.source, doc.fileRef);
      if (revision !== this.revision || this.controller !== controller) return;
      const cursor = controller.getSnapshot().current?.cursor ?? { frame: 0, step: 1, continuation: 1 };
      const mapped = remapPresentationCursor(previous, next, cursor);
      const committed = await controller.replace(next, mapped, doc.title);
      if (committed && revision === this.revision && this.controller === controller) this.renderer = next;
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
    if (command.type === "close-view") { void Promise.resolve(this.windows?.closeView(command.role)).then(this.focusEditor).catch(error => { controller.setError(error instanceof Error ? error.message : "Couldn’t close the presentation window."); }); return; }
    if (!this.renderer && ["next", "previous", "next-frame", "previous-frame", "jump"].includes(command.type)) {
      if (command.type === "jump") this.launchCommands = [];
      if (command.type === "next" && !controller.getSnapshot().timer.started) controller.timer("start");
      this.launchCommands.push(command);
      return;
    }
    if (command.type === "show-presenter" || command.type === "recover-output" || command.type === "swap-displays") {
      const action = command.type === "show-presenter" ? this.windows?.showPresenter() : command.type === "recover-output" ? this.windows?.recoverOutput(null) : this.windows?.swapDisplays();
      void Promise.resolve(action).then(result => {
        if (command.type === "recover-output") { this.outputNeedsSelection = false; controller.setOutputAvailable(true); }
        if (command.type === "swap-displays" && result) savePresentationOptions({ ...loadPresentationOptions(), ...result });
      }).catch(error => { controller.setError(error instanceof Error ? error.message : "Couldn’t change presentation windows."); });
      return;
    }
    void controller.command(command);
  };
  async recoverOutput(displayId: string | null): Promise<void> { await this.windows?.recoverOutput(displayId); this.outputNeedsSelection = false; this.controller?.setOutputAvailable(true); }
  async stop(): Promise<void> {
    const controller = this.controller;
    if (!controller) return;
    controller.stop();
    this.unsubscribe?.(); this.unsubscribe = null;
    this.unsubscribeController?.(); this.unsubscribeController = null;
    this.revision++;
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = null;
    this.launchCommands = [];
    const transport = this.transport, windows = this.windows, api = this.api;
    this.controller = null; this.renderer = null; this.transport = null; this.windows = null; this.api = null;
    this.update({ snapshot: null, focus: "editor" });
    const cleanup = (async () => {
      try { await windows?.close(); }
      catch (error) { console.info("[tikz-editor] Couldn’t close a presentation window", error); }
      finally { transport?.close(); await api?.keepAwake?.(false).catch(error => { console.info("[tikz-editor] Couldn’t release presentation power assertion", error); }); }
    })();
    this.cleaningUp = cleanup;
    await cleanup;
    if (this.cleaningUp === cleanup) this.cleaningUp = null;
  }
}
export const presentationService = new PresentationService();
