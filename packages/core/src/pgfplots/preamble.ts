import type { PgfplotsLibraryStatement, PgfplotsSetStatement, Statement } from "../ast/types.js";
import { skipTexComment } from "../parser/tex-lexical.js";

/** The compat level written when a document sets none (design/pgfplots.md, section 4.5). */
export const DEFAULT_PGFPLOTS_COMPAT = "1.18";

/** What a document's preamble says about pgfplots. */
export type PgfplotsPreamble = {
  /** `\usepackage[…]{pgfplots}` (or `\RequirePackage`): whether it is loaded, and its options. */
  package: { loaded: boolean; optionsRaw?: string };
  /** `\usepgfplotslibrary{…}`, in order, without duplicates. */
  libraries: string[];
  /** The `\pgfplotsset{…}` statements before the picture, in order. */
  settings: PgfplotsSetStatement[];
  /** The last `compat=` among them, if any. */
  compat?: string;
};

/**
 * Collects the pgfplots preamble of a document from the statements read
 * before its picture (a parse with `includeContextDefinitions`) and the text
 * before the picture. Statements inside the picture are its own source.
 */
export function collectPgfplotsPreamble(source: string, statements: readonly Statement[], pictureFrom: number): PgfplotsPreamble {
  const before = (statement: Statement): boolean => statement.span.to <= pictureFrom;
  const settings = statements.filter((statement): statement is PgfplotsSetStatement & Statement => statement.kind === "PgfplotsSet" && before(statement));
  const libraryStatements = statements.filter((statement): statement is PgfplotsLibraryStatement & Statement => statement.kind === "PgfplotsLibrary" && before(statement));
  const libraries = [...new Set(libraryStatements.flatMap((statement) => statement.libraries))];
  const compat = settings.map((statement) => statement.compat?.raw).filter((value): value is string => value !== undefined).at(-1);
  return {
    package: detectPgfplotsPackage(source.slice(0, pictureFrom)),
    libraries,
    settings,
    ...(compat !== undefined ? { compat } : {})
  };
}

const PACKAGE_COMMAND = /\\(?:usepackage|RequirePackage)\s*(\[[^\]]*\])?\s*\{([^{}]*)\}/gu;

/** Whether `\usepackage{…,pgfplots,…}` appears outside comments, with its options. */
export function detectPgfplotsPackage(preamble: string): PgfplotsPreamble["package"] {
  const text = stripComments(preamble);
  for (const match of text.matchAll(PACKAGE_COMMAND)) {
    const names = (match[2] ?? "").split(",").map((name) => name.trim());
    if (names.includes("pgfplots")) {
      const options = match[1]?.slice(1, -1).trim();
      return options ? { loaded: true, optionsRaw: options } : { loaded: true };
    }
  }
  return { loaded: false };
}

function stripComments(text: string): string {
  let result = "";
  let cursor = 0;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === "\\") {
      result += text.slice(cursor, cursor + 2);
      cursor += 2;
      continue;
    }
    if (char === "%") {
      cursor = skipTexComment(text, cursor);
      continue;
    }
    result += char;
    cursor += 1;
  }
  return result;
}

/**
 * The preamble lines a standalone document needs for pgfplots: the package,
 * its libraries, a `compat` level (the document's, or 1.18 when it sets
 * none) and the document's own `\pgfplotsset` settings, verbatim.
 */
export function pgfplotsPreambleLines(source: string, preamble: PgfplotsPreamble): string[] {
  const lines = [`\\usepackage${preamble.package.optionsRaw ? `[${preamble.package.optionsRaw}]` : ""}{pgfplots}`];
  if (preamble.libraries.length > 0) {
    lines.push(`\\usepgfplotslibrary{${preamble.libraries.join(",")}}`);
  }
  if (preamble.compat === undefined) {
    lines.push(`\\pgfplotsset{compat=${DEFAULT_PGFPLOTS_COMPAT}}`);
  }
  for (const setting of preamble.settings) {
    lines.push(source.slice(setting.span.from, setting.span.to).trim());
  }
  return lines;
}
