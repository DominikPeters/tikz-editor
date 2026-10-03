export type Point = {
  x: number;
  y: number;
};

export function point(x: number, y: number): Point {
  return { x, y };
}

export function offsetPoint(base: Point, dx: number, dy: number): Point {
  return { x: base.x + dx, y: base.y + dy };
}
