import { describe, expect, it } from "vitest";
import { createCommandTable } from "../../packages/core/src/editing/commands/index.js";
import { valueProblem, valueSource } from "../../packages/core/src/editing/operations/index.js";
import { parseScenarioKeys } from "../../packages/core/src/editing/testing/index.js";
import { KeystrokeSession, type FuzzKey } from "./fuzz/keystroke-session.js";

/**
 * The value editor (O8): a command whose values the preview does not show
 * is never written with them empty. The chip opens the editor, and the
 * command is written whole when its fields are filled.
 */
const commands = createCommandTable();

/** A session on `text`; `⟦…⟧` marks a selection, `‸` a caret. */
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

/** The text with the selection marked as `session` reads it. */
function marked(target: KeystrokeSession): string {
  const { anchor, focus } = target.selection;
  const from = Math.min(anchor, focus);
  const to = Math.max(anchor, focus);
  const { text } = target;
  return from === to ? `${text.slice(0, from)}‸${text.slice(from)}` : `${text.slice(0, from)}⟦${text.slice(from, to)}⟧${text.slice(to)}`;
}

const pick = (...values: string[]): FuzzKey => ({ kind: "pick", values });

describe("the value editor", () => {
  it("asks for the colour first, and wraps the selection once it is given", () => {
    const target = session("The ⟦risk⟧ is low.");
    press(target, "\\textcolor␣");
    expect(target.text).toBe("The risk is low.");
    expect(target.picker()).toMatchObject({ name: "textcolor", seed: "" });
    press(target, pick("red!60!black"));
    expect(marked(target)).toBe("The \\textcolor{red!60!black}{⟦risk⟧} is low.");
    expect(target.pickerOpen()).toBe(false);
  });

  it("writes nothing on Esc, the selection kept", () => {
    const target = session("The ⟦risk⟧ is low.");
    press(target, "\\textcolor␣", "Esc");
    expect(marked(target)).toBe("The ⟦risk⟧ is low.");
    expect(target.pickerOpen()).toBe(false);
  });

  it("stays open on a value that cannot be written", () => {
    const target = session("The ⟦risk⟧ is low.");
    press(target, "\\textcolor⏎", pick("red!!"));
    expect(target.text).toBe("The risk is low.");
    expect(target.pickerOpen()).toBe(true);
    press(target, pick(""));
    expect(target.pickerOpen()).toBe(true);
  });

  it("puts the caret into the link text after the URL, with % and # escaped", () => {
    const target = session("See ‸.");
    press(target, "\\href␣", pick("https://example.org/a%20b#part"), "here");
    expect(marked(target)).toBe("See \\href{https://example.org/a\\%20b\\#part}{here‸}.");
  });

  it("takes typed braces: `{` opens the first field, `}` closes it and the next `{` is the argument's own", () => {
    const target = session("A ‸ word.");
    press(target, "\\textcolor{");
    expect(target.picker()).toMatchObject({ name: "textcolor", key: "brace" });
    press(target, { kind: "pick", values: ["blue"], viaBrace: true }, "{risk}");
    expect(marked(target)).toBe("A \\textcolor{blue}{risk}‸ word.");
  });

  it("starts the first field with a character typed right after the name", () => {
    const target = session("a‸b");
    press(target, "\\hspace2");
    expect(target.picker()).toMatchObject({ name: "hspace", seed: "2" });
    press(target, pick("2em"));
    expect(marked(target)).toBe("a\\hspace{2em}‸b");
  });

  it("starts the first field with a selection the command replaces", () => {
    const target = session("Go to ⟦https://example.org⟧ now.");
    press(target, "\\url␣");
    expect(target.picker()).toMatchObject({ name: "url", seed: "https://example.org" });
    press(target, pick("https://example.org"));
    expect(marked(target)).toBe("Go to \\url{https://example.org}‸ now.");
  });

  it("asks for the argument `[` or `<` opened, and leaves it out when empty", () => {
    const model = session("A ‸.");
    press(model, "\\textcolor[", pick("rgb", "1,0,0"), "x");
    expect(marked(model)).toBe("A \\textcolor[rgb]{1,0,0}{x‸}.");
    const slides = session("A ‸.");
    press(slides, "\\textcolor<", pick("", "red"));
    expect(marked(slides)).toBe("A \\textcolor{red}{‸}.");
  });

  it("writes a text command in math inside \\text", () => {
    const target = session("$x = ‸$");
    press(target, "\\href␣", pick("https://example.org"), "y");
    expect(marked(target)).toBe("$x = \\text{\\href{https://example.org}{y‸}}$");
  });

  it("is one undo step", () => {
    const target = session("The ⟦risk⟧ is low.");
    press(target, "\\textcolor␣", pick("red"), "⌘Z");
    expect(target.text).toBe("The risk is low.");
  });

  it("asks for keys and lengths too, and never writes them empty", () => {
    for (const [keys, value, expected] of [
      ["\\ref␣", "sec:intro", "See \\ref{sec:intro}‸."],
      ["\\label⏎", "fig:one", "See \\label{fig:one}‸."],
      ["\\vspace⇥", "1em", "See \\vspace{1em}‸."],
      ["\\footnote␣", "A note.", "See \\footnote{A note.}‸."],
    ] as const) {
      const target = session("See ‸.");
      press(target, keys);
      expect(target.text).toBe("See .");
      press(target, pick(value));
      expect(marked(target)).toBe(expected);
    }
  });

  it("edits values already written, in one step", () => {
    const text = "A \\textcolor[rgb]{1,0,0}{risk} and \\hspace{1em} b.";
    const target = session(`‸${text}`);
    const span = (value: string) => ({ from: text.indexOf(value), to: text.indexOf(value) + value.length });
    press(target, { kind: "setValues", edits: [{ span: span("1em"), text: "2em" }, { span: span("rgb"), text: "" }] });
    // (Without its model, `1,0,0` is no colour: refused as a whole.)
    expect(target.text).toBe(text);
    press(target, { kind: "setValues", edits: [{ span: span("1em"), text: "2em" }, { span: span("1,0,0"), text: "0,0,1" }] });
    expect(target.text).toBe("A \\textcolor[rgb]{0,0,1}{risk} and \\hspace{2em} b.");
    press(target, { kind: "setValues", edits: [{ span: span("1em"), text: "" }] });
    expect(target.text).toBe("A \\textcolor[rgb]{0,0,1}{risk} and \\hspace{2em} b.");
    press(target, "⌘Z");
    expect(target.text).toBe(text);
  });
});

