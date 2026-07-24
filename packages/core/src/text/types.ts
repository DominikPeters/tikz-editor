import type { TextSourceMap } from "./source-map.js";
import type { DocumentGraphicsResolver } from "../graphics/types.js";

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
  textWidthPt: number | null;
  alignment?: NodeTextParagraphAlignment;
  fontStyle: NodeTextFontStyle;
  fontWeight: NodeTextFontWeight;
  fontFamily: NodeTextFontFamily;
  fontSizePt: number;
  sourceMap?: TextSourceMap;
  graphicsResolver?: DocumentGraphicsResolver;
  colorResolver?: NodeTextColorResolver;
};

/** Resolves document-local xcolor names without rewriting the TeX source. */
export type NodeTextColorResolver = {
  readonly cacheKey: string;
  resolve(name: string): string | null;
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
      mode: "tex";
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
