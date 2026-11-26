import { scanBeamerDocument } from "./scan.js";
import { beamerFontspecFileRequests, scanBeamerFontspecDeclarations, type BeamerFontFileRequest } from "./theme/fontspec.js";
import type { BeamerDocumentModel, BeamerThemeKind } from "./types.js";

/**
 * Text files of the document's project that TeX would find next to it: local
 * theme files (`beamerthemegemini.sty`) and, later, packages and inputs.
 * Names are TeX file names; the host resolves them against the document's
 * folder. `cacheKey` changes whenever any file's contents change.
 */
export type BeamerProjectFiles = {
  readonly cacheKey: string;
  readText(name: string): string | null;
  /** The registered runtime font (runtime-registry.ts) for a font file name, if the host loaded it. */
  fontId?(name: string): `otf:${string}` | null;
};

const THEME_FILE_PREFIX: Readonly<Record<BeamerThemeKind, string>> = {
  "theme": "beamertheme",
  "color-theme": "beamercolortheme",
  "font-theme": "beamerfonttheme",
  "inner-theme": "beamerinnertheme",
  "outer-theme": "beameroutertheme",
};

/** The file `\usetheme{name}` and its siblings load. */
export function beamerThemeFileName(kind: BeamerThemeKind, name: string): string {
  return `${THEME_FILE_PREFIX[kind]}${name.trim()}.sty`;
}

const filesByDocument = new WeakMap<BeamerDocumentModel, BeamerProjectFiles>();

/** Attach project files to a scanned document; theme resolution reads them. */
export function withBeamerProjectFiles(document: BeamerDocumentModel, files: BeamerProjectFiles | undefined): BeamerDocumentModel {
  if (!files) return document;
  const attached = { ...document };
  filesByDocument.set(attached, files);
  return attached;
}

export function beamerProjectFiles(document: BeamerDocumentModel): BeamerProjectFiles | undefined {
  return filesByDocument.get(document);
}

/**
 * A theme file as a document whose preamble is the file's text, so the
 * preamble scanners (colors, fonts, theme uses) run on it unchanged.
 * `\mode<...>` switches are blanked, and a braced `\mode<...>{...}` keeps
 * its contents at top level, as TeX sees them in presentation mode. Offsets
 * in the result are those of `text` plus `offset`.
 */
export function scanBeamerThemeFileDocument(text: string): { document: BeamerDocumentModel; offset: number } {
  const prefix = "\\documentclass{beamer}\n";
  const source = `${prefix}${blankModeSwitches(text)}\n\\begin{document}\n\\end{document}\n`;
  return { document: scanBeamerDocument(source), offset: prefix.length };
}

function blankModeSwitches(text: string): string {
  const chars = text.split("");
  for (const match of text.matchAll(/\\mode\s*<[^>]*>/gu)) {
    for (let index = match.index; index < match.index + match[0].length; index += 1) chars[index] = " ";
    let open = match.index + match[0].length;
    while (open < chars.length && /\s/u.test(chars[open] ?? "")) open += 1;
    if (chars[open] !== "{") continue;
    let depth = 0;
    for (let index = open; index < chars.length; index += 1) {
      const char = chars[index];
      if (char === "\\") { index += 1; continue; }
      if (char === "%") { while (index < chars.length && chars[index] !== "\n") index += 1; continue; }
      if (char === "{") depth += 1;
      if (char === "}" && --depth === 0) { chars[open] = " "; chars[index] = " "; break; }
    }
  }
  return chars.join("");
}

const PROJECT_FILE_SEARCH_DEPTH = 4;

/**
 * Read the project files a document needs, following theme files that load
 * further themes. `read` returns null for a file the project does not have
 * (a stock theme, for instance).
 */
export async function collectBeamerProjectFiles(
  source: string,
  read: (name: string) => Promise<string | null>
): Promise<ReadonlyMap<string, string>> {
  const files = new Map<string, string>();
  const tried = new Set<string>();
  let pending = beamerThemeFileRequests(scanBeamerDocument(source));
  for (let depth = 0; depth < PROJECT_FILE_SEARCH_DEPTH && pending.length > 0; depth += 1) {
    const next: string[] = [];
    for (const name of pending) {
      if (tried.has(name)) continue;
      tried.add(name);
      const text = await read(name);
      if (text === null) continue;
      files.set(name, text);
      next.push(...beamerThemeFileRequests(scanBeamerThemeFileDocument(text).document));
    }
    pending = next;
  }
  return files;
}

function beamerThemeFileRequests(document: BeamerDocumentModel): string[] {
  return document.preamble.themes.flatMap(use => use.name.value.split(",")
    .map(name => name.trim())
    .filter(name => /^[A-Za-z0-9_-]+$/u.test(name))
    .map(name => beamerThemeFileName(use.kind, name)));
}

export function createBeamerProjectFiles(files: ReadonlyMap<string, string>, cacheKey: string): BeamerProjectFiles {
  return { cacheKey, readText: name => files.get(name) ?? null };
}

/**
 * Font file names the document's fontspec declarations (in its preamble and
 * in the given theme files) may load, each with fontspec's `Path=` folder.
 * The host loads what it finds and answers `fontId` for those names.
 */
export function beamerFontFileRequests(source: string, themeFiles: ReadonlyMap<string, string> = new Map()): BeamerFontFileRequest[] {
  const documents = [scanBeamerDocument(source), ...[...themeFiles.values()].map(text => scanBeamerThemeFileDocument(text).document)];
  return documents.flatMap(document => beamerFontspecFileRequests(scanBeamerFontspecDeclarations(document)));
}
