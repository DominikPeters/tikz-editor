import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareBeamerDocument, scanBeamerDocument } from "../packages/core/src/beamer/index.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace, type BeamerStructuralComparison } from "../scripts/lib/beamer-frame-compare.mjs";
import { priorityFidelityFailures, priorityOracleFailures, unsupportedCodeFailures, type PriorityFixture } from "../scripts/lib/beamer-priority-contracts.mjs";

const root = new URL("./fixtures/beamer/corpus-priorities/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("cases.json", root), "utf8")) as {
  fidelity: PriorityFixture[];
  recognition: { id: string; file: string; frame: number; environment: string; requiredText: string[] }[];
};
const codeSource = readFileSync(new URL("unsupported-code.tex", root), "utf8");

function perfectSummary(): BeamerStructuralComparison["summary"] {
  return { matchedRectangles: 1, unmatchedNativeRectangles: 0, unmatchedOracleRules: 0, coveredOverlayRules: 0, maxRectangleEdgeDeltaPt: 0, matchedTextLines: 1, unmatchedNativeTextLines: 0, unmatchedOracleTextLines: 0, excludedOracleTextLines: 0, coveredOverlayTextLines: 0, comparedGlyphs: 1, maxAbsoluteGlyphDxPt: 0, maxAbsoluteGlyphDyPt: 0, glyphCodeMatch: true, fontMatch: true };
}
function comparison(summary = perfectSummary()) {
  return { input: { overlayStepCount: 1 }, oracle: { page: { pageCount: 1 } }, structural: { summary } };
}
function tracedPage(text: string) { return { glyphs: [...text].map(char => ({ code: char.codePointAt(0)! })) }; }

describe("Beamer corpus-priority reproduction contracts", () => {
  it("keeps fixture frames complete and code recognition separate from fidelity", () => {
    const flow = scanBeamerDocument(readFileSync(new URL("flow.tex", root), "utf8"));
    const code = scanBeamerDocument(codeSource);
    expect(flow.frames).toHaveLength(manifest.fidelity.length);
    expect(code.frames).toHaveLength(manifest.recognition.length);
    expect([...flow.frames, ...code.frames].every(frame => frame.endSpan)).toBe(true);
    expect(new Set([...manifest.fidelity, ...manifest.recognition].map(f => f.id)).size).toBe(26);
    expect(manifest.fidelity.every(f => f.file === "flow.tex")).toBe(true);
    expect(new Set(manifest.recognition.map(f => f.environment))).toEqual(new Set(["alltt", "lstlisting"]));
  });

  it("retains the exact glyph and rectangle tolerances, including invalid measurements", () => {
    const summary = perfectSummary();
    const fixture = { pages: 1 };
    expect(priorityFidelityFailures(comparison(summary), fixture)).toEqual([]);
    expect(priorityFidelityFailures(comparison({ ...summary, maxAbsoluteGlyphDxPt: .020001 }), fixture)).toContainEqual(expect.stringContaining("maxAbsoluteGlyphDxPt"));
    expect(priorityFidelityFailures(comparison({ ...summary, maxAbsoluteGlyphDyPt: .010001 }), fixture)).toContainEqual(expect.stringContaining("maxAbsoluteGlyphDyPt"));
    expect(priorityFidelityFailures(comparison({ ...summary, maxRectangleEdgeDeltaPt: .010001 }), fixture)).toContainEqual(expect.stringContaining("maxRectangleEdgeDeltaPt"));
    expect(priorityFidelityFailures(comparison({ ...summary, maxAbsoluteGlyphDxPt: NaN }), fixture)).toContainEqual(expect.stringContaining("maxAbsoluteGlyphDxPt"));
    expect(priorityFidelityFailures(comparison({ ...summary, glyphCodeMatch: false }), fixture)).toContain("glyphCodeMatch=false");
    expect(priorityFidelityFailures(comparison({ ...summary, fontMatch: false }), fixture)).toContain("fontMatch=false");
  });

  it("fails missing oracle text and absent images rather than accepting matching chrome", () => {
    expect(priorityFidelityFailures(comparison({ ...perfectSummary(), unmatchedOracleTextLines: 2 }), { pages: 1 })).toContainEqual(expect.stringContaining("unmatchedOracleTextLines=2"));
    expect(priorityFidelityFailures(comparison(), { pages: 1, images: 1 }, 0)).toContain("SVG images=0, expected 1");
    expect(priorityOracleFailures({ pdf: { pageCount: 1 }, pageTrace: { pages: [tracedPage("Title only")] } }, { pages: 1, oracleText: ["Alpha"] })).toContain("oracle is missing witness Alpha");
  });

  it("withholds glyph comparisons when states or continuation pages have no correspondence", () => {
    const report = { input: { overlayStepCount: 1 }, oracle: { page: { pageCount: 3 } }, structural: null };
    expect(priorityFidelityFailures(report, { pages: 3 })).toEqual([
      "native pages/states=1, fixture expects 3",
      "No valid page correspondence; exact glyph comparison withheld.",
    ]);
    expect(priorityOracleFailures({ pdf: { pageCount: 3 }, pageTrace: { pages: [tracedPage("Alpha"), tracedPage("Gamma"), tracedPage("Beta")] } }, { pages: 3, oracleTextByPage: [["Alpha"], ["Beta"], ["Gamma"]] })).toHaveLength(2);
  });

  it.each(manifest.recognition)("recognizes $id with a bounded complete source card and supported siblings", async fixture => {
    const render = await prepareBeamerDocument(codeSource).renderFrame({ frameIndex: fixture.frame - 1, step: 1 });
    const from = codeSource.indexOf(`\\begin{${fixture.environment}}`, render.frame.bodySpan.from);
    const end = `\\end{${fixture.environment}}`;
    const span = { from, to: codeSource.indexOf(end, from) + end.length };
    const trace = buildNativeBeamerPageTrace(render, computerModernTexMetricProvider);
    expect(unsupportedCodeFailures({ source: codeSource, span, render, trace, requiredText: fixture.requiredText })).toEqual([]);
  });

  it("rejects the silent disappearance shape observed for code inside an exampleblock", async () => {
    const render = await prepareBeamerDocument(codeSource).renderFrame({ frameIndex: 0, step: 1 });
    const card = render.layout.items.find(item => item.kind === "unsupported")!;
    const trace = buildNativeBeamerPageTrace(render, computerModernTexMetricProvider);
    const missing = { ...render, diagnostics: [], layout: { ...render.layout, items: render.layout.items.filter(item => item.kind !== "unsupported") }, svg: { ...render.svg, svg: "<svg/>" } };
    const failures = unsupportedCodeFailures({ source: codeSource, span: card.sourceSpan, render: missing, trace: { ...trace, lines: [] }, requiredText: ["BeforeOpaque", "AfterOpaque"] });
    expect(failures).toContain("Missing unsupported-environment diagnostic with the complete source span.");
    expect(failures).toContain("Supported sibling text is missing: BeforeOpaque");
    expect(failures).toContain("Missing visible unsupported source placeholder.");
  });
});
