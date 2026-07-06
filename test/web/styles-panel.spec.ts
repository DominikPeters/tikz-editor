/** @vitest-environment jsdom */

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StylesCascadeDeclaration,
  StylesCascadeModel,
  StylesCascadeSection
} from "../../packages/core/src/edit/styles-cascade";

type MockStoreState = {
  selectedElementIds: Set<string>;
  activeDocumentId: string;
  activeFigureId: string | null;
  snapshot: {
    source: string;
    editHandles: unknown[];
    scene: { elements: Array<{ sourceRef: { sourceId: string } }> };
  };
  source: string;
  sourceRevision: number;
  dispatch: unknown;
};

const mocks = vi.hoisted(() => {
  const storeState: MockStoreState = {
    selectedElementIds: new Set(["el-1"]),
    activeDocumentId: "doc-1",
    activeFigureId: null,
    snapshot: {
      source: "\\draw[dashed] (0,0) -- (1,0);",
      editHandles: [],
      scene: {
        elements: [{ sourceRef: { sourceId: "el-1" } }]
      }
    },
    source: "\\draw[dashed] (0,0) -- (1,0);",
    sourceRevision: 1,
    dispatch: undefined
  };
  return {
    dispatch: vi.fn(),
    buildStylesCascadeModel: vi.fn(),
    areStylesCascadeModelsIdentical: vi.fn((_models: unknown) => true),
    storeState
  };
});

vi.mock("../../packages/app/src/store/store", () => ({
  useEditorStore: (selector: (state: typeof mocks.storeState) => unknown) => selector({
    ...mocks.storeState,
    dispatch: mocks.dispatch
  })
}));

vi.mock("../../packages/app/src/edit-analysis-manager", () => ({
  getSharedEditAnalysisView: () => ({ kind: "test-analysis" }),
  getSharedEditAnalysisSession: () => null
}));

vi.mock("../../packages/app/src/colors/project-named-colors", () => ({
  useProjectNamedColorSwatches: () => []
}));

vi.mock("tikz-editor/edit/styles-cascade", async () => {
  const actual = await vi.importActual<typeof import("tikz-editor/edit/styles-cascade")>(
    "tikz-editor/edit/styles-cascade"
  );
  return {
    ...actual,
    buildStylesCascadeModel: (element: unknown, options: unknown) => mocks.buildStylesCascadeModel(element, options),
    buildSharedStylesCascadeModel: (models: StylesCascadeModel[]) => models[0] ?? null,
    areStylesCascadeModelsIdentical: (models: StylesCascadeModel[]) => mocks.areStylesCascadeModelsIdentical(models)
  };
});

import { StylesPanel } from "../../packages/app/src/ui/StylesPanel";

function makeWriteTarget(writable: boolean) {
  return {
    mode: "setProperty" as const,
    elementId: "el-1",
    level: "command" as const,
    key: "",
    writable
  };
}

function makeDeclaration(input: {
  id: string;
  sourceText: string;
  cssValue?: string;
  writable: boolean;
  status?: StylesCascadeDeclaration["status"];
}): StylesCascadeDeclaration {
  const rawLabel = input.sourceText.split("=")[0]?.trim();
  return {
    id: input.id,
    propertyId: null,
    label: rawLabel && rawLabel.length > 0 ? rawLabel : input.id,
    cssValue: input.cssValue ?? "",
    status: input.status ?? "active",
    property: null,
    writeTargets: [makeWriteTarget(input.writable)],
    sourceText: input.sourceText
  };
}

function makeModel(declaration: StylesCascadeDeclaration, sectionWritable = true): StylesCascadeModel {
  const section: StylesCascadeSection = {
    id: "section-1",
    kind: "command",
    title: "Draw command",
    subtitle: null,
    sourceLevel: "command",
    sourceLabel: null,
    sourceLocation: "line 1",
    writable: sectionWritable,
    declarations: [declaration],
    addableProperties: [],
    addPropertyTemplates: {},
    writeTargets: [makeWriteTarget(sectionWritable)]
  };

  return {
    elementKind: "path",
    elementIds: ["el-1"],
    sections: [section],
    comparableSignature: "sig"
  } as unknown as StylesCascadeModel;
}

