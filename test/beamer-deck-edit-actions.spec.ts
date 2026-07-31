import { describe, expect, it } from "vitest";
import {
  applyDeckEditAction,
  prepareBeamerDocument,
  scanBeamerDocument,
  type BeamerFrameLayout,
  type BeamerObjectNode,
  type DeckEditAction,
} from "../packages/core/src/beamer/index.js";
import { buildBeamerObjectIndex } from "../packages/core/src/beamer/object-index.js";

const SOURCE = [
  "\\documentclass{beamer}",
  "\\begin{document}",
  "\\begin{frame}[c]{Objects}",
  "\\begin{block}<2->{Facts}",
  "\\begin{itemize}",
  "\\item Alpha one",
  "\\item Beta two",
  "\\end{itemize}",
  "\\end{block}",
  "\\begin{columns}[T]",
  "\\begin{column}{.55\\textwidth}",
  "Left prose.",
  "\\end{column}",
  "\\begin{column}{.42\\textwidth}",
  "\\includegraphics[width=0.63\\textwidth]{demo.png}",
  "\\end{column}",
  "\\end{columns}",
  "\\end{frame}",
  "\\end{document}",
].join("\n");

type Fixture = {
  source: string;
  layout: BeamerFrameLayout;
  frameId: string;
  nodeOfKind: (kind: string, occurrence?: number) => BeamerObjectNode;
};

async function fixture(source: string = SOURCE): Promise<Fixture> {
  // Step 2 so the `<2->` block is visible (hidden objects are unselectable).
  const page = await prepareBeamerDocument(source).renderFrame({
    frameIndex: 0,
    step: 2,
  });
  const layout = page.layout;
  const index = buildBeamerObjectIndex({
    items: layout.items,
    paragraphs: layout.paragraphs,
    source,
  });
  return {
    source,
    layout,
    frameId: layout.frameId,
    nodeOfKind: (kind, occurrence = 0) => {
      const nodes = index.nodes.filter((node) => node.kind === kind);
      const node = nodes[occurrence];
      expect(node, `expected a ${kind} node #${occurrence}`).toBeDefined();
      return node;
    },
  };
}

function applied(
  fx: Fixture,
  action: DeckEditAction
): string {
  const result = applyDeckEditAction(fx.source, fx.layout, action);
  expect(result.kind, JSON.stringify(result)).toBe("success");
  if (result.kind !== "success") throw new Error("unreachable");
  // Patches must reproduce the source transition.
  let patched = fx.source;
  for (let i = result.patches.length - 1; i >= 0; i -= 1) {
    const patch = result.patches[i];
    patched =
      patched.slice(0, patch.oldSpan.from) +
      patch.replacement +
      patched.slice(patch.oldSpan.to);
  }
  expect(patched).toBe(result.newSource);
  return result.newSource;
}

async function expectRenders(source: string): Promise<void> {
  const page = await prepareBeamerDocument(source).renderFrame({
    frameIndex: 0,
    step: 1,
  });
  expect(page.layout.paragraphs.length).toBeGreaterThan(0);
}

