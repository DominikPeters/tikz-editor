import { beamerThemeFileName, collectBeamerProjectFiles, createBeamerProjectFiles, scanBeamerDocument, type BeamerProjectFiles } from "@tikz-editor/core/beamer";
import { computeSourceFingerprint } from "@tikz-editor/core/utils/source-fingerprint";
import type { LocalAssetReadResult } from "./platform/types";

/**
 * The project's text files a Beamer document loads from its folder, such as
 * local theme files, read before rendering as images are. Reads are cached
 * per path until the file watcher reports a change.
 */
export type PreparedProjectFiles = {
  readonly files: BeamerProjectFiles | undefined;
  /** File name and text, for worker transport. */
  readonly entries: readonly (readonly [string, string])[];
};

const textCache = new Map<string, string | null>();
const THEME_USE = /\\use(?:color|font|inner|outer)?theme(?![A-Za-z@])/u;

export async function prepareBeamerProjectFiles(params: {
  readonly source: string;
  readonly resolvePath: (name: string) => string | null;
  readonly readLocalAsset: ((path: string) => Promise<LocalAssetReadResult>) | undefined;
}): Promise<PreparedProjectFiles> {
  const { readLocalAsset } = params;
  if (!readLocalAsset || !THEME_USE.test(params.source)) return { files: undefined, entries: [] };
  const read = async (name: string): Promise<string | null> => {
    const path = params.resolvePath(name);
    if (path === null) return null;
    if (textCache.has(path)) return textCache.get(path) ?? null;
    const result = await readLocalAsset(path);
    const text = result.status === "ok" ? decodeUtf8Base64(result.bytesBase64) : null;
    textCache.set(path, text);
    return text;
  };
  const collected = await collectBeamerProjectFiles(params.source, read);
  if (collected.size === 0) return { files: undefined, entries: [] };
  const entries = [...collected].sort(([left], [right]) => left.localeCompare(right));
  return { files: createBeamerProjectFiles(collected, beamerProjectFilesCacheKey(entries)), entries };
}

export function beamerProjectFilesCacheKey(entries: readonly (readonly [string, string])[]): string {
  return `project-files:${computeSourceFingerprint(JSON.stringify(entries))}`;
}

/** Files the document names directly; their own uses are found once read. */
export function beamerProjectFileWatchPaths(source: string, resolvePath: (name: string) => string | null): string[] {
  if (!THEME_USE.test(source)) return [];
  const names = scanBeamerDocument(source).preamble.themes.flatMap(use => use.name.value.split(",")
    .map(name => name.trim()).filter(name => /^[A-Za-z0-9_-]+$/u.test(name))
    .map(name => beamerThemeFileName(use.kind, name)));
  const paths = [...new Set(names)].flatMap(name => resolvePath(name) ?? []);
  for (const path of textCache.keys()) if (textCache.get(path) !== null) paths.push(path);
  return [...new Set(paths)];
}

export function invalidateProjectFilePath(path: string): void {
  textCache.delete(path);
}

function decodeUtf8Base64(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

/** Project files carried in a worker's graphics bundle. */
export function beamerProjectFilesFromBundle(bundle: { readonly cacheKey: string; readonly projectFiles?: readonly (readonly [string, string])[] } | null | undefined): BeamerProjectFiles | undefined {
  return bundle?.projectFiles?.length ? createBeamerProjectFiles(new Map(bundle.projectFiles), bundle.cacheKey) : undefined;
}
