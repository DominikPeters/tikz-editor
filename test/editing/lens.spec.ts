import { describe, expect, it } from "vitest";
import { createCommandTable } from "../../packages/core/src/editing/commands/index.js";
import { lensEdit } from "../../packages/core/src/editing/operations/index.js";
import { parseScenarioKeys } from "../../packages/core/src/editing/testing/index.js";
import { KeystrokeSession, type FuzzKey } from "./fuzz/keystroke-session.js";

/**
 * The source lens (R13): ⌘E opens the raw source of the innermost
 * construct around the caret, or of the selection, edited in place as
 * typed; Esc closes it and keeps what it wrote.
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

/** The text with the lens span marked `«…»`. */
function lensed(target: KeystrokeSession): string {
  const lens = target.lens();
  const { text } = target;
  return lens ? `${text.slice(0, lens.span.from)}«${text.slice(lens.span.from, lens.span.to)}»${text.slice(lens.span.to)}` : text;
}

describe("the source lens", () => {
  it.each([
    ["the style wrapper around the caret", "A \\textbf{bo‸ld} word.", "A «\\textbf{bold}» word."],
    ["the formula around the caret", "Let $x^‸2 + y$ be.", "Let «$x^2 + y$» be."],
    ["the overlay around the caret", "A \\only<2>{sh‸own} b.", "A «\\only<2>{shown}» b."],
    ["the paragraph in prose", "One.\n\nTwo th‸ree.\n\nFour.", "One.\n\n«Two three.»\n\nFour."],
    ["the item in a list", "\\begin{itemize}\n\\item On‸e\n\\item Two\n\\end{itemize}", "\\begin{itemize}\n«\\item One»\n\\item Two\n\\end{itemize}"],
    ["the selection", "A ⟦bold⟧ word.", "A «bold» word."],
  ])("opens on %s", (_name, marked, expected) => {
    const target = session(marked);
    press(target, "⌘E");
    expect(lensed(target)).toBe(expected);
  });

  it("writes its text over the span as typed, without the canvas's input rules", () => {
    const target = session("A \\textbf{bo‸ld} word.");
    press(target, "⌘E");
    // A half-typed command and an unbalanced brace: the lens writes them as they are.
    press(target, { kind: "lensText", text: "\\textbf<2>{bold} \\fr{", caret: 21 });
    expect(lensed(target)).toBe("A «\\textbf<2>{bold} \\fr{» word.");
    expect(target.selection).toEqual({ anchor: 23, focus: 23 });
  });

  it("closes on Esc, keeping what it wrote, and is undone as one step", () => {
    const target = session("A \\textbf{bo‸ld} word.");
    press(target, "⌘E", { kind: "lensText", text: "\\textbf{bolder}", caret: 14 }, { kind: "lensText", text: "\\textit{bolder}", caret: 7 }, "Esc");
    expect(target.lens()).toBeNull();
    expect(target.text).toBe("A \\textit{bolder} word.");
    press(target, "⌘Z");
    expect(target.text).toBe("A \\textbf{bold} word.");
  });

  it("closes on any other edit", () => {
    const target = session("A \\textbf{bo‸ld} word.");
    press(target, "⌘E", { kind: "select", anchor: 0, focus: 0 });
    expect(target.lens()).toBeNull();
  });

  it("patches only what changed, so positions elsewhere in the span keep their place", () => {
    expect(lensEdit("a \\textbf{bold} b", { from: 2, to: 15 }, "\\textbf{bolder}")).toEqual({
      patch: { from: 14, to: 14, insert: "er" },
      span: { from: 2, to: 17 },
    });
    expect(lensEdit("abc", { from: 0, to: 3 }, "abc")).toEqual({ patch: null, span: { from: 0, to: 3 } });
  });
});

describe("the quick fix for recovered source (T6)", () => {
  it("writes the missing closers where recovery put them, innermost first, as one step", () => {
    const target = session("‸A \\textbf{bo $x and more.\n\nNext.");
    press(target, { kind: "fixClosers" });
    expect(target.text).toBe("A \\textbf{bo $x and more.$}\n\nNext.");
    press(target, "⌘Z");
    expect(target.text).toBe("A \\textbf{bo $x and more.\n\nNext.");
  });
});
