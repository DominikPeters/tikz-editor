import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { renderBeamerFrame } from "../packages/core/src/beamer/index.js";
import type { BeamerParagraphLayout } from "../packages/core/src/beamer/types.js";
import { createTextLayoutContext } from "../packages/core/src/text/layout-context.js";
import { documentSourceOffset } from "../packages/core/src/text/source-coordinates.js";
import { flattenPositionedTexVListItems } from "../packages/core/src/text/tex/vlist/index.js";
import { getKnuthPlassPointFromOffset, getKnuthPlassSelectionRects } from "../packages/core/src/text/knuth-plass/editor/hitmap.js";

const source = readFileSync(new URL("./fixtures/beamer/kkt_theorem_beamer.tex", import.meta.url), "utf8");
const offset = source.indexOf("g_i(x)=0");
let paragraph: BeamerParagraphLayout;

beforeAll(async () => {
  const frame = await renderBeamerFrame(source, { frameIndex: 2 });
  paragraph = frame.layout.paragraphs.find((candidate) => candidate.role === "body" &&
    source.slice(candidate.sourceSpan.from, candidate.sourceSpan.to).includes("the active set is"))!;
});

describe("Beamer display math editing geometry", () => {
  it.each([0.7, 1, 2.8])("uses the rendered KKT active-set baseline at zoom %s", async (scale) => {
    const item = flattenPositionedTexVListItems(paragraph.vlistLayout.items).find((candidate) =>
      candidate.item.kind === "display-math" && candidate.item.box.sourceStart <= offset && candidate.item.box.sourceEnd > offset
    );
    if (!item || item.item.kind !== "display-math") throw new Error("Expected the active-set display box.");
    const entry = item.item.box.caretMap!.entries.find((candidate) => candidate.sourceOffset === offset &&
      candidate.sourceSpan?.start === offset && candidate.kind === "glyph-boundary")!;
    const context = createTextLayoutContext({
      getParagraphReports: () => [paragraph.report],
      getVListLayouts: () => [{ paragraphId: paragraph.paragraphId, layout: paragraph.vlistLayout }],
      getVListLayout: () => paragraph.vlistLayout,
    });
    const containerElement = {
      tagName: "g",
      getScreenCTM: () => ({ a: scale, b: 0, c: 0, d: scale, e: scale * paragraph.bounds.x, f: scale * paragraph.bounds.y }),
    } as unknown as Element;
    const params = {
      paragraphId: paragraph.paragraphId, sourceCoordinateSpace: "document" as const,
      sourceText: source.slice(paragraph.sourceSpan.from, paragraph.sourceSpan.to),
      sourceTextStartOffset: documentSourceOffset(paragraph.sourceSpan.from), containerElement,
    };
    // The SVG places the box at its top and its glyphs at one ascent below it.
    const baseline = paragraph.bounds.y + item.y + item.metrics.height;
    const point = await getKnuthPlassPointFromOffset(context, { ...params, offset });
    expect(point.ok).toBe(true);
    expect(point.clientPoint?.x).toBeCloseTo(scale * (paragraph.bounds.x + item.x + entry.x), 6);
    expect(point.clientPoint?.y).toBeCloseTo(scale * (baseline + entry.y + (entry.depth - entry.height) / 2), 6);
    const selection = await getKnuthPlassSelectionRects(context, { ...params, startOffset: offset, endOffset: offset + 1 });
    expect(selection.ok).toBe(true);
    expect(selection.rects.length).toBeGreaterThan(0);
    expect(selection.rects[0].bounds.minY).toBeLessThanOrEqual(scale * (baseline + entry.hitBounds.yStart) + 1e-6);
    expect(selection.rects[0].bounds.maxY).toBeGreaterThanOrEqual(scale * (baseline + entry.hitBounds.yEnd) - 1e-6);
  });
});
