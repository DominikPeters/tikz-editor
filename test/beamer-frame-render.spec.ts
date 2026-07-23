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
    expect(tikz.bounds.width).toBeCloseTo(145.109055, 6);
    expect(tikz.bounds.height).toBeCloseTo(82.712161, 6);
    expect(result.diagnostics).toEqual([]);
  }, 20_000);

  it("keeps unsupported bodies explicit in the contract", async () => {
    const result = await renderBeamerFrame(String.raw`
\documentclass{beamer}
\begin{document}
\begin{frame}{Plain}Body without columns.\end{frame}
\end{document}`);

    expect(result.layout.items.some((item) => item.kind === "unsupported")).toBe(true);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "beamer-render-unsupported-body" }),
    ]);
  });

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
