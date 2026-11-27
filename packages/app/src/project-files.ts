import "./harfbuzz-loader";
import {
  beamerFontFileRequests, beamerInputFileRequests, beamerThemeFileName, buildRuntimeTexFont, collectBeamerProjectFiles, createBeamerProjectFiles,
  loadRuntimeHarfBuzz, mayReadPgfplotsTableFiles, pgfplotsTableFileNames, registerRuntimeTexFont, registerRuntimeTexFontTransfer, scanBeamerDocument,
  type BeamerProjectFiles, type RuntimeTexFontData, type RuntimeTexFontTransfer,
} from "@tikz-editor/core/beamer";
import { runtimeTexFontFileId } from "@tikz-editor/core/text/tex/fonts/runtime-registry";
import { loadTexGlyphOutlines } from "@tikz-editor/core/text/tex/fonts/glyph-outlines";
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
  /** Runtime fonts by registered id, for worker transport (metrics and file; workers draw outlines on demand), and fontspec file names to ids. */
  readonly fonts: readonly (readonly [string, RuntimeTexFontTransfer])[];
  /** fontspec requests (`projectFontNameKey`) to registered font ids. */
  readonly fontNames: readonly (readonly [string, string])[];
  /** Every path this preparation read or looked for, found or not, for the file watcher. */
  readonly dependencies: readonly string[];
};

