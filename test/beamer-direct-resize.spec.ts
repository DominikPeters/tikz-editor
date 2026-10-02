import { describe, expect, it } from "vitest";
import { beamerColumnDividers, beamerColumnResizePatches, beamerImageResizeTarget, beamerImageResizePatches, prepareBeamerDocument } from "../packages/core/src/beamer/index.js";
import type { SourcePatch } from "../packages/core/src/edit/types.js";
import type { DocumentGraphicsResolver } from "../packages/core/src/graphics/types.js";

const document = (body: string) => String.raw`\documentclass{beamer}
\begin{document}\begin{frame}[t]{Resize}
${body}
\end{frame}\end{document}`;
const columns = (widths: string[]) => String.raw`\begin{columns}[T]` + widths.map((width, i) => String.raw`
\begin{column}[t]{${width}}Column ${i + 1} has enough text to reflow.\end{column}`).join("") + String.raw`
\end{columns}`;
const resolver: DocumentGraphicsResolver = { cacheKey: "resize-test", resolve: () => ({ status: "resolved", mimeType: "image/png", dataBase64: "", naturalWidthPt: 120, naturalHeightPt: 60, revision: "1" }) };
async function render(source: string, step = 1) {
  return (await prepareBeamerDocument(source).renderFrame({ frameIndex: 0, step, graphicsResolver: resolver })).layout;
}
function apply(source: string, patches: SourcePatch[]) {
  const next = [...patches].reverse().reduce((text, p) => text.slice(0, p.oldSpan.from) + p.replacement + text.slice(p.oldSpan.to), source);
  for (const patch of patches) expect(next.slice(patch.newSpan.from, patch.newSpan.to)).toBe(patch.replacement);
  return next;
}

describe("column divider resizing", () => {
  it("preserves the sum, authored units, options, and all surrounding source", async () => {
    const source = document(columns([" .55\\textwidth ", ".42\\textwidth"]));
    const layout = await render(source);
    const divider = beamerColumnDividers(source, layout)[0];
    const patches = beamerColumnResizePatches(source, divider, divider.leftWidth * (-.07 / .55));
    expect(apply(source, patches)).toBe(source.replace(".55\\textwidth", ".48\\textwidth").replace(".42\\textwidth", ".49\\textwidth"));
    const next = beamerColumnDividers(apply(source, patches), await render(apply(source, patches)))[0];
    expect(next.leftWidth + next.rightWidth).toBeCloseTo(divider.leftWidth + divider.rightWidth, 5);
  });
  it("edits only the adjacent pair in a three-column layout", async () => {
    const source = document(columns([".2\\textwidth", ".3\\textwidth", ".4\\textwidth"]));
    const dividers = beamerColumnDividers(source, await render(source));
    expect(dividers).toHaveLength(2);
    const next = apply(source, beamerColumnResizePatches(source, dividers[1], dividers[1].leftWidth / 3));
    expect(next).toBe(source.replace("{.3\\textwidth}", "{.4\\textwidth}").replace("{.4\\textwidth}Column 3", "{.3\\textwidth}Column 3"));
  });
  it("resolves and retains mixed absolute and relative dimensions", async () => {
    const source = document(columns(["3cm", ".4\\linewidth"]));
    const divider = beamerColumnDividers(source, await render(source))[0];
    expect(divider.leftWidth).toBeCloseTo(3 * 72.27 / 2.54, 5);
    const nextSource = apply(source, beamerColumnResizePatches(source, divider, 10));
    expect(nextSource).toContain("cm}"); expect(nextSource).toContain("\\linewidth}");
    const next = beamerColumnDividers(nextSource, await render(nextSource))[0];
    expect(next.leftWidth).toBeCloseTo(divider.leftWidth + 10, 3);
    expect(next.rightWidth).toBeCloseTo(divider.rightWidth - 10, 3);
  });
  it("clamps at usable widths and has no patch for a zero delta", async () => {
    const source = document(columns([".5\\textwidth", ".5\\textwidth"]));
    const divider = beamerColumnDividers(source, await render(source))[0];
    expect(beamerColumnResizePatches(source, divider, 0)).toEqual([]);
    const next = apply(source, beamerColumnResizePatches(source, divider, 1e6));
    const resized = beamerColumnDividers(next, await render(next))[0];
    expect(resized.rightWidth).toBeCloseTo(12, 3);
    expect(resized.leftWidth + resized.rightWidth).toBeCloseTo(divider.leftWidth + divider.rightWidth, 3);
  });
  it("does not publish misleading handles for arbitrary expressions or hidden columns", async () => {
    const source = document(columns(["\\dimexpr\\textwidth/2\\relax", ".5\\textwidth"]));
    expect(beamerColumnDividers(source, await render(source))).toEqual([]);
    const hidden = document(String.raw`\only<2>{${columns([".5\\textwidth", ".5\\textwidth"])}}`);
    expect(beamerColumnDividers(hidden, await render(hidden))).toEqual([]);
    expect(beamerColumnDividers(hidden, await render(hidden, 2))).toHaveLength(1);
  });
});

