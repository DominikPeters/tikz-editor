import { isPresentationMessage, type PlatformPresentationApi, type PresentationDisplay, type PresentationOptions, type PresentationRole } from "@tikz-editor/app/presentation";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Monitor } from "@tauri-apps/api/window";
import type { EditorPlatform } from "@tikz-editor/app/platform/types";
import { resolvePlatformStorage } from "@tikz-editor/app/platform/storage";

/** Auxiliary windows do not consume file-open queues, initialize the assistant, or own app menus. */
export function createDesktopPresentationWindowPlatform(): EditorPlatform {
  const storage = resolvePlatformStorage();
  return { id: "desktop-tauri", persistence: { load: key => storage.getItem(key), save: (key, value) => { storage.setItem(key, value); } }, presentation: createDesktopPresentationApi() };
}

function displayId(monitor: Monitor, all: Monitor[]): string {
  const name = monitor.name ?? "Display";
  const duplicates = all.filter(candidate => (candidate.name ?? "Display") === name);
  if (duplicates.length === 1) return JSON.stringify([name]);
  const base = JSON.stringify([name, monitor.size.width, monitor.size.height]);
  return duplicates.filter(candidate => candidate.size.width === monitor.size.width && candidate.size.height === monitor.size.height).length > 1 ? `${base}:${monitor.position.x}:${monitor.position.y}` : base;
}
function matchingDisplay(id: string | null, displays: PresentationDisplay[]): PresentationDisplay | undefined {
  const exact = displays.find(display => display.id === id);
  if (exact || !id) return exact;
  try {
    const key = id.replace(/:-?\d+:-?\d+$/u, "");
    const identity = JSON.parse(key) as unknown;
    if (!Array.isArray(identity) || typeof identity[0] !== "string") return;
    const named = displays.filter(display => display.name === identity[0]);
    if (named.length === 1) return named[0];
    const sized = named.filter(display => display.width === identity[1] && display.height === identity[2]);
    return sized.length === 1 ? sized[0] : undefined;
  } catch { return; }
}
const isMac = () => /mac/i.test(navigator.platform);
async function monitors(): Promise<{ displays: PresentationDisplay[]; native: Monitor[] }> {
  const api = await import("@tauri-apps/api/window");
  const [all, primary] = await Promise.all([api.availableMonitors(), api.primaryMonitor()]);
  return { native: all, displays: all.map(monitor => ({ id: displayId(monitor, all), name: monitor.name ?? "Display",
    primary: !!primary && primary.position.x === monitor.position.x && primary.position.y === monitor.position.y,
    x: monitor.position.x, y: monitor.position.y, width: monitor.size.width, height: monitor.size.height, scaleFactor: monitor.scaleFactor })) };
}

async function fullScreen(window: WebviewWindow, value: boolean): Promise<void> {
  if (isMac()) await window.setSimpleFullscreen(value);
  else { await window.setDecorations(!value); await window.setFullscreen(value); }
}
async function place(window: WebviewWindow, display: PresentationDisplay, fullscreen: boolean): Promise<void> {
  const { PhysicalPosition, PhysicalSize } = await import("@tauri-apps/api/dpi");
  await fullScreen(window, false);
  const width = Math.min(display.width, 1100 * display.scaleFactor), height = Math.min(display.height, 760 * display.scaleFactor);
  await window.setSize(new PhysicalSize(width, height));
  await window.setPosition(new PhysicalPosition(display.x + Math.max(0, (display.width - width) / 2), display.y + Math.max(0, (display.height - height) / 2)));
  if (fullscreen) await fullScreen(window, true);
}
async function waitForCreated(window: WebviewWindow): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    void window.once("tauri://created", () => { resolve(); });
    void window.once<string>("tauri://error", event => { reject(new Error(event.payload)); });
  });
}

