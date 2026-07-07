import { afterEach, describe, expect, it, vi } from "vitest";

import { clientPoint, px } from "../packages/core/src/coords/index.js";

const RETRY_MESSAGE =
  "MathJax retry -- an asynchronous action is required; try using one of the promise-based functions and await its resolution.";

type GlobalsSnapshot = {
  window: unknown;
  document: unknown;
  mathJax: unknown;
  self: unknown;
};

function snapshotGlobals(): GlobalsSnapshot {
  const target = globalThis as {
    window?: unknown;
    document?: unknown;
    MathJax?: unknown;
    self?: unknown;
  };
  return {
    window: target.window,
    document: target.document,
    mathJax: target.MathJax,
    self: target.self
  };
}

function restoreGlobals(snapshot: GlobalsSnapshot): void {
  const target = globalThis as {
    window?: unknown;
    document?: unknown;
    MathJax?: unknown;
    self?: unknown;
  };

  if (snapshot.window === undefined) {
    delete target.window;
  } else {
    target.window = snapshot.window;
  }

  if (snapshot.document === undefined) {
    delete target.document;
  } else {
    target.document = snapshot.document;
  }

  if (snapshot.mathJax === undefined) {
    delete target.MathJax;
  } else {
    target.MathJax = snapshot.mathJax;
  }

  if (snapshot.self === undefined) {
    delete target.self;
  } else {
    target.self = snapshot.self;
  }
}

