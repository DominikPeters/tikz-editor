import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import {
  buildMatrixInspectorDescriptor,
  buildTreeInspectorDescriptor,
  dashStylePresetFromStyle,
  fillPatternPresetFromRaw,
  fillPatternPresetFromResolvedPattern,
  fillShadingPresetFromStyleName,
  getInspectorDescriptor,
  lineCapPresetFromStyle,
  lineJoinPresetFromStyle,
  lineWidthPresetLabel,
  TIKZPICTURE_GLOBAL_TARGET_ID
} from "../packages/core/src/edit/inspector.js";
import { resolveFigureBoundsState } from "../packages/core/src/edit/figure-bounds.js";
import {
  buildArrowTipSetPropertyMutation,
  buildFillModeSetPropertyMutations,
  buildFillPatternOptionSetPropertyMutation,
  buildFillPatternSetPropertyMutation,
  buildFillShadingSetPropertyMutations,
  buildNodeFontSetPropertyMutation,
  buildNodeInnerSepSetPropertyMutation,
  buildNodeMinimumDimensionSetPropertyMutations,
  buildNodeShapeSetPropertyMutation,
  buildPathMorphingDecorationSetPropertyMutations,
  buildRoundedCornersSetPropertyMutation,
  buildShadowMutationContextForPreset,
  buildShadowSetPropertyMutations,
  buildTransformSetPropertyMutations,
  resolveTransformInspectorMutationContext,
  resolveTransformInspectorValues
} from "../packages/core/src/edit/property-write-builders.js";
import {
  makeForeachTemplateTargetId,
  makePicTemplateTargetId,
  makeStyleSourceTargetId,
  resolveFigurePropertyTargetFromParseResult,
  resolvePropertyTarget,
  resolvePropertyTargetFromParseResult
} from "../packages/core/src/edit/property-target.js";
import { buildMultiInspectorModel } from "../packages/app/src/ui/inspector-panel/panel-helpers.js";

describe("getInspectorDescriptor", () => {
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

  it("returns computed style sections for a path element", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=blue,fill=yellow,line width=0.8pt,->] (0,0) -- (2,0);
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

    expect(descriptor.elementKind).toBe("path");
    expect(descriptor.writeTargetId).toBe("path:0");

    const strokeSection = descriptor.sections.find((section) => section.id === "stroke");
    expect(strokeSection).toBeDefined();
    if (!strokeSection) {
      throw new Error("Expected stroke section");
    }

    const strokeColor = strokeSection.properties.find((property) => property.kind === "color");
    expect(strokeColor).toBeDefined();
    if (!strokeColor || strokeColor.kind !== "color") {
      throw new Error("Expected stroke color property");
    }
    expect(strokeColor.value).toBe("blue");
    expect(strokeColor.write.writable).toBe(true);

    const lineWidth = strokeSection.properties.find((property) => property.kind === "lineWidth");
    expect(lineWidth).toBeDefined();
    if (!lineWidth || lineWidth.kind !== "lineWidth") {
      throw new Error("Expected line width property");
    }
    expect(lineWidth.value).toBeCloseTo(0.8, 6);
    expect(lineWidth.presetLabel).toBe("thick");

    const pathSection = descriptor.sections.find((section) => section.id === "path");
    expect(pathSection).toBeDefined();
    if (!pathSection) {
      throw new Error("Expected path section");
    }
    const pathMorphingProperty = pathSection.properties.find(
      (property) => property.kind === "pathMorphingDecoration"
    );
    expect(pathMorphingProperty).toBeDefined();
    if (!pathMorphingProperty || pathMorphingProperty.kind !== "pathMorphingDecoration") {
      throw new Error("Expected path morphing property");
    }
    expect(pathMorphingProperty.value).toBe("none");
    expect(pathSection.properties.some((property) => property.id === "path-morphing-segment-length")).toBe(false);
    expect(pathSection.properties.some((property) => property.id === "path-morphing-amplitude")).toBe(false);
    expect(pathSection.properties.some((property) => property.id === "path-morphing-aspect")).toBe(false);

    const arrowProperties = pathSection.properties.filter((property) => property.kind === "arrowTip");
    expect(arrowProperties).toHaveLength(2);
    const beginArrow = arrowProperties.find(
      (property) => property.kind === "arrowTip" && property.side === "start"
    );
    const endArrow = arrowProperties.find(
      (property) => property.kind === "arrowTip" && property.side === "end"
    );
    if (!beginArrow || beginArrow.kind !== "arrowTip") {
      throw new Error("Expected begin arrow property");
    }
    if (!endArrow || endArrow.kind !== "arrowTip") {
      throw new Error("Expected end arrow property");
    }
    expect(beginArrow.value).toBe("none");
    expect(endArrow.value).toBe("arrow");
    expect(endArrow.write.arrowContext.startRaw).toBe("");
    expect(endArrow.write.arrowContext.endRaw).toBe(">");
    expect(endArrow.write.arrowContext.clearKeys).toContain("->");
  });

  it("replaces geometric transform fields with canonical TikZ transform controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[scale=2,shift={(2pt,3pt)},rotate=15] (0,0) -- (2,0);
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
    const transformSection = descriptor.sections.find((section) => section.id === "transform");
    expect(transformSection).toBeDefined();
    if (!transformSection) {
      throw new Error("Expected transform section");
    }

    const transformIds = transformSection.properties.map((property) => property.id);
    expect(transformIds).toEqual(["xshift", "yshift", "xscale", "yscale", "rotate"]);
    expect(transformIds).not.toContain("x");
    expect(transformIds).not.toContain("y");
    expect(transformIds).not.toContain("width");
    expect(transformIds).not.toContain("height");
  });

  it("resolves canonical transform values from scale and shift shorthands", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[scale=2,shift={(2pt,3pt)},rotate=15] (0,0) -- (2,0);
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
    const transformSection = descriptor.sections.find((section) => section.id === "transform");
    expect(transformSection).toBeDefined();
    if (!transformSection) {
      throw new Error("Expected transform section");
    }

    const values = new Map<string, number>();
    const defaultValues = new Map<string, number | undefined>();
    for (const property of transformSection.properties) {
      if (property.kind !== "number") {
        continue;
      }
      values.set(property.id, property.value);
      defaultValues.set(property.id, property.defaultValue);
    }

    expect(values.get("xscale")).toBeCloseTo(2, 6);
    expect(values.get("yscale")).toBeCloseTo(2, 6);
    expect(values.get("xshift")).toBeCloseTo(2, 6);
    expect(values.get("yshift")).toBeCloseTo(3, 6);
    expect(values.get("rotate")).toBeCloseTo(15, 6);
    expect(defaultValues.get("xshift")).toBe(0);
    expect(defaultValues.get("yshift")).toBe(0);
    expect(defaultValues.get("xscale")).toBe(1);
    expect(defaultValues.get("yscale")).toBe(1);
    expect(defaultValues.get("rotate")).toBe(0);
  });

  it("resolves global tikzpicture transform values for inspector empty state", () => {
    const source = String.raw`\begin{tikzpicture}[scale=2, yscale=3]
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const values = resolveTransformInspectorValues(source, TIKZPICTURE_GLOBAL_TARGET_ID);
    expect(values.xscale).toBeCloseTo(2, 6);
    expect(values.yscale).toBeCloseTo(3, 6);
  });

  it("recognizes leading simple figure bounding-box directives for empty-state inspector", () => {
    const commandSource = String.raw`\begin{tikzpicture}
  \useasboundingbox (0,0) rectangle (2,3);
  \draw (0.2,0.8) rectangle (0.8,0.2);
\end{tikzpicture}`;
    const optionSource = String.raw`\begin{tikzpicture}
  \path[use as bounding box] (-1,-2) rectangle (2,3);
  \draw (0.2,0.8) rectangle (0.8,0.2);
\end{tikzpicture}`;

    const commandBounds = resolveFigureBoundsState(commandSource);
    const optionBounds = resolveFigureBoundsState(optionSource);

    expect(commandBounds).toMatchObject({ mode: "fixed", x: 0, y: 0, width: 2, height: 3 });
    expect(optionBounds).toMatchObject({ mode: "fixed", x: -1, y: -2, width: 3, height: 5 });
  });

  it("treats bounding-box directives after earlier geometry as automatic for empty-state inspector", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (-1,-1) rectangle (1,1);
  \useasboundingbox (0,0) rectangle (2,3);
\end{tikzpicture}`;

    expect(resolveFigureBoundsState(source)).toEqual({ mode: "auto" });
  });

  it("inserts a canonical leading bounding-box directive when fixed figure bounds are set from auto", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (-1,-1) rectangle (1,1);
  \useasboundingbox (0,0) rectangle (2,3);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setFigureBounds",
      mode: "fixed",
      x: 0,
      y: 0,
      width: 4,
      height: 5
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toBe(String.raw`\begin{tikzpicture}
  \useasboundingbox (0,0) rectangle (4,5);
  \draw (-1,-1) rectangle (1,1);
  \useasboundingbox (0,0) rectangle (2,3);
\end{tikzpicture}`);
  });

  it("updates and removes the canonical fixed figure bounds directive", () => {
    const source = String.raw`\begin{tikzpicture}
  \path[use as bounding box] (0,0) rectangle (2,3);
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const updated = applyEditAction(source, [], {
      kind: "setFigureBounds",
      mode: "fixed",
      x: -1,
      y: -2,
      width: 3,
      height: 4
    });
    expect(updated.kind).toBe("success");
    if (updated.kind !== "success") return;
    expect(updated.newSource).toContain(String.raw`\useasboundingbox (-1,-2) rectangle (2,2);`);

    const removed = applyEditAction(updated.newSource, [], { kind: "setFigureBounds", mode: "auto" });
    expect(removed.kind).toBe("success");
    if (removed.kind !== "success") return;
    expect(removed.newSource).toBe(String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`);
  });

  it("keeps declared color alias syntax for color flags", () => {
    const source = String.raw`\begin{tikzpicture}
  \definecolor{mypink}{rgb}{0.858, 0.188, 0.478}
  \draw[mypink] (-2.5, 2.5) -- (2.5, 2.5);
  \draw[draw=mypink] (-2.55, 2.5) -- (2.45, 2.5);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const pathElements = rendered.semantic.scene.elements
      .filter((entry) => entry.kind === "Path")
      .sort((left, right) => left.sourceRef.sourceSpan.from - right.sourceRef.sourceSpan.from);
    expect(pathElements.length).toBeGreaterThanOrEqual(2);

    const first = pathElements[0];
    const second = pathElements[1];
    if (!first || !second) {
      throw new Error("Expected two path elements");
    }

    const firstDescriptor = getInspectorDescriptor(first, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const secondDescriptor = getInspectorDescriptor(second, {
      source,
      editHandles: rendered.semantic.editHandles
    });

    const firstStrokeSection = firstDescriptor.sections.find((section) => section.id === "stroke");
    const secondStrokeSection = secondDescriptor.sections.find((section) => section.id === "stroke");
    if (!firstStrokeSection || !secondStrokeSection) {
      throw new Error("Expected stroke section");
    }

    const firstStrokeColor = firstStrokeSection.properties.find((property) => property.kind === "color");
    const secondStrokeColor = secondStrokeSection.properties.find((property) => property.kind === "color");
    if (!firstStrokeColor || firstStrokeColor.kind !== "color") {
      throw new Error("Expected first stroke color property");
    }
    if (!secondStrokeColor || secondStrokeColor.kind !== "color") {
      throw new Error("Expected second stroke color property");
    }

    expect(firstStrokeColor.syntaxValue).toBe("mypink");
    expect(secondStrokeColor.syntaxValue).toBe("mypink");
  });

  it("keeps inherited every-node fill syntax for node inspector colors", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \node[draw] (A) at (-1, -1) {A};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const textElement = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
    expect(textElement).toBeDefined();
    if (!textElement) {
      throw new Error("Expected text element");
    }

    const descriptor = getInspectorDescriptor(textElement, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const fillSection = descriptor.sections.find((section) => section.id === "fill");
    expect(fillSection).toBeDefined();
    if (!fillSection) {
      throw new Error("Expected fill section");
    }

    const fillColor = fillSection.properties.find((property) => property.id === "fill-color");
    if (!fillColor || fillColor.kind !== "color") {
      throw new Error("Expected fill color property");
    }

    const fillMode = fillSection.properties.find((property) => property.kind === "fillMode");
    if (!fillMode || fillMode.kind !== "fillMode") {
      throw new Error("Expected fill mode property");
    }

    expect(fillColor.syntaxValue).toBe("blue!10");
    expect(fillMode.context.fillColor).toBe("blue!10");
  });

  it("does not expose arrow tips for closed paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=blue,->] (0,0) -- (2,0) -- cycle;
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

    const pathSection = descriptor.sections.find((section) => section.id === "path");
    expect(pathSection).toBeDefined();
    if (!pathSection) {
      throw new Error("Expected path section");
    }
    const arrowProperties = pathSection.properties.filter((property) => property.kind === "arrowTip");
    expect(arrowProperties).toHaveLength(0);
  });

  it("orders regular path sections as geometry before paint", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=blue] (0,0) rectangle (1,1);
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
    const sectionIds = descriptor.sections.map((section) => section.id);

    expect(sectionIds.indexOf("path")).toBeLessThan(sectionIds.indexOf("stroke"));
    expect(sectionIds.indexOf("stroke")).toBeLessThan(sectionIds.indexOf("fill"));
  });

  it("shows grid controls for a single grid operation with keyword-targeted writes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) grid (2,2);
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
    const sectionIds = descriptor.sections.map((section) => section.id);
    expect(sectionIds).toContain("grid");
    expect(sectionIds).toContain("path");
    expect(sectionIds).toContain("stroke");
    expect(sectionIds.indexOf("grid")).toBeLessThan(sectionIds.indexOf("stroke"));
    expect(sectionIds.indexOf("grid")).toBeLessThan(sectionIds.indexOf("path"));
    expect(sectionIds.indexOf("path")).toBeLessThan(sectionIds.indexOf("stroke"));

    const gridSection = descriptor.sections.find((section) => section.id === "grid");
    expect(gridSection).toBeDefined();
    if (!gridSection) {
      throw new Error("Expected grid section");
    }

    const step = gridSection.properties.find((property) => property.id === "grid-step");
    const xstep = gridSection.properties.find((property) => property.id === "grid-xstep");
    const ystep = gridSection.properties.find((property) => property.id === "grid-ystep");
    if (!step || step.kind !== "number") {
      throw new Error("Expected grid step number property");
    }
    if (!xstep || xstep.kind !== "number") {
      throw new Error("Expected grid xstep number property");
    }
    if (!ystep || ystep.kind !== "number") {
      throw new Error("Expected grid ystep number property");
    }

    expect(step.value).toBeCloseTo(1, 6);
    expect(xstep.value).toBeCloseTo(1, 6);
    expect(ystep.value).toBeCloseTo(1, 6);
    expect(step.defaultValue).toBe(1);
    expect(xstep.defaultValue).toBe(1);
    expect(ystep.defaultValue).toBe(1);
    expect(step.unit).toBe("cm");
    expect(xstep.unit).toBe("cm");
    expect(ystep.unit).toBe("cm");
    expect(step.step).toBeCloseTo(0.1, 6);
    expect(xstep.step).toBeCloseTo(0.1, 6);
    expect(ystep.step).toBeCloseTo(0.1, 6);
    expect(step.clearKeys).toContain("xstep");
    expect(step.clearKeys).toContain("ystep");

    const parsed = parseTikz(source);
    const statement = parsed.figure.body.find((entry) => entry.kind === "Path");
    if (!statement || statement.kind !== "Path") {
      throw new Error("Expected path statement");
    }
    const gridKeyword = statement.items.find((item) => item.kind === "PathKeyword" && item.keyword === "grid");
    if (!gridKeyword || gridKeyword.kind !== "PathKeyword") {
      throw new Error("Expected grid keyword");
    }

    if (step.write!.mode !== "setProperty" || xstep.write!.mode !== "setProperty" || ystep.write!.mode !== "setProperty") {
      throw new Error("Expected setProperty writes for grid properties");
    }
    expect(step.write!.elementId).toBe(gridKeyword.id);
    expect(xstep.write!.elementId).toBe(gridKeyword.id);
    expect(ystep.write!.elementId).toBe(gridKeyword.id);
    expect(step.write!.key).toBe("step");
    expect(xstep.write!.key).toBe("xstep");
    expect(ystep.write!.key).toBe("ystep");

    const mutation = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: step.write!.elementId,
      level: step.write!.level,
      key: step.write!.key,
      value: "2.5cm",
      clearKeys: step.clearKeys
    });
    expect(mutation.kind).toBe("success");
    if (mutation.kind !== "success") {
      throw new Error("Expected successful grid step mutation");
    }
    expect(mutation.newSource).toContain("\\draw (0,0) grid[step=2.5cm] (2,2);");
  });

  it("reads explicit grid xstep/ystep keyword options into cm inspector values", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) grid[xstep=2mm, y step=3mm] (2,2);
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
    const gridSection = descriptor.sections.find((section) => section.id === "grid");
    expect(gridSection).toBeDefined();
    if (!gridSection) {
      throw new Error("Expected grid section");
    }

    const step = gridSection.properties.find((property) => property.id === "grid-step");
    const xstep = gridSection.properties.find((property) => property.id === "grid-xstep");
    const ystep = gridSection.properties.find((property) => property.id === "grid-ystep");
    if (!step || step.kind !== "number" || !xstep || xstep.kind !== "number" || !ystep || ystep.kind !== "number") {
      throw new Error("Expected grid number properties");
    }

    expect(step.value).toBeCloseTo(1, 6);
    expect(xstep.value).toBeCloseTo(0.2, 6);
    expect(ystep.value).toBeCloseTo(0.3, 6);
  });

  it("reads inherited grid step options from the effective style chain", () => {
    const source = String.raw`\begin{tikzpicture}[step=0.5]
  \draw (0,0) grid (2,2);
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
    const gridSection = descriptor.sections.find((section) => section.id === "grid");
    expect(gridSection).toBeDefined();
    if (!gridSection) {
      throw new Error("Expected grid section");
    }

    const step = gridSection.properties.find((property) => property.id === "grid-step");
    const xstep = gridSection.properties.find((property) => property.id === "grid-xstep");
    const ystep = gridSection.properties.find((property) => property.id === "grid-ystep");
    if (!step || step.kind !== "number" || !xstep || xstep.kind !== "number" || !ystep || ystep.kind !== "number") {
      throw new Error("Expected grid number properties");
    }

    expect(step.value).toBeCloseTo(0.5, 6);
    expect(xstep.value).toBeCloseTo(0.5, 6);
    expect(ystep.value).toBeCloseTo(0.5, 6);
  });

  it("hides grid controls when a path statement contains multiple grid operations", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) grid (1,1) (2,2) grid (3,3);
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
    expect(descriptor.sections.some((section) => section.id === "grid")).toBe(false);
  });

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

  it("marks non-curated tip kinds as custom", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[arrows={Rays-}] (0,0) -- (2,0);
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
    const pathSection = descriptor.sections.find((section) => section.id === "path");
    expect(pathSection).toBeDefined();
    if (!pathSection) {
      throw new Error("Expected path section");
    }

    const beginArrow = pathSection.properties.find(
      (property) => property.kind === "arrowTip" && property.side === "start"
    );
    const endArrow = pathSection.properties.find(
      (property) => property.kind === "arrowTip" && property.side === "end"
    );
    if (!beginArrow || beginArrow.kind !== "arrowTip") {
      throw new Error("Expected begin arrow property");
    }
    if (!endArrow || endArrow.kind !== "arrowTip") {
      throw new Error("Expected end arrow property");
    }

    expect(beginArrow.value).toBe("custom");
    expect(endArrow.value).toBe("none");
  });

  it("builds shorthand mutations for default arrow combinations", () => {
    const mutation = buildArrowTipSetPropertyMutation(
      {
        startRaw: "",
        endRaw: ">",
        clearKeys: ["arrows", "->"]
      },
      "start",
      "arrow"
    );
    expect(mutation.key).toBe("<->");
    expect(mutation.value).toBe("true");
    expect(mutation.clearKeys).toContain("arrows");
  });

  it("canonicalizes xscale edits by materializing xscale and yscale while removing scale shorthand", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[scale=2,blue] (0,0) -- (2,0);
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
    const transformSection = descriptor.sections.find((section) => section.id === "transform");
    expect(transformSection).toBeDefined();
    if (!transformSection) {
      throw new Error("Expected transform section");
    }

    const xscale = transformSection.properties.find((property) => property.id === "xscale");
    expect(xscale).toBeDefined();
    if (!xscale || xscale.kind !== "number" || !xscale.write?.transformContext) {
      throw new Error("Expected xscale number property with transform context");
    }

    const mutations = buildTransformSetPropertyMutations(xscale.write.transformContext.values, "xscale", 3);
    expect(mutations).toHaveLength(2);

    let updated = source;
    for (const mutation of mutations) {
      const result = applyEditAction(updated, [], {
        kind: "setProperty",
        elementId: xscale.write.elementId,
        level: xscale.write.level,
        key: mutation.key,
        value: mutation.value,
        clearKeys: mutation.clearKeys
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error("Expected successful setProperty transform mutation");
      }
      updated = result.newSource;
    }

    expect(updated).toContain("xscale=3");
    expect(updated).toContain("yscale=2");
    expect(updated).not.toMatch(/\bscale\s*=/);
  });

  it("keeps cm transforms while applying additive canonical transform edits", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[cm={0,1,1,0,(1cm,1cm)}] (0,0) -- (2,0);
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
    const transformSection = descriptor.sections.find((section) => section.id === "transform");
    expect(transformSection).toBeDefined();
    if (!transformSection) {
      throw new Error("Expected transform section");
    }

    const xscale = transformSection.properties.find((property) => property.id === "xscale");
    expect(xscale).toBeDefined();
    if (!xscale || xscale.kind !== "number" || !xscale.write?.transformContext) {
      throw new Error("Expected xscale number property with transform context");
    }

    const mutations = buildTransformSetPropertyMutations(xscale.write.transformContext.values, "xscale", 2);
    expect(mutations.length).toBeGreaterThanOrEqual(1);

    let updated = source;
    for (const mutation of mutations) {
      const result = applyEditAction(updated, [], {
        kind: "setProperty",
        elementId: xscale.write.elementId,
        level: xscale.write.level,
        key: mutation.key,
        value: mutation.value,
        clearKeys: mutation.clearKeys
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error("Expected successful setProperty transform mutation");
      }
      updated = result.newSource;
    }

    expect(updated).toContain("cm={0,1,1,0,(1cm,1cm)}");
    expect(updated).toContain("xscale=2");
  });

  it("does not materialize default companion scale when editing only yscale", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0);
