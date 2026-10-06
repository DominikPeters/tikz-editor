import { describe, expect, it } from "vitest";
import {
  createTexDerivedInlineMathBoxProvider,
  layoutSimpleTexParagraph,
  texLength,
  texLineX,
  renderTexParagraphSvgBody,
  computerModernTexMetricProvider,
} from "@tikz-editor/core/text/tex/index.js";
import {
  caseFromTexFuzzAst,
  checkTexFuzzLayoutResultInvariants,
  checkTexFuzzPaintedMathContent,
  checkTexFuzzMetamorphicInvariants,
  generateFullySupportedTexFuzzCases,
  TEX_FUZZ_HARD_INVARIANT_WIDTHS,
} from "@tikz-editor/tex-fuzz";

const noHyphenation = { hyphenate: (): number[] => [] };

function layout(source: string, width = 160) {
  return layoutSimpleTexParagraph(source, {
    width,
    fallbackPolicy: "placeholder",
    hyphenator: noHyphenation,
    mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
  });
}

describe("TeX fuzz renderer hard invariants", () => {
  it("keeps leading comments from changing vertical glue before a display", () => {
    const caseData = caseFromTexFuzzAst([
      { kind: "vertical-glue", command: "medskip" },
      { kind: "display-math", delimiter: "multline", body: { kind: "atom", value: "a" } },
    ], { profile: "document" });
    expect(checkTexFuzzMetamorphicInvariants(caseData).findings).toEqual([]);
  });
  it("retains adjacent inline formulas as separate painted math leaves", () => {
    const caseData = caseFromTexFuzzAst([
      { kind: "math", body: { kind: "atom", value: "x" } },
      { kind: "math", body: { kind: "atom", value: "y" } },
      { kind: "math", body: { kind: "atom", value: "z" } },
    ], { profile: "document" });
    expect(caseData.source).toBe("$x$$y$$z$");
    const result = layout(caseData.source);
    expect(result.supported).toBe(true);
    expect(checkTexFuzzLayoutResultInvariants(caseData, 160, result)).toEqual([]);
    const svg = renderTexParagraphSvgBody(result.report!, { vlistLayout: result.vlistLayout,
      lineHeightPt: texLength(12), metricProvider: computerModernTexMetricProvider });
    expect(checkTexFuzzPaintedMathContent(caseData, 160, svg)).toEqual([]);
  });

  it("keeps empty paragraph measurements around display math and incomplete input", () => {
    const source = String.raw`\newline\begin{equation*}\end{equation*}` + "\\";
    expect(() => layout(source)).not.toThrow();
    const result = layout(source);
    expect(result.report).not.toBeNull();
  });

  it("preserves custom labels across separate adjacent lists and invisible item bodies", () => {
    const caseData = caseFromTexFuzzAst([
      { kind: "environment", name: "enumerate", children: [
        { kind: "item", label: [{ kind: "text", value: "Label" }] }, { kind: "text", value: "Alpha" },
      ] },
      { kind: "environment", name: "enumerate", children: [
        { kind: "item" }, { kind: "color", color: "red", children: [{ kind: "space", nonBreaking: true }] },
        { kind: "item", label: [{ kind: "text", value: "Hidden body" }] },
        { kind: "dimension-box", command: "phantom", children: [{ kind: "text", value: "Invisible" }] },
      ] },
      { kind: "text", value: "After" },
    ], { profile: "document" });
    const result = layout(caseData.source);
    expect(result.supported).toBe(true);
    expect(checkTexFuzzLayoutResultInvariants(caseData, 160, result)).toEqual([]);
    expect(result.report?.lines.flatMap(line => line.segments).filter(segment => segment.text === "After")).toHaveLength(1);
  });
  it("detects prose corruption in supported documents while ignoring automatic list markers", () => {
    const caseData = caseFromTexFuzzAst([
      { kind: "text", value: "Before" }, { kind: "paragraph-break", command: "par" },
      { kind: "environment", name: "itemize", children: [
        { kind: "item" }, { kind: "text", value: "Alpha" },
        { kind: "item", label: [{ kind: "text", value: "Tag" }] }, { kind: "text", value: "Beta" },
      ] }, { kind: "text", value: "After" },
    ], { profile: "document" });
    const original = layout(caseData.source);
    expect(original.supported).toBe(true);
    expect(checkTexFuzzLayoutResultInvariants(caseData, 160, original)).toEqual([]);
    const corrupted = structuredClone(original);
    const segment = corrupted.report!.lines.flatMap((line) => line.segments).find((segment) => segment.text === "Beta")!;
    segment.text = "Wrong";
    expect(checkTexFuzzLayoutResultInvariants(caseData, 160, corrupted).map((finding) => finding.fingerprint.code))
      .toContain("visible-content-mismatch");
  });

  it("detects dropped and duplicated display math leaves in final SVG paint", () => {
    const caseData = caseFromTexFuzzAst([
      { kind: "text", value: "Active set" },
      { kind: "display-math", delimiter: "bracket", body: { kind: "fraction", command: "frac",
        numerator: { kind: "atom", value: "x" }, denominator: { kind: "atom", value: "y" } } },
      { kind: "text", value: "After" },
    ], { profile: "document" });
    const result = layout(caseData.source);
    expect(result.supported).toBe(true);
    const svg = renderTexParagraphSvgBody(result.report!, { vlistLayout: result.vlistLayout,
      lineHeightPt: texLength(12), metricProvider: computerModernTexMetricProvider });
    expect(checkTexFuzzPaintedMathContent(caseData, 160, svg)).toEqual([]);
    const leaf = caseData.sourceMap.find((span) => span.kind === "math.atom")!;
    const glyph = svg.match(new RegExp(`<path\\b[^>]*data-source-start="${leaf.start}"[^>]*>`))![0];
    expect(checkTexFuzzPaintedMathContent(caseData, 160, svg.replace(glyph, "")).map((finding) => finding.fingerprint.code))
      .toContain("math-leaf-paint-loss");
    expect(checkTexFuzzPaintedMathContent(caseData, 160, svg + glyph).map((finding) => finding.fingerprint.code))
      .toContain("math-leaf-paint-duplication");
  });

  it("detects a silently dropped final segment even if the remaining geometry is made self-consistent", () => {
    const caseData = caseFromTexFuzzAst([
      { kind: "text", value: "Alpha" },
      { kind: "space", nonBreaking: false },
      { kind: "text", value: "Omega" },
    ]);
    const result = layout(caseData.source);
    expect(checkTexFuzzLayoutResultInvariants(caseData, 160, result)).toEqual([]);
    expect(result.report?.lines[0]?.segments.length).toBeGreaterThan(1);

    const corrupted = structuredClone(result);
    const line = corrupted.report?.lines[0];
    if (!line) throw new Error("Expected one laid-out line.");
    line.segments.pop();
    const remainingLast = line.segments.at(-1);
    line.xEnd = remainingLast
      ? texLineX(remainingLast.x + remainingLast.width)
      : line.xStart;

    expect(checkTexFuzzLayoutResultInvariants(caseData, 160, corrupted).map(
      (finding) => finding.fingerprint.code
    )).toContain("visible-content-loss");
  });

  it("detects finite but internally inconsistent segment geometry", () => {
    const caseData = caseFromTexFuzzAst([
      { kind: "text", value: "Alpha" },
      { kind: "space", nonBreaking: false },
      { kind: "text", value: "Omega" },
    ]);
    const corrupted = structuredClone(layout(caseData.source));
    const segment = corrupted.report?.lines[0]?.segments[1];
    if (!segment) throw new Error("Expected multiple laid-out segments.");
    segment.width = texLength(segment.width / 2);

    expect(checkTexFuzzLayoutResultInvariants(caseData, 160, corrupted).map(
      (finding) => finding.fingerprint.code
    )).toContain("segment-flow-mismatch");
  });

  it("detects erased text even when geometry and source attribution remain intact", () => {
    const caseData = caseFromTexFuzzAst([{ kind: "text", value: "Visible" }]);
    const corrupted = structuredClone(layout(caseData.source));
    for (const segment of corrupted.report?.lines.flatMap((line) => line.segments) ?? []) {
      if (segment.kind === "text") segment.text = "";
    }

    expect(checkTexFuzzLayoutResultInvariants(caseData, 160, corrupted).map(
      (finding) => finding.fingerprint.code
    )).toContain("visible-content-loss");
  });

  it("detects a nonempty substitution and reports an edit-distance diff", () => {
    const caseData = caseFromTexFuzzAst([{ kind: "text", value: "Omega" }]);
    const corrupted = structuredClone(layout(caseData.source));
    const segment = corrupted.report?.lines[0]?.segments.find((candidate) => candidate.kind === "text");
    if (!segment) throw new Error("Expected a painted text segment.");
    segment.text = "Sigma";

    const finding = checkTexFuzzLayoutResultInvariants(caseData, 160, corrupted).find(
      (candidate) => candidate.fingerprint.code === "visible-content-mismatch"
    );
    expect(finding?.detail).toMatchObject({
      editDistance: 4,
      expectedLength: 5,
      actualLength: 5,
      firstDifference: 0,
      expectedContext: "Omega",
      actualContext: "Sigma",
    });
  });

  it("detects duplicated and reordered painted prose", () => {
    const caseData = caseFromTexFuzzAst([
      { kind: "text", value: "Alpha" },
      { kind: "space", nonBreaking: false },
      { kind: "text", value: "Omega" },
    ]);
    const original = layout(caseData.source);
    const duplicated = structuredClone(original);
    const duplicateLine = duplicated.report?.lines[0];
    const textSegment = duplicateLine?.segments.find((segment) => segment.text === "Alpha");
    if (!duplicateLine || !textSegment) throw new Error("Expected painted prose.");
    duplicateLine.segments.push(structuredClone(textSegment));
    expect(checkTexFuzzLayoutResultInvariants(caseData, 160, duplicated).map(
      (finding) => finding.fingerprint.code
    )).toContain("visible-content-mismatch");

    const reordered = structuredClone(original);
    const reorderLine = reordered.report?.lines[0];
    if (!reorderLine) throw new Error("Expected painted prose.");
    reorderLine.segments.reverse();
    expect(checkTexFuzzLayoutResultInvariants(caseData, 160, reordered).map(
      (finding) => finding.fingerprint.code
    )).toContain("visible-content-mismatch");
  });

  it("normalizes TeX spaces and accents while respecting phantom and smash painting", () => {
    const caseData = caseFromTexFuzzAst([
      { kind: "font", command: "textbf", children: [{ kind: "text", value: "Café" }] },
      { kind: "space", nonBreaking: false },
      { kind: "accent", command: "'", base: "e" },
      { kind: "line-break", command: "newline" },
      { kind: "dimension-box", command: "phantom", children: [{ kind: "text", value: "Hidden" }] },
      { kind: "dimension-box", command: "smash", children: [{ kind: "text", value: "Visible" }] },
    ]);

    expect(layout(caseData.source).supported).toBe(true);
    expect(checkTexFuzzLayoutResultInvariants(caseData, 160, layout(caseData.source)).map(
      (finding) => finding.fingerprint.code
    )).not.toContain("visible-content-mismatch");
  });

  it("does not demand painted content from phantom-family boxes", () => {
    const caseData = caseFromTexFuzzAst([{
      kind: "dimension-box",
      command: "phantom",
      children: [{ kind: "text", value: "Invisible" }],
    }]);
    const corrupted = structuredClone(layout(caseData.source));
    for (const line of corrupted.report?.lines ?? []) {
      line.segments = [];
      line.xEnd = line.xStart;
    }

    expect(checkTexFuzzLayoutResultInvariants(caseData, 160, corrupted).some(
      (finding) => finding.fingerprint.code === "visible-content-loss"
    )).toBe(false);
  });

  it("has no semantic-content false positives across fully supported generated prose", () => {
    const generated = generateFullySupportedTexFuzzCases(20_260_712, { count: 32 });
    for (const caseData of generated.cases) {
      for (const width of TEX_FUZZ_HARD_INVARIANT_WIDTHS) {
        const contentFindings = checkTexFuzzLayoutResultInvariants(caseData, width, layout(caseData.source, width))
          .filter((finding) => finding.fingerprint.code.startsWith("visible-content-"));
        expect(contentFindings, `${caseData.source} at ${width}pt`).toEqual([]);
      }
    }
  }, 30_000);
});
