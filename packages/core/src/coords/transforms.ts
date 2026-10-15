declare const transformBrand: unique symbol;

type AffineTransform<Brand extends string> = Readonly<{
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  [transformBrand]: Brand;
}>;

export type FrameToWorldTransform = AffineTransform<"transform:frame-to-world">;
export type WorldToFrameTransform = AffineTransform<"transform:world-to-frame">;
export type WorldToSvgTransform = AffineTransform<"transform:world-to-svg">;
export type SvgToWorldTransform = AffineTransform<"transform:svg-to-world">;
export type AnchorToWorldTransform = AffineTransform<"transform:anchor-to-world">;
export type WorldTransform = AffineTransform<"transform:world-to-world">;
export type FrameTransform = FrameToWorldTransform;
export type AnchorTransform = AnchorToWorldTransform;
export type SvgTransform = WorldToSvgTransform;

function createTransform<Brand extends string>(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
  brand: Brand
): AffineTransform<Brand> {
  void brand;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This constructor establishes a phantom coordinate brand without changing its runtime representation.
  return { a, b, c, d, e, f } as AffineTransform<Brand>;
}

export function frameToWorldTransform(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number
): FrameToWorldTransform {
  return createTransform(a, b, c, d, e, f, "transform:frame-to-world");
}

export const frameTransform = frameToWorldTransform;

export function worldToFrameTransform(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number
): WorldToFrameTransform {
  return createTransform(a, b, c, d, e, f, "transform:world-to-frame");
}

export function worldToSvgTransform(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number
): WorldToSvgTransform {
  return createTransform(a, b, c, d, e, f, "transform:world-to-svg");
}

export function svgToWorldTransform(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number
): SvgToWorldTransform {
  return createTransform(a, b, c, d, e, f, "transform:svg-to-world");
}

export function anchorToWorldTransform(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number
): AnchorToWorldTransform {
  return createTransform(a, b, c, d, e, f, "transform:anchor-to-world");
}

export function worldTransform(a: number, b: number, c: number, d: number, e: number, f: number): WorldTransform {
  return createTransform(a, b, c, d, e, f, "transform:world-to-world");
}
