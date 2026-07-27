import { describe, expect, it } from "vitest";

import {
  prepareBeamerDocument,
  type BeamerFrameLayout,
} from "../packages/core/src/beamer/index.js";

const SOURCE = String.raw`\documentclass{beamer}
\newcommand{\generatedword}{Generated}
\newcommand{\shout}[1]{#1!}
\begin{document}
\begin{frame}{Editable title \generatedword}
Direct prose and \textbf{bold words}. \generatedword
\shout{Macro argument}
\begin{itemize}
\item Editable item
\end{itemize}
\begin{block}{Editable block title}
Editable block body
\end{block}
\only<2->{Overlay text}
\[
  x + y
\]
\end{frame}
\begin{frame}{Later frame}
Later body
\end{frame}
\end{document}`;

function editableSlices(layout: BeamerFrameLayout, source = SOURCE): string[] {
  return layout.paragraphs.flatMap((paragraph) =>
    paragraph.editableTextSpans.map((editable) =>
      source.slice(editable.span.from, editable.span.to)
    )
  );
}

describe("Beamer canvas editing contract", () => {
  it("publishes only visible directly-authored prose spans", async () => {
    const page = await prepareBeamerDocument(SOURCE).renderFrame({
      frameIndex: 0,
      step: 1,
    });
    const slices = editableSlices(page.layout);
    const joined = slices.join("|");

    expect(joined).toContain("Editable title");
    expect(joined).toContain("Direct prose");
    expect(joined).toContain("bold words");
    expect(joined).toContain("Editable item");
    expect(joined).toContain("Editable block title");
    expect(joined).toContain("Editable block body");
    expect(joined).not.toContain("Generated");
    expect(joined).not.toContain("Macro argument");
    expect(joined).not.toContain("Overlay text");
    expect(joined).not.toContain("x + y");
    expect(
      page.layout.paragraphs.flatMap((paragraph) =>
        paragraph.editableTextSpans.flatMap((editable) => editable.hitBounds)
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          width: expect.any(Number),
          height: expect.any(Number),
        }),
      ])
    );
  });

  it.each([
    "Direct {",
    "Direct \\",
    String.raw`Direct \begin{`,
  ])("keeps document roots stable while %j is structurally masked", async (replacement) => {
      const from = SOURCE.indexOf("Direct prose");
      const edited =
        SOURCE.slice(0, from) +
        replacement +
        SOURCE.slice(from + "Direct prose".length);
      const masked = prepareBeamerDocument(edited, {
        structuralMasks: [{ from, to: from + replacement.length }],
      });

      expect(masked.document.frames.map((frame) => frame.title?.value)).toEqual([
        String.raw`Editable title \generatedword`,
        "Later frame",
      ]);
      const page = await masked.renderFrame({ frameIndex: 0, step: 1 });
      expect(page.layout.frameId).toBe("frame:0");
    });

  it("returns structured-clone-compatible editable span metadata", async () => {
    const page = await prepareBeamerDocument(SOURCE).renderFrame({
      frameIndex: 0,
      step: 1,
    });
    const editable = page.layout.paragraphs.map((paragraph) => ({
      paragraphId: paragraph.paragraphId,
      editableTextSpans: paragraph.editableTextSpans,
    }));
    expect(structuredClone(editable)).toEqual(editable);
  });
});
