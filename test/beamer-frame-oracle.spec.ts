import { describe, expect, it } from "vitest";

import { scanBeamerDocument } from "../packages/core/src/index.js";
import {
  buildBeamerFrameProbeSource,
  parseBeamerPageTraceTsv,
  parseBeamerClassVersion,
  parseBeamerProbeLog,
  parsePdfInfo,
  summarizeMutoolStructuredText,
} from "../scripts/lib/beamer-frame-oracle.mjs";

describe("Beamer frame oracle", () => {
  it("builds a single-frame probe while retaining the source preamble", () => {
    const source = String.raw`\documentclass[aspectratio=169]{beamer}
\newcommand{\term}{oracle}
\begin{document}
\begin{frame}{First}
  not selected
\end{frame}
\begin{frame}[t]{Selected}
  A \term.
\end{frame}
\end{document}`;
    const document = scanBeamerDocument(source);

    const probe = buildBeamerFrameProbeSource(source, document, 1);

    expect(probe.frame.id).toBe("frame:1");
    expect(probe.source).toContain(
      String.raw`\documentclass[aspectratio=169]{beamer}`
    );
    expect(probe.source).toContain(String.raw`\newcommand{\term}{oracle}`);
    expect(probe.source).toContain(String.raw`\begin{frame}[t]{Selected}`);
    expect(probe.source).toContain(String.raw`\setcounter{framenumber}{1}`);
    expect(probe.source).toContain(String.raw`\def\inserttotalframenumber{2}`);
    expect(probe.source).not.toContain("not selected");
    expect(probe.source.match(/\\begin\{document\}/gu)).toHaveLength(1);
    expect(probe.source).toContain("TIKZ_BEAMER_DIM paperWidth");
  });

  it("rejects missing and incomplete frames", () => {
    const completeSource = String.raw`\begin{document}
\begin{frame}{Only}body\end{frame}
\end{document}`;
    const complete = scanBeamerDocument(completeSource);
    expect(() =>
      buildBeamerFrameProbeSource(completeSource, complete, 1)
    ).toThrow(/does not exist/u);

    const incompleteSource = String.raw`\begin{document}
\begin{frame}{Draft}`;
    const incomplete = scanBeamerDocument(incompleteSource);
    expect(() =>
      buildBeamerFrameProbeSource(incompleteSource, incomplete, 0)
    ).toThrow(/incomplete/u);
  });

  it("parses per-page TeX dimensions in scaled points", () => {
    const trace = parseBeamerProbeLog(`noise
TIKZ_BEAMER_PAGE 1
TIKZ_BEAMER_META aspectRatio 169
TIKZ_BEAMER_DIM paperWidth 1048576
TIKZ_BEAMER_DIM textWidth 917504
TIKZ_BEAMER_PAGE 2
TIKZ_BEAMER_META aspectRatio 169
TIKZ_BEAMER_DIM paperWidth 1048576
`);

    expect(trace.pages).toEqual([
      {
        pageNumber: 1,
        metadata: { aspectRatio: "169" },
        dimensions: {
          paperWidth: { sp: 1_048_576, texPt: 16 },
          textWidth: { sp: 917_504, texPt: 14 },
        },
      },
      {
        pageNumber: 2,
        metadata: { aspectRatio: "169" },
        dimensions: {
          paperWidth: { sp: 1_048_576, texPt: 16 },
        },
      },
    ]);
  });

  it("parses full-page box, rule, and glyph traces in scaled points", () => {
    const trace = parseBeamerPageTraceTsv(`PAGE\t1\tvlist\t1048576\t2097152\t0
BOX\t1\tvlist\troot\t0\t0\t1048576\t2097152\t0
RULE\t1\troot.1\t-65536\t-131072\t1048576\t2097152\t0
GLYPH\t1\troot.2\t72\t32768\t65536\t491520\t458752\t0\t15\t786432\t[lmsans12-regular]:+tlig;
`);

    expect(trace.pages).toEqual([{
      pageNumber: 1,
      boxKind: "vlist",
      width: { sp: 1_048_576, texPt: 16 },
      height: { sp: 2_097_152, texPt: 32 },
      depth: { sp: 0, texPt: 0 },
      boxes: [{
        kind: "vlist",
        path: "root",
        x: { sp: 0, texPt: 0 },
        y: { sp: 0, texPt: 0 },
        width: { sp: 1_048_576, texPt: 16 },
        height: { sp: 2_097_152, texPt: 32 },
        depth: { sp: 0, texPt: 0 },
      }],
      rules: [{
        path: "root.1",
        x: { sp: -65_536, texPt: -1 },
        y: { sp: -131_072, texPt: -2 },
        width: { sp: 1_048_576, texPt: 16 },
        height: { sp: 2_097_152, texPt: 32 },
        depth: { sp: 0, texPt: 0 },
      }],
      glyphs: [{
        path: "root.2",
        code: 72,
        x: { sp: 32_768, texPt: 0.5 },
        y: { sp: 65_536, texPt: 1 },
        width: { sp: 491_520, texPt: 7.5 },
        height: { sp: 458_752, texPt: 7 },
        depth: { sp: 0, texPt: 0 },
        fontId: 15,
        fontSize: { sp: 786_432, texPt: 12 },
        fontName: "[lmsans12-regular]:+tlig;",
      }],
    }]);
  });

  it("parses PDF page geometry and Beamer class provenance", () => {
    expect(
      parsePdfInfo(`Pages:           2
Page size:       453.543 x 255.118 pts
Page rot:        0
`)
    ).toEqual({
      pageCount: 2,
      widthPdfPt: 453.543,
      heightPdfPt: 255.118,
      description: null,
      rotation: 0,
    });
    expect(
      parseBeamerClassVersion(String.raw`\ProvidesClass{beamer}
  [2025/02/04 v3.72 A class for typesetting presentations]`)
    ).toEqual({
      date: "2025/02/04",
      version: "3.72",
      description: "A class for typesetting presentations",
    });
  });

  it("normalizes structured text into positioned line evidence", () => {
    expect(
      summarizeMutoolStructuredText({
        pages: [{
          blocks: [
            {
              type: "text",
              bbox: { x: 8, y: 10, w: 167, h: 12 },
              lines: [{
                bbox: { x: 8, y: 10, w: 167, h: 12 },
                font: {
                  name: "LMSans12-Regular",
                  size: 14,
                  weight: "normal",
                  style: "normal",
                },
                x: 8,
                y: 20,
                text: "Frame title",
              }],
            },
            {
              type: "path",
              bbox: { x: 0, y: 0, w: 1, h: 1 },
            },
          ],
        }],
      })
    ).toEqual({
      pages: [{
        pageNumber: 1,
        textBounds: { x: 8, y: 10, width: 167, height: 12 },
        lines: [{
          text: "Frame title",
          bounds: { x: 8, y: 10, width: 167, height: 12 },
          baseline: { x: 8, y: 20 },
          font: {
            name: "LMSans12-Regular",
            size: 14,
            weight: "normal",
            style: "normal",
          },
        }],
      }],
    });
  });
});
