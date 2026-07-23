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
  span: Span;
  root: BeamerTikzPictureRoot;
};

export type BeamerUnsupportedBodyNode = {
  kind: "unsupported";
  id: string;
  span: Span;
  message: string;
};

export type BeamerColumnFlowNode =
  | BeamerParagraphBodyNode
  | BeamerListBodyNode
  | BeamerVerticalSpaceBodyNode
  | BeamerTikzBodyNode
  | BeamerUnsupportedBodyNode;

export type BeamerColumnBodyNode = {
  kind: "column";
  id: string;
  span: Span;
  beginSpan: Span;
  endSpan: Span;
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
  bodySpan: Span;
  columns: BeamerColumnBodyNode[];
};

export type BeamerFrameBodyNode =
  | BeamerColumnsBodyNode
  | BeamerParagraphBodyNode
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
