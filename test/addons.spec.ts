import { describe, expect, it } from "vitest";

import type { AddonEngine, AddonRegistration } from "@tikz-editor/addon-api";
import { parseTikz } from "@tikz-editor/core/parser/index.js";
import { createAddonRuntime } from "@tikz-editor/core/addons/runtime.js";
import { toAddonHandleView } from "@tikz-editor/core/addons/edit-context.js";
import { applyEditAction } from "@tikz-editor/core/edit/actions.js";
import { renderTikzToSvg } from "@tikz-editor/core/render/index.js";
import { collectGeometryInvalidation } from "@tikz-editor/core/semantic/dependencies.js";
import { createSmileyAddon } from "./helpers/smiley-addon.js";

function createProbeEngine(): AddonEngine {
  return {
    manifest: {
      id: "probe",
      version: "0.0.1",
      apiVersion: "^0.1.0",
      displayName: "Probe",
      license: "MIT",
      sourceUrl: "https://example.invalid/probe",
      triggers: { commands: ["\\probe"] },
      entries: { engine: "./engine.js" }
    },
    parseCommand: (statement, context) => {
      const args = context.slice(statement.argsSpan).trim();
      return { kind: "success", payload: { args } };
    },
    evaluate: () => ({ kind: "success", elements: [] })
  };
}

describe("add-on command routing", () => {
  it("routes claimed commands to AddonCommand statements", () => {
    const runtime = createAddonRuntime([{ engine: createProbeEngine() }]);
    const source = "\\begin{tikzpicture}\n\\probe (1,2);\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}";
    const parsed = parseTikz(source, { addons: runtime });

    const kinds = parsed.figure.body.map((statement) => statement.kind);
    expect(kinds).toEqual(["AddonCommand", "Path"]);

    const claimed = parsed.figure.body[0];
    if (claimed.kind !== "AddonCommand") {
      throw new Error("expected AddonCommand");
    }
    expect(claimed.addonId).toBe("probe");
    expect(claimed.commandName).toBe("\\probe");
    expect(claimed.payload).toEqual({ args: "(1,2)" });
  });

  it("leaves unclaimed commands as UnknownStatement", () => {
    const runtime = createAddonRuntime([{ engine: createProbeEngine() }]);
    const source = "\\begin{tikzpicture}\n\\other (1,2);\n\\end{tikzpicture}";
    const parsed = parseTikz(source, { addons: runtime });
    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["UnknownStatement"]);
  });

  it("does not route when the document never mentions a trigger", () => {
    const registration: AddonRegistration = { engine: createProbeEngine() };
    const runtime = createAddonRuntime([registration]);
    const source = "\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}";
    const parsed = parseTikz(source, { addons: runtime });
    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["Path"]);
  });

  it("deactivates a later add-on that claims an already-claimed command", () => {
    const probe = createProbeEngine();
    const rival: AddonEngine = {
      ...createProbeEngine(),
      manifest: { ...createProbeEngine().manifest, id: "rival" }
    };
    const runtime = createAddonRuntime([{ engine: probe }, { engine: rival }]);
    expect(runtime.engines.has("probe")).toBe(true);
    expect(runtime.engines.has("rival")).toBe(false);
    expect(runtime.issues).toHaveLength(1);
    expect(runtime.issues[0].addonId).toBe("rival");
  });
});

