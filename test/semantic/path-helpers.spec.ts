import { describe, expect, it } from "vitest";

import { worldPoint as makeWorldPoint } from "../../packages/core/src/coords/points.js";
import type { WorldPoint } from "../../packages/core/src/coords/points.js";
import { pt } from "../../packages/core/src/coords/scalars.js";
import { worldTransform } from "../../packages/core/src/coords/transforms.js";
import type { CoordinateItem, PathOptionItem, PathStatement, ToOperationItem } from "../../packages/core/src/ast/types.js";
import type { OptionListAst, OptionEntry } from "../../packages/core/src/options/types.js";
import type { PlacementSegment } from "../../packages/core/src/semantic/path/types.js";
import {
  parseCircleRadiusFromCoordinateRaw,
  parseCoordinateOperation,
  parseEllipseRadiiFromCoordinateRaw
} from "../../packages/core/src/semantic/path/parsers.js";
import {
  appendArcCommand,
  extractArcParameters,
  parseArcShorthand
} from "../../packages/core/src/semantic/path/arc.js";
import {
  extractGridStepsFromOptionList,
  extractGridStepsFromOptionLists,
  makeGridElements
} from "../../packages/core/src/semantic/path/grid.js";
import {
  evaluateTurnCoordinate,
  resolveDefaultGridStep
} from "../../packages/core/src/semantic/path/evaluate-coordinate-helpers.js";
import { parseSvgPathOperation } from "../../packages/core/src/semantic/path/svg.js";
import { appendPathPoint, roundClosedPathStartCorner } from "../../packages/core/src/semantic/path/segments.js";
import {
  applyNameIntersectionsDirective,
  collectPathIntersectionDirectives,
  registerNamedPath
} from "../../packages/core/src/semantic/path/intersections.js";
import {
  cloneAdornmentOwnerGeometry,
  extractNodeAdornmentPlan,
  extractToLikeOptionPlan,
  makeNodeAdornmentTargetId,
  materializeNodeAdornment,
  stripAdornmentInternalStyleOptions
} from "../../packages/core/src/semantic/path/label-quotes.js";
import {
  findNextConnector,
  findTopLevelChar,
  mergeOptionLists,
  optionListFromEntries,
  optionListIfPresent,
  readBalancedSegment,
  readConnector,
  skipWhitespace,
  splitTopLevel,
  stripOptionListBrackets,
  trimRightIndex
} from "../../packages/core/src/semantic/path/graph-parse-utils.js";
import {
  resolveSizeAwareGraphNodePoints,
  type RuntimeGraphNode
} from "../../packages/core/src/semantic/path/graph-size-aware-placement.js";
import {
  currentAnchorForDirection,
  parseDirectionalKey,
  parseNodeDistance,
  resolveNodePositioningTarget,
  targetAnchorForDirection
} from "../../packages/core/src/semantic/path/node-positioning.js";
import {
  buildPlotExpressionEntries,
  defaultEvaluateCoordinateRaw,
  emitPlotPath,
  evaluatePlotCoordinatePoints,
  extractPlotCoordinateEntries
} from "../../packages/core/src/semantic/path/evaluate-plot.js";
import {
  applyPlotOptionLists,
  createDefaultPlotSettings,
  formatPlotSampleValue,
  resolvePlotSampleValues
} from "../../packages/core/src/semantic/path/plot.js";
import { defaultStyle } from "../../packages/core/src/semantic/style/defaults.js";
import {
  createSemanticContext,
  readContextMacroBinding,
  readNamedCoordinate,
  writeContextMacroBinding,
  writeNamedCoordinate,
  writeNamedNodeGeometry,
  type NamedNodeGeometry
} from "../../packages/core/src/semantic/context.js";
import type { SceneCircle, SceneElement, SceneEllipse, ScenePath, ScenePathCommand } from "../../packages/core/src/semantic/types.js";

const span = { from: 0, to: 0 };
const identity = worldTransform(1, 0, 0, 1, 0, 0);
const identityTransform = worldTransform(1, 0, 0, 1, 0, 0);

function p(x: number, y: number) {
  return makeWorldPoint(pt(x), pt(y));
}

function flag(key: string): OptionEntry {
  return { kind: "flag", key, raw: key, span };
}

function kv(key: string, valueRaw: string): OptionEntry {
  return { kind: "kv", key, valueRaw, raw: `${key}=${valueRaw}`, span };
}

function options(...entries: OptionEntry[]): OptionListAst {
  return { raw: "", span, entries };
}

function unknown(raw: string): OptionEntry {
  return { kind: "unknown", raw, span };
}

function coordinate(item: Partial<CoordinateItem>): CoordinateItem {
  return {
    kind: "Coordinate",
    id: "coord",
    raw: "(0:1)",
    span,
    form: "polar",
    x: "0",
    y: "1",
    relativePrefix: null,
    options: options(flag("turn")),
    ...item
  } as CoordinateItem;
}

function pathOption(entries: OptionEntry[]): PathOptionItem {
  return {
    kind: "PathOption",
    id: "path-option",
    raw: "",
    span,
    options: options(...entries),
    optionsSpan: span
  } as PathOptionItem;
}

function sourceRef(sourceId: string) {
  return {
    sourceId,
    sourceSpan: span,
    sourceFingerprint: "test-fingerprint"
  };
}

function scenePath(sourceId: string, commands: ScenePathCommand[]): ScenePath {
  return {
    kind: "Path",
    id: `path:${sourceId}`,
    runtimeId: `runtime:path:${sourceId}`,
    layer: "main",
    sourceRef: sourceRef(sourceId),
    style: {} as ScenePath["style"],
    styleChain: [],
    commands
  };
}

function sceneCircle(sourceId: string, centerX: number, centerY: number, radius: number): SceneCircle {
  return {
    kind: "Circle",
    id: `circle:${sourceId}`,
    runtimeId: `runtime:circle:${sourceId}`,
    layer: "main",
    sourceRef: sourceRef(sourceId),
    style: {} as SceneCircle["style"],
    styleChain: [],
    center: p(centerX, centerY),
    radius
  };
}

function sceneEllipse(sourceId: string, centerX: number, centerY: number, rx: number, ry: number, rotation = 0): SceneEllipse {
  return {
    kind: "Ellipse",
    id: `ellipse:${sourceId}`,
    runtimeId: `runtime:ellipse:${sourceId}`,
    layer: "main",
    sourceRef: sourceRef(sourceId),
    style: {} as SceneEllipse["style"],
    styleChain: [],
    center: p(centerX, centerY),
    rx,
    ry,
    rotation
  };
}

function graphRuntimeNode(
  nodeIndex: number,
  logicalWidth: number,
  logicalDepth: number,
  overrides: Partial<RuntimeGraphNode["placementHint"]> = {}
): RuntimeGraphNode {
  return {
    nodeIndex,
    defaultPoint: p(logicalWidth * 10, logicalDepth * 10),
    syntheticNode: {
      kind: "Node",
      id: `graph-node:${nodeIndex}`,
      raw: "A",
      templateRaw: "A",
      span,
      textSource: "group",
      textSpan: span,
      text: "A"
    },
    placementHint: {
      mode: "grid",
      logicalWidth,
      logicalDepth,
      level: logicalWidth + logicalDepth + 1,
      chainShift: { x: 10, y: 0 },
      groupShift: { x: 0, y: 10 },
      chainSepDistance: 4,
      groupSepDistance: 5,
      ...overrides
    }
  };
}

