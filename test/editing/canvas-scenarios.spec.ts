import { describe, expect, it } from "vitest";
import { runScenario } from "../../packages/core/src/editing/testing/index.js";
import { legacyCanvasDriver } from "./legacy-canvas-driver.js";
import { characterisationScenarios, contractScenarios } from "./scenarios.js";

describe("canvas editing: today's behaviour (legacy driver)", () => {
  for (const scenario of characterisationScenarios) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const { actual, expected } = await runScenario(legacyCanvasDriver, scenario);
      expect(actual).toBe(expected);
    });
  }
});

describe("canvas editing: contracts from the scenarios doc", () => {
  for (const scenario of contractScenarios) {
    if (scenario.legacy === "passes") {
      it(`${scenario.id}: ${scenario.title}`, async () => {
        const { actual, expected } = await runScenario(legacyCanvasDriver, scenario);
        expect(actual).toBe(expected);
      });
    } else {
      it(`${scenario.id}: ${scenario.title} (not yet met)`, async () => {
        const { actual, expected } = await runScenario(legacyCanvasDriver, scenario);
        expect(actual).not.toBe(expected);
      });
    }
  }

  it.todo("burst typing ahead of layout never drops keystrokes (revision protocol)");
  it.todo("undo groups: a typing run is one step; a chip commit is one step (R12)");
  it.todo("O4: a [ committed by composition does not open \\\\'s optional argument");
  it.todo("O8: cancelling the \\textcolor picker restores the selection and writes nothing");
});
