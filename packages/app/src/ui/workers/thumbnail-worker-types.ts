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
  /** Present for deck frames: render this Beamer frame's final overlay step. */
  deckFrameIndex?: number;
  parseOptions: ThumbnailRenderParseOptions;
  svgOptions?: ThumbnailRenderSvgOptions;
};

export type ThumbnailCancelRequest = {
  type: "cancelRequest";
  requestId: string;
};

export type ThumbnailCancelGroup = {
  type: "cancelGroup";
  groupId: string;
};

export type ThumbnailWorkerRequestMessage =
  | ThumbnailRenderRequest
  | ThumbnailCancelRequest
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