\end{tikzpicture}`;
    const values = resolveTransformInspectorValues(source, TIKZPICTURE_GLOBAL_TARGET_ID);
    const mutations = buildTransformSetPropertyMutations(values, "yscale", 2);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      key: "yscale",
      value: "2"
    });

    let updated = source;
    for (const mutation of mutations) {
      const result = applyEditAction(updated, [], {
        kind: "setProperty",
        elementId: TIKZPICTURE_GLOBAL_TARGET_ID,
        level: "command",
        key: mutation.key,
        value: mutation.value,
        clearKeys: mutation.clearKeys
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error("Expected successful global setProperty transform mutation");
      }
      updated = result.newSource;
    }

    expect(updated).toContain("\\begin{tikzpicture}[yscale=2]");
    expect(updated).not.toContain("xscale=1");
  });

  it("canonicalizes xshift edits by materializing xshift and yshift while removing shift shorthand", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[shift={(2pt,3pt)},blue] (0,0) -- (2,0);
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
    const transformSection = descriptor.sections.find((section) => section.id === "transform");
    expect(transformSection).toBeDefined();
    if (!transformSection) {
      throw new Error("Expected transform section");
    }

    const xshift = transformSection.properties.find((property) => property.id === "xshift");
    expect(xshift).toBeDefined();
    if (!xshift || xshift.kind !== "number" || !xshift.write?.transformContext) {
      throw new Error("Expected xshift number property with transform context");
    }

    const mutations = buildTransformSetPropertyMutations(xshift.write.transformContext.values, "xshift", 5);
    expect(mutations).toHaveLength(2);

    let updated = source;
    for (const mutation of mutations) {
      const result = applyEditAction(updated, [], {
        kind: "setProperty",
        elementId: xshift.write.elementId,
        level: xshift.write.level,
        key: mutation.key,
        value: mutation.value,
        clearKeys: mutation.clearKeys
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error("Expected successful setProperty transform mutation");
      }
      updated = result.newSource;
    }

    expect(updated).toContain("xshift=5pt");
    expect(updated).toContain("yshift=3pt");
    expect(updated).not.toMatch(/\bshift\s*=/);
  });

  it("inserts new scope transform options after \\begin{scope} when a scope has no option list", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \node[draw] (B) at (1.5, -0.5) {B};
    \node[draw] (C) at (0, 1.5) {C};
  \end{scope}
\end{tikzpicture}`;

    const resolved = resolvePropertyTarget(source, "scope:0");
    expect(resolved.kind).toBe("found");
    if (resolved.kind !== "found") {
      throw new Error("Expected scope property target");
    }

    const mutations = buildTransformSetPropertyMutations(
      resolveTransformInspectorValues(source, "scope:0"),
      "xshift",
      0.8
    );
    expect(mutations).toHaveLength(1);

    let updated = source;
    for (const mutation of mutations) {
      const result = applyEditAction(updated, [], {
        kind: "setProperty",
        elementId: resolved.target.id,
        level: "command",
        key: mutation.key,
        value: mutation.value,
        clearKeys: mutation.clearKeys
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error("Expected successful scope transform mutation");
      }
      updated = result.newSource;
    }

    expect(updated).toContain("\\begin{scope}[xshift=0.8pt]");
    expect(updated).not.toContain("yshift=0pt");
    expect(updated).not.toContain("\\begin{scope[xshift=0.8pt]}");
  });

  it("clears default xscale while preserving a non-default yscale companion", () => {
    const source = String.raw`\begin{tikzpicture}[xscale=1.5, yscale=2]
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const mutations = buildTransformSetPropertyMutations(
      resolveTransformInspectorMutationContext(source, TIKZPICTURE_GLOBAL_TARGET_ID),
      "xscale",
      1
    );
    expect(mutations).toEqual([
      {
        key: "xscale",
        value: "",
        clearKeys: ["xscale", "scale", "/tikz/scale", "/tikz/xscale"]
      }
    ]);

    let updated = source;
    for (const mutation of mutations) {
      const result = applyEditAction(updated, [], {
        kind: "setProperty",
        elementId: TIKZPICTURE_GLOBAL_TARGET_ID,
        level: "command",
        key: mutation.key,
        value: mutation.value,
        clearKeys: mutation.clearKeys
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error("Expected successful xscale reset mutation");
      }
      updated = result.newSource;
    }

    expect(updated).toContain("\\begin{tikzpicture}[yscale=2]");
    expect(updated).not.toContain("xscale=");
    expect(updated).not.toMatch(/\bscale\s*=/);
  });

  it("builds rotate mutations without touching scale or shift keys", () => {
    const mutations = buildTransformSetPropertyMutations(
      { xshift: 2, yshift: 3, xscale: 2, yscale: 2, rotate: 15 },
      "rotate",
      20
    );

    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      key: "rotate",
      value: "20"
    });
  });

  it("rewrites scale shorthand into explicit scales when flipping xscale", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[scale=2] (0,0) -- (2,0);
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
    const transformSection = descriptor.sections.find((section) => section.id === "transform");
    expect(transformSection).toBeDefined();
    if (!transformSection) {
      throw new Error("Expected transform section");
    }

    const xscale = transformSection.properties.find((property) => property.id === "xscale");
    expect(xscale).toBeDefined();
    if (!xscale || xscale.kind !== "number" || !xscale.write?.transformContext) {
      throw new Error("Expected xscale number property with transform context");
    }

    const mutations = buildTransformSetPropertyMutations(xscale.write.transformContext.values, "xscale", -2);
    expect(mutations).toHaveLength(2);

    let updated = source;
    for (const mutation of mutations) {
      const result = applyEditAction(updated, [], {
        kind: "setProperty",
        elementId: xscale.write.elementId,
        level: xscale.write.level,
        key: mutation.key,
        value: mutation.value,
        clearKeys: mutation.clearKeys
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error("Expected successful setProperty transform mutation");
      }
      updated = result.newSource;
    }

    expect(updated).toContain("xscale=-2");
    expect(updated).toContain("yscale=2");
    expect(updated).not.toMatch(/\bscale\s*=/);
  });

  it("supports flipping yscale twice back to the original value", () => {
    const values = resolveTransformInspectorValues(String.raw`\begin{tikzpicture}
  \draw[yscale=2] (0,0) -- (1,0);
\end{tikzpicture}`, "path:0");
    const flipped = buildTransformSetPropertyMutations(values, "yscale", -values.yscale);
    expect(flipped).toHaveLength(1);
    expect(flipped[0]).toMatchObject({
      key: "yscale",
      value: "-2"
    });

    const reflipped = buildTransformSetPropertyMutations(
      { ...values, yscale: -2 },
      "yscale",
      2
    );
    expect(reflipped).toHaveLength(1);
    expect(reflipped[0]).toMatchObject({
      key: "yscale",
      value: "2"
    });
  });

  it("builds path morphing decoration mutations", () => {
    const enabledMutations = buildPathMorphingDecorationSetPropertyMutations("zigzag");
    expect(enabledMutations).toHaveLength(2);
    expect(enabledMutations[0]).toMatchObject({
      key: "decorate",
      value: "true"
    });
    expect(enabledMutations[1]).toMatchObject({
      key: "decoration",
      value: "zigzag"
    });
    expect(enabledMutations[0]?.clearKeys).toContain("decoration");
    expect(enabledMutations[0]?.clearKeys).toContain("/pgf/decoration/segment length");
    expect(enabledMutations[0]?.clearKeys).toContain("/pgf/decoration/amplitude");
    expect(enabledMutations[0]?.clearKeys).toContain("/pgf/decoration/aspect");

    const disabledMutations = buildPathMorphingDecorationSetPropertyMutations("none");
    expect(disabledMutations).toHaveLength(1);
    expect(disabledMutations[0]).toMatchObject({
      key: "decorate",
      value: "false"
    });
    expect(disabledMutations[0]?.clearKeys).toContain("decoration");
    expect(disabledMutations[0]?.clearKeys).toContain("/pgf/decorations/segment length");
    expect(disabledMutations[0]?.clearKeys).toContain("/pgf/decorations/amplitude");
    expect(disabledMutations[0]?.clearKeys).toContain("/pgf/decorations/aspect");
  });

  it("shows segment length and amplitude path morphing suboptions for curated decorations", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[decorate,decoration={zigzag,segment length=8pt,amplitude=3pt}] (0,0) -- (2,0);
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
    const pathSection = descriptor.sections.find((section) => section.id === "path");
    expect(pathSection).toBeDefined();
    if (!pathSection) {
      throw new Error("Expected path section");
    }

    const segmentLength = pathSection.properties.find((property) => property.id === "path-morphing-segment-length");
    const amplitude = pathSection.properties.find((property) => property.id === "path-morphing-amplitude");
    const aspect = pathSection.properties.find((property) => property.id === "path-morphing-aspect");

    expect(segmentLength).toBeDefined();
    expect(amplitude).toBeDefined();
    expect(aspect).toBeUndefined();
    if (!segmentLength || segmentLength.kind !== "number") {
      throw new Error("Expected segment length property");
    }
    if (!amplitude || amplitude.kind !== "number") {
      throw new Error("Expected amplitude property");
    }

    expect(segmentLength.value).toBeCloseTo(8, 6);
    expect(segmentLength.unit).toBe("pt");
    expect(segmentLength.write?.key).toBe("/pgf/decoration/segment length");
    expect(amplitude.value).toBeCloseTo(3, 6);
    expect(amplitude.unit).toBe("pt");
    expect(amplitude.write?.key).toBe("/pgf/decoration/amplitude");
  });

  it("shows bent path morphing suboptions including aspect", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[decorate,decoration={bent,amplitude=4pt,aspect=.3}] (0,0) -- (2,0);
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
    const pathSection = descriptor.sections.find((section) => section.id === "path");
    expect(pathSection).toBeDefined();
    if (!pathSection) {
      throw new Error("Expected path section");
    }

    const segmentLength = pathSection.properties.find((property) => property.id === "path-morphing-segment-length");
    const amplitude = pathSection.properties.find((property) => property.id === "path-morphing-amplitude");
    const aspect = pathSection.properties.find((property) => property.id === "path-morphing-aspect");

    expect(segmentLength).toBeUndefined();
    expect(amplitude).toBeDefined();
    expect(aspect).toBeDefined();
    if (!amplitude || amplitude.kind !== "number") {
      throw new Error("Expected bent amplitude property");
    }
    if (!aspect || aspect.kind !== "number") {
      throw new Error("Expected bent aspect property");
    }

    expect(amplitude.value).toBeCloseTo(4, 6);
    expect(aspect.value).toBeCloseTo(0.3, 6);
    expect(aspect.unit).toBeUndefined();
    expect(aspect.write?.key).toBe("/pgf/decoration/aspect");
  });

  it("falls back to default path morphing suboption values when keys are omitted", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[decorate,decoration=bent] (0,0) -- (2,0);
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
    const pathSection = descriptor.sections.find((section) => section.id === "path");
    expect(pathSection).toBeDefined();
    if (!pathSection) {
      throw new Error("Expected path section");
    }

    const amplitude = pathSection.properties.find((property) => property.id === "path-morphing-amplitude");
    const aspect = pathSection.properties.find((property) => property.id === "path-morphing-aspect");
    if (!amplitude || amplitude.kind !== "number") {
      throw new Error("Expected default bent amplitude property");
    }
    if (!aspect || aspect.kind !== "number") {
      throw new Error("Expected default bent aspect property");
    }
    expect(amplitude.value).toBeCloseTo(2.5, 6);
    expect(aspect.value).toBeCloseTo(0.5, 6);
  });

  it("marks out-of-set path morphing decorations as custom", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[decorate,decoration=waves] (0,0) -- (2,0);
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
    const pathSection = descriptor.sections.find((section) => section.id === "path");
    expect(pathSection).toBeDefined();
    if (!pathSection) {
      throw new Error("Expected path section");
    }
    const pathMorphingProperty = pathSection.properties.find(
      (property) => property.kind === "pathMorphingDecoration"
    );
    expect(pathMorphingProperty).toBeDefined();
    if (!pathMorphingProperty || pathMorphingProperty.kind !== "pathMorphingDecoration") {
      throw new Error("Expected path morphing property");
    }
    expect(pathMorphingProperty.value).toBe("custom");
    expect(pathSection.properties.some((property) => property.id === "path-morphing-segment-length")).toBe(false);
    expect(pathSection.properties.some((property) => property.id === "path-morphing-amplitude")).toBe(false);
    expect(pathSection.properties.some((property) => property.id === "path-morphing-aspect")).toBe(false);
  });

  it("parses decoration names from nested, explicit, and disabled decoration options", () => {
    const cases = [
      {
        source: String.raw`\begin{tikzpicture}
  \draw[decorate=false,decoration={name=zigzag}] (0,0) -- (2,0);
\end{tikzpicture}`,
        expected: "none"
      },
      {
        source: String.raw`\begin{tikzpicture}
  \draw[decorate,decoration={mirror, name=zigzag}] (0,0) -- (2,0);
\end{tikzpicture}`,
        expected: "zigzag"
      },
      {
        source: String.raw`\begin{tikzpicture}
  \draw[decorate,/pgf/decoration/name=bent] (0,0) -- (2,0);
\end{tikzpicture}`,
        expected: "bent"
      },
      {
        source: String.raw`\begin{tikzpicture}
  \draw[decorate,decoration={name=unknown}] (0,0) -- (2,0);
\end{tikzpicture}`,
        expected: "custom"
      }
    ];

    for (const testCase of cases) {
      const rendered = renderTikzToSvg(testCase.source);
      const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
      expect(element).toBeDefined();
      if (!element) {
        throw new Error("Expected decorated path element");
      }
      const descriptor = getInspectorDescriptor(element, {
        source: testCase.source,
        editHandles: rendered.semantic.editHandles
      });
      const pathSection = descriptor.sections.find((section) => section.id === "path");
      expect(pathSection).toBeDefined();
      if (!pathSection) {
        throw new Error("Expected path section");
      }
      expect(pathSection.properties.find((property) => property.kind === "pathMorphingDecoration")).toMatchObject({
        value: testCase.expected
      });
    }
  });

  it("preserves the untouched custom side when editing the opposite side", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=blue,arrows={Stealth[length=10pt]-Latex}] (0,0) -- (2,0);
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
    const pathSection = descriptor.sections.find((section) => section.id === "path");
    expect(pathSection).toBeDefined();
    if (!pathSection) {
      throw new Error("Expected path section");
    }
    const endArrow = pathSection.properties.find(
      (property) => property.kind === "arrowTip" && property.side === "end"
    );
    expect(endArrow).toBeDefined();
    if (!endArrow || endArrow.kind !== "arrowTip") {
      throw new Error("Expected end arrow property");
    }

    const mutation = buildArrowTipSetPropertyMutation(endArrow.write.arrowContext, "end", "none");
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: endArrow.write.elementId,
      level: endArrow.write.level,
      key: mutation.key,
      value: mutation.value,
      clearKeys: mutation.clearKeys
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("arrows=Stealth[length=10pt]-");
    expect(result.newSource).not.toContain("Latex");
  });

  it("shows line cap for open paths but hides line join when there are no joins", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0);
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
    const strokeSection = descriptor.sections.find((section) => section.id === "stroke");
    expect(strokeSection).toBeDefined();
    if (!strokeSection) {
      throw new Error("Expected stroke section");
    }

    const hasLineCap = strokeSection.properties.some((property) => property.kind === "lineCap");
    const hasLineJoin = strokeSection.properties.some((property) => property.kind === "lineJoin");
    expect(hasLineCap).toBe(true);
    expect(hasLineJoin).toBe(false);
  });

  it("hides fill controls for open single-segment paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (-2.5, 2.5) -- (2.5, 2.5);
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

    expect(descriptor.sections.some((section) => section.id === "fill")).toBe(false);
  });

  it("keeps fill controls for open paths that enclose a region via implicit closure", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (0,0) -- (2,0) -- (1,1);
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

    expect(descriptor.sections.some((section) => section.id === "fill")).toBe(true);
  });

  it("keeps fill controls for open curve paths because PGF can fill their swept region", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (0,0) .. controls (1,2) and (2,2) .. (3,0);
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

    expect(descriptor.sections.some((section) => section.id === "fill")).toBe(true);
  });

  it("keeps solid fill mode as the default inspector mode", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (0,0) rectangle (1,1);
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
    const fillSection = descriptor.sections.find((section) => section.id === "fill");
    expect(fillSection).toBeDefined();
    if (!fillSection) {
      throw new Error("Expected fill section");
    }

    const fillMode = fillSection.properties.find((property) => property.kind === "fillMode");
    expect(fillMode).toBeDefined();
    if (!fillMode || fillMode.kind !== "fillMode") {
      throw new Error("Expected fill mode property");
    }
    expect(fillMode.value).toBe("solid");
  });

  it("detects gradient fill mode and shading subtype", () => {
    const source = String.raw`\begin{tikzpicture}
  \shade[top color=red,bottom color=blue] (0,0) rectangle (1,1);
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
    const fillSection = descriptor.sections.find((section) => section.id === "fill");
    expect(fillSection).toBeDefined();
    if (!fillSection) {
      throw new Error("Expected fill section");
    }

    const fillMode = fillSection.properties.find((property) => property.kind === "fillMode");
    const fillShading = fillSection.properties.find((property) => property.kind === "fillShading");
    if (!fillMode || fillMode.kind !== "fillMode") {
      throw new Error("Expected fill mode property");
    }
    if (!fillShading || fillShading.kind !== "fillShading") {
      throw new Error("Expected fill shading property");
    }
    expect(fillMode.value).toBe("gradient");
    expect(fillShading.value).toBe("axis");
    expect(fillSection.properties.some((property) => property.id === "fill-axis-top-color")).toBe(true);
    expect(fillSection.properties.some((property) => property.id === "fill-axis-bottom-color")).toBe(true);
  });

  it("shows radial and ball shading color controls", () => {
    const cases = [
      {
        source: String.raw`\begin{tikzpicture}
  \shade[inner color=red,outer color=blue] (0,0) circle (1);
\end{tikzpicture}`,
        expectedIds: ["fill-radial-inner-color", "fill-radial-outer-color"]
      },
      {
        source: String.raw`\begin{tikzpicture}
  \shade[ball color=green] (0,0) circle (1);
\end{tikzpicture}`,
        expectedIds: ["fill-ball-color"]
      }
    ];

    for (const testCase of cases) {
      const rendered = renderTikzToSvg(testCase.source);
      const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
      expect(element).toBeDefined();
      if (!element) {
        throw new Error("Expected shaded path element");
      }
      const descriptor = getInspectorDescriptor(element, {
        source: testCase.source,
        editHandles: rendered.semantic.editHandles
      });
      const fillSection = descriptor.sections.find((section) => section.id === "fill");
      expect(fillSection).toBeDefined();
      if (!fillSection) {
        throw new Error("Expected fill section");
      }
      for (const id of testCase.expectedIds) {
        expect(fillSection.properties.some((property) => property.id === id)).toBe(true);
      }
    }
  });

  it("detects pattern fill mode and keeps pattern color syntax aliases", () => {
    const source = String.raw`\begin{tikzpicture}
  \definecolor{brand}{rgb}{0.2,0.4,0.7}
  \draw[pattern=grid,pattern color=brand] (0,0) rectangle (1,1);
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
    const fillSection = descriptor.sections.find((section) => section.id === "fill");
    expect(fillSection).toBeDefined();
    if (!fillSection) {
      throw new Error("Expected fill section");
    }

    const fillMode = fillSection.properties.find((property) => property.kind === "fillMode");
    const fillPattern = fillSection.properties.find((property) => property.kind === "fillPattern");
    const patternColor = fillSection.properties.find((property) => property.id === "fill-pattern-color");
    if (!fillMode || fillMode.kind !== "fillMode") {
      throw new Error("Expected fill mode property");
    }
    if (!fillPattern || fillPattern.kind !== "fillPattern") {
      throw new Error("Expected fill pattern property");
    }
    if (!patternColor || patternColor.kind !== "color") {
      throw new Error("Expected pattern color property");
    }
    expect(fillMode.value).toBe("pattern");
    expect(fillPattern.value).toBe("grid");
    expect(patternColor.syntaxValue).toBe("brand");
  });

  it("shows meta-pattern options for configurable pattern families", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[pattern={Lines[angle=45,distance=4pt,line width=0.6pt,xshift=1pt,yshift=2pt]},pattern color=blue] (0,0) rectangle (1,1);
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
    const fillSection = descriptor.sections.find((section) => section.id === "fill");
    expect(fillSection).toBeDefined();
    if (!fillSection) {
      throw new Error("Expected fill section");
    }

    const angle = fillSection.properties.find((property) => property.id === "fill-pattern-angle");
    const distance = fillSection.properties.find((property) => property.id === "fill-pattern-distance");
    const xshift = fillSection.properties.find((property) => property.id === "fill-pattern-xshift");
    const yshift = fillSection.properties.find((property) => property.id === "fill-pattern-yshift");
    const lineWidth = fillSection.properties.find((property) => property.id === "fill-pattern-line-width");
    const fillPattern = fillSection.properties.find((property) => property.kind === "fillPattern");

    if (!fillPattern || fillPattern.kind !== "fillPattern") {
      throw new Error("Expected fill pattern property");
    }

    if (!angle || angle.kind !== "fillPatternOption") {
      throw new Error("Expected fill pattern angle property");
    }
    if (!distance || distance.kind !== "fillPatternOption") {
      throw new Error("Expected fill pattern distance property");
    }
    if (!xshift || xshift.kind !== "fillPatternOption") {
      throw new Error("Expected fill pattern xshift property");
    }
    if (!yshift || yshift.kind !== "fillPatternOption") {
      throw new Error("Expected fill pattern yshift property");
    }
    if (!lineWidth || lineWidth.kind !== "fillPatternOption") {
      throw new Error("Expected fill pattern line width property");
    }

    expect(fillPattern.value).toBe("Lines");
    expect(angle.value).toBeCloseTo(45, 6);
    expect(distance.value).toBeCloseTo(4, 6);
    expect(xshift.value).toBeCloseTo(1, 6);
    expect(yshift.value).toBeCloseTo(2, 6);
    expect(lineWidth.value).toBeCloseTo(0.6, 6);
  });

  it("shows radius and points controls for dot and star meta-pattern families", () => {
    const cases = [
      {
        source: String.raw`\begin{tikzpicture}
  \draw[pattern={Dots[distance=5pt,radius=1.5pt,xshift=1pt,yshift=2pt]},pattern color=blue] (0,0) rectangle (1,1);
\end{tikzpicture}`,
        expectedIds: ["fill-pattern-radius"]
      },
      {
        source: String.raw`\begin{tikzpicture}
  \draw[pattern={Stars[distance=6pt,radius=2pt,points=7]},pattern color=blue] (0,0) rectangle (1,1);
\end{tikzpicture}`,
        expectedIds: ["fill-pattern-radius", "fill-pattern-points"]
      }
    ];

    for (const testCase of cases) {
      const rendered = renderTikzToSvg(testCase.source);
      const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
      expect(element).toBeDefined();
      if (!element) {
        throw new Error("Expected patterned path element");
      }
      const descriptor = getInspectorDescriptor(element, {
        source: testCase.source,
        editHandles: rendered.semantic.editHandles
      });
      const fillSection = descriptor.sections.find((section) => section.id === "fill");
      expect(fillSection).toBeDefined();
      if (!fillSection) {
        throw new Error("Expected fill section");
      }
      for (const id of testCase.expectedIds) {
        expect(fillSection.properties.some((property) => property.id === id)).toBe(true);
      }
    }
  });

  it("maps unsupported shading and pattern values to custom inspector presets", () => {
    const shadingSource = String.raw`\begin{tikzpicture}
  \shade[shading=color wheel] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const shadingRendered = renderTikzToSvg(shadingSource);
    const shadingPath = shadingRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(shadingPath).toBeDefined();
    if (!shadingPath) {
      throw new Error("Expected shading path element");
    }

    const shadingDescriptor = getInspectorDescriptor(shadingPath, {
      source: shadingSource,
      editHandles: shadingRendered.semantic.editHandles
    });
    const shadingFillSection = shadingDescriptor.sections.find((section) => section.id === "fill");
    expect(shadingFillSection).toBeDefined();
    if (!shadingFillSection) {
      throw new Error("Expected fill section");
    }
    const fillShading = shadingFillSection.properties.find((property) => property.kind === "fillShading");
    if (!fillShading || fillShading.kind !== "fillShading") {
      throw new Error("Expected fill shading property");
    }
    expect(fillShading.value).toBe("custom");

    const patternSource = String.raw`\begin{tikzpicture}
  \draw[pattern={CustomPattern}] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const patternRendered = renderTikzToSvg(patternSource);
    const patternPath = patternRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(patternPath).toBeDefined();
    if (!patternPath) {
      throw new Error("Expected pattern path element");
    }

    const patternDescriptor = getInspectorDescriptor(patternPath, {
      source: patternSource,
      editHandles: patternRendered.semantic.editHandles
    });
    const patternFillSection = patternDescriptor.sections.find((section) => section.id === "fill");
    expect(patternFillSection).toBeDefined();
    if (!patternFillSection) {
      throw new Error("Expected fill section");
    }
    const fillPattern = patternFillSection.properties.find((property) => property.kind === "fillPattern");
    if (!fillPattern || fillPattern.kind !== "fillPattern") {
      throw new Error("Expected fill pattern property");
    }
    expect(fillPattern.value).toBe("custom");
  });

  it("normalizes fill, dash, cap, join, and line-width presets from raw model values", () => {
    expect(fillShadingPresetFromStyleName("{ axis }")).toBe("axis");
    expect(fillShadingPresetFromStyleName("radial")).toBe("radial");
    expect(fillShadingPresetFromStyleName("ball")).toBe("ball");
    expect(fillShadingPresetFromStyleName("color wheel")).toBe("custom");

    expect(fillPatternPresetFromResolvedPattern(null)).toBe("dots");
    expect(fillPatternPresetFromResolvedPattern({ kind: "legacy", name: "Grid" } as never)).toBe("grid");
    expect(fillPatternPresetFromResolvedPattern({ kind: "legacy", name: "not-known" } as never)).toBe("custom");
    expect(fillPatternPresetFromResolvedPattern({ kind: "meta-hatch" } as never)).toBe("Hatch");
    expect(fillPatternPresetFromRaw("")).toBe("dots");
    expect(fillPatternPresetFromRaw("{Dots[distance={(1,2)}, radius=2pt]}")).toBe("Dots");
    expect(fillPatternPresetFromRaw("Stars[points=7]")).toBe("Stars");
    expect(fillPatternPresetFromRaw("unknown family")).toBe("custom");

    expect(lineWidthPresetLabel(0.4)).toBe("thin");
    expect(lineWidthPresetLabel(123)).toBeNull();
    expect(dashStylePresetFromStyle(null, 1)).toBe("solid");
    expect(dashStylePresetFromStyle([], 1)).toBe("solid");
    expect(dashStylePresetFromStyle([3, 3], 1)).toBe("dashed");
    expect(dashStylePresetFromStyle([4, 2], 1)).toBe("densely dashed");
    expect(dashStylePresetFromStyle([6, 4], 1)).toBe("loosely dashed");
    expect(dashStylePresetFromStyle([1, 2], 1)).toBe("dotted");
    expect(dashStylePresetFromStyle([1, 1], 1)).toBe("densely dotted");
    expect(dashStylePresetFromStyle([1, 4], 1)).toBe("loosely dotted");
    expect(dashStylePresetFromStyle([1, 2, 3], 1)).toBe("custom");
    expect(dashStylePresetFromStyle([5, 5], 1)).toBe("custom");
    expect(lineCapPresetFromStyle("round")).toBe("round");
    expect(lineCapPresetFromStyle("invalid" as never)).toBe("custom");
    expect(lineJoinPresetFromStyle("bevel")).toBe("bevel");
    expect(lineJoinPresetFromStyle("invalid" as never)).toBe("custom");
  });

  it("resolves fill mode from flag, disabled, and corner-color option states", () => {
    const cases = [
      {
        source: String.raw`\begin{tikzpicture}
  \draw[pattern] (0,0) rectangle (1,1);
\end{tikzpicture}`,
        mode: "pattern",
        shading: "axis",
        pattern: "dots"
      },
      {
        source: String.raw`\begin{tikzpicture}
  \draw[pattern=none,shade=false,fill=yellow] (0,0) rectangle (1,1);
\end{tikzpicture}`,
        mode: "solid",
        shading: "axis",
        pattern: "dots"
      },
      {
        source: String.raw`\begin{tikzpicture}
  \shade[lower left=red,upper right=blue] (0,0) rectangle (1,1);
\end{tikzpicture}`,
        mode: "gradient",
        shading: "custom",
        pattern: "dots"
      }
    ];

    for (const testCase of cases) {
      const rendered = renderTikzToSvg(testCase.source);
      const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
      expect(element).toBeDefined();
      if (!element) {
        throw new Error("Expected path element");
      }
      const descriptor = getInspectorDescriptor(element, {
        source: testCase.source,
        editHandles: rendered.semantic.editHandles
      });
      const fillSection = descriptor.sections.find((section) => section.id === "fill");
      expect(fillSection).toBeDefined();
      if (!fillSection) {
        throw new Error("Expected fill section");
      }
      expect(fillSection.properties.find((property) => property.kind === "fillMode")).toMatchObject({ value: testCase.mode });
      const fillShading = fillSection.properties.find((property) => property.kind === "fillShading");
      const fillPattern = fillSection.properties.find((property) => property.kind === "fillPattern");
      if (fillShading) {
        expect(fillShading).toMatchObject({ value: testCase.shading });
      }
      if (fillPattern) {
        expect(fillPattern).toMatchObject({ value: testCase.pattern });
      }
    }
  });

  it("builds deterministic fill mode mutations that clear conflicting paint keys", () => {
    const toSolid = buildFillModeSetPropertyMutations("solid", {
      fillColor: "green",
      patternColor: "red",
      shading: "radial",
      pattern: "grid"
    });
    expect(toSolid).toHaveLength(1);
    expect(toSolid[0]).toMatchObject({
      key: "fill",
      value: "green"
    });
    expect(toSolid[0]?.clearKeys).toContain("pattern");
    expect(toSolid[0]?.clearKeys).toContain("shade");

    const toGradient = buildFillModeSetPropertyMutations("gradient", {
      fillColor: "green",
      patternColor: "red",
      shading: "custom",
      pattern: "grid"
    });
    expect(toGradient.map((mutation) => mutation.key)).toEqual(["shade", "shading"]);
    expect(toGradient[1]?.value).toBe("axis");
    expect(toGradient[0]?.clearKeys).toContain("pattern");

    const toPattern = buildFillModeSetPropertyMutations("pattern", {
      fillColor: "green",
      patternColor: "blue",
      shading: "axis",
      pattern: "custom"
    });
    expect(toPattern.map((mutation) => mutation.key)).toEqual(["pattern", "pattern color"]);
    expect(toPattern[0]?.value).toBe("dots");
    expect(toPattern[1]?.value).toBe("blue");
    expect(toPattern[0]?.clearKeys).toContain("shade");
    expect(toPattern[0]?.clearKeys).toContain("shading");

    const shadingMutations = buildFillShadingSetPropertyMutations("radial");
    expect(shadingMutations.map((mutation) => mutation.key)).toEqual(["shade", "shading"]);
    expect(shadingMutations[1]?.value).toBe("radial");
    expect(shadingMutations[1]?.clearKeys).toContain("top color");

    const patternMutation = buildFillPatternSetPropertyMutation("grid");
    expect(patternMutation).toMatchObject({
      key: "pattern",
      value: "grid"
    });

    const patternOptionMutation = buildFillPatternOptionSetPropertyMutation(
      {
        family: "Stars",
        values: {
          angle: 0,
          distance: 8.5358,
          xshift: 0,
          yshift: 0,
          lineWidth: 0.4,
          radius: 2.8,
          points: 5
        }
      },
      "points",
      7
    );
    expect(patternOptionMutation).toMatchObject({
      key: "pattern",
      value: "{Stars[angle=0,distance=8.54pt,xshift=0pt,yshift=0pt,radius=2.8pt,points=7]}"
    });
  });

  it("shows line join for closed paths and line cap only when dashes are active", () => {
    const undashedSource = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const dashedSource = String.raw`\begin{tikzpicture}
  \draw[dashed] (0,0) rectangle (1,1);
\end{tikzpicture}`;

    const undashedRendered = renderTikzToSvg(undashedSource);
    const dashedRendered = renderTikzToSvg(dashedSource);
    const undashedPath = undashedRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    const dashedPath = dashedRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(undashedPath).toBeDefined();
    expect(dashedPath).toBeDefined();
    if (!undashedPath || !dashedPath) {
      throw new Error("Expected path elements");
    }

    const undashedDescriptor = getInspectorDescriptor(undashedPath, {
      source: undashedSource,
      editHandles: undashedRendered.semantic.editHandles
    });
    const dashedDescriptor = getInspectorDescriptor(dashedPath, {
      source: dashedSource,
      editHandles: dashedRendered.semantic.editHandles
    });
    const undashedStroke = undashedDescriptor.sections.find((section) => section.id === "stroke");
    const dashedStroke = dashedDescriptor.sections.find((section) => section.id === "stroke");
    expect(undashedStroke).toBeDefined();
    expect(dashedStroke).toBeDefined();
    if (!undashedStroke || !dashedStroke) {
      throw new Error("Expected stroke sections");
    }

    expect(undashedStroke.properties.some((property) => property.kind === "lineJoin")).toBe(true);
    expect(undashedStroke.properties.some((property) => property.kind === "lineCap")).toBe(false);

    expect(dashedStroke.properties.some((property) => property.kind === "lineJoin")).toBe(true);
    expect(dashedStroke.properties.some((property) => property.kind === "lineCap")).toBe(true);
  });

  it("shows rounded corners in the path section only when the path has geometric corners", () => {
    const joinedSource = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const straightSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0);
\end{tikzpicture}`;
    const collinearSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const smoothArcSource = String.raw`\begin{tikzpicture}
  \draw (1,0) arc[start angle=0,end angle=180,radius=1cm]
               arc[start angle=180,end angle=360,radius=1cm];
\end{tikzpicture}`;
    const decoratedStraightSource = String.raw`\begin{tikzpicture}
  \draw[decorate, decoration=zigzag] (-2.5, 2.5) -- (2.5, 2.5);
\end{tikzpicture}`;
    const decoratedCorneredSource = String.raw`\begin{tikzpicture}
  \draw[decorate, decoration=zigzag] (0,0) -- (1,0) -- (1,1);
\end{tikzpicture}`;

    const joinedRendered = renderTikzToSvg(joinedSource);
    const straightRendered = renderTikzToSvg(straightSource);
    const collinearRendered = renderTikzToSvg(collinearSource);
    const smoothArcRendered = renderTikzToSvg(smoothArcSource);
    const decoratedStraightRendered = renderTikzToSvg(decoratedStraightSource);
    const decoratedCorneredRendered = renderTikzToSvg(decoratedCorneredSource);
    const joinedPath = joinedRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    const straightPath = straightRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    const collinearPath = collinearRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    const smoothArcPath = smoothArcRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    const decoratedStraightPath = decoratedStraightRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    const decoratedCorneredPath = decoratedCorneredRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(joinedPath).toBeDefined();
    expect(straightPath).toBeDefined();
    expect(collinearPath).toBeDefined();
    expect(smoothArcPath).toBeDefined();
    expect(decoratedStraightPath).toBeDefined();
    expect(decoratedCorneredPath).toBeDefined();
    if (
      !joinedPath ||
      !straightPath ||
      !collinearPath ||
      !smoothArcPath ||
      !decoratedStraightPath ||
      !decoratedCorneredPath
    ) {
      throw new Error("Expected path elements");
    }

    const joinedDescriptor = getInspectorDescriptor(joinedPath, {
      source: joinedSource,
      editHandles: joinedRendered.semantic.editHandles
    });
    const straightDescriptor = getInspectorDescriptor(straightPath, {
      source: straightSource,
      editHandles: straightRendered.semantic.editHandles
    });
    const collinearDescriptor = getInspectorDescriptor(collinearPath, {
      source: collinearSource,
      editHandles: collinearRendered.semantic.editHandles
    });
    const smoothArcDescriptor = getInspectorDescriptor(smoothArcPath, {
      source: smoothArcSource,
      editHandles: smoothArcRendered.semantic.editHandles
    });
    const decoratedStraightDescriptor = getInspectorDescriptor(decoratedStraightPath, {
      source: decoratedStraightSource,
      editHandles: decoratedStraightRendered.semantic.editHandles
    });
    const decoratedCorneredDescriptor = getInspectorDescriptor(decoratedCorneredPath, {
      source: decoratedCorneredSource,
      editHandles: decoratedCorneredRendered.semantic.editHandles
    });

    const joinedPathSection = joinedDescriptor.sections.find((section) => section.id === "path");
    const straightPathSection = straightDescriptor.sections.find((section) => section.id === "path");
    const collinearPathSection = collinearDescriptor.sections.find((section) => section.id === "path");
    const smoothArcPathSection = smoothArcDescriptor.sections.find((section) => section.id === "path");
    const decoratedStraightPathSection = decoratedStraightDescriptor.sections.find((section) => section.id === "path");
    const decoratedCorneredPathSection = decoratedCorneredDescriptor.sections.find((section) => section.id === "path");
    expect(joinedPathSection).toBeDefined();
    expect(straightPathSection).toBeDefined();
    expect(collinearPathSection).toBeDefined();
    expect(smoothArcPathSection).toBeDefined();
    expect(decoratedStraightPathSection).toBeDefined();
    expect(decoratedCorneredPathSection).toBeDefined();
    if (
      !joinedPathSection ||
      !straightPathSection ||
      !collinearPathSection ||
      !smoothArcPathSection ||
      !decoratedStraightPathSection ||
      !decoratedCorneredPathSection
    ) {
      throw new Error("Expected path sections");
    }

    const joinedRoundedCorners = joinedPathSection.properties.find(
      (property) => property.kind === "roundedCorners"
    );
    const straightRoundedCorners = straightPathSection.properties.find(
      (property) => property.kind === "roundedCorners"
    );
    const collinearRoundedCorners = collinearPathSection.properties.find(
      (property) => property.kind === "roundedCorners"
    );
    const smoothArcRoundedCorners = smoothArcPathSection.properties.find(
      (property) => property.kind === "roundedCorners"
    );
    const decoratedStraightRoundedCorners = decoratedStraightPathSection.properties.find(
      (property) => property.kind === "roundedCorners"
    );
    const decoratedCorneredRoundedCorners = decoratedCorneredPathSection.properties.find(
      (property) => property.kind === "roundedCorners"
    );

    expect(joinedRoundedCorners).toBeDefined();
    if (!joinedRoundedCorners || joinedRoundedCorners.kind !== "roundedCorners") {
      throw new Error("Expected rounded corners property");
    }
    expect(joinedRoundedCorners.enabled).toBe(false);
    expect(joinedRoundedCorners.radius).toBeCloseTo(4, 6);
    expect(joinedRoundedCorners.defaultRadius).toBeCloseTo(4, 6);
    expect(joinedRoundedCorners.max).toBeCloseTo(14.23, 2);

    expect(straightRoundedCorners).toBeUndefined();
    expect(collinearRoundedCorners).toBeUndefined();
    expect(smoothArcRoundedCorners).toBeUndefined();
    expect(decoratedStraightRoundedCorners).toBeUndefined();
    expect(decoratedCorneredRoundedCorners).toBeDefined();
  });

  it("keeps rounded-corner max stable after rounded corners are enabled", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rounded corners=4pt] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const path = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(path).toBeDefined();
    if (!path) {
      throw new Error("Expected path element");
    }

    const descriptor = getInspectorDescriptor(path, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const pathSection = descriptor.sections.find((section) => section.id === "path");
    expect(pathSection).toBeDefined();
    if (!pathSection) {
      throw new Error("Expected path section");
    }

    const roundedCorners = pathSection.properties.find((property) => property.kind === "roundedCorners");
    expect(roundedCorners).toBeDefined();
    if (!roundedCorners || roundedCorners.kind !== "roundedCorners") {
      throw new Error("Expected rounded corners property");
    }

    expect(roundedCorners.enabled).toBe(true);
    expect(roundedCorners.max).toBeCloseTo(14.23, 2);
  });

  it("builds rounded-corners mutations for enabling and disabling", () => {
    const enabled = buildRoundedCornersSetPropertyMutation(true, 6);
    expect(enabled).toMatchObject({
      key: "rounded corners",
      value: "6pt"
    });
    expect(enabled.clearKeys).toContain("sharp corners");
    expect(enabled.clearKeys).not.toContain("rounded corners");

    const enabledDefault = buildRoundedCornersSetPropertyMutation(true);
    expect(enabledDefault.value).toBe("true");

    const disabled = buildRoundedCornersSetPropertyMutation(false, 6);
    expect(disabled).toMatchObject({
      key: "sharp corners",
      value: "true"
    });
    expect(disabled.clearKeys).toContain("rounded corners");
    expect(disabled.clearKeys).not.toContain("sharp corners");

    const disabledWithoutSharp = buildRoundedCornersSetPropertyMutation(false, 6, false);
    expect(disabledWithoutSharp).toMatchObject({
      key: "rounded corners",
      value: ""
    });
    expect(disabledWithoutSharp.clearKeys).toContain("rounded corners");
    expect(disabledWithoutSharp.clearKeys).toContain("sharp corners");
  });

  it("requires explicit sharp-corners disable only when rounded corners are inherited", () => {
    const inheritedSource = String.raw`\begin{tikzpicture}
  \begin{scope}[rounded corners=6pt]
    \draw (0,0) rectangle (1,1);
  \end{scope}
\end{tikzpicture}`;
    const inheritedRendered = renderTikzToSvg(inheritedSource);
    const inheritedPath = inheritedRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(inheritedPath).toBeDefined();
    if (!inheritedPath) {
      throw new Error("Expected inherited path element");
    }
    const inheritedDescriptor = getInspectorDescriptor(inheritedPath, {
      source: inheritedSource,
      editHandles: inheritedRendered.semantic.editHandles
    });
    const inheritedPathSection = inheritedDescriptor.sections.find((section) => section.id === "path");
    expect(inheritedPathSection).toBeDefined();
    if (!inheritedPathSection) {
      throw new Error("Expected inherited path section");
    }
    const inheritedRounded = inheritedPathSection.properties.find((property) => property.kind === "roundedCorners");
    expect(inheritedRounded).toBeDefined();
    if (!inheritedRounded || inheritedRounded.kind !== "roundedCorners") {
      throw new Error("Expected inherited rounded corners property");
    }
    expect(inheritedRounded.disableRequiresSharpCorners).toBe(true);

    const localSource = String.raw`\begin{tikzpicture}
  \draw[rounded corners=6pt] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const localRendered = renderTikzToSvg(localSource);
    const localPath = localRendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(localPath).toBeDefined();
    if (!localPath) {
      throw new Error("Expected local path element");
    }
    const localDescriptor = getInspectorDescriptor(localPath, {
      source: localSource,
      editHandles: localRendered.semantic.editHandles
    });
    const localPathSection = localDescriptor.sections.find((section) => section.id === "path");
    expect(localPathSection).toBeDefined();
    if (!localPathSection) {
      throw new Error("Expected local path section");
    }
    const localRounded = localPathSection.properties.find((property) => property.kind === "roundedCorners");
    expect(localRounded).toBeDefined();
    if (!localRounded || localRounded.kind !== "roundedCorners") {
      throw new Error("Expected local rounded corners property");
    }
    expect(localRounded.disableRequiresSharpCorners).toBe(false);
  });

  it("shows shadow controls for paths with a drop shadow", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[drop shadow={shadow xshift=1pt,shadow yshift=-2pt,opacity=.25,fill=gray}] (0,0) -- (1,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const path = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(path).toBeDefined();
    if (!path) {
      throw new Error("Expected path element");
    }

    const descriptor = getInspectorDescriptor(path, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const shadowSection = descriptor.sections.find((section) => section.id === "shadow");
    expect(shadowSection).toBeDefined();
    if (!shadowSection) {
      throw new Error("Expected shadow section");
    }

    expect(shadowSection.properties.map((property) => property.id)).toEqual([
      "shadow-preset",
      "shadow-xshift",
      "shadow-yshift",
      "shadow-scale",
      "shadow-opacity",
      "shadow-color"
    ]);

    const preset = shadowSection.properties.find((property) => property.id === "shadow-preset");
    const xshift = shadowSection.properties.find((property) => property.id === "shadow-xshift");
    const yshift = shadowSection.properties.find((property) => property.id === "shadow-yshift");
    const scale = shadowSection.properties.find((property) => property.id === "shadow-scale");
    const opacity = shadowSection.properties.find((property) => property.id === "shadow-opacity");
    const color = shadowSection.properties.find((property) => property.id === "shadow-color");

    if (!preset || preset.kind !== "shadowPreset") {
      throw new Error("Expected shadow preset property");
    }
    if (!xshift || xshift.kind !== "length") {
      throw new Error("Expected shadow xshift property");
    }
    if (!yshift || yshift.kind !== "length") {
      throw new Error("Expected shadow yshift property");
    }
    if (!scale || scale.kind !== "number") {
      throw new Error("Expected shadow scale property");
    }
    if (!opacity || opacity.kind !== "number") {
      throw new Error("Expected shadow opacity property");
    }
    if (!color || color.kind !== "color") {
      throw new Error("Expected shadow color property");
    }

    expect(preset.value).toBe("drop-shadow");
    expect(xshift.value).toBeCloseTo(1, 6);
    expect(yshift.value).toBeCloseTo(-2, 6);
    expect(scale.value).toBeCloseTo(1, 6);
    expect(opacity.value).toBeCloseTo(0.25, 6);
    expect(opacity.min).toBe(0);
    expect(opacity.max).toBe(1);
    expect(color.value).toBe("gray");
    expect(color.syntaxValue).toBe("gray");
    expect(xshift.write.shadowContext).toBeDefined();
  });

  it("parses shadow overrides while ignoring malformed nested values", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[drop shadow={draw,shadow xshift=bad,shadow yshift=3pt,shadow scale={1.4},opacity={0.35},fill=__tikz-shadow-inherit-fill__}] (0,0) -- (1,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const path = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(path).toBeDefined();
    if (!path) {
      throw new Error("Expected path element");
    }

    const descriptor = getInspectorDescriptor(path, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const shadowSection = descriptor.sections.find((section) => section.id === "shadow");
    expect(shadowSection).toBeDefined();
    if (!shadowSection) {
      throw new Error("Expected shadow section");
    }

    const xshift = shadowSection.properties.find((property) => property.id === "shadow-xshift");
    const yshift = shadowSection.properties.find((property) => property.id === "shadow-yshift");
    const scale = shadowSection.properties.find((property) => property.id === "shadow-scale");
    const opacity = shadowSection.properties.find((property) => property.id === "shadow-opacity");
    const color = shadowSection.properties.find((property) => property.id === "shadow-color");

    if (!xshift || xshift.kind !== "length") {
      throw new Error("Expected shadow xshift property");
    }
    if (!yshift || yshift.kind !== "length") {
      throw new Error("Expected shadow yshift property");
    }
    if (!scale || scale.kind !== "number") {
      throw new Error("Expected shadow scale property");
    }
    if (!opacity || opacity.kind !== "number") {
      throw new Error("Expected shadow opacity property");
    }
    if (!color || color.kind !== "color") {
      throw new Error("Expected shadow color property");
    }

    expect(xshift.value).not.toBeCloseTo(0, 6);
    expect(yshift.value).toBeCloseTo(3, 6);
    expect(scale.value).toBeCloseTo(1.4, 6);
    expect(opacity.value).toBeCloseTo(0.35, 6);
    expect(color.value).toBe("black!50");
  });

  it("preserves preset default shadow color syntax as black!50", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[drop shadow] (0,0) -- (1,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const path = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(path).toBeDefined();
    if (!path) {
      throw new Error("Expected path element");
    }

    const descriptor = getInspectorDescriptor(path, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const shadowSection = descriptor.sections.find((section) => section.id === "shadow");
    expect(shadowSection).toBeDefined();
    if (!shadowSection) {
      throw new Error("Expected shadow section");
    }

    const color = shadowSection.properties.find((property) => property.id === "shadow-color");
    if (!color || color.kind !== "color") {
      throw new Error("Expected shadow color property");
    }

    expect(color.value).toBe("black!50");
    expect(color.syntaxValue).toBe("black!50");
  });

  it("matches documented circular glow defaults", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[circular glow] (0,0) -- (1,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const path = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
    expect(path).toBeDefined();
    if (!path) {
      throw new Error("Expected path element");
    }

    const descriptor = getInspectorDescriptor(path, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    const shadowSection = descriptor.sections.find((section) => section.id === "shadow");
    expect(shadowSection).toBeDefined();
    if (!shadowSection) {
      throw new Error("Expected shadow section");
    }

    const xshift = shadowSection.properties.find((property) => property.id === "shadow-xshift");
    const yshift = shadowSection.properties.find((property) => property.id === "shadow-yshift");
    const scale = shadowSection.properties.find((property) => property.id === "shadow-scale");
    const opacity = shadowSection.properties.find((property) => property.id === "shadow-opacity");
    const color = shadowSection.properties.find((property) => property.id === "shadow-color");

    if (!xshift || xshift.kind !== "length") {
      throw new Error("Expected circular glow xshift property");
    }
    if (!yshift || yshift.kind !== "length") {
      throw new Error("Expected circular glow yshift property");
    }
    if (!scale || scale.kind !== "number") {
      throw new Error("Expected circular glow scale property");
    }
    if (!opacity || opacity.kind !== "number") {
      throw new Error("Expected circular glow opacity property");
    }
    if (!color || color.kind !== "color") {
      throw new Error("Expected circular glow color property");
    }

    expect(xshift.value).toBeCloseTo(0, 6);
    expect(yshift.value).toBeCloseTo(0, 6);
    expect(scale.value).toBeCloseTo(1.25, 6);
    expect(opacity.value).toBeCloseTo(1, 6);
    expect(opacity.min).toBe(0);
    expect(opacity.max).toBe(1);
    expect(color.value).toBe("black");
    expect(color.syntaxValue).toBe("black");
  });

  it("classifies the documented shadow presets in inspector controls", () => {
    const cases: Array<{ option: string; preset: string }> = [
      { option: "copy shadow", preset: "copy-shadow" },
      { option: "double copy shadow", preset: "copy-shadow" },
      { option: "circular drop shadow", preset: "circular-drop-shadow" },
      { option: "general shadow", preset: "drop-shadow" }
    ];

    for (const testCase of cases) {
      const source = String.raw`\begin{tikzpicture}
  \draw[${testCase.option}] (0,0) -- (1,0);
\end{tikzpicture}`;
      const rendered = renderTikzToSvg(source);
      const path = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
      expect(path, testCase.option).toBeDefined();
      if (!path) {
        throw new Error(`Expected path element for ${testCase.option}`);
      }

      const descriptor = getInspectorDescriptor(path, {
        source,
        editHandles: rendered.semantic.editHandles
      });
      const shadowSection = descriptor.sections.find((section) => section.id === "shadow");
      expect(shadowSection, testCase.option).toBeDefined();
      if (!shadowSection) {
        throw new Error(`Expected shadow section for ${testCase.option}`);
      }

      const preset = shadowSection.properties.find((property) => property.id === "shadow-preset");
      if (!preset || preset.kind !== "shadowPreset") {
        throw new Error(`Expected shadow preset property for ${testCase.option}`);
      }
      expect(preset.value).toBe(testCase.preset);
    }
  });

  it("builds shadow mutations as flags or nested option payloads", () => {
    const defaultDropShadow = buildShadowSetPropertyMutations({
      preset: "drop-shadow",
      xshiftPt: 2.15,
      yshiftPt: -2.15,
      scale: 1,
      opacity: 0.5,
      color: "black!50"
    });
    expect(defaultDropShadow).toEqual([
      {
        key: "drop shadow",
        value: "true",
        clearKeys: ["copy shadow", "circular drop shadow", "circular glow", "general shadow", "double copy shadow"]
      }
    ]);

    const customDropShadow = buildShadowSetPropertyMutations({
      preset: "drop-shadow",
      xshiftPt: 2,
      yshiftPt: -3,
      scale: 1,
      opacity: 0.25,
      color: "gray"
    });
    expect(customDropShadow).toEqual([
      {
        key: "drop shadow",
        value: "{shadow xshift=2pt,shadow yshift=-3pt,opacity=0.25,fill=gray}",
        clearKeys: ["copy shadow", "circular drop shadow", "circular glow", "general shadow", "double copy shadow"]
      }
    ]);

    const disabledShadow = buildShadowSetPropertyMutations({
      preset: "none",
      xshiftPt: 0,
      yshiftPt: 0,
      scale: 1,
      opacity: 1,
      color: null
    });
    expect(disabledShadow).toEqual([
      {
        key: "drop shadow",
        value: "",
        clearKeys: ["drop shadow", "copy shadow", "circular drop shadow", "circular glow", "general shadow", "double copy shadow"]
      }
    ]);

    const copyToDropShadow = buildShadowSetPropertyMutations({
      preset: "drop-shadow",
      xshiftPt: 2.15,
      yshiftPt: -2.15,
      scale: 1,
      opacity: 0.5,
      color: "__tikz-shadow-inherit-fill__"
    });
    expect(copyToDropShadow).toEqual([
      {
        key: "drop shadow",
        value: "true",
        clearKeys: ["copy shadow", "circular drop shadow", "circular glow", "general shadow", "double copy shadow"]
      }
    ]);

    const circularGlowOpacity = buildShadowSetPropertyMutations({
      preset: "circular-glow",
      xshiftPt: 0,
      yshiftPt: 0,
      scale: 1.25,
      opacity: 0.4,
      color: "black"
    });
    expect(circularGlowOpacity).toEqual([
      {
        key: "circular glow",
        value: "{opacity=0.4}",
        clearKeys: ["drop shadow", "copy shadow", "circular drop shadow", "general shadow", "double copy shadow"]
      }
    ]);
  });

  it("builds documented preset contexts for shadow preset switches", () => {
    expect(buildShadowMutationContextForPreset("circular-glow")).toEqual({
      preset: "circular-glow",
      xshiftPt: 0,
      yshiftPt: 0,
      scale: 1.25,
      opacity: 1,
      color: "black"
    });

    expect(buildShadowMutationContextForPreset("copy-shadow")).toEqual({
      preset: "copy-shadow",
      xshiftPt: 2.15,
      yshiftPt: -2.15,
      scale: 1,
      opacity: 1,
      color: null
    });
  });

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

describe("resolvePropertyTarget – matrix cells", () => {
  it("resolves style-source and global targets across standalone style syntaxes", () => {
    expect(resolvePropertyTarget(String.raw`\tikz { \draw (0,0); }`, "   ")).toMatchObject({
      kind: "not-found",
      reason: "Missing element id"
    });

    const global = resolvePropertyTarget(String.raw`\tikz[scale=2] \draw (0,0);`, TIKZPICTURE_GLOBAL_TARGET_ID);
    expect(global.kind).toBe("found");
    if (global.kind !== "found") {
      throw new Error("Expected inline tikzpicture target");
    }
    expect(global.target.kind).toBe("figure");
    expect(global.target.insertOffset).toBeGreaterThan(0);

    const inlineSource = String.raw`\tikz[scale=2] \draw (0,0);`;
    expect(resolvePropertyTargetFromParseResult(
      inlineSource,
      parseTikz(inlineSource, { recover: true }),
      TIKZPICTURE_GLOBAL_TARGET_ID
    )).toMatchObject({ kind: "found", target: { kind: "figure" } });

    const source = String.raw`\tikzset{foo/.style={draw, fill=red}}
\pgfkeys{/tikz/bar/.style=[rounded corners, blue]}
\tikzstyle{legacy}=[dashed, line width=1pt]
\tikzstyle{legacy bare}=dashed, line width=1pt
foo/.append style={solid, fill=blue}
foo/.prefix style=[very thick]
empty/.style=
bare/.style=draw,green
broken`;
    const styleSnippets = [
      String.raw`\tikzset{foo/.style={draw, fill=red}}`,
      String.raw`\pgfkeys{/tikz/bar/.style=[rounded corners, blue]}`,
      String.raw`\tikzstyle{legacy}=[dashed, line width=1pt]`,
      String.raw`\tikzstyle{legacy bare}=dashed, line width=1pt`,
      String.raw`foo/.append style={solid, fill=blue}`,
      String.raw`foo/.prefix style=[very thick]`,
      String.raw`empty/.style=`,
      String.raw`bare/.style=draw,green`
    ];

    for (const snippet of styleSnippets) {
      const from = source.indexOf(snippet);
      const targetId = makeStyleSourceTargetId({ from, to: from + snippet.length });
      const resolved = resolvePropertyTarget(source, targetId);
      expect(resolved.kind).toBe("found");
      if (resolved.kind !== "found") {
        throw new Error(`Expected style source target for ${snippet}`);
      }
      expect(resolved.target.kind).toBe("style-source");
      expect(resolved.target.optionsSpan).toBeDefined();
      expect(resolved.target.insertOffset).toBeGreaterThanOrEqual(resolved.target.optionsSpan?.from ?? 0);
    }

    const parseResult = parseTikz(source, { recover: true });
    const firstStyleFrom = source.indexOf(styleSnippets[0]);
    expect(resolvePropertyTargetFromParseResult(
      source,
      parseResult,
      makeStyleSourceTargetId({ from: firstStyleFrom, to: firstStyleFrom + styleSnippets[0].length })
    )).toMatchObject({ kind: "found", target: { kind: "style-source" } });

    expect(resolvePropertyTarget(source, "__style_source__:bad:4").kind).toBe("not-found");
    expect(resolvePropertyTarget(source, makeStyleSourceTargetId({ from: -1, to: 3 })).kind).toBe("not-found");
    const brokenFrom = source.indexOf("broken");
    expect(resolvePropertyTarget(source, makeStyleSourceTargetId({ from: brokenFrom, to: brokenFrom + "broken".length }))).toMatchObject({
      kind: "not-found"
    });
  });

  it("resolves parse-result, operation, nested node, adornment, scope, and foreach-template targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=1cm]
    \draw[blue] (0,0) to[bend left] node[above, label={[red]north:L}] {T} (1,0)
      edge[red] node[below] {E} (2,0)
      coordinate[pos=.5] (M)
      svg[scale=1] {M 0 0 L 1 1}
      child { node[draw] {C} };
  \end{scope}
  \foreach \x in {1,2} {
    \node[draw] (N\x) at (\x,0) {N\x};
    \foreach \y in {1,2} { \node[fill=red] (N\x-\y) at (\x,\y) {N}; }
  }
  \tikzset{tick/.pic={\draw[blue] (0,0) -- (1,0);}}
  \pic at (0,0) {tick};
\end{tikzpicture}`;
    const parseResult = parseTikz(source, { recover: true });
    expect(resolvePropertyTargetFromParseResult(source, parseResult, "")).toMatchObject({ kind: "not-found" });

    const scope = parseResult.figure.body.find((statement) => statement.kind === "Scope");
    if (!scope || scope.kind !== "Scope") {
      throw new Error("Expected scope");
    }
    const path = scope.body.find((statement) => statement.kind === "Path");
    if (!path || path.kind !== "Path") {
      throw new Error("Expected path");
    }

    expect(resolvePropertyTargetFromParseResult(source, parseResult, scope.id)).toMatchObject({
      kind: "found",
      target: { kind: "style-source" }
    });
    expect(resolvePropertyTargetFromParseResult(source, parseResult, path.id)).toMatchObject({
      kind: "found",
      target: { kind: "path-statement", pathCommand: "draw" }
    });

    const to = path.items.find((item) => item.kind === "ToOperation");
    const edge = path.items.find((item) => item.kind === "EdgeOperation");
    const coordinate = path.items.find((item) => item.kind === "CoordinateOperation");
    const svg = path.items.find((item) => item.kind === "SvgOperation");
    const child = path.items.find((item) => item.kind === "ChildOperation");
    if (!to || to.kind !== "ToOperation" || !edge || edge.kind !== "EdgeOperation" || !coordinate || coordinate.kind !== "CoordinateOperation" || !svg || svg.kind !== "SvgOperation" || !child || child.kind !== "ChildOperation") {
      throw new Error("Expected rich path operations");
    }

    expect(resolvePropertyTargetFromParseResult(source, parseResult, to.id)).toMatchObject({ kind: "found", target: { kind: "to-operation" } });
    expect(resolvePropertyTargetFromParseResult(source, parseResult, edge.id)).toMatchObject({ kind: "found", target: { kind: "edge-operation" } });
    expect(resolvePropertyTargetFromParseResult(source, parseResult, coordinate.id)).toMatchObject({ kind: "found", target: { kind: "coordinate-operation" } });
    expect(resolvePropertyTargetFromParseResult(source, parseResult, svg.id)).toMatchObject({ kind: "found", target: { kind: "svg-operation" } });

    const nestedToNode = to.nodes?.[0];
    const nestedEdgeNode = edge.nodes?.[0];
    if (!nestedToNode || !nestedEdgeNode) {
      throw new Error("Expected operation nodes");
    }
    expect(resolvePropertyTargetFromParseResult(source, parseResult, nestedToNode.id)).toMatchObject({ kind: "found", target: { kind: "node-item" } });
    expect(resolvePropertyTargetFromParseResult(source, parseResult, nestedEdgeNode.id)).toMatchObject({ kind: "found", target: { kind: "node-item" } });
    expect(resolvePropertyTargetFromParseResult(source, parseResult, `node-adornment:${nestedToNode.id}:label:0`)).toMatchObject({
      kind: "found",
      target: { kind: "node-adornment", adornmentKind: "label" }
    });

    const foreach = parseResult.figure.body.find((statement) => statement.kind === "Foreach");
    if (!foreach || foreach.kind !== "Foreach") {
      throw new Error("Expected foreach");
    }
    const foreachTarget = resolvePropertyTarget(source, makeForeachTemplateTargetId(foreach.id, "path:0"));
    expect(foreachTarget).toMatchObject({
      kind: "found",
      target: { kind: "foreach-template", foreachLocalTargetId: "path:0" }
    });
    expect(resolvePropertyTargetFromParseResult(
      source,
      parseResult,
      makeForeachTemplateTargetId(foreach.id, "path:0")
    )).toMatchObject({
      kind: "found",
      target: { kind: "foreach-template", foreachLocalTargetId: "path:0" }
    });

    const nestedForeachTarget = resolvePropertyTarget(source, makeForeachTemplateTargetId(foreach.id, "path:0", ["foreach:0"]));
    expect(nestedForeachTarget).toMatchObject({
      kind: "not-found"
    });

    expect(resolvePropertyTarget(source, "__foreach_template__:::")).toMatchObject({ kind: "not-found" });
    expect(resolvePropertyTarget(source, makeForeachTemplateTargetId(foreach.id, "missing"))).toMatchObject({ kind: "not-found" });

    const picCode = String.raw`\draw[blue] (0,0) -- (1,0);`;
    const picCodeFrom = source.indexOf(picCode);
    const picTemplateId = makePicTemplateTargetId({ from: picCodeFrom, to: picCodeFrom + picCode.length }, "path:0");
    expect(resolvePropertyTarget(source, picTemplateId)).toMatchObject({
      kind: "found",
      target: { kind: "pic-template", picLocalTargetId: "path:0" }
    });
    expect(resolvePropertyTargetFromParseResult(source, parseResult, picTemplateId)).toMatchObject({
      kind: "found",
      target: { kind: "pic-template", picLocalTargetId: "path:0" }
    });
    expect(resolvePropertyTarget(source, makePicTemplateTargetId({ from: picCodeFrom, to: picCodeFrom + picCode.length }, "missing"))).toMatchObject({
      kind: "not-found"
    });
  });

  it("covers defensive property-target resolution failures and delegated analysis views", () => {
    const delegated = resolvePropertyTarget("same", "delegated-id", {
      activeFigureId: "fig",
      analysisView: {
        source: "same",
        activeFigureId: "fig",
        resolvePropertyTarget: (id: string) => ({ kind: "not-found", reason: `delegated:${id}` })
      }
    } as never);
    expect(delegated).toEqual({ kind: "not-found", reason: "delegated:delegated-id" });

    expect(resolveFigurePropertyTargetFromParseResult("", {
      figure: { span: { from: 0, to: 0 } }
    } as never)).toMatchObject({ kind: "not-found" });
    expect(resolveFigurePropertyTargetFromParseResult("\\draw (0,0);", {
      figure: { span: { from: 0, to: "\\draw (0,0);".length } }
    } as never)).toMatchObject({ kind: "not-found" });

    const styleSource = String.raw`\tikzset
\tikzset{unterminated
\tikzstyle{missing}
\tikzstyle{empty}= ;
not a style/.unknown={draw}`;
    for (const snippet of [
      String.raw`\tikzset`,
      String.raw`\tikzset{unterminated`,
      String.raw`\tikzstyle{missing}`,
      String.raw`\tikzstyle{empty}= ;`,
      String.raw`not a style/.unknown={draw}`
    ]) {
      const from = styleSource.indexOf(snippet);
      const resolved = resolvePropertyTarget(styleSource, makeStyleSourceTargetId({ from, to: from + snippet.length }));
      expect(resolved.kind).toBe("not-found");
    }

    const matrixSource = String.raw`\begin{tikzpicture}
  \begin{scope}
    \matrix[matrix] { A & B \\ };
    \node {plain};
  \end{scope}
\end{tikzpicture}`;
    expect(resolvePropertyTarget(matrixSource, "node:0:0:matrix-cell:0:1")).toMatchObject({ kind: "not-found" });
    expect(resolvePropertyTarget(matrixSource, "missing:matrix-cell:1:1")).toMatchObject({ kind: "not-found" });
    expect(resolvePropertyTarget(matrixSource, "node:0:1:matrix-cell:1:1")).toMatchObject({ kind: "not-found" });
    expect(resolvePropertyTarget(matrixSource, "node:0:0:matrix-cell:10:1")).toMatchObject({ kind: "not-found" });

    const treeSource = String.raw`\begin{tikzpicture}
  \path node {root} child { edge from parent node {edge} node {after edge} };
\end{tikzpicture}`;
    for (const id of [
      ":tree-child:1:child:0",
      "path:0:tree-child:",
      "path:0:tree-child:x:child:0",
      "path:0:tree-child:1:",
      "missing:tree-child:1:child:0",
      "path:0:tree-child:2:child:0"
    ]) {
      expect(resolvePropertyTarget(treeSource, id)).toMatchObject({ kind: "not-found" });
    }
  });

  it("resolves matrix statement ids to matrix-statement targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,row sep=2mm,column sep=3mm] {
    A & B \\
  };
