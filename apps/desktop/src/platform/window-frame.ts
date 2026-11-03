import type { PlatformWindowFrame } from "@tikz-editor/app/platform/types";

// The caption buttons of the self-drawn Windows title bar
// (design/native-windows-look.md, phase 6). The maximise button's bounds go
// to the shell, which lays a native hit-test window over it so that Windows
// offers Snap Layouts there (snap_layout.rs); that window then owns the
// pointer, so its hover comes back as an event.

const MAXIMIZE_HOVER_EVENT = "desktop-maximize-button-hover";

async function currentWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

async function invoke(command: string, args?: Record<string, unknown>): Promise<void> {
  const core = await import("@tauri-apps/api/core");
  await core.invoke(command, args);
}

// Subscribes now and unsubscribes whenever the async listen settles.
function subscription(listen: () => Promise<() => void>): () => void {
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  void listen().then((stop) => {
    if (cancelled) stop();
    else unlisten = stop;
  }, () => null);
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

export function createWindowFrame(): PlatformWindowFrame {
  return {
    minimize: async () => { await (await currentWindow()).minimize(); },
    toggleMaximize: async () => { await (await currentWindow()).toggleMaximize(); },
    close: async () => { await (await currentWindow()).close(); },
    isMaximized: async () => await (await currentWindow()).isMaximized(),
    onMaximizedChange: (listener) => subscription(async () => {
      const window = await currentWindow();
      return await window.onResized(() => {
        void window.isMaximized().then(listener, () => null);
      });
    }),
    setMaximizeButtonBounds: (bounds) => {
      void invoke("desktop_set_maximize_button_bounds", { bounds }).catch(() => null);
    },
    accentPalette: async () => {
      const core = await import("@tauri-apps/api/core");
      return await core.invoke<string[] | null>("desktop_accent_palette");
    },
    onMaximizeButtonHover: (listener) => subscription(async () => {
      const window = await currentWindow();
      return await window.listen<boolean>(MAXIMIZE_HOVER_EVENT, (event) => { listener(event.payload); });
    })
  };
}
