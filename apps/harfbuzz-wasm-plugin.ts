import type { Plugin } from "vite";

const INIT = "init(await createHarfBuzz());";

/**
 * harfbuzzjs initialises itself with a top-level `await` (which the app's
 * build targets do not allow) and loads `harfbuzz.wasm` from its own
 * directory (which a bundle does not keep). This rewrites the initialisation
 * into an exported promise, `__tikzHarfBuzzReady`, that locates the file with
 * `new URL(..., import.meta.url)`, so Vite serves it in development and emits
 * it in a build. `loadRuntimeHarfBuzz` (packages/core) awaits the promise.
 * Vite must not pre-bundle the package, or the transform would not see it.
 */
export function harfbuzzWasm(): Plugin {
  return {
    name: "tikz-editor-harfbuzz-wasm",
    enforce: "pre",
    config: () => ({ optimizeDeps: { exclude: ["harfbuzzjs"] } }),
    transform(code, id) {
      if (!id.replaceAll("\\", "/").includes("/harfbuzzjs/dist/index.mjs")) return null;
      if (!code.includes(INIT)) this.error("harfbuzzjs changed its initialisation; update apps/harfbuzz-wasm-plugin.ts.");
      return code.replace(INIT,
        'export const __tikzHarfBuzzReady = createHarfBuzz({ locateFile: (path) => path === "harfbuzz.wasm" ? new URL("./harfbuzz.wasm", import.meta.url).href : path }).then(init);');
    },
  };
}