describe("applyDeckEditAction", () => {
  it("renames a block within its family, rewriting both boundaries", async () => {
    const fx = await fixture();
    const block = fx.nodeOfKind("block");
    const next = applied(fx, {
      kind: "deckRenameEnvironment",
      frameId: fx.frameId,
      objectId: block.id,
      name: "alertblock",
    });
    expect(next).toContain("\\begin{alertblock}<2->{Facts}");
    expect(next).toContain("\\end{alertblock}");
    expect(next).not.toContain("{block}");
    await expectRenders(next);
  });

  it("rejects renames across environment groups", async () => {
    const fx = await fixture();
    const block = fx.nodeOfKind("block");
    const result = applyDeckEditAction(fx.source, fx.layout, {
      kind: "deckRenameEnvironment",
      frameId: fx.frameId,
      objectId: block.id,
      name: "columns",
    });
    expect(result.kind).toBe("unsupported");
  });

  it("replaces a block title behind its overlay specification", async () => {
    const fx = await fixture();
    const block = fx.nodeOfKind("block");
    const next = applied(fx, {
      kind: "deckSetEnvironmentTitle",
      frameId: fx.frameId,
      objectId: block.id,
      title: "Key facts",
    });
    expect(next).toContain("\\begin{block}<2->{Key facts}");
    await expectRenders(next);
  });

  it("sets, replaces, and removes a block overlay specification", async () => {
    const fx = await fixture();
    const block = fx.nodeOfKind("block");
    const replacedSource = applied(fx, {
      kind: "deckSetOverlaySpec",
      frameId: fx.frameId,
      objectId: block.id,
      spec: "3-",
    });
    expect(replacedSource).toContain("\\begin{block}<3->{Facts}");

    const removedSource = applied(fx, {
      kind: "deckSetOverlaySpec",
      frameId: fx.frameId,
      objectId: block.id,
      spec: null,
    });
    expect(removedSource).toContain("\\begin{block}{Facts}");
    await expectRenders(removedSource);
  });

  it("adds an overlay specification to an item", async () => {
    const fx = await fixture();
    const item = fx.nodeOfKind("item", 1);
    const next = applied(fx, {
      kind: "deckSetOverlaySpec",
      frameId: fx.frameId,
      objectId: item.id,
      spec: "<2->",
    });
    expect(next).toContain("\\item<2-> Beta two");
    await expectRenders(next);
  });

  it("rewrites a graphics option value in place", async () => {
    const fx = await fixture();
    const graphics = fx.nodeOfKind("graphics");
    const next = applied(fx, {
      kind: "deckSetGraphicsOption",
      frameId: fx.frameId,
      objectId: graphics.id,
      key: "width",
      value: "0.4\\textwidth",
    });
    expect(next).toContain("\\includegraphics[width=0.4\\textwidth]{demo.png}");
    await expectRenders(next);
  });

  it("adds and removes graphics options, dropping an empty bracket", async () => {
    const fx = await fixture();
    const graphics = fx.nodeOfKind("graphics");
    const withAngle = applied(fx, {
      kind: "deckSetGraphicsOption",
      frameId: fx.frameId,
      objectId: graphics.id,
      key: "angle",
      value: "90",
    });
    expect(withAngle).toContain("[width=0.63\\textwidth, angle=90]");

    const removed = applied(fx, {
      kind: "deckSetGraphicsOption",
      frameId: fx.frameId,
      objectId: graphics.id,
      key: "width",
      value: null,
    });
    expect(removed).toContain("\\includegraphics{demo.png}");
    await expectRenders(removed);
  });

  it("replaces a column width argument", async () => {
    const fx = await fixture();
    const column = fx.nodeOfKind("column");
    const next = applied(fx, {
      kind: "deckSetColumnWidth",
      frameId: fx.frameId,
      objectId: column.id,
      width: "0.48\\textwidth",
    });
    expect(next).toContain("\\begin{column}{0.48\\textwidth}");
    expect(next).toContain("\\begin{column}{.42\\textwidth}");
    await expectRenders(next);
  });

  it("sets an exclusive frame alignment flag", async () => {
    const fx = await fixture();
    const next = applied(fx, {
      kind: "deckSetFrameOption",
      frameId: fx.frameId,
      key: "t",
      value: true,
    });
    expect(next).toContain("\\begin{frame}[t]{Objects}");
    await expectRenders(next);
  });

  it("adds, updates, and removes frame key-value options", async () => {
    const fx = await fixture();
    const withLabel = applied(fx, {
      kind: "deckSetFrameOption",
      frameId: fx.frameId,
      key: "label",
      value: "objects",
    });
    expect(withLabel).toContain("\\begin{frame}[c, label=objects]{Objects}");

    const removed = applied(fx, {
      kind: "deckSetFrameOption",
      frameId: fx.frameId,
      key: "c",
      value: null,
    });
    expect(removed).toContain("\\begin{frame}{Objects}");
    await expectRenders(removed);
  });

  it("inserts a fresh option bracket when the frame has none", async () => {
    const bare = SOURCE.replace("\\begin{frame}[c]{Objects}", "\\begin{frame}{Objects}");
    const fx = await fixture(bare);
    const next = applied(fx, {
      kind: "deckSetFrameOption",
      frameId: fx.frameId,
      key: "fragile",
      value: true,
    });
    expect(next).toContain("\\begin{frame}[fragile]{Objects}");
  });

  it("deletes and duplicates objects through the shared result contract", async () => {
    const fx = await fixture();
    const block = fx.nodeOfKind("block");
    const deleted = applied(fx, {
      kind: "deckDeleteObject",
      frameId: fx.frameId,
      objectId: block.id,
    });
    expect(deleted).not.toContain("Facts");
    await expectRenders(deleted);

    const item = fx.nodeOfKind("item", 0);
    const duplicated = applied(fx, {
      kind: "deckDuplicateObject",
      frameId: fx.frameId,
      objectId: item.id,
    });
    expect(duplicated.match(/\\item Alpha one/g)).toHaveLength(2);
    await expectRenders(duplicated);
  });

  it("refuses actions against a different frame or a missing object", async () => {
    const fx = await fixture();
    const block = fx.nodeOfKind("block");
    expect(
      applyDeckEditAction(fx.source, fx.layout, {
        kind: "deckDeleteObject",
        frameId: "some-other-frame",
        objectId: block.id,
      }).kind
    ).toBe("unsupported");
    expect(
      applyDeckEditAction(fx.source, fx.layout, {
        kind: "deckDeleteObject",
        frameId: fx.frameId,
        objectId: "missing",
      }).kind
    ).toBe("unsupported");
  });

  it("uses scan-model frame ids for frame options", async () => {
    const fx = await fixture();
    const model = scanBeamerDocument(fx.source);
    expect(model.frames.map((frame) => frame.id)).toContain(fx.frameId);
  });
});