describe("semantic path helper parsers", () => {
  it("parses coordinate operations and rejects non-coordinate forms", () => {
    expect(parseCoordinateOperation("coordinate (foo) at (1,2)")).toEqual({ name: "foo" });
    expect(parseCoordinateOperation("coordinate(bar)")).toEqual({ name: "bar" });
    expect(parseCoordinateOperation("node (bar)")).toBeNull();
  });

  it("parses circle and ellipse radii from coordinate syntax", () => {
    const parsedCircleRadius = parseCircleRadiusFromCoordinateRaw("(2)");
    expect(parsedCircleRadius).not.toBeNull();
    expect(parsedCircleRadius?.value).toBeCloseTo(56.9055, 3);
    expect(parseCircleRadiusFromCoordinateRaw("(4pt)")).toEqual({
      value: 4,
      applyFrameTransform: false
    });
    expect(parseCircleRadiusFromCoordinateRaw("(1,2)")).toBeNull();
    expect(parseCircleRadiusFromCoordinateRaw("(30:1)")).toBeNull();
    expect(parseCircleRadiusFromCoordinateRaw("(1 and 2)")).toBeNull();

    const ellipse = parseEllipseRadiiFromCoordinateRaw("(1 and 2pt)");
    expect(ellipse?.rx.applyFrameTransform).toBe(true);
    expect(ellipse?.ry).toEqual({ value: 2, applyFrameTransform: false });
    expect(parseEllipseRadiiFromCoordinateRaw("(1,2)")).toBeNull();
    expect(parseEllipseRadiiFromCoordinateRaw("(bad and 2pt)")).toBeNull();
  });

  it("parses arc parameters, shorthand syntax, diagnostics, and transformed arcs", () => {
    const diagnostics: string[] = [];
    const pushDiagnostic = (_code: string, message: string) => diagnostics.push(message);
    expect(
      extractArcParameters(
        pathOption([
          flag("ignored"),
          kv("start angle", "10"),
          kv("delta angle", "45"),
          kv("radius", "2pt"),
          kv("x radius", "bad")
        ]),
        pushDiagnostic,
        { radius: 3 } as never
      )
    ).toMatchObject({ startAngle: 10, endAngle: 55, rx: 2, ry: 2 });
    expect(extractArcParameters(pathOption([kv("end angle", "20"), kv("radius", "1pt")]), pushDiagnostic, {} as never)).toBeNull();
    expect(extractArcParameters(pathOption([kv("start angle", "0"), kv("radius", "1pt")]), pushDiagnostic, {} as never)).toBeNull();
    expect(extractArcParameters(pathOption([kv("start angle", "0"), kv("end angle", "90")]), pushDiagnostic, {} as never)).toBeNull();
    expect(diagnostics).toEqual([
      "Arc requires a start angle.",
      "Arc requires an end angle or delta angle.",
      "Arc requires `radius` or both `x radius` and `y radius`."
    ]);

    expect(parseArcShorthand("(0:90:1cm and 2pt)")).toMatchObject({ startAngle: 0, endAngle: 90 });
    expect(parseArcShorthand("(0:90:bad and 2pt)")).toBeNull();
    expect(parseArcShorthand("(0:bad:1cm)")).toBeNull();
    expect(parseArcShorthand("(0:90:bad)")).toBeNull();
    expect(parseArcShorthand("(0:90)")).toBeNull();
    expect(parseArcShorthand("0:90:1cm")).toBeNull();

    const commands: ScenePathCommand[] = [];
    const normal = appendArcCommand(commands, p(1, 0), { startAngle: 0, endAngle: 270, rx: 1, ry: 2 });
    const reflected = appendArcCommand(commands, p(1, 0), { startAngle: 0, endAngle: -90, rx: 1, ry: 2 }, { a: -1, b: 0, c: 0, d: 1 });
    const singular = appendArcCommand(commands, p(0, 0), { startAngle: 0, endAngle: 90, rx: 0, ry: 0 }, { a: 0, b: 0, c: 0, d: 0 });
    expect(normal.endpoint).toBeDefined();
    expect(reflected.endpoint).toBeDefined();
    expect(singular.endpoint).toBeDefined();
    expect(commands[0]).toMatchObject({ kind: "A", largeArc: true, sweep: true });
    expect(commands[1]).toMatchObject({ kind: "A", sweep: true });
  });
});

describe("semantic SVG path operation parser", () => {
  it("parses absolute, relative, smooth, quadratic, arc, and close commands", () => {
    const parsed = parseSvgPathOperation({
      payloadRaw: "{M 0 0 l 10 0 h 5 v 5 C 20 5 20 10 15 10 s -5 5 -10 0 Q 0 10 0 5 t 5 -5 A 5 5 0 0 1 10 0 z}",
      transform: identityTransform,
      startPoint: p(0, 0),
      subpathStartPoint: null
    });

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.commands.at(0)).toMatchObject({ kind: "M", to: { x: 0, y: 0 } });
    expect(parsed.commands.some((command) => command.kind === "C")).toBe(true);
    expect(parsed.commands.at(-1)).toMatchObject({ kind: "Z" });
    expect(parsed.subpathStartPoint).toMatchObject({ x: 0, y: 0 });
    expect(parsed.lastSegment?.kind).toBe("line");
  });

  it("unwraps quoted payloads and reports malformed SVG path data", () => {
    const parsed = parseSvgPathOperation({
      payloadRaw: '"10 20 X M 0"',
      transform: identityTransform,
      startPoint: p(3, 4),
      subpathStartPoint: p(1, 2)
    });

    expect(parsed.commands).toEqual([]);
    expect(parsed.diagnostics).toContain("Expected an SVG command before numeric data near position 1.");
    expect(parsed.diagnostics).toContain("Unexpected character 'X' near position 7.");
    expect(parsed.diagnostics).toContain("SVG command 'M' requires at least one coordinate pair.");
    expect(parsed.endPoint).toMatchObject({ x: 3, y: 4 });
  });

  it("handles non-invertible transforms, invalid arc flags, zero-radius arcs, and unsupported commands", () => {
    const parsed = parseSvgPathOperation({
      payloadRaw: "M 0 0 A 0 5 0 2 3 10 0 R 1 2",
      transform: worldTransform(0, 0, 0, 0, 0, 0),
      startPoint: p(0, 0),
      subpathStartPoint: null
    });

    expect(parsed.diagnostics).toContain("SVG operation transform is not invertible; interpreting SVG data in world coordinates.");
    expect(parsed.diagnostics).toContain("Arc flag value '2' is not 0 or 1; treating nonzero as true.");
    expect(parsed.diagnostics).toContain("Arc flag value '3' is not 0 or 1; treating nonzero as true.");
    expect(parsed.diagnostics).toContain("Unexpected character 'R' near position 24.");
    expect(parsed.commands.some((command) => command.kind === "L")).toBe(true);
  });

  it("reports missing SVG command operands and handles terse payload edge cases", () => {
    const malformed = parseSvgPathOperation({
      payloadRaw: "{L H V C S Q T A}",
      transform: identityTransform,
      startPoint: p(0, 0),
      subpathStartPoint: null
    });

    expect(malformed.diagnostics).toEqual([
      "SVG command 'L' requires coordinate pairs.",
      "SVG command 'H' requires x values.",
      "SVG command 'V' requires y values.",
      "SVG command 'C' requires groups of 6 numbers.",
      "SVG command 'S' requires groups of 4 numbers.",
      "SVG command 'Q' requires groups of 4 numbers.",
      "SVG command 'T' requires coordinate pairs.",
      "SVG command 'A' requires groups of 7 numbers."
    ]);

    const repeatedMove = parseSvgPathOperation({
      payloadRaw: "M 1 1 2 2 3 3 A 1 1 0 0 0 3 3",
      transform: identityTransform,
      startPoint: p(0, 0),
      subpathStartPoint: null
    });
    expect(repeatedMove.commands.filter((command) => command.kind === "L")).toHaveLength(2);

    const empty = parseSvgPathOperation({
      payloadRaw: "",
      transform: identityTransform,
      startPoint: p(2, 3),
      subpathStartPoint: null
    });
    expect(empty.commands).toEqual([]);
    expect(empty.endPoint).toEqual(p(2, 3));
  });
});

