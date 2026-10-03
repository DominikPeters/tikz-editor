import type { DocumentGraphicsPreviewBundle } from "@tikz-editor/core/graphics/index";

export type ThumbnailRenderParseOptions = {
  activeRootId: string;
  includeContextDefinitions: boolean;
  recover?: boolean;
};

export type ThumbnailRenderSvgOptions = {
  padding?: number;
};

export type ThumbnailRenderRequest = {
  type: "render";
  requestId: string;
  groupId: string;
  source: string;
  figureId: string;
  figureSignature: string;
  /** Path-free graphics preview state registered separately with the worker. */
  graphicsPreviewBundleKey?: string;
  /** Present for deck frames: render this Beamer frame's final overlay step. */
  deckFrameIndex?: number;
  parseOptions: ThumbnailRenderParseOptions;
  svgOptions?: ThumbnailRenderSvgOptions;
};

export type ThumbnailRegisterGraphicsMessage = {
  type: "registerGraphics";
  bundle: DocumentGraphicsPreviewBundle;
};

export type ThumbnailCancelGroup = {
  type: "cancelGroup";
  groupId: string;
};

export type ThumbnailWorkerRequestMessage =
  | ThumbnailRegisterGraphicsMessage
  | ThumbnailRenderRequest
  | ThumbnailCancelGroup;

export type ThumbnailRenderSuccess = {
  type: "result";
  ok: true;
  requestId: string;
  groupId: string;
  figureId: string;
  figureSignature: string;
  svg: string;
};

export type ThumbnailRenderFailure = {
  type: "result";
  ok: false;
  requestId: string;
  groupId: string;
  figureId: string;
  figureSignature: string;
  error: string;
};

export type ThumbnailWorkerResponseMessage = ThumbnailRenderSuccess | ThumbnailRenderFailure;
