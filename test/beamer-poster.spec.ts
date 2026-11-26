import { describe, expect, it } from "vitest";

import { renderBeamerFrame, resolveBeamerPageGeometry, scanBeamerDocument } from "../packages/core/src/beamer/index.js";
import { beamerPosterFontSizes, beamerPosterMacroBindings, beamerPosterRound2, beamerPosterUnsupportedLoad, scanBeamerPoster } from "../packages/core/src/beamer/poster.js";
import { texDecimalTimesDimensionPt, texScannedDimensionPt } from "../packages/core/src/text/tex/dimensions.js";
import { resolveBeamerTheme } from "../packages/core/src/beamer/theme/resolve.js";
import { beamerDisplayMathProfile, beamerListSizeOverrides, beamerNamedFontSize } from "../packages/core/src/beamer/theme/font-sizes.js";

const poster = (options: string, preamble = "", body = "Text") => String.raw`\documentclass{beamer}
\usepackage[${options}]{beamerposter}
${preamble}
\begin{document}
\begin{frame}
${body}
\end{frame}
\end{document}`;

const settings = (options: string, preamble = "") => scanBeamerPoster(scanBeamerDocument(poster(options, preamble)));

// Expected values are from pdfLaTeX probes against TeX Live 2026's
// beamerposter 1.13 (\the\paperwidth, \the\textwidth, \f@size, \leftmargini).
describe("beamerposter package options", () => {
  it("defaults to A0 landscape when no orientation is given", () => {
    const result = settings("");
    expect(result?.size).toBe("a0");
    expect(result?.portrait).toBe(false);
    expect(result?.fontScale).toBe(1);
    expect(result?.paper.widthPt).toBeCloseTo(3383.0325, 3);
    expect(result?.paper.heightPt).toBeCloseTo(2392.87694, 3);
  });

  it("treats a bare orientation as portrait and ignores an invalid one", () => {
    expect(settings("orientation")?.portrait).toBe(true);
    const misspelled = settings("orientation=lanscape");
    expect(misspelled?.portrait).toBe(false);
    expect(misspelled?.diagnostics.map(d => d.code)).toContain("beamerposter-orientation-ignored");
  });

  it("swaps paper for portrait but applies custom sizes after the swap", () => {
    const a1 = settings("size=a1,orientation=portrait,scale=1.4");
    expect(a1?.paper.widthPt).toBeCloseTo(1690.09352, 3);
    expect(a1?.paper.heightPt).toBeCloseTo(2392.87694, 3);
    const custom = settings("size=custom,width=100,height=50,orientation=portrait");
    expect(custom?.paper.widthPt).toBeCloseTo(2845.27559, 3);
    expect(custom?.paper.heightPt).toBeCloseTo(1422.63779, 3);
  });

  it("ignores width and height without size=custom", () => {
    expect(settings("width=100,height=50")?.paper.widthPt).toBeCloseTo(3383.0325, 3);
  });

  it("rounds the font scale and each size to two decimals, as fp does", () => {
    expect(settings("size=a1")?.fontScale).toBe(0.71);
    expect(settings("size=a1,scale=1.4")?.fontScale).toBe(0.99);
    expect(settings("size=a3,scale=1.4")?.fontScale).toBe(0.49);
    expect(beamerPosterRound2("0.35355339", "1.4")).toBe(0.49);
    const a3 = new Map(beamerPosterFontSizes(0.49).map(([name, size, skip]) => [name, [size, skip]]));
    expect(a3.get("tiny")).toEqual([5.88, 6.86]);
    expect(a3.get("normalsize")).toEqual([12.19, 14.7]);
    expect(a3.get("large")).toEqual([14.63, 18.13]);
    expect(a3.get("VERYHuge")).toEqual([52.43, 65.66]);
    const a1 = new Map(beamerPosterFontSizes(0.99).map(([name, size, skip]) => [name, [size, skip]]));
    expect(a1.get("tiny")).toEqual([11.88, 13.86]);
    expect(a1.get("Huge")).toEqual([61.3, 76.23]);
  });

  it("only reads literal top-level loads, and reports the others", () => {
    const source = String.raw`\documentclass{beamer}
\newcommand{\PosterSize}{\usepackage[size=a1]{beamerposter}}
\begin{document}\begin{frame}A\end{frame}\end{document}`;
    const document = scanBeamerDocument(source);
    expect(scanBeamerPoster(document)).toBeNull();
    expect(beamerPosterUnsupportedLoad(document)?.code).toBe("beamerposter-indirect-load");
  });
});

describe("TeX dimension arithmetic", () => {
  it("scans decimal dimensions to scaled points", () => {
    // \the\paperwidth after \setlength{\paperwidth}{84.1cm}: 2392.87694pt.
    expect(texScannedDimensionPt("84.1", "cm")).toBeCloseTo(2392.876938, 6);
    expect(texScannedDimensionPt("48", "in")).toBeCloseTo(3468.95999, 5);
    expect(texScannedDimensionPt("-1.5", "pt")).toBe(-1.5);
  });

  it("rounds a decimal factor on a register to 2^-16", () => {
    expect(texDecimalTimesDimensionPt(".333333", 2392.876938)).toBeCloseTo(797.6136, 3);
    expect(texDecimalTimesDimensionPt("2", 10)).toBe(20);
  });
});