describe("semantic path segment helpers", () => {
  it("appends null-current, orthogonal, unsupported, and rounded line segments", () => {
    const commands: ScenePathCommand[] = [];
    expect(appendPathPoint(commands, "--", null, p(5, 0), null, 2)).toMatchObject({
      segment: null,
      nextRoundedCorners: 2
    });
    expect(commands).toEqual([{ kind: "L", to: p(5, 0) }]);

    commands.length = 0;
    commands.push({ kind: "M", to: p(0, 0) });
    const straight = appendPathPoint(commands, "--", p(0, 0), p(10, 0), null, 3);
    expect(straight.segment?.kind).toBe("line");
    expect(commands.at(-1)).toMatchObject({ kind: "L", to: p(10, 0) });

    commands.length = 0;
    commands.push({ kind: "M", to: p(0, 0) });
    appendPathPoint(commands, "--", p(0, 0), p(10, 0), 3, 3);
    expect(commands.at(-1)).toMatchObject({ kind: "L", to: p(10, 0) });

    commands.length = 0;
    commands.push({ kind: "M", to: p(0, 0) });
    const horizontalVertical = appendPathPoint(commands, "-|", p(0, 0), p(10, 20), null, 3);
    const verticalHorizontal = appendPathPoint(commands, "|-", p(10, 20), p(30, 40), 3, 4);
    expect(horizontalVertical.segment?.kind).toBe("hv");
    expect(verticalHorizontal.segment?.kind).toBe("hv");
    expect(commands.some((command) => command.kind === "C")).toBe(true);

    expect(appendPathPoint(commands, "??" as "--", p(30, 40), p(50, 50), null, 5)).toMatchObject({
      segment: null,
      nextRoundedCorners: 5
    });

    const curveEnded: ScenePathCommand[] = [
      { kind: "M", to: p(0, 0) },
      { kind: "C", c1: p(2, 0), c2: p(8, 0), to: p(10, 0) }
    ];
    appendPathPoint(curveEnded, "--", p(10, 0), p(10, 10), 2, null);
    expect(curveEnded.at(-2)?.kind).toBe("C");
    expect(curveEnded.at(-1)).toMatchObject({ kind: "L", to: p(10, 10) });
  });

  it("rounds closed path starts and ignores unroundable closures", () => {
    const closed: ScenePathCommand[] = [
      { kind: "M", to: p(0, 0) },
      { kind: "L", to: p(20, 0) },
      { kind: "L", to: p(20, 20) }
    ];
    roundClosedPathStartCorner(closed, p(0, 20), p(0, 0), 5);
    expect(closed[0]?.kind).toBe("M");
    expect(closed.at(-1)?.kind).toBe("C");

    const disabled = structuredClone(closed);
    roundClosedPathStartCorner(disabled, p(0, 20), p(0, 0), 0);
    expect(disabled).toHaveLength(closed.length);

    const noMove: ScenePathCommand[] = [{ kind: "L", to: p(1, 0) }];
    roundClosedPathStartCorner(noMove, p(0, 1), p(0, 0), 5);
    expect(noMove).toHaveLength(1);

    const noFirstSegment: ScenePathCommand[] = [{ kind: "M", to: p(0, 0) }];
    roundClosedPathStartCorner(noFirstSegment, p(0, 1), p(0, 0), 5);
    expect(noFirstSegment).toHaveLength(1);

    const degenerate: ScenePathCommand[] = [
      { kind: "M", to: p(0, 0) },
      { kind: "L", to: p(0, 0) }
    ];
    roundClosedPathStartCorner(degenerate, p(0, 0), p(0, 0), 5);
    expect(degenerate).toHaveLength(2);
  });
});

