import { describe, expect, it } from "vitest";
import { beamerImageCropDrag, beamerImageCropPatches, beamerImageCropTarget, prepareBeamerDocument } from "../packages/core/src/beamer/index.js";
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

  it("keeps dragged edges inside the image and at a minimum size", async () => {
    const source = document(String.raw`\includegraphics[width=4cm]{demo.png}`);
    const before = (await target(source))!;
    expect(beamerImageCropDrag(before, "w", -50, 0).left).toBe(0);
    const squeezed = beamerImageCropDrag(before, "e", -1e6, 0);
    expect((120 - squeezed.left - squeezed.right) * before.scale.x).toBeCloseTo(4, 6);
    expect(beamerImageCropDrag(before, "move", 30, 30)).toEqual(before.crop);
  });
});
