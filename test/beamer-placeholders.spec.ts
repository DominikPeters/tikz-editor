import { describe, expect, it } from "vitest";

import { renderBeamerFrame } from "../packages/core/src/beamer/render.js";
import { buildBeamerObjectIndex } from "../packages/core/src/beamer/object-index.js";

// Use an unknown environment for generic fallback tests: ordinary
// tcolorbox now has a native renderer.
const UNSUPPORTED_ENVIRONMENT = String.raw`\begin{unknown}Unrendered <tag> & text\end{unknown}`;

function frameSource(body: string): string {
  return String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}[t]{Example}
${body}
\end{frame}
\end{document}`;
}

function sourceCards(result: Awaited<ReturnType<typeof renderBeamerFrame>>) {
  return result.layout.items.filter((item) => item.kind === "unsupported");
}

describe("Beamer visible source placeholders", () => {
  it("renders ordinary package boxes without replacing them with source cards", async () => {
    const source = frameSource(String.raw`Before.\begin{tcolorbox}[title=Heading]Supported body.\end{tcolorbox}After.`).replace("\\begin{document}", "\\usepackage{tcolorbox}\n\\begin{document}");
    const result = await renderBeamerFrame(source);
    expect(sourceCards(result)).toHaveLength(0);
    expect(result.diagnostics).toEqual([]);
    const box = result.layout.items.find(item => item.kind === "block")!;
    expect(source.slice(box.sourceSpan.from, box.sourceSpan.to)).toBe(String.raw`\begin{tcolorbox}[title=Heading]Supported body.\end{tcolorbox}`);
    expect(result.layout.paragraphs.some(paragraph => paragraph.report.lines.some(line => line.segments.some(segment => segment.text === "Supported")))).toBe(true);
    expect(result.svg.svg).toContain('data-tcolorbox-layer="frame"');
  });

  it("keeps unsupported package skins in one source-owned placeholder", async () => {
    const opaque = String.raw`\begin{tcolorbox}[enhanced]Unrendered body.\end{tcolorbox}`;
    const source = frameSource(`Before.${opaque}After.`);
    const result = await renderBeamerFrame(source);
    const [card] = sourceCards(result);
    expect(sourceCards(result)).toHaveLength(1);
    expect(source.slice(card.sourceSpan.from, card.sourceSpan.to)).toBe(opaque);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "beamer-tcolorbox-unsupported-option", span: expect.objectContaining({ from: source.indexOf("enhanced") }) }));
  });

  it("keeps surrounding text, source spans and non-overlapping flow geometry", async () => {
    const source = frameSource(`Before.\n${UNSUPPORTED_ENVIRONMENT}\nAfter.`);
    const result = await renderBeamerFrame(source);
    const [card] = sourceCards(result);
    expect(sourceCards(result)).toHaveLength(1);
    expect(source.slice(card.sourceSpan.from, card.sourceSpan.to)).toBe(UNSUPPORTED_ENVIRONMENT);
    expect(result.svg.svg).toContain("data-beamer-placeholder=");
    expect(result.svg.svg).toContain("Unsupported content");
    expect(result.svg.svg).toContain("&lt;tag&gt; &amp;");
    expect(result.svg.svg).not.toContain("<tag>");
    const body = result.layout.paragraphs.filter((paragraph) => paragraph.role === "body");
    expect(body.map((paragraph) => source.slice(paragraph.sourceSpan.from, paragraph.sourceSpan.to)))
      .toEqual(["Before.", "After."]);
    expect(body[0].bounds.y + body[0].bounds.height).toBeLessThanOrEqual(card.bounds.y);
    expect(card.bounds.y + card.bounds.height).toBeLessThanOrEqual(body[1].bounds.y);
    const objects = buildBeamerObjectIndex({
      items: result.layout.items,
      paragraphs: result.layout.paragraphs,
      source,
    });
    expect(objects.byId.get(card.id)?.sourceSpan).toEqual(card.sourceSpan);
  });

  it("reserves space within a column and preserves the other column", async () => {
    const source = frameSource(String.raw`\begin{columns}[t]
