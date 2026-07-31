import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  prepareBeamerDocument,
  resolveBeamerEditScopeAt,
  type BeamerFrameLayout,
} from "../packages/core/src/beamer/index.js";

const SOURCE = String.raw`\documentclass{beamer}
\newcommand{\generatedword}{Generated}
\newcommand{\shout}[1]{#1!}
\newcommand{\plain}[1]{#1}
\begin{document}
\begin{frame}{Editable title \generatedword}
Direct prose and \textbf{bold words}. \generatedword
\shout{Macro argument} \plain{Plain wrapped}
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

function editableSlices(
  layout: BeamerFrameLayout,
  source = SOURCE,
  kind: "text" | "math" = "text"
): string[] {
  return layout.paragraphs.flatMap((paragraph) =>
    paragraph.editableTextSpans
      .filter((editable) => editable.kind === kind)
      .map((editable) => source.slice(editable.span.from, editable.span.to))
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
    expect(joined).not.toContain("Plain wrapped");
    expect(joined).not.toContain("Overlay text");
    expect(joined).not.toContain("x + y");

    // Math islands publish click-into hit spans of their own kind.
    const mathJoined = editableSlices(page.layout, SOURCE, "math").join("|");
    expect(mathJoined).toContain("x + y");
    expect(mathJoined).not.toContain("Direct prose");

    // Macro output publishes atomic click-to-select spans covering the
    // invocation; hidden overlay material publishes nothing.
    const atomSlices = page.layout.paragraphs.flatMap((paragraph) =>
      paragraph.atomicRenderSpans.map((atom) =>
        SOURCE.slice(atom.span.from, atom.span.to)
      )
    );
    expect(atomSlices).toContain(String.raw`\generatedword`);
    // Rendered argument output selects the whole invocation, including for
    // macros whose output is nothing but their argument.
    expect(atomSlices).toContain(String.raw`\shout{Macro argument}`);
    expect(atomSlices).toContain(String.raw`\plain{Plain wrapped}`);
    expect(atomSlices.join("|")).not.toContain("Overlay text");
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

  it("publishes edit scopes with nearest-container resolution", async () => {
    const kktSource = readFileSync(
      fileURLToPath(new URL("./fixtures/beamer/kkt_theorem_beamer.tex", import.meta.url)),
      "utf8"
    );
    const prepared = prepareBeamerDocument(kktSource);

    // Frame 2 ("Why KKT conditions matter"): title + two columns + body.
    const columnsPage = await prepared.renderFrame({ frameIndex: 1, step: 1 });
    const columnsScopes = columnsPage.layout.editScopes;
    expect(columnsScopes.map((scope) => scope.kind)).toEqual([
      "frame-title",
      "column",
      "column",
      "frame-body",
    ]);
    const titleScope = columnsScopes[0];
    expect(kktSource.slice(titleScope.span.from, titleScope.span.to)).toBe(
      "Why KKT conditions matter"
    );
    const columnProse = kktSource.indexOf("KKT conditions turn a constrained");
    const columnScope = resolveBeamerEditScopeAt(columnsScopes, columnProse);
    expect(columnScope?.kind).toBe("column");
    expect(kktSource.slice(columnScope!.span.from, columnScope!.span.to)).toContain(
      "They generalize"
    );
    expect(
      resolveBeamerEditScopeAt(columnsScopes, titleScope.span.from + 1)?.kind
    ).toBe("frame-title");

    // Frame 3 ("Problem form and notation"): no containers, so prose,
    // display math, and glue all resolve to the whole-body scope.
    const bodyPage = await prepared.renderFrame({ frameIndex: 2, step: 1 });
    const bodyScopes = bodyPage.layout.editScopes;
    expect(bodyScopes.map((scope) => scope.kind)).toEqual([
      "frame-title",
      "frame-body",
    ]);
    for (const anchor of ["We consider", "minimize", "\\vspace{.3em}"]) {
      const offset = kktSource.indexOf(anchor, bodyScopes[1].span.from);
      expect(resolveBeamerEditScopeAt(bodyScopes, offset)?.kind).toBe("frame-body");
    }
    expect(structuredClone(bodyScopes)).toEqual(bodyScopes);
  });

  it("renders title-page metadata fields as editable preamble scopes", async () => {
    const source = String.raw`\documentclass{beamer}
