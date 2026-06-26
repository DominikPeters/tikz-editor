import { describe, expect, it } from "vitest";

import {
  DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
  expandMacroBindings,
  expandMacroBindingsMapped,
  isControlSequenceToken,
  type MacroBinding,
  type MacroExpansionTraceEvent,
  type MacroOriginFrame
} from "../packages/core/src/macros/index.js";
import { projectInputRange } from "../packages/core/src/text/source-map.js";

function makeOrigin(
  macroName: string,
  definitionId: string,
  commandRaw: MacroOriginFrame["commandRaw"] = "\\newcommand"
): MacroOriginFrame {
  return {
    macroName,
    definitionId,
    definitionSpan: { from: 0, to: 1 },
    commandRaw
  };
}

function textBinding(
  value: string,
  macroName: string,
  definitionId: string,
  commandRaw: MacroOriginFrame["commandRaw"] = "\\def"
): MacroBinding {
  return {
    kind: "text",
    value,
    provenance: [makeOrigin(macroName, definitionId, commandRaw)]
  };
}

function callableBinding(body: string, parameterCount: number, macroName: string, definitionId: string): MacroBinding {
  return {
    kind: "callable",
    body,
    parameterCount,
    provenance: [makeOrigin(macroName, definitionId, "\\newcommand")]
  };
}

