import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { InAppExternalDisplay } from "@tikz-editor/app/presentation";

/**
 * A projector or monitor attached by cable or AirPlay (`external_display` in
 * src-tauri/src/lib.rs). It mirrors the iPad until a presentation puts its
 * slides there.
 */
export function createIpadExternalDisplay(): InAppExternalDisplay {
  let connected = false;
  const listeners = new Set<(connected: boolean) => void>();
  const update = (next: boolean) => {
    if (next === connected) return;
    connected = next;
    for (const listener of listeners) listener(next);
  };
  // A display attached before the page loaded announced itself to no one.
  void invoke<boolean>("ipad_external_display_connected").then(update).catch(() => {});
  void listen<boolean>("ipad-external-display", event => { update(event.payload); }).catch(() => {});
  return {
    connected: () => connected,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    show: async (src, background) => { await invoke("ipad_external_show", { src, background }); },
    hide: async () => { await invoke("ipad_external_hide"); },
  };
}
