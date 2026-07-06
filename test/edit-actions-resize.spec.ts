import { describe, expect, it } from "vitest";
import type { NodeTextEngine } from "../packages/core/src/text/types.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { collectSourceWorldBounds } from "../packages/core/src/edit/snapping/geometry.js";
import { wb, wp } from "./coords-helpers.js";
import { cm, scopeBodyBounds } from "./edit-actions-helpers.js";

describe("applyEditAction – resizeElement", () => {
  it("returns specific unsupported reasons for invalid resize targets and roles", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;

    const missingId = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "   ",
      role: "right",
      newWorld: wp(10, 0)
    });
    expect(missingId.kind).toBe("unsupported");
    if (missingId.kind === "unsupported") {
      expect(missingId.reason).toContain("Missing element id");
    }

    const unknown = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "missing",
      role: "right",
      newWorld: wp(10, 0)
    });
    expect(unknown.kind).toBe("unsupported");

    const badRole = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "center" as never,
      newWorld: wp(10, 0)
    });
    expect(badRole.kind).toBe("unsupported");
    if (badRole.kind === "unsupported") {
      expect(badRole.reason).toContain("Unsupported resize role");
    }

    const rectangleBadRole = applyEditAction(String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
\end{tikzpicture}`, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "center" as never,
      newWorld: wp(10, 0)
    });
    expect(rectangleBadRole.kind).toBe("unsupported");
    if (rectangleBadRole.kind === "unsupported") {
      expect(rectangleBadRole.reason).toContain("Unsupported resize role");
    }

    const circleBadRole = applyEditAction(String.raw`\begin{tikzpicture}
  \draw (0,0) circle (1cm);
\end{tikzpicture}`, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "center" as never,
      newWorld: wp(cm(1), cm(1))
    });
    expect(circleBadRole.kind).toBe("unsupported");
    if (circleBadRole.kind === "unsupported") {
      expect(circleBadRole.reason).toContain("Unsupported resize role");
    }

    const scopeBadRole = applyEditAction(String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) rectangle (1,1);
  \end{scope}
\end{tikzpicture}`, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "center" as never,
      newWorld: wp(10, 0)
    });
    expect(scopeBadRole.kind).toBe("unsupported");
    if (scopeBadRole.kind === "unsupported") {
      expect(scopeBadRole.reason).toContain("Unsupported resize role");
    }
  });

  it("writes minimum width and minimum height when growing from a corner", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(100, 100)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=");
    expect(result.newSource).toContain("minimum height=");
  });

  it("rounds resize-authored minimum dimensions to integer points", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(45.4, 60.6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=91pt");
    expect(result.newSource).toContain("minimum height=121pt");

    const fine = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(45.4, 60.6),
      formatPrecision: "fine"
    });

    expect(fine.kind).toBe("success");
    if (fine.kind !== "success") return;
    expect(fine.newSource).toContain("minimum width=90.8pt");
    expect(fine.newSource).toContain("minimum height=121.2pt");
  });

  it("drops non-binding minimum dimensions when shrinking below intrinsic floor", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,minimum width=100pt,minimum height=80pt] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: wp(0, 0)
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("minimum width=");
    expect(result.newSource).not.toContain("minimum height=");
  });

  it("updates only the axis targeted by the resize role", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,minimum height=40pt] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(90, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=");
    expect(result.newSource).toContain("minimum height=40pt");
  });

  it("resizes non-rectangular shaped nodes by rewriting shape constraints", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,shape=diamond,minimum width=2.2cm,minimum height=1.4cm] at (0,0) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-right",
      newWorld: wp(100, 100)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("shape=diamond");
    expect(/minimum (width|height)=/.test(result.newSource)).toBe(true);
    expect(result.newSource).not.toContain("minimum width=2.2cm, minimum height=1.4cm");
  });

  it("resizes diamond nodes from side handles using companion dimensions", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,shape=diamond,aspect=2] at (0,0) {};
