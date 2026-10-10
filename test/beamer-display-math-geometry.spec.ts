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

describe("caret and selection geometry around commands and big operators", () => {
  const formula = String.raw`\nabla f(x^\star)+\sum_{i\in\act}\lambda_i\nabla g_i(x^\star)+\sum_j\nu_j\nabla h_j(x^\star)=0`;
  const start = source.indexOf(formula);
  const at = (needle: string, from = 0) => start + formula.indexOf(needle, from);
  let display: BeamerParagraphLayout;
  let box: Extract<ReturnType<typeof flattenPositionedTexVListItems>[number]["item"], { kind: "display-math" }>["box"];
  let params: Parameters<typeof getKnuthPlassPointFromOffset>[1] & { sourceCoordinateSpace: "document" };
  let context: unknown;

  beforeAll(async () => {
    const frame = await renderBeamerFrame(source, { frameIndex: 8 });
    const find = (candidate: BeamerParagraphLayout) => flattenPositionedTexVListItems(candidate.vlistLayout.items).find((item) =>
      item.item.kind === "display-math" && item.item.box.sourceStart <= start && item.item.box.sourceEnd > start);
    display = frame.layout.paragraphs.find((candidate) => find(candidate))!;
    const item = find(display)!.item;
    if (item.kind !== "display-math") throw new Error("Expected the KKT stationarity display.");
    box = item.box;
    context = createTextLayoutContext({
      getParagraphReports: () => [display.report],
      getVListLayouts: () => [{ paragraphId: display.paragraphId, layout: display.vlistLayout }],
      getVListLayout: () => display.vlistLayout,
    });
    params = {
      paragraphId: display.paragraphId, sourceCoordinateSpace: "document",
      sourceText: source.slice(display.sourceSpan.from, display.sourceSpan.to),
      sourceTextStartOffset: documentSourceOffset(display.sourceSpan.from),
      containerElement: { tagName: "g", getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) } as unknown as Element,
    };
  });

  it("has no caret position inside a command's name, so a click on its glyph lands at an end", () => {
    for (const name of [String.raw`\nabla`, String.raw`\sum`, String.raw`\lambda`, String.raw`\star`]) {
      const from = at(name);
      const inside = box.caretMap!.entries.filter((entry) => entry.sourceOffset > from && entry.sourceOffset < from + name.length);
      expect(inside, name).toEqual([]);
    }
  });

  it("selects a symbol with its subscript without the symbol after it", async () => {
    const nabla = box.caretMap!.entries.find((entry) => entry.sourceOffset === at(String.raw`\nabla g`) && entry.kind === "glyph-boundary" &&
      entry.sourceSpan?.start === at(String.raw`\nabla g`))!;
    const lambda = box.caretMap!.entries.find((entry) => entry.sourceOffset === at(String.raw`\lambda`) && entry.kind === "glyph-boundary")!;
    const selection = await getKnuthPlassSelectionRects(context, {
      ...params, startOffset: documentSourceOffset(at(String.raw`\lambda`)), endOffset: documentSourceOffset(at(String.raw`\nabla g`)),
    });
    expect(selection.rects).toHaveLength(1);
    const { minX, maxX } = selection.rects[0].bounds;
    // (The width of λ and its subscript, up to where ∇ starts: not across ∇.)
    expect(maxX - minX).toBeCloseTo(nabla.x - lambda.x, 6);
  });

  it("draws the caret at a big operator over the operator, not above it", async () => {
    for (const offset of [at(String.raw`\sum_{`), at(String.raw`\sum_j`)]) {
      const sum = box.caretMap!.entries.find((entry) => entry.sourceOffset === offset && entry.kind === "glyph-boundary" && entry.sourceSpan?.start === offset)!;
      const point = await getKnuthPlassPointFromOffset(context, { ...params, offset: documentSourceOffset(offset) });
      const top = Math.min(point.caretTop!.y, point.caretBottom!.y);
      const bottom = Math.max(point.caretTop!.y, point.caretBottom!.y);
      // The operator's ink, in the same coordinates as the caret (the caret's centre is the ink's).
      const centre = (top + bottom) / 2;
      expect(bottom - top).toBeCloseTo(sum.hitBounds.yEnd - sum.hitBounds.yStart, 6);
      expect(point.clientPoint!.y).toBeCloseTo(centre, 6);
    }
  });
});
