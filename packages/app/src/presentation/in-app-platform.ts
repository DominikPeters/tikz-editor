import type { PlatformPresentationApi, PresentationMessage, PresentationRole, PresentationTransport } from "./types";

/**
 * Presenting inside the editor's own window, for platforms with a single
 * screen (the iPad): the audience or presenter view is shown over the editor
 * instead of in a window of its own, and the views talk to the presentation
 * service over an in-process channel instead of BroadcastChannel.
 */
export type InAppPresentationView = { sessionId: string; role: PresentationRole };

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

export function createInAppPresentationApi(native: { keepAwake?: (active: boolean) => Promise<void> } = {}): PlatformPresentationApi {
  // The service and each view ask to keep the display awake; it stays awake
  // while any of them does.
  let awake = 0;
  return {
    displays: () => Promise.resolve([]),
    connect(sessionId, receive): Promise<PresentationTransport> {
      const members = channels.get(sessionId) ?? new Set<Member>();
      channels.set(sessionId, members);
      const member: Member = message => { receive(message); };
      members.add(member);
      return Promise.resolve({
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
      });
    },
    open(sessionId, options, onOutputLost) {
      const rehearsing = options.mode === "rehearse";
      setView({ sessionId, role: rehearsing ? "presenter" : "audience" });
      const showing = () => currentView?.sessionId === sessionId;
      return Promise.resolve({
        close() { if (showing()) setView(null); },
        // One screen: the presenter view replaces the slides, which the
        // service then treats as an output to bring back.
        showPresenter() {
          if (!showing()) return;
          setView({ sessionId, role: "presenter" });
          if (!rehearsing) onOutputLost();
        },
        closeView(role) { if (role === "presenter" && showing()) setView({ sessionId, role: "audience" }); },
        recoverOutput() { if (showing()) setView({ sessionId, role: "audience" }); },
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
