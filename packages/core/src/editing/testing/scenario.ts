/**
 * Scenario DSL for canvas editing (design/canvas-editing-architecture.md,
 * "Testing"). A scenario is the notation of
 * design/canvas-keyboard-scenarios.md made executable: a marked frame body,
 * a key sequence, and the expected marked frame body.
 *
 * Marks:
 * - `‸` alone is a collapsed caret.
 * - `⟦…⟧` is a forward selection (focus at `⟧`); `⟦‸…⟧` is a backward
 *   selection (focus at `⟦`).
 *
 * Positions are written as source offsets. Where a source offset is
 * ambiguous between two editor positions (e.g. the inside end of an
 * unbraced script and the position after the scripted atom), write
 * scenarios whose start and end states are unambiguous.
 */

export type MarkedSelection = {
  readonly anchor: number;
  readonly focus: number;
};

export type MarkedSource = {
  readonly source: string;
  readonly selection: MarkedSelection;
};

const CARET = "‸";
const OPEN = "⟦";
const CLOSE = "⟧";

export function parseMarkedSource(marked: string): MarkedSource {
  const caretCount = [...marked].filter((char) => char === CARET).length;
  const openIndex = marked.indexOf(OPEN);
  const closeIndex = marked.indexOf(CLOSE);
  if (openIndex < 0 && closeIndex < 0) {
    if (caretCount !== 1) {
      throw new Error(`Marked source needs exactly one ${CARET} or one ${OPEN}…${CLOSE}: ${marked}`);
    }
    const caret = marked.indexOf(CARET);
    return {
      source: marked.slice(0, caret) + marked.slice(caret + CARET.length),
      selection: { anchor: caret, focus: caret },
    };
  }
  if (
    openIndex < 0 ||
    closeIndex < openIndex ||
    marked.includes(OPEN, openIndex + 1) ||
    marked.includes(CLOSE, closeIndex + 1)
  ) {
    throw new Error(`Malformed selection marks: ${marked}`);
  }
  let inner = marked.slice(openIndex + OPEN.length, closeIndex);
  let backward = false;
  if (caretCount > 1) {
    throw new Error(`At most one ${CARET} inside a selection: ${marked}`);
  }
  if (caretCount === 1) {
    if (inner.startsWith(CARET)) {
      backward = true;
      inner = inner.slice(CARET.length);
    } else if (inner.endsWith(CARET)) {
      inner = inner.slice(0, -CARET.length);
    } else {
      throw new Error(`A ${CARET} in a selection must touch ${OPEN} or ${CLOSE}: ${marked}`);
    }
  }
  const source = marked.slice(0, openIndex) + inner + marked.slice(closeIndex + CLOSE.length);
  const from = openIndex;
  const to = openIndex + inner.length;
  return {
    source,
    selection: backward ? { anchor: to, focus: from } : { anchor: from, focus: to },
  };
}

export function formatMarkedSource(source: string, selection: MarkedSelection): string {
  const { anchor, focus } = selection;
  if (anchor === focus) {
    return source.slice(0, anchor) + CARET + source.slice(anchor);
  }
  const from = Math.min(anchor, focus);
  const to = Math.max(anchor, focus);
  const backwardMark = focus < anchor ? CARET : "";
  return (
    source.slice(0, from) + OPEN + backwardMark + source.slice(from, to) + CLOSE + source.slice(to)
  );
}

export type ScenarioKey =
  | {
      readonly kind: "key";
      /** A DOM `KeyboardEvent.key` value. */
      readonly key: string;
      readonly shift: boolean;
      readonly primary: boolean;
      readonly alt: boolean;
      /** An auto-repeat keystroke (`↻` suffix). */
      readonly repeat: boolean;
    }
  | { readonly kind: "text"; readonly text: string }
  /** A pause longer than any typing-run window (`⏸`). */
  | { readonly kind: "pause" };

const NAMED_KEYS: Readonly<Record<string, string>> = {
  "←": "ArrowLeft",
  "→": "ArrowRight",
  "↑": "ArrowUp",
  "↓": "ArrowDown",
  "⌫": "Backspace",
  "⌦": "Delete",
  "⏎": "Enter",
  "⇥": "Tab",
  "␣": " ",
  Esc: "Escape",
  Home: "Home",
  End: "End",
};

/**
 * Parses a whitespace-separated key sequence.
 * - Named keys: `← → ↑ ↓ ⌫ ⌦ ⏎ ⇥ ␣ Esc Home End`.
 * - Modifier prefixes `⇧ ⌘ ⌥` in any order: `⇧→`, `⌘B`, `⇧⇥`.
 * - `×N` repeats a token N times; a trailing `↻` marks auto-repeat.
 * - `⏸` is a pause (it ends a typing run for undo).
 * - Any other token is typed text, one keystroke per character; inside
 *   text, `␣` types a space (`\cup␣`).
 */
