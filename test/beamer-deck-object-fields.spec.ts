import { describe, expect, it } from "vitest";
import {
  applyDeckEditAction,
  buildDeckObjectInspector,
  prepareBeamerDocument,
  type BeamerFrameLayout,
  type BeamerObjectNode,
  type DeckEditAction,
  type DeckInspectorField,
} from "../packages/core/src/beamer/index.js";
import { buildBeamerObjectIndex } from "../packages/core/src/beamer/object-index.js";

const SOURCE = [
  "\\documentclass{beamer}",
  "\\begin{document}",
  "\\begin{frame}{Objects}",
  "\\begin{itemize}[<+-| alert@+>]",
  "\\item One",
  "\\end{itemize}",
  "\\begin{enumerate}[<+->][(a)]",
  "\\item Two",
  "\\end{enumerate}",
  "\\begin{columns}[T,totalwidth=.9\\textwidth]",
  "\\begin{column}[b]{.5\\textwidth}",
  "\\includegraphics[width=.5\\textwidth,keepaspectratio,trim=1 2 3 4,clip]{figure.pdf}",
  "\\end{column}",
  "\\begin{column}{.4\\textwidth}",
  "\\begin{tikzpicture}",
  "\\draw (0,0) -- (1,1);",
  "\\end{tikzpicture}",
  "\\end{column}",
  "\\end{columns}",
  "\\begin{lstlisting}",
  "x = 1",
  "\\end{lstlisting}",
  "\\end{frame}",
  "\\end{document}",
].join("\n");

type Fixture = {
  source: string;
  layout: BeamerFrameLayout;
  node: (kind: string, occurrence?: number) => BeamerObjectNode;
};

async function fixture(source: string = SOURCE): Promise<Fixture> {
  // The last step, so every revealed item is shown.
  const prepared = prepareBeamerDocument(source);
  const page = await prepared.renderFrame({ frameIndex: 0, step: prepared.frameStepCount(0) });
  const index = buildBeamerObjectIndex({ items: page.layout.items, paragraphs: page.layout.paragraphs, source });
  return {
    source,
    layout: page.layout,
    node: (kind, occurrence = 0) => {
      const found = index.nodes.filter((candidate) => candidate.kind === kind)[occurrence];
      if (!found) throw new Error(`expected a ${kind} node #${occurrence}`);
      return found;
    },
  };
}

function fields(fx: Fixture, kind: string, occurrence = 0): DeckInspectorField[] {
  const node = fx.node(kind, occurrence);
  const message = fx.layout.items.find((item) => item.id === node.id)?.message;
  return buildDeckObjectInspector(fx.source, node, message === undefined ? {} : { message }).fields;
}

