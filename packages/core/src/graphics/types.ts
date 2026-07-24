import type { SimpleTexGraphicsOptions } from "../text/tex/ir.js";

/**
 * A source-backed request for a document-local graphic.
 *
 * The request is independent of any particular layout consumer: native TeX
 * paragraphs, Beamer composition, and embedded TikZ pictures all resolve
 * through the same document resource contract.
 */
export type DocumentGraphicsResolveRequest = {
  filename: string;
  options: SimpleTexGraphicsOptions;
  source: string;
  sourceStart: number;
  sourceEnd: number;
};

export type DocumentGraphicsResolution =
  | {
      status: "resolved";
      mimeType: "image/png" | "image/jpeg" | "image/svg+xml";
      dataBase64: string;
      naturalWidthPt: number;
      naturalHeightPt: number;
      revision: string;
      resolvedPath?: string;
      watchedPaths?: readonly string[];
    }
  | {
      status: "missing";
      revision?: string;
      resolvedPath?: string;
      watchedPaths?: readonly string[];
    }
  | {
      status: "unsupported";
      reason?: string;
      revision?: string;
      resolvedPath?: string;
      watchedPaths?: readonly string[];
    };

export type DocumentGraphicsResolver = {
  readonly cacheKey: string;
  resolve(request: DocumentGraphicsResolveRequest): DocumentGraphicsResolution;
};
