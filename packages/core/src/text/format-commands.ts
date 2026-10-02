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
  // Keep the regex search outside comments, including comments containing
  // braces that would otherwise make a fake wrapper span visible text.
  let lexicalCursor = 0;
  FORMAT_COMMAND_PATTERN.lastIndex = 0;
  for (
    let match = FORMAT_COMMAND_PATTERN.exec(text);
    match;
    match = FORMAT_COMMAND_PATTERN.exec(text)
  ) {
    const from = match.index;
    while (lexicalCursor < from) {
      if (text[lexicalCursor] === "\\") {
        lexicalCursor += 2;
      } else if (text[lexicalCursor] === "%") {
        const lineEnd = text.indexOf("\n", lexicalCursor);
        lexicalCursor = lineEnd === -1 ? text.length : lineEnd + 1;
      } else lexicalCursor += 1;
    }
    if (lexicalCursor > from) continue;
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
 * wrapper containing a caret; ranged toggles may split several wrappers.
 * Use isTextFormatActive for the active state of a ranged selection.
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
  selectionEnd: number,
  allowParagraphs = false
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
      if (!allowParagraphs && text[lineEnd] === "\n") {
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

type FormatPartition = {
  before: string;
  selected: string;
  after: string;
  /** Whether every selected text fragment inherits the requested format. */
  allActive: boolean;
};

/**
 * Split only recognized inline wrappers at the selection boundaries. Each
 * piece is balanced, so removing a format cannot change adjacent text or
 * discard an unrelated nested style. Unknown TeX groups are never split.
 */
function partitionFormatSelection(
  text: string,
  start: number,
  end: number,
  name: TextFormatCommandName | null
): FormatPartition | null {
  const wrappers = scanTextFormatWrappers(text);
  const visit = (from: number, to: number, active: boolean): FormatPartition | null => {
    const result: FormatPartition = { before: "", selected: "", after: "", allActive: true };
    const appendPlain = (left: number, right: number) => {
      result.before += text.slice(left, Math.min(right, Math.max(left, start)));
      const selected = text.slice(Math.max(left, start), Math.max(left, Math.min(right, end)));
      result.selected += selected;
      if (selected.length > 0 && !active) result.allActive = false;
      result.after += text.slice(Math.min(right, Math.max(left, end)), right);
    };
    let cursor = from;
    for (const wrapper of wrappers) {
      if (wrapper.from < cursor || wrapper.to > to) continue;
      appendPlain(cursor, wrapper.from);
      cursor = wrapper.to;
      if (wrapper.to <= start) {
        result.before += text.slice(wrapper.from, wrapper.to);
        continue;
      }
      if (wrapper.from >= end) {
        result.after += text.slice(wrapper.from, wrapper.to);
        continue;
      }
      // A boundary may sit in content or outside the entire invocation,
      // but never in a command name, color argument, or closing brace.
      if ([start, end].some((offset) =>
        (wrapper.from < offset && offset < wrapper.contentFrom) ||
        (wrapper.contentTo < offset && offset < wrapper.to)
      )) return null;
      const inner = visit(wrapper.contentFrom, wrapper.contentTo, active || wrapper.name === name);
      if (!inner) return null;
      const prefix = text.slice(wrapper.from, wrapper.contentFrom);
      const wrap = (value: string) => value.length > 0 ? prefix + value + "}" : "";
      // Cutting an unknown group or math island would make the cloned
      // wrappers invalid. Leave such source selections untouched.
      if (![inner.before, inner.selected, inner.after].every((value) =>
        isTextFormatWrapSafe(value, 0, value.length)
      )) return null;
      result.before += wrap(inner.before);
      result.selected += wrapper.name === name ? inner.selected : wrap(inner.selected);
      result.after += wrap(inner.after);
      result.allActive &&= inner.allActive;
    }
    appendPlain(cursor, to);
    return result;
  };
  return visit(0, text.length, false);
}

function formatSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  name: TextFormatCommandName,
  prefix: string | null,
  toggle: boolean
): TextFormatToggleResult | null {
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  if (start < 0 || end > text.length) return null;
  // Keep unrelated enclosing styles in place and select only their content.
  const enclosing = scanTextFormatWrappers(text).find((wrapper) =>
    wrapper.contentFrom <= start && end <= wrapper.contentTo
  );
  if (enclosing && enclosing.name !== name) {
    const inner = formatSelection(
      text.slice(enclosing.contentFrom, enclosing.contentTo),
      start - enclosing.contentFrom, end - enclosing.contentFrom, name, prefix, toggle
    );
    return inner ? {
      nextText: text.slice(0, enclosing.contentFrom) + inner.nextText + text.slice(enclosing.contentTo),
      selectionStart: enclosing.contentFrom + inner.selectionStart,
      selectionEnd: enclosing.contentFrom + inner.selectionEnd,
    } : null;
  }
  // A collapsed caret inside a wrapper also splits it: subsequent typing
  // changes style without restyling the existing passage.
  const active = activeTextFormatWrapper(text, start, end, name);
  const parts = partitionFormatSelection(text, start, end, name);
  if (!parts || !isTextFormatWrapSafe(parts.selected, 0, parts.selected.length)) return null;
  const remove = prefix == null || (toggle && (start === end ? active != null : parts.allActive));
  const insertedPrefix = remove ? "" : prefix;
  const selected = insertedPrefix + parts.selected + (remove ? "" : "}");
  let contentStart = 0;
  let contentEnd = parts.selected.length;
  for (const wrapper of scanTextFormatWrappers(parts.selected)) {
    if (wrapper.from === contentStart && wrapper.to === contentEnd) {
      contentStart = wrapper.contentFrom;
      contentEnd = wrapper.contentTo;
    }
  }
  return {
    nextText: parts.before + selected + parts.after,
    selectionStart: parts.before.length + insertedPrefix.length + contentStart,
    selectionEnd: parts.before.length + insertedPrefix.length + contentEnd,
  };
}

/** Toggle a format on exactly the selected text, preserving other styles. */
export function toggleTextFormatCommand(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  name: Exclude<TextFormatCommandName, "textcolor">
): TextFormatToggleResult | null {
  return formatSelection(text, selectionStart, selectionEnd, name, `\\${name}{`, true);
}

/** Apply or remove color on exactly the selection, splitting existing spans. */
export function applyTextColorCommand(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  color: string | null
): TextFormatToggleResult | null {
  return formatSelection(
    text, selectionStart, selectionEnd, "textcolor",
    color == null ? null : `\\textcolor{${color}}{`, false
  );
}

/** Replace a text range while closing/reopening inline styles around the break. */
export function replaceTextFormatSelection(
  text: string,
  start: number,
  end: number,
  insert: string
): TextFormatToggleResult | null {
  const parts = partitionFormatSelection(text, start, end, null);
  if (!parts || !isTextFormatWrapSafe(parts.selected, 0, parts.selected.length, true)) return null;
  const caret = parts.before.length + insert.length;
  return { nextText: parts.before + insert + parts.after, selectionStart: caret, selectionEnd: caret };
}

/** Active state for selections spanning multiple adjacent or nested runs. */
export function isTextFormatActive(
  text: string,
  start: number,
  end: number,
  name: TextFormatCommandName
): boolean {
  if (start === end) return activeTextFormatWrapper(text, start, end, name) != null;
  const parts = partitionFormatSelection(text, Math.min(start, end), Math.max(start, end), name);
  return parts != null && parts.selected.length > 0 && parts.allActive;
}
