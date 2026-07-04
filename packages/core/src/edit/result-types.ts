import type { SourcePatch } from "./types.js";

export type EditActionSuccessResult = {
  kind: "success";
  newSource: string;
  patches: SourcePatch[];
  selectedSourceIds?: string[];
  changedSourceIds?: string[];
};

export type EditActionPartialResult = {
  kind: "partial";
  newSource: string;
  patches: SourcePatch[];
  skippedHandles: string[];
  reason: string;
  selectedSourceIds?: string[];
  changedSourceIds?: string[];
};

export type EditActionUnsupportedResult = {
  kind: "unsupported";
  reason: string;
};

export type EditActionErrorResult = {
  kind: "error";
  message: string;
};

export type EditActionResultLike =
  | EditActionSuccessResult
  | EditActionPartialResult
  | EditActionUnsupportedResult
  | EditActionErrorResult;