describe("StylesPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.dispatch.mockReset();
    mocks.buildStylesCascadeModel.mockReset();
    mocks.areStylesCascadeModelsIdentical.mockReturnValue(true);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.querySelectorAll(".menuFixed").forEach((entry) => entry.remove());
  });

  it("does not expose rename/delete editors when declaration targets are not writable", async () => {
    mocks.buildStylesCascadeModel.mockReturnValue(
      makeModel(makeDeclaration({ id: "decl", sourceText: "draw=red", cssValue: "red", writable: false }), false)
    );

    await act(async () => {
      root.render(React.createElement(StylesPanel));
    });

    expect(container.querySelector('input[aria-label="Property name"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Delete draw"]')).toBeNull();
    const valueButton = container.querySelector<HTMLButtonElement>("button");
    expect(valueButton).not.toBeNull();
    expect(valueButton?.disabled).toBe(true);
  });

  it("renames flag properties without dropping them", async () => {
    mocks.buildStylesCascadeModel.mockReturnValue(
      makeModel(makeDeclaration({ id: "decl", sourceText: "dashed", cssValue: "", writable: true }), true)
    );

    await act(async () => {
      root.render(React.createElement(StylesPanel));
    });

    const keyInput = container.querySelector('input[aria-label="Property name"]') as HTMLInputElement;
    expect(keyInput).not.toBeNull();

    await act(async () => {
      keyInput.focus();
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(keyInput, "dotted");
      keyInput.dispatchEvent(new Event("input", { bubbles: true }));
      keyInput.blur();
    });

    const editActions = mocks.dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action?.type === "APPLY_EDIT_ACTION")
      .map((action) => action.action);

    expect(editActions).toEqual([
      expect.objectContaining({ kind: "setProperty", key: "dashed", value: "" }),
      expect.objectContaining({ kind: "setProperty", key: "dotted", value: "true" })
    ]);
  });

  it("dispatches a remove mutation when deleting a property", async () => {
    mocks.buildStylesCascadeModel.mockReturnValue(
      makeModel(makeDeclaration({ id: "decl", sourceText: "draw=red", cssValue: "red", writable: true }), true)
    );

    await act(async () => {
      root.render(React.createElement(StylesPanel));
    });

    const deleteButton = container.querySelector('button[aria-label="Delete draw"]') as HTMLButtonElement;
    expect(deleteButton).not.toBeNull();

    await act(async () => {
      deleteButton.click();
    });

    const dispatched = mocks.dispatch.mock.calls.map(([action]) => action.action);
    expect(dispatched).toContainEqual(expect.objectContaining({ kind: "setProperty", key: "draw", value: "" }));
  });

  it("renders toggle checkbox state for active and disabled declarations", async () => {
    const activeDecl = makeDeclaration({ id: "decl-active", sourceText: "draw=red", cssValue: "red", writable: true });
    const disabledDecl = makeDeclaration({
      id: "decl-disabled",
      sourceText: "fill=blue",
      cssValue: "blue",
      writable: true,
      status: "disabled"
    });
    const model = makeModel(activeDecl, true);
    model.sections[0].declarations = [activeDecl, disabledDecl];
    mocks.buildStylesCascadeModel.mockReturnValue(model);

    await act(async () => {
      root.render(React.createElement(StylesPanel));
    });

    const activeToggle = container.querySelector<HTMLInputElement>('input[aria-label="Toggle draw"]');
    expect(activeToggle).not.toBeNull();
    expect(activeToggle?.checked).toBe(true);

    const disabledToggle = container.querySelector<HTMLInputElement>('input[aria-label="Toggle fill"]');
    expect(disabledToggle).not.toBeNull();
    expect(disabledToggle?.checked).toBe(false);
  });

  it("dispatches comment-toggle metadata when disabling via checkbox", async () => {
    mocks.buildStylesCascadeModel.mockReturnValue(
      makeModel(makeDeclaration({ id: "decl", sourceText: "draw=red", cssValue: "red", writable: true }), true)
    );

    await act(async () => {
      root.render(React.createElement(StylesPanel));
    });

    const toggle = container.querySelector<HTMLInputElement>('input[aria-label="Toggle draw"]');
    expect(toggle).not.toBeNull();

    await act(async () => {
      toggle!.click();
    });

    const dispatched = mocks.dispatch.mock.calls.map(([action]) => action.action);
    expect(dispatched).toContainEqual(
      expect.objectContaining({
        kind: "setProperty",
        key: "draw",
        commentMode: "disable",
        commentSourceText: "draw=red"
      })
    );
  });

  it("keeps disabled declarations read-only while allowing re-enable checkbox", async () => {
    mocks.buildStylesCascadeModel.mockReturnValue(
      makeModel(makeDeclaration({ id: "decl-disabled", sourceText: "draw=red", cssValue: "red", writable: true, status: "disabled" }), true)
    );

    await act(async () => {
      root.render(React.createElement(StylesPanel));
    });

    expect(container.querySelector('input[aria-label="Property name"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Delete draw"]')).toBeNull();
    const valueButton = container.querySelector<HTMLButtonElement>("button");
    expect(valueButton).not.toBeNull();
    expect(valueButton?.disabled).toBe(true);

    const toggle = container.querySelector<HTMLInputElement>('input[aria-label="Toggle draw"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.disabled).toBe(false);
  });

  it("keeps raw value displays in sync after external value updates", async () => {
    const declaration = makeDeclaration({ id: "decl", sourceText: "draw=red", cssValue: "red", writable: false });
    const model = makeModel(declaration, false);
    mocks.buildStylesCascadeModel.mockImplementation(() => model);

    await act(async () => {
      root.render(React.createElement(StylesPanel));
    });

    const before = container.querySelector("button");
    expect(before?.textContent).toContain("red");

    model.sections[0].declarations[0] = makeDeclaration({
      id: "decl",
      sourceText: "draw=blue",
      cssValue: "blue",
      writable: false
    });

    await act(async () => {
      root.render(React.createElement(StylesPanel));
    });

    const after = container.querySelector("button");
    expect(after?.textContent).toContain("blue");
  });
});
