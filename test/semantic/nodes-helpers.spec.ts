import { describe, expect, it } from "vitest";

import type { PathItem } from "../../packages/core/src/ast/types.js";
import { worldPoint, worldVector } from "../../packages/core/src/coords/points.js";
import type { NodeTextEngine, NodeTextMetrics } from "../../packages/core/src/text/types.js";
import { pt } from "../../packages/core/src/coords/scalars.js";
import { worldTransform } from "../../packages/core/src/coords/transforms.js";
import { parseOptionListRaw } from "../../packages/core/src/options/parse.js";
import {
  createSemanticContext,
  writeNamedNodeGeometry
} from "../../packages/core/src/semantic/context.js";
import {
  applyNameScope,
  collectScopedNodeNames,
  maybeResolveNamedCoordinateBorderPoint,
  maybeResolveNamedCoordinateBorderPointFromRaw,
  maybeResolveNamedCoordinateBorderPointFromRawAlongAngle,
  maybeResolveTrailingCoordinateFromNodeName,
  shouldCaptureStandaloneNodeNameCoordinate
} from "../../packages/core/src/semantic/nodes/named-coordinates.js";
import {
  parseNodeParts,
  resolveRectangleSplitHorizontal,
  resolveRectangleSplitIgnoreEmptyParts,
  resolveRectangleSplitPartTexts,
  resolveRectangleSplitParts
} from "../../packages/core/src/semantic/nodes/multipart.js";
import {
  pointAtPlacementSegment,
  resolveNodeTargetPoint,
  resolveNodePositionFraction
} from "../../packages/core/src/semantic/nodes/placement.js";
import {
  adjustNodeLayoutForShape,
  resolveNodeLayout
} from "../../packages/core/src/semantic/nodes/layout.js";
import {
  parseMatrixRowsForEdit,
  resolveMatrixCellEditTarget,
  resolveMatrixMode
} from "../../packages/core/src/semantic/nodes/matrix.js";
import {
  intersectRayWithPolygon,
  makeChamferedRectanglePolygon,
  makeCloud,
  makeCloudCallout,
  makeDoubleArrow,
  makeEllipseCallout,
  makeIsoscelesTrianglePolygon,
  makeKitePolygon,
  makeRectangleCallout,
  makeRegularPolygon,
  makeRoundedRectanglePolygon,
  makeSignal,
  makeSingleArrow,
  makeStar,
  makeStarburst,
  makeTape,
  makeTrapeziumPolygon,
  regularPolygonStartAngle,
  resolveCalloutPointerOffset,
  resolveNodeShapeGeometryParams,
  type CircularSizingInput
} from "../../packages/core/src/semantic/nodes/shape-geometry.js";
import { defaultStyle } from "../../packages/core/src/semantic/style/defaults.js";

const wp = (x: number, y: number) => worldPoint(pt(x), pt(y));
const wv = (x: number, y: number) => worldVector(pt(x), pt(y));
const textEngineWithMetrics = (metrics: NodeTextMetrics | null): NodeTextEngine => ({
  validate: () => null,
  measure: () => metrics,
  renderFromCache: () => null
});
const box = (naturalWidth = 40, naturalHeight = 24, minimumWidth = 20, minimumHeight = 12): CircularSizingInput => ({
  naturalWidth,
  naturalHeight,
  minimumWidth,
  minimumHeight
});

