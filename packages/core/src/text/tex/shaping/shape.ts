import { encodeOt1Text, type Ot1EncodedChar } from "../encoding/ot1.js";
import {
  texHBoxX,
  texLength,
  type TexHBoxX,
} from "../coordinates.js";
import { roundTexPt, tfmToPt } from "../fonts/units.js";
import type {
  GeneratedTexCharMetric,
  GeneratedTexLigKern,
  ResolvedTexFont,
  ShapeTexTextOptions,
  ShapedTexTextRun,
  TexCaretStop,
  TexGlyphBox,
  TexKern,
  TexShapedItem,
} from "../fonts/types.js";

interface WorkGlyph {
  readonly code: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly components?: readonly number[];
}

type LigKernRule =
  | { readonly kind: "lig"; readonly out: number }
  | { readonly kind: "kern"; readonly width: number };

export function shapeOt1Text(
  text: string,
  font: ResolvedTexFont,
  options: ShapeTexTextOptions = {}
): ShapedTexTextRun {
  const sourceStart = options.sourceStart ?? 0;
  const encoded = encodeOt1Text(text, sourceStart, options.sourceEnd);
  const items = applyLigKernProgram(encoded, font);
  const width = roundTexPt(texLength(items.reduce((sum, item) => sum + item.width, 0)));
  const sourceEnd = options.sourceEnd ?? sourceStart + text.length;
  const caretStops = options.includeCaretStops === false
    ? []
    : buildCaretStops(sourceStart, sourceEnd, font, items);

  return {
    text,
    font,
    sourceStart,
    sourceEnd,
    width,
    items,
    caretStops: caretStops.map((stop) => stop.x),
    sourceCaretStops: caretStops,
  };
}

function applyLigKernProgram(encoded: readonly Ot1EncodedChar[], font: ResolvedTexFont): TexShapedItem[] {
  const rules = buildLigKernMap(font.data.ligKerns);
  const items: TexShapedItem[] = [];
  let current: WorkGlyph | null = null;

  const emitCurrent = () => {
    if (!current) {
      return;
    }
    items.push(createGlyphBox(current, font));
    current = null;
  };

  for (const char of encoded) {
    if (!current) {
      current = char;
      continue;
    }

    const rule = ligKernRule(rules, current.code, char.code);
    if (rule?.kind === "lig") {
      current = {
        code: rule.out,
        sourceStart: current.sourceStart,
        sourceEnd: char.sourceEnd,
        components: [...(current.components ?? [current.code]), char.code],
      };
      continue;
    }

    emitCurrent();
    if (rule?.kind === "kern") {
      items.push({
        kind: "kern",
        sourceStart: char.sourceStart,
        sourceEnd: char.sourceStart,
        width: roundTexPt(tfmToPt(font, rule.width)),
      } satisfies TexKern);
    }
    current = char;
  }

  emitCurrent();
  return items;
}

function createGlyphBox(glyph: WorkGlyph, font: ResolvedTexFont): TexGlyphBox {
  const metric = getCharMetric(font, glyph.code);
  return {
    kind: "glyph",
    fontId: font.id,
    code: glyph.code,
    sourceStart: glyph.sourceStart,
    sourceEnd: glyph.sourceEnd,
    width: roundTexPt(tfmToPt(font, metric.width)),
    height: roundTexPt(tfmToPt(font, metric.height)),
    depth: roundTexPt(tfmToPt(font, metric.depth)),
    italicCorrection: roundTexPt(tfmToPt(font, metric.italicCorrection)),
    components: glyph.components ?? [glyph.code],
  };
}

function getCharMetric(font: ResolvedTexFont, code: number): GeneratedTexCharMetric {
  const metric = font.data.chars[String(code)];
  if (!metric) {
    throw new Error(`Font '${font.id}' has no TFM metric for OT1 code ${code}.`);
  }
  return metric;
}

const ligKernMapCache = new WeakMap<readonly GeneratedTexLigKern[], Map<number, LigKernRule>>();

