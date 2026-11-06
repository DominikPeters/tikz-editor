import { describe, expect, it } from "vitest";
import { generateBeamerFuzzCases, INTRICATE_FAMILIES } from "../scripts/lib/beamer-fuzz-cases.mjs";
import { scanBeamerDocument } from "../packages/core/src/beamer/index.js";
import { generateBeamerEditSequence, withEditProbes, materializeBeamerEdits } from "./differential/beamer-edit-fuzz.js";

describe("recursive Beamer document grammar", () => {
  it("replays structural decisions and crosses nested productions within explicit budgets", () => {
    const cases = generateBeamerFuzzCases({ seed: 20261106, cases: 256, profile: "intricate" });
    expect(cases.slice(0, 6)).toEqual(generateBeamerFuzzCases({ seed: 20261106, cases: 6, profile: "intricate" }));
    expect(cases.slice(0, 6)).not.toEqual(generateBeamerFuzzCases({ seed: 20261107, cases: 6, profile: "intricate" }));
    expect(new Set(cases.map(entry => entry.source)).size).toBe(256);
    expect(new Set(cases.map(entry => entry.fixture.family)).size).toBe(INTRICATE_FAMILIES.length);
    const plans = cases.map(entry => entry.fixture.choices.grammar!.macroPlan);
    expect(new Set(plans.map(plan => plan.chainDepth))).toEqual(new Set([1, 2, 3]));
    expect(new Set(plans.map(plan => plan.initialUnit)).size).toBe(3);
    expect(plans.every(plan => plan.initialStyle !== plan.localStyle && plan.initialUnit !== plan.localUnit)).toBe(true);
    const interactions = new Set(cases.flatMap(entry => entry.fixture.choices.grammar!.pairs));
    expect(interactions.size).toBeGreaterThan(65);
    expect(interactions).toContain("columns>list");
    expect(interactions).toContain("block>columns");
    expect(interactions).toContain("list>list");
    expect(interactions).toContain("overlay>block");
    for (const entry of cases) {
      const grammar = entry.fixture.choices.grammar!;
      expect(grammar.nodes).toBeLessThanOrEqual(grammar.budget);
      expect(grammar.depth).toBeLessThanOrEqual(grammar.maxDepth);
      expect(grammar.depth).toBeGreaterThanOrEqual(2);
      const document = scanBeamerDocument(entry.source);
      expect(document.diagnostics).toEqual([]);
      expect(document.frames).toHaveLength(grammar.frameCount);
      expect(entry.additionalFixtures).toHaveLength(grammar.frameCount - 1);
      expect(entry.source).toContain(String.raw`\renewcommand{\fuzzunit}`);
      expect(entry.source).toContain(String.raw`\fuzzscale[2]{y}`);
      for (const mask of entry.fixture.paintColors!) expect(mask.visible).toHaveLength(entry.fixture.pages);
      expect(entry.fixture.paintColors![0].visible.at(-1)).toBe(false);
    }
  });
  it("makes the default broad workload expand beyond its small controls", () => {
    const cases = generateBeamerFuzzCases({ cases: 64 });
    expect(cases.slice(0, 33).every(entry => !entry.fixture.choices.grammar)).toBe(true);
    expect(cases.slice(33).every(entry => entry.fixture.choices.grammar)).toBe(true);
    expect(cases.slice(33).every(entry => entry.source.length > 2000)).toBe(true);
  });
  it("preserves frame options and targets the appended drawing probes after a whole deck", () => {
    const entry = generateBeamerFuzzCases({ seed: 20261106, cases: 1, profile: "intricate" })[0];
    const source = withEditProbes(entry.source);
    expect(source).toContain(String.raw`\begin{frame}[t,shrink=5]`);
    expect(source).toContain(String.raw`{Composed dependencies}\raggedright \editprobetext\par`);
    const recipe = generateBeamerEditSequence(source, entry.fixture.family, 42, 14);
    const frames = entry.fixture.choices.grammar!.frameCount;
    expect(recipe.actions[2]).toEqual({ kind: "navigate", frame: frames, step: 2 });
    expect(recipe.actions).toContainEqual(expect.objectContaining({ kind: "navigate", frame: frames + 1, picture: true }));
    const materialized = materializeBeamerEdits(recipe);
    expect(materialized.effectiveEdits.width).toBeGreaterThan(0);
    expect(materialized.effectiveEdits["bounds-width"]).toBeGreaterThan(0);
    expect(scanBeamerDocument(materialized.finalSource).diagnostics).toEqual([]);
  });
});