\title{Deck title}
\subtitle{Deck subtitle}
\author{Ada Lovelace}
\institute{Analytical Engine Institute}
\date{December 1843}
\begin{document}
\begin{frame}
\titlepage
\end{frame}
\end{document}`;
    const page = await prepareBeamerDocument(source).renderFrame({
      frameIndex: 0,
      step: 1,
    });

    const byRole = new Map(
      page.layout.paragraphs.map((paragraph) => [paragraph.role, paragraph])
    );
    for (const [role, text] of [
      ["title", "Deck title"],
      ["subtitle", "Deck subtitle"],
      ["author", "Ada Lovelace"],
      ["institute", "Analytical Engine Institute"],
      ["date", "December 1843"],
    ] as const) {
      const paragraph = byRole.get(role);
      expect(paragraph, role).toBeDefined();
      expect(
        source.slice(paragraph!.sourceSpan.from, paragraph!.sourceSpan.to),
        role
      ).toBe(text);
      expect(editableSlices(page.layout, source).join("|"), role).toContain(
        text
      );
    }
    // Metadata boxes stack below the title box in template order.
    const tops = (["subtitle", "author", "institute", "date"] as const).map(
      (role) => byRole.get(role)!.bounds.y
    );
    expect(tops).toEqual([...tops].sort((a, b) => a - b));

    // Each field is its own preamble scope patching the preamble span.
    const preambleScopes = page.layout.editScopes.filter(
      (scope) => scope.kind === "preamble-field"
    );
    expect(preambleScopes).toHaveLength(5);
    const authorOffset = source.indexOf("Ada Lovelace");
    const authorScope = resolveBeamerEditScopeAt(
      page.layout.editScopes,
      authorOffset
    );
    expect(authorScope?.kind).toBe("preamble-field");
    expect(
      source.slice(authorScope!.span.from, authorScope!.span.to)
    ).toBe("Ada Lovelace");
    // Frame-body offsets still resolve to the frame-body scope.
    expect(
      resolveBeamerEditScopeAt(
        page.layout.editScopes,
        source.indexOf(String.raw`\titlepage`)
      )?.kind
    ).toBe("frame-body");
  });

  it("centers short metadata lines that exceed the finite-skip breaker", async () => {
    // Madrid's wider rounded title box previously made the 8pt institute
    // line infeasible for the generic centered breaker; the center retry
    // must land it mid-measure instead of dropping the paragraph.
    const source = String.raw`\documentclass{beamer}
\usetheme{Madrid}
\title{Deck title}
\author{Ada Lovelace}
\institute{Analytical Engine Institute}
\date{December 1843}
\begin{document}
\begin{frame}
\titlepage
\end{frame}
\end{document}`;
    const page = await prepareBeamerDocument(source).renderFrame({
      frameIndex: 0,
      step: 1,
    });
    const institute = page.layout.paragraphs.find(
      (paragraph) => paragraph.role === "institute"
    );
    expect(institute).toBeDefined();
    const line = institute!.report.lines[0];
    expect(line).toBeDefined();
    const center = Number(line.xStart) + Number(line.width) / 2;
    expect(center).toBeCloseTo(institute!.bounds.width / 2, 4);
  });

  it("keeps empty metadata fields as empty boxes without scopes", async () => {
    const source = String.raw`\documentclass{beamer}
