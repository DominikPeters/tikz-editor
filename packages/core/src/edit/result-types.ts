import type { SourcePatch } from "./types.js";
import type { IdentityMove } from "./identity-provenance.js";

export type EditActionSuccessResult = {
  kind: "success";
  newSource: string;
  patches: SourcePatch[];
  /** Explicit source ownership for structural edits such as reordering. */
  identityMoves?: IdentityMove[];
  geometryBaseSource?: string;
  selectedSourceIds?: string[];
  changedSourceIds?: string[];
};

export type EditActionPartialResult = {
  kind: "partial";
  newSource: string;
  patches: SourcePatch[];
  /** Explicit source ownership for structural edits such as reordering. */
  identityMoves?: IdentityMove[];
  geometryBaseSource?: string;
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
