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

/**
 * Resolution facts retained by layout without retaining the asset payload.
 *
 * The raster/SVG bytes belong to the paint cache. Layout consumers only need
 * stable resource identity, intrinsic dimensions, and failure state.
 */
export type DocumentGraphicsAsset =
  | {
      readonly filename: string;
      readonly status: "resolved";
      readonly mimeType: "image/png" | "image/jpeg" | "image/svg+xml";
      readonly naturalWidthPt: number;
      readonly naturalHeightPt: number;
      readonly revision: string;
    }
  | {
      readonly filename: string;
      readonly status: "missing";
      readonly revision?: string;
    }
  | {
      readonly filename: string;
      readonly status: "unsupported";
      readonly reason?: string;
      readonly revision?: string;
    };

/** A text file of the document's project (a pgfplots table), as the host found it. */
export type DocumentTextFileResolution =
  | { status: "resolved"; text: string }
  /** The host reads the document's folder, but the file is not there. */
  | { status: "missing" };

export type DocumentGraphicsResolver = {
  readonly cacheKey: string;
  resolve(request: DocumentGraphicsResolveRequest): DocumentGraphicsResolution;
  /**
   * Text files the document reads by name, relative to its folder (pgfplots
   * `\addplot table {data.dat}`, `\pgfplotstableread{data.dat}`). Absent when
   * the host cannot read the document's folder at all (the web shell, an
   * unsaved document); the contents are part of `cacheKey`.
   */
  readTextFile?(filename: string): DocumentTextFileResolution;
};
