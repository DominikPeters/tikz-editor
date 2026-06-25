import { describe, expect, it } from "vitest";
import { applyEditAction, PROPERTY_WRITE_CLEANUP_NOOP_REASON } from "../packages/core/src/edit/actions.js";
import { makeStyleSourceTargetId, TIKZPICTURE_GLOBAL_TARGET_ID } from "../packages/core/src/edit/property-target.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { parseTikz } from "../packages/core/src/parser/index.js";

// ── setProperty ───────────────────────────────────────────────────────────────

describe("applyEditAction – setProperty", () => {
  const lineWidthPresetKeys = [
    "ultra thin",
    "very thin",
    "thin",
    "semithick",
    "thick",
    "very thick",
    "ultra thick"
  ];

  function resolveFirstGridKeywordId(source: string): string {
    const parsed = parseTikz(source);
    for (const statement of parsed.figure.body) {
      if (statement.kind !== "Path") {
        continue;
      }
      const keyword = statement.items.find((item) => item.kind === "PathKeyword" && item.keyword === "grid");
      if (keyword && keyword.kind === "PathKeyword") {
        return keyword.id;
      }
    }
    throw new Error("Expected at least one grid path keyword");
  }

  it("updates an existing command option key", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, line width=0.4pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "line width",
      value: "1.2pt"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[blue, line width=1.2pt] (0,0) -- (1,0);");
      expect(result.patches).toHaveLength(1);
    }
  });

  it("rejects empty setProperty keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "   ",
      value: "red"
    });

    expect(result).toEqual({
      kind: "error",
      message: "Cannot set an empty option key"
    });
  });

  it("returns unsupported for no-op setProperty writes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "blue",
      clearKeys: ["", "draw"]
    });

    expect(result).toEqual({
      kind: "unsupported",
      reason: "setProperty would not change the source."
    });
  });

  it("disables and enables multiline command options by comment toggling exact source text", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[
    blue,
    line width={max(1pt,2pt)},
    decoration={markings, mark=at position 0.5 with {\arrow{>}}},
    % keep this note
  ] (0,0) -- (1,0);
\end{tikzpicture}`;

    const disabled = applyEditAction(
      source,
      [],
      {
        kind: "setProperty",
        elementId: "path:0",
        level: "command",
        key: "line width",
        value: "ignored",
        commentMode: "disable",
        commentSourceText: "line width={max(1pt,2pt)},"
      },
      { parseOptions: { indentSize: 4 } }
    );

    expect(disabled.kind).toBe("success");
    if (disabled.kind !== "success") {
      throw new Error("Expected comment disable to succeed");
    }
    expect(disabled.newSource).toContain("    % line width={max(1pt,2pt)},");
    expect(disabled.newSource).toContain("    % keep this note");
    expect(disabled.newSource).toContain("decoration={markings, mark=at position 0.5 with {\\arrow{>}}}");

    const enabled = applyEditAction(disabled.newSource, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "line width",
      value: "ignored",
      commentMode: "enable",
      commentSourceText: "% line width={max(1pt,2pt)},"
    });

    expect(enabled.kind).toBe("success");
    if (enabled.kind !== "success") {
      throw new Error("Expected comment enable to succeed");
    }
    expect(enabled.newSource).toContain("  line width={max(1pt,2pt)},");
    expect(enabled.newSource).not.toContain("% line width={max(1pt,2pt)}");
  });

  it("comment toggles inline options and preserves escaped percent signs", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=blue, text={100\% sure}, dashed] (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "dashed",
      value: "ignored",
      commentMode: "disable"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected inline comment toggle to succeed");
    }
    expect(result.newSource).toContain("text={100\\% sure}");
    expect(result.newSource).toContain("% dashed,");
  });

  it("falls back from stale exact comment text to normalized keys in nested option lists", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=blue, decorate, decoration={markings, mark=at position 0.5 with {\arrow{>}}}, preaction={[draw=red]}, text={a,b[c]}] (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "ignored",
      commentMode: "disable",
      commentSourceText: "draw=green"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected nested option comment toggle to succeed");
    }
    expect(result.newSource).toContain("% draw=blue,");
    expect(result.newSource).toContain("decoration={markings, mark=at position 0.5 with {\\arrow{>}}}");
    expect(result.newSource).toContain("preaction={[draw=red]}");
    expect(result.newSource).toContain("text={a,b[c]}");
  });

  it("reports unsupported comment toggles for missing or ineligible matches", () => {
    const noMatch = applyEditAction(String.raw`\begin{tikzpicture}
  \draw[blue] (0,0) -- (1,0);
\end{tikzpicture}`, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "fill",
      value: "ignored",
      commentMode: "disable"
    });
    expect(noMatch).toEqual({
      kind: "unsupported",
      reason: "Could not find a matching declaration to toggle."
    });

    const noOptions = applyEditAction(String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "ignored",
      commentMode: "disable"
    });
    expect(noOptions).toEqual({
      kind: "unsupported",
      reason: "No writable option list is available for comment toggling."
    });
  });

  it("comment toggles around empty and malformed commented option fragments", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[
    % ,
    draw=red
  ] (0,0) -- (1,0);
\end{tikzpicture}`;

    const disabled = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "ignored",
      commentMode: "disable"
    });

    expect(disabled.kind).toBe("success");
    if (disabled.kind !== "success") {
      throw new Error("Expected comment toggle with empty commented fragment to succeed");
    }
    expect(disabled.newSource).toContain(String.raw`% ,
    % draw=red,`);

    const malformed = String.raw`\begin{tikzpicture}
  \draw[
    % ],
    % draw=red,
    fill=blue
  ] (0,0) -- (1,0);
\end{tikzpicture}`;
    const enabled = applyEditAction(malformed, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "ignored",
      commentMode: "enable"
    });

    expect(enabled.kind).toBe("success");
    if (enabled.kind !== "success") {
      throw new Error("Expected comment toggle with malformed commented fragment to succeed");
    }
    expect(enabled.newSource).toContain(String.raw`% ],
    draw=red,
    fill=blue`);
  });

  it("rejects empty comment-toggle keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: " ",
      value: "ignored",
      commentMode: "disable"
    });

    expect(result).toEqual({
      kind: "error",
      message: "Cannot toggle an empty option key"
    });
  });

  it("rejects comment toggles for matrix-cell property targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[draw=red]| B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: "ignored",
      commentMode: "disable"
    });

    expect(result).toEqual({
      kind: "unsupported",
      reason: "Property comment toggles are unavailable for this source target."
    });
  });

  it("comment toggles style-source entries in bare option values", () => {
    const source = String.raw`\begin{tikzpicture}[accent/.style={draw=red, fill=blue}]
  \draw[accent] (0,0) -- (1,0);
\end{tikzpicture}`;
    const styleStart = source.indexOf("accent/.style");
    const styleEnd = source.indexOf("}]", styleStart) + 1;
    const styleTargetId = makeStyleSourceTargetId({ from: styleStart, to: styleEnd });

    const disabled = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: styleTargetId,
      level: "named-style",
      key: "draw",
      value: "ignored",
      commentMode: "disable"
    });

    expect(disabled.kind).toBe("success");
    if (disabled.kind !== "success") {
      throw new Error("Expected style-source disable to succeed");
    }
    expect(disabled.newSource).toContain(String.raw`accent/.style={
  % draw=red,
  fill=blue
}`);

    const enabledStart = disabled.newSource.indexOf("accent/.style");
    const enabledEnd = disabled.newSource.indexOf("}", enabledStart) + 1;
    const enabledTargetId = makeStyleSourceTargetId({ from: enabledStart, to: enabledEnd });
    const enabled = applyEditAction(disabled.newSource, [], {
      kind: "setProperty",
      elementId: enabledTargetId,
      level: "named-style",
      key: "draw",
      value: "ignored",
      commentMode: "enable"
    });

    expect(enabled.kind).toBe("success");
    if (enabled.kind !== "success") {
      throw new Error("Expected style-source enable to succeed");
    }
    expect(enabled.newSource).toContain(String.raw`accent/.style={
  draw=red,
  fill=blue
}`);
  });

  it("comment toggles braced tikzset style values", () => {
    const source = String.raw`\tikzset{accent/.style={draw=red, fill=blue}}`;
    const styleStart = source.indexOf("accent/.style");
    const styleEnd = source.lastIndexOf("}");
    const styleTargetId = makeStyleSourceTargetId({ from: styleStart, to: styleEnd });

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: styleTargetId,
      level: "named-style",
      key: "fill",
      value: "ignored",
      commentMode: "disable"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected braced tikzset style toggle to succeed");
    }
    expect(result.newSource).toContain(String.raw`accent/.style={
  draw=red,
  % fill=blue,
}`);
  });

  it("comment toggles legacy bracketed tikzstyle values and empty multiline styles", () => {
    const legacy = String.raw`\tikzstyle{accent}=[draw=red, fill=blue]`;
    const legacyTarget = makeStyleSourceTargetId({ from: 0, to: legacy.length });

    const disabled = applyEditAction(legacy, [], {
      kind: "setProperty",
      elementId: legacyTarget,
      level: "named-style",
      key: "fill",
      value: "ignored",
      commentMode: "disable"
    });

    expect(disabled.kind).toBe("success");
    if (disabled.kind !== "success") {
      throw new Error("Expected legacy tikzstyle toggle to succeed");
    }
    expect(disabled.newSource).toContain("% fill=blue");
    expect(disabled.newSource).toContain("[");
    expect(disabled.newSource).toContain("]");

    const emptyStyle = String.raw`accent/.style={

}`;
    const emptyTarget = makeStyleSourceTargetId({ from: 0, to: emptyStyle.length });
    const inserted = applyEditAction(emptyStyle, [], {
      kind: "setProperty",
      elementId: emptyTarget,
      level: "named-style",
      key: "draw",
      value: "red"
    });

    expect(inserted.kind).toBe("success");
    if (inserted.kind !== "success") {
      throw new Error("Expected empty style insertion to succeed");
    }
    expect(inserted.newSource).toBe(String.raw`accent/.style={draw=red}`);
  });

  it("supports writing named line width flags while clearing numeric line width", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, line width=0.2pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "very thin",
      value: "true",
      clearKeys: ["line width", ...lineWidthPresetKeys.filter((key) => key !== "very thin")]
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[blue, very thin] (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("line width=");
    }
  });

  it("supports writing numeric line width while clearing preset flags", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, very thin] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "line width",
      value: "1.3pt",
      clearKeys: lineWidthPresetKeys
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[blue, line width=1.3pt] (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("very thin");
    }
  });

  it("inserts a new command option list when none exists", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[red] (0,0) -- (1,0);");
    }
  });

  it("serializes fill color as a bare option when setting color on a \\fill path", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "fill",
      value: "yellow"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\fill[yellow] (0,0) rectangle (1,1);");
    }
  });

  it("replaces existing bare draw color flags instead of appending duplicates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, thick] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[red, thick] (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("blue");
    }
  });

  it("serializes updated draw key values as bare colors on \\draw paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=blue, thick] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "green"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[green, thick] (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("draw=");
    }
  });

  it("rewrites no-draw \\draw paths to \\path when certified", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, thick] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "none"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\path[thick] (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("\\draw[none");
      expect(result.newSource).not.toContain("draw=none");
    }
  });

  it("rewrites no-fill \\fill paths to \\path when certified", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill[yellow] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "fill",
      value: "none"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\path (0,0) rectangle (1,1);");
      expect(result.newSource).not.toContain("\\fill[none");
      expect(result.newSource).not.toContain("fill=none");
    }
  });

  it("rewrites fill-only paint to \\fill when inherited draw is absent", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=none] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "fill",
      value: "red"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\fill[red] (0,0) rectangle (1,1);");
      expect(result.newSource).not.toContain("draw=none");
    }
  });

  it("keeps explicit draw disabling when inherited draw would change cleanup semantics", () => {
    const source = String.raw`\begin{tikzpicture}[draw]
  \draw[draw=none] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "fill",
      value: "red"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[draw=none, fill=red] (0,0) rectangle (1,1);");
    }
  });

  it("uses conservative property writes in preview mode", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, thick] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(
      source,
      [],
      {
        kind: "setProperty",
        elementId: "path:0",
        level: "command",
        key: "draw",
        value: "none"
      },
      { parseOptions: { propertyWriteMode: "preview" } }
    );

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[draw=none, thick] (0,0) -- (1,0);");
    }
  });

  it("cleans existing conservative paint writes on drag-end cleanup", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=none, fill=red] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "cleanupPropertyWrites"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\fill[red] (0,0) rectangle (1,1);");
      expect(result.newSource).not.toContain("draw=none");
    }
  });

  it("limits targeted paint cleanup to requested element ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=none, fill=red] (0,0) rectangle (1,1);
  \draw[draw=none, fill=blue] (2,0) rectangle (3,1);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "cleanupPropertyWrites",
      elementIds: ["path:0"]
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\fill[red] (0,0) rectangle (1,1);");
      expect(result.newSource).toContain("\\draw[draw=none, fill=blue] (2,0) rectangle (3,1);");
    }
  });

  it("reports no-op cleanup for empty targets and already idiomatic paint", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill[red] (0,0) rectangle (1,1);
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "cleanupPropertyWrites",
      elementIds: ["  "]
    })).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });
    expect(applyEditAction(source, [], {
      kind: "cleanupPropertyWrites"
    })).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });
  });

  it("cleans paint commands inside scopes and disabled filldraw combinations", () => {
    const nestedSource = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw[draw=none, fill=red] (0,0) rectangle (1,1);
  \end{scope}
\end{tikzpicture}`;
    const nested = applyEditAction(nestedSource, [], {
      kind: "cleanupPropertyWrites"
    });
    expect(nested.kind).toBe("success");
    if (nested.kind !== "success") {
      throw new Error("Expected nested cleanup to succeed");
    }
    expect(nested.newSource).toContain("\\fill[red] (0,0) rectangle (1,1);");

    const bothDisabled = applyEditAction(String.raw`\begin{tikzpicture}
  \filldraw[draw=false, fill=false] (0,0) rectangle (1,1);
\end{tikzpicture}`, [], {
      kind: "cleanupPropertyWrites"
    });
    expect(bothDisabled).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });

    const fillOnlyFilldraw = applyEditAction(String.raw`\begin{tikzpicture}
  \filldraw[draw=false, fill=red] (0,0) rectangle (1,1);
\end{tikzpicture}`, [], {
      kind: "cleanupPropertyWrites"
    });
    expect(fillOnlyFilldraw).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });

    const drawOnlyFilldraw = applyEditAction(String.raw`\begin{tikzpicture}
  \filldraw[draw=blue, fill=false] (0,0) rectangle (1,1);
\end{tikzpicture}`, [], {
      kind: "cleanupPropertyWrites"
    });
    expect(drawOnlyFilldraw).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });
  });

  it("skips cosmetic drag-end paint cleanup for large sources without conservative paint tokens", () => {
    const source = String.raw`\begin{tikzpicture}
  \filldraw[fill=blue!20] (0,0) rectangle (1,1);
${Array.from({ length: 5000 }, (_, index) => `  % large document filler ${index}`).join("\n")}
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "cleanupPropertyWrites",
      elementIds: ["path:0"]
    });

    expect(result).toEqual({
      kind: "unsupported",
      reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
    });
  });

  it("omits local default-equivalent properties when certified", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[line cap=round] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "line cap",
      value: "butt"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("line cap=butt");
    }
  });

  it("keeps default-valued properties when omission would expose an inherited value", () => {
    const source = String.raw`\begin{tikzpicture}[line cap=round]
  \draw[line cap=round] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "line cap",
      value: "butt"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[line cap=butt] (0,0) -- (1,0);");
    }
  });

  it("inserts node options when targeting a node item id", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) node {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      throw new Error("Expected first statement to be a path");
    }
    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (!node || node.kind !== "Node") {
      throw new Error("Expected a node item");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: node.id,
      level: "command",
      key: "fill",
      value: "yellow"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,0) node[fill=yellow] {A};");
    }
  });

  it("appends transparent inside an existing named node option list", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (B) at (1.5, -0.5) {B};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      throw new Error("Expected first statement to be a path");
    }
    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (!node || node.kind !== "Node") {
      throw new Error("Expected a node item");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: node.id,
      level: "command",
      key: "transparent",
      value: "true"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected node transparent rewrite to succeed");
    }
    expect(result.newSource).toContain("\\node[draw, transparent] (B) at (1.5, -0.5) {B};");
    expect(result.newSource).not.toContain("\\node[transparent][draw]");
  });

  it("inserts a matrix-cell option prefix when setting a property on a matrix-of-nodes cell", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell setProperty insertion to succeed");
    }
    expect(result.newSource).toContain("A & |[draw=red]| B");
  });

  it("rejects empty matrix-cell setProperty keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: " ",
      value: "red"
    });

    expect(result).toEqual({
      kind: "error",
      message: "Cannot set an empty option key"
    });
  });

  it("rejects clearing absent matrix-cell options", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: ""
    });

    expect(result).toEqual({
      kind: "unsupported",
      reason: "setProperty would not change the source."
    });
  });

  it("updates existing matrix-cell option prefixes", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[draw=red]| B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "fill",
      value: "yellow"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell option rewrite to succeed");
    }
    expect(result.newSource).toContain("|[draw=red, fill=yellow]| B");
  });

  it("normalizes matrix-cell clearKeys while setting a new primary option", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[draw=red, fill=yellow]| B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "fill",
      value: "blue",
      clearKeys: [" ", "draw", "fill"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell clearKeys rewrite to succeed");
    }
    expect(result.newSource).toContain("|[fill=blue]| B");
    expect(result.newSource).not.toContain("draw=red");
  });

  it("rejects no-op rewrites on existing matrix-cell option prefixes", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[draw=red]| B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result).toEqual({
      kind: "unsupported",
      reason: "setProperty would not change the source."
    });
  });

  it("rejects matrix-cell property writes on plain matrices", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result.kind).toBe("unsupported");
  });

  it("removes matrix-cell option prefix when clearing the only supported key", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[draw=red]| B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: ""
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell prefix removal to succeed");
    }
    expect(result.newSource).toContain("A & B \\\\");
    expect(result.newSource).not.toContain("|[draw=red]|");
  });

  it("removes matrix-cell option prefixes with whitespace around the option pipes", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & | [draw=red] |   B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: ""
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected spaced matrix-cell prefix removal to succeed");
    }
    expect(result.newSource).toContain("A & B \\\\");
    expect(result.newSource).not.toContain("[draw=red]");
  });

  it("keeps remaining matrix-cell options when clearing one of several keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[draw=red,fill=yellow]| B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: ""
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell partial key removal to succeed");
    }
    expect(result.newSource).toContain("|[fill=yellow]| B");
    expect(result.newSource).not.toContain("draw=red");
  });

  it("supports broader matrix-cell property keys like line width", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "line width",
      value: "1pt"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell line width insertion to succeed");
    }
    expect(result.newSource).toContain("A & |[line width=1pt]| B");
  });

  it("clears broader matrix-cell keys and removes empty option prefixes", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[line width=1pt]| B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "line width",
      value: ""
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell line width clear to succeed");
    }
    expect(result.newSource).toContain("A & B \\\\");
    expect(result.newSource).not.toContain("|[line width=1pt]|");
  });

  it("updates matrix-level row/column spacing properties", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,row sep=2mm,column sep=3mm] {
    A & B \\
  };
