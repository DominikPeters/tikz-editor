/**
 * Beamer's `\mode` command (beamerbasemodes.sty) applied to preamble text:
 * the material TeX skips in the current mode is blanked, and the wrappers
 * of the material it keeps are blanked so that the kept declarations are at
 * top level, as `\@firstofone` leaves them. Offsets do not change.
 *
 * The rules, confirmed with LuaLaTeX:
 * - `\mode<spec>{body}` keeps the body (without braces) only when the spec
 *   selects the mode; afterwards the mode in force is re-established.
 * - `\mode<spec>` without a brace group switches. A spec that does not
 *   select the mode skips whole lines, read verbatim, until a line that is
 *   exactly `\mode`, `\mode*`, `\article`, `\presentation` or `\common`
 *   (trailing spaces aside). The line holding the token after `>` (which
 *   `\@ifnextchar` already read; a blank line's `\par` takes the next line
 *   along) is never such a line.
 * - `\mode*` outside frames skips token by token until a frame, a section
 *   command, `\title`/`\author`/`\date`/`\institute`, `\mode` and the like.
 * - `\article`, `\presentation` and `\common` are `\mode<article>`,
 *   `\mode<presentation>` and `\mode<all>`.
 */

/** `\beamer@currentmode`: `beamer`, or `handout`/`trans` from the class options, `second` on a second screen. */
export type BeamerTexMode = "beamer" | "handout" | "trans" | "second" | "article";

/**
 * Whether a mode spec selects the mode, outside frames (slide 1), per
 * beamerbasedecode.sty's `\beamer@decode`. `pauses` is the `beamerpauses`
 * counter, which a `+` advances.
 */
export function beamerModeSpecSelects(spec: string, mode: BeamerTexMode = "beamer", pauses: { value: number } = { value: 0 }): boolean {
  let found = "*";
  let plus = false;
  // \zap@space: spaces in the spec do not count. In a .sty, `@` is a letter, so
  // `alert@1` is one mode name rather than an action.
  for (const part of spec.replace(/\s+/gu, "").split("|")) {
    if (part === "") continue;
    const colon = part.indexOf(":");
    let ovmode = colon < 0 ? "beamer" : part.slice(0, colon);
    let value = colon < 0 ? part : part.slice(colon + 1);
    if (/^[A-Za-z@]/u.test(value)) {
      ovmode = value;
      if (found === "*") found = "0";
      value = "1-";
    }
    if (value.includes("+")) plus = true;
    value = value
      .replace(/\+(?:\((-?\d+)\))?/gu, (_whole, offset: string | undefined) => String(Math.max(0, Number(offset ?? 0) + pauses.value)))
      .replace(/\.(?:\((-?\d+)\))?/gu, (_whole, offset: string | undefined) => String(Math.max(0, Number(offset ?? 0) + pauses.value - 1)));
    const selects = ovmode === mode || ovmode === "all"
      || (ovmode === "presentation" && mode !== "article")
      || (ovmode === "beamer" && mode === "second");
    if (selects) found = value;
  }
  if (plus) pauses.value += 1;
  return found.split(",").some(entry => {
    if (entry === "*") return true;
    const range = /^(\d*)-(\d*)$/u.exec(entry);
    if (range) return (range[1] === "" || Number(range[1]) <= 1) && (range[2] === "" || Number(range[2]) >= 1);
    return /^\d+$/u.test(entry) && Number(entry) === 1;
  });
}

const STOP_LINES = new Set(["\\mode", "\\mode*", "\\article", "\\presentation", "\\common", "\\begin{document}", "\\end{document}"]);
// \beamer@treat: what ends `\mode*`'s skipping outside frames.
const STAR_STOPS = new Set([
  "frame", "lecture", "note", "appendix", "againframe", "section", "subsection", "subsubsection", "part", "maketitle",
  "author", "title", "date", "institute", "article", "mode", "common", "presentation",
]);
const ALIASES: ReadonlyMap<string, string> = new Map([["article", "article"], ["presentation", "presentation"], ["common", "all"]]);

/**
 * `text` with what `\mode` skips in `mode` blanked, between `from` and `to`
 * (the preamble); everything else is unchanged. Text without `\mode` (or its
 * aliases) is returned as is.
 */