export function createDesktopPresentationApi(): PlatformPresentationApi {
  return {
    async displays() { return (await monitors()).displays; },
    async identifyDisplays() {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const { PhysicalPosition } = await import("@tauri-apps/api/dpi");
      const { invoke } = await import("@tauri-apps/api/core");
      const { displays } = await monitors();
      await Promise.all(displays.map(async (display, index) => {
        const label = `presentation-identifier-${crypto.randomUUID()}`;
        const url = new URL(window.location.href);
        url.searchParams.delete("presentation"); url.searchParams.delete("session");
        url.searchParams.set("identify-display", String(index + 1)); url.searchParams.set("display-name", display.name);
        const identifier = new WebviewWindow(label, { url: url.pathname + url.search, title: "Identify Display", width: 220, height: 160,
          decorations: false, resizable: false, alwaysOnTop: true, focus: false, focusable: false, visible: false, backgroundColor: "#202020" });
        await waitForCreated(identifier);
        await invoke("desktop_prepare_presentation_window", { label });
        await identifier.setPosition(new PhysicalPosition(display.x + (display.width - 220 * display.scaleFactor) / 2, display.y + (display.height - 160 * display.scaleFactor) / 2));
        await identifier.show();
        window.setTimeout(() => { void identifier.destroy().catch(() => {}); }, 2500);
      }));
    },
    async connect(sessionId, receive) {
      const { listen, emit } = await import("@tauri-apps/api/event");
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const event = `tikz-presentation:${sessionId}`;
      const unlisten = await listen<unknown>(event, message => { if (isPresentationMessage(message.payload, sessionId)) receive(message.payload); });
      const unlistenFocus = getCurrentWindow().label === "main" ? await listen<string>("presentation-focused-window", message => {
        const role = message.payload === "main" ? "editor" : message.payload === `presentation-audience-${sessionId}` ? "audience" : message.payload === `presentation-presenter-${sessionId}` ? "presenter" : null;
        if (role) receive({ type: "focus", sessionId, role });
      }) : undefined;
      return { send: message => emit(event, message), close: () => { unlisten(); unlistenFocus?.(); } };
    },
    async open(sessionId: string, options: PresentationOptions, onOutputLost) {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const { invoke } = await import("@tauri-apps/api/core");
      const { emit, listen } = await import("@tauri-apps/api/event");
      let audience: WebviewWindow | null = null, presenter: WebviewWindow | null = null;
      const getAudience = (): WebviewWindow | null => audience;
      const getPresenter = (): WebviewWindow | null => presenter;
      let audienceDisplay: string | null = options.audienceDisplay;
      let audienceFullscreen = options.mode === "display";
      let presenterDisplay: string | null = options.presenterDisplay;
      let closing = false, checking = false;
      const { displays } = await monitors();
      const primary = displays.find(display => display.primary) ?? displays[0];
      if (!primary) throw new Error("No presentation display is available.");
      const showConsole = options.mode === "rehearse" || (options.showPresenter ?? (options.mode === "window" || displays.length > 1));
      const output = audienceDisplay ? matchingDisplay(audienceDisplay, displays) : displays.find(display => !display.primary) ?? primary;
      if (!output && options.mode !== "rehearse") throw new Error("The previous audience display isn’t connected. Choose another display in Presentation Options.");
      const consoleDisplay = matchingDisplay(presenterDisplay, displays) ?? primary;
      if (presenterDisplay && showConsole && !matchingDisplay(presenterDisplay, displays)) throw new Error("The previous presenter display isn’t connected. Choose another display in Presentation Options.");
      audienceDisplay = output?.id ?? null; presenterDisplay = consoleDisplay.id;
      const create = async (role: PresentationRole): Promise<WebviewWindow> => {
        const label = `presentation-${role}-${sessionId}`;
        const url = new URL(window.location.href);
        url.searchParams.set("presentation", role); url.searchParams.set("session", sessionId);
        const child = new WebviewWindow(label, { url: url.pathname + url.search, title: role === "audience" ? "Presentation" : "Presenter View",
          width: role === "audience" ? 1100 : 1180, height: role === "audience" ? 720 : 820, visible: false, focus: false,
          resizable: true, dragDropEnabled: false, backgroundColor: role === "audience" ? "#000000" : undefined });
        await waitForCreated(child);
        await invoke("desktop_prepare_presentation_window", { label });
        await child.once("tauri://destroyed", () => {
          if (closing) return;
          if (role === "audience") { if (audience === child) audience = null; onOutputLost(); }
          else if (presenter === child) presenter = null;
          void emit(`tikz-presentation:${sessionId}`, { type: "closed", sessionId, role });
        });
        return child;
      };
      const showPresenter = async () => {
        if (!presenter) {
          presenter = await create("presenter");
          const live = (await monitors()).displays;
          await place(presenter, live.find(display => display.id === presenterDisplay) ?? live.find(display => display.primary) ?? primary, false);
        }
        await presenter.show(); await presenter.setFocus();
      };
      const showAudience = async (display: PresentationDisplay, fullscreen: boolean) => {
        audience ??= await create("audience");
        await place(audience, display, fullscreen);
        audienceFullscreen = fullscreen;
        audienceDisplay = display.id;
        await audience.show();
      };
      try {
        if (options.mode !== "rehearse" && output) await showAudience(output, options.mode === "display");
        if (showConsole) await showPresenter();
        else await getAudience()?.setFocus();
      } catch (error) {
        closing = true; await getAudience()?.destroy(); await getPresenter()?.destroy(); throw error;
      }
      let lastGeometry = JSON.stringify(output);
      const refreshDisplays = () => {
        if (closing || checking || !audience || audienceDisplay === null) return;
        checking = true;
        void (async () => {
          const current = (await monitors()).displays;
          const target = matchingDisplay(audienceDisplay, current);
          if (!target && audience) {
            const fallback = current.find(display => display.primary) ?? current[0];
            if (fallback) await place(audience, fallback, false);
            audienceDisplay = null; audienceFullscreen = false; lastGeometry = ""; onOutputLost();
          } else if (target && JSON.stringify(target) !== lastGeometry && audience) {
            lastGeometry = JSON.stringify(target);
            audienceDisplay = target.id;
            await place(audience, target, audienceFullscreen);
          }
        })().catch(error => { console.info("[tikz-editor] Couldn’t refresh presentation displays", error); }).finally(() => { checking = false; });
      };
      const unlistenDisplays = await listen("presentation-displays-changed", refreshDisplays);
      const timer = window.setInterval(refreshDisplays, 2000);
      return {
        async close() {
          if (closing) return;
          closing = true; unlistenDisplays(); window.clearInterval(timer);
          const children = [audience, presenter]; audience = null; presenter = null;
          await Promise.allSettled(children.filter((child): child is WebviewWindow => child !== null).map(child => child.destroy()));
        },
        showPresenter,
        async closeView(role) {
          await (role === "presenter" ? presenter : audience)?.destroy();
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().setFocus();
        },
        async recoverOutput(displayId = null) {
          const current = (await monitors()).displays;
          const target = displayId ? matchingDisplay(displayId, current) : current.find(display => display.primary) ?? current[0];
          if (!target) throw new Error("The selected audience display isn’t connected.");
          // Recovery is windowed until the presenter explicitly selects a display.
          await showAudience(target, displayId !== null && options.mode === "display");
          lastGeometry = JSON.stringify(target);
          void emit(`tikz-presentation:${sessionId}`, { type: "hello", sessionId, role: "audience" });
        },
        async swapDisplays() {
          if (!audience || !presenter || !audienceDisplay || !presenterDisplay) return;
          const current = (await monitors()).displays;
          const nextAudience = current.find(display => display.id === presenterDisplay), nextPresenter = current.find(display => display.id === audienceDisplay);
          if (!nextAudience || !nextPresenter) throw new Error("A presentation display is no longer connected.");
          await place(audience, nextAudience, audienceFullscreen);
          await place(presenter, nextPresenter, false);
          audienceDisplay = nextAudience.id; presenterDisplay = nextPresenter.id; lastGeometry = JSON.stringify(nextAudience);
          return { audienceDisplay, presenterDisplay };
        },
      };
    },
    async keepAwake(active) { const { invoke } = await import("@tauri-apps/api/core"); await invoke("desktop_presentation_keep_awake", { active }); },
    async enterFullscreen() {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      const window = getCurrentWebviewWindow();
      await fullScreen(window, true);
      await window.setFocus();
      await getCurrentWebview().setFocus();
    },
    async onFocus(receive) { const { getCurrentWindow } = await import("@tauri-apps/api/window"); return getCurrentWindow().onFocusChanged(event => { if (event.payload) receive(); }); },
  };
}
