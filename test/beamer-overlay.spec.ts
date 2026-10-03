import { describe, expect, it } from "vitest";

import {
  parseBeamerFrameBody,
  renderBeamerFramePages,
  scanBeamerDocument,
} from "../packages/core/src/beamer/index.js";
import {
  buildNativeBeamerPageTrace,
} from "../scripts/lib/beamer-frame-compare.mjs";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";

function deck(body: string): string {
  return String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Overlay contract}
${body}
\end{frame}
\end{document}`;
}

function tracedText(
  page: Awaited<ReturnType<typeof renderBeamerFramePages>>["pages"][number]
): string {
  return buildNativeBeamerPageTrace(
    page,
    computerModernTexMetricProvider
  ).lines
    .filter((line) => line.role === "body")
    .map((line) => line.text)
    .join(" ");
}

function tracedContentText(
  page: Awaited<ReturnType<typeof renderBeamerFramePages>>["pages"][number]
): string {
  return buildNativeBeamerPageTrace(
    page,
    computerModernTexMetricProvider
  ).lines
    .filter((line) =>
      line.role === "body" ||
      line.role === "block-title" ||
      line.role === "block-body"
    )
    .map((line) => line.text)
    .join(" ");
}

function listMarkerPaint(page: Awaited<ReturnType<typeof renderBeamerFramePages>>["pages"][number]) {
  return [...page.svg.svg.matchAll(/<g\b[^>]*data-tex-hbox-role="list-label"[^>]*>/gu)].map(match => ({
    from: Number(match[0].match(/data-source-start="(\d+)"/u)?.[1]),
    to: Number(match[0].match(/data-source-end="(\d+)"/u)?.[1]),
    visible: !match[0].includes('visibility="hidden"')
  }));
}

describe("Beamer overlays", () => {
  it.each([
    String.raw`\begin{itemize}\item<2> Later\end{itemize}\begin{itemize}\item Always\end{itemize}`,
    String.raw`\begin{itemize}\item Before\pause\item After\end{itemize}`
  ])("binds covered marker paint and hit ownership to each authored item: %s", async body => {
    const source = deck(body);
    const result = await renderBeamerFramePages(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.pages).toHaveLength(2);
    for (const [index, page] of result.pages.entries()) {
      const paint = listMarkerPaint(page);
      const markers = page.layout.items.filter(item => item.kind === "list-marker");
      expect(paint.filter(marker => marker.visible)).toHaveLength(index + 1);
      expect(markers.filter(marker => marker.visibility !== "hidden")).toHaveLength(index + 1);
      expect(paint.map(marker => ({ from: marker.from, to: marker.to }))).toEqual(markers.map(marker => marker.sourceSpan));
      for (const marker of paint) expect(source.slice(marker.from, marker.to)).toMatch(/^\\item/u);
      expect(new Set(paint.map(marker => marker.from)).size).toBe(2);
    }
  });

  it("preserves nested and custom-label source ownership after an earlier only removal", async () => {
    const source = deck(String.raw`\only<2>{Removed prefix}
      \begin{itemize}\item Outer\begin{enumerate}\item<2>[Custom] Nested\end{enumerate}\item Final\end{itemize}`);
    const result = await renderBeamerFramePages(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.pages.map(page => listMarkerPaint(page).filter(marker => marker.visible).length)).toEqual([2, 3]);
    for (const page of result.pages) {
      const paint = listMarkerPaint(page);
      expect(paint).toHaveLength(3);
      expect(source.slice(paint[1].from, paint[1].to)).toBe("\\item");
      expect(new Set(paint.map(marker => marker.from)).size).toBe(3);
      const nested = page.layout.paragraphs.flatMap(paragraph => paragraph.listStructure ?? [])
        .find(list => list.environment === "enumerate")!.items[0];
      expect(paint[1].from).toBe(nested.commandSpan.from);
      expect(paint[1].to).toBeLessThanOrEqual(nested.commandSpan.to);
      expect(source.slice(nested.labelSpan!.from, nested.labelSpan!.to)).toBe("Custom");
    }
  });

  it.each(["itemize", "enumerate"])("keeps the visible part of a custom %s label under nested overlay rules", async environment => {
    const source = deck(String.raw`\only<2>{Removed prefix}
      \begin{itemize}\item Outer\begin{${environment}}\item[\uncover<2>{X\only<2>{Z}}Y] Body\end{${environment}}\end{itemize}`);
    const result = await renderBeamerFramePages(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.pages).toHaveLength(2);
    const labelStart = source.indexOf("X\\only");
    const alwaysStart = source.indexOf("Y]");
    for (const [index, page] of result.pages.entries()) {
      const paint = listMarkerPaint(page);
      expect(paint).toHaveLength(2);
      expect(paint.every(marker => marker.visible)).toBe(true);
      expect(source.slice(paint[1].from, paint[1].to)).toBe("\\item");
      const glyphAt = (start: number) => page.svg.svg.match(new RegExp(`<path[^>]*data-source-start="${start}"[^>]*>`))?.[0];
      expect(glyphAt(labelStart)).toBeDefined();
      expect(glyphAt(labelStart)?.includes('visibility="hidden"')).toBe(index === 0);
      expect(glyphAt(alwaysStart)).toBeDefined();
      expect(glyphAt(alwaysStart)).not.toContain('visibility="hidden"');
      const nested = page.layout.paragraphs.flatMap(paragraph => paragraph.listStructure ?? [])
        .find(list => list.environment === environment && list.depth === 2)!.items[0];
      expect(source.slice(nested.labelSpan!.from, nested.labelSpan!.to)).toBe(String.raw`\uncover<2>{X\only<2>{Z}}Y`);
      const labelBox = page.layout.paragraphs.flatMap(paragraph => paragraph.vlistLayout.boxReport.items)
        .find(item => item.hboxRole?.kind === "list-label" && item.hboxRole.labelKind === "custom")!;
      expect(labelBox.sourceSpan).toEqual({ start: nested.labelSpan!.from, end: nested.labelSpan!.to });
      const removedPaint = glyphAt(source.indexOf("Z}}Y"));
      expect(removedPaint !== undefined).toBe(index === 1);
      if (removedPaint) expect(removedPaint).not.toContain('visibility="hidden"');
    }
  });

  it.each(["X", "$x$"])("covers only the %s child of a custom label", async child => {
    const source = deck(String.raw`\begin{itemize}\item[\uncover<2>{${child}}Y] Body\end{itemize}`);
    const result = await renderBeamerFramePages(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.pages).toHaveLength(2);
    const childStart = source.indexOf(child) + (child === "$x$" ? 1 : 0);
    const alwaysStart = source.indexOf("Y]");
    for (const [index, page] of result.pages.entries()) {
      expect(listMarkerPaint(page)[0].visible).toBe(true);
      const childPaint = page.svg.svg.match(new RegExp(`<(?:path|g)[^>]*data-source-start="${childStart}"[^>]*>`))?.[0];
      expect(childPaint).toBeDefined();
      expect(childPaint?.includes('visibility="hidden"')).toBe(index === 0);
      const siblingPaint = page.svg.svg.match(new RegExp(`<path[^>]*data-source-start="${alwaysStart}"[^>]*>`))?.[0];
      expect(siblingPaint).toBeDefined();
      expect(siblingPaint).not.toContain('visibility="hidden"');
      const label = page.layout.paragraphs.flatMap(paragraph => paragraph.listStructure ?? [])[0].items[0].labelSpan!;
      expect(source.slice(label.from, label.to)).toBe(String.raw`\uncover<2>{${child}}Y`);
    }
  });

  it("preserves overlay shaping boundaries in labels while ordinary labels retain ligatures", async () => {
    const source = deck(String.raw`\begin{itemize}\item[\uncover<2>{f}i] Body\item[fi] Control\end{itemize}`);
    const result = await renderBeamerFramePages(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.pages).toHaveLength(2);
    const coveredStart = source.indexOf("{f}i") + 1;
    const alwaysStart = coveredStart + 2;
    const controlStart = source.indexOf("[fi]") + 1;
    const widths: number[] = [];
    for (const [index, page] of result.pages.entries()) {
      expect(listMarkerPaint(page).every(marker => marker.visible)).toBe(true);
      const glyphAt = (start: number) => page.svg.svg.match(new RegExp(`<path[^>]*data-source-start="${start}"[^>]*>`))?.[0];
      expect(glyphAt(coveredStart)).toContain('data-tex-glyph="102"');
      expect(glyphAt(coveredStart)?.includes('visibility="hidden"')).toBe(index === 0);
      expect(glyphAt(alwaysStart)).toContain('data-tex-glyph="105"');
      expect(glyphAt(alwaysStart)).not.toContain('visibility="hidden"');
      expect(glyphAt(controlStart)).toContain('data-tex-glyph="64257"');
      const label = page.layout.paragraphs.flatMap(paragraph => paragraph.vlistLayout.boxReport.items)
        .find(item => item.hboxRole?.kind === "list-label" && item.hboxRole.itemIndex === 1)!;
      expect(source.slice(label.sourceSpan!.start, label.sourceSpan!.end)).toBe(String.raw`\uncover<2>{f}i`);
      widths.push(label.width);
    }
    expect(widths[0]).toBe(widths[1]);
    const control = await renderBeamerFramePages(deck(String.raw`\begin{itemize}\item[{f}i] Body\end{itemize}`));
    const groupedLabel = control.pages[0].layout.paragraphs.flatMap(paragraph => paragraph.vlistLayout.boxReport.items)
      .find(item => item.hboxRole?.kind === "list-label")!;
    expect(widths[0]).toBe(groupedLabel.width);
  });

  it.each(["uncover", "only"])("applies enclosing %s rules to list markers", async command => {
    const source = deck(String.raw`${"\\"}${command}<2>{\begin{itemize}\item Covered\end{itemize}}
      \begin{itemize}\item Always\end{itemize}`);
    const result = await renderBeamerFramePages(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.pages.map(page => listMarkerPaint(page).filter(marker => marker.visible).length)).toEqual([1, 2]);
    expect(result.pages.map(page => page.layout.items.filter(item => item.kind === "list-marker" && item.visibility !== "hidden").length)).toEqual([1, 2]);
  });

  it.each(["itemize", "enumerate", "description"])("inherits relative overlay defaults into nested %s", async environment => {
    const label = environment === "description" ? "[Term]" : "";
    const source = deck(String.raw`\begin{itemize}[<+->]\item Outer\begin{${environment}}\item${label} Nested\end{${environment}}\item Final\end{itemize}`);
    const document = scanBeamerDocument(source);
    const ir = parseBeamerFrameBody({ source, frame: document.frames[0], document });
    expect(ir.overlays.items.map(item => item.spec.resolved)).toEqual(["1-", "2-", "3-"]);
    expect(ir.overlays.items.map(item => item.defaultListSpan)).toEqual(ir.overlays.items.map(() => ir.overlays.listDefaults[0].span));
    const result = await renderBeamerFramePages(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.stepCount).toBe(3);
    expect(result.pages.map(page => listMarkerPaint(page).filter(marker => marker.visible).length)).toEqual(environment === "description" ? [1, 1, 2] : [1, 2, 3]);
    expect(tracedText(result.pages[0])).not.toContain("Nested");
    expect(tracedText(result.pages[1])).toContain("Nested");
    expect(tracedText(result.pages[1])).not.toContain("Final");
    if (environment === "description") {
      const labelStart = source.indexOf("Term");
      for (const [index, page] of result.pages.entries()) {
        const glyph = page.svg.svg.match(new RegExp(`<path[^>]*data-source-start="${labelStart}"[^>]*>`))?.[0];
        expect(glyph).toBeDefined();
        expect(glyph?.includes('visibility="hidden"')).toBe(index === 0);
      }
    }
  });

  it("restores parent defaults after a nested override and resets default ownership for siblings", async () => {
    const source = deck(String.raw`\begin{itemize}[<+->]\item Outer
      \begin{enumerate}[<4->]\item Nested\end{enumerate}\item Final\end{itemize}
      \begin{itemize}\item Always\end{itemize}\begin{itemize}[<+->]\item Later\end{itemize}`);
    const document = scanBeamerDocument(source);
    const ir = parseBeamerFrameBody({ source, frame: document.frames[0], document });
    expect(ir.overlays.items.map(item => item.spec.resolved)).toEqual(["1-", "4-", "2-", "3-"]);
    expect(ir.overlays.items.map(item => item.defaultListSpan)).toEqual([
      ir.overlays.listDefaults[0].span, ir.overlays.listDefaults[1].span,
      ir.overlays.listDefaults[0].span, ir.overlays.listDefaults[2].span
    ]);
    const result = await renderBeamerFramePages(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.pages.map(page => listMarkerPaint(page).filter(marker => marker.visible).length)).toEqual([2, 3, 4, 5]);
    expect(result.pages.every(page => tracedText(page).includes("Always"))).toBe(true);
  });

  it("resolves explicit, relative, item, and pause steps in source order", () => {
    const source = deck(String.raw`
