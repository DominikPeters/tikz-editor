import { describe, expect, it } from "vitest";

import { renderSimpleTexParagraphDebugSvgBody } from "../packages/core/src/text/mathjax-engine.js";
import { createIdentityMappedText } from "../packages/core/src/text/source-map.js";
import {
  computerModernTexMetricProvider,
  createTexDerivedInlineMathBoxProvider,
  layoutSimpleTexParagraph,
  luaLatexDefaultTextFontProfile,
  renderTexParagraphSvgBody,
  texLength,
  type TexParagraphLayoutOptions,
  type TexLength,
  type TexVListLayout,
} from "../packages/core/src/text/tex/index.js";
import type { ParagraphLayoutReport } from "../packages/core/src/text/knuth-plass/paragraph/report.js";

const DEFAULT_FONT_SIZE_PT = texLength(10);

function layoutAndRender(
  source: string,
  options: {
    readonly paragraphId: string;
    readonly sourceOffset?: number;
    readonly fontSizePt?: TexLength;
  }
) {
  const fontSizePt = options.fontSizePt ?? DEFAULT_FONT_SIZE_PT;
  const font = luaLatexDefaultTextFontProfile.resolveTextFont(
    luaLatexDefaultTextFontProfile.defaultFontState,
    fontSizePt,
    computerModernTexMetricProvider
  );
  const mapped = options.sourceOffset == null
    ? null
    : createIdentityMappedText(source, options.sourceOffset);
  const layoutOptions: Omit<TexParagraphLayoutOptions, "sourceMap"> & {
    readonly sourceMap?: undefined;
  } = {
    paragraphId: options.paragraphId,
    width: texLength(180),
    alignment: "ragged-right",
    font,
    metricProvider: computerModernTexMetricProvider,
    textFontProfile: luaLatexDefaultTextFontProfile,
    tikzTextWidthNode: true,
    fallbackPolicy: "placeholder",
    mathBoxProvider: createTexDerivedInlineMathBoxProvider({
      baseAtPt: fontSizePt,
    }),
  };
  const layout = mapped
    ? layoutSimpleTexParagraph(source, {
      ...layoutOptions,
      sourceMap: mapped.sourceMap,
    })
    : layoutSimpleTexParagraph(source, layoutOptions);
  if (!layout.supported || !layout.report || !layout.vlistLayout) {
    throw new Error(layout.fallbackReason ?? "Expected a renderable TeX layout.");
  }
  const report: ParagraphLayoutReport = layout.report;
  const vlistLayout: TexVListLayout = layout.vlistLayout;
  const body = renderTexParagraphSvgBody(report, {
    lineHeightPt: texLength(fontSizePt * 1.2),
    vlistLayout,
    metricProvider: computerModernTexMetricProvider,
    textFontProfile: luaLatexDefaultTextFontProfile,
    baseFontSizePt: fontSizePt,
    alignment: "ragged-right",
  });
  return { body, report, vlistLayout };
}

describe("public TeX SVG renderer", () => {
  it("preserves the existing node-text SVG output", () => {
    const source = String.raw`Alpha \begin{itemize}\item Beta\end{itemize} \[x+y\]`;
    const direct = layoutAndRender(source, {
      paragraphId: "tex:debug-placeholder",
    }).body;
    const existing = renderSimpleTexParagraphDebugSvgBody({
      text: source,
      width: 180,
      alignment: "ragged-right",
    });

    expect(existing).toBe(direct);
  });

  it("renders document-space source metadata from remapped layout reports", () => {
    const source = String.raw`Alpha \[x+y\] Omega`;
    const sourceOffset = 200;
    const { body, report } = layoutAndRender(source, {
      paragraphId: "tex:document-source",
      sourceOffset,
    });
    const displayStart = sourceOffset + source.indexOf(String.raw`\[`);
    const displayEnd = sourceOffset + source.indexOf(String.raw`\]`) + 2;

    expect(report.sourceCoordinateSpace).toBe("document");
    expect(body).toContain('data-paragraph-id="tex:document-source"');
    expect(body).toContain('data-source-start="200" data-source-end="201"');
    expect(body).toContain(
      `data-tex-display-math="true" data-source-start="${displayStart}" data-source-end="${displayEnd}"`
    );
  });

  it("uses an explicit base font size for glyph and math scaling", () => {
    const fontSizePt = texLength(14.4);
    const { body } = layoutAndRender(String.raw`Large \(x\)`, {
      paragraphId: "tex:large",
      fontSizePt,
    });

    expect(body).toContain("scale(1.44)");
    expect(body).toContain("scale(0.0144)");
  });
});