\end{tikzpicture}`;

    const resolved = resolvePropertyTarget(source, "path:0");
    expect(resolved.kind).toBe("found");
    if (resolved.kind !== "found") {
      throw new Error("Expected matrix statement target");
    }

    expect(resolved.target.kind).toBe("matrix-statement");
    expect(resolved.target.optionsSpan).toBeDefined();
    expect(resolved.target.matrixKind).toBe("nodes");
    expect(resolved.target.matrixTextMode).toBe("text");
  });

  it("builds matrix descriptors with transform, spacing, and paint controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[xshift=1pt,yshift=2pt,rotate=15,matrix of nodes,row sep=1pt,column sep=3pt,draw=red,fill=blue] {
    A & B \\
  };
\end{tikzpicture}`;
    const descriptor = buildMatrixInspectorDescriptor(source, "path:0");
    expect(descriptor).toBeDefined();
    if (!descriptor) {
      throw new Error("Expected matrix descriptor");
    }
    expect(descriptor.sections.find((section) => section.id === "transform")?.properties.map((property) => property.id)).toEqual([
      "xshift",
      "yshift",
      "xscale",
      "yscale",
      "rotate"
    ]);
    const matrixSection = descriptor.sections.find((section) => section.id === "matrix");
    expect(matrixSection).toBeDefined();
    if (!matrixSection) {
      throw new Error("Expected matrix section");
    }
    expect(matrixSection.properties.find((property) => property.id === "matrix-row-sep")).toMatchObject({ value: 1 });
    expect(matrixSection.properties.find((property) => property.id === "matrix-column-sep")).toMatchObject({ value: 3 });
    expect(matrixSection.properties.find((property) => property.id === "matrix-draw")).toMatchObject({ value: "red" });
    expect(matrixSection.properties.find((property) => property.id === "matrix-fill")).toMatchObject({ value: "blue" });
    expect(buildMatrixInspectorDescriptor(source, "missing")).toBeNull();
    expect(buildMatrixInspectorDescriptor(String.raw`\begin{tikzpicture}\draw (0,0);\end{tikzpicture}`, "path:0")).toBeNull();
  });

  it("normalizes sparse and malformed matrix inspector options", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,row sep={1pt,bad,2pt},column sep=bad,draw,fill=] {
    A \\
  };