\only<2>{Second}
\begin{itemize}
  \item<+-> Alpha
  \item<+-> Beta
\end{itemize}
\pause
After pause.`);
    const document = scanBeamerDocument(source);
    const ir = parseBeamerFrameBody({
      source,
      frame: document.frames[0],
    });

    expect(ir.overlays.commands.map((command) => ({
      kind: command.kind,
      resolved: command.spec.resolved,
    }))).toEqual([{ kind: "only", resolved: "2" }]);
    expect(ir.overlays.items.map((item) => item.spec.resolved)).toEqual([
      "1-",
      "2-",
    ]);
    expect(ir.overlays.pauses.map((pause) => pause.threshold)).toEqual([4]);
    expect(ir.overlays.stepCount).toBe(4);
  });

  it("removes only branches before layout and emits one native page per step", async () => {
    const source = deck(String.raw`
Prefix \only<2>{a deliberately long inserted phrase that changes wrapping}
suffix.`);
    const result = await renderBeamerFramePages(source);

    expect(result.stepCount).toBe(2);
    expect(result.pages.map((page) => page.layout.step)).toEqual([1, 2]);
    expect(tracedText(result.pages[0])).not.toContain("deliberately");
    expect(tracedText(result.pages[1])).toContain("deliberately");
    const firstBody = result.pages[0].layout.paragraphs.find(
      (paragraph) => paragraph.role === "body"
    )!;
    const secondBody = result.pages[1].layout.paragraphs.find(
      (paragraph) => paragraph.role === "body"
    )!;
    expect(firstBody.report.lines.length).toBeLessThan(
      secondBody.report.lines.length
    );
  });

  it("keeps covered material in layout while suppressing its paint", async () => {
    const source = deck(String.raw`
