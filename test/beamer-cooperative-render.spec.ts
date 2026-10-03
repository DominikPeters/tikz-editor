import { describe, expect, it } from "vitest";
import {
  prepareBeamerDocument,
  renderBeamerFrame,
  renderBeamerFramePages,
} from "../packages/core/src/beamer/index.js";
import type { DocumentGraphicsResolver } from "../packages/core/src/graphics/types.js";
import type { RenderBeamerFrameResult } from "../packages/core/src/beamer/types.js";

const picture = String.raw`\begin{tikzpicture}` + "\n" +
  Array.from({ length: 120 }, (_, i) => `\\draw (${i},0)--(${i},1);`).join("\n") +
  String.raw`\node[draw] {Inner $x^2$};\end{tikzpicture}`;
const deck = (body: string) => String.raw`\documentclass{beamer}\usetheme{Madrid}
\title{Cooperative frame}\begin{document}\begin{frame}{Title}` + body +
  String.raw`\end{frame}\end{document}`;
const column = (body: string) => String.raw`\begin{columns}[T]\begin{column}{.48\textwidth}` + body +
  String.raw`\end{column}\begin{column}{.48\textwidth}Other $y^2$\end{column}\end{columns}`;
const graphicParagraphs = (prefix: string, count = 12) => Array.from({ length: count }, (_, i) =>
  `Text ${i} \\includegraphics[width=4pt]{${prefix}${i}}\n` +
  // The native text frontend keeps blank lines/vspace in one VList chunk.
  // A real block boundary creates distinct source-backed paragraph units.
  String.raw`\begin{block}{Separator}\end{block}` + "\n"
).join("");

function resolver(seen: string[], cacheKey = "cooperative-graphics"): DocumentGraphicsResolver {
  return { cacheKey, resolve: request => {
    seen.push(request.filename);
    return { status: "resolved", mimeType: "image/svg+xml", dataBase64: "PHN2Zy8+",
      naturalWidthPt: 4, naturalHeightPt: 3, revision: "unchanged" };
  } };
}

// Callback-bearing paragraph reports are render-local. All serializable
// layout, VList, source mapping, paint and diagnostic facts remain compared.
function comparable(result: RenderBeamerFrameResult): unknown {
  return JSON.parse(JSON.stringify(result));
}