export function parseScenarioKeys(spec: string): ScenarioKey[] {
  const keys: ScenarioKey[] = [];
  for (const rawToken of spec.split(/\s+/u).filter(Boolean)) {
    let token = rawToken;
    let times = 1;
    const repeatMatch = /×(\d+)$/u.exec(token);
    if (repeatMatch) {
      times = Number(repeatMatch[1]);
      token = token.slice(0, repeatMatch.index);
    }
    let autoRepeat = false;
    if (token.endsWith("↻")) {
      autoRepeat = true;
      token = token.slice(0, -1);
    }
    let shift = false;
    let primary = false;
    let alt = false;
    let rest = token;
    for (;;) {
      if (rest.startsWith("⇧")) {
        shift = true;
      } else if (rest.startsWith("⌘")) {
        primary = true;
      } else if (rest.startsWith("⌥")) {
        alt = true;
      } else {
        break;
      }
      rest = rest.slice(1);
    }
    if (rest === "⏸" && !shift && !primary && !alt) {
      for (let index = 0; index < times; index += 1) {
        keys.push({ kind: "pause" });
      }
      continue;
    }
    const named = NAMED_KEYS[rest];
    const modified = shift || primary || alt;
    let parsed: ScenarioKey[];
    if (named !== undefined && (named !== " " || modified)) {
      parsed = [{ kind: "key", key: named, shift, primary, alt, repeat: autoRepeat }];
    } else if (modified) {
      if ([...rest].length !== 1) {
        throw new Error(`Modified key must be a single character or a named key: ${rawToken}`);
      }
      parsed = [{ kind: "key", key: rest.toLowerCase(), shift, primary, alt, repeat: autoRepeat }];
    } else {
      parsed = [...rest.replaceAll("␣", " ")].map((char) => ({ kind: "text" as const, text: char }));
    }
    for (let index = 0; index < times; index += 1) {
      keys.push(...parsed);
    }
  }
  return keys;
}

export type EditorState = {
  readonly source: string;
  readonly selection: MarkedSelection;
};

export interface EditorSession {
  press(key: ScenarioKey): Promise<void>;
  /** Lets deferred work (e.g. layout the editor is waiting for) complete. */
  settle?(): Promise<void>;
  state(): EditorState;
}

/**
 * An editing implementation under test: today's canvas behavior (a legacy
 * driver in test/) or the new editing core once it exists.
 */
export interface EditorDriver {
  readonly name: string;
  open(initial: EditorState & { readonly step: number }): Promise<EditorSession>;
}

export type Scenario = {
  /** Scenario id from design/canvas-keyboard-scenarios.md, e.g. "M7". */
  readonly id: string;
  readonly title: string;
  /** Marked frame body. */
  readonly body: string;
  readonly keys: string;
  /** Expected marked frame body. */
  readonly expect: string;
  /** Extra preamble lines (after \documentclass{beamer}). */
  readonly preamble?: string;
  readonly step?: number;
};

export function beamerScenarioDocument(
  body: string,
  preamble = ""
): { source: string; bodyFrom: number; suffix: string } {
  const prefix =
    `\\documentclass{beamer}\n${preamble ? `${preamble}\n` : ""}` +
    `\\begin{document}\n\\begin{frame}{T}\n`;
  const suffix = `\n\\end{frame}\n\\end{document}\n`;
  return { source: prefix + body + suffix, bodyFrom: prefix.length, suffix };
}

/**
 * Runs a scenario and returns the actual and expected marked bodies, so a
 * test can compare them with a readable diff. The document outside the
 * frame body must be unchanged, and the selection must stay inside it.
 */
export async function runScenario(
  driver: EditorDriver,
  scenario: Scenario
): Promise<{ actual: string; expected: string }> {
  const start = parseMarkedSource(scenario.body);
  const { source, bodyFrom, suffix } = beamerScenarioDocument(start.source, scenario.preamble);
  const prefix = source.slice(0, bodyFrom);
  const session = await driver.open({
    source,
    selection: {
      anchor: bodyFrom + start.selection.anchor,
      focus: bodyFrom + start.selection.focus,
    },
    step: scenario.step ?? 1,
  });
  for (const key of parseScenarioKeys(scenario.keys)) {
    await session.press(key);
  }
  await session.settle?.();
  const end = session.state();
  if (!end.source.startsWith(prefix) || !end.source.endsWith(suffix)) {
    throw new Error(`[${driver.name}] ${scenario.id}: edit escaped the frame body:\n${end.source}`);
  }
  const bodyTo = end.source.length - suffix.length;
  const inBody = (offset: number) => offset >= bodyFrom && offset <= bodyTo;
  if (!inBody(end.selection.anchor) || !inBody(end.selection.focus)) {
    throw new Error(`[${driver.name}] ${scenario.id}: selection left the frame body`);
  }
  const actual = formatMarkedSource(end.source.slice(bodyFrom, bodyTo), {
    anchor: end.selection.anchor - bodyFrom,
    focus: end.selection.focus - bodyFrom,
  });
  return { actual, expected: scenario.expect };
}
