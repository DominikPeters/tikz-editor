import { describe, expect, it } from "vitest";
import { ComputerModernTexMetricProvider } from "../packages/core/src/text/tex/fonts/computer-modern.js";
import type { GeneratedTexLigKern, ResolvedTexFont } from "../packages/core/src/text/tex/fonts/types.js";
import { texLength } from "../packages/core/src/text/tex/coordinates.js";
import { shapeOt1Text } from "../packages/core/src/text/tex/shaping/shape.js";

describe("cached TeX shaping", () => {
  it("keeps cache internals out of font-profile serialization", () => {
    const provider = new ComputerModernTexMetricProvider();
    for (const text of ["office", "other"]) {
      provider.shapeText(text);
      provider.shapeText(text);
    }
    expect(JSON.stringify(provider)).toBe("{}");
  });

  it("preserves borrowed shaping methods and cold/warm serialization", () => {
    const provider = new ComputerModernTexMetricProvider();
    const font = provider.resolveFont();
    const adapter = { resolveFont: () => font, shapeText: provider.shapeText };
    expect(adapter.shapeText("office AV")).toEqual(shapeOt1Text("office AV", font));
    const cold = provider.shapeText("serialization probe", font);
    provider.shapeText("serialization probe", font);
    expect(JSON.stringify(provider.shapeText("serialization probe", font))).toBe(JSON.stringify(cold));
  });

  it("rejects inherited object properties as generated font IDs", () => {
    const provider = new ComputerModernTexMetricProvider();
    for (const fontId of ["constructor", "__proto__", "toString"]) {
      expect(() => provider.resolveFont({ fontId })).toThrow("not available");
    }
    expect(Object.isFrozen(Object.prototype)).toBe(false);
  });

  it.each(["office AV", "e\u0301—é", "x", " ", "", "``quoted'' -- ---"])(
    "matches uncached shaping and rebases every source position for %s", (text) => {
      const provider = new ComputerModernTexMetricProvider();
      const font = provider.resolveFont({ fontId: "lmroman10-regular" });
      for (const includeCaretStops of [true, false]) {
        for (const spanExtra of [0, 3]) {
          for (const sourceStart of [40, 0, 80, -30, Number.MAX_SAFE_INTEGER - 512, -Number.MAX_SAFE_INTEGER]) {
            const options = { sourceStart, sourceEnd: sourceStart + text.length + spanExtra, includeCaretStops };
            const actualFont = { ...font, color: sourceStart === 0 ? "red" : "blue" };
            const result = provider.shapeText(text, actualFont, options);
            expect(result).toEqual(shapeOt1Text(text, actualFont, options));
            expect(result.font).toBe(actualFont);
          }
        }
      }
    }
  );

  it("reuses immutable glyph and caret arrays for equivalent requests", () => {
    const provider = new ComputerModernTexMetricProvider();
    const font = provider.resolveFont();
    provider.shapeText("office", font, { sourceStart: 5 });
    const first = provider.shapeText("office", font, { sourceStart: 5 });
    const second = provider.shapeText("office", { ...font, color: "red" }, { sourceStart: 5 });
    expect(second.items).toBe(first.items);
    expect(second.sourceCaretStops).toBe(first.sourceCaretStops);
    expect(Object.isFrozen(first.items)).toBe(true);
    expect(Object.isFrozen(first.items[0])).toBe(true);
    expect(Object.isFrozen(first.caretStops)).toBe(true);
    expect(Object.isFrozen(first.sourceCaretStops[0])).toBe(true);
  });

  it("isolates size, caret mode, and synthesized accent spans", () => {
    const provider = new ComputerModernTexMetricProvider();
    for (const atPt of [10, 10.0000001, 20]) {
      const font = provider.resolveFont({ fontId: "lmroman10-regular", atPt: texLength(atPt) });
      for (const sourceEnd of [21, 25, 28]) {
        for (const includeCaretStops of [true, false]) {
          const options = { sourceStart: 20, sourceEnd, includeCaretStops };
          expect(provider.shapeText("é", font, options)).toEqual(shapeOt1Text("é", font, options));
        }
      }
    }
  });

  it("bypasses fractional offsets and observes mutable custom metrics and lig/kern programs", () => {
    const provider = new ComputerModernTexMetricProvider();
    const base = provider.resolveFont();
    const metric = { ...base.data.chars[65], width: 1 };
    const rules: GeneratedTexLigKern[] = [];
    const font: ResolvedTexFont = { ...base, data: { ...base.data, chars: { ...base.data.chars, 65: metric }, ligKerns: rules } };
    expect(provider.shapeText("AA", font).width).toBe(20);
    metric.width = 2;
    rules.push(["kern", 65, 65, 0.25]);
    expect(provider.shapeText("AA", font).width).toBe(42.5);
    for (const sourceStart of [0.5, -0, 3]) {
      expect(provider.shapeText("AV", base, { sourceStart }))
        .toEqual(shapeOt1Text("AV", base, { sourceStart }));
    }
    expect(Object.isFrozen(metric)).toBe(false);
  });

  it("evicts old runs and bypasses oversized inputs", () => {
    const provider = new ComputerModernTexMetricProvider();
    const font = provider.resolveFont();
    provider.shapeText("eviction probe", font);
    const first = provider.shapeText("eviction probe", font);
    for (let index = 0; index < 2049; index++) {
      provider.shapeText(`fill ${index}`, font);
      provider.shapeText(`fill ${index}`, font);
    }
    const repeated = provider.shapeText("eviction probe", font);
    expect(repeated).toEqual(first);
    expect(repeated.items).not.toBe(first.items);
    const text = "a".repeat(257);
    expect(provider.shapeText(text, font).items).not.toBe(provider.shapeText(text, font).items);
  });
});