Always visible.
\uncover<2->{Covered material remains in the vertical list.}`);
    const result = await renderBeamerFramePages(source);
    const firstBody = result.pages[0].layout.paragraphs.find(
      (paragraph) => paragraph.role === "body"
    )!;
    const secondBody = result.pages[1].layout.paragraphs.find(
      (paragraph) => paragraph.role === "body"
    )!;

    expect(firstBody.bounds).toEqual(secondBody.bounds);
    expect(firstBody.report.lines.map((line) => line.width)).toEqual(
      secondBody.report.lines.map((line) => line.width)
    );
    expect(firstBody.hiddenSourceSpans).toHaveLength(1);
    expect(tracedText(result.pages[0])).not.toContain("Covered");
    expect(tracedText(result.pages[1])).toContain("Covered");
    expect(result.pages[0].svg.svg).toContain('visibility="hidden"');
  });

  it("projects item overlays without removing their list geometry", async () => {
    const source = deck(String.raw`
\begin{itemize}
  \item<1-> Alpha
  \item<2-> Beta
\end{itemize}`);
    const result = await renderBeamerFramePages(source);
    const markerCounts = result.pages.map((page) =>
      page.layout.items.filter((item) =>
        item.kind === "list-marker" && item.visibility !== "hidden"
      ).length
    );

    expect(markerCounts).toEqual([1, 2]);
    expect(tracedText(result.pages[0])).toContain("Alpha");
    expect(tracedText(result.pages[0])).not.toContain("Beta");
    expect(tracedText(result.pages[1])).toContain("Beta");
    expect(
      result.pages[0].layout.paragraphs.find(
        (paragraph) => paragraph.role === "body"
      )?.bounds
    ).toEqual(
      result.pages[1].layout.paragraphs.find(
        (paragraph) => paragraph.role === "body"
      )?.bounds
    );
  });

  it("applies list-level relative defaults to direct items", async () => {
    const source = deck(String.raw`
