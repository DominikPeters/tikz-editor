import { describe, expect, it } from "vitest";
import {
  applyBeamerStructuralEdits,
  beamerObjectAtOffset,
  beamerObjectDeletionPatch,
  beamerObjectDuplicationPatch,
  buildBeamerObjectIndex,
  prepareBeamerDocument,
  type BeamerObjectIndex,
  type BeamerObjectNode,
} from "../packages/core/src/beamer/index.js";

function frameDocument(body: string): string {
  return `\\documentclass{beamer}\n\\begin{document}\n\\begin{frame}{T}\n${body}\n\\end{frame}\n\\end{document}`;
}

const COLUMNS_BODY = [
  "\\begin{columns}[T]",
  "\\begin{column}{.55\\textwidth}",
  "Intro prose.",
  "\\begin{itemize}",
  "\\item First one",
  "\\item Second two",
  "\\begin{itemize}",
  "\\item Nested alpha",
  "\\item Nested beta",
  "\\end{itemize}",
  "\\item Third three",
  "\\end{itemize}",
  "\\end{column}",
  "\\begin{column}{.42\\textwidth}",
  "\\begin{tikzpicture}",
  "\\draw (0,0) -- (1,1);",
  "\\end{tikzpicture}",
  "\\end{column}",
  "\\end{columns}",
].join("\n");

const BLOCK_BODY = [
  "\\begin{block}{Key facts}",
  "\\begin{itemize}",
  "\\item Alpha row",
  "\\item Beta row",
  "\\end{itemize}",
  "\\end{block}",
  "Outro prose.",
].join("\n");

async function indexFor(source: string): Promise<BeamerObjectIndex> {
  const page = await prepareBeamerDocument(source).renderFrame({
    frameIndex: 0,
    step: 1,
  });
  return buildBeamerObjectIndex({
    items: page.layout.items,
    paragraphs: page.layout.paragraphs,
    source,
  });
}

function nodeAt(index: BeamerObjectIndex, offset: number): BeamerObjectNode {
  const node = beamerObjectAtOffset(index, offset);
  expect(node).not.toBeNull();
  return node as BeamerObjectNode;
}

function parentChainKinds(index: BeamerObjectIndex, node: BeamerObjectNode): string[] {
  const kinds: string[] = [];
  let current: BeamerObjectNode | undefined = node;
  while (current) {
    kinds.push(current.kind);
    current = current.parentId ? index.byId.get(current.parentId) : undefined;
  }
  return kinds;
}

/** Applies a patch and asserts the edited document still renders. */
async function applyAndRender(
  source: string,
  edits: readonly { span: { from: number; to: number }; insert: string }[]
): Promise<string> {
  const next = applyBeamerStructuralEdits(source, edits);
  const page = await prepareBeamerDocument(next).renderFrame({
    frameIndex: 0,
    step: 1,
  });
  expect(page.layout.paragraphs.length).toBeGreaterThan(0);
  return next;
}

describe("beamer object index", () => {
  it("publishes columns, column, list, item, and tikzpicture nodes with the Esc-ladder parent chain", async () => {
    const source = frameDocument(COLUMNS_BODY);
    const index = await indexFor(source);
    const kinds = index.nodes.map((node) => node.kind);
    expect(kinds.filter((kind) => kind === "columns")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "column")).toHaveLength(2);
    expect(kinds.filter((kind) => kind === "list")).toHaveLength(2);
    expect(kinds.filter((kind) => kind === "item")).toHaveLength(5);
    expect(kinds.filter((kind) => kind === "tikzpicture")).toHaveLength(1);

    const nested = nodeAt(index, source.indexOf("alpha"));
    expect(nested.kind).toBe("item");
    expect(parentChainKinds(index, nested)).toEqual([
      "item",
      "list",
      "item",
      "list",
      "column",
      "columns",
    ]);

    const tikz = nodeAt(index, source.indexOf("(0,0)"));
    expect(parentChainKinds(index, tikz)).toEqual([
      "tikzpicture",
      "column",
      "columns",
    ]);

    // Every rendered bullet resolves to a distinct item object, including
    // the nested list's bullets.
    const markerTargets = [...index.objectIdByMarkerId.values()];
    expect(markerTargets).toHaveLength(5);
    expect(new Set(markerTargets).size).toBe(5);
    for (const objectId of markerTargets) {
      expect(index.byId.get(objectId)?.kind).toBe("item");
    }
  });

  it("keeps item geometry inside the list and the list inside its column", async () => {
    const source = frameDocument(COLUMNS_BODY);
    const index = await indexFor(source);
    const item = nodeAt(index, source.indexOf("Second two"));
    const list = index.byId.get(item.parentId as string) as BeamerObjectNode;
    const column = index.nodes.find(
      (node) =>
        node.kind === "column" &&
        node.sourceSpan.from <= list.sourceSpan.from &&
        list.sourceSpan.to <= node.sourceSpan.to
    ) as BeamerObjectNode;
    for (const [inner, outer] of [
      [item, list],
      [list, column],
    ] as const) {
      expect(inner.bounds.x).toBeGreaterThanOrEqual(outer.bounds.x - 0.5);
      expect(inner.bounds.y).toBeGreaterThanOrEqual(outer.bounds.y - 0.5);
      expect(inner.bounds.x + inner.bounds.width).toBeLessThanOrEqual(
        outer.bounds.x + outer.bounds.width + 0.5
      );
      expect(inner.bounds.y + inner.bounds.height).toBeLessThanOrEqual(
        outer.bounds.y + outer.bounds.height + 0.5
      );
    }
    // The item's marker (left of the text) is part of its bounds.
    const row = index.nodes.find(
      (node) => node.kind === "item" && node.id !== item.id && node.parentId === item.parentId
    );
    expect(row).toBeDefined();
    expect(item.bounds.width).toBeGreaterThan(10);
  });

  it("publishes block nodes and parents their inner list into the block", async () => {
    const source = frameDocument(BLOCK_BODY);
    const index = await indexFor(source);
    const item = nodeAt(index, source.indexOf("Beta row"));
    expect(parentChainKinds(index, item)).toEqual(["item", "list", "block"]);
    const block = index.nodes.find((node) => node.kind === "block") as BeamerObjectNode;
    expect(source.slice(block.sourceSpan.from, block.sourceSpan.to)).toContain(
      "\\begin{block}{Key facts}"
    );
    // Prose outside any object resolves to no node.
    expect(beamerObjectAtOffset(index, source.indexOf("Outro"))).toBeNull();
  });
});

