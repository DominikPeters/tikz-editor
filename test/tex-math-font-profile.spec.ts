import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPUTER_MODERN_MATH_FONTS,
  computerModernTexMetricProvider,
  luaLatexAmsMathFontId,
  luaLatexAmsMathFontProfile,
  luaLatexDefaultMathFontId,
  luaLatexDefaultMathFontProfile,
} from "../packages/core/src/text/tex/index.js";

describe("TeX math font profile", () => {
  it("maps default LuaLaTeX math families and styles to TeX font assignments", () => {
    expect(luaLatexDefaultMathFontProfile.manifest).toEqual([
      { family: "operators", text: "cmr10", script: "cmr7", scriptscript: "cmr5" },
      { family: "letters", text: "cmmi10", script: "cmmi7", scriptscript: "cmmi5" },
      { family: "symbols", text: "cmsy10", script: "cmsy7", scriptscript: "cmsy5" },
      { family: "extension", text: "cmex10", script: "cmex10", scriptscript: "cmex10" },
    ]);
    expect(luaLatexDefaultMathFontId("letters", "text")).toBe("cmmi10");
    expect(luaLatexDefaultMathFontId("letters", "script")).toBe("cmmi7");
    expect(luaLatexDefaultMathFontId("letters", "scriptscript")).toBe("cmmi5");
    expect(luaLatexDefaultMathFontId("extension", "scriptscript")).toBe("cmex10");
  });

  it("resolves math fonts through the same metric provider as TeX text fonts", () => {
    const text = luaLatexDefaultMathFontProfile.resolveMathFont({
      family: "letters",
      style: "text",
      baseAtPt: 10,
    });
    const script = luaLatexDefaultMathFontProfile.resolveMathFont({
      family: "letters",
      style: "script",
      baseAtPt: 10,
    });
    const extension = luaLatexDefaultMathFontProfile.resolveMathFont({
      family: "extension",
      style: "scriptscript",
      baseAtPt: 10,
    });
    const scriptExtension = luaLatexDefaultMathFontProfile.resolveMathFont({
      family: "extension",
      style: "script",
      baseAtPt: 10,
    });

    expect(text.id).toBe("cmmi10");
    expect(text.atPt).toBe(10);
    expect(script.id).toBe("cmmi7");
    expect(script.atPt).toBe(7);
    expect(scriptExtension.id).toBe("cmex10");
    expect(scriptExtension.atPt).toBe(10);
    expect(extension.id).toBe("cmex10");
    expect(extension.atPt).toBe(10);
  });

  it("models amsmath cmex font-size selection for extension symbols", () => {
    expect(luaLatexAmsMathFontProfile.manifest).toEqual([
      { family: "operators", text: "cmr10", script: "cmr7", scriptscript: "cmr5" },
      { family: "letters", text: "cmmi10", script: "cmmi7", scriptscript: "cmmi5" },
      { family: "symbols", text: "cmsy10", script: "cmsy7", scriptscript: "cmsy5" },
      { family: "extension", text: "cmex10", script: "cmex7", scriptscript: "cmex7" },
      { family: "amsSymbolsA", text: "msam10", script: "msam7", scriptscript: "msam5" },
      { family: "amsSymbolsB", text: "msbm10", script: "msbm7", scriptscript: "msbm5" },
    ]);
    expect(luaLatexAmsMathFontId("extension", "text")).toBe("cmex10");
    expect(luaLatexAmsMathFontId("extension", "script")).toBe("cmex7");
    expect(luaLatexAmsMathFontId("extension", "scriptscript")).toBe("cmex7");
    expect(luaLatexAmsMathFontId("amsSymbolsA", "script")).toBe("msam7");
    expect(luaLatexAmsMathFontId("amsSymbolsB", "scriptscript")).toBe("msbm5");

    const scriptExtension = luaLatexAmsMathFontProfile.resolveMathFont({
      family: "extension",
      style: "script",
      baseAtPt: 10,
    });
    const scriptscriptExtension = luaLatexAmsMathFontProfile.resolveMathFont({
      family: "extension",
      style: "scriptscript",
      baseAtPt: 10,
    });

    expect(scriptExtension.id).toBe("cmex7");
    expect(scriptExtension.atPt).toBe(7);
    expect(scriptscriptExtension.id).toBe("cmex7");
    expect(scriptscriptExtension.atPt).toBe(5);

    const scriptAmsA = luaLatexAmsMathFontProfile.resolveMathFont({
      family: "amsSymbolsA",
      style: "script",
      baseAtPt: 10,
    });
    const scriptscriptAmsB = luaLatexAmsMathFontProfile.resolveMathFont({
      family: "amsSymbolsB",
      style: "scriptscript",
      baseAtPt: 10,
    });

    expect(scriptAmsA.id).toBe("msam7");
    expect(scriptAmsA.atPt).toBe(7);
    expect(scriptscriptAmsB.id).toBe("msbm5");
    expect(scriptscriptAmsB.atPt).toBe(5);
  });

  it("vendors math font metadata, parameters, and extensible recipes", () => {
    for (const fontId of DEFAULT_COMPUTER_MODERN_MATH_FONTS) {
      const font = computerModernTexMetricProvider.resolveFont({ fontId });
      expect(font.data.source).toMatchObject({ kind: "tfm", name: fontId });
      expect(font.data.checksum).not.toBe("");
      expect(Object.keys(font.data.chars).length).toBeGreaterThan(0);
    }

    expect(luaLatexDefaultMathFontProfile.parameters).toMatchObject({
      axisHeight: 0.25,
      num1: 0.676508,
      denom1: 0.685951,
      sup1: 0.412892,
      sub1: 0.15,
      defaultRuleThickness: 0.039999,
    });

    const cmex = computerModernTexMetricProvider.resolveFont({ fontId: "cmex10" });
    expect(cmex.data.chars["0"]?.nextLarger).toBe(16);
    expect(cmex.data.chars["12"]?.varchar).toEqual({ rep: 12 });
  });
});
