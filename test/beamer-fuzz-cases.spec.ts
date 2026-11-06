import { describe, expect, it } from "vitest";
import { BEAMER_FUZZ_SMOKE_FAMILIES, BEAMER_FUZZ_FAMILIES, generateBeamerFuzzCases } from "../scripts/lib/beamer-fuzz-cases.mjs";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";

describe("seeded Beamer interaction cases", () => {
  it("covers every family, replays exactly and varies its choices",()=>{
    const cases=generateBeamerFuzzCases({seed:123,cases:38});
    expect(cases).toEqual(generateBeamerFuzzCases({seed:123,cases:38}));
    expect(cases).not.toEqual(generateBeamerFuzzCases({seed:124,cases:38}));
    expect(new Set(cases.map(c=>c.fixture.family))).toEqual(new Set(BEAMER_FUZZ_FAMILIES));
    expect(new Set(cases.map(c=>c.fixture.choices.alignment)).size).toBe(3);
    expect(new Set(cases.map(c=>c.id)).size).toBe(cases.length);
  });
  it("crosses independent dimensions and produces mostly distinct active source programs", () => {
    const cases = generateBeamerFuzzCases({ seed: 20261110, cases: 1024 });
    expect(new Set(cases.map(c => c.source)).size).toBeGreaterThan(950);
    const choices = cases.map(c => c.fixture.choices);
    for (const [key, minimum] of [["fontSize", 8], ["aspectRatio", 2], ["theme", 3], ["columnMode", 4], ["columnWidth", 5], ["shape", 4], ["transform", 5], ["label", 4], ["blockKind", 3]] as const) {
      expect(new Set(choices.map(choice => choice[key])).size).toBe(minimum);
    }
    for (const c of cases) {
      expect(c.fixture.pages).toBeGreaterThanOrEqual(1);
      for (const mask of c.fixture.paintColors ?? []) expect(mask.visible).toHaveLength(c.fixture.pages);
      if (c.fixture.family === "scoped-alignment") expect(c.source).toContain(String.raw`\begin{frame}\relax{`);
      if (c.fixture.pages > 1) expect(c.source).toContain(`\\only<${c.fixture.pages}>{}`);
      if (!["date", "default-date"].includes(c.fixture.family)) expect(c.source).toContain(String.raw`\year=2026\month=11\day=5`);
    }
    const ending = cases.filter(c => c.fixture.family === "overlay-union");
    expect(ending.every(c => c.fixture.paintColors?.[0].visible.at(-1) === false)).toBe(true);
    expect(new Set(generateBeamerFuzzCases({ seed: 123, cases: 38, profile: "smoke" }).map(c => c.fixture.family))).toEqual(new Set(BEAMER_FUZZ_SMOKE_FAMILIES));
  });

  it("rejects runs too small to exercise the mandatory families",()=>{
    expect(()=>generateBeamerFuzzCases({cases:1})).toThrow();
    expect(()=>generateBeamerFuzzCases({seed:NaN})).toThrow();
  });
  for(const c of generateBeamerFuzzCases({seed:20261105,cases:38,profile:"smoke"})) {
    it(c.id,async()=>{
      const prepared=prepareBeamerDocument(c.source);
      expect(prepared.document.diagnostics).toEqual([]);
      expect(prepared.frameStepCount(0)).toBe(c.fixture.pages);
      const pages=await prepared.renderFramePages();
      for(const [index,page] of pages.pages.entries()) {
        expect(page.diagnostics).toEqual([]);
        expect(page.svg.svg).not.toContain('data-tex-literal=');
        for(const mask of c.fixture.paintColors??[]) {
          const painted=page.svg.svg.includes(`fill="${mask.color}"`);
          expect(painted).toBe(mask.visible[index]);
        }
      }
    });
  }
});