\end{tikzpicture}`;

    const horizontal = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(120, 0)
    });

    expect(horizontal.kind).toBe("success");
    if (horizontal.kind !== "success") return;
    expect(horizontal.newSource).toContain("minimum width=");
    expect(horizontal.newSource).not.toContain("minimum height=");

    const vertical = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top",
      newWorld: wp(0, 100)
    });

    expect(vertical.kind).toBe("success");
    if (vertical.kind !== "success") return;
    expect(vertical.newSource).toContain("minimum height=");
  });

  it("scales explicit diamond minimum dimensions during side resize", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,shape=diamond,minimum width=40pt,minimum height=20pt] at (0,0) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(120, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=");
    expect(result.newSource).toContain("minimum height=");
    expect(result.newSource).not.toContain("minimum width=40pt,minimum height=20pt");
  });

  it("can prefer a single constraint when resizing dependent shapes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,shape=isosceles triangle,minimum width=2.2cm,minimum height=1.4cm] at (0,0) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-right",
      newWorld: wp(120, 60)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("shape=isosceles triangle");
    expect(/minimum (width|height)=/.test(result.newSource)).toBe(true);
  });

  it("maps visual drag through inverse node transform when resizing transformed nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,xscale=0.1] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(30, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const match = /minimum width=([0-9.]+)pt/.exec(result.newSource);
    expect(match).not.toBeNull();
    const width = match ? Number(match[1]) : Number.NaN;
    expect(width).toBeGreaterThan(200);
  });

  it("drops non-binding minimum dimensions for unstyled nodes when shrinking", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[minimum width=100pt,minimum height=80pt] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(0, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("minimum width=");
    expect(result.newSource).not.toContain("minimum height=");
  });

  it("drops non-binding minimum width for positioned nodes when shrinking", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[minimum width=40pt] at (1,2) {node};
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const bounds = collectSourceWorldBounds(semantic.scene.elements).get("path:0");
    expect(bounds).toBeDefined();
    if (!bounds) return;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("minimum width=");
  });

  it("uses the provided text engine when computing intrinsic resize floors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,minimum width=120pt] at (0,0) {Long label text};
\end{tikzpicture}`;
    const fakeTextEngine: NodeTextEngine = {
      validate: () => null,
      measure: () => ({
        cacheKey: "fake-measure",
        width: 40,
        height: 10,
        baselineY: -2,
        midLineY: 0,
        paragraphId: "fake-paragraph",
        renderSourceText: "Long label text"
      }),
      renderFromCache: () => null
    };

    const result = applyEditAction(
      source,
      [],
      {
        kind: "resizeElement",
        elementId: "path:0",
        role: "right",
        newWorld: wp(45, 0)
      },
      { evaluateOptions: { textEngine: fakeTextEngine } }
    );

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=90pt");
  });

  it("rewrites text width instead of minimum width for horizontal resize when text width is set", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,text width=2cm] at (0,0) {This is wrapped text};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(120, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const textWidthMatch = /text width=([0-9.]+)pt/.exec(result.newSource);
    expect(textWidthMatch).not.toBeNull();
    expect(Number(textWidthMatch?.[1])).toBe(Math.round(Number(textWidthMatch?.[1])));
    expect(result.newSource).not.toContain("minimum width=");
  });

  it("preserves unknown node options while resizing text-width nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,{unparsed option},text width=2cm] at (0,0) {This is wrapped text};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(120, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("{unparsed option}");
    expect(result.newSource).toContain("text width=");
  });

  it("keeps existing minimum width unchanged when horizontal resize targets text width", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,text width=2cm,minimum width=100pt] at (0,0) {This is wrapped text};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(120, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=100pt");
    const textWidthMatch = /text width=([0-9.]+)pt/.exec(result.newSource);
    expect(textWidthMatch).not.toBeNull();
  });

  it("uses node inner sep overrides when resizing text-width nodes", () => {
    const innerSepSource = String.raw`\begin{tikzpicture}
  \node[draw,text width=2cm,inner sep=10pt] at (0,0) {This is wrapped text};
\end{tikzpicture}`;
    const innerSep = applyEditAction(innerSepSource, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(120, 0)
    });

    expect(innerSep.kind).toBe("success");
    if (innerSep.kind !== "success") return;
    const innerSepWidth = Number(/text width=([0-9.]+)pt/.exec(innerSep.newSource)?.[1]);
    expect(innerSepWidth).toBeLessThan(240);

    const innerXSepSource = String.raw`\begin{tikzpicture}
  \node[draw,text width=2cm,inner xsep=8pt] at (0,0) {This is wrapped text};
\end{tikzpicture}`;
    const innerXSep = applyEditAction(innerXSepSource, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(120, 0)
    });

    expect(innerXSep.kind).toBe("success");
    if (innerXSep.kind !== "success") return;
    const innerXSepWidth = Number(/text width=([0-9.]+)pt/.exec(innerXSep.newSource)?.[1]);
    expect(innerXSepWidth).toBeLessThan(240);
    expect(innerXSepWidth).toBeGreaterThan(innerSepWidth);
  });

  it("updates text width horizontally and minimum height vertically for corner resize", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,text width=2cm] at (0,0) {This is wrapped text};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(120, 120)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("text width=");
    expect(result.newSource).toContain("minimum height=");
    expect(result.newSource).not.toContain("minimum width=");
  });

  it("does not change text width for vertical-only resize", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,text width=2cm] at (0,0) {This is wrapped text};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top",
      newWorld: wp(0, 120)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("text width=2cm");
  });

  it("removes minimum height when vertical resize makes it non-binding", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,minimum height=50pt] at (0,0) {A};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const bounds = collectSourceWorldBounds(semantic.scene.elements).get("path:0");
    expect(bounds).toBeDefined();
    if (!bounds) {
      return;
    }

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom",
      newWorld: wp((bounds.minX + bounds.maxX) / 2, bounds.maxY - 20)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("minimum height=");
  });

  it("removes non-binding minimum height for multiline text-width corner resize", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw, text width=105.09pt, align=left, minimum height=50pt] at (0,0) {This is the first line which can read quite internationally and this is the second line which is more pedestrian};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const bounds = collectSourceWorldBounds(semantic.scene.elements).get("path:0");
    expect(bounds).toBeDefined();
    if (!bounds) {
      return;
    }

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(bounds.maxX - 20, bounds.maxY)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("text width=");
    expect(result.newSource).not.toContain("minimum height=");
  });

  it("resizes circle statements that use coordinate radius payloads", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) circle (1cm);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1.2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle (2cm)");
  });

  it("resizes filled circle statements that are emitted as path geometry", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (0,0) circle (1cm);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1.2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle (2cm)");
  });

  it("resizes ellipse statements that use explicit x/y radius options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2cm");
    expect(result.newSource).toContain("y radius=1cm");
  });

  it("resizes filled ellipse statements that are emitted as path geometry", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2cm");
    expect(result.newSource).toContain("y radius=1cm");
  });

  it("rewrites the last circle option list that owns a radius", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) circle [draw=blue] [radius=1cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(1.5), cm(1.2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle [draw=blue] [radius=1.5cm]");
  });

  it("preserves formatted ellipse payload coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse ( 1cm and 0.5cm );
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("ellipse ( 2cm and 1cm )");
  });

  it("preserves formatted circle payload coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) circle ( 1cm );
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1.2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle ( 2cm)");
  });

  it("resizes circle syntax with comments between the keyword and payload", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) circle % radius payload stays attached to circle
    (1cm);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(1.5), cm(1.2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("% radius payload stays attached to circle");
    expect(result.newSource).toContain("(1.5cm)");
  });

  it("preserves ellipse aspect ratio when preserveAspect is enabled", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(1.2), cm(0.4)),
      preserveAspect: true
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=1.2cm");
    expect(result.newSource).toContain("y radius=0.6cm");
  });

  it("uses the provided preserveAspectRatio instead of the current ratio", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1.2cm, y radius=0.4cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(0.5)),
      preserveAspect: true,
      preserveAspectRatio: 0.5
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2cm");
    expect(result.newSource).toContain("y radius=1cm");
  });

  it("rejects preserving ellipse aspect ratio without explicit radii", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse;
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1)),
      preserveAspect: true
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("explicit ellipse radii");
  });

  it("inserts ellipse radii when corner resizing an ellipse without explicit radii", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse;
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("ellipse[x radius=2cm, y radius=1cm]");
  });

  it("resizes ellipse statements where y radius is larger than x radius", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (-1.88,1.26) ellipse [x radius=0.38cm, y radius=0.88cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(-0.68), cm(2.76))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=1.2cm");
    expect(result.newSource).toContain("y radius=1.5cm");
  });

  it("resizes circle and ellipse options while preserving comments and flags", () => {
    const circleSource = String.raw`\begin{tikzpicture}
  \draw (0,0) circle % keep radius options close to the keyword
    [draw, radius=1cm];
\end{tikzpicture}`;
    const circle = applyEditAction(circleSource, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(1.5), cm(1.5))
    });

    expect(circle.kind).toBe("success");
    if (circle.kind !== "success") return;
    expect(circle.newSource).toContain("% keep radius options close to the keyword");
    expect(circle.newSource).toContain("[draw, radius=1.5cm]");

    const ellipseSource = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [draw, x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;
    const ellipse = applyEditAction(ellipseSource, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(1.5), cm(0.75))
    });

    expect(ellipse.kind).toBe("success");
    if (ellipse.kind !== "success") return;
    expect(ellipse.newSource).toContain("[draw, x radius=1.5cm, y radius=0.75cm]");
  });

  it("falls back to current ellipse ratio when preserveAspectRatio is invalid", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(0.5)),
      preserveAspect: true,
      preserveAspectRatio: Number.NaN
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2cm");
    expect(result.newSource).toContain("y radius=1cm");
  });

  it("resizes transform-rotated ellipse statements emitted as ellipse primitives", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45] (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1.2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2.26cm");
    expect(result.newSource).toContain("y radius=0.57cm");
  });

  it("resizes transform-rotated filled ellipse path statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45,fill=yellow] (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1.2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2.26cm");
    expect(result.newSource).toContain("y radius=0.57cm");
  });

  it("resizes transform-rotated rectangle statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45] (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: wp(cm(-1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw[rotate=45] (0.71,0) rectangle (2,2.12);");
  });

  it("keeps rotated rectangle corner drags continuous across world-topness changes", () => {
    let currentSource = String.raw`\begin{tikzpicture}[rotate=40]
  \draw (-3.73,-1.69) rectangle (2.91,2.78);
\end{tikzpicture}`;

    const dragX = 3.316;
    const dragYValues = [0.58, 0.2, -0.1, -0.3, -0.5, -0.7];
    const rewrittenTargetYValues: number[] = [];

    for (const dragY of dragYValues) {
      const result = applyEditAction(currentSource, [], {
        kind: "resizeElement",
        elementId: "path:0",
        role: "top-right",
        newWorld: wp(cm(dragX), cm(dragY))
      });

      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        return;
      }
      currentSource = result.newSource;

      const targetMatch = currentSource.match(/rectangle\s*\(\s*[-+0-9.]+\s*,\s*([-+0-9.]+)\s*\)/);
      expect(targetMatch).not.toBeNull();
      if (!targetMatch) {
        return;
      }
      rewrittenTargetYValues.push(Number(targetMatch[1]));
    }

    for (let index = 1; index < rewrittenTargetYValues.length; index += 1) {
      const prev = rewrittenTargetYValues[index - 1];
      const next = rewrittenTargetYValues[index];
      expect(Math.abs(next - prev)).toBeLessThan(2);
    }
  });

  it("keeps rotated node corner drags stable at existing corners", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,rotate=30] at (0,0) {A};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const nodeBoxPath = semantic.scene.elements.find(
      (element): element is Extract<typeof semantic.scene.elements[number], { kind: "Path" }> =>
        element.sourceRef.sourceId === "path:0" && element.kind === "Path"
    );
    expect(nodeBoxPath).toBeDefined();
    if (!nodeBoxPath) {
      return;
    }

    const corner = nodeBoxPath.commands.find(
      (command): command is Extract<typeof nodeBoxPath.commands[number], { kind: "M" | "L" }> =>
        command.kind === "M" || command.kind === "L"
    )?.to;
    expect(corner).toBeDefined();
    if (!corner) {
      return;
    }

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-right",
      newWorld: corner
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }
    expect(result.newSource).not.toContain("minimum width");
    expect(result.newSource).not.toContain("minimum height");
  });

  it("rejects no-op node resizes at the existing unrotated corner", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const bounds = collectSourceWorldBounds(semantic.scene.elements).get("path:0");
    expect(bounds).toBeDefined();
    if (!bounds) return;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(bounds.maxX, bounds.minY)
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("would not change");
  });

  it("resizes nodes with label/pin adornments using only the node geometry", () => {
    const plainSource = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;
    const adornedSource = String.raw`\begin{tikzpicture}
  \node[draw,label=right:L,pin=above:P] at (0,0) {A};
\end{tikzpicture}`;

    const plainResult = applyEditAction(plainSource, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(120, 120)
    });
    const adornedResult = applyEditAction(adornedSource, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(120, 120)
    });

    expect(plainResult.kind).toBe("success");
    expect(adornedResult.kind).toBe("success");
    if (plainResult.kind !== "success" || adornedResult.kind !== "success") {
      return;
    }

    const extractMinimum = (updatedSource: string, key: "minimum width" | "minimum height") =>
      updatedSource.match(new RegExp(`${key}=([0-9.]+)pt`))?.[1] ?? null;

    expect(extractMinimum(adornedResult.newSource, "minimum width")).toBe(
      extractMinimum(plainResult.newSource, "minimum width")
    );
    expect(extractMinimum(adornedResult.newSource, "minimum height")).toBe(
      extractMinimum(plainResult.newSource, "minimum height")
    );
    expect(adornedResult.newSource).toContain("label=right:L");
    expect(adornedResult.newSource).toContain("pin=above:P");
  });

  it("moves adorned nodes without rewriting label/pin option payloads", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label=right:L,pin=above:P] at (0,0) {A};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const result = applyEditAction(source, semantic.editHandles, {
      kind: "moveElements",
      elementIds: ["path:0"],
      delta: wp(1, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }

    expect(result.newSource).toContain("label=right:L");
    expect(result.newSource).toContain("pin=above:P");
    expect(result.newSource).toContain(" at (0.04,0) ");
    expect(result.newSource).not.toContain("\\node[draw,(");
  });

  it("blocks moveElements direct manipulation for fit nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (a) at (0,0) {};
  \node (b) at (1,0) {};
  \node[draw,fit=(a) (b)] (f) {};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const fitPathId =
      parsed.figure.body
        .find(
          (statement) =>
            statement.kind === "Path"
            && statement.items.some(
              (item) =>
                item.kind === "Node"
                && item.options?.entries.some(
                  (entry) => (entry.kind === "flag" || entry.kind === "kv") && entry.key === "fit"
                )
            )
        )?.id ?? null;
    expect(fitPathId).not.toBeNull();
    if (!fitPathId) {
      return;
    }

    const semantic = evaluateTikzFigure(parsed.figure, source);
    const result = applyEditAction(source, semantic.editHandles, {
      kind: "moveElements",
      elementIds: [fitPathId],
      delta: wp(1, 0)
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") {
      return;
    }
    expect(result.reason).toContain("fit");
    expect(result.reason).toContain("disabled");
  });

  it("resizes transform-rotated circle statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45] (0,0) circle (1cm);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1.2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw[rotate=45] (0,0) circle (2.26cm);");
  });

  it("rejects circle and rectangle resizes through non-invertible transforms", () => {
    const circle = applyEditAction(String.raw`\begin{tikzpicture}
  \draw[xscale=0] (0,0) circle (1cm);
\end{tikzpicture}`, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1))
    });
    expect(circle.kind).toBe("unsupported");
    if (circle.kind === "unsupported") {
      expect(circle.reason).toContain("local geometry");
    }

    const rectangle = applyEditAction(String.raw`\begin{tikzpicture}
  \draw[xscale=0] (0,0) rectangle (2,1);
\end{tikzpicture}`, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(3), cm(2))
    });
    expect(rectangle.kind).toBe("unsupported");
    if (rectangle.kind === "unsupported") {
      expect(rectangle.reason).toContain("local geometry");
    }
  });

  it("keeps side-only circle resizes circular using explicit radius options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) circle [radius=1cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top",
      newWorld: wp(0, cm(1.5))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle [radius=1.5cm]");
  });

  it("rejects invalid and no-op circle resizes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) circle (1cm);
\end{tikzpicture}`;

    const badRole = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "center" as never,
      newWorld: wp(cm(1), 0)
    });
    expect(badRole.kind).toBe("unsupported");
    if (badRole.kind === "unsupported") {
      expect(badRole.reason).toContain("Unsupported resize role");
    }

    const noOp = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(cm(1), 0)
    });
    expect(noOp.kind).toBe("unsupported");
    if (noOp.kind === "unsupported") {
      expect(noOp.reason).toContain("would not change");
    }
  });

  it("inserts per-shape radius options when circle radius is inherited from statement options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[radius=1cm] (0,0) circle;
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(1.5), cm(1.5))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle[radius=1.5cm]");
  });

  it("adds radius entries to an existing circle option list without radius keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) circle [draw=blue];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(1.25), cm(1.25))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle [draw=blue, x radius=1.25cm, y radius=1.25cm]");
  });

  it("normalizes circle x/y radius options back to a single radius", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) circle [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(cm(2), 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2cm");
    expect(result.newSource).toContain("y radius=0.5cm");
  });

  it("expands ellipse radius shorthand into x and y radius options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [radius=1cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(cm(2), 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2cm");
    expect(result.newSource).toContain("y radius=1cm");
    expect(result.newSource).not.toContain("[radius=1cm]");
  });

  it("rejects single-axis ellipse resize when no explicit radius can be inferred", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse;
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(cm(2), 0)
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("explicit circle/ellipse radii");
  });

  it("preserves ellipse aspect ratio for side-only drags", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const horizontal = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(cm(2), 0),
      preserveAspect: true
    });
    expect(horizontal.kind).toBe("success");
    if (horizontal.kind !== "success") return;
    expect(horizontal.newSource).toContain("x radius=2cm");
    expect(horizontal.newSource).toContain("y radius=1cm");

    const vertical = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top",
      newWorld: wp(0, cm(1.5)),
      preserveAspect: true
    });
    expect(vertical.kind).toBe("success");
    if (vertical.kind !== "success") return;
    expect(vertical.newSource).toContain("x radius=3cm");
    expect(vertical.newSource).toContain("y radius=1.5cm");
  });

  it("resizes rectangle statements using opposite-corner anchoring", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: wp(cm(-1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (-1,0) rectangle (2,2);");
  });

  it("resizes filled rectangle statements using opposite-corner anchoring", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: wp(cm(-1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw[fill=yellow] (-1,0) rectangle (2,2);");
  });

  it("updates rectangle relative target coordinates against the moved start corner", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle +(2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: wp(cm(-1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (-1,0) rectangle +(3,2);");
  });

  it("resizes rectangle statements from side handles without moving the opposite side", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const right = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(cm(3), cm(0.5))
    });
    expect(right.kind).toBe("success");
    if (right.kind !== "success") return;
    expect(right.newSource).toContain("\\draw (0,0) rectangle (3,1);");

    const top = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top",
      newWorld: wp(cm(1), cm(2))
    });
    expect(top.kind).toBe("success");
    if (top.kind !== "success") return;
    expect(top.newSource).toContain("\\draw (0,0) rectangle (2,2);");

    const left = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "left",
      newWorld: wp(cm(-1), cm(0.5))
    });
    expect(left.kind).toBe("success");
    if (left.kind !== "success") return;
    expect(left.newSource).toContain("\\draw (-1,0) rectangle (2,1);");

    const bottom = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom",
      newWorld: wp(cm(1), cm(-1))
    });
    expect(bottom.kind).toBe("success");
    if (bottom.kind !== "success") return;
    expect(bottom.newSource).toContain("\\draw (0,-1) rectangle (2,1);");
  });

  it("resizes rectangles whose authored start coordinate is the visual maximum corner", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (2,1) rectangle (0,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-left",
      newWorld: wp(cm(-1), cm(-1))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (2,1) rectangle (-1,-1);");
  });

  it("resizes rectangle statements from the bottom-right corner", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(cm(3), cm(-1))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,-1) rectangle (3,1);");
  });

  it("preserves rectangle proportions during corner resize when preserveAspect is enabled", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: wp(cm(-1), cm(2)),
      preserveAspect: true
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (-2,0) rectangle (2,2);");
  });

  it("uses the provided rectangle aspect ratio when preserving proportions", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (3,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: wp(cm(-1), cm(2)),
      preserveAspect: true,
      preserveAspectRatio: 0.5
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (-1,0) rectangle (3,2);");
  });

  it("rejects invalid and no-op rectangle resizes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const badRole = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "center" as never,
      newWorld: wp(cm(1), cm(0.5))
    });
    expect(badRole.kind).toBe("unsupported");
    if (badRole.kind === "unsupported") {
      expect(badRole.reason).toContain("Unsupported resize role");
    }

    const noOp = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(cm(2), cm(0.5))
    });
    expect(noOp.kind).toBe("unsupported");
    if (noOp.kind === "unsupported") {
      expect(noOp.reason).toContain("would not change");
    }
  });

  it("rejects rectangles without explicit editable start and target coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw rectangle (2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(cm(3), cm(0.5))
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("explicit start and target coordinates");
  });

  it("rejects rectangle resize when rectangle coordinates are not rewritable", () => {
    const source = String.raw`\begin{tikzpicture}
  \coordinate (A) at (0,0);
  \coordinate (B) at (2,1);
  \draw (A) rectangle (B);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:2",
      role: "right",
      newWorld: wp(cm(3), cm(0.5))
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("rewritable rectangle coordinates");
  });

  it("resizes rectangles inside nested scopes", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \begin{scope}
      \draw (0,0) rectangle (2,1);
    \end{scope}
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:2",
      role: "top-right",
      newWorld: wp(cm(3), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (0,0) rectangle (3,2);");
  });

  it("resizes scopes by rewriting scale and compensating shift", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "top-left",
      newWorld: wp(cm(-1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xscale=1.5");
    expect(result.newSource).toContain("yscale=2");
    const xshiftMatch = result.newSource.match(/xshift=([-0-9.]+)pt/);
    expect(xshiftMatch).not.toBeNull();
    expect(xshiftMatch ? Number(xshiftMatch[1]) : Number.NaN).toBeLessThan(-20);
    expect(result.newSource).not.toContain("yshift=");
    expect(result.changedSourceIds).toEqual(["scope:0", "path:1"]);
  });

  it("resizes scopes by replacing existing transform options while preserving other options", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[draw=blue,xscale=2,yshift=5pt]
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "bottom-right",
      newWorld: wp(cm(3), cm(-2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("[draw=blue");
    expect(result.newSource).not.toContain("yshift=5pt");
    expect(result.newSource).toContain("xscale=");
    expect(result.newSource).toContain("yscale=");
  });

  it("resizes scopes while preserving unknown entries in existing option lists", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[draw=blue,{unparsed option},xscale=2,yshift=5pt]
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "bottom-right",
      newWorld: wp(cm(3), cm(-2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("draw=blue");
    expect(result.newSource).toContain("{unparsed option}");
    expect(result.newSource).toContain("xscale=");
    expect(result.newSource).toContain("yscale=");
    expect(result.newSource).not.toContain("yshift=5pt");
  });

  it("expands changed ids for nested scope resizes", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) rectangle (2,1);
    \begin{scope}
      \draw (3,0) rectangle (4,1);
    \end{scope}
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "right",
      newWorld: wp(cm(5), cm(0.5))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.changedSourceIds).toEqual(["scope:0", "path:1", "scope:2", "path:3"]);
  });

  it("resizes nested scopes directly and expands only their nested contents", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \begin{scope}
      \draw (0,0) rectangle (2,1);
    \end{scope}
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:1",
      role: "right",
      newWorld: wp(cm(3), cm(0.5))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xscale=1.5");
    expect(result.changedSourceIds).toEqual(["scope:1", "path:2"]);
  });

  it("resizes scopes from left and bottom side handles", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const left = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "left",
      newWorld: wp(cm(-1), cm(0.5))
    });
    expect(left.kind).toBe("success");
    if (left.kind !== "success") return;
    expect(left.newSource).toContain("xscale=1.5");

    const bottom = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "bottom",
      newWorld: wp(cm(1), cm(-1))
    });
    expect(bottom.kind).toBe("success");
    if (bottom.kind !== "success") return;
    expect(bottom.newSource).toContain("yscale=2");

    const top = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "top",
      newWorld: wp(cm(1), cm(2))
    });
    expect(top.kind).toBe("success");
    if (top.kind !== "success") return;
    expect(top.newSource).toContain("yscale=2");
  });

  it("resizes scopes from the bottom-left corner and preserves non-transform option entries", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[draw=blue,rounded corners,xscale=2,yshift=5pt]
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "bottom-left",
      newWorld: wp(cm(-1), cm(-1))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("draw=blue");
    expect(result.newSource).toContain("rounded corners");
    expect(result.newSource).toContain("xscale=");
    expect(result.newSource).toContain("yscale=");
  });

  it("rejects no-op scope resizes", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "right",
      newWorld: wp(cm(2), cm(0.5))
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("would not change");
  });

  it("rejects non-finite scope resize transforms", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "right",
      newWorld: wp(cm(3), cm(0.5)),
      referenceScopeTransform: {
        xscale: Number.POSITIVE_INFINITY,
        yscale: 1,
        xshift: 0,
        yshift: 0
      }
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("non-finite transform");
  });

  it("rejects degenerate, rotated, and invalid-role scope resizes", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[rotate=30]
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const rotated = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "right",
      newWorld: wp(cm(3), 0)
    });
    expect(rotated.kind).toBe("unsupported");
    if (rotated.kind === "unsupported") {
      expect(rotated.reason).toContain("non-rotated scopes");
    }

    const degenerate = applyEditAction(source.replace("[rotate=30]", ""), [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "right",
      newWorld: wp(cm(3), 0),
      referenceBounds: wb(0, 0, 0, 10)
    });
    expect(degenerate.kind).toBe("unsupported");
    if (degenerate.kind === "unsupported") {
      expect(degenerate.reason).toContain("non-zero bounds");
    }

    const badRole = applyEditAction(source.replace("[rotate=30]", ""), [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "center" as never,
      newWorld: wp(cm(3), 0)
    });
    expect(badRole.kind).toBe("unsupported");
    if (badRole.kind === "unsupported") {
      expect(badRole.reason).toContain("Unsupported resize role");
    }

    const emptyScope = applyEditAction(String.raw`\begin{tikzpicture}
  \begin{scope}
  \end{scope}
\end{tikzpicture}`, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "right",
      newWorld: wp(cm(1), 0)
    });
    expect(emptyScope.kind).toBe("unsupported");
    if (emptyScope.kind === "unsupported") {
      expect(emptyScope.reason).toContain("No geometry bounds");
    }
  });

  it("preserves aspect ratio when resizing scopes from a corner", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "bottom-right",
      newWorld: wp(cm(4), cm(-1.2)),
      preserveAspect: true
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xscale=2");
    expect(result.newSource).toContain("yscale=2");
  });

  it("falls back from diamond side-specific resize when minimum size is set", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,shape=diamond,minimum size=40pt] at (0,0) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(120, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum size=40pt");
    expect(result.newSource).toContain("minimum width=");
  });

  it("infers diamond companion dimensions from one explicit minimum dimension", () => {
    const widthOnlySource = String.raw`\begin{tikzpicture}
  \node[draw,shape=diamond,aspect=2,minimum width=40pt] at (0,0) {};
\end{tikzpicture}`;
    const vertical = applyEditAction(widthOnlySource, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top",
      newWorld: wp(0, 120)
    });

    expect(vertical.kind).toBe("success");
    if (vertical.kind !== "success") return;
    expect(vertical.newSource).toContain("minimum width=40pt");
    expect(vertical.newSource).toContain("minimum height=");

    const heightOnlySource = String.raw`\begin{tikzpicture}
  \node[draw,shape=diamond,aspect=2,minimum height=20pt] at (0,0) {};
\end{tikzpicture}`;
    const horizontal = applyEditAction(heightOnlySource, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(120, 0)
    });

    expect(horizontal.kind).toBe("success");
    if (horizontal.kind !== "success") return;
    expect(horizontal.newSource).toContain("minimum width=");
    expect(horizontal.newSource).toContain("minimum height=20pt");
  });

  it("keeps the opposite scope edges fixed in semantic bounds during referenced top-right resize", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw[fill=red] (-2.5,1.5) rectangle (-0.8,-0.3);
    \draw[fill=blue] (-2.4,0) rectangle (-0.9,-2);
  \end{scope}
\end{tikzpicture}`;

    const before = scopeBodyBounds(source);
    expect(before).toBeDefined();
    if (!before) {
      return;
    }

    const parsed = parseTikz(source, { recover: true });
    const evaluated = evaluateTikzFigure(parsed.figure, source);
    const result = applyEditAction(source, evaluated.editHandles, {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "top-right",
      newWorld: wp(before.maxX + cm(2), before.maxY),
      referenceBounds: before,
      referenceScopeTransform: { xscale: 1, yscale: 1, xshift: 0, yshift: 0 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }

    const after = scopeBodyBounds(result.newSource);
    expect(after).toBeDefined();
    if (!after) {
      return;
    }

    expect(Math.abs(after.minX - before.minX)).toBeLessThan(0.5);
    expect(Math.abs(after.minY - before.minY)).toBeLessThan(0.5);
    expect(after.maxX).toBeGreaterThan(before.maxX);
  });

  it("returns unsupported for non-node elements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(10, 0)
    });

    expect(result.kind).toBe("unsupported");
  });

  it("reports changedSourceIds for successful resize edits", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: wp(120, 120)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.changedSourceIds).toEqual(["path:0"]);
  });

  it("blocks resizeElement direct manipulation for fit nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (a) at (0,0) {};
  \node (b) at (1,0) {};
  \node[draw,fit=(a) (b)] (f) {};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const fitPathId =
      parsed.figure.body
        .find(
          (statement) =>
            statement.kind === "Path"
            && statement.items.some(
              (item) =>
                item.kind === "Node"
                && item.options?.entries.some(
                  (entry) => (entry.kind === "flag" || entry.kind === "kv") && entry.key === "fit"
                )
            )
        )?.id ?? null;
    expect(fitPathId).not.toBeNull();
    if (!fitPathId) {
      return;
    }

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: fitPathId,
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1))
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") {
      return;
    }
    expect(result.reason).toContain("fit");
    expect(result.reason).toContain("disabled");

    const fitPath = parsed.figure.body.find((statement) => statement.id === fitPathId);
    const fitNode = fitPath?.kind === "Path" ? fitPath.items.find((item) => item.kind === "Node") : null;
    expect(fitNode?.kind).toBe("Node");
    if (!fitNode || fitNode.kind !== "Node") {
      return;
    }

    const nodeResult = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: fitNode.id,
      role: "bottom-right",
      newWorld: wp(cm(2), cm(1))
    });

    expect(nodeResult.kind).toBe("unsupported");
    if (nodeResult.kind !== "unsupported") {
      return;
    }
    expect(nodeResult.reason).toContain("fit");
    expect(nodeResult.reason).toContain("disabled");
  });
});
