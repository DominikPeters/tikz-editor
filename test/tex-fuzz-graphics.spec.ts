import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { caseFromTexFuzzAst, checkTexFuzzHardInvariants, checkTexFuzzLayoutResultInvariants, createTexFuzzGraphicsResolver, generateTexFuzzGraphicsNode, generateTexFuzzCase,
  measureTexFuzzCoverage, TexFuzzRandom, TEX_FUZZ_GRAPHICS_PROGRAMS, texFuzzShrinkCandidates } from "@tikz-editor/tex-fuzz";
import { isTexFuzzCase } from "../packages/tex-fuzz/src/validation.js";
import { computerModernTexMetricProvider, layoutSimpleTexParagraph, parseSimpleTexParagraphIr, texLength } from "../packages/core/src/text/tex/index.js";
import { simpleTexInlineNodesToLayoutItems } from "../packages/core/src/text/tex/layout-inline-items.js";
import { commandExists, runBatchedTexSupportOracle } from "../scripts/lib/tex-fuzz-oracle.mjs";
import { stageFuzzGraphicsAssets } from "../scripts/lib/fuzz-graphics-assets.mjs";
import { generateBeamerFuzzCases } from "../scripts/lib/beamer-fuzz-cases.mjs";
import { prepareBeamerDocument } from "../packages/core/src/beamer/index.js";

