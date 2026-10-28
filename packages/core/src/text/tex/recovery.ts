import { requireDefined } from "../../utils/invariants.js";
import { requireArrayValue } from "../../utils/collections.js";
import type { Span } from "../../ast/types.js";
import { TexWeightedLruCache } from "./cache.js";

/**
 * Recovery from unbalanced TeX (T1, T2, T5): an opener with no closer is
 * closed virtually where its run ends, and a closer with no opener is a
 * stray, so the damage stays inside the construct being edited instead of
 * taking the enclosing list or paragraph down with it.
 *
 * Matching follows TeX's: a `}` closes the innermost open group, and
 * groups and environments nest. Math cannot outlast its paragraph: a blank
 * line, `\par`, `\item` or the end of its environment closes it, as TeX
 * inserts the missing `$` (with an error). A group TeX would carry on to
 * the end of its environment is closed at the end of its own paragraph or
 * item, or before an environment in it, instead: the run the edit is in.
 * Valid source has no recovery.
 */
export type TexVirtualCloser = {
  /** The opener: `{`, `$`, `$$`, `\(` or `\[`. */
  readonly opener: Span;
  readonly kind: "group" | "math" | "display" | "delimiter";
  /** Where the closer is missing: the end of the run's content, before trailing spaces. */
  readonly at: number;
  /** The closer that is missing: `}`, `$`, `$$`, `\\)`, `\\]`, or a `\\left`'s `\\right` (`\\right)`). */
  readonly closer: string;
};

export type TexRecovery = {
  readonly closers: readonly TexVirtualCloser[];
  /** Closers with no opener (`}`, `\)`, `\]`), and openers with nothing to close. */
  readonly strays: readonly Span[];
};

export const NO_TEX_RECOVERY: TexRecovery = { closers: [], strays: [] };

type Frame =
  | { readonly kind: "env"; readonly name: string }
  // A `text` group is in text mode inside math (`\text{… $k$ …}`): its `$` opens a formula of its own.
  | { readonly kind: "group"; readonly opener: Span; readonly text: boolean; runEnd: number | null }
  | { readonly kind: "math"; readonly opener: Span; readonly closer: "$" | "$$" | "\\)" | "\\]" }
  // `\left(` in math, until its `\right`.
  | { readonly kind: "delimiter"; readonly opener: Span; readonly closer: string };

/** The `\right` delimiter that matches a `\left` one. */
const MATCHING_DELIMITERS: Readonly<Record<string, string>> = {
  "(": ")", "[": "]", "\\{": "\\}", "\\lbrace": "\\rbrace", "\\langle": "\\rangle", "<": ">", "\\lvert": "\\rvert",
  "\\lVert": "\\rVert", "\\lfloor": "\\rfloor", "\\lceil": "\\rceil", "\\lgroup": "\\rgroup",
};

/** Environments whose body TeX does not read as tokens. */
const OPAQUE_ENVIRONMENTS = new Set(["verbatim", "verbatim*", "Verbatim", "BVerbatim", "semiverbatim", "lstlisting", "minted", "alltt", "comment"]);

/** Commands whose argument is text even in math. */
const TEXT_ARGUMENT = new Set(["text", "textrm", "textsf", "texttt", "textbf", "textit", "textsl", "textsc", "textup", "textmd",
  "textnormal", "mbox", "hbox", "fbox", "intertext", "shortintertext", "operatorname"]);

/** Definitions, whose bodies are not run where they stand (`\newcommand{\BI}{\begin{itemize}}`). */
const DEFINITIONS = new Set(["newcommand", "renewcommand", "providecommand", "DeclareRobustCommand", "newenvironment",
  "renewenvironment", "def", "gdef", "edef", "xdef", "NewDocumentCommand", "RenewDocumentCommand", "ProvideDocumentCommand",
  "DeclareDocumentCommand", "NewDocumentEnvironment", "RenewDocumentEnvironment", "newcolumntype",
  "defbeamertemplate", "setbeamertemplate", "addtobeamertemplate"]);

// Source keys include whole documents: an entry limit alone can retain many
// large revisions. Keep a single oversized active document reusable as well.
const cache = new TexWeightedLruCache<string, TexRecovery>(128, 2 * 1024 * 1024, {
  retainOversizedEntry: true,
});