function buildLigKernMap(rules: readonly GeneratedTexLigKern[]): Map<number, LigKernRule> {
  const cached = ligKernMapCache.get(rules);
  if (cached) {
    return cached;
  }
  const map = new Map<number, LigKernRule>();
  for (const rule of rules) {
    const [, left, right, value] = rule;
    const key = ruleKey(left, right);
    if (map.has(key)) {
      continue;
    }
    map.set(
      key,
      rule[0] === "lig"
        ? { kind: "lig", out: value }
        : { kind: "kern", width: value }
    );
  }
  ligKernMapCache.set(rules, map);
  return map;
}

function ruleKey(left: number, right: number): number {
  return left * 0x10000 + right;
}

function ligKernRule(
  rules: ReadonlyMap<number, LigKernRule>,
  left: number,
  right: number
): LigKernRule | undefined {
  return rules.get(ruleKey(
    ot1LigKernAlias(left),
    ot1LigKernAlias(right)
  ));
}

function ot1LigKernAlias(code: number): number {
  // The parser exposes TeX's paired quotes as Unicode glyphs, while the
  // TFM lig/kern program addresses their OT1 slots.
  if (code === 0x201c) {
    return 92;
  }
  if (code === 0x201d) {
    return 34;
  }
  return code;
}

function buildCaretStops(
  sourceStart: number,
  sourceEnd: number,
  font: ResolvedTexFont,
  items: readonly TexShapedItem[]
): TexCaretStop[] {
  const stops = Array.from({ length: Math.max(0, sourceEnd - sourceStart) + 1 }, (_, index) => ({
    sourceOffset: sourceStart + index,
    x: texHBoxX(0),
  }));
  let x: TexHBoxX = texHBoxX(0);
  for (const item of items) {
    if (item.kind === "kern") {
      const local = item.sourceStart - sourceStart;
      x = roundTexPt(texHBoxX(x + item.width));
      if (local >= 0 && local < stops.length) {
        updateCaretStop(stops, local, item.sourceStart, x);
      }
      continue;
    }

    const localStart = item.sourceStart - sourceStart;
    const localEnd = item.sourceEnd - sourceStart;
    if (localStart >= 0 && localStart < stops.length) {
      updateCaretStop(stops, localStart, item.sourceStart, roundTexPt(x));
    }

    const internalStops = localEnd - localStart;
    if (internalStops === 1 && item.components.length === 1) {
      // An ordinary character has a single end stop. Its component-width
      // ratio is exactly one, so avoid another metric lookup and two arrays.
      if (localEnd >= 0 && localEnd < stops.length) {
        updateCaretStop(stops, localEnd, item.sourceEnd, roundTexPt(texHBoxX(x + item.width)));
      }
    } else if (internalStops > 0) {
      const componentWidths = item.components.map((code) => tfmToPt(font, getCharMetric(font, code).width));
      const componentTotal = componentWidths.reduce((sum, width) => sum + width, 0);
      let internalX: TexHBoxX = x;
      for (let index = 1; index <= internalStops; index++) {
        const componentWidth = componentWidths[index - 1] ?? (item.width / internalStops);
        internalX = texHBoxX(internalX + (componentTotal > 0
          ? item.width * (componentWidth / componentTotal)
          : item.width / internalStops));
        const local = localStart + index;
        if (local >= 0 && local < stops.length) {
          updateCaretStop(stops, local, sourceStart + local, roundTexPt(internalX));
        }
      }
    }
    x = roundTexPt(texHBoxX(x + item.width));
  }
  return stops;
}

function updateCaretStop(
  stops: { sourceOffset: number; x: TexHBoxX }[],
  index: number,
  sourceOffset: number,
  x: TexHBoxX
): void {
  // These objects are private until shaping returns; update rather than
  // allocating a replacement at both ends of every glyph and kern.
  const stop = stops[index];
  if (stop) {
    stop.sourceOffset = sourceOffset;
    stop.x = x;
  } else {
    stops[index] = { sourceOffset, x };
  }
}
