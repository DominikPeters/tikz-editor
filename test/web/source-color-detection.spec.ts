import { describe, expect, it } from "vitest";
import { parser } from "@tikz-editor/lezer-tikz";
import {
  collectDeclaredColors,
  collectDetectedColors,
  resolveDeclaredColorAnalysis,
  resolveDeclaredColors
} from "../../packages/app/src/colors/source-color-detection";

function detect(source: string) {
  const tree = parser.parse(source);
  const ranges = [{ from: 0, to: source.length }];
  const declared = collectDeclaredColors(source, tree);
  const occurrences = collectDetectedColors(source, tree, ranges, declared);
  return { declared, occurrences };
}

function findSingleOccurrence(
  occurrences: ReturnType<typeof detect>["occurrences"],
  predicate: (value: ReturnType<typeof detect>["occurrences"][number]) => boolean
) {
  const found = occurrences.filter(predicate);
  expect(found).toHaveLength(1);
  return found[0];
}

describe("source color detection", () => {
  it("detects option key-value color tokens and exact spans", () => {
    const source = "\\path[draw=red, fill=blue!20, text=#00ffaa] (0,0) -- (1,1);";
    const { occurrences } = detect(source);

    const draw = findSingleOccurrence(occurrences, (value) => value.source === "option-value" && value.optionKey === "draw");
    const fill = findSingleOccurrence(occurrences, (value) => value.source === "option-value" && value.optionKey === "fill");
    const text = findSingleOccurrence(occurrences, (value) => value.source === "option-value" && value.optionKey === "text");

    expect(draw.token).toBe("red");
    expect(draw.from).toBe(source.indexOf("red"));
    expect(draw.to).toBe(source.indexOf("red") + "red".length);
    expect(draw.editable).toBe(true);

    expect(fill.token).toBe("blue!20");
    expect(fill.from).toBe(source.indexOf("blue!20"));
    expect(fill.to).toBe(source.indexOf("blue!20") + "blue!20".length);
    expect(fill.editable).toBe(true);

    expect(text.token).toBe("#00ffaa");
    expect(text.from).toBe(source.indexOf("#00ffaa"));
    expect(text.to).toBe(source.indexOf("#00ffaa") + "#00ffaa".length);
    expect(text.editable).toBe(true);
  });

  it("detects color flags and ignores non-color flags", () => {
    const source = "\\path[red, thick] (0,0) -- (1,1);";
    const { occurrences } = detect(source);

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.source).toBe("option-flag");
    expect(occurrences[0]?.token).toBe("red");
    expect(occurrences[0]?.from).toBe(source.indexOf("red"));
    expect(occurrences[0]?.to).toBe(source.indexOf("red") + "red".length);
  });

  it("detects colors inside nested style payloads", () => {
    const source = "\\draw[every node/.style={fill=orange!30, draw=black}] (0,0) -- (1,1);";
    const { occurrences } = detect(source);

    const nestedFill = findSingleOccurrence(
      occurrences,
      (value) => value.source === "option-value" && value.optionKey === "fill" && value.token === "orange!30"
    );
    const nestedDraw = findSingleOccurrence(
      occurrences,
      (value) => value.source === "option-value" && value.optionKey === "draw" && value.token === "black"
    );

    expect(nestedFill.from).toBe(source.indexOf("orange!30"));
    expect(nestedDraw.from).toBe(source.indexOf("black"));
  });

  it("detects editable colorlet source expression and resolves declared usage", () => {
    const source = "\\colorlet{brand}{blue!60!black}\n\\path[draw=brand] (0,0) -- (1,1);";
    const { declared, occurrences } = detect(source);

    const declaredBrand = declared.get("brand");
    expect(declaredBrand).toBeTruthy();

    const colorlet = findSingleOccurrence(occurrences, (value) => value.source === "colorlet");
    expect(colorlet.token).toBe("blue!60!black");
    expect(colorlet.from).toBe(source.indexOf("blue!60!black"));
    expect(colorlet.editable).toBe(true);

    const draw = findSingleOccurrence(
      occurrences,
      (value) => value.source === "option-value" && value.optionKey === "draw" && value.token === "brand"
    );
    expect(draw.cssColor).toBe(declaredBrand);
  });

  it("detects definecolor spec as preview-only and resolves downstream references", () => {
    const source = "\\definecolor{accent}{rgb}{1,0.5,0}\n\\path[draw=accent] (0,0) -- (1,1);";
    const { declared, occurrences } = detect(source);

    expect(declared.get("accent")).toBe("#ff8000");

    const definecolor = findSingleOccurrence(occurrences, (value) => value.source === "definecolor");
    expect(definecolor.token).toBe("1,0.5,0");
    expect(definecolor.from).toBe(source.indexOf("1,0.5,0"));
    expect(definecolor.editable).toBe(false);
    expect(definecolor.readOnlyReason).toContain("read-only");

    const draw = findSingleOccurrence(
      occurrences,
      (value) => value.source === "option-value" && value.optionKey === "draw" && value.token === "accent"
    );
    expect(draw.cssColor).toBe("#ff8000");
  });

  it("resolves colorlet aliases collected from parser context definitions", () => {
    const source = String.raw`\documentclass{article}
\colorlet{alternativebarcolor}{black!15}
\begin{tikzpicture}
  \fill[alternativebarcolor] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const { declared, occurrences } = detect(source);

    expect(declared.get("alternativebarcolor")).toBeTruthy();
    const fill = findSingleOccurrence(
      occurrences,
      (value) => value.source === "option-flag" && value.token === "alternativebarcolor"
    );
    expect(fill.cssColor).toBe(declared.get("alternativebarcolor") ?? null);
  });

  it("does not emit swatches for non-color option tokens", () => {
    const source = "\\draw[->, line width=2pt] (0,0) -- (1,1);";
    const { occurrences } = detect(source);
    expect(occurrences).toHaveLength(0);
  });

  it("reuses declared color resolution across non-declaration edits", () => {
    const before = "\\colorlet{brand}{blue!60!black}\n\\path[draw=brand] (0,0) -- (1,1);";
    const after = "\\colorlet{brand}{blue!60!black}\n\\path[draw=brand] (2,3) -- (4,5);";

    const first = resolveDeclaredColors(before, parser.parse(before));
    const second = resolveDeclaredColors(after, parser.parse(after));

    expect(second).toBe(first);
    expect(second.get("brand")).toBe("#000099");
  });

  it("invalidates declared color resolution when declarations change", () => {
    const before = "\\colorlet{brand}{blue!60!black}\n\\path[draw=brand] (0,0) -- (1,1);";
    const after = "\\colorlet{brand}{red!60!black}\n\\path[draw=brand] (0,0) -- (1,1);";

    const first = resolveDeclaredColors(before, parser.parse(before));
    const second = resolveDeclaredColors(after, parser.parse(after));

    expect(second).not.toBe(first);
    expect(second.get("brand")).toBe("#990000");
  });

  it("refreshes declaration ranges when signature stays the same but offsets move", () => {
    const before = "\\colorlet{brand}{blue!60!black}\n\\path[draw=brand] (0,0) -- (1,1);";
    const after = " % moved by prefix\n\\colorlet{brand}{blue!60!black}\n\\path[draw=brand] (0,0) -- (1,1);";

    const first = resolveDeclaredColorAnalysis(before, parser.parse(before));
    const second = resolveDeclaredColorAnalysis(after, parser.parse(after));

    expect(second.colors).toBe(first.colors);
    expect(second.ranges).not.toEqual(first.ranges);
    expect(second.ranges[0]?.from).toBeGreaterThan(first.ranges[0]?.from ?? 0);
  });

  it("keeps duplicate color occurrences as independent spans", () => {
    const source = "\\path[draw=red, fill=red] (0,0) rectangle (1,1);";
    const { occurrences } = detect(source);
    const reds = occurrences.filter(
      (value) => value.source === "option-value" && (value.optionKey === "draw" || value.optionKey === "fill")
    );

    expect(reds).toHaveLength(2);
    expect(reds[0]?.from).toBe(source.indexOf("red"));
    expect(reds[1]?.from).toBe(source.lastIndexOf("red"));
    expect(reds[0]?.from).not.toBe(reds[1]?.from);
  });
});