\end{tikzpicture}`;

    const rowSepResult = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "row sep",
      value: "5mm"
    });
    expect(rowSepResult.kind).toBe("success");
    if (rowSepResult.kind !== "success") {
      throw new Error("Expected matrix row sep update to succeed");
    }
    expect(rowSepResult.newSource).toContain("row sep=5mm");

    const columnSepResult = applyEditAction(rowSepResult.newSource, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "column sep",
      value: "7mm"
    });
    expect(columnSepResult.kind).toBe("success");
    if (columnSepResult.kind !== "success") {
      throw new Error("Expected matrix column sep update to succeed");
    }
    expect(columnSepResult.newSource).toContain("column sep=7mm");
  });

  it("updates matrix-level draw/fill properties", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;

    const drawResult = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "blue"
    });
    expect(drawResult.kind).toBe("success");
    if (drawResult.kind !== "success") {
      throw new Error("Expected matrix draw update to succeed");
    }
    expect(drawResult.newSource).toContain("draw=blue");

    const fillResult = applyEditAction(drawResult.newSource, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "fill",
      value: "yellow"
    });
    expect(fillResult.kind).toBe("success");
    if (fillResult.kind !== "success") {
      throw new Error("Expected matrix fill update to succeed");
    }
    expect(fillResult.newSource).toContain("fill=yellow");
  });

  it("keeps matrix-level inspector writes inside one option list", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[
    matrix of nodes,
    ampersand replacement=\&,
  ] (m) {
    A \& B \& C \\
    D \& E \& F \\
  };
\end{tikzpicture}`;

    const updates = [
      ["draw", "red"],
      ["column sep", "0.2pt"],
      ["row sep", "0.4pt"],
      ["row sep", "0.3pt"],
      ["row sep", "0.2pt"],
      ["column sep", "0.1pt"],
      ["row sep", "0.1pt"]
    ] as const;

    let current = source;
    for (const [key, value] of updates) {
      const result = applyEditAction(current, [], {
        kind: "setProperty",
        elementId: "path:0",
        level: "command",
        key,
        value
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error(`Expected matrix property '${key}' to update`);
      }
      current = result.newSource;
    }

    expect(current).toContain("\\matrix[");
    expect(current).toContain("matrix of nodes");
    expect(current).toContain("ampersand replacement=\\&");
    expect(current).toContain("draw=red");
    expect(current).toContain("column sep=0.1pt");
    expect(current).toContain("row sep=0.1pt");
    expect(current).not.toContain("][");
    expect(current.match(/\[/g)?.length ?? 0).toBe(1);
  });

  it("adds matrix rows at start, middle, and end using 1-based insert-at indices", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;

    const addStart = applyEditAction(source, [], {
      kind: "addMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 1
    });
    expect(addStart.kind).toBe("success");
    if (addStart.kind !== "success") {
      throw new Error("Expected addMatrixRow at start to succeed");
    }
    expect(addStart.changedSourceIds).toEqual(["path:0"]);

    const addMiddle = applyEditAction(source, [], {
      kind: "addMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 2
    });
    expect(addMiddle.kind).toBe("success");

    const addEnd = applyEditAction(source, [], {
      kind: "addMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 3
    });
    expect(addEnd.kind).toBe("success");
  });

  it("removes matrix rows with index validation", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
    C & D \\
    E & F \\
  };
