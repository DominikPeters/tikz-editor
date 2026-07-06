import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_MENU_COMMAND_IDS } from "../../packages/app/src/app-menu/index.js";
import { renderTikzToSvg } from "../../packages/core/src/render/index.js";
import { createEditorCommandRuntime } from "../../packages/app/src/ui/editor-command-runtime.js";
import * as DockLayoutModule from "../../packages/app/src/ui/DockLayout.js";
import type { EditorAction } from "../../packages/app/src/store/types.js";
import { setActiveEditorPlatform } from "../../packages/app/src/platform/current.js";

const svgToTikzMock = vi.hoisted(() => vi.fn<(source: string) => string>());
const convertIpeToTikzMock = vi.hoisted(() => vi.fn<(source: string) => { tikz: string; diagnostics: Array<{ severity: "warning" | "error"; message: string }> }>());

vi.mock("svg2tikz", () => ({
  svgToTikz: svgToTikzMock
}));

vi.mock("ipe2tikz", () => ({
  convertIpeToTikz: convertIpeToTikzMock
}));

const SOURCE = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

function uniqueMatrixCellIds(
  rendered: ReturnType<typeof renderTikzToSvg>,
  predicate: (entry: { row: number; column: number }) => boolean
): string[] {
  const ids = new Set<string>();
  for (const element of rendered.semantic.scene.elements) {
    const matrixCell = element.matrixCell;
    if (!matrixCell) {
      continue;
    }
    if (!predicate({ row: matrixCell.row, column: matrixCell.column })) {
      continue;
    }
    ids.add(matrixCell.cellSourceId);
  }
  return [...ids];
}

