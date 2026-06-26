import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { getInspectorDescriptor, TIKZPICTURE_GLOBAL_TARGET_ID } from "../packages/core/src/edit/inspector.js";
import { resolveFigureBoundsState } from "../packages/core/src/edit/figure-bounds.js";
import { buildTransformSetPropertyMutations, resolveTransformInspectorMutationContext, resolveTransformInspectorValues } from "../packages/core/src/edit/property-write-builders.js";
import { resolvePropertyTarget } from "../packages/core/src/edit/property-target.js";

describe("getInspectorDescriptor – transform and bounds", () => {
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

  it("edits rotate around through the canonical rotate inspector field", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate around={32:(3.09,0.79)}] (2.85,1.03) rectangle (3.33,0.55);
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

    const rotate = transformSection.properties.find((property) => property.id === "rotate");
    if (!rotate || rotate.kind !== "number" || !rotate.write?.transformContext) {
      throw new Error("Expected rotate number property with transform context");
    }
    expect(rotate.label).toBe("Rotate around (3.09, 0.79)");
    expect(rotate.value).toBe(32);

    const [mutation] = buildTransformSetPropertyMutations(rotate.write.transformContext, "rotate", 10);
    expect(mutation).toBeDefined();
    if (!mutation) {
      throw new Error("Expected rotate around mutation");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: rotate.write.elementId,
      level: rotate.write.level,
      key: mutation.key,
      value: mutation.value,
      clearKeys: mutation.clearKeys
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected successful rotate around mutation");
    }

    expect(result.newSource).toContain("rotate around={10:(3.09,0.79)}");
    expect(result.newSource).not.toMatch(/,\s*rotate\s*=/);
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
});
