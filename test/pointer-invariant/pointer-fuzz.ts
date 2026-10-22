import { applyEditAction, type EditAction, type ElementTemplate } from "../../packages/core/src/edit/actions.js";
import { createEditGeometrySession } from "../../packages/core/src/edit/geometry-session.js";
import { PT_PER_CM } from "../../packages/core/src/edit/format.js";
import { collectSourceWorldBounds } from "../../packages/core/src/edit/snapping/geometry.js";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import { applyMatrix } from "../../packages/core/src/semantic/transform.js";
import { applyFrameToWorldPoint, applyWorldToFramePoint, invertFrameToWorldTransform } from "../../packages/core/src/coords/frame.js";
import { frameLocalPoint, pt } from "../../packages/core/src/coords/index.js";
import { spelledCoordinateFrame } from "../../packages/core/src/semantic/site-context.js";
import { rotationSense } from "../../packages/core/src/edit/writer/index.js";
import type { EditHandle } from "../../packages/core/src/semantic/types.js";
import type { WorldPoint } from "../../packages/core/src/coords/points.js";
import { freehandToolPath } from "../../packages/app/src/ui/canvas-panel/freehand-tool.js";
import { pathToolAddPathAction, pathToolAppendAction } from "../../packages/app/src/ui/canvas-panel/path-tool.js";
import { wp } from "../coords-helpers.js";

/**
 * Pointer invariant: an edit that takes a world position must leave the
 * edited geometry at that world position after a fresh render, whatever
 * frames (units, axes, transforms) the picture, scope and path set up.
 * Edits that take no position (reverse, point kind, positioning) must leave
 * the geometry where it was. No edit may move the untouched node `A`.
 */

export type FrameStack = { label: string; picture: string; scope: string; path: string };

export const FRAMES: FrameStack[] = [
  { label: "identity", picture: "", scope: "", path: "" },
  { label: "picture-units", picture: "x=2cm,y=1.6cm", scope: "", path: "" },
  { label: "picture-skew", picture: "x={(2cm,.5cm)},y={(-.3cm,1.6cm)}", scope: "", path: "" },
  { label: "picture-scale", picture: "scale=2", scope: "", path: "" },
  { label: "picture-flip", picture: "yscale=-1", scope: "", path: "" },
  { label: "picture-shift", picture: "shift={(3,2)}", scope: "", path: "" },
  { label: "picture-slant", picture: "xslant=.4,yslant=-.2", scope: "", path: "" },
  { label: "scope-rotate-shift", picture: "", scope: "rotate=30,xshift=1cm", path: "" },
  { label: "scope-units", picture: "", scope: "x=1.5cm,y=.8cm", path: "" },
  { label: "path-xyscale", picture: "", scope: "", path: "xscale=2,yscale=.7" },
  { label: "path-units", picture: "", scope: "", path: "x=2cm" },
  { label: "path-rotate-shift", picture: "", scope: "", path: "rotate=-35,xshift=3mm" },
  { label: "every-path", picture: "every path/.style={rotate=20,xshift=5mm}", scope: "", path: "" },
  { label: "stacked", picture: "x=2cm,y=1.6cm,rotate=20", scope: "xshift=1cm,scale=1.5", path: "rotate=-35,xshift=3mm" }
];

/** One frame per mechanism: axis vectors, picture transform, scope transform, all stacked. */
export const QUICK_FRAME_LABELS = new Set(["identity", "picture-units", "picture-scale", "scope-rotate-shift", "stacked"]);

/** `P` is replaced by the path options. */
export type Body = { label: string; text: string; path?: true };

export const BODIES: Body[] = [
  { label: "cartesian", text: String.raw`\draw[P] (0,0) -- (1,.5) -- (2,0);`, path: true },
  { label: "dimensioned", text: String.raw`\draw[P] (0cm,0cm) -- (1cm,.5cm) -- (20pt,0pt);`, path: true },
  { label: "mixed-units", text: String.raw`\draw[P] (0,0) -- (1cm,.5) -- (2,10pt);`, path: true },
  { label: "polar", text: String.raw`\draw[P] (0:1) -- (60:1.5) -- (120:1);`, path: true },
  { label: "relative", text: String.raw`\draw[P] (0,0) -- ++(1,.5) -- +(0,1);`, path: true },
  { label: "curve", text: String.raw`\draw[P] (0,0) .. controls (.5,1) and (1.5,1) .. (2,0);`, path: true },
  { label: "rectangle", text: String.raw`\draw[P] (0,0) rectangle (1.5,1);`, path: true },
  { label: "circle", text: String.raw`\draw[P] (1,1) circle (.5);`, path: true },
  { label: "node", text: String.raw`\node[draw,P] at (1,1) {N};` },
  { label: "transform-shape-node", text: String.raw`\node[draw,transform shape,P] at (1,1) {N};` },
  { label: "ellipse", text: String.raw`\draw[P] (1,1) ellipse (1 and .5);`, path: true },
  { label: "relative-start", text: String.raw`\draw[P] +(1,2) -- ++(1,0) -- ++(0,1);`, path: true },
  { label: "midpath-options", text: String.raw`\draw[P] (0,0) -- (1,0) [rotate=30] -- (1,1);`, path: true },
  { label: "named-endpoint", text: String.raw`\draw[P] (A.north) -- (1,0);`, path: true },
  { label: "calc", text: String.raw`\draw[P] ($(A)+(1,0)$) -- (0,0);`, path: true },
  { label: "to-bend", text: String.raw`\draw[P] (0,0) to[bend left] (1,1);`, path: true },
  { label: "to-angles", text: String.raw`\draw[P] (0,0) to[out=40,in=160] (2,1);`, path: true },
  { label: "positioning", text: String.raw`\node[draw,right=of A,P] {R};` }
];

