import { describe, expect, it } from "vitest";
import { runScenario } from "../../packages/core/src/editing/testing/index.js";
import { canvasSessionDriver } from "./canvas-session-driver.js";
import {
  burstScenarios,
  characterisationScenarios,
  contractScenarios,
  inputRuleScenarios,
  treeEditingScenarios,
  undoScenarios,
} from "./scenarios.js";

const eager = canvasSessionDriver("eager");
const burst = canvasSessionDriver("burst");

describe("canvas editing: today's behaviour", () => {
  for (const scenario of characterisationScenarios) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const { actual, expected } = await runScenario(eager, scenario);
      expect(actual).toBe(expected);
    });
  }
});

describe("canvas editing: the edit tree", () => {
  for (const scenario of treeEditingScenarios) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const { actual, expected } = await runScenario(eager, scenario);
      expect(actual).toBe(expected);
    });
  }
});

describe("canvas editing: input rules", () => {
  for (const scenario of inputRuleScenarios) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const { actual, expected } = await runScenario(eager, scenario);
      expect(actual).toBe(expected);
    });
  }
});

describe("canvas editing: undo groups", () => {
  for (const scenario of undoScenarios) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const { actual, expected } = await runScenario(eager, scenario);
      expect(actual).toBe(expected);
    });
  }
});

describe("canvas editing: typing ahead of layout", () => {
  for (const scenario of burstScenarios) {
    it(`${scenario.id}: ${scenario.title} (rendering after every key)`, async () => {
      const { actual, expected } = await runScenario(eager, scenario);
      expect(actual).toBe(expected);
    });
  }
  for (const scenario of [...burstScenarios, ...characterisationScenarios, ...treeEditingScenarios, ...inputRuleScenarios, ...undoScenarios]) {
    it(`${scenario.id}: ${scenario.title} (no rendering between keys)`, async () => {
      const { actual, expected } = await runScenario(burst, scenario);
      expect(actual).toBe(expected);
    });
  }
});

describe("canvas editing: contracts from the scenarios doc", () => {
  for (const scenario of contractScenarios) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const { actual, expected } = await runScenario(eager, scenario);
      expect(actual).toBe(expected);
    });
  }

  it.todo("a chip commit is one undo step (R12)");
  it.todo("O4: a [ committed by composition does not open \\\\'s optional argument");
  it.todo("O8: cancelling the \\textcolor picker restores the selection and writes nothing");
});
