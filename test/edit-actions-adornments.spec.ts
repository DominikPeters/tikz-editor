import { describe, expect, it } from "vitest";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { ADORNMENT_EDIT_NOOP_REASON, applyAdornmentSetProperty, applyAdornmentValueRewrite } from "../packages/core/src/edit/actions/adornment-set-property.js";
import { PIN_EDGE_DASH_PROPERTY_KEY, PIN_EDGE_DRAW_PROPERTY_KEY, PIN_EDGE_LINE_WIDTH_PROPERTY_KEY } from "../packages/core/src/edit/adornment-keys.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { wp } from "./coords-helpers.js";

describe("applyEditAction – node adornments", () => {
  it("duplicates a single label option without duplicating the whole node", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label=right:L] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "duplicateAdornment",
      targetId: "node-adornment:node:0:2:label:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("label=right:L, label=right:L");
  });

  it("deletes only the selected pin option", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin=above:P,label=right:L] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteAdornment",
      targetId: "node-adornment:node:0:2:pin:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("pin=above:P");
    expect(result.newSource).toContain("label=right:L");
  });

  it("normalizes surrounding commas and whitespace when deleting adornments", () => {
    const firstSource = String.raw`\begin{tikzpicture}
  \node[draw,pin=above:P,  label=right:L] at (0,0) {A};
\end{tikzpicture}`;
    const first = applyEditAction(firstSource, [], {
      kind: "deleteAdornment",
      targetId: "node-adornment:node:0:2:pin:0"
    });
    expect(first.kind).toBe("success");
    if (first.kind !== "success") {
      throw new Error("Expected pin deletion to succeed");
    }
    expect(first.newSource).toContain("\\node[draw,label=right:L]");

    const lastSource = String.raw`\begin{tikzpicture}
  \node[draw, pin=above:P, label=right:L] at (0,0) {A};
\end{tikzpicture}`;
    const last = applyEditAction(lastSource, [], {
      kind: "deleteAdornment",
      targetId: "node-adornment:node:0:2:label:1"
    });
    expect(last.kind).toBe("success");
    if (last.kind !== "success") {
      throw new Error("Expected label deletion to succeed");
    }
    expect(last.newSource).toContain("\\node[draw, pin=above:P]");
  });

  it("rejects missing adornment deletion targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin=above:P,label=right:L] at (0,0) {A};
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "deleteAdornment",
      targetId: "node-adornment:missing"
    })).toEqual({
      kind: "unsupported",
      reason: "Selected adornment could not be resolved for deletion."
    });
  });

  it("preserves pin edge options when editing pin text", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin={[pin edge={draw=blue,dashed,line width=1pt}]above:P}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: "__adornment_text__",
      value: "Q"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("pin edge={draw=blue,dashed,line width=1pt}");
    expect(result.newSource).toContain("above:Q");
  });

  it("preserves pin edge options when editing pin draw color", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin={[pin edge={draw=blue,dashed,line width=1pt},fill=yellow]above:P}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("pin edge={draw=blue,dashed,line width=1pt}");
    expect(result.newSource).toContain("fill=yellow");
    expect(result.newSource).toContain("draw=red");
  });

  it("rejects invalid adornment property writes before rewriting source", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label=right:L] at (0,0) {A};