describe("cooperative Beamer rendering", () => {
  it.each(["body", "column"])("yields inside 120-path %s TikZ evaluation", async location => {
    const source = deck(location === "body" ? picture : column(picture));
    const prepared = prepareBeamerDocument(source);
    const normal = await prepared.renderFrame();
    let yields = 0;
    const actual = await prepared.renderFrame({ cooperative: {
      budgetMs: 0, yieldControl: async () => { yields++; },
    } });
    expect(yields).toBeGreaterThan(100);
    expect(actual.svg.svg).toContain("<path");
    expect(actual.layout.embeddedTikz).toHaveLength(1);
    expect(comparable(actual)).toEqual(comparable(normal));
  });

  it.each(["body", "column"])("aborts during inner %s TikZ and leaves prepared reuse intact", async location => {
    const prepared = prepareBeamerDocument(deck(location === "body" ? picture : column(picture)));
    const normal = await prepared.renderFrame();
    const controller = new AbortController();
    let yields = 0;
    await expect(prepared.renderFrame({ cooperative: {
      budgetMs: 0, signal: controller.signal,
      yieldControl: async () => { if (++yields === 20) controller.abort(); },
    } })).rejects.toMatchObject({ name: "AbortError" });
    expect(yields).toBe(20);
    expect(comparable(await prepared.renderFrame())).toEqual(comparable(normal));
  });

  it.each(["body", "column"])("yields between actual %s paragraph layouts", async location => {
    const seen: string[] = [];
    const snapshots: string[][] = [];
    const body = graphicParagraphs(location);
    const source = deck(location === "body" ? body : column(body));
    const actual = await renderBeamerFrame(source, { graphicsResolver: resolver(seen), cooperative: {
      budgetMs: 0, yieldControl: async () => { snapshots.push([...new Set(seen)]); },
    } });
    expect(new Set(seen).size).toBe(12);
    expect(snapshots.some(names => names.length >= 3 && names.length < 12)).toBe(true);
    expect(actual.layout.paragraphs.filter(p => p.role === "body").length).toBeGreaterThanOrEqual(12);
    const normal = await renderBeamerFrame(source, { graphicsResolver: resolver([]) });
    expect(comparable(actual)).toEqual(comparable(normal));
  });

  it.each(["body", "column"])("aborts between real %s paragraphs before later graphics resolve", async location => {
    const seen: string[] = [];
    const body = graphicParagraphs(location);
    const prepared = prepareBeamerDocument(deck(location === "body" ? body : column(body)));
    const controller = new AbortController();
    await expect(prepared.renderFrame({ graphicsResolver: resolver(seen), cooperative: {
      budgetMs: 0, signal: controller.signal,
      yieldControl: async () => { if (new Set(seen).size >= 3) controller.abort(); },
    } })).rejects.toMatchObject({ name: "AbortError" });
    expect(new Set(seen).size).toBe(3);
    expect(seen).not.toContain(`${location}3`);
    const retry = await prepared.renderFrame({ graphicsResolver: resolver([]) });
    expect(retry.layout.graphics).toHaveLength(12);
  });

  it("re-enters caller services only around synchronous paragraph work", async () => {
    let inBatch = false;
    const seen: string[] = [];
    const base = resolver(seen);
    const graphicsResolver: DocumentGraphicsResolver = { cacheKey: base.cacheKey, resolve: request => {
      expect(inBatch).toBe(true);
      return base.resolve(request);
    } };
    await renderBeamerFrame(deck(column(graphicParagraphs("scoped", 3))), { graphicsResolver, cooperative: {
      budgetMs: 0,
      run: operation => {
        expect(inBatch).toBe(false);
        inBatch = true;
        try { return operation(); } finally { inBatch = false; }
      },
      yieldControl: async () => { expect(inBatch).toBe(false); },
    } });
    expect(new Set(seen).size).toBe(3);
  });

  it.each(["one-shot", "prepared"])("cooperates on every overlay page via %s API", async api => {
    const source = deck(String.raw`First\pause ` + column(picture) + String.raw`\pause Last`);
    const prepared = prepareBeamerDocument(source);
    const normal = await prepared.renderFramePages();
    let yields = 0;
    const options = { cooperative: { budgetMs: 0, yieldControl: async () => { yields++; } } };
    const actual = api === "one-shot"
      ? await renderBeamerFramePages(source, options)
      : await prepared.renderFramePages(options);
    expect(actual.stepCount).toBe(3);
    expect(yields).toBeGreaterThan(300);
    expect(actual.pages.map(comparable)).toEqual(normal.pages.map(comparable));
  });

  it("aborts after one overlay page and can render all pages again", async () => {
    const prepared = prepareBeamerDocument(deck(String.raw`First\pause ` + graphicParagraphs("overlay", 3)));
    const controller = new AbortController();
    const seen: string[] = [];
    let firstPageYields = 0;
    await prepared.renderFrame({ graphicsResolver: resolver([]), cooperative: {
      budgetMs: 0, yieldControl: async () => { firstPageYields++; },
    } });
    let yields = 0;
    await expect(prepared.renderFramePages({ graphicsResolver: resolver(seen), cooperative: {
      budgetMs: 0, signal: controller.signal,
      // One page's real work plus the page-entry checkpoints; cancellation
      // happens as the second page starts its first paragraph.
      yieldControl: async () => { if (++yields === firstPageYields + 3) controller.abort(); },
    } })).rejects.toMatchObject({ name: "AbortError" });
    expect(new Set(seen).size).toBe(3);
    expect((await prepared.renderFramePages()).pages).toHaveLength(2);
  });

  it("keeps concurrent prepared text/graphics renders independent across suspension", async () => {
    const prepared = prepareBeamerDocument(deck(column(graphicParagraphs("shared", 3) + picture)));
    const normal = await prepared.renderFrame({ graphicsResolver: resolver([], "normal") });
    let interrupted = false;
    const actual = await prepared.renderFrame({ graphicsResolver: resolver([], "normal"), cooperative: {
      budgetMs: 0, yieldControl: async () => {
        if (!interrupted) {
          interrupted = true;
          await prepared.renderFrame({ graphicsResolver: { cacheKey: "other", resolve: () => ({ status: "missing" }) } });
        }
      },
    } });
    expect(interrupted).toBe(true);
    expect(comparable(actual)).toEqual(comparable(normal));
  });

  it("preserves diagnostic order across asynchronous column pictures", async () => {
    const source = deck(String.raw`\begin{columns}
\begin{column}{.48\textwidth}\begin{tikzpicture}\draw (missingA)--(1,1);\end{tikzpicture}\end{column}
\begin{column}{.48\textwidth}\begin{mystery}Unsupported column\end{mystery}\end{column}
\end{columns}`);
    const normal = await renderBeamerFrame(source);
    const actual = await renderBeamerFrame(source, { cooperative: { budgetMs: 0, yieldControl: async () => {} } });
    expect(normal.diagnostics.length).toBeGreaterThan(0);
    expect(comparable(actual)).toEqual(comparable(normal));
  });

  it("does not yield within budget and rejects an already aborted public render", async () => {
    let yields = 0;
    const source = deck("One paragraph.");
    await renderBeamerFrame(source, { cooperative: {
      budgetMs: Infinity, yieldControl: async () => { yields++; },
    } });
    expect(yields).toBe(0);
    const controller = new AbortController();
    controller.abort();
    await expect(renderBeamerFramePages(source, { cooperative: {
      signal: controller.signal, yieldControl: async () => { yields++; },
    } })).rejects.toMatchObject({ name: "AbortError" });
    expect(yields).toBe(0);
  });
});
