import { TEX_GLYPH_OUTLINE_LOADERS } from "./data/outlines/index.generated.js";
import type { TexGlyphOutlines } from "./types.js";

// Layout needs only font metrics, which are bundled. Glyph outlines are most of
// the font data and only painting needs them, so each font's outlines load the
// first time a render asks for them. A render that ran without some outlines
// has blank glyphs: async callers render through `withTexGlyphOutlines`, which
// waits for the outlines and renders again.

/** A font's outlines: all of them, or a function that draws one when asked (runtime fonts). */
export type TexGlyphOutlineSource = TexGlyphOutlines | ((code: number) => string);

const loaded = new Map<string, TexGlyphOutlineSource>();
// Fonts outside the generated table whose outlines need an asynchronous step
// (a worker's runtime fonts load harfbuzz first).
const runtimeLoaders = new Map<string, () => Promise<TexGlyphOutlineSource>>();
const pending = new Map<string, Promise<void>>();
let generation = 0;

/**
 * Counts installed outlines. Caches that keep rendered glyphs drop their
 * entries when it changes, since those may have been rendered blank.
 */
export function texGlyphOutlineGeneration(): number {
  return generation;
}

/** Whether some outlines are loading, so a render now may paint glyphs blank. */
export function texGlyphOutlinesLoading(): boolean {
  return pending.size > 0;
}

/** The glyph's SVG path at 10pt, or "" while its font's outlines are not loaded (which starts loading them). */
export function texGlyphOutline(fontId: string, code: number): string {
  const outlines = loaded.get(fontId);
  if (outlines) return typeof outlines === "function" ? outlines(code) : outlines[String(code)] ?? "";
  void loadTexGlyphOutlines([fontId]);
  return "";
}

/** Installs outlines directly, for fonts outside the generated table. */
export function installTexGlyphOutlines(fontId: string, outlines: TexGlyphOutlineSource): void {
  loaded.delete(fontId);
  runtimeLoaders.delete(fontId);
  loaded.set(fontId, outlines);
  generation += 1;
}

/**
 * Outlines for a font outside the generated table that arrive when `loader`
 * resolves: the first render that paints the font starts it, and
 * `withTexGlyphOutlines` renders again once it has installed them.
 */
export function registerTexGlyphOutlineLoader(fontId: string, loader: () => Promise<TexGlyphOutlineSource>): void {
  loaded.delete(fontId);
  pending.delete(fontId);
  runtimeLoaders.set(fontId, loader);
  generation += 1;
}

/** Resolves once every outline load that is under way has finished. */
export async function settleTexGlyphOutlineLoads(): Promise<void> {
  while (pending.size > 0) await Promise.all(pending.values());
}

export function loadTexGlyphOutlines(fontIds: Iterable<string>): Promise<void> {
  const loads: Promise<void>[] = [];
  for (const fontId of fontIds) {
    if (loaded.has(fontId)) continue;
    let load = pending.get(fontId);
    if (!load) {
      const runtimeLoader = runtimeLoaders.get(fontId);
      const generated = Object.hasOwn(TEX_GLYPH_OUTLINE_LOADERS, fontId) ? TEX_GLYPH_OUTLINE_LOADERS[fontId] : undefined;
      const start = runtimeLoader ?? (generated ? () => generated().then((module): TexGlyphOutlineSource => module.default) : undefined);
      if (!start) continue;
      const loading = start();
      const thisLoad = loading.then(
        (outlines) => {
          // A newer registration for this id replaced the loader meanwhile.
          if (runtimeLoader && runtimeLoaders.get(fontId) !== runtimeLoader) return;
          loaded.set(fontId, outlines);
          generation += 1;
        },
        () => {
          // Offline or a stale deployment: glyphs stay blank, and a later render retries.
        }
      ).finally(() => { if (pending.get(fontId) === thisLoad) pending.delete(fontId); });
      load = thisLoad;
      pending.set(fontId, load);
    }
    loads.push(load);
  }
  return Promise.all(loads).then(() => {});
}

export function loadAllTexGlyphOutlines(): Promise<void> {
  return loadTexGlyphOutlines(Object.keys(TEX_GLYPH_OUTLINE_LOADERS));
}

// Default text and math fonts of an ordinary picture.
const COMMON_FONTS = ["lmroman10-regular", "cmr10", "cmr7", "cmmi10", "cmmi7", "cmsy10", "cmex10"];

/**
 * In Node (scripts, tests) outlines are local files, so all load up front and
 * synchronous renders paint every glyph. Elsewhere the common fonts start
 * loading without waiting for them.
 */
export async function preloadTexGlyphOutlines(): Promise<void> {
  const runtimeProcess: unknown = Reflect.get(globalThis, "process");
  const versions: unknown = runtimeProcess !== null && typeof runtimeProcess === "object"
    ? Reflect.get(runtimeProcess, "versions") : undefined;
  if (versions !== null && typeof versions === "object" && Reflect.get(versions, "node")) {
    await loadAllTexGlyphOutlines();
  } else {
    void loadTexGlyphOutlines(COMMON_FONTS);
  }
}

/**
 * Renders until no glyph can have been painted blank. A render that finds a
 * font's outlines missing starts loading them; once loads settle and installed
 * something, cached text is stale, so the render runs again. Callers that keep
 * their own render caches should drop them when `texGlyphOutlineGeneration`
 * changes. (Loads that fail leave the glyphs blank rather than retrying here.)
 */
export async function withTexGlyphOutlines<T>(render: (attempt: number) => T | Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const before = generation;
    const result = await render(attempt);
    if (attempt + 1 >= attempts) return result;
    while (pending.size > 0) await Promise.all(pending.values());
    if (generation === before) return result;
  }
}