\end{tikzpicture}`;

    const invalidAngle = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "__adornment_angle__",
      value: "not-a-number"
    });
    expect(invalidAngle.kind).toBe("error");

    const invalidDistance = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "__adornment_distance__",
      value: "not-a-length"
    });
    expect(invalidDistance.kind).toBe("error");

    const emptyKey = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "   ",
      value: "red"
    });
    expect(emptyKey.kind).toBe("error");
  });

  it("normalizes adornment angles, text fallbacks, and no-op rewrites", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label=right:L] at (0,0) {A};
\end{tikzpicture}`;

    const wrappedAngle = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "__adornment_angle__",
      value: "-45"
    });
    expect(wrappedAngle.kind).toBe("success");
    if (wrappedAngle.kind !== "success") {
      throw new Error("Expected wrapped adornment angle rewrite to succeed");
    }
    expect(wrappedAngle.newSource).toContain("label=below right:L");

    const numericAngle = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "__adornment_angle__",
      value: "22"
    });
    expect(numericAngle.kind).toBe("success");
    if (numericAngle.kind !== "success") {
      throw new Error("Expected numeric adornment angle rewrite to succeed");
    }
    expect(numericAngle.newSource).toContain("label=22:L");

    const emptyText = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "__adornment_text__",
      value: ""
    });
    expect(emptyText.kind).toBe("success");
    if (emptyText.kind !== "success") {
      throw new Error("Expected empty adornment text rewrite to succeed");
    }
    expect(emptyText.newSource).toContain("label=right:label");

    const noOp = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "__adornment_angle__",
      value: "0"
    });
    expect(noOp).toEqual({
      kind: "unsupported",
      reason: ADORNMENT_EDIT_NOOP_REASON
    });
  });

  it("keeps exported adornment setters defensive for non-adornment targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const nonAdornmentTarget = {
      id: "path:0",
      kind: "style-source",
      span: { from: 0, to: source.length }
    } as Parameters<typeof applyAdornmentSetProperty>[1];

    expect(applyAdornmentSetProperty(source, nonAdornmentTarget, {
      elementId: "path:0",
      key: "draw",
      value: "red"
    })).toEqual({
      kind: "unsupported",
      reason: "Adornment target does not have a writable value span."
    });
    expect(applyAdornmentValueRewrite(source, nonAdornmentTarget, undefined, "path:0")).toEqual({
      kind: "unsupported",
      reason: "Adornment target does not have a writable value span."
    });
  });

  it("rewrites generic adornment options while honoring clear keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label={[fill=yellow,draw=blue,text=green]right:L}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "draw",
      value: "red",
      clearKeys: ["", "draw", "fill"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("draw=red");
    expect(result.newSource).toContain("text=green");
    expect(result.newSource).not.toContain("fill=yellow");
    expect(result.newSource).not.toContain("draw=blue");
  });

  it("removes generic adornment options and braces comma-containing label text", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label={[fill=yellow]right:L}] at (0,0) {A};
\end{tikzpicture}`;

    const removed = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "fill",
      value: ""
    });
    expect(removed.kind).toBe("success");
    if (removed.kind !== "success") return;
    expect(removed.newSource).not.toContain("fill=yellow");

    const text = applyEditAction(removed.newSource, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:label:0",
      level: "command",
      key: "__adornment_text__",
      value: "A,B"
    });
    expect(text.kind).toBe("success");
    if (text.kind !== "success") return;
    expect(text.newSource).toContain("right:{A,B}");
  });
});

describe("applyEditAction – adornment placement", () => {
  it("rejects adornment actions when the target cannot be resolved", () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0,0) {A};
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "duplicateAdornment",
      targetId: "node-adornment:missing"
    }).kind).toBe("unsupported");
    expect(applyEditAction(source, [], {
      kind: "moveAdornment",
      targetId: "node-adornment:missing",
      ownerPoint: wp(0, 0),
      newWorld: wp(1, 0)
    }).kind).toBe("unsupported");
    expect(applyEditAction(source, [], {
      kind: "addNodeAdornment",
      nodeId: "node:missing",
      adornmentKind: "label",
      angle: "above",
      text: "X"
    }).kind).toBe("unsupported");
  });

  it("rejects adding node adornments to non-node source targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addNodeAdornment",
      nodeId: "path:0",
      adornmentKind: "label",
      angle: "above",
      text: "X"
    });

    expect(result).toEqual({
      kind: "unsupported",
      reason: "Selected target is not a node that can receive an adornment."
    });
  });

  it("inserts a new pin by creating a node option list when none exists", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (A) at (0,0) {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const statement = parsed.figure.body.find((entry) => entry.kind === "Path");
    if (!statement || statement.kind !== "Path") {
      throw new Error("Expected node path statement");
    }
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") {
      throw new Error("Expected node item");
    }

    const result = applyEditAction(source, [], {
      kind: "addNodeAdornment",
      nodeId: node.id,
      adornmentKind: "pin",
      angle: "right",
      text: "P"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected adornment insertion to create options");
    }
    expect(result.newSource).toBe(String.raw`\begin{tikzpicture}
  \node[pin=right:P] (A) at (0,0) {A};
