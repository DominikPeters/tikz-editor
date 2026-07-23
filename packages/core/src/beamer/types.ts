import type { Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";

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
