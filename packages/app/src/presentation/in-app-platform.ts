import type { PlatformPresentationApi, PresentationMessage, PresentationRole, PresentationSnapshot, PresentationTransport } from "./types";

/**
 * Presenting inside the editor's own window, for platforms with a single
 * screen (the iPad): the audience or presenter view is shown over the editor
 * instead of in a window of its own, and the views talk to the presentation
 * service over an in-process channel instead of BroadcastChannel.
 *
 * With an external display attached the slides go there, as their own image,
 * and the screen shows the presenter view.
 */
export type InAppPresentationView = { sessionId: string; role: PresentationRole };

/** A display the platform can put the slides on (the iPad's projector or AirPlay). */
export type InAppExternalDisplay = {
  connected(): boolean;
  subscribe(listener: (connected: boolean) => void): () => void;
  /** The slide as an image URL, or null for the background alone. */
  show(src: string | null, background: "black" | "white"): Promise<void>;
  /** Back to mirroring the screen. */
  hide(): Promise<void>;
};

let currentView: InAppPresentationView | null = null;
const viewListeners = new Set<() => void>();
function setView(view: InAppPresentationView | null): void {
  currentView = view;
  for (const listener of viewListeners) listener();
}
export const inAppPresentationView = {
  get: (): InAppPresentationView | null => currentView,
  subscribe: (listener: () => void): (() => void) => { viewListeners.add(listener); return () => { viewListeners.delete(listener); }; },
};

type Member = (message: PresentationMessage) => void;
const channels = new Map<string, Set<Member>>();

function connectMember(sessionId: string, receive: Member): PresentationTransport {
  const members = channels.get(sessionId) ?? new Set<Member>();
  channels.set(sessionId, members);
  const member: Member = message => { receive(message); };
  members.add(member);
  return {
    // Like BroadcastChannel: every other member, never the sender, and
    // never synchronously.
    send(message) {
      for (const other of members) {
        if (other !== member) queueMicrotask(() => { if (members.has(other)) other(message); });
      }
    },
    close() {
      members.delete(member);
      if (!members.size) channels.delete(sessionId);
    },
  };
}

/**
 * Follows the presentation as its audience and puts each slide on the
 * display. Returns how to stop.
 */
function sendSlidesTo(display: InAppExternalDisplay, sessionId: string): () => void {
  let shownSvg: string | null | undefined;
  let shownBlank: PresentationSnapshot["blank"] | undefined;
  const present = (snapshot: PresentationSnapshot) => {
    if (snapshot.ended) return;
    const svg = snapshot.blank === "none" ? snapshot.current?.svg ?? null : null;
    if (svg === shownSvg && snapshot.blank === shownBlank) return;
    shownSvg = svg; shownBlank = snapshot.blank;
    const src = svg === null ? null : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    void display.show(src, snapshot.blank === "white" ? "white" : "black").catch(() => {});
  };
  const transport = connectMember(sessionId, message => { if (message.type === "snapshot") present(message.snapshot); });
  // As an audience window would: the service answers with the current slide.
  void transport.send({ type: "hello", sessionId, role: "audience" });
  return () => {
    transport.close();
    void display.hide().catch(() => {});
  };
}

export function createInAppPresentationApi(native: { keepAwake?: (active: boolean) => Promise<void>; externalDisplay?: InAppExternalDisplay } = {}): PlatformPresentationApi {
  const external = native.externalDisplay;
  // The service and each view ask to keep the display awake; it stays awake
  // while any of them does.
  let awake = 0;
  return {
    displays: () => Promise.resolve([]),
    connect(sessionId, receive): Promise<PresentationTransport> {
      return Promise.resolve(connectMember(sessionId, receive));
    },
    open(sessionId, options, onOutputLost, onOutputRestored) {
      const rehearsing = options.mode === "rehearse";
      const showing = () => currentView?.sessionId === sessionId;
      let stopSlides: (() => void) | null = null;
      const startSlides = () => {
        if (!external || stopSlides) return;
        stopSlides = sendSlidesTo(external, sessionId);
        setView({ sessionId, role: "presenter" });
      };
      const stopSlidesOnDisplay = () => { stopSlides?.(); stopSlides = null; };

      setView({ sessionId, role: rehearsing ? "presenter" : "audience" });
      if (!rehearsing && external?.connected()) startSlides();
      // A display attached during the talk takes the slides; one unplugged
      // leaves the presenter view, which offers to show them here again.
      const unsubscribe = external?.subscribe(connected => {
        if (!showing() || rehearsing) return;
        if (connected && !stopSlides) { startSlides(); onOutputRestored?.(); }
        else if (stopSlides) { stopSlidesOnDisplay(); onOutputLost(); }
      });
      return Promise.resolve({
        close() {
          unsubscribe?.();
          stopSlidesOnDisplay();
          if (showing()) setView(null);
        },
        // One screen: the presenter view replaces the slides, which the
        // service then treats as an output to bring back.
        showPresenter() {
          if (!showing() || stopSlides) return;
          setView({ sessionId, role: "presenter" });
          if (!rehearsing) onOutputLost();
        },
        closeView(role) { if (role === "presenter" && showing() && !stopSlides) setView({ sessionId, role: "audience" }); },
        recoverOutput() {
          if (!showing()) return;
          if (external?.connected() && !rehearsing) startSlides();
          else setView({ sessionId, role: "audience" });
        },
        swapDisplays() {},
      });
    },
    async keepAwake(active) {
      const before = awake > 0;
      awake = Math.max(0, awake + (active ? 1 : -1));
      if (awake > 0 !== before) await native.keepAwake?.(awake > 0);
    },
  };
}
