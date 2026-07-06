import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { getInspectorDescriptor } from "../packages/core/src/edit/inspector.js";

describe("getInspectorDescriptor – attachments", () => {
  it("returns attachment-specific controls for path-attached nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[above] {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.sourceRef.sourceId.startsWith("node:")
    );
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected a path-attached node text element");
    }

    const descriptor = getInspectorDescriptor(text, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const attachmentSection = descriptor.sections.find((section) => section.id === "path-attached-node");
    expect(attachmentSection).toBeDefined();
    if (!attachmentSection) {
      throw new Error("Expected attachment inspector section");
    }
    expect(attachmentSection.properties.some((property) => property.id === "path-attached-node-position")).toBe(true);
    expect(attachmentSection.properties.some((property) => property.id === "path-attached-node-side")).toBe(true);
    expect(attachmentSection.properties.some((property) => property.id === "path-attached-node-sloped")).toBe(true);
  });

  it("adapts path-attached node controls for neutral, auto, base, and mid regimes", () => {
    const cases = [
      {
        source: String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[midway,sloped] {neutral};
\end{tikzpicture}`,
        text: "neutral",
        expectedSide: null,
        expectedSloped: true
      },
      {
        source: String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[auto,swap,pos=0.63] {auto};
\end{tikzpicture}`,
        text: "auto",
        expectedSide: { label: "Preferred side", value: "right", options: ["left", "right"] },
        expectedSloped: false,
        expectedPositionLabel: "0.63"
      },
      {
        source: String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[base left] {base};
\end{tikzpicture}`,
        text: "base",
        expectedSide: { label: "Side", value: "base left", options: ["base left", "base right"] },
        expectedSloped: false
      },
      {
        source: String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[mid right] {mid};
\end{tikzpicture}`,
        text: "mid",
        expectedSide: { label: "Side", value: "mid right", options: ["mid left", "mid right"] },
        expectedSloped: false
      }
    ];

    for (const testCase of cases) {
      const rendered = renderTikzToSvg(testCase.source);
      const text = rendered.semantic.scene.elements.find(
        (entry) => entry.kind === "Text" && entry.text === testCase.text
      );
      expect(text?.kind).toBe("Text");
      if (!text || text.kind !== "Text") {
        throw new Error(`Expected ${testCase.text} path-attached text element`);
      }

      const descriptor = getInspectorDescriptor(text, {
        source: testCase.source,
        editHandles: rendered.semantic.editHandles
      });
      const attachmentSection = descriptor.sections.find((section) => section.id === "path-attached-node");
      expect(attachmentSection).toBeDefined();
      if (!attachmentSection) {
        throw new Error("Expected attachment inspector section");
      }
      const position = attachmentSection.properties.find((property) => property.id === "path-attached-node-position");
      expect(position?.kind).toBe("slider");
      if (!position || position.kind !== "slider") {
        throw new Error("Expected attachment position slider");
      }
      if (testCase.expectedPositionLabel) {
        expect(position.displayLabel).toBe(testCase.expectedPositionLabel);
      }

      const side = attachmentSection.properties.find((property) => property.id === "path-attached-node-side");
      if (testCase.expectedSide) {
        expect(side?.kind).toBe("enum");
        if (!side || side.kind !== "enum") {
          throw new Error("Expected attachment side enum");
        }
        expect(side.label).toBe(testCase.expectedSide.label);
        expect(side.value).toBe(testCase.expectedSide.value);
        expect(side.options.map((option) => option.value)).toEqual(testCase.expectedSide.options);
      } else {
        expect(side).toBeUndefined();
      }

      const sloped = attachmentSection.properties.find((property) => property.id === "path-attached-node-sloped");
      expect(sloped?.kind).toBe("boolean");
      if (!sloped || sloped.kind !== "boolean") {
        throw new Error("Expected attachment sloped toggle");
      }
      expect(sloped.value).toBe(testCase.expectedSloped);
    }
  });

  it("keeps authored path-attached node text editable when only adjacent coordinates use macros", () => {
    const source = String.raw`\begin{tikzpicture}
  \def\r{0.9}
  \draw[<->, thick] (0.02,0) -- node[above, sloped] {$r$} (\r-0.02,0);
  \draw[<->, thick] (\r+0.02,0) -- node[above, sloped] {$r$} (2*\r-0.01,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const secondRadiusLabel = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.sourceRef.sourceId === "node:2:3"
    );
    expect(secondRadiusLabel).toBeDefined();
    if (!secondRadiusLabel) {
      throw new Error("Expected the second path-attached radius label");
    }

    const descriptor = getInspectorDescriptor(secondRadiusLabel, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const textColorProperty = descriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.id === "node-text-color" && property.kind === "color");

    expect(descriptor.readOnlyReason).toBeUndefined();
    expect(descriptor.writeTargetId).toBe("node:2:3");
    expect(textColorProperty?.write).toBeDefined();
    if (!textColorProperty?.write) {
      throw new Error("Expected node text color to expose a write target");
    }
    expect(textColorProperty.write.writable).toBe(true);
  });

  it("returns adornment-specific sections for pins", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin={[pin edge={blue,dashed,line width=1pt}]above:$q_0$}] at (0,0) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const pinText = rendered.semantic.scene.elements.find(
      (entry) => entry.adornment?.targetId === "node-adornment:node:0:2:pin:0" && entry.kind === "Text"
    );
    expect(pinText).toBeDefined();
    if (!pinText) {
      throw new Error("Expected a pin text element");
    }

    const descriptor = getInspectorDescriptor(pinText, {
      source,
      editHandles: rendered.semantic.editHandles
    });

    expect(descriptor.sections.some((section) => section.id === "adornment")).toBe(true);
    const pinEdgeSection = descriptor.sections.find((section) => section.id === "pin-edge");
    expect(pinEdgeSection).toBeDefined();
    if (!pinEdgeSection) {
      throw new Error("Expected pin-edge section");
    }
    expect(pinEdgeSection.properties.some((property) => property.id === "pin-edge-color")).toBe(true);
    expect(pinEdgeSection.properties.some((property) => property.id === "pin-edge-line-width")).toBe(true);
    expect(pinEdgeSection.properties.some((property) => property.id === "pin-edge-dash-style")).toBe(false);
  });
});
