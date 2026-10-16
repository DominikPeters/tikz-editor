import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace, compareBeamerPageTraces, type OracleBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";

const fixtures = new URL("./fixtures/beamer/titlepages-fidelity/", import.meta.url);
const cases = readdirSync(fixtures).filter(file => file.endsWith(".tex")).map(file => file.slice(0, -4));

describe("Beamer titlepage fidelity", () => {
  for (const name of cases) {
    it(`matches LuaLaTeX glyphs, line breaks and rules: ${name}`, async () => {
      const source = readFileSync(new URL(`${name}.tex`, fixtures), "utf8");
      const oracle = JSON.parse(readFileSync(new URL(`${name}.oracle.json`, fixtures), "utf8")) as {
        sourceSha256: string; pages: OracleBeamerPageTrace[];
      };
      expect(createHash("sha256").update(source).digest("hex")).toBe(oracle.sourceSha256);
      const document = prepareBeamerDocument(source);
      const pages = await document.renderFramePages();
      expect(pages.pageCount).toBe(oracle.pages.length);
      for (const [index, page] of pages.pages.entries()) {
        expect(page.diagnostics.map(diagnostic => diagnostic.code)).toEqual(name.startsWith("metropolis") ? ["beamer-font-substitution"] : []);
        expect(page.svg.svg).not.toContain("data-tex-literal=");
        const { summary } = compareBeamerPageTraces(buildNativeBeamerPageTrace(page, computerModernTexMetricProvider), oracle.pages[index]);
        expect(summary).toMatchObject({ unmatchedNativeRectangles: 0, unmatchedOracleRules: 0,
          unmatchedNativeTextLines: 0, unmatchedOracleTextLines: 0, excludedOracleTextLines: 0,
          glyphCodeMatch: true, fontMatch: true, transformMatch: true });
        expect(summary.maxAbsoluteGlyphDxPt).toBeLessThan(.001);
        expect(summary.maxAbsoluteGlyphDyPt).toBeLessThan(.001);
        expect(summary.maxRectangleEdgeDeltaPt).toBeLessThan(.001);
      }
    });
  }

  it("maps title graphics to their authored preamble span", async () => {
    const source = readFileSync(new URL("graphic.tex", fixtures), "utf8");
    const result = await prepareBeamerDocument(source).renderFrame();
    const graphic = result.layout.paragraphs.find(paragraph => paragraph.role === "titlegraphic")!;
    expect(source.slice(graphic.sourceSpan.from, graphic.sourceSpan.to)).toBe(String.raw`\rule{40pt}{20pt}`);
    expect(result.layout.editScopes).toContainEqual(expect.objectContaining({ kind: "preamble-field", span: graphic.sourceSpan }));
  });
  it.each(["default", "moloch", "metropolis"])("resolves titlepage images and retains their source spans: %s", async name => {
    const source = readFileSync(new URL(`${name}.tex`, fixtures), "utf8")
      .replace(String.raw`\title{`, String.raw`\titlegraphic{\includegraphics[width=40pt]{logo.png}}` + "\n" + String.raw`\title{`);
    const requests: string[] = [];
    const page = await prepareBeamerDocument(source).renderFrame({ graphicsResolver: {
      cacheKey: "titlepage-images",
      resolve(request) {
        requests.push(request.filename);
        return { status: "resolved", mimeType: "image/png", dataBase64: "aW1hZ2U=", naturalWidthPt: 40, naturalHeightPt: 20, revision: "1" };
      },
    } });
    expect(requests).toContain("logo.png");
    expect(page.layout.graphics).toHaveLength(1);
    const graphic = page.layout.graphics[0];
    expect(graphic.bounds.width).toBeCloseTo(40);
    expect(graphic.bounds.height).toBeCloseTo(20);
    expect(source.slice(graphic.sourceSpan.from, graphic.sourceSpan.to)).toContain("logo.png");
    expect(page.svg.svg).toContain('data-tex-includegraphics="true"');
  });

  it("recognizes separate standalone titlepages in document order, excluding grouped definitions", () => {
    const source = String.raw`\documentclass{beamer}\title{Deck}\date{}
\newcommand{\later}{\maketitle}
\begin{document}\maketitle\begin{frame}Body\end{frame}\maketitle\end{document}`;
    const document = prepareBeamerDocument(source);
    expect(document.document.frames.map(frame => source.slice(frame.bodySpan.from, frame.bodySpan.to)))
      .toEqual([String.raw`\maketitle`, "Body", String.raw`\maketitle`]);
  });

});