/**
 * `partial`: the action skipped some targets, and what it did write passed the
 * check. `error` is the action reporting (or throwing) an error.
 */
export type CaseOutcome =
  | { kind: "ok" }
  | { kind: "partial"; reason: string }
  | { kind: "unsupported"; reason: string }
  | { kind: "error"; message: string }
  | { kind: "fail"; detail: string };

export type CaseResult = { key: string; action: string; outcome: CaseOutcome };

type Snapshot = { source: string; handles: EditHandle[]; parsed: ReturnType<typeof parseTikz>; semantic: ReturnType<typeof evaluateTikzFigure> };

export function evaluate(source: string): Snapshot {
  const parsed = parseTikz(source, { recover: true, includeContextDefinitions: true });
  const semantic = evaluateTikzFigure(parsed.figure, source);
  return { source, handles: semantic.editHandles, parsed, semantic };
}

const ANCHOR_STATEMENT = String.raw`\node (A) at (0,1) {A};`;
const options = (text: string) => text ? `[${text}]` : "";

/** Empty frames are left out of the source, so actions that refuse scoped paths still run. */
export function pictureSource(frame: FrameStack, body: string): { source: string; bodyFrom: number; bodyTo: number } {
  const scoped = frame.scope !== "";
  const head = String.raw`\begin{tikzpicture}${options(frame.picture)}` + "\n" + ANCHOR_STATEMENT + "\n" + (scoped ? String.raw`\begin{scope}${options(frame.scope)}` + "\n" : "");
  const text = body.replace("[P]", options(frame.path)).replace(",P]", frame.path ? `,${frame.path}]` : "]");
  const tail = scoped ? "\n\\end{scope}\n\\end{tikzpicture}" : "\n\\end{tikzpicture}";
  return { source: `${head}${text}${tail}`, bodyFrom: head.length, bodyTo: head.length + text.length };
}

/** Deterministic per-case randomness, so adding cases never reshuffles others. */
export function caseRandom(key: string, seed: number): () => number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDelta(random: () => number): WorldPoint {
  const angle = random() * 2 * Math.PI;
  const length = (.3 + random() * 1.2) * PT_PER_CM;
  return wp(length * Math.cos(angle), length * Math.sin(angle));
}

const add = (p: WorldPoint, d: WorldPoint) => wp(p.x + d.x, p.y + d.y);
const dist = (p: WorldPoint, q: WorldPoint) => Math.hypot(p.x - q.x, p.y - q.y);
const fmt = (p: WorldPoint) => `(${p.x.toFixed(2)},${p.y.toFixed(2)})`;
const rotateAbout = (p: WorldPoint, pivot: WorldPoint, deg: number) => {
  const r = deg * Math.PI / 180, dx = p.x - pivot.x, dy = p.y - pivot.y;
  return wp(pivot.x + dx * Math.cos(r) - dy * Math.sin(r), pivot.y + dx * Math.sin(r) + dy * Math.cos(r));
};

/**
 * Source numbers are written with two decimals; the error that allows in
 * world space depends on how large a unit (and a centimetre) is there.
 */
export function frameTolerance(frame: FrameStack): number {
  const unitless = evaluate(pictureSource(frame, String.raw`\draw[P] (0,0) -- (1,0) -- (0,1);`).source);
  const dimensioned = evaluate(pictureSource(frame, String.raw`\draw[P] (0cm,0cm) -- (1cm,0cm) -- (0cm,1cm);`).source);
  const span = (snapshot: Snapshot) => {
    const points = snapshot.handles.filter(h => h.sourceRef.sourceSpan.from > snapshot.source.indexOf("{A}")).map(h => h.world);
    if (points.length < 3) return 2 * PT_PER_CM;
    return dist(points[0], points[1]) + dist(points[0], points[2]);
  };
  return .0055 * (span(unitless) + span(dimensioned)) + .01;
}

function bodyHandles(snapshot: Snapshot, from: number, to: number): EditHandle[] {
  const ids = new Set(snapshot.handles.filter(h => h.sourceRef.sourceSpan.from >= from && h.sourceRef.sourceSpan.from < to)
    .map(h => h.sourceRef.sourceId));
  // Synthetic to/bend controls have no coordinate span. They still belong
  // to the body's source statement and must be exercised, not filtered out.
  return snapshot.handles.filter(h => ids.has(h.sourceRef.sourceId));
}

function sourceIdsOf(handles: readonly EditHandle[]): Set<string> {
  return new Set(handles.map(h => h.sourceRef.sourceId));
}

function anchorHandles(snapshot: Snapshot): EditHandle[] {
  const from = snapshot.source.indexOf(ANCHOR_STATEMENT);
  return snapshot.handles.filter(h => h.sourceRef.sourceSpan.from >= from && h.sourceRef.sourceSpan.to <= from + ANCHOR_STATEMENT.length);
}

