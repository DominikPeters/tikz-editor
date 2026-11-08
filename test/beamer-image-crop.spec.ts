import { describe, expect, it } from "vitest";
import { applyDeckEditAction, beamerImageCropDrag, beamerImageCropPatches, beamerImageCropTarget, buildBeamerObjectIndex, buildDeckObjectInspector, prepareBeamerDocument, type DeckInspectorField } from "../packages/core/src/beamer/index.js";
import type { DocumentGraphicsResolver } from "../packages/core/src/graphics/index.js";
import type { SourcePatch } from "../packages/core/src/edit/types.js";

const resolver: DocumentGraphicsResolver = { cacheKey: "crop-test", resolve: () => ({ status: "resolved", mimeType: "image/png", dataBase64: "", naturalWidthPt: 120, naturalHeightPt: 60, revision: "1" }) };
const document = (body: string) => `\\documentclass{beamer}\n\\begin{document}\n\\begin{frame}\n${body}\n\\end{frame}\n\\end{document}`;
const apply = (source: string, patches: readonly SourcePatch[]) => [...patches].reverse().reduce((text, patch) => text.slice(0, patch.oldSpan.from) + patch.replacement + text.slice(patch.oldSpan.to), source);
const BP = 72.27 / 72;

async function target(source: string) {
  const layout = (await prepareBeamerDocument(source).renderFrame({ frameIndex: 0, step: 1, graphicsResolver: resolver })).layout;
  const graphic = layout.graphics[0];
  if (!graphic) throw new Error("Missing graphic");
  return beamerImageCropTarget(source, layout, graphic.itemId);
}