describe("semantic label and quote helpers", () => {
  it("handles empty adornment inputs and label quote defaults", () => {
    expect(extractNodeAdornmentPlan(undefined)).toEqual({ mainOptions: undefined, adornments: [] });
    expect(stripAdornmentInternalStyleOptions(undefined)).toBeUndefined();
    expect(extractToLikeOptionPlan({ id: "edge", options: undefined } as never).generatedNodes).toEqual([]);

    const plan = extractNodeAdornmentPlan(
      options(
        flag("quotes mean label"),
        kv("label position", "below right"),
        kv("label distance", "bad"),
        unknown('"Plain quote"'),
        unknown('"Styled quote"{text=blue}'),
        unknown('"unterminated'),
        unknown("'"),
        kv("label", "{:{Fallback angle}}"),
        kv("label", "{[name=keep]center:}"),
        flag("quotes mean pin")
      )
    );

    expect(plan.mainOptions?.entries.map((entry) => entry.raw)).toEqual(["\"unterminated", "'"]);
    expect(plan.adornments.map((adornment) => adornment.text)).toEqual(["Plain quote", "Styled quote", "Fallback angle"]);
    expect(plan.adornments.map((adornment) => adornment.angleRaw)).toEqual(["below right", "below right", "below right"]);
  });

  it("extracts node adornments, quote shorthand, defaults, and retained main options", () => {
    const plan = extractNodeAdornmentPlan(
      options(
        flag("quotes mean pin"),
        kv("pin position", "left"),
        kv("pin distance", "4pt"),
        kv("pin edge", "{draw=blue}"),
        kv("pin", "{[name=p,pin distance=5pt,pin edge={draw=red}]45:{Pin}}"),
        kv("label", "{[label distance=2pt]below:{Lab}}"),
        kv("label", "{}"),
        unknown('"Quote"\' {above right,text=red}'),
        kv("draw", "blue"),
        flag("thick")
      ),
      { labelPosition: "right", labelDistancePt: 1 }
    );

    expect(plan.mainOptions?.entries.map((entry) => entry.raw)).toEqual(["draw=blue", "thick"]);
    expect(plan.adornments).toHaveLength(3);
    expect(plan.adornments.map((adornment) => adornment.kind)).toEqual(["pin", "label", "pin"]);
    expect(plan.adornments.map((adornment) => adornment.text)).toEqual(["Pin", "Lab", "Quote"]);
    expect(plan.adornments[0]?.angleRaw).toBe("45");
    expect(plan.adornments[0]?.distancePt).toBeCloseTo(5, 6);
    expect(plan.adornments[0]?.pinEdgeRaw).toBe("{draw=red}");
    expect(plan.adornments[1]?.angleRaw).toBe("below");
    expect(plan.adornments[2]?.angleRaw).toBe("45");
  });

  it("strips adornment-only style hooks and clones owner geometry", () => {
    const stripped = stripAdornmentInternalStyleOptions(
      options(
        flag("every label"),
        kv("every pin quotes", "{text=red}"),
        kv("fill", "white")
      )
    );
    expect(stripped?.entries.map((entry) => entry.raw)).toEqual(["fill=white"]);

    const clone = cloneAdornmentOwnerGeometry({
      shape: "rectangle",
      center: p(1, 2),
      anchorHalfWidth: 3,
      anchorHalfHeight: 4,
      anchorRadius: 5,
      anchorTransform: worldTransform(1, 2, 3, 4, 5, 6),
      anchorPolygon: [p(0, 0), p(1, 0), p(0, 1)]
    });
    expect(clone?.shape).toBe("rectangle");
    expect(clone?.anchorTransform).toEqual({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 });
    expect(clone?.anchorPolygon).toHaveLength(3);
    expect(makeNodeAdornmentTargetId("node:1", 2, "pin")).toBe("node-adornment:node:1:pin:2");
  });

  it("lowers edge-label, edge-node, and quote options into synthetic nodes", () => {
    const item: ToOperationItem = {
      kind: "ToOperation",
      id: "to:1",
      span,
      raw: "",
      options: options(
        kv("edge label", "{A}"),
        kv("edge label'", "{B}"),
        kv("edge node", "{node[near start] (n1) {N1} \\node[near end] {N2}}"),
        kv("edge node", "{not a node}"),
        unknown('"Q"\' {below}'),
        kv("draw", "red")
      )
    };

    const plan = extractToLikeOptionPlan(item);
    expect(plan.generatedNodes.map((node) => node.text)).toEqual(["A", "B", "N1", "N2", "Q"]);
    expect(plan.generatedNodes[2]?.name).toBe("n1");
    expect(plan.item.options?.entries.map((entry) => entry.raw)).toEqual(["edge node={not a node}", "draw=red"]);
  });

  it("materializes adornments against named geometry and local transforms", () => {
    const context = createSemanticContext(defaultStyle(), worldTransform(2, 0, 0, 2, 10, 20));
    writeNamedCoordinate(context, "A", p(10, 20));
    const baseGeometry: NamedNodeGeometry = {
      shape: "circle",
      center: p(10, 20),
      anchorHalfWidth: 8,
      anchorHalfHeight: 8,
      anchorRadius: 8
    };
    writeNamedNodeGeometry(context, "A", baseGeometry);
    writeNamedCoordinate(context, "A.east", p(18, 20));

    const spec = extractNodeAdornmentPlan(options(kv("pin", "{[name=explicit,anchor=north]east:{Pin}}"))).adornments[0];
    if (!spec) {
      throw new Error("Expected pin spec");
    }
    const materialized = materializeNodeAdornment({
      spec,
      context,
      mainNodeNameRaw: "A",
      ownerId: "path:0",
      adornmentIndex: 0
    });

    expect(materialized.node.name).toBe("explicit");
    expect(materialized.node.options?.entries.some((entry) => entry.kind === "kv" && entry.key === "at")).toBe(true);
    expect(materialized.node.options?.entries.some((entry) => entry.kind === "kv" && entry.key === "anchor" && entry.valueRaw === "north")).toBe(true);
    expect(materialized.mainPoint).toMatchObject({ x: 10, y: 20 });
    expect(materialized.mainGeometry?.shape).toBe("circle");

    const geometries: Array<[string, NamedNodeGeometry]> = [
      ["rectangle", { ...baseGeometry, shape: "rectangle", anchorHalfWidth: 6, anchorHalfHeight: 4 }],
      ["ellipse", { ...baseGeometry, shape: "ellipse", anchorHalfWidth: 6, anchorHalfHeight: 4 }],
      ["diamond", { ...baseGeometry, shape: "diamond", anchorPolygon: [p(0, 5), p(5, 0), p(0, -5), p(-5, 0)] }]
    ];
    for (const [shape, geometry] of geometries) {
      writeNamedNodeGeometry(context, shape, geometry);
      writeNamedCoordinate(context, shape, p(10, 20));
      const labelSpec = extractNodeAdornmentPlan(options(kv("label", "{45:{L}}"))).adornments[0];
      if (!labelSpec) {
        throw new Error("Expected label spec");
      }
      const label = materializeNodeAdornment({
        spec: labelSpec,
        context,
        mainNodeNameRaw: shape,
        ownerId: shape,
        adornmentIndex: 1
      });
      expect(label.node.options?.entries.some((entry) => entry.kind === "kv" && entry.key === "anchor")).toBe(true);
      expect(label.mainGeometry?.shape).toBe(shape);
    }

    const centerSpec = extractNodeAdornmentPlan(options(kv("label", "{center:{C}}"))).adornments[0];
    const numericSpec = extractNodeAdornmentPlan(options(kv("label", "{720:{N}}"))).adornments[0];
    const anchorSpec = extractNodeAdornmentPlan(options(kv("label", "{custom:{A}}"))).adornments[0];
    if (!centerSpec || !numericSpec || !anchorSpec) {
      throw new Error("Expected label specs");
    }
    writeNamedCoordinate(context, "A.custom", p(10, 35));
    expect(materializeNodeAdornment({ spec: centerSpec, context, mainNodeNameRaw: "missing", ownerId: "missing", adornmentIndex: 0 }).node.options?.entries.some(
      (entry) => entry.kind === "kv" && entry.key === "anchor" && entry.valueRaw === "center"
    )).toBe(true);
    expect(materializeNodeAdornment({ spec: numericSpec, context, mainNodeNameRaw: "A", ownerId: "A", adornmentIndex: 2 }).node.options?.entries.some(
      (entry) => entry.kind === "kv" && entry.key === "anchor" && entry.valueRaw === "west"
    )).toBe(true);
    expect(materializeNodeAdornment({ spec: anchorSpec, context, mainNodeNameRaw: "A", ownerId: "A", adornmentIndex: 3 }).node.options?.entries.some(
      (entry) => entry.kind === "kv" && entry.key === "anchor"
    )).toBe(true);

    for (const [angle, expectedAnchor] of [
      ["45", "south west"],
      ["90", "south"],
      ["135", "south east"],
      ["180", "east"],
      ["225", "north east"],
      ["270", "north"],
      ["315", "north west"],
      ["-10", "north west"]
    ] as const) {
      const directionalSpec = extractNodeAdornmentPlan(options(kv("label", `{${angle}:{${angle}}}`))).adornments[0];
      if (!directionalSpec) {
        throw new Error("Expected directional label spec");
      }
      const directional = materializeNodeAdornment({
        spec: directionalSpec,
        context,
        mainNodeNameRaw: "missing",
        ownerId: `missing-${angle}`,
        adornmentIndex: 0
      });
      expect(directional.node.options?.entries.some(
        (entry) => entry.kind === "kv" && entry.key === "anchor" && entry.valueRaw === expectedAnchor
      )).toBe(true);
    }

    const explicitPlacementSpec = extractNodeAdornmentPlan(options(kv("label", "{[anchor=south,at={(1pt,2pt)},name=manual]45:{Manual}}"))).adornments[0];
    if (!explicitPlacementSpec) {
      throw new Error("Expected explicit placement label spec");
    }
    const explicitPlacement = materializeNodeAdornment({
      spec: explicitPlacementSpec,
      context,
      mainNodeNameRaw: "A",
      ownerId: "manual",
      adornmentIndex: 0
    });
    expect(explicitPlacement.node.options?.entries.filter((entry) => entry.kind === "kv" && entry.key === "anchor")).toHaveLength(1);
    expect(explicitPlacement.node.options?.entries.filter((entry) => entry.kind === "kv" && entry.key === "at")).toHaveLength(1);

    writeNamedCoordinate(context, "singularCircle", p(10, 20));
    writeNamedNodeGeometry(context, "singularCircle", {
      ...baseGeometry,
      shape: "circle",
      anchorTransform: worldTransform(0, 0, 0, 0, 0, 0)
    });
    writeNamedCoordinate(context, "flatEllipse", p(10, 20));
    writeNamedNodeGeometry(context, "flatEllipse", {
      ...baseGeometry,
      shape: "ellipse",
      anchorHalfWidth: 0,
      anchorHalfHeight: 0
    });
    materializeNodeAdornment({ spec: numericSpec, context, mainNodeNameRaw: "singularCircle", ownerId: "singularCircle", adornmentIndex: 4 });
    materializeNodeAdornment({ spec: numericSpec, context, mainNodeNameRaw: "flatEllipse", ownerId: "flatEllipse", adornmentIndex: 5 });
  });
});

