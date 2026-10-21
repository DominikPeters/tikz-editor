import { arrowLocalPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { ArrowLocalPoint } from "../../coords/points.js";
import { computeKiteShapeParameters, computeLatexShapeParameters, computeStealthShapeParameters, computeTeeBarbShapeParameters } from "./metrics.js";
import type { ArrowLocalPathCommand, ArrowTipMetrics, NormalizedArrowTip } from "./types.js";

function alPoint(x: number, y: number): ArrowLocalPoint {
  return arrowLocalPoint(pt(x), pt(y));
}

export function buildLocalTipPaths(tip: NormalizedArrowTip, metrics: ArrowTipMetrics): ArrowLocalPathCommand[][] {
  const rawPaths = buildRawTipPaths(tip);
  const mirrored = tip.reversed ? rawPaths.map((path) => transformPath(path, (x, y) => alPoint(-x, y))) : rawPaths;
  const lineEndShift = -metrics.lineEnd;
  return mirrored.map((path) => transformPath(path, (x, y) => alPoint(x + lineEndShift, y)));
}

function buildRawTipPaths(tip: NormalizedArrowTip): ArrowLocalPathCommand[][] {
  const halfWidth = tip.width / 2;

  if (tip.kind === "cm-rightarrow") {
    const c1x = tip.length * 0.18269;
    const c2x = tip.length * 0.58981;
    const c1y = halfWidth * 0.4;
    const c2y = halfWidth * 0.116666;
    return [
      [
        moveTo(0, halfWidth),
        cubicTo(c1x, c1y, c2x, c2y, tip.length, 0),
        cubicTo(c2x, -c2y, c1x, -c1y, 0, -halfWidth)
      ]
    ];
  }

  if (tip.kind === "hooks") {
    const rx = tip.length - tip.lineWidth / 2;
    const ry = (tip.width - tip.lineWidth) / 4;
    const arc = (tip.arc ?? 180) - 90;
    const upper = ellipseArc(rx, ry, 0, ry, arc, -90);
    const lower = ellipseArc(rx, ry, 0, -ry, 90, -arc);
    return [[...upper, ...lower.slice(1)]];
  }

  if (tip.kind === "straight-barb") {
    return [[moveTo(0, halfWidth), lineTo(tip.length, 0), lineTo(0, -halfWidth)]];
  }

  if (tip.kind === "arc-barb") {
    return [ellipseArc(tip.length - tip.lineWidth / 2, halfWidth - tip.lineWidth / 2, 0, 0, (tip.arc ?? 180) / 2, -(tip.arc ?? 180) / 2)];
  }

  if (tip.kind === "tee-barb" || tip.kind === "bar") {
    const { front, back } = computeTeeBarbShapeParameters(tip);
    const halfStroke = tip.lineWidth / 2;
    const top = halfWidth - halfStroke;
    if (Math.abs(front - back - tip.lineWidth) < 1e-6) {
      return [[moveTo(0, halfWidth), lineTo(0, -halfWidth)]];
    }
    if (front === halfStroke) {
      return [[moveTo(back, top), lineTo(0, top), lineTo(0, -top), lineTo(back, -top)]];
    }
    return [[moveTo(back, top), lineTo(front, top), moveTo(0, top), lineTo(0, -top), moveTo(back, -top), lineTo(front, -top)]];
  }

  if (tip.kind === "implies") {
    const midX = tip.length * 0.62;
    const innerTailX = tip.length * 0.35;
    const innerMidX = tip.length * 0.727;
    const innerPointX = tip.length * 0.97;
    return [
      [moveTo(0, halfWidth), lineTo(midX, halfWidth), lineTo(tip.length, 0), lineTo(midX, -halfWidth), lineTo(0, -halfWidth), close()],
      [
        moveTo(innerTailX, halfWidth * 0.7),
        lineTo(innerMidX, halfWidth * 0.7),
        lineTo(innerPointX, 0),
        lineTo(innerMidX, -halfWidth * 0.7),
        lineTo(innerTailX, -halfWidth * 0.7),
        close()
      ]
    ];
  }

  if (tip.kind === "stealth" || tip.kind === "triangle") {
    const params = computeStealthShapeParameters(tip.kind === "triangle" ? { ...tip, inset: 0 } : tip);
    const tipX = params.innerLength + params.backMiter;
    const topX = params.backMiter;
    const insetX = params.inset + params.insetMiter;
    const innerHalfWidth = params.innerHalfWidth;
    return [[moveTo(tipX, 0), lineTo(topX, innerHalfWidth), lineTo(insetX, 0), lineTo(topX, -innerHalfWidth), close()]];
  }

  if (tip.kind === "latex") {
    const params = computeLatexShapeParameters(tip);
    const innerLength = params.innerLength;
    const halfBackWidth = params.halfBackWidth;
    return [
      [
        moveTo(innerLength, 0),
        cubicTo(0.877192 * innerLength, 0.077922 * halfBackWidth, 0.337381 * innerLength, 0.51948 * halfBackWidth, 0, halfBackWidth),
        lineTo(0, -halfBackWidth),
        cubicTo(0.337381 * innerLength, -0.51948 * halfBackWidth, 0.877192 * innerLength, -0.077922 * halfBackWidth, innerLength, 0),
        close()
      ]
    ];
  }

  if (tip.kind === "kite") {
    const params = computeKiteShapeParameters(tip);
    return [[moveTo(params.front, 0), lineTo(params.topX, params.topY), lineTo(params.back, 0), lineTo(params.topX, -params.topY), close()]];
  }

  if (tip.kind === "square") {
    const inset = tip.lineWidth / 2;
    return [[moveTo(tip.length - inset, halfWidth - inset), lineTo(inset, halfWidth - inset), lineTo(inset, -halfWidth + inset), lineTo(tip.length - inset, -halfWidth + inset), close()]];
  }

  if (tip.kind === "circle") {
    return [[...ellipseArc(tip.length / 2 - tip.lineWidth / 2, halfWidth - tip.lineWidth / 2, tip.length / 2, 0, 0, 360), close()]];
  }

  if (tip.kind === "round-cap" || tip.kind === "butt-cap" || tip.kind === "triangle-cap") {
    const shaftHalfWidth = tip.contextLineWidth / 2;
    const back = -0.75 * tip.contextLineWidth;
    // Reversed Round/Triangle Cap drawing adds a shaft-width rectangle,
    // and reverses the curved/pointed front inside that rectangle.
    if (tip.reversed && tip.kind !== "butt-cap") {
      const front = tip.kind === "round-cap"
        ? ellipseArc(tip.length, shaftHalfWidth, 0, 0, 90, -90).slice(1)
        : [lineTo(tip.length, 0), lineTo(0, -shaftHalfWidth), lineTo(tip.length, -shaftHalfWidth)];
      return [[moveTo(tip.length - back, shaftHalfWidth), lineTo(tip.length, shaftHalfWidth),
        lineTo(0, shaftHalfWidth), ...front, lineTo(tip.length - back, -shaftHalfWidth), close()]];
    }
    const frontPaths = tip.kind === "round-cap"
      ? [moveTo(back, shaftHalfWidth), lineTo(0, shaftHalfWidth), ...ellipseArc(tip.length, shaftHalfWidth, 0, 0, 90, -90).slice(1), lineTo(back, -shaftHalfWidth), close()]
      : tip.kind === "triangle-cap"
        ? [moveTo(back, shaftHalfWidth), lineTo(0, shaftHalfWidth), lineTo(tip.length, 0), lineTo(0, -shaftHalfWidth), lineTo(back, -shaftHalfWidth), close()]
        : [moveTo(back, shaftHalfWidth), lineTo(0, shaftHalfWidth), lineTo(tip.length, shaftHalfWidth), lineTo(tip.length, -shaftHalfWidth), lineTo(back, -shaftHalfWidth), close()];
    return [frontPaths];
  }

  if (tip.kind === "rays") {
    const rayCount = Math.max(1, Math.round(tip.rayCount ?? 4));
    const rays: ArrowLocalPathCommand[][] = [];
    for (let i = 0; i < rayCount; i += 1) {
      const angle = -Math.PI / 2 + ((i + 0.5) * Math.PI) / rayCount;
      const x = tip.length * Math.cos(angle);
      const y = halfWidth * Math.sin(angle);
      rays.push([moveTo(0, 0), lineTo(x, y)]);
    }
    return rays;
  }

  const notchX = tip.length * 0.24;
  return [[moveTo(0, halfWidth), lineTo(tip.length, 0), lineTo(0, -halfWidth), lineTo(notchX, 0), close()]];
}

function transformPath(path: ArrowLocalPathCommand[], map: (x: number, y: number) => ArrowLocalPoint): ArrowLocalPathCommand[] {
  return path.map((command) => {
    if (command.kind === "Z") {
      return { kind: "Z" };
    }
    if (command.kind === "M" || command.kind === "L") {
      const point = map(command.to.x, command.to.y);
      return { kind: command.kind, to: point };
    }
    if (command.kind === "C") {
      const c1 = map(command.c1.x, command.c1.y);
      const c2 = map(command.c2.x, command.c2.y);
      const to = map(command.to.x, command.to.y);
      return { kind: "C", c1, c2, to };
    }
    const to = map(command.to.x, command.to.y);
    return {
      kind: "A",
      rx: command.rx,
      ry: command.ry,
      xAxisRotation: command.xAxisRotation,
      largeArc: command.largeArc,
      sweep: command.sweep,
      to
    };
  });
}

function ellipseArc(rx: number, ry: number, cx: number, cy: number, startDegrees: number, endDegrees: number): ArrowLocalPathCommand[] {
  const start = startDegrees * Math.PI / 180;
  const end = endDegrees * Math.PI / 180;
  const count = Math.max(1, Math.ceil(Math.abs(end - start) / (Math.PI / 2)));
  const delta = (end - start) / count;
  const result: ArrowLocalPathCommand[] = [moveTo(cx + rx * Math.cos(start), cy + ry * Math.sin(start))];
  for (let index = 0; index < count; index += 1) {
    const a = start + index * delta;
    const b = a + delta;
    const k = 4 / 3 * Math.tan(delta / 4);
    result.push(cubicTo(
      cx + rx * (Math.cos(a) - k * Math.sin(a)), cy + ry * (Math.sin(a) + k * Math.cos(a)),
      cx + rx * (Math.cos(b) + k * Math.sin(b)), cy + ry * (Math.sin(b) - k * Math.cos(b)),
      cx + rx * Math.cos(b), cy + ry * Math.sin(b)
    ));
  }
  return result;
}

function moveTo(x: number, y: number): ArrowLocalPathCommand {
  return { kind: "M", to: arrowLocalPoint(pt(x), pt(y)) };
}

function lineTo(x: number, y: number): ArrowLocalPathCommand {
  return { kind: "L", to: arrowLocalPoint(pt(x), pt(y)) };
}

function cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): ArrowLocalPathCommand {
  return {
    kind: "C",
    c1: arrowLocalPoint(pt(c1x), pt(c1y)),
    c2: arrowLocalPoint(pt(c2x), pt(c2y)),
    to: arrowLocalPoint(pt(x), pt(y))
  };
}

function close(): ArrowLocalPathCommand {
  return { kind: "Z" };
}
