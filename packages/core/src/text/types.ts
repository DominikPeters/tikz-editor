import type { TextSourceMap } from "./source-map.js";

export type NodeTextFontStyle = "normal" | "italic";
export type NodeTextFontWeight = "normal" | "bold";
export type NodeTextFontFamily = "serif" | "sans" | "monospace";
export type NodeTextParagraphAlignment = "ragged-right" | "ragged-left" | "center" | "justified";

export type NodeTextValidationIssue = {
  code?: string;
  message: string;
};

export type NodeTextMeasureRequest = {
  text: string;
  mode?: "text" | "math";
  textWidthPt: number | null;
  alignment?: NodeTextParagraphAlignment;
  fontStyle: NodeTextFontStyle;
  fontWeight: NodeTextFontWeight;
  fontFamily: NodeTextFontFamily;
  fontSizePt: number;
  sourceMap?: TextSourceMap;
};

export type NodeTextMetrics = {
  cacheKey: string;
  width: number;
  height: number;
  baselineY: number;
  midLineY: number;
  paragraphId: string | null;
  renderSourceText: string;
};

export type NodeTextRenderPayload = {
  cacheKey: string;
  viewBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  body: string;
};

export type NodeTextLayoutKind = "single-line" | "wrapped" | "explicit-multiline" | "matrix-cell";

export type NodeTextRenderInfo =
  | {
      mode: "plain";
    }
  | {
      mode: "mathjax";
      cacheKey: string;
      paragraphId: string | null;
      renderSourceText: string;
      layoutKind: NodeTextLayoutKind;
      paragraphAlignment?: NodeTextParagraphAlignment;
    };

export type NodeTextEngine = {
  validate(text: string): NodeTextValidationIssue | null;
  measure(request: NodeTextMeasureRequest): NodeTextMetrics | null;
  renderFromCache(cacheKey: string): NodeTextRenderPayload | null;
  /**
   * Resolve pending async renders and return the cache keys that became available
   * during this flush. Returns an empty list when nothing changed.
   */
  flushPending?(): Promise<readonly string[]>;
};
