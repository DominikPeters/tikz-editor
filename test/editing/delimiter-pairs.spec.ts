import { describe, expect, it } from "vitest";
import { createCommandTable } from "../../packages/core/src/editing/commands/index.js";
import { parseScenarioKeys } from "../../packages/core/src/editing/testing/index.js";
import { KeystrokeSession, type FuzzKey } from "./fuzz/keystroke-session.js";

/**
 * `\left` and `\right` around what is already written: `\left(` brings
 * its `\right)`, so typing `\right)` further on extends the pair to there
 * (TeX has no `\right` without a `\left`); a selection is wrapped whole.
 */
const commands = createCommandTable();

function session(marked: string): KeystrokeSession {
  const anchor = marked.includes("⟦") ? marked.indexOf("⟦") : marked.indexOf("‸");
  const text = marked.replace(/[⟦⟧‸]/gu, "");
  const focus = marked.includes("⟧") ? marked.indexOf("⟧") - 1 : anchor;
  return new KeystrokeSession(text, commands, anchor, focus);
}

function press(target: KeystrokeSession, ...keys: (string | FuzzKey)[]): void {
  for (const key of keys) {
    for (const each of typeof key === "string" ? parseScenarioKeys(key) : [key]) {
      target.press(each);
    }
  }
}

function marked(target: KeystrokeSession): string {
  const { anchor, focus } = target.selection;
  const from = Math.min(anchor, focus);
  const to = Math.max(anchor, focus);
  const { text } = target;
  return from === to ? `${text.slice(0, from)}‸${text.slice(from)}` : `${text.slice(0, from)}⟦${text.slice(from, to)}⟧${text.slice(to)}`;
}

const after = (target: KeystrokeSession, needle: string): FuzzKey => {
  const at = target.text.indexOf(needle) + needle.length;
  return { kind: "select", anchor: at, focus: at };
};

describe("delimiter pairs around what is written", () => {
  it("extends the pair \\left( brought to where \\right) is typed, as one step", () => {
    const target = session(String.raw`$f+‸\lambda_i\nabla g_i(x^\star)+h$`);
    press(target, String.raw`\left(`);
    expect(marked(target)).toBe(String.raw`$f+\left(‸\right)\lambda_i\nabla g_i(x^\star)+h$`);
    press(target, after(target, String.raw`(x^\star)`), String.raw`\right)`);
    expect(marked(target)).toBe(String.raw`$f+\left(\lambda_i\nabla g_i(x^\star)\right)‸+h$`);
    press(target, "⌘Z");
    expect(target.text).toBe(String.raw`$f+\left(\right)\lambda_i\nabla g_i(x^\star)+h$`);
  });

  it("takes the delimiter typed: \\left( … \\right] is a pair too", () => {
    const target = session(String.raw`$\left(\right)a+b‸$`);
    press(target, String.raw`\right]`);
    expect(marked(target)).toBe(String.raw`$\left(a+b\right]‸$`);
  });

  it("extends only a pair in the same formula slot, never across a script", () => {
    const target = session(String.raw`$\left(\right)x^{2‸}$`);
    press(target, String.raw`\right)`);
    expect(target.text).toBe(String.raw`$\left(\right)x^{2}$`);
  });

  it("still steps over the \\right that \\left brought", () => {
    const target = session(String.raw`$\left(a‸\right)+b$`);
    press(target, String.raw`\right)`);
    expect(marked(target)).toBe(String.raw`$\left(a\right)‸+b$`);
  });

  it("wraps a selection, which stays selected", () => {
    const target = session(String.raw`$f+⟦\lambda_i g_i(x)⟧+h$`);
    press(target, String.raw`\left(`);
    expect(marked(target)).toBe(String.raw`$f+\left(⟦\lambda_i g_i(x)⟧\right)+h$`);
  });

  it("does not turn selected prose into a formula", () => {
    const target = session("Some ⟦words⟧ here.");
    press(target, String.raw`\left(`);
    expect(target.text).toBe("Some words here.");
  });
});
