import { describe, expect, it } from "vitest";

import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { TIKZPICTURE_GLOBAL_TARGET_ID } from "../packages/core/src/edit/property-target.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";

type EntryPoint = "picture" | "scope" | "inline" | "braced inline";
const ENTRY_POINTS: EntryPoint[] = ["picture", "scope", "inline", "braced inline"];
const DRAW = String.raw`\draw (0,0) -- (1,0);`;

function wrap(entryPoint: EntryPoint, contents: string): string {
  switch (entryPoint) {
    case "picture": return `\\begin{tikzpicture}${contents}\\end{tikzpicture}`;
    case "scope": return `\\begin{tikzpicture}\\begin{scope}${contents}\\end{scope}\\end{tikzpicture}`;
    case "inline": return `\\tikz${contents}`;
    case "braced inline": return `\\tikz${contents.replace(DRAW, `{${DRAW}};`)}`;
  }
}

function optionList(parsed: ReturnType<typeof parseTikz>, entryPoint: EntryPoint) {
  const first = parsed.figure.body[0];
  return entryPoint === "scope" && first?.kind === "Scope" ? first.options : parsed.figure.options;
}

function retainedComments(parsed: ReturnType<typeof parseTikz>): number {
  let count = 0;
  parsed.tree.iterate({ enter(node) { if (node.name === "Comment") count += 1; } });
  return count;
}

