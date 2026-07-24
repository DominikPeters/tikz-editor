import type {
  MacroAliasStatement,
  MacroCommandDefinitionStatement,
  MacroDefinitionStatement,
  Span,
} from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type { SvgRenderModel, SvgViewBox } from "../svg/types.js";
import type { ParagraphLayoutReport } from "../text/knuth-plass/paragraph/report.js";
import type { TexVListLayout } from "../text/tex/index.js";

export type BeamerDelimitedSourceValue = {
  /** Span including the delimiters. */
  span: Span;
  /** Span of the source between the delimiters. */
  contentSpan: Span;
  value: string;
};

export type BeamerFrameOption = {
  span: Span;
  keySpan: Span;
  valueSpan?: Span;
  key: string;
  value?: string;
};

export type BeamerFrameOptions = {
  source: BeamerDelimitedSourceValue;
  entries: BeamerFrameOption[];
  alignment: "top" | "center" | "bottom";
  fragile: boolean;
  plain: boolean;
  label?: string;
};

export type BeamerTikzPictureRoot = {
  kind: "tikzpicture";
  id: string;
  span: Span;
  beginSpan: Span;
  endSpan: Span;
};

export type BeamerFrameModel = {
  kind: "frame";
  id: string;
  sourceOrder: number;
  span: Span;
  beginSpan: Span;
  endSpan: Span | null;
  /** Header arguments after `\begin{frame}` and before the body. */
  headerSpan: Span;
  bodySpan: Span;
  overlay?: BeamerDelimitedSourceValue;
  options?: BeamerFrameOptions;
  title?: BeamerDelimitedSourceValue;
  subtitle?: BeamerDelimitedSourceValue;
  sectionId: string | null;
  subsectionId: string | null;
  children: BeamerTikzPictureRoot[];
};

export type BeamerSectionModel = {
  kind: "section";
  id: string;
  sourceOrder: number;
  level: 1 | 2;
  starred: boolean;
  span: Span;
  commandSpan: Span;
  shortTitle?: BeamerDelimitedSourceValue;
  title: BeamerDelimitedSourceValue;
  parentSectionId: string | null;
};

export type BeamerDocumentClassModel = {
  span: Span;
  commandSpan: Span;
  options?: BeamerDelimitedSourceValue;
  className: BeamerDelimitedSourceValue;
};

export type BeamerThemeKind =
  | "theme"
  | "color-theme"
  | "font-theme"
  | "inner-theme"
  | "outer-theme";

export type BeamerThemeUseModel = {
  kind: BeamerThemeKind;
  span: Span;
  commandSpan: Span;
  options?: BeamerDelimitedSourceValue;
  name: BeamerDelimitedSourceValue;
};

export type BeamerMetadataFieldName =
  | "title"
  | "subtitle"
  | "author"
  | "institute"
  | "date";

export type BeamerMetadataFieldModel = {
  name: BeamerMetadataFieldName;
  span: Span;
  commandSpan: Span;
  shortValue?: BeamerDelimitedSourceValue;
  value: BeamerDelimitedSourceValue;
};

export type BeamerPreambleModel = {
  span: Span;
  documentClass: BeamerDocumentClassModel | null;
  themes: BeamerThemeUseModel[];
  metadata: Partial<Record<BeamerMetadataFieldName, BeamerMetadataFieldModel>>;
  atBeginSectionSpans: Span[];
  macroDefinitions: Array<
    | MacroDefinitionStatement
    | MacroAliasStatement
    | MacroCommandDefinitionStatement
  >;
};

export type BeamerDocumentRoot = BeamerSectionModel | BeamerFrameModel;

export type BeamerDocumentModel = {
  source: string;
  documentSpan: Span | null;
  documentBodySpan: Span;
  preamble: BeamerPreambleModel;
  sections: BeamerSectionModel[];
  frames: BeamerFrameModel[];
  roots: BeamerDocumentRoot[];
  diagnostics: Diagnostic[];
};

/**
 * Beamer page coordinates use TeX points and a top-left, y-down origin.
 *
 * This is deliberately distinct from both PDF points and TikZ's y-up scene
 * coordinates. Keeping the unit and orientation explicit lets callers place
 * native text reports, embedded TikZ renderings, and future editor hit maps in
 * one stable document-space contract.
 */
export type BeamerRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BeamerPageGeometry = {
  /** The documentclass aspectratio option, or Beamer's default `43`. */
  aspectRatio: string;
  /** Physical page bounds in TeX points. */
  page: BeamerRect;
  /** Theme-defined body text box, before frame-local layout. */
  textArea: BeamerRect;
  /** Identifier of the fully resolved theme supplying the dimensions. */
  themeId: string;
};

export type BeamerFrameLayoutItemKind =
  | "background"
  | "title-page"
  | "frame-title"
  | "frame-subtitle"
  | "text"
  | "navigation-symbols"
  | "list-marker"
  | "block"
  | "columns"
  | "column"
  | "tikzpicture"
  | "unsupported";

export type BeamerFrameLayoutItem = {
  id: string;
  kind: BeamerFrameLayoutItemKind;
  sourceSpan: Span;
  bounds: BeamerRect;
  parentId: string | null;
  paragraphId?: string;
  childIds?: string[];
  message?: string;
};

export type BeamerParagraphLayout = {
  paragraphId: string;
  role:
    | "title"
    | "subtitle"
    | "author"
    | "institute"
    | "date"
    | "frame-title"
    | "frame-subtitle"
    | "body"
    | "block-title"
    | "block-body"
    | "footline";
  sourceSpan: Span;
  bounds: BeamerRect;
  report: ParagraphLayoutReport<"document">;
  vlistLayout: TexVListLayout<"document">;
};

export type BeamerEmbeddedTikzLayout = {
  itemId: string;
  sourceSpan: Span;
  bounds: BeamerRect;
  viewBox: SvgViewBox;
  model: SvgRenderModel;
};

export type BeamerFrameLayout = {
  coordinateSystem: {
    unit: "tex-pt";
    origin: "top-left";
    yAxis: "down";
  };
  frameId: string;
  frameIndex: number;
  step: number;
  page: BeamerPageGeometry;
  contentBounds: BeamerRect;
  items: BeamerFrameLayoutItem[];
  paragraphs: BeamerParagraphLayout[];
  embeddedTikz: BeamerEmbeddedTikzLayout[];
};

export type BeamerFrameSvgResult = {
  svg: string;
  viewBox: SvgViewBox;
  model: SvgRenderModel;
  diagnostics: Array<{
    code: string;
    message: string;
  }>;
};

export type RenderBeamerFrameResult = {
  document: BeamerDocumentModel;
  frame: BeamerFrameModel;
  layout: BeamerFrameLayout;
  svg: BeamerFrameSvgResult;
  diagnostics: Diagnostic[];
};

export type RenderBeamerFrameOptions = {
  /** Zero-based frame index. */
  frameIndex?: number;
  /** One-based overlay step. Overlay filtering is not yet implemented. */
  step?: number;
};
