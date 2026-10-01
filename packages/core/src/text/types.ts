import type { TextSourceMap } from "./source-map.js";
import type { DocumentGraphicsResolver } from "../graphics/types.js";
import type { TexGraphicsPlacement } from "./tex/vlist/types.js";
import type { TextLayoutContext } from "./layout-context.js";

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
  /** Identifies all resolved colors, including document scope and revision. */
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
  /** Native TeX graphics in the text payload's top-left coordinate system. */
  graphicsPlacements?: readonly TexGraphicsPlacement[];
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
  /** Source-backed atomic graphics in payload view-box coordinates. */
  graphicsPlacements: readonly TexGraphicsPlacement[];
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
      /** Native TeX graphics retained on the semantic text element. */
      graphicsPlacements?: readonly TexGraphicsPlacement[];
    };

export type NodeTextEngine = {
  /** Local owner of caret/selection reports; carry it with rendered results. */
  readonly layoutContext?: TextLayoutContext;
  /** Keep visible text alive independently of the engine's reusable cache. */
  createRenderScope?(previousContext?: TextLayoutContext | null): NodeTextRenderScope;
  validate(text: string): NodeTextValidationIssue | null;
  measure(request: NodeTextMeasureRequest): NodeTextMetrics | null;
  /** Reuse layout after an unchanged text fragment moves within the source. */
  rebaseSource?(cacheKey: string, delta: number): NodeTextMetrics | null;
  renderFromCache(cacheKey: string): NodeTextRenderPayload | null;
  /**
   * Resolve pending async renders and return the cache keys that became available
   * during this flush. Returns an empty list when nothing changed.
   */
  flushPending?(): Promise<readonly string[]>;
};

export interface NodeTextRenderScope {
  readonly layoutContext: TextLayoutContext;
  /** Synchronous capture; engine identity stays stable for incremental checkpoints. */
  run<T>(operation: () => T): T;
  retain(cacheKeys: readonly string[]): void;
}
