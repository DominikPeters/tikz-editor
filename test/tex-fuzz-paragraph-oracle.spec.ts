import { describe, expect, it } from "vitest";
import {
  compareTexFuzzParagraphGeometry,
  runBatchedTexParagraphOracle,
} from "../scripts/lib/tex-fuzz-paragraph-oracle.mjs";
import { commandExists } from "../scripts/lib/tex-fuzz-oracle.mjs";
import {
  generateTexFuzzCase,
  projectTexFuzzCaseToParagraph,
  texFuzzParagraphOracleWidth,
} from "@tikz-editor/tex-fuzz";
import { layoutSimpleTexParagraph } from "@tikz-editor/core/text/tex/index.js";

describe("generated TeX paragraph oracle", () => {
  it("detects finite glue corruption and silent line content loss", () => {
    const tex = {
      id: "case",
      supported: true,
      lines: [{
        index: 0,
        widthSp: 10_485_760,
        glueSet: 1,
        glueSign: 1,
        text: "Alpha Beta",
        interwordWidthsSp: [218_235],
      }],
    };
    const correct = { lines: [{ segments: [
      { kind: "text", text: "Alpha", width: 20 },
      { kind: "space", text: " ", width: 218_235 / 65_536 },
      { kind: "text", text: "Beta", width: 20 },
    ] }] };
    expect(compareTexFuzzParagraphGeometry(correct, tex).matches).toBe(true);
    const halvedGlue = { lines: [{ segments: correct.lines[0].segments.map((segment) =>
      segment.kind === "space" ? { ...segment, width: segment.width / 2 } : segment
    ) }] };
    expect(compareTexFuzzParagraphGeometry(halvedGlue, tex)).toMatchObject({
      matches: false,
      code: "paragraph-space-width",
    });
    const dropped = { lines: [{ segments: correct.lines[0].segments.slice(0, -1) }] };
    expect(compareTexFuzzParagraphGeometry(dropped, tex)).toMatchObject({
      matches: false,
      code: "paragraph-line-text",
    });
  });

  it.runIf(process.env.TEX_FUZZ_ORACLE_TESTS === "1" && commandExists("lualatex"))(
    "batches isolated generated paragraphs in one LuaLaTeX process",
    () => {
      const result = runBatchedTexParagraphOracle([
        { id: "a", source: String.raw`Alpha Beta Gamma Delta \\ Epsilon Zeta Eta Theta`, width: 160 },
        { id: "b", source: String.raw`One Two Three Four \\ Five Six Seven Eight`, width: 160 },
      ]);
      expect(result.stats.compilations).toBe(1);
      expect(result.observations.every((item) => item?.supported)).toBe(true);
    },
    30_000
  );

  it.runIf(process.env.TEX_FUZZ_ORACLE_TESTS === "1" && commandExists("lualatex"))(
    "compares generated projections with justified glue enabled",
    () => {
      const cases = Array.from({ length: 6 }, (_, index) =>
        projectTexFuzzCaseToParagraph(generateTexFuzzCase(20260711 + index, { profile: "aggressive" }))
      );
      const oracle = runBatchedTexParagraphOracle(cases.map((caseData, index) => ({
        id: `generated-${index}`,
        source: caseData.source,
        width: texFuzzParagraphOracleWidth(caseData),
      })));
      expect(oracle.stats.compilations).toBe(1);
      cases.forEach((caseData, index) => {
        const report = layoutSimpleTexParagraph(caseData.source, {
          width: texFuzzParagraphOracleWidth(caseData),
          alignment: "justified",
          hyphenator: { hyphenate: () => [] },
        }).report;
        expect(report).not.toBeNull();
        expect(report?.lines.some((line) => Math.abs(line.glueSetRatio) > 1e-9)).toBe(true);
        expect(compareTexFuzzParagraphGeometry(report!, oracle.observations[index]!)).toMatchObject({ matches: true });
      });
    },
    30_000
  );
});