describe("editor-command-runtime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    svgToTikzMock.mockReset();
    convertIpeToTikzMock.mockReset();
    setActiveEditorPlatform({
      id: "test-platform",
      persistence: {
        load: () => null,
        save: () => undefined
      }
    });
  });

  it("computes enabled and checked states for menu commands", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(["path:0"]),
        historyIndex: 0,
        historyLength: 2,
        showGrid: true,
        showTransparencyGrid: false,
        showDocumentBounds: true
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.UNDO].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.REDO].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PASTE].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.ROTATE_LEFT_90].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.FLIP_HORIZONTAL].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PATH_REVERSE].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_GRID].checked).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_TRANSPARENCY_GRID].checked).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_INFINITE_CANVAS].checked).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GRID].checked).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GUIDES].checked).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_POINTS].checked).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_GAPS].checked).toBe(true);
  });

  it("enables Check for Updates when platform updater support is available", () => {
    const onCheckForUpdates = vi.fn();
    setActiveEditorPlatform({
      id: "desktop-test",
      persistence: {
        load: () => null,
        save: () => undefined
      },
      updates: {
        checkForUpdate: async () => null,
        installUpdate: async () => undefined,
        relaunch: async () => undefined
      }
    });

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch: vi.fn<(action: EditorAction) => void>(),
        snapshot: makeSnapshot(renderTikzToSvg(SOURCE)),
        selectedElementIds: new Set(),
        onCheckForUpdates
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.CHECK_FOR_UPDATES].enabled).toBe(true);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.CHECK_FOR_UPDATES, "menu")).toBe(true);
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1);
  });

  it("disables Check for Updates while update work is busy", () => {
    setActiveEditorPlatform({
      id: "desktop-test",
      persistence: {
        load: () => null,
        save: () => undefined
      },
      updates: {
        checkForUpdate: async () => null,
        installUpdate: async () => undefined,
        relaunch: async () => undefined
      }
    });

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch: vi.fn<(action: EditorAction) => void>(),
        snapshot: makeSnapshot(renderTikzToSvg(SOURCE)),
        selectedElementIds: new Set(),
        onCheckForUpdates: vi.fn(),
        updateCheckBusy: true
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.CHECK_FOR_UPDATES].enabled).toBe(false);
  });

  it("routes Quit through the app close guard callback", () => {
    const onRequestQuitApp = vi.fn();
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch: vi.fn<(action: EditorAction) => void>(),
        snapshot: makeSnapshot(renderTikzToSvg(SOURCE)),
        selectedElementIds: new Set(),
        onRequestQuitApp
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.QUIT_APP].enabled).toBe(true);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.QUIT_APP, "menu")).toBe(true);
    expect(onRequestQuitApp).toHaveBeenCalledTimes(1);
  });

  it("dispatches per-mode snap toggles", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        snapModes: {
          grid: false,
          guides: true,
          points: false,
          gaps: true
        }
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GRID].checked).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_POINTS].checked).toBe(false);

    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.TOGGLE_TRANSPARENCY_GRID, "menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "TOGGLE_CANVAS_AID", aid: "transparencyGrid" });
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.TOGGLE_INFINITE_CANVAS, "menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "TOGGLE_CANVAS_AID", aid: "documentBounds" });
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GUIDES, "menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "TOGGLE_SNAP_MODE", mode: "guides" });
  });

  it("treats fit to content as a checked toggle", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const inactiveRuntime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        fitToContentModeActive: false
      })
    );
    expect(inactiveRuntime.bindings[APP_MENU_COMMAND_IDS.FIT_TO_CONTENT].checked).toBe(false);
    expect(inactiveRuntime.runCommand(APP_MENU_COMMAND_IDS.FIT_TO_CONTENT, "menu")).toBe(true);
    expect(dispatch).toHaveBeenLastCalledWith({ type: "REQUEST_FIT_TO_CONTENT" });

    const activeRuntime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        fitToContentModeActive: true
      })
    );
    expect(activeRuntime.bindings[APP_MENU_COMMAND_IDS.FIT_TO_CONTENT].checked).toBe(true);
    expect(activeRuntime.runCommand(APP_MENU_COMMAND_IDS.FIT_TO_CONTENT, "menu")).toBe(true);
    expect(dispatch).toHaveBeenLastCalledWith({ type: "SET_FIT_TO_CONTENT_MODE", active: false });
  });

  it("routes rotate-left through grouped transform edits", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=90] (0,0) -- (1,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        source,
        snapshot: makeSnapshot(rendered, source),
        selectedElementIds: new Set(["path:0"]),
        historyIndex: 0,
        historyLength: 1
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.ROTATE_LEFT_90, "menu");

    expect(ran).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "setProperty",
        elementId: "path:0",
        level: "command",
        key: "rotate",
        value: "180",
        propertyId: "transform.rotate",
        clearKeys: ["/tikz/rotate", "rotate around", "/tikz/rotate around"]
      }
    }));
  });

  it("opens the repeat dialog from the repeat command", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const onOpenRepeat = vi.fn();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(["path:0"]),
        onOpenRepeat
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.REPEAT].enabled).toBe(true);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.REPEAT, "menu")).toBe(true);
    expect(onOpenRepeat).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("flattens the outer foreach loop from a generated selection", () => {
    const source = String.raw`\begin{tikzpicture}
\foreach \x in {0,1} {
  \draw (\x,0) -- (\x,1);
}
\end{tikzpicture}`;
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(source);
    const generated = rendered.semantic.scene.elements.find((element) => (element.origin?.foreachStack.length ?? 0) > 0);
    expect(generated).toBeDefined();
    if (!generated?.origin) {
      throw new Error("Expected generated foreach scene element.");
    }
    const outerLoop = generated.origin.foreachStack[0];
    expect(outerLoop).toBeDefined();
    if (!outerLoop) {
      throw new Error("Expected outer foreach frame.");
    }

    const runtime = createEditorCommandRuntime(
      makeInput({
        source,
        dispatch,
        snapshot: makeSnapshot(rendered, source),
        selectedElementIds: new Set([generated.sourceRef.sourceId])
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.FLATTEN_FOREACH].enabled).toBe(true);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.FLATTEN_FOREACH, "menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "flattenForeach",
        target: { kind: "span", span: outerLoop.loopSpan },
        recursive: true
      },
      precomputedResult: expect.objectContaining({
        kind: "success",
        selectedSourceIds: ["path:0", "path:1"]
      })
    }));
  });

  it("runs commands through one shared entrypoint for menu and shortcut origins", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(["path:0"]),
        historyIndex: 0,
        historyLength: 1
      })
    );

    const ranMenu = runtime.runCommand(APP_MENU_COMMAND_IDS.UNDO, "menu");
    const ranShortcut = runtime.runCommand(APP_MENU_COMMAND_IDS.UNDO, "shortcut");

    expect(ranMenu).toBe(true);
    expect(ranShortcut).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "UNDO" });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "UNDO" });
  });

  it("disables commands when prerequisites are missing", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: -1,
        historyLength: 0
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.UNDO].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.COPY].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PASTE].enabled).toBe(true);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.UNDO, "shortcut")).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("enables tree context commands for tree-child selection and routes commands to tree edit actions", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {left} };
\end{tikzpicture}`;
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(source);
    const leftText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left"
    );
    if (!leftText || leftText.kind !== "Text" || !leftText.treeChild) {
      throw new Error("Expected tree child text element");
    }
    const selectedChildId = leftText.treeChild.childSourceId;

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        source,
        snapshot: makeSnapshot(rendered, source),
        selectedElementIds: new Set([selectedChildId])
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TREE_ADD_CHILD].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_BEFORE].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_AFTER].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.DELETE].enabled).toBe(true);

    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_AFTER, "context-menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "addTreeSibling",
        siblingSourceId: selectedChildId,
        position: "after"
      }
    });

    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.DELETE, "context-menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "removeTreeChild",
        childSourceId: selectedChildId
      }
    });
  });

  it("enables only add-child for tree-root selection", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {left} };
\end{tikzpicture}`;
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(source);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        source,
        snapshot: makeSnapshot(rendered, source),
        selectedElementIds: new Set(["path:0"])
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TREE_ADD_CHILD].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_BEFORE].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_AFTER].enabled).toBe(false);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.TREE_ADD_CHILD, "context-menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "addTreeChild",
        parentSourceId: "path:0"
      }
    });
  });

  it("enables matrix structural commands for matrix statement selection", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] (m) {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(source);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        source,
        snapshot: makeSnapshot(rendered, source),
        selectedElementIds: new Set(["path:0"])
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_ADD_ROW_END].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_ADD_COLUMN_END].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_INSERT_ROW_ABOVE].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_INSERT_ROW_BELOW].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_INSERT_COLUMN_LEFT].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_INSERT_COLUMN_RIGHT].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_TRANSPOSE].enabled).toBe(true);

    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.MATRIX_ADD_ROW_END, "context-menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "addMatrixRow",
        matrixSourceId: "path:0",
        rowIndex: 3
      }
    });

    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.MATRIX_ADD_COLUMN_END, "context-menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "addMatrixColumn",
        matrixSourceId: "path:0",
        columnIndex: 3
      }
    });

    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.MATRIX_TRANSPOSE, "context-menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "transposeMatrix",
        matrixSourceId: "path:0"
      }
    });
  });

  it("enables matrix row/column removal commands for matrix-cell selection", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] (m) {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(source);
    const matrixCellId = rendered.semantic.scene.elements.find(
      (entry) => entry.matrixCell?.row === 1 && entry.matrixCell.column === 2
    )?.matrixCell?.cellSourceId;
    if (!matrixCellId) {
      throw new Error("Expected matrix cell source id");
    }

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        source,
        snapshot: makeSnapshot(rendered, source),
        selectedElementIds: new Set([matrixCellId])
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_REMOVE_ROW].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_REMOVE_COLUMN].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_INSERT_ROW_ABOVE].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_INSERT_ROW_BELOW].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_INSERT_COLUMN_LEFT].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_INSERT_COLUMN_RIGHT].enabled).toBe(true);

    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.MATRIX_REMOVE_ROW, "context-menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "removeMatrixRow",
        matrixSourceId: "path:0",
        rowIndex: 1
      }
    });

    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.MATRIX_REMOVE_COLUMN, "context-menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "removeMatrixColumn",
        matrixSourceId: "path:0",
        columnIndex: 2
      }
    });

    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.MATRIX_INSERT_ROW_ABOVE, "context-menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "addMatrixRow",
        matrixSourceId: "path:0",
        rowIndex: 1
      }
    });
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.MATRIX_INSERT_ROW_BELOW, "context-menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "addMatrixRow",
        matrixSourceId: "path:0",
        rowIndex: 2
      }
    });
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.MATRIX_INSERT_COLUMN_LEFT, "context-menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "addMatrixColumn",
        matrixSourceId: "path:0",
        columnIndex: 2
      }
    });
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.MATRIX_INSERT_COLUMN_RIGHT, "context-menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "addMatrixColumn",
        matrixSourceId: "path:0",
        columnIndex: 3
      }
    });
  });

  it("disables matrix row/column removal when only one row or one column remains", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] (m) {
    A & B \\
  };
