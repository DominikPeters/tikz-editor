import type { Cm, Pt, Px } from "./scalars.js";

declare const coordBrand: unique symbol;

type Point2D<Unit, Space extends string> = Readonly<{
  x: Unit;
  y: Unit;
  [coordBrand]: `point:${Space}`;
}>;

type Vector2D<Unit, Space extends string> = Readonly<{
  x: Unit;
  y: Unit;
  [coordBrand]: `vector:${Space}`;
}>;

type Bounds2D<Unit, Space extends string> = Readonly<{
  minX: Unit;
  minY: Unit;
  maxX: Unit;
  maxY: Unit;
  [coordBrand]: `bounds:${Space}`;
}>;

type Rect2D<Unit, Space extends string> = Readonly<{
  x: Unit;
  y: Unit;
  width: Unit;
  height: Unit;
  [coordBrand]: `rect:${Space}`;
}>;

export type SourceCmPoint = Point2D<Cm, "source-cm">;
export type FrameLocalPoint = Point2D<Pt, "frame-local">;
export type WorldPoint = Point2D<Pt, "world">;
export type AnchorLocalPoint = Point2D<Pt, "anchor-local">;
export type ArrowLocalPoint = Point2D<Pt, "arrow-local">;
export type SvgPoint = Point2D<Pt, "svg">;
export type ViewportPoint = Point2D<Px, "viewport">;
export type ClientPoint = Point2D<Px, "client">;
export type TextRectLocalPoint = Point2D<Px, "text-rect-local">;
export type TextareaLocalPoint = Point2D<Px, "textarea-local">;

export type FrameLocalVector = Vector2D<Pt, "frame-local">;
export type WorldVector = Vector2D<Pt, "world">;
export type SvgVector = Vector2D<Pt, "svg">;
export type ViewportVector = Vector2D<Px, "viewport">;
export type ClientVector = Vector2D<Px, "client">;

export type WorldBounds = Bounds2D<Pt, "world">;
export type SvgBounds = Bounds2D<Pt, "svg">;
export type ViewportBounds = Bounds2D<Px, "viewport">;
export type ClientBounds = Bounds2D<Px, "client">;
// Rectangles are branded as a whole because ordinary width/height arithmetic
// intentionally produces numbers. Construction still makes the coordinate
// space explicit and prevents local/document/viewport rectangles from mixing.
export type FrameLocalRect = Rect2D<number, "frame-local">;
export type SvgRect = Rect2D<number, "svg">;
export type ViewportRect = Rect2D<number, "viewport">;
export type ClientRect = Rect2D<number, "client">;

type PointBrand =
  | SourceCmPoint[typeof coordBrand]
  | FrameLocalPoint[typeof coordBrand]
  | WorldPoint[typeof coordBrand]
  | AnchorLocalPoint[typeof coordBrand]
  | ArrowLocalPoint[typeof coordBrand]
  | SvgPoint[typeof coordBrand]
  | ViewportPoint[typeof coordBrand]
  | ClientPoint[typeof coordBrand]
  | TextRectLocalPoint[typeof coordBrand]
  | TextareaLocalPoint[typeof coordBrand];

type VectorBrand =
  | FrameLocalVector[typeof coordBrand]
  | WorldVector[typeof coordBrand]
  | SvgVector[typeof coordBrand]
  | ViewportVector[typeof coordBrand]
  | ClientVector[typeof coordBrand];

type BoundsBrand =
  | WorldBounds[typeof coordBrand]
  | SvgBounds[typeof coordBrand]
  | ViewportBounds[typeof coordBrand]
  | ClientBounds[typeof coordBrand];

type RectBrand =
  | FrameLocalRect[typeof coordBrand]
  | SvgRect[typeof coordBrand]
  | ViewportRect[typeof coordBrand]
  | ClientRect[typeof coordBrand];

function createPoint<Unit, Brand extends PointBrand>(x: Unit, y: Unit, brand: Brand): Point2D<Unit, Brand extends `point:${infer Space}` ? Space : never> {
  void brand;
  return { x, y } as unknown as Point2D<Unit, Brand extends `point:${infer Space}` ? Space : never>;
}