describe("semantic node helper coverage", () => {
  it("resolves scoped names and standalone trailing coordinate candidates", () => {
    const context = createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 0, 0));
    context.stack[0].namePrefix = "pre-";
    context.stack[0].nameSuffix = "-suf";

    expect(collectScopedNodeNames(" main ", ["", "alias", "alias"], context)).toEqual(["pre-main-suf", "pre-alias-suf"]);
    expect(applyNameScope("node.east", context)).toBe("pre-node-suf.east");
    expect(maybeResolveTrailingCoordinateFromNodeName(undefined)).toBeNull();
    expect(maybeResolveTrailingCoordinateFromNodeName("   ")).toBeNull();
    expect(maybeResolveTrailingCoordinateFromNodeName("1,2")).toBe("(1,2)");
    expect(maybeResolveTrailingCoordinateFromNodeName("named")).toBeNull();
    expect(applyNameScope(" raw ", createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 0, 0)))).toBe("raw");

    const nodeItem = { kind: "Node" } as PathItem;
    const atKeyword = { kind: "PathKeyword", keyword: "at" } as PathItem;
    const comment = { kind: "PathComment" } as PathItem;
    const coordinate = { kind: "Coordinate" } as PathItem;
    expect(shouldCaptureStandaloneNodeNameCoordinate([nodeItem, coordinate], 1)).toBe(false);
    expect(shouldCaptureStandaloneNodeNameCoordinate([atKeyword, comment, coordinate], 2)).toBe(false);
    expect(shouldCaptureStandaloneNodeNameCoordinate([comment, coordinate], 1)).toBe(true);
  });

  it("resolves named node border points for circle, rectangle, ellipse, polygon, and fallback cases", () => {
    const context = createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 0, 0));
    const fallback = wp(99, 99);
    writeNamedNodeGeometry(context, "circle", {
      shape: "circle",
      center: wp(0, 0),
      anchorHalfWidth: 10,
      anchorHalfHeight: 10,
      anchorRadius: 10
    });
    writeNamedNodeGeometry(context, "rect", {
      shape: "rectangle",
      center: wp(20, 0),
      anchorHalfWidth: 8,
      anchorHalfHeight: 4,
      anchorRadius: 8
    });
    writeNamedNodeGeometry(context, "ellipse", {
      shape: "ellipse",
      center: wp(40, 0),
      anchorTransform: worldTransform(0, 1, -1, 0, 0, 0),
      anchorHalfWidth: 12,
      anchorHalfHeight: 6,
      anchorRadius: 12
    });
    writeNamedNodeGeometry(context, "poly", {
      shape: "rectangle",
      center: wp(60, 0),
      anchorHalfWidth: 5,
      anchorHalfHeight: 5,
      anchorRadius: 5,
      anchorPolygon: [wp(-5, -5), wp(5, -5), wp(5, 5), wp(-5, 5)]
    });
    writeNamedNodeGeometry(context, "point", {
      shape: "coordinate",
      center: wp(80, 0),
      anchorHalfWidth: 0,
      anchorHalfHeight: 0,
      anchorRadius: 0
    });
    writeNamedNodeGeometry(context, "flat-circle", {
      shape: "circle",
      center: wp(90, 0),
      anchorTransform: worldTransform(0, 0, 0, 0, 0, 0),
      anchorHalfWidth: 0,
      anchorHalfHeight: 0,
      anchorRadius: 10
    });
    writeNamedNodeGeometry(context, "bad-rect", {
      shape: "rectangle",
      center: wp(100, 0),
      anchorHalfWidth: Number.NaN,
      anchorHalfHeight: 4,
      anchorRadius: 4
    });
    writeNamedNodeGeometry(context, "plain-ellipse", {
      shape: "ellipse",
      center: wp(110, 0),
      anchorHalfWidth: 8,
      anchorHalfHeight: 4,
      anchorRadius: 8
    });

    expect(maybeResolveNamedCoordinateBorderPoint({ form: "cartesian", x: "0" }, fallback, wp(0, 0), context)).toBe(fallback);
    expect(maybeResolveNamedCoordinateBorderPoint({ form: "named", x: "point" }, fallback, wp(80, 10), context)).toBe(fallback);
    expect(maybeResolveNamedCoordinateBorderPoint({ form: "named", x: "circle" }, fallback, null, context)).toBe(fallback);
    expect(maybeResolveNamedCoordinateBorderPoint({ form: "named", x: "circle.east" }, fallback, wp(20, 0), context)).toBe(fallback);
    expect(maybeResolveNamedCoordinateBorderPoint({ form: "named", x: "circle" }, fallback, wp(20, 0), context).x).toBeCloseTo(10);
    expect(maybeResolveNamedCoordinateBorderPointFromRaw("(rect)", fallback, wp(20, 12), context).y).toBeCloseTo(4);
    expect(maybeResolveNamedCoordinateBorderPointFromRaw("(1,2)", fallback, wp(20, 12), context)).toBe(fallback);
    expect(maybeResolveNamedCoordinateBorderPointFromRawAlongAngle("(ellipse)", fallback, 0, context).x).toBeGreaterThan(40);
    expect(maybeResolveNamedCoordinateBorderPointFromRawAlongAngle("(poly)", fallback, 45, context).x).toBeGreaterThan(60);
    expect(maybeResolveNamedCoordinateBorderPointFromRawAlongAngle("(missing)", fallback, 0, context)).toBe(fallback);
    expect(maybeResolveNamedCoordinateBorderPointFromRawAlongAngle("( )", fallback, 0, context)).toBe(fallback);
    expect(maybeResolveNamedCoordinateBorderPointFromRawAlongAngle("(circle.east)", fallback, 0, context)).toBe(fallback);
    expect(maybeResolveNamedCoordinateBorderPointFromRaw("(flat-circle)", fallback, wp(91, 0), context).x).toBeCloseTo(90);
    expect(maybeResolveNamedCoordinateBorderPointFromRaw("(bad-rect)", fallback, wp(100, 10), context)).toBe(fallback);
    expect(maybeResolveNamedCoordinateBorderPointFromRaw("(plain-ellipse)", fallback, wp(110, 10), context).y).toBeCloseTo(4);
  });

  it("parses multipart node text and rectangle split options", () => {
    const parts = parseNodeParts(String.raw`top \nodepart[style={x[y]}] {second} lower \nodepart   {third} c \nodepart{2} d \nodepart{{fourth}} e \nodepart{} tail \nodepart missing`);
    expect(parts).toEqual([
      { name: "text", text: "top tail \\nodepartmissing" },
      { name: "second", text: "lower" },
      { name: "third", text: "c" },
      { name: "2", text: "d" },
      { name: "fourth", text: "e" }
    ]);

    const options = parseOptionListRaw("[rectangle split parts=3,rectangle split horizontal=false,rectangle split ignore empty parts]");
    expect(resolveRectangleSplitParts(undefined)).toBe(4);
    expect(resolveRectangleSplitParts(options)).toBe(3);
    expect(resolveRectangleSplitParts(parseOptionListRaw("[rectangle split parts=20]"))).toBe(20);
    expect(resolveRectangleSplitParts(parseOptionListRaw("[rectangle split parts=99]"))).toBe(4);
    expect(resolveRectangleSplitHorizontal(undefined)).toBe(false);
    expect(resolveRectangleSplitHorizontal(options)).toBe(false);
    expect(resolveRectangleSplitHorizontal(parseOptionListRaw("[rectangle split horizontal]"))).toBe(true);
    expect(resolveRectangleSplitHorizontal(parseOptionListRaw("[rectangle split horizontal=yes]"))).toBe(true);
    expect(resolveRectangleSplitIgnoreEmptyParts(undefined)).toBe(false);
    expect(resolveRectangleSplitIgnoreEmptyParts(options)).toBe(true);
    expect(resolveRectangleSplitIgnoreEmptyParts(parseOptionListRaw("[rectangle split ignore empty parts=0]"))).toBe(false);
    expect(resolveRectangleSplitIgnoreEmptyParts(parseOptionListRaw("[rectangle split ignore empty parts=yes]"))).toBe(true);

    expect(resolveRectangleSplitPartTexts(parts, 4)).toEqual(["top tail \\nodepartmissing", "lower d", "c", "e"]);
    expect(resolveRectangleSplitPartTexts(parseNodeParts(String.raw`a\nodepart{text} x\nodepart{one} y\nodepart{twentieth} z\nodepart{unknown} u\nodepart{21} v`), 2)).toEqual(["a x y", "z"]);
  });

  it("resolves node placement fractions and segment interpolation variants", () => {
    expect(resolveNodePositionFraction(undefined)).toBeNull();
    expect(resolveNodePositionFraction(parseOptionListRaw("[very near start]"))).toBeCloseTo(0.125);
    expect(resolveNodePositionFraction(parseOptionListRaw("[near start,near end,at end,pos=2]"))).toBe(1);
    expect(resolveNodePositionFraction(parseOptionListRaw("[pos=bad]"))).toBeNull();

    expect(pointAtPlacementSegment({ kind: "line", from: wp(0, 0), to: wp(10, 0) }, 0.25).x).toBeCloseTo(2.5);
    expect(pointAtPlacementSegment({ kind: "hv", operator: "-|", from: wp(0, 0), bend: wp(10, 0), to: wp(10, 10) }, 0.25).x).toBeCloseTo(5);
    expect(pointAtPlacementSegment({ kind: "hv", operator: "-|", from: wp(0, 0), bend: wp(10, 0), to: wp(10, 10) }, 0.75).y).toBeCloseTo(5);
    expect(pointAtPlacementSegment({ kind: "cubic", from: wp(0, 0), c1: wp(10, 0), c2: wp(10, 10), to: wp(20, 10) }, 0.5).x).toBeGreaterThan(9);
    expect(pointAtPlacementSegment({
      kind: "arc",
      from: wp(10, 0),
      to: wp(0, 10),
      params: { rx: 10, ry: 10, startAngle: 0, endAngle: 90 }
    }, 0.5).x).toBeGreaterThan(0);
  });

  it("resolves node target placement from explicit, option, segment, and implicit origins", () => {
    const context = createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 0, 0));
    context.source = String.raw`\node {A};`;
    const diagnostics: string[] = [];
    const pushDiagnostic = (code: string): void => {
      diagnostics.push(code);
    };
    const span = { from: 0, to: context.source.length };
    const baseItem = {
      kind: "Node",
      id: "n",
      span,
      raw: "",
      templateRaw: "",
      textSource: "group",
      textSpan: { from: 6, to: 7 },
      text: "A"
    } as const;

    expect(resolveNodeTargetPoint({ ...baseItem, atRaw: "(1,2)", atSpan: { from: 1, to: 6 } }, context, "src", span, pushDiagnostic, undefined, null).x).toBeCloseTo(28.4528);
    expect(context.editHandles.length).toBe(1);
    expect(resolveNodeTargetPoint(baseItem, context, "src", span, pushDiagnostic, parseOptionListRaw("[at={(3,4)}]"), null).y).toBeCloseTo(113.8112);
    expect(resolveNodeTargetPoint(baseItem, context, "src", span, pushDiagnostic, parseOptionListRaw("[midway]"), { kind: "line", from: wp(0, 0), to: wp(10, 0) }).x).toBeCloseTo(5);
    expect(resolveNodeTargetPoint(baseItem, context, "src", span, pushDiagnostic, undefined, { kind: "line", from: wp(0, 0), to: wp(12, 0) }).x).toBeCloseTo(12);
    expect(resolveNodeTargetPoint(baseItem, context, "src", span, pushDiagnostic, undefined, null, wp(7, 8), { explicitAtSyntax: true })).toEqual(wp(7, 8));
    expect(resolveNodeTargetPoint(baseItem, context, "src", span, pushDiagnostic, undefined, null, undefined, { allowImplicitOriginHandle: true })).toEqual(wp(0, 0));
    expect(context.editHandles.at(-1)?.insertion).toEqual({ kind: "node-inline-at" });
  });

  it("measures node layouts across text wrapping, math engine, fallback metrics, and shape adjustment", () => {
    const style = { ...defaultStyle(), stroke: "none", lineWidth: 2 };
    const wrapped = resolveNodeLayout(
      "Alpha Beta\\\\[2pt] GammaDelta",
      parseOptionListRaw("[text width=18pt,align=flush right,outer sep=auto,minimum size=40pt,text height=8pt,text depth=3pt]"),
      style
    );
    expect(wrapped.textLines.length).toBeGreaterThan(1);
    expect(wrapped.textRenderInfo.mode).toBe("plain");
    expect(wrapped.outerXSep).toBe(0);

    const explicitHeader = resolveNodeLayout(
      String.raw`left \\ right`,
      parseOptionListRaw("[node halign header=\\hfil#,outer sep=5pt,outer xsep=2pt,outer ysep=3pt,align=bad]"),
      { ...style, stroke: "black" }
    );
    expect(explicitHeader.textLines).toEqual(["left", "right"]);
    expect(explicitHeader.outerXSep).toBe(2);
    expect(explicitHeader.outerYSep).toBe(3);

    expect(resolveNodeLayout("abc", parseOptionListRaw("[align=right]"), style).textRenderInfo.mode).toBe("plain");
    expect(resolveNodeLayout("abc", parseOptionListRaw("[align=flush center]"), style).textRenderInfo.mode).toBe("plain");
    expect(resolveNodeLayout("abc", parseOptionListRaw("[align=left]"), style).textRenderInfo.mode).toBe("plain");
    expect(resolveNodeLayout("      ", parseOptionListRaw("[text width=4pt]"), style).textLines).toEqual(["      "]);

    const measured = resolveNodeLayout(
      String.raw`x\\y`,
      parseOptionListRaw("[align=center]"),
      style,
      1,
      textEngineWithMetrics({
          width: 24,
          height: 14,
          baselineY: -4,
          midLineY: 1,
          cacheKey: "k",
          paragraphId: "p",
          renderSourceText: "x\\\\y"
      }),
      "math"
    );
    expect(measured.textRenderInfo.mode).toBe("tex");
    if (measured.textRenderInfo.mode !== "tex") {
      throw new Error("expected native TeX render info");
    }
    expect(measured.textRenderInfo.layoutKind).toBe("explicit-multiline");
    expect(measured.textRenderInfo.paragraphAlignment).toBe("center");

    const measuredWrappedCenter = resolveNodeLayout(
      "x y",
      parseOptionListRaw("[text width=20pt,align=center]"),
      style,
      1,
      textEngineWithMetrics({
          width: 20,
          height: 10,
          baselineY: -3,
          midLineY: 0,
          cacheKey: "kw",
          paragraphId: "pw",
          renderSourceText: "x y"
      })
    );
    if (measuredWrappedCenter.textRenderInfo.mode !== "tex") {
      throw new Error("expected native TeX render info");
    }
    expect(measuredWrappedCenter.textRenderInfo.paragraphAlignment).toBe("center");

    const fallbackMeasured = resolveNodeLayout(
      String.raw`x\\y`,
      parseOptionListRaw("[text width=10pt]"),
      style,
      1,
      textEngineWithMetrics(null),
      "math"
    );
    expect(fallbackMeasured.textRenderInfo.mode).toBe("plain");
    expect(fallbackMeasured.textLines).toEqual(["x", "y"]);

    const empty = resolveNodeLayout("", parseOptionListRaw("[text height=5pt]"), style);
    expect(empty.textBlockHeight).toBeGreaterThan(0);
    const largeFont = resolveNodeLayout(
      "X",
      undefined,
      { ...style, fontSize: 20 }
    );
    expect(largeFont.naturalWidth - largeFont.textBlockWidth)
      .toBeCloseTo(2 * 0.3333 * 20, 6);
    const circle = adjustNodeLayoutForShape(wrapped, "circle");
    const ellipse = adjustNodeLayoutForShape(wrapped, "ellipse");
    expect(circle.visualWidth).toBeCloseTo(circle.visualHeight);
    expect(ellipse.visualWidth).toBeGreaterThanOrEqual(wrapped.visualWidth);
    expect(adjustNodeLayoutForShape(wrapped, "rectangle")).toBe(wrapped);
  });

  it("parses matrix modes, separators, edit targets, and cell spans for edge cases", () => {
    const disabled = resolveMatrixMode(parseOptionListRaw("[matrix=false,matrix of nodes=false,ampersand replacement={}]"));
    expect(disabled.enabled).toBe(false);
    expect(disabled.cellSeparator).toBe("&");
    expect(resolveMatrixMode(parseOptionListRaw("[matrix of math nodes=true]")).matrixKind).toBe("math-nodes");

    const mode = resolveMatrixMode(parseOptionListRaw(String.raw`[
      matrix of nodes,
      nodes in empty cells,
      row sep={between origins,2pt},
      column sep={between borders,3pt},
      ampersand replacement=\amp,
      matrix anchor=base_east
    ]`));
    expect(mode.rowSep).toEqual({ gap: 2, betweenOrigins: true });
    expect(mode.columnSep).toEqual({ gap: 3, betweenOrigins: false });
    expect(mode.matrixAnchor).toBe("base east");

    const body = String.raw` |[draw]| A \amp [2pt] {B \amp C} \\[4pt] \node (n) at (1,2) {D}; \amp |(named)| E `;
    const rows = parseMatrixRowsForEdit(body, mode.cellSeparator, 50);
    expect(rows.rows.map((row) => row.cells.length)).toEqual([2, 2]);
    expect(rows.rows[0].cells[1].raw).toContain(String.raw`B \amp C`);

    const first = resolveMatrixCellEditTarget(body, { from: 50, to: 50 + body.length }, mode, 1, 1);
    const explicit = resolveMatrixCellEditTarget(body, { from: 50, to: 50 + body.length }, mode, 2, 1);
    const namedPrefix = resolveMatrixCellEditTarget(body, { from: 50, to: 50 + body.length }, mode, 2, 2);
    const command = resolveMatrixCellEditTarget(String.raw`\cmd`, { from: 0, to: 4 }, { ...mode, matrixOfNodes: false, includeEmptyCells: false }, 1, 1);
    expect(first?.optionSpan).toBeDefined();
    expect(body.slice((explicit?.textSpan.from ?? 0) - 50, (explicit?.textSpan.to ?? 0) - 50)).toBe("D");
    expect(namedPrefix?.optionSpan).toBeUndefined();
    expect(command).toBeNull();
    expect(resolveMatrixCellEditTarget(body, { from: 50, to: 50 + body.length }, mode, 1.5, 1)).toBeNull();
  });

  it("normalizes uncommon node shape options and rejects malformed values", () => {
    const options = parseOptionListRaw(String.raw`[
      aspect=0,
      isosceles triangle stretches=false,
      kite vertex angles={bad and 20},
      dart tail angle=0,
      circular sector angle=0,
      cloud puffs=1,
      cloud puff arc=0,
      cloud ignores aspect=off,
      starburst points=361,
      starburst point height=-2pt,
      random starburst=off,
      signal pointer angle=0,
      signal to={north east south west},
      signal from={south west},
      tape bend=none,
      tape bend top=out and in,
      tape bend bottom=unknown,
      tape bend height=-4pt,
      callout relative pointer={},
      callout absolute pointer={(1,2)},
      callout pointer shorten=-1pt,
      callout pointer width=-2pt,
      callout pointer arc=0,
      callout pointer start size={},
      callout pointer end size={},
      callout pointer segments=0,
      single arrow tip angle=0,
      single arrow head extend=-1pt,
      single arrow head indent=-2pt,
      double arrow tip angle=0,
      double arrow head extend=-3pt,
      double arrow head indent=-4pt,
      trapezium angle=-30deg,
      trapezium stretches=false,
      trapezium stretches body=off,
      regular polygon sides=2,
      star points=1,
      star point ratio=0,
      star point height=-1pt,
      magnifying glass handle aspect=-1,
      rounded rectangle arc length=-240,
      rounded rectangle west arc=none,
      rounded rectangle east arc=concave,
      chamfered rectangle angle=120,
      chamfered rectangle sep=-3pt,
      chamfered rectangle xsep=bad,
      chamfered rectangle ysep=-2pt,
      chamfered rectangle corners={north west,south east}
    ]`);
    const params = resolveNodeShapeGeometryParams(options, () => 1234);

    expect(params.diamondAspect).toBe(1);
    expect(params.isoscelesTriangleStretches).toBe(false);
    expect(params.kiteUpperVertexAngle).toBe(120);
    expect(params.dartTailAngle).toBe(135);
    expect(params.circularSectorAngle).toBe(60);
    expect(params.cloudPuffs).toBe(10);
    expect(params.cloudPuffArc).toBe(150);
    expect(params.cloudIgnoresAspect).toBe(false);
    expect(params.randomStarburstSeed).toBe(0);
    expect(params.signalPointerAngle).toBe(90);
    expect(params.signalToSides).toEqual(["west"]);
    expect(params.signalFromSides).toEqual(["west"]);
    expect(params.tapeBendTop).toBe("out and in");
    expect(params.tapeBendBottom).toBe("in and out");
    expect(params.calloutPointerIsAbsolute).toBe(true);
    expect(params.calloutAbsolutePointerRaw).toBe("(1,2)");
    expect(params.calloutPointerSegments).toBe(2);
    expect(params.roundedRectangleArcLength).toBe(180);
    expect(params.roundedRectangleWestArc).toBe("none");
    expect(params.roundedRectangleEastArc).toBe("concave");
    expect(params.chamferedRectangleAngle).toBe(89);
    expect(params.chamferedRectangleXSepPt).toBe(0);
    expect(params.chamferedRectangleCorners).toBe("north west,south east");

    const random = resolveNodeShapeGeometryParams(parseOptionListRaw("[random starburst=true,shape border rotate=15]"), () => 88);
    expect(random.randomStarburstSeed).toBe(88);
    expect(random.shapeBorderRotate).toBe(15);
  });

  it("builds uncommon node polygons for curved corners, callouts, signals, tape, arrows, and stars", () => {
    const sizing = box();

    expect(makeRoundedRectanglePolygon(40, 20, 0, "none", "none")).toHaveLength(5);
    expect(makeRoundedRectanglePolygon(40, 20, 180, "concave", "concave").length).toBeGreaterThan(20);

    const chamfered = makeChamferedRectanglePolygon(40, 24, 4, 8, 30, "north west,south east");
    expect(chamfered[0].x).toBeGreaterThan(-20);
    expect(chamfered[2].y).toBeCloseTo(12);

    const triangle = makeIsoscelesTrianglePolygon(box(100, 4, 10, 4), 30, 15, false);
    expect(triangle[0].x).not.toBeCloseTo(0);
    expect(makeKitePolygon(box(8, 120, 8, 120), 0, 0, 45)[0].x).not.toBeCloseTo(0);
    expect(makeTrapeziumPolygon({ naturalHalfWidth: 10, naturalHalfHeight: 6, minimumWidth: 60, minimumHeight: 30 }, 75, 105, 30, true, true)[0].x).toBeLessThan(0);

    expect(regularPolygonStartAngle(4, 10)).toBe(55);
    expect(makeRegularPolygon(box(10, 30, 12, 12), 4, 0)).toHaveLength(4);

    const ratioStar = makeStar(box(4, 4, 40, 40), 5, 2, 0, true, 10);
    const heightStar = makeStar(box(4, 4, 40, 40), 5, 2, 3, false, 0);
    expect(ratioStar.polygon).toHaveLength(10);
    expect(heightStar.inner[0].y).toBeLessThan(heightStar.outer[0].y);

    const staticBurst = makeStarburst(sizing, 5, 6, 0, 0);
    const randomBurst = makeStarburst(sizing, 5, 6, 42, 0);
    expect(staticBurst.outer[0].y).toBeGreaterThan(randomBurst.outer[0].y);

    const signal = makeSignal(sizing, 0, ["north", "east", "south", "west"], ["north", "west"]);
    expect(signal.polygon[0].y).toBeGreaterThan(12);
    expect(signal.polygon[7].x).toBeLessThan(-20);

    const flatTape = makeTape(sizing, "none", "none", 10);
    const wavyTape = makeTape(sizing, "out and in", "in and out", 10);
    expect(flatTape.polygon[9].y).toBeCloseTo(12);
    expect(wavyTape.polygon[5].y).not.toBeCloseTo(12);

    const singleArrow = makeSingleArrow(box(10, 6, 8, 60), 0, 3, 999, 90);
    const doubleArrow = makeDoubleArrow(box(10, 6, 8, 60), 0, 3, 999, 45);
    expect(singleArrow.polygon).toHaveLength(7);
    expect(doubleArrow.polygon).toHaveLength(10);
  });

  it("handles callout pointer fallback, shortening, absolute offsets, and cloud pointer sizing", () => {
    const sizing = box(40, 20, 10, 10);
    const relativeEast = makeRectangleCallout(sizing, wp(0, 0), 6, false, 0);
    const absoluteNorth = makeRectangleCallout(sizing, wp(0, 40), 200, true, 5);
    const absoluteWest = makeRectangleCallout(sizing, wp(-60, 0), 6, true, 0);
    const absoluteSouth = makeRectangleCallout(sizing, wp(0, -60), 6, true, 0);
    expect(relativeEast.pointer.x).toBeGreaterThan(20);
    expect(absoluteNorth.pointer.y).toBeCloseTo(35);
    expect(absoluteWest.pointer.x).toBeLessThan(-20);
    expect(absoluteSouth.pointer.y).toBeLessThan(-10);

    const ellipseFallback = makeEllipseCallout(sizing, wp(0, 0), 0, false, 999, 4);
    const ellipseAbsolute = makeEllipseCallout(sizing, wp(0, -40), 270, true, 10, 4);
    expect(ellipseFallback.pointer.x).toBeGreaterThan(0);
    expect(ellipseAbsolute.pointer.y).toBeCloseTo(-30);
    expect(ellipseAbsolute.polygon.length).toBeGreaterThan(4);

    const cloudFallback = makeCloudCallout(sizing, 1, 0, 0, false, 0, wp(0, 0), "bad", "2pt and 4pt", 0, false, 0);
    const cloudAbsolute = makeCloudCallout(sizing, 5, 200, 2, true, 10, wp(60, 0), ".25 of callout", "3pt", 3, true, 10);
    expect(cloudFallback.pointerPolygon).toHaveLength(1);
    expect(cloudAbsolute.pointer.x).toBeCloseTo(50);
    expect(cloudAbsolute.pointerPolygon.length).toBeGreaterThan(4);

    const context = createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 0, 0));
    const absolute = resolveCalloutPointerOffset({
      calloutPointerIsAbsolute: true,
      calloutRelativePointerRaw: "(bad)",
      calloutAbsolutePointerRaw: "(3,4)",
      calloutPointerShortenPt: 0
    }, context, wp(10, 20));
    expect(absolute.x).toBeCloseTo(75.358);
    expect(absolute.y).toBeCloseTo(93.8112);

    const relative = resolveCalloutPointerOffset({
      calloutPointerIsAbsolute: false,
      calloutRelativePointerRaw: "1cm,2cm",
      calloutAbsolutePointerRaw: null,
      calloutPointerShortenPt: 0
    }, null, null);
    expect(relative.x).toBeGreaterThan(20);
    expect(relative.y).toBeGreaterThan(50);
  });

  it("covers cloud aspect handling and ray intersection edge cases", () => {
    const stretched = makeCloud(box(10, 40, 10, 40), 5, 0, 2, false, 0);
    const ignored = makeCloud(box(10, 40, 10, 40), 5, 360, 2, true, 45);
    expect(stretched.polygon.length).toBeGreaterThan(10);
    expect(stretched.puffs).toHaveLength(5);
    expect(ignored.puffs[0].x).not.toBeCloseTo(stretched.puffs[0].x);

    const square = [wp(-10, -10), wp(10, -10), wp(10, 10), wp(-10, 10)];
    expect(intersectRayWithPolygon(wp(0, 0), wv(0, 0), square)).toBeNull();
    expect(intersectRayWithPolygon(wp(20, 0), wv(1, 0), square)).toBeNull();
    expect(intersectRayWithPolygon(wp(0, 0), wv(1, 0), square)?.x).toBeCloseTo(10);
  });
});