describe("optional argument comment trivia", () => {
  it.each(["", "% retained header\n", "% retained header\r\n", "% retained header\r"])(
    "recovers a malformed inline option body after trivia %j",
    (trivia) => {
      const source = `\\tikz${trivia}[draw ${DRAW}`;
      const parsed = parseTikz(source, { recover: true });
      expect(parsed.figure.options).toBeUndefined();
      const path = parsed.figure.body.find((statement) => statement.kind === "Path");
      expect(path?.kind).toBe("Path");
      expect(source.slice(path?.span.from, path?.span.to)).toBe(DRAW);
      expect(parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    }
  );

  it.each(ENTRY_POINTS.flatMap((entryPoint) => ["\n", "\r\n", "\r"].map((lineBreak) => ({ entryPoint, lineBreak }))))(
    "retains $entryPoint options and comments with $lineBreak line endings",
    ({ entryPoint, lineBreak }) => {
      const options = "[scale=2, red, line width=1.5pt]";
      const trivia = `% first ] { comment${lineBreak}% second comment${lineBreak} `;
      const source = wrap(entryPoint, `${trivia}${options}${DRAW}`);
      const control = wrap(entryPoint, `${lineBreak}${options}${DRAW}`);
      const parsed = parseTikz(source, { recover: false });
      const actual = optionList(parsed, entryPoint);
      expect(actual?.raw).toBe(options);
      expect(source.slice(actual?.span.from, actual?.span.to)).toBe(options);
      expect(actual?.entries.map(({ raw }) => raw)).toEqual(optionList(parseTikz(control), entryPoint)?.entries.map(({ raw }) => raw));
      expect(parsed.diagnostics).toEqual([]);
      expect(retainedComments(parsed)).toBe(2);
      expect(renderTikzToSvg(source).svg.svg).toBe(renderTikzToSvg(control).svg.svg);
      if (entryPoint === "picture") {
        expect(parsed.figures[0]?.optionsSpan).toEqual(actual?.span);
      }
    }
  );

  it.each(ENTRY_POINTS)("retains comments before a $0 body when there are no options", (entryPoint) => {
    for (const body of ["", DRAW]) {
      const source = wrap(entryPoint, `% header comment\n% second comment\n${body}`);
      const parsed = parseTikz(source, { recover: false });
      expect(optionList(parsed, entryPoint)).toBeUndefined();
      expect(parsed.diagnostics).toEqual([]);
      expect(retainedComments(parsed)).toBe(2);
      expect(renderTikzToSvg(source).svg.svg).toBe(renderTikzToSvg(wrap(entryPoint, body)).svg.svg);
    }
  });

  it("edits the existing picture options while preserving preceding comments", () => {
    const source = wrap("picture", `% preserve header\n[scale=2, red]${DRAW}`);
    const result = applyEditAction(source, [], {
      kind: "setProperty", elementId: TIKZPICTURE_GLOBAL_TARGET_ID, level: "command", key: "scale", value: "3"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error("Expected picture option edit to succeed");
    expect(result.newSource).toBe(source.replace("scale=2", "scale=3"));
    const parsed = parseTikz(result.newSource, { recover: false });
    expect(parsed.figure.options?.raw).toBe("[scale=3, red]");
    expect(parsed.figures[0]?.optionsSpan).toEqual(parsed.figure.options?.span);
  });

  it("keeps the inline command boundary before an adjacent option or comment", () => {
    for (const suffix of [`[scale=2]${DRAW}`, `% comment\n[scale=2]${DRAW}`]) {
      const parsed = parseTikz(`\\tikz${suffix}`, { recover: false });
      const commands: string[] = [];
      parsed.tree.iterate({ enter(node) { if (node.name === "InlineTikzCmd") commands.push(parsed.source.slice(node.from, node.to)); } });
      expect(commands).toEqual(["\\tikz"]);
      expect(parsed.figure.options?.raw).toBe("[scale=2]");
    }
    const longer = parseTikz(String.raw`\tikzexample{literal}`);
    let inlineCount = 0;
    longer.tree.iterate({ enter(node) { if (node.name === "TikzInline") inlineCount += 1; } });
    expect(inlineCount).toBe(0);
  });
});

describe("brace-protected option brackets", () => {
  it.each([
    "[test/.style={label={above:{]}}},scale=2]",
    "[test/.style={label={above:{[x]}}},scale=2]",
    "[test/.style={label={above:{] ]}}},scale=2]",
    String.raw`[test/.style={label={above:{\{]}}},scale=2]`,
    "[scale=2, % ] { fake delimiters\nred]"
  ])("keeps the complete original option span for %s", (options) => {
    const source = wrap("picture", `% header\n${options}${DRAW}`);
    const parsed = parseTikz(source, { recover: false });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.figure.options?.raw).toBe(options);
    expect(source.slice(parsed.figures[0]?.optionsSpan?.from, parsed.figures[0]?.optionsSpan?.to)).toBe(options);
    expect(parsed.figures[0]?.optionsSpan).toEqual(parsed.figure.options?.span);
    const style = parsed.figure.options?.entries.find((entry) => entry.kind === "kv" && entry.key === "test/.style");
    if (style?.kind === "kv") {
      expect(style.valueRaw).toBe(options.slice(options.indexOf("=") + 1, options.lastIndexOf(",")));
    }
    const result = applyEditAction(source, [], {
      kind: "setProperty", elementId: TIKZPICTURE_GLOBAL_TARGET_ID, level: "command", key: "scale", value: "3"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error("Expected protected-bracket option edit to succeed");
    expect(result.newSource).toBe(source.replace("scale=2", "scale=3"));
    expect(parseTikz(result.newSource, { recover: false }).figure.options?.raw).toBe(options.replace("scale=2", "scale=3"));
  });

  it("keeps literal closing brackets in a preceding style payload", () => {
    const source = String.raw`\tikzset{test/.style={label={above:{]}}}}
\begin{tikzpicture}\node[test] {x};\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: false, includeContextDefinitions: true });
    const style = parsed.figure.body.find((statement) => statement.kind === "TikzSet");
    expect(parsed.diagnostics).toEqual([]);
    expect(style?.kind).toBe("TikzSet");
    if (style?.kind !== "TikzSet") throw new Error("Expected retained TikZ style");
    expect(style.optionList.entries[0]).toMatchObject({ key: "test/.style", valueRaw: "{label={above:{]}}}" });
  });
});
