import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { getInspectorDescriptor } from "../packages/core/src/edit/inspector.js";
import {
  buildNodeFontSetPropertyMutation,
  buildNodeInnerSepSetPropertyMutation,
  buildNodeMinimumDimensionSetPropertyMutations,
  buildNodeShapeSetPropertyMutation
} from "../packages/core/src/edit/property-write-builders.js";
import { buildMultiInspectorModel } from "../packages/app/src/ui/inspector-panel/panel-helpers.js";

describe("getInspectorDescriptor – nodes", () => {
  it("shows a node section for node-backed text with shape, padding, minimum size, font, and text color controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[circle,inner sep=3pt,font=\Large\bfseries\sffamily] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }

    const descriptor = getInspectorDescriptor(text, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const sectionIds = descriptor.sections.map((section) => section.id);
    expect(sectionIds).toContain("node");

    const nodeSection = descriptor.sections.find((section) => section.id === "node");
    expect(nodeSection).toBeDefined();
    if (!nodeSection) {
      throw new Error("Expected node section");
    }
    expect(nodeSection.properties.map((property) => property.kind)).toEqual([
      "nodeShape",
      "length",
      "length",
      "length",
      "nodeTextAlign",
      "nodeFont",
      "color"
    ]);
    expect(nodeSection.properties.map((property) => property.id)).toEqual([
      "node-shape",
      "node-inner-sep",
      "node-minimum-width",
      "node-minimum-height",
      "node-text-align",
      "node-font",
      "node-text-color"
    ]);
  });

  it("exposes node text color through the node section using the text key", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[circle,text=red] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }

    const descriptor = getInspectorDescriptor(text, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const nodeSection = descriptor.sections.find((section) => section.id === "node");
    expect(nodeSection).toBeDefined();
    if (!nodeSection) {
      throw new Error("Expected node section");
    }
    const textColor = nodeSection.properties.find((property) => property.id === "node-text-color");
    if (!textColor || textColor.kind !== "color") {
      throw new Error("Expected node text color property");
    }

    expect(textColor.syntaxValue).toBe("red");
    expect(textColor.write.key).toBe("text");
  });

  it("normalizes node align aliases and treats align=none as unset", () => {
    const rightSource = String.raw`\begin{tikzpicture}
  \node[align=flush right] at (0,0) {A};
\end{tikzpicture}`;
    const noneSource = String.raw`\begin{tikzpicture}
  \node[align=none] at (0,0) {A};
\end{tikzpicture}`;

    const rightElement = renderTikzToSvg(rightSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const noneElement = renderTikzToSvg(noneSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(rightElement).toBeDefined();
    expect(noneElement).toBeDefined();
    if (!rightElement || !noneElement) {
      throw new Error("Expected text elements");
    }

    const rightDescriptor = getInspectorDescriptor(rightElement, { source: rightSource });
    const noneDescriptor = getInspectorDescriptor(noneElement, { source: noneSource });
    const rightAlign = getNodePropertyById(rightDescriptor, "node-text-align");
    const noneAlign = getNodePropertyById(noneDescriptor, "node-text-align");
    expect(rightAlign?.kind).toBe("nodeTextAlign");
    expect(noneAlign?.kind).toBe("nodeTextAlign");
    if (!rightAlign || rightAlign.kind !== "nodeTextAlign" || !noneAlign || noneAlign.kind !== "nodeTextAlign") {
      throw new Error("Expected node text align property");
    }

    expect(rightAlign.value).toBe("right");
    expect(noneAlign.value).toBe("unset");
  });

  it("shows node text width when text width or align is set and keeps it nullable", () => {
    const hiddenSource = String.raw`\begin{tikzpicture}
  \node at (0,0) {A};
\end{tikzpicture}`;
    const alignSource = String.raw`\begin{tikzpicture}
  \node[align=center] at (0,0) {A};
\end{tikzpicture}`;
    const widthSource = String.raw`\begin{tikzpicture}
  \node[text width=2cm] at (0,0) {A};
\end{tikzpicture}`;

    const hiddenElement = renderTikzToSvg(hiddenSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const alignElement = renderTikzToSvg(alignSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const widthElement = renderTikzToSvg(widthSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(hiddenElement).toBeDefined();
    expect(alignElement).toBeDefined();
    expect(widthElement).toBeDefined();
    if (!hiddenElement || !alignElement || !widthElement) {
      throw new Error("Expected text elements");
    }

    const hiddenDescriptor = getInspectorDescriptor(hiddenElement, { source: hiddenSource });
    const alignDescriptor = getInspectorDescriptor(alignElement, { source: alignSource });
    const widthDescriptor = getInspectorDescriptor(widthElement, { source: widthSource });

    const hiddenWidth = getNodePropertyById(hiddenDescriptor, "node-text-width");
    const alignWidth = getNodePropertyById(alignDescriptor, "node-text-width");
    const widthWidth = getNodePropertyById(widthDescriptor, "node-text-width");

    expect(hiddenWidth).toBeUndefined();
    expect(alignWidth?.kind).toBe("optionalLength");
    expect(widthWidth?.kind).toBe("optionalLength");
    if (!alignWidth || alignWidth.kind !== "optionalLength" || !widthWidth || widthWidth.kind !== "optionalLength") {
      throw new Error("Expected optional node text width properties");
    }

    expect(alignWidth.value).toBeNull();
    expect(widthWidth.value).not.toBeNull();
  });

  it("round-trips node text align and text width through inspector write targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[align=center,text width=2cm] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }

    const descriptor = getInspectorDescriptor(text, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const align = getNodePropertyById(descriptor, "node-text-align");
    const textWidth = getNodePropertyById(descriptor, "node-text-width");
    expect(align?.kind).toBe("nodeTextAlign");
    expect(textWidth?.kind).toBe("optionalLength");
    if (!align || align.kind !== "nodeTextAlign" || !textWidth || textWidth.kind !== "optionalLength") {
      throw new Error("Expected node text layout properties");
    }

    const removedAlign = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: align.write.elementId,
      level: align.write.level,
      key: align.write.key,
      value: "",
      clearKeys: align.clearKeys
    });
    expect(removedAlign.kind).toBe("success");
    if (removedAlign.kind !== "success") {
      throw new Error("Expected successful align clear mutation");
    }
    expect(removedAlign.newSource).not.toContain("align=");

    const removedWidth = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: textWidth.write.elementId,
      level: textWidth.write.level,
      key: textWidth.write.key,
      value: "",
      clearKeys: textWidth.clearKeys
    });
    expect(removedWidth.kind).toBe("success");
    if (removedWidth.kind !== "success") {
      throw new Error("Expected successful text width clear mutation");
    }
    expect(removedWidth.newSource).not.toContain("text width=");

    const updatedWidth = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: textWidth.write.elementId,
      level: textWidth.write.level,
      key: textWidth.write.key,
      value: "12pt",
      clearKeys: textWidth.clearKeys
    });
    expect(updatedWidth.kind).toBe("success");
    if (updatedWidth.kind !== "success") {
      throw new Error("Expected successful text width mutation");
    }
    expect(updatedWidth.newSource).toContain("text width=12pt");
  });

  it("removes node text color when setProperty receives an empty text value", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[circle,text=red] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }

    const descriptor = getInspectorDescriptor(text, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const nodeSection = descriptor.sections.find((section) => section.id === "node");
    expect(nodeSection).toBeDefined();
    if (!nodeSection) {
      throw new Error("Expected node section");
    }
    const textColor = nodeSection.properties.find((property) => property.id === "node-text-color");
    if (!textColor || textColor.kind !== "color") {
      throw new Error("Expected node text color property");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: textColor.write.elementId,
      level: textColor.write.level,
      key: textColor.write.key,
      value: "",
      clearKeys: ["text", "text color"]
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected successful text color reset mutation");
    }

    expect(result.newSource).not.toContain("text=red");
    expect(result.newSource).not.toContain("text color=");
  });

  it.each([
    {
      name: "bare standalone node",
      source: String.raw`\begin{tikzpicture}
  \node at (1,2) {node};
\end{tikzpicture}`,
      expectedValue: null,
      expectedSyntaxValue: null
    },
    {
      name: "fill-only node",
      source: String.raw`\begin{tikzpicture}
  \node[fill=red] at (1,2) {node};
\end{tikzpicture}`,
      expectedValue: null,
      expectedSyntaxValue: null
    },
    {
      name: "node on a draw path",
      source: String.raw`\begin{tikzpicture}
  \draw (0,0) node {node};
\end{tikzpicture}`,
      expectedValue: null,
      expectedSyntaxValue: null
    },
    {
      name: "node with explicit draw",
      source: String.raw`\begin{tikzpicture}
  \node[draw] at (1,2) {node};
\end{tikzpicture}`,
      expectedValue: "black",
      expectedSyntaxValue: null
    },
    {
      name: "node with every node draw style",
      source: String.raw`\begin{tikzpicture}[every node/.style={draw=red}]
  \node at (1,2) {node};
\end{tikzpicture}`,
      expectedValue: "red",
      expectedSyntaxValue: "red"
    },
    {
      name: "node disabling inherited every node draw style",
      source: String.raw`\begin{tikzpicture}[every node/.style={draw=red}]
  \node[draw=none] at (1,2) {node};
\end{tikzpicture}`,
      expectedValue: null,
      expectedSyntaxValue: "none"
    }
  ])("presents inactive node stroke as none for $name", ({ source, expectedValue, expectedSyntaxValue }) => {
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text" && entry.text === "node");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }

    const descriptor = getInspectorDescriptor(text, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const strokeColor = getStrokeColorProperty(descriptor);

    expect(strokeColor.value).toBe(expectedValue);
    expect(strokeColor.syntaxValue).toBe(expectedSyntaxValue);
  });

  it("writes standalone node stroke options outside literal node text", () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0,3) {node};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }

    const descriptor = getInspectorDescriptor(text, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const strokeColor = getStrokeColorProperty(descriptor);
    expect(strokeColor.value).toBeNull();

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: strokeColor.write.elementId,
      level: strokeColor.write.level,
      key: strokeColor.write.key,
      value: "red"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected successful stroke color mutation");
    }

    expect(result.newSource).toBe(String.raw`\begin{tikzpicture}
  \node[draw=red] at (0,3) {node};
\end{tikzpicture}`);
    expect(result.changedSourceIds).toEqual(["path:0"]);
  });

  it("marks local node draw as removable when setting stroke back to none", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw=red] at (0,3) {node};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }

    const descriptor = getInspectorDescriptor(text, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const strokeColor = getStrokeColorProperty(descriptor);
    expect(strokeColor.write.clearOnNoneKeys).toEqual([]);

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: strokeColor.write.elementId,
      level: strokeColor.write.level,
      key: strokeColor.write.key,
      value: "",
      clearKeys: strokeColor.write.clearOnNoneKeys
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected successful stroke color removal");
    }

    expect(result.newSource).toBe(String.raw`\begin{tikzpicture}
  \node at (0,3) {node};
\end{tikzpicture}`);
  });

  it("keeps node-backed path sections below node paint controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw=red,fill=blue] at (0,3) {node};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const nodeBox = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Path" && entry.id.startsWith("scene-node-box:")
    );
    expect(nodeBox).toBeDefined();
    if (!nodeBox) {
      throw new Error("Expected node box path element");
    }

    const descriptor = getInspectorDescriptor(nodeBox, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const sectionIds = descriptor.sections.map((section) => section.id);

    expect(sectionIds.indexOf("node")).toBeLessThan(sectionIds.indexOf("stroke"));
    expect(sectionIds.indexOf("stroke")).toBeLessThan(sectionIds.indexOf("fill"));
    expect(sectionIds.indexOf("fill")).toBeLessThan(sectionIds.indexOf("path"));
  });

  it("keeps none as an override when inherited node draw would reappear", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={draw=blue}]
  \node[draw=red] at (0,3) {node};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }

    const descriptor = getInspectorDescriptor(text, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const strokeColor = getStrokeColorProperty(descriptor);
    expect(strokeColor.write.clearOnNoneKeys).toBeUndefined();
  });

  it.each([
    {
      name: "path-attached node",
      source: String.raw`\begin{tikzpicture}
  \draw (0,0) -- node {node} (1,0);
\end{tikzpicture}`,
      expected: String.raw`\begin{tikzpicture}
  \draw (0,0) -- node[draw=red] {node} (1,0);
\end{tikzpicture}`
    },
    {
      name: "path node operation",
      source: String.raw`\begin{tikzpicture}
  \path (0,0) node {node};
\end{tikzpicture}`,
      expected: String.raw`\begin{tikzpicture}
  \path (0,0) node[draw=red] {node};
\end{tikzpicture}`
    },
    {
      name: "to node operation",
      source: String.raw`\begin{tikzpicture}
  \draw (0,0) to node {node} (1,0);
\end{tikzpicture}`,
      expected: String.raw`\begin{tikzpicture}
  \draw (0,0) to node[draw=red] {node} (1,0);
\end{tikzpicture}`
    },
    {
      name: "tree child node",
      source: String.raw`\begin{tikzpicture}
  \node {root} child { node {node} };
\end{tikzpicture}`,
      expected: String.raw`\begin{tikzpicture}
  \node {root} child { node[draw=red] {node} };
\end{tikzpicture}`
    },
    {
      name: "matrix-of-nodes cell",
      source: String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] at (0,0) {node};
\end{tikzpicture}`,
      expected: String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] at (0,0) {|[draw=red]| node};
\end{tikzpicture}`
    }
  ])("writes $name stroke options around literal node text", ({ source, expected }) => {
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text" && entry.text === "node");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }

    const descriptor = getInspectorDescriptor(text, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const strokeColor = getStrokeColorProperty(descriptor);

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: strokeColor.write.elementId,
      level: strokeColor.write.level,
      key: strokeColor.write.key,
      value: "red"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected successful stroke color mutation");
    }

    expect(result.newSource).toBe(expected);
    expect(result.changedSourceIds).toEqual(["path:0"]);
  });

  it("detects node shape from flags and shape= values, including custom fallback note", () => {
    const circleSource = String.raw`\begin{tikzpicture}
  \node[circle] at (0,0) {A};
\end{tikzpicture}`;
    const diamondSource = String.raw`\begin{tikzpicture}
  \node[shape=diamond] at (0,0) {A};
\end{tikzpicture}`;
    const customSource = String.raw`\begin{tikzpicture}
  \node[shape=rounded rectangle] at (0,0) {A};
\end{tikzpicture}`;

    const circleElement = renderTikzToSvg(circleSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const diamondElement = renderTikzToSvg(diamondSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const customElement = renderTikzToSvg(customSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(circleElement).toBeDefined();
    expect(diamondElement).toBeDefined();
    expect(customElement).toBeDefined();
    if (!circleElement || !diamondElement || !customElement) {
      throw new Error("Expected text elements");
    }

    const circleDescriptor = getInspectorDescriptor(circleElement, { source: circleSource });
    const diamondDescriptor = getInspectorDescriptor(diamondElement, { source: diamondSource });
    const customDescriptor = getInspectorDescriptor(customElement, { source: customSource });

    const circleShape = getNodeShapeProperty(circleDescriptor);
    const diamondShape = getNodeShapeProperty(diamondDescriptor);
    const customShape = getNodeShapeProperty(customDescriptor);

    expect(circleShape.value).toBe("circle");
    expect(diamondShape.value).toBe("diamond");
    expect(customShape.value).toBe("custom");
    expect(customShape.note).toContain("Custom node shape detected");
  });

  it("adds adaptive shape controls under node shape for supported core and arrow shapes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[star,star points=7,star point ratio=1.8,shape border rotate=25] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }

    const descriptor = getInspectorDescriptor(text, { source, editHandles: rendered.semantic.editHandles });
    const nodeSection = descriptor.sections.find((section) => section.id === "node");
    expect(nodeSection).toBeDefined();
    if (!nodeSection) {
      throw new Error("Expected node section");
    }
    const propertyIds = nodeSection.properties.map((property) => property.id);
    expect(propertyIds).toContain("node-shape-star-points");
    expect(propertyIds).toContain("node-shape-star-point-ratio");
    expect(propertyIds).toContain("node-shape-star-point-height");
    expect(propertyIds).toContain("node-shape-star-border-rotate");
  });

  it("enforces star ratio/height conflict clear-keys for adaptive controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[star,star point ratio=1.65] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }

    const descriptor = getInspectorDescriptor(text, { source, editHandles: rendered.semantic.editHandles });
    const nodeSection = descriptor.sections.find((section) => section.id === "node");
    expect(nodeSection).toBeDefined();
    if (!nodeSection) {
      throw new Error("Expected node section");
    }

    const ratio = nodeSection.properties.find((property) => property.id === "node-shape-star-point-ratio");
    const height = nodeSection.properties.find((property) => property.id === "node-shape-star-point-height");
    if (!ratio || ratio.kind !== "number") {
      throw new Error("Expected star point ratio number property");
    }
    if (!height || height.kind !== "length") {
      throw new Error("Expected star point height length property");
    }

    expect(ratio.clearKeys).toContain("star point height");
    expect(height.clearKeys).toContain("star point ratio");
  });

  it("edits adaptive number/length/enum/boolean properties through inspector write targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[trapezium,trapezium left angle=75,trapezium stretches=false] at (0,0) {A};
  \node[tape,tape bend top=none,tape bend height=4pt] at (2,0) {B};
  \node[signal,signal to=east,signal from=nowhere] at (4,0) {C};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const texts = rendered.semantic.scene.elements.filter((entry) => entry.kind === "Text");
    expect(texts.length).toBeGreaterThanOrEqual(3);
    if (texts.length < 3) {
      throw new Error("Expected three text elements");
    }

    const trapezium = getInspectorDescriptor(texts[0], { source, editHandles: rendered.semantic.editHandles });
    const tape = getInspectorDescriptor(texts[1], { source, editHandles: rendered.semantic.editHandles });
    const signal = getInspectorDescriptor(texts[2], { source, editHandles: rendered.semantic.editHandles });

    const leftAngle = getNodePropertyById(trapezium, "node-shape-trapezium-left-angle");
    if (!leftAngle || leftAngle.kind !== "number") {
      throw new Error("Expected trapezium left-angle number property");
    }
    const stretches = getNodePropertyById(trapezium, "node-shape-trapezium-stretches");
    if (!stretches || stretches.kind !== "boolean") {
      throw new Error("Expected trapezium stretches boolean property");
    }
    const bendTop = getNodePropertyById(tape, "node-shape-tape-bend-top");
    if (!bendTop || bendTop.kind !== "enum") {
      throw new Error("Expected tape bend-top enum property");
    }
    const bendHeight = getNodePropertyById(tape, "node-shape-tape-bend-height");
    if (!bendHeight || bendHeight.kind !== "length") {
      throw new Error("Expected tape bend-height length property");
    }
    const signalTo = getNodePropertyById(signal, "node-shape-signal-to");
    if (!signalTo || signalTo.kind !== "enum") {
      throw new Error("Expected signal-to enum property");
    }

    const applyProperty = (
      currentSource: string,
      property: typeof leftAngle | typeof stretches | typeof bendTop | typeof bendHeight  ,
      value: string
    ) => {
      if (!("write" in property) || !property.write) {
        throw new Error("Expected writable inspector property");
      }
      const result = applyEditAction(currentSource, [], {
        kind: "setProperty",
        elementId: property.write.elementId,
        level: property.write.level,
        key: property.write.key,
        value,
        clearKeys:
          property.kind === "number" || property.kind === "length" || property.kind === "boolean"
            ? property.clearKeys
            : undefined
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error("Expected successful inspector property mutation");
      }
      return result.newSource;
    };

    let next = source;
    next = applyProperty(next, leftAngle, "80deg");
    next = applyProperty(next, stretches, "true");
    next = applyProperty(next, bendTop, "in and out");
    next = applyProperty(next, bendHeight, "7pt");
    next = applyProperty(next, signalTo, "west");

    expect(next).toContain("trapezium left angle=80deg");
    expect(next).toContain("trapezium stretches");
    expect(next).not.toContain("trapezium stretches=false");
    expect(next).toContain("tape bend top=in and out");
    expect(next).toContain("tape bend height=7pt");
    expect(next).toContain("signal to=west");
  });

  it("normalizes compound signal directions for inspector enum values", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[signal,signal to=east and west,signal from=north and south] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected signal text element");
    }

    const descriptor = getInspectorDescriptor(text, { source, editHandles: rendered.semantic.editHandles });
    const signalTo = getNodePropertyById(descriptor, "node-shape-signal-to");
    const signalFrom = getNodePropertyById(descriptor, "node-shape-signal-from");
    if (!signalTo || signalTo.kind !== "enum") {
      throw new Error("Expected signal-to enum property");
    }
    if (!signalFrom || signalFrom.kind !== "enum") {
      throw new Error("Expected signal-from enum property");
    }

    expect(signalTo.value).toBe("east and west");
    expect(signalFrom.value).toBe("north and south");
  });

  it("falls back to a stable side for non-canonical compound signal directions", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[signal,signal to=north and east,signal from=west] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected signal text element");
    }

    const descriptor = getInspectorDescriptor(text, { source, editHandles: rendered.semantic.editHandles });
    const signalTo = getNodePropertyById(descriptor, "node-shape-signal-to");
    if (!signalTo || signalTo.kind !== "enum") {
      throw new Error("Expected signal-to enum property");
    }

    expect(signalTo.value).toBe("east");
  });

  it("exposes adaptive controls for the remaining supported node shapes", () => {
    const cases: Array<{ shape: string; options: string; expected: string[] }> = [
      {
        shape: "regular polygon",
        options: "regular polygon,regular polygon sides=6,shape border rotate=15",
        expected: ["node-shape-regular-polygon-sides", "node-shape-regular-polygon-border-rotate"]
      },
      {
        shape: "isosceles triangle",
        options: "isosceles triangle,isosceles triangle apex angle=50,isosceles triangle stretches",
        expected: ["node-shape-isosceles-triangle-apex-angle", "node-shape-isosceles-triangle-stretches"]
      },
      {
        shape: "kite",
        options: "kite,kite upper vertex angle=110,kite lower vertex angle=70",
        expected: ["node-shape-kite-upper-vertex-angle", "node-shape-kite-lower-vertex-angle"]
      },
      {
        shape: "dart",
        options: "dart,dart tip angle=35,dart tail angle=80",
        expected: ["node-shape-dart-tip-angle", "node-shape-dart-tail-angle"]
      },
      {
        shape: "circular sector",
        options: "circular sector,circular sector angle=120",
        expected: ["node-shape-circular-sector-angle"]
      },
      {
        shape: "cylinder",
        options: "cylinder,aspect=1.7",
        expected: ["node-shape-cylinder-aspect"]
      },
      {
        shape: "cloud",
        options: "cloud,aspect=1.3,cloud puffs=12,cloud puff arc=110,cloud ignores aspect",
        expected: [
          "node-shape-cloud-aspect",
          "node-shape-cloud-puffs",
          "node-shape-cloud-puff-arc",
          "node-shape-cloud-ignores-aspect"
        ]
      },
      {
        shape: "starburst",
        options: "starburst,starburst points=13,starburst point height=5pt,random starburst=4",
        expected: [
          "node-shape-starburst-points",
          "node-shape-starburst-point-height",
          "node-shape-starburst-random-seed"
        ]
      },
      {
        shape: "single arrow",
        options: "single arrow,single arrow tip angle=45,single arrow head extend=4pt,single arrow head indent=2pt",
        expected: [
          "node-shape-single-arrow-tip-angle",
          "node-shape-single-arrow-head-extend",
          "node-shape-single-arrow-head-indent"
        ]
      },
      {
        shape: "double arrow",
        options: "double arrow,double arrow tip angle=50,double arrow head extend=4pt,double arrow head indent=2pt",
        expected: [
          "node-shape-double-arrow-tip-angle",
          "node-shape-double-arrow-head-extend",
          "node-shape-double-arrow-head-indent"
        ]
      }
    ];

    for (const testCase of cases) {
      const source = String.raw`\begin{tikzpicture}
  \node[${testCase.options}] at (0,0) {A};
\end{tikzpicture}`;
      const rendered = renderTikzToSvg(source);
      const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
      expect(text).toBeDefined();
      if (!text) {
        throw new Error(`Expected text element for ${testCase.shape}`);
      }
      const descriptor = getInspectorDescriptor(text, { source, editHandles: rendered.semantic.editHandles });
      const propertyIds = descriptor.sections.flatMap((section) => section.properties.map((property) => property.id));
      for (const id of testCase.expected) {
        expect(propertyIds).toContain(id);
      }
    }
  });

  it("clears the conflicting star adaptive key when editing ratio vs point height", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[star,star points=5,star point ratio=1.65] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }

    const descriptor = getInspectorDescriptor(text, { source, editHandles: rendered.semantic.editHandles });
    const pointHeight = getNodePropertyById(descriptor, "node-shape-star-point-height");
    const pointRatio = getNodePropertyById(descriptor, "node-shape-star-point-ratio");
    if (!pointHeight || pointHeight.kind !== "length") {
      throw new Error("Expected star point-height length property");
    }
    if (!pointRatio || pointRatio.kind !== "number") {
      throw new Error("Expected star point-ratio number property");
    }
    if (!pointHeight.write || !pointRatio.write) {
      throw new Error("Expected write targets for star adaptive properties");
    }

    const heightResult = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: pointHeight.write.elementId,
      level: pointHeight.write.level,
      key: pointHeight.write.key,
      value: "9pt",
      clearKeys: pointHeight.clearKeys
    });
    expect(heightResult.kind).toBe("success");
    if (heightResult.kind !== "success") {
      throw new Error("Expected successful star point-height mutation");
    }
    expect(heightResult.newSource).toContain("star point height=9pt");
    expect(heightResult.newSource).not.toContain("star point ratio=");

    const ratioResult = applyEditAction(heightResult.newSource, [], {
      kind: "setProperty",
      elementId: pointRatio.write.elementId,
      level: pointRatio.write.level,
      key: pointRatio.write.key,
      value: "1.9",
      clearKeys: pointRatio.clearKeys
    });
    expect(ratioResult.kind).toBe("success");
    if (ratioResult.kind !== "success") {
      throw new Error("Expected successful star point-ratio mutation");
    }
    expect(ratioResult.newSource).toContain("star point ratio=1.9");
    expect(ratioResult.newSource).not.toContain("star point height=");
  });

  it("shows shape border rotate only for shapes that use rotation in semantic rendering", () => {
    const withRotationSource = String.raw`\begin{tikzpicture}
  \node[star,shape border rotate=10] at (0,0) {A};
\end{tikzpicture}`;
    const withoutRotationSource = String.raw`\begin{tikzpicture}
  \node[diamond,aspect=1.2] at (0,0) {A};
\end{tikzpicture}`;

    const withRotationText = renderTikzToSvg(withRotationSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const withoutRotationText = renderTikzToSvg(withoutRotationSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(withRotationText).toBeDefined();
    expect(withoutRotationText).toBeDefined();
    if (!withRotationText || !withoutRotationText) {
      throw new Error("Expected text elements");
    }

    const withRotationDescriptor = getInspectorDescriptor(withRotationText, { source: withRotationSource });
    const withoutRotationDescriptor = getInspectorDescriptor(withoutRotationText, { source: withoutRotationSource });
    const withRotation = getNodePropertyById(withRotationDescriptor, "node-shape-star-border-rotate");
    const withoutRotation = getNodePropertyById(withoutRotationDescriptor, "node-shape-diamond-border-rotate");

    expect(withRotation).toBeDefined();
    expect(withRotation?.kind).toBe("number");
    expect(withoutRotation).toBeUndefined();
  });

  it("merges adaptive properties for same-shape multi-selection and hides them for mixed shapes", () => {
    const sameShapeSource = String.raw`\begin{tikzpicture}
  \node[star,star points=5] at (0,0) {A};
  \node[star,star points=7] at (2,0) {B};
\end{tikzpicture}`;
    const mixedShapeSource = String.raw`\begin{tikzpicture}
  \node[star,star points=5] at (0,0) {A};
  \node[trapezium,trapezium left angle=70] at (2,0) {B};
\end{tikzpicture}`;

    const sameTexts = renderTikzToSvg(sameShapeSource).semantic.scene.elements.filter((entry) => entry.kind === "Text");
    const mixedTexts = renderTikzToSvg(mixedShapeSource).semantic.scene.elements.filter((entry) => entry.kind === "Text");
    expect(sameTexts).toHaveLength(2);
    expect(mixedTexts).toHaveLength(2);
    if (sameTexts.length !== 2 || mixedTexts.length !== 2) {
      throw new Error("Expected two text elements in each source");
    }

    const sameDescriptors = sameTexts.map((entry) => getInspectorDescriptor(entry, { source: sameShapeSource }));
    const mixedDescriptors = mixedTexts.map((entry) => getInspectorDescriptor(entry, { source: mixedShapeSource }));
    const sameMulti = buildMultiInspectorModel(sameDescriptors, sameDescriptors.length);
    const mixedMulti = buildMultiInspectorModel(mixedDescriptors, mixedDescriptors.length);

    const sameNode = sameMulti.sections.find((section) => section.id === "node");
    const mixedNode = mixedMulti.sections.find((section) => section.id === "node");
    expect(sameNode).toBeDefined();
    expect(mixedNode).toBeDefined();
    if (!sameNode || !mixedNode) {
      throw new Error("Expected node sections");
    }

    const sameStarPoints = sameNode.properties.find((property) => property.id === "node-shape-star-points");
    expect(sameStarPoints).toBeDefined();
    expect(sameStarPoints && "mixed" in sameStarPoints ? sameStarPoints.mixed : false).toBe(true);

    const mixedAdaptive = mixedNode.properties.filter(
      (property) =>
        property.id.startsWith("node-shape-star-")
        || property.id.startsWith("node-shape-trapezium-")
    );
    expect(mixedAdaptive).toHaveLength(0);
  });

  it("merges node text align and optional text width for multi-selection", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[align=left,text width=2cm] at (0,0) {A};
  \node[align=right] at (2,0) {B};
\end{tikzpicture}`;
    const texts = renderTikzToSvg(source).semantic.scene.elements.filter((entry) => entry.kind === "Text");
    expect(texts).toHaveLength(2);
    if (texts.length !== 2) {
      throw new Error("Expected two text elements");
    }

    const descriptors = texts.map((entry) => getInspectorDescriptor(entry, { source }));
    const multi = buildMultiInspectorModel(descriptors, descriptors.length);
    const nodeSection = multi.sections.find((section) => section.id === "node");
    expect(nodeSection).toBeDefined();
    if (!nodeSection) {
      throw new Error("Expected node section");
    }

    const align = nodeSection.properties.find((property) => property.id === "node-text-align");
    const textWidth = nodeSection.properties.find((property) => property.id === "node-text-width");
    expect(align?.kind).toBe("nodeTextAlign");
    expect(textWidth?.kind).toBe("optionalLength");
    if (!align || align.kind !== "nodeTextAlign" || !textWidth || textWidth.kind !== "optionalLength") {
      throw new Error("Expected node text layout properties in multi model");
    }

    expect(align.mixed).toBe(true);
    expect(textWidth.mixed).toBe(true);
  });

  it("carries scalar default reset values through multi-selection models", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[inner sep=2pt,minimum width=4pt] at (0,0) {A};
  \node[inner sep=6pt,minimum width=8pt] at (2,0) {B};
\end{tikzpicture}`;
    const texts = renderTikzToSvg(source).semantic.scene.elements.filter((entry) => entry.kind === "Text");
    expect(texts).toHaveLength(2);
    if (texts.length !== 2) {
      throw new Error("Expected two text elements");
    }

    const descriptors = texts.map((entry) => getInspectorDescriptor(entry, { source }));
    const multi = buildMultiInspectorModel(descriptors, descriptors.length);
    const nodeSection = multi.sections.find((section) => section.id === "node");
    expect(nodeSection).toBeDefined();
    if (!nodeSection) {
      throw new Error("Expected node section");
    }

    const innerSep = nodeSection.properties.find((property) => property.id === "node-inner-sep");
    const minimumWidth = nodeSection.properties.find((property) => property.id === "node-minimum-width");
    expect(innerSep?.kind).toBe("length");
    expect(minimumWidth?.kind).toBe("length");
    if (!innerSep || innerSep.kind !== "length" || !minimumWidth || minimumWidth.kind !== "length") {
      throw new Error("Expected node length properties in multi model");
    }

    expect(innerSep.mixed).toBe(true);
    expect(innerSep.defaultValue).toBeCloseTo(3.333, 6);
    expect(minimumWidth.mixed).toBe(true);
    expect(minimumWidth.defaultValue).toBe(1);
  });

  it("builds node shape mutations that normalize existing shape flags", () => {
    const mutation = buildNodeShapeSetPropertyMutation("circle");
    expect(mutation).toMatchObject({
      key: "shape",
      value: "circle"
    });
    expect(mutation.clearKeys).toContain("rectangle");
    expect(mutation.clearKeys).toContain("diamond");
    expect(mutation.clearKeys).toContain("trapezium");

    const source = String.raw`\begin{tikzpicture}
  \node[diamond,shape=star] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }
    const descriptor = getInspectorDescriptor(text, { source, editHandles: rendered.semantic.editHandles });
    const shapeProperty = getNodeShapeProperty(descriptor);
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: shapeProperty.write.elementId,
      level: "command",
      key: mutation.key,
      value: mutation.value,
      clearKeys: mutation.clearKeys
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected successful shape mutation");
    }
    expect(result.newSource).toContain("shape=circle");
    expect(result.newSource).not.toContain("diamond");
  });

  it("detects node inner sep defaults and normalizes x/y sep conflicts", () => {
    const defaultSource = String.raw`\begin{tikzpicture}
  \node[rectangle] at (0,0) {A};
\end{tikzpicture}`;
    const conflictSource = String.raw`\begin{tikzpicture}
  \node[inner xsep=2pt,inner ysep=6pt] at (0,0) {A};
\end{tikzpicture}`;

    const defaultElement = renderTikzToSvg(defaultSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const conflictElement = renderTikzToSvg(conflictSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(defaultElement).toBeDefined();
    expect(conflictElement).toBeDefined();
    if (!defaultElement || !conflictElement) {
      throw new Error("Expected text elements");
    }

    const defaultInnerSep = getNodeInnerSepProperty(getInspectorDescriptor(defaultElement, { source: defaultSource }));
    const conflictInnerSep = getNodeInnerSepProperty(getInspectorDescriptor(conflictElement, { source: conflictSource }));
    expect(defaultInnerSep.value).toBeGreaterThan(3);
    expect(defaultInnerSep.value).toBeLessThan(3.5);
    expect(defaultInnerSep.defaultValue).toBeCloseTo(3.333, 6);
    expect(conflictInnerSep.value).toBeCloseTo(4, 6);
    expect(conflictInnerSep.note).toContain("inner xsep/inner ysep");

    const mutation = buildNodeInnerSepSetPropertyMutation(5.5);
    expect(mutation).toMatchObject({
      key: "inner sep",
      value: "5.5pt"
    });
    expect(mutation.clearKeys).toContain("inner xsep");
    expect(mutation.clearKeys).toContain("inner ysep");
  });

  it("resolves node minimum width/height from minimum size and replaces shared sizing on edit", () => {
    const defaultSource = String.raw`\begin{tikzpicture}
  \node[rectangle] at (0,0) {A};
\end{tikzpicture}`;
    const sharedSource = String.raw`\begin{tikzpicture}
  \node[minimum size=12pt] at (0,0) {A};
\end{tikzpicture}`;
    const mixedSource = String.raw`\begin{tikzpicture}
  \node[minimum width=4pt,minimum size=10pt] at (0,0) {A};
\end{tikzpicture}`;

    const defaultElement = renderTikzToSvg(defaultSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const sharedElement = renderTikzToSvg(sharedSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const mixedElement = renderTikzToSvg(mixedSource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(defaultElement).toBeDefined();
    expect(sharedElement).toBeDefined();
    expect(mixedElement).toBeDefined();
    if (!defaultElement || !sharedElement || !mixedElement) {
      throw new Error("Expected text elements");
    }

    const defaultMinimumWidth = getNodeLengthProperty(getInspectorDescriptor(defaultElement, { source: defaultSource }), "node-minimum-width");
    const defaultMinimumHeight = getNodeLengthProperty(getInspectorDescriptor(defaultElement, { source: defaultSource }), "node-minimum-height");
    expect(defaultMinimumWidth.value).toBeCloseTo(1, 6);
    expect(defaultMinimumHeight.value).toBeCloseTo(1, 6);
    expect(defaultMinimumWidth.defaultValue).toBe(1);
    expect(defaultMinimumHeight.defaultValue).toBe(1);

    const sharedMinimumWidth = getNodeLengthProperty(getInspectorDescriptor(sharedElement, { source: sharedSource }), "node-minimum-width");
    const sharedMinimumHeight = getNodeLengthProperty(getInspectorDescriptor(sharedElement, { source: sharedSource }), "node-minimum-height");
    expect(sharedMinimumWidth.value).toBeCloseTo(12, 6);
    expect(sharedMinimumHeight.value).toBeCloseTo(12, 6);
    expect(sharedMinimumWidth.note).toContain("minimum size detected");
    expect(sharedMinimumHeight.note).toContain("minimum size detected");

    const mixedMinimumWidth = getNodeLengthProperty(getInspectorDescriptor(mixedElement, { source: mixedSource }), "node-minimum-width");
    const mixedMinimumHeight = getNodeLengthProperty(getInspectorDescriptor(mixedElement, { source: mixedSource }), "node-minimum-height");
    expect(mixedMinimumWidth.value).toBeCloseTo(10, 6);
    expect(mixedMinimumHeight.value).toBeCloseTo(10, 6);

    const mutationSet = buildNodeMinimumDimensionSetPropertyMutations(
      { minimumWidth: 12, minimumHeight: 12 },
      "minimum width",
      14
    );
    expect(mutationSet).toEqual([
      {
        key: "minimum width",
        value: "14pt",
        clearKeys: ["minimum size"]
      },
      {
        key: "minimum height",
        value: "12pt",
        clearKeys: ["minimum size"]
      }
    ]);

    const update = applyEditAction(sharedSource, [], {
      kind: "setProperty",
      elementId: sharedMinimumWidth.write.elementId,
      level: sharedMinimumWidth.write.level,
      key: mutationSet[0].key,
      value: mutationSet[0].value,
      clearKeys: mutationSet[0].clearKeys
    });
    expect(update.kind).toBe("success");
    if (update.kind !== "success") {
      throw new Error("Expected successful minimum size mutation");
    }
    const update2 = applyEditAction(update.newSource, [], {
      kind: "setProperty",
      elementId: sharedMinimumWidth.write.elementId,
      level: sharedMinimumWidth.write.level,
      key: mutationSet[1].key,
      value: mutationSet[1].value,
      clearKeys: mutationSet[1].clearKeys
    });
    expect(update2.kind).toBe("success");
    if (update2.kind !== "success") {
      throw new Error("Expected successful companion minimum mutation");
    }
    expect(update2.newSource).toContain("minimum width=14pt");
    expect(update2.newSource).toContain("minimum height=12pt");
    expect(update2.newSource).not.toContain("minimum size=");
  });

  it("resolves node font key preference and serializes deterministic font mutations", () => {
    const fontKeySource = String.raw`\begin{tikzpicture}
  \node[circle,font=\small\bfseries] at (0,0) {A};
\end{tikzpicture}`;
    const nodeFontKeySource = String.raw`\begin{tikzpicture}
  \node[circle,node font=\footnotesize\itshape] at (0,0) {A};
\end{tikzpicture}`;
    const defaultKeySource = String.raw`\begin{tikzpicture}
  \node[circle] at (0,0) {A};
\end{tikzpicture}`;

    const fontElement = renderTikzToSvg(fontKeySource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const nodeFontElement = renderTikzToSvg(nodeFontKeySource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    const defaultElement = renderTikzToSvg(defaultKeySource).semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(fontElement).toBeDefined();
    expect(nodeFontElement).toBeDefined();
    expect(defaultElement).toBeDefined();
    if (!fontElement || !nodeFontElement || !defaultElement) {
      throw new Error("Expected text elements");
    }

    const fontProperty = getNodeFontProperty(getInspectorDescriptor(fontElement, { source: fontKeySource }));
    const nodeFontProperty = getNodeFontProperty(
      getInspectorDescriptor(nodeFontElement, { source: nodeFontKeySource })
    );
    const defaultFontProperty = getNodeFontProperty(
      getInspectorDescriptor(defaultElement, { source: defaultKeySource })
    );

    expect(fontProperty.context.key).toBe("font");
    expect(nodeFontProperty.context.key).toBe("node font");
    expect(defaultFontProperty.context.key).toBe("node font");

    const presetMutation = buildNodeFontSetPropertyMutation(
      {
        key: "font",
        clearKeys: ["node font"],
        fallbackCustomSizePt: 10
      },
      {
        family: "sans",
        weight: "bold",
        style: "italic",
        sizePreset: "small",
        customSizePt: null
      }
    );
    expect(presetMutation).toMatchObject({
      key: "font",
      value: "\\small\\sffamily\\bfseries\\itshape",
      clearKeys: ["node font"]
    });

    const customSizeMutation = buildNodeFontSetPropertyMutation(
      {
        key: "node font",
        clearKeys: ["font"],
        fallbackCustomSizePt: 10
      },
      {
        family: "serif",
        weight: "normal",
        style: "normal",
        sizePreset: "custom",
        customSizePt: 11
      }
    );
    expect(customSizeMutation).toMatchObject({
      key: "node font",
      value: "\\fontsize{11pt}{13.2pt}\\selectfont",
      clearKeys: ["font"]
    });

    const italicOnlyMutation = buildNodeFontSetPropertyMutation(
      {
        key: "node font",
        clearKeys: ["font"],
        fallbackCustomSizePt: 10
      },
      {
        family: "serif",
        weight: "normal",
        style: "italic",
        sizePreset: "normalsize",
        customSizePt: null
      }
    );
    expect(italicOnlyMutation).toMatchObject({
      key: "node font",
      value: "\\itshape",
      clearKeys: ["font"]
    });

    const defaultsMutation = buildNodeFontSetPropertyMutation(
      {
        key: "node font",
        clearKeys: ["font"],
        fallbackCustomSizePt: 10
      },
      {
        family: "serif",
        weight: "normal",
        style: "normal",
        sizePreset: "normalsize",
        customSizePt: null
      }
    );
    expect(defaultsMutation).toMatchObject({
      key: "node font",
      value: "",
      clearKeys: ["font"]
    });
  });

  it("marks custom node font commands with a replacement note", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[node font=\unknownfontswitch] at (0,0) {A};
\end{tikzpicture}`;
    const element = renderTikzToSvg(source).semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(element).toBeDefined();
    if (!element) {
      throw new Error("Expected text element");
    }

    const fontProperty = getNodeFontProperty(getInspectorDescriptor(element, { source }));
    expect(fontProperty.note).toContain("Custom font command detected");
  });

  it("removes a node font key when setProperty receives an empty value", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[circle,node font=\itshape] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected text element");
    }
    const descriptor = getInspectorDescriptor(text, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const nodeFont = getNodeFontProperty(descriptor);
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: nodeFont.write.elementId,
      level: nodeFont.write.level,
      key: nodeFont.write.key,
      value: "",
      clearKeys: nodeFont.context.clearKeys
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected successful node font reset mutation");
    }
    expect(result.newSource).not.toContain("node font=");
    expect(result.newSource).not.toContain("font=");
  });
});

