/**
 * Text-format command toggles for the canvas format toolbar
 * (design/beamer-canvas-editing.md, "Format toolbar"). Pure functions over
 * a session buffer: the caller supplies the buffer text and a selection in
 * buffer offsets and receives a full replacement buffer plus the post-edit
 * selection, ready for the canvas text-edit machine's `structural_edit`
 * path.
 *
 * The scanner is a lexical approximation of TeX text mode: control
 * symbols (`\{`, `\%`, `\\`) hide the next character, `%` starts a
 * line comment, and braces nest. That is exactly the grammar the native
 * simple-tex engine applies to these buffers, so the toggle edits stay in
 * sync with what the canvas renders.
 */

export type TextFormatCommandName =
  | "textbf"
  | "textit"
  | "underline"
  | "texttt"
  | "alert"
  | "textcolor";

export type TextFormatWrapper = {
  readonly name: TextFormatCommandName;
  /** Offset of the command's backslash. */
  readonly from: number;
  /** Interior of the content argument. */
  readonly contentFrom: number;
  readonly contentTo: number;
  /** Offset just past the closing brace. */
  readonly to: number;
  /** Raw first-argument text for `\textcolor` wrappers. */
  readonly colorValue?: string;
  /** Span of the `\textcolor` color argument interior. */
  readonly colorSpan?: { readonly from: number; readonly to: number };
};

export type TextFormatToggleResult = {
  readonly nextText: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
};

const FORMAT_COMMAND_PATTERN = /\\(textbf|textit|underline|texttt|alert|textcolor)(?![a-zA-Z])/g;

function isEscapedBackslashAt(text: string, index: number): boolean {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    count += 1;
  }
  return count % 2 === 1;
}

function skipSpaces(text: string, offset: number): number {
  let cursor = offset;
  while (cursor < text.length && (text[cursor] === " " || text[cursor] === "\t")) {
    cursor += 1;
  }
  return cursor;
}

/**
 * Matches a braced group starting at `open` (which must be `{`); returns
 * the offset just past the closing brace, or null when unbalanced.
 */
function matchBracedGroup(text: string, open: number): number | null {
  if (text[open] !== "{") {
    return null;
  }
  let depth = 0;
  let cursor = open;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === "%") {
      const lineEnd = text.indexOf("\n", cursor);
      cursor = lineEnd === -1 ? text.length : lineEnd + 1;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return cursor + 1;
      }
    }
    cursor += 1;
  }
  return null;
}

export function scanTextFormatWrappers(text: string): readonly TextFormatWrapper[] {
  const wrappers: TextFormatWrapper[] = [];
  FORMAT_COMMAND_PATTERN.lastIndex = 0;
  for (
    let match = FORMAT_COMMAND_PATTERN.exec(text);
    match;
    match = FORMAT_COMMAND_PATTERN.exec(text)
  ) {
    const from = match.index;
    if (isEscapedBackslashAt(text, from)) {
      continue;
    }
    const name = match[1] as TextFormatCommandName;
    let cursor = skipSpaces(text, from + match[0].length);
    if (name === "alert" && text[cursor] === "<") {
      const specEnd = text.indexOf(">", cursor + 1);
      const nextBrace = text.indexOf("{", cursor + 1);
      if (specEnd === -1 || (nextBrace !== -1 && nextBrace < specEnd)) {
        continue;
      }
      cursor = skipSpaces(text, specEnd + 1);
    }
    let colorValue: string | undefined;
    let colorSpan: { from: number; to: number } | undefined;
    if (name === "textcolor") {
      if (text[cursor] === "[") {
        const modelEnd = text.indexOf("]", cursor + 1);
        if (modelEnd === -1) {
          continue;
        }
        cursor = skipSpaces(text, modelEnd + 1);
      }
      const colorEnd = matchBracedGroup(text, cursor);
      if (colorEnd === null) {
        continue;
      }
      colorSpan = { from: cursor + 1, to: colorEnd - 1 };
      colorValue = text.slice(colorSpan.from, colorSpan.to);
      cursor = skipSpaces(text, colorEnd);
    }
    const contentEnd = matchBracedGroup(text, cursor);
    if (contentEnd === null) {
      continue;
    }
    wrappers.push({
      name,
      from,
      contentFrom: cursor + 1,
      contentTo: contentEnd - 1,
      to: contentEnd,
      ...(colorValue !== undefined ? { colorValue } : {}),
      ...(colorSpan !== undefined ? { colorSpan } : {}),
    });
  }
  return wrappers;
}

/**
 * The innermost wrapper of `name` that either contains the selection in
 * its content argument or is exactly the (trimmed) selection. This is the
 * wrapper a toolbar toggle would remove, and its presence is the button's
 * active state.
 */
