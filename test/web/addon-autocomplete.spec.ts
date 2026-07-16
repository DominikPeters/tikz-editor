import { afterEach, describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";

import { createAddonRuntime } from "@tikz-editor/core/addons/runtime.js";
import { tikzLanguage } from "@tikz-editor/lang-tikz";
import { addonCompletion } from "../../packages/app/src/ui/source-panel/addon-autocomplete";
import { setActiveAddonRuntime } from "../../packages/app/src/addons/registry";
import { createSmileyAddon } from "../helpers/smiley-addon.js";

function completeAt(source: string, pos: number, explicit = false) {
  const state = EditorState.create({ doc: source, extensions: [tikzLanguage] });
  return addonCompletion(new CompletionContext(state, pos, explicit));
}

function withCompletionTables() {
  const registration = createSmileyAddon();
  registration.engine.completion = {
    optionKeys: ["padding", "mood"],
    valueMap: { mood: ["happy", "sleepy"] },
    scrubKeys: { length: ["padding"] }
  };
  return createAddonRuntime([registration]);
}

afterEach(() => {
  setActiveAddonRuntime(null);
});

describe("addonCompletion", () => {
  it("returns nothing when no runtime is active", () => {
    const source = "\\begin{tikzpicture}\n\\begin{smi\n\\end{tikzpicture}";
    expect(completeAt(source, source.indexOf("smi") + 3)).toBeNull();
  });

  it("completes claimed environment names after \\begin{", () => {
    setActiveAddonRuntime(withCompletionTables());
    const source = "\\begin{tikzpicture}\n\\begin{smi\n\\end{tikzpicture}";
    const result = completeAt(source, source.indexOf("smi") + 3);
    expect(result?.options.map((option) => option.label)).toContain("smileybox");
  });

  it("completes claimed command names after a backslash", () => {
    setActiveAddonRuntime(withCompletionTables());
    const source = "\\begin{tikzpicture}\n\\smi\n\\end{tikzpicture}";
    const result = completeAt(source, source.indexOf("\\smi") + 4);
    const labels = result?.options.map((option) => option.label) ?? [];
    expect(labels).toContain("\\smiley");
    expect(labels).toContain("\\smileyset");
  });

  it("completes engine option keys inside a claimed environment's option list", () => {
    setActiveAddonRuntime(withCompletionTables());
    const source = "\\begin{tikzpicture}\n\\begin{smileybox}[pa]\n\\end{smileybox}\n\\end{tikzpicture}";
    const result = completeAt(source, source.indexOf("[pa]") + 3);
    expect(result?.options.map((option) => option.label)).toContain("padding");
  });

  it("completes engine option values after = inside a claimed environment", () => {
    setActiveAddonRuntime(withCompletionTables());
    const source = "\\begin{tikzpicture}\n\\begin{smileybox}[mood=ha]\n\\end{smileybox}\n\\end{tikzpicture}";
    const result = completeAt(source, source.indexOf("=ha]") + 3);
    expect(result?.options.map((option) => option.label)).toContain("happy");
  });

  it("does not offer add-on option keys in ordinary TikZ option lists", () => {
    setActiveAddonRuntime(withCompletionTables());
    const source = "\\begin{tikzpicture}\n\\draw[pa] (0,0) -- (1,1);\n\\end{tikzpicture}";
    const result = completeAt(source, source.indexOf("[pa]") + 3);
    expect(result).toBeNull();
  });
});
