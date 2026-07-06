import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alignSelection,
  canCopySelection,
  canCutSelection,
  canDeleteSelection,
  canDuplicateSelection,
  canPasteSelection,
  copySelection,
  copySelectionToClipboardData,
  cutSelection,
  cutSelectionToClipboardData,
  deleteSelection,
  distributeSelection,
  flipSelection,
  isCodeMirrorEventTarget,
  pasteSelectionFromClipboardData,
  pasteSelectionFromSystemClipboard,
  rotateSelection
} from "../packages/app/src/ui/editor-commands.js";
import { PT_PER_CM } from "../packages/core/src/edit/format.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import {
  SVG_CLIPBOARD_MIME,
  PLAIN_TEXT_CLIPBOARD_MIME,
  TIKZ_CLIPBOARD_MIME
} from "../packages/app/src/ui/editor-clipboard.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import type { EditorAction } from "../packages/app/src/store/types.js";
import { setActiveEditorPlatform } from "../packages/app/src/platform/current.js";

const SOURCE = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
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

describe("editor-commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setActiveEditorPlatform({
      id: "test-default",
      persistence: {
        load: () => null,
        save: () => undefined
      }
    });
  });

  it("copySelection writes custom + plain payloads to the system clipboard", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    class ClipboardItemMock {
      constructor(public data: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", ClipboardItemMock);
    vi.stubGlobal("navigator", { clipboard: { write } });
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const didCopy = await copySelection({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:1", "path:0"]),
      dispatch
    });

    expect(didCopy).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    const writtenItems = write.mock.calls[0]?.[0] as ClipboardItemMock[];
    expect(Array.isArray(writtenItems)).toBe(true);
    expect(writtenItems[0]?.data[TIKZ_CLIPBOARD_MIME]).toBeInstanceOf(Blob);
    expect(writtenItems[0]?.data[PLAIN_TEXT_CLIPBOARD_MIME]).toBeInstanceOf(Blob);
    expect(writtenItems[0]?.data[SVG_CLIPBOARD_MIME]).toBeInstanceOf(Blob);
  });

  it("copySelection falls back to writeText when multi-format write is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const didCopy = await copySelection({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:1", "path:0"]),
      dispatch
    });

    expect(didCopy).toBe(true);
    expect(writeText).toHaveBeenCalledWith("\\draw (0,0) -- (1,0);\n\\draw (0,1) -- (1,1);");
  });

  it("copySelection retries clipboard write without SVG when SVG MIME is rejected", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("svg unsupported"))
      .mockResolvedValueOnce(undefined);
    class ClipboardItemMock {
      constructor(public data: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", ClipboardItemMock);
    vi.stubGlobal("navigator", { clipboard: { write } });
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const didCopy = await copySelection({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:1", "path:0"]),
      dispatch
    });

    expect(didCopy).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
    const firstItems = write.mock.calls[0]?.[0] as ClipboardItemMock[];
    const secondItems = write.mock.calls[1]?.[0] as ClipboardItemMock[];
    expect(firstItems[0]?.data[SVG_CLIPBOARD_MIME]).toBeInstanceOf(Blob);
    expect(secondItems[0]?.data[SVG_CLIPBOARD_MIME]).toBeUndefined();
    expect(secondItems[0]?.data[TIKZ_CLIPBOARD_MIME]).toBeInstanceOf(Blob);
    expect(secondItems[0]?.data[PLAIN_TEXT_CLIPBOARD_MIME]).toBeInstanceOf(Blob);
  });

  it("copySelection writes desktop clipboard bundle with custom svg format payload", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const writeBundle = vi.fn().mockResolvedValue(undefined);
    class ClipboardItemMock {
      constructor(public data: Record<string, Blob>) {}
    }
    setActiveEditorPlatform({
      id: "desktop-test",
      persistence: {
        load: () => null,
        save: () => undefined
      },
      clipboard: {
        writeBundle
      }
    });
    vi.stubGlobal("ClipboardItem", ClipboardItemMock);
    vi.stubGlobal("navigator", { clipboard: { write } });
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const didCopy = await copySelection({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:1", "path:0"]),
      dispatch
    });

    expect(didCopy).toBe(true);
    expect(writeBundle).toHaveBeenCalledTimes(1);
    expect(writeBundle).toHaveBeenCalledWith(expect.objectContaining({
      plainText: "\\draw (0,0) -- (1,0);\n\\draw (0,1) -- (1,1);",
      tikzJson: expect.any(String),
      svgText: expect.stringContaining("<svg")
    }));
  });

  it("copySelectionToClipboardData writes custom and text payloads without navigator permission flow", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (mime: string, value: string) => {
        data.set(mime, value);
      }
    } as unknown as DataTransfer;

    const didCopy = copySelectionToClipboardData({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:1", "path:0"]),
      dispatch
    }, dataTransfer);

    expect(didCopy).toBe(true);
    expect(data.get(TIKZ_CLIPBOARD_MIME)).toBeTypeOf("string");
    expect(data.get(PLAIN_TEXT_CLIPBOARD_MIME)).toBe("\\draw (0,0) -- (1,0);\n\\draw (0,1) -- (1,1);");
  });

  it("copySelectionToClipboardData also mirrors payloads to desktop clipboard bundle writer", async () => {
    const writeBundle = vi.fn().mockResolvedValue(undefined);
    setActiveEditorPlatform({
      id: "desktop-test",
      persistence: {
        load: () => null,
        save: () => undefined
      },
      clipboard: {
        writeBundle
      }
    });
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (mime: string, value: string) => {
        data.set(mime, value);
      }
    } as unknown as DataTransfer;

    const didCopy = copySelectionToClipboardData({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:1", "path:0"]),
      dispatch
    }, dataTransfer);

    expect(didCopy).toBe(true);
    await Promise.resolve();
    expect(writeBundle).toHaveBeenCalledTimes(1);
    expect(writeBundle).toHaveBeenCalledWith(expect.objectContaining({
      plainText: "\\draw (0,0) -- (1,0);\n\\draw (0,1) -- (1,1);",
      tikzJson: expect.any(String),
      svgText: expect.stringContaining("<svg")
    }));
  });

  it("cutSelectionToClipboardData copies and deletes selection", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const dataTransfer = {
      setData: vi.fn()
    } as unknown as DataTransfer;

    const didCut = cutSelectionToClipboardData({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:0"]),
      dispatch
    }, dataTransfer);

    expect(didCut).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "deleteElement",
        elementId: "path:0"
      }
    });
  });

  it("pasteSelectionFromClipboardData no-ops for empty payloads", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const didPaste = await pasteSelectionFromClipboardData({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:0"]),
      dispatch
    }, {
      getData: () => ""
    } as unknown as DataTransfer);

    expect(didPaste).toEqual({ kind: "failure", reason: "empty" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("pasteSelectionFromClipboardData preserves position for preserve payloads", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const payload = {
      version: 1,
      snippets: ["\\draw (0,0) -- (1,0);"],
      plainText: "\\draw (0,0) -- (1,0);",
      pasteBehavior: "preserve",
      pasteCount: 0
    };

    const didPaste = await pasteSelectionFromClipboardData({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(),
      dispatch
    }, {
      getData: (mime: string) => mime === TIKZ_CLIPBOARD_MIME ? JSON.stringify(payload) : ""
    } as unknown as DataTransfer);

    expect(didPaste).toEqual({ kind: "success" });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPLY_EDIT_ACTION",
      action: expect.objectContaining({
        kind: "pasteStatements",
        snippets: ["\\draw (0,0) -- (1,0);"],
        anchorElementId: undefined,
        delta: { x: 0, y: 0 }
      })
    }));
  });

  it("pasteSelectionFromClipboardData increases offset based on payload pasteCount", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const payload = {
      version: 1,
      snippets: ["\\draw (0,0) -- (1,0);"],
      plainText: "\\draw (0,0) -- (1,0);",
      pasteBehavior: "offset",
      pasteCount: 2
    };
    const didPaste = await pasteSelectionFromClipboardData({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(),
      dispatch
    }, {
      getData: (mime: string) => mime === TIKZ_CLIPBOARD_MIME ? JSON.stringify(payload) : ""
    } as unknown as DataTransfer);

    expect(didPaste).toEqual({ kind: "success" });
    const expectedStep = 0.25 * PT_PER_CM;
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPLY_EDIT_ACTION",
      action: expect.objectContaining({
        kind: "pasteStatements",
        delta: { x: expectedStep * 3, y: -expectedStep * 3 }
      })
    }));
  });

  it("pasteSelectionFromClipboardData falls back to text/plain payloads", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const didPaste = await pasteSelectionFromClipboardData({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(),
      dispatch
    }, {
      getData: (mime: string) => mime === PLAIN_TEXT_CLIPBOARD_MIME ? "\\draw (2,2) -- (3,3);" : ""
    } as unknown as DataTransfer);

    expect(didPaste).toEqual({ kind: "success" });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPLY_EDIT_ACTION",
      action: expect.objectContaining({
        kind: "pasteStatements",
        snippets: ["\\draw (2,2) -- (3,3);"]
      })
    }));
  });

  it("pasteSelectionFromClipboardData rejects invalid custom JSON safely", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const didPaste = await pasteSelectionFromClipboardData({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(),
      dispatch
    }, {
      getData: (mime: string) => mime === TIKZ_CLIPBOARD_MIME ? "{bad json" : ""
    } as unknown as DataTransfer);

    expect(didPaste).toEqual({ kind: "failure", reason: "invalid" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("pasteSelectionFromSystemClipboard reads custom MIME payloads", async () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);
    const payload = {
      version: 1,
      snippets: ["\\draw (4,4) -- (5,5);"],
      plainText: "\\draw (4,4) -- (5,5);",
      pasteBehavior: "offset",
      pasteCount: 0
    };
    vi.stubGlobal("navigator", {
      clipboard: {
        read: vi.fn().mockResolvedValue([
          {
            types: [TIKZ_CLIPBOARD_MIME],
            getType: async () => new Blob([JSON.stringify(payload)], { type: TIKZ_CLIPBOARD_MIME })
          }
        ])
      }
    });

    const didPaste = await pasteSelectionFromSystemClipboard({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(),
      dispatch
    });

    expect(didPaste).toEqual({ kind: "success" });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPLY_EDIT_ACTION",
      action: expect.objectContaining({
        snippets: ["\\draw (4,4) -- (5,5);"]
      })
    }));
  });

  it("deleteSelection dispatches delete action and clears selection", () => {
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const didDelete = deleteSelection({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:0", "path:1"]),
      dispatch
    });

    expect(didDelete).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "deleteElements",
        elementIds: ["path:0", "path:1"]
      }
    });
  });

  it("deleteSelection removes a full selected matrix row", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] (m) {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(source);
    const selectedElementIds = new Set(uniqueMatrixCellIds(rendered, ({ row }) => row === 1));

    const didDelete = deleteSelection({
      source,
      snapshotSource: source,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds,
      dispatch
    });

    expect(didDelete).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "removeMatrixRow",
        matrixSourceId: "path:0",
        rowIndex: 1
      }
    });
  });

  it("deleteSelection removes a full selected matrix column", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] (m) {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(source);
    const selectedElementIds = new Set(uniqueMatrixCellIds(rendered, ({ column }) => column === 2));

    const didDelete = deleteSelection({
      source,
      snapshotSource: source,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds,
      dispatch
    });

    expect(didDelete).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "removeMatrixColumn",
        matrixSourceId: "path:0",
        columnIndex: 2
      }
    });
  });

  it("deleteSelection is disabled for partial matrix-cell selection", () => {
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
      throw new Error("Expected matrix cell id");
    }

    const didDelete = deleteSelection({
      source,
      snapshotSource: source,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set([partialCellId]),
      dispatch
    });

    expect(didDelete).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("disables delete/cut/copy/paste/duplicate for mixed matrix and non-matrix selections", () => {
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
      throw new Error("Expected matrix cell id");
    }
    const context = {
      source,
      snapshotSource: source,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set([matrixCellId, "path:1"]),
      dispatch
    };

    expect(canDeleteSelection(context)).toBe(false);
    expect(canCutSelection(context)).toBe(false);
    expect(canCopySelection(context)).toBe(false);
    expect(canPasteSelection(context)).toBe(false);
    expect(canDuplicateSelection(context)).toBe(false);
  });

  it("cutSelection copies then deletes the selection", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const dispatch = vi.fn<(action: EditorAction) => void>();
    const rendered = renderTikzToSvg(SOURCE);

    const didCut = await cutSelection({
      source: SOURCE,
      snapshotSource: SOURCE,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:0"]),
      dispatch
    });

    expect(didCut).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "deleteElement",
        elementId: "path:0"
      }
    });
  });

  it("alignSelection dispatches when availability says the action is enabled", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,1) -- (3,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const dispatch = vi.fn<(action: EditorAction) => void>();

    const didAlign = alignSelection({
      source,
      snapshotSource: source,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:0", "path:1"]),
      dispatch
    }, "left");

    expect(didAlign).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "alignElements",
        elementIds: ["path:0", "path:1"],
        mode: "left"
      }
    }));
  });

  it("alignSelection does not dispatch when selection contains non-rewritable elements", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,1} {
    \draw (\x,0) -- (\x,1);
  }
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const dispatch = vi.fn<(action: EditorAction) => void>();

    const didAlign = alignSelection({
      source,
      snapshotSource: source,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:0", "path:1"]),
      dispatch
    }, "left");

    expect(didAlign).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("distributeSelection does not dispatch when the distribution is a no-op", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,4) -- (1,4);
  \draw (0,2) -- (1,2);
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const dispatch = vi.fn<(action: EditorAction) => void>();

    const didDistribute = distributeSelection({
      source,
      snapshotSource: source,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:0", "path:1", "path:2"]),
      dispatch
    }, "vertical");

    expect(didDistribute).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rotateSelection dispatches grouped rotate mutations for multi-selection", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=90] (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const dispatch = vi.fn<(action: EditorAction) => void>();

    const didRotate = rotateSelection({
      source,
      snapshotSource: source,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:0", "path:1"]),
      dispatch
    }, "left");

    expect(didRotate).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(2);
    const first = dispatch.mock.calls[0]?.[0];
    const second = dispatch.mock.calls[1]?.[0];
    expect(first).toMatchObject({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "setProperty",
        elementId: "path:0",
        level: "command",
        key: "rotate",
        value: "180",
        clearKeys: ["/tikz/rotate", "rotate around", "/tikz/rotate around"]
      }
    });
    expect(second).toMatchObject({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "setProperty",
        elementId: "path:1",
        level: "command",
        key: "rotate",
        value: "90",
        clearKeys: ["/tikz/rotate", "rotate around", "/tikz/rotate around"]
      }
    });
    expect(first?.type).toBe("APPLY_EDIT_ACTION");
    expect(second?.type).toBe("APPLY_EDIT_ACTION");
    if (first?.type === "APPLY_EDIT_ACTION" && second?.type === "APPLY_EDIT_ACTION") {
      expect(first.historyMergeKey).toBe(second.historyMergeKey);
    }
  });

  it("flipSelection negates xscale while preserving existing yscale", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[xscale=2,yscale=3] (0,0) -- (1,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const dispatch = vi.fn<(action: EditorAction) => void>();

    const didFlip = flipSelection({
      source,
      snapshotSource: source,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:0"]),
      dispatch
    }, "horizontal");

    expect(didFlip).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: "APPLY_EDIT_ACTION",
      action: expect.objectContaining({
        kind: "setProperty",
        elementId: "path:0",
        level: "command",
        key: "xscale",
        value: "-2",
        clearKeys: expect.arrayContaining(["scale", "/tikz/scale", "/tikz/xscale"])
      })
    }));
  });

  it("flipSelection negates yscale from the default scale", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const dispatch = vi.fn<(action: EditorAction) => void>();

    const didFlip = flipSelection({
      source,
      snapshotSource: source,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:0"]),
      dispatch
    }, "vertical");

    expect(didFlip).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "APPLY_EDIT_ACTION",
      action: expect.objectContaining({
        kind: "setProperty",
        elementId: "path:0",
        level: "command",
        key: "yscale",
        value: "-1"
      })
    }));
  });

  it("transform commands do not dispatch when selection is not transformable", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label=above:A] {B};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const dispatch = vi.fn<(action: EditorAction) => void>();

    const didRotate = rotateSelection({
      source,
      snapshotSource: `${source} `,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["node:0"]),
      dispatch
    }, "right");
    const didFlip = flipSelection({
      source,
      snapshotSource: source,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["node-adornment:node:0:2:label:0"]),
      dispatch
    }, "horizontal");

    expect(didRotate).toBe(false);
    expect(didFlip).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rotateSelection dispatches transform edits for scope selections", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const dispatch = vi.fn<(action: EditorAction) => void>();

    const didRotate = rotateSelection({
      source,
      snapshotSource: source,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["scope:0"]),
      dispatch
    }, "left");

    expect(didRotate).toBe(true);
    expect(dispatch).toHaveBeenCalled();
    expect(dispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: "APPLY_EDIT_ACTION",
      action: expect.objectContaining({
        kind: "setProperty",
        elementId: "scope:0",
        level: "command",
        key: "rotate",
        value: "90"
      })
    }));
  });

  it("rotateSelection writes into an existing node option list", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (C) at (0, 1.5) {C};
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const dispatch = vi.fn<(action: EditorAction) => void>();

    const didRotate = rotateSelection({
      source,
      snapshotSource: source,
      scene: rendered.semantic.scene,
      editHandles: rendered.semantic.editHandles,
      selectedElementIds: new Set(["path:0"]),
      dispatch
    }, "right");

    expect(didRotate).toBe(true);
    const actions = dispatch.mock.calls
      .map((call) => call[0])
      .filter((action): action is Extract<EditorAction, { type: "APPLY_EDIT_ACTION" }> => action?.type === "APPLY_EDIT_ACTION");
    expect(actions).toHaveLength(1);
    expect(actions[0]?.action).toMatchObject({
      kind: "setProperty",
      key: "rotate",
      value: "-90"
    });
    expect(actions[0]?.action.kind).toBe("setProperty");
    if (actions[0]?.action.kind === "setProperty") {
      expect(actions[0].action.elementId).toMatch(/^node:/);
    }

    let updated = source;
    for (const action of actions) {
      const result = applyEditAction(updated, rendered.semantic.editHandles, action.action);
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error("Expected successful node transform rewrite");
      }
      updated = result.newSource;
    }

    expect(updated).toContain(String.raw`\node[draw, rotate=-90] (C) at (0, 1.5) {C};`);
    expect(updated).not.toContain(String.raw`\node[rotate=-90][draw]`);
  });

  it("detects CodeMirror targets so keyboard commands can bail out", () => {
    const target = {
      closest: vi.fn((selector: string) => (selector === ".cm-editor" ? {} : null))
    };

    expect(isCodeMirrorEventTarget(target as unknown as EventTarget)).toBe(true);
    expect(isCodeMirrorEventTarget(null)).toBe(false);
  });
});
