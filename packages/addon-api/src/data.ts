/**
 * Plain data types shared across the add-on boundary.
 *
 * Everything in this file must stay structured-clone-compatible: these values
 * ride inside session snapshots that are designed for Web Worker transfer.
 * The host (tikz-editor core) implements interfaces over these shapes; add-ons
 * never import the host directly.
 */

export type Span = { from: number; to: number };

/** A point in TikZ world coordinates (pt units, y up). */
export type WorldPoint = { x: number; y: number };

/** Axis-aligned bounds in TikZ world coordinates. */
export type WorldBounds = { minX: number; minY: number; maxX: number; maxY: number };

export type OptionEntry =
  | {
      kind: "kv";
      key: string;
      valueRaw: string;
      span: Span;
      keySpan?: Span;
      valueSpan?: Span | null;
      raw: string;
    }
  | {
      kind: "flag";
      key: string;
      span: Span;
      keySpan?: Span;
      raw: string;
    }
  | {
      kind: "unknown";
      span: Span;
      raw: string;
    };

export type OptionListAst = {
  span: Span;
  raw: string;
  entries: OptionEntry[];
};

export type ScenePathCommand =
  | { kind: "M"; to: WorldPoint }
  | { kind: "L"; to: WorldPoint }
  | { kind: "C"; c1: WorldPoint; c2: WorldPoint; to: WorldPoint }
  | { kind: "A"; rx: number; ry: number; xAxisRotation: number; largeArc: boolean; sweep: boolean; to: WorldPoint }
  | { kind: "Z" };

export type AddonDiagnostic = {
  severity: "error" | "warning";
  message: string;
  span: Span;
  /** Add-on diagnostic codes should be namespaced, e.g. "addon:pgfplots:bad-domain". */
  code?: string;
};

export type PgfMathResult =
  | { ok: true; kind: "scalar" | "length"; value: number }
  | { ok: false; code: string; message: string };