describe("beamerposter page geometry", () => {
  it("takes the page from the package and keeps Beamer's text margins", () => {
    const geometry = resolveBeamerPageGeometry(scanBeamerDocument(poster("")));
    expect(geometry.page.width).toBeCloseTo(3383.0325, 3);
    expect(geometry.textArea.width).toBeCloseTo(3326.12701, 3);
  });

  it("keeps the package's text width when the paper is reassigned later", () => {
    const geometry = resolveBeamerPageGeometry(scanBeamerDocument(poster("size=a0,scale=1.25",
      String.raw`\setlength{\paperwidth}{48in}
\setlength{\paperheight}{36in}`)));
    expect(geometry.page.width).toBeCloseTo(3468.95999, 3);
    expect(geometry.page.height).toBeCloseTo(2601.71999, 3);
    expect(geometry.textArea.width).toBeCloseTo(3326.12701, 3);
  });

  it("computes the text width of a custom size", () => {
    const geometry = resolveBeamerPageGeometry(scanBeamerDocument(poster("size=custom,width=100,height=50")));
    expect(geometry.textArea.width).toBeCloseTo(2788.3701, 3);
  });
});

describe("beamerposter fonts and lists", () => {
  it("selects poster sizes for the theme's text", () => {
    const theme = resolveBeamerTheme(scanBeamerDocument(poster("size=a1,scale=1.4")));
    expect(theme.fonts["normal-text"].sizePt).toBe(24.63);
    expect(theme.fonts["normal-text"].lineHeightPt).toBe(29.7);
  });

  it("leaves display and list registers at the class values", () => {
    const theme = resolveBeamerTheme(scanBeamerDocument(poster("")));
    const display = beamerDisplayMathProfile(theme);
    expect(display.above.normal.sizePt).toBe(11);
    expect(display.sizeOverrides?.small?.above.normal.sizePt).toBe(11);
    expect(beamerListSizeOverrides(theme)).toEqual([]);
  });

  it("assigns list indents in em of the class font", () => {
    const theme = resolveBeamerTheme(scanBeamerDocument(poster("size=a1,orientation=portrait,scale=1.4")));
    expect(theme.dimensions.listLeftMarginEmByDepth).toEqual([3.96, 2.18, 1.85]);
    expect(theme.dimensions.listLabelSepEm).toBe(0.99);
    // \leftmargini = 43.36217pt from an 11pt class.
    expect(3.96 * beamerNamedFontSize("11", "normalsize").sizePt).toBeCloseTo(43.362, 2);
  });

  it("defines the extra sizes and redefines \\normalfont as \\normalsize", () => {
    const bindings = beamerPosterMacroBindings(settings(""));
    expect(bindings.get("\\veryHuge")).toMatchObject({ kind: "text", value: "\\fontsize{74.3}{93}\\selectfont " });
    expect(bindings.get("\\normalfont")).toMatchObject({ kind: "text", value: "\\normalsize " });
  });

  it("evaluates em in theme margins in the class font", () => {
    // beamerouterthemeinfolines.sty: text margin left=1em, at theme load.
    const geometry = resolveBeamerPageGeometry(scanBeamerDocument(poster("size=a0", String.raw`\usetheme{Madrid}`)));
    expect(geometry.textArea.x).toBeCloseTo(10.95, 5);
  });

  it("leaves decks unchanged", () => {
    const theme = resolveBeamerTheme(scanBeamerDocument(String.raw`\documentclass{beamer}
\begin{document}\begin{frame}A\end{frame}\end{document}`));
    expect(theme.fonts["normal-text"].sizePt).toBe(10.95);
    expect(theme.options["poster-font-scale"]).toBeUndefined();
    expect(theme.dimensions.listLabelSepEm).toBeUndefined();
  });
});

describe("beamerposter rendering", () => {
  const runs = async (body: string) => {
    const result = await renderBeamerFrame(poster("", "", body), { frameIndex: 0 });
    const paragraph = result.layout.paragraphs.find(candidate => candidate.role === "body");
    return (paragraph?.report.lines ?? []).flatMap(line => line.segments.filter(segment => segment.text));
  };

  it("sets body text in the poster's normal size", async () => {
    expect((await runs("Text"))[0]).toMatchObject({ text: "Text", fontAtPt: 24.88 });
  });

  it("sizes \\veryHuge text from the poster table", async () => {
    const segments = await runs(String.raw`A {\veryHuge Text}`);
    expect(segments.find(segment => segment.text?.includes("Text"))?.fontAtPt).toBeCloseTo(74.3, 5);
  });

  it("selects named sizes inside command arguments", async () => {
    const segments = await runs(String.raw`A \textbf{bold {\small small}}`);
    expect(segments.find(segment => segment.text?.includes("small"))?.fontAtPt).toBe(20.74);
  });

  it("keeps bold through \\normalfont, as beamerposter's redefinition does", async () => {
    const [normalized] = await runs(String.raw`\bfseries\normalfont Text`);
    const [bold] = await runs(String.raw`\bfseries Text`);
    expect(normalized?.fontId).toBe(bold?.fontId);
  });
});
