import { concatMappedText, createGeneratedMappedText, createIdentityMappedText, type MappedText } from "../../text/source-map.js";
import type { Span } from "../../ast/types.js";

/**
 * Source text with, for each character, its offset in the main document (or
 * -1 for text of a theme file or built by a macro). Template text is passed
 * around in this form so that inserted metadata and text written in the main
 * document stay mapped to their source.
 */
export type TemplateFrag = {
  readonly text: string;
  readonly origin: readonly number[];
};

export const EMPTY_FRAG: TemplateFrag = { text: "", origin: [] };

export function fragFromSource(text: string, sourceOffset: number | null): TemplateFrag {
  return { text, origin: Array.from({ length: text.length }, (_, index) => sourceOffset === null ? -1 : sourceOffset + index) };
}

export function fragSlice(frag: TemplateFrag, from: number, to: number): TemplateFrag {
  return { text: frag.text.slice(from, to), origin: frag.origin.slice(from, to) };
}

export function fragConcat(parts: readonly TemplateFrag[]): TemplateFrag {
  return { text: parts.map(part => part.text).join(""), origin: parts.flatMap(part => part.origin) };
}

export function fragGenerated(text: string): TemplateFrag {
  return { text, origin: Array.from({ length: text.length }, () => -1) };
}

/** Mapped text for a fragment: runs of consecutive main-document offsets are identity-mapped. */
export function fragMappedText(frag: TemplateFrag, owner: Span, reason = "Beamer template text"): MappedText {
  const parts: MappedText[] = [];
  let start = 0;
  while (start < frag.text.length) {
    const first = frag.origin[start] ?? -1;
    let end = start + 1;
    while (end < frag.text.length && (first >= 0
      ? (frag.origin[end] ?? -1) === first + (end - start)
      : (frag.origin[end] ?? -1) < 0)) end += 1;
    const text = frag.text.slice(start, end);
    parts.push(first >= 0 ? createIdentityMappedText(text, first) : createGeneratedMappedText(text, reason, owner));
    start = end;
  }
  return parts.length === 0 ? createGeneratedMappedText("", reason, owner) : concatMappedText(parts);
}

export type TemplateToken =
  | { readonly kind: "cs"; readonly name: string; readonly from: number; readonly to: number; readonly starred: boolean }
  | { readonly kind: "char"; readonly char: string; readonly from: number; readonly to: number }
  | { readonly kind: "space"; readonly from: number; readonly to: number }
  | { readonly kind: "par"; readonly from: number; readonly to: number }
  | { readonly kind: "param"; readonly index: number; readonly from: number; readonly to: number };

const LETTER = /[A-Za-z@]/u;

/** Reader over one fragment. Tokens carry positions in that fragment. */
export class TemplateReader {
  position = 0;
  /** Whether `@` is a letter (inside \makeatletter and theme files). */
  constructor(readonly frag: TemplateFrag) {}

  get done(): boolean { return this.position >= this.frag.text.length; }

  /** The next token, or null at the end. Spaces collapse; a blank line is \par. */
  next(): TemplateToken | null {
    const text = this.frag.text;
    for (;;) {
      if (this.position >= text.length) return null;
      const from = this.position;
      const char = text.charAt(from);
      if (char === "%") {
        while (this.position < text.length && text.charAt(this.position) !== "\n") this.position += 1;
        this.position += 1;
        // The line end is consumed with the comment, and so are the next line's leading blanks.
        while (this.position < text.length && /[ \t]/u.test(text.charAt(this.position))) this.position += 1;
        continue;
      }
      if (/\s/u.test(char)) {
        let newlines = 0;
        while (this.position < text.length && /\s/u.test(text.charAt(this.position))) {
          if (text.charAt(this.position) === "\n") newlines += 1;
          this.position += 1;
        }
        return newlines >= 2 ? { kind: "par", from, to: this.position } : { kind: "space", from, to: this.position };
      }
      if (char === "\\") {
        const nameStart = from + 1;
        if (nameStart >= text.length) { this.position = nameStart; return { kind: "char", char: "\\", from, to: nameStart }; }
        if (LETTER.test(text.charAt(nameStart))) {
          let end = nameStart + 1;
          while (end < text.length && LETTER.test(text.charAt(end))) end += 1;
          const name = text.slice(nameStart, end);
          let to = end;
          // A control word swallows the blanks after it.
          while (to < text.length && /[ \t]/u.test(text.charAt(to))) to += 1;
          if (to < text.length && text.charAt(to) === "\n") {
            // A line end after a control word is also skipped (it would be a space that is dropped).
            to += 1;
            while (to < text.length && /[ \t]/u.test(text.charAt(to))) to += 1;
            if (to < text.length && text.charAt(to) === "\n") { this.position = end; return { kind: "cs", name, from, to: end, starred: false }; }
          }
          const starred = false;
          this.position = to;
          return { kind: "cs", name, from, to: end, starred };
        }
        this.position = nameStart + 1;
        return { kind: "cs", name: text.charAt(nameStart), from, to: nameStart + 1, starred: false };
      }
      if (char === "#" && /[1-9]/u.test(text.charAt(from + 1))) {
        this.position = from + 2;
        return { kind: "param", index: Number(text.charAt(from + 1)), from, to: from + 2 };
      }
      this.position = from + 1;
      return { kind: "char", char, from, to: from + 1 };
    }
  }

