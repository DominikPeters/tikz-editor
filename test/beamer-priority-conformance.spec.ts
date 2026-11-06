import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareBeamerDocument, scanBeamerDocument } from "../packages/core/src/beamer/index.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace, type BeamerStructuralComparison } from "../scripts/lib/beamer-frame-compare.mjs";
import { priorityManifestFailures, priorityFidelityFailures, priorityOracleFailures, unsupportedCodeFailures, type PriorityFixture } from "../scripts/lib/beamer-priority-contracts.mjs";
import { compareColorPixels, paintContractFailures } from "../scripts/lib/beamer-paint-compare.mjs";

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
  it("rejects case-only identities and filenames while allowing shared source frames", () => {
    expect(priorityManifestFailures([{ id: "top", file: "columns.tex" }, { id: "bottom", file: "columns.tex" }])).toEqual([]);
    expect(priorityManifestFailures([{ id: "t", file: "top.tex" }, { id: "T", file: "capital-t.tex" }])).toContainEqual(expect.stringContaining("ID collision"));
    expect(priorityManifestFailures([{ id: "top", file: "case-t.tex" }, { id: "capital-t", file: "case-T.tex" }])).toContainEqual(expect.stringContaining("filename collision"));
  });

  it("keeps fixture frames complete and code recognition separate from fidelity", () => {
    const flow = scanBeamerDocument(readFileSync(new URL("flow.tex", root), "utf8"));
    const code = scanBeamerDocument(codeSource);
    expect(flow.frames).toHaveLength(manifest.fidelity.length);
    expect(code.frames).toHaveLength(manifest.recognition.length);
    expect([...flow.frames, ...code.frames].every(frame => frame.endSpan)).toBe(true);
    expect(new Set([...manifest.fidelity, ...manifest.recognition].map(f => f.id)).size).toBe(26);
    expect(manifest.fidelity.every(f => f.file === "flow.tex")).toBe(true);
    expect(new Set(manifest.recognition.map(f => f.environment))).toEqual(new Set(["verbatim", "lstlisting"]));
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

  it("rejects incorrect block fills independently of matching glyph geometry", () => {
    const paint = { tolerance: 2, samples: [{ id: "example:block-body", maxChannelDelta: 31 }] };
    expect(priorityFidelityFailures({ ...comparison(), paint }, { pages: 1 })).toContainEqual(expect.stringContaining("Block paint example:block-body"));
    expect(paintContractFailures({ ...paint, samples: [{ id: "body", maxChannelDelta: NaN }] })).toHaveLength(1);
    expect(paintContractFailures({ ...paint, samples: [{ id: "body", maxChannelDelta: 2 }] })).toEqual([]);
  });

  it("requires requested canvas paint measurements even in structural-only comparisons", () => {
    const fixture = { pages: 1, paintProbes: [{ id: "canvas", x: 2, y: 100 }] };
    expect(priorityFidelityFailures(comparison(), fixture)).toContain("Required paint probe canvas was not measured (use raster comparison).");
    expect(priorityFidelityFailures({ ...comparison(), paint: { tolerance: 2, samples: [] } }, fixture)).toHaveLength(1);
    expect(priorityFidelityFailures({ ...comparison(), paint: { tolerance: 2, samples: [{ id: "canvas", maxChannelDelta: 0 }] } }, fixture)).toEqual([]);
    expect(priorityFidelityFailures({ ...comparison(), paint: { tolerance: 2, samples: [{ id: "canvas", maxChannelDelta: 26 }] } }, fixture)).toContainEqual(expect.stringContaining("RGB delta 26"));
  });

  it("compares colored footprints spatially, including black and white", () => {
    const native = new Uint8Array([255, 0, 255, 0, 0, 0, 255, 255, 255]);
    const shifted = new Uint8Array([0, 0, 0, 255, 0, 255, 255, 255, 255]);
    expect(compareColorPixels(native, native, "#ff00ff").relativeDifference).toBe(0);
    expect(compareColorPixels(native, shifted, "#ff00ff").disagreement).toBe(2);
    expect(compareColorPixels(native, native, "#000000").nativePixels).toBe(1);
    expect(compareColorPixels(native, native, "#ffffff").nativePixels).toBe(1);
  });

  it("allows shared raster edges but rejects interior holes and larger shifts", () => {
    const image = (shift = 0) => {
      const pixels = new Uint8Array(11 * 11 * 3).fill(255);
      for (let y = 2; y <= 8; y++) for (let x = 2 + shift; x <= 8 + shift; x++) pixels[(y * 11 + x) * 3 + 1] = 0;
      return pixels;
    };
    const oracle = image();
    expect(compareColorPixels(image(1), oracle, "#ff00ff", 11).interiorDisagreement).toBe(0);
    expect(compareColorPixels(image(2), oracle, "#ff00ff", 11).interiorDisagreement).toBeGreaterThan(0);
    const hole = image();
    hole[(5 * 11 + 5) * 3 + 1] = 255;
    expect(compareColorPixels(hole, oracle, "#ff00ff", 11).interiorDisagreement).toBe(1);
    expect(compareColorPixels(new Uint8Array(oracle.length).fill(255), oracle, "#ff00ff", 11).interiorDisagreement).toBeGreaterThan(0);
  });

  it("requires independent paint witnesses and rejects missing or shifted paths even with perfect glyphs", () => {
    const fixture = { pages: 1, paintColors: [{ color: "#ff00ff", visible: [true] }] };
    const mask = { color: "#ff00ff", nativePixels: 100, oraclePixels: 100, relativeDifference: 0 };
    expect(priorityFidelityFailures({ ...comparison(), colorMasks: [mask] }, fixture)).toEqual([]);
    expect(priorityFidelityFailures(comparison(), fixture)).toContainEqual(expect.stringContaining("raster comparison is required"));
    expect(priorityFidelityFailures({ ...comparison(), colorMasks: [{ ...mask, nativePixels: 0, oraclePixels: 0 }] }, fixture)).toContainEqual(expect.stringContaining("Oracle is missing"));
    expect(priorityFidelityFailures({ ...comparison(), colorMasks: [{ ...mask, relativeDifference: 1 }] }, fixture)).toContainEqual(expect.stringContaining("Paint mask"));
    expect(priorityFidelityFailures({ ...comparison(), colorMasks: [{ ...mask, relativeDifference: NaN }] }, fixture)).toContainEqual(expect.stringContaining("Paint mask"));
    expect(priorityFidelityFailures({ ...comparison(), colorMasks: [mask] }, { ...fixture, paintColors: [{ color: "#ff00ff", visible: [false] }] })).toContainEqual(expect.stringContaining("unexpectedly paints"));
  });

  it("withholds glyph comparisons when states or continuation pages have no correspondence", () => {
    const report = { input: { overlayStepCount: 1 }, oracle: { page: { pageCount: 3 } }, structural: null };
    expect(priorityFidelityFailures(report, { pages: 3 })).toEqual([
      "native pages/states=1, fixture expects 3",
      "No valid page correspondence; exact glyph comparison withheld.",
    ]);
    expect(priorityOracleFailures({ pdf: { pageCount: 3 }, pageTrace: { pages: [tracedPage("Alpha"), tracedPage("Gamma"), tracedPage("Beta")] } }, { pages: 3, oracleTextByPage: [["Alpha"], ["Beta"], ["Gamma"]] })).toHaveLength(2);
  });

  it("gates continuation page count separately from overlay step count", () => {
    const report = { input: { overlayStepCount: 1, pageCount: 3 }, oracle: { page: { pageCount: 3 } }, structural: { summary: perfectSummary() } };
    expect(priorityFidelityFailures(report, { pages: 3 })).toEqual([]);
    expect(priorityFidelityFailures({ ...report, input: { overlayStepCount: 3, pageCount: 2 } }, { pages: 3 })).toContain("native pages/states=2, fixture expects 3");
  });

  it.each(manifest.recognition)("recognizes $id with a bounded complete source card and supported siblings", async fixture => {
    const render = await prepareBeamerDocument(codeSource).renderFrame({ frameIndex: fixture.frame - 1, step: 1 });
    const from = codeSource.indexOf(`\\begin{${fixture.environment}}`, render.frame.bodySpan.from);
    const end = `\\end{${fixture.environment}}`;
    const span = { from, to: codeSource.indexOf(end, from) + end.length };
    const trace = buildNativeBeamerPageTrace(render, computerModernTexMetricProvider);
    expect(unsupportedCodeFailures({ source: codeSource, span, render, trace, requiredText: fixture.requiredText })).toEqual([]);
  });

  it("places the display-only matrix block and surrounding prose on the TeX baselines", async () => {
    const source = readFileSync(new URL("flow.tex", root), "utf8");
    const render = await prepareBeamerDocument(source).renderFrame({ frameIndex: 3, step: 1 });
    const trace = buildNativeBeamerPageTrace(render, computerModernTexMetricProvider);
    // LuaLaTeX shipout positions from the strict block-aligned-matrix case.
    // The comparator regenerates this oracle and checks every glyph and font.
    for (const [text, baseline] of [
      ["Beforetheblock.", 85.397415], ["Encoding", 104.860870],
      ["Alpha=", 138.420883], ["Beta=", 156.038406],
      ["Aftertheblock.", 181.233444],
    ] as const) {
      const line = trace.lines.find(candidate => candidate.text === text);
      expect(line, text).toBeDefined();
      expect(Math.abs(line!.baselineY - baseline), text).toBeLessThan(.01);
    }
    expect(trace.lines.find(line => line.text === "Alpha=")!.glyphs[0].fontName).toBe("lmroman10-regular");
    expect(render.diagnostics).toEqual([]);
    expect(render.layout.items.some(item => item.kind === "unsupported")).toBe(false);
  });

  it("matches the nested block/list flow, including the paragraph after the block", async () => {
    const source = readFileSync(new URL("flow.tex", root), "utf8");
    const render = await prepareBeamerDocument(source).renderFrame({ frameIndex: 1, step: 1 });
    const trace = buildNativeBeamerPageTrace(render, computerModernTexMetricProvider);
    for (const [text, baseline] of [
      ["Beforetheblock.", 90.687302], ["Othercolumn.", 90.807755],
      ["Result", 110.150757], ["Alpha", 125.750061],
      ["Beta", 139.750061], ["Gamma", 156.350067],
      ["Aftertheblock.", 177.585526],
    ] as const) {
      const line = trace.lines.find(candidate => candidate.text === text)!;
      expect(line, text).toBeDefined();
      expect(Math.abs(line.baselineY - baseline), text).toBeLessThan(.01);
    }
    expect(trace.lines.find(line => line.text === "Beta")!.glyphs.every(g => g.fontSize === 10)).toBe(true);
    expect(render.diagnostics).toEqual([]);
  });

  it("applies all three stock list body fonts and restores the outer size on exit", async () => {
    const source = String.raw`\documentclass{beamer}\begin{document}\begin{frame}[t]
\begin{itemize}\item Alpha
\begin{enumerate}\item Beta
\begin{itemize}\item Delta\end{itemize}
\item Epsilon\end{enumerate}
\item Gamma\end{itemize}
\end{frame}\end{document}`;
    const render = await prepareBeamerDocument(source).renderFrame({ frameIndex: 0, step: 1 });
    const trace = buildNativeBeamerPageTrace(render, computerModernTexMetricProvider);
    for (const [text, size] of [["Alpha", 10.95], ["Beta", 10], ["Delta", 9], ["Epsilon", 10], ["Gamma", 10.95]] as const) {
      const line = trace.lines.find(candidate => candidate.text.endsWith(text))!;
      expect(line, text).toBeDefined();
      expect(line.glyphs.slice(-text.length).every(g => g.fontSize === size), text).toBe(true);
    }
    expect(render.diagnostics).toEqual([]);
  });

  it.each([
    { frame: 5, x: 194.522522, baseline: 134.946899 },
    { frame: 19, x: 63.929550, baseline: 120.596008 },
  ])("places cases in fixture frame $frame at the TeX position", async fixture => {
    const source = readFileSync(new URL("flow.tex", root), "utf8");
    const render = await prepareBeamerDocument(source).renderFrame({ frameIndex: fixture.frame - 1, step: 1 });
    const trace = buildNativeBeamerPageTrace(render, computerModernTexMetricProvider);
    const line = trace.lines.find(candidate => candidate.text === "f(x)=")!;
    expect(line).toBeDefined();
    expect(Math.abs(line.x - fixture.x)).toBeLessThan(.02);
    expect(Math.abs(line.baselineY - fixture.baseline)).toBeLessThan(.01);
    expect(render.diagnostics).toEqual([]);
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
