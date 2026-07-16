import { afterEach, describe, expect, it, vi } from "vitest";

import { createAddonRuntime } from "@tikz-editor/core/addons/runtime.js";
import { generateElementSource } from "@tikz-editor/core/edit/element-templates.js";
import { renderTikzToSvg } from "@tikz-editor/core/render/index.js";

import { APP_MENU_DEFINITION } from "../../packages/app/src/app-menu/index.js";
import { buildAddonContextMenu } from "../../packages/app/src/addons/context-menu";
import { buildAddonGhostPathData, findAddonTemplate } from "../../packages/app/src/addons/ghost";
import { appendAddonMenuItems } from "../../packages/app/src/addons/menu";
import { setActiveAddonRuntime } from "../../packages/app/src/addons/registry";
import { listAddonToolTemplates } from "../../packages/app/src/addons/templates";
import type { EditorAction } from "../../packages/app/src/store/types.js";
import { createEditorCommandRuntime } from "../../packages/app/src/ui/editor-command-runtime.js";
import { createSmileyAddon } from "../helpers/smiley-addon.js";

const PT_PER_UNIT = 28.4527559055;
const SMILEY_SOURCE = "\\begin{tikzpicture}\n\\smiley (1,1);\n\\end{tikzpicture}";

afterEach(() => {
  setActiveAddonRuntime(null);
});

function activateSmileyRuntime() {
  const runtime = createAddonRuntime([createSmileyAddon()]);
  setActiveAddonRuntime(runtime);
  return runtime;
}

function makeRuntimeInput(options: {
  dispatch: (action: EditorAction) => void;
  toolMode?: "select" | "addonTemplate";
  activeAddonTemplateId?: string | null;
}) {
  const rendered = renderTikzToSvg(SMILEY_SOURCE, { addons: createAddonRuntime([createSmileyAddon()]) });
  return {
    source: SMILEY_SOURCE,
    activeFigureId: rendered.parse.activeFigureId,
    snapshot: {
      source: SMILEY_SOURCE,
      revision: 1,
      figures: rendered.parse.figures,
      activeFigureId: rendered.parse.activeFigureId,
      editHandles: rendered.semantic.editHandles,
      scene: rendered.semantic.scene,
      svg: rendered.svg,
      svgModel: rendered.svg.model,
      parseResult: rendered.parse,
      semanticResult: rendered.semantic,
      incremental: null
    },
    toolMode: options.toolMode ?? ("select" as const),
    activeAddonTemplateId: options.activeAddonTemplateId ?? null,
    selectedElementIds: new Set<string>(),
    activeHandleId: null,
    historyIndex: -1,
    historyLength: 0,
    activeDocumentId: "doc-1",
    tabCount: 1,
    dirty: false,
    fileRef: null,
    fitToContentModeActive: false,
    rightSidebarTab: "inspector" as const,
    assistantAvailable: false,
    showGrid: false,
    showTransparencyGrid: false,
    snapModes: { grid: true, guides: true, points: true, gaps: true },
    snapHapticsEnabled: false,
    showRulers: true,
    showGuides: true,
    showDocumentBounds: true,
    showSourcePanel: true,
    showInspectorPanel: true,
    showObjectsPanel: true,
    showStylesPanel: true,
    showFiguresPanel: true,
    showAssistantPanel: false,
    showDevPanel: false,
    updateCanvasSettings: () => undefined,
    dispatch: options.dispatch
  };
}

describe("add-on tool templates", () => {
  it("lists templates from the active runtime with their addon id", () => {
    activateSmileyRuntime();
    const templates = listAddonToolTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0].id).toBe("addon:smiley:smiley");
    expect(templates[0].addonId).toBe("smiley");
    expect(templates[0].placement).toBe("drag-rect");
  });

  it("returns nothing without an active runtime", () => {
    expect(listAddonToolTemplates()).toEqual([]);
    expect(findAddonTemplate("addon:smiley:smiley")).toBeNull();
  });

  it("inserts addonSource templates verbatim", () => {
    const source = generateElementSource(
      { kind: "addonSource", source: "\n\\smiley (1,1);\n" },
      { x: 0, y: 0 } as never
    );
    expect(source).toBe("\\smiley (1,1);");
  });
});