\begin{itemize}[<+->]
  \item Alpha
  \item Beta
  \item Gamma
\end{itemize}`);
    const result = await renderBeamerFramePages(source);

    expect(result.stepCount).toBe(3);
    expect(result.pages.map((page) =>
      page.layout.items.filter((item) =>
        item.kind === "list-marker" && item.visibility !== "hidden"
      ).length
    )).toEqual([1, 2, 3]);
    expect(tracedText(result.pages[0])).not.toContain("Beta");
    expect(tracedText(result.pages[2])).toContain("Gamma");
  });

  it("applies remove and keep-space semantics to structural environments", async () => {
    const source = deck(String.raw`
\begin{onlyenv}<2>
  \begin{block}{Removed block}Only on page two.\end{block}
\end{onlyenv}
\begin{uncoverenv}<3->
  \begin{block}{Covered block}Painted from page three.\end{block}
\end{uncoverenv}`);
    const result = await renderBeamerFramePages(source);
    const blocks = (pageIndex: number) =>
      result.pages[pageIndex].layout.items.filter(
        (item) => item.kind === "block" && item.visibility !== "hidden"
      );

    expect(result.stepCount).toBe(3);
    expect(blocks(0)).toHaveLength(0);
    expect(
      result.pages[0].layout.items.filter(
        (item) => item.kind === "block" && item.visibility === "hidden"
      )
    ).toHaveLength(1);
    expect(blocks(1).map((block) => block.id)).toEqual([
      expect.stringContaining(":block:"),
    ]);
    expect(blocks(2).map((block) => block.id)).toEqual([
      expect.stringContaining(":block:"),
    ]);
    expect(tracedContentText(result.pages[1])).toContain("Onlyonpagetwo");
    expect(tracedContentText(result.pages[1])).not.toContain(
      "Paintedfrompagethree"
    );
    expect(tracedContentText(result.pages[2])).toContain(
      "Paintedfrompagethree"
    );
  });

  it("keeps block structure for an action spec on the environment itself", async () => {
    const source = deck(String.raw`
