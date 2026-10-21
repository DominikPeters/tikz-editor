import { describe, expect, it } from "vitest";
import type { EditAction } from "../packages/core/src/edit/actions.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { TIKZPICTURE_GLOBAL_TARGET_ID, type InspectorDescriptor, type InspectorProperty, type SetPropertyWriteTarget } from "../packages/core/src/edit/inspector.js";
import { buildFillModeSetPropertyMutations } from "../packages/core/src/edit/property-write-builders.js";
import type { EditParseOptions } from "../packages/core/src/edit/parse-options.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { parseOptionListRaw } from "../packages/core/src/options/parse.js";
import type { StyleChainEntry } from "../packages/core/src/semantic/style-chain.js";
import type { ResolvedStyle } from "../packages/core/src/semantic/types.js";
import {
  buildSharedStylesCascadeModel,
  buildStylesCascadeModel,
  planStylesRemovePropertyActions,
  planStylesRenamePropertyActions,
  planStylesSetPropertyActions,
  planStylesTogglePropertyActions
} from "../packages/core/src/edit/styles-cascade.js";

function firstPath(source: string) {
  const rendered = renderTikzToSvg(source);
  const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Path");
  if (!element || element.kind !== "Path") {
    throw new Error("Expected a path element");
  }
  return { rendered, element };
}

function firstText(source: string) {
  const rendered = renderTikzToSvg(source);
  const element = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text");
  if (!element || element.kind !== "Text") {
    throw new Error("Expected a text element");
  }
  return { rendered, element };
}

function applyActionsToSource(source: string, actions: EditAction[], parseOptions?: EditParseOptions): string {
  let current = source;
  for (const action of actions) {
    const result = applyEditAction(current, [], action, parseOptions ? { parseOptions } : undefined);
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error(`Expected success, got ${result.kind}`);
    }
    current = result.newSource;
  }
  return current;
}

function commandSourceTexts(source: string): string[] {
  const { rendered, element } = firstPath(source);
  const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
  const commandSection = model.sections.find((section) => section.kind === "command");
  return (commandSection?.declarations ?? []).map((declaration) => declaration.sourceText.trim());
}

function testWriteTarget(overrides: Partial<SetPropertyWriteTarget> = {}): SetPropertyWriteTarget {
  return {
    mode: "setProperty",
    elementId: "direct-target",
    level: "command",
    key: "",
    writable: true,
    ...overrides
  };
}

function colorProperty(id: string, label: string, key: string): InspectorProperty {
  return {
    kind: "color",
    id,
    label,
    value: null,
    syntaxValue: null,
    options: [],
    write: testWriteTarget({ key })
  };
}