/** The recovery a text needs (cached by text). */
export function scanTexRecovery(text: string): TexRecovery {
  const cached = cache.get(text);
  if (cached) {
    return cached;
  }
  const recovery = scan(text);
  cache.set(text, recovery, text.length * 2 + recovery.closers.length * 160 + recovery.strays.length * 64 + 96);
  return recovery;
}

function scan(text: string): TexRecovery {
  // Nothing to recover without one of these.
  if (!/[{}$]|\\[()[\]]/u.test(text)) {
    return NO_TEX_RECOVERY;
  }
  const closers: TexVirtualCloser[] = [];
  const strays: Span[] = [];
  const stack: Frame[] = [];

  /** Comments seen so far: a closer never goes inside one (the spaces they end with are theirs). */
  const comments: Span[] = [];
  /** The run's content ends before trailing spaces, but never before the opener, nor inside a comment. */
  const trimmed = (at: number, floor: number) => {
    let end = at;
    while (end > floor && /\s/u.test(text.charAt(end - 1))) {
      end -= 1;
    }
    // A control space (`\ `) is content: its space stays with its backslash.
    let backslashes = 0;
    while (end - backslashes > floor && text[end - backslashes - 1] === "\\") {
      backslashes += 1;
    }
    if (backslashes % 2 === 1 && end < at) {
      end += 1;
    }
    const comment = comments.find((span) => span.from < end && end < span.to);
    return comment ? comment.to : end;
  };
  // An opener with nothing in its run (a lone `$`, `\textbf{` at the end) has nothing to
  // render closed: it stays a stray, shown as source.
  const unclosed = (frame: Frame, at: number) => {
    if (frame.kind === "env") {
      return;
    }
    const end = frame.kind === "group" ? frame.runEnd ?? trimmed(at, frame.opener.to) : trimmed(at, frame.opener.to);
    if (frame.kind === "delimiter") {
      // (Even with nothing in it yet: `\left(` just typed shows where its `\right` would go.)
      closers.push({ opener: frame.opener, kind: "delimiter", at: end, closer: frame.closer });
    } else if (end === frame.opener.to) {
      strays.push(frame.opener);
    } else if (frame.kind === "group") {
      closers.push({ opener: frame.opener, kind: "group", at: end, closer: "}" });
    } else {
      const display = frame.closer === "$$" || frame.closer === "\\]";
      closers.push({ opener: frame.opener, kind: display ? "display" : "math", at: end, closer: frame.closer });
    }
  };
  /** The innermost frame of a kind above the innermost environment or text group. */
  const nearest = (test: (frame: Frame) => boolean): number => {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const frame = requireArrayValue(stack, index);
      if (test(frame)) {
        return index;
      }
      if (frame.kind === "env" || (frame.kind === "group" && frame.text)) {
        return -1;
      }
    }
    return -1;
  };
  /** The end of the balanced group at `from`, or null if it does not close. */
  const groupEnd = (from: number): number | null => {
    let depth = 0;
    for (let cursor = from; cursor < text.length; cursor += 1) {
      if (text[cursor] === "\\") {
        cursor += 1;
      } else if (text[cursor] === "%") {
        const end = text.indexOf("\n", cursor);
        cursor = end < 0 ? text.length : end;
      } else if (text[cursor] === "{") {
        depth += 1;
      } else if (text[cursor] === "}" && --depth === 0) {
        return cursor + 1;
      }
    }
    return null;
  };
  const popTo = (index: number, at: number) => {
    while (stack.length > index) {
      unclosed(requireDefined(stack.pop(), "Recovery stack frame is required."), at);
    }
  };
  /** A paragraph or item ends: math cannot outlast it, and a group still open there ends its run. */
  const runEnds = (at: number) => {
    const math = nearest((frame) => frame.kind === "math");
    if (math >= 0) {
      // Math and everything opened in it.
      let lowest = math;
      for (let index = math - 1; index >= 0; index -= 1) {
        const frame = requireArrayValue(stack, index);
        if (frame.kind === "env" || (frame.kind === "group" && frame.text)) {
          break;
        }
        if (frame.kind === "math") {
          lowest = index;
        }
      }
      popTo(lowest, at);
    }
    const top = stack.at(-1);
    if (top?.kind === "group" && top.runEnd == null) {
      top.runEnd = trimmed(at, top.opener.to);
    }
  };

  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "%") {
      const end = text.indexOf("\n", index);
      comments.push({ from: index, to: end < 0 ? text.length : end });
      index = end < 0 ? text.length : end;
      continue;
    }
    if (char === "\n") {
      // A blank line (spaces allowed on it) ends the paragraph.
      let next = index + 1;
      while (next < text.length && (text[next] === " " || text[next] === "\t" || text[next] === "\r")) {
        next += 1;
      }
      if (text[next] === "\n") {
        runEnds(index);
        while (next < text.length && /\s/u.test(text.charAt(next))) {
          next += 1;
        }
        index = next;
        continue;
      }
      index += 1;
      continue;
    }
    if (char === "\\") {
      const word = /^[A-Za-z@]+/u.exec(text.slice(index + 1, index + 40));
      if (!word) {
        const symbol = text[index + 1] ?? "";
        const span = { from: index, to: index + 2 };
        if (symbol === "(" || symbol === "[") {
          stack.push({ kind: "math", opener: span, closer: symbol === "(" ? "\\)" : "\\]" });
        } else if (symbol === ")" || symbol === "]") {
          const closer = symbol === ")" ? "\\)" : "\\]";
          const math = nearest((frame) => frame.kind === "math" && frame.closer === closer);
          if (math >= 0) {
            popTo(math + 1, index);
            stack.pop();
          } else {
            strays.push(span);
          }
        }
        index += symbol ? 2 : 1;
        continue;
      }
      const name = word[0];
      const end = index + 1 + name.length;
      if (name === "begin" || name === "end") {
        const environment = /^\s*\{([^{}\n]*)\}/u.exec(text.slice(end, end + 80));
        if (!environment) {
          // `\begin{it` mid-typing: no environment, and its brace is no group either.
          index = text[end] === "{" ? end + 1 : end;
          continue;
        }
        const envName = requireArrayValue(environment, 1).trim();
        const after = end + environment[0].length;
        if (name === "begin") {
          if (OPAQUE_ENVIRONMENTS.has(envName)) {
            const close = text.indexOf(`\\end{${envName}}`, after);
            index = close < 0 ? text.length : close + `\\end{${envName}}`.length;
            continue;
          }
          // In prose, an environment's start ends the run of a group still open before it.
          const top = stack.at(-1);
          if (top?.kind === "group" && top.runEnd == null && nearest((frame) => frame.kind === "math") < 0) {
            top.runEnd = trimmed(index, top.opener.to);
          }
          stack.push({ kind: "env", name: envName });
        } else {
          let open = stack.length - 1;
          while (open >= 0) {
            const frame = requireArrayValue(stack, open);
            if (frame.kind === "env" && frame.name === envName) break;
            open -= 1;
          }
          if (open >= 0) {
            popTo(open + 1, index);
            stack.pop();
          }
        }
        index = after;
        continue;
      }
      if (DEFINITIONS.has(name)) {
        // Past the name and parameters (`\foo`, `[2]`, `#1`) and every braced argument, the body last.
        let cursor = end;
        for (;;) {
          const lead = requireDefined(/^[^{}%\n]*\n?[ \t]*/u.exec(text.slice(cursor, cursor + 80)), "Recovery definition prefix always matches.")[0];
          const close = text[cursor + lead.length] === "{" ? groupEnd(cursor + lead.length) : null;
          if (close == null) {
            break;
          }
          cursor = close;
        }
        index = cursor;
        continue;
      }
      if ((name === "left" || name === "right") && nearest((frame) => frame.kind === "math") >= 0) {
        // `\left` and `\right` pair up within a formula, as TeX's error recovery closes
        // a `\left` with an invisible `\right.` where the formula or group it is in ends.
        const delimiter = /^\s*(\\[A-Za-z]+|\\.|[^\s\\{}])/u.exec(text.slice(end, end + 40));
        const delimiterEnd = delimiter ? end + delimiter[0].length : end;
        const span = { from: index, to: delimiterEnd };
        if (name === "left") {
          const opener = delimiter?.[1] ?? ".";
          stack.push({ kind: "delimiter", opener: span, closer: `\\right${MATCHING_DELIMITERS[opener] ?? (opener === "|" || opener === "\\|" ? opener : ".")}` });
        } else {
          const open = nearest((frame) => frame.kind === "delimiter");
          if (open >= 0) {
            popTo(open + 1, index);
            stack.pop();
          } else {
            strays.push(span);
          }
        }
        index = delimiterEnd;
        continue;
      }
      if (name === "item" || name === "par") {
        runEnds(index);
      } else if (name === "verb") {
        let delimiterAt = end;
        if (text[delimiterAt] === "*") {
          delimiterAt += 1;
        }
        const delimiter = text[delimiterAt];
        const close = delimiter ? text.indexOf(delimiter, delimiterAt + 1) : -1;
        const lineEnd = text.indexOf("\n", delimiterAt);
        index = close >= 0 && (lineEnd < 0 || close < lineEnd) ? close + 1 : end;
        continue;
      }
      index = end;
      continue;
    }
    if (char === "{" && (text[index - 1] === ">" || text[index - 1] === "<")) {
      // A column specification's insertion (`>{$}c<{$}`) holds half of a formula: braces only.
      let depth = 0;
      let cursor = index;
      for (; cursor < text.length; cursor += 1) {
        if (text[cursor] === "\\") {
          cursor += 1;
        } else if (text[cursor] === "{") {
          depth += 1;
        } else if (text[cursor] === "}" && --depth === 0) {
          break;
        }
      }
      if (cursor < text.length) {
        index = cursor + 1;
        continue;
      }
    }
    if (char === "{") {
      const command = /\\([A-Za-z@]+)\s*$/u.exec(text.slice(Math.max(0, index - 40), index));
      const inMath = nearest((frame) => frame.kind === "math") >= 0;
      stack.push({ kind: "group", opener: { from: index, to: index + 1 }, text: inMath && command != null && TEXT_ARGUMENT.has(requireArrayValue(command, 1)), runEnd: null });
      index += 1;
      continue;
    }
    if (char === "}") {
      const top = stack.at(-1);
      if (top?.kind === "group") {
        stack.pop();
      } else {
        const group = nearest((frame) => frame.kind === "group");
        if (group >= 0) {
          // `\textbf{a $b}`: the math ends where its group does.
          popTo(group + 1, index);
          stack.pop();
        } else {
          strays.push({ from: index, to: index + 1 });
        }
      }
      index += 1;
      continue;
    }
    if (char === "$") {
      const double = text[index + 1] === "$";
      const math = nearest((frame) => frame.kind === "math");
      if (math >= 0) {
        const frame = requireArrayValue(stack, math);
        if (frame.kind !== "math") throw new Error("Expected the nearest math frame.");
        const length = frame.closer === "$$" && double ? 2 : 1;
        if (frame.closer === "$" || (frame.closer === "$$" && double)) {
          // `$\frac{a}{$`: groups opened in the math end with it.
          popTo(math + 1, index);
          stack.pop();
          index += length;
          continue;
        }
        strays.push({ from: index, to: index + 1 });
        index += 1;
        continue;
      }
      stack.push({ kind: "math", opener: { from: index, to: index + (double ? 2 : 1) }, closer: double ? "$$" : "$" });
      index += double ? 2 : 1;
      continue;
    }
    index += 1;
  }
  popTo(0, text.length);
  if (closers.length === 0 && strays.length === 0) {
    return NO_TEX_RECOVERY;
  }
  closers.sort((left, right) => left.opener.from - right.opener.from);
  strays.sort((left, right) => left.from - right.from);
  return { closers, strays };
}

/**
 * The text with each unclosed opener and stray closer masked (same
 * length), for a parser whose own error recovery would otherwise spread:
 * the rest then parses as it did before the edit. The mask is `*`, a
 * token of one character that never merges with its neighbours (spaces
 * would join the whitespace around them).
 */
export function maskTexRecovery(text: string, recovery: TexRecovery): string {
  // (`\left` and `\right` are the math parser's to recover, which it does: they stay.)
  const spans = [...recovery.closers.filter((closer) => closer.kind !== "delimiter").map((closer) => closer.opener), ...recovery.strays]
    .filter((span) => !text.startsWith("\\left", span.from) && !text.startsWith("\\right", span.from))
    .sort((left, right) => left.from - right.from);
  if (spans.length === 0) {
    return text;
  }
  let masked = "";
  let cursor = 0;
  for (const span of spans) {
    masked += text.slice(cursor, span.from) + "*".repeat(span.to - span.from);
    cursor = span.to;
  }
  return masked + text.slice(cursor);
}

/** The virtual closer of the opener at `from`, if it has one. */
export function texVirtualCloserAt(recovery: TexRecovery, from: number): TexVirtualCloser | null {
  return recovery.closers.find((closer) => closer.opener.from === from) ?? null;
}
