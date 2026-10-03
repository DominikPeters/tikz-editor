import type { Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type {
  BeamerDelimitedSourceValue,
  BeamerDocumentModel,
  BeamerFrameModel,
  BeamerTheoremDeclarationModel,
  BeamerTheoremStyle,
  BeamerTheoremTemplateVariant,
  BeamerTikzPictureRoot,
} from "./types.js";
import type { BeamerOverlayModel } from "./overlay.js";
import type { BeamerTheoremOccurrence } from "./theorems.js";
import type { TexSyntaxIndex } from "../text/tex/syntax-index.js";
import type { MappedText } from "../text/source-map.js";

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
} & (
  | { command: "vspace"; starred: boolean; value: BeamerDelimitedSourceValue }
  | { command: "smallskip" | "medskip" | "bigskip"; starred: false }
);

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
  /** Package boxes reuse block flow ownership but do not use a Beamer block template. */
  packageBox?: "tcolorbox";
  span: Span;
  beginSpan: Span;
  endSpan: Span;
  options?: BeamerDelimitedSourceValue;
  title: BeamerDelimitedSourceValue;
  bodySpan: Span;
  children: BeamerLeafFlowNode[];
};

export type BeamerTheoremBodyNode = {
  kind: "theorem";
  id: string;
  environment: string;
  blockEnvironment: "block" | "exampleblock";
  theoremStyle: BeamerTheoremStyle;
  theoremTemplate: BeamerTheoremTemplateVariant;
  declaration: BeamerTheoremDeclarationModel | null;
  number: string | null;
  proof: boolean;
  qed: boolean;
  span: Span;
  beginSpan: Span;
  endSpan: Span;
  overlay?: BeamerDelimitedSourceValue;
  addition?: BeamerDelimitedSourceValue;
  title: BeamerDelimitedSourceValue;
  titleMapped: MappedText;
  bodySpan: Span;
  children: BeamerLeafFlowNode[];
};

export type BeamerColumnFlowNode =
  | BeamerLeafFlowNode
  | BeamerBlockBodyNode
  | BeamerTheoremBodyNode;

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
  | BeamerTheoremBodyNode
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
  overlays: BeamerOverlayModel;
  diagnostics: Diagnostic[];
};

export type ParseBeamerFrameBodyParams = {
  source: string;
  frame: BeamerFrameModel;
  document?: BeamerDocumentModel;
  /** Shared private syntax index for a prepared source revision. */
  syntax?: TexSyntaxIndex;
  /**
   * Precomputed document-order theorem occurrences. Theorem counters are a
   * document-wide pass; a prepared document computes them once instead of
   * per frame.
   */
  theoremOccurrences?: ReadonlyMap<number, BeamerTheoremOccurrence>;
  /** Reuse the prepared document's scan for this frame and source revision. */
  overlays?: BeamerOverlayModel;
};
