import { worldBounds, worldPoint, type WorldBounds, type WorldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { SceneElement, ScenePathCommand } from "../types.js";
import { applyMatrix } from "../transform.js";

/** Extra source protocol information, consumed before a path leaves semantic
 * evaluation. It does not change editable/painted circle or ellipse geometry. */
type ProtocolPoint = { point: WorldPoint; deferredY?: number };
const ellipseProtocols = new WeakMap<SceneElement | ScenePathCommand, readonly ProtocolPoint[]>();

/** Preserve the protocol when semantic bookkeeping clones unchanged geometry. */
export function copyPgfPictureProtocol(from: SceneElement, to: SceneElement): void {
  const protocol = ellipseProtocols.get(from);
  if (protocol) ellipseProtocols.set(to, protocol);
}

export function hasPgfPictureBoundsDependency(elements: readonly SceneElement[]): boolean {
  return elements.some(element => {
    const protocols = element.kind === "Path"
      ? element.commands.map(command => ellipseProtocols.get(command)).filter((value): value is readonly ProtocolPoint[] => value !== undefined)
      : [ellipseProtocols.get(element) ?? []];
    const points = protocols.flat();
    const unconditional = points.filter(event => event.deferredY === undefined);
    if (!unconditional.length) return false;
    let minimum = Infinity, maximum = -Infinity;
    for (const event of unconditional) {
      minimum = Math.min(minimum, event.point.y);
      maximum = Math.max(maximum, event.point.y);
    }
    return points.some(event => event.deferredY !== undefined && (event.point.y < minimum || event.point.y > maximum));
  });
}

export function registerEllipseProtocol(
  owner: SceneElement | ScenePathCommand,
  center: WorldPoint,
  axes: readonly [{ x: number; y: number }, { x: number; y: number }],
  half?: -1 | 0 | 1
): void {
  const [xAxis, yAxis] = axes;
  const point = (x: number, y: number): WorldPoint => worldPoint(
    pt(center.x + x * xAxis.x + y * yAxis.x), pt(center.y + x * xAxis.y + y * yAxis.y)
  );
  const k = .55228475;
  const quarters = [
    [[1, k], [k, 1], [0, 1]],
    [[-k, 1], [-1, k], [-1, 0]],
    [[-1, -k], [-k, -1], [0, -1]],
    [[k, -1], [1, -k], [1, 0]],
  ] as const;
  const protocol: ProtocolPoint[] = half === undefined || half === -1 ? [{ point: center }, { point: point(1, 0) }] : [];
  for (const [index, quarter] of quarters.entries()) {
    if (half !== undefined && Math.floor(index / 2) !== half) continue;
    for (const [controlIndex, [x, y]] of quarter.entries()) {
      protocol.push({ point: point(x, y), ...(controlIndex === 0 ? { deferredY: center.y } : {}) });
    }
  }
  ellipseProtocols.set(owner, protocol);
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
const empty = (): Bounds => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
const include = (bounds: Bounds, point: { x: number; y: number }) => {
  bounds.minX = Math.min(bounds.minX, point.x); bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.minY = Math.min(bounds.minY, point.y); bounds.maxY = Math.max(bounds.maxY, point.y);
};

/** PGF's picture protocol is intentionally distinct from tight ink bounds.
 * pgfpathellipse's \pgf@temp ends in a literal dimension assignment to yc.
 * TeX expands the following conditionals before committing that assignment:
 * the first control's y becomes visible only after an x-bound assignment.
 * A typeout/relax inserted before curveto changes this observable behavior.
 * Track picture and path bounds separately, in pgf@protocolsizes order;
 * strokes subsequently enlarge the picture using the completed path bounds. */
export function computePgfPictureBounds(
  elements: readonly SceneElement[],
  initial: WorldBounds | null | undefined,
  geometricBounds: (elements: SceneElement[]) => WorldBounds | undefined
): WorldBounds | undefined {
  const picture: Bounds = initial ? { ...initial } : empty();
  const contribution = empty();
  const addToPicture = (point: { x: number; y: number }) => {
    include(picture, point);
    include(contribution, point);
  };
  for (const element of elements) {
    const path = empty();
    const add = (event: ProtocolPoint) => {
      const point = element.transform ? applyMatrix(element.transform, event.point) : event.point;
      // Protocols are authored in world space before optional final element transforms.
      const oldY = event.deferredY === undefined ? point.y : element.transform
        ? applyMatrix(element.transform, worldPoint(event.point.x, pt(event.deferredY))).y : event.deferredY;
      const pictureXChanges = point.x < picture.minX || point.x > picture.maxX;
      const pathXChanges = point.x < path.minX || point.x > path.maxX;
      addToPicture({ x: point.x, y: pictureXChanges ? point.y : oldY });
      include(path, { x: point.x, y: pictureXChanges || pathXChanges ? point.y : oldY });
    };
    const protocol = ellipseProtocols.get(element);
    if (protocol) {
      for (const event of protocol) add(event);
    } else if (element.kind === "Path" && element.commands.some(command => command.kind === "C" || ellipseProtocols.has(command))) {
      let current: WorldPoint | undefined;
      for (const command of element.commands) {
        const arc = ellipseProtocols.get(command);
        if (arc) for (const event of arc) add(event);
        else if (command.kind === "C") for (const point of [command.c1, command.c2, command.to]) add({ point });
        else if (command.kind === "M" || command.kind === "L") add({ point: command.to });
        else if (command.kind === "A") {
          const bounds = geometricBounds([{ ...element, commands: [...(current ? [{ kind: "M" as const, to: current }] : []), command] }]);
          if (bounds) { addToPicture({ x: bounds.minX, y: bounds.minY }); addToPicture({ x: bounds.maxX, y: bounds.maxY }); }
        }
        if (command.kind !== "Z") current = command.to;
      }
    } else {
      const bounds = geometricBounds([element]);
      if (bounds) { addToPicture({ x: bounds.minX, y: bounds.minY }); addToPicture({ x: bounds.maxX, y: bounds.maxY }); }
      continue;
    }
    if (element.style.stroke && element.style.stroke !== "none" && element.style.lineWidth > 0) {
      const padding = element.style.lineWidth / 2;
      addToPicture({ x: path.minX - padding, y: path.minY - padding });
      addToPicture({ x: path.maxX + padding, y: path.maxY + padding });
    }
  }
  // A statement records only its own contribution, never the inherited box.
  // Otherwise reusing a later statement would retain an earlier shape's old
  // bounds when that shape shrinks during an incremental edit.
  return Number.isFinite(contribution.minX) ? worldBounds(pt(contribution.minX), pt(contribution.minY), pt(contribution.maxX), pt(contribution.maxY)) : undefined;
}