/** World points of a source element's rendered geometry, including copies made by `\foreach`. */
function scenePoints(snapshot: Snapshot, include: (sourceId: string) => boolean): WorldPoint[] {
  return snapshot.semantic.scene.elements.filter(element => include(element.sourceRef.sourceId)).flatMap(element => {
    const local = element.kind === "Path"
      ? element.commands.flatMap(command => command.kind === "M" || command.kind === "L" ? [command.to] : command.kind === "C" ? [command.c1, command.c2, command.to] : [])
      : element.kind === "Circle" || element.kind === "Ellipse" ? [element.center] : [];
    return local.map(point => element.transform ? applyMatrix(element.transform, point) : point);
  });
}

/** Greedy match: every expected point has its own actual point within tolerance. */
function missingPoints(actual: readonly WorldPoint[], expected: readonly WorldPoint[], tolerance: number): WorldPoint[] {
  const pool = [...actual];
  const missing: WorldPoint[] = [];
  for (const point of expected) {
    let best = -1;
    for (let i = 0; i < pool.length; i++) if (dist(pool[i], point) <= tolerance && (best < 0 || dist(pool[i], point) < dist(pool[best], point))) best = i;
    if (best < 0) missing.push(point);
    else pool.splice(best, 1);
  }
  return missing;
}

const DRAG_ACTIONS = new Set<EditAction["kind"]>(["moveHandle", "moveElements", "resizeElement"]);

type Applied =
  | { kind: "success"; next: Snapshot; partialReason?: string }
  | { kind: "unsupported"; reason: string }
  | { kind: "error"; message: string };

function apply(snapshot: Snapshot, action: EditAction): Applied {
  // Drags run against a geometry session in the app; one-shot commands do not.
  const options = DRAG_ACTIONS.has(action.kind)
    ? { geometry: createEditGeometrySession({ source: snapshot.source, parsed: snapshot.parsed, semantic: snapshot.semantic }) }
    : {};
  let result;
  try {
    result = applyEditAction(snapshot.source, snapshot.handles, action, options);
  } catch (error) {
    return { kind: "error", message: `threw ${String(error)}` };
  }
  if (result.kind === "error") return { kind: "error", message: result.message };
  if (result.kind === "unsupported") return { kind: "unsupported", reason: result.reason };
  if (result.newSource === snapshot.source) return { kind: "unsupported", reason: result.kind === "partial" ? result.reason : "no source change" };
  // A partial edit still wrote source; what it wrote is checked like a full one.
  return { kind: "success", next: evaluate(result.newSource), ...(result.kind === "partial" ? { partialReason: result.reason } : {}) };
}

