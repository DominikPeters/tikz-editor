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
  graphicsResolver?: NodeTextGraphicsResolver;
};

export type NodeTextGraphicsOptionValue = string | boolean;

export type NodeTextGraphicsOptions = Readonly<Record<string, NodeTextGraphicsOptionValue>>;

export type NodeTextGraphicsResolveRequest = {
  filename: string;
  options: NodeTextGraphicsOptions;
  source: string;
  sourceStart: number;
  sourceEnd: number;
};

export type NodeTextGraphicsResolution =
  | {
      status: "resolved";
      mimeType: "image/png" | "image/jpeg" | "image/svg+xml";
      dataBase64: string;
      naturalWidthPt: number;
      naturalHeightPt: number;
      revision: string;
      resolvedPath?: string;
      watchedPaths?: readonly string[];
    }
  | {
      status: "missing";
      revision?: string;
      resolvedPath?: string;
      watchedPaths?: readonly string[];
    }
  | {
      status: "unsupported";
      reason?: string;
      revision?: string;
      resolvedPath?: string;
      watchedPaths?: readonly string[];
    };

export type NodeTextGraphicsResolver = {
  readonly cacheKey: string;
  resolve(request: NodeTextGraphicsResolveRequest): NodeTextGraphicsResolution;
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
