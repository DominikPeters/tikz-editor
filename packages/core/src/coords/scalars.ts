declare const scalarBrand: unique symbol;

type Brand<T, B extends string> = T & { readonly [scalarBrand]: B };

export type Pt = Brand<number, "Pt">;
export type Cm = Brand<number, "Cm">;
export type Px = Brand<number, "Px">;
export type Deg = Brand<number, "Deg">;

export type Scalar = Pt | Cm | Px | Deg;

export function pt(value: number): Pt {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This constructor establishes a phantom coordinate brand without changing its runtime representation.
  return value as Pt;
}

export function cm(value: number): Cm {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This constructor establishes a phantom coordinate brand without changing its runtime representation.
  return value as Cm;
}

export function px(value: number): Px {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This constructor establishes a phantom coordinate brand without changing its runtime representation.
  return value as Px;
}

export function deg(value: number): Deg {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This constructor establishes a phantom coordinate brand without changing its runtime representation.
  return value as Deg;
}

export function scalarValue(value: Scalar): number {
  return value;
}

export function addScalar<TScalar extends Scalar>(left: TScalar, right: TScalar): TScalar {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This constructor establishes a phantom coordinate brand without changing its runtime representation.
  return (scalarValue(left) + scalarValue(right)) as TScalar;
}

export function subScalar<TScalar extends Scalar>(left: TScalar, right: TScalar): TScalar {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This constructor establishes a phantom coordinate brand without changing its runtime representation.
  return (scalarValue(left) - scalarValue(right)) as TScalar;
}

export function scaleScalar<TScalar extends Scalar>(value: TScalar, factor: number): TScalar {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This constructor establishes a phantom coordinate brand without changing its runtime representation.
  return (scalarValue(value) * factor) as TScalar;
}

export function divScalar<TScalar extends Scalar>(value: TScalar, divisor: number): TScalar {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This constructor establishes a phantom coordinate brand without changing its runtime representation.
  return (scalarValue(value) / divisor) as TScalar;
}

export function absScalar<TScalar extends Scalar>(value: TScalar): TScalar {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This constructor establishes a phantom coordinate brand without changing its runtime representation.
  return Math.abs(scalarValue(value)) as TScalar;
}

export function minScalar<TScalar extends Scalar>(left: TScalar, right: TScalar): TScalar {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This constructor establishes a phantom coordinate brand without changing its runtime representation.
  return (Math.min(scalarValue(left), scalarValue(right))) as TScalar;
}

export function maxScalar<TScalar extends Scalar>(left: TScalar, right: TScalar): TScalar {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This constructor establishes a phantom coordinate brand without changing its runtime representation.
  return (Math.max(scalarValue(left), scalarValue(right))) as TScalar;
}

export function clampScalar<TScalar extends Scalar>(value: TScalar, min: TScalar, max: TScalar): TScalar {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This constructor establishes a phantom coordinate brand without changing its runtime representation.
  return (Math.min(Math.max(scalarValue(value), scalarValue(min)), scalarValue(max))) as TScalar;
}

export function negScalar<TScalar extends Scalar>(value: TScalar): TScalar {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This constructor establishes a phantom coordinate brand without changing its runtime representation.
  return (-scalarValue(value)) as TScalar;
}

export type CoordinateBrand<T extends string> = Brand<number, T>;
