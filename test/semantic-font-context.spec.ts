import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";

const source = String.raw`\begin{tikzpicture}[font=\scriptsize]\node[draw] {A};\end{tikzpicture}`;
const ambient = { initialFont: String.raw`\sffamily\bfseries\fontsize{12}{14.5}\selectfont`, namedFontSizes: { scriptsize: 8 } };

describe("TikZ ambient font context", () => {
  it("selects class sizes while retaining ambient family and weight", () => {
    const page = renderTikzToSvg(source, { evaluate: ambient });
    expect(page.semantic.diagnostics).toEqual([]);
    const text = page.semantic.scene.elements.find(element => element.kind === "Text");
    expect(text?.style).toMatchObject({ fontSize: 8, fontFamily: "sans", fontWeight: "bold" });
  });
  it("resolves em padding against the ambient font independently of node text size", () => {
    const implicit = renderTikzToSvg(source, { evaluate: ambient });
    const explicit = renderTikzToSvg(source.replace("node[draw]", "node[draw,inner sep=3.9996pt]"), { evaluate: ambient });
    expect(implicit.semantic.scene.bounds).toEqual(explicit.semantic.scene.bounds);
  });
  it("replaces earlier TikZ font properties using the ambient defaults", () => {
    const page = renderTikzToSvg(String.raw`\begin{tikzpicture}[font=\itshape]\node[font=\scriptsize] {A};\end{tikzpicture}`, { evaluate: ambient });
    expect(page.semantic.scene.elements.find(element => element.kind === "Text")?.style).toMatchObject({ fontSize: 8, fontFamily: "sans", fontStyle: "normal", fontWeight: "bold" });
  });
});
