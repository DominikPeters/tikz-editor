import {
  frameLocalPoint,
  pt,
  svgBounds,
  svgPoint,
  worldBounds,
  worldPoint,
  worldVector
} from "../packages/core/src/coords/index.js";

export const wp = (x: number, y: number) => worldPoint(pt(x), pt(y));
export const wv = (x: number, y: number) => worldVector(pt(x), pt(y));
export const wb = (minX: number, minY: number, maxX: number, maxY: number) =>
  worldBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));

export const sp = (x: number, y: number) => svgPoint(pt(x), pt(y));
export const sb = (minX: number, minY: number, maxX: number, maxY: number) =>
  svgBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));

export const flp = (x: number, y: number) => frameLocalPoint(pt(x), pt(y));