describe("beamer object edits", () => {
  it("deletes an item, and deleting the only item removes the environment", async () => {
    const source = frameDocument(BLOCK_BODY);
    const index = await indexFor(source);
    const item = nodeAt(index, source.indexOf("Alpha row"));
    const patch = beamerObjectDeletionPatch(source, index, item);
    expect(patch).not.toBeNull();
    const next = await applyAndRender(source, patch!.edits);
    expect(next).not.toContain("Alpha row");
    expect(next).toContain("Beta row");

    const nextIndex = await indexFor(next);
    const lastItem = nodeAt(nextIndex, next.indexOf("Beta row"));
    const only = beamerObjectDeletionPatch(next, nextIndex, lastItem);
    const final = await applyAndRender(next, only!.edits);
    expect(final).not.toContain("itemize");
    expect(final).not.toContain("\\item");
    expect(final).toContain("Key facts");
  });

  it("deletes lists, blocks, and embedded tikzpictures whole", async () => {
    const source = frameDocument(BLOCK_BODY);
    const index = await indexFor(source);
    const list = nodeAt(index, source.indexOf("Alpha row")).parentId as string;
    const listPatch = beamerObjectDeletionPatch(
      source,
      index,
      index.byId.get(list) as BeamerObjectNode
    );
    const withoutList = await applyAndRender(source, listPatch!.edits);
    expect(withoutList).not.toContain("itemize");
    expect(withoutList).toContain("Key facts");

    const block = index.nodes.find((node) => node.kind === "block") as BeamerObjectNode;
    const blockPatch = beamerObjectDeletionPatch(source, index, block);
    const withoutBlock = await applyAndRender(source, blockPatch!.edits);
    expect(withoutBlock).not.toContain("Key facts");
    expect(withoutBlock).toContain("Outro prose.");

    const columnsSource = frameDocument(COLUMNS_BODY);
    const columnsIndex = await indexFor(columnsSource);
    const tikz = columnsIndex.nodes.find(
      (node) => node.kind === "tikzpicture"
    ) as BeamerObjectNode;
    const tikzPatch = beamerObjectDeletionPatch(columnsSource, columnsIndex, tikz);
    const withoutTikz = await applyAndRender(columnsSource, tikzPatch!.edits);
    expect(withoutTikz).not.toContain("tikzpicture");
    expect(withoutTikz).toContain("Intro prose.");
  });

  it("deletes a column, and deleting the only column removes the columns environment", async () => {
    const source = frameDocument(COLUMNS_BODY);
    const index = await indexFor(source);
    const tikzColumn = index.nodes.find(
      (node) =>
        node.kind === "column" &&
        source.slice(node.sourceSpan.from, node.sourceSpan.to).includes("tikzpicture")
    ) as BeamerObjectNode;
    const patch = beamerObjectDeletionPatch(source, index, tikzColumn);
    const next = await applyAndRender(source, patch!.edits);
    expect(next).not.toContain("tikzpicture");
    expect(next).toContain("\\begin{columns}");
    expect(next).toContain("Intro prose.");

    const nextIndex = await indexFor(next);
    const lastColumn = nextIndex.nodes.find(
      (node) => node.kind === "column"
    ) as BeamerObjectNode;
    const only = beamerObjectDeletionPatch(next, nextIndex, lastColumn);
    const final = await applyAndRender(next, only!.edits);
    expect(final).not.toContain("columns");
    expect(final).not.toContain("Intro prose.");
  });

  it("duplicates items and blocks below the original with a selectable copy span", async () => {
    const source = frameDocument(BLOCK_BODY);
    const index = await indexFor(source);
    const item = nodeAt(index, source.indexOf("Alpha row"));
    const patch = beamerObjectDuplicationPatch(source, item);
    expect(patch).not.toBeNull();
    const next = await applyAndRender(source, patch!.edits);
    expect(next.match(/\\item Alpha row/gu)).toHaveLength(2);
    expect(
      next.slice(patch!.selectSpan!.from, patch!.selectSpan!.to)
    ).toContain("\\item Alpha row");
    // The copy renders as its own selectable item.
    const nextIndex = await indexFor(next);
    const copies = nextIndex.nodes.filter(
      (node) =>
        node.kind === "item" &&
        next.slice(node.sourceSpan.from, node.sourceSpan.to).includes("Alpha row")
    );
    expect(copies).toHaveLength(2);

    const block = index.nodes.find((node) => node.kind === "block") as BeamerObjectNode;
    const blockPatch = beamerObjectDuplicationPatch(source, block);
    const twoBlocks = await applyAndRender(source, blockPatch!.edits);
    expect(twoBlocks.match(/\\begin\{block\}\{Key facts\}/gu)).toHaveLength(2);
  });
});