describe("semantic path intersection directives", () => {
  it("collects named paths and parses rich name-intersections directives", () => {
    const collected = collectPathIntersectionDirectives([
      options(
        flag("draw"),
        kv("stroke", "red"),
        kv("name path", "{ outer }"),
        kv("name path local", "{}"),
        kv("name path global", "outer"),
        kv("name intersections", "{of={outer} and {inner}, by={[near] first, second}, name={hit}, sort by={outer}, total=\\hitCount}")
      )
    ]);

    expect(collected.namedPathNames).toEqual(["outer"]);
    expect(collected.diagnostics).toEqual([]);
    expect(collected.nameIntersections).toMatchObject({
      firstPathName: "outer",
      secondPathName: "inner",
      prefix: "hit",
      byNames: ["first", "second"],
      sortBy: "outer",
      totalMacro: "\\hitCount"
    });

    const nested = collectPathIntersectionDirectives([
      options(
        kv(
          "name intersections",
          String.raw`{ignored, of={left \(kept\)} and {right {kept}}, by={[style={[inner option]}] alpha, [draw] beta}, name={}, sort by={}, total={\totalMacro extra}}`
        )
      )
    ]);
    expect(nested.diagnostics).toEqual([]);
    expect(nested.nameIntersections).toMatchObject({
      firstPathName: "left \\(kept\\)",
      secondPathName: "right {kept}",
      prefix: "intersection",
      byNames: ["alpha", "beta"],
      totalMacro: "\\totalMacro"
    });
  });

  it("reports malformed name-intersections directives", () => {
    expect(collectPathIntersectionDirectives([options(kv("name intersections", "{}"))]).diagnostics).toEqual([
      "invalid-name-intersections"
    ]);
    expect(collectPathIntersectionDirectives([options(kv("name intersections", "{of=a with b}"))]).diagnostics).toEqual([
      "invalid-name-intersections-of",
      "invalid-name-intersections-of"
    ]);
    expect(collectPathIntersectionDirectives([options(kv("name intersections", "{by={}}"))]).diagnostics).toEqual([
      "invalid-name-intersections-of"
    ]);
    const unmatchedBracket = collectPathIntersectionDirectives([
      options(kv("name intersections", "{of=a and b, by={[style first, second}, total=notAMacro}"))
    ]);
    expect(unmatchedBracket.nameIntersections?.byNames).toEqual(["{[style first, second}, total=notAMacro"]);
    expect(unmatchedBracket.nameIntersections?.totalMacro).toBeUndefined();
  });

  it("registers sampled paths and applies intersection directives", () => {
    const context = createSemanticContext(defaultStyle(), identityTransform);
    const nonGeometry = {
      kind: "Text",
      id: "text:ignored",
      runtimeId: "runtime:text:ignored",
      layer: "main",
      sourceRef: sourceRef("text"),
      style: {} as Extract<SceneElement, { kind: "Text" }>["style"],
      styleChain: [],
      position: p(0, 0),
      text: "ignored"
    } satisfies SceneElement;

    expect(registerNamedPath("{}", [scenePath("empty", [{ kind: "M", to: p(0, 0) }])], context)).toBe(false);
    expect(registerNamedPath(" first ", [
      scenePath("first", [
        { kind: "M", to: p(0, 0) },
        { kind: "L", to: p(10, 10) },
        { kind: "M", to: p(0, 10) },
        { kind: "L", to: p(10, 0) },
        { kind: "Z" }
      ]),
      nonGeometry
    ], context)).toBe(true);
    expect(registerNamedPath("second", [
      scenePath("second", [
        { kind: "M", to: p(4, -2) },
        { kind: "L", to: p(4, 12) }
      ])
    ], context)).toBe(true);

    expect(
      applyNameIntersectionsDirective(
        {
          firstPathName: "missing",
          secondPathName: "second",
          prefix: "hit",
          byNames: [],
          span
        },
        context
      )
    ).toEqual(["unknown-named-path:missing"]);
    expect(
      applyNameIntersectionsDirective(
        {
          firstPathName: "first",
          secondPathName: "missing",
          prefix: "hit",
          byNames: [],
          span
        },
        context
      )
    ).toEqual(["unknown-named-path:missing"]);

    expect(
      applyNameIntersectionsDirective(
        {
          firstPathName: "first",
          secondPathName: "second",
          prefix: "hit",
          byNames: ["aliasA", "", "aliasB"],
          sortBy: "first",
          totalMacro: "\\hits",
          span
        },
        context
      )
    ).toEqual([]);
    expect(readNamedCoordinate(context, "hit-1")).toMatchObject({ x: 4 });
    expect(readNamedCoordinate(context, "hit-2")).toMatchObject({ x: 4 });
    expect(readNamedCoordinate(context, "aliasA")).toMatchObject({ x: 4 });
    expect(readNamedCoordinate(context, "aliasB")).toBeUndefined();
    const hitsBinding = readContextMacroBinding(context, "\\hits");
    expect(hitsBinding?.kind).toBe("text");
    if (hitsBinding?.kind !== "text") {
      throw new Error("expected text macro binding");
    }
    expect(hitsBinding.value).toBe("2");

    expect(registerNamedPath("empty", [scenePath("just-move", [{ kind: "M", to: p(0, 0) }])], context)).toBe(true);
    expect(
      applyNameIntersectionsDirective(
        {
          firstPathName: "empty",
          secondPathName: "second",
          prefix: "none",
          byNames: [],
          totalMacro: "\\none",
          span
        },
        context
      )
    ).toEqual([]);
    const noneBinding = readContextMacroBinding(context, "\\none");
    expect(noneBinding?.kind).toBe("text");
    if (noneBinding?.kind !== "text") {
      throw new Error("expected text macro binding");
    }
    expect(noneBinding.value).toBe("0");
  });

  it("samples curved, circular, and elliptical named paths for intersections", () => {
    const context = createSemanticContext(defaultStyle(), identityTransform);
    registerNamedPath("curve", [
      scenePath("curve", [
        { kind: "M", to: p(0, 0) },
        { kind: "C", c1: p(5, 12), c2: p(5, -12), to: p(10, 0) }
      ])
    ], context);
    registerNamedPath("curve-again", [
      scenePath("curve-again", [
        { kind: "M", to: p(0, 0) },
        { kind: "C", c1: p(5, -12), c2: p(5, 12), to: p(10, 0) }
      ])
    ], context);
    registerNamedPath("horizontal", [
      scenePath("horizontal", [
        { kind: "M", to: p(-10, 0) },
        { kind: "L", to: p(10, 0) },
        { kind: "A", rx: 1, ry: 1, xAxisRotation: 0, largeArc: false, sweep: true, to: p(11, 0) }
      ])
    ], context);
    registerNamedPath("rounds", [
      sceneCircle("circle", 0, 0, 4),
      sceneCircle("flat-circle", 0, 0, 0),
      sceneEllipse("ellipse", 0, 0, 6, 3, 30),
      sceneEllipse("flat-ellipse", 0, 0, 0, 3)
    ], context);

    applyNameIntersectionsDirective(
      {
        firstPathName: "curve",
        secondPathName: "curve-again",
        prefix: "curve-hit",
        byNames: [],
        span
      },
      context
    );
    applyNameIntersectionsDirective(
      {
        firstPathName: "rounds",
        secondPathName: "horizontal",
        prefix: "round-hit",
        byNames: [],
        sortBy: "horizontal",
        span
      },
      context
    );

    expect(readNamedCoordinate(context, "curve-hit-1")).toBeDefined();
    expect(readNamedCoordinate(context, "round-hit-1")).toBeDefined();
    expect(readNamedCoordinate(context, "round-hit-2")).toBeDefined();
  });
});

describe("semantic plot settings helpers", () => {
  it("applies less common plot flags and parses resilient plot options", () => {
    const bindings = new Map();
    const settings = applyPlotOptionLists(createDefaultPlotSettings(), [
      options(
        flag("sharp plot"),
        flag("sharp cycle"),
        flag("const plot mark right"),
        flag("const plot mark mid"),
        flag("jump mark left"),
        flag("jump mark right"),
        flag("jump mark mid"),
        flag("xcomb"),
        flag("polar comb"),
        flag("xbar"),
        flag("xbar interval"),
        flag("only marks"),
        unknown("???"),
        kv("domain", ""),
        kv("domain", "0"),
        kv("domain", "{0:{1:2}}"),
        kv("domain", "{0:2}"),
        kv("samples", "bad"),
        kv("samples", "Infinity"),
        kv("samples", "1.2"),
        kv("samples at", "{bad, 1, 2+1}"),
        kv("variable", ""),
        kv("variable", "t"),
        kv("mark", ""),
        kv("tension", "bad"),
        kv("bar width", ""),
        kv("bar shift", "3pt"),
        kv("bar interval width", "bad"),
        kv("bar interval shift", "0.25")
      )
    ], bindings);

    expect(settings.handler).toBe("only-marks");
    expect(settings.domainStart).toBe(0);
    expect(settings.domainEnd).toBe(2);
    expect(settings.samples).toBe(2);
    expect(settings.samplesAt).toEqual([1, 3]);
    expect(settings.variable).toBe("\\t");
    expect(settings.mark).toBeNull();
    expect(settings.barShift).toBeCloseTo(3, 6);
    expect(settings.barIntervalShift).toBeCloseTo(0.25, 6);
  });

  it("resolves and formats edge-case plot samples", () => {
    expect(resolvePlotSampleValues({ ...createDefaultPlotSettings(), samples: 2, domainStart: -1, domainEnd: 1 })).toEqual([
      -1,
      1
    ]);
    expect(resolvePlotSampleValues({
      ...createDefaultPlotSettings(),
      samples: Number.POSITIVE_INFINITY,
      domainStart: 0,
      domainEnd: 1
    })).toEqual([0, 1]);
    expect(resolvePlotSampleValues({
      ...createDefaultPlotSettings(),
      samples: 3,
      domainStart: Number.POSITIVE_INFINITY,
      domainEnd: 1
    })).toEqual([Number.POSITIVE_INFINITY, 1]);
    expect(resolvePlotSampleValues({ ...createDefaultPlotSettings(), samples: 4, domainStart: 2, domainEnd: 2 })).toEqual([
      2,
      2
    ]);

    expect(formatPlotSampleValue(0)).toBe("0");
    expect(formatPlotSampleValue(2)).toBe("2");
    expect(formatPlotSampleValue(1 / 3)).toBe("0.333333333333");
  });
});

