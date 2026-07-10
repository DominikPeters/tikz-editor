import { afterEach, describe, expect, it, vi } from "vitest";

type MockRenderResult = {
  parse: {
    source: string;
    figure: { body: unknown[] };
    figures: Array<{ id: string }>;
    activeFigureId: string | null;
  };
  semantic: {
    editHandles: unknown[];
    scene: { elements: unknown[] };
    dependencies: unknown;
  };
  svg: {
    svg: string;
    model: {
      viewBox: { x: number; y: number; width: number; height: number };
      defs: string[];
      defsFingerprint: string;
      parts: unknown[];
      diagnostics: unknown[];
    };
  };
  renderDiagnostics: unknown[];
};

function makeModel(label: string) {
  return {
    viewBox: { x: 0, y: 0, width: 10, height: 10 },
    defs: [],
    defsFingerprint: label,
    parts: [],
    diagnostics: []
  };
}

function makeRenderResult(source: string, label = "full"): MockRenderResult {
  return {
    parse: {
      source,
      figure: { body: [] },
      figures: [{ id: "figure:0" }],
      activeFigureId: "figure:0"
    },
    semantic: {
      editHandles: [],
      scene: { elements: [] },
      dependencies: {}
    },
    svg: {
      svg: `<svg data-label="${label}"></svg>`,
      model: makeModel(label)
    },
    renderDiagnostics: []
  };
}

