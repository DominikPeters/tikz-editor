export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

/** Property access itself can throw when browser storage is disabled. */
export function resolvePlatformStorage(provided?: StorageLike): StorageLike {
  if (provided) {
    return provided;
  }
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
  } catch (error) {
    if (typeof console !== "undefined" && typeof console.info === "function") {
      console.info("[tikz-editor] Browser storage is unavailable; using session memory.", error);
    }
  }
  const memory = new Map<string, string>();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value);
    }
  };
}
