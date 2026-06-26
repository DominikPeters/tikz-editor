import { describe, expect, it } from "vitest";

import { pt } from "../../packages/core/src/coords/scalars.js";
import { worldPoint } from "../../packages/core/src/coords/points.js";
import { worldTransform } from "../../packages/core/src/coords/transforms.js";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import { defaultStyle } from "../../packages/core/src/semantic/style/defaults.js";
import type { SceneElement, SceneFigure, SourceRef } from "../../packages/core/src/semantic/types.js";
import { emitSvg, emitSvgModel } from "../../packages/core/src/svg/emit.js";
import { createSvgModelBuilder, serializeSvgModel, serializeSvgModelAsync } from "../../packages/core/src/svg/model.js";
import { computeSvgPathBounds } from "../../packages/core/src/svg/geometry.js";
import type { SvgRenderModel } from "../../packages/core/src/svg/types.js";

const span = { from: 0, to: 0 };

function sourceRef(sourceId: string): SourceRef {
  return {
    sourceId,
    sourceSpan: span,
    sourceFingerprint: sourceId
  };
}

function scene(elements: SceneElement[]): SceneFigure {
  return {
    kind: "SceneFigure",
    span,
    requiredTikzLibraries: [],
    layers: [{ name: "main", order: 0 }],
    elements
  };
}