describe("images in the existing TeX and Beamer grammars", () => {
  it("records and replays every image key program, format, star and corner form", () => {
    const cases = Array.from({ length: 256 }, (_, seed) => caseFromTexFuzzAst([
      generateTexFuzzGraphicsNode(new TexFuzzRandom(seed), "image"),
    ], { seed }));
    for (const value of cases) expect(isTexFuzzCase(JSON.parse(JSON.stringify(value)))).toBe(true);
    const coverage = measureTexFuzzCoverage(cases);
    for (const feature of ["graphics.includegraphics", "graphics.format.png", "graphics.format.jpg", "graphics.format.pdf", "graphics.star", "graphics.corners", "graphics.key.page", "graphics.key.trim", "graphics.key.angle", "graphics.key.totalheight"]) {
      expect(coverage.featureCounts[feature], feature).toBeGreaterThan(0);
    }
    expect(new Set(cases.map(value => value.ast[0].kind === "includegraphics" && value.ast[0].options.join(","))).size).toBeGreaterThan(TEX_FUZZ_GRAPHICS_PROGRAMS.length);
    expect(cases[9]).toEqual(caseFromTexFuzzAst([generateTexFuzzGraphicsNode(new TexFuzzRandom(9), "image")], { seed: 9 }));
    expect(Array.from({ length: 64 }, (_, seed) => generateTexFuzzCase(seed, { profile: "aggressive" })).some(value => value.features.includes("graphics.includegraphics"))).toBe(true);
  });

  it("renders controlled images in nested font/box contexts without placeholder or paint loss", () => {
    for (let seed = 0; seed < 40; seed++) {
      const image = generateTexFuzzGraphicsNode(new TexFuzzRandom(seed), "image");
      const value = caseFromTexFuzzAst([{ kind: "font", command: "textbf", children: [{ kind: "box", command: "fbox", children: [image] }] }], { seed });
      expect(checkTexFuzzHardInvariants(value), value.source).toEqual([]);
    }
  });

  it("rejects unresolved assets and missing final SVG image paint", () => {
    const value = caseFromTexFuzzAst([{ kind: "includegraphics", filename: "fuzz-images/pattern.png", options: [] }]);
    const result = layoutSimpleTexParagraph(value.source, { width: 160, graphicsResolver: createTexFuzzGraphicsResolver() });
    expect(checkTexFuzzLayoutResultInvariants(value, 160, result)).toEqual([]);
    const corrupted = structuredClone(result);
    if (!corrupted.report) throw new Error("Missing image layout report");
    for (const line of corrupted.report.lines) for (const segment of line.segments) {
      if (segment.mathSvgBody) segment.mathSvgBody = "";
    }
    expect(checkTexFuzzLayoutResultInvariants(value, 160, corrupted).map(finding => finding.fingerprint.code)).toContain("image-paint-count");
    const missing = layoutSimpleTexParagraph(value.source, { width: 160, graphicsResolver: { cacheKey: "missing", resolve: () => ({ status: "missing" }) } });
    expect(checkTexFuzzLayoutResultInvariants(value, 160, missing).map(finding => finding.fingerprint.code)).toContain("image-asset-unresolved");
  });

  it("shrinks image keys while retaining the original image file and option order", () => {
    const original = caseFromTexFuzzAst([{ kind: "includegraphics", filename: "fuzz-images/pages.pdf", options: ["page=2", "width=18pt", "angle=90"] }]);
    const candidates = texFuzzShrinkCandidates(original);
    expect(candidates.some(value => value.source.includes("[page=2,angle=90]"))).toBe(true);
    expect(candidates.filter(value => value.features.includes("graphics.includegraphics")).every(value => value.source.includes("{fuzz-images/pages.pdf}"))).toBe(true);
    expect(original.source).toContain("[page=2,width=18pt,angle=90]");
  });

  it("stages the image bytes used by both renderers beside a TeX reproduction", () => {
    const directory = mkdtempSync(join(tmpdir(), "graphics-fuzz-test-"));
    try {
      const manifest = stageFuzzGraphicsAssets(directory);
      expect(manifest.files).toContain("fuzz-images/pages.pdf");
      const resolver = createTexFuzzGraphicsResolver();
      const image = resolver.resolve({ filename: "fuzz-images/pattern.png", options: { raw: "" }, source: "", sourceStart: 0, sourceEnd: 0 });
      expect(image.status).toBe("resolved");
      if (image.status === "resolved") expect(image.dataBase64).toBe(readFileSync(join(directory, "fuzz-images/pattern.png")).toString("base64"));
    } finally { rmSync(directory, { recursive: true }); }
  });

  it("exercises all focused Beamer image families and every overlay state with resolved assets", async () => {
    const cases = generateBeamerFuzzCases({ profile: "images", cases: 8, seed: 20261108 });
    expect(cases).toEqual(generateBeamerFuzzCases({ profile: "images", cases: 8, seed: 20261108 }));
    for (const value of cases) {
      const pages = await prepareBeamerDocument(value.source).renderFramePages({ graphicsResolver: createTexFuzzGraphicsResolver(value.source) });
      expect(pages.stepCount, value.id).toBe(value.fixture.pages);
      for (const [index, page] of pages.pages.entries()) {
        expect(page.diagnostics, value.id).toEqual([]);
        expect((page.svg.svg.match(/<image\b/gu) ?? []).length, `${value.id} state ${index + 1}`).toBe(value.fixture.imagesByPage![index]);
        expect(page.layout.graphics.every(image => image.asset.status === "resolved"), value.id).toBe(true);
      }
    }
    const recursive = generateBeamerFuzzCases({ profile: "intricate", cases: 21, seed: 20261108 });
    expect(recursive.some(value => value.fixture.choices.grammar!.features.image > 0)).toBe(true);
    expect(recursive.some(value => value.fixture.choices.grammar!.features["image-node"] > 0)).toBe(true);
  });

  it.runIf(process.env.TEX_FUZZ_ORACLE_TESTS === "1" && commandExists("lualatex"))("compares real image box dimensions with independent LuaLaTeX", () => {
    const sources = [
      String.raw`\includegraphics{fuzz-images/pattern.png}`,
      String.raw`\includegraphics[width=18pt]{fuzz-images/photo.jpg}`,
      String.raw`\includegraphics[page=2]{fuzz-images/pages.pdf}`,
      String.raw`\includegraphics[trim=2 1 3 2,clip,width=18pt]{fuzz-images/pattern.png}`,
      String.raw`\includegraphics[width=18pt,angle=90]{fuzz-images/pattern.png}`,
      String.raw`\includegraphics[angle=90,width=18pt]{fuzz-images/pattern.png}`,
      String.raw`\includegraphics[origin=c,angle=-90,totalheight=12pt]{fuzz-images/pattern.png}`,
    ];
    const oracle = runBatchedTexSupportOracle(sources.map((source, id) => ({ id: String(id), source })), { batchSize: sources.length });
    expect(oracle.observations.every(value => value.supported)).toBe(true);
    for (const [index, source] of sources.entries()) {
      const block = parseSimpleTexParagraphIr(source).blocks[0];
      const item = simpleTexInlineNodesToLayoutItems(block.nodes, block.sourceStart, block.sourceEnd, texLength(10), computerModernTexMetricProvider,
        "font", undefined, undefined, undefined, createTexFuzzGraphicsResolver()).find(value => value.kind === "text-box");
      if (item?.kind !== "text-box") throw new Error("Missing native image box");
      const reference = oracle.observations[index];
      for (const [actual, expected] of [[item.box.width, reference.widthSp], [item.box.height, reference.heightSp], [item.box.depth, reference.depthSp]]) {
        expect(actual, source).toBeCloseTo(expected! / 65536, 2);
      }
    }
  }, 30_000);
});