describe("add-on insert-menu assembly", () => {
  it("appends a separator and the contributed item to the Insert section", () => {
    activateSmileyRuntime();
    const definition = appendAddonMenuItems(APP_MENU_DEFINITION);
    const insert = definition.find((section) => section.id === "insert");
    const items = insert?.items ?? [];
    expect(items[items.length - 1]).toEqual({
      kind: "command",
      commandId: "addon:smiley:insert-smiley",
      label: "Smiley"
    });
    expect(items[items.length - 2]).toEqual({ kind: "separator" });
  });

  it("leaves the definition untouched without contributions", () => {
    expect(appendAddonMenuItems(APP_MENU_DEFINITION)).toBe(APP_MENU_DEFINITION);
  });
});

describe("add-on command bindings", () => {
  it("arms the addonTemplate tool when the insert command runs", () => {
    activateSmileyRuntime();
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const runtime = createEditorCommandRuntime(makeRuntimeInput({ dispatch }));

    const binding = runtime.addonBindings.get("addon:smiley:insert-smiley");
    expect(binding?.enabled).toBe(true);
    expect(binding?.checked).toBe(false);

    expect(runtime.runCommand("addon:smiley:insert-smiley", "menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_TOOL_MODE",
      mode: "addonTemplate",
      addonTemplateId: "addon:smiley:smiley"
    });
  });

  it("reports the armed template as checked", () => {
    activateSmileyRuntime();
    const runtime = createEditorCommandRuntime(
      makeRuntimeInput({
        dispatch: () => undefined,
        toolMode: "addonTemplate",
        activeAddonTemplateId: "addon:smiley:smiley"
      })
    );
    expect(runtime.addonBindings.get("addon:smiley:insert-smiley")?.checked).toBe(true);
  });

  it("contributes no bindings without an active runtime", () => {
    const runtime = createEditorCommandRuntime(makeRuntimeInput({ dispatch: () => undefined }));
    expect(runtime.addonBindings.size).toBe(0);
    expect(runtime.runCommand("addon:smiley:insert-smiley", "menu")).toBe(false);
  });
});

describe("add-on ghost preview", () => {
  it("encodes the generated snippet as compound svg path data", () => {
    activateSmileyRuntime();
    const template = findAddonTemplate("addon:smiley:smiley");
    expect(template).not.toBeNull();

    const d = buildAddonGhostPathData(
      template!,
      { x: 0, y: 0 } as never,
      { x: 2 * PT_PER_UNIT, y: 2 * PT_PER_UNIT } as never,
      (point) => ({ x: point.x, y: -point.y })
    );
    expect(d).toBeTruthy();
    // Face and eyes become arc pairs; the mouth is a cubic curve.
    expect(d).toContain("A ");
    expect(d).toContain("C ");
  });

  it("falls back to the template's default size on a plain click", () => {
    activateSmileyRuntime();
    const template = findAddonTemplate("addon:smiley:smiley");
    const d = buildAddonGhostPathData(
      template!,
      { x: 0, y: 0 } as never,
      { x: 0, y: 0 } as never,
      (point) => ({ x: point.x, y: -point.y })
    );
    expect(d).toBeTruthy();
  });
});

describe("add-on context menu", () => {
  it("builds items for a claimed statement and dispatches addonEdit on run", () => {
    const runtime = activateSmileyRuntime();
    const rendered = renderTikzToSvg(SMILEY_SOURCE, { addons: runtime });
    const dispatch = vi.fn<(action: EditorAction) => void>();

    const menu = buildAddonContextMenu(rendered.parse, "addon-command:0", { x: 0, y: 0 }, dispatch);
    expect(menu).not.toBeNull();
    expect(menu?.items).toEqual([
      { kind: "command", commandId: "addon:smiley:grow", label: "Grow smiley" }
    ]);

    const binding = menu?.bindings.get("addon:smiley:grow");
    expect(binding?.enabled).toBe(true);
    void binding?.run("context-menu");
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "addonEdit",
        addonId: "smiley",
        edit: { kind: "set-radius", statementId: "addon-command:0", radius: 1.25 }
      }
    });
  });

  it("contributes nothing for unclaimed statements", () => {
    const runtime = activateSmileyRuntime();
    const rendered = renderTikzToSvg(SMILEY_SOURCE, { addons: runtime });
    expect(buildAddonContextMenu(rendered.parse, "path:0", { x: 0, y: 0 }, () => undefined)).toBeNull();
    expect(buildAddonContextMenu(rendered.parse, null, { x: 0, y: 0 }, () => undefined)).toBeNull();
  });
});
