import { describe, expect, it } from "vitest";

import {
  activeTextFormatWrapper,
  applyTextColorCommand,
  isTextFormatWrapSafe,
  scanTextFormatWrappers,
  toggleTextFormatCommand,
} from "../packages/core/src/text/format-commands.js";

describe("text format command toggles", () => {
  it("wraps a plain selection and selects the wrapped content", () => {
    const text = "Alpha beta gamma";
    const result = toggleTextFormatCommand(text, 6, 10, "textbf")!;
    expect(result.nextText).toBe("Alpha \\textbf{beta} gamma");
    expect(result.nextText.slice(result.selectionStart, result.selectionEnd)).toBe("beta");
  });

  it("trims whitespace at the selection edges before wrapping", () => {
    const text = "Alpha beta gamma";
    const result = toggleTextFormatCommand(text, 5, 11, "textit")!;
    expect(result.nextText).toBe("Alpha \\textit{beta} gamma");
  });

  it("inserts an empty wrapper at a collapsed caret", () => {
    const text = "Alpha ";
    const result = toggleTextFormatCommand(text, 6, 6, "textbf")!;
    expect(result.nextText).toBe("Alpha \\textbf{}");
    expect(result.selectionStart).toBe(result.selectionEnd);
    expect(result.nextText[result.selectionStart]).toBe("}");
  });

  it("unwraps when the selection sits inside a wrapper's content", () => {
    const text = "Alpha \\textbf{beta} gamma";
    const result = toggleTextFormatCommand(text, 14, 18, "textbf")!;
    expect(result.nextText).toBe("Alpha beta gamma");
    expect(result.nextText.slice(result.selectionStart, result.selectionEnd)).toBe("beta");
  });

  it("unwraps when the selection covers the whole wrapper", () => {
    const text = "Alpha \\textbf{beta} gamma";
    const result = toggleTextFormatCommand(text, 6, 19, "textbf")!;
    expect(result.nextText).toBe("Alpha beta gamma");
  });

  it("targets the innermost wrapper of the requested command", () => {
    const text = "\\textbf{one \\textbf{two} three}";
    const wrapper = activeTextFormatWrapper(text, 20, 23, "textbf")!;
    expect(text.slice(wrapper.contentFrom, wrapper.contentTo)).toBe("two");
  });

  it("does not treat a different command as active", () => {
    const text = "\\textit{beta}";
    expect(activeTextFormatWrapper(text, 8, 12, "textbf")).toBeNull();
    const result = toggleTextFormatCommand(text, 8, 12, "textbf")!;
    expect(result.nextText).toBe("\\textit{\\textbf{beta}}");
  });

  it("recognizes an alert wrapper with an overlay spec and unwraps it whole", () => {
    const text = "Alpha \\alert<2->{beta} gamma";
    const wrapper = activeTextFormatWrapper(text, 17, 21, "alert")!;
    expect(wrapper.from).toBe(6);
    const result = toggleTextFormatCommand(text, 17, 21, "alert")!;
    expect(result.nextText).toBe("Alpha beta gamma");
  });

  it("rejects unsafe selections instead of breaking the buffer", () => {
    expect(isTextFormatWrapSafe("a {b} c", 0, 7)).toBe(true);
    // Closing brace of a group opened outside the selection.
    expect(isTextFormatWrapSafe("{ab} c", 1, 5)).toBe(false);
    // Odd number of math toggles.
    expect(isTextFormatWrapSafe("a $x$ b", 0, 4)).toBe(false);
    // Paragraph break inside the selection.
    expect(isTextFormatWrapSafe("a\n\nb", 0, 4)).toBe(false);
    // Comment start inside the selection.
    expect(isTextFormatWrapSafe("a % b", 0, 5)).toBe(false);
    expect(toggleTextFormatCommand("{ab} c", 1, 5, "textbf")).toBeNull();
  });

  it("skips escaped command backslashes when scanning", () => {
    const wrappers = scanTextFormatWrappers("a \\\\textbf{x} b \\textbf{y}");
    expect(wrappers).toHaveLength(1);
    expect(wrappers[0].contentFrom).toBeGreaterThan(16);
  });

  it("applies a text color and replaces the color of an existing wrapper", () => {
    const wrapped = applyTextColorCommand("Alpha beta", 6, 10, "blue")!;
    expect(wrapped.nextText).toBe("Alpha \\textcolor{blue}{beta}");
    const inner = wrapped;
    const recolored = applyTextColorCommand(
      inner.nextText,
      inner.selectionStart,
      inner.selectionEnd,
      "red"
    )!;
    expect(recolored.nextText).toBe("Alpha \\textcolor{red}{beta}");
    const removed = applyTextColorCommand(
      recolored.nextText,
      recolored.selectionStart,
      recolored.selectionEnd,
      null
    )!;
    expect(removed.nextText).toBe("Alpha beta");
  });

  it("reads the current color from an enclosing textcolor wrapper", () => {
    const text = "\\textcolor{teal}{beta}";
    const wrapper = activeTextFormatWrapper(text, 17, 21, "textcolor")!;
    expect(wrapper.colorValue).toBe("teal");
  });
});
