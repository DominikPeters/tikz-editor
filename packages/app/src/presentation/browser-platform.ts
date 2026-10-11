import { isPresentationMessage, type PlatformPresentationApi, type PresentationOptions, type PresentationRole, type PresentationWindows } from "./types";

export function presentationWindowUrl(sessionId: string, role: PresentationRole, fullscreen = false): string {
  const url = new URL(window.location.href);
  url.searchParams.set("presentation", role);
  url.searchParams.set("session", sessionId);
  if (fullscreen) url.searchParams.set("fullscreen", "1");
  else url.searchParams.delete("fullscreen");
  return url.href;
}

export function createBrowserPresentationApi(): PlatformPresentationApi {
  let awake = false;
  let wakeLock: WakeLockSentinel | null = null;
  let requestingWake = false;
  const acquireWake = async () => {
    if (!awake || requestingWake || wakeLock || document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
    requestingWake = true;
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (!awake) { await lock.release(); return; }
      wakeLock = lock;
      lock.addEventListener("release", () => { if (wakeLock === lock) wakeLock = null; });
    } catch { /* Browser/OS policy may deny a wake lock. */ }
    finally { requestingWake = false; }
  };
  const visibility = () => { void acquireWake(); };
  return {
    displays: () => Promise.resolve([]),
    connect(sessionId, receive) {
      const channel = new BroadcastChannel(`tikz-presentation:${sessionId}`);
      channel.onmessage = event => { if (isPresentationMessage(event.data, sessionId)) receive(event.data); };
      return Promise.resolve({ send: message => { channel.postMessage(message); }, close: () => { channel.close(); } });
    },
    open(sessionId: string, options: PresentationOptions, onOutputLost) {
      return new Promise<PresentationWindows>(resolve => {
      let audience: Window | null = null, presenter: Window | null = null;
      let closing = false;
      const openAudience = () => {
        audience = window.open(presentationWindowUrl(sessionId, "audience", options.mode === "display"), `tikz-audience-${sessionId}`, "popup,width=1100,height=700");
        if (!audience) throw new Error("Allow this site to open a presentation window, then try again.");
      };
      const openPresenter = () => {
        presenter = window.open(presentationWindowUrl(sessionId, "presenter"), `tikz-presenter-${sessionId}`, "popup,width=1180,height=820");
        if (!presenter) throw new Error("Allow this site to open the presenter window, then choose Show Presenter View.");
        presenter.focus();
      };
      // Reserve windows while the launch click still has browser user activation.
      if (options.mode !== "rehearse") openAudience();
      if (options.showPresenter !== false || options.mode === "rehearse") {
        try { openPresenter(); }
        catch (error) {
          if (options.mode === "rehearse") throw error;
          // Some browsers allow one popup per gesture. Show Presenter View provides a second gesture.
          console.info("[tikz-editor] Presenter popup was blocked", error);
        }
      }
      let audienceWasOpen = audience !== null;
      const timer = window.setInterval(() => {
        if (closing) return;
        if (audienceWasOpen && audience?.closed) { audienceWasOpen = false; onOutputLost(); }
      }, 500);
      resolve({
        close() { closing = true; window.clearInterval(timer); audience?.close(); presenter?.close(); },
        showPresenter() { openPresenter(); },
        closeView(role) { if (role === "presenter") presenter?.close(); else audience?.close(); window.focus(); },
        recoverOutput() { openAudience(); audienceWasOpen = true; },
        swapDisplays() { audience?.focus(); },
      });
      });
    },
    async keepAwake(active) {
      awake = active;
      document.removeEventListener("visibilitychange", visibility);
      if (active) { document.addEventListener("visibilitychange", visibility); await acquireWake(); }
      else { const lock = wakeLock; wakeLock = null; await lock?.release(); }
    },
    async enterFullscreen() { await document.documentElement.requestFullscreen(); },
    onFocus(receive) { window.addEventListener("focus", receive); return Promise.resolve(() => { window.removeEventListener("focus", receive); }); },
  };
}