\end{tikzpicture}`);
    expect(result.selectedSourceIds).toEqual([`node-adornment:${node.id}:pin:0`]);
  });

  it("inserts a new label inside an existing node option list", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (A) at (-1, -1) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addNodeAdornment",
      nodeId: "node:0:3",
      adornmentKind: "label",
      angle: "below",
      text: "Label"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected adornment insertion to succeed");
    }
    expect(result.newSource).toBe(String.raw`\begin{tikzpicture}
  \node[draw, label=below:Label] (A) at (-1, -1) {A};
\end{tikzpicture}`);
  });

  it("inserts new adornments before trailing option-list whitespace", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[
    draw,
  ] (A) at (-1, -1) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addNodeAdornment",
      nodeId: "node:0:3",
      adornmentKind: "label",
      angle: "above",
      text: "L"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected adornment insertion before trailing whitespace to succeed");
    }
    expect(result.newSource).toContain("draw,\n  , label=above:L]");
    expect(result.newSource).not.toContain("]\n, label");
  });

  it("omits a local label distance when dragging back to the implicit default distance", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label={[red,label distance=6pt]above:X}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveAdornment",
      targetId: "node-adornment:node:0:2:label:0",
      ownerPoint: wp(0, 0),
      newWorld: wp(0, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected adornment move to succeed");
    }
    expect(result.newSource).toContain("label={[");
    expect(result.newSource).toContain("center:X");
    expect(result.newSource).not.toContain("label distance=");
    expect(result.newSource).not.toContain("every label");
    expect(result.changedSourceIds).toEqual(["path:0"]);
  });

  it("moves adornments using explicit overrides and computed compass angles", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label=right:L] at (0,0) {A};
\end{tikzpicture}`;

    const explicit = applyEditAction(source, [], {
      kind: "moveAdornment",
      targetId: "node-adornment:node:0:2:label:0",
      ownerPoint: wp(0, 0),
      newWorld: wp(-10, 0),
      angleRaw: "123",
      distancePt: 42
    });
    expect(explicit.kind).toBe("success");
    if (explicit.kind !== "success") {
      throw new Error("Expected explicit adornment move to succeed");
    }
    expect(explicit.newSource).toContain("label distance=42pt");
    expect(explicit.newSource).toContain("123:L");

    const computed = applyEditAction(source, [], {
      kind: "moveAdornment",
      targetId: "node-adornment:node:0:2:label:0",
      ownerPoint: wp(0, 0),
      newWorld: wp(-10, -10)
    });
    expect(computed.kind).toBe("success");
    if (computed.kind !== "success") {
      throw new Error("Expected computed adornment move to succeed");
    }
    expect(computed.newSource).toContain("below left:L");
  });

  it("uses numeric computed angles when a moved adornment is away from compass presets", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label=right:L] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveAdornment",
      targetId: "node-adornment:node:0:2:label:0",
      ownerPoint: wp(0, 0),
      newWorld: wp(10, 4)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected non-compass adornment move to succeed");
    }
    expect(result.newSource).toContain("22:L");
    expect(result.newSource).toContain("label distance=11pt");

    const fine = applyEditAction(source, [], {
      kind: "moveAdornment",
      targetId: "node-adornment:node:0:2:label:0",
      ownerPoint: wp(0, 0),
      newWorld: wp(10, 4),
      formatPrecision: "fine"
    });
    expect(fine.kind).toBe("success");
    if (fine.kind !== "success") {
      throw new Error("Expected fine-precision adornment move to succeed");
    }
    expect(fine.newSource).toContain("label distance=10.8pt");
  });

  it("does not serialize synthetic every-pin styles when rewriting a pin repeatedly", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin=above:Pin] at (0,0) {A};
