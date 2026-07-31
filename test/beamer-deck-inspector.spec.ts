import { describe, expect, it } from "vitest";
import {
  buildDeckFrameInspector,
  buildDeckObjectInspector,
  prepareBeamerDocument,
  splitDeckDimension,
  type BeamerObjectNode,
  type DeckInspectorField,
} from "../packages/core/src/beamer/index.js";
import { buildBeamerObjectIndex } from "../packages/core/src/beamer/object-index.js";

const SOURCE = [
  "\\documentclass{beamer}",
  "\\begin{document}",
  "\\begin{frame}[t, label=demo]{Objects}",
  "\\begin{alertblock}<2->{Watch out}",
  "\\begin{itemize}",
  "\\item<3-> Alpha one",
  "\\item Beta two",
  "\\end{itemize}",
  "\\end{alertblock}",
  "\\begin{columns}[T]",
  "\\begin{column}{.55\\textwidth}",
  "\\includegraphics[width=0.63\\textwidth]{demo.png}",
  "\\end{column}",
  "\\begin{column}{.42\\textwidth}",
  "\\begin{tikzpicture}[scale=0.8]",
  "\\draw (0,0) -- (1,1);",
  "\\end{tikzpicture}",
  "\\end{column}",
  "\\end{columns}",
  "\\end{frame}",
  "\\end{document}",
].join("\n");

async function fixture(): Promise<{
  frameId: string;
  nodeOfKind: (kind: string, occurrence?: number) => BeamerObjectNode;
}> {
  const page = await prepareBeamerDocument(SOURCE).renderFrame({
    frameIndex: 0,
    step: 3,
  });
  const index = buildBeamerObjectIndex({
    items: page.layout.items,
    paragraphs: page.layout.paragraphs,
    source: SOURCE,
  });
  return {
    frameId: page.layout.frameId,
    nodeOfKind: (kind, occurrence = 0) => {
      const node = index.nodes.filter((candidate) => candidate.kind === kind)[occurrence];
      expect(node, `expected a ${kind} node #${occurrence}`).toBeDefined();
      return node;
    },
  };
}

function fieldById(fields: readonly DeckInspectorField[], id: string): DeckInspectorField {
  const field = fields.find((candidate) => candidate.id === id);
  expect(field, `expected field ${id}`).toBeDefined();
  return field as DeckInspectorField;
}

describe("deck inspector models", () => {
  it("describes a block with type, title, and overlay", async () => {
    const fx = await fixture();
    const model = buildDeckObjectInspector(SOURCE, fx.nodeOfKind("block"));
    expect(model.title).toBe("Block");
    const type = fieldById(model.fields, "environment");
    expect(type).toMatchObject({
      kind: "enum",
      value: "alertblock",
      write: { kind: "renameEnvironment" },
    });
    if (type.kind === "enum") {
      expect(type.options.map((option) => option.value)).toEqual([
        "block",
        "alertblock",
        "exampleblock",
      ]);
    }
    expect(fieldById(model.fields, "title")).toMatchObject({
      kind: "text",
      value: "Watch out",
    });
    expect(fieldById(model.fields, "overlay")).toMatchObject({
      kind: "text",
      value: "2-",
    });
  });

  it("describes lists, items, columns, graphics, and drawings", async () => {
    const fx = await fixture();

    const list = buildDeckObjectInspector(SOURCE, fx.nodeOfKind("list"));
    expect(fieldById(list.fields, "environment")).toMatchObject({
      kind: "enum",
      value: "itemize",
    });

    const item = buildDeckObjectInspector(SOURCE, fx.nodeOfKind("item", 0));
    expect(fieldById(item.fields, "overlay")).toMatchObject({
      kind: "text",
      value: "3-",
    });

    const column = buildDeckObjectInspector(SOURCE, fx.nodeOfKind("column"));
    expect(fieldById(column.fields, "width")).toMatchObject({
      kind: "number",
      value: 0.55,
      unit: "\\textwidth",
      write: { kind: "setColumnWidth", suffix: "\\textwidth" },
    });

    const graphics = buildDeckObjectInspector(SOURCE, fx.nodeOfKind("graphics"));
    expect(fieldById(graphics.fields, "width")).toMatchObject({
      kind: "number",
      value: 0.63,
      unit: "\\textwidth",
    });
    expect(fieldById(graphics.fields, "height")).toMatchObject({
      kind: "number",
      value: null,
    });
    expect(fieldById(graphics.fields, "scale")).toMatchObject({
      kind: "number",
      value: null,
    });

    const tikz = buildDeckObjectInspector(SOURCE, fx.nodeOfKind("tikzpicture"));
    expect(fieldById(tikz.fields, "scale")).toMatchObject({
      kind: "number",
      value: 0.8,
      write: { kind: "setEnvironmentOption", key: "scale" },
    });
  });

  it("describes frame options without the frame title", async () => {
    const fx = await fixture();
    const model = buildDeckFrameInspector(SOURCE, fx.frameId);
    expect(model).not.toBeNull();
    expect(model!.title).toBe("Frame");
    expect(model!.fields.map((field) => field.id)).toEqual([
      "alignment",
      "fragile",
      "plain",
      "label",
    ]);
    expect(fieldById(model!.fields, "alignment")).toMatchObject({
      kind: "enum",
      value: "t",
      write: { kind: "setFrameAlignment" },
    });
    expect(fieldById(model!.fields, "fragile")).toMatchObject({
      kind: "boolean",
      value: false,
    });
    expect(fieldById(model!.fields, "label")).toMatchObject({
      kind: "text",
      value: "demo",
    });
  });

  it("splits authored dimensions into value and suffix", () => {
    expect(splitDeckDimension("0.63\\textwidth")).toEqual({ value: 0.63, suffix: "\\textwidth" });
    expect(splitDeckDimension(".5\\linewidth")).toEqual({ value: 0.5, suffix: "\\linewidth" });
    expect(splitDeckDimension("3cm")).toEqual({ value: 3, suffix: "cm" });
    expect(splitDeckDimension("90")).toEqual({ value: 90, suffix: "" });
    expect(splitDeckDimension("0.5\\textwidth+2pt")).toBeNull();
  });
});