function createVector<Unit, Brand extends VectorBrand>(
  x: Unit,
  y: Unit,
  brand: Brand
): Vector2D<Unit, Brand extends `vector:${infer Space}` ? Space : never> {
  void brand;
  return { x, y } as unknown as Vector2D<Unit, Brand extends `vector:${infer Space}` ? Space : never>;
}

function createBounds<Unit, Brand extends BoundsBrand>(
  minX: Unit,
  minY: Unit,
  maxX: Unit,
  maxY: Unit,
  brand: Brand
): Bounds2D<Unit, Brand extends `bounds:${infer Space}` ? Space : never> {
  void brand;
  return { minX, minY, maxX, maxY } as unknown as Bounds2D<
    Unit,
    Brand extends `bounds:${infer Space}` ? Space : never
  >;
}

function createRect<Unit, Brand extends RectBrand>(
  x: Unit,
  y: Unit,
  width: Unit,
  height: Unit,
  brand: Brand
): Rect2D<Unit, Brand extends `rect:${infer Space}` ? Space : never> {
  void brand;
  return { x, y, width, height } as unknown as Rect2D<
    Unit,
    Brand extends `rect:${infer Space}` ? Space : never
  >;
}

export function sourceCmPoint(x: Cm, y: Cm): SourceCmPoint {
  return createPoint(x, y, "point:source-cm");
}

export function frameLocalPoint(x: Pt, y: Pt): FrameLocalPoint {
  return createPoint(x, y, "point:frame-local");
}

export function worldPoint(x: Pt, y: Pt): WorldPoint {
  return createPoint(x, y, "point:world");
}

export function anchorLocalPoint(x: Pt, y: Pt): AnchorLocalPoint {
  return createPoint(x, y, "point:anchor-local");
}

export function arrowLocalPoint(x: Pt, y: Pt): ArrowLocalPoint {
  return createPoint(x, y, "point:arrow-local");
}

export function svgPoint(x: Pt, y: Pt): SvgPoint {
  return createPoint(x, y, "point:svg");
}

export function viewportPoint(x: Px, y: Px): ViewportPoint {
  return createPoint(x, y, "point:viewport");
}

export function clientPoint(x: Px, y: Px): ClientPoint {
  return createPoint(x, y, "point:client");
}

export function textRectLocalPoint(x: Px, y: Px): TextRectLocalPoint {
  return createPoint(x, y, "point:text-rect-local");
}

export function textareaLocalPoint(x: Px, y: Px): TextareaLocalPoint {
  return createPoint(x, y, "point:textarea-local");
}

export function frameLocalVector(x: Pt, y: Pt): FrameLocalVector {
  return createVector(x, y, "vector:frame-local");
}

export function worldVector(x: Pt, y: Pt): WorldVector {
  return createVector(x, y, "vector:world");
}

export function svgVector(x: Pt, y: Pt): SvgVector {
  return createVector(x, y, "vector:svg");
}

export function viewportVector(x: Px, y: Px): ViewportVector {
  return createVector(x, y, "vector:viewport");
}

export function clientVector(x: Px, y: Px): ClientVector {
  return createVector(x, y, "vector:client");
}

export function worldBounds(minX: Pt, minY: Pt, maxX: Pt, maxY: Pt): WorldBounds {
  return createBounds(minX, minY, maxX, maxY, "bounds:world");
}

export function svgBounds(minX: Pt, minY: Pt, maxX: Pt, maxY: Pt): SvgBounds {
  return createBounds(minX, minY, maxX, maxY, "bounds:svg");
}

export function viewportBounds(minX: Px, minY: Px, maxX: Px, maxY: Px): ViewportBounds {
  return createBounds(minX, minY, maxX, maxY, "bounds:viewport");
}

export function clientBounds(minX: Px, minY: Px, maxX: Px, maxY: Px): ClientBounds {
  return createBounds(minX, minY, maxX, maxY, "bounds:client");
}

export function frameLocalRect(x: number, y: number, width: number, height: number): FrameLocalRect {
  return createRect(x, y, width, height, "rect:frame-local");
}

export function svgRect(x: number, y: number, width: number, height: number): SvgRect {
  return createRect(x, y, width, height, "rect:svg");
}

export function viewportRect(x: number, y: number, width: number, height: number): ViewportRect {
  return createRect(x, y, width, height, "rect:viewport");
}

export function clientRect(x: number, y: number, width: number, height: number): ClientRect {
  return createRect(x, y, width, height, "rect:client");
}
