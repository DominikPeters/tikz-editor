import { describe, expect, it } from "vitest";
import { createBeamerTexTextFontProfile } from "../packages/core/src/beamer/theme/font.js";
import { computerModernTexMetricProvider, layoutSimpleTexParagraph, texLength } from "../packages/core/src/text/tex/index.js";

const textFontProfile = createBeamerTexTextFontProfile({ family: "sans", series: "medium", shape: "upright", sizePt: 10.95, lineHeightPt: 13.6 });
const font = textFontProfile.resolveTextFont(textFontProfile.defaultFontState, texLength(10.95), computerModernTexMetricProvider);
const layout = (source: string) => layoutSimpleTexParagraph(source, { width: texLength(300), font, textFontProfile });

describe("Beamer's scoped emphasis", () => {
  it("matches a scoped itshape without LaTeX's implicit italic correction", () => {
    const emphasized = layout(String.raw`Ordinary \emph{emphasis} and text.`);
    const declared = layout(String.raw`Ordinary {\itshape emphasis} and text.`);
    expect(emphasized.supported).toBe(true);
    expect(emphasized.report!.lines[0].naturalWidth).toBeCloseTo(declared.report!.lines[0].naturalWidth, 6);
    expect(emphasized.report!.lines[0].segments.map(segment => ({ text: segment.text, x: segment.x, fontId: segment.fontId }))).toEqual(declared.report!.lines[0].segments.map(segment => ({ text: segment.text, x: segment.x, fontId: segment.fontId })));
  });

  it("keeps nested emphasis italic and preserves the Beamer command across font resets", () => {
    for (const reset of ["", String.raw`\normalfont `, String.raw`\sf `, String.raw`\textnormal{}`]) {
      const result = layout(reset + String.raw`\emph{Alpha \emph{Beta} Gamma} Tail`);
      expect(result.supported).toBe(true);
      const segments = result.report!.lines[0].segments.filter(segment => segment.kind === "text");
      expect(segments.filter(segment => segment.text !== "Tail").every(segment => segment.fontId?.includes("oblique") || segment.fontId?.includes("italic"))).toBe(true);
      expect(segments.at(-1)!.fontId).not.toMatch(/italic|oblique/u);
    }
    const generic = layoutSimpleTexParagraph(String.raw`\emph{Alpha \emph{Beta} Gamma}`, { width: texLength(300) });
    const beta = generic.report!.lines[0].segments.find(segment => segment.text === "Beta")!;
    expect(beta.fontId).toBe("lmroman10-regular");
  });
});