  peek(): TemplateToken | null {
    const saved = this.position;
    const token = this.next();
    this.position = saved;
    return token;
  }

  /** Skip blanks (not paragraph breaks) and return the next character without consuming it. */
  peekChar(): string | null {
    let at = this.position;
    const text = this.frag.text;
    for (;;) {
      if (at >= text.length) return null;
      const char = text.charAt(at);
      if (char === "%") { while (at < text.length && text.charAt(at) !== "\n") at += 1; at += 1; continue; }
      if (/\s/u.test(char)) { at += 1; continue; }
      return char;
    }
  }

  skipBlanks(): void {
    const text = this.frag.text;
    for (;;) {
      if (this.position >= text.length) return;
      const char = text.charAt(this.position);
      if (char === "%") { while (this.position < text.length && text.charAt(this.position) !== "\n") this.position += 1; this.position += 1; continue; }
      if (/\s/u.test(char)) { this.position += 1; continue; }
      return;
    }
  }

  /** The balanced `{...}` argument (without braces), or a single token's source. */
  readGroup(): TemplateFrag | null {
    this.skipBlanks();
    const text = this.frag.text;
    if (this.position >= text.length) return null;
    if (text.charAt(this.position) !== "{") {
      const token = this.next();
      return token ? fragSlice(this.frag, token.from, token.to) : null;
    }
    const start = this.position + 1;
    let depth = 0;
    for (let at = this.position; at < text.length; at += 1) {
      const char = text.charAt(at);
      if (char === "\\") { at += 1; continue; }
      if (char === "%") { while (at < text.length && text.charAt(at) !== "\n") at += 1; continue; }
      if (char === "{") depth += 1;
      else if (char === "}" && --depth === 0) {
        this.position = at + 1;
        return fragSlice(this.frag, start, at);
      }
    }
    this.position = text.length;
    return null;
  }

  /** An optional `[...]` argument, if one follows (blanks skipped). */
  readOptional(): TemplateFrag | null {
    const saved = this.position;
    this.skipBlanks();
    const text = this.frag.text;
    if (text.charAt(this.position) !== "[") { this.position = saved; return null; }
    const start = this.position + 1;
    let depth = 0;
    for (let at = this.position + 1; at < text.length; at += 1) {
      const char = text.charAt(at);
      if (char === "\\") { at += 1; continue; }
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === "]" && depth === 0) {
        this.position = at + 1;
        return fragSlice(this.frag, start, at);
      }
    }
    this.position = saved;
    return null;
  }
}

/** Split `key=value, key=value` option text, keeping braced values whole. */
export function splitTemplateOptions(text: string): Array<[string, string | null]> {
  const entries: Array<[string, string | null]> = [];
  let depth = 0;
  let start = 0;
  const flush = (end: number): void => {
    const entry = text.slice(start, end).trim();
    start = end + 1;
    if (!entry) return;
    const equals = entry.indexOf("=");
    if (equals < 0) entries.push([entry, null]);
    else entries.push([entry.slice(0, equals).trim(), entry.slice(equals + 1).trim().replace(/^\{([\s\S]*)\}$/u, "$1")]);
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === "\\") { index += 1; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === "," && depth === 0) flush(index);
  }
  flush(text.length);
  return entries;
}