export function activeTextFormatWrapper(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  name: TextFormatCommandName
): TextFormatWrapper | null {
  const [start, end] = trimSelection(text, selectionStart, selectionEnd);
  let innermost: TextFormatWrapper | null = null;
  for (const wrapper of scanTextFormatWrappers(text)) {
    if (wrapper.name !== name) {
      continue;
    }
    const containsSelection = wrapper.contentFrom <= start && end <= wrapper.contentTo;
    const isSelection = wrapper.from === start && wrapper.to === end;
    if (!containsSelection && !isSelection) {
      continue;
    }
    if (!innermost || wrapper.from >= innermost.from) {
      innermost = wrapper;
    }
  }
  return innermost;
}

/**
 * A selection is safe to wrap when inserting `\cmd{` before it and `}`
 * after it cannot break the buffer: braces inside are balanced and never
 * close a group opened outside, inline-math `$` toggles pair up, no
 * comment starts inside, and no blank line (paragraph break) splits it —
 * text commands cannot span paragraphs.
 */
export function isTextFormatWrapSafe(
  text: string,
  selectionStart: number,
  selectionEnd: number
): boolean {
  let depth = 0;
  let mathToggles = 0;
  let cursor = selectionStart;
  while (cursor < selectionEnd) {
    const char = text[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === "%") {
      return false;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    } else if (char === "$") {
      mathToggles += 1;
    } else if (char === "\n") {
      const lineEnd = skipSpaces(text, cursor + 1);
      if (text[lineEnd] === "\n") {
        return false;
      }
    }
    cursor += 1;
  }
  return depth === 0 && mathToggles % 2 === 0;
}

function trimSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number
): [number, number] {
  let start = Math.min(selectionStart, selectionEnd);
  let end = Math.max(selectionStart, selectionEnd);
  while (start < end && /\s/.test(text[start])) {
    start += 1;
  }
  while (end > start && /\s/.test(text[end - 1])) {
    end -= 1;
  }
  return [start, end];
}

function unwrapResult(text: string, wrapper: TextFormatWrapper): TextFormatToggleResult {
  const openLength = wrapper.contentFrom - wrapper.from;
  const nextText =
    text.slice(0, wrapper.from) +
    text.slice(wrapper.contentFrom, wrapper.contentTo) +
    text.slice(wrapper.to);
  return {
    nextText,
    selectionStart: wrapper.from,
    selectionEnd: wrapper.contentTo - openLength,
  };
}

function wrapResult(
  text: string,
  start: number,
  end: number,
  prefix: string
): TextFormatToggleResult {
  const nextText = text.slice(0, start) + prefix + text.slice(start, end) + "}" + text.slice(end);
  return {
    nextText,
    selectionStart: start + prefix.length,
    selectionEnd: end + prefix.length,
  };
}

/**
 * Toggles a plain format wrapper (`\textbf`, `\textit`, `\underline`,
 * `\texttt`, `\alert`) around the selection. Returns null when the
 * selection cannot legally be wrapped.
 */
export function toggleTextFormatCommand(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  name: Exclude<TextFormatCommandName, "textcolor">
): TextFormatToggleResult | null {
  const wrapper = activeTextFormatWrapper(text, selectionStart, selectionEnd, name);
  if (wrapper) {
    return unwrapResult(text, wrapper);
  }
  const [start, end] = trimSelection(text, selectionStart, selectionEnd);
  if (!isTextFormatWrapSafe(text, start, end)) {
    return null;
  }
  return wrapResult(text, start, end, `\\${name}{`);
}

/**
 * Applies (or, with `color: null`, removes) a `\textcolor` wrapper. An
 * enclosing wrapper has its color argument replaced in place rather than
 * being nested.
 */
export function applyTextColorCommand(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  color: string | null
): TextFormatToggleResult | null {
  const wrapper = activeTextFormatWrapper(text, selectionStart, selectionEnd, "textcolor");
  if (wrapper) {
    if (color === null) {
      return unwrapResult(text, wrapper);
    }
    const span = wrapper.colorSpan;
    if (!span) {
      return null;
    }
    const delta = color.length - (span.to - span.from);
    const nextText = text.slice(0, span.from) + color + text.slice(span.to);
    const shift = (offset: number): number => (offset > span.to ? offset + delta : offset);
    return {
      nextText,
      selectionStart: shift(selectionStart),
      selectionEnd: shift(selectionEnd),
    };
  }
  if (color === null) {
    return null;
  }
  const [start, end] = trimSelection(text, selectionStart, selectionEnd);
  if (!isTextFormatWrapSafe(text, start, end)) {
    return null;
  }
  return wrapResult(text, start, end, `\\textcolor{${color}}{`);
}