function directStylesModel(
  source: string,
  entryInput: Omit<StyleChainEntry, "before" | "after"> & Record<string, unknown>,
  properties: InspectorProperty[],
  descriptorInput: Partial<InspectorDescriptor> = {}
) {
  const { element } = firstPath(String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`);
  const descriptor: InspectorDescriptor = {
    elementKind: "path",
    elementId: "direct-path",
    writeTargetId: null,
    sections: [
      {
        id: "direct-section",
        title: "Direct",
        sourceLevel: "command",
        properties
      }
    ],
    ...descriptorInput
  };
  const entry = {
    ...entryInput,
    before: element.style,
    after: {
      ...element.style,
      ...entryInput.resolvedContributions
    }
  } as StyleChainEntry;
  return buildStylesCascadeModel({ ...element, styleChain: [entry] }, { source }, descriptor);
}

describe("styles cascade model", () => {
  it("orders sections from most specific to least specific and marks overridden declarations", () => {
    const source = String.raw`\begin{tikzpicture}[accent/.style={draw=red,fill=yellow}]
  \begin{scope}[draw=blue]
    \draw[accent,line width=1pt] (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });

    expect(model.sections.length).toBeGreaterThanOrEqual(3);
    expect(model.sections[0]?.kind).toBe("command");
    expect(model.sections.some((section) => section.kind === "named-style")).toBe(true);
    expect(model.sections.some((section) => section.kind === "scope")).toBe(true);

    const namedStyleSection = model.sections.find((section) => section.kind === "named-style");
    expect(namedStyleSection).toBeDefined();
    const strokeDeclaration = namedStyleSection?.declarations.find((declaration) => declaration.propertyId === "stroke-color");
    expect(strokeDeclaration?.status).toBe("active");

    const scopeSection = model.sections.find((section) => section.kind === "scope");
    expect(scopeSection).toBeDefined();
    const scopeStroke = scopeSection?.declarations.find((declaration) => declaration.propertyId === "stroke-color");
    expect(scopeStroke?.status).toBe("overridden");
  });

  it("treats matching cascades as shareable and different cascades as non-shareable", () => {
    const matchingSource = String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt] (0,0) -- (1,0);
  \draw[draw=red,line width=1pt] (0,1) -- (1,1);
\end{tikzpicture}`;
    const matchingRendered = renderTikzToSvg(matchingSource);
    const matchingPaths = matchingRendered.semantic.scene.elements.filter((entry) => entry.kind === "Path");
    expect(matchingPaths).toHaveLength(2);
    const matchingModels = matchingPaths.map((entry) =>
      buildStylesCascadeModel(entry, { source: matchingSource, editHandles: matchingRendered.semantic.editHandles })
    );
    expect(buildSharedStylesCascadeModel(matchingModels)).not.toBeNull();

    const differentSource = String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt] (0,0) -- (1,0);
  \draw[draw=blue,line width=1pt] (0,1) -- (1,1);
\end{tikzpicture}`;
    const differentRendered = renderTikzToSvg(differentSource);
    const differentPaths = differentRendered.semantic.scene.elements.filter((entry) => entry.kind === "Path");
    const differentModels = differentPaths.map((entry) =>
      buildStylesCascadeModel(entry, { source: differentSource, editHandles: differentRendered.semantic.editHandles })
    );
    expect(buildSharedStylesCascadeModel(differentModels)).toBeNull();
  });

  it("edits named-style origin layers through styles write targets", () => {
    const source = String.raw`\begin{tikzpicture}[accent/.style={draw=red}]
  \draw[accent] (0,0) -- (1,0);
\end{tikzpicture}`;

    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const namedStyleSection = model.sections.find((section) => section.kind === "named-style");
    expect(namedStyleSection).toBeDefined();
    const declaration = namedStyleSection?.declarations.find((row) => row.propertyId === "stroke-color");
    expect(declaration?.writeTargets[0]?.elementId).toContain("__style_source__:");

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: declaration!.writeTargets[0].elementId,
      level: "named-style",
      key: "draw",
      value: "blue"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected success");
    }
    expect(result.newSource).toContain("accent/.style={draw=blue}");
  });

  it("renaming a flag-style key preserves it as a flag", () => {
    const writeTarget = {
      mode: "setProperty" as const,
      elementId: "source-1",
      level: "command" as const,
      key: "",
      writable: true
    };

    const actions = planStylesRenamePropertyActions([writeTarget], "dashed", "dotted", "");
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({
      kind: "setProperty",
      key: "dashed",
      value: ""
    });
    expect(actions[1]).toMatchObject({
      kind: "setProperty",
      key: "dotted",
      value: "true"
    });
  });

  it("skips non-editable style write targets and no-op style mutations", () => {
    const writable = testWriteTarget({ elementId: "shape-1", key: "" });
    const readonly = testWriteTarget({ elementId: "shape-2", key: "", writable: false });
    const blankElement = testWriteTarget({ elementId: "   ", key: "" });

    expect(planStylesSetPropertyActions([readonly, blankElement, writable], { key: "", value: "ignored" })).toEqual([]);

    const setActions = planStylesSetPropertyActions([readonly, blankElement, writable], { key: "draw", value: "red" });
    expect(setActions).toHaveLength(1);
    expect(setActions[0]).toMatchObject({ elementId: "shape-1", key: "draw", value: "red" });

    const toggleActions = planStylesTogglePropertyActions([readonly, blankElement, writable], {
      key: "unknown custom key",
      mode: "disable",
      sourceText: "unknown custom key"
    });
    expect(toggleActions).toHaveLength(1);
    expect(toggleActions[0]).toMatchObject({ elementId: "shape-1" });
    expect(toggleActions[0]).not.toHaveProperty("propertyId");
  });

  it("merges partial shared cascade models with missing section write targets", () => {
    expect(buildSharedStylesCascadeModel([])).toBeNull();

    const signature = JSON.stringify([{ kind: "command", declarations: [] }]);
    const shared = buildSharedStylesCascadeModel([
      {
        elementKind: "path",
        elementIds: ["first"],
        comparableSignature: signature,
        sections: [
          {
            id: "section",
            kind: "command",
            title: "Command",
            subtitle: null,
            sourceLevel: "command",
            sourceLabel: null,
            sourceLocation: null,
            writable: true,
            declarations: [
              {
                id: "draw",
                propertyId: "stroke-color",
                label: "Stroke color",
                cssValue: "red",
                status: "active",
                property: null,
                sourceText: "draw=red",
                writeTargets: [testWriteTarget({ elementId: "first" })]
              }
            ],
            addableProperties: [],
            addPropertyTemplates: {},
            writeTargets: [testWriteTarget({ elementId: "first" })]
          }
        ]
      },
      {
        elementKind: "path",
        elementIds: ["second"],
        comparableSignature: signature,
        sections: []
      }
    ]);

    expect(shared?.elementIds).toEqual(["first", "second"]);
    expect(shared?.sections[0]?.writeTargets).toHaveLength(1);
    expect(shared?.sections[0]?.declarations[0]?.writeTargets).toHaveLength(1);
  });

  it("coerces raw option entries into direct style cascade declarations", () => {
    const source = "[draw=red,xshift=1.5,line width=2pt,dashed,line cap=round,line join=bevel,fill=blue,shading=axis,pattern=none,rounded corners=3pt,shape=circle]";
    const model = directStylesModel(
      source,
      {
        kind: "command",
        sourceRef: {
          sourceId: "missing-direct-command",
          sourceKind: "path-statement",
          label: "direct command",
          sourceSpan: { from: 0, to: source.length }
        },
        rawOptions: [parseOptionListRaw(source)],
        resolvedContributions: {}
      },
      [
        colorProperty("stroke-color", "Stroke color", "draw"),
        {
          kind: "number",
          id: "transform.xshift",
          label: "X shift",
          value: 0,
          step: 0.1,
          unit: "pt",
          write: testWriteTarget({ key: "xshift" })
        },
        {
          kind: "lineWidth",
          id: "line-width",
          label: "Line width",
          value: 0.4,
          min: 0.1,
          max: 6,
          step: 0.1,
          presetLabel: null,
          write: testWriteTarget({ key: "line width" })
        },
        {
          kind: "dashStyle",
          id: "dash-style",
          label: "Dash style",
          value: "solid",
          options: [],
          previewLineWidth: 0.4,
          write: testWriteTarget({ key: "solid" })
        },
        {
          kind: "lineCap",
          id: "line-cap",
          label: "Line cap",
          value: "butt",
          options: [],
          previewLineWidth: 0.4,
          write: testWriteTarget({ key: "line cap" })
        },
        {
          kind: "lineJoin",
          id: "line-join",
          label: "Line join",
          value: "miter",
          options: [],
          previewLineWidth: 0.4,
          write: testWriteTarget({ key: "line join" })
        },
        colorProperty("fill-color", "Fill color", "fill"),
        {
          kind: "fillShading",
          id: "fill-shading",
          label: "Shading",
          value: "axis",
          options: [],
          write: testWriteTarget({ key: "shading" })
        },
        {
          kind: "fillPattern",
          id: "fill-pattern",
          label: "Pattern",
          value: "dots",
          options: [],
          write: testWriteTarget({ key: "pattern" })
        },
        {
          kind: "roundedCorners",
          id: "rounded-corners",
          label: "Rounded corners",
          enabled: false,
          disableRequiresSharpCorners: true,
          radius: 4,
          defaultRadius: 4,
          min: 0,
          max: 24,
          step: 0.1,
          write: testWriteTarget({ key: "rounded corners" })
        },
        {
          kind: "nodeShape",
          id: "node-shape",
          label: "Shape",
          value: "rectangle",
          options: [],
          write: testWriteTarget({ key: "shape" })
        }
      ]
    );

    const declarations = model.sections.flatMap((section) => section.declarations);
    expect(declarations.find((declaration) => declaration.propertyId === "stroke-color")?.cssValue).toBe("red");
    expect(declarations.find((declaration) => declaration.propertyId === "transform.xshift")?.cssValue).toBe("1.5pt");
    expect(declarations.find((declaration) => declaration.propertyId === "line-width")?.cssValue).toBe("2pt");
    expect(declarations.find((declaration) => declaration.propertyId === "dash-style")?.cssValue).toBe("dashed");
    expect(declarations.find((declaration) => declaration.propertyId === "line-cap")?.cssValue).toBe("round");
    expect(declarations.find((declaration) => declaration.propertyId === "line-join")?.cssValue).toBe("bevel");
    expect(declarations.find((declaration) => declaration.propertyId === "fill-color")?.cssValue).toBe("blue");
    expect(declarations.find((declaration) => declaration.propertyId === "fill-shading")?.cssValue).toBe("axis");
    expect(declarations.find((declaration) => declaration.propertyId === "fill-pattern")?.cssValue).toBe("custom");
    expect(declarations.find((declaration) => declaration.propertyId === "rounded-corners")?.cssValue).toBe("3pt");
    expect(declarations.find((declaration) => declaration.propertyId === "node-shape")?.cssValue).toBe("circle");
  });

  it("falls back cleanly for invalid direct style cascade values", () => {
    const source = "[xshift=oops,inner sep=wide,line width=heavy,dash pattern=on 2pt off 1pt,rounded corners=false]";
    const model = directStylesModel(
      source,
      {
        kind: "command",
        sourceRef: {
          sourceId: "missing-invalid-command",
          sourceKind: "path-statement",
          sourceSpan: { from: 0, to: source.length }
        },
        rawOptions: [parseOptionListRaw(source)],
        resolvedContributions: {}
      },
      [
        {
          kind: "number",
          id: "transform.xshift",
          label: "X shift",
          value: 4,
          step: 0.1,
          unit: "pt"
        },
        {
          kind: "length",
          id: "node-inner-sep",
          label: "Inner sep",
          value: 2,
          step: 0.1,
          unit: "pt",
          write: testWriteTarget({ key: "inner sep" })
        },
        {
          kind: "lineWidth",
          id: "line-width",
          label: "Line width",
          value: 0.4,
          min: 0.1,
          max: 6,
          step: 0.1,
          presetLabel: null,
          write: testWriteTarget({ key: "line width" })
        },
        {
          kind: "dashStyle",
          id: "dash-style",
          label: "Dash style",
          value: "solid",
          options: [],
          previewLineWidth: 0.4,
          write: testWriteTarget({ key: "solid" })
        },
        {
          kind: "roundedCorners",
          id: "rounded-corners",
          label: "Rounded corners",
          enabled: true,
          disableRequiresSharpCorners: true,
          radius: 7,
          defaultRadius: 4,
          min: 0,
          max: 24,
          step: 0.1,
          write: testWriteTarget({ key: "rounded corners" })
        }
      ]
    );

    const values = Object.fromEntries(model.sections.flatMap((section) => section.declarations).map((declaration) => [declaration.propertyId, declaration.cssValue]));
    expect(values["transform.xshift"]).toBe("4pt");
    expect(values["node-inner-sep"]).toBe("2pt");
    expect(values["line-width"]).toBe("0.4pt");
    expect(values["dash-style"]).toBe("solid");
    expect(values["rounded-corners"]).toBe("false");
  });

  it.each([
    { source: "[pattern=none]", expected: "solid" },
    { source: "[pattern=north east lines]", expected: "pattern" },
    { source: "[shade]", expected: "gradient" }
  ])("coerces fill mode from $source", ({ source, expected }) => {
    const model = directStylesModel(
      source,
      {
        kind: "command",
        sourceRef: {
          sourceId: "missing-fill-mode-command",
          sourceKind: "path-statement",
          sourceSpan: { from: 0, to: source.length }
        },
        rawOptions: [parseOptionListRaw(source)],
        resolvedContributions: {}
      },
      [
        {
          kind: "fillMode",
          id: "fill-mode",
          label: "Mode",
          value: "solid",
          options: [],
          context: { fillColor: null, patternColor: null, shading: "axis", pattern: "dots" },
          write: testWriteTarget({ key: "fill" })
        }
      ]
    );

    expect(model.sections.flatMap((section) => section.declarations)[0]?.cssValue).toBe(expected);
  });

  it("falls through unsupported inspector property kinds in direct declarations", () => {
    const source = "[draw=red]";
    const model = directStylesModel(
      source,
      {
        kind: "command",
        sourceRef: {
          sourceId: "missing-text-kind-command",
          sourceKind: "path-statement",
          sourceSpan: { from: 0, to: source.length }
        },
        rawOptions: [parseOptionListRaw(source)],
        resolvedContributions: {}
      },
      [
        {
          kind: "text",
          id: "stroke-color",
          label: "Stroke label fallback",
          value: "unchanged",
          write: testWriteTarget({ key: "draw" })
        }
      ]
    );

    expect(model.sections[0]?.declarations[0]?.cssValue).toBe("Stroke label fallback");
    expect(model.sections[0]?.declarations[0]?.property).toMatchObject({ value: "unchanged" });
  });

  it.each([
    "arrowTip",
    "boolean",
    "enum",
    "fillPatternOption",
    "nodeFont",
    "nodeTextAlign",
    "optionalLength",
    "pathMorphingDecoration",
    "shadowPreset",
    "slider",
    "text"
  ])("keeps unsupported inspector kind %s as a label-only cascade declaration", (kind) => {
    const model = directStylesModel(
      "[draw=red]",
      {
        kind: "command",
        sourceRef: {
          sourceId: `missing-${kind}-command`,
          sourceKind: "path-statement",
          sourceSpan: { from: 0, to: 10 }
        },
        rawOptions: [parseOptionListRaw("[draw=red]")],
        resolvedContributions: {}
      },
      [
        {
          kind,
          id: "stroke-color",
          label: `${kind} fallback`,
          write: testWriteTarget({ key: "draw" })
        } as InspectorProperty
      ]
    );

    expect(model.sections[0]?.declarations[0]?.cssValue).toBe(`${kind} fallback`);
  });

  it("builds read-only declarations from source-less style contributions", () => {
    const model = directStylesModel(
      "",
      {
        kind: "every-shape",
        shape: "diamond",
        rawOptions: [],
        resolvedContributions: {
          lineWidth: 1.2,
          roundedCorners: 5
        }
      },
      [
        {
          kind: "lineWidth",
          id: "line-width",
          label: "Line width",
          value: 0.4,
          min: 0.1,
          max: 6,
          step: 0.1,
          presetLabel: null,
          write: testWriteTarget({ key: "line width" })
        },
        {
          kind: "roundedCorners",
          id: "rounded-corners",
          label: "Rounded corners",
          enabled: false,
          disableRequiresSharpCorners: true,
          radius: 4,
          defaultRadius: 4,
          min: 0,
          max: 24,
          step: 0.1,
          write: testWriteTarget({ key: "rounded corners" })
        }
      ]
    );

    expect(model.sections[0]?.kind).toBe("global");
    expect(model.sections[0]?.title).toBe("every diamond node");
    expect(model.sections[0]?.subtitle).toBe("diamond");
    expect(model.sections[0]?.writable).toBe(false);
    expect(model.sections[0]?.declarations.map((declaration) => declaration.cssValue)).toEqual(["1.2pt", "5pt"]);
    expect(model.sections[0]?.declarations.every((declaration) => declaration.writeTargets.length === 0)).toBe(true);
  });

  it("formats source-less contributions for paint, shading, and pattern style values", () => {
    const contributionCases: Array<{
      contribution: Partial<ResolvedStyle>;
      property: InspectorProperty;
      expected: string;
    }> = [
      {
        contribution: { stroke: "orange" },
        property: colorProperty("stroke-color", "Stroke color", "draw"),
        expected: "orange"
      },
      {
        contribution: { fill: "teal" },
        property: colorProperty("fill-color", "Fill color", "fill"),
        expected: "teal"
      },
      {
        contribution: { textColor: "purple" },
        property: colorProperty("node-text-color", "Text color", "text"),
        expected: "purple"
      },
      {
        contribution: { lineCap: "rect" } as unknown as Partial<ResolvedStyle>,
        property: {
          kind: "lineCap",
          id: "line-cap",
          label: "Line cap",
          value: "butt",
          options: [],
          previewLineWidth: 0.4,
          write: testWriteTarget({ key: "line cap" })
        },
        expected: "rect"
      },
      {
        contribution: { lineJoin: "round" },
        property: {
          kind: "lineJoin",
          id: "line-join",
          label: "Line join",
          value: "miter",
          options: [],
          previewLineWidth: 0.4,
          write: testWriteTarget({ key: "line join" })
        },
        expected: "round"
      },
      {
        contribution: { fillPattern: { kind: "Lines" } } as unknown as Partial<ResolvedStyle>,
        property: {
          kind: "fillMode",
          id: "fill-mode",
          label: "Mode",
          value: "solid",
          options: [],
          context: { fillColor: null, patternColor: null, shading: "axis", pattern: "dots" },
          write: testWriteTarget({ key: "fill" })
        },
        expected: "pattern"
      },
      {
        contribution: { shadeEnabled: true },
        property: {
          kind: "fillMode",
          id: "fill-mode",
          label: "Mode",
          value: "solid",
          options: [],
          context: { fillColor: null, patternColor: null, shading: "axis", pattern: "dots" },
          write: testWriteTarget({ key: "fill" })
        },
        expected: "gradient"
      },
      {
        contribution: { shading: "axis" },
        property: {
          kind: "fillShading",
          id: "fill-shading",
          label: "Shading",
          value: "axis",
          options: [],
          write: testWriteTarget({ key: "shading" })
        },
        expected: "axis"
      },
      {
        contribution: { patternColor: "cyan" },
        property: colorProperty("fill-pattern-color", "Pattern color", "pattern color"),
        expected: "cyan"
      },
      {
        contribution: { axisTopColor: "red" },
        property: colorProperty("fill-axis-top-color", "Top color", "top color"),
        expected: "red"
      },
      {
        contribution: { axisBottomColor: "blue" },
        property: colorProperty("fill-axis-bottom-color", "Bottom color", "bottom color"),
        expected: "blue"
      },
      {
        contribution: { radialInnerColor: "white" },
        property: colorProperty("fill-radial-inner-color", "Inner color", "inner color"),
        expected: "white"
      },
      {
        contribution: { radialOuterColor: "black" },
        property: colorProperty("fill-radial-outer-color", "Outer color", "outer color"),
        expected: "black"
      },
      {
        contribution: { ballColor: "green" },
        property: colorProperty("fill-ball-color", "Ball color", "ball color"),
        expected: "green"
      }
    ];

    for (const { contribution, property, expected } of contributionCases) {
      const model = directStylesModel(
        "",
        {
          kind: "global",
          rawOptions: [],
          resolvedContributions: contribution
        },
        [property]
      );
      expect(model.sections[0]?.declarations[0]?.cssValue).toBe(expected);
      if (property.kind === "lineCap" && expected === "rect") {
        expect(model.sections[0]?.declarations[0]?.property).toMatchObject({ kind: "lineCap", value: "custom" });
      }
    }
  });

  it("keeps default and built-in style layers read-only", () => {
    const model = directStylesModel(
      "[draw=black]",
      {
        kind: "command",
        sourceRef: {
          sourceId: "default-style",
          sourceKind: "builtin-style",
          label: "help lines",
          sourceSpan: { from: 0, to: 12 }
        },
        rawOptions: [parseOptionListRaw("[draw=black]")],
        resolvedContributions: {}
      },
      [colorProperty("stroke-color", "Stroke color", "draw")]
    );

    expect(model.sections[0]?.kind).toBe("default");
    expect(model.sections[0]?.title).toBe("help lines");
    expect(model.sections[0]?.writable).toBe(false);
    expect(model.sections[0]?.readOnlyReason).toContain("default style layer");
    expect(model.sections[0]?.declarations[0]?.status).toBe("active");
    expect(model.sections[0]?.declarations[0]?.writeTargets).toHaveLength(0);

    const fallbackTitleModel = directStylesModel(
      "[draw=black]",
      {
        kind: "command",
        sourceRef: {
          sourceId: "builtin-without-label",
          sourceKind: "builtin-style",
          sourceSpan: { from: 0, to: 12 }
        },
        rawOptions: [parseOptionListRaw("[draw=black]")],
        resolvedContributions: {}
      },
      [colorProperty("stroke-color", "Stroke color", "draw")]
    );
    expect(fallbackTitleModel.sections[0]?.title).toBe("Built-in style");
  });

  it("keeps command and global default style layers read-only", () => {
    const defaults = [
      { sourceKind: "command-default", expectedTitle: "TikZ defaults" },
      { sourceKind: "global-default", expectedTitle: "TikZ defaults" }
    ];

    for (const { sourceKind, expectedTitle } of defaults) {
      const model = directStylesModel(
        "[draw=black]",
        {
          kind: "command",
          sourceRef: {
            sourceId: `${sourceKind}-style`,
            sourceKind,
            sourceSpan: { from: 0, to: 12 }
          },
          rawOptions: [parseOptionListRaw("[draw=black]")],
          resolvedContributions: {}
        },
        [colorProperty("stroke-color", "Stroke color", "draw")]
      );
      expect(model.sections[0]?.kind).toBe("default");
      expect(model.sections[0]?.title).toBe(expectedTitle);
      expect(model.sections[0]?.writable).toBe(false);
    }
  });

  it("surfaces disabled declarations nested inside style definitions", () => {
    const source = "[accent/.style={\n  % draw=red,\n  fill=blue,\n  % unknown option,\n}]";
    const model = directStylesModel(
      source,
      {
        kind: "global",
        sourceRef: {
          sourceId: TIKZPICTURE_GLOBAL_TARGET_ID,
          sourceKind: "tikzpicture-options",
          sourceSpan: { from: 0, to: source.length }
        },
        rawOptions: [parseOptionListRaw(source)],
        resolvedContributions: {}
      },
      [
        colorProperty("stroke-color", "Stroke color", "draw"),
        colorProperty("fill-color", "Fill color", "fill")
      ]
    );

    const declarations = model.sections.flatMap((section) => section.declarations);
    expect(declarations.find((declaration) => declaration.propertyId === "stroke-color")?.status).toBe("disabled");
    expect(declarations.find((declaration) => declaration.propertyId === null && declaration.status === "disabled")?.sourceText).toBe("unknown option");
  });

  it("surfaces unknown and CRLF-commented disabled options", () => {
    const unknownModel = directStylesModel(
      "[???]",
      {
        kind: "command",
        sourceRef: {
          sourceId: "missing-unknown-command",
          sourceKind: "path-statement",
          sourceSpan: { from: 0, to: 5 }
        },
        rawOptions: [parseOptionListRaw("[???]")],
        resolvedContributions: {}
      },
      []
    );
    expect(unknownModel.sections[0]?.declarations[0]).toMatchObject({
      propertyId: null,
      label: "???",
      cssValue: ""
    });

    const commentedSource = "[\r\n% foo=bar,\r\n% draw=red,\r\n]";
    const commentedModel = directStylesModel(
      commentedSource,
      {
        kind: "command",
        sourceRef: {
          sourceId: "missing-commented-command",
          sourceKind: "path-statement",
          sourceSpan: { from: 0, to: commentedSource.length }
        },
        rawOptions: [parseOptionListRaw(commentedSource)],
        resolvedContributions: {}
      },
      [colorProperty("stroke-color", "Stroke color", "draw")]
    );
    const disabled = commentedModel.sections[0]?.declarations.filter((declaration) => declaration.status === "disabled");
    expect(disabled?.map((declaration) => declaration.sourceText)).toEqual(["foo=bar", "draw=red"]);
  });

  it("ignores malformed nested style definition spans", () => {
    const malformedStyleEntry = {
      kind: "kv" as const,
      key: "accent/.style",
      valueRaw: "",
      span: { from: 1, to: 14 },
      keySpan: { from: 1, to: 14 },
      valueSpan: null,
      raw: "accent/.style"
    };
    const model = directStylesModel(
      "[accent/.style]",
      {
        kind: "global",
        sourceRef: {
          sourceId: TIKZPICTURE_GLOBAL_TARGET_ID,
          sourceKind: "tikzpicture-options",
          sourceSpan: { from: 0, to: 15 }
        },
        rawOptions: [
          {
            span: { from: 0, to: 15 },
            raw: "[accent/.style]",
            entries: [malformedStyleEntry]
          }
        ],
        resolvedContributions: {}
      },
      [colorProperty("stroke-color", "Stroke color", "draw")]
    );

    expect(model.sections).toHaveLength(0);
  });

  it("handles whitespace and bracketed style definition value spans", () => {
    const whitespaceSource = "[accent/.style=   ]";
    const whitespaceModel = directStylesModel(
      whitespaceSource,
      {
        kind: "global",
        sourceRef: {
          sourceId: TIKZPICTURE_GLOBAL_TARGET_ID,
          sourceKind: "tikzpicture-options",
          sourceSpan: { from: 0, to: whitespaceSource.length }
        },
        rawOptions: [parseOptionListRaw(whitespaceSource)],
        resolvedContributions: {}
      },
      [colorProperty("stroke-color", "Stroke color", "draw")]
    );
    expect(whitespaceModel.sections).toHaveLength(0);

    const bracketSource = "[accent/.style=[\r\n% draw=red,\r\n]]";
    const bracketModel = directStylesModel(
      bracketSource,
      {
        kind: "global",
        sourceRef: {
          sourceId: TIKZPICTURE_GLOBAL_TARGET_ID,
          sourceKind: "tikzpicture-options",
          sourceSpan: { from: 0, to: bracketSource.length }
        },
        rawOptions: [parseOptionListRaw(bracketSource)],
        resolvedContributions: {}
      },
      [colorProperty("stroke-color", "Stroke color", "draw")]
    );
    expect(bracketModel.sections[0]?.declarations[0]).toMatchObject({
      propertyId: "stroke-color",
      status: "disabled",
      sourceText: "draw=red"
    });
  });

  it("uses style source target ids for global and named style layers", () => {
    const globalModel = directStylesModel(
      "[draw=black]",
      {
        kind: "global",
        sourceRef: {
          sourceId: TIKZPICTURE_GLOBAL_TARGET_ID,
          sourceKind: "tikzpicture-options",
          sourceSpan: { from: 0, to: 12 }
        },
        rawOptions: [parseOptionListRaw("[draw=black]")],
        resolvedContributions: {}
      },
      [colorProperty("stroke-color", "Stroke color", "draw")]
    );
    expect(globalModel.sections[0]?.kind).toBe("global");

    const namedSource = "[accent/.style={draw=red}]";
    const namedModel = directStylesModel(
      namedSource,
      {
        kind: "named-style",
        styleName: "accent",
        sourceRef: {
          sourceId: "style-ref-with-span",
          sourceKind: "style-definition",
          sourceSpan: { from: 0, to: namedSource.length }
        },
        rawOptions: [parseOptionListRaw(namedSource)],
        resolvedContributions: { stroke: "red" }
      },
      [colorProperty("stroke-color", "Stroke color", "draw")]
    );
    expect(namedModel.sections[0]?.kind).toBe("named-style");
    expect(namedModel.sections[0]?.subtitle).toBe(".accent");
    expect(namedModel.sections[0]?.sourceLocation).toBe("line 1");
  });

  it("keeps generated foreach identity targets read-only when no template target is available", () => {
    const directIdentityModel = directStylesModel(
      "[draw=red]",
      {
        kind: "command",
        sourceRef: {
          sourceId: "foreach:expanded-node",
          sourceKind: "path-statement",
          sourceSpan: { from: 0, to: 10 },
          identityRef: {
            sourceId: "foreach:expanded-node",
            sourceKind: "path-statement"
          }
        },
        rawOptions: [parseOptionListRaw("[draw=red]")],
        resolvedContributions: {}
      },
      [colorProperty("stroke-color", "Stroke color", "draw")]
    );
    expect(directIdentityModel.sections[0]?.readOnlyReason).toContain("Generated style layers");

    const generatedIdentityModel = directStylesModel(
      "[draw=red]",
      {
        kind: "command",
        sourceRef: {
          sourceId: "generated-node",
          sourceKind: "path-statement",
          sourceSpan: { from: 0, to: 10 },
          identityRef: {
            sourceId: "source-node",
            sourceKind: "path-statement"
          }
        },
        rawOptions: [parseOptionListRaw("[draw=red]")],
        resolvedContributions: {}
      },
      [colorProperty("stroke-color", "Stroke color", "draw")]
    );
    expect(generatedIdentityModel.sections[0]?.readOnlyReason).toContain("Generated style layers");
  });
});