\begin{column}{.45\textwidth}
Before.
${UNSUPPORTED_ENVIRONMENT}
After.
\end{column}
\begin{column}{.45\textwidth}Other column.\end{column}
\end{columns}`);
    const result = await renderBeamerFrame(source);
    const [card] = sourceCards(result);
    expect(sourceCards(result)).toHaveLength(1);
    const parent = result.layout.items.find((item) => item.id === card.parentId)!;
    expect(parent.kind).toBe("column");
    expect(parent.childIds).toContain(card.id);
    expect(card.bounds.width).toBe(parent.bounds.width);
    expect(card.bounds.y + card.bounds.height).toBeLessThanOrEqual(parent.bounds.y + parent.bounds.height);
    expect(result.layout.paragraphs.some((paragraph) =>
      source.slice(paragraph.sourceSpan.from, paragraph.sourceSpan.to) === "Other column."
    )).toBe(true);
  });

  it("shows a bounded source card for an entirely unsupported body", async () => {
    const source = frameSource(String.raw`\begin{unknown}${"long source ".repeat(1000)}\end{unknown}`);
    const result = await renderBeamerFrame(source);
    const [card] = sourceCards(result);
    expect(sourceCards(result)).toHaveLength(1);
    expect(card.bounds.height).toBeLessThanOrEqual(54);
    expect(result.svg.svg).toContain("…");
    expect(result.svg.svg.length).toBeLessThan(50_000);
    expect(card.sourceSpan.to - card.sourceSpan.from).toBeGreaterThan(10_000);
  });

  it.each(["block", "exampleblock", "theorem", "proof"])("preserves supported siblings and source ownership inside %s", async environment => {
    const heading = environment.endsWith("block") ? "{Heading}" : "";
    const source = frameSource(String.raw`\begin{${environment}}${heading}
Before.
${UNSUPPORTED_ENVIRONMENT}
Between.
\begin{alltt}second opaque region\end{alltt}
After.
\end{${environment}}`);
    const result = await renderBeamerFrame(source);
    const cards = sourceCards(result);
    expect(cards).toHaveLength(2);
    const block = result.layout.items.find(item => item.kind === "block")!;
    const paragraphs = result.layout.paragraphs.filter(paragraph => paragraph.role === "block-body");
    expect(paragraphs.map(paragraph => source.slice(paragraph.sourceSpan.from, paragraph.sourceSpan.to)))
      .toEqual(["Before.", "Between.", "After."]);
    expect(source.slice(cards[0].sourceSpan.from, cards[0].sourceSpan.to)).toBe(UNSUPPORTED_ENVIRONMENT);
    for (const [index, card] of cards.entries()) {
      expect(card.parentId).toBe(block.id);
      expect(block.childIds).toContain(card.id);
      expect(card.bounds.height).toBeLessThanOrEqual(54);
      expect(paragraphs[index].bounds.y + paragraphs[index].bounds.height).toBeLessThanOrEqual(card.bounds.y);
      expect(card.bounds.y + card.bounds.height).toBeLessThanOrEqual(paragraphs[index + 1].bounds.y);
      expect(card.bounds.y + card.bounds.height).toBeLessThanOrEqual(block.bounds.y + block.bounds.height);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        code: "beamer-render-unsupported-flow-node", span: card.sourceSpan,
      }));
    }
  });

  it.each(["uncover", "only"])("preserves %s source-card visibility and spacing inside blocks", async command => {
    const source = frameSource(String.raw`\begin{block}{Heading}
