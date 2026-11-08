import { describe, expect, it } from "vitest";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { applySourcePatches, invertSourcePatches } from "../packages/core/src/edit/source-patches.js";
import { parseTikz } from "../packages/core/src/parser/index.js";

describe("structural edit source preservation", () => {
  const first = String.raw`\draw (0,0) -- (1,0);`;
  const second = String.raw`\draw (0,1) -- (1,1);`;
  const third = String.raw`\draw (0,2) -- (1,2);`;
  const body = `${first} % first gap\n  % second gap\n  ${second}\n  % third gap\n  ${third}`;

  it.each((["reorderElements", "groupElements"] as const).flatMap(kind => ["\n", "\r\n"].map(newline => ({ kind, newline }))))("retains sibling comments with $kind and $newline line endings", ({ kind, newline }) => {
    const source = `\\begin{tikzpicture}\n  ${body}\n\\end{tikzpicture}`.replaceAll("\n", newline);
    const result = applyEditAction(source, [], kind === "reorderElements"
      ? { kind, elementIds: ["path:0"], direction: "bringToFront" }
      : { kind, elementIds: ["path:0", "path:1"] });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    for (const comment of ["% first gap", "% second gap", "% third gap"]) {
      expect(result.newSource.split(comment)).toHaveLength(2);
    }
    if (newline === "\r\n") expect(result.newSource.replaceAll("\r\n", "")).not.toContain("\n");
    expect(parseTikz(result.newSource).diagnostics).toEqual([]);
    expect(applySourcePatches(result.newSource, invertSourcePatches(source, result.patches))).toEqual({ kind: "success", source });
  });

  it.each(["", "[name=group]"].flatMap(options => ["\n", "\r\n"].map(newline => ({ options, newline }))))("retains scope comments when ungrouping $options with $newline line endings", ({ options, newline }) => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}% header comment
  ${options}
    % leading comment
    ${first} % inline comment
    % middle comment
    ${second}
    % trailing comment
  \end{scope}${third}
\end{tikzpicture}`.replaceAll("\n", newline);
    const result = applyEditAction(source, [], { kind: "ungroupElements", elementIds: ["scope:0"] });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    for (const comment of ["% header comment", "% leading comment", "% inline comment", "% middle comment", "% trailing comment"]) {
      expect(result.newSource.split(comment)).toHaveLength(2);
    }
    if (newline === "\r\n") expect(result.newSource.replaceAll("\r\n", "")).not.toContain("\n");
    const parsed = parseTikz(result.newSource);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.figure.body).toHaveLength(3);
    expect(result.newSource).not.toContain("name=group");
    expect(applySourcePatches(result.newSource, invertSourcePatches(source, result.patches))).toEqual({ kind: "success", source });
  });

  it("keeps a comment-only scope body when ungrouping", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    % preserve this note
  \end{scope}
\end{tikzpicture}`;
    const result = applyEditAction(source, [], { kind: "ungroupElements", elementIds: ["scope:0"] });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    expect(result.newSource).toContain("% preserve this note");
    expect(result.newSource).not.toContain("\\begin{scope}");
    expect(parseTikz(result.newSource).diagnostics).toEqual([]);
  });
});