\title{Deck title}
\author{}
\date{}
\begin{document}
\begin{frame}
\titlepage
\end{frame}
\end{document}`;
    const page = await prepareBeamerDocument(source).renderFrame({
      frameIndex: 0,
      step: 1,
    });

    expect(
      page.layout.paragraphs.map((paragraph) => paragraph.role)
    ).not.toContain("author");
    expect(
      page.layout.editScopes.filter(
        (scope) => scope.kind === "preamble-field"
      ).map((scope) => scope.id)
    ).toEqual(["frame:0:scope:preamble:title"]);
  });

  describe("editing corpus fixture", () => {
    const corpusSource = readFileSync(
      fileURLToPath(
        new URL("./fixtures/beamer/editing_corpus_beamer.tex", import.meta.url)
      ),
      "utf8"
    );
    const corpus = prepareBeamerDocument(corpusSource);

    it("strips command-form titles from body flow and splits at \\vfill", async () => {
      const frame = corpus.document.frames[0];
      expect(frame.title?.value).toBe("Command-form title");
      expect(frame.subtitle?.value).toBe("Command-form subtitle");

      const page = await corpus.renderFrame({ frameIndex: 0, step: 1 });
      const slices = editableSlices(page.layout, corpusSource);
      const joined = slices.join("|");
      expect(joined).toContain("First line");
      expect(joined).toContain("second line");
      expect(joined).toContain("Signed with");
      // Header commands are lifted into the frame model, never typeset as
      // body prose (frame subtitles are not rendered by any headline
      // template yet, so the subtitle text appears nowhere).
      expect(joined).not.toContain("frametitle");
      expect(joined).not.toContain("Short title");
      expect(joined).not.toContain("Command-form subtitle");
      // `\vfill` ends the paragraph like TeX vertical glue; the prose on
      // both sides survives as separate paragraphs and the glue itself is
      // structural source, not editable text.
      expect(joined).not.toContain("vfill");
      expect(
        page.layout.paragraphs.filter((p) => p.role === "body").map((p) => p.paragraphId)
      ).toEqual(["frame:0:paragraph:0", "frame:0:paragraph:0:1"]);

      // Argument-bearing macro calls publish whole-invocation atoms.
      const atoms = page.layout.paragraphs.flatMap((paragraph) =>
        paragraph.atomicRenderSpans.map((atom) =>
          corpusSource.slice(atom.span.from, atom.span.to)
        )
      );
      expect(atoms).toContain(String.raw`\inner{x}{y}`);
      expect(atoms).toContain(String.raw`\highlight{a wrapped phrase}`);
    });

    it("publishes editable prose for nested lists, empty items, and description bodies", async () => {
      const page = await corpus.renderFrame({ frameIndex: 1, step: 1 });
      const joined = editableSlices(page.layout, corpusSource).join("|");
      expect(joined).toContain("Outer first");
      expect(joined).toContain("Nested numbered");
      expect(joined).toContain("Outer after empty");
      expect(joined).toContain("Points uphill");
      expect(joined).toContain("Curves the bowl");
      // Known gap: description labels render as list chrome and are not
      // yet editable on canvas.
      expect(joined).not.toContain("Gradient");
      expect(joined).not.toContain("Hessian");
    });

    it("gates editable spans per overlay step across pause, alt, temporal, and incremental lists", async () => {
      const pages = await corpus.renderFramePages({ frameIndex: 2 });
      expect(pages.stepCount).toBe(3);
      const bodyTexts = (step: number) =>
        pages.pages[step - 1].layout.paragraphs
          .filter((paragraph) => paragraph.role === "body")
          .flatMap((paragraph) =>
            paragraph.editableTextSpans.map((editable) =>
              corpusSource.slice(editable.span.from, editable.span.to).trim()
            )
          )
          .filter((text) => text.length > 0)
          .sort();
      expect(bodyTexts(1)).toEqual(["Always visible"]);
      expect(bodyTexts(2)).toEqual([
        "Alt otherwise",
        "Always visible",
        "Incremental one",
        "Revealed second",
        "Temporal during",
      ]);
      expect(bodyTexts(3)).toEqual([
        "Alt on three",
        "Always visible",
        "Incremental one",
        "Incremental two",
        "Revealed second",
        "Temporal after",
      ]);
      // The leading \pause covers the temporal's step-1 branch, so it can
      // never appear on any step.
      for (const step of [1, 2, 3]) {
        expect(bodyTexts(step)).not.toContain("Temporal before");
      }
    });

    it("lays out graphics size variants with precise filename spans", async () => {
      const page = await corpus.renderFrame({ frameIndex: 3, step: 1 });
      const graphics = page.layout.graphics;
      expect(
        graphics.map((graphic) =>
          corpusSource.slice(graphic.filenameSpan.from, graphic.filenameSpan.to)
        )
      ).toEqual(["plots/loss-curve", "diagrams/architecture", "photos/team"]);
      // width=3cm, height=2cm, scale=0.5 of the 28.45pt placeholder.
      expect(graphics[0].bounds.width).toBeCloseTo(85.36, 1);
      expect(graphics[1].bounds.height).toBeCloseTo(56.91, 1);
      expect(graphics[2].bounds.width).toBeCloseTo(14.23, 1);
      for (const graphic of graphics) {
        expect(graphic.caretPolicy).toBe("filename-linear");
        expect(graphic.asset.status).toBe("missing");
      }
      // Each command also publishes a click-into hit span.
      const mathJoined = editableSlices(page.layout, corpusSource, "math").join("|");
      expect(mathJoined).toContain(
        String.raw`\includegraphics[width=3cm]{plots/loss-curve}`
      );
      expect(mathJoined).toContain(
        String.raw`\includegraphics[scale=0.5]{photos/team}`
      );
    });

    it("falls back to an unsupported body for fragile verbatim frames without editing surfaces", async () => {
      expect(corpus.document.frames[4].options?.fragile).toBe(true);
      const page = await corpus.renderFrame({ frameIndex: 4, step: 1 });
      // The whole body renders as the unsupported-body placeholder: no
      // body paragraphs, no editable spans, no atoms — so no canvas
      // session can anchor inside it (the title stays editable).
      expect(page.layout.paragraphs.map((p) => p.role)).toEqual(["frame-title"]);
      expect(
        page.diagnostics.some(
          (diagnostic) => diagnostic.code === "beamer-render-unsupported-body"
        )
      ).toBe(true);
      expect(editableSlices(page.layout, corpusSource)).toEqual([
        "Verbatim listing",
      ]);
    });
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