function field(list: readonly DeckInspectorField[], id: string): DeckInspectorField {
  const found = list.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing field ${id}`);
  return found;
}

function applied(fx: Fixture, action: DeckEditAction): string {
  const result = applyDeckEditAction(fx.source, fx.layout, action);
  if (result.kind !== "success") throw new Error(JSON.stringify(result));
  return result.newSource;
}

describe("deck object fields", () => {
  it("reads a list's reveal and an enumerate's label template", async () => {
    const fx = await fixture();
    expect(field(fields(fx, "list", 0), "reveal")).toMatchObject({ value: "+-| alert@+", write: { kind: "setListDefaultOverlay" } });
    expect(fields(fx, "list", 0).some((entry) => entry.id === "template")).toBe(false);
    expect(field(fields(fx, "list", 1), "reveal")).toMatchObject({ value: "+-" });
    expect(field(fields(fx, "list", 1), "template")).toMatchObject({ value: "(a)" });
  });

  it("reads columns and column alignment and widths", async () => {
    const fx = await fixture();
    const columns = fields(fx, "columns");
    expect(field(columns, "alignment")).toMatchObject({ value: "T", write: { kind: "setEnvironmentFlagChoice" } });
    expect(field(columns, "totalwidth")).toMatchObject({ value: 0.9, unit: "\\textwidth" });
    expect(field(columns, "onlytextwidth")).toMatchObject({ value: false });
    expect(field(fields(fx, "column", 0), "alignment")).toMatchObject({ value: "b" });
    expect(field(fields(fx, "column", 1), "alignment")).toMatchObject({ value: "" });
  });

  it("reads an image's file and the options the preview draws", async () => {
    const fx = await fixture();
    const image = fields(fx, "graphics");
    expect(field(image, "file")).toMatchObject({ value: "figure.pdf", write: null });
    expect(field(image, "width")).toMatchObject({ value: 0.5 });
    expect(field(image, "page")).toMatchObject({ value: 1, step: 1 });
    expect(field(image, "keepaspectratio")).toMatchObject({ value: true });
    expect(field(image, "trim")).toMatchObject({ value: "1 2 3 4" });
    expect(field(image, "clip")).toMatchObject({ value: true });
    // Neither is drawn by the preview, so neither is offered.
    expect(image.some((entry) => entry.id === "angle" || entry.id === "overlay")).toBe(false);
  });

  it("offers editing a drawing and showing unsupported source", async () => {
    const fx = await fixture();
    expect(field(fields(fx, "tikzpicture"), "edit-drawing")).toMatchObject({
      kind: "button",
      command: { kind: "enterDrawing", rootId: fx.node("tikzpicture").rootId },
    });
    const unsupported = fields(fx, "unsupported");
    expect(field(unsupported, "reason")).toMatchObject({ kind: "message", text: expect.stringContaining("lstlisting") });
    expect(field(unsupported, "source")).toMatchObject({ kind: "code", text: expect.stringContaining("x = 1") });
    expect(field(unsupported, "show-in-source")).toMatchObject({
      command: { kind: "revealSource", span: fx.node("unsupported").sourceSpan },
    });
  });
});

describe("deck object field writes", () => {
  it.each([
    ["keepaspectratio=true,clip=true", true, true],
    ["keepaspectratio,keepaspectratio=false,clip,clip=false", false, false],
    ["keepaspectratio=no,clip=0,clip", false, true],
  ])("reads explicit boolean values in source order: %s", async (options, aspect, clip) => {
    const fx = await fixture(SOURCE.replace("width=.5\\textwidth,keepaspectratio,trim=1 2 3 4,clip", String(options)));
    expect(field(fields(fx, "graphics"), "keepaspectratio")).toMatchObject({ value: aspect });
    expect(field(fields(fx, "graphics"), "clip")).toMatchObject({ value: clip });
  });

  it("removes every duplicate flag while preserving comments and other options", async () => {
    const fx = await fixture(SOURCE.replace("keepaspectratio,trim=1 2 3 4,clip", "clip, % retain crop note\ntrim=1 2 3 4,clip=true"));
    const next = applied(fx, { kind: "deckSetGraphicsOption", frameId: fx.layout.frameId, objectId: fx.node("graphics").id, key: "clip", value: null });
    expect(next).toContain("% retain crop note\ntrim=1 2 3 4");
    const reread = await fixture(next);
    expect(field(fields(reread, "graphics"), "clip")).toMatchObject({ value: false });
    expect(field(fields(reread, "graphics"), "width")).toMatchObject({ value: 0.5 });
  });

  it("replaces a columns alignment case-sensitively and clears it", async () => {
    const fx = await fixture();
    const objectId = fx.node("columns").id;
    const frameId = fx.layout.frameId;
    const keys = ["c", "t", "T", "b"];
    expect(applied(fx, { kind: "deckSetEnvironmentOption", frameId, objectId, key: "t", value: true, exclusive: keys }))
      .toContain("\\begin{columns}[totalwidth=.9\\textwidth, t]");
    expect(applied(fx, { kind: "deckSetEnvironmentOption", frameId, objectId, key: "c", value: null, exclusive: keys }))
      .toContain("\\begin{columns}[totalwidth=.9\\textwidth]");
    expect(applied(fx, { kind: "deckSetEnvironmentOption", frameId, objectId, key: "onlytextwidth", value: true }))
      .toContain("\\begin{columns}[T,totalwidth=.9\\textwidth, onlytextwidth]");
  });

  it("sets a column's placement before its width", async () => {
    const fx = await fixture();
    const next = applied(fx, {
      kind: "deckSetEnvironmentOption", frameId: fx.layout.frameId, objectId: fx.node("column", 1).id,
      key: "T", value: true, exclusive: ["c", "t", "T", "b"],
    });
    expect(next).toContain("\\begin{column}[T]{.4\\textwidth}");
  });

  it("toggles image flags and sets options", async () => {
    const fx = await fixture();
    const frameId = fx.layout.frameId;
    const objectId = fx.node("graphics").id;
    expect(applied(fx, { kind: "deckSetGraphicsOption", frameId, objectId, key: "clip", value: null }))
      .toContain("\\includegraphics[width=.5\\textwidth,keepaspectratio,trim=1 2 3 4]{figure.pdf}");
    expect(applied(fx, { kind: "deckSetGraphicsOption", frameId, objectId, key: "page", value: "3" }))
      .toContain("trim=1 2 3 4,clip, page=3]{figure.pdf}");

    const bare = await fixture(SOURCE.replace("[width=.5\\textwidth,keepaspectratio,trim=1 2 3 4,clip]{figure.pdf}", "{figure.pdf}"));
    expect(applied(bare, { kind: "deckSetGraphicsOption", frameId, objectId: bare.node("graphics").id, key: "keepaspectratio", value: true }))
      .toContain("\\includegraphics[keepaspectratio]{figure.pdf}");
  });
});