describe("svg render model", () => {
  it("is deterministic for equivalent scene input", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,0) circle [radius=3pt];
  \node at (0.5,0.5) {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);

    const first = emitSvgModel(semantic.scene, { padding: 8 });
    const second = emitSvgModel(semantic.scene, { padding: 8 });

    expect(first).toEqual(second);
    const partIds = first.parts.map((part) => part.partId);
    expect(new Set(partIds).size).toBe(partIds.length);
    expect(first.parts.every((part, index) => part.order === index)).toBe(true);
  });

  it("serializes to the same svg output as emitSvg compatibility wrapper", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[->] (0,0) -- (2,1);
  \node at (1,0.5) {Hello};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);

    const model = emitSvgModel(semantic.scene, { padding: 10 });
    const emitted = emitSvg(semantic.scene, { padding: 10 });

    expect(serializeSvgModel(model, true)).toBe(emitted.svg);
    expect(emitted.model).toEqual(model);
    expect(emitted.diagnostics).toEqual(model.diagnostics);
  });

  it("supports async pretty serialization with stable structure", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const model = emitSvgModel(semantic.scene, { padding: 10 });

    const compact = serializeSvgModel(model, true);
    const pretty = await serializeSvgModelAsync(model, { includeXmlns: true, pretty: true });

    expect(pretty).toContain("\n");
    expect(pretty).not.toBe(compact);
    expect(pretty.replace(/\s+/g, "")).toBe(compact.replace(/\s+/g, ""));
  });

  it("sanitizes generated part ids and rejects duplicate reused parts", () => {
    const builder = createSvgModelBuilder();
    const first = builder.addPart({
      basePartId: " repeated id ",
      sourceId: "source:a",
      elementId: null,
      markup: "<path/>"
    });
    const second = builder.addPart({
      basePartId: "repeated id",
      sourceId: "source:b",
      elementId: "element:b",
      markup: "<circle/>"
    });
    const fallback = builder.addPart({
      basePartId: "   ",
      sourceId: "source:c",
      elementId: null,
      markup: "<g/>"
    });

    expect(first.partId).toBe("repeated_id");
    expect(second.partId).toBe("repeated_id#2");
    expect(fallback.partId).toBe("part");
    expect(() => builder.addExistingPart(first)).toThrow(/Duplicate svg part id/);
  });

  it("serializes compact models without xmlns and skips async formatting when pretty is false", async () => {
    const builder = createSvgModelBuilder();
    builder.addPart({
      basePartId: "path",
      sourceId: "source:path",
      elementId: null,
      markup: "<path d=\"M0 0\"/>"
    });
    const model = builder.build({
      viewBox: { x: 0, y: 0, width: 10, height: 5 },
      defs: ["<clipPath id=\"clip\"/>"],
      diagnostics: []
    });

    const compact = serializeSvgModel(model, false);
    expect(compact).not.toContain("xmlns=");
    expect(compact).toContain("<defs><clipPath id=\"clip\"/></defs>");
    await expect(serializeSvgModelAsync(model, { includeXmlns: false, pretty: false })).resolves.toBe(compact);
  });

  it("computes path bounds for empty paths and arcs without previous points", () => {
    const viewBox = { y: -10, height: 20 };
    expect(computeSvgPathBounds([], viewBox)).toBeNull();
    expect(
      computeSvgPathBounds(
        [{ kind: "A", rx: 0, ry: Number.NaN, xAxisRotation: 0, largeArc: false, sweep: true, to: worldPoint(pt(1), pt(2)) }],
        viewBox
      )
    ).toMatchObject({
      minX: 1,
      maxX: 1
    });
  });

  it("emits transformed double-stroked primitives without losing shape-specific transforms", () => {
    const baseStyle = {
      ...defaultStyle(),
      stroke: "black",
      fill: "#ffeeaa",
      doubleStroke: true,
      doubleDistance: 2,
      doubleColor: "#ffffff",
      lineWidth: 0.5
    };
    const transform = worldTransform(1, 0, 0, 1, 2, 3);
    const emitted = emitSvgModel(
      scene([
        {
          kind: "Path",
          id: "path",
          runtimeId: "path",
          layer: "main",
          sourceRef: sourceRef("source:path"),
          style: baseStyle,
          styleChain: [],
          commands: [
            { kind: "M", to: worldPoint(pt(0), pt(0)) },
            { kind: "L", to: worldPoint(pt(10), pt(0)) }
          ],
          transform
        },
        {
          kind: "Circle",
          id: "circle",
          runtimeId: "circle",
          layer: "main",
          sourceRef: sourceRef("source:circle"),
          style: baseStyle,
          styleChain: [],
          center: worldPoint(pt(5), pt(5)),
          radius: 3,
          transform
        },
        {
          kind: "Ellipse",
          id: "ellipse",
          runtimeId: "ellipse",
          layer: "main",
          sourceRef: sourceRef("source:ellipse"),
          style: baseStyle,
          styleChain: [],
          center: worldPoint(pt(12), pt(5)),
          rx: 4,
          ry: 2,
          rotation: 30,
          transform
        }
      ]),
      { viewBox: { x: -5, y: -5, width: 30, height: 30 } }
    );

    const markup = emitted.parts.map((part) => part.markup).join("");
    expect(emitted.parts.map((part) => part.partId)).toEqual(
      expect.arrayContaining([
        "path:shaft:outer",
        "path:shaft:inner",
        "circle:circle:outer",
        "circle:circle:inner",
        "ellipse:ellipse:outer",
        "ellipse:ellipse:inner"
      ])
    );
    expect(markup.match(/transform="matrix/g)?.length).toBeGreaterThanOrEqual(4);
    expect(markup).toContain("rotate(-30");
  });

  it("reports empty paths and preserves cached MathJax text payload metadata", () => {
    const textStyle = {
      ...defaultStyle(),
      textAlign: "right" as const,
      textColor: "#333333"
    };
    const emitted = emitSvgModel(
      scene([
        {
          kind: "Path",
          id: "empty-path",
          runtimeId: "empty-path",
          layer: "main",
          sourceRef: sourceRef("source:empty"),
          style: defaultStyle(),
          styleChain: [],
          commands: [{ kind: "M", to: worldPoint(pt(0), pt(0)) }]
        },
        {
          kind: "Text",
          id: "mathjax-text",
          runtimeId: "mathjax-text",
          layer: "main",
          sourceRef: sourceRef("source:text"),
          style: textStyle,
          styleChain: [],
          position: worldPoint(pt(4), pt(6)),
          text: String.raw`\frac{a}{b}`,
          rotation: 15,
          transform: worldTransform(1, 0, 0, 1, 1, 2),
          textRenderInfo: {
            mode: "mathjax",
            cacheKey: "mathjax:1",
            paragraphId: "paragraph:1",
            renderSourceText: String.raw`\frac{a}{b}`,
            layoutKind: "wrapped",
            paragraphAlignment: "ragged-left"
          }
        }
      ]),
      {
        viewBox: { x: -10, y: -10, width: 30, height: 30 },
        textEngine: {
          validate: () => null,
          measure: () => null,
          renderFromCache: () => ({
            cacheKey: "mathjax:1",
            viewBox: { x: 0, y: 0, width: 20, height: 10 },
            body: "<g><path d=\"M0 0\" /></g>"
          })
        }
      }
    );

    const markup = emitted.parts.map((part) => part.markup).join("");
    expect(emitted.diagnostics).toContainEqual(expect.objectContaining({ code: "empty-path" }));
    expect(markup).toContain('data-text-renderer="mathjax"');
    expect(markup).toContain('data-paragraph-id="paragraph:1"');
    expect(markup).toContain('preserveAspectRatio="xMaxYMid meet"');
    expect(markup).toContain('transform="matrix');
    expect(markup).toContain("rotate(-15");
    expect(markup).toContain('opacity="1"');

    for (const textEngine of [
      undefined,
      {
        validate: () => null,
        measure: () => null,
        renderFromCache: () => null
      }
    ]) {
      const missingRender = emitSvgModel(
        scene([
          {
            kind: "Text",
            id: "missing-mathjax-text",
            runtimeId: "missing-mathjax-text",
            layer: "main",
            sourceRef: sourceRef("source:missing-text"),
            style: defaultStyle(),
            styleChain: [],
            position: worldPoint(pt(0), pt(0)),
            text: String.raw`\alpha`,
            textRenderInfo: {
              mode: "mathjax",
              cacheKey: "mathjax:missing",
              paragraphId: null,
              renderSourceText: String.raw`\alpha`,
              layoutKind: "single-line",
              paragraphAlignment: undefined
            }
          }
        ]),
        {
          viewBox: { x: -5, y: -5, width: 10, height: 10 },
          textEngine
        }
      );

      expect(missingRender.diagnostics).toContainEqual(expect.objectContaining({ code: "missing-mathjax-text-render" }));
      expect(missingRender.parts.map((part) => part.markup).join("")).toContain("<text");
    }
  });

  it("matches full emission when reusing unaffected source parts", () => {
    const previousSource = String.raw`\begin{tikzpicture}
  \draw (-3,1) -- (3,1);
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const nextSource = String.raw`\begin{tikzpicture}
  \draw (-3,1) -- (3,1);
  \draw (0.2,0) -- (1.2,0);
\end{tikzpicture}`;

    const previousParsed = parseTikz(previousSource);
    const previousSemantic = evaluateTikzFigure(previousParsed.figure, previousSource);
    const nextParsed = parseTikz(nextSource);
    const nextSemantic = evaluateTikzFigure(nextParsed.figure, nextSource);

    const previousModel = emitSvgModel(previousSemantic.scene, { padding: 8 });
    const fullNextModel = emitSvgModel(nextSemantic.scene, { padding: 8 });
    const movedSourceId = previousSemantic.scene.elements[1]?.sourceRef.sourceId;
    expect(movedSourceId).toBeDefined();

    const incrementalNextModel = emitSvgModel(nextSemantic.scene, {
      padding: 8,
      reuse: {
        previousModel,
        affectedSourceIds: movedSourceId ? [movedSourceId] : []
      }
    });

    expect(incrementalNextModel).toEqual(fullNextModel);
  });

  it("falls back to full emission when viewBox changes under reuse hints", () => {
    const previousSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;
    const nextSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (5,0);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;

    const previousParsed = parseTikz(previousSource);
    const previousSemantic = evaluateTikzFigure(previousParsed.figure, previousSource);
    const nextParsed = parseTikz(nextSource);
    const nextSemantic = evaluateTikzFigure(nextParsed.figure, nextSource);

    const previousModel = emitSvgModel(previousSemantic.scene, { padding: 8 });
    const fullNextModel = emitSvgModel(nextSemantic.scene, { padding: 8 });
    const movedSourceId = previousSemantic.scene.elements[0]?.sourceRef.sourceId;
    expect(movedSourceId).toBeDefined();
    expect(fullNextModel.viewBox).not.toEqual(previousModel.viewBox);

    const incrementalNextModel = emitSvgModel(nextSemantic.scene, {
      padding: 8,
      reuse: {
        previousModel,
        affectedSourceIds: movedSourceId ? [movedSourceId] : []
      }
    });

    expect(incrementalNextModel).toEqual(fullNextModel);
  });

  it("falls back to full emission for invalid reuse hints and stale cached parts", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const previousModel = emitSvgModel(semantic.scene, { padding: 8 });
    const fullModel = emitSvgModel(semantic.scene, { padding: 8 });
    const [firstElement, secondElement] = semantic.scene.elements;
    expect(firstElement).toBeDefined();
    expect(secondElement).toBeDefined();
    expect(previousModel.parts.length).toBeGreaterThanOrEqual(2);

    const firstSourceId = firstElement?.sourceRef.sourceId ?? "missing:first";
    const secondSourceId = secondElement?.sourceRef.sourceId ?? "missing:second";
    const withParts = (parts: SvgRenderModel["parts"]): SvgRenderModel => ({
      ...previousModel,
      parts
    });

    const sparseParts = new Array<SvgRenderModel["parts"][number]>(previousModel.parts.length);
    for (let index = 1; index < previousModel.parts.length; index += 1) {
      sparseParts[index] = previousModel.parts[index];
    }

    const fallbackCases: Array<{
      previousModel?: SvgRenderModel | null;
      affectedSourceIds?: readonly string[] | null;
    }> = [
      { previousModel: null, affectedSourceIds: [firstSourceId] },
      { previousModel, affectedSourceIds: [] },
      {
        previousModel: withParts(sparseParts),
        affectedSourceIds: [firstSourceId]
      },
      {
        previousModel: withParts(previousModel.parts.map((part, index) => (index === 0 ? { ...part, order: 1 } : part))),
        affectedSourceIds: [firstSourceId]
      },
      {
        previousModel: withParts(
          previousModel.parts.map((part, index) =>
            index === 1 ? { ...part, partId: previousModel.parts[0]?.partId ?? part.partId } : part
          )
        ),
        affectedSourceIds: [firstSourceId]
      },
      {
        previousModel: withParts(previousModel.parts.map((part, index) => (index === 0 ? { ...part, elementId: null } : part))),
        affectedSourceIds: [firstSourceId]
      },
      {
        previousModel: withParts(
          previousModel.parts.map((part, index) => (index === 0 ? { ...part, elementId: "stale-element" } : part))
        ),
        affectedSourceIds: [secondSourceId]
      },
      {
        previousModel: withParts(
          previousModel.parts.map((part, index) => (index === 0 ? { ...part, sourceId: "stale-source" } : part))
        ),
        affectedSourceIds: [secondSourceId]
      }
    ];

    for (const reuse of fallbackCases) {
      expect(emitSvgModel(semantic.scene, { padding: 8, reuse })).toEqual(fullModel);
    }
  });

  it("falls back to full emission when reuse is unsafe for scene state", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const previousModel = emitSvgModel(semantic.scene, { padding: 8 });
    const fullModel = emitSvgModel(semantic.scene, { padding: 8 });
    const sourceId = semantic.scene.elements[0]?.sourceRef.sourceId ?? "missing";

    expect(
      emitSvgModel(
        { ...semantic.scene, hasStatefulGraphicsState: true },
        {
          padding: 8,
          reuse: {
            previousModel,
            affectedSourceIds: [sourceId]
          }
        }
      )
    ).toEqual(fullModel);

    const clippedSource = String.raw`\begin{tikzpicture}
  \clip (0,0) rectangle (1,1);
  \draw (0,0) -- (2,0);
\end{tikzpicture}`;
    const clippedParsed = parseTikz(clippedSource);
    const clippedSemantic = evaluateTikzFigure(clippedParsed.figure, clippedSource);
    const clippedPreviousModel = emitSvgModel(clippedSemantic.scene, { padding: 8 });
    const clippedFullModel = emitSvgModel(clippedSemantic.scene, { padding: 8 });
    const clippedSourceId = clippedSemantic.scene.elements[0]?.sourceRef.sourceId ?? "missing:clipped";

    expect(
      emitSvgModel(clippedSemantic.scene, {
        padding: 8,
        reuse: {
          previousModel: clippedPreviousModel,
          affectedSourceIds: [clippedSourceId]
        }
      })
    ).toEqual(clippedFullModel);
  });

  it("accepts cached models with multiple parts for an affected element", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const previousModel = emitSvgModel(semantic.scene, { padding: 8 });
    const fullModel = emitSvgModel(semantic.scene, { padding: 8 });
    const firstPart = previousModel.parts[0];
    expect(firstPart).toBeDefined();
    const sourceId = firstPart?.sourceId ?? "missing";
    const previousModelWithExtraAffectedPart: SvgRenderModel = {
      ...previousModel,
      parts: [
        ...previousModel.parts,
        {
          ...firstPart,
          partId: `${firstPart?.partId ?? "part"}:cached-copy`,
          order: previousModel.parts.length
        }
      ]
    };

    expect(
      emitSvgModel(semantic.scene, {
        padding: 8,
        reuse: {
          previousModel: previousModelWithExtraAffectedPart,
          affectedSourceIds: [sourceId]
        }
      })
    ).toEqual(fullModel);
  });
});