Before.
${"\\"}${command}<2>{${UNSUPPORTED_ENVIRONMENT}}
After.
\end{block}`);
    const hidden = await renderBeamerFrame(source, { step: 1 });
    const visible = await renderBeamerFrame(source, { step: 2 });
    expect(sourceCards(hidden)).toHaveLength(0);
    expect(sourceCards(visible)).toHaveLength(1);
    const afterY = (result: typeof hidden) => result.layout.paragraphs.find(paragraph =>
      source.slice(paragraph.sourceSpan.from, paragraph.sourceSpan.to).includes("After.")
    )!.bounds.y;
    if (command === "uncover") expect(afterY(hidden)).toBeCloseTo(afterY(visible), 6);
    else expect(afterY(hidden)).toBeLessThan(afterY(visible));
  });

  it.each(["", "% only a comment", String.raw`\only<2>{Later}`])("does not flag empty or removed content: %s", async (body) => {
    const result = await renderBeamerFrame(frameSource(body), { step: 1 });
    expect(sourceCards(result)).toHaveLength(0);
    expect(result.svg.svg).not.toContain("data-beamer-placeholder=");
  });

  it.each(["uncover", "only"])("respects %s overlays without hidden hit targets", async (command) => {
    const source = frameSource(`\\${command}<2>{${UNSUPPORTED_ENVIRONMENT}}\nAfter.`);
    const hidden = await renderBeamerFrame(source, { step: 1 });
    const visible = await renderBeamerFrame(source, { step: 2 });
    expect(sourceCards(hidden)).toHaveLength(0);
    expect(sourceCards(visible)).toHaveLength(1);
    expect(hidden.svg.svg).not.toContain("data-beamer-placeholder=");
    const followingParagraphY = (result: typeof hidden) => result.layout.paragraphs.find((paragraph) =>
      source.slice(paragraph.sourceSpan.from, paragraph.sourceSpan.to).includes("After.")
    )!.bounds.y;
    if (command === "uncover") {
      expect(followingParagraphY(hidden)).toBeCloseTo(followingParagraphY(visible), 6);
    } else {
      expect(followingParagraphY(hidden)).toBeLessThan(followingParagraphY(visible));
    }
  });

  it.each([false, true])("keeps nested structures inside their unsupported owner (column=%s)", async (column) => {
    const nested = String.raw`\begin{tcolorbox}
\begin{block}{Inside}Content\end{block}
\begin{itemize}\item Nested list\end{itemize}
\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}
\end{tcolorbox}`;
    const body = column
      ? String.raw`\begin{columns}\begin{column}{.5\textwidth}${nested}\end{column}\end{columns}`
      : nested;
    const source = frameSource(body);
    const result = await renderBeamerFrame(source);
    expect(sourceCards(result)).toHaveLength(1);
    const [card] = sourceCards(result);
    expect(source.slice(card.sourceSpan.from, card.sourceSpan.to)).toBe(nested);
    expect(result.layout.items.some((item) =>
      item.kind === "block" || item.kind === "tikzpicture"
    )).toBe(false);
  });

  it("leaves inline wrappers and math arrays to the paragraph renderer", async () => {
    const result = await renderBeamerFrame(frameSource(String.raw`\textbf{${UNSUPPORTED_ENVIRONMENT}}
\[\begin{array}{cc}a&b\\c&d\end{array}\]`));
    expect(sourceCards(result)).toHaveLength(0);
    expect(result.layout.paragraphs.some((paragraph) => paragraph.role === "body")).toBe(true);
  });

  it.each(["uncoverenv", "onlyenv"])("respects %s in columns", async (environment) => {
    const source = frameSource(String.raw`\begin{columns}[t]\begin{column}{.5\textwidth}
\begin{${environment}}<2>${UNSUPPORTED_ENVIRONMENT}\end{${environment}}
After.
\end{column}\end{columns}`);
    const hidden = await renderBeamerFrame(source, { step: 1 });
    const visible = await renderBeamerFrame(source, { step: 2 });
    expect(sourceCards(hidden)).toHaveLength(0);
    expect(sourceCards(visible)).toHaveLength(1);
    const columnHeight = (result: typeof hidden) =>
      result.layout.items.find((item) => item.kind === "column")!.bounds.height;
    if (environment === "uncoverenv") {
      expect(columnHeight(hidden)).toBeCloseTo(columnHeight(visible), 6);
    } else {
      expect(columnHeight(hidden)).toBeLessThan(columnHeight(visible));
    }
  });

  it("preserves supported math, lists and minipages", async () => {
    const result = await renderBeamerFrame(frameSource(String.raw`\begin{equation}x=1\end{equation}
\begin{itemize}\item Item\end{itemize}
\begin{minipage}{2cm}Small box.\end{minipage}`));
    expect(sourceCards(result)).toHaveLength(0);
  });
});