Intro prose.
\begin{block}<2->{Acted block}
\begin{itemize}
\item Inside item
\end{itemize}
\end{block}`);
    const result = await renderBeamerFramePages(source);
    expect(result.stepCount).toBe(2);

    // The block is a real block on both pages: covered (space reserved,
    // paint suppressed) on page one, painted on page two. The begin/end
    // tokens are block structure, not overlay syntax to strip.
    const blockItems = (pageIndex: number) =>
      result.pages[pageIndex].layout.items.filter(
        (item) => item.kind === "block"
      );
    expect(blockItems(0)).toHaveLength(1);
    expect(blockItems(0)[0].visibility).toBe("hidden");
    expect(blockItems(1)).toHaveLength(1);
    expect(blockItems(1)[0].visibility).not.toBe("hidden");
    expect(tracedContentText(result.pages[1])).toContain("Actedblock");
    expect(tracedContentText(result.pages[1])).toContain("Insideitem");
    // The title parses behind the spec — no missing-title diagnostic.
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.code === "beamer-block-missing-title"
      )
    ).toHaveLength(0);
  });

  it("supports alternate, temporal, invisible, and pause projections", async () => {
    const source = deck(String.raw`
\alt<2>{During}{Otherwise}
\temporal<2>{Before}{At}{After}
\invisible<2>{Hidden on two}
Before pause.
\pause
After pause.`);
    const result = await renderBeamerFramePages(source);

    expect(result.stepCount).toBe(2);
    expect(tracedText(result.pages[0])).toContain("Otherwise");
    expect(tracedText(result.pages[0])).toContain("Before");
    expect(tracedText(result.pages[0])).toContain("Hiddenontwo");
    expect(tracedText(result.pages[0])).not.toContain("Afterpause");
    expect(tracedText(result.pages[1])).toContain("During");
    expect(tracedText(result.pages[1])).toContain("At");
    expect(tracedText(result.pages[1])).not.toContain("Hiddenontwo");
    expect(tracedText(result.pages[1])).toContain("Afterpause");
  });
});
