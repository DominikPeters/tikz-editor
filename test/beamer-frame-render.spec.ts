import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { renderBeamerFrame } from "../packages/core/src/beamer/index.js";

const FIXTURE_PATH = new URL(
  "./fixtures/beamer/kkt_theorem_beamer.tex",
  import.meta.url
);
const HELLO_WORLD_FIXTURE_PATH = new URL(
  "./fixtures/beamer/hello_world_beamer.tex",
  import.meta.url
);

describe("headless Beamer frame renderer", () => {
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
      const line = paragraph.report.lines[0]!;
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
    const tikz = result.layout.embeddedTikz[0]!;

    expect(tikz.model.parts.some((part) =>
      part.markup.includes('data-tex-font="lmsans10-oblique"')
    )).toBe(true);
    expect(tikz.bounds.width).toBeCloseTo(263.119339, 6);
    expect(tikz.bounds.height).toBeCloseTo(84.222295, 6);
    expect(result.diagnostics).toEqual([]);
  }, 20_000);

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
    const tikz = result.layout.embeddedTikz[0]!;

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
    const titleLine = title.report.lines[0]!;
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
        bodyParagraphs[0]!.sourceSpan.from,
        bodyParagraphs[0]!.sourceSpan.to
      )
    ).toContain("Write the constraint");
    expect(bodyParagraphs[0]!.bounds.y).toBeLessThan(columns.bounds.y);
    const baseline = (paragraph: (typeof bodyParagraphs)[number], index: number) => {
      const line = paragraph.report.lines[index]!;
      const placement = paragraph.vlistLayout.linePlacements.find(
        (candidate) => candidate.lineIndex === line.lineIndex
      )!;
      return paragraph.bounds.y + Number(placement.y) + Number(line.ascent);
    };
    expect(baseline(bodyParagraphs[0]!, 0)).toBeCloseTo(99.958734, 6);
    expect(columns.bounds.y).toBeCloseTo(194.881934, 6);
    expect(baseline(bodyParagraphs[1]!, 0)).toBeCloseTo(202.601684, 6);
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
      const line = paragraph.report.lines[lineIndex]!;
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
    const pageNumberLine = pageNumber.report.lines[0]!;
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
    const bodyLine = body.report.lines[0]!;
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
});
