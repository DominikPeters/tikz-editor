import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
import type { RenderBeamerFrameResult } from "../packages/core/src/beamer/types.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace, compareBeamerPageTraces, type OracleBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";

const oracle = JSON.parse(readFileSync(new URL("./fixtures/beamer/frame-titles-fidelity/titles.oracle.json", import.meta.url), "utf8")) as {
  sourceFiles: Record<string, string>;
  pages: Array<{ id: string; file: string; frameIndex: number; step: number; pageCount: number; trace: OracleBeamerPageTrace }>;
};
const sources = new Map(Object.keys(oracle.sourceFiles).map(file => [file,
  readFileSync(new URL(`./fixtures/beamer/corpus-followups/${file}`, import.meta.url), "utf8")]));
const prepared = new Map([...sources].map(([file, source]) => [file, prepareBeamerDocument(source)]));
const deck = (frame: string, preamble = "") => String.raw`\documentclass{beamer}
${preamble}
\begin{document}${frame}\end{document}`;
const trace = (page: RenderBeamerFrameResult) =>
  buildNativeBeamerPageTrace(page, computerModernTexMetricProvider);

describe("ordinary Beamer frame titles and subtitles", () => {
  it("pins the source used for the checked-in LuaLaTeX traces", () => {
    for (const [file, source] of sources) {
      expect(createHash("sha256").update(source).digest("hex")).toBe(oracle.sourceFiles[file]);
    }
  });

  for (const page of oracle.pages) {
    it(`matches exact glyphs, title/body packing and covered paint: ${page.id} state ${page.step}`, async () => {
      const document = prepared.get(page.file)!;
      expect(document.frameStepCount(page.frameIndex)).toBe(page.pageCount);
      const result = await document.renderFrame({ frameIndex: page.frameIndex, step: page.step });
      expect(result.diagnostics).toEqual([]);
      expect(result.svg.svg).not.toContain("data-tex-literal=");
      const { summary } = compareBeamerPageTraces(trace(result), page.trace);
      expect(summary).toMatchObject({ unmatchedNativeRectangles: 0, unmatchedOracleRules: 0,
        unmatchedNativeTextLines: 0, unmatchedOracleTextLines: 0, excludedOracleTextLines: 0,
        glyphCodeMatch: true, fontMatch: true, transformMatch: true });
      expect(summary.maxAbsoluteGlyphDxPt).toBeLessThan(.001);
      expect(summary.maxAbsoluteGlyphDyPt).toBeLessThan(.001);
      expect(summary.maxRectangleEdgeDeltaPt).toBeLessThan(.001);
    });
  }

  it.each(["only", "uncover"])("counts overlays located only in the frame header: %s", async command => {
    const source = deck(String.raw`\begin{frame}{Alpha ` + `\\${command}` + String.raw`<2>{Beta}}Body.\end{frame}`);
    const document = prepareBeamerDocument(source);
    expect(document.frameStepCount(0)).toBe(2);
    const result = await document.renderFramePages();
    expect(result.pageCount).toBe(2);
    const titles = result.pages.map(page => trace(page).lines.filter(line => line.role === "frame-title").map(line => line.text).join(""));
    expect(titles).toEqual(["Alpha", "AlphaBeta"]);
    const beta = source.indexOf("Beta");
    const first = trace(result.pages[0]);
    expect(first.coveredLines.some(line => line.text === "Beta")).toBe(command === "uncover");
    const title = result.pages[1].layout.paragraphs.find(paragraph => paragraph.role === "frame-title")!;
    expect(title.report.lines.flatMap(line => line.segments).find(segment => segment.text === "Beta")?.sourceStartRaw).toBe(beta);
    expect(result.pages.every(page => !page.svg.svg.includes("data-tex-literal="))).toBe(true);
  });

  it.each(["frametitle", "framesubtitle"])("projects the overlay argument on the title command: %s", async command => {
    const source = deck(String.raw`\begin{frame}` + (command === "framesubtitle" ? "{Alpha}" : "") +
      `\\${command}<2>` + (command === "frametitle" ? "[Short]" : "") + String.raw`{Beta}Body.\end{frame}`);
    const document = prepareBeamerDocument(source);
    expect(document.frameStepCount(0)).toBe(2);
    const result = await document.renderFramePages();
    expect(result.pageCount).toBe(2);
    const role = command === "frametitle" ? "frame-title" : "frame-subtitle";
    expect(result.pages.map(page => trace(page).lines.filter(line => line.role === role).map(line => line.text).join(""))).toEqual(["", "Beta"]);
  });

  it("keeps a title assigned after a body pause outside the pause's covered body paint", async () => {
    const source = deck(String.raw`\begin{frame}\pause\frametitle{Alpha}Body.\end{frame}`);
    const result = await prepareBeamerDocument(source).renderFramePages();
    expect(result.pages).toHaveLength(2);
    expect(result.pages.map(page => trace(page).lines.filter(line => line.role === "frame-title").map(line => line.text).join(""))).toEqual(["Alpha", "Alpha"]);
  });

  it("paints the subtitle using the inherited frametitle foreground", async () => {
    const result = await prepared.get("flow-titles.tex")!.renderFrame({ frameIndex: 1 });
    expect(result.svg.svg).toMatch(/<g color="#3333b3"[^>]*><g data-paragraph-id="frame:1:frame-subtitle:text"/u);
  });

  it.each(["", "   ", "% a comment\n   "])("retains a blank authored title in the model while reserving no chrome: %j", async title => {
    const result = await prepareBeamerDocument(deck(String.raw`\begin{frame}{${title}}Body.\end{frame}`, String.raw`\usetheme{Warsaw}`)).renderFrame();
    const absent = await prepareBeamerDocument(deck(String.raw`\begin{frame}Body.\end{frame}`, String.raw`\usetheme{Warsaw}`)).renderFrame();
    expect(result.frame.title?.value).toBe(title);
    expect(result.layout.paragraphs.some(paragraph => paragraph.role === "frame-title")).toBe(false);
    const geometry = (page: RenderBeamerFrameResult) => trace(page).lines.map(line => ({
      text: line.text, x: line.x, baselineY: line.baselineY, glyphs: line.glyphs,
    }));
    expect(geometry(result)).toEqual(geometry(absent));
    expect(result.layout.contentBounds).toEqual(absent.layout.contentBounds);
  });
});