function changedText(before: string, after: string): string {
  let start = 0;
  while (start < before.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return JSON.stringify(after.slice(start, after.length - end).slice(0, 120));
}

export type FuzzContext = { seed: number; tolerance: Map<string, number> };

function tol(context: FuzzContext, frame: FrameStack): number {
  let value = context.tolerance.get(frame.label);
  if (value === undefined) {
    value = frameTolerance(frame);
    context.tolerance.set(frame.label, value);
  }
  return value;
}

type Check = { expected: WorldPoint[]; actual: WorldPoint[]; anchorMayMove?: boolean };

/** Runs one edit and checks where its geometry ended up. */
function runCase(
  context: FuzzContext,
  frame: FrameStack,
  key: string,
  before: Snapshot,
  action: EditAction,
  check: (next: Snapshot) => Check | { kind: "fail"; detail: string }
): CaseResult {
  const name = key.split("|")[0];
  const applied = apply(before, action);
  if (applied.kind !== "success") return { key, action: name, outcome: applied };
  const next = applied.next;
  const result = check(next);
  if ("kind" in result) return { key, action: name, outcome: result };
  const tolerance = tol(context, frame);
  const problems: string[] = [];
  const missing = missingPoints(result.actual, result.expected, tolerance);
  if (missing.length > 0) {
    const nearest = missing.map(point => {
      const closest = result.actual.reduce<WorldPoint | null>((best, p) => !best || dist(p, point) < dist(best, point) ? p : best, null);
      return `${fmt(point)}→${closest ? fmt(closest) : "none"}`;
    });
    problems.push(`expected ${missing.length}/${result.expected.length} at ${nearest.join(" ")}`);
  }
  if (!result.anchorMayMove) {
    const moved = missingPoints(anchorHandles(next).map(h => h.world), anchorHandles(before).map(h => h.world), tolerance);
    if (moved.length > 0) problems.push(`untouched node A moved from ${moved.map(fmt).join(" ")}`);
  }
  if (problems.length === 0) return { key, action: name, outcome: applied.partialReason === undefined ? { kind: "ok" } : { kind: "partial", reason: applied.partialReason } };
  return { key, action: name, outcome: { kind: "fail", detail: `${problems.join("; ")}; wrote ${changedText(before.source, next.source)}` } };
}

type BodyCase = { context: FuzzContext; frame: FrameStack; body: Body; before: Snapshot; handles: EditHandle[]; elementId: string | undefined };

/** Coordinates an element owns: named and calc references follow their node instead. */
const ownHandles = (handles: readonly EditHandle[]) =>
  handles.filter(h => h.coordinateForm !== "named" && h.coordinateForm !== "calc" && h.handleType !== "curve-control");

/** Moving each handle of the body puts that handle under the pointer. */
function moveHandleCases({ context, frame, body, before, handles }: BodyCase): CaseResult[] {
  return handles.flatMap((handle, index): CaseResult[] => {
    if (handle.handleType === "curve-control") return curveHandleCase(context, frame, body, before, handle, index);
    const key = `moveHandle|${frame.label}|${body.label}|${index}:${handle.kind}`;
    const target = add(handle.world, randomDelta(caseRandom(key, context.seed)));
    return [runCase(context, frame, key, before, { kind: "moveHandle", handleId: handle.id, newWorld: target, bypassSnapping: true }, next => {
      const moved = next.handles.find(h => h.id === handle.id);
      return { expected: [target], actual: moved ? [moved.world] : [] };
    })];
  });
}

/** Curve controls encode an angle, not a freely positioned Bezier control. */
function curveHandleCase(context: FuzzContext, frame: FrameStack, body: Body, before: Snapshot,
  handle: Extract<EditHandle, { handleType: "curve-control" }>, index: number): CaseResult[] {
  const key = `moveCurveHandle|${frame.label}|${body.label}|${index}:${handle.kind}`;
  const edit = handle.curveEdit;
  const local = (point: WorldPoint, anchor: WorldPoint) => {
    const { a, b, c, d } = edit.linear;
    const det = a * d - b * c;
    const x = point.x - anchor.x, y = point.y - anchor.y;
    return wp((d * x - c * y) / det, (a * y - b * x) / det);
  };
  const target = add(handle.world, randomDelta(caseRandom(key, context.seed)));
  const angle = (point: WorldPoint): number => {
    if (edit.kind === "to-angle") {
      const anchor = edit.role === "out" ? edit.startWorld : edit.endWorld;
      const v = local(point, anchor);
      return Math.atan2(v.y, v.x) * 180 / Math.PI;
    }
    const end = local(edit.endWorld, edit.startWorld), p = local(point, edit.startWorld);
    const length = Math.hypot(end.x, end.y);
    const height = ((p.x - end.x / 2) * -end.y + (p.y - end.y / 2) * end.x) / length;
    return Math.atan2(2 * height, length) * 180 / Math.PI;
  };
  return [runCase(context, frame, key, before, { kind: "moveHandle", handleId: handle.id, newWorld: target, bypassSnapping: true }, next => {
    const moved = next.handles.find(h => h.id === handle.id);
    if (!moved) return { kind: "fail", detail: "curve handle disappeared" };
    const error = Math.abs(((angle(moved.world) - angle(target) + 540) % 360) - 180);
    if (error > 1.01) return { kind: "fail", detail: `authored angle missed by ${error.toFixed(3)} degrees` };
    return { expected: [edit.startWorld, edit.endWorld], actual: next.handles.filter(h => h.kind === "path-point").map(h => h.world) };
  })];
}

/** Moving the body element translates each of its own coordinates by the delta. */
function moveElementCase({ context, frame, body, before, handles, elementId }: BodyCase): CaseResult[] {
  if (!elementId) return [];
  const key = `moveElement|${frame.label}|${body.label}`;
  const delta = randomDelta(caseRandom(key, context.seed));
  return [runCase(context, frame, key, before, { kind: "moveElements", elementIds: [elementId], delta, bypassSnapping: true }, next => ({
    expected: ownHandles(handles).map(h => add(h.world, delta)),
    actual: next.handles.filter(h => h.sourceRef.sourceId === elementId).map(h => h.world)
  }))];
}

/** Duplicating with an offset puts the copy at the original plus the offset. */
function duplicateCase({ context, frame, body, before, handles, elementId }: BodyCase): CaseResult[] {
  if (!elementId) return [];
  const key = `duplicateElements|${frame.label}|${body.label}`;
  const delta = randomDelta(caseRandom(key, context.seed));
  const known = sourceIdsOf(before.handles);
  return [runCase(context, frame, key, before, { kind: "duplicateElements", elementIds: [elementId], delta }, next => ({
    expected: ownHandles(handles).map(h => add(h.world, delta)),
    actual: next.handles.filter(h => !known.has(h.sourceRef.sourceId)).map(h => h.world)
  }))];
}

const POLYLINES = new Set(["cartesian", "dimensioned", "mixed-units", "polar", "relative", "relative-start"]);
const LINE_PATHS = new Set([...POLYLINES, "named-endpoint", "calc", "midpath-options"]);

/** Inserting a point at a line segment's midpoint adds a point there and keeps the others. */
function insertPathPointCase({ context, frame, body, before, handles, elementId }: BodyCase): CaseResult[] {
  const points = handles.filter(h => h.kind === "path-point");
  if (!LINE_PATHS.has(body.label) || !elementId || points.length < 2) return [];
  const key = `insertPathPoint|${frame.label}|${body.label}`;
  const midpoint = wp((points[0].world.x + points[1].world.x) / 2, (points[0].world.y + points[1].world.y) / 2);
  return [runCase(context, frame, key, before, { kind: "insertPathPoint", elementId, segmentIndex: 0, point: midpoint }, next => ({
    expected: [...points.map(h => h.world), midpoint],
    actual: next.handles.filter(h => h.sourceRef.sourceId === elementId).map(h => h.world)
  }))];
}

/** Reversing a path changes its direction, never where its points are. */
function reversePathCase({ context, frame, body, before, handles, elementId }: BodyCase): CaseResult[] {
  if (!body.path || !elementId) return [];
  const key = `reversePath|${frame.label}|${body.label}`;
  return [runCase(context, frame, key, before, { kind: "reversePath", elementId }, next => ({
    expected: handles.filter(h => h.handleType === "coordinate").map(h => h.world),
    actual: next.handles.filter(h => h.sourceRef.sourceId === elementId).map(h => h.world)
  }))];
}

/** Turning a corner into a smooth point adds control points but keeps every anchor. */
function setPathPointKindCase({ context, frame, body, before, handles, elementId }: BodyCase): CaseResult[] {
  const points = handles.filter(h => h.kind === "path-point");
  if (!POLYLINES.has(body.label) || !elementId || points.length < 3) return [];
  const key = `setPathPointKind|${frame.label}|${body.label}`;
  return [runCase(context, frame, key, before, { kind: "setPathPointKind", elementId, handleId: points[1].id, pointKind: "smooth" }, next => ({
    expected: points.map(h => h.world),
    actual: next.handles.filter(h => h.sourceRef.sourceId === elementId && h.kind === "path-point").map(h => h.world)
  }))];
}

/**
 * Dragging a corner resize handle puts that corner under the pointer. A
 * rectangle keeps its opposite corner; a node keeps its center (its `at`), as
 * the editor resizes nodes symmetrically. A node with its own `rotate` has no
 * axis-aligned box to drag, so it gets no case.
 */
function resizeCases({ context, frame, body, before, handles, elementId }: BodyCase): CaseResult[] {
  if ((body.label === "circle" || body.label === "ellipse") && elementId) {
    const handle = handles.find(h => h.kind === "path-point");
    if (!handle || handle.handleType !== "coordinate") return [];
    const center = handle.world;
    const radiusFrame = spelledCoordinateFrame(handle.siteContext, { unitlessX: true, unitlessY: true });
    return (["right", "top"] as const).map(role => {
      const key = `resizeElement|${frame.label}|${body.label}|${role}`;
      const offset = role === "right" ? wp(radiusFrame.a * 2 * PT_PER_CM, radiusFrame.b * 2 * PT_PER_CM)
        : wp(radiusFrame.c * 2 * PT_PER_CM, radiusFrame.d * 2 * PT_PER_CM);
      const target = add(center, offset);
      return runCase(context, frame, key, before, { kind: "resizeElement", elementId, role, newWorld: target }, next => {
        const shape = next.semantic.scene.elements.find(e => e.sourceRef.sourceId === elementId && (e.kind === "Circle" || e.kind === "Ellipse"));
        if (shape?.kind !== "Circle" && shape?.kind !== "Ellipse") return { kind: "fail", detail: "resized radii disappeared" };
        const nextCenter = next.handles.find(h => h.kind === "path-point" && h.sourceRef.sourceId === elementId)?.world;
        // The handles follow the radius axes, not the world bounding box.
        // Independently project onto the rendered ellipse along the pointer ray.
        const theta = (shape.kind === "Ellipse" ? shape.rotation ?? 0 : 0) * Math.PI / 180;
        const x = Math.cos(theta) * offset.x + Math.sin(theta) * offset.y;
        const y = -Math.sin(theta) * offset.x + Math.cos(theta) * offset.y;
        const rx = shape.kind === "Circle" ? shape.radius : shape.rx;
        const ry = shape.kind === "Circle" ? shape.radius : shape.ry;
        const norm = Math.hypot(x / rx, y / ry);
        const boundary = wp(shape.center.x + offset.x / norm, shape.center.y + offset.y / norm);
        return { expected: [center, target], actual: nextCenter ? [nextCenter, boundary] : [boundary] };
      });
    });
  }
  if ((body.label !== "rectangle" && body.label !== "node") || !elementId || handles.length === 0) return [];
  if (body.label === "node" && /rotate/.test(frame.path)) return [];
  const bounds = collectSourceWorldBounds(before.semantic.scene.elements).get(elementId);
  if (!bounds) return [];
  const corners = [
    { role: "top-right" as const, sign: 1, offset: wp(.4 * PT_PER_CM, .3 * PT_PER_CM) },
    { role: "bottom-left" as const, sign: -1, offset: wp(-.3 * PT_PER_CM, -.2 * PT_PER_CM) }
  ];
  return corners.map(({ role, sign, offset }) => {
    // The first corner keeps its historical key, so the baseline still matches.
    const key = role === "top-right" ? `resizeElement|${frame.label}|${body.label}` : `resizeElement|${frame.label}|${body.label}|${role}`;
    if (body.label === "node") {
      const dragged = sign > 0 ? wp(bounds.maxX, bounds.maxY) : wp(bounds.minX, bounds.minY);
      const center = wp((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);
      const target = add(dragged, offset);
      return runCase(context, frame, key, before, { kind: "resizeElement", elementId, role, newWorld: target }, next => {
        const after = collectSourceWorldBounds(next.semantic.scene.elements).get(elementId);
        if (!after) return { kind: "fail", detail: "node bounds missing after resize" };
        const corner = sign > 0 ? wp(after.maxX, after.maxY) : wp(after.minX, after.minY);
        return { expected: [target, center], actual: [corner, wp((after.minX + after.maxX) / 2, (after.minY + after.maxY) / 2)] };
      });
    }
    const pick = (h: EditHandle) => sign * (h.world.x + h.world.y);
    const dragged = handles.reduce((best, h) => pick(h) > pick(best) ? h : best, handles[0]).world;
    const fixed = handles.reduce((best, h) => pick(h) < pick(best) ? h : best, handles[0]).world;
    const target = add(dragged, offset);
    return runCase(context, frame, key, before, { kind: "resizeElement", elementId, role, newWorld: target }, next => ({
      expected: [target, fixed], actual: next.handles.filter(h => h.sourceRef.sourceId === elementId).map(h => h.world)
    }));
  });
}

/** Rotating about the center turns every point of the element by the angle in world space. */
function rotateCase({ context, frame, body, before, elementId }: BodyCase): CaseResult[] {
  if (!body.path || !elementId || body.label === "named-endpoint" || body.label === "calc") return [];
  const key = `rotateElement|${frame.label}|${body.label}`;
  const angle = 15 + Math.round(caseRandom(key, context.seed)() * 60);
  const points = scenePoints(before, id => id === elementId);
  const bounds = collectSourceWorldBounds(before.semantic.scene.elements).get(elementId);
  if (!bounds || points.length === 0) return [];
  const pivot = wp((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);
  const coordinate = before.handles.find(h => h.sourceRef.sourceId === elementId && h.handleType === "coordinate");
  const site = coordinate?.handleType === "coordinate" ? coordinate.siteContext : undefined;
  const ctm = site?.ctm;
  const inverse = ctm ? invertFrameToWorldTransform(ctm) : null;
  // The API's angle is authored under a nonconformal parent: no single
  // local rotation expresses a rigid world turn through stretch or shear.
  const rotate = (p: WorldPoint) => {
    if (!ctm || !inverse || !site || rotationSense(site) !== null) return rotateAbout(p, pivot, angle);
    const local = applyWorldToFramePoint(inverse, p), center = applyWorldToFramePoint(inverse, pivot);
    const dx = local.x - center.x, dy = local.y - center.y, radians = angle * Math.PI / 180;
    return applyFrameToWorldPoint(ctm, frameLocalPoint(
      pt(center.x + dx * Math.cos(radians) - dy * Math.sin(radians)),
      pt(center.y + dx * Math.sin(radians) + dy * Math.cos(radians))));
  };
  return [runCase(context, frame, key, before, { kind: "rotateElement", elementId, mode: "center-pivot", angleDeg: angle, baselineSource: before.source }, next => ({
    expected: points.map(rotate),
    actual: scenePoints(next, id => id === elementId)
  }))];
}

/** Repeating in a grid puts copy (i, j) at the original plus i·h right and j·v down. */
function repeatCase({ context, frame, body, before, elementId }: BodyCase): CaseResult[] {
  if (!body.path || !elementId || body.label === "named-endpoint" || body.label === "calc" || body.label === "to-bend") return [];
  const key = `repeatElements|${frame.label}|${body.label}`;
  const random = caseRandom(key, context.seed);
  const h = (1 + random()) * PT_PER_CM, v = (1 + random()) * PT_PER_CM;
  const points = scenePoints(before, id => id === elementId);
  const known = new Set(before.semantic.scene.elements.map(e => e.sourceRef.sourceId).filter(id => id !== elementId));
  return [runCase(context, frame, key, before, { kind: "repeatElements", elementIds: [elementId], columns: 2, rows: 2, horizontalStep: h, verticalStep: v }, next => ({
    expected: [0, 1].flatMap(j => [0, 1].flatMap(i => points.map(p => wp(p.x + i * h, p.y - j * v)))),
    actual: scenePoints(next, id => !known.has(id))
  }))];
}

/** Aligning with the untouched node lines both up in world space. */
function alignCases({ context, frame, body, before, elementId }: BodyCase): CaseResult[] {
  const anchorId = anchorHandles(before)[0]?.sourceRef.sourceId;
  if (!elementId || !anchorId) return [];
  return (["left", "top"] as const).map(mode => {
    const key = `alignElements|${frame.label}|${body.label}|${mode}`;
    return runCase(context, frame, key, before, { kind: "alignElements", elementIds: [anchorId, elementId], mode }, next => {
      const bounds = collectSourceWorldBounds(next.semantic.scene.elements);
      const a = bounds.get(anchorId), b = bounds.get(elementId);
      if (!a || !b) return { kind: "fail", detail: "bounds missing after align" };
      const edge = (x: typeof a) => mode === "left" ? wp(x.minX, 0) : wp(0, x.maxY);
      return { expected: [edge(a)], actual: [edge(b)], anchorMayMove: true };
    });
  });
}

/** Writing a node's position relative to `A` must not move where it is drawn, nor back to absolute where it is placed. */
function positioningCases({ context, frame, body, before, handles, elementId }: BodyCase): CaseResult[] {
  if (!elementId) return [];
  const position = handles.find(h => h.kind === "node-position");
  if (!position) return [];
  const anchorId = anchorHandles(before)[0]?.sourceRef.sourceId;
  if (body.label === "positioning") {
    const key = `convertNodePositionToAbsolute|${frame.label}`;
    return [runCase(context, frame, key, before, { kind: "convertNodePositionToAbsolute", nodeId: elementId }, next => ({
      expected: [position.world], actual: next.handles.filter(h => h.sourceRef.sourceId === elementId && h.kind === "node-position").map(h => h.world)
    }))];
  }
  if (body.label === "node" && anchorId) {
    const key = `positionNodeRelativeTo|${frame.label}`;
    // The node's own shifts give way to the positioning, so where it is drawn is what must stay.
    const drawnCenter = (snapshot: Snapshot) => {
      const bounds = collectSourceWorldBounds(snapshot.semantic.scene.elements).get(elementId);
      return bounds ? [wp((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2)] : [];
    };
    return [runCase(context, frame, key, before, { kind: "positionNodeRelativeTo", nodeId: elementId, targetNodeName: "A", targetNodeSourceId: anchorId, bypassSnapping: true }, next => ({
      expected: drawnCenter(before), actual: drawnCenter(next)
    }))];
  }
  return [];
}

/** The path tool appends a segment to the end of a path under the pointer. */
function appendToPathCase({ context, frame, body, before, handles, elementId }: BodyCase): CaseResult[] {
  const points = handles.filter(h => h.kind === "path-point");
  if (!POLYLINES.has(body.label) || !elementId || points.length < 2) return [];
  const key = `appendToPath|${frame.label}|${body.label}`;
  const last = points[points.length - 1].world;
  const target = add(last, randomDelta(caseRandom(key, context.seed)));
  const append = pathToolAppendAction({ startWorld: last, segments: [{ kind: "line", to: target }], appendTarget: { elementId, end: "end" } });
  if (!append) return [{ key, action: "appendToPath", outcome: { kind: "unsupported", reason: "no segments" } }];
  return [runCase(context, frame, key, before, append, next => ({
    expected: [...points.map(h => h.world), target],
    actual: next.handles.filter(h => h.sourceRef.sourceId === elementId).map(h => h.world)
  }))];
}

const TEMPLATES: { label: string; template: (at: WorldPoint, other: WorldPoint) => ElementTemplate; expected: (at: WorldPoint, other: WorldPoint) => WorldPoint[] }[] = [
  { label: "node", template: () => ({ kind: "node", text: "X" }), expected: at => [at] },
  { label: "line", template: (_at, other) => ({ kind: "line", to: other }), expected: (at, other) => [at, other] },
  { label: "rectangle", template: (_at, other) => ({ kind: "rectangle", corner: other }), expected: (at, other) => [at, other] },
  { label: "grid", template: (_at, other) => ({ kind: "grid", corner: other }), expected: (at, other) => [at, other] },
  { label: "bezier", template: (_at, other) => ({ kind: "bezier", to: other }), expected: (at, other) => [at, other] },
  { label: "circle", template: (_at, other) => ({ kind: "circle", edge: other }), expected: at => [at] }
];

/** A picture-level case: new statements are appended to the picture. */
function pictureCase(frame: FrameStack): { before: Snapshot; known: Set<string> } | null {
  if (frame.scope || frame.path) return null;
  const before = evaluate(pictureSource(frame, String.raw`\draw (0,0) -- (1,0);`).source);
  return { before, known: sourceIdsOf(before.handles) };
}

/** Adding an element puts it where the user clicked: the action takes world points, as the app sends them. */
function addElementCases(context: FuzzContext, frame: FrameStack): CaseResult[] {
  const picture = pictureCase(frame);
  if (!picture) return [];
  const { before, known } = picture;
  return TEMPLATES.map(({ label, template, expected }): CaseResult => {
    const key = `addElement|${frame.label}|${label}`;
    const random = caseRandom(key, context.seed);
    const at = add(wp(PT_PER_CM, PT_PER_CM), randomDelta(random));
    const other = add(at, randomDelta(random));
    return runCase(context, frame, key, before, { kind: "addElement", at, template: template(at, other) }, next => ({
      expected: expected(at, other), actual: next.handles.filter(h => !known.has(h.sourceRef.sourceId)).map(h => h.world)
    }));
  });
}

/** The path tool sends its draft as a new path in world points. */
function pathToolCase(context: FuzzContext, frame: FrameStack): CaseResult[] {
  const picture = pictureCase(frame);
  if (!picture) return [];
  const { before, known } = picture;
  const key = `pathTool|${frame.label}`;
  const random = caseRandom(key, context.seed);
  const start = add(wp(PT_PER_CM, PT_PER_CM), randomDelta(random));
  const middle = add(start, randomDelta(random));
  const end = add(middle, randomDelta(random));
  const addPath = pathToolAddPathAction({ startWorld: start, segments: [{ kind: "line", to: middle }, { kind: "line", to: end }] }, { closed: false });
  if (!addPath) return [{ key, action: "pathTool", outcome: { kind: "unsupported", reason: "no segments" } }];
  return [runCase(context, frame, key, before, addPath, next => ({
    expected: [start, middle, end], actual: next.handles.filter(h => !known.has(h.sourceRef.sourceId)).map(h => h.world)
  }))];
}

/** A freehand stroke, sent as a new path in world points, starts and ends where the pointer did. */
function freehandCase(context: FuzzContext, frame: FrameStack): CaseResult[] {
  const picture = pictureCase(frame);
  if (!picture) return [];
  const { before, known } = picture;
  const key = `freehand|${frame.label}`;
  const random = caseRandom(key, context.seed);
  const start = add(wp(PT_PER_CM, PT_PER_CM), randomDelta(random));
  const bend = 1 + random();
  const points = Array.from({ length: 12 }, (_, i) => wp(start.x + i * 4, start.y + bend * 20 * Math.sin(i / 11 * Math.PI)));
  const path = freehandToolPath({ points, minSampleDistanceWorld: 1 }, 1);
  if (!path) return [{ key, action: "freehand", outcome: { kind: "unsupported", reason: "no path" } }];
  return [runCase(context, frame, key, before, { kind: "addPath", start: path.start, segments: path.segments }, next => ({
    expected: [points[0], points[points.length - 1]], actual: next.handles.filter(h => !known.has(h.sourceRef.sourceId)).map(h => h.world)
  }))];
}

/**
 * The inspector shows the picture bounds in world centimetres and writes
 * them back with setFigureBounds; the rendered bounds must be what was typed.
 */
function figureBoundsCase(context: FuzzContext, frame: FrameStack): CaseResult[] {
  const picture = pictureCase(frame);
  if (!picture) return [];
  const key = `setFigureBounds|${frame.label}`;
  const random = caseRandom(key, context.seed);
  const box = { x: -1 - random(), y: -1 - random(), width: 4 + 2 * random(), height: 3 + 2 * random() };
  return [runCase(context, frame, key, picture.before, { kind: "setFigureBounds", mode: "fixed", ...box }, next => {
    const bounds = next.semantic.scene.bounds;
    if (!bounds) return { kind: "fail", detail: "no picture bounds" };
    return {
      expected: [wp(box.x * PT_PER_CM, box.y * PT_PER_CM), wp((box.x + box.width) * PT_PER_CM, (box.y + box.height) * PT_PER_CM)],
      actual: [wp(bounds.minX, bounds.minY), wp(bounds.maxX, bounds.maxY)]
    };
  })];
}

/** A singular inverse must refuse writes rather than emit fabricated coordinates. */
function singularCases(context: FuzzContext, frame: FrameStack): CaseResult[] {
  const collapsed = { ...frame, picture: `${frame.picture}${frame.picture ? "," : ""}scale=0` };
  const before = evaluate(pictureSource(collapsed, String.raw`\draw[P] (0,0) -- (1,1);`).source);
  const handle = before.handles.find(h => h.kind === "path-point");
  const actions: EditAction[] = [{ kind: "addElement", at: wp(100, 20), template: { kind: "line", to: wp(120, 40) } }];
  if (handle) actions.push({ kind: "moveHandle", handleId: handle.id, newWorld: wp(100, 20), bypassSnapping: true });
  return actions.map(action => runCase(context, collapsed, `singular|${frame.label}|${action.kind}`, before, action,
    () => ({ kind: "fail", detail: "a singular frame accepted a coordinate write" })));
}

/** Appending reads the state after the last tikzset, not the picture's initial axes. */
function changedInsertionCases(context: FuzzContext, frame: FrameStack): CaseResult[] {
  const source = pictureSource(frame, String.raw`\draw[P] (0,0) -- (1,0);`).source
    .replace("\\end{tikzpicture}", "\\tikzset{x=2cm,y=.7cm}\n\\end{tikzpicture}");
  const before = evaluate(source), known = sourceIdsOf(before.handles);
  const key = `insertAfterTikzset|${frame.label}`;
  const target = add(wp(50, 30), randomDelta(caseRandom(key, context.seed)));
  return [runCase(context, frame, key, before, { kind: "addElement", at: target, template: { kind: "node", text: "new" } }, next => ({
    expected: [target], actual: next.handles.filter(h => !known.has(h.sourceRef.sourceId)).map(h => h.world)
  }))];
}

/** Raw pasted text reads in the destination scope; its requested offset is world-space. */
function crossScopePasteCase(context: FuzzContext, frame: FrameStack): CaseResult[] {
  const source = pictureSource(frame, String.raw`\draw[P] (0,0) -- (1,0);
\begin{scope}[x=.8cm,y=2cm,rotate=20]
\draw (3,2) -- (4,2);
\end{scope}`).source;
  const before = evaluate(source), known = sourceIdsOf(before.handles);
  const anchor = before.handles.find(h => h.sourceText === "(3,2)");
  if (!anchor) throw new Error("missing destination scope anchor");
  const paste = { kind: "pasteStatements" as const, anchorElementId: anchor.sourceRef.sourceId,
    snippets: [String.raw`\draw (0,0) -- ++(1,.5);`] };
  // Zero offset leaves the authored text untouched, an oracle for the gap's geometry.
  const unshifted = apply(before, { ...paste, delta: wp(0, 0) });
  if (unshifted.kind !== "success") throw new Error("could not insert raw paste fixture");
  const key = `pasteAcrossScopes|${frame.label}`;
  const delta = randomDelta(caseRandom(key, context.seed));
  const expected = unshifted.next.handles.filter(h => !known.has(h.sourceRef.sourceId)).map(h => add(h.world, delta));
  return [runCase(context, frame, key, before, { ...paste, delta }, next => ({
    expected: [...expected, ...before.handles.map(h => h.world)], actual: next.handles.map(h => h.world)
  }))];
}

const BODY_CASES = [
  moveHandleCases, moveElementCase, duplicateCase, insertPathPointCase, reversePathCase, setPathPointKindCase,
  resizeCases, rotateCase, repeatCase, alignCases, positioningCases, appendToPathCase
];
const PICTURE_CASES = [addElementCases, pathToolCase, freehandCase, figureBoundsCase, singularCases, changedInsertionCases, crossScopePasteCase];

export function runPointerFuzz(seed: number, frames: readonly FrameStack[] = FRAMES, bodies: readonly Body[] = BODIES): CaseResult[] {
  const context: FuzzContext = { seed, tolerance: new Map() };
  const results: CaseResult[] = [];
  for (const frame of frames) {
    for (const body of bodies) {
      const { source, bodyFrom, bodyTo } = pictureSource(frame, body.text);
      const before = evaluate(source);
      const handles = bodyHandles(before, bodyFrom, bodyTo);
      const [elementId] = sourceIdsOf(handles);
      for (const cases of BODY_CASES) results.push(...cases({ context, frame, body, before, handles, elementId }));
    }
    for (const cases of PICTURE_CASES) results.push(...cases(context, frame));
  }
  return results;
}