\end{tikzpicture}`;

    const removeMiddle = applyEditAction(source, [], {
      kind: "removeMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 2
    });
    expect(removeMiddle.kind).toBe("success");
    if (removeMiddle.kind !== "success") {
      throw new Error("Expected removeMatrixRow to succeed");
    }
    expect(removeMiddle.newSource).not.toContain("C & D");

    const invalid = applyEditAction(source, [], {
      kind: "removeMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 4
    });
    expect(invalid.kind).toBe("unsupported");
  });

  it("adds and removes matrix columns at arbitrary indices for ragged matrices", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B & C \\
    D & E \\
    F \\
  };
\end{tikzpicture}`;

    const addColumn = applyEditAction(source, [], {
      kind: "addMatrixColumn",
      matrixSourceId: "path:0",
      columnIndex: 2
    });
    expect(addColumn.kind).toBe("success");
    if (addColumn.kind !== "success") {
      throw new Error("Expected addMatrixColumn to succeed");
    }
    expect(addColumn.changedSourceIds).toEqual(["path:0"]);

    const removeColumn = applyEditAction(addColumn.newSource, [], {
      kind: "removeMatrixColumn",
      matrixSourceId: "path:0",
      columnIndex: 3
    });
    expect(removeColumn.kind).toBe("success");
  });

  it("transposes rectangular matrices", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "transposeMatrix",
      matrixSourceId: "path:0"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected transposeMatrix to succeed");
    }
    expect(result.newSource).toMatch(/A\s*&\s*C\s*\\\\/);
    expect(result.newSource).toMatch(/B\s*&\s*D/);
  });

  it("transposes ragged matrices by padding then trimming trailing empties", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B & C \\
    D & E \\
    F \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "transposeMatrix",
      matrixSourceId: "path:0"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected ragged transpose to succeed");
    }
    expect(result.newSource).toMatch(/A\s*&\s*D\s*&\s*F\s*\\\\/);
    expect(result.newSource).toMatch(/B\s*&\s*E\s*\\\\/);
    expect(result.newSource).toMatch(/\n\s*C\s*}\s*;/);
  });

  it("handles empty matrix transposes without inventing cells", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "transposeMatrix",
      matrixSourceId: "path:0"
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("Matrix text span is unavailable for structural editing.");
    }
  });

  it("keeps custom ampersand replacement parseable across structural edits", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,ampersand replacement=\&] {
    A \& B \\
    C \& D \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addMatrixColumn",
      matrixSourceId: "path:0",
      columnIndex: 2
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected addMatrixColumn with ampersand replacement to succeed");
    }
    const rendered = renderTikzToSvg(result.newSource);
    expect(rendered.semantic.featureUsage.matrix_node).toBe("used-supported");
  });

  it("normalizes away boundary gap overrides in structural matrix rewrites", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A &[2mm] B \\[3mm]
    C & D \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 2
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected addMatrixRow with gap overrides to succeed");
    }
    expect(result.newSource).not.toContain("&[");
    expect(result.newSource).not.toContain("\\\\[");
  });

  it("rejects invalid matrix structural targets and indices", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;

    for (const action of [
      { kind: "addMatrixRow", matrixSourceId: "missing", rowIndex: 1 },
      { kind: "removeMatrixRow", matrixSourceId: "missing", rowIndex: 1 },
      { kind: "addMatrixColumn", matrixSourceId: "missing", columnIndex: 1 },
      { kind: "removeMatrixColumn", matrixSourceId: "missing", columnIndex: 1 },
      { kind: "transposeMatrix", matrixSourceId: "missing" }
    ] as const) {
      expect(applyEditAction(source, [], action).kind).toBe("unsupported");
    }

    for (const rowIndex of [0, 4, 1.5]) {
      expect(applyEditAction(source, [], {
        kind: "addMatrixRow",
        matrixSourceId: "path:0",
        rowIndex
      }).kind).toBe("unsupported");
    }
    for (const columnIndex of [0, 4, 1.5]) {
      expect(applyEditAction(source, [], {
        kind: "addMatrixColumn",
        matrixSourceId: "path:0",
        columnIndex
      }).kind).toBe("unsupported");
    }
    for (const rowIndex of [0, 3, 1.5]) {
      expect(applyEditAction(source, [], {
        kind: "removeMatrixRow",
        matrixSourceId: "path:0",
        rowIndex
      }).kind).toBe("unsupported");
    }
    for (const columnIndex of [0, 3, 1.5]) {
      expect(applyEditAction(source, [], {
        kind: "removeMatrixColumn",
        matrixSourceId: "path:0",
        columnIndex
      }).kind).toBe("unsupported");
    }
  });

  it("rejects removal of the final matrix row or column", () => {
    const oneRow = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] { A & B };
\end{tikzpicture}`;
    const oneColumn = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A \\
    B \\
  };
\end{tikzpicture}`;

    expect(applyEditAction(oneRow, [], {
      kind: "removeMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 1
    }).kind).toBe("unsupported");
    expect(applyEditAction(oneColumn, [], {
      kind: "removeMatrixColumn",
      matrixSourceId: "path:0",
      columnIndex: 1
    }).kind).toBe("unsupported");
  });

  it("routes tree-child layout keys to child options", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=2mm] { node[draw] {leaf} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leafText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "leaf"
    );
    if (!leafText || leafText.kind !== "Text" || !leafText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: "level distance",
      value: "5mm"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected tree-child layout update to succeed");
    }
    expect(result.newSource).toContain("child[level distance=5mm]");
    expect(result.newSource).toContain("node[draw] {leaf}");
  });

  it("clears existing tree-child layout options", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=2mm, sibling distance=3mm] { node[draw] {leaf} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leafText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "leaf"
    );
    if (!leafText || leafText.kind !== "Text" || !leafText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: "level distance",
      value: ""
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected tree-child layout clear to succeed");
    }
    expect(result.newSource).toContain("child[sibling distance=3mm]");
    expect(result.newSource).not.toContain("level distance");
  });

  it("routes tree-child node style keys to child root node options", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=2mm] { node[draw] {leaf} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leafText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "leaf"
    );
    if (!leafText || leafText.kind !== "Text" || !leafText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: "fill",
      value: "yellow"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected tree-child node style update to succeed");
    }
    expect(result.newSource).toContain("child[level distance=2mm]");
    expect(result.newSource).toContain("node[");
    expect(result.newSource).toContain("draw");
    expect(result.newSource).toContain("fill=yellow");
    expect(result.newSource).toContain("{leaf}");
  });

  it("supports broader tree-child node property writes (e.g. line width)", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=2mm] { node[draw] {leaf} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leafText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "leaf"
    );
    if (!leafText || leafText.kind !== "Text" || !leafText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: "line width",
      value: "1.5pt"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected broader tree-child node write to succeed");
    }
    expect(result.newSource).toContain("child[level distance=2mm]");
    expect(result.newSource).toContain("node[");
    expect(result.newSource).toContain("draw");
    expect(result.newSource).toContain("line width=1.5pt");
    expect(result.newSource).toContain("{leaf}");
  });

  it("rejects empty tree-child setProperty keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=2mm] { node[draw] {leaf} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leafText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "leaf"
    );
    if (!leafText || leafText.kind !== "Text" || !leafText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: " ",
      value: "red"
    });

    expect(result).toEqual({
      kind: "error",
      message: "Cannot set an empty option key"
    });
  });

  it("inserts missing tree-child option lists at the correct level", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {leaf} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leafText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "leaf"
    );
    if (!leafText || leafText.kind !== "Text" || !leafText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const layoutInsert = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: "sibling distance",
      value: "4mm"
    });
    expect(layoutInsert.kind).toBe("success");
    if (layoutInsert.kind !== "success") {
      throw new Error("Expected tree-child layout insert to succeed");
    }
    expect(layoutInsert.newSource).toContain("child[sibling distance=4mm] { node {leaf} }");

    const nodeInsert = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: "draw",
      value: "red"
    });
    expect(nodeInsert.kind).toBe("success");
    if (nodeInsert.kind !== "success") {
      throw new Error("Expected tree-child node options insert to succeed");
    }
    expect(nodeInsert.newSource).toContain("child { node[draw=red]");
    expect(nodeInsert.newSource).toContain("{leaf}");
  });

  it("rejects tree-child setProperty writes for child foreach", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child foreach \x in {A,B} { node {\x} };
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const path = parsed.figure.body.find((statement) => statement.kind === "Path");
    if (!path || path.kind !== "Path") {
      throw new Error("Expected path statement");
    }
    const childOperation = path.items.find((item) => item.kind === "ChildOperation");
    if (!childOperation || childOperation.kind !== "ChildOperation") {
      throw new Error("Expected child operation");
    }
    const syntheticChildId = `${path.id}:tree-child:1:${childOperation.id}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: syntheticChildId,
      level: "command",
      key: "draw",
      value: "red"
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("child foreach");
    }
  });

  it("updates an existing grid keyword option list by keyword id", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) grid[step=2mm] (2,2);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: resolveFirstGridKeywordId(source),
      level: "command",
      key: "step",
      value: "0.5cm",
      clearKeys: ["xstep", "x step", "ystep", "y step"]
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,0) grid[step=0.5cm] (2,2);");
    }
  });

  it("inserts a grid keyword option list when none exists", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) grid (2,2);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: resolveFirstGridKeywordId(source),
      level: "command",
      key: "xstep",
      value: "0.4cm",
      clearKeys: ["x step"]
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,0) grid[xstep=0.4cm] (2,2);");
    }
  });

  it("updates an existing tikzpicture global option key", () => {
    const source = String.raw`\begin{tikzpicture}[xscale=1.2, yscale=0.8]
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: TIKZPICTURE_GLOBAL_TARGET_ID,
      level: "command",
      key: "xscale",
      value: "2"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\begin{tikzpicture}[xscale=2, yscale=0.8]");
    }
  });

  it("inserts a tikzpicture global option list when missing", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: TIKZPICTURE_GLOBAL_TARGET_ID,
      level: "command",
      key: "xscale",
      value: "1.5"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\begin{tikzpicture}[xscale=1.5]");
    }
  });

  it("keeps a shadow preset as a flag when setProperty receives true", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[copy shadow] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "drop shadow",
      value: "true",
      clearKeys: ["copy shadow", "circular drop shadow", "circular glow", "general shadow", "double copy shadow"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw[drop shadow] (0,0) -- (1,0);");
    expect(result.newSource).not.toContain("copy shadow");
  });

  it("writes nested shadow options with braces", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[drop shadow] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "drop shadow",
      value: "{shadow xshift=2pt,shadow yshift=-3pt,opacity=0.25}",
      clearKeys: ["copy shadow", "circular drop shadow", "circular glow", "general shadow", "double copy shadow"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(
      "\\draw[drop shadow={shadow xshift=2pt,shadow yshift=-3pt,opacity=0.25}] (0,0) -- (1,0);"
    );
    expect(result.newSource).not.toContain("drop shadow=shadow xshift=2pt");
  });

  it("returns unsupported when the target id is missing", () => {
    const result = applyEditAction("\\draw (0,0);", [], {
      kind: "setProperty",
      elementId: "missing",
      level: "command",
      key: "color",
      value: "red"
    });
    expect(result.kind).toBe("unsupported");
  });
});
