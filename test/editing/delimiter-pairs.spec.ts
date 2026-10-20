import { describe, expect, it } from "vitest";
import { createCommandTable } from "../../packages/core/src/editing/commands/index.js";
import { chipCandidates } from "../../packages/core/src/editing/input/chip.js";
import { parseScenarioKeys } from "../../packages/core/src/editing/testing/index.js";
import { KeystrokeSession, type FuzzKey } from "./fuzz/keystroke-session.js";

/**
 * `\left` and `\right` around what is already written (M14): `\left(`
 * writes its pair with the `\right)` pending, taken along by the arrows
 * until accepted; a `\left` without its `\right` (from the source lens,
 * or a file) is closed by `\right)` typed after it; a pair already closed
 * extends to where `\right)` is typed (TeX has no `\right` without a
 * `\left`); a selection is wrapped in the whole pair.
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

describe("delimiter pairs around what is written", () => {
  it(String.raw`writes \left( with its \right) pending: → takes it along over what is written, ⇥ accepts it, one undo step`, () => {
    const target = session(String.raw`$f+‸\lambda_i\nabla g_i(x^\star)+h$`);
    press(target, String.raw`\left(`);
    expect(marked(target)).toBe(String.raw`$f+\left(‸\right)\lambda_i\nabla g_i(x^\star)+h$`);
    expect(target.pendingCloser).toBe(target.selection.focus);
    // Item by item: `\lambda_i`, `\nabla`, `g_i`, then the plain `(x^\star)` as one.
    press(target, "→ → →");
    expect(marked(target)).toBe(String.raw`$f+\left(\lambda_i\nabla g_i‸\right)(x^\star)+h$`);
    press(target, "→");
    expect(marked(target)).toBe(String.raw`$f+\left(\lambda_i\nabla g_i(x^\star)‸\right)+h$`);
    press(target, "←");
    expect(marked(target)).toBe(String.raw`$f+\left(\lambda_i\nabla g_i‸\right)(x^\star)+h$`);
    press(target, "→");
    press(target, "⇥");
    expect(marked(target)).toBe(String.raw`$f+\left(\lambda_i\nabla g_i(x^\star)\right)‸+h$`);
    expect(target.pendingCloser).toBeUndefined();
    press(target, "⌘Z");
    expect(target.text).toBe(String.raw`$f+\lambda_i\nabla g_i(x^\star)+h$`);
  });

  it.each([
    ["typing goes in front of it", String.raw`$a‸$`, String.raw`\left(x+1`, String.raw`$a\left(x+1‸\right)$`, true],
    ["its delimiter typed accepts it", String.raw`$a‸$`, String.raw`\left(x+1)=0`, String.raw`$a\left(x+1\right)=0‸$`, false],
    ["unless a ( typed inside is open", String.raw`$a‸$`, String.raw`\left(f(x)`, String.raw`$a\left(f(x)‸\right)$`, true],
    [String.raw`\right] typed there replaces it`, String.raw`$a‸$`, String.raw`\left(x\right]`, String.raw`$a\left(x\right]‸$`, false],
    ["⌘→ takes it to the end", String.raw`$a‸+b=c$`, String.raw`\left( ⌘→`, String.raw`$a\left(+b=c‸\right)$`, true],
    ["→ at the end accepts it", String.raw`$a‸+b$`, String.raw`\left( → → →`, String.raw`$a\left(+b\right)‸$`, false],
    ["← takes it back", String.raw`$a‸+b$`, String.raw`\left( → → ←`, String.raw`$a\left(+‸\right)b$`, true],
    ["Esc accepts it where it stands", String.raw`$a‸+b$`, String.raw`\left( → Esc`, String.raw`$a\left(+‸\right)b$`, false],
    ["⌫ in the empty pair removes it", String.raw`$a‸+b$`, String.raw`\left( ⌫`, String.raw`$a‸+b$`, false],
    ["into a construct it never goes", String.raw`$a‸\frac{1}{2}+b$`, String.raw`\left( →`, String.raw`$a\left(\frac{1}{2}‸\right)+b$`, true],
    ["a plain (…) goes over as one, nested ones too", String.raw`$‸f(g(x),[y])+1$`, String.raw`\left( → →`, String.raw`$\left(f(g(x),[y])‸\right)+1$`, true],
    ["an unmatched ( goes over alone", String.raw`$‸(a+b$`, String.raw`\left( →`, String.raw`$\left((‸\right)a+b$`, true],
    ["a control word left behind keeps apart", String.raw`$\alpha‸x+b$`, String.raw`\left( →`, String.raw`$\alpha\left(x‸\right)+b$`, true],
    ["a named delimiter", String.raw`$a‸$`, String.raw`\left\langle␣x`, String.raw`$a\left\langle x‸\right\rangle$`, true],
    ["a control-symbol delimiter", String.raw`$a‸$`, String.raw`\left\{x`, String.raw`$a\left\{x‸\right\}$`, true],
    ["in prose, the pair starts a formula", "a ‸ b", String.raw`\left(x ⇥ y`, String.raw`a $\left(x\right)y‸$ b`, false],
    ["a named delimiter kept apart from a letter after it", String.raw`$lat‸r$`, String.raw`\left\langle␣`, String.raw`$lat\left\langle‸\right\rangle r$`, true],
    [String.raw`in an optional argument, ] is written \rbrack, which does not end it`, String.raw`\begin{thebibliography}{9}\bibitem[A‸B]{k} x\end{thebibliography}`,
      String.raw`\left(\right]`, String.raw`\begin{thebibliography}{9}\bibitem[A$\left(\right\rbrack‸$B]{k} x\end{thebibliography}`, false],
  ])(String.raw`a pending \right: %s`, (_name, start, keys, expected, pending) => {
    const target = session(start);
    press(target, keys);
    expect(marked(target)).toBe(expected);
    expect(target.pendingCloser != null).toBe(pending);
  });

  it("⌥→ takes it along by word", () => {
    const target = session(String.raw`$a‸+bc+d$`);
    press(target, String.raw`\left(`, "⌥→");
    expect(marked(target)).toBe(String.raw`$a\left(+bc‸\right)+d$`);
  });

  it(String.raw`closes a \left( just typed at once, empty`, () => {
    const target = session(String.raw`$a‸$`);
    press(target, String.raw`\left(\right)`);
    expect(marked(target)).toBe(String.raw`$a\left(\right)‸$`);
  });

  it(String.raw`takes the delimiter typed: \left( … \right] is a pair too`, () => {
    const target = session(String.raw`$\left(a+b‸$`);
    press(target, String.raw`\right]`);
    expect(marked(target)).toBe(String.raw`$\left(a+b\right]‸$`);
  });

  it(String.raw`closes only in the \left's own slot, never inside a script in it`, () => {
    const target = session(String.raw`$\left(x^{2‸}$`);
    press(target, String.raw`\right)`);
    expect(target.text).toBe(String.raw`$\left(x^{2}$`);
  });

  it(String.raw`extends a pair already closed to where \right) is typed`, () => {
    const target = session(String.raw`$\left(\right)a+b‸$`);
    press(target, String.raw`\right]`);
    expect(marked(target)).toBe(String.raw`$\left(a+b\right]‸$`);
  });

  it(String.raw`still steps over a \right already there`, () => {
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
  ])(String.raw`deletes a \left( still open alone, never what follows it: %s`, (_name, start, keys, expected) => {
    const target = session(start);
    press(target, keys);
    expect(marked(target)).toBe(expected);
  });

  it.each([
    [String.raw`⌫ just inside \left(`, String.raw`$f+\left(‸g(x)+h\right)=0$`, "⌫", String.raw`$f+‸g(x)+h=0$`],
    [String.raw`⌦ just inside \right)`, String.raw`$f+\left(g(x)+h‸\right)=0$`, "⌦", String.raw`$f+g(x)+h‸=0$`],
    ["scripted: braced, so the script stays on all of it", String.raw`$\left(‸a+b\right)^2$`, "⌫", "${‸a+b}^2$"],
    [String.raw`with \middle`, String.raw`$\left\{‸x \middle| x>0\right\}$`, "⌫", String.raw`$‸x | x>0$`],
    ["keeping command names apart", String.raw`$\alpha\left(‸x\right)y$`, "⌫", String.raw`$\alpha ‸xy$`],
    ["the formula's only content", String.raw`a $\left(‸\right)$ b`, "⌫", "a ${‸}$ b"],
  ])("unwraps a closed pair, keeping what it encloses: %s", (_name, start, keys, expected) => {
    const target = session(start);
    press(target, keys);
    expect(marked(target)).toBe(expected);
    press(target, "⌘Z");
    expect(marked(target)).toBe(start);
  });
});

describe(String.raw`the chip offers \left and \right with their delimiters`, () => {
  const names = (prefix: string, closer?: string) => chipCandidates(commands, "math", prefix, "", closer).map((candidate) => candidate.name);

  it(String.raw`lists \left(, \left[, \left\{ and \left| in place of a bare \left`, () => {
    expect(names("left")).toEqual(expect.arrayContaining(["left(", "left[", String.raw`left\{`, "left|"]));
    expect(names("left")).not.toContain("left");
    expect(names("left").slice(0, 4)).toEqual(["left(", "left[", String.raw`left\{`, "left|"]);
  });

  it(String.raw`offers a pending \right first, from its first letter`, () => {
    expect(names("r", String.raw`\right]`)[0]).toBe("right]");
    expect(names("r")[0]).not.toBe("right]");
  });

  it("commits the completion accepted with its delimiter, the pair pending", () => {
    const target = session(String.raw`$a‸$`);
    press(target, String.raw`\lef ⇥`);
    expect(marked(target)).toBe(String.raw`$a\left(‸\right)$`);
    expect(target.pendingCloser).toBe(target.selection.focus);
  });

  it(String.raw`accepts the pending \right offered first`, () => {
    const target = session(String.raw`$a‸$`);
    press(target, String.raw`\left[x\r ⇥`);
    expect(marked(target)).toBe(String.raw`$a\left[x\right]‸$`);
  });

  it(String.raw`still commits \leftarrow and \rightarrow as themselves`, () => {
    const target = session(String.raw`$a‸$`);
    press(target, String.raw`\leftarrow␣\rightarrow␣`);
    expect(target.text).toBe(String.raw`$a\leftarrow\rightarrow$`);
  });
});