\end{tikzpicture}`;
    const descriptor = buildMatrixInspectorDescriptor(source, "path:0");
    expect(descriptor).toBeDefined();
    if (!descriptor) {
      throw new Error("Expected matrix descriptor");
    }

    const matrixSection = descriptor.sections.find((section) => section.id === "matrix");
    expect(matrixSection).toBeDefined();
    if (!matrixSection) {
      throw new Error("Expected matrix section");
    }
    expect(matrixSection.properties.find((property) => property.id === "matrix-row-sep")).toMatchObject({ value: 0 });
    expect(matrixSection.properties.find((property) => property.id === "matrix-column-sep")).toMatchObject({ value: 0 });
    expect(matrixSection.properties.find((property) => property.id === "matrix-draw")).toMatchObject({ value: null });
    expect(matrixSection.properties.find((property) => property.id === "matrix-fill")).toMatchObject({ value: null });
  });

  it("resolves matrix-cell synthetic ids to cell text spans", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[draw,fill=yellow]| BC \\
  };
\end{tikzpicture}`;

    const resolved = resolvePropertyTarget(source, "node:0:0:matrix-cell:1:2");
    expect(resolved.kind).toBe("found");
    if (resolved.kind !== "found") {
      throw new Error("Expected matrix-cell target");
    }

    expect(resolved.target.kind).toBe("matrix-cell");
    expect(resolved.target.matrixSourceId).toBe("path:0");
    expect(resolved.target.row).toBe(1);
    expect(resolved.target.column).toBe(2);
    expect(resolved.target.textSpan).toBeDefined();
    expect(resolved.target.optionSpan).toBeDefined();
    if (resolved.target.textSpan) {
      expect(source.slice(resolved.target.textSpan.from, resolved.target.textSpan.to)).toBe("BC");
    }
    if (resolved.target.optionSpan) {
      expect(source.slice(resolved.target.optionSpan.from, resolved.target.optionSpan.to)).toBe("[draw,fill=yellow]");
    }
  });

  it("allows supported matrix-cell inspector writes for matrix of nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,nodes={draw}] {
    A & B \\
  };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const matrixCellText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.matrixCell?.cellSourceId === "node:0:0:matrix-cell:1:1"
    );
    expect(matrixCellText).toBeDefined();
    if (!matrixCellText) {
      throw new Error("Expected matrix cell text element");
    }

    const descriptor = getInspectorDescriptor(matrixCellText, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.sections.some((section) => section.id === "transform")).toBe(false);

    const strokeSection = descriptor.sections.find((section) => section.id === "stroke");
    expect(strokeSection).toBeDefined();
    if (!strokeSection) {
      throw new Error("Expected stroke section");
    }
    const strokeColor = strokeSection.properties.find((property) => property.kind === "color");
    expect(strokeColor).toBeDefined();
    if (!strokeColor || strokeColor.kind !== "color") {
      throw new Error("Expected stroke color property");
    }
    expect(strokeColor.write.writable).toBe(true);
    const lineWidth = strokeSection.properties.find((property) => property.kind === "lineWidth");
    expect(lineWidth).toBeDefined();
    if (!lineWidth || lineWidth.kind !== "lineWidth") {
      throw new Error("Expected stroke line width property");
    }
    expect(lineWidth.write.writable).toBe(true);
  });

  it("allows supported matrix-cell inspector writes for matrix of math nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of math nodes,nodes={draw}] {
    x^2 & y^2 \\
  };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const matrixCellText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.matrixCell?.cellSourceId === "node:0:0:matrix-cell:1:1"
    );
    expect(matrixCellText).toBeDefined();
    if (!matrixCellText) {
      throw new Error("Expected matrix cell text element");
    }

    const descriptor = getInspectorDescriptor(matrixCellText, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.sections.some((section) => section.id === "transform")).toBe(false);
    const strokeSection = descriptor.sections.find((section) => section.id === "stroke");
    expect(strokeSection).toBeDefined();
    if (!strokeSection) {
      throw new Error("Expected stroke section");
    }
    const strokeColor = strokeSection.properties.find((property) => property.kind === "color");
    expect(strokeColor).toBeDefined();
    if (!strokeColor || strokeColor.kind !== "color") {
      throw new Error("Expected stroke color property");
    }
    expect(strokeColor.write.writable).toBe(true);
    const lineWidth = strokeSection.properties.find((property) => property.kind === "lineWidth");
    expect(lineWidth).toBeDefined();
    if (!lineWidth || lineWidth.kind !== "lineWidth") {
      throw new Error("Expected stroke line width property");
    }
    expect(lineWidth.write.writable).toBe(true);
  });

  it("keeps plain matrix-cell inspector writes read-only", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix {
    A & B \\
  };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const matrixCellText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.matrixCell?.cellSourceId === "node:0:0:matrix-cell:1:1"
    );
    expect(matrixCellText).toBeDefined();
    if (!matrixCellText) {
      throw new Error("Expected matrix cell text element");
    }

    const descriptor = getInspectorDescriptor(matrixCellText, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.sections.some((section) => section.id === "transform")).toBe(false);
    const strokeSection = descriptor.sections.find((section) => section.id === "stroke");
    expect(strokeSection).toBeDefined();
    if (!strokeSection) {
      throw new Error("Expected stroke section");
    }
    const strokeColor = strokeSection.properties.find((property) => property.kind === "color");
    expect(strokeColor).toBeDefined();
    if (!strokeColor || strokeColor.kind !== "color") {
      throw new Error("Expected stroke color property");
    }
    expect(strokeColor.write.writable).toBe(false);
    const lineWidth = strokeSection.properties.find((property) => property.kind === "lineWidth");
    expect(lineWidth).toBeDefined();
    if (!lineWidth || lineWidth.kind !== "lineWidth") {
      throw new Error("Expected stroke line width property");
    }
    expect(lineWidth.write.writable).toBe(false);
  });
});