describe("semantic graph parse helpers", () => {
  it("skips nested, quoted, escaped, and commented connectors", () => {
    const raw = String.raw`a/"not / split"/{b/c}/(d/e)[f/g]% / comment
 h/i`;
    const split = splitTopLevel(raw, ["/"], 10);
    expect(split.map((part) => part.raw.trim())).toEqual(["a", '"not / split"', "{b/c}", String.raw`(d/e)[f/g]% / comment
 h`, "i"]);
    expect(split[1]?.from).toBeGreaterThan(10);

    expect(readConnector("a -> b", 2, ["->", "--"] as const)).toEqual({ operator: "->", index: 2, next: 4 });
    expect(readConnector("a -> b", 0, ["->"] as const)).toBeNull();
    expect(findNextConnector(String.raw`a "{->}" {->} -> b`, 0, ["->"] as const)).toEqual({ operator: "->", index: 14 });
    expect(findTopLevelChar(String.raw`a:{b:c} "d:e"`, ":")).toBe(1);
    expect(readBalancedSegment("{a {b} \"}\"}", 0, "{", "}")).toMatchObject({ raw: "{a {b} \"}\"}" });
    expect(readBalancedSegment("x{a}", 0, "{", "}")).toBeNull();
  });

  it("merges and trims graph option lists", () => {
    const first = options(kv("draw", "red"));
    const second = options(flag("thick"));
    first.raw = "[draw=red]";
    first.span = { from: 2, to: 12 };
    second.raw = "[thick]";
    second.span = { from: 15, to: 22 };

    expect(mergeOptionLists([])).toBeUndefined();
    expect(mergeOptionLists([first])).toBe(first);
    expect(mergeOptionLists([first, second])).toMatchObject({
      raw: "[draw=red,thick]",
      span: { from: 2, to: 22 }
    });
    expect(optionListIfPresent(undefined)).toEqual([]);
    expect(optionListIfPresent(first)).toEqual([first]);
    expect(optionListFromEntries([], first)).toBeUndefined();
    expect(optionListFromEntries([flag("blue")], first)?.raw).toBe("[blue]");
    expect(stripOptionListBrackets(" [a,b] ")).toBe("a,b");
    expect(stripOptionListBrackets("a,b")).toBe("a,b");
    expect(trimRightIndex("  a  ")).toBe(2);
    expect(trimRightIndex("   ")).toBe(-1);
    expect(skipWhitespace("  % comment\n  node", 0)).toBe(14);
  });
});

describe("semantic size-aware graph placement", () => {
  it("rejects unsupported hint sets and resolves compatible grid placements", () => {
    const context = createSemanticContext(defaultStyle(), identityTransform);
    const statement = {
      kind: "Path",
      id: "graph-statement",
      span,
      command: "draw",
      items: []
    } as PathStatement;

    expect(resolveSizeAwareGraphNodePoints([], statement, context, defaultStyle()).size).toBe(0);
    expect(resolveSizeAwareGraphNodePoints([{ ...graphRuntimeNode(0, 0, 0), placementHint: undefined }], statement, context, defaultStyle()).size).toBe(0);
    expect(resolveSizeAwareGraphNodePoints([graphRuntimeNode(0, 0, 0, { mode: "circular" })], statement, context, defaultStyle()).size).toBe(0);
    expect(resolveSizeAwareGraphNodePoints([graphRuntimeNode(0, 0, 0, { chainSepDistance: null, groupSepDistance: null })], statement, context, defaultStyle()).size).toBe(0);
    expect(
      resolveSizeAwareGraphNodePoints(
        [
          graphRuntimeNode(0, 0, 0),
          graphRuntimeNode(1, 1, 0, { chainShift: { x: 11, y: 0 } })
        ],
        statement,
        context,
        defaultStyle()
      ).size
    ).toBe(0);
    expect(resolveSizeAwareGraphNodePoints([graphRuntimeNode(0, 0, 0, { chainShift: { x: 0, y: 0 } })], statement, context, defaultStyle()).size).toBe(0);

    const resolved = resolveSizeAwareGraphNodePoints(
      [
        graphRuntimeNode(0, 0, 0),
        graphRuntimeNode(1, 2, 0),
        graphRuntimeNode(2, 2, 2)
      ],
      statement,
      context,
      defaultStyle()
    );
    expect(resolved.size).toBe(3);
    expect(resolved.get(0)).toMatchObject({ x: 0, y: 0 });
    expect((resolved.get(1)?.x ?? 0) > 10).toBe(true);
    expect((resolved.get(2)?.y ?? 0) > 10).toBe(true);

    const fallbackStep = resolveSizeAwareGraphNodePoints(
      [
        graphRuntimeNode(0, 0, 0, { groupSepDistance: null }),
        graphRuntimeNode(1, 0, 2, { groupSepDistance: null })
      ],
      statement,
      context,
      defaultStyle()
    );
    expect(fallbackStep.get(1)?.y).toBeCloseTo(20, 6);
  });
});

describe("semantic node positioning helpers", () => {
  it("parses directional keys, anchors, and node distance values", () => {
    expect(parseDirectionalKey(" Above Left ")).toEqual({ direction: "above left", legacyOf: false });
    expect(parseDirectionalKey("below right of")).toEqual({ direction: "below right", legacyOf: true });
    expect(parseDirectionalKey("above of")).toEqual({ direction: "above", legacyOf: true });
    expect(parseDirectionalKey("sideways")).toBeNull();
    expect(currentAnchorForDirection("base left")).toBe("base east");
    expect(targetAnchorForDirection("mid right")).toBe("mid east");
    expect(parseNodeDistance("2pt and 3")).toMatchObject({
      kind: "pair",
      vertical: { kind: "dimension", value: 2 },
      horizontal: { kind: "number", value: 3 }
    });
    expect(parseNodeDistance("")).toBeNull();
    expect(parseNodeDistance("1pt and bad")).toBeNull();
    expect(parseNodeDistance("-1pt and 2pt")).toBeNull();
    expect(parseNodeDistance("-1pt")).toBeNull();
    expect(parseNodeDistance("-1pt", { allowNegative: true })).toMatchObject({ kind: "single" });
    expect(parseNodeDistance("bad")).toBeNull();
  });

  it("resolves relative positioning targets, shifts, on-grid, and diagnostics", () => {
    const context = createSemanticContext(defaultStyle(), worldTransform(2, 0, 0, 3, 0, 0));
    writeNamedCoordinate(context, "A", p(10, 20));
    writeNamedCoordinate(context, "A.north", p(10, 30));
    writeNamedCoordinate(context, "A.south west", p(5, 15));

    const resolved = resolveNodePositioningTarget(
      options(
        flag("on grid"),
        kv("node distance", "1 and 2"),
        kv("xshift", "bad"),
        kv("yshift", "3pt"),
        kv("above left", "of A")
      ),
      context,
      p(0, 0)
    );
    expect(resolved.diagnostics).toContain("invalid-xshift:bad");
    expect(resolved.anchorOverride).toBe("center");
    expect(resolved.relativePlacement).toMatchObject({ direction: "above left", targetNodeName: "A" });
    expect(resolved.anchorPoint.x).toBeLessThan(10);
    expect(resolved.anchorPoint.y).toBeGreaterThan(20);

    const invalid = resolveNodePositioningTarget(options(kv("right", "bad of")), context, p(1, 2));
    expect(invalid.diagnostics).toContain("invalid-positioning-shift:bad of");
    expect(invalid.anchorPoint).toMatchObject({ x: 1, y: 2 });

    expect(resolveNodePositioningTarget(undefined, context, p(4, 5))).toMatchObject({
      anchorPoint: p(4, 5),
      diagnostics: []
    });
    const local = resolveNodePositioningTarget(
      options(flag("centered"), kv("on grid", "false"), kv("node distance", "bad"), kv("yshift", "bad"), kv("right", "2pt")),
      context,
      p(0, 0)
    );
    expect(local.diagnostics).toEqual(["invalid-node-distance:bad", "invalid-yshift:bad"]);
    expect(local.anchorPoint.x).toBeCloseTo(2, 6);
  });
});

