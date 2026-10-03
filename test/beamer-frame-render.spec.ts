import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { renderBeamerFrame, prepareBeamerDocument } from "../packages/core/src/beamer/index.js";
import type { DocumentGraphicsResolver } from "../packages/core/src/graphics/index.js";

const FIXTURE_PATH = new URL(
  "./fixtures/beamer/kkt_theorem_beamer.tex",
  import.meta.url
);
const HELLO_WORLD_FIXTURE_PATH = new URL(
  "./fixtures/beamer/hello_world_beamer.tex",
  import.meta.url
);
const INFOLINES_NAVIGATION_FIXTURE_PATH = new URL(
  "./fixtures/beamer/infolines_navigation_beamer.tex",
  import.meta.url
);

describe("headless Beamer frame renderer", () => {
  it("renders a multi-item nested list followed by an outer item", async () => {
    // Regression: the second nested item's interline glue used to land
    // between its list-label hbox and paragraph, breaking the measurer's
    // label/paragraph adjacency invariant (spacing.ts).
    const source = [
      "\\documentclass{beamer}",
      "\\begin{document}",
      "\\begin{frame}{Nested}",
      "\\begin{itemize}",
      "\\item First one",
      "\\begin{itemize}",
      "\\item Inner row",
      "\\item Inner two",
      "\\end{itemize}",
      "\\item Outer last",
      "\\end{itemize}",
      "\\end{frame}",
      "\\end{document}",
    ].join("\n");
    const result = await renderBeamerFrame(source, { frameIndex: 0 });
    const body = result.layout.paragraphs.find((paragraph) => paragraph.role === "body");
    expect(body).toBeDefined();
    const rowTexts = body!.report.lines.map((line) =>
      line.segments.map((segment) => segment.text ?? "").join("")
    );
    expect(rowTexts.join("\n")).toContain("Inner two");
    // Inner rows keep vertical order: the glue fix must not reorder rows.
    const placementFor = (needle: string) => {
      const line = body!.report.lines.find((candidate) =>
        candidate.segments.some((segment) => segment.text?.includes(needle))
      )!;
      return Number(
        body!.vlistLayout.linePlacements.find(
          (candidate) => candidate.lineIndex === line.lineIndex
        )!.y
      );
    };
    expect(placementFor("row")).toBeLessThan(placementFor("two"));
    expect(placementFor("two")).toBeLessThan(placementFor("last"));
  });

  it("renders Infolines section navigation at the measured TeX positions", async () => {
    const source = readFileSync(INFOLINES_NAVIGATION_FIXTURE_PATH, "utf8");
    const result = await renderBeamerFrame(source, { frameIndex: 0 });
    const headline = result.layout.paragraphs.filter(
      (paragraph) => paragraph.role === "headline"
    );
    const firstLinePosition = (paragraph: (typeof headline)[number]) => {
      const line = paragraph.report.lines[0];
      const placement = paragraph.vlistLayout.linePlacements.find(
        (candidate) => candidate.lineIndex === line.lineIndex
      )!;
      return {
        x: paragraph.bounds.x + Number(line.xStart),
        baselineY:
          paragraph.bounds.y +
          Number(placement.y) +
          Number(line.ascent),
      };
    };

    expect(headline.map((paragraph) => paragraph.paragraphId)).toEqual([
      "frame:0:headline:section",
      "frame:0:headline:subsection",
    ]);
    expect(firstLinePosition(headline[0])).toEqual({
      x: expect.closeTo(189.947056, 6),
      baselineY: expect.closeTo(7.059586, 6),
    });
    expect(firstLinePosition(headline[1])).toEqual({
      x: expect.closeTo(232.957039, 6),
      baselineY: expect.closeTo(7.059586, 6),
    });
    const sectionVListReport = headline[0].vlistLayout.reports.find(
      (report) =>
        "paragraphId" in report &&
        report.paragraphId === "frame:0:headline:section"
    );
    expect(
      sectionVListReport &&
      "lines" in sectionVListReport
        ? Number(sectionVListReport.lines[0]?.segments[0]?.caretStops?.[0])
        : undefined
    ).toBeCloseTo(189.947056, 6);
    expect(result.svg.svg).toContain(
      'data-paragraph-id="frame:0:headline:section"'
    );
    expect(result.svg.svg).toContain(
      'data-paragraph-id="frame:0:headline:subsection"'
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("renders the KKT title page through theme-owned frame flow", async () => {
    const source = readFileSync(FIXTURE_PATH, "utf8");
    const result = await renderBeamerFrame(source, { frameIndex: 0 });
    const title = result.layout.paragraphs.find(
      (paragraph) => paragraph.role === "title"
    )!;
    const subtitle = result.layout.paragraphs.find(
      (paragraph) => paragraph.role === "subtitle"
    )!;
    const baseline = (paragraph: typeof title) => {
      const line = paragraph.report.lines[0];
      const placement = paragraph.vlistLayout.linePlacements.find(
        (candidate) => candidate.lineIndex === line.lineIndex
      )!;
      return paragraph.bounds.y + Number(placement.y) + Number(line.ascent);
    };
    const titlePage = result.layout.items.find(
      (item) => item.kind === "title-page"
    )!;

    expect(titlePage.bounds).toEqual(
      expect.objectContaining({
        x: expect.closeTo(6.935, 6),
        y: expect.closeTo(20.944441, 6),
        width: expect.closeTo(441.374094, 6),
        height: expect.closeTo(60.468338, 6),
      })
    );
    expect(baseline(title)).toBeCloseTo(45.453032, 6);
    expect(baseline(subtitle)).toBeCloseTo(62.653029, 6);
    expect(result.layout.embeddedTikz[0]?.bounds.y).toBeCloseTo(
      147.059999,
      6
    );
    expect(result.svg.svg).toContain(
      'data-beamer-title-page-template="beamer/title-page/rounded-shadow"'
    );
    const navigation = result.layout.items.find(
      (item) => item.kind === "navigation-symbols"
    )!;
    expect(navigation.bounds).toEqual({
      x: expect.closeTo(325.318819, 6),
      y: expect.closeTo(238.416798, 6),
      width: expect.closeTo(127.08, 6),
      height: 7,
    });
    expect(result.svg.svg).toContain(
      'data-beamer-vector-template="beamer/navigation-symbols/default"'
    );
    expect(result.svg.svg).toContain('stroke="#adade0"');
    expect(result.svg.svg).toContain('fill="#d6d6f0"');
    expect(result.diagnostics).toEqual([]);
  }, 20_000);

  it("renders the representative KKT columns frame through the native engines", async () => {
    const source = readFileSync(FIXTURE_PATH, "utf8");
    const result = await renderBeamerFrame(source, { frameIndex: 1 });

    expect(result.frame.title?.value).toBe("Why KKT conditions matter");
    expect(result.layout.coordinateSystem).toEqual({
      unit: "tex-pt",
      origin: "top-left",
      yAxis: "down",
    });
    expect(result.layout.page.themeId).toBe("Madrid");
    expect(result.svg.svg).toContain('data-tex-font="lmsans12-regular"');
    expect(result.layout.items.filter((item) => item.kind === "column")).toHaveLength(2);
    expect(result.layout.items.filter((item) => item.kind === "tikzpicture")).toHaveLength(1);
    expect(result.layout.paragraphs.map((paragraph) => paragraph.role)).toEqual([
      "frame-title",
      "footline",
      "footline",
      "body",
      "body",
    ]);
    expect(result.layout.embeddedTikz).toHaveLength(1);

    for (const paragraph of result.layout.paragraphs) {
      expect(paragraph.report.sourceCoordinateSpace).toBe("document");
      expect(
        paragraph.vlistLayout.reports.some(
          (report) =>
            "sourceCoordinateSpace" in report &&
            report.sourceCoordinateSpace === "document"
        )
      ).toBe(true);
    }
    const intro = result.layout.paragraphs.find(
      (paragraph) =>
        paragraph.role === "body" &&
        source.slice(paragraph.sourceSpan.from, paragraph.sourceSpan.to)
          .startsWith("KKT conditions")
    )!;
    expect(intro.report.lines).toHaveLength(2);
    expect(intro.report.lines[0]?.segments[0]?.sourceStartRaw).toBe(
      intro.sourceSpan.from
    );
    const bodyParagraphs = result.layout.paragraphs.filter(
      (paragraph) => paragraph.role === "body"
    );
    const bodyBaselines = bodyParagraphs.flatMap((paragraph) => {
      const placements = new Map(
        paragraph.vlistLayout.linePlacements.map(
          (placement) => [placement.lineIndex, placement]
        )
      );
      return paragraph.report.lines.map((line) =>
        paragraph.bounds.y +
        Number(placements.get(line.lineIndex)?.y ?? 0) +
        Number(line.ascent)
      );
    });
    expect(bodyBaselines).toEqual([
      expect.closeTo(74.010236, 6),
      expect.closeTo(87.610236, 6),
      expect.closeTo(109.685236, 6),
      expect.closeTo(126.285236, 6),
      expect.closeTo(139.885236, 6),
      expect.closeTo(156.485236, 6),
      expect.closeTo(170.085236, 6),
      expect.closeTo(186.685236, 6),
      expect.closeTo(200.285236, 6),
    ]);
    const list = bodyParagraphs.find(
      (paragraph) => paragraph.paragraphId === "frame:1:column:0:list:0"
    )!;
    expect(list.report.lines.map((line) => line.xStart)).toEqual(
      list.report.lines.map(() => expect.closeTo(21.9, 6))
    );
    const markers = result.layout.items.filter(
      (item) => item.kind === "list-marker"
    );
    expect(markers).toHaveLength(4);
    expect(markers.map((marker) => marker.bounds)).toEqual([
      expect.objectContaining({
        x: expect.closeTo(22.221492, 6),
        y: expect.closeTo(104.331728, 6),
        width: expect.closeTo(5.153508, 6),
        height: expect.closeTo(5.153508, 6),
      }),
      expect.objectContaining({ y: expect.closeTo(120.931728, 6) }),
      expect.objectContaining({ y: expect.closeTo(151.131728, 6) }),
      expect.objectContaining({ y: expect.closeTo(181.331728, 6) }),
    ]);
    expect(result.svg.svg).toContain('data-beamer-list-marker="ball"');

    expect(result.svg.viewBox.width).toBeCloseTo(455.24408, 4);
    expect(result.svg.svg).toContain(
      'data-beamer-template-part="frame:1:footline:title:background"'
    );
    expect(result.svg.svg).toContain('data-tex-font="lmsans10-regular"');
    expect(result.svg.svg).toContain('data-paragraph-id="frame:1:frame-title:text"');
    expect(result.svg.svg).toContain("<path");
    expect(result.diagnostics).toEqual([]);
  }, 20_000);

  it("renders Madrid enumerate labels through the projected-ball template", async () => {
    const source = readFileSync(FIXTURE_PATH, "utf8");
    const result = await renderBeamerFrame(source, { frameIndex: 17 });
    const markers = result.layout.items.filter(
      (item) => item.kind === "list-marker"
    );

    expect(result.frame.title?.value).toBe("How to solve with KKT in practice");
    expect(markers).toHaveLength(6);
    expect(markers.every((marker) =>
      marker.bounds.width > 0 && marker.bounds.height > 0
    )).toBe(true);
    expect(result.svg.svg.match(
      /data-beamer-list-marker="enumerate-ball"/g
    )).toHaveLength(6);
  });

  it("renders a centered frame-root TikZ picture as embedded vector content", async () => {
    const source = readFileSync(FIXTURE_PATH, "utf8");
    const result = await renderBeamerFrame(source, { frameIndex: 15 });

    expect(result.layout.embeddedTikz).toHaveLength(1);
    expect(
      result.layout.items.filter((item) => item.kind === "tikzpicture")
    ).toHaveLength(1);
    expect(result.svg.svg).not.toContain(String.raw`\begin{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
  }, 20_000);

  it("applies Beamer math substitutions and PGF picture bounds inside embedded TikZ", async () => {
    const source = readFileSync(FIXTURE_PATH, "utf8");
    const result = await renderBeamerFrame(source, { frameIndex: 7 });
    const tikz = result.layout.embeddedTikz[0];

    expect(tikz.model.parts.some((part) =>
      part.markup.includes('data-tex-font="lmsans10-oblique"')
    )).toBe(true);
    expect(tikz.bounds.width).toBeCloseTo(263.119339, 6);
    expect(tikz.bounds.height).toBeCloseTo(84.222295, 6);
    expect(result.diagnostics).toEqual([]);
  }, 20_000);

  it("uses one document graphics resolver across frame flow, columns, and embedded TikZ", async () => {
    const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Graphics}
\includegraphics[width=20pt]{frame.png}
\begin{columns}
  \begin{column}{0.45\textwidth}
    \includegraphics[width=18pt]{column.png}
  \end{column}
  \begin{column}{0.45\textwidth}
    \begin{tikzpicture}
      \node {\includegraphics[width=16pt]{tikz.png}};
    \end{tikzpicture}
  \end{column}
\end{columns}
\end{frame}
\end{document}`;
    const resolvedFilenames: string[] = [];
    const graphicsResolver: DocumentGraphicsResolver = {
      cacheKey: "beamer-document-graphics",
      resolve(request) {
        resolvedFilenames.push(request.filename);
        return {
          status: "resolved",
          mimeType: "image/png",
          dataBase64: "YmVhbWVyLWdyYXBoaWM=",
          naturalWidthPt: 40,
          naturalHeightPt: 20,
          revision: `${request.filename}:r1`,
        };
      },
    };

    const result = await renderBeamerFrame(source, { graphicsResolver });

    expect(resolvedFilenames).toEqual([
      "frame.png",
      "column.png",
      "tikz.png",
    ]);
    expect(
      result.svg.svg.match(/data-tex-includegraphics="true"/gu)
    ).toHaveLength(3);
    expect(result.layout.graphics).toHaveLength(2);
    expect(
      result.layout.paragraphs
        .flatMap((paragraph) => paragraph.vlistLayout.graphicsPlacements)
        .every((graphic) => graphic.sourceCoordinateSpace === "document")
    ).toBe(true);
    expect(result.layout.graphics.map((graphic) => graphic.asset.filename))
      .toEqual(["frame.png", "column.png"]);
    expect(
      result.layout.items.filter((item) => item.kind === "graphics")
    ).toHaveLength(2);
    for (const graphic of result.layout.graphics) {
      expect(source.slice(
        graphic.sourceSpan.from,
        graphic.sourceSpan.to
      )).toContain(String.raw`\includegraphics`);
      expect(source.slice(
        graphic.filenameSpan.from,
        graphic.filenameSpan.to
      )).toBe(graphic.asset.filename);
      expect(graphic.bounds.width).toBeGreaterThan(0);
      expect(graphic.bounds.height).toBeGreaterThan(0);
      expect(graphic.baselineY).toBeCloseTo(
        graphic.bounds.y + graphic.bounds.height,
        6
      );
      expect(graphic.visibility).toBe("visible");
    }
    expect(result.svg.svg).toContain(
      'href="data:image/png;base64,YmVhbWVyLWdyYXBoaWM="'
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("resolves frame and column graphics against their TeX width registers", async () => {
    const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Contextual graphics}
\includegraphics[width=.5\textwidth]{frame.png}
\includegraphics[width=.1\paperwidth]{paper.png}
\begin{columns}
  \begin{column}{.4\textwidth}
    \includegraphics[width=.5\textwidth]{column.png}
  \end{column}
\end{columns}
\end{frame}
\end{document}`;
    const graphicsResolver: DocumentGraphicsResolver = {
      cacheKey: "beamer-contextual-graphics",
      resolve: () => ({
        status: "resolved",
        mimeType: "image/png",
        dataBase64: "aW1hZ2U=",
        naturalWidthPt: 40,
        naturalHeightPt: 20,
        revision: "contextual-r1",
      }),
    };
    const result = await renderBeamerFrame(source, { graphicsResolver });
    const frameGraphic = result.layout.graphics.find(
      (graphic) => graphic.asset.filename === "frame.png"
    );
    const columnGraphic = result.layout.graphics.find(
      (graphic) => graphic.asset.filename === "column.png"
    );
    const paperGraphic = result.layout.graphics.find(
      (graphic) => graphic.asset.filename === "paper.png"
    );

    expect(frameGraphic?.bounds.width).toBeCloseTo(
      result.layout.page.textArea.width * 0.5,
      6
    );
    expect(columnGraphic?.bounds.width).toBeCloseTo(
      result.layout.page.textArea.width * 0.4 * 0.5,
      6
    );
    expect(paperGraphic?.bounds.width).toBeCloseTo(
      result.layout.page.page.width * 0.1,
      6
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("retains covered graphics geometry and exposes overlay visibility", async () => {
    const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Overlay graphic}
Before \uncover<2->{\includegraphics[width=24pt]{overlay.png}} after
\end{frame}
\end{document}`;
    const graphicsResolver: DocumentGraphicsResolver = {
      cacheKey: "beamer-overlay-graphics",
      resolve: () => ({
        status: "resolved",
        mimeType: "image/png",
        dataBase64: "aW1hZ2U=",
        naturalWidthPt: 48,
        naturalHeightPt: 24,
        revision: "overlay-r1",
      }),
    };

    const covered = await renderBeamerFrame(source, {
      step: 1,
      graphicsResolver,
    });
    const visible = await renderBeamerFrame(source, {
      step: 2,
      graphicsResolver,
    });

    expect(covered.layout.graphics).toHaveLength(1);
    expect(visible.layout.graphics).toHaveLength(1);
    expect(covered.layout.graphics[0]?.visibility).toBe("hidden");
    expect(visible.layout.graphics[0]?.visibility).toBe("visible");
    expect(covered.layout.graphics[0]?.bounds).toEqual(
      visible.layout.graphics[0]?.bounds
    );
    expect(covered.layout.graphics[0]?.itemId).toBe(
      visible.layout.graphics[0]?.itemId
    );
  });

  it("shrinks display glue when a composed frame overfills its TeX frame box", async () => {
    const source = readFileSync(FIXTURE_PATH, "utf8");
    const result = await renderBeamerFrame(source, { frameIndex: 13 });
    const body = result.layout.paragraphs.find(
      (paragraph) => paragraph.role === "body"
    )!;
    const displayBoundaries = body.vlistLayout.boxReport.items.filter(
      (item) => item.glue?.origin?.kind === "display-math-boundary"
    );

    expect(displayBoundaries).toHaveLength(6);
    expect(displayBoundaries.map((item) => Number(item.height))).toEqual(
      displayBoundaries.map(() => expect.closeTo(5.021192, 6))
    );
    expect(result.layout.embeddedTikz).toHaveLength(1);
    expect(result.layout.embeddedTikz[0]?.bounds.y).toBeCloseTo(
      186.190826,
      6
    );
    expect(result.diagnostics).toEqual([]);
  }, 20_000);

  it("cancels trailing display glue at a centered trivlist boundary", async () => {
    const source = readFileSync(FIXTURE_PATH, "utf8");
    const result = await renderBeamerFrame(source, { frameIndex: 11 });
    const body = result.layout.paragraphs.find(
      (paragraph) => paragraph.role === "body"
    )!;
    const displayBoundaries = body.vlistLayout.boxReport.items.filter(
      (item) => item.glue?.origin?.kind === "display-math-boundary"
    );

    expect(displayBoundaries.map((item) => Number(item.height))).toEqual([
      expect.closeTo(7.120875, 6),
      expect.closeTo(7.120875, 6),
      0,
      expect.closeTo(4.560438, 6),
      0,
      expect.closeTo(4.560438, 6),
    ]);
    expect(result.layout.embeddedTikz[0]?.bounds.y).toBeCloseTo(
      160.025921,
      6
    );
    expect(result.diagnostics).toEqual([]);
  }, 20_000);

  it("uses Beamer boxes and 11pt display skips for the KKT geometry frame", async () => {
    const source = readFileSync(FIXTURE_PATH, "utf8");
    const result = await renderBeamerFrame(source, { frameIndex: 4 });
    const body = result.layout.paragraphs.find(
      (paragraph) => paragraph.paragraphId === "frame:4:column:0:paragraph:0"
    )!;
    const placements = new Map(
      body.vlistLayout.linePlacements.map(
        (placement) => [placement.lineIndex, placement]
      )
    );
    const baselines = body.report.lines.map(
      (line) =>
        body.bounds.y +
        Number(placements.get(line.lineIndex)?.y ?? 0) +
        Number(line.ascent)
    );
    const secondColumn = result.layout.items.find(
      (item) => item.id === "frame:4:columns:0:column:1"
    )!;
    const tikz = result.layout.embeddedTikz[0];

    expect(baselines).toEqual([
      expect.closeTo(94.032506, 6),
      expect.closeTo(107.632506, 6),
      expect.closeTo(156.832506, 6),
      expect.closeTo(170.432506, 6),
    ]);
    expect(tikz.bounds.x).toBeCloseTo(secondColumn.bounds.x, 6);
    expect(tikz.bounds.width).toBeCloseTo(149.060830, 6);
    expect(tikz.bounds.height).toBeCloseTo(83.912161, 6);
    expect(result.diagnostics).toEqual([]);
  }, 20_000);

  it("uses Beamer's 11pt NFSS and AMS alignment spacing for the KKT conditions", async () => {
    const source = readFileSync(FIXTURE_PATH, "utf8");
    const result = await renderBeamerFrame(source, { frameIndex: 3 });
    const body = result.layout.paragraphs.find(
      (paragraph) => paragraph.paragraphId === "frame:3:paragraph:0"
    )!;
    const rows = body.vlistLayout.boxReport.items.filter(
      (item) => item.hboxRole?.kind === "display-align-row"
    );
    const baselines = rows.map((row) => Number(row.y + row.height));
    const title = result.layout.paragraphs.find(
      (paragraph) => paragraph.role === "frame-title"
    )!;
    const titleLine = title.report.lines[0];
    const titlePlacement = title.vlistLayout.linePlacements.find(
      (placement) => placement.lineIndex === titleLine.lineIndex
    )!;
    const titleBaseline =
      title.bounds.y + Number(titlePlacement.y) + Number(titleLine.ascent);
    const footlineTitle = result.layout.paragraphs.find(
      (paragraph) => paragraph.paragraphId === "frame:3:footline:title"
    )!;

    expect(body.bounds.y).toBeCloseTo(64.501088, 6);
    expect(titleBaseline).toBeCloseTo(20.142303, 6);
    const footlineSpaces =
      footlineTitle.report.lines[0]?.segments
        .filter((segment) => segment.kind === "space")
        .map((segment) => Number(segment.width)) ?? [];
    expect(footlineSpaces).toHaveLength(2);
    expect(footlineSpaces[0]).toBeCloseTo(2.124, 6);
    expect(footlineSpaces[1]).toBeCloseTo(2.124, 6);
    expect(baselines).toHaveLength(4);
    expect(baselines[1] - baselines[0]).toBeCloseTo(29.510575, 6);
    expect(baselines[2] - baselines[1]).toBeCloseTo(16.6, 6);
    expect(baselines[3] - baselines[2]).toBeCloseTo(16.6, 6);
    expect(result.svg.svg).toContain('data-tex-font="cmmi8"');
    expect(result.svg.svg).not.toContain('data-tex-font="cmmi7"');
  }, 20_000);

  it("expands preamble math macros before native display layout", async () => {
    const source = readFileSync(FIXTURE_PATH, "utf8");
    const result = await renderBeamerFrame(source, { frameIndex: 2 });
    const body = result.layout.paragraphs.find(
      (paragraph) => paragraph.role === "body"
    )!;

    expect(body.report.lines.some((line) =>
      line.segments.some((segment) => segment.kind === "math")
    )).toBe(true);
    expect(result.svg.svg).toContain('data-tex-font="msbm10"');
    expect(result.svg.svg).toContain('data-tex-font="cmsy10"');
    expect(result.svg.svg).not.toContain("tex-unsupported-fallback");
    expect(result.diagnostics).toEqual([]);
  }, 20_000);

  it("renders an ordinary root-flow body without a columns wrapper", async () => {
    const result = await renderBeamerFrame(String.raw`
\documentclass{beamer}
\begin{document}
\begin{frame}{Plain}Body without columns.\end{frame}
\end{document}`);

    expect(
      result.layout.paragraphs.some(
        (paragraph) =>
          paragraph.role === "body" &&
          paragraph.report.lines[0]?.segments.some(
            (segment) =>
              segment.kind === "text" && segment.text === "Body"
          )
      )
    ).toBe(true);
    expect(result.layout.items.some((item) => item.kind === "unsupported")).toBe(false);
    expect(result.diagnostics).toEqual([]);
  });

  it("uses Beamer's class-owned sans math font substitutions", async () => {
    const result = await renderBeamerFrame(String.raw`
\documentclass{beamer}
\begin{document}
\begin{frame}{Math fonts}$x_1=(\lambda)$, $\mathbf{1}$, and \(\text{label}\).\end{frame}
\end{document}`);

    expect(result.svg.svg).toContain('data-tex-font="lmsans10-oblique"');
    expect(result.svg.svg).toContain('data-tex-font="lmsans8-regular"');
    expect(result.svg.svg).toContain('data-tex-font="cmss10"');
    expect(result.svg.svg).toContain('data-tex-font="cmmi10"');
    expect(result.svg.svg).toContain('data-tex-font="lmsans10-bold"');
    expect(result.svg.svg).not.toContain('data-tex-font="cmbx10"');
    expect(result.diagnostics).toEqual([]);
  });

  it("composes root flow and following columns in source order", async () => {
    const source = readFileSync(FIXTURE_PATH, "utf8");
    const result = await renderBeamerFrame(source, { frameIndex: 12 });
    const bodyParagraphs = result.layout.paragraphs.filter(
      (paragraph) => paragraph.role === "body"
    );
    const columns = result.layout.items.find(
      (item) => item.id === "frame:12:columns:0"
    )!;

    expect(bodyParagraphs).toHaveLength(3);
    expect(
      source.slice(
        bodyParagraphs[0].sourceSpan.from,
        bodyParagraphs[0].sourceSpan.to
      )
    ).toContain("Write the constraint");
    expect(bodyParagraphs[0].bounds.y).toBeLessThan(columns.bounds.y);
    const baseline = (paragraph: (typeof bodyParagraphs)[number], index: number) => {
      const line = paragraph.report.lines[index];
      const placement = paragraph.vlistLayout.linePlacements.find(
        (candidate) => candidate.lineIndex === line.lineIndex
      )!;
      return paragraph.bounds.y + Number(placement.y) + Number(line.ascent);
    };
    expect(baseline(bodyParagraphs[0], 0)).toBeCloseTo(99.958734, 6);
    expect(columns.bounds.y).toBeCloseTo(194.881934, 6);
    expect(baseline(bodyParagraphs[1], 0)).toBeCloseTo(202.601684, 6);
    expect(result.diagnostics).toEqual([]);
  }, 20_000);

  it("composes Madrid rounded blocks through the resolved theme template", async () => {
    const source = readFileSync(FIXTURE_PATH, "utf8");
    const result = await renderBeamerFrame(source, { frameIndex: 19 });
    const blocks = result.layout.items.filter(
      (item) => item.kind === "block"
    );
    const columns = result.layout.items.find(
      (item) => item.id === "frame:19:columns:0"
    )!;
    const body = result.layout.paragraphs.find(
      (paragraph) => paragraph.paragraphId === "frame:19:paragraph:0"
    )!;
    const necessaryTitle = result.layout.paragraphs.find(
      (paragraph) =>
        paragraph.paragraphId === "frame:19:column:0:block:0:title"
    )!;
    const necessaryBody = result.layout.paragraphs.find(
      (paragraph) =>
        paragraph.paragraphId === "frame:19:column:0:block:0:body"
    )!;
    const baseline = (paragraph: typeof body, lineIndex: number) => {
      const line = paragraph.report.lines[lineIndex];
      const placement = paragraph.vlistLayout.linePlacements.find(
        (candidate) => candidate.lineIndex === line.lineIndex
      )!;
      return paragraph.bounds.y + Number(placement.y) + Number(line.ascent);
    };

    expect(blocks).toHaveLength(3);
    expect(columns.bounds.y).toBeCloseTo(130.370096, 6);
    expect(baseline(body, 0)).toBeCloseTo(86.966896, 6);
    expect(baseline(body, 1)).toBeCloseTo(104.966896, 6);
    expect(baseline(necessaryTitle, 0)).toBeCloseTo(148.713096, 6);
    expect(baseline(necessaryBody, 0)).toBeCloseTo(165.260396, 6);
    expect(
      necessaryTitle.report.lines[0]?.segments.find(
        (segment) => segment.kind === "text"
      )
    ).toEqual(
      expect.objectContaining({
        fontId: "lmsans12-regular",
        fontAtPt: 12,
      })
    );
    expect(result.svg.svg).toContain(
      'data-beamer-block-template="beamer/block/rounded-shadow"'
    );
    expect(result.svg.svg).toContain("<linearGradient");
    const roundedShadow = result.svg.svg.match(
      /<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" rx="([^"]+)" fill="#000000" opacity="0\.45" filter="url\(#frame-19-column-0-block-0-shadow-filter\)" \/>/
    );
    expect(roundedShadow).not.toBeNull();
    const shadowX = Number(roundedShadow?.[1]);
    const shadowY = Number(roundedShadow?.[2]);
    const shadowWidth = Number(roundedShadow?.[3]);
    const shadowHeight = Number(roundedShadow?.[4]);
    const shadowRadius = Number(roundedShadow?.[5]);
    expect(shadowX - blocks[0].bounds.x).toBeCloseTo(2.5, 3);
    expect(shadowY - blocks[0].bounds.y).toBeCloseTo(2.5, 3);
    expect(shadowWidth).toBeCloseTo(blocks[0].bounds.width, 3);
    expect(blocks[0].bounds.height - shadowHeight).toBeCloseTo(
      shadowRadius,
      3
    );
    expect(result.diagnostics).toEqual([]);
  }, 20_000);

  it("renders the minimal comparison fixture without diagnostics", async () => {
    const source = readFileSync(HELLO_WORLD_FIXTURE_PATH, "utf8");
    const result = await renderBeamerFrame(source);

    expect(result.frame.title?.value).toBe("Hello, world!");
    expect(result.layout.page.themeId).toBe("Madrid");
    expect(result.svg.svg).toContain('data-tex-font="lmsans12-regular"');
    expect(
      result.layout.items.find(
        (item) => item.id === "frame:0:frame-title:background"
      )?.bounds.height
    ).toBeCloseTo(27.684662, 6);
    const footlineBackground = result.layout.items.find(
      (item) => item.id === "frame:0:footline:title:background"
    )!;
    expect(footlineBackground.bounds.height).toBeCloseTo(8.658005, 6);
    expect(
      footlineBackground.bounds.y + footlineBackground.bounds.height
    ).toBeCloseTo(result.layout.page.page.height, 6);
    const pageNumber = result.layout.paragraphs.find(
      (paragraph) => paragraph.paragraphId === "frame:0:footline:number"
    )!;
    expect(
      pageNumber.report.lines[0]?.segments
        .filter((segment) => segment.kind === "space")
        .map((segment) => Number(segment.width))
    ).toEqual([1, 1]);
    const pageNumberLine = pageNumber.report.lines[0];
    const pageNumberPlacement = pageNumber.vlistLayout.linePlacements.find(
      (placement) => placement.lineIndex === pageNumberLine.lineIndex
    )!;
    expect(
      pageNumber.bounds.y +
        Number(pageNumberPlacement.y) +
        Number(pageNumberLine.ascent)
    ).toBeCloseTo(253.410798, 6);
    expect(
      result.layout.items.filter((item) => item.kind === "column")
    ).toHaveLength(1);
    expect(result.layout.contentBounds.y).toBeCloseTo(117.726856, 6);
    expect(result.layout.contentBounds.height).toBeCloseTo(7.8402, 6);
    const body = result.layout.paragraphs.find(
      (paragraph) => paragraph.role === "body"
    )!;
    const bodyLine = body.report.lines[0];
    const bodyPlacement = body.vlistLayout.linePlacements.find(
      (placement) => placement.lineIndex === bodyLine.lineIndex
    )!;
    expect(
      body.bounds.y +
        Number(bodyPlacement.y) +
        Number(bodyLine.ascent)
    ).toBeCloseTo(125.446606, 6);
    expect(result.layout.paragraphs.map((paragraph) => paragraph.role)).toEqual([
      "frame-title",
      "footline",
      "footline",
      "body",
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("applies Beamer's frame vertical-fill alignment policies", async () => {
    const source = String.raw`
\documentclass[aspectratio=169]{beamer}
\usetheme{Madrid}
\begin{document}
\begin{frame}[t]{Top}\begin{columns}\begin{column}{\textwidth}Body\end{column}\end{columns}\end{frame}
\begin{frame}[c]{Center}\begin{columns}\begin{column}{\textwidth}Body\end{column}\end{columns}\end{frame}
\begin{frame}[b]{Bottom}\begin{columns}\begin{column}{\textwidth}Body\end{column}\end{columns}\end{frame}
\end{document}`;
    const [top, center, bottom] = await Promise.all(
      [0, 1, 2].map((frameIndex) =>
        renderBeamerFrame(source, { frameIndex })
      )
    );

    expect(top.layout.contentBounds.y).toBeLessThan(
      center.layout.contentBounds.y
    );
    expect(center.layout.contentBounds.y).toBeLessThan(
      bottom.layout.contentBounds.y
    );
  });

  it("emits source-colored SVG gradients for smooth navigation themes", async () => {
    const source = String.raw`
\documentclass[aspectratio=169]{beamer}
\usetheme{Darmstadt}
\begin{document}
\section{Foundations}
\subsection{Overview}
\begin{frame}{Typography}Body\end{frame}
\section{Geometry}
\begin{frame}{Other}Body\end{frame}
\end{document}`;
    const result = await renderBeamerFrame(source);

    expect(result.svg.svg).toContain("<linearGradient");
    expect(result.svg.svg).toContain('gradientUnits="userSpaceOnUse"');
    expect(result.svg.svg).toContain('stop-color="#000000"');
    expect(result.svg.svg).toContain('stop-color="#262686"');
    expect(result.svg.svg).toContain(
      'data-beamer-vector-template="beamer/headline/smoothbars-shade"'
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects invalid frame and overlay selections", async () => {
    const source = String.raw`
\documentclass{beamer}
\begin{document}\begin{frame}A\end{frame}\end{document}`;

    await expect(renderBeamerFrame(source, { frameIndex: 2 })).rejects.toThrow(
      "outside the document's 1 frames"
    );
    await expect(renderBeamerFrame(source, { step: 0 })).rejects.toThrow(
      "positive integer"
    );
  });

  it("renders inline \\alert in the theme's alerted-text color", async () => {
    const source = [
      "\\documentclass{beamer}",
      "\\begin{document}",
      "\\begin{frame}{Alerts}",
      "Plain then \\alert{very important} words.",
      "\\begin{itemize}",
      "\\item An \\alert<2->{acted} item",
      "\\end{itemize}",
      "\\end{frame}",
      "\\end{document}",
    ].join("\n");
    const result = await renderBeamerFrame(source, { frameIndex: 0 });
    const body = result.layout.paragraphs.find(
      (paragraph) => paragraph.role === "body"
    );
    expect(body).toBeDefined();
    const rowText = body!.report.lines
      .map((line) => line.segments.map((segment) => segment.text ?? "").join(""))
      .join(" ");
    expect(rowText).toContain("important");
    // No raw command text may leak into the layout, and the default
    // alerted-text foreground paints the content.
    expect(rowText).not.toContain("alert");
    expect(result.svg.svg).toContain('fill="#ff0000"');
    expect(
      result.diagnostics.filter((diagnostic) =>
        diagnostic.message.includes("alert")
      )
    ).toEqual([]);
  });
});


describe("frame macro contexts", () => {
  const text = (result: Awaited<ReturnType<typeof renderBeamerFrame>>) => result.layout.paragraphs
    .flatMap(paragraph => paragraph.report.lines.map(line => line.segments.map(segment => segment.text ?? "").join(""))).join("\n");
  it("uses between-frame redefinitions in each slide, including out-of-order renders", async () => {
    const source = String.raw`\documentclass{beamer}
\newcommand{\unit}{ms}
\begin{document}
\begin{frame}{Latency}Response time: 12\unit\end{frame}
\renewcommand{\unit}{s}
\begin{frame}{Results}Summary: 15\unit.\only<2>{Later.}\end{frame}
\end{document}`;
    const document = prepareBeamerDocument(source);
    expect(text(await document.renderFrame({ frameIndex: 1 }))).toContain("15s");
    expect(text(await document.renderFrame({ frameIndex: 0 }))).toContain("12ms");
    expect(text(await document.renderFrame({ frameIndex: 1, step: 2 }))).toContain("15s");
  });
  it("keeps earlier frame/group definitions local and captures aliases at declaration time", async () => {
    const source = String.raw`\documentclass{beamer}
\newcommand{\unit}{ms}
\begin{document}
\begin{frame}{A}\renewcommand{\unit}{bad}A\end{frame}
{\renewcommand{\unit}{alsoBad}}
\let\oldunit\unit
\renewcommand{\unit}{s}
\begin{frame}{B}15\unit, 12\oldunit\end{frame}
\end{document}`;
    const rendered = text(await renderBeamerFrame(source, { frameIndex: 1 }));
    expect(rendered).toContain("15s, 12ms");
  });
});
