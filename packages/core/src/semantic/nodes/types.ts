import type { NodeTextRenderInfo } from "../../text/types.js";
import type { TwoPartShapeSizingInput } from "./shape-geometry.js";

export type NodeShape =
  | "rectangle"
  | "rounded rectangle"
  | "chamfered rectangle"
  | "cross out"
  | "strike out"
  | "circle"
  | "magnifying glass"
  | "circle split"
  | "circle solidus"
  | "ellipse split"
  | "diamond split"
  | "rectangle split"
  | "ellipse"
  | "diamond"
  | "trapezium"
  | "semicircle"
  | "regular polygon"
  | "star"
  | "isosceles triangle"
  | "kite"
  | "dart"
  | "circular sector"
  | "cylinder"
  | "cloud"
  | "starburst"
  | "signal"
  | "tape"
  | "rectangle callout"
  | "ellipse callout"
  | "cloud callout"
  | "single arrow"
  | "double arrow"
  | "coordinate";
export type NodeLayer = "front" | "behind";

export type NodeLayout = {
  textLines: string[];
  textBlockWidth: number;
  textBlockHeight: number;
  textRenderInfo: NodeTextRenderInfo;
  naturalWidth: number;
  naturalHeight: number;
  minimumWidth: number;
  minimumHeight: number;
  lineWidth: number;
  outerXSep: number;
  outerYSep: number;
  visualWidth: number;
  visualHeight: number;
  visualRadius: number;
  anchorHalfWidth: number;
  anchorHalfHeight: number;
  anchorRadius: number;
  baseLineY: number;
  midLineY: number;
  /**
   * Vertical offset of the text block's centre from the node centre, when
   * `text height`/`text depth` replace the box's height or depth (the
   * glyphs then sit off-centre: their baseline is at `baseLineY`). 0 otherwise.
   */
  textOffsetY?: number;
  /** The text box's height plus depth after `text height`/`text depth` (absent: the text block's). */
  textBoxHeight?: number;
  twoPartShapeSizing?: TwoPartShapeSizingInput;
};