\end{tikzpicture}`;

    const firstRewrite = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: "__adornment_distance__",
      value: "23.5pt"
    });

    expect(firstRewrite.kind).toBe("success");
    if (firstRewrite.kind !== "success") {
      throw new Error("Expected first pin rewrite to succeed");
    }
    expect(firstRewrite.newSource).not.toContain("every pin");

    const secondRewrite = applyEditAction(firstRewrite.newSource, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: "__adornment_angle__",
      value: "40"
    });

    expect(secondRewrite.kind).toBe("success");
    if (secondRewrite.kind !== "success") {
      throw new Error("Expected second pin rewrite to succeed");
    }
    expect(secondRewrite.newSource).not.toContain("every pin");
  });

  it("rewrites pin-edge dash mode without disturbing other pin-edge options", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin={[pin edge={draw=blue,dashed,line width=1pt},fill=yellow]above:P}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: PIN_EDGE_DASH_PROPERTY_KEY,
      value: "densely dotted",
      clearKeys: ["dashed"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected pin-edge dash rewrite to succeed");
    }
    expect(result.newSource).toContain("pin edge={draw=blue, line width=1pt, densely dotted}");
    expect(result.newSource).not.toContain("pin edge={draw=blue,dashed");
    expect(result.newSource).toContain("fill=yellow");
  });

  it("removes pin-edge entirely when the last pin-edge style is cleared", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin={[pin edge={draw=blue}]above:P}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: PIN_EDGE_DRAW_PROPERTY_KEY,
      value: ""
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected pin-edge draw removal to succeed");
    }
    expect(result.newSource).not.toContain("pin edge");
    expect(result.newSource).toContain("pin=above:P");
  });

  it("rewrites pin-edge line width while normalizing braced pin-edge payloads", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin={[pin edge=dashed]above:P}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: PIN_EDGE_LINE_WIDTH_PROPERTY_KEY,
      value: "2pt"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected pin-edge line width rewrite to succeed");
    }
    expect(result.newSource).toContain("pin edge={dashed, line width=2pt}");
  });

  it("normalizes solid pin-edge dash mode by removing authored dash options", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin={[pin edge={draw=blue,dashed}]above:P}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: PIN_EDGE_DASH_PROPERTY_KEY,
      value: "solid"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected pin-edge solid rewrite to succeed");
    }
    expect(result.newSource).toContain("pin edge={draw=blue}");
    expect(result.newSource).not.toContain("dashed");
  });

  it("creates pin-edge options when absent and supports empty dash clearing", () => {
    const withoutPinEdge = String.raw`\begin{tikzpicture}
  \node[draw,pin=above:P] at (0,0) {A};
\end{tikzpicture}`;

    const created = applyEditAction(withoutPinEdge, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: PIN_EDGE_DRAW_PROPERTY_KEY,
      value: "red"
    });

    expect(created.kind).toBe("success");
    if (created.kind !== "success") {
      throw new Error("Expected pin-edge creation to succeed");
    }
    expect(created.newSource).toContain("pin edge={draw=red}");

    const dashed = String.raw`\begin{tikzpicture}
  \node[draw,pin={[pin edge={draw=blue,dashed}]above:P}] at (0,0) {A};
\end{tikzpicture}`;
    const clearedDash = applyEditAction(dashed, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: PIN_EDGE_DASH_PROPERTY_KEY,
      value: ""
    });

    expect(clearedDash.kind).toBe("success");
    if (clearedDash.kind !== "success") {
      throw new Error("Expected empty pin-edge dash rewrite to succeed");
    }
    expect(clearedDash.newSource).toContain("pin edge={draw=blue}");
    expect(clearedDash.newSource).not.toContain("dashed");
  });
});