describe("styles cascade integration edits", () => {
  it("renames a flag option from dashed to dotted", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[dashed,draw=red] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const declaration = model.sections.flatMap((s) => s.declarations).find((d) => d.sourceText.trim() === "dashed");
    expect(declaration).toBeDefined();

    const updated = applyActionsToSource(
      source,
      planStylesRenamePropertyActions(declaration!.writeTargets, "dashed", "dotted", "")
    );

    expect(updated).toContain("dotted");
    expect(updated).toContain("draw=red");
    expect(updated).not.toContain("dashed");
  });

  it("renames key-value draw=red to fill=red while preserving value", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const declaration = model.sections.flatMap((s) => s.declarations).find((d) => d.sourceText.includes("draw=red"));
    expect(declaration).toBeDefined();

    const updated = applyActionsToSource(
      source,
      planStylesRenamePropertyActions(declaration!.writeTargets, "draw", "fill", "red")
    );

    expect(updated).toContain("fill=red");
    expect(updated).not.toContain("draw=red");
    expect(updated).toContain("line width=1pt");
  });

  it("removes draw=red without disturbing other options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt,dashed] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const declaration = model.sections.flatMap((s) => s.declarations).find((d) => d.sourceText.includes("draw=red"));
    expect(declaration).toBeDefined();

    const updated = applyActionsToSource(source, planStylesRemovePropertyActions(declaration!.writeTargets, "draw"));

    expect(updated).not.toContain("draw=red");
    expect(updated).toContain("line width=1pt");
    expect(updated).toContain("dashed");
  });

  it("toggles a declaration off by serializing it as a commented option line", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const declaration = model.sections.flatMap((section) => section.declarations).find((row) => row.sourceText.includes("draw=red"));
    expect(declaration).toBeDefined();

    const updated = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(declaration!.writeTargets, {
        key: "draw",
        mode: "disable",
        sourceText: declaration!.sourceText
      })
    );

    expect(updated).toContain("% draw=red,");
    expect(updated).toContain("line width=1pt");
    expect(updated).toContain("\\draw[\n  % draw=red,\n  line width=1pt\n]");
    expect(updated).toContain("\\draw[");
  });

  it("toggles a commented declaration back on", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[
    % draw=red,
    line width=1pt
  ] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const declaration = model.sections.flatMap((section) => section.declarations).find((row) => row.propertyId === "stroke-color");
    expect(declaration).toBeDefined();
    expect(declaration?.status).toBe("disabled");

    const updated = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(declaration!.writeTargets, {
        key: "draw",
        mode: "enable",
        sourceText: declaration!.sourceText
      })
    );

    expect(updated).toContain("draw=red");
    expect(updated).not.toContain("% draw=red,");
    expect(updated).toContain("line width=1pt");
  });

  it("toggles declarations inside named-style bodies", () => {
    const source = String.raw`\begin{tikzpicture}[accent/.style={draw=red,fill=blue}]
  \draw[accent] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const namedStyleSection = model.sections.find((section) => section.kind === "named-style");
    const declaration = namedStyleSection?.declarations.find((row) => row.propertyId === "stroke-color");
    expect(declaration).toBeDefined();

    const updated = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(declaration!.writeTargets, {
        key: "draw",
        mode: "disable",
        sourceText: declaration!.sourceText
      })
    );

    expect(updated).toContain("% draw=red,");
    expect(updated).toContain("fill=blue");
    expect(updated).toContain("accent/.style={");
  });

  it("toggles fill declarations inside every node style layers", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \node (A) at (-1, -1) {A};
\end{tikzpicture}`;
    const { rendered, element } = firstText(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const everyNodeSection = model.sections.find((section) => section.title === "every node");
    const fillDeclaration = everyNodeSection?.declarations.find((row) => row.propertyId === "fill-color");
    expect(fillDeclaration).toBeDefined();

    const disabled = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(fillDeclaration!.writeTargets, {
        key: "fill",
        mode: "disable",
        sourceText: fillDeclaration!.sourceText
      })
    );

    expect(disabled).toContain("every node/.style={");
    expect(disabled).toContain("% fill=blue!10,");
    expect(disabled).toContain("every node/.style={\n  % fill=blue!10,\n}");

    const { rendered: disabledRendered, element: disabledElement } = firstText(disabled);
    const disabledModel = buildStylesCascadeModel(disabledElement, {
      source: disabled,
      editHandles: disabledRendered.semantic.editHandles
    });
    const disabledFill = disabledModel.sections
      .flatMap((section) => section.declarations)
      .find((row) => row.propertyId === "fill-color" && row.status === "disabled");
    expect(disabledFill).toBeDefined();
  });

  it("preserves existing multiline option indentation when toggling", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[
    draw=red,
    line width=1pt
  ] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const drawDeclaration = model.sections.flatMap((section) => section.declarations).find((row) => row.propertyId === "stroke-color");
    expect(drawDeclaration).toBeDefined();

    const disabled = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(drawDeclaration!.writeTargets, {
        key: "draw",
        mode: "disable",
        sourceText: drawDeclaration!.sourceText
      })
    );

    expect(disabled).toContain("\\draw[\n    % draw=red,\n    line width=1pt\n]");
  });

  it("uses configured indent size when reflowing single-line toggles", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const drawDeclaration = model.sections.flatMap((section) => section.declarations).find((row) => row.propertyId === "stroke-color");
    expect(drawDeclaration).toBeDefined();

    const disabled = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(drawDeclaration!.writeTargets, {
        key: "draw",
        mode: "disable",
        sourceText: drawDeclaration!.sourceText
      }),
      { indentSize: 4 }
    );

    expect(disabled).toContain("\\draw[\n    % draw=red,\n    line width=1pt\n]");
  });

  it("toggles fill declarations inside every-shape style layers", () => {
    const source = String.raw`\begin{tikzpicture}[every rectangle node/.style={fill=green!20}]
  \node[rectangle] (R) at (0, 0) {R};
\end{tikzpicture}`;
    const { rendered, element } = firstText(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const everyRectangleSection = model.sections.find((section) => section.title === "every rectangle node");
    const fillDeclaration = everyRectangleSection?.declarations.find((row) => row.propertyId === "fill-color");
    expect(fillDeclaration).toBeDefined();

    const disabled = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(fillDeclaration!.writeTargets, {
        key: "fill",
        mode: "disable",
        sourceText: fillDeclaration!.sourceText
      })
    );

    expect(disabled).toContain("every rectangle node/.style={");
    expect(disabled).toContain("% fill=green!20,");
  });

  it("toggles fill declarations inside scope layers", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[fill=yellow!30]
    \node (S) at (0,0) {S};
  \end{scope}
\end{tikzpicture}`;
    const { rendered, element } = firstText(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const scopeSection = model.sections.find((section) => section.kind === "scope");
    const fillDeclaration = scopeSection?.declarations.find((row) => row.propertyId === "fill-color");
    expect(fillDeclaration).toBeDefined();

    const disabled = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(fillDeclaration!.writeTargets, {
        key: "fill",
        mode: "disable",
        sourceText: fillDeclaration!.sourceText
      })
    );

    expect(disabled).toContain("\\begin{scope}[");
    expect(disabled).toContain("% fill=yellow!30,");
  });

  it.each([
    {
      placement: "first",
      source: String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt,dashed] (0,0) -- (1,0);
\end{tikzpicture}`,
      before: ["% draw=red,", "line width=1pt", "dashed"]
    },
    {
      placement: "middle",
      source: String.raw`\begin{tikzpicture}
  \draw[line width=1pt,draw=red,dashed] (0,0) -- (1,0);
\end{tikzpicture}`,
      before: ["line width=1pt", "% draw=red,", "dashed"]
    },
    {
      placement: "last",
      source: String.raw`\begin{tikzpicture}
  \draw[line width=1pt,dashed,draw=red] (0,0) -- (1,0);
\end{tikzpicture}`,
      before: ["line width=1pt", "dashed", "% draw=red,"]
    },
    {
      placement: "only",
      source: String.raw`\begin{tikzpicture}
  \draw[draw=red] (0,0) -- (1,0);
\end{tikzpicture}`,
      before: ["% draw=red,"]
    }
  ])("toggles key-value declarations in $placement position", ({ source, before }) => {
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const declaration = model.sections.flatMap((section) => section.declarations).find((row) => row.sourceText.includes("draw=red"));
    expect(declaration).toBeDefined();

    const disabledSource = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(declaration!.writeTargets, {
        key: "draw",
        mode: "disable",
        sourceText: declaration!.sourceText
      })
    );
    expect(disabledSource).toContain("% draw=red,");

    const indexes = before.map((token) => disabledSource.indexOf(token));
    for (const index of indexes) {
      expect(index).toBeGreaterThanOrEqual(0);
    }
    for (let index = 1; index < indexes.length; index += 1) {
      expect(indexes[index]).toBeGreaterThan(indexes[index - 1]);
    }

    const { rendered: disabledRendered, element: disabledElement } = firstPath(disabledSource);
    const disabledModel = buildStylesCascadeModel(disabledElement, {
      source: disabledSource,
      editHandles: disabledRendered.semantic.editHandles
    });
    const disabledDeclaration = disabledModel.sections
      .flatMap((section) => section.declarations)
      .find((row) => row.propertyId === "stroke-color" && row.status === "disabled");
    expect(disabledDeclaration).toBeDefined();

    const reenabledSource = applyActionsToSource(
      disabledSource,
      planStylesTogglePropertyActions(disabledDeclaration!.writeTargets, {
        key: "draw",
        mode: "enable",
        sourceText: disabledDeclaration!.sourceText
      })
    );

    expect(reenabledSource).not.toContain("% draw=red,");
    expect(reenabledSource).toContain("draw=red");
  });

  it("toggles flag-like options (draw, rounded corners) without values", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw,rounded corners,line width=1pt] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const drawFlag = model.sections.flatMap((section) => section.declarations).find((row) => row.sourceText.trim() === "draw");
    const roundedCornersFlag = model.sections
      .flatMap((section) => section.declarations)
      .find((row) => row.sourceText.trim() === "rounded corners");
    expect(drawFlag).toBeDefined();
    expect(roundedCornersFlag).toBeDefined();

    const disabled = applyActionsToSource(
      source,
      [
        ...planStylesTogglePropertyActions(drawFlag!.writeTargets, {
          key: "draw",
          mode: "disable",
          sourceText: drawFlag!.sourceText
        }),
        ...planStylesTogglePropertyActions(roundedCornersFlag!.writeTargets, {
          key: "rounded corners",
          mode: "disable",
          sourceText: roundedCornersFlag!.sourceText
        })
      ]
    );

    expect(disabled).toContain("% draw,");
    expect(disabled).toContain("% rounded corners,");
    expect(disabled).toContain("line width=1pt");

    const { rendered: disabledRendered, element: disabledElement } = firstPath(disabled);
    const disabledModel = buildStylesCascadeModel(disabledElement, {
      source: disabled,
      editHandles: disabledRendered.semantic.editHandles
    });
    const disabledDraw = disabledModel.sections
      .flatMap((section) => section.declarations)
      .find((row) => row.sourceText.trim() === "draw" && row.status === "disabled");
    const disabledRoundedCorners = disabledModel.sections
      .flatMap((section) => section.declarations)
      .find((row) => row.sourceText.trim() === "rounded corners" && row.status === "disabled");
    expect(disabledDraw).toBeDefined();
    expect(disabledRoundedCorners).toBeDefined();
  });

  it("toggles node option declarations (text element selection)", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,rounded corners,font=\small] at (0,0) {A};
