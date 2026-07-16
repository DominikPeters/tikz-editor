import { afterEach, describe, expect, it } from "vitest";

import { createAddonRuntime } from "@tikz-editor/core/addons/runtime.js";
import { renderTikzToSvg } from "@tikz-editor/core/render/index.js";
import { buildAddonInspectorModel } from "../../packages/app/src/addons/inspector";
import { setActiveAddonRuntime } from "../../packages/app/src/addons/registry";
import { resolveHandleDragAction } from "../../packages/app/src/ui/canvas-panel/handle-drag-actions";
import { createSmileyAddon } from "../helpers/smiley-addon.js";

afterEach(() => {
  setActiveAddonRuntime(null);
});

describe("add-on handle drag routing (app layer)", () => {
  it("routes addon handle drags to planHandleDrag and wraps the edit in addonEdit", () => {
    const runtime = createAddonRuntime([createSmileyAddon()]);
    setActiveAddonRuntime(runtime);
    const source = "\\begin{tikzpicture}\n\\smiley (1,1);\n\\end{tikzpicture}";
    const result = renderTikzToSvg(source, { addons: runtime });
    const handle = result.semantic.editHandles.find((entry) => entry.handleType === "addon");
    if (handle?.handleType !== "addon") {
      throw new Error("expected addon handle");
    }

    const action = resolveHandleDragAction({
      handleId: handle.id,
      newWorld: { x: 2 * 28.4527559055, y: 28.4527559055 } as never,
      activeEndpointAnchor: null,
      handle
    });
    expect(action).toEqual({
      kind: "addonEdit",
      addonId: "smiley",
      edit: { kind: "move-center", statementId: "addon-command:0", x: 2, y: 1 }
    });
  });

  it("keeps ordinary handles on the moveHandle path", () => {
    const action = resolveHandleDragAction({
      handleId: "handle:path:0:point:0",
      newWorld: { x: 1, y: 2 } as never,
      activeEndpointAnchor: null,
      handle: null
    });
    expect(action).toEqual({ kind: "moveHandle", handleId: "handle:path:0:point:0", newWorld: { x: 1, y: 2 } });
  });
});

describe("add-on inspector provider (app layer)", () => {
  it("builds inspector sections for a selected claimed statement", () => {
    const runtime = createAddonRuntime([createSmileyAddon()]);
    setActiveAddonRuntime(runtime);
    const source = "\\begin{tikzpicture}\n\\smiley[radius=2] (1,1);\n\\end{tikzpicture}";
    const result = renderTikzToSvg(source, { addons: runtime });

    const model = buildAddonInspectorModel(result.parse, ["addon-command:0"]);
    expect(model).not.toBeNull();
    expect(model?.addonId).toBe("smiley");
    expect(model?.sections[0]?.title).toBe("Smiley");
    const property = model?.sections[0]?.properties[0];
    if (property?.kind !== "number") {
      throw new Error("expected number property");
    }
    expect(property.value).toBeCloseTo(2, 6);
  });

  it("returns null for ordinary statements and multi-selection", () => {
    const runtime = createAddonRuntime([createSmileyAddon()]);
    setActiveAddonRuntime(runtime);
    const source = "\\begin{tikzpicture}\n\\smiley (1,1);\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}";
    const result = renderTikzToSvg(source, { addons: runtime });

    expect(buildAddonInspectorModel(result.parse, ["path:1"])).toBeNull();
    expect(buildAddonInspectorModel(result.parse, ["addon-command:0", "path:1"])).toBeNull();
  });
});
