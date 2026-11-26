import { setRuntimeHarfBuzzLoader } from "@tikz-editor/core/beamer";

// Runtime OpenType fonts (core's runtime-opentype.ts) need harfbuzzjs. The core
// package leaves it to the host, so browser bundles of core do not include it.
setRuntimeHarfBuzzLoader(async () => {
  const module = await import("harfbuzzjs");
  // In the apps' builds the module's initialisation is an exported promise
  // (apps/harfbuzz-wasm-plugin.ts); in Node it has already run.
  const ready: unknown = Reflect.get(module, "__tikzHarfBuzzReady");
  if (ready instanceof Promise) await ready;
  return module;
});