const textCache = new Map<string, string | null>();
// Built fonts by path, kept while the file's revision is unchanged. Ids name
// the path and revision (runtimeTexFontFileId), so two documents' files of
// the same name, or two revisions of one file, never share registered metrics.
const fontCache = new Map<string, { readonly revision: string; readonly id: `otf:${string}`; readonly data: RuntimeTexFontData }>();
const THEME_USE = /\\use(?:color|font|inner|outer)?theme(?![A-Za-z@])/u;
const INPUT_USE = /\\(?:input|include)\s*\{/u;
const FONTSPEC = /\\(?:setmainfont|setsansfont|setmonofont|newfontfamily|renewfontfamily|setfontfamily)(?![A-Za-z@])/u;
const NONE: PreparedProjectFiles = { files: undefined, entries: [], fonts: [], fontNames: [], dependencies: [] };

/** Whether a document may load project files at all; callers skip the asynchronous step otherwise. */
export function documentUsesProjectFiles(source: string): boolean {
  return THEME_USE.test(source) || FONTSPEC.test(source) || INPUT_USE.test(source) || mayReadPgfplotsTableFiles(source);
}

export const NO_PROJECT_FILES = NONE;

export async function prepareBeamerProjectFiles(params: {
  readonly source: string;
  readonly resolvePath: (name: string) => string | null;
  readonly readLocalAsset: ((path: string) => Promise<LocalAssetReadResult>) | undefined;
  readonly findFont?: ((names: readonly string[], byFileName: boolean) => Promise<string | null>) | undefined;
}): Promise<PreparedProjectFiles> {
  const { readLocalAsset } = params;
  if (!readLocalAsset || !documentUsesProjectFiles(params.source)) return NONE;
  const dependencies = new Set<string>();
  const read = async (name: string): Promise<string | null> => {
    const path = params.resolvePath(name);
    if (path === null) return null;
    dependencies.add(path);
    if (textCache.has(path)) return textCache.get(path) ?? null;
    const result = await readLocalAsset(path);
    const text = result.status === "ok" ? decodeUtf8Base64(result.bytesBase64) : null;
    textCache.set(path, text);
    return text;
  };
  const collected = THEME_USE.test(params.source) || INPUT_USE.test(params.source) || mayReadPgfplotsTableFiles(params.source) ? await collectBeamerProjectFiles(params.source, read) : new Map<string, string>();
  const entries = [...collected].sort(([left], [right]) => left.localeCompare(right));
  const fonts = await loadProjectFonts(params, collected, readLocalAsset, dependencies);
  if (collected.size === 0 && fonts.names.size === 0) return dependencies.size === 0 ? NONE : { ...NONE, dependencies: [...dependencies] };
  const fontNames = [...fonts.names].sort(([left], [right]) => left.localeCompare(right));
  const key = beamerProjectFilesCacheKey([...entries, ...fontNames.map(([name, id]) => [name, `${id}@${fonts.revisions.get(id) ?? ""}`] as const)]);
  return {
    files: { ...createBeamerProjectFiles(collected, key), fontId: (name: string, path?: string) => fonts.names.get(projectFontNameKey(name, path)) ?? null },
    entries,
    fonts: [...fonts.data].map(([id, data]) => [id, { font: data.font, bytes: data.bytes }] as const),
    fontNames,
    dependencies: [...dependencies],
  };
}

/** A fontspec face request: the file name, under the `Path=` it was asked for in. */
function projectFontNameKey(name: string, path: string | undefined): string {
  return path ? `${path}\u0000${name}` : name;
}

/**
 * fontspec faces: from the document's folder (and `Path=`) first, then where
 * the platform finds them (desktop: system fonts or TeX Live, in luaotfload's
 * order). Each font is built once per file revision and registered.
 */
async function loadProjectFonts(
  params: Parameters<typeof prepareBeamerProjectFiles>[0],
  themeFiles: ReadonlyMap<string, string>,
  readLocalAsset: (path: string) => Promise<LocalAssetReadResult>,
  dependencies: Set<string>
): Promise<{ names: Map<string, `otf:${string}`>; data: Map<string, RuntimeTexFontData>; revisions: Map<string, string> }> {
  const names = new Map<string, `otf:${string}`>();
  const data = new Map<string, RuntimeTexFontData>();
  const revisions = new Map<string, string>();
  const requests = FONTSPEC.test(params.source) || [...themeFiles.values()].some(text => FONTSPEC.test(text))
    ? beamerFontFileRequests(params.source, themeFiles) : [];
  for (const request of requests) {
    const key = (name: string) => projectFontNameKey(name, request.path);
    if (request.names.some(name => names.has(key(name)))) continue;
    let found: { name: string; read: Extract<LocalAssetReadResult, { status: "ok" }> } | null = null;
    for (const name of request.names) {
      const path = request.path && /^(?:\/|[A-Za-z]:[\\/])/u.test(request.path)
        ? `${request.path.replace(/[\\/]?$/u, "/")}${name}`
        : params.resolvePath(`${request.path ?? ""}${name}`);
      if (path === null) continue;
      // A face added to the folder later takes precedence; watch for it.
      dependencies.add(path);
      const result = await readLocalAsset(path);
      if (result.status === "ok") { found = { name, read: result }; break; }
    }
    if (!found && params.findFont) {
      const path = await params.findFont(request.names, request.byFileName);
      const result = path ? await readLocalAsset(path) : null;
      const name = path?.split(/[\\/]/u).at(-1);
      if (result?.status === "ok" && name) found = { name, read: result };
    }
    if (!found) continue;
    dependencies.add(found.read.path);
    const cached = fontCache.get(found.read.path);
    let entry = cached?.revision === found.read.revision ? cached : undefined;
    if (!entry) {
      const hb = await loadRuntimeHarfBuzz();
      const font = buildRuntimeTexFont(hb, decodeBase64(found.read.bytesBase64), found.name);
      entry = { revision: found.read.revision, id: runtimeTexFontFileId(found.name, found.read.path, found.read.revision), data: font };
      fontCache.set(found.read.path, entry);
    }
    registerRuntimeTexFont(entry.id, entry.data);
    data.set(entry.id, entry.data);
    revisions.set(entry.id, entry.revision);
    for (const name of request.names) if (!names.has(key(name))) names.set(key(name), entry.id);
  }
  return { names, data, revisions };
}

export function beamerProjectFilesCacheKey(entries: readonly (readonly [string, string])[]): string {
  return `project-files:${computeSourceFingerprint(JSON.stringify(entries))}`;
}

/**
 * Files the document names directly. What those files load in turn (nested
 * themes, `\input` files, fonts) is known once they are read, from the
 * preparation's `dependencies`.
 */
export function beamerProjectFileWatchPaths(source: string, resolvePath: (name: string) => string | null): string[] {
  if (!documentUsesProjectFiles(source)) return [];
  const names = scanBeamerDocument(source).preamble.themes.flatMap(use => use.name.value.split(",")
    .map(name => name.trim()).filter(name => /^[A-Za-z0-9_-]+$/u.test(name))
    .map(name => beamerThemeFileName(use.kind, name)));
  names.push(...beamerInputFileRequests(source).flat(), ...pgfplotsTableFileNames(source));
  return [...new Set([...new Set(names)].flatMap(name => resolvePath(name) ?? []))];
}

export function invalidateProjectFilePath(path: string): void {
  textCache.delete(path);
  fontCache.delete(path);
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeUtf8Base64(base64: string): string {
  return new TextDecoder().decode(decodeBase64(base64));
}

/**
 * Project files and runtime fonts carried in a worker's graphics bundle. The
 * fonts are registered in the worker, which builds no metrics itself and
 * draws outlines from the font files only for the glyphs it paints.
 */
export function beamerProjectFilesFromBundle(bundle: {
  readonly cacheKey: string;
  readonly projectFiles?: readonly (readonly [string, string])[];
  readonly runtimeFonts?: readonly (readonly [string, RuntimeTexFontTransfer])[];
  readonly projectFontNames?: readonly (readonly [string, string])[];
} | null | undefined): BeamerProjectFiles | undefined {
  if (!bundle?.projectFiles?.length && !bundle?.runtimeFonts?.length) return undefined;
  for (const [id, transfer] of bundle.runtimeFonts ?? []) registerRuntimeTexFontTransfer(id, transfer);
  // Start drawing outlines (harfbuzz loads first) while the render waits in the queue.
  void loadTexGlyphOutlines((bundle.runtimeFonts ?? []).map(([id]) => id));
  const fontNames = new Map(bundle.projectFontNames ?? []);
  return {
    ...createBeamerProjectFiles(new Map(bundle.projectFiles ?? []), bundle.cacheKey),
    fontId: (name: string, path?: string) => {
      const id = fontNames.get(projectFontNameKey(name, path));
      return id !== undefined && isRuntimeFontId(id) ? id : null;
    },
  };
}

function isRuntimeFontId(id: string): id is `otf:${string}` {
  return id.startsWith("otf:");
}
