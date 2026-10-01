import { describe, expect, it } from "vitest";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/fonts/computer-modern.js";

describe("rendering-only TeX shaping", () => {
  it.each(["office AV", "e\u0301—é", "x", " "])(
    "keeps glyphs and metrics for %s while omitting unused caret maps",
    (text) => {
      const font = computerModernTexMetricProvider.resolveFont({ fontId: "lmroman10-regular" });
      const options = { sourceStart: 20, sourceEnd: 20 + text.length + 3 };
      const editable = computerModernTexMetricProvider.shapeText(text, font, options);
      const rendered = computerModernTexMetricProvider.shapeText(text, font, {
        ...options,
        includeCaretStops: false,
      });

      expect(editable.caretStops).toHaveLength(text.length + 4);
      expect(rendered.caretStops).toEqual([]);
      expect(rendered.sourceCaretStops).toEqual([]);
      expect({
        ...rendered,
        caretStops: editable.caretStops,
        sourceCaretStops: editable.sourceCaretStops,
      }).toEqual(editable);
    }
  );
});
