import { describe, expect, it } from "vitest";

import type { AddonEngine, AddonRegistration } from "@tikz-editor/addon-api";
import { parseTikz } from "@tikz-editor/core/parser/index.js";
import { createAddonRuntime } from "@tikz-editor/core/addons/runtime.js";
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
