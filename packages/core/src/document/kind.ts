import { scanBeamerDocumentClass } from "../beamer/scan.js";
import { readTexBalancedDelimited, readTexControlSequence, skipTexWhitespaceAndComments } from "../parser/tex-lexical.js";

/**
 * The editing mode a document selects. Mode follows the file: a
 * `\documentclass{beamer}` source is a Beamer deck whose roots are frames;
 * everything else is a TikZ document whose roots are standalone pictures.
 */
export type DocumentKind = "tikz" | "beamer";

/**
 * A complete leading literal declaration is independent of the document body.
 * Retain its exact lexical prefix as the classification dependency. Complex or
 * unfinished preambles continue through the existing full syntax scanner.
 */
export function documentKindDependencySource(source: string): string {
  const command = readTexControlSequence(source, skipTexWhitespaceAndComments(source, 0));
  if (command?.raw !== "\\documentclass") return source;
  let cursor = skipTexWhitespaceAndComments(source, command.to);
  if (source.charAt(cursor) === "[") {
    const options = readTexBalancedDelimited(source, cursor, "[", "]");
    // TeX controls inside options can change delimiter interpretation. Keep
    // those declarations on the canonical full-parser path.
    if (!options || source.slice(options.from, options.to).includes("\\")) return source;
    cursor = skipTexWhitespaceAndComments(source, options.to);
  }
  const className = readTexBalancedDelimited(source, cursor, "{", "}");
  if (!className || !/^[A-Za-z0-9._-]+$/u.test(source.slice(className.from + 1, className.to - 1).trim())) return source;
  return source.slice(0, className.to);
}

export function detectDocumentKind(source: string): DocumentKind {
  const documentClass = scanBeamerDocumentClass(documentKindDependencySource(source));
  return documentClass?.className.value.trim() === "beamer"
    ? "beamer"
    : "tikz";
}