describe("computeSnapshot edge orchestration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("@tikz-editor/core/render/index");
    vi.doUnmock("@tikz-editor/core/parser/index");
    vi.doUnmock("@tikz-editor/core/semantic/index");
    vi.doUnmock("@tikz-editor/core/svg/index");
    vi.doUnmock("@tikz-editor/core/text/mathjax-engine");
  });

  it("uses the full path with a missing optional text engine and reuses warm prewarm results", async () => {
    const renderTikzToSvgAsync = vi.fn(async (source: string) => makeRenderResult(source));
    vi.doMock("@tikz-editor/core/render/index", () => ({ renderTikzToSvgAsync }));
    vi.doMock("@tikz-editor/core/text/mathjax-engine", () => ({
      createMathJaxNodeTextEngine: vi.fn(async () => {
        throw new Error("MathJax unavailable");
      })
    }));
    vi.doMock("@tikz-editor/core/parser/index", () => ({
      createIncrementalParseSession: vi.fn(() => ({
        prime: vi.fn(),
        reset: vi.fn()
      }))
    }));
    vi.doMock("@tikz-editor/core/semantic/index", () => ({
      createIncrementalSemanticSession: vi.fn(() => ({
        reset: vi.fn(),
        evaluate: vi.fn()
      }))
    }));

    const { computeSnapshot } = await import("../packages/app/src/compute.js");
    const rendered = await computeSnapshot({
      id: "full-default-kind",
      documentId: "doc-1",
      source: "\\begin{tikzpicture}\\end{tikzpicture}",
      changedSourceIds: [" path:0 ", "", "path:0"],
      patches: [
        {
          oldSpan: { from: 1, to: 2 },
          newSpan: { from: 1, to: 3 },
          replacement: "xx"
        }
      ]
    });

    expect(rendered.id).toBe("full-default-kind");
    expect(rendered.documentId).toBe("doc-1");
    expect(rendered.snapshot.incremental).toBeNull();
    expect(renderTikzToSvgAsync).toHaveBeenCalledWith(
      "\\begin{tikzpicture}\\end{tikzpicture}",
      expect.objectContaining({ textEngine: null })
    );

    const prewarm = await computeSnapshot({
      id: "prewarm-same-source",
      documentId: "doc-1",
      kind: "prewarm",
      source: "\\begin{tikzpicture}\\end{tikzpicture}"
    });

    expect(prewarm.snapshot.parseResult).toBeNull();
    expect(prewarm.snapshot.source).toBe("\\begin{tikzpicture}\\end{tikzpicture}");
    expect(prewarm.diagnostics).toEqual([]);
    expect(renderTikzToSvgAsync).toHaveBeenCalledTimes(1);
  });

  it("returns compute-error diagnostics and clears cached state when full rendering throws", async () => {
    const renderTikzToSvgAsync = vi
      .fn()
      .mockResolvedValueOnce(makeRenderResult("seed-before-error"))
      .mockRejectedValueOnce(new Error("render exploded"));
    const parseReset = vi.fn();
    const semanticReset = vi.fn();
    vi.doMock("@tikz-editor/core/render/index", () => ({
      renderTikzToSvgAsync
    }));
    vi.doMock("@tikz-editor/core/text/mathjax-engine", () => ({
      createMathJaxNodeTextEngine: vi.fn(async () => null)
    }));
    vi.doMock("@tikz-editor/core/parser/index", () => ({
      createIncrementalParseSession: vi.fn(() => ({
        prime: vi.fn(),
        reset: parseReset
      }))
    }));
    vi.doMock("@tikz-editor/core/semantic/index", () => ({
      createIncrementalSemanticSession: vi.fn(() => ({
        evaluate: vi.fn(),
        reset: semanticReset
      }))
    }));

    const { computeSnapshot } = await import("../packages/app/src/compute.js");
    await computeSnapshot({
      id: "seed-before-error",
      source: "seed-before-error"
    });
    const response = await computeSnapshot({
      id: "render-error",
      source: "\\bad"
    });

    expect(response.snapshot.scene).toBeNull();
    expect(response.snapshot.svgModel).toBeNull();
    expect(response.diagnostics).toEqual([
      {
        code: "compute-error",
        message: "render exploded",
        severity: "error"
      }
    ]);
    expect(parseReset).toHaveBeenCalledTimes(1);
    expect(semanticReset).toHaveBeenCalledTimes(1);
  });

  it("merges dependency, matrix, scope, and pending MathJax source ids into SVG reuse hints", async () => {
    const fullResult = makeRenderResult("seed", "seed");
    const parseResult = {
      source: "next",
      figures: [{ id: "figure:0" }],
      activeFigureId: "figure:0",
      figure: {
        body: [
          {
            kind: "Scope",
            id: "scope:0",
            body: [
              { kind: "Path", id: "scope:path:0" },
              { kind: "Scope", id: "scope:inner", body: [{ kind: "Path", id: "scope:path:1" }] }
            ]
          }
        ]
      }
    };
    const semanticResult = {
      editHandles: [],
      dependencies: { graph: true },
      scene: {
        elements: [
          {
            kind: "Path",
            sourceRef: { sourceId: "matrix:path" },
            matrixCell: { matrixSourceId: "matrix:0", cellSourceId: "matrix:cell:0" }
          },
          {
            kind: "Text",
            sourceRef: { sourceId: "text:0" },
            textRenderInfo: { mode: "mathjax", cacheKey: "mathjax:changed" }
          },
          {
            kind: "Text",
            sourceRef: { sourceId: "text:1" },
            textRenderInfo: { mode: "mathjax", cacheKey: "mathjax:unchanged" }
          }
        ]
      }
    };
    const parseStats = {
      strategy: "incremental",
      fallbackReason: undefined,
      patchApplication: undefined,
      reparsedStatementCount: 1,
      reusedStatementCount: 2
    };
    const semanticStats = {
      strategy: "incremental",
      replayMode: "selective",
      fallbackReason: undefined,
      recomputeFromStatementIndex: 0,
      recomputedStatementCount: 1,
      reusedStatementCount: 2,
      corridorEndStatementIndex: 1,
      affectedStatementCount: 1
    };
    const parseEvaluate = vi.fn(() => ({ parse: parseResult, stats: parseStats }));
    const semanticEvaluate = vi.fn(() => ({ semantic: semanticResult, stats: semanticStats }));
    const collectGeometryInvalidation = vi.fn(() => ({
      affectedSourceIds: ["dep:0"],
      reachedOpaque: false
    }));
    const emitSvg = vi.fn((_scene: unknown, options: unknown) => ({
      svg: "<svg></svg>",
      model: makeModel(`emit:${emitSvg.mock.calls.length}`),
      diagnostics: [],
      options
    }));
    const textEngine = {
      validate: () => null,
      measure: () => null,
      renderFromCache: () => null,
      flushPending: vi.fn(async () => ["mathjax:changed"])
    };

    vi.doMock("@tikz-editor/core/render/index", () => ({
      renderTikzToSvgAsync: vi.fn(async () => fullResult)
    }));
    vi.doMock("@tikz-editor/core/text/mathjax-engine", () => ({
      createMathJaxNodeTextEngine: vi.fn(async () => textEngine)
    }));
    vi.doMock("@tikz-editor/core/parser/index", () => ({
      createIncrementalParseSession: vi.fn(() => ({
        prime: vi.fn(),
        reset: vi.fn(),
        evaluate: parseEvaluate
      }))
    }));
    vi.doMock("@tikz-editor/core/semantic/index", () => ({
      createIncrementalSemanticSession: vi.fn(() => ({
        reset: vi.fn(),
        evaluate: semanticEvaluate
      })),
      collectGeometryInvalidation
    }));
    vi.doMock("@tikz-editor/core/svg/index", () => ({ emitSvg }));

    const { computeSnapshot } = await import("../packages/app/src/compute.js");
    await computeSnapshot({ id: "seed", source: "seed", activeFigureId: "figure:0" });
    const incremental = await computeSnapshot({
      id: "incremental",
      source: "next",
      activeFigureId: "figure:0",
      sourceRevision: 2,
      changedSourceIds: [" matrix:0 ", "scope:0", ""],
      patches: [
        {
          oldSpan: { from: 1, to: 2 },
          newSpan: { from: 1, to: 3 },
          replacement: "xx"
        }
      ],
      patchBaseRevision: 1,
      trigger: "drag-element"
    });

    expect(incremental.snapshot.incremental).toMatchObject({
      changedSourceIds: ["matrix:0", "scope:0"],
      replayMode: "selective",
      affectedStatementCount: 1
    });
    expect(incremental.snapshot.incremental?.parsePatchApplication).toBeUndefined();
    expect(emitSvg).toHaveBeenCalledTimes(2);
    expect(emitSvg.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      reuse: expect.objectContaining({
        previousModel: fullResult.svg.model,
        affectedSourceIds: [
          "dep:0",
          "matrix:cell:0",
          "matrix:path",
          "scope:0",
          "scope:inner",
          "scope:path:0",
          "scope:path:1"
        ]
      })
    }));
    expect(emitSvg.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      reuse: expect.objectContaining({
        affectedSourceIds: [
          "dep:0",
          "matrix:cell:0",
          "matrix:path",
          "scope:0",
          "scope:inner",
          "scope:path:0",
          "scope:path:1",
          "text:0"
        ]
      })
    }));
    expect(collectGeometryInvalidation).toHaveBeenCalledWith(
      semanticResult.dependencies,
      {
        changedSourceIds: ["matrix:0", "scope:0", "matrix:path", "matrix:cell:0"]
      }
    );
  });

  it("omits SVG reuse hints when there is no reusable previous model or invalidation is opaque", async () => {
    const parseResult = {
      source: "next",
      figures: [{ id: "figure:0" }],
      activeFigureId: "figure:0",
      figure: { body: [] }
    };
    const semanticResult = {
      editHandles: [],
      dependencies: {},
      scene: { elements: [] }
    };
    const parseStats = {
      strategy: "incremental",
      fallbackReason: undefined,
      patchApplication: undefined,
      reparsedStatementCount: 1,
      reusedStatementCount: 0
    };
    const semanticStats = {
      strategy: "full",
      fallbackReason: "opaque-dependency",
      recomputeFromStatementIndex: null,
      recomputedStatementCount: 1,
      reusedStatementCount: 0
    };
    const emitSvg = vi.fn(() => ({
      svg: "<svg></svg>",
      model: makeModel("opaque"),
      diagnostics: []
    }));

    vi.doMock("@tikz-editor/core/text/mathjax-engine", () => ({
      createMathJaxNodeTextEngine: vi.fn(async () => ({
        validate: () => null,
        measure: () => null,
        renderFromCache: () => null,
        flushPending: vi.fn(async () => [])
      }))
    }));
    vi.doMock("@tikz-editor/core/parser/index", () => ({
      createIncrementalParseSession: vi.fn(() => ({
        reset: vi.fn(),
        evaluate: vi.fn(() => ({ parse: parseResult, stats: parseStats }))
      }))
    }));
    vi.doMock("@tikz-editor/core/semantic/index", () => ({
      createIncrementalSemanticSession: vi.fn(() => ({
        reset: vi.fn(),
        evaluate: vi.fn(() => ({ semantic: semanticResult, stats: semanticStats }))
      })),
      collectGeometryInvalidation: vi.fn(() => ({
        affectedSourceIds: ["path:0"],
        reachedOpaque: true
      }))
    }));
    vi.doMock("@tikz-editor/core/svg/index", () => ({ emitSvg }));

    const { computeSnapshot } = await import("../packages/app/src/compute.js");
    const response = await computeSnapshot({
      id: "opaque-incremental",
      source: "next",
      changedSourceIds: ["path:0"],
      trigger: "drag-element"
    });

    expect(response.snapshot.incremental?.fallbackReason).toBe("opaque-dependency");
    expect(emitSvg).toHaveBeenCalledWith(
      semanticResult.scene,
      expect.objectContaining({ reuse: undefined })
    );
  });
});