export function applyBeamerModes(text: string, mode: BeamerTexMode = "beamer", from = 0, to = text.length): string {
  if (!/\\(?:mode|article|presentation|common)(?![A-Za-z@])/u.test(text.slice(from, to))) return text;
  const chars = text.split("");
  const blank = (start: number, end: number) => {
    for (let index = Math.max(start, from); index < Math.min(end, to); index += 1) if (chars[index] !== "\n") chars[index] = " ";
  };
  const lineEnd = (index: number) => { const end = text.indexOf("\n", index); return end < 0 || end > to ? to : end; };
  const pauses = { value: 0 };
  // \beamer@mode: what a braced \mode re-establishes after its body.
  let starred = false;
  // Matching `}` of a kept braced body, where the mode in force is re-established.
  const closers: number[] = [];
  let index = from;

  /** Where the next token starts: spaces and one line end are skipped; an empty line is `\par`. */
  const nextToken = (start: number): number => {
    let cursor = start;
    while (cursor < to && (text[cursor] === " " || text[cursor] === "\t")) cursor += 1;
    if (text[cursor] !== "\n") return cursor;
    cursor += 1;
    while (cursor < to && (text[cursor] === " " || text[cursor] === "\t")) cursor += 1;
    return text[cursor] === "\n" ? cursor - 1 : cursor;
  };
  /** After `>`: the first token `\@ifnextchar` sees and where verbatim line reading may stop. */
  const peek = (start: number): { at: number; brace: boolean; nextLine: number } => {
    let cursor = start;
    let sawNewline = false;
    for (;;) {
      while (cursor < to && (text[cursor] === " " || text[cursor] === "\t")) cursor += 1;
      if (cursor < to && text[cursor] === "%") { cursor = lineEnd(cursor) + 1; sawNewline = true; continue; }
      if (cursor < to && text[cursor] === "\n") {
        // An empty line is \par: the token seen, and reading takes the next line with it.
        if (sawNewline) { const after = lineEnd(cursor + 1); return { at: cursor, brace: false, nextLine: after + 1 }; }
        sawNewline = true; cursor += 1; continue;
      }
      return { at: cursor, brace: text[cursor] === "{", nextLine: lineEnd(cursor) + 1 };
    }
  };
  const matchingBrace = (open: number): number => {
    let depth = 0;
    for (let cursor = open; cursor < to; cursor += 1) {
      const char = text[cursor];
      if (char === "\\") { cursor += 1; continue; }
      if (char === "%") { cursor = lineEnd(cursor); continue; }
      if (char === "{") depth += 1;
      else if (char === "}" && --depth === 0) return cursor;
    }
    return -1;
  };
  /** Verbatim line skipping from `start` (a line start); returns where scanning resumes. */
  const skipLines = (start: number): number => {
    let line = start;
    while (line < to) {
      const end = lineEnd(line);
      const content = text.slice(line, end).replace(/ +$/u, "");
      if (STOP_LINES.has(content)) return line;
      blank(line, end);
      line = end + 1;
    }
    return to;
  };
  /** `\mode*`'s token skipping from `start`; returns where scanning resumes. */
  const skipTokens = (start: number): number => {
    let cursor = start;
    while (cursor < to) {
      const char = text[cursor];
      if (char === "%") { const end = lineEnd(cursor); blank(cursor, end); cursor = end; continue; }
      if (char === "\\") {
        const name = /^\\([A-Za-z@]+|.)/u.exec(text.slice(cursor, cursor + 64))?.[1] ?? "";
        if (STAR_STOPS.has(name)) return cursor;
        const environment = /^\s*\{\s*([A-Za-z]+)\s*\}/u.exec(text.slice(cursor + 1 + name.length, cursor + name.length + 40))?.[1];
        if ((name === "begin" && environment === "frame") || (name === "end" && environment === "document")) return cursor;
        blank(cursor, cursor + 1 + name.length);
        cursor += 1 + name.length;
        continue;
      }
      blank(cursor, cursor + 1);
      cursor += 1;
    }
    return to;
  };
  /** The mode in force after a kept braced body, or initially: `\mode*` skips again. */
  const reestablish = (at: number): number => (starred && mode !== "article" ? skipTokens(at) : at);

  while (index < to) {
    if (closers.length > 0 && index === closers.at(-1)) {
      closers.pop();
      blank(index, index + 1);
      index = reestablish(index + 1);
      continue;
    }
    const char = text[index];
    if (char === "%") { index = lineEnd(index); continue; }
    if (char !== "\\") { index += 1; continue; }
    const name = /^\\([A-Za-z@]+|.)/u.exec(text.slice(index, index + 64))?.[1] ?? "";
    const start = index;
    index += 1 + name.length;
    let spec: string;
    let specEnd: number;
    if (name === "mode") {
      const cursor = nextToken(index);
      if (text[cursor] === "*") {
        blank(start, cursor + 1);
        starred = true;
        index = mode === "article" ? cursor + 1 : skipTokens(cursor + 1);
        continue;
      }
      if (text[cursor] !== "<") continue;
      const close = text.indexOf(">", cursor);
      if (close < 0 || close >= to) continue;
      spec = text.slice(cursor + 1, close);
      specEnd = close + 1;
    } else {
      const alias = ALIASES.get(name);
      if (alias === undefined) continue;
      spec = alias;
      specEnd = index;
    }
    const selected = beamerModeSpecSelects(spec, mode, pauses);
    const next = peek(specEnd);
    if (next.brace) {
      const close = matchingBrace(next.at);
      if (close < 0) { blank(start, to); index = to; continue; }
      if (selected) {
        blank(start, next.at + 1);
        closers.push(close);
        index = next.at + 1;
      } else {
        blank(start, close + 1);
        index = reestablish(close + 1);
      }
      continue;
    }
    starred = false;
    blank(start, specEnd);
    if (selected) { index = specEnd; continue; }
    // The line with the peeked token is read along with it, verbatim.
    blank(specEnd, next.nextLine);
    index = skipLines(next.nextLine);
  }
  return chars.join("");
}