describe("smiley test add-on (Phase A contract)", () => {
  const runtime = () => createAddonRuntime([createSmileyAddon()]);

  it("evaluates a claimed command into scene elements with no unsupported warnings", () => {
    const source = "\\begin{tikzpicture}\n\\smiley (0,0);\n\\end{tikzpicture}";
    const result = renderTikzToSvg(source, { addons: runtime() });

    expect(result.semantic.diagnostics.filter((d) => d.code === "unsupported-statement")).toEqual([]);
    const elements = result.semantic.scene.elements;
    expect(elements.filter((element) => element.kind === "Circle")).toHaveLength(3);
    expect(elements.filter((element) => element.kind === "Path")).toHaveLength(1);
    for (const element of elements) {
      expect(element.sourceRef.sourceId).toBe("addon-command:0");
      expect(element.id.startsWith("addon:addon-command:0:")).toBe(true);
    }
    expect(result.svg.svg).toContain("circle");
  });

  it("participates in picture bounds", () => {
    const source = "\\begin{tikzpicture}\n\\smiley (0,0);\n\\end{tikzpicture}";
    const result = renderTikzToSvg(source, { addons: runtime() });
    const bounds = result.semantic.scene.bounds;
    expect(bounds).toBeDefined();
    expect(bounds!.minX).toBeLessThanOrEqual(-28);
    expect(bounds!.maxX).toBeGreaterThanOrEqual(28);
  });

  it("exports a coordinate system usable by later ordinary statements", () => {
    const source = [
      "\\begin{tikzpicture}",
      "\\smiley (0,0);",
      "\\draw (smiley cs:1,0) -- (smiley cs:-1,0);",
      "\\end{tikzpicture}"
    ].join("\n");
    const result = renderTikzToSvg(source, { addons: runtime() });

    const drawPath = result.semantic.scene.elements.find(
      (element) => element.kind === "Path" && element.sourceRef.sourceId === "path:1"
    );
    expect(drawPath).toBeDefined();
    if (drawPath?.kind !== "Path") {
      throw new Error("expected path");
    }
    const [start, end] = drawPath.commands;
    if (start.kind !== "M" || end.kind !== "L") {
      throw new Error("expected M/L commands");
    }
    expect(start.to.x).toBeCloseTo(28.4527559055, 3);
    expect(start.to.y).toBeCloseTo(0, 6);
    expect(end.to.x).toBeCloseTo(-28.4527559055, 3);
  });

  it("records dependency edges so edits to the add-on statement invalidate consumers", () => {
    const source = [
      "\\begin{tikzpicture}",
      "\\smiley (0,0);",
      "\\draw (smiley cs:1,0) -- (smiley cs:-1,0);",
      "\\end{tikzpicture}"
    ].join("\n");
    const result = renderTikzToSvg(source, { addons: runtime() });

    const invalidation = collectGeometryInvalidation(result.semantic.dependencies, {
      changedSourceIds: ["addon-command:0"]
    });
    expect(invalidation.affectedSourceIds).toContain("path:1");
  });

  it("exports named coordinates and node anchors usable by later statements", () => {
    const source = [
      "\\begin{tikzpicture}",
      "\\smiley (1,1);",
      "\\draw (smiley center) -- (2,2);",
      "\\draw (smiley.east) -- (3,0);",
      "\\end{tikzpicture}"
    ].join("\n");
    const result = renderTikzToSvg(source, { addons: runtime() });

    expect(result.semantic.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const centerDraw = result.semantic.scene.elements.find(
      (element) => element.kind === "Path" && element.sourceRef.sourceId === "path:1"
    );
    if (centerDraw?.kind !== "Path" || centerDraw.commands[0].kind !== "M") {
      throw new Error("expected path with M");
    }
    expect(centerDraw.commands[0].to.x).toBeCloseTo(28.4527559055, 3);
    expect(centerDraw.commands[0].to.y).toBeCloseTo(28.4527559055, 3);

    const anchorDraw = result.semantic.scene.elements.find(
      (element) => element.kind === "Path" && element.sourceRef.sourceId === "path:2"
    );
    if (anchorDraw?.kind !== "Path" || anchorDraw.commands[0].kind !== "M") {
      throw new Error("expected path with M");
    }
    expect(anchorDraw.commands[0].to.x).toBeCloseTo(2 * 28.4527559055, 3);
  });

  it("pushes add-on diagnostics instead of generic unsupported warnings on bad input", () => {
    const source = "\\begin{tikzpicture}\n\\smiley;\n\\end{tikzpicture}";
    const result = renderTikzToSvg(source, { addons: runtime() });
    expect(result.semantic.diagnostics.some((d) => d.code === "addon:smiley:missing-coordinate")).toBe(true);
    expect(result.semantic.diagnostics.some((d) => d.code === "unsupported-statement")).toBe(false);
  });

  it("marks namespaced feature usage", () => {
    const source = "\\begin{tikzpicture}\n\\smiley (0,0);\n\\end{tikzpicture}";
    const result = renderTikzToSvg(source, { addons: runtime() });
    expect(result.semantic.featureUsage["addon:smiley:smiley-command"]).toBe("used-supported");
  });
});

describe("claimed environments (Phase B grammar seam)", () => {
  const runtime = () => createAddonRuntime([createSmileyAddon()]);

  it("parses a claimed environment into AddonEnvironment with a host-parsed body", () => {
    const source = [
      "\\begin{tikzpicture}",
      "\\begin{smileybox}[padding=0.5]",
      "\\draw (0,0) -- (1,1);",
      "\\smiley (2,2);",
      "\\end{smileybox}",
      "\\end{tikzpicture}"
    ].join("\n");
    const parsed = parseTikz(source, { addons: runtime() });

    expect(parsed.figure.body).toHaveLength(1);
    const environment = parsed.figure.body[0];
    if (environment.kind !== "AddonEnvironment") {
      throw new Error(`expected AddonEnvironment, got ${environment.kind}`);
    }
    expect(environment.envName).toBe("smileybox");
    expect(environment.addonId).toBe("smiley");
    expect(environment.payload).toEqual({ padding: 0.5 * 28.4527559055 });
    expect((environment.body ?? []).map((statement) => statement.kind)).toEqual(["Path", "AddonCommand"]);
  });

  it("evaluates the environment body as ordinary TikZ plus add-on chrome", () => {
    const source = [
      "\\begin{tikzpicture}",
      "\\begin{smileybox}",
      "\\draw (0,0) -- (1,1);",
      "\\end{smileybox}",
      "\\end{tikzpicture}"
    ].join("\n");
    const result = renderTikzToSvg(source, { addons: runtime() });

    expect(result.semantic.diagnostics.filter((d) => d.code === "unsupported-statement")).toEqual([]);
    const paths = result.semantic.scene.elements.filter((element) => element.kind === "Path");
    expect(paths).toHaveLength(2);
    const bodyPath = paths.find((element) => element.sourceRef.sourceId.startsWith("path:"));
    const border = paths.find((element) => element.sourceRef.sourceId.startsWith("addon-environment:"));
    expect(bodyPath).toBeDefined();
    expect(border).toBeDefined();
  });

  it("warns on begin/end environment name mismatch", () => {
    const source = [
      "\\begin{tikzpicture}",
      "\\begin{smileybox}",
      "\\end{smilebox}",
      "\\end{tikzpicture}"
    ].join("\n");
    const parsed = parseTikz(source, { addons: runtime() });
    expect(parsed.diagnostics.some((d) => d.code === "environment-name-mismatch")).toBe(true);
  });

  it("keeps unclaimed environments as unknown statements with the standard warning", () => {
    const source = [
      "\\begin{tikzpicture}",
      "\\begin{axis}",
      "\\end{axis}",
      "\\end{tikzpicture}"
    ].join("\n");
    const result = renderTikzToSvg(source, { addons: runtime() });
    expect(result.parse.figure.body.map((statement) => statement.kind)).toEqual(["UnknownStatement"]);
    expect(result.semantic.diagnostics.some((d) => d.code === "unsupported-statement")).toBe(true);
  });
});

describe("claimed macro commands (semicolon-less prescan)", () => {
  const runtime = () => createAddonRuntime([createSmileyAddon()]);

  it("recovers a claimed macro command without a semicolon", () => {
    const source = [
      "\\begin{tikzpicture}",
      "\\smileyset{mood=happy}",
      "\\draw (0,0) -- (1,1);",
      "\\end{tikzpicture}"
    ].join("\n");
    const parsed = parseTikz(source, { addons: runtime() });

    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["AddonCommand", "Path"]);
    const claimed = parsed.figure.body[0];
    if (claimed.kind !== "AddonCommand") {
      throw new Error("expected AddonCommand");
    }
    expect(claimed.commandName).toBe("\\smileyset");
    expect(claimed.payload).toEqual({ configRaw: "mood=happy" });
    expect(parsed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("routes a semicolon-terminated claimed macro command through the grammar path", () => {
    const source = "\\begin{tikzpicture}\n\\smileyset{mood=happy};\n\\end{tikzpicture}";
    const parsed = parseTikz(source, { addons: runtime() });
    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["AddonCommand"]);
  });

  it("ignores claimed macro commands inside braced groups", () => {
    const source = "\\begin{tikzpicture}\n\\node at (0,0) {uses \\smileyset literally};\n\\end{tikzpicture}";
    const parsed = parseTikz(source, { addons: runtime() });
    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["Path"]);
  });

  it("still reports missing semicolons for plain TikZ statements", () => {
    const source = "\\begin{tikzpicture}\n\\smileyset{mood=happy}\n\\draw (0,0) -- (1,1)\n\\end{tikzpicture}";
    const parsed = parseTikz(source, { addons: runtime() });
    expect(parsed.diagnostics.some((d) => d.code === "missing-semicolon" || d.code === "parse-error")).toBe(true);
  });
});

describe("add-on editing surface (Phase C)", () => {
  const runtime = () => createAddonRuntime([createSmileyAddon()]);

  it("creates addon edit handles during evaluation", () => {
    const source = "\\begin{tikzpicture}\n\\smiley (1,1);\n\\end{tikzpicture}";
    const result = renderTikzToSvg(source, { addons: runtime() });
    const handle = result.semantic.editHandles.find((entry) => entry.handleType === "addon");
    expect(handle).toBeDefined();
    if (handle?.handleType !== "addon") {
      throw new Error("expected addon handle");
    }
    expect(handle.addonId).toBe("smiley");
    expect(handle.role).toBe("center");
    expect(handle.world.x).toBeCloseTo(28.4527559055, 3);
    expect(handle.sourceRef.sourceId).toBe("addon-command:0");
  });

  it("routes a handle drag through planHandleDrag and applyEditAction", () => {
    const activeRuntime = runtime();
    const source = "\\begin{tikzpicture}\n\\smiley (1,1);\n\\end{tikzpicture}";
    const result = renderTikzToSvg(source, { addons: activeRuntime });
    const handle = result.semantic.editHandles.find((entry) => entry.handleType === "addon");
    if (handle?.handleType !== "addon") {
      throw new Error("expected addon handle");
    }

    const engine = activeRuntime.engineById("smiley");
    const edit = engine?.planHandleDrag?.(toAddonHandleView(handle), { x: 2 * 28.4527559055, y: 28.4527559055 });
    expect(edit).toBeDefined();

    const applied = applyEditAction(source, result.semantic.editHandles, {
      kind: "addonEdit",
      addonId: "smiley",
      edit
    }, { evaluateOptions: { addons: activeRuntime } });
    if (applied.kind !== "success") {
      throw new Error(`expected success, got ${applied.kind}`);
    }
    expect(applied.newSource).toContain("\\smiley (2,1);");
    expect(applied.changedSourceIds).toEqual(["addon-command:0"]);
  });

  it("applies inspector property writes through rewriteOptionList", () => {
    const activeRuntime = runtime();
    const registration = createSmileyAddon();
    const source = "\\begin{tikzpicture}\n\\smiley[fill=red] (1,1);\n\\end{tikzpicture}";
    const parsed = parseTikz(source, { addons: activeRuntime });
    const statement = parsed.figure.body[0];
    if (statement.kind !== "AddonCommand") {
      throw new Error("expected AddonCommand");
    }

    const sections = registration.ui?.inspector?.(statement) ?? [];
    expect(sections).toHaveLength(1);
    const property = sections[0].properties[0];
    if (property.kind !== "number") {
      throw new Error("expected number property");
    }
    expect(property.value).toBeCloseTo(1, 6);

    const applied = applyEditAction(source, [], {
      kind: "addonEdit",
      addonId: "smiley",
      edit: property.buildEdit(2)
    }, { evaluateOptions: { addons: activeRuntime } });
    if (applied.kind !== "success") {
      throw new Error(`expected success, got ${applied.kind}`);
    }
    expect(applied.newSource).toContain("radius=2");
    expect(applied.newSource).toContain("fill=red");
  });

  it("reports unsupported for edits from unknown add-ons", () => {
    const applied = applyEditAction("\\begin{tikzpicture}\n\\end{tikzpicture}", [], {
      kind: "addonEdit",
      addonId: "ghost",
      edit: {}
    }, {});
    expect(applied.kind).toBe("unsupported");
  });
});

describe("add-on evaluation budget", () => {
  it("degrades to a warning when an add-on exceeds the element budget", () => {
    const floodEngine: AddonEngine = {
      manifest: {
        id: "flood",
        version: "0.0.1",
        apiVersion: "^0.1.0",
        displayName: "Flood",
        license: "MIT",
        sourceUrl: "https://example.invalid/flood",
        triggers: { commands: ["\\flood"] },
        entries: { engine: "./engine.js" }
      },
      evaluate: (statement, context) => {
        const elements = [];
        for (let index = 0; index < 100; index += 1) {
          elements.push(context.makeCircle({ center: { x: index, y: 0 }, radius: 1 }));
        }
        return { kind: "success", elements };
      }
    };
    const runtime = createAddonRuntime([{ engine: floodEngine }]);
    const source = "\\begin{tikzpicture}\n\\flood;\n\\end{tikzpicture}";
    const result = renderTikzToSvg(source, {
      addons: runtime,
      evaluate: { maxAddonElementsPerStatement: 10 }
    });
    expect(result.semantic.diagnostics.some((d) => d.code === "addon-eval-budget-exceeded")).toBe(true);
    expect(result.semantic.scene.elements).toHaveLength(0);
  });
});