describe("semantic evaluate-plot helpers", () => {
  const plotItem = {
    kind: "PlotOperation" as const,
    id: "plot",
    span,
    raw: "plot coordinates {(0,0) (1,1)}",
    mode: "coordinates" as const
  };

  it("extracts and evaluates plot coordinate entries with relative current-point semantics", () => {
    expect(extractPlotCoordinateEntries(String.raw` junk + (1,\(kept\)), ++(2,(3)), trailing `)).toEqual([
      { raw: String.raw`(1,\(kept\))`, relativePrefix: "+" },
      { raw: "(2,(3))", relativePrefix: "++" }
    ]);
    expect(extractPlotCoordinateEntries("{ , }")).toEqual([]);
    expect(extractPlotCoordinateEntries(String.raw`{ junk +(1,0), ++(2,0), (3,0) }`)).toEqual([
      { raw: "(1,0)", relativePrefix: "+" },
      { raw: "(2,0)", relativePrefix: "++" },
      { raw: "(3,0)" }
    ]);

    let current: WorldPoint | null = p(0, 0);
    const diagnostics: string[] = [];
    const points = evaluatePlotCoordinatePoints({
      entries: [
        { raw: "(1,0)", relativePrefix: "+" },
        { raw: "(2,0)", relativePrefix: "++" },
        { raw: "(bad)" }
      ],
      span,
      issuePrefix: "plot",
      currentPoint: current,
      setCurrentPoint: (point) => {
        current = point;
      },
      pushDiagnostic: (code) => diagnostics.push(code),
      evaluateCoordinateRaw: (raw, relativePrefix) => {
        if (raw === "(bad)") {
          return { world: null, diagnostics: ["bad-coordinate"] };
        }
        return {
          world: raw === "(1,0)" ? p(1, 0) : p(3, 0),
          diagnostics: [],
          advancesCurrentPoint: relativePrefix === "++"
        };
      }
    });

    expect(points).toEqual([p(1, 0), p(3, 0)]);
    expect(diagnostics).toEqual(["bad-coordinate"]);
    expect(current).toEqual(p(0, 0));
  });

  it("emits difficult plot path handler variants and marker overlays", () => {
    const handlers = [
      "sharp",
      "sharp-cycle",
      "smooth",
      "smooth-cycle",
      "const-left",
      "const-right",
      "const-mid",
      "jump-left",
      "jump-right",
      "jump-mid",
      "ycomb",
      "xcomb",
      "polar-comb",
      "ybar",
      "xbar",
      "ybar-interval",
      "xbar-interval",
      "only-marks"
    ] as const;

    for (const handler of handlers) {
      const geometryElements: SceneElement[] = [];
      const marked: string[] = [];
      const settings = {
        ...createDefaultPlotSettings(),
        handler,
        mark: handler === "only-marks" ? "*" : handler === "const-left" ? "+" : handler === "jump-right" ? "x" : null,
        barWidth: 4,
        barShift: 1,
        barIntervalWidth: 0.5,
        barIntervalShift: 0.25
      };
      const currentPoints: Array<WorldPoint | null> = [];
      const pathStarts: Array<WorldPoint | null> = [];

      const result = emitPlotPath({
        statementId: `stmt-${handler}`,
        item: plotItem,
        points: [p(1, 2), p(5, 7), p(9, 3)],
        settings,
        connectFrom: handler === "sharp" || handler.endsWith("comb") || handler.endsWith("bar") ? p(0, 0) : null,
        style: defaultStyle(),
        styleChain: [],
        geometryElements,
        markFeature: (feature, status) => marked.push(`${feature}:${status}`),
        activeRoundedCorners: 2,
        setCurrentPoint: (point) => currentPoints.push(point),
        setPathStartPoint: (point) => pathStarts.push(point)
      });

      expect(currentPoints.at(-1)).toEqual(p(9, 3));
      expect(pathStarts.length).toBe(1);
      expect(marked).toContain("svg_path:supported");
      expect(geometryElements.length).toBeGreaterThanOrEqual(settings.mark ? 1 : 1);
      if (handler === "only-marks") {
        expect(result.lastPlacementSegment).toBeNull();
        expect(geometryElements).toHaveLength(1);
      } else {
        expect(result.previousSegmentRoundedCorners).toBe(2);
      }
    }
  });

  it("emits connected and single-point plot handler edge cases", () => {
    for (const handler of ["sharp-cycle", "smooth", "smooth-cycle", "const-left", "const-right", "const-mid", "jump-left", "jump-right", "jump-mid", "ybar-interval", "xbar-interval"] as const) {
      const geometryElements: SceneElement[] = [];
      const settings = {
        ...createDefaultPlotSettings(),
        handler,
        mark: handler.includes("mid") ? "x" : handler.includes("right") ? "*" : "+"
      };
      const result = emitPlotPath({
        statementId: `single-${handler}`,
        item: plotItem,
        points: [p(1, 2)],
        settings,
        connectFrom: p(0, 0),
        style: defaultStyle(),
        styleChain: [],
        geometryElements,
        markFeature: () => undefined,
        activeRoundedCorners: null,
        setCurrentPoint: () => undefined,
        setPathStartPoint: () => undefined
      });

      expect(geometryElements.length).toBeGreaterThan(0);
      expect(result.lastPlacementSegment).not.toBeNull();
    }
  });

  it("handles empty plots, expression sampling, binding restore, and raw coordinate evaluation", () => {
    const geometryElements: SceneElement[] = [];
    let current: WorldPoint | null = p(5, 5);
    let start: WorldPoint | null = p(1, 1);
    const empty = emitPlotPath({
      statementId: "stmt-empty",
      item: plotItem,
      points: [],
      settings: createDefaultPlotSettings(),
      connectFrom: null,
      style: defaultStyle(),
      styleChain: [],
      geometryElements,
      markFeature: () => undefined,
      activeRoundedCorners: null,
      setCurrentPoint: (point) => {
        current = point;
      },
      setPathStartPoint: (point) => {
        start = point;
      }
    });

    expect(empty).toEqual({ lastPlacementSegment: null, previousSegmentRoundedCorners: null });
    expect(geometryElements).toEqual([]);
    expect(current).toEqual(p(5, 5));
    expect(start).toEqual(p(1, 1));

    const context = createSemanticContext(defaultStyle(), identityTransform);
    const settings = { ...createDefaultPlotSettings(), variable: "\\t", samplesAt: [0, 0.5, 1] };
    const bindings = new Map();
    bindings.set("\\t", { kind: "text", value: "old", provenance: [] });
    writeContextMacroBinding(context, "\\t", { kind: "text", value: "context-old", provenance: [] });
    expect(buildPlotExpressionEntries({
      context,
      consumerStatementId: "stmt",
      expressionRaw: "(\\t,\\t)",
      settings,
      macroBindings: bindings
    })).toEqual([{ raw: "(old,old)" }, { raw: "(old,old)" }, { raw: "(old,old)" }]);
    const restoredBinding = readContextMacroBinding(context, "\\t", "stmt");
    expect(restoredBinding?.kind).toBe("text");
    if (restoredBinding?.kind !== "text") {
      throw new Error("expected text macro binding");
    }
    expect(restoredBinding.value).toBe("context-old");

    let rawCurrent: WorldPoint | null = null;
    const evaluated = defaultEvaluateCoordinateRaw(
      "(1,2)",
      p(3, 4),
      (point) => {
        rawCurrent = point;
      },
      context
    );
    expect(rawCurrent).toEqual(p(3, 4));
    expect(evaluated.world?.x).toBeCloseTo(28.4528, 3);
    expect(evaluated.world?.y).toBeCloseTo(56.9055, 3);
  });
});

