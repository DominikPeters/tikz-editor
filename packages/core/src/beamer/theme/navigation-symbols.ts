import type {
  BeamerFrameTemplateContext,
  BeamerTemplatePathCommand,
  BeamerTemplatePrimitive,
  BeamerTemplateVectorShape,
} from "./types.js";

const TEX_POINTS_PER_BP = 72.27 / 72;
const TEX_POINTS_PER_CM = 72.27 / 2.54;

// beamerbasenavigationsymbols.tex gives every symbol a 20pt picture.
const PICTURE_WIDTH_PT = 20;
const PICTURE_HEIGHT_PT = 7;
const PICTURE_HEIGHT_ABOVE_BASELINE_PT = 5.5;
// The default template is evaluated while Beamer's page machinery has a 4pt
// Latin Modern Sans 8 font active. Its interword space is .354em.
const TEMPLATE_INTERWORD_SPACE_PT = 4 * 0.354;
const SYMBOL_COUNT = 6;
const TEMPLATE_WIDTH_PT =
  SYMBOL_COUNT * PICTURE_WIDTH_PT +
  (SYMBOL_COUNT - 1) * TEMPLATE_INTERWORD_SPACE_PT;
// beamerouterthemedefault.sty places the strip in the right sidebar followed
// by \hskip0.1cm. The picture depth (1.5pt) and following 2pt skip put its
// PGF origin 3.5pt above the footline paint.
const RIGHT_SIDEBAR_INSET_PT = 0.1 * TEX_POINTS_PER_CM;
const ORIGIN_ABOVE_FOOTLINE_PT = 3.5;

const STRONG = "navigation symbols";
const DIMMED = "navigation symbols dimmed";

type Point = {
  x: number;
  y: number;
};

/**
 * Plan Beamer's default six-symbol navigation strip from the upstream PGF
 * object definitions.
 *
 * The returned shapes are backend-neutral page geometry. The renderer only
 * serializes them; it does not know which paths make a slide, frame, section,
 * document, or history icon.
 */
export function planBeamerNavigationSymbols(
  context: BeamerFrameTemplateContext,
  footlinePaintTopY: number
): BeamerTemplatePrimitive[] {
  const template = context.theme.templates.navigationSymbols;
  if (template.id === "beamer/navigation-symbols/none") {
    return [];
  }
  if (template.id !== "beamer/navigation-symbols/default") {
    throw new Error(
      `No Beamer navigation-symbol template is registered for '${template.id}'.`
    );
  }

  const startX =
    context.page.page.width -
    RIGHT_SIDEBAR_INSET_PT -
    TEMPLATE_WIDTH_PT;
  const originY = footlinePaintTopY - ORIGIN_ABOVE_FOOTLINE_PT;
  const origins = Array.from({ length: SYMBOL_COUNT }, (_, index) => ({
    x: startX +
      index * (PICTURE_WIDTH_PT + TEMPLATE_INTERWORD_SPACE_PT),
    y: originY,
  }));
  const shapes: BeamerTemplateVectorShape[] = [
    ...slideShapes(origins[0]),
    ...frameShapes(origins[1]),
    ...subsectionShapes(origins[2]),
    ...sectionShapes(origins[3]),
    ...documentShapes(origins[4]),
    ...historyShapes(origins[5]),
  ];

  return [{
    kind: "vector",
    id: `${context.frame.id}:navigation-symbols`,
    sourceSpan: context.frame.span,
    bounds: {
      x: startX,
      y: originY - PICTURE_HEIGHT_ABOVE_BASELINE_PT,
      width: TEMPLATE_WIDTH_PT,
      height: PICTURE_HEIGHT_PT,
    },
    templateId: template.id,
    layoutKind: "navigation-symbols",
    shapes,
  }];
}

function slideShapes(origin: Point): BeamerTemplateVectorShape[] {
  return [
    rect(origin, 8.3, 0.8, 3.4, 2.4, STRONG, 0.4),
    filledTriangles(origin),
  ];
}

