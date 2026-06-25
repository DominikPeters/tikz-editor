import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import {
  dashStylePresetFromStyle,
  fillPatternPresetFromRaw,
  fillPatternPresetFromResolvedPattern,
  fillShadingPresetFromStyleName,
  getInspectorDescriptor,
  lineCapPresetFromStyle,
  lineJoinPresetFromStyle,
  lineWidthPresetLabel
} from "../packages/core/src/edit/inspector.js";
import {
  buildArrowTipSetPropertyMutation,
  buildFillModeSetPropertyMutations,
  buildFillPatternOptionSetPropertyMutation,
  buildFillPatternSetPropertyMutation,
  buildFillShadingSetPropertyMutations,
  buildPathMorphingDecorationSetPropertyMutations,
  buildRoundedCornersSetPropertyMutation,
  buildShadowMutationContextForPreset,
  buildShadowSetPropertyMutations
} from "../packages/core/src/edit/property-write-builders.js";

describe("getInspectorDescriptor – path controls", () => {
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
});