\end{tikzpicture}`;
    const { rendered, element } = firstText(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const declaration = model.sections
      .flatMap((section) => section.declarations)
      .find((row) => row.sourceText.trim() === "rounded corners");
    expect(declaration).toBeDefined();

    const disabled = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(declaration!.writeTargets, {
        key: "rounded corners",
        mode: "disable",
        sourceText: declaration!.sourceText
      })
    );

    expect(disabled).toContain("% rounded corners,");
    expect(disabled).toContain("draw,");
    expect(disabled).toContain("font=\\small");
  });

  it("surfaces commented-only node options as disabled declarations", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[
    % draw=red,
  ] at (-0.2,3) {node};
\end{tikzpicture}`;
    const { rendered, element } = firstText(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const commandSection = model.sections.find((section) => section.kind === "command");
    const drawDeclaration = commandSection?.declarations.find(
      (row) => row.sourceText.trim() === "draw=red" && row.status === "disabled"
    );
    expect(drawDeclaration).toBeDefined();
  });

  it("preserves duplicate keys by only disabling the targeted declaration", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red,draw=blue,line width=1pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const declaration = model.sections.flatMap((section) => section.declarations).find((row) => row.sourceText.trim() === "draw=red");
    expect(declaration).toBeDefined();

    const disabled = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(declaration!.writeTargets, {
        key: "draw",
        mode: "disable",
        sourceText: declaration!.sourceText
      })
    );

    expect(disabled).toContain("% draw=red,");
    expect(disabled).toContain("draw=blue");
    expect(disabled).toContain("line width=1pt");

    const { rendered: disabledRendered, element: disabledElement } = firstPath(disabled);
    const disabledModel = buildStylesCascadeModel(disabledElement, {
      source: disabled,
      editHandles: disabledRendered.semantic.editHandles
    });
    const commandSection = disabledModel.sections.find((section) => section.kind === "command");
    const strokeDeclarations = (commandSection?.declarations ?? []).filter((row) => row.propertyId === "stroke-color");
    expect(strokeDeclarations.some((row) => row.status === "disabled")).toBe(true);
    expect(strokeDeclarations.some((row) => row.status === "active")).toBe(true);
  });

  it("keeps command declaration order stable when toggling a middle property", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red,rounded corners,line width=1pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const orderBefore = commandSourceTexts(source);
    expect(orderBefore).toEqual(["draw=red", "rounded corners", "line width=1pt"]);

    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const roundedCorners = model.sections
      .flatMap((section) => section.declarations)
      .find((row) => row.sourceText.trim() === "rounded corners");
    expect(roundedCorners).toBeDefined();

    const disabled = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(roundedCorners!.writeTargets, {
        key: "rounded corners",
        mode: "disable",
        sourceText: roundedCorners!.sourceText
      })
    );
    const orderAfterDisable = commandSourceTexts(disabled);
    expect(orderAfterDisable).toEqual(["draw=red", "rounded corners", "line width=1pt"]);
  });

  it("surfaces disabled declarations and keeps lower layers active", () => {
    const source = String.raw`\begin{tikzpicture}[draw=blue]
  \draw[
    % draw=red,
    line width=1pt
  ] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const commandSection = model.sections.find((section) => section.kind === "command");
    const commandStroke = commandSection?.declarations.find((row) => row.propertyId === "stroke-color");
    expect(commandStroke).toBeDefined();
    expect(commandStroke?.status).toBe("disabled");

    const inheritedStroke = model.sections
      .filter((section) => section.kind !== "command")
      .flatMap((section) => section.declarations)
      .find((row) => row.propertyId === "stroke-color");
    expect(inheritedStroke).toBeDefined();
    expect(inheritedStroke?.status).toBe("active");
  });

  it("renames unsupported raw options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[foo=bar,draw=red] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const rawDecl = model.sections.flatMap((s) => s.declarations).find((d) => d.sourceText.includes("foo=bar"));
    expect(rawDecl).toBeDefined();

    const updated = applyActionsToSource(
      source,
      planStylesRenamePropertyActions(rawDecl!.writeTargets, "foo", "baz", "bar")
    );

    expect(updated).toContain("baz=bar");
    expect(updated).not.toContain("foo=bar");
  });

  it("deletes unsupported raw options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[foo=bar,draw=red] (0,0) -- (1,0);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const rawDecl = model.sections.flatMap((s) => s.declarations).find((d) => d.sourceText.includes("foo=bar"));
    expect(rawDecl).toBeDefined();

    const updated = applyActionsToSource(source, planStylesRemovePropertyActions(rawDecl!.writeTargets, "foo"));

    expect(updated).not.toContain("foo=bar");
    expect(updated).toContain("draw=red");
  });

  it("applies fill-mode transitions with clear keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=blue,pattern=north east lines] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const { rendered, element } = firstPath(source);
    const model = buildStylesCascadeModel(element, { source, editHandles: rendered.semantic.editHandles });
    const commandSection = model.sections.find((s) => s.kind === "command");
    expect(commandSection).toBeDefined();

    const mutations = buildFillModeSetPropertyMutations("gradient", {});
    const actions = mutations.flatMap((mutation) =>
      planStylesSetPropertyActions(commandSection!.writeTargets, mutation)
    );

    const updated = applyActionsToSource(source, actions);

    expect(updated).toContain("shade");
    expect(updated).toContain("shading=");
    expect(updated).not.toContain("pattern=north east lines");
  });

  it("builds add-property fill-mode templates from patterned and shaded styles", () => {
    const patternedSource = String.raw`\begin{tikzpicture}
  \draw[pattern=north east lines] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const { rendered: patternedRendered, element: patternedElement } = firstPath(patternedSource);
    const patternedModel = buildStylesCascadeModel(patternedElement, {
      source: patternedSource,
      editHandles: patternedRendered.semantic.editHandles
    });
    expect(patternedModel.sections[0]?.addPropertyTemplates["fill-mode"]).toMatchObject({
      kind: "fillMode",
      value: "pattern"
    });

    const shadedSource = String.raw`\begin{tikzpicture}
  \draw[shade] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const { rendered: shadedRendered, element: shadedElement } = firstPath(shadedSource);
    const shadedModel = buildStylesCascadeModel(shadedElement, {
      source: shadedSource,
      editHandles: shadedRendered.semantic.editHandles
    });
    expect(shadedModel.sections[0]?.addPropertyTemplates["fill-mode"]).toMatchObject({
      kind: "fillMode",
      value: "gradient"
    });
  });

  it("applies shared-cascade edits to all selected elements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[dashed,draw=red] (0,0) -- (1,0);
  \draw[dashed,draw=red] (0,1) -- (1,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const paths = rendered.semantic.scene.elements.filter((entry) => entry.kind === "Path");
    expect(paths).toHaveLength(2);
    const models = paths.map((entry) =>
      buildStylesCascadeModel(entry, { source, editHandles: rendered.semantic.editHandles })
    );
    const shared = buildSharedStylesCascadeModel(models);
    expect(shared).not.toBeNull();

    const dashedDecl = shared!.sections.flatMap((s) => s.declarations).find((d) => d.sourceText.trim() === "dashed");
    expect(dashedDecl).toBeDefined();
    expect(dashedDecl!.writeTargets).toHaveLength(2);

    const updated = applyActionsToSource(
      source,
      planStylesRenamePropertyActions(dashedDecl!.writeTargets, "dashed", "dotted", "")
    );

    expect(updated).not.toContain("dashed");
    expect((updated.match(/dotted/g) ?? []).length).toBe(2);
  });

  it("applies shared-cascade toggle edits to all selected elements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt] (0,0) -- (1,0);
  \draw[draw=red,line width=1pt] (0,1) -- (1,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const paths = rendered.semantic.scene.elements.filter((entry) => entry.kind === "Path");
    expect(paths).toHaveLength(2);
    const models = paths.map((entry) =>
      buildStylesCascadeModel(entry, { source, editHandles: rendered.semantic.editHandles })
    );
    const shared = buildSharedStylesCascadeModel(models);
    expect(shared).not.toBeNull();

    const drawDecl = shared!.sections.flatMap((section) => section.declarations).find((row) => row.propertyId === "stroke-color");
    expect(drawDecl).toBeDefined();
    expect(drawDecl!.writeTargets).toHaveLength(2);

    const updated = applyActionsToSource(
      source,
      planStylesTogglePropertyActions(drawDecl!.writeTargets, {
        key: "draw",
        mode: "disable",
        sourceText: drawDecl!.sourceText
      })
    );

    expect((updated.match(/% draw=red,/g) ?? []).length).toBe(2);
  });

  it("keeps generated node foreach style layers read-only", () => {
    const source = String.raw`\begin{tikzpicture}
  \path (0,0) node foreach \p in {0.25,0.75} [pos=\p,fill=red] {\p};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const text = rendered.semantic.scene.elements.find((entry) => entry.kind === "Text" && entry.text === "0.25");
    expect(text).toBeDefined();
    if (!text) {
      throw new Error("Expected generated node foreach text");
    }

    const model = buildStylesCascadeModel(text, { source, editHandles: rendered.semantic.editHandles });
    const command = model.sections.find((section) => section.kind === "command");
    expect(command?.writable).toBe(false);
    expect(command?.readOnlyReason).toContain("Generated style layers");
    const fill = command?.declarations.find((declaration) => declaration.propertyId === "fill-color");
    expect(fill?.sourceText).toBe("fill=red");
    expect(fill?.writeTargets).toHaveLength(0);
  });
});