function frameShapes(origin: Point): BeamerTemplateVectorShape[] {
  return [
    {
      kind: "path",
      commands: [
        ...rectCommands(origin, 7, 0, 3.4, 2.4),
        moveBp(origin, 7.8, 2.4),
        lineBp(origin, 7.8, 3.2),
        lineBp(origin, 11.2, 3.2),
        lineBp(origin, 11.2, 0.8),
        lineBp(origin, 10.4, 0.8),
        moveBp(origin, 8.6, 3.2),
        lineBp(origin, 8.6, 4),
        lineBp(origin, 12, 4),
        lineBp(origin, 12, 1.6),
        lineBp(origin, 11.2, 1.6),
      ],
      strokeColorRole: STRONG,
      strokeWidthPt: 0.4,
      lineJoin: "miter",
    },
    filledTriangles(origin),
  ];
}

function subsectionShapes(origin: Point): BeamerTemplateVectorShape[] {
  return [
    strokeBp(origin, STRONG, 0.6, [
      ["move", 9, 3],
      ["line", 12, 3],
    ]),
    filledTriangles(origin),
    strokeBp(origin, DIMMED, 0.6, [
      ["move", 8, 4],
      ["line", 11, 4],
      ["move", 9, 2],
      ["line", 12, 2],
      ["move", 8, 1],
      ["line", 11, 1],
      ["move", 9, 0],
      ["line", 12, 0],
    ]),
  ];
}

function sectionShapes(origin: Point): BeamerTemplateVectorShape[] {
  return [
    strokeBp(origin, STRONG, 0.6, [
      ["move", 8, 4],
      ["line", 11, 4],
      ["move", 9, 3],
      ["line", 12, 3],
      ["move", 9, 2],
      ["line", 12, 2],
    ]),
    filledTriangles(origin),
    strokeBp(origin, DIMMED, 0.6, [
      ["move", 8, 1],
      ["line", 11, 1],
      ["move", 9, 0],
      ["line", 12, 0],
    ]),
  ];
}

function documentShapes(origin: Point): BeamerTemplateVectorShape[] {
  // The KKT deck has no appendix, so Beamer selects
  // `beamerdocnavstrongsingle`.
  return [strokeBp(origin, STRONG, 0.6, [
    ["move", 8, 4],
    ["line", 11, 4],
    ["move", 9, 3],
    ["line", 12, 3],
    ["move", 9, 2],
    ["line", 12, 2],
    ["move", 8, 1],
    ["line", 11, 1],
    ["move", 9, 0],
    ["line", 12, 0],
  ])];
}

function historyShapes(origin: Point): BeamerTemplateVectorShape[] {
  const searchStart = bpPoint(origin, 10.4, 1.6);
  const searchEnd = bpPoint(origin, 12, 0);
  return [
    {
      kind: "path",
      commands: [
        { kind: "move", ...searchStart },
        { kind: "line", ...searchEnd },
      ],
      strokeColorRole: STRONG,
      strokeWidthPt: 0.6,
    },
    {
      kind: "circle",
      ...circleGeometry(origin, 9.5, 2.5, 1.2),
      strokeColorRole: STRONG,
      strokeWidthPt: 0.4,
    },
    {
      kind: "path",
      commands: [
        moveBp(origin, 4, 0),
        cubicMixed(origin, [5.1, 0], [6, 0.9], [6, 2]),
        cubicBp(origin, [6, 3.1], [5.1, 4], [4, 4]),
        cubicBp(origin, [2.9, 4], [2, 3.1], [2, 2]),
        moveBp(origin, 3.2, 2.6),
        lineBp(origin, 2, 1.6),
        lineBp(origin, 0.8, 2.6),
        moveBp(origin, 16, 0),
        cubicBp(origin, [14.9, 0], [14, 0.9], [14, 2]),
        cubicBp(origin, [14, 3.1], [14.9, 4], [16, 4]),
        cubicBp(origin, [17.1, 4], [18, 3.1], [18, 2]),
        moveBp(origin, 19.2, 2.6),
        lineBp(origin, 18, 1.6),
        lineBp(origin, 16.8, 2.6),
      ],
      strokeColorRole: STRONG,
      strokeWidthPt: 0.4,
      lineCap: "round",
    },
  ];
}

