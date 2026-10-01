import { describe, expect, it } from "vitest";
import { caseFromTexFuzzAst, shrinkTexFuzzCase } from "@tikz-editor/tex-fuzz";
import { texFuzzMathOracleCases, compareTexFuzzMathOracle } from "../scripts/lib/tex-fuzz-math-oracle.mjs";

import { commandExists } from "../scripts/lib/tex-fuzz-oracle.mjs";

const caseData = caseFromTexFuzzAst([{ kind: "math", body: { kind: "fraction", command: "frac",
  numerator: { kind: "atom", value: "x" }, denominator: { kind: "atom", value: "y" } } }]);

describe("shared math glyph differential findings", () => {
  it("selects actual nested syntax rather than replacing generated math with prose", () => {
    const owner = caseFromTexFuzzAst([{ kind: "font", command: "textbf", children: caseData.ast }]);
    const selected = texFuzzMathOracleCases([owner, owner], 8);
    expect(selected).toHaveLength(1);
    expect(selected[0].source).toBe(String.raw`$\frac{x}{y}$`);
    expect(selected[0].sourceMap.some((span) => span.kind === "math.atom")).toBe(true);
  });

  it("turns glyph displacement into a shared, shrinkable diagnostic", async () => {
    const compare = (formula: string) => ({ ok: !formula.includes("frac"),
      mismatches: formula.includes("frac") ? ["glyph 0 x differs: ours=1 tex=2"] : [], ours: { supported: true } });
    const result = compareTexFuzzMathOracle(caseData, { compare });
    expect(result).toMatchObject({ compared: true, observation: { fingerprint: {
      resultClass: "differential", code: "math-glyph-trace", mode: "math",
    } } });
    const shrunk = await shrinkTexFuzzCase(caseData, result.observation!, async (candidates) =>
      candidates.map((candidate) => compareTexFuzzMathOracle(candidate, { compare }).observation)
    );
    expect(shrunk.minimizedCase.source).toContain("frac");
  });

  it("records an incomparable oracle result without claiming a successful comparison", () => {
    const result = compareTexFuzzMathOracle(caseData, { compare: () => ({
      ok: false, mismatches: ["TeX oracle failed: timeout"], ours: { supported: true },
    }) });
    expect(result.compared).toBe(false);
    expect(result.observation?.detail?.comparable).toBe(false);
  });
  it.runIf(process.env.TEX_FUZZ_ORACLE_TESTS === "1" && commandExists("lualatex"))(
    "matches LuaLaTeX paint for short, long, empty, and nested arrow labels", () => {
      const formulas = [
        String.raw`\xrightarrow[a]{a}`, String.raw`\xleftarrow[x]{1}`,
        String.raw`\dot{\xrightarrow[a]{a}}`, String.raw`\xleftarrow[\mathbf{rank}]{1-b}`,
        String.raw`\xrightarrow[xy]{abcdabcd}`, String.raw`\xleftarrow[xy]{abcdabcd}`,
        String.raw`\xrightarrow{}`, String.raw`\xleftarrow[]{}`, String.raw`\xrightarrow[a]{}`,
        String.raw`\scriptstyle\xrightarrow[a]{a}`, String.raw`x_{\xrightarrow[a^2]{a^2}}`,
        String.raw`\frac{1}{\xrightarrow[a^2]{a^2}}`,
      ];
      for (const content of formulas) {
        const candidate = caseFromTexFuzzAst([{ kind: "math", content }]);
        const result = compareTexFuzzMathOracle(candidate);
        expect(result, content).toEqual({ compared: true, observation: null });
      }
    }, 30_000
  );

});
