import type { EditorPlatform } from "./types.js";

type MemoryStorage = Map<string, string>;

function createFallbackPlatform(): EditorPlatform {
  const storage: MemoryStorage = new Map();
  return {
    id: "fallback-memory",
    persistence: {
      load: (key) => storage.get(key) ?? null,
      save: (key, value) => {
        storage.set(key, value);
      }
    }
  };
}

let activePlatform: EditorPlatform = createFallbackPlatform();
let platformGeneration = 0;

export function setActiveEditorPlatform(platform: EditorPlatform): void {
  if (activePlatform !== platform) platformGeneration++;
  activePlatform = platform;
}

export function getActiveEditorPlatformGeneration(): number { return platformGeneration; }

export function getActiveEditorPlatform(): EditorPlatform {
  return activePlatform;
}
