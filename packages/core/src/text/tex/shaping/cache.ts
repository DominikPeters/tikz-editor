import { TexWeightedLruCache, freezeTexCacheValue } from "../cache.js";
import { COMPUTER_MODERN_OT1_FONTS } from "../fonts/data/computer-modern-ot1.generated.js";
import type {
  GeneratedTexFont,
  ResolvedTexFont,
  ShapeTexTextOptions,
  ShapedTexTextRun,
} from "../fonts/types.js";
import { shapeOt1Text } from "./shape.js";

// Only our generated table is cacheable. Custom font metrics remain live inputs.
Object.freeze(COMPUTER_MODERN_OT1_FONTS);
const generatedFonts = new WeakSet<GeneratedTexFont>(Object.values(COMPUTER_MODERN_OT1_FONTS));
const immutableFonts = new WeakSet<GeneratedTexFont>();
const MAX_TEXT_LENGTH = 256;
const MAX_SOURCE_SPAN = 512;
type CachedShapedRun = Omit<ShapedTexTextRun, "font">;

export class TexShapedTextCache {
  private readonly runs = new TexWeightedLruCache<string, CachedShapedRun>(2048, 2 * 1024 * 1024);
  private readonly seen = new TexWeightedLruCache<string, true>(1024, 256 * 1024);

  public shapeText(
    text: string,
    font: ResolvedTexFont,
    options: ShapeTexTextOptions
  ): ShapedTexTextRun {
    const sourceStart = options.sourceStart ?? 0;
    const sourceEnd = options.sourceEnd ?? sourceStart + text.length;
    const spanLength = sourceEnd - sourceStart;
    if (
      text.length > MAX_TEXT_LENGTH ||
      !generatedFonts.has(font.data) || font.data !== COMPUTER_MODERN_OT1_FONTS[font.id] ||
      !Number.isFinite(font.atPt) || Object.is(font.atPt, -0) ||
      !Number.isSafeInteger(sourceStart) || Object.is(sourceStart, -0) ||
      !Number.isSafeInteger(sourceEnd) || Object.is(sourceEnd, -0) ||
      !Number.isSafeInteger(sourceStart + text.length) ||
      spanLength < 0 || spanLength > MAX_SOURCE_SPAN
    ) {
      return shapeOt1Text(text, font, options);
    }
    // Generated font IDs and finite numeric fields contain no colon, so this
    // fixed prefix is unambiguous even when the text itself contains colons.
    const key = `${font.id}:${font.atPt}:${spanLength}:${options.includeCaretStops === false ? 0 : 1}:${text}`;
    const cached = this.runs.get(key);
    if (cached) return rebaseShapedRun(cached, font, sourceStart, sourceEnd);
    const reused = this.seen.get(key) === true;
    if (!reused) this.seen.set(key, true, key.length * 2 + 64);

    if (!immutableFonts.has(font.data)) {
      // These are owned, readonly generated metrics. Enforce immutability so
      // a cache hit cannot silently use metrics from before a data mutation.
      freezeTexCacheValue(font.data.chars);
      freezeTexCacheValue(font.data.ligKerns);
      Object.freeze(font.data);
      immutableFonts.add(font.data);
    }
    const run = shapeOt1Text(text, font, options);
    // Unique edits/counters should not pay to prepare immutable cache values.
    if (!reused) return run;
    // Freeze only the newly produced arrays/items, never the caller's font.
    for (const item of run.items) {
      if (item.kind === "glyph") Object.freeze(item.components);
      Object.freeze(item);
    }
    for (const stop of run.sourceCaretStops) Object.freeze(stop);
    Object.freeze(run.items);
    Object.freeze(run.sourceCaretStops);
    Object.freeze(run.caretStops);
    Object.freeze(run);
    // Keep no caller-owned font/color object alive through the cache.
    this.runs.set(key, {
      text: run.text,
      sourceStart: run.sourceStart,
      sourceEnd: run.sourceEnd,
      width: run.width,
      items: run.items,
      caretStops: run.caretStops,
      sourceCaretStops: run.sourceCaretStops,
    }, key.length * 2 + run.items.length * 160 + run.caretStops.length * 64 + 160);
    return run;
  }
}

function rebaseShapedRun(
  run: CachedShapedRun,
  font: ResolvedTexFont,
  sourceStart: number,
  sourceEnd: number
): ShapedTexTextRun {
  const shifted = sourceStart !== run.sourceStart;
  return {
    text: run.text,
    font,
    sourceStart,
    sourceEnd,
    width: run.width,
    items: !shifted ? run.items : run.items.map((item) => ({
      ...item,
      sourceStart: sourceStart + (item.sourceStart - run.sourceStart),
      sourceEnd: sourceStart + (item.sourceEnd - run.sourceStart),
    })),
    caretStops: run.caretStops,
    sourceCaretStops: !shifted ? run.sourceCaretStops : run.sourceCaretStops.map((stop) => ({
      ...stop,
      sourceOffset: sourceStart + (stop.sourceOffset - run.sourceStart),
    })),
  };
}
