import { describe, expect, it } from "vitest";
import {
  formatMarkedSource,
  parseMarkedSource,
  parseScenarioKeys,
} from "../../packages/core/src/editing/testing/index.js";

describe("scenario DSL: marked sources", () => {
  it.each([
    ["ab‸c", "abc", 2, 2],
    ["a⟦bc⟧d", "abcd", 1, 3],
    ["a⟦bc‸⟧d", "abcd", 1, 3],
    ["a⟦‸bc⟧d", "abcd", 3, 1],
  ])("parses %s", (marked, source, anchor, focus) => {
    expect(parseMarkedSource(marked)).toEqual({ source, selection: { anchor, focus } });
  });

  it.each(["ab‸c", "a⟦bc⟧d", "a⟦‸bc⟧d", "‸", String.raw`$\frac{a}{‸}$`])("round-trips %s", (marked) => {
    const parsed = parseMarkedSource(marked);
    expect(formatMarkedSource(parsed.source, parsed.selection)).toBe(marked);
  });

  it.each(["abc", "a‸b‸c", "a⟦b", "a⟦b‸c⟧", "a⟧b⟦c"])("rejects %s", (marked) => {
    expect(() => parseMarkedSource(marked)).toThrow();
  });
});

describe("scenario DSL: key sequences", () => {
  it("parses named keys, modifiers, repeats and auto-repeat", () => {
    expect(parseScenarioKeys("⇧→ ⌘B →×2 ⌫↻")).toEqual([
      { kind: "key", key: "ArrowRight", shift: true, primary: false, alt: false, repeat: false },
      { kind: "key", key: "b", shift: false, primary: true, alt: false, repeat: false },
      { kind: "key", key: "ArrowRight", shift: false, primary: false, alt: false, repeat: false },
      { kind: "key", key: "ArrowRight", shift: false, primary: false, alt: false, repeat: false },
      { kind: "key", key: "Backspace", shift: false, primary: false, alt: false, repeat: true },
    ]);
  });

  it("types text one keystroke per character, with ␣ as space", () => {
    expect(parseScenarioKeys(String.raw`\cup␣ ␣`)).toEqual(
      [..."\\cup ", " "].map((text) => ({ kind: "text", text }))
    );
  });

  it("rejects multi-character modified tokens", () => {
    expect(() => parseScenarioKeys("⌘bold")).toThrow();
  });
});
