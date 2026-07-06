import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { getInspectorDescriptor } from "../packages/core/src/edit/inspector.js";

describe("getInspectorDescriptor – generated targets", () => {
  it("edits top-level foreach-generated elements through the loop template", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,1} {
    \draw (\x,0) -- (\x,1);
  }
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });

    expect(descriptor.readOnlyReason).toBeUndefined();
    expect(descriptor.infoNote).toContain("foreach template");

    const lineWidth = descriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.kind === "lineWidth");
    expect(lineWidth).toBeDefined();
    if (!lineWidth || lineWidth.kind !== "lineWidth") {
      throw new Error("Expected a writable line-width control");
    }
    expect(lineWidth.write.writable).toBe(true);
    expect(lineWidth.write.elementId.startsWith("__foreach_template__:foreach:")).toBe(true);

    const updated = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: lineWidth.write.elementId,
      level: lineWidth.write.level,
      key: lineWidth.write.key,
      value: "2pt"
    });
    expect(updated.kind).toBe("success");
    if (updated.kind !== "success") {
      throw new Error("Expected foreach template edit to succeed");
    }
    expect(updated.newSource).toContain(String.raw`\draw[line width=2pt] (\x,0) -- (\x,1);`);

    const rerendered = renderTikzToSvg(updated.newSource);
    const paths = rerendered.semantic.scene.elements.filter((entry) => entry.kind === "Path");
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(path.style.lineWidth).toBeCloseTo(2, 6);
    }
  });

  it("keeps foreach-variable-backed properties read-only while allowing constant ones", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \c in {red,blue} {
    \draw[draw=\c,line width=1pt] (0,0) -- (0,1);
  }
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });

    const strokeColor = descriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.kind === "color" && property.id === "stroke-color");
    const lineWidth = descriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.kind === "lineWidth");
    if (!strokeColor || strokeColor.kind !== "color") {
      throw new Error("Expected a stroke color control");
    }
    if (!lineWidth || lineWidth.kind !== "lineWidth") {
      throw new Error("Expected a line width control");
    }

    expect(strokeColor.write.writable).toBe(false);
    expect(strokeColor.write.reason).toContain("iteration variables");
    expect(lineWidth.write.writable).toBe(true);
  });

  it("marks foreach-variable-backed complex inspector controls read-only", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \c in {red,blue} {
    \draw[
      draw=\c,
      fill=\c,
      pattern color=\c,
      pattern={Lines[angle=0,distance=4pt]},
      shade,
      top color=\c,
      dashed,
      line cap=round,
      line join=round,
      rounded corners=2pt,
      decorate,
      decoration={snake,amplitude=1pt},
      drop shadow={shadow xshift=1pt,fill=\c,opacity=.5}
    ] (0,0) -- (1,0) -- (1,1) -- cycle;
  }
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected foreach path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const properties = descriptor.sections.flatMap((section) => section.properties);
    const readOnlyIds = new Set(
      properties
        .filter((property) => "write" in property && property.write?.writable === false)
        .map((property) => property.id)
    );

    expect(readOnlyIds).toContain("stroke-color");
    expect(readOnlyIds).toContain("fill-color");
    expect(readOnlyIds).toContain("fill-mode");
    expect(readOnlyIds).toContain("shadow-preset");
    expect(readOnlyIds.size).toBeGreaterThanOrEqual(5);

    const constantLineWidth = properties.find((property) => property.kind === "lineWidth");
    expect(constantLineWidth?.kind).toBe("lineWidth");
    if (!constantLineWidth || constantLineWidth.kind !== "lineWidth") {
      throw new Error("Expected line width property");
    }
    expect(constantLineWidth.write.writable).toBe(true);
  });

  it("edits nested statement foreach-generated elements through the innermost loop template", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {3,4,5} {
    \foreach \y in {0,1,2} {
      \draw (\x,\y) rectangle (\x+1,\y+1);
    }
  }
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });

    expect(descriptor.readOnlyReason).toBeUndefined();
    expect(descriptor.infoNote).toContain("foreach template");

    const lineWidth = descriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.kind === "lineWidth");
    expect(lineWidth).toBeDefined();
    if (!lineWidth || lineWidth.kind !== "lineWidth") {
      throw new Error("Expected a writable line-width control");
    }
    expect(lineWidth.write.writable).toBe(true);
    expect(lineWidth.write.elementId.startsWith("__foreach_template__:foreach:")).toBe(true);
    expect(lineWidth.write.elementId).toContain("/foreach:");

    const updated = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: lineWidth.write.elementId,
      level: lineWidth.write.level,
      key: lineWidth.write.key,
      value: "2pt"
    });
    expect(updated.kind).toBe("success");
    if (updated.kind !== "success") {
      throw new Error("Expected nested foreach template edit to succeed");
    }
    expect(updated.newSource).toContain(String.raw`\draw[line width=2pt] (\x,\y) rectangle (\x+1,\y+1);`);

    const rerendered = renderTikzToSvg(updated.newSource);
    const paths = rerendered.semantic.scene.elements.filter((entry) => entry.kind === "Path");
    expect(paths).toHaveLength(9);
    for (const path of paths) {
      expect(path.style.lineWidth).toBeCloseTo(2, 6);
    }
  });

  it("keeps path-foreach-generated elements read-only in inspector", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) foreach \x in {1,2} { -- (\x,0) };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected a path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });

    expect(descriptor.readOnlyReason).toBe("This \\foreach expansion cannot be edited from the inspector.");
  });

  it("edits pic-generated elements through the shared pic template", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{tick/.pic={\draw[line width=.4pt,blue] (0,0) -- (1,0);}}
  \pic at (0,0) {tick};
  \pic at (0,1) {tick};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path" && entry.origin?.picStack?.length);
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected pic-generated path element");
    }

    const descriptor = getInspectorDescriptor(element, {
      source,
      editHandles: rendered.semantic.editHandles
    });

    expect(descriptor.readOnlyReason).toBeUndefined();
    expect(descriptor.writeTargetId).toMatch(/^__pic_template__:/);
    const lineWidth = descriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.kind === "lineWidth");
    expect(lineWidth?.kind).toBe("lineWidth");
    if (!lineWidth || lineWidth.kind !== "lineWidth") {
      throw new Error("Expected line width property");
    }
    expect(lineWidth.write.writable).toBe(true);
    if (!descriptor.writeTargetId) {
      throw new Error("Expected a pic template write target");
    }

    const updated = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "setProperty",
      elementId: descriptor.writeTargetId,
      level: lineWidth.write.level,
      key: lineWidth.write.key,
      value: "2pt"
    });
    expect(updated.kind).toBe("success");
    if (updated.kind !== "success") {
      throw new Error("Expected pic template edit to succeed");
    }
    expect(updated.newSource).toContain(String.raw`\draw[line width=2pt, blue] (0,0) -- (1,0);`);
    const rerendered = renderTikzToSvg(updated.newSource);
    const picPaths = rerendered.semantic.scene.elements.filter((entry) => entry.kind === "Path" && entry.origin?.picStack?.length);
    expect(picPaths).toHaveLength(2);
    for (const path of picPaths) {
      expect(path.style.lineWidth).toBe(2);
    }
  });

  it("keeps statements after foreach editable in inspector", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[red] (1.68,0.2) rectangle (1,-0.32);

  \foreach \x in {0,1} { \draw (0,0) -- (1,1); }

  \draw[blue] (-0.6,1.4) rectangle (0.2,0.8);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const blueRectangle = rendered.semantic.scene.elements.find(
      (entry) =>
        entry.kind === "Path" &&
        entry.shapeHint === "rectangle" &&
        entry.sourceRef.sourceId === "path:2"
    );
    expect(blueRectangle).toBeDefined();
    if (!blueRectangle) {
      throw new Error("Expected rectangle path after foreach");
    }

    const descriptor = getInspectorDescriptor(blueRectangle, {
      source,
      editHandles: rendered.semantic.editHandles
    });

    expect(descriptor.readOnlyReason).toBeUndefined();

    const strokeColor = descriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.kind === "color" && property.id === "stroke-color");
    expect(strokeColor).toBeDefined();
    if (!strokeColor || strokeColor.kind !== "color") {
      throw new Error("Expected stroke color property");
    }
    expect(strokeColor.write.writable).toBe(true);
  });

  it("keeps non-first statements editable in inspector", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[red] (0,0) rectangle (1,1);
  \draw[green] (2,0) rectangle (3,1);
  \draw[blue] (4,0) rectangle (5,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const secondRectangle = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Path" && entry.shapeHint === "rectangle" && entry.sourceRef.sourceId === "path:1"
    );
    const thirdRectangle = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Path" && entry.shapeHint === "rectangle" && entry.sourceRef.sourceId === "path:2"
    );
    expect(secondRectangle).toBeDefined();
    expect(thirdRectangle).toBeDefined();
    if (!secondRectangle || !thirdRectangle) {
      throw new Error("Expected second and third rectangle paths");
    }

    const secondDescriptor = getInspectorDescriptor(secondRectangle, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const thirdDescriptor = getInspectorDescriptor(thirdRectangle, {
      source,
      editHandles: rendered.semantic.editHandles
    });

    const secondStrokeColor = secondDescriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.kind === "color" && property.id === "stroke-color");
    const thirdStrokeColor = thirdDescriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.kind === "color" && property.id === "stroke-color");
    expect(secondStrokeColor).toBeDefined();
    expect(thirdStrokeColor).toBeDefined();
    if (!secondStrokeColor || secondStrokeColor.kind !== "color") {
      throw new Error("Expected writable stroke color control for second statement");
    }
    if (!thirdStrokeColor || thirdStrokeColor.kind !== "color") {
      throw new Error("Expected writable stroke color control for third statement");
    }

    expect(secondStrokeColor.write.writable).toBe(true);
    expect(thirdStrokeColor.write.writable).toBe(true);
    expect(secondDescriptor.writeTargetId).toBe("path:1");
    expect(thirdDescriptor.writeTargetId).toBe("path:2");
  });
});