function getNodeShapeProperty(descriptor: ReturnType<typeof getInspectorDescriptor>) {
  const nodeSection = descriptor.sections.find((section) => section.id === "node");
  if (!nodeSection) {
    throw new Error("Expected node section");
  }
  const shape = nodeSection.properties.find((property) => property.kind === "nodeShape");
  if (!shape || shape.kind !== "nodeShape") {
    throw new Error("Expected node shape property");
  }
  return shape;
}

function getNodePropertyById(descriptor: ReturnType<typeof getInspectorDescriptor>, propertyId: string) {
  const nodeSection = descriptor.sections.find((section) => section.id === "node");
  if (!nodeSection) {
    throw new Error("Expected node section");
  }
  return nodeSection.properties.find((property) => property.id === propertyId);
}

function getStrokeColorProperty(descriptor: ReturnType<typeof getInspectorDescriptor>) {
  const strokeSection = descriptor.sections.find((section) => section.id === "stroke");
  if (!strokeSection) {
    throw new Error("Expected stroke section");
  }
  const strokeColor = strokeSection.properties.find((property) => property.id === "stroke-color");
  if (!strokeColor || strokeColor.kind !== "color") {
    throw new Error("Expected stroke color property");
  }
  return strokeColor;
}

function getNodeLengthProperty(
  descriptor: ReturnType<typeof getInspectorDescriptor>,
  propertyId: "node-inner-sep" | "node-minimum-width" | "node-minimum-height"
) {
  const nodeSection = descriptor.sections.find((section) => section.id === "node");
  if (!nodeSection) {
    throw new Error("Expected node section");
  }
  const property = nodeSection.properties.find((entry) => entry.id === propertyId);
  if (!property || property.kind !== "length") {
    throw new Error(`Expected node length property for ${propertyId}`);
  }
  return property;
}

function getNodeInnerSepProperty(descriptor: ReturnType<typeof getInspectorDescriptor>) {
  return getNodeLengthProperty(descriptor, "node-inner-sep");
}

function getNodeFontProperty(descriptor: ReturnType<typeof getInspectorDescriptor>) {
  const nodeSection = descriptor.sections.find((section) => section.id === "node");
  if (!nodeSection) {
    throw new Error("Expected node section");
  }
  const nodeFont = nodeSection.properties.find((property) => property.kind === "nodeFont");
  if (!nodeFont || nodeFont.kind !== "nodeFont") {
    throw new Error("Expected node font property");
  }
  return nodeFont;
}
