import { describe, expect, it } from "vitest";
import { valueTagText } from "../../packages/app/src/ui/canvas-panel/canvas-value-tag";

const value = (open: string, text: string, close: string) => ({ open, text, close });

describe("value tags", () => {
  it("shows a command's values in source form when they fit", () => {
    expect(valueTagText("textcolor", [value("{", "red", "}")], 40)).toBe("\\textcolor{red}");
  });

  it("shortens the longest value first, keeping its start, as far as the construct is narrow", () => {
    const url = value("{", "https://example.org/a/very/long/path", "}");
    expect(valueTagText("href", [url], 60)).toBe("\\href{https://example.org/…}");
    expect(valueTagText("href", [url], 200)).toBe("\\href{https://example.org/a/very/lo…}");
    expect(valueTagText("href", [url], 400)).toBe("\\href{https://example.org/a/very/long/path}");
  });

  it("shows a colour whole over a short word", () => {
    expect(valueTagText("textcolor", [value("{", "red!60!black", "}")], 40)).toBe("\\textcolor{red!60!black}");
  });

  it("shows a wide box's values whole", () => {
    const values = [value("[", "t", "]"), value("[", "3cm", "]"), value("[", "c", "]"), value("{", "0.4\\textwidth", "}")];
    expect(valueTagText("parbox", values, 300)).toBe("\\parbox[t][3cm][c]{0.4\\textwidth}");
  });
});