describe("macro expansion", () => {
  it("expands fixed-arity macros with braced arguments", () => {
    const bindings = new Map<string, MacroBinding>([
      ["\\pair", callableBinding("#1/#2", 2, "\\pair", "macro:pair")]
    ]);

    const expanded = expandMacroBindings(String.raw`\pair{A}{B}`, bindings);
    expect(expanded).toBe("A/B");
  });

  it("accepts single-token arguments for fixed-arity macros", () => {
    const bindings = new Map<string, MacroBinding>([
      ["\\pair", callableBinding("#1/#2", 2, "\\pair", "macro:pair")]
    ]);

    const expanded = expandMacroBindings(String.raw`\pair A B`, bindings);
    expect(expanded).toBe("A/B");
  });

  it("preserves TeX control sequence boundaries around replacements", () => {
    const bindings = new Map<string, MacroBinding>([
      ["\\x", textBinding("abc", "\\x", "macro:x")]
    ]);

    const expanded = expandMacroBindings(String.raw`\mathstrut\x`, bindings);
    expect(expanded).toBe(String.raw`\mathstrut{}abc`);
  });

  it("captures provenance in expansion trace events", () => {
    const bindings = new Map<string, MacroBinding>([
      ["\\pair", callableBinding("#1/#2", 2, "\\pair", "macro:pair")]
    ]);
    const trace: MacroExpansionTraceEvent[] = [];

    const expanded = expandMacroBindings(String.raw`\pair{A}{B}`, bindings, { trace });
    expect(expanded).toBe("A/B");
    expect(trace.length).toBeGreaterThan(0);
    expect(trace[0]?.macroName).toBe("\\pair");
    expect(trace[0]?.provenance[0]?.definitionId).toBe("macro:pair");
  });

  it("enforces the default recursion depth limit of 100 expansions", () => {
    const bindings = new Map<string, MacroBinding>([
      ["\\loop", textBinding(String.raw`\loop x`, "\\loop", "macro:loop")]
    ]);

    const expanded = expandMacroBindings(String.raw`\loop`, bindings);
    const growthCount = (expanded.match(/ x/g) ?? []).length;

    expect(growthCount).toBe(DEFAULT_MACRO_EXPANSION_MAX_DEPTH);
    expect(expanded.startsWith(String.raw`\loop`)).toBe(true);
  });

  it("supports optional first arguments with defaults", () => {
    const bindings = new Map<string, MacroBinding>([
      [
        "\\pair",
        {
          kind: "callable",
          body: "#1/#2",
          parameterCount: 2,
          optionalFirstArgDefault: "left",
          provenance: [makeOrigin("\\pair", "macro:pair", "\\newcommand")]
        }
      ]
    ]);

    const defaulted = expandMacroBindings(String.raw`\pair{R}`, bindings);
    const explicit = expandMacroBindings(String.raw`\pair[right]{R}`, bindings);
    expect(defaulted).toBe("left/R");
    expect(explicit).toBe("right/R");
  });

  it("detects expansion cycles and preserves unknown control sequences", () => {
    const bindings = new Map<string, MacroBinding>([
      ["\\a", textBinding(String.raw`\b`, "\\a", "macro:a")],
      ["\\b", textBinding(String.raw`\a`, "\\b", "macro:b")]
    ]);

    expect(expandMacroBindings(String.raw`pre \a \unknown`, bindings)).toBe(String.raw`pre \a \unknown`);
    expect(expandMacroBindings("", bindings)).toBe("");
    expect(expandMacroBindings(String.raw`\a`, new Map())).toBe(String.raw`\a`);
  });

  it("supports zero-argument callable macros and trailing control-word boundaries", () => {
    const bindings = new Map<string, MacroBinding>([
      ["\\word", callableBinding("abc", 0, "\\word", "macro:word")],
      ["\\join", callableBinding(String.raw`\abc`, 1, "\\join", "macro:join")]
    ]);

    expect(expandMacroBindings(String.raw`\word next`, bindings)).toBe("abc next");
    expect(expandMacroBindings(String.raw`\wordx`, bindings)).toBe(String.raw`\wordx`);
    expect(expandMacroBindings(String.raw`\wordtail`, bindings)).toBe(String.raw`\wordtail`);
    expect(expandMacroBindings(String.raw`\word tail`, bindings)).toBe("abc tail");
    expect(expandMacroBindings(String.raw`\word{}tail`, bindings)).toBe("abc{}tail");
    expect(expandMacroBindings(String.raw`\join{X}tail`, bindings)).toBe(String.raw`\abc{}tail`);
    expect(isControlSequenceToken(" \\word ")).toBe(true);
    expect(isControlSequenceToken("\\word1")).toBe(false);
  });

  it("leaves callable macros unchanged when required arguments are missing or malformed", () => {
    const bindings = new Map<string, MacroBinding>([
      ["\\pair", callableBinding("#1/#2", 2, "\\pair", "macro:pair")]
    ]);

    expect(expandMacroBindings(String.raw`\pair{A}`, bindings)).toBe(String.raw`\pair{A}`);
    expect(expandMacroBindings(String.raw`\pair{unterminated`, bindings)).toBe(String.raw`\pair{unterminated`);
  });

  it("parses control sequence arguments plus escaped and nested bracket/braced arguments", () => {
    const bindings = new Map<string, MacroBinding>([
      ["\\wrap", callableBinding("[#1]", 1, "\\wrap", "macro:wrap")],
      [
        "\\opt",
        {
          kind: "callable",
          body: "#1/#2",
          parameterCount: 2,
          optionalFirstArgDefault: "default",
          provenance: [makeOrigin("\\opt", "macro:opt", "\\newcommand")]
        }
      ],
      ["\\hash", callableBinding("##/#1/#3/#x", 1, "\\hash", "macro:hash")]
    ]);

    expect(expandMacroBindings(String.raw`\wrap\alpha`, bindings)).toBe(String.raw`[\alpha]`);
    expect(expandMacroBindings(String.raw`\wrap{a\{b\}}`, bindings)).toBe(String.raw`[a\{b\}]`);
    expect(expandMacroBindings(String.raw`\opt[[a\]b]]{R}`, bindings)).toBe(String.raw`[a\]b]/R`);
    expect(expandMacroBindings(String.raw`\opt[[a[b]]]{R}`, bindings)).toBe("[a[b]]/R");
    expect(expandMacroBindings(String.raw`\opt[unterminated{R}`, bindings)).toBe(String.raw`\opt[unterminated{R}`);
    expect(expandMacroBindings(String.raw`\hash{Z}`, bindings)).toBe("#/Z/#3/#x");
  });

  it("maps macro-generated text to invocations and arguments to original argument source", () => {
    const bindings = new Map<string, MacroBinding>([
      ["\\wrap", callableBinding(String.raw`\textbf{#1}`, 1, "\\wrap", "macro:wrap")]
    ]);

    const expanded = expandMacroBindingsMapped(String.raw`\wrap{Alpha}`, bindings, { sourceOffset: 20 });

    expect(expanded.text).toBe(String.raw`\textbf{Alpha}`);
    expect(projectInputRange(expanded.sourceMap, 0, "\\textbf{".length)).toEqual({
      kind: "source-range",
      from: 20,
      to: 32,
      policy: "macro",
      macroName: "\\wrap"
    });
    expect(projectInputRange(expanded.sourceMap, "\\textbf{".length, "\\textbf{Alpha".length)).toEqual({
      kind: "source-range",
      from: 26,
      to: 31,
      policy: "caret"
    });
    expect(expanded.sourceMap.charOrigins["\\textbf{".length]).toMatchObject({
      kind: "macro-argument",
      from: 26,
      to: 27,
      macroName: "\\wrap"
    });
  });

  it("maps optional default arguments as generated text owned by the invocation", () => {
    const bindings = new Map<string, MacroBinding>([
      [
        "\\pair",
        {
          kind: "callable",
          body: "#1/#2",
          parameterCount: 2,
          optionalFirstArgDefault: "left",
          provenance: [makeOrigin("\\pair", "macro:pair", "\\newcommand")]
        }
      ]
    ]);

    const expanded = expandMacroBindingsMapped(String.raw`\pair{R}`, bindings, { sourceOffset: 10 });

    expect(expanded.text).toBe("left/R");
    expect(projectInputRange(expanded.sourceMap, 0, 4)).toEqual({
      kind: "source-range",
      from: 10,
      to: 18,
      policy: "generated",
      reason: "macro optional default"
    });
    expect(projectInputRange(expanded.sourceMap, 5, 6)).toEqual({
      kind: "source-range",
      from: 16,
      to: 17,
      policy: "caret"
    });
  });
});
