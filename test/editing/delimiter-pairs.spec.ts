import { describe, expect, it } from "vitest";
import { createCommandTable } from "../../packages/core/src/editing/commands/index.js";
import { parseScenarioKeys } from "../../packages/core/src/editing/testing/index.js";
import { scanTexRecovery } from "../../packages/core/src/text/tex/recovery.js";
import { KeystrokeSession, type FuzzKey } from "./fuzz/keystroke-session.js";

/**
 * `\left` and `\right` around what is already written (M14): `\left(`
 * is written alone and `\right)` typed after what it encloses closes it;
 * a pair already closed extends to where `\right)` is typed (TeX has no
 * `\right` without a `\left`); a selection is wrapped in the whole pair.
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
  it("writes \left( alone, closed by \right) typed after what it wraps, as TeX's recovery shows", () => {
    const target = session(String.raw`$f+‸\lambda_i\nabla g_i(x^\star)+h$`);
    press(target, String.raw`\left(`);
    expect(marked(target)).toBe(String.raw`$f+\left(‸\lambda_i\nabla g_i(x^\star)+h$`);
    // Until then, its `\right` is missing where the formula ends: the canvas draws it there.
    expect(scanTexRecovery(target.text).closers).toMatchObject([{ kind: "delimiter", closer: String.raw`\right)`, at: target.text.length - 1 }]);
    press(target, after(target, String.raw`(x^\star)`), String.raw`\right)`);
    expect(marked(target)).toBe(String.raw`$f+\left(\lambda_i\nabla g_i(x^\star)\right)‸+h$`);
    expect(scanTexRecovery(target.text).closers).toEqual([]);
    press(target, "⌘Z");
    expect(target.text).toBe(String.raw`$f+\left(\lambda_i\nabla g_i(x^\star)+h$`);
  });

  it("closes a \left( just typed at once, empty", () => {
    const target = session(String.raw`$a‸$`);
    press(target, String.raw`\left(\right)`);
    expect(marked(target)).toBe(String.raw`$a\left(\right)‸$`);
  });

  it("takes the delimiter typed: \left( … \right] is a pair too", () => {
    const target = session(String.raw`$\left(a+b‸$`);
    press(target, String.raw`\right]`);
    expect(marked(target)).toBe(String.raw`$\left(a+b\right]‸$`);
  });

  it("closes only in the \left's own slot, never inside a script in it", () => {
    const target = session(String.raw`$\left(x^{2‸}$`);
    press(target, String.raw`\right)`);
    expect(target.text).toBe(String.raw`$\left(x^{2}$`);
  });

  it("extends a pair already closed to where \right) is typed", () => {
    const target = session(String.raw`$\left(\right)a+b‸$`);
    press(target, String.raw`\right]`);
    expect(marked(target)).toBe(String.raw`$\left(a+b\right]‸$`);
  });

  it("still steps over a \right already there", () => {
    const target = session(String.raw`$\left(a‸\right)+b$`);
    press(target, String.raw`\right)`);
    expect(marked(target)).toBe(String.raw`$\left(a\right)‸+b$`);
  });

  it("wraps a selection in the whole pair, the selection kept", () => {
    const target = session(String.raw`$f+⟦\lambda_i g_i(x)⟧+h$`);
    press(target, String.raw`\left(`);
    expect(marked(target)).toBe(String.raw`$f+\left(⟦\lambda_i g_i(x)⟧\right)+h$`);
  });

  it("does not turn selected prose into a formula", () => {
    const target = session("Some ⟦words⟧ here.");
    press(target, String.raw`\left(`);
    expect(target.text).toBe("Some words here.");
  });

  it.each([
    ["⌫ after it", String.raw`$a\left(‸ b+c$`, "⌫", String.raw`$a‸ b+c$`],
    ["⌦ before it", String.raw`$a‸\left( b+c$`, "⌦", String.raw`$a‸ b+c$`],
    ["the formula's only content", String.raw`a $\left(‸$ b`, "⌫", "a ${‸}$ b"],
  ])("deletes a \left( still open alone, never what follows it: %s", (_name, start, keys, expected) => {
    const target = session(start);
    press(target, keys);
    expect(marked(target)).toBe(expected);
  });
});
