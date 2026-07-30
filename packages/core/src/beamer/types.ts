import type {
  MacroAliasStatement,
  MacroCommandDefinitionStatement,
  MacroDefinitionStatement,
  Span,
} from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type {
  DocumentGraphicsAsset,
  DocumentGraphicsResolver,
} from "../graphics/types.js";
import type { SvgRenderModel, SvgViewBox } from "../svg/types.js";
import type { ParagraphLayoutReport } from "../text/knuth-plass/paragraph/report.js";
import type { TexVListLayout } from "../text/tex/index.js";
import type { SimpleTexGraphicsOptions } from "../text/tex/ir.js";
import type { SvgRect } from "../coords/index.js";
import type { SourcePatch } from "../edit/types.js";
import type { Tree } from "@lezer/common";

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

export type BeamerTheoremStyle =
  | "plain"
  | "definition"
  | "example"
  | "remark";

export type BeamerTheoremDeclarationModel = {
  kind: "theorem-declaration";
  /** Environment name without delimiters. */
  name: string;
  span: Span;
  commandSpan: Span;
  nameSource: BeamerDelimitedSourceValue;
  displayName: BeamerDelimitedSourceValue;
  style: BeamerTheoremStyle;
  /** Null for `\newtheorem*` declarations. */
  counter: string | null;
  /** Counter whose value this declaration shares, when applicable. */
  sharedCounter?: string;
  /** Counter that resets this declaration, currently `section` when present. */
  within?: string;
  starred: boolean;
  builtIn: boolean;
};

export type BeamerTheoremTemplateVariant =
  | "default"
  | "numbered"
  | "ams-style"
  | "normal-font";

export type BeamerPreambleModel = {
  span: Span;
  documentClass: BeamerDocumentClassModel | null;
  themes: BeamerThemeUseModel[];
  metadata: Partial<Record<BeamerMetadataFieldName, BeamerMetadataFieldModel>>;
  atBeginSectionSpans: Span[];
  theoremDeclarations: BeamerTheoremDeclarationModel[];
  theoremTemplate: BeamerTheoremTemplateVariant;
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
  /** Frame canvas after subtracting theme-owned left/right sidebars. */
  frameArea: BeamerRect;
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
  | "mini-frame-navigation"
  | "headline-decoration"
  | "list-marker"
  | "block"
  | "columns"
  | "column"
  | "graphics"
  | "tikzpicture"
  | "unsupported";

export type BeamerFrameLayoutItem = {
  id: string;
  kind: BeamerFrameLayoutItemKind;
  sourceSpan: Span;
  bounds: BeamerRect;
  parentId: string | null;
  /** Hidden overlay material retains geometry but contributes no paint. */
  visibility?: "visible" | "hidden";
  paragraphId?: string;
  childIds?: string[];
  message?: string;
  /** The marker is already represented by a glyph in its paragraph VList. */
  traceAsGlyph?: boolean;
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
    | "headline"
    | "footline";
  sourceSpan: Span;
  bounds: BeamerRect;
  report: ParagraphLayoutReport<"document">;
  vlistLayout: TexVListLayout<"document">;
  /**
   * Visible, directly-authored prose ranges that canvas typo editing may
   * patch independently. Generated, macro-owned, math, graphics, labels, and
   * hidden overlay material are intentionally absent.
   */
  editableTextSpans: BeamerEditableTextSpan[];
  /** Source ranges laid out for covered overlays but omitted from paint. */
  hiddenSourceSpans?: readonly Span[];
  /** Source-backed but non-direct ranges, such as explicit custom-macro arguments. */
  readOnlySourceSpans?: readonly Span[];
  /** One-based list item ordinals whose labels are covered on this step. */
  hiddenListItemIndices?: readonly number[];
};

export type BeamerEditableTextSpan = {
  id: string;
  span: Span;
  /** Final document/SVG-space geometry; never paragraph-local geometry. */
  hitBounds: SvgRect[];
};

export type BeamerEditScopeKind = "frame-title" | "column" | "frame-body";

/**
 * A canvas editing session's buffer unit: the nearest container of the
 * edited text (design/beamer-canvas-editing.md). Column scopes nest inside
 * the frame-body scope; the smallest containing span wins.
 */
export type BeamerEditScope = {
  kind: BeamerEditScopeKind;
  id: string;
  /** Full session buffer span in document coordinates. */
  span: Span;
};

export type PrepareBeamerDocumentOptions = {
  /**
   * Source ranges neutralized only for the document-structure CST. Text
   * layout still consumes the real source.
   */
  structuralMasks?: readonly Span[];
  /** Previous CST and source patches for incremental Lezer parsing. */
  previousSyntaxTree?: Tree;
  syntaxPatches?: readonly SourcePatch[];
};

export type BeamerEmbeddedTikzLayout = {
  itemId: string;
  sourceSpan: Span;
  bounds: BeamerRect;
  viewBox: SvgViewBox;
  model: SvgRenderModel;
};

export type BeamerGraphicsLayout = {
  itemId: string;
  paragraphId: string;
  lineIndex: number;
  sourceSpan: Span;
  filenameSpan: Span;
  bounds: BeamerRect;
  baselineY: number;
  asset: DocumentGraphicsAsset;
  options: SimpleTexGraphicsOptions;
  caretPolicy: "filename-linear";
  visibility: "visible" | "hidden";
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
    clip: boolean;
  };
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
  stepCount: number;
  page: BeamerPageGeometry;
  contentBounds: BeamerRect;
  items: BeamerFrameLayoutItem[];
  paragraphs: BeamerParagraphLayout[];
  graphics: BeamerGraphicsLayout[];
  embeddedTikz: BeamerEmbeddedTikzLayout[];
  editScopes: BeamerEditScope[];
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
  /** One-based overlay step. */
  step?: number;
  /** Resolves document-local graphics for frame text and embedded TikZ. */
  graphicsResolver?: DocumentGraphicsResolver;
};

export type RenderBeamerFramePagesOptions = {
  /** Zero-based frame index. */
  frameIndex?: number;
  /** Resolves document-local graphics for every overlay page. */
  graphicsResolver?: DocumentGraphicsResolver;
};

export type RenderBeamerFramePagesResult = {
  document: BeamerDocumentModel;
  frame: BeamerFrameModel;
  stepCount: number;
  pages: RenderBeamerFrameResult[];
  diagnostics: Diagnostic[];
};
