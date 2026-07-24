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

describe("Beamer overlays", () => {
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
      frame: document.frames[0]!,
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
    expect(tracedText(result.pages[0]!)).not.toContain("deliberately");
    expect(tracedText(result.pages[1]!)).toContain("deliberately");
    const firstBody = result.pages[0]!.layout.paragraphs.find(
      (paragraph) => paragraph.role === "body"
    )!;
    const secondBody = result.pages[1]!.layout.paragraphs.find(
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
    const firstBody = result.pages[0]!.layout.paragraphs.find(
      (paragraph) => paragraph.role === "body"
    )!;
    const secondBody = result.pages[1]!.layout.paragraphs.find(
      (paragraph) => paragraph.role === "body"
    )!;

    expect(firstBody.bounds).toEqual(secondBody.bounds);
    expect(firstBody.report.lines.map((line) => line.width)).toEqual(
      secondBody.report.lines.map((line) => line.width)
    );
    expect(firstBody.hiddenSourceSpans).toHaveLength(1);
    expect(tracedText(result.pages[0]!)).not.toContain("Covered");
    expect(tracedText(result.pages[1]!)).toContain("Covered");
    expect(result.pages[0]!.svg.svg).toContain('visibility="hidden"');
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
    expect(tracedText(result.pages[0]!)).toContain("Alpha");
    expect(tracedText(result.pages[0]!)).not.toContain("Beta");
    expect(tracedText(result.pages[1]!)).toContain("Beta");
    expect(
      result.pages[0]!.layout.paragraphs.find(
        (paragraph) => paragraph.role === "body"
      )?.bounds
    ).toEqual(
      result.pages[1]!.layout.paragraphs.find(
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
    expect(tracedText(result.pages[0]!)).not.toContain("Beta");
    expect(tracedText(result.pages[2]!)).toContain("Gamma");
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
      result.pages[pageIndex]!.layout.items.filter(
        (item) => item.kind === "block" && item.visibility !== "hidden"
      );

    expect(result.stepCount).toBe(3);
    expect(blocks(0)).toHaveLength(0);
    expect(
      result.pages[0]!.layout.items.filter(
        (item) => item.kind === "block" && item.visibility === "hidden"
      )
    ).toHaveLength(1);
    expect(blocks(1).map((block) => block.id)).toEqual([
      expect.stringContaining(":block:"),
    ]);
    expect(blocks(2).map((block) => block.id)).toEqual([
      expect.stringContaining(":block:"),
    ]);
    expect(tracedContentText(result.pages[1]!)).toContain("Onlyonpagetwo");
    expect(tracedContentText(result.pages[1]!)).not.toContain(
      "Paintedfrompagethree"
    );
    expect(tracedContentText(result.pages[2]!)).toContain(
      "Paintedfrompagethree"
    );
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
    expect(tracedText(result.pages[0]!)).toContain("Otherwise");
    expect(tracedText(result.pages[0]!)).toContain("Before");
    expect(tracedText(result.pages[0]!)).toContain("Hiddenontwo");
    expect(tracedText(result.pages[0]!)).not.toContain("Afterpause");
    expect(tracedText(result.pages[1]!)).toContain("During");
    expect(tracedText(result.pages[1]!)).toContain("At");
    expect(tracedText(result.pages[1]!)).not.toContain("Hiddenontwo");
    expect(tracedText(result.pages[1]!)).toContain("Afterpause");
  });
});