function filledTriangles(origin: Point): BeamerTemplateVectorShape {
  return {
    kind: "path",
    commands: [
      moveBp(origin, 4, 0.5),
      lineBp(origin, 2, 2),
      lineBp(origin, 4, 3.5),
      { kind: "close" },
      moveBp(origin, 16, 0.5),
      lineBp(origin, 18, 2),
      lineBp(origin, 16, 3.5),
      { kind: "close" },
    ],
    fillColorRole: DIMMED,
  };
}

function rect(
  origin: Point,
  x: number,
  y: number,
  width: number,
  height: number,
  strokeColorRole: string,
  strokeWidthPt: number
): BeamerTemplateVectorShape {
  const topLeft = ptPoint(origin, x, y + height);
  return {
    kind: "rect",
    x: topLeft.x,
    y: topLeft.y,
    width,
    height,
    strokeColorRole,
    strokeWidthPt,
  };
}

function rectCommands(
  origin: Point,
  x: number,
  y: number,
  width: number,
  height: number
): BeamerTemplatePathCommand[] {
  const bottomLeft = ptPoint(origin, x, y);
  const topLeft = ptPoint(origin, x, y + height);
  return [
    { kind: "move", ...bottomLeft },
    { kind: "line", x: bottomLeft.x + width, y: bottomLeft.y },
    { kind: "line", x: topLeft.x + width, y: topLeft.y },
    { kind: "line", ...topLeft },
    { kind: "close" },
  ];
}

function strokeBp(
  origin: Point,
  strokeColorRole: string,
  strokeWidthPt: number,
  commands: readonly [
    "move" | "line",
    number,
    number,
  ][]
): BeamerTemplateVectorShape {
  return {
    kind: "path",
    commands: commands.map(([kind, x, y]) =>
      kind === "move" ? moveBp(origin, x, y) : lineBp(origin, x, y)
    ),
    strokeColorRole,
    strokeWidthPt,
  };
}

function moveBp(
  origin: Point,
  x: number,
  y: number
): BeamerTemplatePathCommand {
  return { kind: "move", ...bpPoint(origin, x, y) };
}

function lineBp(
  origin: Point,
  x: number,
  y: number
): BeamerTemplatePathCommand {
  return { kind: "line", ...bpPoint(origin, x, y) };
}

function cubicBp(
  origin: Point,
  control1: readonly [number, number],
  control2: readonly [number, number],
  end: readonly [number, number]
): BeamerTemplatePathCommand {
  const first = bpPoint(origin, ...control1);
  const second = bpPoint(origin, ...control2);
  const point = bpPoint(origin, ...end);
  return {
    kind: "cubic",
    control1X: first.x,
    control1Y: first.y,
    control2X: second.x,
    control2Y: second.y,
    x: point.x,
    y: point.y,
  };
}

function cubicMixed(
  origin: Point,
  control1Pt: readonly [number, number],
  control2Bp: readonly [number, number],
  endBp: readonly [number, number]
): BeamerTemplatePathCommand {
  const first = ptPoint(origin, ...control1Pt);
  const second = bpPoint(origin, ...control2Bp);
  const point = bpPoint(origin, ...endBp);
  return {
    kind: "cubic",
    control1X: first.x,
    control1Y: first.y,
    control2X: second.x,
    control2Y: second.y,
    x: point.x,
    y: point.y,
  };
}

function bpPoint(origin: Point, x: number, y: number): Point {
  return {
    x: origin.x + x * TEX_POINTS_PER_BP,
    y: origin.y - y * TEX_POINTS_PER_BP,
  };
}

function ptPoint(origin: Point, x: number, y: number): Point {
  return {
    x: origin.x + x,
    y: origin.y - y,
  };
}

function circleGeometry(
  origin: Point,
  x: number,
  y: number,
  radius: number
): { cx: number; cy: number; radius: number } {
  const center = ptPoint(origin, x, y);
  return { cx: center.x, cy: center.y, radius };
}
