import { describe, expect, it } from "vitest";
import { runScenario } from "../../packages/core/src/editing/testing/index.js";
import { resolveIntent } from "../../packages/core/src/editing/input/index.js";
import { createCommandTable } from "../../packages/core/src/editing/commands/index.js";
import { createEditView } from "../../packages/core/src/editing/position/index.js";
import { buildEditTree } from "../../packages/core/src/editing/tree/build.js";
import { applyPatches } from "../../packages/core/src/editing/transaction/index.js";
import { canvasSessionDriver } from "./canvas-session-driver.js";
import { KeystrokeSession } from "./fuzz/keystroke-session.js";
import { parseScenarioKeys } from "../../packages/core/src/editing/testing/index.js";
import {
  burstScenarios,
  characterisationScenarios,
  chipScenarios,
  contractScenarios,
  inputRuleScenarios,
  structuralKeyScenarios,
  texValidityScenarios,
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

describe("canvas editing: structural keys", () => {
  for (const scenario of structuralKeyScenarios) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const { actual, expected } = await runScenario(eager, scenario);
      expect(actual).toBe(expected);
    });
  }
});

describe("canvas editing: the command chip", () => {
  for (const scenario of chipScenarios) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const { actual, expected } = await runScenario(eager, scenario);
      expect(actual).toBe(expected);
    });
  }
});

describe("canvas editing: source TeX accepts", () => {
  for (const scenario of texValidityScenarios) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const { actual, expected } = await runScenario(eager, scenario);
      expect(actual).toBe(expected);
    });
  }

  // (The scenario documents give the frame a title; here the body follows `\begin{frame}` directly.)
  it.each([
    ["typed", "\nText", 1, ["["], "\n\\relax[Text"],
    ["left by a deletion", "\nx[draft] Text", 2, ["⌫"], "\n\\relax[draft] Text"],
  ])("X11: a [ %s at a frame body's start is not read as the frame's options", (_, body, caret, keys, expected) => {
    const session = new KeystrokeSession(body, createCommandTable(), caret, caret, false, true);
    for (const key of keys.flatMap((token) => parseScenarioKeys(token))) {
      session.press(key);
    }
    expect(session.text).toBe(expected);
  });
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
  for (const scenario of [...burstScenarios, ...characterisationScenarios, ...treeEditingScenarios, ...inputRuleScenarios, ...structuralKeyScenarios, ...chipScenarios, ...texValidityScenarios, ...undoScenarios]) {
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

  it("O4: a [ committed by composition does not open \\\\'s optional argument", () => {
    const text = String.raw`a\\ b`;
    const caret = text.indexOf("b");
    const resolution = resolveIntent({
      surface: "canvas",
      editMode: "default",
      isScopeSession: true,
      revision: 0,
      text,
      bufferFrom: 0,
      anchor: caret,
      focus: caret,
      composition: null,
      domain: null,
      verticalGoal: null,
      structure: (source) => createEditView(buildEditTree(source)),
      positions: null,
      interaction: {},
      commands: createCommandTable(),
    }, { type: "compose", text: "[", commit: true, origin: "composition", repeat: false });
    expect(resolution.kind).toBe("transaction");
    const { transaction } = resolution as Extract<typeof resolution, { kind: "transaction" }>;
    expect(applyPatches(text, transaction.patches)).toBe(String.raw`a\\ {}[b`);
  });
  it.todo("O8: cancelling the \\textcolor picker restores the selection and writes nothing");
});
