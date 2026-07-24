import type { Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type {
  BeamerDelimitedSourceValue,
  BeamerFrameModel,
  BeamerTikzPictureRoot,
} from "./types.js";

export type BeamerParagraphBodyNode = {
  kind: "paragraph";
  id: string;
  span: Span;
};

export type BeamerTitlePageBodyNode = {
  kind: "title-page";
  id: string;
  span: Span;
  commandSpan: Span;
};

export type BeamerListBodyNode = {
  kind: "list";
  id: string;
  environment: "itemize" | "enumerate" | "description";
  span: Span;
};

export type BeamerVerticalSpaceBodyNode = {
  kind: "vertical-space";
  id: string;
  span: Span;
  starred: boolean;
  value: BeamerDelimitedSourceValue;
};

export type BeamerTikzBodyNode = {
  kind: "tikzpicture";
  id: string;
  /** Full flow span, including an owning center environment when present. */
  span: Span;
  root: BeamerTikzPictureRoot;
  horizontalAlignment: "left" | "center";
};

export type BeamerUnsupportedBodyNode = {
  kind: "unsupported";
  id: string;
  span: Span;
  message: string;
};

export type BeamerLeafFlowNode =
  | BeamerParagraphBodyNode
  | BeamerListBodyNode
  | BeamerVerticalSpaceBodyNode
  | BeamerTikzBodyNode
  | BeamerUnsupportedBodyNode;

export type BeamerBlockEnvironment =
  | "block"
  | "alertblock"
  | "exampleblock";

export type BeamerBlockBodyNode = {
  kind: "block";
  id: string;
  environment: BeamerBlockEnvironment;
  span: Span;
  beginSpan: Span;
  endSpan: Span;
  options?: BeamerDelimitedSourceValue;
  title: BeamerDelimitedSourceValue;
  bodySpan: Span;
  children: BeamerLeafFlowNode[];
};

export type BeamerColumnFlowNode =
  | BeamerLeafFlowNode
  | BeamerBlockBodyNode;

/**
 * Beamer's `T` mode is distinct from `t`: both use a top-aligned minipage,
 * but `T` prepends `\vskip-1ex\nointerlineskip` so the visible tops align.
 */
export type BeamerColumnAlignment = "T" | "top" | "center" | "bottom";

export type BeamerColumnBodyNode = {
  kind: "column";
  id: string;
  span: Span;
  beginSpan: Span;
  endSpan: Span;
  options?: BeamerDelimitedSourceValue;
  alignment: BeamerColumnAlignment;
  width: BeamerDelimitedSourceValue;
  bodySpan: Span;
  children: BeamerColumnFlowNode[];
};

export type BeamerColumnsBodyNode = {
  kind: "columns";
  id: string;
  span: Span;
  beginSpan: Span;
  endSpan: Span;
  options?: BeamerDelimitedSourceValue;
  alignment: BeamerColumnAlignment;
  bodySpan: Span;
  columns: BeamerColumnBodyNode[];
};

export type BeamerFrameBodyNode =
  | BeamerColumnsBodyNode
  | BeamerBlockBodyNode
  | BeamerTitlePageBodyNode
  | BeamerVerticalSpaceBodyNode
  | BeamerParagraphBodyNode
  | BeamerTikzBodyNode
  | BeamerUnsupportedBodyNode;

export type BeamerFrameBodyIr = {
  kind: "frame-body";
  frameId: string;
  span: Span;
  children: BeamerFrameBodyNode[];
  diagnostics: Diagnostic[];
};

export type ParseBeamerFrameBodyParams = {
  source: string;
  frame: BeamerFrameModel;
};