describe("resolvePropertyTarget – tree children", () => {
  it("resolves synthetic tree-child ids with child/node spans", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=4mm] { node[draw,fill=yellow] {left} }
    child { node {right} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leftText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left"
    );
    expect(leftText?.kind).toBe("Text");
    if (!leftText || leftText.kind !== "Text" || !leftText.treeChild) {
      throw new Error("Expected a tree child text element");
    }

    const resolved = resolvePropertyTarget(source, leftText.treeChild.childSourceId);
    expect(resolved.kind).toBe("found");
    if (resolved.kind !== "found") {
      throw new Error("Expected tree-child property target");
    }
    expect(resolved.target.kind).toBe("tree-child");
    expect(resolvePropertyTargetFromParseResult(
      source,
      parseTikz(source, { recover: true }),
      leftText.treeChild.childSourceId
    )).toMatchObject({ kind: "found", target: { kind: "tree-child" } });
    expect(resolved.target.childOperationId).toBe(leftText.treeChild.childOperationId);
    expect(resolved.target.treeChildForeach).toBe(false);
    expect(resolved.target.treeChildOptionsSpan).toBeDefined();
    expect(resolved.target.treeNodeOptionsSpan).toBeDefined();
    expect(resolved.target.textSpan).toBeDefined();
    if (resolved.target.treeChildOptionsSpan) {
      expect(source.slice(resolved.target.treeChildOptionsSpan.from, resolved.target.treeChildOptionsSpan.to)).toBe("[level distance=4mm]");
    }
    if (resolved.target.treeNodeOptionsSpan) {
      expect(source.slice(resolved.target.treeNodeOptionsSpan.from, resolved.target.treeNodeOptionsSpan.to)).toBe("[draw,fill=yellow]");
    }
    if (resolved.target.textSpan) {
      expect(source.slice(resolved.target.textSpan.from, resolved.target.textSpan.to)).toBe("left");
    }
  });

  it("marks child foreach tree children as read-only targets", () => {
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
    const resolved = resolvePropertyTarget(source, syntheticChildId);
    expect(resolved.kind).toBe("found");
    if (resolved.kind !== "found") {
      throw new Error("Expected tree-child property target");
    }
    expect(resolved.target.kind).toBe("tree-child");
    expect(resolved.target.treeChildForeach).toBe(true);
  });

  it("builds tree-child descriptors with node controls and without Transform/Child Layout", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=3mm,sibling distance=7mm] { node[draw,fill=yellow] {left} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leftText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left"
    );
    expect(leftText?.kind).toBe("Text");
    if (!leftText || leftText.kind !== "Text") {
      throw new Error("Expected tree child text element");
    }

    const descriptor = getInspectorDescriptor(leftText, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.sections.some((section) => section.id === "transform")).toBe(false);
    expect(descriptor.sections.some((section) => section.id === "tree-child-layout")).toBe(false);
    expect(descriptor.sections.some((section) => section.id === "node")).toBe(true);
    const lineWidth = descriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.kind === "lineWidth");
    expect(lineWidth?.kind).toBe("lineWidth");
    if (!lineWidth || lineWidth.kind !== "lineWidth") {
      throw new Error("Expected lineWidth property");
    }
    expect(lineWidth.write.writable).toBe(true);
  });

  it("keeps tree-child write targeting on the synthetic child id when style-chain command points at root path", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node[draw] {root}
    child { node[draw,fill=yellow] {left} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leftText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left"
    );
    expect(leftText?.kind).toBe("Text");
    if (!leftText || leftText.kind !== "Text" || !leftText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const rootText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "root"
    );
    expect(rootText?.kind).toBe("Text");
    if (!rootText || rootText.kind !== "Text") {
      throw new Error("Expected root text element");
    }
    const syntheticStyleChainElement = {
      ...leftText,
      styleChain: rootText.styleChain
    };

    const descriptor = getInspectorDescriptor(syntheticStyleChainElement, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.writeTargetId).toBe(leftText.treeChild.childSourceId);
    const writableFillProperty = descriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.kind === "color" && property.write.key === "fill");
    expect(writableFillProperty).toBeDefined();
    if (!writableFillProperty || writableFillProperty.kind !== "color") {
      throw new Error("Expected fill color property");
    }
    expect(writableFillProperty.write.elementId).toBe(leftText.treeChild.childSourceId);
    expect(writableFillProperty.write.writable).toBe(true);
  });

  it("keeps tree-child descriptors read-only for child foreach expansions", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child foreach \x in {A,B} { node[draw] {\x} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const rootText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "root"
    );
    if (!rootText || rootText.kind !== "Text") {
      throw new Error("Expected root text element");
    }

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
    const fakeTreeChildElement = {
      ...rootText,
      styleChain: [],
      sourceRef: {
        ...rootText.sourceRef,
        sourceId: syntheticChildId
      }
    };

    const descriptor = getInspectorDescriptor(fakeTreeChildElement, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.readOnlyReason).toContain("child foreach");
    expect(descriptor.sections.some((section) => section.id === "tree-child-layout")).toBe(false);
    expect(descriptor.sections.some((section) => section.id === "node")).toBe(true);
  });

  it("builds root tree descriptor with transform, layout, and node controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \path[grow=right,level distance=6mm] node[draw] {root}
    child[sibling distance=5mm] { node[fill=yellow] {left} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const rootText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "root"
    );
    expect(rootText?.kind).toBe("Text");
    if (!rootText) {
      throw new Error("Expected root tree text element");
    }

    const descriptor = buildTreeInspectorDescriptor(source, "path:0", rootText, {});
    expect(descriptor).toBeDefined();
    if (!descriptor) {
      throw new Error("Expected tree root descriptor");
    }
    expect(descriptor.sections.some((section) => section.id === "transform")).toBe(true);
    expect(descriptor.sections.some((section) => section.id === "tree-layout")).toBe(true);
    expect(descriptor.sections.some((section) => section.id === "node")).toBe(true);
  });

  it("chooses root layout write targets by existing key site with path fallback", () => {
    const source = String.raw`\begin{tikzpicture}
  \path[level distance=4mm] node[sibling distance=3mm] {root}
    child { node {left} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const rootText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "root"
    );
    expect(rootText?.kind).toBe("Text");
    if (!rootText) {
      throw new Error("Expected root tree text element");
    }

    const descriptor = buildTreeInspectorDescriptor(source, "path:0", rootText, {});
    if (!descriptor) {
      throw new Error("Expected tree root descriptor");
    }
    const treeLayout = descriptor.sections.find((section) => section.id === "tree-layout");
    expect(treeLayout).toBeDefined();
    if (!treeLayout) {
      throw new Error("Expected tree layout section");
    }
    const levelDistance = treeLayout.properties.find((property) => property.id === "tree-level-distance");
    const siblingDistance = treeLayout.properties.find((property) => property.id === "tree-sibling-distance");
    const grow = treeLayout.properties.find((property) => property.id === "tree-grow");
    expect(levelDistance?.kind).toBe("length");
    expect(siblingDistance?.kind).toBe("length");
    expect(grow?.kind).toBe("enum");
    if (!levelDistance || levelDistance.kind !== "length" || !siblingDistance || siblingDistance.kind !== "length" || !grow || grow.kind !== "enum") {
      throw new Error("Expected tree layout properties");
    }
    const nodeSection = descriptor.sections.find((section) => section.id === "node");
    expect(nodeSection).toBeDefined();
    if (!nodeSection) {
      throw new Error("Expected node section");
    }
    const nodeShape = nodeSection.properties.find((property) => property.id === "node-shape");
    expect(nodeShape?.kind).toBe("nodeShape");
    if (!nodeShape || nodeShape.kind !== "nodeShape") {
      throw new Error("Expected node shape write target");
    }

    expect(levelDistance.write.elementId).toBe("path:0");
    expect(siblingDistance.write.elementId).toBe(nodeShape.write.elementId);
    expect(grow.write.elementId).toBe("path:0");
  });

  it("builds root tree layout without a node descriptor and tolerates malformed node layout", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node[grow=,level distance=bad,sibling distance=3mm] {root}
    child { node {left} };
\end{tikzpicture}`;

    const descriptor = buildTreeInspectorDescriptor(source, "path:0", null, {});
    expect(descriptor).toBeDefined();
    if (!descriptor) {
      throw new Error("Expected tree root descriptor");
    }
    expect(descriptor.sections.some((section) => section.id === "node")).toBe(false);

    const treeLayout = descriptor.sections.find((section) => section.id === "tree-layout");
    expect(treeLayout).toBeDefined();
    if (!treeLayout) {
      throw new Error("Expected tree layout section");
    }
    const grow = treeLayout.properties.find((property) => property.id === "tree-grow");
    const levelDistance = treeLayout.properties.find((property) => property.id === "tree-level-distance");
    const siblingDistance = treeLayout.properties.find((property) => property.id === "tree-sibling-distance");
    expect(grow).toMatchObject({ kind: "enum", value: "down" });
    expect(levelDistance).toMatchObject({ kind: "length", value: 0 });
    expect(siblingDistance?.kind).toBe("length");
    if (!siblingDistance || siblingDistance.kind !== "length") {
      throw new Error("Expected sibling distance length");
    }
    expect(siblingDistance.value).toBeCloseTo(8.535827, 5);
    expect(siblingDistance.write.elementId).not.toBe("path:0");
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