describe("image corner resizing", () => {
  it.each([
    ["width=0.63\\textwidth", "width=0.945\\textwidth"],
    ["height=2cm", "height=3cm"],
    ["width = {3cm}, height=1cm, keepaspectratio", "width = {4.5cm}, height=1.5cm, keepaspectratio"],
    ["width=3cm,height=1cm", "width=4.5cm,height=1.5cm"],
    ["scale=.5", "scale=.75"],
    ["trim=1pt 2pt 3pt 4pt,clip,width=3cm", "trim=1pt 2pt 3pt 4pt,clip,width=4.5cm"],
  ])("preserves aspect and source options for %s", async (options, expected) => {
    const source = document(String.raw`\includegraphics[${options}]{demo.png}`);
    const layout = await render(source);
    const target = beamerImageResizeTarget(source, layout, layout.graphics[0].itemId)!;
    expect(target).not.toBeNull();
    const nextSource = apply(source, beamerImageResizePatches(source, target, 1.5));
    expect(nextSource).toBe(source.replace(options, expected));
    const next = (await render(nextSource)).graphics[0];
    expect(next.bounds.width).toBeCloseTo(target.bounds.width * 1.5, 3);
    expect(next.bounds.height).toBeCloseTo(target.bounds.height * 1.5, 3);
  });
  it("adds scale to natural-size images without rewriting the filename", async () => {
    for (const options of ["", "[clip]", "[]"]) {
      const source = document(String.raw`\includegraphics${options}{demo.png}`);
      const layout = await render(source);
      const target = beamerImageResizeTarget(source, layout, layout.graphics[0].itemId)!;
      expect(beamerImageResizePatches(source, target, 1)).toEqual([]);
      const nextSource = apply(source, beamerImageResizePatches(source, target, .5));
      expect(nextSource).toContain(options === "[clip]" ? "[clip, scale=0.5]{demo.png}" : "[scale=0.5]{demo.png}");
      expect((await render(nextSource)).graphics[0].bounds.width).toBeCloseTo(60, 3);
    }
  });
  it("keeps relative image widths local to their column", async () => {
    const source = document(columns([".4\\textwidth", ".5\\textwidth"]).replace("Column 1 has enough text to reflow.", String.raw`\includegraphics[width=.5\linewidth]{demo.png}`));
    const layout = await render(source);
    const target = beamerImageResizeTarget(source, layout, layout.graphics[0].itemId)!;
    const nextSource = apply(source, beamerImageResizePatches(source, target, 1.5));
    expect(nextSource).toContain("width=.75\\linewidth");
    expect((await render(nextSource)).graphics[0].bounds.width).toBeCloseTo(target.bounds.width * 1.5, 3);
  });
  it.each(["width=\\customwidth", "width=2cm,width=3cm", "angle=45,width=3cm", "totalheight=2cm", "scale={.5}"])("leaves unsupported sizing %s to source editing", async (options) => {
    const source = document(String.raw`\includegraphics[${options}]{demo.png}`);
    const layout = await render(source);
    expect(beamerImageResizeTarget(source, layout, layout.graphics[0].itemId)).toBeNull();
  });
  it("offers no image handles for unresolved assets", async () => {
    const source = document(String.raw`\includegraphics[width=3cm]{missing.png}`);
    const layout = (await prepareBeamerDocument(source).renderFrame({ frameIndex: 0 })).layout;
    expect(beamerImageResizeTarget(source, layout, layout.graphics[0].itemId)).toBeNull();
  });
});