describe("semantic grid helpers", () => {
  it("extracts scalar, coordinate, polar, explicit-unit, and inherited grid steps", () => {
    const diagnostics: string[] = [];
    const push = (code: string) => diagnostics.push(code);
    const macros = new Map();
    macros.set("\\s", { kind: "text", value: "0.5cm", provenance: [] });

    const transform = worldTransform(2, 0, 0, 3, 0, 0);
    expect(extractGridStepsFromOptionList(options(kv("step", "1")), push, macros, transform)).toMatchObject({
      stepX: 56.905511811,
      stepY: 85.3582677165
    });
    expect(extractGridStepsFromOptionList(options(kv("step", "(1cm, 2)")), push, macros, transform)).toMatchObject({
      stepX: 28.4527559055,
      stepY: 170.716535433
    });
    const polar = extractGridStepsFromOptionList(options(kv("step", "(45:1cm)")), push, macros, identityTransform);
    expect(polar?.stepX).toBeCloseTo(20.119, 3);
    expect(polar?.stepY).toBeCloseTo(20.119, 3);
    expect(extractGridStepsFromOptionList(options(kv("x step", "0.5cm"), kv("y step", "2mm")), push, macros, transform)).toMatchObject({
      stepX: 14.22637795275,
      stepY: 5.6905511811
    });

    const combined = extractGridStepsFromOptionLists([
      options(kv("step", "1cm")),
      options(kv("xstep", "2cm"))
    ], push, macros, identityTransform);
    expect(combined).toMatchObject({ stepX: 56.905511811, stepY: 28.4527559055 });
    expect(extractGridStepsFromOptionList(options(flag("help lines")), push, macros, identityTransform)).toBeNull();
  });

  it("reports invalid grid steps and falls back for singular affine grids", () => {
    const diagnostics: string[] = [];
    const push = (code: string) => diagnostics.push(code);
    const macros = new Map();

    expect(extractGridStepsFromOptionList(options(kv("step", "(1,-2)"), kv("xstep", "bad"), kv("ystep", "-1")), push, macros, identityTransform)).toBeNull();
    expect(diagnostics).toEqual(["invalid-grid-step", "invalid-grid-step", "invalid-grid-step"]);

    const style = defaultStyle();
    const singular = worldTransform(0, 0, 0, 0, 0, 0);
    const paths = makeGridElements("source", "grid", p(0, 0), p(20, 20), -1, -1, style, [], span, singular);
    expect(paths.some((path) => path.id.includes("scene-grid-x:"))).toBe(true);
    expect(paths.some((path) => path.id.includes("scene-grid-y:"))).toBe(true);
  });

  it("anchors grid lines to step multiples rather than the lower corner", () => {
    const style = defaultStyle();
    const paths = makeGridElements("source", "grid", p(-4.3, -4.3), p(32.7528, 4.3), 28.4527559055, 28.4527559055, style, [], span);
    const verticalXs = paths
      .filter((path) => path.id.includes("scene-grid-x:"))
      .map((path) => path.commands[0])
      .filter((command): command is Extract<ScenePathCommand, { kind: "M" }> => command?.kind === "M")
      .map((command) => command.to.x);
    const horizontalYs = paths
      .filter((path) => path.id.includes("scene-grid-y:"))
      .map((path) => path.commands[0])
      .filter((command): command is Extract<ScenePathCommand, { kind: "M" }> => command?.kind === "M")
      .map((command) => command.to.y);

    expect(verticalXs).toHaveLength(2);
    expect(verticalXs[0]).toBeCloseTo(0);
    expect(verticalXs[1]).toBeCloseTo(28.4528, 3);
    expect(horizontalYs).toEqual([0]);
  });

  it("builds transformed affine grid lines with cloned styles", () => {
    const style = { ...defaultStyle(), stroke: "#123456" };
    const transform = worldTransform(1, 1, -1, 1, 10, 20);
    const paths = makeGridElements("source", "grid", p(10, 20), p(10, 76.9055), 28.4527559055, 28.4527559055, style, [], span, transform);

    expect(paths.length).toBeGreaterThan(2);
    expect(paths.every((path) => path.style.stroke === "#123456")).toBe(true);
    expect(paths.some((path) => {
      const [move, line] = path.commands;
      return move?.kind === "M" && line?.kind === "L" && Math.abs(move.to.x - line.to.x) > 1;
    })).toBe(true);
  });
});

describe("semantic turn-coordinate helpers", () => {
  it("ignores coordinates without turn options and reports invalid turn inputs", () => {
    expect(evaluateTurnCoordinate(coordinate({ options: options() }), p(0, 0), identity, null)).toBeNull();
    expect(evaluateTurnCoordinate(coordinate({ form: "cartesian" }), p(0, 0), identity, null)).toMatchObject({
      kind: "invalid",
      diagnostics: ["invalid-turn-coordinate:(0:1)"]
    });
    expect(evaluateTurnCoordinate(coordinate({}), null, identity, null)).toMatchObject({
      kind: "invalid",
      diagnostics: ["turn-coordinate-without-current-point"]
    });
    expect(evaluateTurnCoordinate(coordinate({ x: "bad" }), p(0, 0), identity, null)).toMatchObject({
      kind: "invalid",
      diagnostics: ["invalid-polar-coordinate:(0:1)"]
    });
  });

  it("evaluates turn coordinates relative to the previous segment heading", () => {
    const segment: PlacementSegment = { kind: "line", from: p(0, 0), to: p(0, 10) };
    const result = evaluateTurnCoordinate(coordinate({ x: "90", y: "1cm" }), p(10, 10), identity, segment);

    expect(result?.kind).toBe("transformed");
    expect(result?.world?.x).toBeCloseTo(10 - 28.4528, 3);
    expect(result?.world?.y).toBeCloseTo(10, 3);
  });

  it("infers turn headings from hv, cubic fallback, arc, and degenerate segments", () => {
    const hv: PlacementSegment = { kind: "hv", operator: "-|", from: p(0, 0), bend: p(10, 0), to: p(10, 10) };
    const cubicFallback: PlacementSegment = { kind: "cubic", from: p(0, 0), c1: p(5, 5), c2: p(10, 0), to: p(10, 0) };
    const arc: PlacementSegment = {
      kind: "arc",
      from: p(0, 0),
      to: p(10, 10),
      params: { startAngle: 0, endAngle: 90, rx: 10, ry: 10 }
    };
    const degenerate: PlacementSegment = { kind: "line", from: p(0, 0), to: p(0, 0) };

    expect(evaluateTurnCoordinate(coordinate({}), p(0, 0), identity, hv)?.world?.y).toBeGreaterThan(0);
    expect(evaluateTurnCoordinate(coordinate({}), p(0, 0), identity, cubicFallback)?.world?.x).toBeGreaterThan(0);
    expect(evaluateTurnCoordinate(coordinate({}), p(0, 0), identity, arc)?.world?.x).toBeGreaterThan(0);
    expect(evaluateTurnCoordinate(coordinate({}), p(0, 0), identity, degenerate)?.world?.x).toBeGreaterThan(0);
  });

  it("resolves transformed default grid steps with fallback for degenerate axes", () => {
    expect(resolveDefaultGridStep({ a: 2, b: 0, c: 0, d: 3 }, "x")).toBeCloseTo(56.9055, 3);
    expect(resolveDefaultGridStep({ a: 2, b: 0, c: 0, d: 3 }, "y")).toBeCloseTo(85.3583, 3);
    expect(resolveDefaultGridStep({ a: 0, b: 0, c: 0, d: 0 }, "x")).toBeCloseTo(28.4528, 3);
  });
});
