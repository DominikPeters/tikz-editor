import type { NodeTextEngine } from "../text/types.js";
import type { SvgBounds, SvgPoint } from "../coords/points.js";
import type { SvgTransform } from "../coords/transforms.js";

export type SvgViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SvgPoint2D = SvgPoint;
export type SvgBounds2D = SvgBounds;
export type SvgTransform2D = SvgTransform;

export type SvgRenderPart = {
  partId: string;
  sourceId: string;
  elementId: string | null;
  order: number;
  markup: string;
  fingerprint: string;
  /** Text source projections can change while geometry remains reusable. */
  textRenderKey?: string;
};

export type SvgRenderModel = {
  viewBox: SvgViewBox;
  defs: string[];
  defsFingerprint: string;
  parts: SvgRenderPart[];
  diagnostics: Array<{
    code: string;
    message: string;
  }>;
};

export type SvgDiffHints = {
  affectedSourceIds?: readonly string[];
};

export type SvgPatchOp =
  | {
      kind: "upsertPart";
      part: SvgRenderPart;
      afterPartId: string | null;
    }
  | {
      kind: "removePart";
      partId: string;
    }
  | {
      kind: "setViewBox";
      viewBox: SvgViewBox;
    }
  | {
      kind: "replaceDefs";
      defs: string[];
      defsFingerprint: string;
    }
  | {
      kind: "replaceAll";
      model: SvgRenderModel;
    };

export type EmitSvgOptions = {
  padding?: number;
  includeXmlns?: boolean;
  textEngine?: NodeTextEngine | null;
  viewBox?: SvgViewBox;
  /**
   * Optional render-model reuse hints for exact incremental SVG emission.
   * If invariants do not hold, emitter falls back to full model emission.
   */
  reuse?: {
    previousModel?: SvgRenderModel | null;
    affectedSourceIds?: readonly string[] | null;
  };
};

export type EmitSvgResult = {
  svg: string;
  viewBox: SvgViewBox;
  model: SvgRenderModel;
  diagnostics: Array<{
    code: string;
    message: string;
  }>;
};