describe("image cropping", () => {
  it("adds trim and clip and keeps the drawn scale of a width-sized image", async () => {
    const source = document(String.raw`\includegraphics[width=4cm]{demo.png}`);
    const before = (await target(source))!;
    expect(before.crop).toEqual({ left: 0, bottom: 0, right: 0, top: 0 });
    const next = apply(source, beamerImageCropPatches(source, before, { left: 12, bottom: 0, right: 0, top: 6 }));
    expect(next).toBe(document(String.raw`\includegraphics[width=3.6cm, trim=${Number((12 / BP).toFixed(2))} 0 0 ${Number((6 / BP).toFixed(2))}, clip]{demo.png}`));
    const after = (await target(next))!;
    expect(after.scale.x).toBeCloseTo(before.scale.x, 3);
    expect(after.scale.y).toBeCloseTo(before.scale.y, 3);
    expect(after.bounds.width).toBeCloseTo(before.bounds.width * 0.9, 2);
    expect(after.crop.left).toBeCloseTo(12, 1);
  });

  it("crops a natural-size image without sizing keys", async () => {
    const source = document(String.raw`\includegraphics{demo.png}`);
    const before = (await target(source))!;
    const next = apply(source, beamerImageCropPatches(source, before, { left: 0, bottom: 0, right: 60, top: 0 }));
    expect(next).toContain(String.raw`\includegraphics[trim=0 0 ${Number((60 / BP).toFixed(2))} 0, clip]{demo.png}`);
    expect((await target(next))!.bounds.width).toBeCloseTo(60, 2);
  });

  it("keeps the author's key and unit and scales a bare register", async () => {
    const trim = document(String.raw`\includegraphics[trim={1cm 0 0 0}, clip, width=\textwidth]{demo.png}`);
    const before = (await target(trim))!;
    const cm = 72.27 / 2.54;
    const next = apply(trim, beamerImageCropPatches(trim, before, { ...before.crop, left: 2 * cm }));
    expect(next).toContain(String.raw`trim={2cm 0cm 0cm 0cm}`);
    expect(next).toMatch(/width=0\.\d+\\textwidth/u);
    expect((await target(next))!.scale.x).toBeCloseTo(before.scale.x, 3);

    const viewport = document(String.raw`\includegraphics[viewport=0 0 100 50, clip=false]{demo.png}`);
    const vp = (await target(viewport))!;
    expect(vp.crop.right).toBeCloseTo(120 - 100 * BP, 4);
    const moved = apply(viewport, beamerImageCropPatches(viewport, vp, beamerImageCropDrag(vp, "move", -vp.scale.x * 5 * BP, 0)));
    expect(moved).toContain("viewport=5 0 105 50, clip]");
  });

  it("removes the crop key when the crop is reset, and works after an overlay specification", async () => {
    const source = document(String.raw`\includegraphics<1->[clip, trim=10 0 0 0, width=3cm]{demo.png}`);
    const before = (await target(source))!;
    const next = apply(source, beamerImageCropPatches(source, before, { left: 0, bottom: 0, right: 0, top: 0 }));
    expect(next).toMatch(/\\includegraphics<1->\[clip, width=3\.\d+cm\]\{demo\.png\}/u);
  });

  it("does not crop rotated images or sizes it cannot rescale", async () => {
    expect(await target(document(String.raw`\includegraphics[angle=90,width=2cm]{demo.png}`))).toBeNull();
    expect(await target(document(String.raw`\includegraphics[width=\dimexpr\textwidth-1cm\relax]{demo.png}`))).toBeNull();
    expect(await target(document(String.raw`\includegraphics[draft]{demo.png}`))).toBeNull();
  });

  it.each([
    "trim=5 0 0 0,trim=10 0 0 0",
    "viewport=5 0 100 50,trim=10 0 0 0",
    "trim=5 0 0 0,bb=10 0 100 50",
    "bb=5 0 100 50,viewport=10 0 100 50",
    "trim=5 % first crop\n 0 0 0,viewport=10 0 100 50",
  ])("resets every crop key in %s while retaining the image scale and comments", async (options) => {
    const source = document(String.raw`\includegraphics[width=4cm,${options},clip,alt={A,B}]{demo.png}`);
    const before = (await target(source))!;
    const next = apply(source, beamerImageCropPatches(source, before, { left: 0, bottom: 0, right: 0, top: 0 }));
    const after = (await target(next))!;
    expect(next).not.toMatch(/(?:trim|viewport|bb)=/u);
    expect(next).toContain("clip");
    expect(next).toContain("alt={A,B}");
    if (options.includes("% first crop")) expect(next).toContain("% first crop\n");
    expect(after.crop).toEqual({ left: 0, bottom: 0, right: 0, top: 0 });
    expect(after.scale.x).toBeCloseTo(before.scale.x, 3);
    expect(after.scale.y).toBeCloseTo(before.scale.y, 3);
  });

  it("keeps dragged edges inside the image and at a minimum size", async () => {
    const source = document(String.raw`\includegraphics[width=4cm]{demo.png}`);
    const before = (await target(source))!;
    expect(beamerImageCropDrag(before, "w", -50, 0).left).toBe(0);
    const squeezed = beamerImageCropDrag(before, "e", -1e6, 0);
    expect((120 - squeezed.left - squeezed.right) * before.scale.x).toBeCloseTo(4, 6);
    expect(beamerImageCropDrag(before, "move", 30, 30)).toEqual(before.crop);
  });

  it("groups the image inspector into file, size and crop sections with crop fields in the author's unit", async () => {
    const source = document(String.raw`\includegraphics[width=0.5\textwidth, trim=1cm 0 0 0, clip]{demo.png}`);
    const layout = (await prepareBeamerDocument(source).renderFrame({ frameIndex: 0, step: 1, graphicsResolver: resolver })).layout;
    const node = buildBeamerObjectIndex({ ...layout, source }).nodes.find((candidate) => candidate.kind === "graphics")!;
    const model = buildDeckObjectInspector(source, node, { layout });
    expect(model.sections?.map((section) => [section.title, section.action?.label ?? null, section.fields.map((field) => field.id)])).toEqual([
      [null, null, ["file"]],
      ["Size", null, ["width", "height", "scale", "keepaspectratio"]],
      ["Crop", "Reset", ["crop-image", "crop-horizontal", "crop-vertical", "clip"]],
    ]);
    expect(model.fields.find((field) => field.id === "file")).toMatchObject({ kind: "file", name: "demo.png", commandLabel: "Replace…" });
    const pair = model.fields.find((field) => field.id === "crop-horizontal") as Extract<DeckInspectorField, { kind: "pair" }>;
    expect(pair.fields.map((field) => [field.label, field.value, field.unit])).toEqual([["Left", 1, "cm"], ["Right", 0, "cm"]]);

    const write = pair.fields[1].write;
    if (write?.kind !== "setGraphicsCrop") throw new Error("expected a crop write");
    const result = applyDeckEditAction(source, layout, { kind: "deckSetGraphicsCrop", frameId: layout.frameId, objectId: node.id, side: write.side, valuePt: 0.5 * write.unitPt });
    if (result.kind !== "success") throw new Error("expected the crop to apply");
    expect(result.newSource).toContain("trim=1cm 0cm 0.5cm 0cm, clip");
    expect((await target(result.newSource))!.scale.x).toBeCloseTo((await target(source))!.scale.x, 3);
  });
});