describe("mathjax node text engine", () => {
  const initialGlobals = snapshotGlobals();

  afterEach(() => {
    restoreGlobals(initialGlobals);
    vi.resetModules();
  });

  function installFakeBrowserMathJax(): {
    outputJax: {
      linebreaks: { getReports: () => Array<Record<string, unknown>> };
      knuthPlassOptions?: Record<string, unknown>;
    };
    texCalls: string[];
  } {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };
    target.window = {};
    target.document = {};

    const reports: Array<Record<string, unknown>> = [];
    const texCalls: string[] = [];
    const outputJax: {
      linebreaks: { getReports: () => Array<Record<string, unknown>> };
      knuthPlassOptions?: Record<string, unknown>;
    } = {
      linebreaks: {
        getReports: () => reports
      }
    };

    const makeNode = (paragraphId: string) => ({
      tagName: "mjx-container",
      querySelector: () => ({
        getAttribute: (name: string) => (name === "viewBox" ? "0 0 1000 500" : null),
        innerHTML: `<g data-paragraph-id="${paragraphId}"></g>`
      })
    });

    target.MathJax = {
      tex2svg: (tex: string) => {
        texCalls.push(tex);
        const paragraphId = `paragraph:${reports.length + 1}`;
        reports.push({
          paragraphId,
          width: 4,
          alignment: "ragged-right",
          layoutMode: outputJax.knuthPlassOptions?.layoutMode ?? "wrap",
          lines: [],
          runs: [],
          errors: [],
          internalMode: "canonical",
          internalDegradeReason: null,
          externalFallbackUsed: false,
          linebreakingMode: "feasible"
        });
        return makeNode(paragraphId);
      },
      startup: {
        adaptor: {
          firstChild: (node: { querySelector: () => unknown }) => node.querySelector(),
          getAttribute: (node: { getAttribute: (name: string) => string | null }, name: string) => node.getAttribute(name),
          innerHTML: (node: { innerHTML: string }) => node.innerHTML
        },
        output: outputJax,
        document: { outputJax }
      }
    };

    return { outputJax, texCalls };
  }

  function makeLineElement(
    bounds: { left: number; top: number; right: number; bottom: number },
    viewBoxWidth: number
  ): any {
    return {
      getBoundingClientRect: () => ({
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        width: bounds.right - bounds.left,
        height: bounds.bottom - bounds.top
      }),
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      ownerSVGElement: {
        viewBox: {
          baseVal: {
            width: viewBoxWidth
          }
        }
      }
    };
  }

  it("treats MathJax async retry as transient during validation", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };

    const tex2svgPromise = vi.fn(async () => ({
      tagName: "svg",
      getAttribute: (name: string) => (name === "viewBox" ? "0 0 1000 1000" : null),
      innerHTML: "<g></g>"
    }));

    target.window = {};
    target.document = {};
    target.MathJax = {
      tex2svg: () => {
        throw new Error(RETRY_MESSAGE);
      },
      tex2svgPromise,
      startup: {}
    };

    const { createMathJaxNodeTextEngine } = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await createMathJaxNodeTextEngine();

    // Non-ASCII input still routes to the MathJax path (literal runs cannot
    // absorb it), keeping this a MathJax-validation test.
    const issue = engine.validate(String.raw`café $\ell^2$`);

    expect(issue).toBeNull();
    const flushed = await engine.flushPending?.();
    expect(tex2svgPromise.mock.calls.length).toBeGreaterThan(6);
    expect(flushed?.length).toBeGreaterThan(0);
  });

  it("still returns invalid-node-tex for hard TeX errors", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };

    target.window = {};
    target.document = {};
    target.MathJax = {
      tex2svg: () => {
        throw new Error("Undefined control sequence");
      },
      startup: {}
    };

    const { createMathJaxNodeTextEngine } = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await createMathJaxNodeTextEngine();

    const issue = engine.validate(String.raw`café $\unknownmacro$`);

    expect(issue).toEqual({
      code: "invalid-node-tex",
      message: "Undefined control sequence"
    });
  });

  it("validates TeX-derived display math without MathJax text-mode probing", async () => {
    const { texCalls } = installFakeBrowserMathJax();

    const { createMathJaxNodeTextEngine } = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await createMathJaxNodeTextEngine();
    const callsBefore = texCalls.length;

    const issue = engine.validate(String.raw`Intro \[x^2=y\] Outro`);

    expect(issue).toBeNull();
    expect(texCalls).toHaveLength(callsBefore);
  });

  it("does not queue async retry work when no promise renderer exists", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };

    target.window = {};
    target.document = {};
    target.MathJax = {
      tex2svg: () => {
        throw new Error(RETRY_MESSAGE);
      },
      startup: {}
    };

    const { createMathJaxNodeTextEngine } = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await createMathJaxNodeTextEngine();

    expect(engine.validate(String.raw`$\ell^2$`)).toBeNull();
    await expect(engine.flushPending?.()).resolves.toEqual([]);
  });

  it("reports finalized cache keys from flushPending", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };

    target.window = {};
    target.document = {};
    target.MathJax = {
      tex2svg: () => {
        throw new Error(RETRY_MESSAGE);
      },
      tex2svgPromise: async () => ({
        tagName: "svg",
        getAttribute: (name: string) => (name === "viewBox" ? "0 0 1000 500" : null),
        innerHTML: "<g data-test='pending'></g>"
      }),
      startup: {}
    };

    const { createMathJaxNodeTextEngine } = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await createMathJaxNodeTextEngine();

    const measured = engine.measure({
      text: String.raw`$\ell^2$`,
      textWidthPt: null,
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "monospace",
      fontSizePt: 10
    });
    expect(measured).toBeNull();

    const changedKeys = await engine.flushPending?.();
    expect(changedKeys).toBeDefined();
    expect(changedKeys?.length ?? 0).toBeGreaterThan(0);
    for (const cacheKey of changedKeys ?? []) {
      expect(engine.renderFromCache(cacheKey)).not.toBeNull();
    }
  });

  it("finishes queued async renders for explicit multiline text", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };
    const reports: Array<Record<string, unknown>> = [];
    const outputJax = {
      linebreaks: {
        getReports: () => reports
      }
    };
    const makeNode = (paragraphId: string) => ({
      tagName: "svg",
      getAttribute: (name: string) => (name === "viewBox" ? "0 0 1000 500" : null),
      innerHTML: `<g data-paragraph-id="${paragraphId}"></g>`
    });
    const tex2svgPromise = vi.fn(async () => {
      const paragraphId = `async:${reports.length + 1}`;
      reports.push({
        paragraphId,
        width: 1200,
        alignment: "ragged-right",
        layoutMode: "fixed-lines",
        lines: [{ naturalWidth: 1100 }],
        runs: [{ width: 1100 }],
        errors: [],
        internalMode: "canonical",
        internalDegradeReason: null,
        externalFallbackUsed: false,
        linebreakingMode: "feasible"
      });
      return makeNode(paragraphId);
    });

    target.window = {};
    target.document = {};
    target.MathJax = {
      tex2svg: () => {
        throw new Error(RETRY_MESSAGE);
      },
      tex2svgPromise,
      startup: {
        output: outputJax
      }
    };

    const { createMathJaxNodeTextEngine } = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await createMathJaxNodeTextEngine();

    expect(engine.validate(String.raw`Alpha é \\ Beta`)).toBeNull();
    const changedKeys = await engine.flushPending?.();

    expect(changedKeys?.length).toBe(1);
    expect(tex2svgPromise.mock.calls.length).toBeGreaterThan(4);
    expect(engine.renderFromCache(changedKeys?.[0] ?? "")?.body).toContain("async:");
  });

  it("initializes MathJax runtime in worker-like environments without browser globals", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
      self?: unknown;
    };

    delete target.window;
    delete target.document;
    target.self = target;

    const { createMathJaxNodeTextEngine } = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await createMathJaxNodeTextEngine();

    const issue = engine.validate(String.raw`$x+y$`);
    expect(issue).toBeNull();
  });

  it("reports fixed-lines layout mode for explicit multiline without text width", async () => {
    installFakeBrowserMathJax();

    const { createMathJaxNodeTextEngine, getActiveMathJaxOutputJax } = await import("../packages/core/src/text/mathjax-engine.js");
    const { getKnuthPlassReportsFromOutputJax } = await import("../packages/core/src/text/knuth-plass/index.js");
    const engine = await createMathJaxNodeTextEngine();

    const measured = engine.measure({
      text: String.raw`a \\ variable`,
      textWidthPt: null,
      alignment: "ragged-right",
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 10
    });

    expect(measured?.paragraphId).toBeTruthy();
    const reports = getKnuthPlassReportsFromOutputJax(getActiveMathJaxOutputJax());
    const report = reports.find((entry) => entry.paragraphId === measured?.paragraphId);
    expect(report?.layoutMode).toBe("fixed-lines");
  });

  it("reports wrapped-explicit layout mode for explicit multiline with text width", async () => {
    installFakeBrowserMathJax();

    const { createMathJaxNodeTextEngine, getActiveMathJaxOutputJax } = await import("../packages/core/src/text/mathjax-engine.js");
    const { getKnuthPlassReportsFromOutputJax } = await import("../packages/core/src/text/knuth-plass/index.js");
    const engine = await createMathJaxNodeTextEngine();

    const measured = engine.measure({
      text: String.raw`Alpha \\[10pt] Beta \\ Gamma Delta`,
      textWidthPt: 120,
      alignment: "center",
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 10
    });

    expect(measured?.paragraphId).toBeTruthy();
    const reports = getKnuthPlassReportsFromOutputJax(getActiveMathJaxOutputJax());
    const report = reports.find((entry) => entry.paragraphId === measured?.paragraphId);
    expect(report?.layoutMode).toBe("wrapped-explicit");
  });

  it("routes simple wrapped serif text through the TeX paragraph path", async () => {
    const { texCalls } = installFakeBrowserMathJax();

    const { createMathJaxNodeTextEngine, getActiveMathJaxOutputJax } = await import("../packages/core/src/text/mathjax-engine.js");
    const { getKnuthPlassReportsFromOutputJax } = await import("../packages/core/src/text/knuth-plass/index.js");
    const { getKnuthPlassCaretFromPoint } = await import("../packages/core/src/text/knuth-plass/editor/hitmap.js");
    const { getTexVListLayoutFromOutputJax } = await import("../packages/core/src/text/tex/vlist/index.js");
    const engine = await createMathJaxNodeTextEngine();
    const callsBeforeMeasure = texCalls.length;

    for (const alignment of ["ragged-right", "ragged-left", "center"] as const) {
      const measured = engine.measure({
        text: "Alpha Beta",
        textWidthPt: 32,
        alignment,
        fontStyle: "normal",
        fontWeight: "normal",
        fontFamily: "serif",
        fontSizePt: 10
      });

      expect(measured?.paragraphId).toMatch(/^tex:/);
      const reports = getKnuthPlassReportsFromOutputJax(getActiveMathJaxOutputJax());
      const report = reports.find((entry) => entry.paragraphId === measured?.paragraphId);
      const vlistLayout = getTexVListLayoutFromOutputJax(getActiveMathJaxOutputJax(), measured?.paragraphId);
      expect(report?.layoutMode).toBe("wrap");
      expect(report?.alignment).toBe(alignment);
      expect(report?.runs.some((run) => run.kind === "text" && run.text === "Alpha")).toBe(true);
      expect(vlistLayout?.reports).toContain(report);
      expect(vlistLayout?.items.some((item) => item.item.kind === "paragraph")).toBe(true);
      expect(engine.renderFromCache(measured?.cacheKey ?? "")?.body).toContain('data-mjx-linebox="true"');
      if (alignment === "ragged-right") {
        const reportWidth = report?.width ?? 0;
        const lineGeometry = report?.lines.map((line, index) =>
          makeLineElement(
            {
              left: 0,
              top: index * 12,
              right: reportWidth,
              bottom: index * 12 + 12
            },
            reportWidth
          )
        ) ?? [];
        await expect(
          getKnuthPlassCaretFromPoint(getActiveMathJaxOutputJax(), {
            paragraphId: measured?.paragraphId ?? "",
            sourceText: "Alpha Beta",
            containerElement: {
              getBoundingClientRect: () => ({
                left: 0,
                top: 0,
                right: reportWidth,
                bottom: 12,
                width: reportWidth,
                height: 12
              }),
              getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
              querySelectorAll: () => lineGeometry
            },
            clientPoint: clientPoint(px(4), px(4))
          })
        ).resolves.toMatchObject({
          ok: true,
          paragraphId: measured?.paragraphId,
          lineIndex: 0
        });
      }
    }
    const grouped = engine.measure({
      text: String.raw`\begin{quote}\begin{enumerate}\item Alpha\item Beta\end{enumerate}\end{quote}`,
      textWidthPt: 120,
      alignment: "justified",
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 10
    });
    const groupedBody = engine.renderFromCache(grouped?.cacheKey ?? "")?.body ?? "";
    const groupedVList = getTexVListLayoutFromOutputJax(getActiveMathJaxOutputJax(), grouped?.paragraphId);
    const groupedItems = [...(groupedVList?.items ?? [])];
    for (let index = 0; index < groupedItems.length; index++) {
      groupedItems.push(...(groupedItems[index].children ?? []));
    }
    expect(groupedItems.some((item) =>
      item.item.kind === "vbox" && item.item.role?.kind === "quote"
    )).toBe(true);
    expect(groupedItems.some((item) =>
      item.item.kind === "vbox" &&
      item.item.role?.kind === "list" &&
      item.item.role.listKind === "enumerate"
    )).toBe(true);
    expect(groupedBody).not.toContain('data-tex-vbox="true"');
    expect(groupedBody).toContain('data-mjx-linebox="true"');
    expect(texCalls).toHaveLength(callsBeforeMeasure);
  });

  it("routes simple natural-width node text through the TeX paragraph path", async () => {
    const { texCalls } = installFakeBrowserMathJax();

    const { createMathJaxNodeTextEngine, getActiveMathJaxOutputJax } = await import("../packages/core/src/text/mathjax-engine.js");
    const { getKnuthPlassReportsFromOutputJax } = await import("../packages/core/src/text/knuth-plass/index.js");
    const engine = await createMathJaxNodeTextEngine();
    const callsBeforeMeasure = texCalls.length;

    const measured = engine.measure({
      text: "Alpha Beta",
      textWidthPt: null,
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 10
    });

    expect(measured?.paragraphId).toMatch(/^tex:/);
    expect(texCalls).toHaveLength(callsBeforeMeasure);
    const reports = getKnuthPlassReportsFromOutputJax(getActiveMathJaxOutputJax());
    const report = reports.find((entry) => entry.paragraphId === measured?.paragraphId);
    expect(report?.layoutMode).toBe("wrap");
    expect(measured?.width).toBeGreaterThan(0);
    expect(report?.width).toBeGreaterThan(0);
    expect(report?.width).toBeLessThan(100);
    expect(report?.runs.some((run) => run.kind === "text" && run.text === "Alpha")).toBe(true);
    expect(engine.renderFromCache(measured?.cacheKey ?? "")?.body).toContain('data-mjx-linebox="true"');
  });

  it("keeps validated natural-width inline math on the TeX paragraph path", async () => {
    const { texCalls } = installFakeBrowserMathJax();

    const { createMathJaxNodeTextEngine } = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await createMathJaxNodeTextEngine();
    const callsBeforeValidate = texCalls.length;

    expect(engine.validate(String.raw`node $x=y$`)).toBeNull();
    const measured = engine.measure({
      text: String.raw`node $x=y$`,
      textWidthPt: null,
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 10
    });

    expect(measured?.paragraphId).toMatch(/^tex:/);
    expect(texCalls).toHaveLength(callsBeforeValidate);
    const body = engine.renderFromCache(measured?.cacheKey ?? "")?.body ?? "";
    expect(body).toContain('data-tex-inline-math="true"');
    expect(body).toContain('data-tex-glyph="61"');
  });

  it("routes supported styled sans and bold node text through the TeX paragraph path", async () => {
    const { texCalls } = installFakeBrowserMathJax();

    const { createMathJaxNodeTextEngine, getActiveMathJaxOutputJax } = await import("../packages/core/src/text/mathjax-engine.js");
    const { getKnuthPlassReportsFromOutputJax } = await import("../packages/core/src/text/knuth-plass/index.js");
    const engine = await createMathJaxNodeTextEngine();
    const callsBeforeMeasure = texCalls.length;

    const measured = engine.measure({
      text: "Alpha",
      textWidthPt: null,
      fontStyle: "normal",
      fontWeight: "bold",
      fontFamily: "sans",
      fontSizePt: 10
    });

    expect(measured?.paragraphId).toMatch(/^tex:/);
    expect(texCalls).toHaveLength(callsBeforeMeasure);
    const reports = getKnuthPlassReportsFromOutputJax(getActiveMathJaxOutputJax());
    const report = reports.find((entry) => entry.paragraphId === measured?.paragraphId);
    expect(report?.runs.some((run) => run.kind === "text" && run.text === "Alpha")).toBe(true);
    const body = engine.renderFromCache(measured?.cacheKey ?? "")?.body ?? "";
    expect(body).toContain('data-tex-font="lmsans10-bold"');
  });

  it("routes supported simple inline math through the TeX paragraph path", async () => {
    const { texCalls } = installFakeBrowserMathJax();

    const { createMathJaxNodeTextEngine, getActiveMathJaxOutputJax } = await import("../packages/core/src/text/mathjax-engine.js");
    const { getKnuthPlassReportsFromOutputJax } = await import("../packages/core/src/text/knuth-plass/index.js");
    const engine = await createMathJaxNodeTextEngine();
    const callsBeforeMeasure = texCalls.length;

    const measured = engine.measure({
      text: String.raw`Alpha $x-y$ beta`,
      textWidthPt: 96,
      alignment: "ragged-right",
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 10
    });

    expect(measured?.paragraphId).toMatch(/^tex:/);
    expect(texCalls).toHaveLength(callsBeforeMeasure);
    const reports = getKnuthPlassReportsFromOutputJax(getActiveMathJaxOutputJax());
    const report = reports.find((entry) => entry.paragraphId === measured?.paragraphId);
    expect(report?.runs.some((run) => run.kind === "math")).toBe(true);
    const mathSegments = report?.lines.flatMap((line) => line.segments)
      .filter((segment) => segment.kind === "math" && segment.sourceKind === "math") ?? [];
    const mathWidthSegments = report?.lines.flatMap((line) => line.segments)
      .filter((segment) => segment.sourceKind === "math") ?? [];
    expect(mathSegments.map((segment) => segment.text).join("")).toBe("x-y");
    expect(mathWidthSegments.reduce((sum, segment) => sum + segment.width, 0)).toBeCloseTo(23.199158, 6);
    const mathSegment = mathSegments[0];
    expect(mathSegment?.mathSvgBody).toContain('data-tex-math-hlist="true"');
    expect(mathSegment?.mathSvgBody).toContain('data-tex-font="cmsy10" data-tex-glyph="0"');
    const body = engine.renderFromCache(measured?.cacheKey ?? "")?.body ?? "";
    expect(body).toContain('data-tex-inline-math="true"');
    expect(body).toContain('data-tex-math-hlist="true"');
    expect(body).toContain('data-tex-glyph="120"');
  });

  it("contains unsupported inline math as literal runs without calling MathJax", async () => {
    const { texCalls } = installFakeBrowserMathJax();

    const { createMathJaxNodeTextEngine } = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await createMathJaxNodeTextEngine();
    const callsBeforeMeasure = texCalls.length;

    const measured = engine.measure({
      text: String.raw`Alpha $\unknown{x}$ beta`,
      textWidthPt: 64,
      alignment: "ragged-right",
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 10
    });

    expect(texCalls.length).toBe(callsBeforeMeasure);
    expect(measured?.paragraphId).toMatch(/^tex:/);
    const body = engine.renderFromCache(measured?.cacheKey ?? "")?.body ?? "";
    expect(body).toContain('data-tex-literal="math-error"');
    expect(body).not.toContain('data-tex-inline-math="true"');
  });

  it("renders unsupported wrapped TeX syntax as literal runs through the TeX path", async () => {
    const { texCalls } = installFakeBrowserMathJax();

    const { createMathJaxNodeTextEngine } = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await createMathJaxNodeTextEngine();
    const callsBeforeMeasure = texCalls.length;

    const measured = engine.measure({
      text: String.raw`Alpha \frac{1}{2}`,
      textWidthPt: 32,
      alignment: "ragged-right",
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 10
    });

    expect(texCalls.length).toBe(callsBeforeMeasure);
    expect(measured?.paragraphId).toMatch(/^tex:/);
    const body = engine.renderFromCache(measured?.cacheKey ?? "")?.body ?? "";
    expect(body).toContain('data-tex-literal="unsupported-command"');
  });

  it("renders block-position unknown commands as literal paragraphs through the debug renderer", async () => {
    const { texCalls } = installFakeBrowserMathJax();

    const {
      createMathJaxNodeTextEngine,
      renderSimpleTexParagraphDebugSvgBody,
    } = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await createMathJaxNodeTextEngine();
    const callsBeforeMeasure = texCalls.length;
    const source = String.raw`Alpha \par \unsupportedgraphics[width=1cm]{plot.pdf} \par Beta`;

    const measured = engine.measure({
      text: source,
      textWidthPt: 150,
      alignment: "ragged-right",
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 10
    });

    expect(texCalls.length).toBe(callsBeforeMeasure);
    expect(measured?.paragraphId).toMatch(/^tex:/);

    const debugBody = renderSimpleTexParagraphDebugSvgBody({
      text: source,
      width: 150,
      alignment: "ragged-right",
    }) ?? "";
    expect(debugBody).not.toContain('data-tex-vlist-item="placeholder"');
    expect(debugBody).not.toContain("Unsupported TeX command in vertical mode.");
    expect(debugBody).toContain('data-mjx-linebox="true"');
    expect(debugBody).toContain('data-line-index="0"');
    expect(debugBody).toContain('data-line-index="1"');
    expect(debugBody).toContain('data-line-index="2"');
    expect(debugBody).toContain('data-tex-glyph="65"');
    expect(debugBody).toContain('data-tex-glyph="66"');
    expect(debugBody).toContain('data-tex-literal="unsupported-command"');
    expect(debugBody.match(/data-mjx-linebox="true"/g)).toHaveLength(3);
  });

  it("renders generic vlist structure for measured hbox and rule items", async () => {
    const { renderTexVListSvgMetadata } = await import(
      "../packages/core/src/text/mathjax-engine.js"
    );
    const body = renderTexVListSvgMetadata([
      {
        item: {
          kind: "hbox",
          sourceSpan: { start: 2, end: 9 },
          role: {
            kind: "list-label",
            labelKind: "default",
            placement: "margin",
            listKind: "enumerate",
            depth: 1,
            labelDepth: 1,
            itemIndex: 2,
            blockIndex: 7,
          },
          box: {
            metrics: { width: 24, height: 6, depth: 2 },
            renderItems: [],
          },
        },
        path: [0],
        x: 3,
        y: 5,
        metrics: { width: 24, height: 6, depth: 2 },
      },
      {
        item: {
          kind: "rule",
          width: 12,
          height: 4,
          depth: 1,
        },
        path: [1],
        x: 0,
        y: 14,
        metrics: { width: 12, height: 4, depth: 1 },
      },
      {
        item: {
          kind: "penalty",
          sourceSpan: { start: 15, end: 26 },
          penalty: -50,
        },
        path: [2],
        x: 0,
        y: 19,
        metrics: { width: 0, height: 0, depth: 0 },
      },
      {
        item: {
          kind: "placeholder",
          sourceSpan: { start: 20, end: 34 },
          reason: "Unsupported TeX command in vertical mode.",
          estimated: { width: 0, height: 8.5, depth: 3.5 },
        },
        path: [3],
        x: 0,
        y: 20,
        metrics: { width: 0, height: 8.5, depth: 3.5 },
      },
    ], 80);

    expect(body).not.toContain("data-tex-vlist-item");
    expect(body).not.toContain("data-source-start");
    expect(body).toContain('transform="translate(3 5)"');
    expect(body).toContain('width="24" height="8"');
    expect(body).toContain('transform="translate(0 14)"');
    expect(body).toContain('width="12" height="5"');
    expect(body).toContain('transform="translate(0 19)"');
    expect(body).toContain('width="80" height="12"');
  });

  it("renders nested vlist structure with relative child transforms", async () => {
    const { renderTexVListSvgMetadata } = await import(
      "../packages/core/src/text/mathjax-engine.js"
    );
    const body = renderTexVListSvgMetadata([
      {
        item: {
          kind: "vbox",
          items: [],
        },
        path: [0],
        x: 10,
        y: 20,
        metrics: { width: 40, height: 7, depth: 13 },
        children: [
          {
            item: {
              kind: "hbox",
              box: {
                metrics: { width: 12, height: 4, depth: 2 },
                renderItems: [],
              },
            },
            path: [0, 0],
            x: 15,
            y: 32,
            metrics: { width: 12, height: 4, depth: 2 },
          },
        ],
      },
    ], 80);

    expect(body).not.toContain('data-tex-vbox="true"');
    expect(body).not.toContain('data-tex-vlist-item="hbox"');
    expect(body).toContain('transform="translate(10 20)"');
    expect(body).toContain('transform="translate(5 12)"');
    expect(body.indexOf('transform="translate(10 20)"')).toBeLessThan(
      body.indexOf('transform="translate(5 12)"')
    );
  });

  it("renders explicit TeX hrule commands as visible vlist rule items", async () => {
    installFakeBrowserMathJax();

    const { renderSimpleTexParagraphDebugSvgBody } = await import(
      "../packages/core/src/text/mathjax-engine.js"
    );
    const body = renderSimpleTexParagraphDebugSvgBody({
      text: String.raw`Alpha \par \hrule width 24pt height 2pt depth 1pt Beta`,
      width: 150,
      alignment: "ragged-right",
    }) ?? "";

    const ruleTransform = body.match(/<g transform="translate\(0 ([^)]+)\)" pointer-events="none"><rect x="0" y="0" width="24" height="3" fill="currentColor"/);
    expect(ruleTransform).not.toBeNull();
    expect(Number(ruleTransform?.[1])).toBeCloseTo(9.1, 4);
    expect(body).toContain('width="24" height="3" fill="currentColor"');
    expect(body.indexOf('data-line-index="0"')).toBeLessThan(
      body.indexOf('width="24" height="3" fill="currentColor"')
    );
    expect(body.indexOf('width="24" height="3" fill="currentColor"')).toBeLessThan(
      body.indexOf('data-line-index="1"')
    );
  });

  it("renders explicit TeX line leading through vlist line placements", async () => {
    installFakeBrowserMathJax();

    const { renderSimpleTexParagraphDebugSvgBody } = await import(
      "../packages/core/src/text/mathjax-engine.js"
    );
    const body = renderSimpleTexParagraphDebugSvgBody({
      text: String.raw`Alpha \\[7pt] Beta`,
      width: 150,
      alignment: "ragged-right",
    }) ?? "";

    const firstLine = body.match(/data-line-index="0"[^>]*transform="translate\(([-\d.]+) ([-\d.]+)\)"/);
    const secondLine = body.match(/data-line-index="1"[^>]*transform="translate\(([-\d.]+) ([-\d.]+)\)"/);

    expect(body).toContain('data-lineleading="7pt"');
    expect(firstLine).not.toBeNull();
    expect(secondLine).not.toBeNull();
    expect(Number(firstLine?.[2])).toBeCloseTo(0, 4);
    expect(Number(secondLine?.[2])).toBeCloseTo(19.33, 4);
    expect(Number(secondLine?.[2])).not.toBeCloseTo(12, 4);
  });

  it("renders TeX list margin labels from vlist hbox items", async () => {
    installFakeBrowserMathJax();

    const { renderSimpleTexParagraphDebugSvgBody } = await import(
      "../packages/core/src/text/mathjax-engine.js"
    );
    const body = renderSimpleTexParagraphDebugSvgBody({
      text: String.raw`\begin{enumerate}\item Alpha\end{enumerate}`,
      width: 150,
      alignment: "ragged-right",
    }) ?? "";

    expect(body).not.toContain('data-tex-vlist-item="hbox"');
    expect(body).toContain('data-tex-glyph="49"');
    expect(body).toContain('data-tex-glyph="46"');
    expect(body).toContain('data-line-index="0"');
    expect(body.indexOf('data-tex-glyph="49"')).toBeLessThan(
      body.indexOf('data-line-index="0"')
    );
  });

  it("renders nested list lineboxes relative to their vbox groups", async () => {
    installFakeBrowserMathJax();

    const { renderSimpleTexParagraphDebugSvgBody } = await import(
      "../packages/core/src/text/mathjax-engine.js"
    );
    const body = renderSimpleTexParagraphDebugSvgBody({
      text: String.raw`\begin{enumerate}\item Alpha \begin{enumerate}\item Nested\end{enumerate}\end{enumerate}`,
      width: 150,
      alignment: "ragged-right",
    }) ?? "";
    const innerLine = body.match(/data-line-index="1"[^>]*transform="translate\(([-\d.]+) ([-\d.]+)\)"/);

    expect(body).not.toContain('data-tex-vbox-role="list"');
    expect(innerLine).not.toBeNull();
    expect(Number(innerLine?.[1])).toBeGreaterThanOrEqual(0);
    expect(Number(innerLine?.[1])).toBeLessThan(47);
  });

  it("renders resumed description item lines after displays at the body indent", async () => {
    installFakeBrowserMathJax();

    const { renderSimpleTexParagraphDebugSvgBody } = await import(
      "../packages/core/src/text/mathjax-engine.js"
    );
    const body = renderSimpleTexParagraphDebugSvgBody({
      text: String.raw`Alpha \begin{description}\item[Term] Nested \(x\) \[y\] after \(z\).\end{description} Beta`,
      width: 190,
      alignment: "ragged-right",
    }) ?? "";
    const tailLine = body.match(/data-line-index="2"[^>]*transform="translate\(([-\d.]+) ([-\d.]+)\)"><rect x="([-\d.]+)"/);

    expect(tailLine).not.toBeNull();
    expect(Number(tailLine?.[1])).toBeCloseTo(0, 4);
    expect(Number(tailLine?.[3])).toBeCloseTo(-25, 4);
  });

  it("normalizes legacy font switches and records wrapped text gap metadata", async () => {
    const { outputJax, texCalls } = installFakeBrowserMathJax();

    const { createMathJaxNodeTextEngine } = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await createMathJaxNodeTextEngine();

    const measured = engine.measure({
      text: String.raw`\ttfamily First.  Next \normalfont plain \bfseries bold \mdseries medium \itshape italic \upshape upright`,
      textWidthPt: 72,
      alignment: "center",
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 20
    });

    expect(measured?.width).toBeCloseTo(20);
    expect(outputJax.knuthPlassOptions?.alignment).toBe("center");
    expect(outputJax.knuthPlassOptions?.layoutMode).toBe("wrap");
    expect(outputJax.knuthPlassOptions?.wrappedTextGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceStart: 7,
          widthEm: 0.5
        })
      ])
    );
    expect(texCalls.at(-1)).toMatch(/\\parbox\[t\]\{35\.865504pt\}/);
    expect(texCalls.at(-1)).not.toContain(String.raw`\ttfamily`);
    expect(texCalls.at(-1)).not.toContain(String.raw`\bfseries`);
    expect(texCalls.at(-1)).toContain(String.raw`\hspace{0.5em}`);

    const complex = engine.measure({
      text: String.raw`Alpha."  Beta $x y$ \% mark \\ Next \LaTeX command`,
      textWidthPt: 72,
      alignment: "ragged-right",
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "monospace",
      fontSizePt: 20
    });

    expect(complex?.paragraphId).toBeTruthy();
    expect(outputJax.knuthPlassOptions?.layoutMode).toBe("wrapped-explicit");
    expect(outputJax.knuthPlassOptions?.wrappedTextGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceStart: 7,
          widthEm: 0.5
        })
      ])
    );
    expect(texCalls.at(-1)).toContain(String.raw`\texttt{`);
    expect(texCalls.at(-1)).toContain(String.raw`\%`);
    expect(texCalls.at(-1)).toContain(String.raw`$x y$`);
    expect(texCalls.at(-1)).toContain(String.raw`\\`);
  });

  it("configures and loads MathJax through a browser startup script", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };
    const reports: Array<Record<string, unknown>> = [];
    const outputJax = {
      linebreaks: {
        getReports: () => reports
      },
      knuthPlassOptions: {} as { layoutMode?: string }
    };
    const makeNode = (paragraphId: string) => ({
      tagName: "mjx-container",
      querySelector: () => ({
        getAttribute: (name: string) => (name === "viewBox" ? "0 0 800 400" : null),
        innerHTML: `<g data-paragraph-id="${paragraphId}"></g>`
      })
    });
    const adaptor = {
      firstChild: (node: { querySelector: () => unknown }) => node.querySelector(),
      getAttribute: (node: { getAttribute: (name: string) => string | null }, name: string) => node.getAttribute(name),
      innerHTML: (node: { innerHTML: string }) => node.innerHTML
    };
    const listeners = new Map<string, () => void>();
    const script = {
      setAttribute: vi.fn(),
      addEventListener: (name: string, listener: () => void) => {
        listeners.set(name, listener);
      },
      removeEventListener: vi.fn()
    };

    target.window = {};
    delete target.MathJax;
    target.document = {
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => script),
      head: {
        appendChild: vi.fn(() => {
          target.MathJax = {
            tex2svg: () => {
              const paragraphId = `script:${reports.length + 1}`;
              reports.push({
                paragraphId,
                width: 3,
                alignment: "ragged-right",
                layoutMode: outputJax.knuthPlassOptions.layoutMode ?? "wrap",
                lines: [],
                runs: [],
                errors: [],
                internalMode: "canonical",
                internalDegradeReason: null,
                externalFallbackUsed: false,
                linebreakingMode: "feasible"
              });
              return makeNode(paragraphId);
            },
            startup: {
              promise: Promise.resolve(),
              adaptor,
              output: outputJax,
              document: { outputJax }
            }
          };
          listeners.get("load")?.();
        })
      }
    };

    const { createMathJaxNodeTextEngine, getActiveMathJaxOutputJax } = await import(
      "../packages/core/src/text/mathjax-engine.js"
    );
    const engine = await createMathJaxNodeTextEngine({ font: "mathjax-stix2" });
    const measured = engine.measure({
      text: "Loaded runtime",
      textWidthPt: 40,
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "monospace",
      fontSizePt: 10
    });

    expect(script.setAttribute).toHaveBeenCalledWith("data-tikz-editor-mathjax", "startup");
    expect(getActiveMathJaxOutputJax()).toBe(outputJax);
    expect(measured?.paragraphId).toBe("script:1");
    expect(outputJax.knuthPlassOptions.layoutMode).toBe("wrap");
  });

  it("preserves existing browser MathJax config while waiting on a loaded startup script", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };
    const outputJax = {
      linebreaks: {
        getReports: () => []
      },
      knuthPlassOptions: {}
    };
    const existingScript = {
      __tikzMathJaxLoaded: true
    };
    target.window = {};
    target.document = {
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => ({})),
      head: {}
    };

    const module = await import("../packages/core/src/text/mathjax-engine.js");
    await expect(module.createMathJaxNodeTextEngine()).rejects.toThrow("document.head is unavailable");

    target.document = {
      getElementById: vi.fn(() => existingScript)
    };
    target.MathJax = {
      output: {
        existingOutputOption: true
      },
      loader: {
        load: ["input/tex", "custom-extension", 17]
      },
      tex: {
        macros: {
          RR: "\\mathbb{R}"
        },
        packages: {
          "[+]": ["ams", "color", 17],
          "[-]": ["legacy-disable"]
        }
      },
      svg: {
        linebreaks: {
          customLinebreaks: true
        }
      },
      startup: {
        ready: "already"
      }
    };

    const enginePromise = module.createMathJaxNodeTextEngine();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const candidate = target.MathJax as { output?: { font?: unknown } } | undefined;
      if (candidate?.output?.font === "mathjax-newcm") {
        break;
      }
    }
    const configuredMathJax = target.MathJax as Record<string, unknown>;
    target.MathJax = {
      tex2svg: () => ({
        tagName: "svg",
        getAttribute: (name: string) => (name === "viewBox" ? "0 0 500 200" : null),
        innerHTML: `<g data-paragraph-id="loaded-marker"></g>`
      }),
      startup: {
        document: { outputJax }
      }
    };

    const engine = await enginePromise;
    expect(module.getActiveMathJaxOutputJax()).toBe(outputJax);
    expect(configuredMathJax.output).toMatchObject({
      existingOutputOption: true,
      font: "mathjax-newcm"
    });
    expect(configuredMathJax.loader).toMatchObject({
      load: ["input/tex", "custom-extension", "output/svg", "[tex]/color", "[tex]/html"]
    });
    expect((configuredMathJax.tex as { macros?: unknown }).macros).toMatchObject({
      RR: "\\mathbb{R}",
      textsc: ["\\style{font-family: serif; font-variant-caps: small-caps}{#1}", 1]
    });
    expect((configuredMathJax.tex as { packages?: unknown }).packages).toMatchObject({
      "[+]": ["ams", "color", "html"],
      "[-]": ["legacy-disable", "noundefined"]
    });
    expect(configuredMathJax.svg).toMatchObject({
      fontCache: "none",
      linebreaks: {
        customLinebreaks: true,
        inline: false
      }
    });
    expect(engine.measure({
      text: "loaded marker",
      textWidthPt: 20,
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "monospace",
      fontSizePt: 10
    })?.paragraphId).toBe("loaded-marker");
  });

  it("awaits preloaded browser startup promises and falls back to startup document output", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };
    const outputJax = {
      linebreaks: {
        getReports: () => []
      },
      knuthPlassOptions: {} as { layoutMode?: string }
    };
    let resolveStartup: (() => void) | null = null;

    target.window = {};
    target.document = {};
    target.MathJax = {
      tex2svg: () => ({
        tagName: "svg",
        getAttribute: (name: string) => (name === "viewBox" ? "0 0 250 125" : null),
        innerHTML: `<g data-paragraph-id="preloaded-promise"></g>`
      }),
      startup: {
        promise: new Promise<void>((resolve) => {
          resolveStartup = resolve;
        }),
        document: { outputJax }
      }
    };

    const module = await import("../packages/core/src/text/mathjax-engine.js");
    const enginePromise = module.createMathJaxNodeTextEngine();
    (resolveStartup as unknown as () => void)();
    const engine = await enginePromise;

    expect(module.getActiveMathJaxOutputJax()).toBe(outputJax);
    expect(engine.measure({
      text: "preloaded promise",
      textWidthPt: null,
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "monospace",
      fontSizePt: 10
    })?.paragraphId).toBe("preloaded-promise");
  });

  it("handles existing startup scripts, script failures, malformed SVG, and fallback linebreak options", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };

    target.window = {};
    const existingScript: {
      onload?: (() => void) | null;
      onerror?: (() => void) | null;
    } = {};
    const outputJax = {
      linebreaks: {
        getReports: () => []
      },
      knuthPlassOptions: {} as { layoutMode?: string }
    };
    target.document = {
      getElementById: vi.fn(() => existingScript)
    };
    target.MathJax = {
      loader: {
        load: ["input/tex", 1]
      },
      tex: {
        packages: {
          "[+]": ["ams", 2],
          "[-]": "bad"
        }
      },
      startup: {}
    };

    const module = await import("../packages/core/src/text/mathjax-engine.js");
    const enginePromise = module.createMathJaxNodeTextEngine({ font: "mathjax-fira" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    target.MathJax = {
      tex2svg: () => ({
        tagName: "svg",
        getAttribute: (name: string) => (name === "viewBox" ? "0 0 900 300" : null),
        innerHTML: `<g data-paragraph-id="existing-script"></g>`
      }),
      startup: {
        output: outputJax
      }
    };
    existingScript.onload?.();
    const engine = await enginePromise;

    expect(engine.measure({
      text: "from existing script",
      textWidthPt: 30,
      alignment: "ragged-left",
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "monospace",
      fontSizePt: 10
    })?.paragraphId).toBe("existing-script");
    expect(outputJax.knuthPlassOptions).toMatchObject({
      alignment: "ragged-left",
      layoutMode: "wrap"
    });

    vi.resetModules();
    target.window = {};
    const listeners = new Map<string, () => void>();
    const failingScript = {
      setAttribute: vi.fn(),
      addEventListener: (name: string, listener: () => void) => {
        listeners.set(name, listener);
      },
      removeEventListener: vi.fn()
    };
    delete target.MathJax;
    target.document = {
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => failingScript),
      head: {
        appendChild: vi.fn(() => {
          listeners.get("error")?.();
        })
      }
    };
    const failingModule = await import("../packages/core/src/text/mathjax-engine.js");
    await expect(failingModule.createMathJaxNodeTextEngine({ font: "mathjax-pagella" }))
      .rejects.toThrow("Unable to load MathJax startup component");

    vi.resetModules();
    target.window = {};
    target.document = {};
    target.MathJax = {
      tex2svg: () => ({
        tagName: "svg",
        getAttribute: () => null,
        innerHTML: "<g></g>"
      }),
      startup: {}
    };
    const malformedModule = await import("../packages/core/src/text/mathjax-engine.js");
    const malformedEngine = await malformedModule.createMathJaxNodeTextEngine();
    expect(malformedEngine.measure({
      text: "bad svg",
      textWidthPt: null,
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "monospace",
      fontSizePt: 10
    })).toBeNull();

    vi.resetModules();
    target.window = {};
    target.document = {};
    target.MathJax = {
      tex2svg: () => ({
        tagName: "svg",
        getAttribute: (name: string) => (name === "viewBox" ? "0 0 700 300" : null),
        innerHTML: "<g></g>"
      }),
      startup: {}
    };
    const noParagraphModule = await import("../packages/core/src/text/mathjax-engine.js");
    const noParagraphEngine = await noParagraphModule.createMathJaxNodeTextEngine();
    expect(() => noParagraphEngine.measure({
      text: String.raw`A \\ B`,
      textWidthPt: null,
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "monospace",
      fontSizePt: 10
    })).toThrow("Multiline MathJax render did not produce a paragraph report");

    vi.resetModules();
    target.window = {};
    target.document = {};
    target.MathJax = {
      tex2svg: () => ({
        tagName: "svg",
        getAttribute: (name: string) => (name === "viewBox" ? "0 0 700 300" : null),
        innerHTML: `<g data-paragraph-id="fallback-options"></g>`
      }),
      startup: {}
    };
    const fallbackModule = await import("../packages/core/src/text/mathjax-engine.js");
    const { KnuthPlassVisitor } = await import("../packages/core/src/text/knuth-plass/KnuthPlassVisitor.js");
    const fallbackEngine = await fallbackModule.createMathJaxNodeTextEngine();
    expect(fallbackEngine.measure({
      text: "fallback options",
      textWidthPt: 25,
      alignment: "center",
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "monospace",
      fontSizePt: 10
    })?.paragraphId).toBe("fallback-options");
    expect(KnuthPlassVisitor.getConfiguredOptions()).toMatchObject({
      alignment: "center",
      layoutMode: "wrap"
    });
  });

  it("surfaces browser startup marker and document shape failures", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };

    const scenarios: Array<{
      document: unknown;
      message: string;
    }> = [
      {
        document: "not-a-document",
        message: "Browser document is unavailable"
      },
      {
        document: {
          getElementById: vi.fn(() => null)
        },
        message: "document.createElement is unavailable"
      },
      {
        document: {
          getElementById: vi.fn(() => null),
          createElement: vi.fn(() => null)
        },
        message: "Unable to create MathJax startup script element"
      },
      {
        document: {
          getElementById: vi.fn(() => null),
          createElement: vi.fn(() => ({})),
          head: {}
        },
        message: "document.head is unavailable"
      },
      {
        document: {
          getElementById: vi.fn(() => ({
            __tikzMathJaxLoadError: new Error("pre-existing startup failure")
          }))
        },
        message: "pre-existing startup failure"
      }
    ];

    for (const scenario of scenarios) {
      vi.resetModules();
      target.window = {};
      target.document = scenario.document;
      delete target.MathJax;

      const module = await import("../packages/core/src/text/mathjax-engine.js");
      await expect(module.createMathJaxNodeTextEngine({ font: "mathjax-bonum" }))
        .rejects.toThrow(scenario.message);
    }
  });

  it("reuses cached entries and handles math-mode wrapping, querySelector SVGs, and object diagnostics", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };
    const reports: Array<Record<string, unknown>> = [];
    const texCalls: string[] = [];
    const outputJax = {
      linebreaks: {
        getReports: () => reports
      },
      knuthPlassOptions: {} as { layoutMode?: string }
    };

    target.window = {};
    target.document = {};
    target.MathJax = {
      tex2svg: (tex: string) => {
        texCalls.push(tex);
        const paragraphId = `query-svg:${reports.length + 1}`;
        reports.push({
          paragraphId,
          width: 2,
          alignment: "ragged-right",
          layoutMode: outputJax.knuthPlassOptions.layoutMode ?? "wrap",
          lines: [{ naturalWidth: 2 }],
          runs: [{ width: 2 }],
          errors: [],
          internalMode: "canonical",
          internalDegradeReason: null,
          externalFallbackUsed: false,
          linebreakingMode: "feasible"
        });
        return {
          querySelector: (selector: string) => selector === "svg"
            ? {
              tagName: "svg",
              getAttribute: (name: string) => (name === "viewBox" ? "0 0 500 200" : null),
              innerHTML: `<g data-paragraph-id="${paragraphId}"></g>`
            }
            : null
        };
      },
      startup: {
        document: { outputJax }
      }
    };

    const module = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await module.createMathJaxNodeTextEngine();

    const first = engine.measure({
      text: "Cached text",
      textWidthPt: null,
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 0
    });
    const callsAfterFirst = texCalls.length;
    const second = engine.measure({
      text: "Cached text",
      textWidthPt: null,
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: Number.NaN
    });

    expect(second).toEqual(first);
    expect(texCalls.length).toBe(callsAfterFirst);
    expect(engine.renderFromCache("missing-cache-key")).toBeNull();
    expect(engine.renderFromCache(first?.cacheKey ?? "")?.body).toContain(first?.paragraphId ?? "");

    const math = engine.measure({
      text: "x+y",
      textWidthPt: 24,
      mode: "math",
      alignment: "center",
      fontStyle: "italic",
      fontWeight: "bold",
      fontFamily: "sans",
      fontSizePt: 10
    });

    expect(math?.paragraphId).toBeTruthy();
    expect(texCalls.at(-1)).toMatch(/^\\parbox\{23\.910336pt\}\{\$x\+y\$\}$/);
    expect(outputJax.knuthPlassOptions).toMatchObject({
      alignment: "center",
      layoutMode: "wrap",
      wrappedTextGaps: []
    });

    vi.resetModules();
    target.window = {};
    target.document = {};
    target.MathJax = {
      tex2svg: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- MathJax can throw object diagnostics.
        throw { msg: "object diagnostic" };
      },
      startup: {}
    };
    const diagnosticModule = await import("../packages/core/src/text/mathjax-engine.js");
    const diagnosticEngine = await diagnosticModule.createMathJaxNodeTextEngine();
    expect(diagnosticEngine.validate(String.raw`café $\bad$`)).toEqual({
      code: "invalid-node-tex",
      message: "object diagnostic"
    });
  });

  it("handles SVG extraction failures, startup document output fallback, and diagnostic variants", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };

    async function measureWithNode(node: unknown) {
      vi.resetModules();
      target.window = {};
      target.document = {};
      target.MathJax = {
        tex2svg: () => node,
        startup: {}
      };
      const module = await import("../packages/core/src/text/mathjax-engine.js");
      const engine = await module.createMathJaxNodeTextEngine();
      return engine.measure({
        text: "bad svg",
        textWidthPt: null,
        fontStyle: "normal",
        fontWeight: "normal",
        fontFamily: "monospace",
        fontSizePt: 10
      });
    }

    await expect(measureWithNode(null)).resolves.toBeNull();
    await expect(measureWithNode({
      tagName: "svg",
      getAttribute: () => "0 0 1",
      innerHTML: "<g></g>"
    })).resolves.toBeNull();
    await expect(measureWithNode({
      tagName: "svg",
      getAttribute: () => "0 0 bad 1",
      innerHTML: "<g></g>"
    })).resolves.toBeNull();
    await expect(measureWithNode({
      querySelector: () => undefined
    })).resolves.toBeNull();
    await expect(measureWithNode({
      tagName: "svg",
      getAttribute: undefined,
      innerHTML: "<g></g>"
    })).resolves.toBeNull();
    await expect(measureWithNode({
      tagName: "svg",
      getAttribute: () => undefined,
      innerHTML: 42
    })).resolves.toBeNull();

    vi.resetModules();
    target.window = {};
    target.document = {};
    target.MathJax = {
      tex2svg: () => ({ tagName: "mjx-container" }),
      startup: {
        adaptor: {
          firstChild: () => null,
          getAttribute: () => null,
          innerHTML: () => ""
        }
      }
    };
    const emptyAdaptorModule = await import("../packages/core/src/text/mathjax-engine.js");
    const emptyAdaptorEngine = await emptyAdaptorModule.createMathJaxNodeTextEngine();
    expect(emptyAdaptorEngine.measure({
      text: "empty adaptor",
      textWidthPt: null,
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "monospace",
      fontSizePt: 10
    })).toBeNull();

    vi.resetModules();
    target.window = {};
    target.document = {};
    const documentOutputJax = {
      linebreaks: {
        getReports: () => []
      }
    };
    target.MathJax = {
      tex2svg: () => ({
        tagName: "svg",
        getAttribute: (name: string) => (name === "viewBox" ? "0 0 500 200" : null),
        innerHTML: `<g data-paragraph-id="document-output"></g>`
      }),
      startup: {
        document: { outputJax: documentOutputJax }
      }
    };
    const documentOutputModule = await import("../packages/core/src/text/mathjax-engine.js");
    await documentOutputModule.createMathJaxNodeTextEngine();
    expect(documentOutputModule.getActiveMathJaxOutputJax()).toBe(documentOutputJax);

    const circularDiagnostic: Record<string, unknown> = {};
    circularDiagnostic.self = circularDiagnostic;
    const diagnosticCases: Array<{ thrown: unknown; message: string }> = [
      { thrown: { reason: "reason diagnostic" }, message: "reason diagnostic" },
      { thrown: { code: "E_TEX" }, message: "{\"code\":\"E_TEX\"}" },
      { thrown: circularDiagnostic, message: "Invalid TeX in node text." },
      { thrown: "", message: "Invalid TeX in node text." }
    ];

    for (const testCase of diagnosticCases) {
      vi.resetModules();
      target.window = {};
      target.document = {};
      target.MathJax = {
        tex2svg: () => {
          throw testCase.thrown;
        },
        startup: {}
      };
      const diagnosticModule = await import("../packages/core/src/text/mathjax-engine.js");
      const diagnosticEngine = await diagnosticModule.createMathJaxNodeTextEngine();
      expect(diagnosticEngine.validate(String.raw`café $\bad$`)).toEqual({
        code: "invalid-node-tex",
        message: testCase.message
      });
    }
  });

  it("rejects fixed-width measurements without paragraph metadata and exposes direct output jax", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };
    const directOutputJax = {
      linebreaks: {
        getReports: () => []
      },
      knuthPlassOptions: {}
    };

    target.window = {};
    target.document = {};
    target.MathJax = {
      outputJax: directOutputJax,
      tex2svg: () => ({
        tagName: "svg",
        getAttribute: (name: string) => (name === "viewBox" ? "0 0 600 250" : null),
        innerHTML: "<g></g>"
      }),
      startup: {}
    };

    const module = await import("../packages/core/src/text/mathjax-engine.js");
    const engine = await module.createMathJaxNodeTextEngine();

    expect(module.getActiveMathJaxOutputJax()).toBe(directOutputJax);
    await expect(engine.flushPending?.()).resolves.toEqual([]);
    expect(() => engine.measure({
      text: "missing paragraph metadata",
      textWidthPt: 30,
      alignment: undefined,
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "monospace",
      fontSizePt: 10
    })).toThrow("Multiline MathJax measurement did not produce paragraph geometry.");
  });
});
