import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectBeamerDeckContext, instrumentBeamerDeckCounters, parseBeamerDeckCounters } from "../scripts/lib/beamer-deck-context.mjs";

import { scanBeamerDocument } from "../packages/core/src/index.js";
import {
  beamerPageTraceLuaSource,
  beamerProbeInstrumentation,
  buildBeamerFrameProbeSource,
  buildBeamerNavigationSeed,
  parseBeamerPageTraceTsv,
  parseBeamerClassVersion,
  parseBeamerProbeLog,
  parsePdfInfo,
  summarizeMutoolStructuredText,
} from "../scripts/lib/beamer-frame-oracle.mjs";

const runOracleIntegration = process.env.BEAMER_ORACLE_TESTS === "1" &&
  spawnSync("lualatex", ["--version"], { stdio: "ignore" }).status === 0;

describe("Beamer frame oracle", () => {
  it("seeds figure/table numbering from actual authored TeX counters", () => {
    const source = String.raw`\documentclass{beamer}\begin{document}\begin{frame}Later.\end{frame}\end{document}`;
    const document = scanBeamerDocument(source);
    const nav = String.raw`\headcommand{\gdef\inserttotalframenumber{1}}`;
    const context = parseBeamerDeckCounters("TIKZ_BEAMER_CONTEXT B 0 0 1 3 2\nTIKZ_BEAMER_CONTEXT E 0 1 2 4 2", nav, 1);
    expect(context.frames[0]).toMatchObject({ beforeFigureNumber: 3, beforeTableNumber: 2 });
    const probe = buildBeamerFrameProbeSource(source, document, 0, [], context);
    expect(probe.source).toContain(String.raw`\setcounter{figure}{3}\setcounter{table}{2}`);
  });
  it("seeds an isolated probe from real full-deck frame counters and navigation", () => {
    const source = String.raw`\documentclass{beamer}\begin{document}
\begin{frame}[allowframebreaks]{First}A.\newpage B.\end{frame}
\begin{frame}{Second}C.\end{frame}\end{document}`;
    const document = scanBeamerDocument(source);
    const nav = String.raw`\headcommand{\gdef\inserttotalframenumber{3}}`;
    const context = parseBeamerDeckCounters(`TIKZ_BEAMER_CONTEXT B 0 0 1
TIKZ_BEAMER_CONTEXT E 0 2 3
TIKZ_BEAMER_CONTEXT B 1 2 3
TIKZ_BEAMER_CONTEXT E 1 3 4`, nav, 2);
    expect(context.frames).toEqual([
      { beforeFrameNumber: 0, afterFrameNumber: 2, firstPage: 1, lastPage: 2 },
      { beforeFrameNumber: 2, afterFrameNumber: 3, firstPage: 3, lastPage: 3 },
    ]);
    const probe = buildBeamerFrameProbeSource(source, document, 1, [], context);
    expect(probe.source).toContain(String.raw`\setcounter{framenumber}{2}`);
    expect(probe.source).toContain(String.raw`\setcounter{page}{3}`);
    expect(probe.source).toContain(String.raw`\def\inserttotalframenumber{3}`);
    expect(probe.navSource).toBe(nav);
    const instrumented = instrumentBeamerDeckCounters(source, document);
    expect(instrumented).toContain(String.raw`TIKZ_BEAMER_CONTEXT B 0 \arabic{framenumber} \arabic{page}`);
    expect(instrumented.indexOf("CONTEXT B 0")).toBeLessThan(instrumented.indexOf("{First}"));
    expect(instrumented.indexOf("CONTEXT E 0")).toBeGreaterThan(instrumented.indexOf("B."));
    expect(() => parseBeamerDeckCounters("", nav, 2)).toThrow("missing authored frame");
  });

  it.skipIf(!runOracleIntegration)("caches actual full-deck counters and invalidates changed input assets", () => {
    const directory = mkdtempSync(join(tmpdir(), "tikz-beamer-counter-context-"));
    try {
      const source = String.raw`\documentclass{beamer}\begin{document}
\begin{frame}[allowframebreaks]{Pages}\input{body.tex}\end{frame}
\begin{frame}{Next}Gamma.\end{frame}\end{document}`;
      const inputPath = join(directory, "deck.tex");
      writeFileSync(inputPath, source);
      writeFileSync(join(directory, "body.tex"), String.raw`Alpha.\newpage Beta.`);
      const params = { source, document: scanBeamerDocument(source), inputPath, cacheDir: join(directory, "cache") };
      const first = collectBeamerDeckContext(params);
      expect(first.cached).toBe(false);
      expect(first.totalFrames).toBe(3);
      expect(first.frames[1].beforeFrameNumber).toBe(2);
      expect(collectBeamerDeckContext(params).cached).toBe(true);
      writeFileSync(join(directory, "body.tex"), String.raw`Alpha.\newpage Beta.\newpage Delta.`);
      const changed = collectBeamerDeckContext(params);
      expect(changed.cached).toBe(false);
      expect(changed.totalFrames).toBe(4);
      expect(changed.frames[1].beforeFrameNumber).toBe(3);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);

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
    expect(probe.navSource).toContain(
      String.raw`\gdef \inserttotalframenumber {2}`
    );
    expect(probe.source).not.toContain("not selected");
    expect(probe.source.match(/\\begin\{document\}/gu)).toHaveLength(1);
    expect(probe.source).toContain("TIKZ_BEAMER_DIM paperWidth");
  });

  it("seeds section navigation and restores current short-title state", () => {
    const source = String.raw`\documentclass{beamer}
\begin{document}
\section[Foundations]{Long Foundations}
\subsection[Overview]{Long Overview}
\begin{frame}{First}A\end{frame}
\begin{frame}{Second}B\end{frame}
\section{Geometry}
\subsection{Diagram}
\begin{frame}{Third}C\end{frame}
\end{document}`;
    const document = scanBeamerDocument(source);
    const probe = buildBeamerFrameProbeSource(source, document, 1);
    const nav = buildBeamerNavigationSeed(source, document);

    expect(probe.source).toContain(String.raw`\setcounter{section}{1}`);
    expect(probe.source).toContain(String.raw`\setcounter{subsection}{1}`);
    expect(probe.source).toContain(String.raw`\setcounter{subsectionslide}{1}`);
    expect(probe.source).toContain(
      String.raw`\def\insertsectionhead{Foundations}`
    );
    expect(probe.source).toContain(
      String.raw`\def\insertsubsectionhead{Overview}`
    );
    expect(nav).toContain(
      String.raw`\sectionentry {1}{Foundations}{1}{Foundations}{0}`
    );
    expect(nav).toContain(
      String.raw`\slideentry {1}{1}{2}{2/2}{Overview}{0}`
    );
    expect(nav).toContain(
      String.raw`\sectionentry {2}{Geometry}{3}{Geometry}{0}`
    );
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

  it("parses full-page box, rule, glyph, and spacing traces in scaled points", () => {
    const trace = parseBeamerPageTraceTsv(`PAGE\t1\tvlist\t1048576\t2097152\t0
BOX\t1\tvlist\troot\t0\t0\t1048576\t2097152\t0
RULE\t1\troot.1\t-65536\t-131072\t1048576\t2097152\t0
GLYPH\t1\troot.2\t72\t32768\t65536\t491520\t458752\t0\t15\t786432\t[lmsans12-regular]:+tlig;
GLUE\t1\troot.3\ty\t0\t524288\t0\t65536\t655360\t2\t0\t0\t0
KERN\t1\troot.4\ty\t0\t589824\t-32768\t-32768\t0\t0\t0\t0\t1
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
      glues: [{
        path: "root.3",
        axis: "y",
        x: { sp: 0, texPt: 0 },
        y: { sp: 524_288, texPt: 8 },
        natural: { sp: 0, texPt: 0 },
        effective: { sp: 65_536, texPt: 1 },
        stretch: { sp: 655_360, texPt: 10 },
        stretchOrder: 2,
        shrink: { sp: 0, texPt: 0 },
        shrinkOrder: 0,
        subtype: 0,
      }],
      kerns: [{
        path: "root.4",
        axis: "y",
        x: { sp: 0, texPt: 0 },
        y: { sp: 589_824, texPt: 9 },
        natural: { sp: -32_768, texPt: -0.5 },
        effective: { sp: -32_768, texPt: -0.5 },
        stretch: { sp: 0, texPt: 0 },
        stretchOrder: 0,
        shrink: { sp: 0, texPt: 0 },
        shrinkOrder: 0,
        subtype: 1,
      }],
    }]);
  });

  it.runIf(runOracleIntegration)("traces the painted extents of cline, trimmed cmidrules, and vertical rule leaders", () => {
    const directory = mkdtempSync(join(tmpdir(), "beamer-rule-leader-oracle-"));
    try {
      const source = readFileSync(new URL("./fixtures/beamer/oracle-rule-leaders.tex", import.meta.url), "utf8");
      writeFileSync(join(directory, "probe.tex"), source.replace(
        String.raw`\begin{document}`,
        `${beamerProbeInstrumentation()}\n${String.raw`\begin{document}`}`
      ));
      writeFileSync(join(directory, "beamer-page-trace.lua"), beamerPageTraceLuaSource());
      execFileSync("lualatex", ["--interaction=nonstopmode", "--halt-on-error", "--no-shell-escape", `--output-directory=${directory}`, "probe.tex"], {
        cwd: directory,
        env: {
          ...process.env,
          TEXMFVAR: process.env.TEXMFVAR ?? "/private/tmp",
          TEXMFCACHE: process.env.TEXMFCACHE ?? "/private/tmp",
          TIKZ_BEAMER_TRACE_DIR: directory,
        },
        stdio: "ignore",
        timeout: 30_000,
      });
      const trace = parseBeamerPageTraceTsv(readFileSync(join(directory, "beamer-page-trace.tsv"), "utf8"));
      type Dimension = { readonly texPt: number };
      type Glyph = { readonly code: number; readonly x: Dimension; readonly y: Dimension };
      type Rule = { readonly path: string; readonly x: Dimension; readonly y: Dimension; readonly width: Dimension; readonly height: Dimension };
      const page = (index: number) => ({
        glyphs: trace.pages[index].glyphs as readonly Glyph[],
        leaders: (trace.pages[index].rules as readonly Rule[]).filter(rule => rule.path.endsWith(".leader")),
      });
      expect(trace.pages).toHaveLength(3);

      const ordinary = page(0);
      const ordinaryA = ordinary.glyphs.find(glyph => glyph.code === 65)!;
      expect(ordinary.leaders).toHaveLength(1);
      expect(ordinary.leaders[0].x.texPt).toBeCloseTo(ordinaryA.x.texPt, 4);
      expect(ordinary.leaders[0].y.texPt - ordinaryA.y.texPt).toBeCloseTo(4.08003, 4);
      expect(ordinary.leaders[0].width.texPt).toBe(30);
      expect(ordinary.leaders[0].height.texPt).toBeCloseTo(0.4, 4);

      const booktabs = page(1);
      const booktabsA = booktabs.glyphs.find(glyph => glyph.code === 65)!;
      const booktabsB = booktabs.glyphs.find(glyph => glyph.code === 66)!;
      expect(booktabs.leaders).toHaveLength(2);
      expect(booktabs.leaders[0].x.texPt - booktabsA.x.texPt).toBe(2);
      expect(booktabs.leaders[0].width.texPt).toBe(25);
      expect(booktabs.leaders[1].x.texPt - booktabsB.x.texPt).toBeCloseTo(5.475, 4);
      expect(booktabs.leaders[1].width.texPt).toBeCloseTo(19.05, 4);
      expect(booktabs.leaders[0].y.texPt - booktabsA.y.texPt).toBeCloseTo(4.08003 + 1.94469, 4);
      expect(booktabs.leaders[0].height.texPt).toBeCloseTo(0.32848, 4);
      expect(booktabs.leaders[0].y.texPt).toBe(booktabs.leaders[1].y.texPt);

      const vertical = page(2);
      expect(vertical.leaders).toHaveLength(1);
      expect(vertical.leaders[0].width.texPt).toBe(2);
      expect(vertical.leaders[0].height.texPt).toBe(20);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it.runIf(runOracleIntegration)("traces graphicx matrices, nested axes and graphics state restoration", () => {
    const directory = mkdtempSync(join(tmpdir(), "beamer-transform-oracle-"));
    try {
      const source = readFileSync(new URL("./fixtures/beamer/oracle-transforms.tex", import.meta.url), "utf8");
      writeFileSync(join(directory, "probe.tex"), source.replace(String.raw`\begin{document}`, `${beamerProbeInstrumentation()}\n${String.raw`\begin{document}`}`));
      writeFileSync(join(directory, "beamer-page-trace.lua"), beamerPageTraceLuaSource());
      execFileSync("lualatex", ["--interaction=nonstopmode", "--halt-on-error", "--no-shell-escape", `--output-directory=${directory}`, "probe.tex"], {
        cwd: directory, env: { ...process.env, TEXMFVAR: "/private/tmp", TEXMFCACHE: "/private/tmp", TIKZ_BEAMER_TRACE_DIR: directory }, stdio: "ignore", timeout: 30_000,
      });
      const trace = parseBeamerPageTraceTsv(readFileSync(join(directory, "beamer-page-trace.tsv"), "utf8"));
      type Glyph = { code: number; x: { texPt: number }; y: { texPt: number }; width: { texPt: number }; transform?: number[] };
      type Rule = { width: { texPt: number }; height: { texPt: number }; transform?: number[] };
      const pages = trace.pages as unknown as readonly { glyphs: readonly Glyph[]; rules: readonly Rule[] }[];
      const matrices = [[0, -1, 1, 0], [2, 0, 0, .5], [0, -.5, .5, 0]];
      expect(trace.pages).toHaveLength(3);
      pages.forEach((page, index) => {
        const a = page.glyphs.find(g => g.code === 65)!;
        const b = page.glyphs.find(g => g.code === 66)!;
        const c = page.glyphs.find(g => g.code === 67)!;
        expect(a.transform).toEqual(matrices[index]);
        expect(b.transform).toEqual(matrices[index]);
        expect(c.transform).toBeUndefined();
        expect(b.x.texPt - a.x.texPt).toBeCloseTo(matrices[index][0] * a.width.texPt, 4);
        expect(b.y.texPt - a.y.texPt).toBeCloseTo(matrices[index][1] * a.width.texPt, 4);
      });
      const rotatedRule = pages[2].rules.find(rule => rule.width.texPt === 6 && rule.height.texPt === 2);
      expect(rotatedRule?.transform).toEqual([0, -1, 1, 0]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 30_000);

  it.runIf(runOracleIntegration)("traces PGF string-backed literal matrices and nested graphicx paint without scaling the frame title", () => {
    const directory = mkdtempSync(join(tmpdir(), "beamer-pgf-transform-oracle-"));
    try {
      const source = readFileSync(new URL("./fixtures/beamer/oracle-pgf-transforms.tex", import.meta.url), "utf8");
      writeFileSync(join(directory, "probe.tex"), source.replace(String.raw`\begin{document}`, `${beamerProbeInstrumentation()}\n${String.raw`\begin{document}`}`));
      writeFileSync(join(directory, "beamer-page-trace.lua"), beamerPageTraceLuaSource());
      execFileSync("lualatex", ["--interaction=nonstopmode", "--halt-on-error", "--no-shell-escape", `--output-directory=${directory}`, "probe.tex"], {
        cwd: directory, env: { ...process.env, TEXMFVAR: "/private/tmp", TEXMFCACHE: "/private/tmp", TIKZ_BEAMER_TRACE_DIR: directory }, stdio: "ignore", timeout: 30_000,
      });
      const trace = parseBeamerPageTraceTsv(readFileSync(join(directory, "beamer-page-trace.tsv"), "utf8"));
      type Glyph = { code: number; x: { texPt: number }; y: { texPt: number }; width: { texPt: number }; transform?: number[]; hiddenLayout?: { x: { texPt: number }; y: { texPt: number } } };
      const pages = trace.pages as unknown as readonly { glyphs: readonly Glyph[] }[];
      const matrices = [[.5, 0, 0, .5], [0, -.5, .5, 0]];
      expect(pages).toHaveLength(5);
      pages.slice(0, 2).forEach((page, index) => {
        const a = page.glyphs.find(glyph => glyph.code === 65)!;
        const b = page.glyphs.find(glyph => glyph.code === 66)!;
        expect(a.transform).toEqual(matrices[index]);
        expect(b.transform).toEqual(matrices[index]);
        expect(page.glyphs.find(glyph => glyph.code === 67)!.transform).toBeUndefined();
        expect(b.x.texPt - a.x.texPt).toBeCloseTo(matrices[index][0] * a.width.texPt, 4);
        expect(b.y.texPt - a.y.texPt).toBeCloseTo(matrices[index][1] * a.width.texPt, 4);
      });
      expect(pages[2].glyphs.find(glyph => glyph.code === 85)!.transform).toBeUndefined();
      expect(pages[2].glyphs.find(glyph => glyph.code === 65)!.transform).toEqual([.80011, 0, 0, .80011]);
      const hidden = pages[3].glyphs.find(glyph => glyph.code === 72)!;
      expect(hidden.hiddenLayout).toBeDefined();
      // PGF serializes its .99627 dimension conversion as 2000.0258bp.
      expect(hidden.x.texPt - hidden.hiddenLayout!.x.texPt).toBeCloseTo(2000.0258 * 72.27 / 72 * .80011, 4);
      expect(hidden.y.texPt - hidden.hiddenLayout!.y.texPt).toBeCloseTo(-2000.0258 * 72.27 / 72 * .80011, 4);
      expect(pages[3].glyphs.find(glyph => glyph.code === 86)!.hiddenLayout).toBeUndefined();
      expect(pages[4].glyphs.find(glyph => glyph.code === 72)!.hiddenLayout).toBeUndefined();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 30_000);

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
