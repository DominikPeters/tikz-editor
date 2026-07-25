import type { SimpleTexGraphicsOptions } from "../text/tex/ir.js";
import type {
  DocumentGraphicsResolution,
  DocumentGraphicsResolveRequest,
  DocumentGraphicsResolver,
} from "./types.js";

/**
 * Path-free, structured-cloneable preview data for one graphics request.
 * Filesystem resolution and watching remain owned by the app/main thread.
 */
export type DocumentGraphicsPreviewResolution =
  | {
      readonly status: "resolved";
      readonly mimeType: "image/png" | "image/jpeg" | "image/svg+xml";
      readonly dataBase64: string;
      readonly naturalWidthPt: number;
      readonly naturalHeightPt: number;
      readonly revision: string;
    }
  | {
      readonly status: "missing";
      readonly revision?: string;
    }
  | {
      readonly status: "unsupported";
      readonly reason?: string;
      readonly revision?: string;
    };

export type DocumentGraphicsPreviewBundleEntry = {
  readonly requestKey: string;
  readonly resolution: DocumentGraphicsPreviewResolution;
};

/**
 * A document-local graphics resolver snapshot suitable for worker transport.
 * The bundle is registered once per cache key; individual render requests
 * carry only that key.
 */
export type DocumentGraphicsPreviewBundle = {
  readonly version: 1;
  readonly cacheKey: string;
  readonly entries: readonly DocumentGraphicsPreviewBundleEntry[];
};

export function documentGraphicsPreviewRequestKey(params: {
  readonly filename: string;
  readonly options: SimpleTexGraphicsOptions;
}): string {
  const filename = params.filename.trim();
  const extension = extensionForGraphicsFilename(filename);
  const pageKey =
    extension === "" || extension === ".pdf"
      ? pdfPageDiscriminator(params.options)
      : "";
  return `${filename}\n${pageKey}`;
}

export function createDocumentGraphicsResolverFromPreviewBundle(
  bundle: DocumentGraphicsPreviewBundle
): DocumentGraphicsResolver {
  const entries = new Map(
    bundle.entries.map((entry) => [entry.requestKey, entry.resolution])
  );
  return {
    cacheKey: bundle.cacheKey,
    resolve(
      request: DocumentGraphicsResolveRequest
    ): DocumentGraphicsResolution {
      return (
        entries.get(
          documentGraphicsPreviewRequestKey({
            filename: request.filename,
            options: request.options,
          })
        ) ?? {
          status: "missing",
          revision: `unprepared-preview:${bundle.cacheKey}`,
        }
      );
    },
  };
}

function pdfPageDiscriminator(options: SimpleTexGraphicsOptions): string {
  if (options.page?.status === "invalid") {
    return `invalid-page=${options.page.raw.trim()}`;
  }
  const pageNumber =
    options.page?.status === "valid" ? options.page.pageNumber : 1;
  return `page=${pageNumber}`;
}

function extensionForGraphicsFilename(filename: string): string {
  const normalized = filename.replaceAll("\\", "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dot = basename.lastIndexOf(".");
  return dot >= 0 ? basename.slice(dot).toLowerCase() : "";
}