\end{tikzpicture}`;
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(source);
    const matrixCellId = rendered.semantic.scene.elements.find(
      (entry) => entry.matrixCell?.row === 1 && entry.matrixCell.column === 1
    )?.matrixCell?.cellSourceId;
    if (!matrixCellId) {
      throw new Error("Expected matrix cell source id");
    }

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        source,
        snapshot: makeSnapshot(rendered, source),
        selectedElementIds: new Set([matrixCellId])
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_REMOVE_ROW].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_REMOVE_COLUMN].enabled).toBe(true);

    const singleColumnSource = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] (m) {
    A \\
    B \\
  };
\end{tikzpicture}`;
    const singleColumnRendered = renderTikzToSvg(singleColumnSource);
    const singleColumnCellId = singleColumnRendered.semantic.scene.elements.find(
      (entry) => entry.matrixCell?.row === 1 && entry.matrixCell.column === 1
    )?.matrixCell?.cellSourceId;
    if (!singleColumnCellId) {
      throw new Error("Expected matrix cell source id");
    }

    const singleColumnRuntime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        source: singleColumnSource,
        snapshot: makeSnapshot(singleColumnRendered, singleColumnSource),
        selectedElementIds: new Set([singleColumnCellId])
      })
    );
    expect(singleColumnRuntime.bindings[APP_MENU_COMMAND_IDS.MATRIX_REMOVE_ROW].enabled).toBe(true);
    expect(singleColumnRuntime.bindings[APP_MENU_COMMAND_IDS.MATRIX_REMOVE_COLUMN].enabled).toBe(false);
  });

  it("enables matrix row removal for multi-selected matrix cells in the same row", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] (m) {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(source);
    const rowCellIds = rendered.semantic.scene.elements
      .filter((entry) => entry.matrixCell?.row === 1)
      .map((entry) => entry.matrixCell!.cellSourceId);
    if (rowCellIds.length < 2) {
      throw new Error("Expected matrix row cell source ids");
    }

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        source,
        snapshot: makeSnapshot(rendered, source),
        selectedElementIds: new Set(rowCellIds.slice(0, 2))
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_REMOVE_ROW].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_REMOVE_COLUMN].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_INSERT_ROW_ABOVE].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_INSERT_ROW_BELOW].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_INSERT_COLUMN_LEFT].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_INSERT_COLUMN_RIGHT].enabled).toBe(false);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.MATRIX_REMOVE_ROW, "context-menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "removeMatrixRow",
        matrixSourceId: "path:0",
        rowIndex: 1
      }
    });
  });

  it("maps delete to remove-row only for exact full-row matrix selection", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] (m) {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(source);
    const fullRowIds = uniqueMatrixCellIds(rendered, ({ row }) => row === 1);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        source,
        snapshot: makeSnapshot(rendered, source),
        selectedElementIds: new Set(fullRowIds)
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.DELETE].enabled).toBe(true);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.DELETE, "shortcut")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "removeMatrixRow",
        matrixSourceId: "path:0",
        rowIndex: 1
      }
    });
  });

  it("disables delete + clipboard commands for partial matrix selection", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] (m) {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(source);
    const partialCellId = uniqueMatrixCellIds(rendered, ({ row, column }) => row === 1 && column === 1)[0];
    if (!partialCellId) {
      throw new Error("Expected matrix cell source id");
    }
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        source,
        snapshot: makeSnapshot(rendered, source),
        selectedElementIds: new Set([partialCellId])
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.DELETE].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.CUT].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.COPY].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PASTE].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.DUPLICATE].enabled).toBe(false);
  });

  it("disables delete + clipboard commands for mixed matrix and non-matrix selections", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] (m) {
    A & B \\
    C & D \\
  };
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(source);
    const matrixCellId = uniqueMatrixCellIds(rendered, ({ row, column }) => row === 1 && column === 1)[0];
    if (!matrixCellId) {
      throw new Error("Expected matrix cell source id");
    }
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        source,
        snapshot: makeSnapshot(rendered, source),
        selectedElementIds: new Set([matrixCellId, "path:1"])
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.DELETE].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.CUT].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.COPY].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PASTE].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.DUPLICATE].enabled).toBe(false);
  });

  it("enables matrix column removal for multi-selected matrix cells in the same column", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] (m) {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(source);
    const columnCellIds = rendered.semantic.scene.elements
      .filter((entry) => entry.matrixCell?.column === 1)
      .map((entry) => entry.matrixCell!.cellSourceId);
    if (columnCellIds.length < 2) {
      throw new Error("Expected matrix column cell source ids");
    }

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        source,
        snapshot: makeSnapshot(rendered, source),
        selectedElementIds: new Set(columnCellIds.slice(0, 2))
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_REMOVE_ROW].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_REMOVE_COLUMN].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_INSERT_ROW_ABOVE].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_INSERT_ROW_BELOW].enabled).toBe(false);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_INSERT_COLUMN_LEFT].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.MATRIX_INSERT_COLUMN_RIGHT].enabled).toBe(true);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.MATRIX_REMOVE_COLUMN, "context-menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "removeMatrixColumn",
        matrixSourceId: "path:0",
        columnIndex: 1
      }
    });
  });

  it("enables point-targeted path commands when a matching active handle is set", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (2,0);
\end{tikzpicture}`;
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(source);
    const activeHandleId = rendered.semantic.editHandles.find(
      (handle) => source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to) === "(1,0)"
    )?.id ?? null;

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        source,
        snapshot: makeSnapshot(rendered, source),
        selectedElementIds: new Set(["path:0"]),
        activeHandleId
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PATH_SPLIT].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PATH_REVERSE].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PATH_DELETE_POINT].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PATH_POINT_SMOOTH].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PATH_POINT_CORNER].enabled).toBe(false);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.PATH_SPLIT, "menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "splitPath",
        elementId: "path:0",
        handleId: activeHandleId
      }
    });
  });

  it("runs reverse path without requiring an active path point", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(["path:0"]),
        activeHandleId: null
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.PATH_REVERSE].enabled).toBe(true);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.PATH_REVERSE, "menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "reversePath",
        elementId: "path:0"
      }
    });
  });

  it("routes the insert path command to addPath tool mode", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: -1,
        historyLength: 0
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.INSERT_PATH, "menu");

    expect(ran).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_TOOL_MODE", mode: "addPath" });
  });

  it("routes the insert freehand command to addFreehand tool mode", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: -1,
        historyLength: 0
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.INSERT_FREEHAND, "menu");

    expect(ran).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_TOOL_MODE", mode: "addFreehand" });
  });

  it("routes the insert equation command to modal callback", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const onOpenInsertEquation = vi.fn();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        onOpenInsertEquation
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.INSERT_EQUATION, "menu");

    expect(ran).toBe(true);
    expect(onOpenInsertEquation).toHaveBeenCalledTimes(1);
  });

  it("enables edit equation only for single selected math-only node", () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0,0) {$x+y$};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const onOpenEditEquation = vi.fn();
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        source,
        snapshot: makeSnapshot(rendered, source),
        selectedElementIds: new Set(["path:0"]),
        onOpenEditEquation
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.EDIT_EQUATION].enabled).toBe(true);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.EDIT_EQUATION, "context-menu")).toBe(true);
    expect(onOpenEditEquation).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: "path:0",
      latex: "x+y"
    }));
  });

  it("routes zoom commands to zoom requests", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: 0,
        historyLength: 1
      })
    );

    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.ZOOM_IN, "shortcut")).toBe(true);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.ZOOM_OUT, "menu")).toBe(true);
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "REQUEST_ZOOM", direction: "in" });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "REQUEST_ZOOM", direction: "out" });
  });

  it("dispatches a layout-state fallback when dock handle is unavailable", () => {
    vi.spyOn(DockLayoutModule, "getDockLayoutHandle").mockReturnValue(null);
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        showSourcePanel: true,
        showInspectorPanel: true,
        showObjectsPanel: true,
        showStylesPanel: true,
        showFiguresPanel: false,
        showAssistantPanel: false
      })
    );

    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.TOGGLE_OBJECTS_PANEL, "menu")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "SYNC_LAYOUT_STATE",
      sourceVisible: true,
      inspectorVisible: true,
      objectsVisible: false,
      stylesVisible: true,
      figuresVisible: false,
      assistantVisible: false,
      activeRightTab: "inspector"
    });
  });

  it("delegates panel toggle to the dock handle when available", () => {
    const togglePanel = vi.fn();
    vi.spyOn(DockLayoutModule, "getDockLayoutHandle").mockReturnValue({
      getModel: vi.fn(),
      togglePanel
    } as unknown as ReturnType<typeof DockLayoutModule.getDockLayoutHandle>);
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set()
      })
    );

    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.TOGGLE_OBJECTS_PANEL, "menu")).toBe(true);
    expect(togglePanel).toHaveBeenCalledWith("objects");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("routes save and manage workspace commands to host callbacks", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const onOpenSaveWorkspace = vi.fn();
    const onOpenManageWorkspaces = vi.fn();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        onOpenSaveWorkspace,
        onOpenManageWorkspaces
      })
    );

    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.SAVE_WORKSPACE_AS, "menu")).toBe(true);
    expect(onOpenSaveWorkspace).toHaveBeenCalledTimes(1);
    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.MANAGE_WORKSPACES, "menu")).toBe(true);
    expect(onOpenManageWorkspaces).toHaveBeenCalledTimes(1);
  });

  it("routes open settings command to host callback", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const onOpenSettings = vi.fn();
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        onOpenSettings
      })
    );

    expect(runtime.runCommand(APP_MENU_COMMAND_IDS.OPEN_SETTINGS, "shortcut")).toBe(true);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("routes open example command to host callback", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const onOpenExample = vi.fn();
    const rendered = renderTikzToSvg(SOURCE);

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: -1,
        historyLength: 0,
        onOpenExample
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.OPEN_EXAMPLE, "menu");

    expect(ran).toBe(true);
    expect(onOpenExample).toHaveBeenCalledTimes(1);
  });

  it("enables SVG, PDF, and PNG export commands when SVG output is available", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const onOpenSvgExport = vi.fn();
    const onOpenPngExport = vi.fn();
    const rendered = renderTikzToSvg(SOURCE);

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: 0,
        historyLength: 1,
        onOpenSvgExport,
        onOpenPngExport
      })
    );

    expect(runtime.bindings[APP_MENU_COMMAND_IDS.EXPORT_SVG_DOWNLOAD].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.EXPORT_STANDALONE_LATEX_DOWNLOAD].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.EXPORT_PDF_DOWNLOAD].enabled).toBe(true);
    expect(runtime.bindings[APP_MENU_COMMAND_IDS.EXPORT_PNG_DOWNLOAD].enabled).toBe(true);
  });

  it("routes SVG export through the host callback", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const onOpenSvgExport = vi.fn();
    const rendered = renderTikzToSvg(SOURCE);

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: 0,
        historyLength: 1,
        onOpenSvgExport
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.EXPORT_SVG_DOWNLOAD, "menu");

    expect(ran).toBe(true);
    expect(onOpenSvgExport).toHaveBeenCalledTimes(1);
    expect(onOpenSvgExport).toHaveBeenCalledWith(rendered.svg);
  });

  it("shows a warning when menu paste cannot read system clipboard", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    vi.stubGlobal("navigator", {
      clipboard: {
        read: vi.fn().mockRejectedValue(new Error("blocked"))
      }
    });
    const alert = vi.fn();
    vi.stubGlobal("alert", alert);
    const rendered = renderTikzToSvg(SOURCE);
    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: 0,
        historyLength: 1
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.PASTE, "menu");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ran).toBe(true);
    expect(alert).toHaveBeenCalledWith("Clipboard access was blocked. Focus the canvas and press Cmd/Ctrl+V to paste.");
  });

  it("routes import svg command through svg conversion and opens a new document", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    svgToTikzMock.mockReturnValue(String.raw`\begin{tikzpicture}
  \draw (4,4)--(5,5);
\end{tikzpicture}`);
    setActiveEditorPlatform({
      id: "test-platform",
      persistence: {
        load: () => null,
        save: () => undefined
      },
      files: {
        openText: async () => ({
          source: `<svg xmlns="http://www.w3.org/2000/svg"></svg>`,
          fileRef: { kind: "file", name: "shape.svg" }
        })
      }
    });

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: 0,
        historyLength: 1
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.IMPORT_SVG, "menu");
    expect(ran).toBe(true);

    await vi.waitFor(() => {
      expect(svgToTikzMock).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "NEW_DOCUMENT" }));
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "NEW_DOCUMENT",
      source: String.raw`\begin{tikzpicture}
  \draw (4,4)--(5,5);
\end{tikzpicture}`,
      title: "shape.tex"
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "MARK_DOCUMENT_SAVED",
      fileRef: { kind: "virtual", name: "shape.tex" }
    });
  });

  it("routes import ipe command through ipe conversion and opens a new virtual tex document", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    convertIpeToTikzMock.mockReturnValue({
      tikz: String.raw`\begin{tikzpicture}
  \draw (1pt,2pt) -- (3pt,4pt);
\end{tikzpicture}`,
      diagnostics: []
    });
    setActiveEditorPlatform({
      id: "test-platform",
      persistence: {
        load: () => null,
        save: () => undefined
      },
      files: {
        openText: async () => ({
          source: `<ipe version="70200"></ipe>`,
          fileRef: { kind: "file", name: "shape.ipe" }
        })
      }
    });

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: 0,
        historyLength: 1
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.IMPORT_IPE, "menu");
    expect(ran).toBe(true);

    await vi.waitFor(() => {
      expect(convertIpeToTikzMock).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "NEW_DOCUMENT" }));
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "NEW_DOCUMENT",
      source: String.raw`\begin{tikzpicture}
  \draw (1pt,2pt) -- (3pt,4pt);
\end{tikzpicture}`,
      title: "shape.tex"
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "MARK_DOCUMENT_SAVED",
      fileRef: { kind: "virtual", name: "shape.tex" }
    });
  });

  it("keeps non-svg open path unchanged", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    setActiveEditorPlatform({
      id: "test-platform",
      persistence: {
        load: () => null,
        save: () => undefined
      },
      files: {
        openText: async () => ({
          source: "\\draw (9,9)--(10,10);",
          fileRef: { kind: "file", name: "opened.tex", provider: "download" }
        })
      }
    });

    const runtime = createEditorCommandRuntime(
      makeInput({
        dispatch,
        snapshot: makeSnapshot(rendered),
        selectedElementIds: new Set(),
        historyIndex: 0,
        historyLength: 1
      })
    );

    const ran = runtime.runCommand(APP_MENU_COMMAND_IDS.OPEN_DOCUMENT, "menu");
    expect(ran).toBe(true);

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "NEW_DOCUMENT" }));
    });

    expect(svgToTikzMock).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "NEW_DOCUMENT",
      source: "\\draw (9,9)--(10,10);",
      title: "opened.tex"
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "MARK_DOCUMENT_SAVED",
      fileRef: { kind: "file", name: "opened.tex", provider: "download" }
    });
  });
});

function makeSnapshot(rendered: ReturnType<typeof renderTikzToSvg>, source = SOURCE) {
  return {
    source,
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
  };
}

function makeInput({
  dispatch,
  source = SOURCE,
  snapshot,
  selectedElementIds,
  activeHandleId = null,
  historyIndex,
  historyLength,
  fitToContentModeActive = false,
  showGrid = false,
  showTransparencyGrid = false,
  snapModes = { grid: true, guides: true, points: true, gaps: true },
  showRulers = true,
  showGuides = true,
  showDocumentBounds = true,
  showSourcePanel = true,
  showInspectorPanel = true,
  showObjectsPanel = true,
  showStylesPanel = true,
  showFiguresPanel = true,
  showAssistantPanel = false,
  showDevPanel = false,
  snapHapticsEnabled = true,
  updateCanvasSettings = () => undefined,
  onOpenExample,
  onOpenSvgExport,
  onOpenPngExport,
  onOpenSettings,
  onOpenInsertEquation,
  onOpenEditEquation,
  onOpenRepeat,
  onOpenSaveWorkspace,
  onOpenManageWorkspaces,
  onCheckForUpdates,
  onRequestQuitApp,
  updateCheckBusy
}: {
  dispatch: (action: EditorAction) => void;
  source?: string;
  snapshot: ReturnType<typeof makeSnapshot>;
  selectedElementIds: ReadonlySet<string>;
  activeHandleId?: string | null;
  historyIndex?: number;
  historyLength?: number;
  fitToContentModeActive?: boolean;
  showGrid?: boolean;
  showTransparencyGrid?: boolean;
  snapModes?: {
    grid: boolean;
    guides: boolean;
    points: boolean;
    gaps: boolean;
  };
  showRulers?: boolean;
  showGuides?: boolean;
  showDocumentBounds?: boolean;
  showSourcePanel?: boolean;
  showInspectorPanel?: boolean;
  showObjectsPanel?: boolean;
  showStylesPanel?: boolean;
  showFiguresPanel?: boolean;
  showAssistantPanel?: boolean;
  showDevPanel?: boolean;
  snapHapticsEnabled?: boolean;
  updateCanvasSettings?: (patch: { snapHapticsEnabled?: boolean }) => void;
  onOpenExample?: () => void;
  onOpenSvgExport?: (svgResult: ReturnType<typeof renderTikzToSvg>["svg"]) => void;
  onOpenPngExport?: (svgResult: ReturnType<typeof renderTikzToSvg>["svg"]) => void;
  onOpenSettings?: () => void;
  onOpenInsertEquation?: () => void;
  onOpenEditEquation?: (target: any) => void;
  onOpenRepeat?: () => void;
  onOpenSaveWorkspace?: () => void;
  onOpenManageWorkspaces?: () => void;
  onCheckForUpdates?: () => void;
  onRequestQuitApp?: () => void;
  updateCheckBusy?: boolean;
}) {
  const activeFigureId = snapshot.parseResult?.activeFigureId ?? null;

  return {
    source,
    activeFigureId,
    editAnalysisView: null,
    snapshot,
    toolMode: "select" as const,
    selectedElementIds,
    activeHandleId,
    historyIndex: historyIndex ?? -1,
    historyLength: historyLength ?? 0,
    activeDocumentId: "doc-1",
    tabCount: 1,
    dirty: false,
    fileRef: null,
    fitToContentModeActive,
    rightSidebarTab: "inspector" as const,
    assistantAvailable: true,
    showGrid,
    showTransparencyGrid,
    snapModes,
    snapHapticsEnabled,
    showRulers,
    showGuides,
    showDocumentBounds,
    showSourcePanel,
    showInspectorPanel,
    showObjectsPanel,
    showStylesPanel,
    showFiguresPanel,
    showAssistantPanel,
    showDevPanel,
    updateCanvasSettings,
    dispatch,
    onOpenExample,
    onOpenSvgExport,
    onOpenPngExport,
    onOpenSettings,
    onOpenInsertEquation,
    onOpenEditEquation,
    onOpenRepeat,
    onOpenSaveWorkspace,
    onOpenManageWorkspaces,
    onCheckForUpdates,
    onRequestQuitApp,
    updateCheckBusy
  };
}