describe("value checks", () => {
  it("keeps an unbraced value one token, and never removes it", () => {
    const text = "$\\bigl(x\\bigr)=0$";
    const target = session(`‸${text}`);
    const span = { from: text.indexOf(")"), to: text.indexOf(")") + 1 };
    press(target, { kind: "setValues", edits: [{ span, text: "" }] });
    expect(target.text).toBe(text);
    press(target, { kind: "setValues", edits: [{ span, text: "\\rangle" }] });
    expect(target.text).toBe("$\\bigl(x\\bigr\\rangle=0$");
  });

  it("asks for \\temporal's slides, which it cannot do without, and keeps them", () => {
    const target = session("A ‸.");
    press(target, "\\temporal␣");
    expect(target.text).toBe("A .");
    press(target, pick(""));
    expect(target.pickerOpen()).toBe(true);
    press(target, pick("2"), "x");
    expect(marked(target)).toBe("A \\temporal<2>{x‸}{}{}.");
    const text = target.text;
    press(target, { kind: "setValues", edits: [{ span: { from: text.indexOf("<2>") + 1, to: text.indexOf("<2>") + 2 }, text: "" }] });
    expect(target.text).toBe(text);
  });

  it("keeps \\setbeamertemplate's option, without which it reads what follows as the template", () => {
    const text = "\\setbeamertemplate{caption}[numbered]\n\\begin{figure}x\\end{figure}";
    const target = session(`‸${text}`);
    press(target, { kind: "setValues", edits: [{ span: { from: text.indexOf("numbered"), to: text.indexOf("numbered") + 8 }, text: "" }] });
    expect(target.text).toBe(text);
  });

  it("keeps a table's columns: a specification cannot take fewer than a row uses", () => {
    const text = "\\begin{tabular}{lr}\nA & 1\\\\\nB & 2\n\\end{tabular}";
    const target = session(`‸${text}`);
    const span = { from: text.indexOf("lr"), to: text.indexOf("lr") + 2 };
    press(target, { kind: "setValues", edits: [{ span, text: "c" }] });
    expect(target.text).toBe(text);
    press(target, { kind: "setValues", edits: [{ span, text: "*{2}{c}" }] });
    expect(target.text).toBe(text.replace("{lr}", "{*{2}{c}}"));
  });

  it.each([
    ["color", "red", null],
    ["color", "red!30!blue", null],
    ["color", "-red!30", null],
    ["color", "red!!", "Not an xcolor colour (red, red!30, red!30!blue)"],
    ["dimension", "2em", null],
    ["dimension", "-.5\\textwidth", null],
    ["dimension", "\\fill", null],
    ["dimension", "1em plus 1fil", null],
    ["dimension", "\\stretch{2}", null],
    ["dimension", "2", "Not a TeX length (2em, 0.5\\textwidth, \\fill)"],
    ["label-key", "sec:intro", null],
    ["label-key", "a#b", "A % or # needs a backslash"],
    ["value", "{x", "Braces do not balance"],
    ["value", "50%", "A % or # needs a backslash"],
    ["url", "https://x.org/50%", null],
    ["overlay", "2-", null],
    ["overlay", "2>", "Not an overlay specification (2-, +-, 1-3)"],
  ] as const)("%s %s", (kind, text, problem) => {
    expect(valueProblem(kind, text)).toBe(problem);
  });

  it("escapes a URL's % and #, and braces a ] in brackets", () => {
    expect(valueSource("url", " a%b\\%c#d ")).toBe("a\\%b\\%c\\#d");
    expect(valueSource("options", "x]", "[")).toBe("{x]}");
  });
});
